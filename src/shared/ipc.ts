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
  // 主 → 渲染（webContents.send）
  LlmTranslateChunk: 'llm:translate:chunk',
  LlmTranslateDone: 'llm:translate:done',
  LlmTranslateError: 'llm:translate:error',

  // ---------- vocab ----------
  VocabList: 'vocab:list',
  VocabAdd: 'vocab:add',
  VocabUpdateNote: 'vocab:update-note',
  VocabDelete: 'vocab:delete',
  // 主 → 渲染
  VocabChanged: 'vocab:changed',

  // ---------- window ----------
  WindowSetAlwaysOnTop: 'window:set-always-on-top',
  WindowSetOpacity: 'window:set-opacity',
  WindowMinimize: 'window:minimize',
  WindowClose: 'window:close',
  // 主 → 渲染
  WindowAlwaysOnTopChanged: 'window:always-on-top-changed'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
