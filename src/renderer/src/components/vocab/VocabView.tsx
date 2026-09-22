import { useEffect, useState } from 'react'
import { BookOpen, SearchX, EyeOff } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useVocabStore } from '@/stores/vocabStore'
import { VocabCard } from './VocabCard'
import { VocabToolbar } from './VocabToolbar'

export function VocabView() {
  const entries = useVocabStore((s) => s.entries)
  const loading = useVocabStore((s) => s.loading)
  const search = useVocabStore((s) => s.search)
  const load = useVocabStore((s) => s.load)
  const error = useVocabStore((s) => s.error)
  const refresh = useVocabStore((s) => s.refresh)
  const [review, setReview] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-semibold">{review ? '生词自测' : '生词本'}</h1>
          <p className="text-xs text-muted-foreground" role="status">{loading ? '正在更新…' : `${search ? '匹配 ' : ''}${entries.length} 个词条`}</p>
        </div>
        <Button
          size="sm" variant={review ? 'secondary' : 'outline'} aria-pressed={review}
          onClick={() => { setReview(!review); useVocabStore.setState({ expandedId: null }) }}
        >
          <EyeOff className="mr-1.5 h-3.5 w-3.5" />
          {review ? '退出自测' : '开始自测'}
        </Button>
      </div>
      <VocabToolbar />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {review && <p className="rounded-md bg-primary/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">先回忆词义，再点击词条揭晓。再次点击隐藏答案。</p>}
        {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive"><span className="min-w-0 flex-1">{error}</span><Button size="sm" variant="outline" onClick={() => void refresh()}>重试</Button></div>}
        {loading && entries.length === 0 && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {!loading && !error && entries.length === 0 && !search && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">生词本还是空的</p>
            <p className="text-xs text-muted-foreground/80">
              翻译时选中原文中的单词，即可加入生词本并自动生成学习详情
            </p>
          </div>
        )}

        {!loading && !error && entries.length === 0 && search && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <SearchX className="h-8 w-8 text-muted-foreground/50" />
            <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">没有找到与「{search}」匹配的生词</p>
          </div>
        )}

        {entries.map((entry) => (
          <VocabCard key={entry.id} entry={entry} review={review} />
        ))}
      </div>
    </div>
  )
}
