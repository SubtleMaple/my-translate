import { create } from 'zustand'
import type { WordLookup } from '@shared/types'

interface LookupState {
  input: string
  result: WordLookup | null
  requestId: string | null
  error: string
  saving: boolean
  setInput: (input: string) => void
  search: (recommendationId?: string) => Promise<void>
  cancel: () => void
  save: () => Promise<void>
}

export const useLookupStore = create<LookupState>((set, get) => ({
  input: '', result: null, requestId: null, error: '', saving: false,
  setInput: (input) => {
    get().cancel()
    set({ input, result: null, error: '' })
  },
  cancel: () => {
    const id = get().requestId
    set({ requestId: null })
    if (id) void window.api.abortLookup(id).catch(() => {})
  },
  search: async (recommendationId) => {
    const input = get().input.trim()
    if (!input) return
    get().cancel()
    const id = crypto.randomUUID()
    set({ requestId: id, result: null, error: '' })
    try {
      const result = recommendationId ? await window.api.lookupRecommendation(id, recommendationId) : await window.api.lookupWord(id, input)
      if (get().requestId === id) set({ result, requestId: null })
    } catch (e) {
      if (get().requestId === id) set({ requestId: null, error: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  },
  save: async () => {
    const result = get().result
    if (!result || get().saving) return
    set({ saving: true })
    try { await window.api.saveLookup(result.id) }
    finally { set({ saving: false }) }
  }
}))
