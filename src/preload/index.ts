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
  lookupWord: (id, word) => ipcRenderer.invoke(IPC.LlmLookup, id, word),
  lookupRecommendation: (id, recommendationId) => ipcRenderer.invoke(IPC.RecommendationLookup, id, recommendationId),
  getRecommendations: (request) => ipcRenderer.invoke(IPC.RecommendationGet, request),
  abortRecommendations: () => ipcRenderer.invoke(IPC.RecommendationAbort),
  recommendationFeedback: (id, kind) => ipcRenderer.invoke(IPC.RecommendationFeedback, id, kind),
  undoRecommendationFeedback: (word) => ipcRenderer.invoke(IPC.RecommendationUndo, word),
  setRecommendationPreference: (patch) => ipcRenderer.invoke(IPC.RecommendationPreference, patch),
  abortLookup: (id) => ipcRenderer.invoke(IPC.LlmLookupAbort, id),
  saveLookup: (id) => ipcRenderer.invoke(IPC.LookupSave, id),
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
  queryVocabView: (query) => ipcRenderer.invoke(IPC.VocabViewQuery, query),
  getVocabViewEntry: (id) => ipcRenderer.invoke(IPC.VocabViewEntry, id),
  onReviewChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on(IPC.ReviewChanged, listener)
    return () => ipcRenderer.removeListener(IPC.ReviewChanged, listener)
  },
  exportVocab: (format) => ipcRenderer.invoke(IPC.VocabExport, format),
  addVocab: (selections, contextSentence) => ipcRenderer.invoke(IPC.VocabAdd, selections, contextSentence),
  updateVocabNote: (id, note) => ipcRenderer.invoke(IPC.VocabUpdateNote, id, note),
  deleteVocab: (id) => ipcRenderer.invoke(IPC.VocabDelete, id),
  regenerateDetail: (id) => ipcRenderer.invoke(IPC.LlmRegenerateDetail, id),
  reviewOverview: (search) => ipcRenderer.invoke(IPC.ReviewOverview, search),
  startReview: (config) => ipcRenderer.invoke(IPC.ReviewStart, config),
  getReview: (id) => ipcRenderer.invoke(IPC.ReviewGet, id),
  revealReview: (command) => ipcRenderer.invoke(IPC.ReviewReveal, command),
  rateReview: (command, rating) => ipcRenderer.invoke(IPC.ReviewRate, command, rating),
  skipReview: (command) => ipcRenderer.invoke(IPC.ReviewSkip, command),
  undoReview: (id, revision) => ipcRenderer.invoke(IPC.ReviewUndo, id, revision),
  endReview: (id, revision) => ipcRenderer.invoke(IPC.ReviewEnd, id, revision),
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
