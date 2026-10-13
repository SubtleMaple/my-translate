import { create } from 'zustand'
import type { RecommendationPage, RecommendationPreference, RecommendationRequest } from '@shared/types'

interface RecommendationStore {
  page: RecommendationPage | null
  busy: boolean
  error: string
  load: (request?: RecommendationRequest) => Promise<void>
  feedback: (id: string, kind: 'known' | 'skip') => Promise<void>
  undo: (word: string) => Promise<void>
  preference: (patch: RecommendationPreference) => Promise<void>
  cancel: () => void
}
let requestNumber = 0
let activeGeneration = 0
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
    page: null, busy: false, error: '',
    load: async (request = {}) => {
      if (request.allowGenerate !== false) {
        if (get().busy) return
        // 先展示保留的当前组；仅首次初始化或手动刷新会生成推荐。
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
        // 词库变更只更新画像和提示，保留当前卡片且不请求模型。
        const number = ++requestNumber
        try {
          const page = await window.api.getRecommendations(request)
          if (number === requestNumber) set({ page })
        } catch (e) { if (number === requestNumber) set({ error: message(e) }) }
      }
    },
    feedback: (id, kind) => mutate(() => window.api.recommendationFeedback(id, kind)),
    undo: (word) => mutate(() => window.api.undoRecommendationFeedback(word)),
    preference: (patch) => mutate(() => window.api.setRecommendationPreference(patch)),
    cancel: () => {
      requestNumber++
      if (get().busy) void window.api.abortRecommendations().catch(() => {})
      activeGeneration = 0
      set({ busy: false })
    }
  }
})
