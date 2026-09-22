import { phraseByWordIndex, tokenize } from './tokenize'

export interface PhraseRange { start: number; end: number }

/** Same unique entries for preview, count and submission. */
export function selectedEntries(input: string, words: Set<string>, ranges: PhraseRange[]): string[] {
  const entries = new Map<string, string>()
  for (const token of tokenize(input)) {
    if (token.type === 'word' && words.has(token.text.toLowerCase())) {
      const key = token.text.toLowerCase()
      if (!entries.has(key)) entries.set(key, token.text)
    }
  }
  for (const range of ranges) {
    const phrase = phraseByWordIndex(input, range.start, range.end).trim()
    if (phrase && !entries.has(phrase.toLowerCase())) entries.set(phrase.toLowerCase(), phrase)
  }
  return [...entries.values()]
}

export function savedPhrases(input: string, known: Set<string>): string[] {
  const sentence = ` ${tokenize(input).filter((t) => t.type === 'word').map((t) => t.text.toLowerCase()).join(' ')} `
  return [...known].filter((word) => word.includes(' ') && sentence.includes(` ${word} `))
}
