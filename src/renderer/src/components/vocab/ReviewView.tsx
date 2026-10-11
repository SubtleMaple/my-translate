import { useEffect, useRef } from 'react'
import { ArrowLeft, CheckCircle2, Eye, Loader2, RotateCcw, Shuffle, SkipForward } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useReviewStore } from '@/stores/reviewStore'
import { useVocabStore } from '@/stores/vocabStore'
import type { ReviewMode, ReviewRating } from '@shared/types'
import { VocabExportDialog } from './VocabExportDialog'

const RATINGS: { value: ReviewRating; label: string; hint: string }[] = [
  { value: 1, label: '忘了', hint: '没想起或想错了' }, { value: 2, label: '费力想起', hint: '揭晓前想起，但吃力' },
  { value: 3, label: '记得', hint: '正常独立回忆' }, { value: 4, label: '很熟', hint: '立即想起且确定' }
]
function interval(due: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((due - now) / 60000))
  if (minutes < 60) return `约 ${minutes} 分钟后`
  if (minutes < 1440) return `约 ${Math.round(minutes / 60)} 小时后`
  return `约 ${Math.round(minutes / 1440)} 天后`
}

export function ReviewView() {
  const { overview, session, config, busy, error, close, configure, load, start, resume, reveal, rate, skip, undo, end, setup } = useReviewStore()
  const search = useVocabStore(s => s.searchInput.trim())
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0 }, [session?.question?.id, !!session?.answer])
  useEffect(() => {
    void load()
    const off = window.api.onVocabChanged(() => void load())
    const focus = () => void load()
    window.addEventListener('focus', focus)
    return () => { off(); window.removeEventListener('focus', focus) }
  }, [load])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || document.querySelector('[role="dialog"],[role="listbox"]')) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('input,textarea,select,[contenteditable="true"],[role="combobox"]')) return
      const current = useReviewStore.getState()
      if (current.busy || current.session?.status !== 'active') return
      if (event.code === 'Space' && !current.session.answer && !target?.closest('button')) { event.preventDefault(); void current.reveal() }
      else if (current.session.answer && /^[1-4]$/.test(event.key)) { event.preventDefault(); void current.rate(Number(event.key) as ReviewRating) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])
  const available = overview ? config.mode === 'smart' ? overview.due + overview.fresh : overview.eligible : 0
  const summary = session?.summary
  return <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col gap-3 p-3 sm:p-5">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div><p className="eyebrow hidden sm:block">RECALL · REFLECT · REMEMBER</p><h1 className="text-lg font-semibold">生词自测</h1></div>
      <div className="flex flex-wrap gap-2"><VocabExportDialog /><Button size="sm" variant="outline" title="退出并保留已保存进度" onClick={close}><ArrowLeft className="h-3.5 w-3.5" />退出自测</Button></div>
      <p className="basis-full text-xs text-muted-foreground">{session ? `初测进度 ${session.processed} / ${session.total} · 加练已评分 ${summary!.extraAnswered} 次` : '英文 → 主动回忆释义 · 本地间隔复习'}</p>
    </header>
    <div ref={bodyRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      {error && <div role="alert" className="flex flex-wrap items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><span className="min-w-0 flex-1 break-words">{error}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>刷新</Button></div>}
      {!session && <section className="space-y-4 rounded-2xl border bg-card p-4">
        {overview?.active && <div className="space-y-2 rounded-xl bg-primary/5 p-3 text-sm"><p>上次自测尚未完成 · {overview.active.processed} / {overview.active.total} 个词</p><Button size="sm" disabled={busy} onClick={() => void resume(overview.active!.id)}>继续上次自测</Button><p className="text-xs text-muted-foreground">可继续作答，或进入后结束本轮再开启新一轮。</p></div>}
        <div className="space-y-1.5"><Label>抽词方式</Label><Select value={config.mode} disabled={busy} onValueChange={mode => configure({ mode: mode as ReviewMode })}>
          <SelectTrigger aria-label="自测抽词方式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="smart">智能随机 · 到期与薄弱词优先</SelectItem><SelectItem value="random">全库随机 · 额外练习</SelectItem></SelectContent>
        </Select></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0 space-y-1.5"><Label>本轮词数</Label><Select value={String(config.size)} disabled={busy} onValueChange={size => configure({ size: Number(size) })}>
            <SelectTrigger aria-label="本轮词数"><SelectValue /></SelectTrigger><SelectContent>{[5,10,20,50].map(size => <SelectItem key={size} value={String(size)}>{size} 个词</SelectItem>)}</SelectContent>
          </Select></div>
          <div className="min-w-0 space-y-1.5"><Label>范围</Label><Select value={config.search ? 'search' : 'all'} disabled={busy} onValueChange={value => configure({ search: value === 'search' ? search || config.search : undefined })}>
            <SelectTrigger aria-label="自测范围"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部词库</SelectItem><SelectItem value="search" disabled={!search && !config.search}>当前搜索结果</SelectItem></SelectContent>
          </Select></div>
        </div>
        {config.search && <p className="break-words text-xs text-muted-foreground">搜索范围：{config.search}</p>}
        {overview && <p role="status" className="text-xs leading-6 text-muted-foreground">可自测 {overview.eligible} 个 · 到期 {overview.due} 个 · 从未自测 {overview.fresh} 个<br />{overview.unavailable > 0 && `${overview.unavailable} 个词条尚无可用释义，暂不出题。`}</p>}
        <p className="text-xs leading-6 text-muted-foreground">{config.mode === 'smart' ? '约八成到期词、两成未测词；遗忘风险较高的词更容易抽中，最早到期的词有保底机会。积压较多时优先复习。' : '从当前范围内均匀抽取不重复词条，包含未到期词。评分会按真实练习时间更新记忆状态。'}</p>
        {!available && overview && <p className="rounded-lg bg-muted p-3 text-sm">{overview.eligible ? '当前范围没有到期词或未测词，可以稍后回来，或选择全库随机练习。' : '先收录词条并完成释义生成，再开始自测。'}</p>}
        <Button disabled={busy || !available || !!overview?.active} onClick={() => void start()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}开始本轮</Button>
        <p className="text-[11px] leading-5 text-muted-foreground">不足设定数量时按实际数量出题。复习目标保持率90%是调度参数，并非记忆效果保证。</p>
      </section>}
      {session?.question && <section key={session.question.id} data-review-question={session.question.id} className="space-y-2 rounded-2xl border bg-card p-3 sm:space-y-4 sm:p-6">
        {session.question.repeat > 0 && <p className="eyebrow">RELEARNING · 第 {session.question.repeat} 次加练</p>}
        <div className={session.answer ? 'flex flex-wrap items-baseline gap-x-3 gap-y-1' : 'py-3 text-center sm:py-6'}>
          <h2 className="word-headword break-words text-2xl [overflow-wrap:anywhere] sm:text-3xl">{session.question.word}</h2>
          {session.answer ? <p className="text-xs text-muted-foreground">{session.answer.phonetic} {session.answer.pos}</p> : <p className="mt-3 text-sm text-muted-foreground">先回忆词义，再揭晓答案。</p>}
        </div>
        {session.answer && <>
          <div aria-label="自测答案" className="space-y-2">
            <p className="whitespace-pre-wrap break-words text-base leading-7">{session.answer.brief}</p>
            <details className="rounded-lg bg-muted/50 p-3 text-xs"><summary className="cursor-pointer text-muted-foreground">原句与完整用法</summary>
              <div className="mt-3 space-y-3 break-words [overflow-wrap:anywhere]">
                {session.answer.contextSentence && <p className="whitespace-pre-wrap leading-6 text-muted-foreground">{session.answer.contextSentence}</p>}
                {session.answer.note && <p className="whitespace-pre-wrap leading-6">我的备注：{session.answer.note}</p>}
                <div className="dictionary-prose prose prose-sm max-w-none overflow-x-auto dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{session.answer.detail}</ReactMarkdown></div>
              </div>
            </details>
          </div>
        </>}
      </section>}
      {session && session.status !== 'active' && <section aria-label="自测总结" className="space-y-4 rounded-2xl border bg-card p-4 sm:p-6">
        <CheckCircle2 className="h-8 w-8 text-primary" /><h2 className="text-xl font-semibold">{session.status === 'completed' ? '本轮完成' : '本轮已结束'}</h2>
        <p className="text-sm leading-6">首次自评记得 {summary!.firstRatings[2] + summary!.firstRatings[3] + summary!.firstRatings[4]} / {summary!.firstRated} 个词（含费力想起）</p>
        <div className="grid grid-cols-2 gap-2">{RATINGS.map(item => <div key={item.value} className="rounded-lg bg-muted/60 p-3 text-sm">{item.label}<span className="float-right font-semibold">{summary!.firstRatings[item.value]}</span></div>)}</div>
        <p className="text-xs leading-6 text-muted-foreground">跳过 {summary!.skipped} 次 · 加练评分 {summary!.extraAnswered} 次 · 不可用词条 {summary!.unavailable} 个<br />加练后的成功不计入首次回忆表现。未到时间的复习会留到稍后。</p>
        {summary!.deferred > 0 && <p className="text-sm text-primary">{summary!.deferred} 个词已安排稍后再测，本轮无需等待。</p>}
        {!!summary!.needsWork.length && <div className="space-y-2"><h3 className="text-sm font-medium">仍需巩固</h3>{summary!.needsWork.map(item => <div key={item.entryId} className="flex flex-wrap justify-between gap-1 border-b py-2 text-xs"><span className="break-words font-medium">{item.word}</span><span className="text-muted-foreground">下次：{new Date(item.dueAt).toLocaleString()}</span></div>)}</div>}
        <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={setup}>再来一轮</Button><Button variant="outline" disabled={busy || !session.canUndo} onClick={() => void undo()}>撤销上一题</Button><Button variant="ghost" onClick={close}>返回生词本</Button></div>
      </section>}
    </div>
    {session?.question && <footer aria-label="自测操作" className="shrink-0 space-y-1.5 border-t pt-2">
      {!session.answer ? <Button className="w-full" disabled={busy} onClick={() => void reveal()}><Eye className="h-4 w-4" />揭晓答案<span className="ml-1 text-xs opacity-70">Space</span></Button> : <>
        <p className="text-[10px] leading-4 text-muted-foreground">1–4 评分 · 看答案才想起请选择“忘了”</p>
        <div className="grid grid-cols-4 gap-1.5">{RATINGS.map(item => <Button key={item.value} data-review-rating={item.value} variant="outline" className="h-auto min-w-0 flex-col gap-1 whitespace-normal px-1 py-2 text-xs sm:py-3 sm:text-sm" disabled={busy} title={`${item.value} · ${item.hint}`} onClick={() => void rate(item.value)}>
          <span><span className="hidden sm:inline">{item.value} · </span>{item.label}</span><span className="text-[9px] font-normal text-muted-foreground sm:text-[10px]">{interval(session.preview![item.value], session.serverNow)}</span>
        </Button>)}</div>
      </>}
      <div className="flex justify-between gap-1">
        <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" disabled={busy} onClick={() => void skip()}><SkipForward className="h-3 w-3" />跳过</Button>
        <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" disabled={busy || !session.canUndo} onClick={() => void undo()}><RotateCcw className="h-3 w-3" />撤销上一题</Button>
        <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" disabled={busy} onClick={() => void end()}>结束本轮</Button>
      </div>
    </footer>}
  </div>
}
