import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import { migrate } from '../shared/databaseSchema'
import { decodeBytes, encodeBytes, readStored, writeStored } from './native'

let db: Database
let dirty = false
let timer: ReturnType<typeof setTimeout> | undefined
export async function initDatabase(wasmBinary?: Uint8Array): Promise<void> {
  const sql = await initSqlJs({ locateFile: () => '/service/sql-wasm.wasm', ...(wasmBinary ? { wasmBinary } : {}) })
  const stored = readStored('database')
  // Never silently replace a damaged database. Surface startup failure and preserve it.
  db = stored ? new sql.Database(decodeBytes(stored)) : new sql.Database()
  if (db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok') throw Error('词库校验失败，原文件已保留')
  if (Number(db.exec('PRAGMA user_version')[0]?.values[0]?.[0]) > 5) throw Error('词库版本较新，请更新应用')
  migrate(db)
  flushDatabase(true)
}
export function getDb(): Database {
  if (!db) throw Error('数据库尚未初始化')
  return db
}
export function markDirty(): void {
  dirty = true
  clearTimeout(timer)
  timer = setTimeout(() => {
    try { flushDatabase() }
    catch { AndroidHost.post(JSON.stringify({ event: 'storage:error', value: '词库保存失败，请检查手机剩余空间，并保持应用打开后重试。' })) }
  }, 0)
}
export function flushDatabase(force = false): void {
  clearTimeout(timer)
  if (!dirty && !force) return
  writeStored('database', encodeBytes(getDb().export()))
  dirty = false
}
