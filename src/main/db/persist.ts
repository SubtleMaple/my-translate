import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { dbPath, getDb } from './database'

/**
 * sql.js 持久化（sql.js 全内存，必须主动 export 落盘）
 * 策略：变更 → markDirty → 800ms 防抖 db.export() → 写 .tmp → rename 原子替换
 * 退出前必须调用 flushDatabase(true)
 */

let dirty = false
let timer: NodeJS.Timeout | null = null

export function markDirty(): void {
  dirty = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => flushDatabase(), 800)
}

/** @param force 退出/建表等场景强制写盘（忽略脏标记） */
export function flushDatabase(force = false): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!dirty && !force) return
  try {
    const data = getDb().export()
    const p = dbPath()
    mkdirSync(dirname(p), { recursive: true })
    const tmp = `${p}.tmp`
    writeFileSync(tmp, Buffer.from(data))
    renameSync(tmp, p)
    dirty = false
  } catch (e) {
    console.error('[db] 落盘失败:', e)
  }
}
