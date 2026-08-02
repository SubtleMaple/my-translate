import { ChevronDown, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { VocabEntry } from '@shared/types'
import { useVocabStore } from '@/stores/vocabStore'
import { VocabDetail } from './VocabDetail'

/** 生词卡片：单词/音标/简要释义/添加时间/状态徽标；点击展开详情 */
export function VocabCard({ entry }: { entry: VocabEntry }) {
  const expandedId = useVocabStore((s) => s.expandedId)
  const toggleExpand = useVocabStore((s) => s.toggleExpand)
  const expanded = expandedId === entry.id

  const regenerate = (e: React.MouseEvent) => {
    e.stopPropagation()
    void window.api.regenerateDetail(entry.id)
  }

  return (
    <Card
      className={cn(
        'cursor-pointer transition-colors hover:bg-accent/40',
        expanded && 'bg-accent/40'
      )}
      onClick={() => toggleExpand(entry.id)}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold">{entry.word}</span>
            {entry.pos && <span className="shrink-0 text-xs text-muted-foreground">{entry.pos}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {entry.status === 'pending' && <Badge variant="warning">生成中</Badge>}
            {entry.status === 'failed' && (
              <Badge variant="destructive">失败</Badge>
            )}
            <span className="rounded-full bg-secondary/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              ×{entry.count}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {formatRelativeTime(entry.createdAt)}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                expanded && 'rotate-180'
              )}
            />
          </div>
        </div>

        {entry.status === 'pending' ? (
          <div className="mt-2 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
          </div>
        ) : (
          <>
            {entry.phonetic && (
              <p className="mt-1 text-xs text-muted-foreground">{entry.phonetic}</p>
            )}
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm text-muted-foreground">
                {entry.brief || '（暂无释义）'}
              </p>
              {entry.status === 'failed' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 px-2 text-xs"
                  onClick={regenerate}
                  title="重新生成详情"
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  重试
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {expanded && (
        <div
          className="border-t px-3 pb-3 pt-0"
          onClick={(e) => e.stopPropagation()}
        >
          <VocabDetail entry={entry} />
        </div>
      )}
    </Card>
  )
}
