import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import { IPC } from '../shared/ipc'
import type { RendererApi, VocabQuery } from '../shared/types'

/**
 * 渲染进程唯一能力入口：window.api
 * 方法白名单严格对应 src/shared/types.ts 的 RendererApi 契约
 */
const api: RendererApi = {
  platform: process.platform,

  // ---------- settings ----------
  getSettings: () => ipcRenderer.invoke(IPC.SettingsGet),
  setSettings: (patch) => ipcRenderer.invoke(IPC.SettingsSet, patch),

  // ---------- llm ----------
  testConnection: () => ipcRenderer.invoke(IPC.LlmTestConnection),

  // ---------- vocab ----------
  listVocab: (query: VocabQuery) => ipcRenderer.invoke(IPC.VocabList, query),
  checkWords: (words) => ipcRenderer.invoke(IPC.VocabCheckWords, words),
  addVocab: (words, contextSentence) => ipcRenderer.invoke(IPC.VocabAdd, words, contextSentence),
  updateVocabNote: (id, note) => ipcRenderer.invoke(IPC.VocabUpdateNote, id, note),
  deleteVocab: (id) => ipcRenderer.invoke(IPC.VocabDelete, id),
  onVocabChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on(IPC.VocabChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC.VocabChanged, listener)
    }
  },

  // ---------- window ----------
  setAlwaysOnTop: (flag) => ipcRenderer.invoke(IPC.WindowSetAlwaysOnTop, flag),
  setOpacity: (value) => ipcRenderer.invoke(IPC.WindowSetOpacity, value),
  minimizeWindow: () => ipcRenderer.invoke(IPC.WindowMinimize),
  closeWindow: () => ipcRenderer.invoke(IPC.WindowClose),
  onAlwaysOnTopChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, flag: boolean) => cb(flag)
    ipcRenderer.on(IPC.WindowAlwaysOnTopChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC.WindowAlwaysOnTopChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
