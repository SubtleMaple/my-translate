/**
 * 句子分词：单词作为可交互 Chip，其余（空格/标点/数字）按原序保留
 * 覆盖场景：don't、state-of-the-art、弯引号 don’t
 */
import type { TextRange, VocabSelection } from './types'

export interface WordToken extends TextRange {
  type: 'word'
  text: string
}

export interface TextToken {
  type: 'text'
  text: string
}

export type Token = WordToken | TextToken

const WORD_RE = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g

export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  for (const match of text.matchAll(WORD_RE)) {
    const start = match.index
    if (start > last) {
      tokens.push({ type: 'text', text: text.slice(last, start) })
    }
    tokens.push({ type: 'word', text: match[0], start, end: start + match[0].length })
    last = start + match[0].length
  }
  if (last < text.length) {
    tokens.push({ type: 'text', text: text.slice(last) })
  }
  return tokens
}

/** 提取全部单词的小写形式（去重） */
export function wordList(text: string): string[] {
  const set = new Set<string>()
  for (const t of tokenize(text)) {
    if (t.type === 'word') set.add(t.text.toLowerCase())
  }
  return [...set]
}

/**
 * 按单词序号（第 start..end 个单词，含端点）取原始词形并空格连接成短语
 * 序号越界时自动收敛到有效范围；空文本返回空串
 */
export function phraseByWordIndex(text: string, start: number, end: number): string {
  const words = tokenize(text)
    .filter((t): t is WordToken => t.type === 'word')
    .map((t) => t.text)
  if (words.length === 0) return ''
  const from = Math.max(0, Math.min(start, words.length - 1))
  const to = Math.max(from, Math.min(end, words.length - 1))
  return words.slice(from, to + 1).join(' ')
}

export function selectionKey(range: TextRange): string {
  return `${range.start}:${range.end}`
}

export function selectionByWordIndex(input: string, start: number, end = start): VocabSelection | null {
  const words = tokenize(input).filter((t): t is WordToken => t.type === 'word')
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= words.length) return null
  return { text: words.slice(start, end + 1).map((t) => t.text).join(' '), start: words[start].start, end: words[end].end }
}

/** 只接受完整单词边界，避免错位/过期的 IPC 目标指向别的同形词。 */
export function selectionFromOffsets(input: string, range: TextRange): VocabSelection | null {
  if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end <= range.start || range.end > input.length) return null
  const words = tokenize(input).filter((t): t is WordToken => t.type === 'word')
  const first = words.findIndex((t) => t.start === range.start)
  const last = words.findIndex((t) => t.end === range.end)
  if (first < 0 || last < first) return null
  return { text: words.slice(first, last + 1).map((t) => t.text).join(' '), start: range.start, end: range.end }
}

/** 提供明确的目标边界，模型无需自行数字符；全文由调用方另行提供。 */
export function focusContext(input: string, range: TextRange): { before: string; selected: string; after: string } {
  return { before: input.slice(Math.max(0, range.start - 120), range.start),
    selected: input.slice(range.start, range.end), after: input.slice(range.end, range.end + 120) }
}
