import type { LlmSettings } from '../../shared/types'
import { getActiveLlm } from '../../shared/llm'
import { chatCompletion, LlmError } from './client'
import { buildDetailSystemPrompt, buildDetailUserPrompt } from './prompts'

/**
 * 生词详情生成（非流式）
 * - 模型返回 JSON → 容错解析（截取首个 { 至末个 }，字段级兜底空值，绝不抛异常打断队列）
 * - 组装固定 Markdown 模板（与需求文档格式一致）
 * - 本文件不依赖 electron，可纯 node 验证
 */

export interface DetailFields {
  phonetic: string
  pos: string
  brief: string
  usage: string
  examples: { en: string; zh: string }[]
  synonyms: string[]
  antonyms: string[]
  memory: string
}

export const EMPTY_DETAIL: DetailFields = {
  phonetic: '',
  pos: '',
  brief: '',
  usage: '',
  examples: [],
  synonyms: [],
  antonyms: [],
  memory: ''
}

/** 截取首个 { 至末个 }，模型常见输出（```json 代码块 / 前后解释文字）均可容错 */
export function extractJsonObject(text: string): string | null {
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first < 0 || last < first) return null
  return text.slice(first, last + 1)
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map(asString).filter(Boolean)
}

function asExamples(v: unknown): { en: string; zh: string }[] {
  if (!Array.isArray(v)) return []
  const out: { en: string; zh: string }[] = []
  for (const item of v) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const en = asString(o.en)
    if (!en) continue
    out.push({ en, zh: asString(o.zh) })
  }
  return out
}

/**
 * 容错解析：提取 JSON 对象 → parse → 逐字段兜底
 * 任何失败路径都返回字段为空的 DetailFields（不抛异常）
 */
export function parseDetailJson(content: string): DetailFields {
  const raw = extractJsonObject(content)
  if (!raw) return EMPTY_DETAIL
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return EMPTY_DETAIL
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return EMPTY_DETAIL
  const o = obj as Record<string, unknown>
  return {
    phonetic: asString(o.phonetic),
    pos: asString(o.pos),
    brief: asString(o.brief),
    usage: asString(o.usage),
    examples: asExamples(o.examples),
    synonyms: asStringArray(o.synonyms),
    antonyms: asStringArray(o.antonyms),
    memory: asString(o.memory)
  }
}

/** 是否有任何有效内容（全空视为解析彻底失败） */
export function hasAnyContent(f: DetailFields): boolean {
  return Boolean(
    f.phonetic ||
      f.pos ||
      f.brief ||
      f.usage ||
      f.examples.length > 0 ||
      f.synonyms.length > 0 ||
      f.antonyms.length > 0 ||
      f.memory
  )
}

/** 组装固定 Markdown 模板（与需求「生词详情自动生成」格式逐节对应） */
export function buildDetailMarkdown(f: DetailFields): string {
  const lines: string[] = []
  lines.push('### 基本信息')
  lines.push(`- 音标：${f.phonetic || '—'}`)
  lines.push(`- 词性：${f.pos || '—'}`)
  lines.push(`- 中文释义：${f.brief || '—'}`)
  lines.push('')
  lines.push('### 详细用法')
  lines.push(f.usage || '—')
  lines.push('')
  lines.push('### 例句')
  if (f.examples.length === 0) {
    lines.push('—')
  } else {
    f.examples.forEach((ex, i) => {
      lines.push(`${i + 1}. ${ex.en}（${ex.zh}）`)
    })
  }
  lines.push('')
  lines.push('### 近义词 / 反义词')
  lines.push(`- 近义：${f.synonyms.length > 0 ? f.synonyms.join('；') : '—'}`)
  lines.push(`- 反义：${f.antonyms.length > 0 ? f.antonyms.join('；') : '—'}`)
  lines.push('')
  lines.push('### 记忆提示 / 易混淆点')
  lines.push(f.memory || '—')
  return lines.join('\n')
}

export interface GeneratedDetail {
  phonetic: string
  pos: string
  brief: string
  detail: string
}

/**
 * 调用大模型生成词条详情
 * - maxTokens 800 / 超时 60s（网络层错误抛 LlmError，由调用方队列捕获置 failed）
 * - 内容完全解析不出时抛 LlmError（可重试），字段级缺失则兜底空值正常返回
 */
export async function generateWordDetail(
  word: string,
  contextSentence: string,
  settings: LlmSettings
): Promise<GeneratedDetail> {
  // anthropic 思考型模型需预留 thinking 预算，max_tokens 加大
  const maxTokens = getActiveLlm(settings).type === 'anthropic' ? 2000 : 800
  const content = await chatCompletion(
    settings,
    [
      { role: 'system', content: buildDetailSystemPrompt() },
      { role: 'user', content: buildDetailUserPrompt(word, contextSentence) }
    ],
    { maxTokens, timeoutMs: 60_000 }
  )

  const fields = parseDetailJson(content)
  if (!hasAnyContent(fields)) {
    throw new LlmError('模型返回内容无法解析，请重新生成')
  }
  return {
    phonetic: fields.phonetic,
    pos: fields.pos,
    brief: fields.brief,
    detail: buildDetailMarkdown(fields)
  }
}
