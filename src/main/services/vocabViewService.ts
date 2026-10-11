import { fsrs, State } from 'ts-fsrs'
import { LEARNING_STAGES, type LearningSummary, type VocabViewEntry, type VocabViewQuery, type VocabViewData } from '../../shared/types'
import { compareVocabView, VOCAB_SORTS } from '../../shared/learning'
import { getVocabById, listVocab } from '../db/vocabRepo'
import { getReviewEvidence, getReviewMemories, getReviewMemory, type ReviewEvidence } from '../db/reviewRepo'
import { REVIEW_PARAMETERS, type ReviewMemory } from './reviewScheduler'

const scheduler = fsrs(REVIEW_PARAMETERS)
const DAY = 86_400_000
export function learningSummary(memory: ReviewMemory | null, evidence: ReviewEvidence | undefined, now: number): LearningSummary {
  const empty: LearningSummary = { stage: 'unseen', hasReview: false, limitedEvidence: true, reviewCount: 0, forgottenCount: 0, successCount: 0,
    stabilityDays: null, recall: null, risk: null, lastRating: null, lastReviewAt: null, dueAt: null, due: false, unavailable: false }
  if (!memory) return empty
  const card = memory.card
  if (!card || !Number.isFinite(card.stability) || card.stability <= 0 || !Number.isFinite(card.due) ||
    !Number.isFinite(card.last_review) || !Number.isInteger(card.reps) || card.reps < 1 || ![State.Learning, State.Review, State.Relearning].includes(card.state) ||
    ![1,2,3,4].includes(memory.lastRating)) return { ...empty, hasReview: true, unavailable: true }
  const successCount = evidence?.successes || 0
  const crossDay = successCount >= 2 && evidence?.firstSuccessAt != null && evidence.lastSuccessAt != null && evidence.lastSuccessAt - evidence.firstSuccessAt >= DAY
  let stage: LearningSummary['stage']
  if (memory.lastRating === 1 || card.state === State.Relearning) stage = 'fragile'
  else if (card.state === State.Learning || !crossDay) stage = 'learning'
  else stage = card.stability >= 30 ? 'stable' : 'developing'
  let recall: number | null = null
  // 时钟回拨时保留长期信息，不伪造当前100%回忆率。
  if (now >= card.last_review!) {
    const value = Number(scheduler.get_retrievability({ ...card, due: new Date(card.due), last_review: new Date(card.last_review!) }, new Date(now), false))
    if (Number.isFinite(value)) recall = Math.max(0, Math.min(1, value))
  }
  return { stage, hasReview: true, limitedEvidence: !crossDay, reviewCount: evidence?.reviews ?? card.reps,
    forgottenCount: evidence?.forgotten || 0, successCount, stabilityDays: card.stability, recall,
    risk: recall === null ? null : 1 - recall, lastRating: memory.lastRating, lastReviewAt: card.last_review!, dueAt: card.due, due: card.due <= now, unavailable: false }
}

export function queryVocabView(query: VocabViewQuery = {}, now = Date.now()): VocabViewData {
  if (!query || (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 10000)) ||
    (query.sortBy !== undefined && !VOCAB_SORTS.some(s => s.value === query.sortBy)) ||
    (query.learningFilter !== undefined && query.learningFilter !== 'all' && !LEARNING_STAGES.includes(query.learningFilter))) throw Error('词库展示条件无效')
  const memories = getReviewMemories(), evidence = getReviewEvidence()
  const entries: VocabViewEntry[] = listVocab({ search: query.search }).map(entry => ({ ...entry,
    learning: learningSummary(memories.get(entry.id) || null, evidence.get(entry.id), now) }))
  const stageCounts = { unseen: 0, fragile: 0, learning: 0, developing: 0, stable: 0 }
  for (const entry of entries) stageCounts[entry.learning.stage]++
  const filtered = entries.filter(entry => !query.learningFilter || query.learningFilter === 'all' || entry.learning.stage === query.learningFilter)
  filtered.sort((a, b) => compareVocabView(a, b, query.sortBy || 'time'))
  return { entries: filtered, evaluatedAt: now, stageCounts, matchedCount: entries.length }
}
export function getVocabViewEntry(id: number, now = Date.now()): { entry: VocabViewEntry | null; evaluatedAt: number } {
  if (!Number.isInteger(id) || id <= 0) throw Error('词条标识无效')
  const entry = getVocabById(id)
  return { entry: entry ? { ...entry, learning: learningSummary(getReviewMemory(id), getReviewEvidence(id).get(id), now) } : null, evaluatedAt: now }
}
