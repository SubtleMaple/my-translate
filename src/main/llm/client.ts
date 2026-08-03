import { getActiveLlm } from '../../shared/llm'
import type { LlmSettings, TestConnectionResult } from '../../shared/types'

/**
 * OpenAI 兼容 + Anthropic messages 双协议客户端（主进程 HTTP，规避渲染端 CORS）
 * - chatCompletion 按 LlmSettings.type 分发协议（非流式）
 * - 流式翻译的协议分支在 translate.ts
 * - fetch 可注入：默认 Node 全局 fetch（便于纯 node 测试）；
 *   Electron 启动时经 setFetchImpl 切换为 net.fetch（Chromium 网络栈，跟随系统代理）
 */

export class LlmError extends Error {
  /** HTTP 状态码；网络层/超时等非 HTTP 错误时可能为 undefined */
  status?: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 注入的 fetch 实现（默认 Node undici 全局 fetch） */
let fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init)

export function setFetchImpl(f: typeof fetch): void {
  fetchImpl = f
}

/** 统一的 HTTP 入口：主进程 LLM 调用全部走这里 */
export function httpFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  return fetchImpl(input, init)
}

/** 统一去掉尾部斜杠，是否包含 /v1 由用户在设置中自行保证 */
export function normalizeBaseURL(u: string): string {
  return u.trim().replace(/\/+$/, '')
}

export async function describeHttpError(res: Response): Promise<string> {
  let detail = ''
  try {
    const j = (await res.json()) as { error?: { message?: string } }
    detail = j?.error?.message ?? ''
  } catch {
    /* 忽略非 JSON 响应体 */
  }
  switch (res.status) {
    case 400:
      return `请求被拒绝（400）${detail ? `：${detail}` : '，请检查 Model 名称是否正确'}`
    case 401:
    case 403:
      return `API Key 无效或已过期（${res.status}）`
    case 404:
      return '接口地址不存在（404），请检查 Base URL 是否需要以 /v1 结尾'
    case 429:
      return '请求过于频繁或额度不足（429）'
    default:
      if (res.status >= 500) return `模型服务方错误（${res.status}），请稍后重试`
      return `请求失败（${res.status}）${detail ? `：${detail}` : ''}`
  }
}

async function ensureOk(res: Response): Promise<void> {
  if (!res.ok) {
    const e = new LlmError(await describeHttpError(res))
    e.status = res.status
    throw e
  }
}

/** 从 messages 中提取 system 内容（Anthropic 需作为顶层 system 参数） */
function extractSystem(messages: ChatMessage[]): { system?: string; rest: ChatMessage[] } {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
  const rest = messages.filter((m) => m.role !== 'system')
  return { system: system || undefined, rest }
}

/** 思考模式关闭时附加的参数（OpenAI 与 Anthropic 格式实测均认 thinking.type） */
export function thinkingBodyParam(config: { thinking: 'auto' | 'off' }): Record<string, unknown> {
  return config.thinking === 'off' ? { thinking: { type: 'disabled' } } : {}
}

async function openaiCompletion(
  settings: LlmSettings,
  messages: ChatMessage[],
  maxTokens: number,
  controller: AbortController
): Promise<string> {
  const { config } = getActiveLlm(settings)
  const url = `${normalizeBaseURL(config.baseURL)}/chat/completions`
  const res = await httpFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey.trim()}`
    },
    body: JSON.stringify({
      model: config.model.trim(),
      messages,
      max_tokens: maxTokens,
      stream: false,
      ...thinkingBodyParam(config)
    }),
    signal: controller.signal
  })
  await ensureOk(res)
  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new LlmError('接口返回格式异常')
  }
  return content
}

async function anthropicCompletion(
  settings: LlmSettings,
  messages: ChatMessage[],
  maxTokens: number,
  controller: AbortController
): Promise<string> {
  const { config } = getActiveLlm(settings)
  const { system, rest } = extractSystem(messages)
  const url = `${normalizeBaseURL(config.baseURL)}/messages`
  const res = await httpFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 双认证头：官方 Anthropic 兼容 x-api-key；第三方网关（如 DeepSeek /anthropic）认 Authorization Bearer
      'x-api-key': config.apiKey.trim(),
      Authorization: `Bearer ${config.apiKey.trim()}`,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.model.trim(),
      max_tokens: maxTokens,
      system,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      ...thinkingBodyParam(config)
    }),
    signal: controller.signal
  })
  await ensureOk(res)
  const data = (await res.json()) as { content?: { type?: string; text?: string }[] }
  const blocks = data?.content ?? []
  const text = blocks
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
  // 允许空文本：思考型模型（如 deepseek-v4-flash）可能只返回 thinking 块，
  // 响应结构有效即视为请求成功（连接测试通过）；业务侧（详情生成）另有内容校验
  return text
}

export async function chatCompletion(
  settings: LlmSettings,
  messages: ChatMessage[],
  opts: { maxTokens?: number; timeoutMs?: number } = {}
): Promise<string> {
  const { maxTokens = 1024, timeoutMs = 30000 } = opts
  const { type, config } = getActiveLlm(settings)
  if (!config.apiKey.trim()) {
    throw new LlmError('尚未配置 API Key，请先到设置页填写')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    if (type === 'anthropic') {
      return await anthropicCompletion(settings, messages, maxTokens, controller)
    }
    return await openaiCompletion(settings, messages, maxTokens, controller)
  } catch (e) {
    if (e instanceof LlmError) throw e
    if ((e as Error).name === 'AbortError') {
      throw new LlmError('请求超时，请检查网络或 Base URL')
    }
    throw new LlmError(`网络连接失败：${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

export async function testConnection(settings: LlmSettings): Promise<TestConnectionResult> {
  const { type, config } = getActiveLlm(settings)
  if (!config.apiKey.trim()) {
    return { ok: false, message: '尚未配置 API Key' }
  }
  try {
    await chatCompletion(settings, [{ role: 'user', content: 'Hi' }], {
      // anthropic 思考型模型会先消耗 thinking token，预算太小可能整个响应全是 thinking 块
      maxTokens: type === 'anthropic' ? 32 : 1,
      timeoutMs: 15000
    })
    return { ok: true, message: '连接成功，模型可用' }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
