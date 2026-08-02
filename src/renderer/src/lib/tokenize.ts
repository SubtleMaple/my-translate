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
