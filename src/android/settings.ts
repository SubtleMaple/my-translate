import { DEFAULT_SETTINGS, type AppSettings, type DeepPartial } from '../shared/types'
import { normalizeLlmShape } from '../shared/llm'
import { readStored, writeStored } from './native'

export function mergeSettings<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const result = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.prototype.hasOwnProperty.call(base, key) || value === undefined) continue
    const k = key as keyof T
    result[k] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeSettings(base[k], value) : value as T[keyof T]
  }
  return result
}
let cache: AppSettings | undefined
export function getSettings(): AppSettings {
  if (!cache) {
    const stored = readStored('settings')
    cache = mergeSettings(DEFAULT_SETTINGS, stored ? normalizeLlmShape(JSON.parse(stored)) : {})
  }
  return cache
}
export function updateSettings(patch: DeepPartial<AppSettings>): AppSettings {
  const next = mergeSettings(getSettings(), patch)
  // Synchronous native atomic write completes before returning success to the UI.
  writeStored('settings', JSON.stringify(next))
  cache = next
  return next
}
