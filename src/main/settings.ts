import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { AppSettings, DEFAULT_SETTINGS, DeepPartial } from '../shared/types'
import { normalizeLlmShape } from '../shared/llm'

/**
 * 自写 JSON 配置存储（替代 electron-store，保持 CJS 单模块体系）
 * - 位置：userData/settings.json
 * - 写策略：内存缓存 + 300ms 防抖 + 原子写（tmp → rename），退出前 flushSettings 强制落盘
 * - 迁移：loadSettings 读盘后规范化（R1：llm 平铺结构 → 嵌套 openai/anthropic，见 shared/llm.ts）
 */

let cache: AppSettings | null = null
let saveTimer: NodeJS.Timeout | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch === undefined ? base : (patch as T)
  }
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const bv = (base as Record<string, unknown>)[k]
    out[k] = isPlainObject(bv) && isPlainObject(v) ? deepMerge(bv, v) : v
  }
  return out as T
}

export function loadSettings(): AppSettings {
  if (cache) return cache
  let merged = DEFAULT_SETTINGS
  const p = settingsPath()
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf-8'))
      merged = deepMerge(DEFAULT_SETTINGS, normalizeLlmShape(raw))
    }
  } catch {
    // 文件损坏：备份后用默认值，不阻塞启动
    try {
      renameSync(p, `${p}.corrupt.${Date.now()}`)
    } catch {
      /* 忽略 */
    }
  }
  cache = merged
  return cache
}

export function getSettings(): AppSettings {
  return loadSettings()
}

export function updateSettings(patch: DeepPartial<AppSettings>): AppSettings {
  cache = deepMerge(loadSettings(), patch)
  scheduleSave()
  return cache
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => flushSettings(), 300)
}

/** 退出前必须调用：取消防抖并同步落盘 */
export function flushSettings(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!cache) return
  try {
    const p = settingsPath()
    mkdirSync(dirname(p), { recursive: true })
    const tmp = `${p}.tmp`
    writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8')
    renameSync(tmp, p)
  } catch (e) {
    console.error('[settings] 保存设置失败:', e)
  }
}
