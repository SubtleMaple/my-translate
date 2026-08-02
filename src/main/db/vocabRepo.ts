import type { VocabAddResult, VocabEntry, VocabQuery, VocabStatus } from '../../shared/types'
import { getDb } from './database'
import { markDirty } from './persist'

/**
 * 生词表 CRUD（全部变更必须 markDirty 触发落盘）
 */

const SELECT_COLUMNS = `id, word, word_lower, phonetic, pos, brief, detail, note, status, context_sentence, fail_reason, created_at, updated_at`

function toVocabEntry(row: unknown[]): VocabEntry {
  const [
    id,
    word,
    _wordLower,
    phonetic,
    pos,
    brief,
    detail,
    note,
    status,
    contextSentence,
    failReason,
    createdAt,
    updatedAt
  ] = row as unknown[]
  return {
    id: Number(id),
    word: String(word ?? ''),
    phonetic: String(phonetic ?? ''),
    pos: String(pos ?? ''),
    brief: String(brief ?? ''),
    detail: String(detail ?? ''),
    note: String(note ?? ''),
    status: String(status ?? 'pending') as VocabStatus,
    contextSentence: String(contextSentence ?? ''),
    failReason: String(failReason ?? ''),
    createdAt: Number(createdAt),
    updatedAt: Number(updatedAt)
  }
}

/** 转义 LIKE 通配符，使搜索退化为纯子串匹配 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`)
}

export function listVocab(query: VocabQuery = {}): VocabEntry[] {
  const db = getDb()
  const clauses: string[] = []
  const params: string[] = []
  if (query.search) {
    const term = `%${escapeLike(query.search)}%`
    clauses.push(`(word LIKE ? ESCAPE '\\' OR brief LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')`)
    params.push(term, term, term, term)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const order = query.sortBy === 'alpha' ? 'ORDER BY word_lower ASC' : 'ORDER BY created_at DESC, id DESC'

  const stmt = db.prepare(`SELECT ${SELECT_COLUMNS} FROM vocabulary ${where} ${order}`)
  stmt.bind(params)
  const rows: VocabEntry[] = []
  while (stmt.step()) {
    rows.push(toVocabEntry(stmt.get()))
  }
  stmt.free()
  return rows
}

/** 返回已存在（小写归一）的词子集 */
export function checkWords(words: string[]): string[] {
  const lowers = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))]
  if (lowers.length === 0) return []
  const db = getDb()
  const placeholders = lowers.map(() => '?').join(', ')
  const stmt = db.prepare(
    `SELECT word_lower FROM vocabulary WHERE word_lower IN (${placeholders})`
  )
  stmt.bind(lowers)
  const found: string[] = []
  while (stmt.step()) {
    const row = stmt.get() as unknown[]
    found.push(String(row[0]))
  }
  stmt.free()
  return found
}

export function addVocab(words: string[], contextSentence: string): VocabAddResult {
  const db = getDb()
  const result: VocabAddResult = { added: [], existed: [] }
  const now = Date.now()
  const seen = new Set<string>()

  for (const raw of words) {
    const word = raw.trim()
    if (!word) continue
    const lower = word.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)

    db.run(
      `INSERT OR IGNORE INTO vocabulary
        (word, word_lower, status, context_sentence, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?)`,
      [word, lower, contextSentence, now, now]
    )
    if (db.getRowsModified() > 0) {
      result.added.push(word)
    } else {
      result.existed.push(word)
    }
  }
  if (result.added.length > 0) markDirty()
  return result
}

export function updateVocabNote(id: number, note: string): void {
  getDb().run('UPDATE vocabulary SET note = ?, updated_at = ? WHERE id = ?', [note, Date.now(), id])
  markDirty()
}

export function deleteVocab(id: number): void {
  getDb().run('DELETE FROM vocabulary WHERE id = ?', [id])
  markDirty()
}

export interface VocabDetailPatch {
  phonetic: string
  pos: string
  brief: string
  detail: string
  status: VocabStatus
  failReason?: string
}

/** 详情生成管线（P5）回写入口 */
export function updateVocabDetail(id: number, patch: VocabDetailPatch): void {
  getDb().run(
    `UPDATE vocabulary SET phonetic = ?, pos = ?, brief = ?, detail = ?, status = ?, fail_reason = ?, updated_at = ?
     WHERE id = ?`,
    [
      patch.phonetic,
      patch.pos,
      patch.brief,
      patch.detail,
      patch.status,
      patch.failReason ?? '',
      Date.now(),
      id
    ]
  )
  markDirty()
}
