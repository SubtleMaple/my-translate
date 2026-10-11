// Real UI/IPC/FSRS/SQLite, isolated synthetic vocabulary; deliberately no LLM config.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode', 'review-e2e-'))
process.env.MY_TRANSLATE_USER_DATA = profile
app.setPath('userData', profile); app.setAppPath(repo)
const report = { profile, checks: [], screenshots: [], failures: [] }
let win
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true)
async function until(fn, label) {
  const start = Date.now()
  while (Date.now() - start < 15000) { if (await fn()) return; await sleep(60) }
  throw Error('Timeout: ' + label)
}
const click = text => evaluate(text => {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  if (!button) throw Error('Missing button: ' + text)
  button.click()
}, text)
const questionId = () => evaluate(() => document.querySelector('[data-review-question]')?.getAttribute('data-review-question'))
async function select(label, option) {
  await evaluate(label => {
    const trigger = [...document.querySelectorAll('[role="combobox"]')].find(e => e.getAttribute('aria-label') === label)
    trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  }, label)
  await until(() => evaluate(() => !!document.querySelector('[role="option"]')), 'select options')
  await evaluate(option => [...document.querySelectorAll('[role="option"]')].find(e => e.textContent.startsWith(option)).click(), option)
  await sleep(120)
}
const settled = () => until(() => evaluate(() => !document.querySelector('button[disabled] [class*="animate-spin"]')), 'settled')
async function key(value, code = value) {
  await evaluate((value, code) => { document.activeElement?.blur(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: value, code, bubbles: true })) }, value, code)
}
async function reveal() {
  await key(' ', 'Space')
  await until(() => evaluate(() => !!document.querySelector('[aria-label="自测答案"]')), 'answer revealed')
}
async function rate(value) {
  const old = await questionId()
  await key(String(value))
  await until(async () => await questionId() !== old, 'rated next question or summary')
}
async function snapshot(name) {
  await sleep(200)
  const issues = await evaluate(() => {
    const issues = []
    if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) issues.push('document overflow')
    for (const el of document.querySelectorAll('button,input,[role="combobox"]')) {
      if (el.disabled || !el.getClientRects().length || el.closest('details:not([open])')) continue
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(Math.min(innerWidth-1, r.x+r.width/2), Math.min(innerHeight-1, r.y+r.height/2))
      if (r.left < -1 || r.right > innerWidth+1 || !(hit === el || el.contains(hit))) issues.push(el.getAttribute('aria-label') || el.textContent)
    }
    document.activeElement?.blur()
    for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0
    return issues
  })
  fs.writeFileSync(path.join(profile, name + '.png'), (await win.webContents.capturePage()).toPNG())
  report.screenshots.push(name)
  assert.deepEqual(issues, [], name)
}
async function main() {
  const SQL = await require(path.join(repo, 'node_modules/sql.js'))({ wasmBinary: fs.readFileSync(path.join(repo, 'node_modules/sql.js/dist/sql-wasm.wasm')) })
  const db = new SQL.Database()
  db.run(`CREATE TABLE vocabulary (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL, word_lower TEXT NOT NULL UNIQUE,
    phonetic TEXT NOT NULL DEFAULT '', pos TEXT NOT NULL DEFAULT '', brief TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', context_sentence TEXT NOT NULL DEFAULT '', fail_reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1, sources TEXT NOT NULL DEFAULT '[]'); PRAGMA user_version=3;`)
  const words = ['bridge','kernel','insight','resilience','notion','sustain','reveal','ponder','subtle','venture','see','saw','failed','empty']
  for (const word of words) db.run(`INSERT INTO vocabulary (word,word_lower,phonetic,pos,brief,detail,note,status,context_sentence,count,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [word,word,'/synthetic/','n.',word === 'empty' ? '' : `SECRET_${word}：测试释义`,
    '### 用法\n回忆后查看完整学习材料。\n' + '较长的解释与例句。'.repeat(80),'个人记忆方法',word === 'failed' ? 'failed' : 'ready','Synthetic source context.',4,1700000000000,1700000001000])
  fs.writeFileSync(path.join(profile, 'my-translate.db'), db.export()); db.close()
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ ui: { theme: 'light' } }))
  require(path.join(repo, 'out/main/index.js'))
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return win && !win.webContents.isLoading() }, 'window')
  await until(() => evaluate(() => !!document.querySelector('#source-text')), 'renderer')
  win.setPosition(20,20); win.setSize(340,420)
  await click('生词本')
  await until(() => evaluate(() => !!document.querySelector('[aria-label="搜索生词"]')), 'vocab')
  const original = await evaluate(() => window.api.listVocab({ sortBy: 'alpha' }))
  await evaluate(() => {
    const el = document.querySelector('[aria-label="搜索生词"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, 'bridge')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('开始自测')
  await until(() => evaluate(() => document.body.textContent.includes('可自测 12 个')), 'eligible counts')
  await snapshot('review-setup-light-340')
  await select('自测范围', '当前搜索结果')
  await until(() => evaluate(() => document.body.textContent.includes('可自测 1 个')), 'filtered count')
  await click('开始本轮')
  await until(questionId, 'single question')
  let active = (await evaluate(() => window.api.reviewOverview())).active
  assert.equal(active.total, 1); assert.equal(active.question.word, 'bridge')
  assert.equal(active.answer, null); assert.ok(!JSON.stringify(active).includes('SECRET'))
  assert.equal(await evaluate(() => document.body.textContent.includes('SECRET')), false)
  assert.equal(await evaluate(() => !!document.querySelector('[data-review-rating]')), false)
  await snapshot('review-front-light-340')
  await reveal(); await snapshot('review-answer-light-340')
  await rate(1)
  await until(() => evaluate(() => !!document.querySelector('[aria-label="自测总结"]')), 'summary')
  let single = await evaluate(id => window.api.getReview(id), active.id)
  assert.equal(single.summary.deferred, 1); assert.equal(single.summary.firstRatings[1], 1)
  await click('撤销上一题'); await until(questionId, 'undo restores')
  assert.ok(await evaluate(() => !!document.querySelector('[aria-label="自测答案"]')))
  await rate(3)
  single = await evaluate(id => window.api.getReview(id), active.id)
  assert.equal(single.summary.firstRatings[1], 0); assert.equal(single.summary.firstRatings[3], 1)
  report.checks.push('offline eligible filtering; search scope; front has no answer/ratings; Space/1-4; single-word deferral; undo restores memory and statistics')
  await click('再来一轮'); await settled()
  await until(() => evaluate(() => document.body.textContent.includes('没有到期词或未测词')), 'no due')
  await select('自测抽词方式', '全库随机')
  assert.ok(await evaluate(() => ![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '开始本轮').disabled))
  await select('自测范围', '全部词库'); await select('自测抽词方式', '智能随机')
  await click('开始本轮'); await until(questionId, 'ten question session')
  active = (await evaluate(() => window.api.reviewOverview())).active
  assert.equal(active.total, 10)
  const firstId = active.question.id
  await click('设置'); await click('生词本')
  await until(questionId, 'menu resume'); assert.equal(await questionId(), firstId)
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload() })
  await until(() => evaluate(() => !!document.querySelector('#source-text')), 'reload')
  await click('生词本'); await click('开始自测')
  await until(() => evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent === '继续上次自测')), 'resume offered')
  await click('继续上次自测'); await until(questionId, 'resumed')
  assert.equal(await questionId(), firstId)
  assert.equal(await evaluate(() => document.body.textContent.includes('SECRET')), false)
  report.checks.push('random mode permits early practice; ten unique base words; menu and renderer restart restore same question')
  await reveal()
  active = await evaluate(id => window.api.getReview(id), active.id)
  const firstEntryId = active.question.entryId
  const command = { sessionId: active.id, questionId: active.question.id, revision: active.revision }
  const [once, replay] = await evaluate(command => Promise.all([window.api.rateReview(command, 3), window.api.rateReview(command, 3)]), command)
  assert.equal(once.processed, 1); assert.equal(replay.processed, 1); assert.equal(once.question.id, replay.question.id)
  await evaluate(() => window.dispatchEvent(new Event('focus')))
  await until(async () => await questionId() === once.question.id, 'UI synced after IPC duplicate')
  await click('撤销上一题'); await until(async () => await questionId() === firstId, 'undo first')
  await evaluate(() => { const b = document.querySelector('[data-review-rating="3"]'); b.click(); b.click() })
  await until(async () => await questionId() !== firstId, 'double click settles')
  active = await evaluate(id => window.api.getReview(id), active.id)
  assert.equal(active.processed, 1)
  const base = new Set([command.questionId])
  const baseEntries = new Set([firstEntryId])
  let skipped = false, forgotten = false
  for (let i = 0; i < 35; i++) {
    active = await evaluate(id => window.api.getReview(id), active.id)
    if (active.status !== 'active') break
    const q = active.question
    if (!q.repeat) { assert.ok(!base.has(q.id)); assert.ok(!baseEntries.has(q.entryId)); base.add(q.id); baseEntries.add(q.entryId) }
    if (!skipped) {
      const old = await questionId(); await click('跳过'); await until(async () => await questionId() !== old, 'skipped'); skipped = true
    } else {
      await reveal()
      await rate(!forgotten && !q.repeat ? 1 : 3)
      if (!forgotten && !q.repeat) forgotten = true
    }
  }
  active = await evaluate(id => window.api.getReview(id), active.id)
  assert.equal(active.status, 'completed'); assert.equal(base.size, 10); assert.equal(baseEntries.size, 10)
  assert.equal(active.summary.firstRated, 9); assert.equal(active.summary.skipped, 1)
  assert.equal(active.summary.firstRatings[1], 1); assert.equal(active.summary.firstRatings[3], 8)
  assert.ok(active.summary.extraAnswered <= 2)
  assert.deepEqual(await evaluate(() => window.api.listVocab({ sortBy: 'alpha' })), original)
  await snapshot('review-summary-light-340')
  report.checks.push('IPC and UI duplicate grading idempotent; skip excluded from first recall score; bounded re-learning; original vocabulary unchanged')
  await click('再来一轮'); await settled(); await select('自测抽词方式', '全库随机')
  await select('本轮词数', '5 个词')
  await click('开始本轮'); await until(questionId, 'random session')
  active = (await evaluate(() => window.api.reviewOverview())).active
  assert.equal(active.config.mode, 'random')
  await evaluate(() => document.querySelector('button[title="切换深浅色"]').click())
  win.setSize(900,650); await snapshot('review-front-dark-900')
  await reveal(); await snapshot('review-answer-dark-900')
  await evaluate(() => { document.querySelector('details').open = true })
  await snapshot('review-details-dark-900')
  win.setSize(340,420); await snapshot('review-details-dark-340')
  const removedId = active.question.entryId, removedQuestion = active.question.id
  await evaluate(id => window.api.deleteVocab(id), removedId)
  await until(async () => await questionId() !== removedQuestion, 'delete skips current')
  active = await evaluate(id => window.api.getReview(id), active.id)
  assert.equal(active.summary.unavailable, 1); assert.equal(active.canUndo, false)
  await click('结束本轮'); await until(() => evaluate(() => !!document.querySelector('[aria-label="自测总结"]')), 'early end')
  active = await evaluate(id => window.api.getReview(id), active.id)
  assert.equal(active.status, 'ended'); assert.equal(active.summary.firstRated, 0)
  await snapshot('review-ended-dark-340')
  await sleep(1100)
  const disk = new SQL.Database(fs.readFileSync(path.join(profile, 'my-translate.db')))
  assert.equal(disk.exec('PRAGMA user_version')[0].values[0][0], 5)
  assert.equal(disk.exec('PRAGMA integrity_check')[0].values[0][0], 'ok')
  assert.ok(disk.exec('SELECT count(*) FROM review_cards')[0].values[0][0] > 0)
  assert.equal(disk.exec('SELECT count(*) FROM review_cards WHERE entry_id=' + removedId)[0].values[0][0], 0)
  assert.equal(disk.exec('SELECT count(*) FROM review_events WHERE entry_id=' + removedId)[0].values[0][0], 0)
  assert.equal(disk.exec('SELECT MIN(count),MAX(count) FROM vocabulary')[0].values[0].join(','), '4,4')
  disk.close()
  report.checks.push('dark/narrow/wide/expanded layouts; delete prunes current and undo; early exit no failure rating; v5 FSRS/session persistence independent of vocabulary count')
}
let finished = false
const watchdog = setTimeout(() => { report.failures.push('watchdog timeout'); finish() }, 140000)
function finish() {
  if (finished) return; finished = true; clearTimeout(watchdog)
  fs.writeFileSync(path.join(profile, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  app.once('quit', () => process.exit(report.failures.length ? 1 : 0)); app.quit()
}
main().catch(error => report.failures.push(error.stack)).finally(finish)
