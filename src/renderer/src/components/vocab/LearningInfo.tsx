import { LEARNING_LABELS, riskLabel } from '@shared/learning'
import type { LearningSummary } from '@shared/types'

export function LearningBadge({ learning }: { learning: LearningSummary }) {
  return <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" data-learning-stage={learning.stage}>
    <span className="learning-tag rounded-full border px-2 py-0.5">{learning.unavailable ? '记录暂不可用' : LEARNING_LABELS[learning.stage]}</span>
    {learning.hasReview && !learning.unavailable && <><span className="text-muted-foreground">{riskLabel(learning)}</span><span className="text-muted-foreground">自测 {learning.reviewCount} 次{learning.limitedEvidence ? ' · 初步' : ''}</span></>}
    {learning.due && <span className="text-destructive">已到期</span>}
  </span>
}
const date = (time: number | null) => time === null ? '—' : new Date(time).toLocaleString()
export function LearningInfo({ learning }: { learning: LearningSummary }) {
  return <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-xs leading-5">
    <h3 className="font-medium">记忆概况</h3><LearningBadge learning={learning} />
    {!learning.hasReview || learning.unavailable ? <p className="text-muted-foreground">{learning.unavailable ? '学习记录暂不可用，当前无法估计熟悉度和风险。' : '尚无有效自测记录，完成自测后可评估熟悉度。'}</p> : <>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        <div><dt className="inline text-muted-foreground">长期稳定性：</dt><dd className="inline">{learning.stabilityDays === null ? '暂无估计' : `约 ${Number(learning.stabilityDays.toFixed(1))} 天`}</dd></div>
        <div><dt className="inline text-muted-foreground">当前回忆率：</dt><dd className="inline">{learning.recall === null ? '暂无估计' : `估计 ${Math.round(learning.recall * 100)}%`}</dd></div>
        <div><dt className="inline text-muted-foreground">最近自评：</dt><dd className="inline">{learning.lastRating ? ['忘了','费力想起','记得','很熟'][learning.lastRating - 1] : '—'}</dd></div>
        <div><dt className="inline text-muted-foreground">有效评分：</dt><dd className="inline">{learning.reviewCount} 次，其中“忘了” {learning.forgottenCount} 次</dd></div>
        <div><dt className="inline text-muted-foreground">上次复习：</dt><dd className="inline">{date(learning.lastReviewAt)}</dd></div>
        <div><dt className="inline text-muted-foreground">下次复习：</dt><dd className="inline">{date(learning.dueAt)}</dd></div>
      </dl>
      <p className="text-muted-foreground">稳定性是模型估计的记忆持续时间；当前风险还取决于距上次复习的时间。{learning.limitedEvidence && '跨日回忆依据不足，当前属于初步估计。'}</p>
    </>}
  </div>
}
