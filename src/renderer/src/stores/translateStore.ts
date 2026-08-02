import { create } from 'zustand'

import type { TranslateEvent, VocabAddResult } from '@shared/types'
import { getActiveLlm } from '@shared/llm'
import { phraseByWordIndex, tokenize, wordList } from '@/lib/tokenize'
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
  /** 选中的单词（小写归一） */
  selectedWords: Set<string>
  /** 拖拽选中的短语（整段作为一条生词记录） */
  phraseRange: PhraseRange | null
  /** 已收录生词（小写归一），chip 弱化展示 */
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
  selectedWords: new Set(),
  phraseRange: null,
  existedWords: new Set(),
  confirmOpen: false,
  adding: false,

  setInput: (value) => {
    // 输入变化后分词随之变化：清空选择、短语与已收录标记
    set({ input: value, selectedWords: new Set(), phraseRange: null, existedWords: new Set() })
  },

  translate: async () => {
    const text = get().input.trim()
    const status = get().status
    if (!text || status === 'loading' || status === 'streaming') return

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
      selectedWords: new Set(),
      phraseRange: null,
      existedWords: new Set()
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
      set({ status: 'idle', output: e.fullText, requestId: null })
      // 翻译完成后批量标记已收录词
      const words = wordList(get().input)
      void window.api.checkWords(words).then((found) => {
        set((s) => ({ existedWords: new Set([...s.existedWords, ...found]) }))
      })
    } else {
      set({ status: 'error', error: e.message, requestId: null })
    }
  },

  bindEvents: () => window.api.onTranslateEvent((e) => get().handleEvent(e))
}))
