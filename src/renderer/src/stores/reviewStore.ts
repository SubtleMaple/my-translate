import { create } from 'zustand'
import type { ReviewCommand, ReviewConfig, ReviewOverview, ReviewRating, ReviewSessionView } from '@shared/types'

interface ReviewStore {
  visible: boolean
  busy: boolean
  error: string
  config: ReviewConfig
  overview: ReviewOverview | null
  session: ReviewSessionView | null
  open: () => void
  close: () => void
  configure: (patch: Partial<ReviewConfig>) => void
  load: () => Promise<void>
  start: () => Promise<void>
  resume: (id: string) => Promise<void>
  reveal: () => Promise<void>
  rate: (rating: ReviewRating) => Promise<void>
  skip: () => Promise<void>
  undo: () => Promise<void>
  end: () => Promise<void>
  setup: () => void
}
let requestNumber = 0
let refreshQueued = false
const describe = (e: unknown) => (e as Error).message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || '自测操作失败，请重试。'

export const useReviewStore = create<ReviewStore>((set, get) => {
  function finish(request: number) {
    if (request !== requestNumber) return
    set({ busy: false })
    if (refreshQueued) { refreshQueued = false; void get().load() }
  }
  function command(): ReviewCommand | null {
    const session = get().session
    return session?.question ? { sessionId: session.id, questionId: session.question.id, revision: session.revision } : null
  }
  async function mutate(operation: () => Promise<ReviewSessionView>) {
    if (get().busy) return
    const request = ++requestNumber
    set({ busy: true, error: '' })
    try {
      const session = await operation()
      if (request === requestNumber) set({ session })
    } catch (e) {
      if (request === requestNumber) {
        set({ error: describe(e) })
        // 例如删除词条或IPC回包丢失：先核对主进程，不重复盲写一次评分。
        const id = get().session?.id
        if (id) try {
          const session = await window.api.getReview(id)
          if (request === requestNumber) set({ session })
        } catch { /* 保留可见错误，允许重新进入 */ }
      }
    } finally { finish(request) }
  }
  return {
    visible: false, busy: false, error: '', config: { mode: 'smart', size: 10 }, overview: null, session: null,
    open: () => { set({ visible: true, session: null, overview: null, error: '' }); void get().load() },
    close: () => set({ visible: false }),
    configure: (patch) => {
      if (get().busy) return
      set({ config: { ...get().config, ...patch } })
      if ('search' in patch) void get().load()
    },
    load: async () => {
      if (get().busy) { refreshQueued = true; return }
      const request = ++requestNumber, sessionId = get().session?.id
      set({ busy: true, error: '' })
      try {
        if (sessionId) {
          const session = await window.api.getReview(sessionId)
          if (request === requestNumber) set({ session })
        } else {
          const overview = await window.api.reviewOverview(get().config.search)
          if (request === requestNumber) set({ overview })
        }
      } catch (e) { if (request === requestNumber) set({ error: describe(e) }) }
      finally { finish(request) }
    },
    start: () => mutate(() => window.api.startReview(get().config)),
    resume: (id) => mutate(() => window.api.getReview(id)),
    reveal: async () => { const value = command(); if (value && !get().session?.answer) await mutate(() => window.api.revealReview(value)) },
    rate: async (rating) => { const value = command(); if (value && get().session?.answer) await mutate(() => window.api.rateReview(value, rating)) },
    skip: async () => { const value = command(); if (value) await mutate(() => window.api.skipReview(value)) },
    undo: async () => { const session = get().session; if (session?.canUndo) await mutate(() => window.api.undoReview(session.id, session.revision)) },
    end: async () => { const session = get().session; if (session) await mutate(() => window.api.endReview(session.id, session.revision)) },
    setup: () => { if (!get().busy) { set({ session: null, error: '' }); void get().load() } }
  }
})
