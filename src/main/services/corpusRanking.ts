import words from 'norvig-frequencies'
import { CEFR_LEVELS, type CefrLevel, type CorpusWord, type CorpusCandidate, type WordRecommendation } from '../../shared/types'
import { DAY, type RecommendationHistory } from '../../shared/recommendations'

let ranks: Map<string, number> | undefined
function rank(word: string): number {
  ranks ??= new Map(words.map((w, i) => [w.toLowerCase(), i + 1]))
  return ranks.get(word) || 0
}

const irregular = new Map<string, string>()
for (const group of [
  'swim swam swum swimming', 'businessman businessmen', 'man men', 'woman women', 'child children',
  'mouse mice', 'foot feet', 'tooth teeth', 'go went gone', 'run ran running',
  'write wrote written', 'take took taken', 'speak spoke spoken', 'break broke broken', 'buy bought',
  'bring brought', 'think thought', 'teach taught', 'catch caught', 'choose chose chosen',
  'drive drove driven', 'eat ate eaten', 'fall fell fallen', 'give gave given', 'fly flew flown',
  'know knew known', 'throw threw thrown', 'wear wore worn', 'wake woke woken'
]) {
  const [lemma, ...forms] = group.split(' ')
  for (const form of forms) irregular.set(form, lemma)
}
const filler = /^(?:u+h+|u+m+|h+m+|a+h+|e+h+|o+h+|huh|uhhuh|hahaha+|hehe+|tch|tsk|pfft|argh|ugh|umm|whoosh)$/i

// 通用书面语频率的粗略分档。词形保留原拼写，仅用高频原形识别常见屈折变体。
export function corpusFamily(word: string): string {
  const base = irregular.get(word)
  if (base) return base
  const roots: string[] = []
  if (word.endsWith('ies')) roots.push(word.slice(0, -3) + 'y')
  if (word.endsWith('es')) roots.push(word.slice(0, -2))
  if (word.endsWith('s') && !word.endsWith('ss')) roots.push(word.slice(0, -1))
  if (word.endsWith('ed') || word.endsWith('ing')) {
    const stem = word.slice(0, word.endsWith('ed') ? -2 : -3)
    roots.push(stem, stem + 'e')
    if (/(.)\1$/.test(stem)) roots.push(stem.slice(0, -1))
    if (stem.endsWith('i')) roots.push(stem.slice(0, -1) + 'y')
  }
  return roots.filter(w => w.length >= 3 && rank(w) && rank(w) < (rank(word) || Infinity))
    .sort((a, b) => rank(a) - rank(b))[0] || word
}
export function prepareCorpus(words: CorpusWord[]): CorpusCandidate[] {
  const groups = new Map<string, CorpusCandidate>()
  for (const { word: spelling, count } of words) {
    const form = spelling.toLowerCase()
    if (filler.test(form)) continue
    const word = corpusFamily(form)
    const item = groups.get(word) || { word, spelling, forms: [], count: 0 }
    item.count += count
    if (form !== word && !item.forms!.includes(form)) item.forms!.push(form)
    if (form === word) item.spelling = spelling
    groups.set(word, item)
  }
  return [...groups.values()]
}

// Permit only inflectional heads linked to this specific input, including an inflection
// whose base is less frequent and therefore was not selected by the local heuristic.
export function relatedLemma(input: CorpusCandidate, lemma: string): boolean {
  if (lemma === input.word || corpusFamily(input.word) === lemma) return true
  // A frequency list can omit a productive re- verb. Require a known base
  // and still verify the complete inflection against the observed spelling.
  if (!rank(lemma) && !(lemma.startsWith('re') && lemma.length >= 5 && rank(lemma.slice(2)))) return false
  const stem = lemma.replace(/e$/, '')
  const forms = [lemma+'s', lemma+'es', lemma+'ed', lemma+'ing', stem+'ed', stem+'ing']
  if (lemma.endsWith('ic')) forms.push(lemma+'ked', lemma+'king')
  if (lemma.endsWith('ie')) forms.push(lemma.slice(0,-2)+'ying')
  if (['large','nice','small','short','long','tall','fast','old','young'].includes(lemma)) forms.push(stem+'er', stem+'est')
  if (/[^aeiou]y$/.test(lemma)) forms.push(lemma.slice(0,-1)+'ies', lemma.slice(0,-1)+'ied', lemma.slice(0,-1)+'ier', lemma.slice(0,-1)+'iest')
  if (/[^aeiou][aeiou][bcdfglmnprstz]$/.test(lemma)) forms.push(lemma+lemma.slice(-1)+'ed', lemma+lemma.slice(-1)+'ing')
  return forms.includes(input.word)
}

function band(word: string): number | undefined {
  const r = rank(corpusFamily(word))
  if (!r) return undefined
  return r <= 800 ? 0 : r <= 2200 ? 1 : r <= 5000 ? 2 : r <= 10000 ? 3 : r <= 22000 ? 4 : 5
}

export interface CorpusProfile {
  targetLevel: CefrLevel
  hasEstimate: boolean
  adjustment: number
  sample: string[]
  excluded: Set<string>
  history: RecommendationHistory[]
}

function corpusEvidence(profile: CorpusProfile, now: number) {
  const excluded = new Set([...profile.excluded].map(corpusFamily))
  const votes = [0, 0, 0, 0, 0, 0]
  const known: number[] = []
  const evidence: number[] = []
  for (const word of profile.sample) {
    const level = band(word)
    if (level !== undefined) evidence.push(level)
  }
  for (const h of profile.history) {
    const root = corpusFamily(h.word)
    const skipped = h.kind === 'skip' && h.updatedAt > now - 90 * DAY
    if (h.kind === 'known' || skipped || h.lookedUpAt > now - 30 * DAY || h.shownAt > now - 7 * DAY) excluded.add(root)
    if (h.feedbackWord && h.word !== h.feedbackWord) continue
    const level = band(h.word)
    if (level === undefined) continue
    if (h.kind === 'known') known.push(level)
    else if (skipped) votes[level]--
    else if (h.shownAt && h.lookedUpAt >= h.shownAt) votes[level] += profile.excluded.has(h.word) ? 2 : 1
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
  let target = CEFR_LEVELS.indexOf(profile.targetLevel)
  if (!profile.hasEstimate && evidence.length) target = median(evidence) + profile.adjustment
  if (known.length >= 3) target = Math.max(target, median(known) + 1 + profile.adjustment)
  target = Math.min(5, Math.max(0, target))
  return { target, votes, excluded }
}

export function corpusTarget(profile: CorpusProfile, now: number): CefrLevel {
  return CEFR_LEVELS[corpusEvidence(profile, now).target]
}

export function rankCorpus(pool: CorpusCandidate[], profile: CorpusProfile, now: number, forReview = false): CorpusCandidate[] {
  if (!pool.length) return []
  const { target, votes, excluded } = corpusEvidence(profile, now)
  const found = pool.flatMap(item => {
    const root = corpusFamily(item.word)
    const level = item.level ? CEFR_LEVELS.indexOf(item.level) : band(item.word)
    if (excluded.has(root) || item.forms?.some(w => excluded.has(corpusFamily(w))) || (!item.level && rank(root) <= 150) || level === undefined || level < target - 1 || (!forReview && level > target + 1)) return []
    const score = 10 - Math.abs(target - level) * 3 + Math.min(3, Math.log2(item.count)) + Math.max(-4, Math.min(4, votes[level]))
    return [{ item, root, score }]
  })
  const seen = new Set<string>()
  return found.sort((a, b) => b.score - a.score || a.item.word.localeCompare(b.item.word)).flatMap(({ item, root }) => {
    if (seen.has(root)) return []
    seen.add(root)
    return [item]
  })
}

export function corpusCandidate(item: CorpusCandidate): Omit<WordRecommendation, 'id'> {
  const root = corpusFamily(item.word)
  return { source: 'corpus', corpusEvidence: item, word: item.word, forms: [...new Set([...(item.forms || []), ...(root === item.word ? [] : [root])])], family: root,
    pos: '', meaning: '', level: item.level || CEFR_LEVELS[band(item.word)!], topic: 'general', utility: 3,
    reason: '来自导入语料，文中出现 ' + item.count + ' 次。' }
}
