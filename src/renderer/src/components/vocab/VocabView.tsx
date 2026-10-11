import { useEffect } from 'react'
import { BookOpen, SearchX, Shuffle } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useVocabStore } from '@/stores/vocabStore'
import { VocabCard } from './VocabCard'
import { VocabToolbar } from './VocabToolbar'
import { VocabExportDialog } from './VocabExportDialog'
import { ReviewView } from './ReviewView'
import { useReviewStore } from '@/stores/reviewStore'
import { VocabEntryDialog } from './VocabEntryDialog'
import { VocabGroups } from './VocabGroups'
import { VocabWordCloud } from './VocabWordCloud'
import { LEARNING_LABELS } from '@shared/learning'

export function VocabView() {
  const entries = useVocabStore((s) => s.entries)
  const loading = useVocabStore((s) => s.loading)
  const search = useVocabStore((s) => s.search)
  const load = useVocabStore((s) => s.load)
  const error = useVocabStore((s) => s.error)
  const refresh = useVocabStore((s) => s.refresh)
  const review = useReviewStore(s => s.visible)
  const openReview = useReviewStore(s => s.open)
  const viewMode = useVocabStore(s => s.viewMode)
  const learningFilter = useVocabStore(s => s.learningFilter)

  useEffect(() => {
    if (!review) void load()
    const onFocus = () => { if (!review) void refresh(true) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load, review, refresh])

  if (review) return <ReviewView />

  return (
    <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-5xl flex-col gap-3 p-3 sm:p-5">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <p className="eyebrow hidden sm:block">YOUR WORD COLLECTION</p>
          <h1 className="text-lg font-semibold tracking-tight">生词本</h1>
          <p className="text-xs text-muted-foreground" role="status">{loading ? '正在更新…' : `${search || learningFilter !== 'all' ? '匹配 ' : ''}${entries.length} 个词条`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <VocabExportDialog />
          <Button
            size="sm" variant="outline"
            onClick={() => { useVocabStore.setState({ expandedId: null }); openReview() }}
          >
            <Shuffle className="mr-1.5 h-3.5 w-3.5" />开始自测
          </Button>
        </div>
      </div>
      <VocabToolbar />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive"><span className="min-w-0 flex-1">{error}</span><Button size="sm" variant="outline" onClick={() => void refresh()}>重试</Button></div>}
        {loading && entries.length === 0 && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {!loading && !error && entries.length === 0 && !search && learningFilter === 'all' && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">生词本还是空的</p>
            <p className="text-xs text-muted-foreground/80">
              翻译时选中原文中的单词，即可加入生词本并自动生成学习详情
            </p>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (search || learningFilter !== 'all') && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <SearchX className="h-8 w-8 text-muted-foreground/50" />
            <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">没有找到匹配的词条{search ? `：「${search}」` : ''}{learningFilter !== 'all' ? ` · ${LEARNING_LABELS[learningFilter]}` : ''}</p>
            {learningFilter !== 'all' && <Button size="sm" variant="outline" onClick={() => void useVocabStore.getState().setLearningFilter('all')}>显示全部状态</Button>}
          </div>
        )}

        {viewMode === 'list' && entries.map((entry) => (
          <VocabCard key={entry.id} entry={entry} />
        ))}
        {!!entries.length && viewMode === 'groups' && <VocabGroups />}
        {!!entries.length && viewMode === 'cloud' && <VocabWordCloud />}
      </div>
      <VocabEntryDialog />
    </div>
  )
}
