import { createEmptyCard, fsrs, type Card, type FSRSParameters, type Grade } from 'ts-fsrs'
import type { ReviewRating, VocabEntry } from '../../shared/types'
import type { ReviewCandidate } from '../../shared/reviewSelection'

export const REVIEW_ENGINE = 'ts-fsrs@5.4.2 / FSRS-6'
export const REVIEW_PARAMETERS: FSRSParameters = JSON.parse(JSON.stringify(fsrs({
  request_retention: 0.9, enable_fuzz: false, enable_short_term: true,
  learning_steps: ['1m', '10m'], relearning_steps: ['1m', '10m']
}).parameters))
export type StoredCard = Omit<Card, 'due' | 'last_review'> & { due: number; last_review?: number }
export interface ReviewMemory { card: StoredCard; lastRating: ReviewRating; engine: string }

function hydrate(memory: ReviewMemory | null, now: number): Card {
  return memory ? { ...memory.card, due: new Date(memory.card.due), last_review: memory.card.last_review === undefined ? undefined : new Date(memory.card.last_review) } : createEmptyCard(new Date(now))
}
function store(card: Card): StoredCard {
  return { ...card, due: card.due.getTime(), last_review: card.last_review?.getTime() }
}
export function scheduleReview(memory: ReviewMemory | null, rating: ReviewRating, now: number, parameters = REVIEW_PARAMETERS) {
  if (memory?.card.last_review !== undefined && now < memory.card.last_review) throw Error('系统时间早于上次复习，请校准时间后重试。')
  const result = fsrs(parameters).next(hydrate(memory, now), new Date(now), rating as Grade)
  return { memory: { card: store(result.card), lastRating: rating, engine: REVIEW_ENGINE } satisfies ReviewMemory,
    log: { ...result.log, due: result.log.due.getTime(), review: result.log.review.getTime() } }
}
export function previewReview(memory: ReviewMemory | null, now: number, parameters = REVIEW_PARAMETERS): Record<ReviewRating, number> {
  // 预览在时钟回拨时仍可展示；真正提交会明确拒绝负时间间隔。
  const time = Math.max(now, memory?.card.last_review || 0)
  return Object.fromEntries(([1, 2, 3, 4] as const).map(rating => [rating, scheduleReview(memory, rating, time, parameters).memory.card.due])) as Record<ReviewRating, number>
}
export function reviewCandidate(entry: VocabEntry, memory: ReviewMemory | null, now: number): ReviewCandidate {
  const recall = memory ? Number(fsrs(REVIEW_PARAMETERS).get_retrievability(hydrate(memory, now), new Date(Math.max(now, memory.card.last_review || 0)), false)) : 0
  return { id: entry.id, fresh: !memory, dueAt: memory?.card.due ?? now,
    intervalMs: memory ? Math.max(0, memory.card.due - (memory.card.last_review ?? now)) : 0,
    recall, lastForgotten: memory?.lastRating === 1, count: entry.count, createdAt: entry.createdAt }
}
