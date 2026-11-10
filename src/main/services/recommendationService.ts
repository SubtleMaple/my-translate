import { createHash, randomUUID } from 'node:crypto'
import { reviewCorpusBatch, mergeReviewed } from '../llm/corpusReview'
import { flushDatabase } from '../db/persist'
import type { CorpusWord, CorpusCandidate, CorpusMode } from '../../shared/types'
import { MAX_CORPUS_WORDS } from '../../shared/corpus'
import { corpusCandidate, corpusFamily, corpusTarget, prepareCorpus, rankCorpus } from './corpusRanking'
import { CEFR_LEVELS, type RecommendationPage, type RecommendationPreference, type RecommendationRequest, type VocabEntry } from '../../shared/types'
import type { CorpusJob } from '../../shared/recommendations'
import { DAY, RECOMMENDATION_BATCH_SIZE, chooseRecommendations, eligibleRecommendation, excludedVocabulary, recommendationProfile, sampleVocabulary, wordKey } from '../../shared/recommendations'
import { getActiveLlm } from '../../shared/llm'
import { getSettings } from '../settings'
import { listVocab } from '../db/vocabRepo'
import { getAnalyses, getCandidate, getCandidates, getRecommendationHistory, getRecommendationState, recordFeedback, recordShown, saveAnalysis, saveCandidates, saveRecommendationState, saveCorpusRevision, undoFeedback } from '../db/recommendationRepo'
import { analyzeVocabulary, generateRecommendations, vocabularyEvidence } from '../llm/recommendations'

let running: Promise<RecommendationPage> | null = null
let controller: AbortController | null = null
let revision = 0
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function snapshot() {
  const settings = getSettings().llm
  const { type, config } = getActiveLlm(settings)
  const modelKey = hash(['recommendations-v1', type, config.baseURL, config.model, config.thinking])
  const entries = listVocab()
  const sample = sampleVocabulary(entries.filter(e => /^[A-Za-z][A-Za-z '’‐-]*$/.test(e.word) && e.word.length <= 160))
  const fingerprints = new Map(sample.map(e => [e.id, hash([modelKey, vocabularyEvidence(e)])]))
  const cache = getAnalyses()
  const analyses = sample.flatMap(e => cache.get(e.id)?.fingerprint === fingerprints.get(e.id) ? [cache.get(e.id)!.analysis] : [])
  const missing = sample.filter(e => cache.get(e.id)?.fingerprint !== fingerprints.get(e.id))
  const state = getRecommendationState()
  const history = getRecommendationHistory()
  const profile = recommendationProfile(sample, analyses, state)
  const excluded = excludedVocabulary(entries, analyses)
  // 全词库只用于本地变化检测与排除；模型只收到有上限的代表样本。
  const key = hash([modelKey, [...excludedVocabulary(entries, [])].sort(), sample.map(e => [fingerprints.get(e.id), Math.min(8, e.count), e.createdAt]),
    state.coldLevel, state.adjustment, history.filter(h => h.kind && (h.kind === 'known' || h.updatedAt > Date.now() - 90 * DAY)).map(h => [h.word, h.kind, h.topic])])
  return { settings, entries, sample, fingerprints, analyses, missing, state, history, profile, excluded, key,
    canGenerate: !!(config.apiKey.trim() && config.baseURL.trim() && config.model.trim()), needsLevel: sample.length === 0 && !state.coldLevel }
}

function corpusProfile(s: ReturnType<typeof snapshot>, candidates: ReturnType<typeof getCandidates>) {
  const active = new Set(s.state.batchIds || [])
  const excluded = new Set(s.excluded)
  for (const item of candidates) if (active.has(item.id)) {
    for (const word of [item.word, ...item.forms]) excluded.add(wordKey(word))
  }
  return { excluded, sample: s.sample.map(e => wordKey(e.word)), history: s.history,
    targetLevel: s.profile.targetLevel, adjustment: s.state.adjustment, hasEstimate: !!(s.profile.estimatedLevel || s.state.coldLevel) }
}
function availableCorpus(pool: CorpusCandidate[], s: ReturnType<typeof snapshot>, candidates: ReturnType<typeof getCandidates>) {
  return pool.length ? rankCorpus(pool, corpusProfile(s, candidates), Date.now()) : []
}

function activateCorpus(ranked: CorpusCandidate[], s: ReturnType<typeof snapshot>, pool = s.state.corpusPool) {
  const batch = ranked.slice(0, RECOMMENDATION_BATCH_SIZE)
  const taken = new Set(batch.map(w => w.word))
  saveCandidates(batch.map(corpusCandidate), Date.now(), { ...s.state, corpusPool: pool.filter(w => !taken.has(w.word)),
    generatedAt: Date.now(), profileKey: s.key, lastError: '' })
}

export function setCorpusMode(mode: CorpusMode): RecommendationPage {
  if (mode !== 'local' && mode !== 'ai') throw Error('筛选模式无效')
  saveRecommendationState({ ...getRecommendationState(), corpusMode: mode })
  return readPage()
}

function addCorpusCandidates(incoming: CorpusCandidate[], reviewed = false): RecommendationPage {
  const current = readPage()
  const s = snapshot(), candidates = getCandidates()
  const existing = s.state.corpusPool
  const families = new Set(existing.flatMap(w => [w.word, ...(w.forms || [])]).map(corpusFamily))
  const fresh = availableCorpus(incoming, s, candidates).filter(w => ![w.word, ...(w.forms || [])].some(form => families.has(corpusFamily(form))))
  const additions = fresh.slice(0, Math.max(0, 1200 - existing.length))
  const pool = [...existing, ...additions]
  const added = additions.length
  const notice = (reviewed ? 'AI 精筛完成，' : '导入完成，') + (added ? '已从语料加入 ' + added + ' 个候选词。' : '没有新增符合当前难度的候选词。') +
    (fresh.length > added ? '语料池已达 1200 词上限，另有 ' + (fresh.length - added) + ' 个未加入。' : '')
  const skipped = reviewed ? s.state.corpusJob?.skippedIndices?.length || 0 : 0
  const summary = notice + (skipped ? `另有 ${skipped} 个词的审校结果无效，已跳过。` : '')
  s.state = { ...s.state, ...(reviewed ? { corpusJob: undefined } : {}), corpusNotice: summary }
  if (added && !current.remainingCount) {
    abortRecommendations()
    activateCorpus(availableCorpus(pool, s, candidates), s, pool)
  } else saveRecommendationState({ ...s.state, corpusPool: pool })
  return readPage(summary)
}

export function importCorpus(words: CorpusWord[], mode: CorpusMode = 'local'): RecommendationPage {
  if (!Array.isArray(words) || words.length > MAX_CORPUS_WORDS || words.some(w => !w || typeof w.word !== 'string' ||
    !/^[a-z]{3,32}$/i.test(w.word) || !Number.isInteger(w.count) || w.count < 1 || w.count > 2_000_000)) throw Error('语料词频无效')
  if (!words.length) throw Error('没有找到可筛选的英文单词。')
  if (mode !== 'local' && mode !== 'ai') throw Error('筛选模式无效')
  const grouped = prepareCorpus(words)
  if (mode === 'local') return addCorpusCandidates(grouped)
  readPage() // 接入旧版队列后再核对本批与排除记录。
  const s = snapshot()
  if (s.state.corpusJob) throw Error('已有精筛任务，请先继续或结束任务。')
  if (!s.canGenerate) throw Error('使用 AI 精筛前请先配置模型。')
  const profile = corpusProfile(s, getCandidates())
  for (const item of s.state.corpusPool) for (const w of [item.word, ...(item.forms || [])]) profile.excluded.add(w)
  const now = Date.now()
  const inputs = rankCorpus(grouped, profile, now, true)
  return startCorpusJob(inputs, corpusTarget(profile, now))
}

function startCorpusJob(inputs: CorpusCandidate[], targetLevel: CorpusJob['targetLevel'], preview?: CorpusJob['preview']): RecommendationPage {
  const job = inputs.length ? { id: randomUUID(), inputs, targetLevel, done: 0, kept: [], preview } : undefined
  saveRecommendationState({ ...getRecommendationState(), corpusJob: job, corpusNotice: job ? '' : '本地预筛后没有新增候选，未调用模型。' })
  flushDatabase(false, true)
  return readPage()
}

function selectedWords(words: string[]): Set<string> {
  if (!Array.isArray(words) || !words.length || words.length > 1200 + RECOMMENDATION_BATCH_SIZE ||
    words.some(word => typeof word !== 'string' || !/^[a-z]{3,32}$/.test(word))) throw Error('请选择有效的语料词')
  return new Set(words)
}

export function reviewCorpusWords(words: string[]): RecommendationPage {
  const selected = selectedWords(words)
  readPage()
  const s = snapshot()
  if (s.state.corpusJob) throw Error('请先完成或放弃当前精筛任务。')
  if (!s.canGenerate) throw Error('请先在设置中配置模型。')
  const batchIds = new Map<string, string>()
  const inputs: CorpusCandidate[] = []
  for (const id of s.state.queueIds) {
    const item = getCandidate(id)
    if (item?.source !== 'corpus' || !selected.has(item.word)) continue
    batchIds.set(item.word, id)
    // Earlier corpus cards stored their count only in the locally generated reason.
    const legacyCount = Number(/^来自导入语料，文中出现 (\d+) 次。$/.exec(item.reason)?.[1]) || 1
    inputs.push(item.corpusEvidence || { word: item.word, forms: item.forms, count: legacyCount })
  }
  inputs.push(...s.state.corpusPool.filter(w => selected.has(w.word)))
  if (!inputs.length) throw Error('所选候选已移出列表，请重新选择。')
  return startCorpusJob(inputs, corpusTarget(corpusProfile(s, getCandidates()), Date.now()),
    { batchIds: Object.fromEntries(batchIds), acceptedIndices: [], removed: [] })
}

function finishPreviewReview(job: CorpusJob, preview: NonNullable<CorpusJob['preview']>): RecommendationPage {
  readPage()
  const s = snapshot()
  const candidates = getCandidates()
  const byId = new Map(candidates.map(card => [card.id, card]))
  const batchIds = new Map(Object.entries(preview.batchIds))
  const queued = new Set(s.state.queueIds)
  const pending = new Set(s.state.corpusPool.map(w => w.word))
  const removed = new Set(preview.removed)
  const skipped = new Set(job.skippedIndices || [])
  const live = new Set(job.inputs.filter((w, index) => {
    const id = batchIds.get(w.word)
    return !skipped.has(index) && !removed.has(w.word) && (id ? queued.has(id) && byId.get(id)?.word === w.word : pending.has(w.word))
  }).map(w => w.word))
  const profile = corpusProfile(s, [])
  const reviewingIds = new Set([...live].map(word => batchIds.get(word)))
  for (const id of s.state.batchIds || []) {
    const item = byId.get(id)
    if (item && !reviewingIds.has(id)) for (const w of [item.word,...item.forms]) profile.excluded.add(w)
  }
  for (const item of s.state.corpusPool) {
    if (!live.has(item.word)) for (const w of [item.word,...(item.forms || [])]) profile.excluded.add(w)
  }
  // Active cards may just have been shown; retain their own display exemption.
  const shown = new Set(job.inputs.filter(w => live.has(w.word) && batchIds.has(w.word)).flatMap(w => [w.word,...(w.forms || [])]))
  profile.history = profile.history.map(h => shown.has(h.word) ? { ...h, shownAt: 0 } : h)
  const byOriginal = new Map(job.kept.map((item, i) => [job.inputs[preview.acceptedIndices[i]].word, item]))
  const accepted = [...live].flatMap(w => byOriginal.has(w) ? [byOriginal.get(w)!] : [])
  const eligible = new Map(rankCorpus(mergeReviewed(accepted), profile, Date.now()).map(item => [item.word, item]))
  const retained = new Map<string, CorpusCandidate>()
  for (const original of live) {
    const lemma = byOriginal.get(original)?.word
    const item = lemma && eligible.get(lemma)
    if (item) {
      retained.set(original, item)
      eligible.delete(item.word)
    }
  }
  const cards = s.state.queueIds.flatMap(id => {
    const card = byId.get(id)
    const item = card && retained.get(card.word)
    return item && reviewingIds.has(id) ? [{ ...corpusCandidate(item), id }] : []
  })
  const keepIds = new Set(cards.map(card => card.id))
  const renamed = new Set(cards.filter(card => byId.get(card.id)?.word !== card.word).map(card => card.id))
  const notice = '候选词精筛完成：保留 ' + retained.size + ' 个，移除或合并 ' + (live.size - retained.size) + ' 个。' +
    (skipped.size ? `另有 ${skipped.size} 个词的审校结果无效，已跳过。` : '')
  saveCorpusRevision({ ...s.state, corpusJob: undefined, corpusNotice: notice,
    queueIds: s.state.queueIds.filter(id => !reviewingIds.has(id) || keepIds.has(id)),
    currentIds: s.state.currentIds.filter(id => !renamed.has(id)),
    corpusPool: s.state.corpusPool.flatMap(item => !live.has(item.word) ? [item] : retained.has(item.word) ? [retained.get(item.word)!] : [])
  }, cards)
  return readPage(notice)
}

let activeReview: { id: string; controller: AbortController } | undefined

export function pauseCorpusReview(id: string): void {
  if (activeReview?.id === id) activeReview.controller.abort()
}
export function discardCorpusReview(id: string): RecommendationPage {
  const state = getRecommendationState()
  if (state.corpusJob?.id === id) {
    pauseCorpusReview(id)
    saveRecommendationState({ ...state, corpusJob: undefined, corpusNotice: '已结束本次精筛。' })
  }
  return readPage()
}

// 一次 RPC 只审一批。只有导入或手动继续才驱动下一批，页面重载不会重新发送请求。
export async function advanceCorpusReview(id: string, offset: number): Promise<RecommendationPage> {
  flushDatabase(false, true)
  const job = getRecommendationState().corpusJob
  if (!job || job.id !== id || job.done !== offset) return readPage()
  if (activeReview) throw Error('当前批次正在处理中')
  const controller = new AbortController()
  activeReview = { id, controller }
  try {
    if (job.done < job.inputs.length) {
      const batch = job.inputs.slice(offset, offset + 40)
      const result = await reviewCorpusBatch(batch, offset, job.targetLevel, getSettings().llm, controller.signal)
      const latest = getRecommendationState()
      if (controller.signal.aborted || latest.corpusJob?.id !== id) throw Error('精筛已暂停')
      if (job.preview && latest.corpusJob.preview) {
        job.preview.removed = latest.corpusJob.preview.removed
        job.preview.acceptedIndices.push(...result.acceptedIndices)
      }
      if (result.skippedIndices.length) (job.skippedIndices ??= []).push(...result.skippedIndices)
      job.kept.push(...result.kept)
      job.done += batch.length
      saveRecommendationState({ ...latest, corpusJob: job })
      flushDatabase(false, true)
    }
    if (job.done < job.inputs.length) return readPage()
    const page = job.preview ? finishPreviewReview(job, job.preview) : addCorpusCandidates(mergeReviewed(job.kept), true)
    flushDatabase(false, true)
    return page
  } finally { activeReview = undefined }
}

export function removeCorpusWord(word: string): RecommendationPage {
  return removeCorpusWords([word])
}

export function removeCorpusWords(words: string[]): RecommendationPage {
  const selected = selectedWords(words)
  const state = getRecommendationState()
  const pool = state.corpusPool.filter(item => !selected.has(item.word))
  const queueIds = state.queueIds.filter(id => {
    const item = getCandidate(id)
    return item?.source !== 'corpus' || !selected.has(item.word)
  })
  if (pool.length !== state.corpusPool.length || queueIds.length !== state.queueIds.length) {
    const preview = state.corpusJob?.preview
    if (preview) preview.removed = [...new Set([...preview.removed, ...state.corpusJob!.inputs.filter(w => selected.has(w.word)).map(w => w.word)])]
    saveRecommendationState({ ...state, corpusPool: pool, queueIds })
  }
  return readPage()
}

function readPage(message?: string): RecommendationPage {
  const s = snapshot(), now = Date.now()
  const candidates = getCandidates()
  const byId = new Map(candidates.map(item => [item.id, item]))
  let state = s.state
  // 旧版只有 currentIds 和候选池：本地接入最多十个，不浪费已有候选重新联网。
  if (state.batchIds === null && (state.generatedAt || state.currentIds.length || candidates.length)) {
    const current = state.currentIds.flatMap(id => {
      const item = byId.get(id)
      return item && eligibleRecommendation(item, s.excluded, s.history, now, true) ? [item] : []
    })
    const available = candidates.filter(item => !state.currentIds.includes(item.id) && eligibleRecommendation(item, s.excluded, s.history, now))
    const batchIds = chooseRecommendations(available, s.profile, s.history, now, current, RECOMMENDATION_BATCH_SIZE).map(item => item.id)
    state = { ...state, batchIds, queueIds: batchIds }
  }
  // 只消费本批候选，不按新画像重排，也不从历史批次或网络自动补充。
  const queue = state.queueIds.flatMap(id => {
    const item = byId.get(id)
    return item && eligibleRecommendation(item, s.excluded, s.history, now, true) ? [item] : []
  })
  const queueIds = queue.map(item => item.id)
  const items = queue.slice(0, 3)
  const ids = items.map(item => item.id)
  if (state !== s.state || JSON.stringify(queueIds) !== JSON.stringify(state.queueIds) || JSON.stringify(ids) !== JSON.stringify(state.currentIds)) {
    recordShown(items.filter(item => !s.state.currentIds.includes(item.id)), now)
    state = { ...state, currentIds: ids, queueIds }
    saveRecommendationState(state)
  }
  const stale = s.state.profileKey !== s.key || s.state.generatedAt < now - 7 * DAY
  const corpusCount = availableCorpus(s.state.corpusPool, s, candidates).length
  const corpusBatch = items.some(item => item.source === 'corpus')
  const fallback = s.needsLevel ? '词库依据不足，先选择一个大致难度。' : !s.canGenerate ? '请先配置大模型；已有缓存仍可浏览。' : s.state.lastError ||
    (items.length === 0 ? state.batchIds !== null ? '本批候选已用完，点击右上角刷新键生成新的一批。' : '暂无可展示的候选，点击更新推荐。' : stale ? '词库或偏好已变化，下次刷新时生效。' : s.profile.sampleSize < 5 ? '样本较少，这是初步估计。' : '')
  return { items, remainingCount: queue.length, batchSize: state.batchIds?.length ?? 0, ...s.profile, coldLevel: s.state.coldLevel, adjustment: s.state.adjustment, totalWords: s.entries.length,
    needsLevel: s.needsLevel, corpusCount, stale, canGenerate: s.canGenerate, generatedAt: s.state.generatedAt,
    corpusMode: state.corpusMode || 'local', corpusNotice: state.corpusNotice || '',
    corpusProgress: state.corpusJob ? { id: state.corpusJob.id, skipped: state.corpusJob.skippedIndices?.length || 0, done: state.corpusJob.done, total: state.corpusJob.inputs.length } : null,
    corpusPreview: { batch: queue.filter(item => item.source === 'corpus').map(item => item.word), pending: state.corpusPool.map(item => item.word) },
    message: message ?? (corpusBatch || corpusCount ? '' : fallback),
    feedback: s.history.filter(h => h.kind === 'known' || (h.kind === 'skip' && h.updatedAt > now - 90 * DAY))
      .filter(h => !h.feedbackWord || h.word === h.feedbackWord)
      .map(h => ({ word: h.word, kind: h.kind as 'known' | 'skip', topic: h.topic, updatedAt: h.updatedAt })) }
}

export function abortRecommendations(): void {
  revision++
  controller?.abort()
}

export async function getRecommendations(request: RecommendationRequest = {}): Promise<RecommendationPage> {
  if (!request || !['current', 'next', 'refresh'].includes(request.action || 'current') || (request.allowGenerate !== undefined && typeof request.allowGenerate !== 'boolean')) throw Error('推荐请求无效')
  const action = request.action || 'current'
  const page = readPage()
  const s = snapshot()
  const firstGroup = s.state.batchIds === null
  const shouldGenerate = action === 'refresh' || (action === 'current' && firstGroup && !s.state.corpusJob)
  if (action === 'refresh' && request.allowGenerate !== false && page.corpusCount) {
    abortRecommendations()
    activateCorpus(availableCorpus(s.state.corpusPool, s, getCandidates()), s)
    return readPage()
  }
  if (!shouldGenerate || request.allowGenerate === false || !page.canGenerate || s.needsLevel) {
    return page
  }
  // 已有当前组的普通读取不等待或发起网络请求；首次生成/手动刷新复用正在运行的任务。
  if (running) return running
  if (action === 'current' && s.state.lastAttempt > Date.now() - 60_000) return page
  const generation = ++revision
  const abort = new AbortController()
  controller = abort
  const guard = () => {
    if (abort.signal.aborted || generation !== revision) throw Error('推荐生成已取消')
    if (snapshot().key !== s.key) throw Error('词库、模型或推荐偏好已变化，请更新推荐')
  }
  saveRecommendationState({ ...getRecommendationState(), lastAttempt: Date.now(), lastError: '' })
  const work = async () => {
    try {
      for (let i = 0; i < s.missing.length; i += 20) {
        const batch: VocabEntry[] = s.missing.slice(i, i + 20)
        const analyses = await analyzeVocabulary(batch, s.settings, abort.signal)
        guard()
        for (const analysis of analyses) saveAnalysis(s.fingerprints.get(analysis.entryId)!, analysis)
      }
      const updated = snapshot()
      const currentWords = getCandidates().filter(item => updated.state.batchIds?.includes(item.id)).flatMap(item => [item.word, ...item.forms]).map(wordKey)
      const excluded = new Set([...updated.excluded, ...currentWords])
      const historyExcluded = updated.history.filter(h => h.kind === 'known' || (h.kind === 'skip' && h.updatedAt > Date.now() - 90 * DAY) || h.shownAt > Date.now() - 7 * DAY || h.lookedUpAt > Date.now() - 30 * DAY)
      const input = {
        targetLevel: updated.profile.targetLevel, topics: updated.profile.topics,
        samples: updated.sample.slice(0, 40).map(vocabularyEvidence),
        excluded: [...new Set([...excluded, ...historyExcluded.map(h => h.word)])].slice(0, 800),
        discouragedTopics: [...new Set(updated.history.filter(h => h.kind === 'skip' && h.updatedAt > Date.now() - 90 * DAY).map(h => h.topic))]
      }
      const generated = await generateRecommendations(input, s.settings, abort.signal)
      guard()
      // 排除规则仍在本地应用全部词库，不能依赖模型遵守截断后的排除清单。
      const eligible = generated.filter(item => eligibleRecommendation({ ...item, id: '' }, excluded, getRecommendationHistory(), Date.now()) &&
        Math.abs(CEFR_LEVELS.indexOf(item.level) - CEFR_LEVELS.indexOf(updated.profile.targetLevel)) <= 1)
      if (!eligible.length) throw Error('模型推荐均已收录、近期见过或难度不合适，请稍后更新')
      const batch = chooseRecommendations(eligible.map(item => ({ ...item, id: wordKey(item.word) })), updated.profile, getRecommendationHistory(), Date.now(), [], RECOMMENDATION_BATCH_SIZE)
      // 只使用本次返回的至多十个有效词；不足十个也不自动追加付费请求。
      saveCandidates(batch, Date.now(), { ...getRecommendationState(), profileKey: s.key, generatedAt: Date.now(), lastError: '' })
      return readPage()
    } catch (e) {
      const message = abort.signal.aborted ? '推荐生成已取消，已有缓存保留。' : (e as Error).message || '推荐生成失败，请重试'
      if (generation === revision) saveRecommendationState({ ...getRecommendationState(), lastError: message })
      return readPage(message)
    } finally {
      if (controller === abort) controller = null
      running = null
    }
  }
  running = work()
  return running
}

export function recommendationFeedback(id: string, kind: 'known' | 'skip'): RecommendationPage {
  if (kind !== 'known' && kind !== 'skip') throw Error('反馈类型无效')
  const item = getCandidate(id)
  if (!item) throw Error('推荐已过期，请更新后操作')
  abortRecommendations()
  recordFeedback(item, kind)
  return readPage()
}
export function undoRecommendationFeedback(word: string): RecommendationPage {
  if (typeof word !== 'string' || word.length > 160) throw Error('反馈单词无效')
  abortRecommendations()
  undoFeedback(wordKey(word))
  return readPage()
}
export async function setRecommendationPreference(patch: RecommendationPreference): Promise<RecommendationPage> {
  if (!patch || (!patch.coldLevel && !patch.difficulty) || (patch.coldLevel !== undefined && !CEFR_LEVELS.includes(patch.coldLevel)) ||
      (patch.difficulty !== undefined && !['easy', 'right', 'hard'].includes(patch.difficulty))) throw Error('推荐难度设置无效')
  abortRecommendations()
  // 等旧任务落定再保存偏好，当前组继续保留到手动刷新。
  if (running) await running
  const state = getRecommendationState()
  saveRecommendationState({ ...state, coldLevel: patch.coldLevel || state.coldLevel,
    adjustment: patch.coldLevel ? 0 : Math.max(-2, Math.min(2, state.adjustment + (patch.difficulty === 'easy' ? 1 : patch.difficulty === 'hard' ? -1 : 0))),
    ...(patch.difficulty === 'right' ? {} : { lastAttempt: 0 }), lastError: '' })
  const page = readPage(patch.difficulty === 'right' ? '已记录：保持当前推荐难度。' : '已记录难度偏好，下次点击刷新时生效。')
  return getRecommendationState().batchIds === null ? getRecommendations() : page
}
export function recommendedLookupTarget(id: string) {
  const item = getCandidate(id)
  if (!item) throw Error('推荐已过期，请更新推荐')
  return item
}
