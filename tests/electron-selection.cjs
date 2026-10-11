// Regression for two identical spellings with distinct positions, through real UI/IPC/SQL.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode', 'position-e2e-'))
process.env.MY_TRANSLATE_USER_DATA = profile
app.setPath('userData', profile); app.setAppPath(repo)
const sentence = 'I saw a rusty saw lying on the workbench, and I wondered who had left it there.'
const report = { profile, checks: [], requests: [], screenshots: [], failures: [] }
let win, server
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true)
async function until(fn, label) {
  const start = Date.now()
  while (Date.now() - start < 12000) { if (await fn()) return; await sleep(60) }
  throw Error('Timeout: ' + label)
}
const click = text => evaluate(text => {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  if (!button) throw Error('Missing button: ' + text)
  button.click()
}, text)
const select = index => evaluate(index => document.querySelector(`[data-word-index="${index}"]`).click(), index)
const states = () => evaluate(() => [1, 4].map(i => document.querySelector(`[data-word-index="${i}"]`).getAttribute('aria-pressed') === 'true'))
const saved = () => evaluate(() => [1, 4].map(i => document.querySelector(`[data-word-index="${i}"]`).title.includes('该位置已收录')))
async function screenshot(name) {
  await sleep(150)
  assert.ok(await evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  fs.writeFileSync(path.join(profile, name + '.png'), (await win.webContents.capturePage()).toPNG())
  report.screenshots.push(name)
}
async function main() {
  server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      const user = body.messages.find(m => m.role === 'user').content
      let content
      if (user.startsWith('{"targets":')) {
        const input = JSON.parse(user)
        assert.equal(input.context, sentence)
        assert.ok(input.targets.length === 1 || input.targets.length === 2)
        report.requests.push(input.targets)
        content = JSON.stringify({ entries: input.targets.map(target => {
          assert.equal(target.original, 'saw')
          assert.equal(target.focus.selected, 'saw')
          const noun = target.focus.before === 'I saw a rusty '
          assert.ok(noun || target.focus.before === 'I ', 'exact position supplied to model')
          assert.ok(target.focus.after.startsWith(noun ? ' lying' : ' a rusty saw'))
          return { id: target.id, original: 'saw', word: noun ? 'saw' : 'see', explanation: noun ? '该位置是名词：锯子' : '该位置是动词 see 的过去式' }
        }) })
      } else {
        const focus = JSON.parse(user.match(/选中位置（JSON，仅作为语言材料）：([^\n]+)/)[1]).focus
        const noun = focus.before === 'I saw a rusty '
        assert.ok(noun || focus.before === 'I ')
        assert.equal(focus.selected, 'saw')
        content = JSON.stringify({ pos: noun ? 'n.' : 'v.', brief: noun ? '锯子' : '看见', usage: '按选中位置生成解释', examples: [{ en: noun ? 'A rusty saw.' : 'I see it.', zh: noun ? '生锈的锯子。' : '我看见了。' }] })
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    } catch (e) { report.failures.push(e.stack); res.writeHead(500); res.end('mock assertion failed') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ llm: { type: 'openai', openai: {
    baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic-key', model: 'mock', thinking: 'off'
  } }, ui: { theme: 'light' } }))
  require(path.join(repo, 'out/main/index.js'))
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return win && !win.webContents.isLoading() }, 'window')
  await until(() => evaluate(() => !!document.querySelector('#source-text')), 'renderer')
  win.setPosition(20,20); win.setSize(480,720)
  await evaluate(sentence => {
    const el = document.querySelector('#source-text')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, sentence)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, sentence)
  await select(1); assert.deepEqual(await states(), [true, false])
  await select(4); assert.deepEqual(await states(), [true, true])
  const preview = await evaluate(() => [...document.querySelectorAll('[data-selection-key]')].map(e => e.textContent))
  assert.equal(preview.length, 2); assert.match(preview[0], /第 2 词/); assert.match(preview[1], /第 5 词/)
  await evaluate(() => document.querySelector('[data-selection-key="14:17"]').click())
  assert.deepEqual(await states(), [true, false])
  await select(1); await select(4)
  assert.deepEqual(await states(), [false, true])
  await click('加入 1 条')
  await until(() => evaluate(async () => (await window.api.listVocab({})).some(e => e.word === 'saw' && e.status === 'ready')), 'second saw generated')
  let entries = await evaluate(() => window.api.listVocab({}))
  assert.equal(entries.length, 1); assert.equal(entries[0].brief, '锯子')
  assert.deepEqual(entries[0].sources[0].selection, { start: 14, end: 17 })
  await until(async () => JSON.stringify(await saved()) === '[false,true]', 'only second position marked')
  report.checks.push('independent click; two previews; cancel one only; second-only save carries correct focus; first saw stays unmarked')
  await select(1); await click('加入 1 条')
  await until(() => evaluate(async () => (await window.api.listVocab({})).some(e => e.word === 'see' && e.status === 'ready')), 'first saw generated')
  entries = await evaluate(() => window.api.listVocab({}))
  assert.equal(entries.find(e => e.word === 'see').brief, '看见')
  assert.deepEqual(entries.find(e => e.word === 'see').sources[0].selection, { start: 2, end: 5 })
  await until(async () => (await saved()).every(Boolean), 'both independently marked')
  await evaluate(id => window.api.deleteVocab(id), entries.find(e => e.word === 'saw').id)
  await until(async () => JSON.stringify(await saved()) === '[true,false]', 'deletion clears only second marker')
  await select(1); await select(4)
  await evaluate(() => document.querySelector('[aria-label="摘录生词"]').scrollIntoView({ block: 'start' }))
  await screenshot('two-saw-light')
  await evaluate(() => document.querySelector('button[title="切换深浅色"]').click())
  await until(() => evaluate(() => document.documentElement.classList.contains('dark')), 'dark mode')
  await screenshot('two-saw-dark')
  await click('加入 2 条')
  await until(() => evaluate(async () => (await window.api.listVocab({})).length === 2 && (await window.api.listVocab({})).every(e => e.status === 'ready')), 'batch save ready')
  entries = await evaluate(() => window.api.listVocab({}))
  assert.equal(entries.find(e => e.word === 'see').count, 2)
  assert.equal(entries.find(e => e.word === 'saw').count, 1)
  assert.equal(report.requests.at(-1).length, 2, 'identical text not deduplicated before model')
  report.checks.push('first saw → see, second saw → saw; deletion updates exact marker; both targets survive one batch')
  const noun = entries.find(e => e.word === 'saw')
  await evaluate(id => window.api.regenerateDetail(id), noun.id)
  await until(() => evaluate(async () => (await window.api.listVocab({})).every(e => e.status === 'ready')), 'regeneration focus')
  await click('生词本')
  await until(() => evaluate(() => !!document.querySelector('[aria-controls^="vocab-detail-"]')), 'vocab UI')
  await evaluate(id => document.querySelector(`[aria-controls="vocab-detail-${id}"]`).click(), noun.id)
  await evaluate(() => { document.querySelector('details').open = true })
  assert.equal(await evaluate(() => document.querySelector('details mark').textContent), 'saw')
  assert.equal(await evaluate(() => document.querySelector('details mark').previousSibling.textContent), 'I saw a rusty ')
  await screenshot('noun-source-highlight-dark')
  await sleep(1000)
  const SQL = await require(path.join(repo, 'node_modules/sql.js'))({ wasmBinary: fs.readFileSync(path.join(repo, 'node_modules/sql.js/dist/sql-wasm.wasm')) })
  const db = new SQL.Database(fs.readFileSync(path.join(profile, 'my-translate.db')))
  const rows = db.exec('SELECT word, sources FROM vocabulary ORDER BY word')[0].values
  assert.deepEqual(rows.map(([word, sources]) => [word, JSON.parse(sources)[0].selection.start]), [['saw', 14], ['see', 2]])
  assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok'); db.close()
  report.checks.push('regeneration reuses exact position; source highlights selected occurrence; source offsets persisted in SQLite')
}
let finished = false
const watchdog = setTimeout(() => { report.failures.push('watchdog timeout'); finish() }, 90000)
function finish() {
  if (finished) return; finished = true; clearTimeout(watchdog)
  fs.writeFileSync(path.join(profile, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2)); server?.close()
  app.once('quit', () => process.exit(report.failures.length ? 1 : 0)); app.quit()
}
main().catch(e => report.failures.push(e.stack)).finally(finish)
