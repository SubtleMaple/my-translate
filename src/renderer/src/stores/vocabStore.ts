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
  error: string | null
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
let queryVersion = 0
let sortVersion = 0

export const useVocabStore = create<VocabState>((set, get) => ({
  entries: [],
  loading: false,
  error: null,
  searchInput: '',
  search: '',
  sortBy: 'time',
  expandedId: null,

  load: async () => {
    set({ sortBy: useSettingsStore.getState().settings.vocab.sortBy })
    await get().refresh()
  },

  refresh: async () => {
    const version = ++queryVersion
    const search = get().searchInput.trim()
    set({ loading: true, error: null, search })
    try {
      const entries = await window.api.listVocab({ search, sortBy: get().sortBy })
      if (version !== queryVersion) return
      set({ entries, loading: false })
    } catch (e) {
      if (version !== queryVersion) return
      console.error('[vocab] 刷新失败:', e)
      set({ loading: false, error: '生词本加载失败，请重试。' })
    }
  },

  setSearchInput: (v) => {
    // 输入一改变就淘汰旧请求，包含防抖等待期间返回的请求。
    queryVersion++
    set({ searchInput: v, loading: true, error: null, expandedId: null })
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      set({ search: v.trim(), expandedId: null })
      void get().refresh()
    }, 300)
  },

  setSortBy: async (sortBy) => {
    const version = ++sortVersion
    set({ sortBy })
    const refresh = get().refresh()
    try {
      await useSettingsStore.getState().setVocabSortBy(sortBy)
    } catch (e) {
      console.error('[vocab] 排序偏好保存失败:', e)
      await refresh
      if (version === sortVersion) {
        set({ error: '当前排序已应用，但偏好保存失败；请重新选择排序重试。' })
      }
    }
    await refresh
  },

  toggleExpand: (id) => {
    set((s) => ({ expandedId: s.expandedId === id ? null : id }))
  },

  bindEvents: () =>
    window.api.onVocabChanged(() => {
      void get().refresh()
    })
}))
