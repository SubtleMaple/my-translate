import { strict as assert } from 'node:assert'
import { before, beforeEach, after, test } from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDatabase, getDb, dbPath } from '../src/main/db/database'
import { addNormalizedVocab, deleteVocab, getVocabById, listVocab, updateVocabDetail } from '../src/main/db/vocabRepo'
import { getReviewMemory, getReviewSession } from '../src/main/db/reviewRepo'
import { flushDatabase } from '../src/main/db/persist'
import { createReviewService } from '../src/main/services/reviewService'
import { previewReview, REVIEW_PARAMETERS, scheduleReview } from '../src/main/services/reviewScheduler'
import { reviewWeight, seededRandom, selectReviewCandidates, weightedSample, type ReviewCandidate } from '../src/shared/reviewSelection'
import type { ReviewCommand, ReviewSessionView } from '../src/shared/types'

const DAY = 86400000
let now = Date.UTC(2026, 9, 10, 12)
const service = createReviewService(() => now, () => 427)
const command = (s: ReviewSessionView): ReviewCommand => ({ sessionId: s.id, questionId: s.question!.id, revision: s.revision })
function seed(size: number) {
  for (let i = 0; i < size; i++) addNormalizedVocab([{ original: `word${i}`, word: `word${i}`, context: `source ${i}`, explanation: '' }],
    { status: 'ready', brief: `释义SECRET_${i}`, detail: `完整解释_${i}`, pos: 'n.' })
}
before(async () => {
  process.env.MY_TRANSLATE_TEST_PROFILE = mkdtempSync(join(tmpdir(), 'opencode', 'review-'))
  await initDatabase()
})
beforeEach(() => {
  getDb().run('DELETE FROM review_events; DELETE FROM review_cards; DELETE FROM review_sessions; DELETE FROM vocabulary;')
  now = Date.UTC(2026, 9, 10, 12)
})
after(() => flushDatabase(true))

test('带权抽样仿真：固定seed复现、1:4权重频率、去重、80/20与最早到期保底', () => {
  const random = seededRandom(918), frequencies = [0, 0]
  for (let i = 0; i < 20000; i++) frequencies[weightedSample([0, 1], 1, n => n ? 4 : 1, random)[0]]++
  assert.ok(frequencies[1] / 20000 > 0.78 && frequencies[1] / 20000 < 0.82)
  const candidates: ReviewCandidate[] = Array.from({ length: 50 }, (_, i) => ({ id: i, fresh: i >= 20 && i < 40, dueAt: i < 20 ? now - (i + 1) * 3600000 : now + DAY,
    intervalMs: DAY, recall: 0.5, lastForgotten: false, count: i + 1, createdAt: i }))
  const selected = selectReviewCandidates(candidates, 10, 'smart', now, seededRandom(9))
  assert.deepEqual(selected, selectReviewCandidates(candidates, 10, 'smart', now, seededRandom(9)))
  assert.equal(new Set(selected).size, 10)
  assert.equal(selected.filter(id => id < 20).length, 8)
  assert.equal(selected.filter(id => id >= 20).length, 2)
  assert.ok(selected.includes(19) && selected.includes(18), '最早到期20%保底')
  assert.ok(selected.includes(20), '最老未测词保底')
  assert.ok(!selected.some(id => id >= 40), '智能模式不凑未到期词')
  const future = candidates.slice(40)
  assert.deepEqual(selectReviewCandidates(future, 10, 'smart', now, seededRandom(1)), [])
  assert.equal(selectReviewCandidates([...future, ...future], 50, 'random', now, seededRandom(1)).length, 10)
  const backlog = candidates.map(c => ({ ...c, fresh: c.id >= 40, dueAt: now - DAY }))
  assert.ok(selectReviewCandidates(backlog, 10, 'smart', now, seededRandom(5)).every(id => id < 40))
  assert.ok(reviewWeight({ ...candidates[0], recall: 0, lastForgotten: true }, now) > reviewWeight({ ...candidates[0], recall: 0.99 }, now))
  assert.equal(weightedSample([1,2], 5, () => 0, () => 0).length, 2)
})

test('FSRS真实调度：四档间隔、长期遗忘回到重学、时钟回拨拒绝', () => {
  const parameters = JSON.stringify(REVIEW_PARAMETERS)
  const preview = previewReview(null, now)
  assert.equal(preview[1] - now, 60000)
  assert.ok(preview[1] < preview[2] && preview[2] < preview[3] && preview[3] < preview[4])
  const initial = scheduleReview(null, 4, now).memory
  assert.equal(initial.card.reps, 1)
  assert.equal(initial.card.last_review, now)
  const failure = scheduleReview(initial, 1, now + 30 * DAY).memory
  assert.equal(failure.card.due, now + 30 * DAY + 60000)
  assert.equal(failure.card.lapses, 1)
  assert.throws(() => scheduleReview(initial, 3, now - 1), /系统时间/)
  assert.equal(JSON.stringify(REVIEW_PARAMETERS), parameters)
})

test('揭晓前不传答案、评分幂等、撤销恢复记忆与队列；复习不改变原词条', () => {
  seed(5)
  const before = listVocab()
  let session = service.start({ mode: 'smart', size: 5 })
  assert.equal(session.answer, null); assert.equal(session.preview, null)
  assert.ok(!JSON.stringify(session).includes('SECRET'))
  assert.throws(() => service.rate(command(session), 3), /揭晓/)
  assert.throws(() => service.rate(command(session), null as any), /四档/)
  assert.throws(() => service.start({ mode: 'random', size: 5 }), /未完成/)
  const front = command(session), id = session.question!.entryId
  session = service.reveal(front)
  assert.ok(session.answer!.brief.includes('SECRET'))
  const rated = service.rate(command(session), 3)
  assert.equal(rated.processed, 1); assert.equal(getReviewMemory(id)!.card.reps, 1)
  const replay = service.rate(front, 3)
  assert.equal(replay.question!.id, rated.question!.id)
  assert.equal(getReviewMemory(id)!.card.reps, 1)
  assert.throws(() => service.rate(front, 1), /其他结果/)
  const restored = service.undo(rated.id, rated.revision)
  assert.equal(restored.question!.entryId, id); assert.ok(restored.answer)
  assert.equal(restored.processed, 0); assert.equal(getReviewMemory(id), null)
  assert.throws(() => service.rate(front, 3), /状态已变化/)
  session = service.rate(command(restored), 4)
  assert.equal(session.summary.firstRated, 1)
  assert.equal(getDb().exec('SELECT count(*) FROM review_events WHERE reverted=0')[0].values[0][0], 1)
  assert.deepEqual(listVocab(), before)
})

test('本轮加练：先隔三题且满一分钟、最多额外两次、首次统计不被加练抬高', () => {
  seed(10)
  let session = service.start({ mode: 'smart', size: 10 })
  const target = session.question!.entryId
  const seen = new Map<number, number>()
  for (let i = 0; i < 30 && session.status === 'active'; i++) {
    const question = session.question!
    seen.set(question.entryId, (seen.get(question.entryId) || 0) + 1)
    if (question.entryId === target && question.repeat) {
      assert.ok(i >= question.repeat * 4)
      assert.ok(now >= Date.UTC(2026, 9, 10, 12) + question.repeat * 80000)
    }
    session = service.reveal(command(session))
    session = service.rate(command(session), question.entryId === target ? 1 : 3)
    now += 20000
    session = service.get(session.id)
  }
  assert.equal(session.status, 'completed')
  assert.equal(seen.get(target), 3)
  assert.equal(session.summary.firstRated, 10)
  assert.equal(session.summary.firstRatings[1], 1)
  assert.equal(session.summary.firstRatings[3], 9)
  assert.equal(session.summary.extraAnswered, 2)
  assert.equal(getReviewMemory(target)!.card.reps, 3)
})

test('一词小库不立即重考；跳过不评分；下一轮到期后可再测；无到期可随机练习', () => {
  seed(1)
  let session = service.start({ mode: 'smart', size: 10 })
  const id = session.question!.entryId
  session = service.reveal(command(session)); session = service.rate(command(session), 1)
  assert.equal(session.status, 'completed'); assert.equal(session.summary.deferred, 1)
  assert.throws(() => service.start({ mode: 'smart', size: 10 }), /没有到期/)
  now += 60000
  session = service.start({ mode: 'smart', size: 10 })
  const before = getReviewMemory(id)
  const skipped = service.skip(command(session))
  assert.equal(skipped.summary.skipped, 1); assert.equal(skipped.summary.firstRated, 0)
  assert.deepEqual(getReviewMemory(id), before)
  session = service.undo(skipped.id, skipped.revision)
  session = service.reveal(command(session)); session = service.rate(command(session), 4)
  assert.equal(session.summary.skipped, 0)
  assert.equal(service.overview().due, 0)
  assert.equal(service.start({ mode: 'random', size: 10 }).question!.entryId, id)
})

test('过滤、删除与失败词跳过；不借撤销复活删除的词；结束不自动记错', () => {
  seed(5)
  const entries = listVocab()
  updateVocabDetail(entries[0].id, { status: 'failed' })
  updateVocabDetail(entries[1].id, { status: 'ready', brief: '' })
  assert.equal(service.overview().unavailable, 2)
  let session = service.start({ mode: 'smart', size: 20, search: 'word0' })
  assert.equal(session.total, 1)
  const id = session.question!.entryId
  session = service.reveal(command(session)); session = service.rate(command(session), 3)
  deleteVocab(id)
  assert.equal(getReviewMemory(id), null)
  assert.equal(getDb().exec('SELECT count(*) FROM review_events WHERE entry_id=' + id)[0].values[0][0], 0)
  assert.equal(service.get(session.id).canUndo, false)
  session = service.start({ mode: 'smart', size: 20 })
  const current = session.question!.entryId
  deleteVocab(current)
  session = service.get(session.id)
  assert.ok(!session.question || session.question.entryId !== current)
  assert.equal(session.summary.unavailable, 1)
  const ended = service.end(session.id, session.revision)
  assert.equal(ended.summary.firstRated, 0)
  assert.ok(!getReviewMemory(current))
})

test('磁盘恢复同一道题及评分状态；跨日恢复、旧会话拒绝、事务失败不留下半次评分', async () => {
  seed(3)
  let session = service.start({ mode: 'smart', size: 3 })
  session = service.reveal(command(session)); session = service.rate(command(session), 3)
  const current = session.question!.id
  flushDatabase(true)
  assert.ok(readFileSync(dbPath()).length > 0)
  await initDatabase()
  now += DAY
  assert.equal(service.overview().active!.question!.id, current)
  session = service.get(session.id)
  const before = getReviewSession(session.id)
  session = service.reveal(command(session))
  getDb().run("CREATE TRIGGER fail_review_write BEFORE INSERT ON review_events BEGIN SELECT RAISE(ABORT,'synthetic disk transaction error'); END")
  assert.throws(() => service.rate(command(session), 4), /synthetic/)
  assert.equal(getReviewMemory(session.question!.entryId), null)
  assert.equal(service.get(session.id).processed, before!.attempts.length)
  getDb().run('DROP TRIGGER fail_review_write')
  session = service.end(session.id, session.revision)
  const old = session.id
  service.start({ mode: 'random', size: 2 })
  assert.throws(() => service.get(old), /替换/)
  assert.ok(getVocabById(listVocab()[0].id))
})

test('已评分词重新生成不误记为未出题跳过；不可用上一题不提供撤销按钮', () => {
  seed(3)
  let session = service.start({ mode: 'smart', size: 3 })
  const gradedId = session.question!.entryId
  session = service.reveal(command(session)); session = service.rate(command(session), 3)
  updateVocabDetail(gradedId, { status: 'pending' })
  session = service.get(session.id)
  assert.equal(session.summary.firstRated, 1)
  assert.equal(session.summary.unavailable, 0)
  assert.equal(session.canUndo, false)
  const currentId = session.question!.entryId
  updateVocabDetail(currentId, { status: 'failed' })
  session = service.get(session.id)
  assert.equal(session.summary.unavailable, 1)
  assert.ok(session.question && session.question.entryId !== currentId)
  assert.equal(getReviewMemory(currentId), null)
})
