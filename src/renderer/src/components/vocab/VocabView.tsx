import { useEffect } from 'react'
import { BookOpen, SearchX } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { useVocabStore } from '@/stores/vocabStore'
import { VocabCard } from './VocabCard'
import { VocabToolbar } from './VocabToolbar'

export function VocabView() {
  const entries = useVocabStore((s) => s.entries)
  const loading = useVocabStore((s) => s.loading)
  const search = useVocabStore((s) => s.search)
  const load = useVocabStore((s) => s.load)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <VocabToolbar />

      <div className="flex-1 space-y-2 overflow-y-auto">
        {loading && entries.length === 0 && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {!loading && entries.length === 0 && !search && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">生词本还是空的</p>
            <p className="text-xs text-muted-foreground/80">
              翻译时选中原文中的单词，即可加入生词本并自动生成学习详情
            </p>
          </div>
        )}

        {!loading && entries.length === 0 && search && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <SearchX className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">没有找到与「{search}」匹配的生词</p>
          </div>
        )}

        {entries.map((entry) => (
          <VocabCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}
