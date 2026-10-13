import { createHash } from 'node:crypto'
import { CEFR_LEVELS, type RecommendationPage, type RecommendationPreference, type RecommendationRequest, type VocabEntry } from '../../shared/types'
import { DAY, chooseRecommendations, eligibleRecommendation, excludedVocabulary, recommendationProfile, sampleVocabulary, wordKey } from '../../shared/recommendations'
import { getActiveLlm } from '../../shared/llm'
import { getSettings } from '../settings'
import { listVocab } from '../db/vocabRepo'
import { getAnalyses, getCandidate, getCandidates, getRecommendationHistory, getRecommendationState, recordFeedback, recordShown, saveAnalysis, saveCandidates, saveRecommendationState, undoFeedback } from '../db/recommendationRepo'
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

function readPage(action: RecommendationRequest['action'] = 'current', message?: string, commit = true): RecommendationPage {
  const s = snapshot(), now = Date.now()
  const candidates = getCandidates()
  // 当前组是用户正在浏览的固定列表；查词、收藏和反馈只影响下一次手动刷新。
  const keepCurrent = action === 'current' && s.state.currentIds.length > 0
  const current = s.state.currentIds.flatMap(id => {
    const item = candidates.find(c => c.id === id)
    return item ? [item] : []
  })
  const available = candidates.filter(item => !s.state.currentIds.includes(item.id) && eligibleRecommendation(item, s.excluded, s.history, now))
  const items = keepCurrent ? current : s.needsLevel ? [] : chooseRecommendations(available, s.profile, s.history, now)
  const ids = items.map(item => item.id)
  if (commit && !keepCurrent && JSON.stringify(ids) !== JSON.stringify(s.state.currentIds)) {
    recordShown(items.filter(item => !s.state.currentIds.includes(item.id)), now)
    saveRecommendationState({ ...s.state, currentIds: ids })
  }
  const stale = s.state.profileKey !== s.key || s.state.generatedAt < now - 7 * DAY
  const fallback = s.needsLevel ? '词库依据不足，先选择一个大致难度。' : !s.canGenerate ? '请先配置大模型；已有缓存仍可浏览。' : s.state.lastError ||
    (items.length === 0 ? '暂无可展示的候选，点击更新推荐。' : stale ? '词库或偏好已变化，可更新推荐。' : s.profile.sampleSize < 5 ? '样本较少，这是初步估计。' : '')
  return { items, ...s.profile, coldLevel: s.state.coldLevel, adjustment: s.state.adjustment, totalWords: s.entries.length,
    needsLevel: s.needsLevel, stale, canGenerate: s.canGenerate, generatedAt: s.state.generatedAt, message: message ?? fallback,
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
  // 换组先预览候选；需要联网补充时保留当前组，失败/取消后仍可浏览。
  const page = readPage(action === 'refresh' ? 'current' : action, undefined, action !== 'next')
  const s = snapshot()
  const firstGroup = !s.state.currentIds.length && !s.state.generatedAt
  const shouldGenerate = action === 'refresh' || (action === 'next' && page.items.length < 3) || (action === 'current' && firstGroup)
  if (!shouldGenerate || request.allowGenerate === false || !page.canGenerate || page.needsLevel) {
    return action === 'next' ? page.items.length ? readPage('next') : readPage('current', '暂无下一组可用候选，当前推荐保留。') : page
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
      const currentWords = getCandidates().filter(item => updated.state.currentIds.includes(item.id)).flatMap(item => [item.word, ...item.forms]).map(wordKey)
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
      saveCandidates(eligible, Date.now())
      saveRecommendationState({ ...getRecommendationState(), profileKey: s.key, generatedAt: Date.now(), lastError: '' })
      return readPage('next')
    } catch (e) {
      const message = abort.signal.aborted ? '推荐生成已取消，已有缓存保留。' : (e as Error).message || '推荐生成失败，请重试'
      if (generation === revision) saveRecommendationState({ ...getRecommendationState(), lastError: message })
      return readPage('current', message)
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
  if (!state.currentIds.length && !state.generatedAt) return getRecommendations()
  return readPage('current', patch.difficulty === 'right' ? '已记录：保持当前推荐难度。' : '已记录难度偏好，下次点击刷新时生效。')
}
export function recommendedLookupTarget(id: string) {
  const item = getCandidate(id)
  if (!item) throw Error('推荐已过期，请更新推荐')
  return item
}
