import { create } from 'zustand'

import type { TranslateEvent, VocabAddResult } from '@shared/types'
import { getActiveLlm } from '@shared/llm'
import { detectInjection } from '@shared/injection'
import { checkOutputForInjection } from '@shared/outputCheck'
import { phraseByWordIndex, tokenize } from '@/lib/tokenize'
import { useSettingsStore } from './settingsStore'

export type TranslateStatus = 'idle' | 'loading' | 'streaming' | 'error'

/** 拖拽选中的短语范围（单词 token 序号闭区间） */
export interface PhraseRange {
  start: number
  end: number
}

/**
 * 翻译状态机 + 单词多选 + 短语拖选
 * 流式事件在 App 挂载时经 bindEvents 订阅，视图切换不丢失
 */
interface TranslateState {
  input: string
  status: TranslateStatus
  output: string
  error: string
  requestId: string | null
  /** 输出侧校验标记：输出疑似执行了输入中的指令（显示警告条，不拦截） */
  outputWarning: boolean
  /** 选中的单词（小写归一） */
  selectedWords: Set<string>
  /** 拖拽选中的短语（整段作为一条生词记录） */
  phraseRange: PhraseRange | null
  /** 本次句子中已加入生词本/词库的词（小写归一），划线提示但仍可点击再次加入（count+1） */
  existedWords: Set<string>
  confirmOpen: boolean
  adding: boolean

  setInput: (value: string) => void
  translate: () => Promise<void>
  stop: () => void
  clear: () => void
  toggleWord: (lower: string) => void
  setPhraseRange: (range: PhraseRange | null) => void
  openConfirm: () => void
  closeConfirm: () => void
  /** @returns null 表示未执行（无选中或进行中） */
  addToVocab: () => Promise<VocabAddResult | null>
  handleEvent: (e: TranslateEvent) => void
  bindEvents: () => () => void
}

export const useTranslateStore = create<TranslateState>((set, get) => ({
  input: '',
  status: 'idle',
  output: '',
  error: '',
  requestId: null,
  outputWarning: false,
  selectedWords: new Set(),
  phraseRange: null,
  existedWords: new Set(),
  confirmOpen: false,
  adding: false,

  setInput: (value) => {
    // 输入变化后分词随之变化：清空选择、短语、本次已加入标记与输出警告
    set({
      input: value,
      selectedWords: new Set(),
      phraseRange: null,
      existedWords: new Set(),
      outputWarning: false
    })
  },
  translate: async () => {
    const text = get().input.trim()
    const status = get().status
    if (!text || status === 'loading' || status === 'streaming') return

    // 输入侧注入防御：中文指令（域外输入）直接拒绝，不发起 LLM 请求
    const injection = detectInjection(text)
    if (injection.blocked) {
      set({
        status: 'error',
        error: `检测到疑似提示词注入（${injection.matches.join('、')}），已拒绝翻译。英文内容会作为普通文本翻译。`
      })
      return
    }

    const { config } = getActiveLlm(useSettingsStore.getState().settings.llm)
    if (!config.apiKey || !config.baseURL || !config.model) {
      set({ status: 'error', error: '请先在设置页配置大模型（API Key / Base URL / Model）' })
      return
    }

    const requestId = crypto.randomUUID()
    set({
      status: 'loading',
      output: '',
      error: '',
      requestId,
      outputWarning: false,
      selectedWords: new Set(),
      phraseRange: null
      // existedWords 不重置：本次句子的「已加入」划线跨翻译保留
    })
    await window.api.translate(requestId, text)
  },

  stop: () => {
    const rid = get().requestId
    if (rid) {
      void window.api.abortTranslate(rid)
      set({ status: 'idle', requestId: null })
    }
  },

  clear: () =>
    set({
      input: '',
      output: '',
      error: '',
      status: 'idle',
      requestId: null,
      outputWarning: false,
      selectedWords: new Set(),
      phraseRange: null,
      existedWords: new Set()
    }),

  toggleWord: (lower) => {
    // 已有短语选择时，点击单词先清掉短语（两种选择方式互斥）
    set((s) => {
      const next = new Set(s.selectedWords)
      if (next.has(lower)) {
        next.delete(lower)
      } else {
        next.add(lower)
      }
      return { selectedWords: next, phraseRange: null }
    })
  },

  setPhraseRange: (range) => {
    // 短语选择替代单词选择，语义单一
    set({ phraseRange: range, selectedWords: new Set() })
  },

  openConfirm: () => set({ confirmOpen: true }),
  closeConfirm: () => set({ confirmOpen: false }),

  addToVocab: async () => {
    const { selectedWords, phraseRange, input, adding } = get()
    if ((selectedWords.size === 0 && !phraseRange) || adding) return null
    const entries: string[] = [...selectedWords]
    if (phraseRange) {
      entries.push(phraseByWordIndex(input, phraseRange.start, phraseRange.end))
    }
    set({ adding: true })
    try {
      const result = await window.api.addVocab(entries, input)
      // 立即更新已收录标记（含本次新增与已存在的）
      set((s) => {
        const next = new Set(s.existedWords)
        for (const w of result.added) next.add(w.toLowerCase())
        for (const w of result.existed) next.add(w.toLowerCase())
        return { existedWords: next, selectedWords: new Set(), phraseRange: null, confirmOpen: false }
      })
      return result
    } finally {
      set({ adding: false })
    }
  },

  handleEvent: (e) => {
    if (e.requestId !== get().requestId) return
    if (e.type === 'chunk') {
      set((s) => ({ output: s.output + e.delta, status: 'streaming' }))
    } else if (e.type === 'done') {
      // 输出侧校验：中文为主的输入未整段回显 → 疑似执行了输入中的指令（仅警告，不拦截）
      const warning = checkOutputForInjection(get().input, e.fullText).flagged
      set({ status: 'idle', output: e.fullText, requestId: null, outputWarning: warning })
      // 划线只反映「本次句子已加入」，不查询词库历史（历史词仍可点击加入 count+1）
    } else {
      set({ status: 'error', error: e.message, requestId: null })
    }
  },

  bindEvents: () => window.api.onTranslateEvent((e) => get().handleEvent(e))
}))
