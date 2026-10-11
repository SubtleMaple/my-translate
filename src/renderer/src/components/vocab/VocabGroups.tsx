import { learningStageOrder, LEARNING_LABELS, learningTooltip } from '@shared/learning'
import { useVocabStore } from '@/stores/vocabStore'

export function VocabGroups() {
  const { entries, sortBy, selectEntry } = useVocabStore()
  return <div className="space-y-3" aria-label="熟悉度分组视图">
    <p className="text-xs leading-5 text-muted-foreground">未自测单独归组；组内沿用当前排序。熟悉度是基于自测的估计。</p>
    {learningStageOrder(sortBy).map(stage => {
      const group = entries.filter(entry => entry.learning.stage === stage)
      if (!group.length) return null
      return <details key={stage} open className="rounded-xl border bg-card" data-learning-stage={stage}>
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium"><span className="learning-ink">{LEARNING_LABELS[stage]}</span><span className="ml-2 text-xs text-muted-foreground">{group.length} 个词</span></summary>
        <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto border-t p-3">
          {group.map(entry => <button key={entry.id} data-group-word={entry.id} className="learning-tag max-w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm hover:bg-accent" title={learningTooltip(entry)} aria-label={`查看 ${entry.word}`} onClick={() => selectEntry(entry.id)}>
            <span className="break-words [overflow-wrap:anywhere]">{entry.word}</span>{entry.learning.due && <span className="ml-1 text-[10px] text-destructive">到期</span>}
          </button>)}
        </div>
      </details>
    })}
  </div>
}
