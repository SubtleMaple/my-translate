import { useEffect } from 'react'
import { Check, Loader2, RefreshCw, Shuffle, Sparkles, Undo2, X } from 'lucide-react'
import { CEFR_LEVELS, TOPIC_LABELS } from '@shared/types'
import { Button } from '@/components/ui/button'
import { useRecommendationStore } from '@/stores/recommendationStore'
import { useLookupStore } from '@/stores/lookupStore'
import { useUiStore } from '@/stores/uiStore'

export function RecommendationPanel() {
  const { page, busy, error, load, feedback, undo, preference, cancel } = useRecommendationStore()
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
      </div>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy || !page || page.needsLevel} onClick={() => void load({ action: 'next' })}><Shuffle className="h-3 w-3" />换一组</Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="更新推荐" aria-label="更新推荐" disabled={busy || !!(page && (!page.canGenerate || page.needsLevel))} onClick={() => void load({ action: 'refresh' })}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
    {page?.needsLevel && <div className="rounded-xl border bg-card p-3">
      <p className="text-xs leading-5 text-muted-foreground">还没有足够的词库依据。选一个大致难度开始，之后会随词库和反馈调整。</p>
      <div className="mt-2 flex flex-wrap gap-2">{CEFR_LEVELS.map(level => <Button key={level} size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={busy} onClick={() => void preference({ coldLevel: level })}>{level}</Button>)}</div>
      <p className="mt-2 text-[10px] text-muted-foreground">A1–A2 基础 · B1–B2 进阶 · C1–C2 高阶</p>
    </div>}
    {busy && <div role="status" className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在分析词库 / 准备推荐…</span><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancel}>取消推荐</Button></div>}
    {(error || (!page?.needsLevel && page?.message)) && <p role={error ? 'alert' : 'status'} className="break-words text-xs leading-5 text-muted-foreground">{error || page?.message}</p>}
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
    <p className="text-[10px] leading-4 text-muted-foreground">难度与用途由模型估计，并非能力测评。已收录、已认识及近期见过的词会被过滤。</p>
  </section>
}
