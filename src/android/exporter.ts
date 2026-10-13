import type { VocabEntry, VocabExportFormat, VocabExportResult } from '../shared/types'
import { serializeVocabExport, vocabExportFilename } from '../shared/vocabExport'
let pending: ((result: { status: string; uri?: string; message?: string }) => void) | undefined
export function receiveExport(result: { status: string; uri?: string; message?: string }): void { pending?.(result); pending = undefined }
export function createVocabExporter(deps: { readAll: () => VocabEntry[]; appVersion: () => string; chooseFile: unknown }) {
  return async (format: VocabExportFormat): Promise<VocabExportResult> => {
    if (format !== 'json' && format !== 'csv') return { status: 'error', message: '请选择 JSON 或 CSV' }
    if (pending) return { status: 'error', message: '请先完成当前导出' }
    const entries = deps.readAll()
    if (!entries.length) return { status: 'empty' }
    const date = new Date()
    const result = await new Promise<{ status: string; uri?: string; message?: string }>((resolve) => {
      pending = resolve
      AndroidHost.exportFile(JSON.stringify({ name: vocabExportFilename(format, date), format, content: serializeVocabExport(entries, format, deps.appVersion(), date) }))
    })
    if (result.status === 'cancelled') return { status: 'cancelled' }
    if (result.status !== 'saved') return { status: 'error', message: result.message || '保存失败，请重试' }
    return { status: 'saved', format, count: entries.length, filePath: result.uri! }
  }
}
