import type { CorpusWord } from './types'

export const MAX_CORPUS_WORDS = 12_000
export const MAX_CORPUS_CHARS = 2_000_000
export const MAX_CORPUS_BYTES = 16 * 1024 * 1024

/** 只传词频，不传原文或文件名。长度限制也使 Android JSON RPC 始终小于 1 MiB。 */
export function countCorpusWords(text: string): CorpusWord[] {
  if (text.length > MAX_CORPUS_CHARS) throw Error('语料文字超过 200 万字符，请拆分文件后导入。')
  const counts = new Map<string, CorpusWord>()
  const tokens = text.normalize('NFKC').replace(/\u00ad/g, '').replace(/’/g, "'")
  for (const match of tokens.matchAll(/[A-Za-z0-9_]+(?:['-][A-Za-z0-9_]+)*/g)) {
    const token = match[0].replace(/'s$/i, '')
    if (!/^[a-z]{3,32}$/i.test(token) || token === token.toUpperCase()) continue
    const word = token.toLowerCase()
    const existing = counts.get(word)
    if (existing) {
      existing.count++
      if (token === word) existing.word = word
    } else {
      counts.set(word, { word: token, count: 1 })
      if (counts.size > MAX_CORPUS_WORDS) throw Error('语料超过 12000 个不同词形，请拆分文件后导入。')
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)
}
