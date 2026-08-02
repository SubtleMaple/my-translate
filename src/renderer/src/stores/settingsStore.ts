import { create } from 'zustand'

import {
  DEFAULT_SETTINGS,
  type ApiType,
  type AppSettings,
  type LlmSettings,
  type TestConnectionResult
} from '@shared/types'

type SettingsState = {
  settings: AppSettings
  loaded: boolean
  testing: boolean
  load: () => Promise<void>
  saveLlm: (llm: LlmSettings) => Promise<void>
  /** 切换 API 类型并立即持久化（两种类型配置独立保存） */
  setLlmType: (type: ApiType) => Promise<void>
  testConnection: () => Promise<TestConnectionResult>
  setAlwaysOnTop: (flag: boolean) => Promise<void>
  setOpacity: (value: number) => Promise<void>
  /** 极简模式开关（持久化，立即生效） */
  setMinimal: (flag: boolean) => Promise<void>
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

  setLlmType: async (type) => {
    const next = await window.api.setSettings({ llm: { type } })
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

  setMinimal: async (flag) => {
    set((state) => ({
      settings: { ...state.settings, ui: { ...state.settings.ui, minimal: flag } }
    }))
    await window.api.setSettings({ ui: { minimal: flag } })
  },

  syncAlwaysOnTop: (flag) => {
    set((state) => ({
      settings: { ...state.settings, window: { ...state.settings.window, alwaysOnTop: flag } }
    }))
  }
}))
