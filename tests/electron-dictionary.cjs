// Real Electron IPC + isolated profile + local deterministic model. No user data/key access.
const { app, BrowserWindow, nativeTheme } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode', 'dictionary-e2e-'))
const artifacts = path.join(profile, 'screenshots')
fs.mkdirSync(artifacts)
process.env.MY_TRANSLATE_USER_DATA = profile
app.setPath('userData', profile); app.setAppPath(repo)
const report = { profile, checks: [], screenshots: [], failures: [] }
let win, server, requests = 0, failNormalize = false
const sleep = ms => new Promise(r => setTimeout(r, ms))
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true)
async function until(fn, label, timeout = 12000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (await fn()) return; await sleep(70) }
  throw Error('Timeout: ' + label)
}
const click = text => evaluate(text => {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  if (!button) throw Error('Missing button: ' + text)
  button.click()
}, text)
const titleClick = title => evaluate(title => document.querySelector(`button[title="${title}"]`).click(), title)
const queryInput = value => evaluate(value => {
  const el = document.querySelector('input[aria-label="查询英文单词"]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}, value)
const addWords = (words, context) => evaluate((words, context) => window.api.addVocab(words.map(text => {
  const start = context.indexOf(text)
  return { text, start, end: start + text.length }
}), context), words, context)
async function snapshot(name) {
  await sleep(120)
  const issues = await evaluate(() => {
    const issues = []
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('horizontal overflow')
    if (document.documentElement.scrollHeight > innerHeight + 1) issues.push('vertical overflow')
    for (const el of document.querySelectorAll('button,input,textarea,[role="combobox"]')) {
      if (el.disabled || !el.getClientRects().length) continue
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(Math.min(innerWidth-1, r.x+r.width/2), Math.min(innerHeight-1, r.y+r.height/2))
      if (r.left < -1 || r.right > innerWidth+1 || !(hit === el || el.contains(hit))) issues.push(el.getAttribute('aria-label') || el.textContent)
    }
    for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0
    document.activeElement?.blur()
    return issues
  })
  assert.deepEqual(issues, [], name)
  await sleep(50)
  fs.writeFileSync(path.join(artifacts, name + '.png'), (await win.webContents.capturePage()).toPNG())
  report.screenshots.push(name)
}
async function main() {
  server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); requests++
    const user = body.messages.find(m => m.role === 'user').content
    let content
    if (user.startsWith('{"targets":')) {
      const { targets, context } = JSON.parse(user)
      if (targets.some(t => t.original === 'slow')) await sleep(700)
      if (failNormalize) content = '{"entries":[]}'
      else content = JSON.stringify({ entries: targets.map(({ id, original }) => ({
        id, original,
        word: ({ books: 'book', went: 'go', goes: 'go', running: 'run', 'looked after': 'look after' })[original] || (original === 'saw' && context.includes('birds') ? 'see' : original),
        explanation: original === 'meeting' ? '本句作名词“会议”，保留独立词义。' : '根据语境还原词典词头；无上下文歧义时保留原词。'
      })) })
    } else content = JSON.stringify({ phonetic: '/ɡəʊ/', pos: 'v.', brief: '去；前往；行进', usage: '用于表示移动、前往某地或状态的变化。常见搭配：go home、go to school。', examples: [{ en: 'We go home together.', zh: '我们一起回家。' }, { en: 'She went to the library.', zh: '她去了图书馆。' }, { en: 'Let us go.', zh: '我们走吧。' }], synonyms: ['leave（离开）'], antonyms: ['stay（停留）'], memory: 'go / went / gone 是不规则变化，结合语境记忆。' })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body.system ? { content: [{ type: 'text', text: content }] } : { choices: [{ message: { content } }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const provider = { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic-key-not-real', model: 'mock', thinking: 'off' }
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ llm: { type: 'openai', openai: provider, anthropic: provider }, ui: { theme: 'light' } }))
  require(path.join(repo, 'out/main/index.js'))
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return win && !win.webContents.isLoading() }, 'window')
  await until(() => evaluate(() => !!document.querySelector('#source-text')), 'renderer')
  win.setPosition(20,20); win.setSize(400,560)
  await click('查词'); await snapshot('lookup-empty-light')
  await queryInput('went'); await evaluate(() => document.querySelector('form').requestSubmit())
  await until(() => evaluate(() => document.querySelector('h2')?.textContent === 'go'), 'lookup result')
  assert.equal((await evaluate(() => window.api.listVocab({}))).length, 0)
  const beforeSave = requests
  await click('加入生词本')
  await until(() => evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent === '已收录')), 'saved state')
  assert.equal(requests, beforeSave)
  let entries = await evaluate(() => window.api.listVocab({}))
  assert.equal(entries[0].word, 'go'); assert.equal(entries[0].status, 'ready')
  assert.equal(entries[0].sources[0].original, 'went')
  await evaluate(id => window.api.updateVocabNote(id, 'Keep this note'), entries[0].id)
  await click('翻译'); await click('查词')
  assert.equal(await evaluate(() => document.querySelector('h2')?.textContent), 'go')
  const direct = await evaluate(() => window.api.lookupWord('direct', 'went'))
  await evaluate(id => Promise.all([window.api.saveLookup(id), window.api.saveLookup(id)]), direct.id)
  assert.equal((await evaluate(() => window.api.listVocab({})))[0].count, 1)
  report.checks.push('UI query via form; no automatic save; reuse detail without network; idempotent save; menu state retained')
  await addWords(['went', 'goes'], 'He went home; she goes home.')
  entries = await evaluate(() => window.api.listVocab({}))
  assert.equal(entries[0].count, 2); assert.equal(entries[0].note, 'Keep this note')
  await addWords(['saw'], 'I saw birds.')
  await addWords(['saw'], 'This is a saw.')
  await addWords(['books', 'running', 'meeting', 'interesting', 'clothes', 'looked after'], 'She was running to a meeting about interesting books and clothes. She looked after them.')
  await until(() => evaluate(async () => (await window.api.listVocab({})).every(e => e.status === 'ready')), 'detail queue')
  entries = await evaluate(() => window.api.listVocab({}))
  for (const word of ['go', 'see', 'saw', 'book', 'run', 'meeting', 'interesting', 'clothes', 'look after']) assert.ok(entries.some(e => e.word === word), word)
  report.checks.push('normalized variants; distinct contextual saw meanings; batch count once; existing note/detail retained; queue ready')
  await click('翻译')
  await evaluate(() => {
    const el = document.querySelector('#source-text')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'failure')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await evaluate(() => document.querySelector('button[title="选择 failure"]').click())
  failNormalize = true; await click('加入 1 条')
  await until(() => evaluate(() => document.body.textContent.includes('词形判断不完整')), 'normalization failure')
  assert.ok(await evaluate(() => !!document.querySelector('button[data-selection-key="0:7"]')))
  assert.ok(!(await evaluate(() => window.api.listVocab({}))).some(e => e.word === 'failure'))
  failNormalize = false
  report.checks.push('invalid normalization response does not write; selected word remains retryable')
  await click('查词'); await queryInput('slow'); await click('查询')
  await click('取消'); await queryInput('books'); await click('查询')
  await until(() => evaluate(() => document.querySelector('h2')?.textContent === 'book'), 'replacement query')
  await sleep(900)
  assert.equal(await evaluate(() => document.querySelector('h2')?.textContent), 'book')
  await queryInput('two words'); await click('查询')
  await until(() => evaluate(() => document.querySelector('[role="alert"]')?.textContent.includes('一个英文单词')), 'single word validation')
  await queryInput('went'); await click('查询')
  await until(() => evaluate(() => document.querySelector('h2')?.textContent === 'go'), 'query restored')
  report.checks.push('cancel aborts request; late result ignored; single-word input validation')
  const paletteNames = [['bamboo','青竹'],['indigo','靛蓝'],['iris','鸢尾'],['amber','琥珀'],['cinnabar','朱砂'],['graphite','石墨']]
  for (const dark of [false, true]) {
    if (dark) await titleClick('切换深浅色')
    for (const [key, label] of paletteNames) {
      await click('设置'); await click(label)
      await until(() => evaluate(key => document.documentElement.dataset.palette === key, key), 'palette')
      assert.equal((await evaluate(() => window.api.getSettings())).ui.palette, key)
      if (key === 'bamboo') { win.setSize(340,420); await snapshot(`settings-${dark ? 'dark' : 'light'}-340`); win.setSize(400,560) }
      await click('查词'); await snapshot(`lookup-${key}-${dark ? 'dark' : 'light'}`)
    }
  }
  win.setSize(340,420); await snapshot('lookup-narrow-340')
  win.setSize(900,650); await snapshot('lookup-wide-900')
  await titleClick('极简模式')
  await until(() => evaluate(() => !!document.querySelector('#minimal-text')), 'minimal')
  assert.equal(await evaluate(() => !!document.querySelector('nav')), false)
  assert.equal(await evaluate(() => !!document.querySelector('input[aria-label="查询英文单词"]')), false)
  win.setSize(260,140); await snapshot('minimal-graphite-260')
  await titleClick('退出极简模式')
  report.checks.push('six palettes × light/dark; settings persistence; narrow/wide layout; minimal excludes lookup')
  await evaluate(() => window.api.setSettings({ llm: { type: 'anthropic' } }))
  const anthropic = await evaluate(() => window.api.lookupWord('anthropic', 'went'))
  assert.equal(anthropic.word, 'go')
  await evaluate(() => window.api.setSettings({ ui: { theme: 'system', palette: 'iris' } }))
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload() })
  await until(() => evaluate(() => document.documentElement.dataset.palette === 'iris'), 'reload persisted settings')
  nativeTheme.themeSource = 'light'
  await until(() => evaluate(() => !document.documentElement.classList.contains('dark')), 'system initial light')
  await sleep(200)
  nativeTheme.themeSource = 'dark'
  await until(() => evaluate(() => document.documentElement.classList.contains('dark')), 'system dark')
  nativeTheme.themeSource = 'light'
  await until(() => evaluate(() => !document.documentElement.classList.contains('dark')), 'system light')
  await sleep(1000)
  const diskSettings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json')))
  assert.equal(diskSettings.ui.palette, 'iris'); assert.equal(diskSettings.ui.theme, 'system')
  const SQL = await require(path.join(repo,'node_modules/sql.js'))({ wasmBinary: fs.readFileSync(path.join(repo,'node_modules/sql.js/dist/sql-wasm.wasm')) })
  const db = new SQL.Database(fs.readFileSync(path.join(profile,'my-translate.db')))
  assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok')
  assert.equal(db.exec("SELECT count FROM vocabulary WHERE word='go'")[0].values[0][0], 2)
  db.close()
  report.checks.push('Anthropic real IPC; renderer reload persistence; live system-theme sync; SQLite disk integrity')
}
let finished = false
const watchdog = setTimeout(() => { report.failures.push('watchdog timeout'); finish() }, 110000)
function finish() {
  if (finished) return; finished = true; clearTimeout(watchdog)
  fs.writeFileSync(path.join(profile, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2)); server?.close()
  app.once('quit', () => process.exit(report.failures.length ? 1 : 0)); app.quit()
}
main().catch(async e => {
  report.failures.push(e.stack)
  if (win && !win.isDestroyed()) {
    report.diagnostic = { native: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors,
      renderer: await evaluate(async () => ({ dark: document.documentElement.classList.contains('dark'), media: matchMedia('(prefers-color-scheme: dark)').matches, ui: (await window.api.getSettings()).ui })) }
  }
}).finally(finish)
