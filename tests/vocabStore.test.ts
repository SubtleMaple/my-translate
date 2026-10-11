import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { useVocabStore } from '../src/renderer/src/stores/vocabStore'
import { useSettingsStore } from '../src/renderer/src/stores/settingsStore'
import type { VocabViewEntry, VocabViewQuery, VocabViewData } from '../src/shared/types'
import { learningSummary } from '../src/main/services/vocabViewService'
import { useReviewStore } from '../src/renderer/src/stores/reviewStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { DEFAULT_SETTINGS } from '../src/shared/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const word = (id: number): VocabViewEntry => ({ id, word: `word-${id}`, phonetic: '', pos: '', brief: '', detail: '', note: '', status: 'ready', contextSentence: '', failReason: '', count: 1, createdAt: 0, updatedAt: 0, learning: learningSummary(null, undefined, 0) })
const page = (id: number): VocabViewData => ({ entries: [word(id)], evaluatedAt: id, stageCounts: { unseen: 1, fragile: 0, learning: 0, developing: 0, stable: 0 }, matchedCount: 1 })

test('生词查询：乱序、防抖窗口、排序、失败重试', async () => {
  const calls: { query: VocabViewQuery; result: ReturnType<typeof deferred<VocabViewData>> }[] = []
  const savedSettings = useSettingsStore.getState().settings
  ;(globalThis as any).window = { api: {
    queryVocabView: (query: VocabViewQuery) => {
      const result = deferred<VocabViewData>()
      calls.push({ query, result })
      return result.promise
    },
    setSettings: async () => savedSettings
  } }
  useVocabStore.setState({ entries: [], searchInput: '', search: '', sortBy: 'time', error: null })
  const store = useVocabStore.getState

  const old = store().refresh()
  const newer = store().refresh()
  calls[1].result.resolve(page(2))
  await newer
  calls[0].result.resolve(page(1))
  await old
  assert.equal(store().entries[0].id, 2, '旧回包不能覆盖最新列表')

  const beforeInput = store().refresh()
  store().setSearchInput(' fresh ')
  calls[2].result.resolve(page(3))
  await beforeInput
  assert.equal(store().entries[0].id, 2, '防抖等待期间旧回包同样失效')
  await new Promise((resolve) => setTimeout(resolve, 330))
  assert.equal(calls[3].query.search, 'fresh')
  calls[3].result.resolve(page(4))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(store().entries[0].id, 4)

  const sortOld = store().setSortBy('alpha')
  const sortNew = store().setSortBy('count')
  assert.equal(calls[4].query.sortBy, 'alpha')
  assert.equal(calls[5].query.sortBy, 'count')
  calls[5].result.resolve(page(6))
  await sortNew
  calls[4].result.resolve(page(5))
  await sortOld
  assert.equal(store().entries[0].id, 6)
  assert.equal(store().sortBy, 'count')

  const failure = store().refresh()
  calls[6].result.reject(new Error('模拟 IPC 失败'))
  await failure
  assert.ok(store().error)
  assert.equal(store().loading, false)
  assert.equal(store().entries[0].id, 6, '刷新失败保留已加载词条')
  const retry = store().refresh()
  calls[7].result.resolve(page(8))
  await retry
  assert.equal(store().error, null)
  assert.equal(store().entries[0].id, 8)
})

test('视图/词云偏好保存与失败回退；筛选快照乱序不覆盖；学习通知只刷新可见词库', async () => {
  const store = useVocabStore.getState
  useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) })
  useVocabStore.setState({ learningFilter: 'all', loading: false, expandedId: 3 })
  let failSettings = false, reads = 0, off = 0
  let reviewChanged!: () => void, vocabChanged!: () => void
  const calls: ReturnType<typeof deferred<VocabViewData>>[] = []
  const api = {
    setSettings: async () => { if (failSettings) throw Error('save failed'); return useSettingsStore.getState().settings },
    queryVocabView: async () => { reads++; return page(9) },
    onReviewChanged: (cb: () => void) => { reviewChanged = cb; return () => { off++ } },
    onVocabChanged: (cb: () => void) => { vocabChanged = cb; return () => { off++ } }
  }
  ;(globalThis as any).window = { api }
  await store().setViewMode('cloud'); await store().setCloudMetric('count')
  assert.equal(useSettingsStore.getState().settings.vocab.view, 'cloud')
  assert.equal(useSettingsStore.getState().settings.vocab.cloudMetric, 'count')
  failSettings = true; await store().setViewMode('groups')
  assert.match(store().error!, /保存失败/)
  assert.equal(useSettingsStore.getState().settings.vocab.view, 'cloud')
  assert.equal(useSettingsStore.getState().settings.vocab.cloudMetric, 'count')
  failSettings = false; await store().load(); assert.equal(store().viewMode, 'cloud')
  api.queryVocabView = () => { const result = deferred<VocabViewData>(); calls.push(result); return result.promise }
  const older = store().setLearningFilter('stable'), latest = store().setLearningFilter('fragile')
  calls[1].resolve(page(11)); await latest
  calls[0].resolve(page(10)); await older
  assert.equal(store().learningFilter, 'fragile'); assert.equal(store().evaluatedAt, 11)
  api.queryVocabView = async () => { reads++; return page(12) }
  const unsubscribe = store().bindEvents(), before = reads
  useUiStore.setState({ view: 'translate' }); reviewChanged(); vocabChanged()
  assert.equal(reads, before)
  useUiStore.setState({ view: 'vocab' }); useReviewStore.setState({ visible: true }); reviewChanged()
  assert.equal(reads, before)
  useReviewStore.setState({ visible: false }); reviewChanged()
  await Promise.resolve(); await Promise.resolve()
  assert.equal(reads, before + 1); assert.equal(store().evaluatedAt, 12)
  unsubscribe(); assert.equal(off, 2)
})
