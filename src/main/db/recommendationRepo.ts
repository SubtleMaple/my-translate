import { randomUUID } from 'node:crypto'
import type { WordRecommendation } from '../../shared/types'
import { DAY, DEFAULT_RECOMMENDATION_STATE, wordKey, type RecommendationHistory, type RecommendationState, type WordAnalysis } from '../../shared/recommendations'
import { getDb } from './database'
import { markDirty } from './persist'

function rows(sql: string, params: (string | number)[] = []): unknown[][] {
  const statement = getDb().prepare(sql)
  try {
    statement.bind(params)
    const output: unknown[][] = []
    while (statement.step()) output.push(statement.get())
    return output
  } finally { statement.free() }
}
export function getRecommendationState(): RecommendationState {
  const row = rows('SELECT payload FROM recommendation_state WHERE id=1')[0]
  return row ? { ...DEFAULT_RECOMMENDATION_STATE, ...JSON.parse(String(row[0])) } : { ...DEFAULT_RECOMMENDATION_STATE, currentIds: [], queueIds: [] }
}
export function saveRecommendationState(state: RecommendationState): void {
  getDb().run('INSERT OR REPLACE INTO recommendation_state (id,payload) VALUES (1,?)', [JSON.stringify(state)])
  markDirty()
}
export function getAnalyses(): Map<number, { fingerprint: string; analysis: WordAnalysis }> {
  return new Map(rows('SELECT entry_id,fingerprint,payload FROM recommendation_analysis').map(r => [Number(r[0]), { fingerprint: String(r[1]), analysis: JSON.parse(String(r[2])) }]))
}
export function saveAnalysis(fingerprint: string, analysis: WordAnalysis): void {
  getDb().run('INSERT OR REPLACE INTO recommendation_analysis (entry_id,fingerprint,payload) VALUES (?,?,?)', [analysis.entryId, fingerprint, JSON.stringify(analysis)])
  markDirty()
}
export function getCandidates(): WordRecommendation[] {
  return rows('SELECT payload FROM recommendation_candidates ORDER BY created_at DESC,word_lower ASC').map(r => JSON.parse(String(r[0])))
}
export function getCandidate(id: string): WordRecommendation | null {
  const row = rows('SELECT payload FROM recommendation_candidates WHERE id=?', [id])[0]
  return row ? JSON.parse(String(row[0])) : null
}
/** 新候选与新批次在同一事务内提交，保存失败不会破坏尚未查完的旧队列。 */
export function saveCandidates(items: Omit<WordRecommendation, 'id'>[], now: number, activateState?: RecommendationState): void {
  const db = getDb()
  const candidates = items.map(item => ({ ...item, id: randomUUID() }))
  db.run('BEGIN')
  try {
    for (const candidate of candidates) {
      db.run('INSERT OR REPLACE INTO recommendation_candidates (id,word_lower,payload,created_at) VALUES (?,?,?,?)', [candidate.id, wordKey(candidate.word), JSON.stringify(candidate), now])
    }
    db.run('DELETE FROM recommendation_candidates WHERE created_at < ?', [now - 30 * DAY])
    db.run('DELETE FROM recommendation_candidates WHERE id NOT IN (SELECT id FROM recommendation_candidates ORDER BY created_at DESC LIMIT 200)')
    db.run('DELETE FROM recommendation_analysis WHERE entry_id NOT IN (SELECT id FROM vocabulary)')
    if (activateState) {
      const ids = candidates.map(item => item.id)
      saveRecommendationState({ ...activateState, batchIds: ids, queueIds: ids, currentIds: ids.slice(0, 3) })
      recordShown(candidates.slice(0, 3), now)
    }
    db.run('COMMIT'); markDirty()
  } catch (error) { db.run('ROLLBACK'); throw error }
}
function consumeCandidates(words: string[]): void {
  const state = getRecommendationState()
  if (state.batchIds === null) return // 旧版缓存将在首次读取时按历史记录迁移。
  const consumed = new Set(words.map(wordKey))
  const queueIds = state.queueIds.filter(id => {
    const item = getCandidate(id)
    return item && ![item.word, ...item.forms].some(word => consumed.has(wordKey(word)))
  })
  if (queueIds.length !== state.queueIds.length) {
    saveRecommendationState({ ...state, queueIds, currentIds: state.currentIds.filter(id => queueIds.includes(id)) })
  }
}
export function getRecommendationHistory(): RecommendationHistory[] {
  return rows('SELECT word_lower,kind,topic,updated_at,shown_at,looked_up_at,feedback_word FROM recommendation_history ORDER BY updated_at DESC').map(r => ({
    word: String(r[0]), kind: r[1] as RecommendationHistory['kind'], topic: r[2] as RecommendationHistory['topic'], updatedAt: Number(r[3]), shownAt: Number(r[4]), lookedUpAt: Number(r[5]), feedbackWord: String(r[6])
  }))
}
export function recordShown(items: WordRecommendation[], now: number): void {
  for (const item of items) getDb().run(`INSERT INTO recommendation_history (word_lower,topic,shown_at) VALUES (?,?,?)
    ON CONFLICT(word_lower) DO UPDATE SET shown_at=excluded.shown_at`, [wordKey(item.word), item.topic, now])
  if (items.length) markDirty()
}
export function recordLookup(words: string[], now = Date.now()): void {
  for (const word of new Set(words.map(wordKey))) getDb().run(`INSERT INTO recommendation_history (word_lower,looked_up_at) VALUES (?,?)
    ON CONFLICT(word_lower) DO UPDATE SET looked_up_at=excluded.looked_up_at`, [word, now])
  markDirty()
  // 只有详情成功后才调用；立即落入持久队列，失败/取消不消耗候选。
  consumeCandidates(words)
}
export function recordFeedback(item: WordRecommendation, kind: 'known' | 'skip', now = Date.now()): void {
  for (const word of new Set([item.word, ...item.forms].map(wordKey))) getDb().run(`INSERT INTO recommendation_history (word_lower,kind,topic,updated_at,feedback_word) VALUES (?,?,?,?,?)
    ON CONFLICT(word_lower) DO UPDATE SET kind=excluded.kind,topic=excluded.topic,updated_at=excluded.updated_at,feedback_word=excluded.feedback_word`, [word, kind, item.topic, now, wordKey(item.word)])
  markDirty()
  consumeCandidates([item.word, ...item.forms])
}
export function undoFeedback(word: string): void {
  // 同次词形反馈一同撤销；保留真实查询历史，不把“撤销认识”误当作没查询过。
  const row = rows('SELECT feedback_word FROM recommendation_history WHERE word_lower=?', [wordKey(word)])[0]
  if (!row || !row[0]) return
  getDb().run("UPDATE recommendation_history SET kind='',shown_at=0,feedback_word='' WHERE feedback_word=?", [String(row[0])])
  markDirty()
}
