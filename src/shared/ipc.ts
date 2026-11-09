/**
 * IPC 频道名常量：主进程 handle / 渲染进程 invoke 的唯一来源
 * 禁止在业务代码中硬编码频道字符串
 */
export const IPC = {
  // ---------- settings（渲染 → 主，invoke/handle） ----------
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',

  // ---------- llm ----------
  LlmTranslate: 'llm:translate',
  LlmTranslateAbort: 'llm:translate:abort',
  LlmTestConnection: 'llm:test-connection',
  LlmRegenerateDetail: 'llm:regenerate-detail',
  LlmLookup: 'llm:lookup',
  LlmLookupAbort: 'llm:lookup:abort',
  LookupSave: 'lookup:save',
  RecommendationGet: 'recommendation:get', // RecommendationPage：最多三张卡片 + 本批剩余数
  RecommendationAbort: 'recommendation:abort',
  RecommendationFeedback: 'recommendation:feedback',
  RecommendationUndo: 'recommendation:undo',
  RecommendationPreference: 'recommendation:preference',
  RecommendationLookup: 'recommendation:lookup',
  // 主 → 渲染（webContents.send）
  LlmTranslateChunk: 'llm:translate:chunk',
  LlmTranslateDone: 'llm:translate:done',
  LlmTranslateError: 'llm:translate:error',

  // ---------- vocab ----------
  VocabList: 'vocab:list',
  VocabViewQuery: 'vocab:view-query',
  VocabViewEntry: 'vocab:view-entry',
  VocabExport: 'vocab:export',
  VocabAdd: 'vocab:add', // VocabSelection[] + 原文，必须携带每个目标的位置
  VocabUpdateNote: 'vocab:update-note',
  VocabDelete: 'vocab:delete',
  // 主 → 渲染
  VocabChanged: 'vocab:changed',

  ReviewOverview: 'review:overview',
  ReviewStart: 'review:start',
  ReviewGet: 'review:get',
  ReviewReveal: 'review:reveal',
  ReviewRate: 'review:rate',
  ReviewSkip: 'review:skip',
  ReviewUndo: 'review:undo',
  ReviewEnd: 'review:end',
  ReviewChanged: 'review:changed',

  // ---------- window ----------
  WindowSetAlwaysOnTop: 'window:set-always-on-top',
  WindowSetOpacity: 'window:set-opacity',
  WindowMinimize: 'window:minimize',
  WindowClose: 'window:close',
  // 主 → 渲染
  WindowAlwaysOnTopChanged: 'window:always-on-top-changed'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
