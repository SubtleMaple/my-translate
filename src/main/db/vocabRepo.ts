import type { VocabAddResult, VocabEntry, VocabQuery, VocabStatus } from '../../shared/types'
import { getDb } from './database'
import { markDirty } from './persist'

/**
 * 生词表 CRUD（全部变更必须 markDirty 触发落盘）
 */

const SELECT_COLUMNS = `id, word, word_lower, phonetic, pos, brief, detail, note, status, context_sentence, fail_reason, count, created_at, updated_at`

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
    count,
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
    count: Number(count ?? 1),
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
  const order =
    query.sortBy === 'alpha'
      ? 'ORDER BY word_lower ASC'
      : query.sortBy === 'count'
        ? 'ORDER BY count DESC, updated_at DESC'
        : 'ORDER BY created_at DESC, id DESC'

  const stmt = db.prepare(`SELECT ${SELECT_COLUMNS} FROM vocabulary ${where} ${order}`)
  stmt.bind(params)
  const rows: VocabEntry[] = []
  while (stmt.step()) {
    rows.push(toVocabEntry(stmt.get()))
  }
  stmt.free()
  return rows
}

export function addVocab(words: string[], contextSentence: string): VocabAddResult {
  const db = getDb()
  const result: VocabAddResult = { added: [], existed: [], addedIds: [] }
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
      result.addedIds.push(Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]))
    } else {
      // 已存在：不新建记录，出现次数 +1 并刷新更新时间
      db.run(
        'UPDATE vocabulary SET count = count + 1, updated_at = ? WHERE word_lower = ?',
        [now, lower]
      )
      result.existed.push(word)
    }
  }
  if (result.added.length > 0 || result.existed.length > 0) markDirty()
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

export function getVocabById(id: number): VocabEntry | null {
  const stmt = getDb().prepare(`SELECT ${SELECT_COLUMNS} FROM vocabulary WHERE id = ?`)
  stmt.bind([id])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const entry = toVocabEntry(stmt.get())
  stmt.free()
  return entry
}

/** 详情重试入口：置回 pending 并清空失败原因（保留已有字段），随后由队列重新生成 */
export function resetVocabToPending(id: number): void {
  getDb().run(
    "UPDATE vocabulary SET status = 'pending', fail_reason = '', updated_at = ? WHERE id = ?",
    [Date.now(), id]
  )
  markDirty()
}

export interface VocabDetailPatch {
  /** undefined 表示保留库中原值（失败回写时不清已有字段） */
  phonetic?: string
  pos?: string
  brief?: string
  detail?: string
  status: VocabStatus
  failReason?: string
}

/** 详情生成管线（P5）回写入口：COALESCE 语义的部分更新 */
export function updateVocabDetail(id: number, patch: VocabDetailPatch): void {
  getDb().run(
    `UPDATE vocabulary SET
       phonetic = COALESCE(?, phonetic),
       pos = COALESCE(?, pos),
       brief = COALESCE(?, brief),
       detail = COALESCE(?, detail),
       status = ?, fail_reason = ?, updated_at = ?
     WHERE id = ?`,
    [
      patch.phonetic ?? null,
      patch.pos ?? null,
      patch.brief ?? null,
      patch.detail ?? null,
      patch.status,
      patch.failReason ?? '',
      Date.now(),
      id
    ]
  )
  markDirty()
}
