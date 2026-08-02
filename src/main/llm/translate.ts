import { describeHttpError, LlmError, normalizeBaseURL } from './client'
import { TRANSLATE_SYSTEM_PROMPT } from './prompts'
import type { LlmSettings } from '../../shared/types'

/**
 * 流式翻译（SSE）
 * - 渲染端生成 requestId，主进程以 requestId 管理 AbortController，支持随时中止
 * - 事件经 emit 回调推送（ipc.ts 负责转发到 webContents）
 * - 本文件不依赖 electron，便于纯 node 单元验证
 */

const STREAM_TIMEOUT_MS = 120_000

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
    if (!settings.apiKey.trim()) {
      throw new LlmError('尚未配置 API Key，请先到设置页填写')
    }
    if (!text.trim()) {
      throw new LlmError('请输入要翻译的内容')
    }

    const url = `${normalizeBaseURL(settings.baseURL)}/chat/completions`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: settings.model.trim(),
        messages: [
          { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
          { role: 'user', content: text }
        ],
        stream: true
      }),
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
          const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
          const delta = json?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
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
