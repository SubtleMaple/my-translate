import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { useVocabStore } from '../src/renderer/src/stores/vocabStore'
import { useSettingsStore } from '../src/renderer/src/stores/settingsStore'
import type { VocabEntry, VocabQuery } from '../src/shared/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const word = (id: number): VocabEntry => ({ id, word: `word-${id}`, phonetic: '', pos: '', brief: '', detail: '', note: '', status: 'ready', contextSentence: '', failReason: '', count: 1, createdAt: 0, updatedAt: 0 })

test('生词查询：乱序、防抖窗口、排序、失败重试', async () => {
  const calls: { query: VocabQuery; result: ReturnType<typeof deferred<VocabEntry[]>> }[] = []
  const savedSettings = useSettingsStore.getState().settings
  ;(globalThis as any).window = { api: {
    listVocab: (query: VocabQuery) => {
      const result = deferred<VocabEntry[]>()
      calls.push({ query, result })
      return result.promise
    },
    setSettings: async () => savedSettings
  } }
  useVocabStore.setState({ entries: [], searchInput: '', search: '', sortBy: 'time', error: null })
  const store = useVocabStore.getState

  const old = store().refresh()
  const newer = store().refresh()
  calls[1].result.resolve([word(2)])
  await newer
  calls[0].result.resolve([word(1)])
  await old
  assert.equal(store().entries[0].id, 2, '旧回包不能覆盖最新列表')

  const beforeInput = store().refresh()
  store().setSearchInput(' fresh ')
  calls[2].result.resolve([word(3)])
  await beforeInput
  assert.equal(store().entries[0].id, 2, '防抖等待期间旧回包同样失效')
  await new Promise((resolve) => setTimeout(resolve, 330))
  assert.equal(calls[3].query.search, 'fresh')
  calls[3].result.resolve([word(4)])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(store().entries[0].id, 4)

  const sortOld = store().setSortBy('alpha')
  const sortNew = store().setSortBy('count')
  assert.equal(calls[4].query.sortBy, 'alpha')
  assert.equal(calls[5].query.sortBy, 'count')
  calls[5].result.resolve([word(6)])
  await sortNew
  calls[4].result.resolve([word(5)])
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
  calls[7].result.resolve([word(8)])
  await retry
  assert.equal(store().error, null)
  assert.equal(store().entries[0].id, 8)
})
