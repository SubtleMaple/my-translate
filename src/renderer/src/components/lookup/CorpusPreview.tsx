import { useEffect, useState } from 'react'
import { List, Sparkles, Trash2 } from 'lucide-react'
import { CorpusReviewProgress } from './CorpusReviewProgress'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useRecommendationStore } from '@/stores/recommendationStore'

const PAGE_SIZE = 40

export function CorpusPreview() {
  const { page, busy, importing, reviewing, error, removeCorpusWord, removeCorpusWords, reviewCorpusWords } = useRecommendationStore()
  const [pageIndex, setPageIndex] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const preview = page?.corpusPreview
  useEffect(() => {
    const live = new Set([...(preview?.batch || []), ...(preview?.pending || [])])
    setSelected(old => [...old].every(w => live.has(w)) ? old : new Set([...old].filter(w => live.has(w))))
  }, [preview])
  if (!page) return null
  const { batch, pending } = page.corpusPreview
  const total = batch.length + pending.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const index = Math.min(pageIndex, pages - 1)
  const start = index * PAGE_SIZE
  const all = [...batch, ...pending]
  const words = all.slice(start, start + PAGE_SIZE)
  const checked = all.filter(w => selected.has(w))
  const targets = checked.length ? checked : all
  const locked = busy || importing
  const toggle = (word: string) => setSelected(old => {
    const next = new Set(old)
    if (!next.delete(word)) next.add(word)
    return next
  })
  return <Dialog onOpenChange={open => { if (open) { setPageIndex(0); setSelected(new Set()) } }}>
    <DialogTrigger asChild>
      <Button variant="outline" size="sm" aria-label="预览语料词" className="h-8 gap-1.5 px-2 text-xs">
        <List className="h-3.5 w-3.5" />预览语料词（{total}）
      </Button>
    </DialogTrigger>
    <DialogContent className="gap-3">
      <DialogHeader>
        <DialogTitle>语料候选词</DialogTitle>
        <DialogDescription>本批待看 {batch.length} 个，等待组批 {pending.length} 个。</DialogDescription>
      </DialogHeader>
      {!!total && <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" aria-label="全选所有页" className="h-4 w-4 accent-primary" checked={checked.length === total}
              ref={el => { if (el) el.indeterminate = checked.length > 0 && checked.length < total }}
              onChange={e => setSelected(e.target.checked ? new Set(all) : new Set())} />全选（所有页）
          </label>
          <span className="text-xs text-muted-foreground">已选 {checked.length} / {total}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={locked || reviewing || !!page.corpusProgress || !page.canGenerate}
            onClick={() => void reviewCorpusWords(targets)}><Sparkles className="mr-1 h-3.5 w-3.5" />
            AI 精筛{checked.length ? '所选' : '全部'}（{targets.length}）</Button>
          <Button size="sm" variant="outline" className="text-destructive" disabled={locked || !checked.length}
            onClick={() => void removeCorpusWords(checked)}>删除所选（{checked.length}）</Button>
        </div>
        <p className="text-xs text-muted-foreground">{page.canGenerate ? '精筛仅发送词表和目标难度，每批最多 40 词，按模型用量计费。' : '使用 AI 精筛前，请先在设置中配置模型。'}</p>
      </div>}
      <CorpusReviewProgress />
      {page.corpusNotice && <p role="status" className="text-xs text-muted-foreground">{page.corpusNotice}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {total ? <ul className="max-h-[52vh] divide-y overflow-y-auto" key={index}>
        {words.map((word, i) => <li key={word} className="flex min-w-0 items-center gap-2 py-1">
          <label className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2">
            <input type="checkbox" aria-label={'选择 ' + word} className="h-4 w-4 shrink-0 accent-primary"
              checked={selected.has(word)} onChange={() => toggle(word)} />
            <span className="word-headword break-all">{word}</span>
          </label>
          <span className="text-xs text-muted-foreground">{start + i < batch.length ? '本批待看' : '等待组批'}</span>
          <Button size="sm" variant="ghost" disabled={busy || importing} aria-label={'删除语料词 ' + word}
            className="shrink-0 text-destructive" onClick={() => void removeCorpusWord(word)}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />删除
          </Button>
        </li>)}
      </ul> : <p className="py-4 text-sm text-muted-foreground">暂无待推荐的语料词。</p>}
      {pages > 1 && <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="outline" disabled={!index} onClick={() => setPageIndex(index - 1)}>上一页</Button>
        <span className="text-xs text-muted-foreground">{index + 1} / {pages}</span>
        <Button size="sm" variant="outline" disabled={index + 1 >= pages} onClick={() => setPageIndex(index + 1)}>下一页</Button>
      </div>}
    </DialogContent>
  </Dialog>
}
