import { create } from 'zustand'

export type AppView = 'translate' | 'vocab' | 'settings'

/**
 * 界面状态
 * 深色模式 Phase 6 将改为「浅色/深色/跟随系统」并持久化到设置
 */
type UiState = {
  dark: boolean
  toggleDark: () => void
  view: AppView
  setView: (v: AppView) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  dark: false,
  toggleDark: () => {
    const next = !get().dark
    document.documentElement.classList.toggle('dark', next)
    set({ dark: next })
  },
  view: 'translate',
  setView: (v) => set({ view: v })
}))
