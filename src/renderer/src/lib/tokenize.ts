/**
 * 句子分词：单词作为可交互 Chip，其余（空格/标点/数字）按原序保留
 * 覆盖场景：don't、state-of-the-art、弯引号 don’t
 */
export interface WordToken {
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
    tokens.push({ type: 'word', text: match[0] })
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
