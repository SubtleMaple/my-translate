import { create } from 'zustand'

import type { CloudMetric, LearningFilter, LearningStage, VocabViewEntry, VocabViewMode, VocabSortBy } from '@shared/types'
import { CLOUD_METRICS, VOCAB_SORTS } from '@shared/learning'
import { useSettingsStore } from './settingsStore'
import { useReviewStore } from './reviewStore'
import { useUiStore } from './uiStore'

/**
 * 生词本列表状态
 * - searchInput 即时值 / search 防抖生效值（300ms）
 * - sortBy 持久化到 settings.vocab.sortBy（主进程负责落盘）
 * - 广播 VocabChanged（增删/详情生成完成）时静默刷新，不打扰用户
 */
interface VocabState {
  entries: VocabViewEntry[]
  loading: boolean
  error: string | null
  searchInput: string
  search: string
  sortBy: VocabSortBy
  expandedId: number | null
  selectedId: number | null
  viewMode: VocabViewMode
  cloudMetric: CloudMetric
  learningFilter: LearningFilter
  evaluatedAt: number
  stageCounts: Record<LearningStage, number>
  matchedCount: number

  load: () => Promise<void>
  refresh: (silent?: boolean) => Promise<void>
  setSearchInput: (v: string) => void
  setSortBy: (v: VocabSortBy) => Promise<void>
  setViewMode: (v: VocabViewMode) => Promise<void>
  setCloudMetric: (v: CloudMetric) => Promise<void>
  setLearningFilter: (v: LearningFilter) => Promise<void>
  selectEntry: (id: number | null) => void
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
  selectedId: null, viewMode: 'list', cloudMetric: 'weakness', learningFilter: 'all', evaluatedAt: 0,
  stageCounts: { unseen: 0, fragile: 0, learning: 0, developing: 0, stable: 0 }, matchedCount: 0,

  load: async () => {
    const prefs = useSettingsStore.getState().settings.vocab
    set({ sortBy: VOCAB_SORTS.some(s => s.value === prefs.sortBy) ? prefs.sortBy : 'time',
      viewMode: ['list', 'cloud', 'groups'].includes(prefs.view) ? prefs.view : 'list',
      cloudMetric: CLOUD_METRICS.some(m => m.value === prefs.cloudMetric) ? prefs.cloudMetric : 'weakness' })
    await get().refresh()
  },

  refresh: async (silent = false) => {
    const version = ++queryVersion
    const search = get().searchInput.trim()
    set({ ...(silent ? {} : { loading: true }), error: null, search })
    try {
      const result = await window.api.queryVocabView({ search, sortBy: get().sortBy, learningFilter: get().learningFilter })
      if (version !== queryVersion) return
      set({ ...result, loading: false })
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

  setViewMode: async (viewMode) => {
    set({ viewMode, error: null })
    try { await useSettingsStore.getState().setVocabDisplay({ view: viewMode }) }
    catch { set({ error: '视图已切换，但偏好保存失败；可再次点击视图按钮重试。' }) }
  },
  setCloudMetric: async (cloudMetric) => {
    set({ cloudMetric, error: null })
    try { await useSettingsStore.getState().setVocabDisplay({ cloudMetric }) }
    catch { set({ error: '词云指标已切换，但偏好保存失败，请重新选择。' }) }
  },
  setLearningFilter: async (learningFilter) => {
    queryVersion++
    set({ learningFilter, expandedId: null })
    await get().refresh()
  },
  selectEntry: (selectedId) => set({ selectedId }),

  bindEvents: () => {
    const refreshVisible = () => {
      // 不为隐藏列表逐词/逐题重算；退出自测/切回词库时读取新快照。
      if (useUiStore.getState().view === 'vocab' && !useReviewStore.getState().visible) void get().refresh(true)
    }
    const offVocab = window.api.onVocabChanged(refreshVisible)
    const offReview = window.api.onReviewChanged(refreshVisible)
    return () => { offVocab(); offReview(); queryVersion++ }
  }
}))
