// Independent RFC 4180 reader for export round-trip tests (no production imports).
exports.parseCsv = function parseCsv(input) {
  const text = input.replace(/^\ufeff/, '')
  const rows = [], row = []
  let cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push([...row]); row.length = 0; cell = ''
    } else cell += ch
  }
  if (quoted) throw Error('Unterminated CSV field')
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}
