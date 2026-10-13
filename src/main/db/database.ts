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

import { getUserVersion, migrate } from '../../shared/databaseSchema'

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
