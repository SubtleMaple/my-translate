import { Button } from '@/components/ui/button'
import { useRecommendationStore } from '@/stores/recommendationStore'

export function CorpusReviewProgress() {
  const { page, reviewing, reviewError, pauseReview, continueReview, discardReview } = useRecommendationStore()
  const progress = page?.corpusProgress
  return <>
    {progress && <div className="space-y-2 rounded-lg border p-3 text-xs">
      <p role="status">{reviewing ? '正在精筛' : '精筛已暂停'} · 已审 {progress.done} / {progress.total} 词 · {Math.ceil(progress.done / 40)} / {Math.ceil(progress.total / 40)} 批{progress.skipped ? ` · 已跳过 ${progress.skipped} 词` : ''}</p>
      <progress aria-label="语料精筛进度" className="w-full" value={progress.done} max={progress.total} />
      {reviewing ? <Button size="sm" variant="outline" onClick={() => void pauseReview()}>暂停精筛</Button> :
        <div className="flex gap-2"><Button size="sm" disabled={!page?.canGenerate} onClick={() => void continueReview()}>继续精筛</Button>
          <Button size="sm" variant="ghost" onClick={() => void discardReview()}>放弃任务</Button></div>}
    </div>}
    {reviewError && <p role="alert" className="text-xs text-destructive">{reviewError}</p>}
  </>
}
