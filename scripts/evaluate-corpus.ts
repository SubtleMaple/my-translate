// Explicit, opt-in quality measurement. No application settings or user vocabulary are read.
import { CEFR_LEVELS, DEFAULT_SETTINGS } from '../src/shared/types'
import { countCorpusWords } from '../src/shared/corpus'
import { prepareCorpus, rankCorpus } from '../src/main/services/corpusRanking'
import { reviewCorpusBatch, mergeReviewed } from '../src/main/llm/corpusReview'
import cases from '../tests/corpus-cases.json'

async function main() {
  const { CORPUS_API_TYPE: type = 'openai', CORPUS_API_KEY: apiKey, CORPUS_API_URL: baseURL, CORPUS_MODEL: model } = process.env
  if (!['openai','anthropic'].includes(type) || !apiKey || !model || !baseURL?.startsWith('https://')) {
    throw Error('请设置 CORPUS_API_TYPE、CORPUS_API_KEY、CORPUS_MODEL 和 HTTPS CORPUS_API_URL。')
  }
  const targetLevel = CEFR_LEVELS[3]
  const profile = { targetLevel, hasEstimate: true, adjustment: 0, sample: [], history: [], excluded: new Set<string>() }
  const settings = { ...DEFAULT_SETTINGS.llm, type: type as 'openai' | 'anthropic', [type]: { baseURL, apiKey, model, thinking: 'off' } }
  const candidates = rankCorpus(prepareCorpus(countCorpusWords(cases.map(c => c[0]).join(' '))), profile, Date.now(), true)
  const reviewed = await reviewCorpusBatch(candidates, 0, targetLevel, settings, new AbortController().signal)
  const result = rankCorpus(mergeReviewed(reviewed.kept), profile, Date.now())
  const groups = [...new Set(cases.map(c => c[1]))].map(category => {
    const falseAccepts = [], falseRejects = []
    for (const [spelling, group, expected] of cases) {
      if (group !== category || !spelling) continue
      const match = result.find(w => w.word === spelling.toLowerCase() || w.forms?.includes(spelling.toLowerCase()))
      if (match && match.word !== expected) falseAccepts.push(spelling)
      if (expected && match?.word !== expected) falseRejects.push(spelling)
    }
    return { category, falseAccepts, falseRejects }
  })
  console.log(JSON.stringify({ model, targetLevel, candidates: candidates.length, skipped: reviewed.skippedIndices.map(i => candidates[i].word), groups, results: result.map(w => w.word) }, null, 2))
}
main().catch(e => { console.error((e as Error).message); process.exitCode = 1 })
