import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { useRecommendationStore } from '../src/renderer/src/stores/recommendationStore'
import type { RecommendationPage } from '../src/shared/types'

const page = (message: string): RecommendationPage => ({ items: [], message, estimatedLevel: 'B1', targetLevel: 'B1', coldLevel: null, adjustment: 0, topics: [], sampleSize: 3, totalWords: 3, needsLevel: false, stale: false, canGenerate: true, generatedAt: 1, feedback: [] })
test('推荐页面先显示缓存；库变更/取消使旧回包失效，失败不清空缓存', async () => {
  const state = useRecommendationStore.getState
  let complete!: (value: RecommendationPage) => void
  let aborts = 0
  const api = {
    getRecommendations: async (request: any) => request?.allowGenerate === false ? page('cache') : new Promise<RecommendationPage>(r => { complete = r }),
    abortRecommendations: async () => { aborts++ }
  }
  ;(globalThis as any).window = { api }
  state().cancel()
  useRecommendationStore.setState({ page: null, error: '' })
  const pending = state().load()
  await Promise.resolve(); await Promise.resolve()
  assert.equal(state().page!.message, 'cache')
  const resolveOld = complete
  api.getRecommendations = async () => page('filtered after library change')
  await state().load({ allowGenerate: false })
  resolveOld(page('stale network'))
  await pending
  assert.equal(state().page!.message, 'filtered after library change')
  api.getRecommendations = async (request) => request?.allowGenerate === false ? page('cache') : new Promise(r => { complete = r })
  const next = state().load({ action: 'refresh' })
  await Promise.resolve(); await Promise.resolve()
  state().cancel(); complete(page('late after cancellation')); await next
  assert.equal(state().busy, false); assert.ok(aborts >= 1); assert.equal(state().page!.message, 'cache')
  api.getRecommendations = async () => { throw Error('IPC unavailable') }
  await state().load()
  assert.equal(state().page!.message, 'cache'); assert.match(state().error, /IPC unavailable/)
})
