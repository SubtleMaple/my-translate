// Real UI/preload/IPC/SQL/file writes. Only the native save chooser is replaced.
const { app, BrowserWindow, dialog } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict')
const { parseCsv } = require('./helpers/csv.cjs')
const repo = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode', 'vocab-export-e2e-'))
process.env.MY_TRANSLATE_USER_DATA = profile
app.setPath('userData', profile); app.setAppPath(repo)
const report = { profile, checks: [], screenshots: [], failures: [] }
let win, calls = 0, release, selected = null, deferred = false
const sleep = ms => new Promise(r => setTimeout(r, ms))
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true)
async function until(fn, label, timeout = 12000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (await fn()) return; await sleep(60) }
  throw Error('Timeout: ' + label)
}
const click = text => evaluate(text => {
  const root = document.querySelector('[role="dialog"]') || document
  const button = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  if (!button) throw Error('Missing button: ' + text)
  button.click()
}, text)
async function format(value) {
  await evaluate(() => {
    const trigger = document.querySelector('[aria-label="导出格式"]')
    trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  })
  await until(() => evaluate(() => !!document.querySelector('[role="option"]')), 'format options')
  await evaluate(value => [...document.querySelectorAll('[role="option"]')].find(e => e.textContent.startsWith(value)).click(), value)
  await until(() => evaluate(value => document.querySelector('[aria-label="导出格式"]').textContent.startsWith(value), value), 'selected format')
}
async function snapshot(name) {
  await sleep(200)
  const issues = await evaluate(() => {
    const out = [], root = document.querySelector('[role="dialog"]') || document.body
    if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) out.push('document overflow')
    for (const el of root.querySelectorAll('button,input,[role="combobox"]')) {
      if (el.disabled || !el.getClientRects().length || el.closest('details:not([open])')) continue
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(Math.min(innerWidth-1, r.x+r.width/2), Math.min(innerHeight-1, r.y+r.height/2))
      if (r.left < -1 || r.right > innerWidth + 1 || !(hit === el || el.contains(hit))) out.push(el.getAttribute('aria-label') || el.textContent)
    }
    document.activeElement?.blur()
    root.scrollTop = 0
    return out
  })
  fs.writeFileSync(path.join(profile, name + '.png'), (await win.webContents.capturePage()).toPNG())
  report.screenshots.push(name)
  assert.deepEqual(issues, [], name)
}
async function main() {
  const SQL = await require(path.join(repo, 'node_modules/sql.js'))({ wasmBinary: fs.readFileSync(path.join(repo, 'node_modules/sql.js/dist/sql-wasm.wasm')) })
  const seed = new SQL.Database()
  seed.run(`CREATE TABLE vocabulary (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL, word_lower TEXT NOT NULL UNIQUE,
    phonetic TEXT NOT NULL DEFAULT '', pos TEXT NOT NULL DEFAULT '', brief TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', context_sentence TEXT NOT NULL DEFAULT '', fail_reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1, sources TEXT NOT NULL DEFAULT '[]'); PRAGMA user_version=3;`)
  const context = 'I saw a rusty saw lying on the workbench.'
  for (const [word, start, pos, brief, status] of [['see',2,'v.','看见','ready'],['saw',14,'n.','锯子','ready'],['unresolved',0,'','','failed']]) {
    const sources = word === 'unresolved' ? [] : [{ original: 'saw', word, explanation: '按位置辨义', context, selection: { start, end: start + 3 } }]
    seed.run(`INSERT INTO vocabulary (word,word_lower,phonetic,pos,brief,detail,note,status,context_sentence,fail_reason,count,created_at,updated_at,sources)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [word,word,'/test/',pos,brief,'### 详情\r\n中文 "引号", 逗号\n' + '长文本。'.repeat(9000), '原始备注',status,context,status === 'failed' ? '测试失败原因' : '',3,1700000000000,1700000001000,JSON.stringify(sources)])
  }
  fs.writeFileSync(path.join(profile, 'my-translate.db'), seed.export()); seed.close()
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ ui: { theme: 'light' }, llm: { openai: { apiKey: 'synthetic-config-not-exported' } } }))
  dialog.showSaveDialog = async (owner, options) => {
    calls++
    assert.equal(owner, win)
    assert.equal(options.title, '导出全部词条')
    assert.ok(options.properties.includes('showOverwriteConfirmation'))
    const extension = options.filters[0].extensions[0]
    assert.ok(['json','csv'].includes(extension))
    assert.match(path.basename(options.defaultPath), new RegExp(`^my-translate-vocabulary-\\d{8}-\\d{6}\\.${extension}$`))
    if (deferred) return new Promise(resolve => { release = resolve })
    return { canceled: !selected, filePath: selected || undefined }
  }
  require(path.join(repo, 'out/main/index.js'))
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return win && !win.webContents.isLoading() }, 'window')
  await until(() => evaluate(() => !!document.querySelector('#source-text')), 'renderer')
  win.setPosition(20,20); win.setSize(340,420)
  await click('生词本')
  await until(() => evaluate(() => document.body.textContent.includes('3 个词条')), 'vocabulary')
  await snapshot('toolbar-light-340')
  await evaluate(() => {
    const input = document.querySelector('[aria-label="搜索生词"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'see')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await until(() => evaluate(() => document.body.textContent.includes('匹配 1 个词条')), 'filtered list')
  await click('导出'); await snapshot('export-json-light-340')
  deferred = true
  await evaluate(() => {
    const button = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === '保存文件')
    button.click(); button.click()
  })
  await until(() => !!release, 'save chooser')
  assert.equal(calls, 1)
  assert.equal((await evaluate(() => window.api.exportVocab('csv'))).status, 'error')
  assert.equal(calls, 1)
  const entries = await evaluate(() => window.api.listVocab({ sortBy: 'alpha' }))
  const target = entries.find(e => e.word === 'see')
  const note = ' =SUM(1,2)\n这是新的 "备注", after chooser'
  await evaluate((id, note) => window.api.updateVocabNote(id, note), target.id, note)
  const jsonPath = path.join(profile, 'full-vocabulary.json')
  fs.writeFileSync(jsonPath, 'old test export')
  release({ canceled: false, filePath: jsonPath }); deferred = false
  await until(() => evaluate(() => document.querySelector('[aria-label="导出文件路径"]')?.textContent), 'saved JSON')
  const document = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  assert.equal(document.entryCount, 3)
  assert.deepEqual(document.entries, await evaluate(() => window.api.listVocab({ sortBy: 'alpha' })))
  assert.equal(document.entries.find(e => e.word === 'see').note, note)
  assert.equal(document.entries.find(e => e.word === 'see').sources[0].selection.start, 2)
  assert.equal(document.entries.find(e => e.word === 'saw').sources[0].selection.start, 14)
  assert.equal(document.entries.find(e => e.word === 'unresolved').status, 'failed')
  assert.ok(!fs.readFileSync(jsonPath, 'utf8').includes('synthetic-config-not-exported'))
  report.checks.push('filtered view exports full library; after-dialog snapshot includes latest note; double click/single flight; overwrite; complete JSON/positions/no settings')
  const before = await evaluate(() => window.api.listVocab({ sortBy: 'alpha' }))
  await format('CSV')
  selected = path.join(profile, 'full-vocabulary.csv')
  await click('保存文件')
  await until(() => evaluate(() => document.querySelector('[aria-label="导出文件路径"]')?.textContent.endsWith('.csv')), 'saved CSV')
  const csv = fs.readFileSync(selected, 'utf8')
  assert.equal(csv.charCodeAt(0), 0xfeff)
  const [headers, ...rows] = parseCsv(csv)
  assert.equal(rows.length, 3)
  for (const row of rows) {
    assert.equal(row.length, headers.length)
    const record = Object.fromEntries(headers.map((h, i) => [h,row[i]])), original = before.find(e => e.word === record.word)
    for (const field of JSON.parse(record.csv_escaped_columns)) record[field] = record[field].slice(1)
    assert.equal(record.detail, original.detail); assert.equal(record.note, original.note)
    assert.deepEqual(JSON.parse(record.sources_json), original.sources)
  }
  assert.deepEqual(await evaluate(() => window.api.listVocab({ sortBy: 'alpha' })), before)
  win.setSize(900,650); await snapshot('export-csv-light-900')
  report.checks.push('UI format selection; CSV independent parser round-trip, long text/formula text/source JSON; no vocabulary mutation')
  await click('关闭')
  await until(() => evaluate(() => !document.querySelector('[role="dialog"]')), 'dialog closed')
  await evaluate(() => document.querySelector('button[title="切换深浅色"]').click())
  win.setSize(340,420)
  await click('导出'); await snapshot('export-csv-dark-340')
  selected = null
  await click('保存文件')
  await until(() => evaluate(() => document.body.textContent.includes('已取消保存')), 'cancel message')
  assert.equal(fs.readFileSync(path.join(profile,'full-vocabulary.csv'),'utf8'), csv)
  selected = path.join(profile, 'missing-directory', 'all.csv')
  await click('保存文件')
  await until(() => evaluate(() => document.querySelector('[role="alert"]')?.textContent.includes('保存目录')), 'write error')
  await snapshot('export-error-dark-340')
  selected = path.join(profile, 'wrong.txt')
  fs.writeFileSync(selected, 'preserve this file')
  await click('保存文件')
  await until(() => evaluate(() => document.querySelector('[role="alert"]')?.textContent.includes('.csv')), 'invalid extension')
  assert.equal(fs.readFileSync(selected, 'utf8'), 'preserve this file')
  selected = path.join(profile, 'recovered.csv')
  await click('保存文件')
  await until(() => evaluate(() => document.querySelector('[aria-label="导出文件路径"]')?.textContent.endsWith('recovered.csv')), 'retry succeeded')
  win.setSize(900,650); await snapshot('export-saved-dark-900')
  assert.ok(fs.readdirSync(profile).every(name => !name.endsWith('.tmp')))
  assert.deepEqual(await evaluate(() => window.api.listVocab({ sortBy: 'alpha' })), before)
  report.checks.push('cancel preserves existing files; missing directory and wrong extension do not overwrite; error retry succeeds; no temp files; light/dark narrow/wide layouts')
  await click('关闭')
  await until(() => evaluate(() => !document.querySelector('[role="dialog"]')), 'closed for review')
  await click('开始自测'); await click('导出')
  await format('CSV')
  selected = path.join(profile, 'review.csv'); await click('保存文件')
  await until(() => fs.existsSync(selected), 'review export')
  assert.equal(parseCsv(fs.readFileSync(selected, 'utf8')).length, 4)
  await until(() => evaluate(() => document.querySelector('[aria-label="导出文件路径"]')?.textContent.endsWith('review.csv')), 'review completed')
  const previousCalls = calls
  for (const entry of before) await evaluate(id => window.api.deleteVocab(id), entry.id)
  await click('保存文件')
  await until(() => evaluate(() => document.body.textContent.includes('词库还是空的，收录词条后再导出')), 'empty state')
  assert.equal(calls, previousCalls)
  report.checks.push('review mode still exports all words; empty library does not open save chooser')
}
let finished = false
const watchdog = setTimeout(() => { report.failures.push('watchdog timeout'); finish() }, 100000)
function finish() {
  if (finished) return; finished = true; clearTimeout(watchdog)
  fs.writeFileSync(path.join(profile, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  app.once('quit', () => process.exit(report.failures.length ? 1 : 0)); app.quit()
}
main().catch(e => report.failures.push(e.stack)).finally(finish)
