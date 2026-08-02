import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import { IPC } from '../shared/ipc'
import type {
  RendererApi,
  TranslateChunkPayload,
  TranslateDonePayload,
  TranslateErrorPayload,
  VocabQuery
} from '../shared/types'

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
  translate: (requestId, text) => ipcRenderer.invoke(IPC.LlmTranslate, requestId, text),
  abortTranslate: (requestId) => ipcRenderer.invoke(IPC.LlmTranslateAbort, requestId),
  onTranslateEvent: (cb) => {
    const onChunk = (_e: IpcRendererEvent, p: TranslateChunkPayload) =>
      cb({ type: 'chunk', requestId: p.requestId, delta: p.delta })
    const onDone = (_e: IpcRendererEvent, p: TranslateDonePayload) =>
      cb({ type: 'done', requestId: p.requestId, fullText: p.fullText })
    const onError = (_e: IpcRendererEvent, p: TranslateErrorPayload) =>
      cb({ type: 'error', requestId: p.requestId, message: p.message })
    ipcRenderer.on(IPC.LlmTranslateChunk, onChunk)
    ipcRenderer.on(IPC.LlmTranslateDone, onDone)
    ipcRenderer.on(IPC.LlmTranslateError, onError)
    return () => {
      ipcRenderer.removeListener(IPC.LlmTranslateChunk, onChunk)
      ipcRenderer.removeListener(IPC.LlmTranslateDone, onDone)
      ipcRenderer.removeListener(IPC.LlmTranslateError, onError)
    }
  },

  // ---------- vocab ----------
  listVocab: (query: VocabQuery) => ipcRenderer.invoke(IPC.VocabList, query),
  checkWords: (words) => ipcRenderer.invoke(IPC.VocabCheckWords, words),
  addVocab: (words, contextSentence) => ipcRenderer.invoke(IPC.VocabAdd, words, contextSentence),
  updateVocabNote: (id, note) => ipcRenderer.invoke(IPC.VocabUpdateNote, id, note),
  deleteVocab: (id) => ipcRenderer.invoke(IPC.VocabDelete, id),
  regenerateDetail: (id) => ipcRenderer.invoke(IPC.LlmRegenerateDetail, id),
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
