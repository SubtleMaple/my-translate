import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { AppSettings, DEFAULT_SETTINGS, DeepPartial } from '../shared/types'

/**
 * 自写 JSON 配置存储（替代 electron-store，保持 CJS 单模块体系）
 * - 位置：userData/settings.json
 * - 写策略：内存缓存 + 300ms 防抖 + 原子写（tmp → rename），退出前 flushSettings 强制落盘
 * - 迁移：loadSettings 读盘后规范化（R1：llm 平铺结构 → 嵌套 openai/anthropic）
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

/**
 * R1 迁移：旧版 llm 平铺结构 {baseURL, apiKey, model} → 嵌套结构
 * 仅当 llm 存在且缺少 openai/anthropic 键、且存在旧平铺键时执行，避免误迁移
 */
function normalizeLlmShape(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw
  const llm = raw.llm
  if (!isPlainObject(llm) || llm.openai !== undefined || llm.anthropic !== undefined) {
    return raw
  }
  const { baseURL, apiKey, model, ...rest } = llm
  if (baseURL === undefined && apiKey === undefined && model === undefined) return raw
  return {
    ...raw,
    llm: {
      ...rest,
      type: (typeof llm.type === 'string' ? llm.type : 'openai') as string,
      openai: {
        baseURL: typeof baseURL === 'string' ? baseURL : DEFAULT_SETTINGS.llm.openai.baseURL,
        apiKey: typeof apiKey === 'string' ? apiKey : DEFAULT_SETTINGS.llm.openai.apiKey,
        model: typeof model === 'string' ? model : DEFAULT_SETTINGS.llm.openai.model
      }
    }
  }
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
