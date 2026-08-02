import type { ApiType, LlmProviderConfig, LlmSettings } from './types'

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
