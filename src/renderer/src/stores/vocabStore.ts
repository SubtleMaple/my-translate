import { create } from 'zustand'

import type { VocabEntry, VocabSortBy } from '@shared/types'
import { useSettingsStore } from './settingsStore'

/**
 * 生词本列表状态
 * - searchInput 即时值 / search 防抖生效值（300ms）
 * - sortBy 持久化到 settings.vocab.sortBy（主进程负责落盘）
 * - 广播 VocabChanged（增删/详情生成完成）时静默刷新，不打扰用户
 */
interface VocabState {
  entries: VocabEntry[]
  loading: boolean
  searchInput: string
  search: string
  sortBy: VocabSortBy
  expandedId: number | null

  load: () => Promise<void>
  refresh: () => Promise<void>
  setSearchInput: (v: string) => void
  setSortBy: (v: VocabSortBy) => Promise<void>
  toggleExpand: (id: number) => void
  bindEvents: () => () => void
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

export const useVocabStore = create<VocabState>((set, get) => ({
  entries: [],
  loading: false,
  searchInput: '',
  search: '',
  sortBy: 'time',
  expandedId: null,

  load: async () => {
    set({ loading: true })
    try {
      // 初始排序跟随设置（settingsStore 已加载完成）
      const { sortBy } = useSettingsStore.getState().settings.vocab
      const entries = await window.api.listVocab({ search: get().search, sortBy })
      set({ entries, sortBy, loading: false })
    } catch (e) {
      console.error('[vocab] 加载失败:', e)
      set({ loading: false })
    }
  },

  refresh: async () => {
    try {
      const entries = await window.api.listVocab({ search: get().search, sortBy: get().sortBy })
      set({ entries })
    } catch (e) {
      console.error('[vocab] 刷新失败:', e)
    }
  },

  setSearchInput: (v) => {
    set({ searchInput: v })
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      set({ search: v.trim(), expandedId: null })
      void get().refresh()
    }, 300)
  },

  setSortBy: async (sortBy) => {
    set({ sortBy })
    // 同步 settingsStore（乐观更新 + 持久化），重进生词本页时 load() 读到一致的值，避免排序闪回
    await useSettingsStore.getState().setVocabSortBy(sortBy)
    void get().refresh()
  },

  toggleExpand: (id) => {
    set((s) => ({ expandedId: s.expandedId === id ? null : id }))
  },

  bindEvents: () =>
    window.api.onVocabChanged(() => {
      void get().refresh()
    })
}))
