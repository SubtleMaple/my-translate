import { ipcMain } from 'electron'

import { IPC } from '../shared/ipc'
import type { AppSettings, DeepPartial, VocabQuery } from '../shared/types'
import { getSettings, updateSettings } from './settings'
import { testConnection } from './llm/client'
import { refreshTrayMenu } from './tray'
import {
  applyAlwaysOnTop,
  applyOpacity,
  clampOpacity,
  getMainWindow
} from './window'
import {
  addVocab,
  checkWords,
  deleteVocab,
  listVocab,
  updateVocabNote
} from './db/vocabRepo'

/**
 * 集中注册全部 IPC handler
 * 窗口相关的「编排逻辑」（应用设置 → 作用到窗口 → 同步托盘/渲染端）放在这里，
 * window.ts / tray.ts 只保留原语，避免循环依赖
 */

function syncAlwaysOnTop(flag: boolean): void {
  const win = getMainWindow()
  applyAlwaysOnTop(flag)
  refreshTrayMenu()
  win?.webContents.send(IPC.WindowAlwaysOnTopChanged, flag)
}

function broadcastVocabChanged(): void {
  getMainWindow()?.webContents.send(IPC.VocabChanged)
}

export function registerIpcHandlers(): void {
  // ---------- settings ----------
  ipcMain.handle(IPC.SettingsGet, () => getSettings())

  ipcMain.handle(IPC.SettingsSet, (_e, patch: DeepPartial<AppSettings>) => {
    const next = updateSettings(patch)
    // 窗口类设置即时生效
    if (patch.window?.alwaysOnTop !== undefined) {
      syncAlwaysOnTop(patch.window.alwaysOnTop)
    }
    if (patch.window?.opacity !== undefined) {
      applyOpacity(patch.window.opacity)
    }
    return next
  })

  // ---------- llm ----------
  ipcMain.handle(IPC.LlmTestConnection, () => testConnection(getSettings().llm))

  // ---------- vocab ----------
  ipcMain.handle(IPC.VocabList, (_e, query: VocabQuery = {}) => listVocab(query))

  ipcMain.handle(IPC.VocabCheckWords, (_e, words: string[]) => checkWords(words))

  ipcMain.handle(IPC.VocabAdd, (_e, words: string[], contextSentence: string) => {
    const result = addVocab(words, contextSentence)
    broadcastVocabChanged()
    return result
  })

  ipcMain.handle(IPC.VocabUpdateNote, (_e, id: number, note: string) => {
    updateVocabNote(id, note)
    broadcastVocabChanged()
  })

  ipcMain.handle(IPC.VocabDelete, (_e, id: number) => {
    deleteVocab(id)
    broadcastVocabChanged()
  })

  // ---------- window ----------
  ipcMain.handle(IPC.WindowSetAlwaysOnTop, (_e, flag: boolean) => {
    updateSettings({ window: { alwaysOnTop: flag } })
    syncAlwaysOnTop(flag)
  })

  ipcMain.handle(IPC.WindowSetOpacity, (_e, value: number) => {
    const v = clampOpacity(value)
    updateSettings({ window: { opacity: v } })
    applyOpacity(v)
  })

  ipcMain.handle(IPC.WindowMinimize, () => {
    getMainWindow()?.minimize()
  })

  ipcMain.handle(IPC.WindowClose, () => {
    // 关闭行为由 window.ts 的 close 拦截统一处理（隐藏到托盘）
    getMainWindow()?.close()
  })
}
