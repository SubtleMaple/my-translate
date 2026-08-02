import { describeHttpError, LlmError, normalizeBaseURL } from './client'
import { TRANSLATE_SYSTEM_PROMPT } from './prompts'
import { getActiveLlm } from '../../shared/llm'
import type { LlmSettings } from '../../shared/types'

/**
 * 流式翻译（SSE）
 * - 渲染端生成 requestId，主进程以 requestId 管理 AbortController，支持随时中止
 * - 事件经 emit 回调推送（ipc.ts 负责转发到 webContents）
 * - 本文件不依赖 electron，便于纯 node 单元验证
 * - 协议分支：openai=choices[].delta.content；anthropic=content_block_delta(delta.text)
 */

const STREAM_TIMEOUT_MS = 120_000

/** Anthropic 协议必须显式指定 max_tokens（OpenAI 可省略） */
const ANTHROPIC_STREAM_MAX_TOKENS = 2000

export interface TranslateEmitter {
  chunk: (delta: string) => void
  done: (fullText: string) => void
  error: (message: string) => void
}

interface ActiveRequest {
  controller: AbortController
  /** 用户主动中止（区别于超时/网络失败） */
  userAbort: boolean
}

const active = new Map<string, ActiveRequest>()

export function abortTranslate(requestId: string): void {
  const entry = active.get(requestId)
  if (entry) {
    entry.userAbort = true
    entry.controller.abort()
  }
}

/** openai 流：解析 choices[0].delta.content */
function parseOpenaiLine(line: string): string {
  const json = JSON.parse(line) as { choices?: { delta?: { content?: string } }[] }
  const delta = json?.choices?.[0]?.delta?.content
  return typeof delta === 'string' ? delta : ''
}

/** anthropic 流：解析 content_block_delta / text_delta（忽略 thinking 块等） */
function parseAnthropicLine(line: string): string {
  const json = JSON.parse(line) as { type?: string; delta?: { type?: string; text?: string } }
  if (json?.type !== 'content_block_delta') return ''
  if (json?.delta?.type !== 'text_delta') return ''
  return typeof json.delta.text === 'string' ? json.delta.text : ''
}

export async function runTranslate(
  requestId: string,
  text: string,
  settings: LlmSettings,
  emit: TranslateEmitter
): Promise<void> {
  const controller = new AbortController()
  active.set(requestId, { controller, userAbort: false })
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS)

  try {
    const { type, config } = getActiveLlm(settings)
    if (!config.apiKey.trim()) {
      throw new LlmError('尚未配置 API Key，请先到设置页填写')
    }
    if (!text.trim()) {
      throw new LlmError('请输入要翻译的内容')
    }

    const isAnthropic = type === 'anthropic'
    const url = isAnthropic
      ? `${normalizeBaseURL(config.baseURL)}/messages`
      : `${normalizeBaseURL(config.baseURL)}/chat/completions`

    const res = await fetch(url, {
      method: 'POST',
      headers: isAnthropic
        ? {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey.trim(),
            'anthropic-version': '2023-06-01'
          }
        : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey.trim()}`
          },
      body: JSON.stringify(
        isAnthropic
          ? {
              model: config.model.trim(),
              max_tokens: ANTHROPIC_STREAM_MAX_TOKENS,
              system: TRANSLATE_SYSTEM_PROMPT,
              messages: [{ role: 'user', content: text }],
              stream: true
            }
          : {
              model: config.model.trim(),
              messages: [
                { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
                { role: 'user', content: text }
              ],
              stream: true
            }
      ),
      signal: controller.signal
    })

    if (!res.ok) {
      throw new LlmError(await describeHttpError(res))
    }
    if (!res.body) {
      throw new LlmError('响应体为空')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let full = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]' || data === '') continue
        try {
          const delta = isAnthropic ? parseAnthropicLine(data) : parseOpenaiLine(data)
          if (delta.length > 0) {
            full += delta
            emit.chunk(delta)
          }
        } catch {
          // 忽略无法解析的 SSE 行（keep-alive 注释等）
        }
      }
    }

    emit.done(full)
  } catch (e) {
    const entry = active.get(requestId)
    if (e instanceof LlmError) {
      emit.error(e.message)
    } else if ((e as Error).name === 'AbortError') {
      // 用户中止 → 静默收尾；超时中止 → 提示
      if (entry?.userAbort) return
      emit.error(`翻译超时（${STREAM_TIMEOUT_MS / 1000}s）或已中止`)
    } else {
      emit.error(`翻译失败：${(e as Error).message}`)
    }
  } finally {
    clearTimeout(timer)
    active.delete(requestId)
  }
}
