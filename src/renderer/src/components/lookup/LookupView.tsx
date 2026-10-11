import { useEffect, useState } from 'react'
import { BookmarkPlus, Check, Loader2, Search, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BrandMark } from '@/components/BrandMark'
import { useLookupStore } from '@/stores/lookupStore'
import { useUiStore } from '@/stores/uiStore'
import { RecommendationPanel } from './RecommendationPanel'

export function LookupView() {
  const { input, result, requestId, error, saving, setInput, search, cancel, save } = useLookupStore()
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let active = true
    let sequence = 0
    setSaved(false)
    const refresh = async () => {
      const seq = ++sequence
      try {
        const entries = await window.api.listVocab({})
        if (active && seq === sequence) setSaved(!!result && entries.some((e) => e.word.toLowerCase() === result.word.toLowerCase()))
      } catch { /* 收藏仍可重试，主进程保证幂等 */ }
    }
    void refresh()
    const off = window.api.onVocabChanged(() => void refresh())
    return () => { active = false; off() }
  }, [result])

  return <div className="page-shell max-w-3xl">
    <div className="page-heading"><p className="eyebrow">WORD EXPLORER</p><h1>一词，一次发现</h1><p>从词义到用法，读懂每一个细节。</p></div>
    <form className="flex items-center gap-2 rounded-2xl border bg-card p-2 shadow-sm" onSubmit={(e) => { e.preventDefault(); void search() }}>
      <Search className="ml-2 h-4 w-4 shrink-0 text-primary" />
      <Input aria-label="查询英文单词" placeholder="输入一个英文单词…" value={input} maxLength={160}
        onChange={(e) => setInput(e.target.value)} className="min-w-0 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0" autoComplete="off" spellCheck={false} />
      {requestId ? <Button type="button" size="sm" variant="secondary" onClick={cancel}><X className="h-3.5 w-3.5" />取消</Button>
        : <Button type="submit" size="sm" disabled={!input.trim()}>查询</Button>}
    </form>
    {requestId && <div role="status" className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-primary" />正在辨析词形，生成学习解释…</div>}
    {error && <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><p className="break-words">{error}</p><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void search()}>重试</Button><Button size="sm" variant="ghost" onClick={() => useUiStore.getState().setView('settings')}>模型设置</Button></div></div>}
    {result && <article className="min-w-0 rounded-2xl border bg-card p-4 sm:p-6 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="eyebrow">DICTIONARY</p><h2 className="word-headword text-3xl">{result.word}</h2><p className="mt-2 text-sm text-muted-foreground">{result.phonetic} <span className="ml-2 text-primary">{result.pos}</span></p></div>
        <Button size="sm" variant={saved ? 'secondary' : 'outline'} disabled={saving || saved} onClick={async () => {
          try { await save(); toast.success('已加入生词本') } catch (e) { toast.error((e as Error).message) }
        }}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}{saved ? '已收录' : '加入生词本'}</Button>
      </div>
      <p className="my-4 text-base font-medium leading-relaxed">{result.brief}</p>
      <div className="mb-5 rounded-lg bg-primary/5 p-3 text-xs leading-6 text-muted-foreground"><span className="font-medium text-primary">{result.original} → {result.word}</span><br />{result.explanation}</div>
      <div className="dictionary-prose prose prose-sm max-w-none overflow-x-auto dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result.detail}</ReactMarkdown></div>
    </article>}
    {!result && !requestId && !error && <div className="flex min-w-0 flex-col items-center gap-4 py-3 text-center">
      <BrandMark className="h-10 w-10 text-primary/70" />
      <p className="word-headword text-xl">留一点好奇，给一个新词。</p>
      <RecommendationPanel />
    </div>}
    {result && <p className="text-center text-[11px] text-muted-foreground">由当前配置的模型生成 · 无上下文时展示常见词义</p>}
  </div>
}
