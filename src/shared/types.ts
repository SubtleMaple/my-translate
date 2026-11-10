/**
 * 主进程 / 渲染进程共享类型契约
 * 本文件只允许类型与常量，不允许任何运行时依赖
 */

// ---------------------------------------------------------------- 生词本

export type VocabStatus = 'pending' | 'ready' | 'failed'

/** 原文中的 UTF-16 字符范围：[start, end)，与 JS String.slice 一致。 */
export interface TextRange { start: number; end: number }

export interface VocabSelection extends TextRange {
  /** 选中范围内的单词按空格连接；相同文本的不同位置是不同目标。 */
  text: string
}

export interface WordSource {
  original: string
  word: string
  explanation: string
  context: string
  /** 旧来源和无上下文查词可缺省；不得据此推断所有同形词已收录。 */
  selection?: TextRange
}

export interface WordLookup extends WordSource {
  /** 主进程暂存结果的标识，收藏只接受该标识 */
  id: string
  phonetic: string
  pos: string
  brief: string
  detail: string
}

// ---------------------------------------------------------------- 个性化推荐（等级是模型估计，不是能力测评）
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
export type CefrLevel = (typeof CEFR_LEVELS)[number]
export const RECOMMENDATION_TOPICS = ['general', 'daily', 'technology', 'business', 'science', 'literature', 'academic', 'health', 'travel'] as const
export type RecommendationTopic = (typeof RECOMMENDATION_TOPICS)[number]
export const TOPIC_LABELS: Record<RecommendationTopic, string> = {
  general: '通用阅读', daily: '日常生活', technology: '科技', business: '商务经济', science: '科学',
  literature: '文学', academic: '学术', health: '健康', travel: '旅行'
}
export interface WordSenseHint { pos: string; meaning: string }
export interface CorpusWord { word: string; count: number }
export type CorpusMode = 'local' | 'ai'
export interface CorpusCandidate extends CorpusWord {
  spelling?: string
  forms?: string[]
  level?: CefrLevel
}
export interface CorpusProgress {
  skipped?: number
  id: string
  total: number
  done: number
}
export interface WordRecommendation extends WordSenseHint {
  source?: 'corpus'
  corpusEvidence?: CorpusCandidate
  id: string
  word: string
  forms: string[]
  family: string
  level: CefrLevel
  topic: RecommendationTopic
  reason: string
  /** 模型估计的实用性 1–5，用于本地排序 */
  utility: number
}
export interface RecommendationFeedback {
  word: string
  kind: 'known' | 'skip'
  topic: RecommendationTopic
  updatedAt: number
}
export interface RecommendationPage {
  corpusMode: CorpusMode
  corpusProgress: CorpusProgress | null
  corpusNotice: string
  corpusCount: number
  corpusPreview: { batch: string[]; pending: string[] }
  items: WordRecommendation[]
  /** 本批尚未消费的词数，包含当前展示的最多三个。 */
  remainingCount: number
  batchSize: number
  estimatedLevel: CefrLevel | null
  targetLevel: CefrLevel
  coldLevel: CefrLevel | null
  adjustment: number
  topics: RecommendationTopic[]
  sampleSize: number
  totalWords: number
  needsLevel: boolean
  stale: boolean
  canGenerate: boolean
  generatedAt: number
  message: string
  feedback: RecommendationFeedback[]
}
export interface RecommendationRequest {
  /** next 为旧版兼容读取；生成新批次只使用 refresh。 */
  action?: 'current' | 'next' | 'refresh'
  allowGenerate?: boolean
}
export interface RecommendationPreference {
  coldLevel?: CefrLevel
  difficulty?: 'easy' | 'right' | 'hard'
}

export interface VocabEntry {
  id: number
  /** 词典词头；旧记录保持原样 */
  word: string
  sources?: WordSource[]
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

export type VocabBaseSortBy = 'time' | 'alpha' | 'count'
export type VocabSortBy = VocabBaseSortBy | 'unfamiliar' | 'familiar' | 'risk'

export interface VocabQuery {
  search?: string
  sortBy?: VocabBaseSortBy
}

export const LEARNING_STAGES = ['fragile', 'learning', 'developing', 'stable', 'unseen'] as const
export type LearningStage = (typeof LEARNING_STAGES)[number]
export type LearningFilter = 'all' | LearningStage
export type VocabViewMode = 'list' | 'cloud' | 'groups'
export type CloudMetric = 'weakness' | 'count' | 'familiarity'
export interface LearningSummary {
  stage: LearningStage
  hasReview: boolean
  limitedEvidence: boolean
  reviewCount: number
  forgottenCount: number
  successCount: number
  stabilityDays: number | null
  recall: number | null
  risk: number | null
  lastRating: ReviewRating | null
  lastReviewAt: number | null
  dueAt: number | null
  due: boolean
  unavailable: boolean
}
export interface VocabViewEntry extends VocabEntry { learning: LearningSummary }
export interface VocabViewQuery { search?: string; sortBy?: VocabSortBy; learningFilter?: LearningFilter }
export interface VocabViewData {
  entries: VocabViewEntry[]
  evaluatedAt: number
  /** 当前搜索范围内、应用学习状态筛选前的各组数量 */
  stageCounts: Record<LearningStage, number>
  matchedCount: number
}

export interface VocabAddResult {
  normalized?: WordSource[]
  /** 成功加入（进入详情生成队列）的词 */
  added: string[]
  /** 已存在且出现次数 +1 的词（不重复生成详情） */
  existed: string[]
  /** 成功加入记录的 id（与 added 一一对应，主进程据此自动入队生成详情） */
  addedIds: number[]
}

export type VocabExportFormat = 'json' | 'csv'
export type VocabExportResult =
  | { status: 'saved'; format: VocabExportFormat; filePath: string; count: number }
  | { status: 'cancelled' }
  | { status: 'empty' }
  | { status: 'error'; message: string }

// ---------------------------------------------------------------- 本地自测 / 间隔复习
export type ReviewRating = 1 | 2 | 3 | 4
export type ReviewMode = 'smart' | 'random'
export interface ReviewConfig { mode: ReviewMode; size: number; search?: string }
export interface ReviewQuestion { id: string; entryId: number; word: string; repeat: number }
export type ReviewAnswer = Pick<VocabEntry, 'phonetic' | 'pos' | 'brief' | 'detail' | 'note' | 'contextSentence'>
export interface ReviewSummary {
  firstRatings: Record<ReviewRating, number>
  firstRated: number
  skipped: number
  extraAnswered: number
  unavailable: number
  deferred: number
  needsWork: { entryId: number; word: string; rating: ReviewRating; dueAt: number }[]
}
export interface ReviewSessionView {
  id: string
  revision: number
  status: 'active' | 'completed' | 'ended'
  config: ReviewConfig
  total: number
  processed: number
  question: ReviewQuestion | null
  answer: ReviewAnswer | null
  preview: Record<ReviewRating, number> | null
  serverNow: number
  canUndo: boolean
  summary: ReviewSummary
}
export interface ReviewOverview {
  eligible: number
  due: number
  fresh: number
  unavailable: number
  active: ReviewSessionView | null
}
/** 题目ID+revision防止迟到请求或重复评分作用于另一题。 */
export interface ReviewCommand { sessionId: string; questionId: string; revision: number }

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
export type ThemePalette = 'bamboo' | 'indigo' | 'iris' | 'amber' | 'cinnabar' | 'graphite'

export interface AppSettings {
  llm: LlmSettings
  window: WindowSettings
  ui: { theme: ThemeMode; minimal: boolean; palette: ThemePalette }
  vocab: { sortBy: VocabSortBy; view: VocabViewMode; cloudMetric: CloudMetric }
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
  ui: { theme: 'system', minimal: false, palette: 'bamboo' },
  vocab: { sortBy: 'time', view: 'list', cloudMetric: 'weakness' }
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
  lookupWord(requestId: string, word: string): Promise<WordLookup>
  lookupRecommendation(requestId: string, recommendationId: string): Promise<WordLookup>
  getRecommendations(request?: RecommendationRequest): Promise<RecommendationPage>
  importCorpus(words: CorpusWord[], mode?: CorpusMode): Promise<RecommendationPage>
  setCorpusMode(mode: CorpusMode): Promise<RecommendationPage>
  advanceCorpusReview(id: string, offset: number): Promise<RecommendationPage>
  pauseCorpusReview(id: string): Promise<void>
  discardCorpusReview(id: string): Promise<RecommendationPage>
  reviewCorpusWords(words: string[]): Promise<RecommendationPage>
  removeCorpusWords(words: string[]): Promise<RecommendationPage>
  removeCorpusWord(word: string): Promise<RecommendationPage>
  abortRecommendations(): Promise<void>
  recommendationFeedback(id: string, kind: 'known' | 'skip'): Promise<RecommendationPage>
  undoRecommendationFeedback(word: string): Promise<RecommendationPage>
  setRecommendationPreference(patch: RecommendationPreference): Promise<RecommendationPage>
  abortLookup(requestId: string): Promise<void>
  saveLookup(id: string): Promise<VocabAddResult>
  /** 发起流式翻译，结果经 onTranslateEvent 推送 */
  translate(requestId: string, text: string): Promise<void>
  abortTranslate(requestId: string): Promise<void>
  /** 订阅翻译流式事件；返回取消订阅函数 */
  onTranslateEvent(cb: (event: TranslateEvent) => void): () => void

  // ---- vocab ----
  listVocab(query: VocabQuery): Promise<VocabEntry[]>
  queryVocabView(query: VocabViewQuery): Promise<VocabViewData>
  getVocabViewEntry(id: number): Promise<{ entry: VocabViewEntry | null; evaluatedAt: number }>
  onReviewChanged(cb: () => void): () => void
  /** 主进程打开保存窗口，导出完整词库（不接受路径或搜索条件）。 */
  exportVocab(format: VocabExportFormat): Promise<VocabExportResult>
  addVocab(selections: VocabSelection[], contextSentence: string): Promise<VocabAddResult>
  updateVocabNote(id: number, note: string): Promise<void>
  deleteVocab(id: number): Promise<void>
  /** 订阅生词数据变更（增删/详情生成完成等主进程广播）；返回取消订阅函数 */
  onVocabChanged(cb: () => void): () => void
  /** 重新生成指定词的详情（失败重试 / 已 ready 词重新生成），主进程置回 pending 并入队 */
  regenerateDetail(id: number): Promise<void>

  // ---- review ----
  reviewOverview(search?: string): Promise<ReviewOverview>
  startReview(config: ReviewConfig): Promise<ReviewSessionView>
  getReview(sessionId: string): Promise<ReviewSessionView>
  revealReview(command: ReviewCommand): Promise<ReviewSessionView>
  rateReview(command: ReviewCommand, rating: ReviewRating): Promise<ReviewSessionView>
  skipReview(command: ReviewCommand): Promise<ReviewSessionView>
  undoReview(sessionId: string, revision: number): Promise<ReviewSessionView>
  endReview(sessionId: string, revision: number): Promise<ReviewSessionView>

  // ---- window ----
  setAlwaysOnTop(flag: boolean): Promise<void>
  setOpacity(value: number): Promise<void>
  minimizeWindow(): Promise<void>
  /** 关闭窗口（实际行为：隐藏到托盘） */
  closeWindow(): Promise<void>
  /** 订阅置顶状态变化（托盘菜单切换时主进程广播）；返回取消订阅函数 */
  onAlwaysOnTopChanged(cb: (flag: boolean) => void): () => void
}
