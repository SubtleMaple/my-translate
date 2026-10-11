import { strict as assert } from 'node:assert'
import { before, beforeEach, after, test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDatabase, getDb } from '../src/main/db/database'
import { flushDatabase } from '../src/main/db/persist'
import { addNormalizedVocab, listVocab } from '../src/main/db/vocabRepo'
import { getReviewEvidence, reviewTransaction, saveReviewEvent, saveReviewMemory } from '../src/main/db/reviewRepo'
import { learningSummary, getVocabViewEntry, queryVocabView } from '../src/main/services/vocabViewService'
import { scheduleReview } from '../src/main/services/reviewScheduler'
import { createReviewService } from '../src/main/services/reviewService'
import { cloudFontSize, compareVocabView } from '../src/shared/learning'
import type { ReviewSessionView, VocabViewEntry } from '../src/shared/types'

const DAY = 86400000, now = Date.UTC(2026,9,11,12)
const evidence = { reviews: 2, forgotten: 0, successes: 2, firstSuccessAt: now - 2 * DAY, lastSuccessAt: now }
function memory(stability = 45, lastReview = now) {
  const m = scheduleReview(null, 4, lastReview).memory
  m.card.stability = stability; m.card.reps = 2; m.card.due = lastReview + stability * DAY
  return m
}
function seed(word: string, m?: ReturnType<typeof memory>, records: { rating: 1 | 2 | 3 | 4 | null; at: number; reverted?: boolean }[] = []) {
  const id = addNormalizedVocab([{ word, original: word, context: 'test context', explanation: '' }], { status: 'ready', brief: '释义', detail: '详情' }).addedIds[0]
  reviewTransaction(() => {
    if (m) saveReviewMemory(id, m)
    records.forEach((r, index) => {
      const eventId = `${id}:${index}`
      saveReviewEvent({ id: eventId, sessionId: 'seed', questionId: eventId, entryId: id, commandRevision: index, rating: r.rating, at: r.at, before: null, after: m || null })
      if (r.reverted) getDb().run('UPDATE review_events SET reverted=1 WHERE id=?', [eventId])
    })
  })
  return id
}
const crossDay = [{ rating: 3 as const, at: now - 2 * DAY }, { rating: 4 as const, at: now }]
before(async () => {
  process.env.MY_TRANSLATE_TEST_PROFILE = mkdtempSync(join(tmpdir(), 'opencode', 'learning-view-'))
  await initDatabase()
})
beforeEach(() => getDb().run('DELETE FROM review_events; DELETE FROM review_cards; DELETE FROM review_sessions; DELETE FROM vocabulary;'))
after(() => flushDatabase(true))

test('熟悉度与即时回忆率分离；一次很熟/短时反复很熟不能升为稳固', () => {
  assert.equal(learningSummary(null, undefined, now).risk, null)
  const single = learningSummary(memory(80), { ...evidence, reviews: 1, successes: 1, firstSuccessAt: now }, now)
  assert.equal(single.stage, 'learning'); assert.equal(single.limitedEvidence, true)
  assert.equal(single.recall, 1)
  assert.equal(learningSummary(memory(80), { ...evidence, reviews: 100, successes: 100, firstSuccessAt: now - 1000 }, now).stage, 'learning')
  const stable = learningSummary(memory(30), evidence, now)
  assert.equal(stable.stage, 'stable'); assert.equal(stable.limitedEvidence, false)
  assert.equal(learningSummary(memory(29.99), evidence, now).stage, 'developing')
  const forgotten = scheduleReview(memory(30), 1, now).memory
  const fragile = learningSummary(forgotten, evidence, now)
  assert.equal(fragile.stage, 'fragile'); assert.equal(fragile.recall, 1)
})

test('风险随时间衰减，长期阶段不按时间伪变；时钟回拨/缺失/异常不显示假百分比', () => {
  const m = memory()
  const saved = structuredClone(m)
  const first = learningSummary(m, evidence, now), later = learningSummary(m, evidence, now + 60 * DAY)
  assert.ok(later.risk! > first.risk!); assert.equal(later.stage, first.stage); assert.equal(later.due, true)
  assert.equal(learningSummary(m, evidence, now - 1).risk, null)
  assert.deepEqual(m, saved)
  assert.equal(learningSummary({ ...m, card: { ...m.card, stability: NaN } }, evidence, now).unavailable, true)
})

test('批量学习查询：六种排序、未知置后、分组计数、搜索/状态筛选、原始导出字段不污染', () => {
  seed('z-unseen')
  seed('stable', memory(45, now - 5 * DAY), crossDay.map(r => ({ ...r, at: r.at - 5 * DAY })))
  seed('developing', memory(8), crossDay)
  seed('learning', memory(45), [{ rating: 4, at: now }])
  seed('fragile', scheduleReview(null, 1, now).memory, [{ rating: 1, at: now }])
  const before = listVocab({ sortBy: 'alpha' })
  const asc = queryVocabView({ sortBy: 'unfamiliar' }, now)
  assert.deepEqual(asc.entries.map(e => e.learning.stage), ['fragile','learning','developing','stable','unseen'])
  assert.deepEqual(queryVocabView({ sortBy: 'familiar' }, now).entries.map(e => e.learning.stage), ['stable','developing','learning','fragile','unseen'])
  const risk = queryVocabView({ sortBy: 'risk' }, now)
  assert.equal(risk.entries[0].word, 'stable'); assert.equal(risk.entries.at(-1)!.word, 'z-unseen')
  for (const sortBy of ['time','alpha','count'] as const) assert.equal(queryVocabView({ sortBy }, now).entries.length, 5)
  assert.equal(asc.evaluatedAt, now)
  assert.deepEqual(asc.stageCounts, { unseen: 1, fragile: 1, learning: 1, developing: 1, stable: 1 })
  assert.equal(queryVocabView({ search: 'stable', learningFilter: 'stable' }, now).entries.length, 1)
  const empty = queryVocabView({ search: 'stable', learningFilter: 'unseen' }, now)
  assert.equal(empty.entries.length, 0); assert.equal(empty.matchedCount, 1)
  assert.deepEqual(listVocab({ sortBy: 'alpha' }), before)
  assert.ok(!('learning' in before[0]))
  assert.throws(() => queryVocabView({ learningFilter: 'bad' as any }, now))
})

test('跨日依据排除跳过和撤销；评分通知提交后发出，重复提交不重复发出；撤销回未测', () => {
  const old = seed('evidence', memory(), [{ rating: 4, at: now - 2 * DAY, reverted: true }, { rating: null, at: now - DAY }, { rating: 4, at: now }])
  assert.equal(getReviewEvidence().get(old)!.reviews, 1)
  assert.equal(getVocabViewEntry(old, now).entry!.learning.stage, 'learning')
  const id = seed('target')
  let notifications = 0
  const service = createReviewService(() => now, () => 9, () => {
    notifications++
    assert.ok(getVocabViewEntry(id, now).entry)
  })
  const cmd = (s: ReviewSessionView) => ({ sessionId: s.id, questionId: s.question!.id, revision: s.revision })
  let session = service.start({ mode: 'smart', size: 1, search: 'target' })
  session = service.reveal(cmd(session)); assert.equal(notifications, 0)
  const command = cmd(session)
  session = service.rate(command, 1)
  assert.equal(notifications, 1); assert.equal(getVocabViewEntry(id, now).entry!.learning.stage, 'fragile')
  service.rate(command, 1); assert.equal(notifications, 1)
  service.undo(session.id, session.revision)
  assert.equal(notifications, 2); assert.equal(getVocabViewEntry(id, now).entry!.learning.stage, 'unseen')
})

test('字号有界、不同指标可切换、未知采用中性值、相等排序保持稳定', () => {
  const id = seed('test', memory(), crossDay)
  const entry = getVocabViewEntry(id, now).entry!
  const forgotten = { ...entry, learning: learningSummary(scheduleReview(null,1,now).memory, undefined, now) }
  assert.ok(cloudFontSize(forgotten, 'weakness') > cloudFontSize(entry, 'weakness'))
  assert.ok(cloudFontSize(forgotten, 'familiarity') < cloudFontSize(entry, 'familiarity'))
  assert.ok(cloudFontSize({ ...entry, count: 50000 }, 'count') <= 38)
  const unseen = { ...entry, learning: learningSummary(null, undefined, now) }
  assert.equal(cloudFontSize(unseen, 'weakness'), 18)
  assert.equal(cloudFontSize(unseen, 'familiarity'), 18)
  const a: VocabViewEntry = { ...entry, id: 10, word: 'alpha' }, b = { ...entry, id: 11, word: 'beta' }
  assert.ok(compareVocabView(a, b, 'familiar') < 0)
})
