import { create } from 'zustand'

import { DEFAULT_SETTINGS, type AppSettings, type LlmSettings, type TestConnectionResult } from '@shared/types'

type SettingsState = {
  settings: AppSettings
  loaded: boolean
  testing: boolean
  load: () => Promise<void>
  saveLlm: (llm: LlmSettings) => Promise<void>
  testConnection: () => Promise<TestConnectionResult>
  setAlwaysOnTop: (flag: boolean) => Promise<void>
  setOpacity: (value: number) => Promise<void>
  /** 托盘菜单切换置顶时，主进程广播同步 */
  syncAlwaysOnTop: (flag: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  testing: false,

  load: async () => {
    const settings = await window.api.getSettings()
    set({ settings, loaded: true })
  },

  saveLlm: async (llm) => {
    const next = await window.api.setSettings({ llm })
    set({ settings: next })
  },

  testConnection: async () => {
    set({ testing: true })
    try {
      return await window.api.testConnection()
    } finally {
      set({ testing: false })
    }
  },

  setAlwaysOnTop: async (flag) => {
    // 先本地即时反馈，再落主进程
    set((state) => ({
      settings: { ...state.settings, window: { ...state.settings.window, alwaysOnTop: flag } }
    }))
    await window.api.setAlwaysOnTop(flag)
  },

  setOpacity: async (value) => {
    set((state) => ({
      settings: { ...state.settings, window: { ...state.settings.window, opacity: value } }
    }))
    await window.api.setOpacity(value)
  },

  syncAlwaysOnTop: (flag) => {
    set((state) => ({
      settings: { ...state.settings, window: { ...state.settings.window, alwaysOnTop: flag } }
    }))
  }
}))
