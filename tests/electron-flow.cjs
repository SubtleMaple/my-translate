/* Run after pnpm build: pnpm exec electron tests/electron-flow.cjs
   Uses real main/preload/renderer IPC, disposable synthetic profile, local mock LLM only. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-reading-flow-'))
process.env.MY_TRANSLATE_USER_DATA = profile
app.setPath('userData', profile)
app.setAppPath(repo)
let win, failTranslation = false, longTranslation = false, server
const screenshotDir = path.join(repo, 'docs/qa-reading-flow')
fs.mkdirSync(screenshotDir, { recursive: true })
const report = { profile, checks: [], layouts: [], failures: [] }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true)
async function until(fn, label, timeout = 12000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (await fn()) return; await sleep(70) }
  throw new Error(`Timeout: ${label}`)
}
const click = text => evaluate(text => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  if (!btn) throw Error(`Missing button: ${text}`)
  btn.click()
}, text)
const titleClick = title => evaluate(title => document.querySelector(`button[title="${title}"]`).click(), title)
const input = text => evaluate(text => {
  const el = document.querySelector('textarea')
  if (!el || el.readOnly) throw Error('No editable textarea')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}, text)
async function resize(width, height) {
  for (let attempt = 0; attempt < 5; attempt++) {
    win.setSize(width, height)
    await sleep(150)
    if (win.getSize().every((v, i) => Math.abs(v - [width, height][i]) <= 2)) break
  }
  assert.ok(win.getSize().every((v, i) => Math.abs(v - [width, height][i]) <= 2), `resize ${width}x${height}; actual ${win.getSize()}`)
  await sleep(150)
}
async function layout(label) {
  await sleep(100)
  const result = await evaluate(() => {
    const issues = []
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('document horizontal overflow')
    if (document.documentElement.scrollHeight > innerHeight + 1) issues.push('document vertical overflow')
    const controls = [...document.querySelectorAll('button, input, textarea')].filter(el => !el.disabled && el.getClientRects().length)
    for (const el of controls) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const rect = el.getBoundingClientRect()
      const x = Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2))
      const y = Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2))
      const hit = document.elementFromPoint(x, y)
      if (rect.left < -1 || rect.right > innerWidth + 1 || rect.bottom < 0 || rect.top > innerHeight || !(hit === el || el.contains(hit))) {
        issues.push({ control: (el.title || el.getAttribute('aria-label') || el.textContent || el.tagName).slice(0, 70), hit: hit?.outerHTML.slice(0,180), rect: {x:rect.x,y:rect.y,width:rect.width,height:rect.height} })
      }
    }
    return { width: innerWidth, height: innerHeight, dark: document.documentElement.classList.contains('dark'), controls: controls.length, issues }
  })
  report.layouts.push({ label, ...result })
  await evaluate(() => { document.activeElement?.blur(); for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0 })
  await sleep(100)
  const image = await win.webContents.capturePage()
  fs.writeFileSync(path.join(screenshotDir, label + '.png'), image.toPNG())
  if (result.issues.length) report.failures.push({ label, issues: result.issues })
}
async function main() {
  server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    if (body.stream) {
      if (failTranslation) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Synthetic failure' } })); return }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const content of ['这是测试译文。', longTranslation ? '超长译文。'.repeat(1600) : '阅读让我们发现新的词语。']) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
        await sleep(40)
      }
      res.end('data: [DONE]\n\n')
    } else {
      const content = JSON.stringify({ phonetic: '/ˈsɪnθətɪk/', pos: 'n.', brief: '合成测试释义；'.repeat(8), usage: '学习用法。'.repeat(80), examples: [{ en: 'A synthetic example '.repeat(50), zh: '这是示例。'.repeat(30) }], synonyms: ['example'], antonyms: [], memory: '仅测试数据' })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ llm: { type: 'openai', openai: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic-key-not-real', model: 'mock', thinking: 'off' } }, ui: { minimal: false, theme: 'light' } }))
  require(path.join(repo, 'out/main/index.js'))
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return win && !win.webContents.isLoading() }, 'window')
  await until(() => evaluate(() => Boolean(document.querySelector('#source-text'))), 'renderer')
  win.setPosition(20, 20)
  await resize(340,420)
  await layout('empty-translate-light-340x420')
  await click('生词本')
  await until(() => evaluate(() => document.body.textContent.includes('生词本还是空的')), 'empty vocab')
  await layout('empty-vocab-light-340x420')
  await click('翻译')
  await input('Alpha beta gamma')
  await evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => 'REPLACED', writeText: async () => {} } })
    const el = document.querySelector('textarea')
    el.focus(); el.setSelectionRange(6,10)
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  })
  await until(() => evaluate(() => document.querySelector('textarea').value === 'Alpha REPLACED gamma'), 'right click replaces selection')
  await evaluate(() => { navigator.clipboard.readText = async () => 'Clipboard replacement sentence.' })
  await click('粘贴并翻译')
  await until(() => evaluate(() => document.body.textContent.includes('翻译完成') && document.querySelector('textarea').value === 'Clipboard replacement sentence.'), 'quick paste replaces whole source and translates')
  longTranslation = true
  await input('Long translation test.')
  await click('翻译')
  await until(() => evaluate(() => document.body.textContent.includes('翻译完成') && document.querySelector('[aria-label="中文译文"]').textContent.length > 7000), 'long translation')
  await layout('long-translation-light-340x420')
  await titleClick('极简模式')
  await until(() => evaluate(() => document.querySelector('#minimal-text')?.readOnly), 'minimal translated output')
  await until(() => win.getMinimumSize()[0] === 260, 'minimal minimum')
  await resize(260,140)
  const beforeNonText = await evaluate(() => document.querySelector('textarea').value)
  await evaluate(() => document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() })))
  assert.equal(await evaluate(() => document.querySelector('textarea').value), beforeNonText, 'non-text paste preserves output')
  await layout('long-translation-minimal-260x140')
  await titleClick('退出极简模式')
  await until(() => evaluate(() => Boolean(document.querySelector('#source-text'))), 'back to full')
  report.checks.push('empty views; right-click selected replacement; paste-and-translate whole replacement; 8000-char output; non-text paste preserves output')
  longTranslation = false
  const source = 'Reading reveals remarkable words and bright ideas. ' + 'pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(3)
  await input(source)
  await click('翻译')
  await until(() => evaluate(() => document.body.textContent.includes('这是测试译文。')), 'stream translation')
  await until(() => evaluate(() => document.body.textContent.includes('翻译完成')), 'translate done')
  report.checks.push('real IPC SSE translation')
  await input(source + ' Edited.')
  assert.equal(await evaluate(() => document.body.textContent.includes('这是测试译文。')), false)
  report.checks.push('editing clears previous translation')
  await evaluate(() => document.querySelector('button[title="选择 Reading"]').click())
  await click('加入 1 条')
  await until(() => evaluate(async () => (await window.api.listVocab({})).some(e => e.word === 'Reading' && e.status === 'ready')), 'single word persisted and generated')
  await evaluate(() => {
    const first = document.querySelector('button[title="选择 bright"]')
    const last = document.querySelector('button[title="选择 ideas"]')
    first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
    first.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: last, clientX: 50, clientY: 10 }))
    last.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: first, clientX: 50, clientY: 10 }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 10 }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 10 }))
  })
  await click('加入 1 条')
  await until(() => evaluate(async () => (await window.api.listVocab({})).length >= 2), 'UI drag phrase persisted')
  assert.ok(await evaluate(async () => (await window.api.listVocab({})).some(e => e.word === 'bright ideas')), 'drag selection saves exact phrase')
  const added = await evaluate(() => window.api.addVocab(['Reading'], 'A long source '.repeat(80)))
  assert.deepEqual(added.existed, ['Reading'])
  await until(() => evaluate(async () => (await window.api.listVocab({})).every(e => e.status === 'ready')), 'phrase generated')
  const entries = await evaluate(() => window.api.listVocab({}))
  assert.equal(entries.find(e => e.word === 'Reading').count, 2)
  await evaluate(id => window.api.updateVocabNote(id, 'Synthetic note persisted'), entries.find(e => e.word === 'Reading').id)
  report.checks.push('UI save, duplicate counter, phrase, detail generation, note IPC')
  await resize(340,420)
  await layout('toast-active-full-340x420')
  await titleClick('极简模式'); await until(() => evaluate(() => Boolean(document.querySelector('#minimal-text'))), 'minimal toast')
  await until(() => win.getMinimumSize()[0] === 260, 'minimal minimum')
  await resize(260,140)
  await layout('toast-active-minimal-260x140')
  await titleClick('退出极简模式')
  await sleep(2600)
  for (const dark of [false, true]) {
    if (dark) await titleClick('切换深浅色')
    for (const [width, height] of [[340,420],[400,560],[900,650]]) {
      await resize(width,height); await layout(`translate-${dark ? 'dark' : 'light'}-${width}x${height}`)
      await click('生词本'); await until(() => evaluate(() => document.querySelector('button[aria-controls^="vocab-detail"]')), 'vocab')
      await evaluate(() => { const b = document.querySelector('button[aria-controls^="vocab-detail"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click() })
      await layout(`vocab-expanded-${dark ? 'dark' : 'light'}-${width}x${height}`)
      await click('开始自测')
      assert.equal(await evaluate(() => Boolean(document.querySelector('[id^="vocab-detail-"]'))), false)
      await layout(`vocab-self-test-${dark ? 'dark' : 'light'}-${width}x${height}`)
      await click('退出自测'); await click('翻译')
    }
    await resize(400,560)
    const fullSize = win.getSize()
    await titleClick('极简模式'); await until(() => evaluate(() => Boolean(document.querySelector('#minimal-text'))), 'minimal mode')
    await until(() => win.getMinimumSize()[0] === 260, 'minimal minimum')
    for (const [width,height] of [[260,140],[320,240]]) {
      await resize(width,height); await layout(`minimal-${dark ? 'dark' : 'light'}-${width}x${height}`)
    }
    await titleClick('退出极简模式'); await sleep(150)
    assert.ok(win.getSize().every((value, i) => Math.abs(value - fullSize[i]) <= 2), 'normal size restored within Windows DPI rounding')
  }
  report.checks.push('self-test conceals details; themes; full/minimal sizes; size restoration')
  failTranslation = true
  await click('翻译')
  await until(() => evaluate(() => document.body.textContent.includes('API Key 无效')), 'HTTP failure')
  await input('Editable after failure.')
  assert.equal(await evaluate(() => document.querySelector('textarea').value), 'Editable after failure.')
  await titleClick('极简模式')
  await click('翻译')
  await until(() => evaluate(() => document.body.textContent.includes('API Key 无效')), 'minimal HTTP failure')
  await layout('minimal-error-320x240')
  const editState = await evaluate(() => ({ readOnly: document.querySelector('textarea').readOnly, hasSourceButton: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '原文' && !b.disabled) }))
  if (editState.readOnly && !editState.hasSourceButton) report.failures.push({ label: 'minimal failure editable', editState })
  else report.checks.push('minimal failure editable or accessible source toggle')
  await titleClick('退出极简模式')
  await evaluate(id => window.api.deleteVocab(id), entries.find(e => e.word === 'bright ideas').id)
  await sleep(1000)
  const initSqlJs = require(path.join(repo, 'node_modules/sql.js'))
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(path.join(repo,'node_modules/sql.js/dist/sql-wasm.wasm')) })
  const db = new SQL.Database(fs.readFileSync(path.join(profile, 'my-translate.db')))
  const rows = db.exec('SELECT word, count, note FROM vocabulary')[0].values
  assert.deepEqual(rows, [['Reading', 2, 'Synthetic note persisted']])
  db.close()
  report.checks.push('SQLite disk verification: one word, duplicate count 2, note saved, phrase deleted')
}
const watchdog = setTimeout(() => { report.failures.push({ error: 'watchdog timeout' }); finish() }, 110000)
let finished = false
function finish() {
  if (finished) return; finished = true
  clearTimeout(watchdog)
  fs.writeFileSync(path.join(profile, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ profile, checks: report.checks, layouts: report.layouts.length, failures: report.failures }, null, 2))
  server?.close()
  // app.quit runs the application's normal settings/database flush.
  app.once('quit', () => process.exit(report.failures.length ? 1 : 0))
  app.quit()
}
main().catch(error => report.failures.push({ error: error.stack })).finally(finish)
