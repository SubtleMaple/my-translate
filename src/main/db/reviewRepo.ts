import type { FSRSParameters } from 'ts-fsrs'
import type { ReviewAnswer, ReviewConfig, ReviewRating } from '../../shared/types'
import type { ReviewMemory } from '../services/reviewScheduler'
import { getDb } from './database'
import { markDirty } from './persist'

export interface ReviewItem { id: string; entryId: number; repeat: number; notBefore: number; afterAnswered: number }
export interface ReviewAttempt { questionId: string; entryId: number; word: string; repeat: number; rating: ReviewRating | null; at: number }
export interface ReviewSessionData {
  id: string
  revision: number
  status: 'active' | 'completed' | 'ended'
  config: ReviewConfig
  seed: number
  engine: string
  parameters: FSRSParameters
  baseIds: number[]
  queue: ReviewItem[]
  current: (ReviewItem & { word: string; answer: ReviewAnswer; revealed: boolean }) | null
  attempts: ReviewAttempt[]
  unavailableIds: number[]
  deferredIds: number[]
  createdAt: number
  undo?: { eventId: string; entryId: number; beforeMemory: ReviewMemory | null; beforeSession: Omit<ReviewSessionData, 'undo'> }
}
export interface ReviewEvent {
  id: string; sessionId: string; questionId: string; entryId: number
  commandRevision: number; rating: ReviewRating | null; at: number
  before: ReviewMemory | null; after: ReviewMemory | null; log?: unknown
}

function rows(sql: string, params: (number | string)[] = []): unknown[][] {
  const stmt = getDb().prepare(sql)
  try {
    stmt.bind(params)
    const result: unknown[][] = []
    while (stmt.step()) result.push(stmt.get())
    return result
  } finally { stmt.free() }
}
export function reviewTransaction<T>(operation: () => T): T {
  const db = getDb()
  db.run('BEGIN')
  try { const value = operation(); db.run('COMMIT'); markDirty(); return value }
  catch (error) { db.run('ROLLBACK'); throw error }
}
export function getReviewMemories(): Map<number, ReviewMemory> {
  return new Map(rows('SELECT entry_id,payload FROM review_cards').map(r => [Number(r[0]), JSON.parse(String(r[1]))]))
}
export function getReviewMemory(entryId: number): ReviewMemory | null {
  const row = rows('SELECT payload FROM review_cards WHERE entry_id=?', [entryId])[0]
  return row ? JSON.parse(String(row[0])) : null
}

export interface ReviewEvidence {
  reviews: number; forgotten: number; successes: number; firstSuccessAt: number | null; lastSuccessAt: number | null
}
/** 单次聚合读取，不逐词扫描日志；跳过及撤销记录不作为掌握依据。 */
export function getReviewEvidence(entryId?: number): Map<number, ReviewEvidence> {
  const data = rows(`SELECT entry_id, COUNT(*),
    SUM(CASE WHEN json_extract(payload,'$.rating')=1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN json_extract(payload,'$.rating')>=2 THEN 1 ELSE 0 END),
    MIN(CASE WHEN json_extract(payload,'$.rating')>=2 THEN json_extract(payload,'$.at') END),
    MAX(CASE WHEN json_extract(payload,'$.rating')>=2 THEN json_extract(payload,'$.at') END)
    FROM review_events WHERE reverted=0 AND json_extract(payload,'$.rating') BETWEEN 1 AND 4
    ${entryId === undefined ? '' : 'AND entry_id=?'} GROUP BY entry_id`, entryId === undefined ? [] : [entryId])
  return new Map(data.map(row => [Number(row[0]), { reviews: Number(row[1]), forgotten: Number(row[2]), successes: Number(row[3]),
    firstSuccessAt: row[4] === null ? null : Number(row[4]), lastSuccessAt: row[5] === null ? null : Number(row[5]) }]))
}
export function saveReviewMemory(entryId: number, memory: ReviewMemory | null): void {
  if (memory) getDb().run('INSERT OR REPLACE INTO review_cards (entry_id,payload) VALUES (?,?)', [entryId, JSON.stringify(memory)])
  else getDb().run('DELETE FROM review_cards WHERE entry_id=?', [entryId])
}
export function getReviewSession(id: string): ReviewSessionData | null {
  const row = rows('SELECT payload FROM review_sessions WHERE id=?', [id])[0]
  return row ? JSON.parse(String(row[0])) : null
}
export function activeReviewSession(): ReviewSessionData | null {
  const row = rows("SELECT payload FROM review_sessions WHERE status='active' ORDER BY rowid DESC LIMIT 1")[0]
  return row ? JSON.parse(String(row[0])) : null
}
export function latestReviewSessionId(): string | null {
  const row = rows('SELECT id FROM review_sessions ORDER BY rowid DESC LIMIT 1')[0]
  return row ? String(row[0]) : null
}
export function saveReviewSession(session: ReviewSessionData): void {
  getDb().run(`INSERT INTO review_sessions (id,status,payload) VALUES (?,?,?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload`, [session.id, session.status, JSON.stringify(session)])
}
export function findReviewEvent(sessionId: string, questionId: string): ReviewEvent | null {
  const row = rows('SELECT payload FROM review_events WHERE session_id=? AND question_id=? AND reverted=0', [sessionId, questionId])[0]
  return row ? JSON.parse(String(row[0])) : null
}
export function saveReviewEvent(event: ReviewEvent): void {
  getDb().run('INSERT INTO review_events (id,session_id,question_id,entry_id,payload) VALUES (?,?,?,?,?)',
    [event.id, event.sessionId, event.questionId, event.entryId, JSON.stringify(event)])
}
export function revertReviewEvent(id: string): void {
  getDb().run('UPDATE review_events SET reverted=1 WHERE id=?', [id])
}

/** 删除词条时同步移除学习记录和会话中的快照，不能通过撤销重新创建已删卡片。 */
export function removeReviewEntry(entryId: number): void {
  getDb().run('DELETE FROM review_cards WHERE entry_id=?', [entryId])
  getDb().run('DELETE FROM review_events WHERE entry_id=?', [entryId])
  for (const row of rows('SELECT payload FROM review_sessions')) {
    const session = JSON.parse(String(row[0])) as ReviewSessionData
    if (!session.baseIds.includes(entryId)) continue
    if (!session.unavailableIds.includes(entryId)) session.unavailableIds.push(entryId)
    session.queue = session.queue.filter(item => item.entryId !== entryId)
    if (session.current?.entryId === entryId) session.current = null
    if (session.status === 'active' && !session.current && !session.queue.length) session.status = 'completed'
    session.attempts = session.attempts.filter(item => item.entryId !== entryId)
    session.deferredIds = session.deferredIds.filter(id => id !== entryId)
    delete session.undo
    session.revision++
    saveReviewSession(session)
  }
}
