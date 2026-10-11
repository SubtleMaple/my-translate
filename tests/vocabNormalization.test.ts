import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import initSqlJs from 'sql.js'
import { initDatabase, getDb, dbPath } from '../src/main/db/database'
import { addNormalizedVocab, getVocabByWord, listVocab, updateVocabNote, deleteVocab } from '../src/main/db/vocabRepo'
import { flushDatabase } from '../src/main/db/persist'

test('真实SQL：v2升级保留旧词；同词头合并、来源、备注、回滚、持久化', async () => {
  process.env.MY_TRANSLATE_TEST_PROFILE = mkdtempSync(join(tmpdir(), 'opencode', 'vocab-normalization-'))
  const SQL = await initSqlJs({ wasmBinary: readFileSync(join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm')) })
  const legacy = new SQL.Database()
  legacy.run(`CREATE TABLE vocabulary (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL, word_lower TEXT NOT NULL UNIQUE,
    phonetic TEXT NOT NULL DEFAULT '', pos TEXT NOT NULL DEFAULT '', brief TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', context_sentence TEXT NOT NULL DEFAULT '',
    fail_reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1);
    INSERT INTO vocabulary (word,word_lower,note,detail,status,count,created_at,updated_at) VALUES ('went','went','旧备注','旧详情','ready',7,1,2);
    PRAGMA user_version=2;`)
  writeFileSync(dbPath(), legacy.export()); legacy.close()
  assert.equal((await initDatabase()).needFlush, true)
  assert.equal(getDb().exec('PRAGMA user_version')[0].values[0][0], 5)
  assert.equal(getVocabByWord('went')!.count, 7)
  assert.equal(getVocabByWord('went')!.detail, '旧详情')
  const source = (original: string, word = 'go', context = 'He went home.') => ({ original, word, context, explanation: '按上下文还原' })
  const result = addNormalizedVocab([source('went'), source('goes')])
  assert.equal(result.addedIds.length, 1)
  assert.equal(getVocabByWord('go')!.count, 1)
  assert.equal(getVocabByWord('go')!.sources!.length, 2)
  updateVocabNote(result.addedIds[0], '新备注')
  addNormalizedVocab([source('going')], { status: 'ready', detail: '不应覆盖已有详情' })
  assert.equal(getVocabByWord('go')!.count, 2)
  assert.equal(getVocabByWord('go')!.detail, '')
  assert.equal(getVocabByWord('go')!.note, '新备注')
  addNormalizedVocab([source('saw', 'see', 'I saw birds.'), source('saw', 'saw', 'This is a saw.')])
  assert.ok(getVocabByWord('see'))
  assert.ok(getVocabByWord('saw'))
  assert.ok(listVocab({ search: 'going' }).some(e => e.word === 'go'))
  assert.equal(listVocab({ search: 'original' }).length, 0, '来源JSON字段名不应成为搜索内容')
  assert.equal(listVocab({ search: '%' }).length, 0, '原词形搜索也转义SQL通配符')
  const repeated = [0, 12].map(start => ({ original: 'running', word: 'run', explanation: '进行时', context: 'running and running', selection: { start, end: start + 7 } }))
  addNormalizedVocab(repeated)
  assert.equal(getVocabByWord('run')!.count, 1, '归一后同一词头仍按既有规则计一次')
  assert.deepEqual(getVocabByWord('run')!.sources, repeated, '相同词形、相同原句的不同位置不能丢失')
  addNormalizedVocab([repeated[0]])
  assert.equal(getVocabByWord('run')!.sources!.length, 2, '同位置重复加入无需重复保存来源')
  const before = listVocab()
  const bad = source('test', 'rollback'); (bad as any).context = bad
  assert.throws(() => addNormalizedVocab([source('okay', 'rollback'), bad]))
  assert.deepEqual(listVocab(), before)
  flushDatabase(true)
  const disk = new SQL.Database(readFileSync(dbPath()))
  assert.equal(disk.exec('PRAGMA integrity_check')[0].values[0][0], 'ok')
  assert.equal(disk.exec("SELECT count FROM vocabulary WHERE word='went'")[0].values[0][0], 7)
  assert.equal(disk.exec("SELECT note FROM vocabulary WHERE word='go'")[0].values[0][0], '新备注')
  assert.deepEqual(JSON.parse(String(disk.exec("SELECT sources FROM vocabulary WHERE word='run'")[0].values[0][0])), repeated)
  disk.close()
  deleteVocab(getVocabByWord('go')!.id)
  assert.equal(getVocabByWord('go'), null)
  flushDatabase(true)
})
