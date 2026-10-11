import { randomBytes, randomUUID } from 'node:crypto'
import type { ReviewAnswer, ReviewCommand, ReviewConfig, ReviewOverview, ReviewRating, ReviewSessionView, VocabEntry } from '../../shared/types'
import { seededRandom, selectReviewCandidates } from '../../shared/reviewSelection'
import { getVocabById, listVocab } from '../db/vocabRepo'
import { activeReviewSession, findReviewEvent, getReviewMemories, getReviewMemory, getReviewSession, latestReviewSessionId, revertReviewEvent,
  reviewTransaction, saveReviewEvent, saveReviewMemory, saveReviewSession, type ReviewSessionData } from '../db/reviewRepo'
import { previewReview, REVIEW_ENGINE, REVIEW_PARAMETERS, reviewCandidate, scheduleReview } from './reviewScheduler'

function eligible(entry: VocabEntry | null): entry is VocabEntry {
  return !!entry && entry.status === 'ready' && !!entry.word.trim() && !!entry.brief.trim()
}
function validateSearch(search: unknown): string | undefined {
  if (search === undefined) return undefined
  if (typeof search !== 'string' || search.length > 1000) throw Error('自测搜索范围无效，请缩短搜索内容。')
  return search.trim() || undefined
}
function requireSession(id: string): ReviewSessionData {
  if (typeof id !== 'string' || id.length > 100) throw Error('自测会话无效')
  const session = getReviewSession(id)
  if (!session || latestReviewSessionId() !== id) throw Error('本轮自测已被替换，请重新进入自测。')
  return session
}
function answer(entry: VocabEntry): ReviewAnswer {
  return { phonetic: entry.phonetic, pos: entry.pos, brief: entry.brief, detail: entry.detail, note: entry.note, contextSentence: entry.contextSentence }
}

/** 重学仅在到时且隔开三道其他题后插入；无合适下一题时结束本轮，保留稍后复习安排。 */
function advance(session: ReviewSessionData, now: number): void {
  if (session.status !== 'active') return
  const pendingIds = [...new Set([...session.queue.map(item => item.entryId), ...(session.current ? [session.current.entryId] : [])])]
  const invalid = new Set(pendingIds.filter(id => !eligible(getVocabById(id))))
  session.unavailableIds = [...new Set([...session.unavailableIds, ...invalid])]
  session.queue = session.queue.filter(item => !invalid.has(item.entryId))
  if (session.current && invalid.has(session.current.entryId)) { session.current = null; delete session.undo }
  if (session.current) return
  const ready = (item: ReviewSessionData['queue'][number]) => item.notBefore <= now && item.afterAnswered <= session.attempts.length
  let index = session.queue.findIndex(item => item.repeat > 0 && ready(item))
  if (index < 0) index = session.queue.findIndex(ready)
  if (index < 0) {
    session.deferredIds = [...new Set(session.queue.map(item => item.entryId))]
    session.queue = []
    session.status = 'completed'
    return
  }
  const [item] = session.queue.splice(index, 1)
  const entry = getVocabById(item.entryId)!
  session.current = { ...item, word: entry.word, answer: answer(entry), revealed: false }
}

function view(session: ReviewSessionData, now: number): ReviewSessionView {
  const first = session.attempts.filter(item => item.repeat === 0)
  const firstRatings: Record<ReviewRating, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  for (const attempt of first) if (attempt.rating) firstRatings[attempt.rating]++
  const last = new Map(session.attempts.filter(item => item.rating).map(item => [item.entryId, item]))
  const needsWork = [...last.values()].filter(item => item.rating! <= 2 && eligible(getVocabById(item.entryId))).map(item => ({
    entryId: item.entryId, word: item.word, rating: item.rating!, dueAt: getReviewMemory(item.entryId)?.card.due || now
  }))
  const current = session.current
  return {
    id: session.id, revision: session.revision, status: session.status, config: session.config,
    total: session.baseIds.length, processed: new Set([...first.map(item => item.entryId), ...session.unavailableIds]).size,
    question: current ? { id: current.id, entryId: current.entryId, word: current.word, repeat: current.repeat } : null,
    answer: current?.revealed ? current.answer : null,
    preview: current?.revealed ? previewReview(getReviewMemory(current.entryId), now, session.parameters) : null,
    serverNow: now, canUndo: !!session.undo && eligible(getVocabById(session.undo.entryId)),
    summary: { firstRatings, firstRated: first.filter(item => item.rating !== null).length, skipped: session.attempts.filter(item => item.rating === null).length,
      extraAnswered: session.attempts.filter(item => item.repeat > 0 && item.rating !== null).length, unavailable: session.unavailableIds.length,
      deferred: session.deferredIds.length, needsWork }
  }
}

/** 可注入时钟/seed用于跨天、短期加练、仿真与回包重放验证；生产一律主进程计时。 */
export function createReviewService(clock = () => Date.now(), seed = () => randomBytes(4).readUInt32LE(), onChanged = () => {}) {
  const notify = () => { try { onChanged() } catch (e) { console.warn('[review] 学习状态通知失败', e) } }
  function get(id: string): ReviewSessionView {
    return reviewTransaction(() => {
      const session = requireSession(id), before = JSON.stringify(session), now = clock()
      advance(session, now)
      if (JSON.stringify(session) !== before) { session.revision++; saveReviewSession(session) }
      return view(session, now)
    })
  }
  function overview(search?: string): ReviewOverview {
    const entries = listVocab({ search: validateSearch(search) }), memories = getReviewMemories(), now = clock()
    const candidates = entries.filter(eligible).map(entry => reviewCandidate(entry, memories.get(entry.id) || null, now))
    const active = activeReviewSession()
    const activeView = active ? get(active.id) : null
    return { eligible: candidates.length, fresh: candidates.filter(c => c.fresh).length,
      due: candidates.filter(c => !c.fresh && c.dueAt <= now).length, unavailable: entries.length - candidates.length,
      active: activeView?.status === 'active' ? activeView : null }
  }
  function start(config: ReviewConfig): ReviewSessionView {
    if (!config || !['smart', 'random'].includes(config.mode) || !Number.isInteger(config.size) || config.size < 1 || config.size > 50) throw Error('请选择有效的自测模式和1–50个词。')
    const search = validateSearch(config.search)
    return reviewTransaction(() => {
      if (activeReviewSession()) throw Error('还有未完成的自测，请继续或先结束本轮。')
      const now = clock(), randomSeed = seed(), memories = getReviewMemories()
      const candidates = listVocab({ search }).filter(eligible).map(entry => reviewCandidate(entry, memories.get(entry.id) || null, now))
      const ids = selectReviewCandidates(candidates, config.size, config.mode, now, seededRandom(randomSeed))
      if (!ids.length) throw Error(config.mode === 'smart' ? '当前范围没有到期词或未测词，可稍后复习或选择全库随机练习。' : '当前范围没有已完成释义的词条。')
      const session: ReviewSessionData = { id: randomUUID(), revision: 0, status: 'active', config: { ...config, search }, seed: randomSeed,
        engine: REVIEW_ENGINE, parameters: structuredClone(REVIEW_PARAMETERS), baseIds: ids,
        queue: ids.map(entryId => ({ id: randomUUID(), entryId, repeat: 0, notBefore: 0, afterAnswered: 0 })),
        current: null, attempts: [], unavailableIds: [], deferredIds: [], createdAt: now }
      advance(session, now); saveReviewSession(session)
      return view(session, now)
    })
  }
  function checked(command: ReviewCommand): ReviewSessionData {
    if (!command || typeof command.questionId !== 'string' || !Number.isInteger(command.revision)) throw Error('自测操作无效')
    const session = requireSession(command.sessionId)
    if (session.status !== 'active' || session.current?.id !== command.questionId || session.revision !== command.revision) throw Error('题目状态已变化，请刷新后继续。')
    if (!eligible(getVocabById(session.current.entryId))) throw Error('当前词条已删除或释义暂不可用，请刷新后继续。')
    return session
  }
  function reveal(command: ReviewCommand): ReviewSessionView {
    return reviewTransaction(() => {
      const session = checked(command)
      session.current!.revealed = true
      // 揭晓是幂等操作，不增加版本；评分必须带此题当前版本。
      saveReviewSession(session)
      return view(session, clock())
    })
  }
  function submit(command: ReviewCommand, rating: ReviewRating | null): ReviewSessionView {
    if (rating !== null && ![1, 2, 3, 4].includes(rating)) throw Error('请选择有效的四档评分。')
    let changed = false
    const result = reviewTransaction(() => {
      if (!command || typeof command.sessionId !== 'string' || typeof command.questionId !== 'string') throw Error('自测操作无效')
      const duplicate = findReviewEvent(command.sessionId, command.questionId)
      if (duplicate) {
        if (duplicate.commandRevision !== command.revision || duplicate.rating !== rating) throw Error('本题已提交其他结果，请刷新后继续。')
        return view(requireSession(command.sessionId), clock())
      }
      const session = checked(command), question = session.current!, now = clock()
      if (rating !== null && !question.revealed) throw Error('请先揭晓答案，再评价记忆情况。')
      const { undo: _oldUndo, ...beforeSession } = structuredClone(session)
      const before = getReviewMemory(question.entryId)
      const scheduled = rating === null ? null : scheduleReview(before, rating, now, session.parameters)
      if (scheduled) { saveReviewMemory(question.entryId, scheduled.memory); changed = true }
      const eventId = randomUUID()
      saveReviewEvent({ id: eventId, sessionId: session.id, questionId: question.id, entryId: question.entryId,
        commandRevision: command.revision, rating, at: now, before, after: scheduled?.memory || before, log: scheduled?.log })
      session.attempts.push({ questionId: question.id, entryId: question.entryId, word: question.word, repeat: question.repeat, rating, at: now })
      if (rating === 1 && question.repeat < 2) session.queue.push({ id: randomUUID(), entryId: question.entryId, repeat: question.repeat + 1,
        notBefore: Math.max(now + 60_000, scheduled!.memory.card.due), afterAnswered: session.attempts.length + 3 })
      session.current = null
      session.revision++
      session.undo = { eventId, entryId: question.entryId, beforeMemory: before, beforeSession }
      advance(session, now); saveReviewSession(session)
      return view(session, now)
    })
    if (changed) notify()
    return result
  }
  function undo(id: string, revision: number): ReviewSessionView {
    const result = reviewTransaction(() => {
      const session = requireSession(id)
      if (session.revision !== revision || !session.undo) throw Error('当前没有可撤销的上一题。')
      const previous = session.undo
      if (!eligible(getVocabById(previous.entryId))) throw Error('上一题词条已不可用，无法撤销。')
      saveReviewMemory(previous.entryId, previous.beforeMemory)
      revertReviewEvent(previous.eventId)
      const restored: ReviewSessionData = { ...previous.beforeSession, revision: session.revision + 1 }
      // 撤销后保持答案可见，可重新确认评分；旧版本回包无法再次计分。
      saveReviewSession(restored)
      return view(restored, clock())
    })
    notify()
    return result
  }
  function end(id: string, revision: number): ReviewSessionView {
    return reviewTransaction(() => {
      const session = requireSession(id)
      if (session.revision !== revision) throw Error('自测进度已变化，请刷新后再结束。')
      if (session.status === 'active') {
        session.status = 'ended'
        session.deferredIds = [...new Set([...session.queue.filter(q => q.repeat > 0).map(q => q.entryId), ...(session.current?.repeat ? [session.current.entryId] : [])])]
        session.current = null
        session.queue = []; delete session.undo; session.revision++
        saveReviewSession(session)
      }
      return view(session, clock())
    })
  }
  return { overview, start, get, reveal, rate: (command: ReviewCommand, rating: ReviewRating) => {
    if (![1, 2, 3, 4].includes(rating)) throw Error('请选择有效的四档评分。')
    return submit(command, rating)
  }, skip: (command: ReviewCommand) => submit(command, null), undo, end }
}
