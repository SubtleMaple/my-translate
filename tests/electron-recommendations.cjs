// Isolated real Electron UI/IPC/SQLite; deterministic local model, no user profile/key.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode', 'recommendations-e2e-'))
process.env.MY_TRANSLATE_USER_DATA = profile
app.setPath('userData', profile); app.setAppPath(repo)
const report = { profile, checks: [], screenshots: [], failures: [] }
const names = ('compile render deploy latency throughput interface protocol robust scalable constraint insight nuance adapt sustain clarify coherent derive feasible reliable concise efficient coherent resilient framework algorithm database software hardware memory storage bandwidth browser server client packet router component module function variable constant parameter argument return process thread task queue stack buffer stream event signal channel socket address route monitor measure estimate evaluate infer deduce justify contrast compare distinguish interpret analyze synthesize assess examine explore discover observe predict anticipate perceive recognize acknowledge consider reflect ponder resolve improve enhance refine optimize simplify reduce expand extend maintain preserve restore recover support enable facilitate establish develop construct compose assemble integrate combine connect separate isolate protect secure ensure verify validate confirm demonstrate illustrate explain express convey imply suggest indicate reveal highlight emphasize identify define describe summarize outline propose recommend require acquire retain obtain achieve accomplish deliver provide contribute cooperate collaborate coordinate negotiate implement execute operate perform conduct manage organize arrange allocate distribute transfer transform convert generate create design innovate invent investigate research experiment simulate calculate compute quantify classify categorize prioritize balance adapt accelerate tolerate mitigate prevent avoid detect diagnose debug troubleshoot repair replace upgrade migrate automate configure customize document communicate articulate persuade appreciate cherish embrace flourish thrive venture wander linger glimpse perceive').split(' ')
const counters = { analysis: 0, recommendations: 0, details: 0, normalization: 0, batchSizes: [] }
let win, server, fail = false, slow = false
const sleep = ms => new Promise(r => setTimeout(r, ms))
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true)
async function until(fn, label, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (await fn()) return; await sleep(70) }
  throw Error('Timeout: ' + label)
}
const click = text => evaluate(text => {
  const b = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === text)
  if (!b) throw Error('Missing button: ' + text)
  b.click()
}, text)
const ariaClick = label => evaluate(label => {
  const b = [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === label)
  if (!b) throw Error('Missing aria button: ' + label)
  b.click()
}, label)
const words = () => evaluate(() => [...document.querySelectorAll('[data-recommendation-word]')].map(el => el.dataset.recommendationWord))
const queryInput = text => evaluate(text => {
  const el = document.querySelector('input[aria-label="查询英文单词"]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}, text)
const settled = () => until(() => evaluate(() => ![...document.querySelectorAll('button')].some(el => el.textContent === '取消推荐')), 'recommendation settled')
async function snapshot(name) {
  await sleep(150)
  const issues = await evaluate(() => {
    const result = []
    if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) result.push('document overflow')
    for (const el of document.querySelectorAll('button,input')) {
      if (el.disabled || !el.getClientRects().length || el.closest('details:not([open])')) continue
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(Math.min(innerWidth-1, r.x+r.width/2), Math.min(innerHeight-1, r.y+r.height/2))
      if (r.left < -1 || r.right > innerWidth+1 || !(hit === el || el.contains(hit))) result.push({ label: el.getAttribute('aria-label') || el.textContent, hit: hit?.tagName, rect: { x:r.x,y:r.y,width:r.width,height:r.height } })
    }
    document.activeElement?.blur()
    document.querySelector('[aria-label="为你推荐"]')?.scrollIntoView({ block: 'start' })
    return result
  })
  assert.deepEqual(issues, [], name)
  await sleep(100)
  fs.writeFileSync(path.join(profile, name + '.png'), (await win.webContents.capturePage()).toPNG())
  report.screenshots.push(name)
}
async function main() {
  server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw), system = body.system || body.messages[0].content
    const user = body.messages.find(m => m.role === 'user').content
    let content
    if (system.includes('vocabulary-analysis-v1')) {
      counters.analysis++
      const input = JSON.parse(user); counters.batchSizes.push(input.vocabulary.length)
      assert.ok(!user.includes('PRIVATE_NOTE'))
      content = JSON.stringify({ analyses: input.vocabulary.map(e => ({ entryId: e.entryId, lemma: e.word, level: e.word.length > 30 ? 'C2' : 'B2', topic: 'technology', confidence: 0.9, specialist: e.word.length > 30 })) })
    } else if (system.includes('recommendations-v1')) {
      counters.recommendations++
      if (slow) await sleep(1200)
      if (fail) { res.writeHead(503); res.end('synthetic failure'); return }
      const input = JSON.parse(user)
      content = JSON.stringify({ recommendations: [...new Set(names)].filter(w => !input.excluded.includes(w)).slice(0, 18).map((word, i) => ({ word, lemma: word, forms: [word+'s'], family: word,
        level: input.targetLevel, topic: i < 12 ? 'technology' : 'general', pos: 'n.', meaning: '推荐目标义项', reason: input.samples.length ? '与你近期的科技阅读相关，有助于理解同类材料。' : '同难度的常用阅读词，可拓展日常表达。', utility: 4 })) })
    } else if (user.startsWith('{"targets":')) {
      counters.normalization++
      content = JSON.stringify({ entries: JSON.parse(user).targets.map(t => ({ id: t.id, original: t.original, word: t.original, explanation: '保留词头' })) })
    } else {
      counters.details++
      content = JSON.stringify({ pos: 'n.', brief: user.includes('推荐义项') ? '推荐目标义项' : '普通测试义项', usage: '常见阅读表达。', examples: [{ en: 'An example.', zh: '一个例子。' }] })
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body.system ? { content: [{ type: 'text', text: content }] } : { choices: [{ message: { content } }] }))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const provider = { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic-key', model: 'mock', thinking: 'off' }
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ llm: { type: 'openai', openai: provider, anthropic: provider }, ui: { theme: 'light' } }))
  require(path.join(repo, 'out/main/index.js'))
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return win && !win.webContents.isLoading() }, 'window')
  await until(() => evaluate(() => !!document.querySelector('#source-text')), 'renderer')
  win.setPosition(20,20); win.setSize(400,650)
  await click('查词'); await settled()
  assert.equal(counters.recommendations, 0)
  await snapshot('cold-start-light')
  await click('B1')
  await until(async () => (await words()).length === 3, 'cold recommendations'); await settled()
  assert.equal(counters.analysis, 0); assert.equal(counters.recommendations, 1)
  const first = await words()
  assert.equal(await evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '换一组')), false)
  await ariaClick('更新推荐'); await settled()
  assert.ok((await words()).every(w => !first.includes(w))); assert.equal(counters.recommendations, 2)
  report.checks.push('empty library requires level; cold B1 initializes once; only refresh control replaces group')
  const kept = await words(), beforeFeedback = counters.recommendations
  const known = kept[0]
  await ariaClick('已认识 ' + known); await settled()
  assert.deepEqual(await words(), kept)
  await evaluate(() => { document.querySelector('[aria-label="为你推荐"] details').open = true })
  await ariaClick('撤销 ' + known); await settled()
  assert.ok(!(await evaluate(() => window.api.getRecommendations({ allowGenerate: false }))).feedback.some(f => f.word === known))
  assert.deepEqual(await words(), kept)
  const persistedKnown = kept[0]
  await ariaClick('已认识 ' + persistedKnown); await settled()
  const skipped = kept[1]
  await ariaClick('不感兴趣 ' + skipped); await settled()
  assert.deepEqual(await words(), kept)
  assert.equal(counters.recommendations, beforeFeedback)
  const queried = kept[2]
  const normalizeBefore = counters.normalization, detailBefore = counters.details
  await ariaClick('查询推荐词 ' + queried)
  await until(() => evaluate(() => document.querySelector('article h2')?.textContent), 'recommended lookup')
  assert.equal(counters.normalization, normalizeBefore)
  assert.equal(counters.details, detailBefore + 1)
  assert.ok(await evaluate(() => document.body.textContent.includes('推荐目标义项')))
  assert.equal((await evaluate(() => window.api.listVocab({}))).length, 0)
  await click('加入生词本')
  await until(() => evaluate(async () => (await window.api.listVocab({})).length === 1), 'save queried word')
  await queryInput(''); await settled()
  assert.deepEqual(await words(), kept)
  for (const word of kept.slice(0, 2)) {
    await ariaClick('查询推荐词 ' + word)
    await until(() => evaluate(word => document.querySelector('article h2')?.textContent === word, word), 'lookup ' + word)
    await queryInput(''); await settled()
    assert.deepEqual(await words(), kept, 'returning after each lookup retains unread cards and order')
  }
  await click('翻译'); await click('查词'); await settled()
  assert.deepEqual(await words(), kept, 'navigation retains the completed group')
  assert.equal(counters.recommendations, beforeFeedback, 'lookup/save/feedback/navigation never request a new group')
  report.checks.push('known/skip/undo retain current cards; all recommended words can be queried; lookup uses recommended sense; save and navigation preserve order without generation')
  await evaluate(() => {
    const context = 'algorithm framework database iterate pneumonoultramicroscopicsilicovolcanoconiosis'
    return window.api.addVocab(context.split(' ').map(text => ({ text, start: context.indexOf(text), end: context.indexOf(text)+text.length })), context)
  })
  await until(() => evaluate(async () => (await window.api.listVocab({})).every(e => e.status === 'ready')), 'seed details ready')
  await settled()
  assert.deepEqual(await words(), kept, 'vocabulary change event retains current group')
  assert.equal(counters.recommendations, beforeFeedback)
  await ariaClick('更新推荐'); await settled()
  assert.ok((await words()).every(w => !kept.includes(w)), 'refresh applies lookup/save/feedback exclusions')
  let current = await evaluate(() => window.api.getRecommendations({ allowGenerate: false }))
  assert.equal(current.estimatedLevel, 'B2'); assert.equal(current.targetLevel, 'B2'); assert.equal(current.sampleSize, 6)
  const analyzed = counters.analysis
  const beforePreference = counters.recommendations, beforePreferenceWords = await words()
  await click('偏简单'); await settled()
  current = await evaluate(() => window.api.getRecommendations({ allowGenerate: false }))
  assert.equal(current.targetLevel, 'C1'); assert.equal(counters.analysis, analyzed)
  assert.deepEqual(await words(), beforePreferenceWords); assert.equal(counters.recommendations, beforePreference)
  await click('偏难'); await settled()
  current = await evaluate(() => window.api.getRecommendations({ allowGenerate: false }))
  assert.equal(current.targetLevel, 'B2'); assert.equal(counters.analysis, analyzed)
  assert.deepEqual(await words(), beforePreferenceWords); assert.equal(counters.recommendations, beforePreference)
  const seedWord = (await words())[0]
  await evaluate(word => window.api.addVocab([{ text: word, start: 0, end: word.length }], word), seedWord)
  await until(() => evaluate(async () => (await window.api.listVocab({})).every(e => e.status === 'ready')), 'new seed ready')
  await settled()
  assert.deepEqual(await words(), beforePreferenceWords)
  assert.equal(counters.recommendations, beforePreference)
  await ariaClick('更新推荐'); await settled()
  assert.equal(counters.batchSizes.at(-1), 1)
  report.checks.push('representative B2 profile resists C2 outlier; difficulty and vocabulary changes preserve group; explicit refresh reuses analyses and analyzes one new word')
  for (const dark of [false, true]) {
    if (dark) await evaluate(() => document.querySelector('button[title="切换深浅色"]').click())
    for (const [width,height] of [[340,420],[900,650]]) {
      win.setSize(width,height); await sleep(250)
      await evaluate(open => { const details = document.querySelector('[aria-label="为你推荐"] details'); if (details) details.open = open }, width === 900)
      await snapshot(`recommendations-${dark ? 'dark' : 'light'}-${width}`)
    }
  }
  const cachedWords = await words()
  fail = true; await ariaClick('更新推荐'); await settled()
  assert.deepEqual(await words(), cachedWords)
  assert.ok(await evaluate(() => document.body.textContent.includes('503')))
  fail = false; slow = true
  await ariaClick('更新推荐')
  await until(() => evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent === '取消推荐')), 'cancellation control')
  await click('取消推荐'); await sleep(1500)
  assert.deepEqual(await words(), cachedWords)
  slow = false
  report.checks.push('four narrow/wide light/dark layouts; provider error retains cache; cancellation ignores late results')
  const beforeModelChange = counters.recommendations
  await evaluate(() => window.api.setSettings({ llm: { type: 'anthropic' } }))
  await click('翻译'); await click('查词'); await settled()
  assert.deepEqual(await words(), cachedWords)
  assert.equal(counters.recommendations, beforeModelChange, 'model changes wait for manual refresh')
  await ariaClick('更新推荐'); await settled()
  assert.equal((await evaluate(() => window.api.getRecommendations({ allowGenerate: false }))).estimatedLevel, 'B2')
  const persistedWords = await words()
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload() })
  await until(() => evaluate(() => !!document.querySelector('#source-text')), 'renderer reloaded')
  const requestsBefore = counters.recommendations
  await click('查词'); await settled()
  current = await evaluate(() => window.api.getRecommendations({ allowGenerate: false }))
  assert.ok(current.feedback.some(f => f.word === persistedKnown && f.kind === 'known'))
  assert.ok(current.feedback.some(f => f.word === skipped && f.kind === 'skip'))
  assert.deepEqual(await words(), persistedWords)
  assert.equal(counters.recommendations, requestsBefore)
  await sleep(1000)
  const SQL = await require(path.join(repo,'node_modules/sql.js'))({ wasmBinary: fs.readFileSync(path.join(repo,'node_modules/sql.js/dist/sql-wasm.wasm')) })
  const db = new SQL.Database(fs.readFileSync(path.join(profile, 'my-translate.db')))
  assert.equal(db.exec('PRAGMA user_version')[0].values[0][0], 5)
  assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok')
  assert.ok(db.exec('SELECT count(*) FROM recommendation_analysis')[0].values[0][0] >= 7)
  assert.equal(db.exec('SELECT count(*) FROM vocabulary')[0].values[0][0], 7)
  db.close()
  await evaluate(() => document.querySelector('button[title="极简模式"]').click())
  await until(() => evaluate(() => !!document.querySelector('#minimal-text')), 'minimal')
  assert.equal(await evaluate(() => !!document.querySelector('[aria-label="为你推荐"]')), false)
  report.checks.push('model change retains group until refresh; Anthropic generation; reload retains current order and feedback; v5 SQLite persistence; minimal hides recommendations')
}
let finished = false
const watchdog = setTimeout(() => { report.failures.push('watchdog timeout'); finish() }, 130000)
function finish() {
  if (finished) return; finished = true; clearTimeout(watchdog)
  report.counters = counters
  fs.writeFileSync(path.join(profile, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2)); server?.close()
  app.once('quit', () => process.exit(report.failures.length ? 1 : 0)); app.quit()
}
main().catch(e => report.failures.push(e.stack)).finally(finish)
