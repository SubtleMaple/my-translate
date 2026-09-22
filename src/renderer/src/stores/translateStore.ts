import { create } from 'zustand'
import type { TranslateEvent, VocabAddResult } from '@shared/types'
import { getActiveLlm } from '@shared/llm'
import { detectInjection } from '@shared/injection'
import { checkOutputForInjection } from '@shared/outputCheck'
import { phraseByWordIndex } from '@/lib/tokenize'
import { selectedEntries, type PhraseRange } from '@/lib/selection'
import { useSettingsStore } from './settingsStore'

export type { PhraseRange } from '@/lib/selection'
export type TranslateStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'stopped' | 'error'

interface TranslateState {
  input: string
  revision: number
  status: TranslateStatus
  output: string
  error: string
  requestId: string | null
  outputWarning: boolean
  selectedWords: Set<string>
  phraseRanges: PhraseRange[]
  /** Full vocabulary index, independent of the list's search filter. */
  existedWords: Set<string>
  catalogStatus: 'loading' | 'ready' | 'error'
  adding: boolean
  addingRevision: number | null
  setInput: (value: string) => void
  translate: () => Promise<void>
  stop: () => void
  clear: () => void
  toggleWord: (lower: string) => void
  addPhraseRange: (range: PhraseRange) => void
  removeSelection: (entry: string) => void
  clearSelection: () => void
  addToVocab: () => Promise<VocabAddResult | null>
  refreshCatalog: () => Promise<void>
  handleEvent: (e: TranslateEvent) => void
  bindEvents: () => () => void
}

let catalogRequest = 0
function abort(requestId: string | null): void {
  if (requestId) void window.api.abortTranslate(requestId).catch(() => { /* late events are ignored */ })
}

export const useTranslateStore = create<TranslateState>((set, get) => ({
  input: '', revision: 0, status: 'idle', output: '', error: '', requestId: null,
  outputWarning: false, selectedWords: new Set(), phraseRanges: [], existedWords: new Set(),
  catalogStatus: 'loading', adding: false, addingRevision: null,

  setInput: (input) => {
    if (input === get().input) return
    const previous = get().requestId
    set((s) => ({ input, revision: s.revision + 1, output: '', error: '', status: 'idle',
      requestId: null, outputWarning: false, selectedWords: new Set(), phraseRanges: [] }))
    abort(previous)
  },
  translate: async () => {
    const { input, status } = get()
    const text = input.trim()
    if (!text || status === 'loading' || status === 'streaming') return
    set({ output: '', outputWarning: false, error: '', requestId: null })
    const injection = detectInjection(text)
    if (injection.blocked) {
      set({ status: 'error', error: `检测到疑似提示词注入（${injection.matches.join('、')}），已拒绝翻译。英文内容会作为普通文本翻译。` })
      return
    }
    const { config } = getActiveLlm(useSettingsStore.getState().settings.llm)
    if (!config.apiKey || !config.baseURL || !config.model) {
      set({ status: 'error', error: '请先在设置页配置大模型（API Key / Base URL / Model）' })
      return
    }
    const requestId = crypto.randomUUID()
    set({ status: 'loading', requestId })
    try {
      await window.api.translate(requestId, text)
    } catch {
      if (get().requestId === requestId) set({ status: 'error', requestId: null, error: '翻译请求未能发出，请重试。' })
    }
  },
  stop: () => {
    const requestId = get().requestId
    if (!requestId) return
    set({ status: 'stopped', requestId: null })
    abort(requestId)
  },
  clear: () => {
    const requestId = get().requestId
    set((s) => ({ input: '', revision: s.revision + 1, output: '', error: '', status: 'idle',
      requestId: null, outputWarning: false, selectedWords: new Set(), phraseRanges: [] }))
    abort(requestId)
  },
  toggleWord: (word) => {
    if (get().addingRevision === get().revision) return
    const lower = word.toLowerCase()
    set((s) => {
      const next = new Set(s.selectedWords)
      if (next.has(lower)) next.delete(lower)
      else next.add(lower)
      return { selectedWords: next }
    })
  },
  addPhraseRange: (range) => {
    if (get().addingRevision === get().revision) return
    if (range.start === range.end) {
      get().toggleWord(phraseByWordIndex(get().input, range.start, range.end).toLowerCase())
      return
    }
    set((s) => ({ phraseRanges: s.phraseRanges.some((r) => r.start === range.start && r.end === range.end)
      ? s.phraseRanges.filter((r) => !(r.start === range.start && r.end === range.end))
      : [...s.phraseRanges, range] }))
  },
  removeSelection: (entry) => {
    if (get().addingRevision === get().revision) return
    const lower = entry.toLowerCase()
    set((s) => ({ selectedWords: new Set([...s.selectedWords].filter((w) => w !== lower)),
      phraseRanges: s.phraseRanges.filter((r) => phraseByWordIndex(s.input, r.start, r.end).toLowerCase() !== lower) }))
  },
  clearSelection: () => {
    if (get().addingRevision !== get().revision) set({ selectedWords: new Set(), phraseRanges: [] })
  },
  addToVocab: async () => {
    const { selectedWords, phraseRanges, input, revision, adding } = get()
    const entries = selectedEntries(input, selectedWords, phraseRanges)
    if (!entries.length || adding) return null
    set({ adding: true, addingRevision: revision })
    try {
      const result = await window.api.addVocab(entries, input)
      catalogRequest += 1
      set((s) => ({
        existedWords: new Set([...s.existedWords, ...result.added.map((w) => w.toLowerCase()), ...result.existed.map((w) => w.toLowerCase())]),
        ...(s.revision === revision ? { selectedWords: new Set<string>(), phraseRanges: [] } : {})
      }))
      void get().refreshCatalog()
      return result
    } finally {
      set({ adding: false, addingRevision: null })
    }
  },
  refreshCatalog: async () => {
    const request = ++catalogRequest
    try {
      const entries = await window.api.listVocab({})
      if (request === catalogRequest) set({ existedWords: new Set(entries.map((e) => e.word.trim().toLowerCase())), catalogStatus: 'ready' })
    } catch {
      if (request === catalogRequest) set({ catalogStatus: 'error', existedWords: new Set() })
    }
  },
  handleEvent: (e) => {
    if (e.requestId !== get().requestId) return
    if (e.type === 'chunk') set((s) => ({ output: s.output + e.delta, status: 'streaming' }))
    else if (e.type === 'done') set({ status: 'done', output: e.fullText, requestId: null,
      outputWarning: checkOutputForInjection(get().input, e.fullText).flagged })
    else set({ status: 'error', error: e.message, requestId: null })
  },
  bindEvents: () => {
    const offTranslate = window.api.onTranslateEvent((e) => get().handleEvent(e))
    const offVocab = window.api.onVocabChanged(() => { void get().refreshCatalog() })
    void get().refreshCatalog()
    return () => { offTranslate(); offVocab(); catalogRequest += 1 }
  }
}))
