import { create } from 'zustand'
import type { TranslateEvent, VocabAddResult, VocabEntry, VocabSelection } from '@shared/types'
import { getActiveLlm } from '@shared/llm'
import { detectInjection } from '@shared/injection'
import { checkOutputForInjection } from '@shared/outputCheck'
import { selectionByWordIndex, selectionKey } from '@/lib/tokenize'
import { savedSelections, selectedEntries, type PhraseRange } from '@/lib/selection'
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
  selectedWords: Set<number>
  phraseRanges: PhraseRange[]
  /** Full vocabulary index, independent of the list's search filter. */
  existedSelections: Set<string>
  catalogEntries: VocabEntry[]
  catalogStatus: 'loading' | 'ready' | 'error'
  adding: boolean
  addingRevision: number | null
  setInput: (value: string) => void
  translate: () => Promise<void>
  stop: () => void
  clear: () => void
  toggleWord: (index: number) => void
  addPhraseRange: (range: PhraseRange) => void
  removeSelection: (entry: VocabSelection) => void
  clearSelection: () => void
  addToVocab: () => Promise<VocabAddResult | null>
  refreshCatalog: () => Promise<void>
  handleEvent: (e: TranslateEvent) => void
  bindEvents: () => () => void
}

let catalogRequest = 0
function knownSelections(entries: VocabEntry[], input: string): Set<string> {
  return new Set(savedSelections(input, entries).map(selectionKey))
}
function abort(requestId: string | null): void {
  if (requestId) void window.api.abortTranslate(requestId).catch(() => { /* late events are ignored */ })
}

export const useTranslateStore = create<TranslateState>((set, get) => ({
  input: '', revision: 0, status: 'idle', output: '', error: '', requestId: null,
  outputWarning: false, selectedWords: new Set(), phraseRanges: [], existedSelections: new Set(),
  catalogStatus: 'loading', catalogEntries: [], adding: false, addingRevision: null,

  setInput: (input) => {
    if (input === get().input) return
    const previous = get().requestId
    set((s) => ({ input, revision: s.revision + 1, output: '', error: '', status: 'idle',
      requestId: null, outputWarning: false, selectedWords: new Set(), phraseRanges: [],
      existedSelections: knownSelections(s.catalogEntries, input) }))
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
      requestId: null, outputWarning: false, selectedWords: new Set(), phraseRanges: [], existedSelections: new Set() }))
    abort(requestId)
  },
  toggleWord: (index) => {
    if (get().addingRevision === get().revision) return
    if (!selectionByWordIndex(get().input, index)) return
    set((s) => {
      const next = new Set(s.selectedWords)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return { selectedWords: next }
    })
  },
  addPhraseRange: (range) => {
    if (get().addingRevision === get().revision) return
    if (!selectionByWordIndex(get().input, range.start, range.end)) return
    if (range.start === range.end) {
      get().toggleWord(range.start)
      return
    }
    set((s) => ({ phraseRanges: s.phraseRanges.some((r) => r.start === range.start && r.end === range.end)
      ? s.phraseRanges.filter((r) => !(r.start === range.start && r.end === range.end))
      : [...s.phraseRanges, range] }))
  },
  removeSelection: (entry) => {
    if (get().addingRevision === get().revision) return
    const matches = (start: number, end = start) => {
      const selection = selectionByWordIndex(get().input, start, end)
      return selection && selectionKey(selection) === selectionKey(entry)
    }
    set((s) => ({ selectedWords: new Set([...s.selectedWords].filter((index) => !matches(index))),
      phraseRanges: s.phraseRanges.filter((r) => !matches(r.start, r.end)) }))
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
        ...(s.revision === revision ? { selectedWords: new Set<number>(), phraseRanges: [] } : {})
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
      if (request === catalogRequest) set({ catalogEntries: entries, existedSelections: knownSelections(entries, get().input), catalogStatus: 'ready' })
    } catch {
      if (request === catalogRequest) set({ catalogStatus: 'error', catalogEntries: [], existedSelections: new Set() })
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
