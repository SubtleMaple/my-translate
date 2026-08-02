import { app } from 'electron'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'

/**
 * sql.js 数据库初始化
 * - wasm 加载：统一 readFileSync 后以 wasmBinary 传入，绕开 locateFile 在打包环境的路径问题
 *   dev 从 node_modules 读；packaged 从 resourcesPath 读（electron-builder extraResources 带出）
 * - 迁移：PRAGMA user_version 管理版本，逐版本应用 MIGRATIONS
 * - 文件损坏：备份为 .corrupt.<时间戳> 后重建空库，不阻塞启动
 */

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
  }
]

let db: Database | null = null
let sqlStatic: SqlJsStatic | null = null

export function dbPath(): string {
  return join(app.getPath('userData'), 'my-translate.db')
}

function wasmPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'sql-wasm.wasm')
    : join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
}

function getUserVersion(db: Database): number {
  const res = db.exec('PRAGMA user_version')
  const row = res?.[0]?.values?.[0]
  return row ? Number(row[0]) : 0
}

function setUserVersion(db: Database, v: number): void {
  db.run(`PRAGMA user_version = ${v}`)
}

function migrate(db: Database): void {
  let v = getUserVersion(db)
  while (v < MIGRATIONS.length) {
    MIGRATIONS[v](db)
    v += 1
    setUserVersion(db, v)
  }
}

/**
 * 初始化数据库
 * @returns needFlush = true 表示发生了建表/迁移/重建，需要立即落盘一次
 */
export async function initDatabase(): Promise<{ needFlush: boolean }> {
  sqlStatic = await initSqlJs({ wasmBinary: readFileSync(wasmPath()) })

  const p = dbPath()
  if (existsSync(p)) {
    try {
      db = new sqlStatic.Database(readFileSync(p))
      const before = getUserVersion(db)
      migrate(db)
      const needFlush = getUserVersion(db) !== before
      return { needFlush }
    } catch (e) {
      // 文件损坏或版本不兼容：备份后重建，不阻塞启动
      console.error('[db] 数据库加载失败，备份并重建:', e)
      try {
        renameSync(p, `${p}.corrupt.${Date.now()}`)
      } catch {
        /* 忽略备份失败 */
      }
    }
  }

  db = new sqlStatic.Database()
  migrate(db)
  return { needFlush: true }
}

export function getDb(): Database {
  if (!db) {
    throw new Error('数据库尚未初始化')
  }
  return db
}
