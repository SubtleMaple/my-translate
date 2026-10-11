import { CEFR_LEVELS, type CefrLevel, type RecommendationTopic, type VocabEntry, type WordRecommendation } from './types'

export interface WordAnalysis {
  entryId: number
  lemma: string
  level: CefrLevel
  topic: RecommendationTopic
  confidence: number
  specialist: boolean
}
export interface RecommendationHistory {
  word: string
  kind: '' | 'known' | 'skip'
  topic: RecommendationTopic
  updatedAt: number
  shownAt: number
  lookedUpAt: number
  feedbackWord?: string
}
export interface RecommendationState {
  coldLevel: CefrLevel | null
  adjustment: number
  currentIds: string[]
  profileKey: string
  generatedAt: number
  lastAttempt: number
  lastError: string
}
export const DEFAULT_RECOMMENDATION_STATE: RecommendationState = {
  coldLevel: null, adjustment: 0, currentIds: [], profileKey: '', generatedAt: 0, lastAttempt: 0, lastError: ''
}
export const DAY = 86_400_000
export const wordKey = (word: string): string => word.trim().toLowerCase().replace(/’/g, "'").replace(/‐/g, '-')

/** 近期24 + 高频18 + 历史均匀抽样18，补齐到最多60条；频次不等同于难度。 */
export function sampleVocabulary(entries: VocabEntry[]): VocabEntry[] {
  const recent = [...entries].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
  const frequent = [...entries].sort((a, b) => b.count - a.count || b.createdAt - a.createdAt)
  const sample = new Map<number, VocabEntry>()
  for (const entry of recent.slice(0, 24)) sample.set(entry.id, entry)
  for (const entry of frequent.slice(0, 18)) sample.set(entry.id, entry)
  for (let i = 0; i < Math.min(18, recent.length); i++) {
    const entry = recent[Math.floor(i * recent.length / Math.min(18, recent.length))]
    sample.set(entry.id, entry)
  }
  for (const entry of recent) {
    if (sample.size >= 60) break
    sample.set(entry.id, entry)
  }
  return [...sample.values()]
}

export function recommendationProfile(entries: VocabEntry[], analyses: WordAnalysis[], state: RecommendationState, now = Date.now()) {
  const byId = new Map(entries.map(e => [e.id, e]))
  const weighted = analyses.filter(a => byId.has(a.entryId)).map(analysis => {
    const entry = byId.get(analysis.entryId)!
    const weight = (entry.createdAt > now - 30 * DAY ? 1.5 : 1) * (1 + Math.min(2, Math.log2(Math.max(1, entry.count))) * 0.15) * (0.5 + analysis.confidence * 0.5)
    return { analysis, weight }
  })
  const common = weighted.filter(a => !a.analysis.specialist)
  const levelSample = common.length >= 3 ? common : weighted
  const ordered = [...levelSample].sort((a, b) => CEFR_LEVELS.indexOf(a.analysis.level) - CEFR_LEVELS.indexOf(b.analysis.level))
  const half = ordered.reduce((n, a) => n + a.weight, 0) / 2
  let sum = 0, estimatedLevel: CefrLevel | null = null
  for (const item of ordered) {
    sum += item.weight
    if (sum >= half) { estimatedLevel = item.analysis.level; break }
  }
  const targetLevel = CEFR_LEVELS[Math.max(0, Math.min(5, CEFR_LEVELS.indexOf(estimatedLevel || state.coldLevel || 'B1') + state.adjustment))]
  const topics = new Map<RecommendationTopic, number>()
  for (const { analysis, weight } of weighted) topics.set(analysis.topic, (topics.get(analysis.topic) || 0) + weight)
  return { estimatedLevel, targetLevel, topics: [...topics].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([topic]) => topic), sampleSize: weighted.length }
}

export function excludedVocabulary(entries: VocabEntry[], analyses: WordAnalysis[]): Set<string> {
  const excluded = new Set(entries.flatMap(e => [e.word, ...(e.sources || []).flatMap(s => [s.original, s.word])]).map(wordKey))
  for (const analysis of analyses) excluded.add(wordKey(analysis.lemma))
  return excluded
}

export function eligibleRecommendation(item: WordRecommendation, excluded: Set<string>, history: RecommendationHistory[], now: number, current = false): boolean {
  const forms = new Set([item.word, ...item.forms].map(wordKey))
  if ([...forms].some(w => excluded.has(w))) return false
  return !history.some(h => forms.has(h.word) && (h.kind === 'known' ||
    (h.kind === 'skip' && h.updatedAt > now - 90 * DAY) || h.lookedUpAt > now - 30 * DAY || (!current && h.shownAt > now - 7 * DAY)))
}

/** 本地控制难度距离、领域需求、实用性和同组多样性；不把模型理由当作分数执行。 */
export function chooseRecommendations(candidates: WordRecommendation[], profile: ReturnType<typeof recommendationProfile>, history: RecommendationHistory[], now: number, chosen: WordRecommendation[] = []): WordRecommendation[] {
  const skipped = history.filter(h => h.kind === 'skip' && h.updatedAt > now - 90 * DAY)
  const target = CEFR_LEVELS.indexOf(profile.targetLevel)
  const ranked = candidates.filter(c => Math.abs(CEFR_LEVELS.indexOf(c.level) - target) <= 1).map(item => {
    const topicIndex = profile.topics.indexOf(item.topic)
    const score = 50 - Math.abs(CEFR_LEVELS.indexOf(item.level) - target) * 22 + item.utility * 3 +
      (topicIndex >= 0 ? 15 - topicIndex * 3 : item.topic === 'general' ? 8 : 0) - Math.min(16, skipped.filter(h => h.topic === item.topic).length * 4)
    return { item, score }
  })
  const result = [...chosen]
  while (result.length < 3) {
    const next = ranked.filter(({ item }) => !result.some(r => r.id === item.id || wordKey(r.family) === wordKey(item.family) ||
      [r.word, ...r.forms].map(wordKey).some(w => [item.word, ...item.forms].map(wordKey).includes(w))))
      .sort((a, b) => (b.score - result.filter(r => r.topic === b.item.topic).length * 12) - (a.score - result.filter(r => r.topic === a.item.topic).length * 12) || a.item.word.localeCompare(b.item.word))[0]
    if (!next) break
    result.push(next.item)
  }
  return result
}
