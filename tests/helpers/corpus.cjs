const { deflateSync } = require('node:zlib')
const { zipSync, strToU8 } = require('fflate')

// An actual PDF with an xref table, a compressed content stream and optional text.
function pdf(text) {
  const stream = deflateSync(Buffer.from(text ? 'BT /F 12 Tf 30 40 Td (' + text + ') Tj ET' : '0 0 20 20 re f'))
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 100] /Resources << /Font << /F 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Filter /FlateDecode /Length ' + stream.length + ' >>\nstream\n' + stream.toString('latin1') + '\nendstream'
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((obj, i) => { offsets.push(body.length); body += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n' })
  const xref = body.length
  body += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')
  return Buffer.from(body + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF', 'latin1')
}
function docx() {
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>gra</w:t></w:r><w:r><w:t>nite</w:t></w:r></w:p></w:body></w:document>'
  return Buffer.from(zipSync({ 'word/document.xml': strToU8(xml), 'word/media/image.png': strToU8('forbidden') }))
}
module.exports = { pdf, docx }
if (require.main === module) require('node:fs').writeFileSync(process.argv[2], pdf('gravity gravity gravity'))
