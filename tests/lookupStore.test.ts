import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { useLookupStore } from '../src/renderer/src/stores/lookupStore'
import type { WordLookup } from '../src/shared/types'

test('查询竞态：编辑/取消/新查询使旧回包失效；菜单切换保留结果；收藏防双击', async () => {
  const pending: { id: string; resolve: (r: WordLookup) => void; reject: (e: Error) => void }[] = []
  const aborts: string[] = []
  let saves = 0, release!: () => void
  ;(globalThis as any).window = { api: {
    lookupWord: (id: string) => new Promise<WordLookup>((resolve, reject) => pending.push({ id, resolve, reject })),
    abortLookup: async (id: string) => { aborts.push(id) },
    saveLookup: () => { saves++; return new Promise<void>(r => { release = r }) }
  } }
  const state = useLookupStore.getState
  const result = (word: string): WordLookup => ({ word, id: word, original: word, explanation: '', context: '', phonetic: '', pos: '', brief: '', detail: '' })
  state().setInput('first'); const first = state().search()
  state().setInput('second'); const second = state().search()
  pending[1].resolve(result('second')); await second
  pending[0].resolve(result('first')); await first
  assert.equal(state().result!.word, 'second')
  assert.ok(aborts.includes(pending[0].id))
  const saving = state().save(); await state().save()
  assert.equal(saves, 1)
  release(); await saving
  state().setInput('third'); const third = state().search(); state().cancel()
  pending[2].reject(Error('late error')); await third
  assert.equal(state().error, '')
  assert.equal(state().requestId, null)
  const retry = state().search(); pending[3].reject(Error('network error')); await retry
  assert.equal(state().error, 'network error')
})
