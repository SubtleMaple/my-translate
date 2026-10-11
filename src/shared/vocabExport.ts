import type { VocabEntry, VocabExportFormat, WordSource } from './types'

/** 明确列出词条字段，避免未来附加运行时/配置属性意外混入导出。 */
function exportEntry(entry: VocabEntry): VocabEntry & { sources: WordSource[] } {
  return {
    id: entry.id, word: entry.word, phonetic: entry.phonetic, pos: entry.pos,
    brief: entry.brief, detail: entry.detail, note: entry.note, status: entry.status,
    contextSentence: entry.contextSentence, failReason: entry.failReason, count: entry.count,
    createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    sources: (entry.sources || []).map(source => ({ original: source.original, word: source.word,
      explanation: source.explanation, context: source.context,
      ...(source.selection ? { selection: { start: source.selection.start, end: source.selection.end } } : {}) }))
  }
}

export function createVocabExport(entries: VocabEntry[], appVersion: string, exportedAt: Date) {
  return {
    schemaVersion: 1,
    application: { name: 'My Translate', version: appVersion },
    exportedAt: exportedAt.toISOString(),
    entryCount: entries.length,
    timestampUnit: 'unix-milliseconds',
    selectionOffsets: { unit: 'UTF-16 code units', startInclusive: true, endExclusive: true },
    entries: entries.map(exportEntry)
  }
}

export const VOCAB_CSV_COLUMNS = [
  'id', 'word', 'phonetic', 'pos', 'brief', 'detail', 'note', 'status', 'fail_reason', 'count',
  'context_sentence', 'created_at_ms', 'updated_at_ms', 'created_at', 'updated_at',
  'original_forms', 'source_count', 'sources_json', 'csv_escaped_columns'
] as const

const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`

export function serializeVocabExport(entries: VocabEntry[], format: VocabExportFormat, appVersion: string, exportedAt: Date): string {
  const document = createVocabExport(entries, appVersion, exportedAt)
  if (format === 'json') return JSON.stringify(document, null, 2) + '\n'
  const lines = [VOCAB_CSV_COLUMNS.map(quote).join(',')]
  for (const entry of document.entries) {
    const cells: (string | number)[] = [entry.id, entry.word, entry.phonetic, entry.pos, entry.brief, entry.detail, entry.note,
      entry.status, entry.failReason, entry.count, entry.contextSentence, entry.createdAt, entry.updatedAt,
      new Date(entry.createdAt).toISOString(), new Date(entry.updatedAt).toISOString(),
      JSON.stringify([...new Set(entry.sources.map(source => source.original))]), entry.sources.length, JSON.stringify(entry.sources)]
    const escaped: string[] = []
    const safeCells = cells.map((cell, index) => {
      // 引号不能阻止表格执行公式；前缀按文本显示，并记录列名以便程序无损还原。
      if (typeof cell === 'string' && /^[\s\u200b-\u200f\ufeff]*[=+\-@]/.test(cell)) {
        escaped.push(VOCAB_CSV_COLUMNS[index])
        return "'" + cell
      }
      return cell
    })
    lines.push([...safeCells, JSON.stringify(escaped)].map(quote).join(','))
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

export function vocabExportFilename(format: VocabExportFormat, date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  return `my-translate-vocabulary-${stamp}.${format}`
}
