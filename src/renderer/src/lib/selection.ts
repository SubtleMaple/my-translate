import type { VocabEntry, VocabSelection } from '@shared/types'
import { selectionByWordIndex, selectionFromOffsets, selectionKey } from './tokenize'

/** 此范围是单词序号（含端点），与 IPC 的字符偏移区分。 */
export interface PhraseRange { start: number; end: number }

/** 预览、计数、提交共用按位置去重的目标，不合并不同位置的同形词/短语。 */
export function selectedEntries(input: string, words: Set<number>, ranges: PhraseRange[]): VocabSelection[] {
  const entries = new Map<string, VocabSelection>()
  for (const range of [...Array.from(words, (index) => ({ start: index, end: index })), ...ranges]) {
    const selection = selectionByWordIndex(input, range.start, range.end)
    if (selection) entries.set(selectionKey(selection), selection)
  }
  return [...entries.values()].sort((a, b) => a.start - b.start || a.end - b.end)
}

/** 只有同一原文且范围准确匹配的来源，才认定该位置已收录。 */
export function savedSelections(input: string, entries: VocabEntry[]): VocabSelection[] {
  const saved = new Map<string, VocabSelection>()
  for (const entry of entries) for (const source of entry.sources || []) {
    if (source.context !== input || !source.selection) continue
    const selection = selectionFromOffsets(input, source.selection)
    if (selection?.text === source.original) saved.set(selectionKey(selection), selection)
  }
  return [...saved.values()]
}
