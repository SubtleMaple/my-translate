import { DEFAULT_SETTINGS, type ApiType, type LlmProviderConfig, type LlmSettings } from './types'

/**
 * 主/渲染两端共享的 LLM 配置解析（纯函数，无运行时依赖）
 * 统一入口，避免各处散落 type 判断
 */

export interface ActiveLlm {
  type: ApiType
  config: LlmProviderConfig
}

export function getActiveLlm(llm: LlmSettings): ActiveLlm {
  if (llm.type === 'anthropic') {
    return { type: 'anthropic', config: llm.anthropic }
  }
  return { type: 'openai', config: llm.openai }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * R1 迁移：旧版 llm 平铺结构 {baseURL, apiKey, model} → 嵌套结构
 * 仅当 llm 存在且缺少 openai/anthropic 键、且存在旧平铺键时执行，避免误迁移
 */
export function normalizeLlmShape(raw: unknown): unknown {
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
