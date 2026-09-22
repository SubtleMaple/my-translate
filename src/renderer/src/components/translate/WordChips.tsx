import { useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkPlus, Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { tokenize, type WordToken } from '@/lib/tokenize'
import { savedPhrases, selectedEntries } from '@/lib/selection'
import { useTranslateStore, type PhraseRange } from '@/stores/translateStore'

interface DragState { startIdx: number; startX: number; startY: number; dragging: boolean; currentIdx: number }

export function WordChips() {
  const { input, selectedWords, phraseRanges, existedWords, catalogStatus, adding, addingRevision, revision,
    toggleWord, addPhraseRange, removeSelection, clearSelection, addToVocab, refreshCatalog } = useTranslateStore()
  const tokens = useMemo(() => tokenize(input), [input])
  const entries = useMemo(() => selectedEntries(input, selectedWords, phraseRanges), [input, selectedWords, phraseRanges])
  const phrases = useMemo(() => savedPhrases(input, existedWords), [input, existedWords])
  const locked = addingRevision === revision
  const dragRef = useRef<DragState | null>(null)
  const suppressClick = useRef(false)
  const [liveRange, setLiveRange] = useState<PhraseRange | null>(null)

  useEffect(() => {
    dragRef.current = null
    setLiveRange(null)
    const cancel = () => { dragRef.current = null; setLiveRange(null) }
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      if (!d.dragging && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) <= 4) return
      d.dragging = true
      setLiveRange({ start: Math.min(d.startIdx, d.currentIdx), end: Math.max(d.startIdx, d.currentIdx) })
    }
    const onUp = () => {
      const d = dragRef.current
      cancel()
      if (d?.dragging) {
        suppressClick.current = true
        addPhraseRange({ start: Math.min(d.startIdx, d.currentIdx), end: Math.max(d.startIdx, d.currentIdx) })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    return () => {
      cancel()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
    }
  }, [addPhraseRange, revision])

  const startDrag = (idx: number, e: React.PointerEvent) => {
    if (e.button !== 0 || locked) return
    suppressClick.current = false
    dragRef.current = { startIdx: idx, startX: e.clientX, startY: e.clientY, dragging: false, currentIdx: idx }
  }
  const handleClick = (t: WordToken) => {
    if (suppressClick.current) { suppressClick.current = false; return }
    toggleWord(t.text.toLowerCase())
  }
  const add = async () => {
    try {
      const result = await addToVocab()
      if (!result) return
      const parts = []
      if (result.added.length) parts.push(`新收录 ${result.added.length} 条，详情正在生成`)
      if (result.existed.length) parts.push(`${result.existed.length} 条已收录，出现次数 +1`)
      toast.success(parts.join('；'))
    } catch { toast.error('加入失败，已保留选择，请重试') }
  }
  let wordIdx = -1
  if (!tokens.some((t) => t.type === 'word')) return null
  return (
    <section className="min-w-0 rounded-xl border bg-card" aria-label="摘录生词">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
        <div>
          <h2 className="text-sm font-semibold">摘录生词</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">点选单词 · 拖选短语 · ✓ 已收录</p>
        </div>
        <Button size="sm" disabled={!entries.length || adding} onClick={() => void add()}>
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
          {adding ? '保存中' : entries.length ? `加入 ${entries.length} 条` : '加入生词本'}
        </Button>
      </div>
      <div className="p-3">
        {catalogStatus !== 'ready' && <p className="mb-2 text-xs text-muted-foreground" role="status">
          {catalogStatus === 'loading' ? '正在核对收录状态…' : '收录状态暂不可用'}
          {catalogStatus === 'error' && <button className="ml-2 underline" onClick={() => void refreshCatalog()}>重试</button>}
        </p>}
        <div className="max-h-56 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-sm leading-[2.4]">
          {tokens.map((t, i) => {
            if (t.type === 'text') return <span key={i}>{t.text}</span>
            const idx = ++wordIdx
            const lower = t.text.toLowerCase()
            const existed = existedWords.has(lower)
            const selected = selectedWords.has(lower) || phraseRanges.some((r) => idx >= r.start && idx <= r.end)
            const live = liveRange && idx >= liveRange.start && idx <= liveRange.end
            return <button key={i} type="button" disabled={locked} aria-pressed={selected}
              title={existed ? `${t.text} · 已收录，再次加入会使出现次数 +1` : `选择 ${t.text}`}
              className={cn('mx-0.5 inline-flex max-w-full select-none items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline leading-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected || live ? 'border-primary bg-primary text-primary-foreground' : existed ? 'border-primary/25 bg-primary/5 text-primary hover:bg-primary/10' : 'border-transparent bg-secondary/60 hover:border-border hover:bg-accent')}
              onPointerDown={(e) => startDrag(idx, e)}
              onPointerEnter={() => { if (dragRef.current) dragRef.current.currentIdx = idx }}
              onClick={() => handleClick(t)}>
              <span className="min-w-0 break-all">{t.text}</span>{existed && <Check className="h-3 w-3 shrink-0" />}
            </button>
          })}
        </div>
        {phrases.length > 0 && <p className="mt-2 break-words text-xs text-primary">已收录短语：{phrases.join(' · ')}</p>}
      </div>
      {entries.length > 0 && <div className="space-y-2 border-t bg-muted/30 p-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground"><span>待加入 {entries.length} 条 · 已去重</span><button disabled={locked} onClick={clearSelection} className="hover:text-foreground">取消选择</button></div>
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
          {entries.map((entry) => <button key={entry.toLowerCase()} disabled={locked} onClick={() => removeSelection(entry)} title={`取消选择 ${entry}`} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs">
            <span className="min-w-0 break-words">{entry}</span>{existedWords.has(entry.toLowerCase()) && <span className="shrink-0 text-muted-foreground">+1</span>}<X className="h-3 w-3 shrink-0" />
          </button>)}
        </div>
      </div>}
    </section>
  )
}
