import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createVocabExport, serializeVocabExport, vocabExportFilename } from '../src/shared/vocabExport'
import { createVocabExporter, writeExportAtomically } from '../src/main/services/vocabExportService'
import type { VocabEntry } from '../src/shared/types'
const { parseCsv } = require('./helpers/csv.cjs')

const sentence = '🙂 I saw a rusty saw lying on the workbench.'
const fixture = (): VocabEntry[] => [{
  id: 1, word: 'see', phonetic: '/siː/', pos: 'v.', brief: '看见，理解', detail: '### 用法\r\n包含 "引号", 逗号\n第二行\t制表符',
  note: '  =HYPERLINK("https://example.invalid","文本")', status: 'ready', contextSentence: sentence, failReason: '', count: 3,
  createdAt: 1700000000000, updatedAt: 1700000001000,
  sources: [{ original: 'saw', word: 'see', explanation: '过去式', context: sentence, selection: { start: 5, end: 8 } }]
}, {
  id: 2, word: 'saw', phonetic: '', pos: 'n.', brief: '锯子', detail: '长详情🙂\n'.repeat(8000), note: "'原有引号无需移除", status: 'pending',
  contextSentence: sentence, failReason: '', count: 1, createdAt: 1700000000000, updatedAt: 1700000001000,
  sources: [{ original: 'saw', word: 'saw', explanation: '该位置是名词', context: sentence, selection: { start: 17, end: 20 } }]
}, {
  id: 3, word: 'legacy phrase', phonetic: '', pos: 'phrase', brief: '', detail: '', note: '\t@legacy', status: 'failed',
  contextSentence: '', failReason: '接口返回 "异常", 请重试\n保留原因', count: 7, createdAt: 0, updatedAt: 1
}]

test('JSON完整保留词条状态、长文、双saw位置、时间单位；不混入运行时属性', () => {
  const entries = fixture()
  ;(entries[0] as any).apiKey = 'synthetic-private-property'
  const output = serializeVocabExport(entries, 'json', '0.2.0', new Date('2026-10-09T12:00:00Z'))
  const exported = JSON.parse(output)
  assert.equal(exported.schemaVersion, 1); assert.equal(exported.entryCount, 3)
  assert.equal(exported.application.version, '0.2.0')
  assert.equal(exported.exportedAt, '2026-10-09T12:00:00.000Z')
  assert.equal(exported.timestampUnit, 'unix-milliseconds')
  assert.equal(exported.selectionOffsets.unit, 'UTF-16 code units')
  assert.equal(output.includes('synthetic-private-property'), false)
  for (let i = 0; i < entries.length; i++) {
    const { apiKey: _ignored, ...entry } = entries[i] as VocabEntry & { apiKey?: string }
    assert.deepEqual(exported.entries[i], { ...entry, sources: entry.sources || [] })
  }
  const copy = createVocabExport(entries, '0.2.0', new Date())
  copy.entries[0].sources[0].selection!.start = 99
  assert.equal(entries[0].sources![0].selection!.start, 5)
})

test('CSV独立解析往返：BOM、引号/逗号/换行、长文、嵌套来源及公式文本可还原', () => {
  const entries = fixture()
  const csv = serializeVocabExport(entries, 'csv', '0.2.0', new Date())
  assert.equal(csv.charCodeAt(0), 0xfeff)
  const [headers, ...rows] = parseCsv(csv) as string[][]
  assert.equal(rows.length, 3)
  for (const [index, row] of rows.entries()) {
    assert.equal(row.length, headers.length)
    const record = Object.fromEntries(headers.map((key, i) => [key, row[i]]))
    const escaped = JSON.parse(record.csv_escaped_columns) as string[]
    for (const key of escaped) { assert.ok(record[key].startsWith("'")); record[key] = record[key].slice(1) }
    const entry = entries[index]
    for (const key of ['word','phonetic','pos','brief','detail','note','status'] as const) assert.equal(record[key], entry[key])
    assert.equal(record.fail_reason, entry.failReason)
    assert.equal(record.context_sentence, entry.contextSentence)
    assert.equal(Number(record.created_at_ms), entry.createdAt)
    assert.equal(record.created_at, new Date(entry.createdAt).toISOString())
    assert.equal(Number(record.count), entry.count)
    assert.deepEqual(JSON.parse(record.sources_json), entry.sources || [])
    assert.equal(Number(record.source_count), entry.sources?.length || 0)
    assert.deepEqual(escaped, index === 0 || index === 2 ? ['note'] : [])
  }
  const empty = JSON.parse(serializeVocabExport([], 'json', '0.2.0', new Date()))
  assert.equal(empty.entryCount, 0); assert.deepEqual(empty.entries, [])
  assert.equal(parseCsv(serializeVocabExport([], 'csv', '0.2.0', new Date())).length, 1)
  assert.equal(vocabExportFilename('json', new Date(2026, 9, 9, 15, 30, 0)), 'my-translate-vocabulary-20261009-153000.json')
})

test('保存对话框后全量快照、重复调用不打开第二个对话框、写入期间快照稳定', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode', 'export-flow-'))
  let entries = fixture().slice(0, 1), chooseCalls = 0, release!: (path: string) => void
  let captured = ''
  const exporter = createVocabExporter({
    readAll: () => entries,
    chooseFile: () => { chooseCalls++; return new Promise(resolve => { release = resolve }) },
    appVersion: () => '0.2.0',
    write: async (_path, content) => { captured = content; entries[0].note = 'changed during disk write' }
  })
  const first = exporter('json')
  const duplicate = await exporter('csv')
  assert.equal(duplicate.status, 'error'); assert.equal(chooseCalls, 1)
  entries = fixture()
  entries[0].note = 'updated while save dialog open'
  release(join(directory, 'all.json'))
  const result = await first
  assert.equal(result.status, 'saved')
  if (result.status === 'saved') assert.equal(result.count, 3)
  assert.equal(JSON.parse(captured).entries[0].note, 'updated while save dialog open')
})

test('空库、取消、无效格式/扩展名、写入错误返回明确结果且可重试', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode', 'export-errors-'))
  let entries: VocabEntry[] = [], calls = 0, selected: string | null = join(directory, 'all.json'), fail = false, writes = 0
  const exporter = createVocabExporter({ readAll: () => entries, appVersion: () => '0.2.0',
    chooseFile: async () => { calls++; return selected },
    write: async () => { writes++; if (fail) throw Object.assign(Error('test denied'), { code: 'EACCES' }) }
  })
  assert.equal((await exporter('json')).status, 'empty'); assert.equal(calls, 0)
  assert.equal((await exporter('xml' as any)).status, 'error'); assert.equal(calls, 0)
  entries = fixture(); selected = null
  assert.equal((await exporter('json')).status, 'cancelled'); assert.equal(writes, 0)
  selected = join(directory, 'wrong.csv')
  assert.equal((await exporter('json')).status, 'error'); assert.equal(writes, 0)
  selected = join(directory, 'all.json'); fail = true
  const denied = await exporter('json')
  assert.equal(denied.status, 'error')
  if (denied.status === 'error') assert.match(denied.message, /权限/)
  fail = false
  assert.equal((await exporter('json')).status, 'saved')
})

test('原子文件保存：完整覆盖已确认文件；替换失败保留原目标并清理临时文件', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode', 'export-disk-'))
  const file = join(directory, 'all.json')
  await writeFile(file, 'old file')
  const content = serializeVocabExport(fixture(), 'json', '0.2.0', new Date())
  await writeExportAtomically(file, content)
  assert.equal(await readFile(file, 'utf8'), content)
  assert.deepEqual(await readdir(directory), ['all.json'])
  const blocked = join(directory, 'blocked.json')
  await mkdir(blocked)
  await writeFile(join(blocked, 'keep.txt'), 'keep')
  await assert.rejects(writeExportAtomically(blocked, 'new content'))
  assert.equal(await readFile(join(blocked, 'keep.txt'), 'utf8'), 'keep')
  assert.ok((await readdir(directory)).every(name => !name.endsWith('.tmp')))
  await assert.rejects(writeExportAtomically(join(directory, 'missing', 'all.json'), content))
})
