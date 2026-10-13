import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { initDatabase, getDb, markDirty, flushDatabase } from '../src/android/database'
import { getSettings, updateSettings, mergeSettings } from '../src/android/settings'
import { nativeFetch, receiveNetwork } from '../src/android/network'
import { encodeBytes, decodeBytes } from '../src/android/native'
import { setFetchImpl, chatCompletion } from '../src/main/llm/client'
import { runTranslate } from '../src/main/llm/translate'
import { DEFAULT_SETTINGS } from '../src/shared/types'
import { encodeArguments, decodeArguments } from '../src/android/rpc'

const storage = new Map<string, string>()
let failWrite = false
let requestHandler = (_raw: string) => {}
let lastCancelled = ''
globalThis.AndroidHost = {
  read: name => JSON.stringify({ value: storage.get(name) ?? null }),
  write: (name, value) => { if (failWrite) return JSON.stringify({ error: '空间不足' }); storage.set(name, value); return '{}' },
  sha256: text => createHash('sha256').update(text).digest('hex'),
  post: () => {}, request: raw => requestHandler(raw), cancel: id => { lastCancelled = id }, exportFile: () => {}
}
const wasm = readFileSync('node_modules/sql.js/dist/sql-wasm.wasm')

test('Android JSON通信保留可选参数undefined，与显式null严格区分', () => {
  const args = [undefined, null, '', 0, false, { search: 'book' }]
  assert.deepEqual(decodeArguments(JSON.parse(JSON.stringify(encodeArguments(args)))), args)
  const defaultSearch = (search = '') => search
  assert.equal(defaultSearch(decodeArguments(JSON.parse(JSON.stringify(encodeArguments([undefined]))))[0] as string), '')
})

test('Android真实SQL迁移、立即落盘、重启、损坏保护和保存失败重试', async () => {
  await initDatabase(wasm)
  assert.equal(getDb().exec('PRAGMA user_version')[0].values[0][0], 5)
  getDb().run("INSERT INTO vocabulary(word,word_lower,created_at,updated_at) VALUES('test','test',1,1)")
  markDirty(); flushDatabase()
  const saved = storage.get('database')!
  await initDatabase(wasm)
  assert.equal(getDb().exec('SELECT word FROM vocabulary')[0].values[0][0], 'test')
  getDb().run("UPDATE vocabulary SET note='中文备注'")
  markDirty(); failWrite = true
  assert.throws(() => flushDatabase(), /空间不足/)
  assert.equal(storage.get('database'), saved)
  failWrite = false; flushDatabase()
  await initDatabase(wasm)
  assert.equal(getDb().exec('SELECT note FROM vocabulary')[0].values[0][0], '中文备注')
  storage.set('database', btoa('damaged data'))
  await assert.rejects(initDatabase(wasm))
  assert.equal(storage.get('database'), btoa('damaged data'))
  storage.set('database', saved); await initDatabase(wasm)
})
test('Android设置白名单合并；保存失败不谎报成功、不更新缓存', () => {
  const previous = getSettings()
  failWrite = true
  assert.throws(() => updateSettings({ ui: { theme: 'dark' } }), /空间不足/)
  assert.equal(getSettings(), previous)
  failWrite = false
  assert.equal(updateSettings({ ui: { theme: 'dark' } }).ui.theme, 'dark')
  assert.equal(JSON.parse(storage.get('settings')!).ui.theme, 'dark')
  const merged = mergeSettings(DEFAULT_SETTINGS, JSON.parse('{"__proto__":{"polluted":true},"ui":{"palette":"iris"}}'))
  assert.equal(merged.ui.palette, 'iris'); assert.equal(merged.ui.theme, DEFAULT_SETTINGS.ui.theme)
  assert.equal(({} as any).polluted, undefined)
})
test('Android二进制桥接完整往返大文件', () => {
  const bytes = new Uint8Array(1024 * 1024).map((_, index) => index % 256)
  assert.deepEqual(decodeBytes(encodeBytes(bytes)), bytes)
})
test('Android nativeFetch双协议非流式与逐字节UTF8流式翻译', async () => {
  setFetchImpl(nativeFetch)
  for (const type of ['openai', 'anthropic'] as const) {
    const settings = structuredClone(DEFAULT_SETTINGS.llm)
    settings.type = type; settings[type].apiKey = 'test-only-placeholder'
    requestHandler = raw => {
      const req = JSON.parse(raw); const body = JSON.parse(req.body)
      assert.match(req.url, type === 'openai' ? /chat\/completions$/ : /messages$/)
      assert.ok(type === 'openai' ? req.headers.authorization : req.headers['x-api-key'])
      queueMicrotask(() => {
        receiveNetwork({ id: req.id, type: 'headers', status: 200 })
        const content = body.stream
          ? 'data: ' + JSON.stringify(type === 'openai' ? { choices: [{ delta: { content: '你好🌿' } }] } : { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好🌿' } }) + '\n\ndata: [DONE]\n\n'
          : JSON.stringify(type === 'openai' ? { choices: [{ message: { content: '你好' } }] } : { content: [{ type: 'text', text: '你好' }] })
        for (const byte of new TextEncoder().encode(content)) receiveNetwork({ id: req.id, type: 'chunk', data: btoa(String.fromCharCode(byte)) })
        receiveNetwork({ id: req.id, type: 'end' })
      })
    }
    assert.equal(await chatCompletion(settings, [{ role: 'user', content: 'Hello' }]), '你好')
    let output = ''; let done = ''
    await runTranslate('stream-' + type, 'Hello', settings, { chunk: delta => { output += delta }, done: text => { done = text }, error: message => { throw Error(message) } })
    assert.equal(output, '你好🌿'); assert.equal(done, output)
  }
})
test('Android取消贯穿原生请求，断网和HTTP错误完整传播', async () => {
  requestHandler = () => {}
  const controller = new AbortController()
  const promise = nativeFetch('https://example.invalid', { signal: controller.signal })
  controller.abort()
  await assert.rejects(promise, { name: 'AbortError' }); assert.ok(lastCancelled)
  requestHandler = raw => { const { id } = JSON.parse(raw); queueMicrotask(() => receiveNetwork({ id, type: 'error', message: '断网' })) }
  await assert.rejects(nativeFetch('https://example.invalid'), /断网/)
  requestHandler = raw => {
    const { id } = JSON.parse(raw)
    queueMicrotask(() => { receiveNetwork({ id, type: 'headers', status: 401 }); receiveNetwork({ id, type: 'chunk', data: btoa('{}') }); receiveNetwork({ id, type: 'end' }) })
  }
  const response = await nativeFetch('https://example.invalid')
  assert.equal(response.status, 401); assert.equal(response.ok, false)
})
