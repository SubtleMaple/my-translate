import { create } from 'zustand'
import { toast } from 'sonner'
import { useSettingsStore } from './settingsStore'

export type AppView = 'translate' | 'lookup' | 'vocab' | 'settings'

/** 临时界面状态；主题偏好由 settingsStore 持久化，ThemeSync 同步系统。 */
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
    void useSettingsStore.getState().setAppearance({ theme: next ? 'dark' : 'light' }).catch(() => toast.error('外观保存失败'))
  },
  view: 'translate',
  setView: (v) => set({ view: v })
}))
