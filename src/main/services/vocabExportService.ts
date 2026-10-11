import { randomUUID } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import type { VocabEntry, VocabExportFormat, VocabExportResult } from '../../shared/types'
import { serializeVocabExport, vocabExportFilename } from '../../shared/vocabExport'

/** 在目标目录写完并关闭临时文件后再替换，写入失败不破坏现有目标文件。 */
export async function writeExportAtomically(filePath: string, content: string): Promise<void> {
  const temporary = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`)
  let handle: FileHandle | undefined
  let created = false
  try {
    handle = await open(temporary, 'wx')
    created = true
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, filePath)
  } finally {
    await handle?.close().catch(() => {})
    if (created) await rm(temporary, { force: true }).catch(() => {})
  }
}

interface ExportDependencies {
  readAll: () => VocabEntry[]
  chooseFile: (format: VocabExportFormat, defaultName: string) => Promise<string | null>
  appVersion: () => string
  write?: (filePath: string, content: string) => Promise<void>
  now?: () => Date
}

function exportError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') return '文件被占用或没有写入权限，请关闭占用文件的程序，或换一个保存位置。'
  if (code === 'ENOSPC' || code === 'EDQUOT') return '保存位置的可用空间不足，请更换位置后重试。'
  if (code === 'ENOENT' || code === 'ENOTDIR') return '保存目录不存在或已被移动，请重新选择保存位置。'
  if (code === 'ENAMETOOLONG' || code === 'EINVAL') return '保存路径无效或过长，请使用较短的文件名后重试。'
  return '导出失败，请确认保存位置可用后重试。'
}

/** 注入系统对话框以便独立验证；调用者只传格式，数据与路径都由主进程决定。 */
export function createVocabExporter(dependencies: ExportDependencies): (format: VocabExportFormat) => Promise<VocabExportResult> {
  let exporting = false
  const now = dependencies.now || (() => new Date())
  return async (format) => {
    if (format !== 'json' && format !== 'csv') return { status: 'error', message: '请选择 JSON 或 CSV 导出格式。' }
    if (exporting) return { status: 'error', message: '已有导出正在进行，请完成当前保存操作。' }
    exporting = true
    try {
      if (!dependencies.readAll().length) return { status: 'empty' }
      const filePath = await dependencies.chooseFile(format, vocabExportFilename(format, now()))
      if (!filePath) return { status: 'cancelled' }
      // 不在对话框返回后偷偷改路径，避免覆盖未经系统对话框确认的另一个文件。
      if (!isAbsolute(filePath) || extname(filePath).toLowerCase() !== `.${format}`) {
        return { status: 'error', message: `请将文件保存为 .${format} 扩展名，然后重试。` }
      }
      // 对话框关闭后同步读取并序列化，期间没有 await，因此得到一致的全量快照。
      const entries = dependencies.readAll()
      if (!entries.length) return { status: 'empty' }
      const content = serializeVocabExport(entries, format, dependencies.appVersion(), now())
      await (dependencies.write || writeExportAtomically)(filePath, content)
      return { status: 'saved', format, filePath, count: entries.length }
    } catch (error) {
      return { status: 'error', message: exportError(error) }
    } finally { exporting = false }
  }
}
