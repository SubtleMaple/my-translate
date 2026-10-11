import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { useReviewStore } from '../src/renderer/src/stores/reviewStore'
import type { ReviewSessionView } from '../src/shared/types'

function page(id: string, revealed: boolean): ReviewSessionView {
  return { id: 'session', revision: id === 'first' ? 0 : 1, status: 'active', config: { mode: 'smart', size: 10 }, total: 10, processed: id === 'first' ? 0 : 1,
    question: { id, entryId: 1, word: 'word', repeat: 0 }, answer: revealed ? { phonetic: '', pos: '', brief: 'answer', detail: '', note: '', contextSentence: '' } : null,
    preview: null, serverNow: 0, canUndo: false, summary: { firstRatings: { 1:0,2:0,3:0,4:0 }, firstRated: 0, skipped: 0, extraAnswered: 0, unavailable: 0, deferred: 0, needsWork: [] } }
}
test('自测UI防双击、揭晓前不能评分；退出不丢回包，失败先核对主进程而非重复评分', async () => {
  const state = useReviewStore.getState
  let ratings = 0, finish!: (result: ReviewSessionView) => void
  const api = {
    rateReview: async () => { ratings++; return new Promise<ReviewSessionView>(resolve => { finish = resolve }) },
    getReview: async () => page('second', false)
  }
  ;(globalThis as any).window = { api }
  useReviewStore.setState({ visible: true, busy: false, session: page('first', false), error: '' })
  await state().rate(3); assert.equal(ratings, 0)
  useReviewStore.setState({ session: page('first', true) })
  const pending = state().rate(3); await state().rate(3)
  assert.equal(ratings, 1)
  state().close(); finish(page('second', false)); await pending
  assert.equal(state().visible, false); assert.equal(state().session!.question!.id, 'second')
  useReviewStore.setState({ visible: true, session: page('first', true) })
  api.rateReview = async () => { ratings++; throw Error('reply lost after commit') }
  await state().rate(4)
  assert.equal(ratings, 2); assert.equal(state().session!.question!.id, 'second')
  assert.equal(state().busy, false); assert.match(state().error, /reply lost/)
  await state().rate(4); assert.equal(ratings, 2, '下一题未揭晓，不重放上一题评分')
})

test('评分等待期间收到词库变化，回包后补拉最新题目，避免显示已删除词', async () => {
  const state = useReviewStore.getState
  let finish!: (result: ReviewSessionView) => void
  let reads = 0
  ;(globalThis as any).window = { api: {
    rateReview: () => new Promise<ReviewSessionView>(resolve => { finish = resolve }),
    getReview: async () => { reads++; return page('after-deletion', false) }
  } }
  useReviewStore.setState({ visible: true, busy: false, session: page('first', true), error: '' })
  const pending = state().rate(3)
  await state().load()
  finish(page('deleted-question', false))
  await pending; await Promise.resolve()
  assert.equal(reads, 1)
  assert.equal(state().session!.question!.id, 'after-deletion')
  assert.equal(state().busy, false)
})
