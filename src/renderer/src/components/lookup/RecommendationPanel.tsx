import { useEffect, useRef } from 'react'
import { Check, FileUp, Loader2, RefreshCw, Sparkles, Undo2, X } from 'lucide-react'
import { readCorpusFile } from '@/lib/corpusFile'
import { CorpusReviewProgress } from './CorpusReviewProgress'
import { CorpusPreview } from './CorpusPreview'
import { CEFR_LEVELS, TOPIC_LABELS } from '@shared/types'
import { Button } from '@/components/ui/button'
import { useRecommendationStore } from '@/stores/recommendationStore'
import { useLookupStore } from '@/stores/lookupStore'
import { useUiStore } from '@/stores/uiStore'

export function RecommendationPanel() {
  const { page, busy, importing, reviewing, setMode, importFile, error, load, feedback, undo, preference, cancel } = useRecommendationStore()
  const progress = page?.corpusProgress
  const ai = page?.corpusMode === 'ai'
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void load()
    const off = window.api.onVocabChanged(() => void load({ allowGenerate: false }))
    return () => { off(); cancel() }
  }, [load, cancel])

  return <section aria-label="为你推荐" className="w-full min-w-0 space-y-3 text-left">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" />为你推荐</h2>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{page?.estimatedLevel ? `词库难度估计 ${page.estimatedLevel} · 目标 ${page.targetLevel} · 参考 ${page.sampleSize} 个词` : page?.coldLevel ? `起始难度 ${page.coldLevel} · 目标 ${page.targetLevel}` : '从你的词库和阅读主题发现下一个值得学的词'}</p>
        {!!page?.topics.length && <p className="text-[11px] text-muted-foreground">{page.topics.map(t => TOPIC_LABELS[t]).join(' · ')}</p>}
        {!!page?.batchSize && <p aria-label="本批候选进度" className="mt-1 text-[11px] text-muted-foreground">本批剩余 {page.remainingCount} / {page.batchSize} 个 · 当前显示 {page.items.length} 个</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <select aria-label="语料筛选模式" className="h-8 rounded-md border bg-background px-1 text-xs" value={page?.corpusMode || 'local'} disabled={!page || busy || importing || reviewing} onChange={e => void setMode(e.target.value === 'ai' ? 'ai' : 'local')}><option value="local">本地筛选</option><option value="ai">AI 精筛</option></select>
        <input type="file" ref={fileInput} hidden accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void importFile(() => readCorpusFile(file))
        }} />
        <Button size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={!page || importing || (ai && (!!progress || !page.canGenerate))} title="导入 TXT、Markdown、DOCX 或带文字的 PDF" onClick={() => fileInput.current?.click()}><FileUp className="h-3.5 w-3.5" />导入语料</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" title="更新推荐" aria-label="更新推荐" disabled={busy || importing || !!(page && !page.corpusCount && (!page.canGenerate || page.needsLevel))} onClick={() => void load({ action: 'refresh' })}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
    {importing && <p role="status" className="text-xs text-muted-foreground">正在提取文字并筛选生词…</p>}
    {ai && <p className="text-xs text-muted-foreground">仅向当前模型发送预筛词表和目标难度；每次最多审校 40 词，按模型用量计费。</p>}
    <CorpusReviewProgress />
    {page?.corpusNotice && page.message !== page.corpusNotice && <p role="status" className="text-xs text-muted-foreground">{page.corpusNotice}</p>}
    <CorpusPreview />
    {!!page?.corpusCount && <p className="text-xs text-muted-foreground">语料池还有 {page.corpusCount} 个候选词，刷新时优先使用。</p>}
    {page?.needsLevel && !page.items.length && !page.corpusCount && <div className="rounded-xl border bg-card p-3">
      <p className="text-xs leading-5 text-muted-foreground">还没有足够的词库依据。选一个大致难度开始，之后会随词库和反馈调整。</p>
      <div className="mt-2 flex flex-wrap gap-2">{CEFR_LEVELS.map(level => <Button key={level} size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={busy} onClick={() => void preference({ coldLevel: level })}>{level}</Button>)}</div>
      <p className="mt-2 text-[10px] text-muted-foreground">A1–A2 基础 · B1–B2 进阶 · C1–C2 高阶</p>
    </div>}
    {busy && <div role="status" className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在分析词库 / 准备推荐…</span><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancel}>取消推荐</Button></div>}
    {(error || page?.message) && <p role={error ? 'alert' : 'status'} className="break-words text-xs leading-5 text-muted-foreground">{error || page?.message}</p>}
    {page && !page.canGenerate && <Button size="sm" variant="outline" onClick={() => useUiStore.getState().setView('settings')}>配置推荐模型</Button>}
    <div className="grid gap-2 sm:grid-cols-3">
      {page?.items.map(item => <article key={item.id} data-recommendation-word={item.word} className="flex min-w-0 flex-col rounded-xl border bg-card p-3">
        <button className="min-w-0 text-left" aria-label={`查询推荐词 ${item.word}`} onClick={() => {
          cancel()
          useLookupStore.getState().setInput(item.word)
          void useLookupStore.getState().search(item.id)
        }}><span className="word-headword block break-words text-lg text-primary">{item.word}</span><span className="mt-1 block text-[10px] text-muted-foreground">估计 {item.level} · {TOPIC_LABELS[item.topic]}</span></button>
        <p className="mt-2 flex-1 break-words text-xs leading-5 text-muted-foreground">{item.reason}</p>
        <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
          <Button size="sm" variant="ghost" className="h-7 px-1.5 text-[11px]" disabled={busy} aria-label={`已认识 ${item.word}`} onClick={() => void feedback(item.id, 'known')}><Check className="h-3 w-3" />已认识</Button>
          <Button size="sm" variant="ghost" className="h-7 px-1.5 text-[11px]" disabled={busy} aria-label={`不感兴趣 ${item.word}`} onClick={() => void feedback(item.id, 'skip')}><X className="h-3 w-3" />不感兴趣</Button>
        </div>
      </article>)}
    </div>
    {page && !page.needsLevel && <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground"><span className="mr-1">这一组的难度</span>
      {([['easy', '偏简单'], ['right', '合适'], ['hard', '偏难']] as const).map(([key, label]) => <Button key={key} size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busy || !page.items.length} onClick={() => void preference({ difficulty: key })}>{label}</Button>)}
    </div>}
    {!!page?.feedback.length && <details className="rounded-lg border px-3 py-2 text-xs"><summary className="cursor-pointer text-muted-foreground">已标记 {page.feedback.length} 个词 · 可撤销</summary>
      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">{page.feedback.map(item => <div key={item.word} className="flex items-center justify-between gap-2"><span className="min-w-0 break-words">{item.word} <span className="text-muted-foreground">· {item.kind === 'known' ? '已认识' : '不感兴趣'}</span></span><Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" disabled={busy} aria-label={`撤销 ${item.word}`} onClick={() => void undo(item.word)}><Undo2 className="h-3 w-3" />撤销</Button></div>)}</div>
    </details>}
    <p className="text-[10px] leading-4 text-muted-foreground">可导入 TXT、Markdown、DOCX 和带文字的 PDF。每批最多 10 个词，显示前 3 个。查词或标记后从本批补位；刷新时优先取语料词。语料词难度按词频估计。</p>
  </section>
}
