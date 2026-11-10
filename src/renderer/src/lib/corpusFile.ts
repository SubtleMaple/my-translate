import { unzipSync } from 'fflate'
import PdfWorker from './corpusPdf.worker?worker'
import { countCorpusWords, MAX_CORPUS_BYTES } from '../../../shared/corpus'
import type { CorpusWord } from '../../../shared/types'

function decode(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' :
    bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes) }
  catch { throw Error('无法解码文字，请将文件另存为 UTF-8 或带 BOM 的 UTF-16。') }
}

function docxText(bytes: Uint8Array): string {
  const part = 'word/document.xml'
  let xml: Uint8Array | undefined
  try {
    xml = unzipSync(bytes, { filter: entry => {
      if (entry.name !== part) return false
      if (entry.originalSize > MAX_CORPUS_BYTES) throw Error()
      return true
    } })[part]
  } catch { throw Error('无法解压 DOCX，请检查文件是否损坏、加密或正文过大。') }
  if (!xml) throw Error('文件缺少 DOCX 正文。')
  const document = new DOMParser().parseFromString(decode(xml), 'application/xml')
  if (document.getElementsByTagName('parsererror').length) throw Error('DOCX 正文格式无效。')
  const ns = document.documentElement.namespaceURI
  if (!ns || !['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'].includes(ns)) throw Error('DOCX 正文格式无效。')
  // A word can span several formatted runs. Paragraphs, tabs and line breaks separate words.
  const parts: string[] = []
  for (const node of Array.from(document.getElementsByTagNameNS(ns, '*'))) {
    if (node.localName === 't') parts.push(node.textContent || '')
    else if (['p', 'tab', 'br', 'cr'].includes(node.localName)) parts.push(' ')
  }
  return parts.join('')
}

function pdfWords(bytes: ArrayBuffer): Promise<CorpusWord[]> {
  return new Promise((resolve, reject) => {
    const worker = new PdfWorker()
    const timer = setTimeout(() => { worker.terminate(); reject(Error('PDF 解析超时，请拆分文件后重试。')) }, 90_000)
    const finish = () => { clearTimeout(timer); worker.terminate() }
    worker.onerror = () => { finish(); reject(Error('PDF 解析器无法读取此文件。')) }
    worker.onmessage = ({ data }) => {
      if (data?.type !== 'corpus-result') return
      finish()
      if (data.error) reject(Error(data.error))
      else resolve(data.words)
    }
    worker.postMessage(bytes, [bytes])
  })
}

export async function readCorpusFile(file: File): Promise<CorpusWord[]> {
  if (file.size > MAX_CORPUS_BYTES) throw Error('文件超过 16 MiB，请拆分后导入。')
  const extension = file.name.split('.').pop()?.toLowerCase()
  const bytes = await file.arrayBuffer()
  if (extension === 'pdf' || file.type === 'application/pdf') return pdfWords(bytes)
  if (extension === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return countCorpusWords(docxText(new Uint8Array(bytes)))
  if (!['txt', 'md'].includes(extension || '') && !['text/plain', 'text/markdown'].includes(file.type)) throw Error('请选择 TXT、Markdown、DOCX 或带文字层的 PDF。')
  const text = decode(new Uint8Array(bytes))
  if (text.includes('\0')) throw Error('无法读取此文本文件，请检查文件格式和编码。')
  return countCorpusWords(text)
}
