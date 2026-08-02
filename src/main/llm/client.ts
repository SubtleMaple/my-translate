import type { LlmSettings, TestConnectionResult } from '../../shared/types'

/**
 * OpenAI 兼容 API 客户端（主进程 Node fetch，规避渲染端 CORS）
 * Phase 2 仅提供非流式 chatCompletion + testConnection；流式翻译在 Phase 4 扩展
 */

export class LlmError extends Error {
  /** HTTP 状态码；网络层/超时等非 HTTP 错误时可能为 undefined */
  status?: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
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

export async function chatCompletion(
  settings: LlmSettings,
  messages: ChatMessage[],
  opts: { maxTokens?: number; timeoutMs?: number } = {}
): Promise<string> {
  const { maxTokens = 1024, timeoutMs = 30000 } = opts
  if (!settings.apiKey.trim()) {
    throw new LlmError('尚未配置 API Key，请先到设置页填写')
  }
  const url = `${normalizeBaseURL(settings.baseURL)}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: settings.model.trim(),
        messages,
        max_tokens: maxTokens,
        stream: false
      }),
      signal: controller.signal
    })
    if (!res.ok) {
      const e = new LlmError(await describeHttpError(res))
      e.status = res.status
      throw e
    }
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new LlmError('接口返回格式异常')
    }
    return content
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
  if (!settings.apiKey.trim()) {
    return { ok: false, message: '尚未配置 API Key' }
  }
  try {
    await chatCompletion(settings, [{ role: 'user', content: 'Hi' }], {
      maxTokens: 1,
      timeoutMs: 15000
    })
    return { ok: true, message: '连接成功，模型可用' }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
