import type { ReviewMode } from './types'

export interface ReviewCandidate {
  id: number
  fresh: boolean
  dueAt: number
  intervalMs: number
  recall: number
  lastForgotten: boolean
  count: number
  createdAt: number
}
const DAY = 86_400_000

/** 每个会话一次抽样；固定seed可复现实验，不以随机排序比较器制造偏差。 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
export function weightedSample<T>(items: readonly T[], size: number, weight: (item: T) => number, random: () => number): T[] {
  return items.map((item, index) => {
    const w = weight(item)
    const u = Math.max(Number.EPSILON, Math.min(1, random()))
    return { item, index, key: -Math.log(u) / (Number.isFinite(w) ? Math.max(0.01, w) : 1) }
  }).sort((a, b) => a.key - b.key || a.index - b.index).slice(0, Math.max(0, Math.floor(size))).map(({ item }) => item)
}
export function reviewWeight(card: ReviewCandidate, now: number): number {
  const recall = Number.isFinite(card.recall) ? Math.min(1, Math.max(0, card.recall)) : 0.5
  const overdue = Math.min(1, Math.max(0, now - card.dueAt) / Math.max(DAY, card.intervalMs))
  return 1 + 3 * (1 - recall) + 2 * overdue + (card.lastForgotten ? 1 : 0)
}
export function selectReviewCandidates(input: ReviewCandidate[], size: number, mode: ReviewMode, now: number, random: () => number): number[] {
  const candidates = [...new Map(input.map(c => [c.id, c])).values()]
  const limit = Math.max(0, Math.min(50, Math.floor(size)))
  if (!limit) return []
  if (mode === 'random') return weightedSample(candidates, limit, () => 1, random).map(c => c.id)
  const due = candidates.filter(c => !c.fresh && c.dueAt <= now)
  const fresh = candidates.filter(c => c.fresh)
  const newQuota = due.length >= limit * 3 ? 0 : Math.min(fresh.length, Math.ceil(limit * 0.2))
  const dueQuota = Math.min(due.length, limit - newQuota)
  const newCount = Math.min(fresh.length, limit - dueQuota)
  const oldest = [...due].sort((a, b) => a.dueAt - b.dueAt || a.id - b.id).slice(0, Math.ceil(dueQuota * 0.2))
  const selectedDue = [...oldest, ...weightedSample(due.filter(c => !oldest.some(o => o.id === c.id)), dueQuota - oldest.length, c => reviewWeight(c, now), random)]
  const oldestNew = [...fresh].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).slice(0, newCount > 0 ? 1 : 0)
  const selectedNew = [...oldestNew, ...weightedSample(fresh.filter(c => !oldestNew.some(o => o.id === c.id)), newCount - oldestNew.length,
    c => 1 + (c.createdAt >= now - 30 * DAY ? 0.3 : 0) + Math.min(0.5, Math.log2(Math.max(1, c.count)) * 0.1), random)]
  // 初始队列随机交错，新/旧题不按列表排序成块出现；数量与保底集合保持不变。
  return weightedSample([...selectedDue, ...selectedNew], limit, () => 1, random).map(c => c.id)
}
