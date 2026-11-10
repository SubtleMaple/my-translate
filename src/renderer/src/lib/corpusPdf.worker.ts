// The isolated parser also runs on older Android WebViews.
import 'core-js/stable'
import { getDocument } from 'unpdf/pdfjs'
import { countCorpusWords, MAX_CORPUS_CHARS } from '../../../shared/corpus'

self.onmessage = async ({ data }: MessageEvent<ArrayBuffer>) => {
  const task = getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: false,
    useWorkerFetch: false, disableFontFace: true, maxImageSize: 0, useWasm: false })
  try {
    const pdf = await task.promise
    if (pdf.numPages > 1500) throw Error('PDF 超过 1500 页，请拆分后导入。')
    const parts: string[] = []
    let length = 0
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if (!('str' in item)) continue
        length += item.str.length + 1
        if (length > MAX_CORPUS_CHARS) throw Error('PDF 文字超过 200 万字符，请拆分后导入。')
        parts.push(item.str + (item.hasEOL ? '\n' : ' '))
      }
      page.cleanup()
    }
    const text = parts.join('').replace(/([a-z])-\s*\n\s*([a-z])/gi, '$1$2')
    if (!text.trim()) throw Error('PDF 没有可提取的文字层，请选择带文字的文件。')
    self.postMessage({ type: 'corpus-result', words: countCorpusWords(text) })
  } catch (error) {
    const e = error as Error
    self.postMessage({ type: 'corpus-result', error: e.name === 'PasswordException' ? 'PDF 受密码保护，请导入已解锁的副本。' :
      /^(PDF |语料)/.test(e.message) ? e.message : '无法读取 PDF 文字层，请检查文件是否完整。' })
  } finally { await task.destroy() }
}
