import { ChevronDown } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { VocabEntry } from '@shared/types'
import { useVocabStore } from '@/stores/vocabStore'
import { VocabDetail } from './VocabDetail'

/** 折叠按钮与详情中的操作分离，键盘和鼠标均可展开。 */
export function VocabCard({ entry, review = false }: { entry: VocabEntry; review?: boolean }) {
  const expandedId = useVocabStore((s) => s.expandedId)
  const toggleExpand = useVocabStore((s) => s.toggleExpand)
  const expanded = expandedId === entry.id
  const hidden = review && !expanded

  return (
    <Card className={cn('min-w-0 overflow-hidden transition-colors', expanded && 'border-primary/40')}>
      <button
        type="button"
        className="block w-full rounded-lg p-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-expanded={expanded}
        aria-controls={`vocab-detail-${entry.id}`}
        aria-label={`${entry.word}，${expanded ? (review ? '隐藏答案' : '收起详情') : (review ? '揭晓答案' : '展开详情')}`}
        onClick={() => toggleExpand(entry.id)}
      >
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 break-words font-semibold [overflow-wrap:anywhere]">{entry.word}</span>
          <ChevronDown aria-hidden="true" className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {entry.status === 'pending' && <Badge variant="warning">生成中</Badge>}
          {entry.status === 'failed' && <Badge variant="destructive">详情待重试</Badge>}
          <span>摘录 {entry.count} 次</span>
          <span>{formatRelativeTime(entry.createdAt)}</span>
          {review && <span className="font-medium text-primary">{hidden ? '点击揭晓' : '已揭晓 · 点击隐藏'}</span>}
        </span>
        {!hidden && (entry.status === 'pending' ? (
          <span className="mt-2 block space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
          </span>
        ) : (
          <>
            {(entry.phonetic || entry.pos) && <span className="mt-1.5 block break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{[entry.phonetic, entry.pos].filter(Boolean).join(' · ')}</span>}
            <span className="mt-1 block break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{entry.brief || '暂无释义，展开查看状态'}</span>
          </>
        ))}
      </button>
      {expanded && (
        <div id={`vocab-detail-${entry.id}`} className="min-w-0 border-t px-3 pb-3">
          <VocabDetail entry={entry} />
        </div>
      )}
    </Card>
  )
}
