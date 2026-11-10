import { create } from 'zustand'
import type { CorpusMode, CorpusWord, RecommendationPage, RecommendationPreference, RecommendationRequest } from '@shared/types'

interface RecommendationStore {
  page: RecommendationPage | null
  busy: boolean
  importing: boolean
  reviewing: boolean
  reviewError: string
  setMode: (mode: CorpusMode) => Promise<void>
  continueReview: () => Promise<void>
  pauseReview: () => Promise<void>
  discardReview: () => Promise<void>
  importFile: (read: () => Promise<CorpusWord[]>) => Promise<void>
  error: string
  load: (request?: RecommendationRequest) => Promise<void>
  feedback: (id: string, kind: 'known' | 'skip') => Promise<void>
  undo: (word: string) => Promise<void>
  reviewCorpusWords: (words: string[]) => Promise<void>
  removeCorpusWords: (words: string[]) => Promise<void>
  removeCorpusWord: (word: string) => Promise<void>
  preference: (patch: RecommendationPreference) => Promise<void>
  cancel: () => void
}
let requestNumber = 0
let activeGeneration = 0
let stopReview = false
const message = (e: unknown) => (e as Error).message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || '推荐暂不可用，请重试'

export const useRecommendationStore = create<RecommendationStore>((set, get) => {
  const mutate = async (operation: () => Promise<RecommendationPage>) => {
    const number = ++requestNumber
    activeGeneration = number
    set({ busy: true, error: '' })
    try {
      const page = await operation()
      if (number === requestNumber) set({ page })
    } catch (e) { if (number === requestNumber) set({ error: message(e) }) }
    finally { if (number === activeGeneration) { activeGeneration = 0; set({ busy: false }) } }
  }
  return {
    page: null, busy: false, importing: false, reviewing: false, reviewError: '', error: '',
    setMode: mode => mutate(() => window.api.setCorpusMode(mode)),
    continueReview: async () => {
      let progress = get().page?.corpusProgress
      if (!progress || get().reviewing) return
      stopReview = false
      set({ reviewing: true, reviewError: '' })
      try {
        while (progress && !stopReview) {
          const page = await window.api.advanceCorpusReview(progress.id, progress.done)
          progress = page.corpusProgress
          set(state => ({ page: state.page ? { ...state.page, corpusProgress: page.corpusProgress, corpusNotice: page.corpusNotice } : page }))
        }
      } catch (e) { if (!stopReview) set({ reviewError: message(e) }) }
      finally {
        await get().load({ allowGenerate: false })
        set({ reviewing: false })
      }
    },
    pauseReview: async () => {
      stopReview = true
      const progress = get().page?.corpusProgress
      if (progress) try { await window.api.pauseCorpusReview(progress.id) } catch (e) { set({ reviewError: message(e) }) }
    },
    discardReview: async () => {
      const progress = get().page?.corpusProgress
      if (progress && !get().reviewing) {
        await mutate(() => window.api.discardCorpusReview(progress.id))
        set({ reviewError: '' })
      }
    },
    importFile: async read => {
      if (get().importing) return
      const mode = get().page?.corpusMode || 'local'
      get().cancel()
      set({ importing: true, error: '', reviewError: '' })
      const number = ++requestNumber
      try {
        const words = await read()
        const page = await window.api.importCorpus(words, mode)
        // Import is a local write. Re-read if a navigation or lookup overlapped the write.
        if (number === requestNumber) set({ page })
        else await get().load({ allowGenerate: false })
        if (mode === 'ai' && page.corpusProgress) void get().continueReview()
      } catch (e) { set({ error: message(e) }) }
      finally { set({ importing: false }) }
    },
    load: async (request = {}) => {
      if (request.allowGenerate !== false) {
        if (get().busy || get().importing) return
        // 先展示持久队列中的最多三张卡片；仅首次初始化或手动刷新会生成新批次。
        const number = ++requestNumber
        activeGeneration = number
        set({ busy: true, error: '' })
        try {
          if (request.action !== 'next') {
            const cached = await window.api.getRecommendations({ allowGenerate: false })
            if (number !== requestNumber) return
            set({ page: cached })
          }
          const page = await window.api.getRecommendations(request)
          if (number === requestNumber) set({ page })
        } catch (e) { if (number === requestNumber) set({ error: message(e) }) }
        finally { if (number === activeGeneration) { activeGeneration = 0; set({ busy: false }) } }
      } else {
        // 词库变更只从本批队列移除已收藏词并补位，不请求模型。
        const number = ++requestNumber
        try {
          const page = await window.api.getRecommendations(request)
          if (number === requestNumber) set({ page })
        } catch (e) { if (number === requestNumber) set({ error: message(e) }) }
      }
    },
    feedback: (id, kind) => mutate(() => window.api.recommendationFeedback(id, kind)),
    undo: (word) => mutate(() => window.api.undoRecommendationFeedback(word)),
    reviewCorpusWords: async words => {
      if (get().busy || get().importing || get().reviewing || get().page?.corpusProgress) return
      let startedId: string | undefined
      set({ reviewError: '' })
      await mutate(async () => {
        const page = await window.api.reviewCorpusWords(words)
        startedId = page.corpusProgress?.id
        return page
      })
      if (startedId && get().page?.corpusProgress?.id === startedId) await get().continueReview()
    },
    removeCorpusWords: words => mutate(() => window.api.removeCorpusWords(words)),
    removeCorpusWord: word => mutate(() => window.api.removeCorpusWord(word)),
    preference: (patch) => mutate(() => window.api.setRecommendationPreference(patch)),
    cancel: () => {
      requestNumber++
      if (get().busy) void window.api.abortRecommendations().catch(() => {})
      activeGeneration = 0
      set({ busy: false })
    }
  }
})
