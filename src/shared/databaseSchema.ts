import type { Database } from 'sql.js'

const MIGRATIONS: readonly ((db: Database) => void)[] = [
  // v1：初始生词表
  (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS vocabulary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        word_lower TEXT NOT NULL UNIQUE,
        phonetic TEXT NOT NULL DEFAULT '',
        pos TEXT NOT NULL DEFAULT '',
        brief TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        context_sentence TEXT NOT NULL DEFAULT '',
        fail_reason TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_vocab_created_at ON vocabulary(created_at)')
  },
  // v2：生词出现次数（重复加入时 count+1，不新建记录）
  (db) => {
    db.run('ALTER TABLE vocabulary ADD COLUMN count INTEGER NOT NULL DEFAULT 1')
  },
  // v3：仅新增摘录写来源，历史词头/详情/次数原样保留
  (db) => {
    db.run("ALTER TABLE vocabulary ADD COLUMN sources TEXT NOT NULL DEFAULT '[]'")
  },
  // v4：推荐辅助数据独立存储，不改写原词条。
  (db) => {
    db.run(`
      CREATE TABLE recommendation_analysis (entry_id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE recommendation_candidates (id TEXT PRIMARY KEY, word_lower TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE recommendation_history (word_lower TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT '', topic TEXT NOT NULL DEFAULT 'general', updated_at INTEGER NOT NULL DEFAULT 0, shown_at INTEGER NOT NULL DEFAULT 0, looked_up_at INTEGER NOT NULL DEFAULT 0, feedback_word TEXT NOT NULL DEFAULT '');
      CREATE TABLE recommendation_state (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL);
    `)
  },
  // v5：记忆状态、评分日志和可恢复会话，与摘录次数分开。
  (db) => {
    db.run(`
      CREATE TABLE review_cards (entry_id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE review_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE review_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, question_id TEXT NOT NULL, entry_id INTEGER NOT NULL, payload TEXT NOT NULL, reverted INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX idx_review_events_entry ON review_events(entry_id);
      CREATE UNIQUE INDEX idx_review_events_question ON review_events(session_id,question_id) WHERE reverted=0;
    `)
  }
]

export function getUserVersion(db: Database): number {
  const res = db.exec('PRAGMA user_version')
  const row = res?.[0]?.values?.[0]
  return row ? Number(row[0]) : 0
}

function setUserVersion(db: Database, v: number): void {
  db.run(`PRAGMA user_version = ${v}`)
}

export function migrate(db: Database): void {
  let v = getUserVersion(db)
  while (v < MIGRATIONS.length) {
    MIGRATIONS[v](db)
    v += 1
    setUserVersion(db, v)
  }
}
