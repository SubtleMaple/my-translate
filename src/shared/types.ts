/**
 * 主进程 / 渲染进程共享类型契约
 * 本文件只允许类型与常量，不允许任何运行时依赖
 */

// ---------------------------------------------------------------- 生词本

export type VocabStatus = 'pending' | 'ready' | 'failed'

export interface VocabEntry {
  id: number
  /** 原始选中的词形（保留大小写） */
  word: string
  phonetic: string
  /** 词性 */
  pos: string
  /** 简要释义（卡片展示） */
  brief: string
  /** 完整 Markdown 详情 */
  detail: string
  /** 用户备注 */
  note: string
  /** 详情生成状态机：pending=生成中 / ready=完成 / failed=失败可重试 */
  status: VocabStatus
  /** 选中该词时的原句 */
  contextSentence: string
  /** 生成失败原因 */
  failReason: string
  /** 出现次数（重复加入时 +1） */
  count: number
  /** 毫秒时间戳 */
  createdAt: number
  updatedAt: number
}

export type VocabSortBy = 'time' | 'alpha' | 'count'

export interface VocabQuery {
  search?: string
  sortBy?: VocabSortBy
}

export interface VocabAddResult {
  /** 成功加入（进入详情生成队列）的词 */
  added: string[]
  /** 已存在而被跳过的词 */
  existed: string[]
  /** 成功加入记录的 id（与 added 一一对应，主进程据此自动入队生成详情） */
  addedIds: number[]
}

// ---------------------------------------------------------------- 设置

/** API 提供商类型：OpenAI 兼容 / Anthropic messages */
export type ApiType = 'openai' | 'anthropic'

export interface LlmProviderConfig {
  baseURL: string
  apiKey: string
  model: string
  /**
   * 思考模式：'auto'=跟随模型默认（不发送任何参数）；
   * 'off'=关闭思考模式（OpenAI/Anthropic 格式均发 thinking:{type:"disabled"}，
   * 适用于 deepseek-v4-flash 等思考型模型，显著加速响应）
   */
  thinking: 'auto' | 'off'
}

export interface LlmSettings {
  /** 当前生效的提供商类型 */
  type: ApiType
  /** OpenAI 兼容配置（Base URL 需以 /v1 结尾） */
  openai: LlmProviderConfig
  /** Anthropic 配置（messages API，Base URL 以 /v1 结尾，如 https://api.anthropic.com/v1） */
  anthropic: LlmProviderConfig
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowSettings {
  alwaysOnTop: boolean
  /** 0.5 - 1.0 */
  opacity: number
  bounds: WindowBounds | null
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppSettings {
  llm: LlmSettings
  window: WindowSettings
  ui: { theme: ThemeMode; minimal: boolean }
  vocab: { sortBy: VocabSortBy }
}

export const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    type: 'openai',
    openai: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      thinking: 'auto'
    },
    anthropic: {
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: '',
      model: 'claude-sonnet-4-20250514',
      thinking: 'auto'
    }
  },
  window: {
    alwaysOnTop: false,
    opacity: 1.0,
    bounds: null
  },
  ui: { theme: 'system', minimal: false },
  vocab: { sortBy: 'time' }
}

// ---------------------------------------------------------------- 工具

/** 递归 Partial，用于设置项局部更新 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

// ---------------------------------------------------------------- LLM

export interface TestConnectionResult {
  ok: boolean
  message: string
}

/** 主进程 → 渲染进程 的翻译流式事件负载 */
export interface TranslateChunkPayload {
  requestId: string
  delta: string
}

export interface TranslateDonePayload {
  requestId: string
  fullText: string
}

export interface TranslateErrorPayload {
  requestId: string
  message: string
}

/** 渲染端统一订阅的翻译事件 */
export type TranslateEvent =
  | { type: 'chunk'; requestId: string; delta: string }
  | { type: 'done'; requestId: string; fullText: string }
  | { type: 'error'; requestId: string; message: string }

// ---------------------------------------------------------------- 渲染进程可调用的 API（preload 暴露）

export interface RendererApi {
  /** 当前平台 */
  platform: string

  // ---- settings ----
  getSettings(): Promise<AppSettings>
  setSettings(patch: DeepPartial<AppSettings>): Promise<AppSettings>

  // ---- llm ----
  testConnection(): Promise<TestConnectionResult>
  /** 发起流式翻译，结果经 onTranslateEvent 推送 */
  translate(requestId: string, text: string): Promise<void>
  abortTranslate(requestId: string): Promise<void>
  /** 订阅翻译流式事件；返回取消订阅函数 */
  onTranslateEvent(cb: (event: TranslateEvent) => void): () => void

  // ---- vocab ----
  listVocab(query: VocabQuery): Promise<VocabEntry[]>
  /** 批量返回已存在（小写归一）的词 */
  checkWords(words: string[]): Promise<string[]>
  addVocab(words: string[], contextSentence: string): Promise<VocabAddResult>
  updateVocabNote(id: number, note: string): Promise<void>
  deleteVocab(id: number): Promise<void>
  /** 订阅生词数据变更（增删/详情生成完成等主进程广播）；返回取消订阅函数 */
  onVocabChanged(cb: () => void): () => void
  /** 重新生成指定词的详情（失败重试 / 已 ready 词重新生成），主进程置回 pending 并入队 */
  regenerateDetail(id: number): Promise<void>

  // ---- window ----
  setAlwaysOnTop(flag: boolean): Promise<void>
  setOpacity(value: number): Promise<void>
  minimizeWindow(): Promise<void>
  /** 关闭窗口（实际行为：隐藏到托盘） */
  closeWindow(): Promise<void>
  /** 订阅置顶状态变化（托盘菜单切换时主进程广播）；返回取消订阅函数 */
  onAlwaysOnTopChanged(cb: (flag: boolean) => void): () => void
}
