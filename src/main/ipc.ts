import { app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'

import { IPC } from '../shared/ipc'
import type { AppSettings, DeepPartial, VocabQuery, VocabSelection, RecommendationRequest, RecommendationPreference } from '../shared/types'
import { getSettings, updateSettings } from './settings'
import { testConnection } from './llm/client'
import { abortTranslate, runTranslate } from './llm/translate'
import { refreshTrayMenu } from './tray'
import {
  applyAlwaysOnTop,
  applyMinimalMode,
  applyOpacity,
  clampOpacity,
  getMainWindow
} from './window'
import {
  addNormalizedVocab,
  deleteVocab,
  listVocab,
  updateVocabNote
} from './db/vocabRepo'
import {
  enqueueDetail,
  regenerateDetail,
  setVocabChangedListener
} from './services/vocabService'
import { normalizeSelections } from './llm/normalizeWord'
import { abortLookup, lookupWord, saveLookup } from './services/lookupService'
import { abortRecommendations, getRecommendations, recommendationFeedback, recommendedLookupTarget, setRecommendationPreference, undoRecommendationFeedback } from './services/recommendationService'
import { createVocabExporter } from './services/vocabExportService'
import { createReviewService } from './services/reviewService'
import { getVocabViewEntry, queryVocabView } from './services/vocabViewService'

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
  // 详情生成队列的变更回调 → 广播渲染端（避免 vocabService ↔ ipc 循环依赖）
  setVocabChangedListener(broadcastVocabChanged)

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
    if (patch.ui?.minimal !== undefined) {
      // 极简模式：动态调整窗口最小尺寸（自动缩小 / 退出恢复）
      applyMinimalMode(patch.ui.minimal)
    }
    return next
  })

  // ---------- llm ----------
  ipcMain.handle(IPC.LlmTestConnection, () => testConnection(getSettings().llm))
  ipcMain.handle(IPC.LlmLookup, (_e, id: string, word: string) => {
    abortRecommendations()
    return lookupWord(id, word)
  })
  ipcMain.handle(IPC.LlmLookupAbort, (_e, id: string) => abortLookup(id))
  ipcMain.handle(IPC.RecommendationGet, (_e, request?: RecommendationRequest) => getRecommendations(request))
  ipcMain.handle(IPC.RecommendationAbort, () => abortRecommendations())
  ipcMain.handle(IPC.RecommendationFeedback, (_e, id: string, kind: 'known' | 'skip') => recommendationFeedback(id, kind))
  ipcMain.handle(IPC.RecommendationUndo, (_e, word: string) => undoRecommendationFeedback(word))
  ipcMain.handle(IPC.RecommendationPreference, (_e, patch: RecommendationPreference) => setRecommendationPreference(patch))
  ipcMain.handle(IPC.RecommendationLookup, (_e, requestId: string, id: string) => {
    abortRecommendations()
    const item = recommendedLookupTarget(id)
    return lookupWord(requestId, item.word, { pos: item.pos, meaning: item.meaning })
  })
  ipcMain.handle(IPC.LookupSave, (_e, id: string) => {
    const result = saveLookup(id)
    broadcastVocabChanged()
    return result
  })

  ipcMain.handle(IPC.LlmTranslate, (_e, requestId: string, text: string) => {
    // 事件流经 webContents.send 推送给发起请求的窗口
    const win = getMainWindow()
    void runTranslate(requestId, text, getSettings().llm, {
      chunk: (delta) => win?.webContents.send(IPC.LlmTranslateChunk, { requestId, delta }),
      done: (fullText) => win?.webContents.send(IPC.LlmTranslateDone, { requestId, fullText }),
      error: (message) => win?.webContents.send(IPC.LlmTranslateError, { requestId, message })
    })
  })

  ipcMain.handle(IPC.LlmTranslateAbort, (_e, requestId: string) => abortTranslate(requestId))

  // ---------- vocab ----------
  ipcMain.handle(IPC.VocabList, (_e, query: VocabQuery = {}) => listVocab(query))
  ipcMain.handle(IPC.VocabViewQuery, (_e, query) => queryVocabView(query))
  ipcMain.handle(IPC.VocabViewEntry, (_e, id: number) => getVocabViewEntry(id))
  const exportVocab = createVocabExporter({
    readAll: () => listVocab({ sortBy: 'alpha' }),
    appVersion: () => app.getVersion(),
    chooseFile: async (format, defaultName) => {
      const win = getMainWindow()
      if (!win || win.isDestroyed()) throw Error('窗口不可用')
      const result = await dialog.showSaveDialog(win, {
        title: '导出全部词条',
        defaultPath: join(app.getPath('documents'), defaultName),
        buttonLabel: '导出',
        filters: [{ name: format === 'json' ? 'JSON 完整词库' : 'CSV 表格数据', extensions: [format] }],
        properties: ['showOverwriteConfirmation', 'createDirectory']
      })
      return result.canceled ? null : result.filePath || null
    }
  })
  ipcMain.handle(IPC.VocabExport, (_e, format) => exportVocab(format))

  const review = createReviewService(undefined, undefined, () => getMainWindow()?.webContents.send(IPC.ReviewChanged))
  ipcMain.handle(IPC.ReviewOverview, (_e, search) => review.overview(search))
  ipcMain.handle(IPC.ReviewStart, (_e, config) => review.start(config))
  ipcMain.handle(IPC.ReviewGet, (_e, id) => review.get(id))
  ipcMain.handle(IPC.ReviewReveal, (_e, command) => review.reveal(command))
  ipcMain.handle(IPC.ReviewRate, (_e, command, rating) => review.rate(command, rating))
  ipcMain.handle(IPC.ReviewSkip, (_e, command) => review.skip(command))
  ipcMain.handle(IPC.ReviewUndo, (_e, id, revision) => review.undo(id, revision))
  ipcMain.handle(IPC.ReviewEnd, (_e, id, revision) => review.end(id, revision))

  ipcMain.handle(IPC.VocabAdd, async (_e, selections: VocabSelection[], contextSentence: string) => {
    const sources = await normalizeSelections(selections, contextSentence, getSettings().llm)
    const result = addNormalizedVocab(sources)
    // 详情生成队列在后台串行跑，不阻塞本次 invoke 返回
    for (const id of result.addedIds) enqueueDetail(id)
    broadcastVocabChanged()
    return result
  })

  ipcMain.handle(IPC.LlmRegenerateDetail, (_e, id: number) => {
    regenerateDetail(id)
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
