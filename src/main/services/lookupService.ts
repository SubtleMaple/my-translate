import { randomUUID } from 'node:crypto'
import type { VocabAddResult, WordLookup, WordSenseHint } from '../../shared/types'
import { recordLookup } from '../db/recommendationRepo'
import { normalizeWords, validateWords } from '../llm/normalizeWord'
import { generateWordDetail } from '../llm/wordDetail'
import { getSettings } from '../settings'
import { addNormalizedVocab, getVocabByWord } from '../db/vocabRepo'

const requests = new Map<string, AbortController>()
const results = new Map<string, WordLookup>()

export function abortLookup(id: string): void {
  requests.get(id)?.abort()
}

export async function lookupWord(id: string, input: string, sense?: WordSenseHint): Promise<WordLookup> {
  const [word] = validateWords([input], true)
  if (typeof id !== 'string' || id.length > 100 || requests.has(id)) throw Error('查询标识无效')
  // 单个查询页面：新查询中断旧查询，主进程同样约束并发。
  for (const controller of requests.values()) controller.abort()
  const controller = new AbortController()
  requests.set(id, controller)
  try {
    const settings = getSettings().llm
    const [source] = sense ? [{ word, original: word, context: '', explanation: `推荐义项：${sense.pos} ${sense.meaning}` }] : await normalizeWords([word], '', settings, controller.signal)
    const detail = await generateWordDetail(source.word, '', settings, controller.signal, undefined, sense)
    if (controller.signal.aborted) throw Error('查询已取消')
    const result: WordLookup = { ...source, ...detail, id: randomUUID() }
    recordLookup([word, source.word])
    results.set(result.id, result)
    if (results.size > 30) results.delete(results.keys().next().value!)
    return result
  } finally { requests.delete(id) }
}

export function saveLookup(id: string): VocabAddResult {
  const result = results.get(id)
  if (!result) throw Error('查询结果已过期，请重新查询后收藏')
  // 查词收藏幂等；已有词不增加阅读出现次数，也不覆盖备注/详情。
  const existing = getVocabByWord(result.word)
  if (existing) return { added: [], addedIds: [], existed: [existing.word], normalized: [result] }
  return addNormalizedVocab([{
    word: result.word, original: result.original, context: '', explanation: result.explanation
  }], { ...result, status: 'ready' })
}
