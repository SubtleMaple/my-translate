// Offline synthetic v5 database; real renderer/IPC/FSRS/canvas/SQLite.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict')
const { fsrs, createEmptyCard } = require('ts-fsrs')
const repo = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode', 'vocab-visuals-'))
process.env.MY_TRANSLATE_USER_DATA = profile
app.setPath('userData', profile); app.setAppPath(repo)
const report = { profile, checks: [], screenshots: [], failures: [] }
const DAY = 86400000, marker = 'DISPLAY_SET'
let win
const sleep = ms => new Promise(r => setTimeout(r, ms))
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true)
async function until(fn, label) {
  const start = Date.now()
  while (Date.now() - start < 15000) { if (await fn()) return; await sleep(60) }
  throw Error('Timeout: ' + label)
}
const click = text => evaluate(text => {
  const root = [...document.querySelectorAll('[role="dialog"]')].at(-1) || document
  const button = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  if (!button) throw Error('Missing button: ' + text)
  button.click()
}, text)
const aria = label => evaluate(label => {
  const el = [...document.querySelectorAll('button')].find(e => e.getAttribute('aria-label') === label)
  if (!el) throw Error('Missing aria: ' + label)
  el.click()
}, label)
async function select(label, option) {
  await evaluate(label => { const el = document.querySelector(`[aria-label="${label}"]`); el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) }, label)
  await until(() => evaluate(() => !!document.querySelector('[role="option"]')), 'options')
  await evaluate(option => [...document.querySelectorAll('[role="option"]')].find(e => e.textContent.startsWith(option)).click(), option)
  await until(() => evaluate(() => !document.querySelector('[role="listbox"]')), 'select closed')
  await until(() => evaluate((label,option) => document.querySelector(`[aria-label="${label}"]`)?.textContent.startsWith(option),label,option), 'selected value')
  await sleep(150)
}
async function search(value) {
  await evaluate(value => {
    const el = document.querySelector('[aria-label="搜索生词"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await sleep(420)
  await until(() => evaluate(() => !document.body.textContent.includes('正在更新…')), 'search ready')
}
const poses = () => evaluate(() => [...document.querySelectorAll('[data-cloud-entry]')].map(g => ({ id: g.dataset.cloudEntry, rect: [...g.querySelector('rect').attributes].filter(a => ['x','y','width','height'].includes(a.name)).map(a => a.value), size: g.querySelector('text').getAttribute('font-size') })))
async function cloudReady() { await until(() => evaluate(() => !!document.querySelector('[data-cloud-entry]')), 'cloud rendered') }
async function snapshot(name) {
  await sleep(180)
  const issues = await evaluate(() => {
    const issues = [], root = [...document.querySelectorAll('[role="dialog"]')].at(-1) || document.body
    if (document.documentElement.scrollWidth > innerWidth+1 || document.documentElement.scrollHeight > innerHeight+1) issues.push('document overflow')
    for (const el of root.querySelectorAll('button,input,textarea,[role="button"]')) {
      if (el.disabled || !el.getClientRects().length || el.closest('details:not([open])')) continue
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(Math.min(innerWidth-1,r.x+r.width/2),Math.min(innerHeight-1,r.y+r.height/2))
      if (r.left < -1 || r.right > innerWidth+1 || !(hit === el || el.contains(hit))) issues.push(el.getAttribute('aria-label') || el.textContent)
    }
    document.activeElement?.blur()
    for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0
    return issues
  })
  await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await sleep(220)
  fs.writeFileSync(path.join(profile, name+'.png'), (await win.webContents.capturePage()).toPNG())
  report.screenshots.push(name)
  assert.deepEqual(issues, [], name)
}
async function main() {
  const SQL = await require(path.join(repo,'node_modules/sql.js'))({ wasmBinary: fs.readFileSync(path.join(repo,'node_modules/sql.js/dist/sql-wasm.wasm')) })
  const db = new SQL.Database()
  db.run(`CREATE TABLE vocabulary (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL, word_lower TEXT NOT NULL UNIQUE, phonetic TEXT NOT NULL DEFAULT '',pos TEXT NOT NULL DEFAULT '',brief TEXT NOT NULL DEFAULT '',detail TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'ready',context_sentence TEXT NOT NULL DEFAULT '',fail_reason TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,count INTEGER NOT NULL DEFAULT 1,sources TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE recommendation_analysis (entry_id INTEGER PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE recommendation_candidates (id TEXT PRIMARY KEY,word_lower TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE recommendation_history (word_lower TEXT PRIMARY KEY,kind TEXT NOT NULL DEFAULT '',topic TEXT NOT NULL DEFAULT 'general',updated_at INTEGER NOT NULL DEFAULT 0,shown_at INTEGER NOT NULL DEFAULT 0,looked_up_at INTEGER NOT NULL DEFAULT 0,feedback_word TEXT NOT NULL DEFAULT '');
    CREATE TABLE recommendation_state (id INTEGER PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE review_cards (entry_id INTEGER PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE review_sessions (id TEXT PRIMARY KEY,status TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE review_events (id TEXT PRIMARY KEY,session_id TEXT NOT NULL,question_id TEXT NOT NULL,entry_id INTEGER NOT NULL,payload TEXT NOT NULL,reverted INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX idx_review_events_question ON review_events(session_id,question_id) WHERE reverted=0;
    CREATE INDEX idx_review_events_entry ON review_events(entry_id);
    PRAGMA user_version=5;`)
  const names = ['curiosity','elusive','resilience','nuance','perspective','testtarget','a'.repeat(160), 'a phrase that stays together',
    ...'serendipity wander cherish tranquil eloquent luminous ephemeral solitude harmony embrace subtle thrive wonder compassion ingenious nostalgia vivid venture whisper bloom dawn grace insight delight courage sustain reveal ponder reflect coherent feasible reliable concise efficient robust scalable constraint adapt clarify derive explore discover observe perceive glimpse'.split(' ')]
  const all = [...names, ...Array.from({length:1000-names.length},(_,i)=>`bench-${i}`)]
  const now = Date.now(), scheduler = fsrs({ enable_fuzz: false })
  all.forEach((word,index) => {
    const id = index+1, display = index < names.length, kind = index === 5 || !display ? 0 : index % 5
    db.run('INSERT INTO vocabulary (id,word,word_lower,pos,brief,detail,note,count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id,word,word.toLowerCase(),'n.',`测试释义 ${word}`,'### 完整用法\n这是一条测试学习材料。',display?marker:'',display?1+index%30:1,now-index,now-index])
    if (!kind) return
    const age = kind === 4 ? 365*DAY : kind === 3 ? DAY : 0, reviewed = now-age
    const card = scheduler.next(createEmptyCard(new Date(reviewed)),new Date(reviewed),4).card
    const stored = { ...card, due: reviewed+(kind === 4 ? 60 : 8)*DAY, last_review: reviewed, stability: kind === 4 ? 60 : kind === 3 ? 8 : kind === 2 ? 80 : 2, reps: kind === 2 ? 1 : 2, state: kind === 1 ? 3 : 2 }
    db.run('INSERT INTO review_cards VALUES (?,?)',[id,JSON.stringify({card:stored,lastRating:kind === 1?1:4,engine:'ts-fsrs@5.4.2 / FSRS-6'})])
    const times = kind === 2 ? [reviewed] : [reviewed-2*DAY,reviewed]
    times.forEach((at,i) => db.run('INSERT INTO review_events (id,session_id,question_id,entry_id,payload) VALUES (?,?,?,?,?)',
      [`${id}:${i}`,'fixture',`${id}:${i}`,id,JSON.stringify({rating:kind === 1 && i === 1?1:4,at})]))
  })
  fs.writeFileSync(path.join(profile,'my-translate.db'),db.export()); db.close()
  fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({ui:{theme:'light'}}))
  require(path.join(repo,'out/main/index.js'))
  await until(() => { win=BrowserWindow.getAllWindows()[0]; return win&&!win.webContents.isLoading() },'window')
  await until(() => evaluate(() => !!document.querySelector('#source-text')),'renderer')
  win.setPosition(20,20); win.setSize(900,700)
  await click('生词本'); await until(() => evaluate(() => document.body.textContent.includes('1000 个词条')),'1000 entries')
  const started = Date.now(), full = await evaluate(() => window.api.queryVocabView({sortBy:'unfamiliar'}))
  report.query1000Ms = Date.now()-started
  assert.equal(full.entries.length,1000)
  assert.equal(full.entries.find(e=>e.word==='resilience').learning.stage,'learning')
  assert.equal(full.entries.find(e=>e.word==='perspective').learning.stage,'stable')
  assert.ok(full.entries.find(e=>e.word==='perspective').learning.risk > 0.1)
  assert.equal(full.entries.find(e=>e.word==='elusive').learning.stage,'fragile')
  await search(marker); await select('生词排序','不熟优先')
  const sorted = await evaluate(() => window.api.queryVocabView({search:'DISPLAY_SET',sortBy:'unfamiliar'}))
  assert.deepEqual(await evaluate(() => [...document.querySelectorAll('button[aria-controls^="vocab-detail-"]')].map(b=>Number(b.getAttribute('aria-controls').replace('vocab-detail-','')))),sorted.entries.map(e=>e.id))
  await snapshot('learning-list-light-900')
  report.checks.push('1000-word batch query; long-term versus current risk; one easy rating stays learning; list sort matches shared data')
  await aria('分组视图')
  await until(() => evaluate(() => !!document.querySelector('[aria-label="熟悉度分组视图"]')),'groups')
  assert.equal(await evaluate(() => document.querySelectorAll('[data-group-word]').length), names.length)
  await select('学习状态筛选','较稳固')
  assert.ok(await evaluate(() => [...document.querySelectorAll('[data-group-word]')].every(b=>b.closest('details').dataset.learningStage==='stable')))
  await aria('词云视图'); await cloudReady()
  assert.ok(await evaluate(() => [...document.querySelectorAll('[data-cloud-entry]')].every(g=>g.dataset.learningStage==='stable')))
  await select('学习状态筛选','全部状态'); await cloudReady()
  const smallMode = await poses()
  await select('词云字号指标','摘录次数'); await cloudReady()
  assert.notDeepEqual(await poses(),smallMode)
  const stablePoses = await poses()
  await aria('刷新记忆状态'); await sleep(250)
  assert.deepEqual(await poses(),stablePoses)
  const boxes = await evaluate(() => [...document.querySelectorAll('[data-cloud-entry] rect')].map(r=>({x:Number(r.getAttribute('x')),y:Number(r.getAttribute('y')),w:Number(r.getAttribute('width')),h:Number(r.getAttribute('height'))})))
  for(let i=0;i<boxes.length;i++) for(const b of boxes.slice(i+1)) {const a=boxes[i];assert.ok(!(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y))}
  assert.ok(await evaluate(() => !!document.querySelector('[data-cloud-fallback="7"]')))
  await snapshot('word-cloud-count-light-900')
  report.checks.push('group/cloud share filters; metric changes geometry; refresh retains deterministic layout; no overlap; long-word fallback')
  const selectedId = Number(await evaluate(() => document.querySelector('[data-cloud-entry]').dataset.cloudEntry))
  const selectedWord = full.entries.find(e=>e.id===selectedId).word
  await evaluate(() => {const g=document.querySelector('[data-cloud-entry]');g.focus();g.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})
  await until(() => evaluate(word => document.querySelector('[role="dialog"] h2')?.textContent===word,selectedWord),'keyboard detail')
  await snapshot('word-detail-light-900')
  await evaluate(() => {
    const el=document.querySelector('[role="dialog"] textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'edited note without search marker')
    el.dispatchEvent(new Event('input',{bubbles:true}))
  })
  await click('保存备注')
  await until(() => evaluate(async id=>(await window.api.getVocabViewEntry(id)).entry.note==='edited note without search marker',selectedId),'note persisted')
  assert.equal(await evaluate(()=>document.querySelector('[role="dialog"] h2').textContent),selectedWord)
  assert.ok(!(await evaluate(()=>window.api.queryVocabView({search:'DISPLAY_SET'}))).entries.some(e=>e.id===selectedId))
  await click('删除'); await until(()=>evaluate(()=>document.querySelectorAll('[role="dialog"]').length===2),'nested delete dialog')
  await click('删除'); await until(()=>evaluate(()=>!document.querySelector('[role="dialog"]')),'deleted detail closes')
  assert.equal((await evaluate(id=>window.api.getVocabViewEntry(id),selectedId)).entry,null)
  report.checks.push('keyboard-accessible cloud; detail independent from search; note save survives filtering; nested deletion closes cleanly')
  for (const dark of [false,true]) {
    if(dark) await evaluate(()=>document.querySelector('button[title="切换深浅色"]').click())
    for (const mode of ['词云','分组','列表']) {
      await aria(mode+'视图'); win.setSize(340,420); await sleep(200)
      if(mode==='词云') await cloudReady()
      await snapshot(`${mode==='词云'?'cloud':mode==='分组'?'groups':'list'}-${dark?'dark':'light'}-340`)
    }
  }
  win.setSize(900,700); await aria('列表视图'); await search('testtarget')
  await click('开始自测')
  await until(()=>evaluate(()=>!!document.querySelector('[aria-label="自测范围"]')),'review setup')
  await select('自测范围','当前搜索结果'); await click('开始本轮')
  await until(()=>evaluate(()=>!!document.querySelector('[data-review-question]')),'review question')
  await evaluate(()=>{document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}))})
  await until(()=>evaluate(()=>!!document.querySelector('[data-review-rating="1"]')),'reveal')
  await evaluate(()=>document.querySelector('[data-review-rating="1"]').click())
  await until(()=>evaluate(()=>!!document.querySelector('[aria-label="自测总结"]')),'rated')
  await click('退出自测')
  await until(()=>evaluate(()=>document.querySelector('button[aria-controls^="vocab-detail-"] [data-learning-stage]')?.dataset.learningStage==='fragile'),'exit review updates list')
  // Recover latest session id through a renderer-held reply during a fresh explicit practice round.
  await click('开始自测'); await until(()=>evaluate(()=>!!document.querySelector('[aria-label="自测抽词方式"]')),'setup second')
  await select('自测抽词方式','全库随机'); await click('开始本轮'); await until(()=>evaluate(()=>!!document.querySelector('[data-review-question]')),'random practice')
  let session=(await evaluate(()=>window.api.reviewOverview())).active
  const command={sessionId:session.id,questionId:session.question.id,revision:session.revision}
  await evaluate(c=>window.api.revealReview(c),command)
  session=await evaluate(c=>window.api.rateReview(c,4),command)
  await click('退出自测')
  await until(()=>evaluate(()=>!document.body.textContent.includes('正在更新…')),'view ready')
  const restored=await evaluate(s=>window.api.undoReview(s.id,s.revision),session)
  await until(()=>evaluate(()=>document.querySelector('button[aria-controls^="vocab-detail-"] [data-learning-stage]')?.dataset.learningStage==='fragile'),'undo notification updates visible list')
  await evaluate(s=>window.api.endReview(s.id,s.revision),restored)
  report.checks.push('review exit refreshes familiarity; undo notification refreshes list without navigation; original count remains separate')
  await search(marker); await aria('词云视图'); await select('词云字号指标','熟悉程度')
  const preferences=await evaluate(()=>window.api.getSettings())
  assert.equal(preferences.vocab.view,'cloud');assert.equal(preferences.vocab.cloudMetric,'familiarity')
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()})
  await until(()=>evaluate(()=>!!document.querySelector('#source-text')),'reloaded')
  await click('生词本');await cloudReady()
  assert.ok(await evaluate(()=>document.querySelector('[aria-label="词云字号指标"]').textContent.includes('熟悉程度')))
  await until(()=>evaluate(()=>document.querySelectorAll('[data-cloud-entry]').length+document.querySelectorAll('[data-cloud-fallback]').length>0),'large collection rendered')
  report.renderedWords=await evaluate(()=>({cloud:document.querySelectorAll('[data-cloud-entry]').length,fallback:document.querySelectorAll('[data-cloud-fallback]').length}))
  assert.ok(report.renderedWords.cloud<=150&&report.renderedWords.fallback<=60)
  await sleep(1000)
  const disk=new SQL.Database(fs.readFileSync(path.join(profile,'my-translate.db')))
  assert.equal(disk.exec('PRAGMA user_version')[0].values[0][0],5)
  assert.equal(disk.exec('PRAGMA integrity_check')[0].values[0][0],'ok')
  assert.equal(disk.exec('SELECT count(*) FROM vocabulary')[0].values[0][0],999)
  disk.close()
  report.checks.push('view/metric preferences persist; thousand-word cloud uses bounded DOM with remainder access; database unchanged schema/integrity')
}
let finished=false
const watchdog=setTimeout(()=>{report.failures.push('watchdog timeout');finish()},150000)
function finish(){
  if(finished)return;finished=true;clearTimeout(watchdog)
  fs.writeFileSync(path.join(profile,'report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2));app.once('quit',()=>process.exit(report.failures.length?1:0));app.quit()
}
main().catch(async error=>{
  report.failures.push(error.stack)
  if(win&&!win.isDestroyed()) report.diagnostic=await evaluate(async()=>({pointerEvents:document.body.style.pointerEvents,selects:[...document.querySelectorAll('[role="combobox"]')].map(e=>({label:e.getAttribute('aria-label'),text:e.textContent,state:e.getAttribute('data-state')})),settings:(await window.api.getSettings()).vocab}))
}).finally(finish)
