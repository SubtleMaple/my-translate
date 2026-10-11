import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { VocabViewEntry } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useVocabStore } from '@/stores/vocabStore'
import { VocabDetail } from './VocabDetail'
import { LearningInfo } from './LearningInfo'

export function VocabEntryDialog() {
  const id = useVocabStore(s => s.selectedId)
  const select = useVocabStore(s => s.selectEntry)
  const [entry, setEntry] = useState<VocabViewEntry | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    setEntry(null); setError('')
    if (id === null) return
    let live = true, serial = 0
    const load = async () => {
      const request = ++serial
      try {
        const result = await window.api.getVocabViewEntry(id)
        if (!live || request !== serial) return
        if (!result.entry) { select(null); return }
        setEntry(result.entry); setError('')
      } catch { if (live && request === serial) setError('词条详情加载失败，请重试。') }
    }
    void load()
    const offVocab = window.api.onVocabChanged(() => void load())
    const offReview = window.api.onReviewChanged(() => void load())
    return () => { live = false; offVocab(); offReview() }
  }, [id, retry, select])
  return <Dialog open={id !== null} onOpenChange={open => { if (!open) select(null) }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto [overflow-wrap:anywhere]">
      <DialogHeader><DialogTitle className="break-words">{entry?.word || '词条详情'}</DialogTitle><DialogDescription>学习状态、释义、摘录来源和个人备注</DialogDescription></DialogHeader>
      {error ? <div role="alert" className="space-y-2 text-sm text-destructive">{error}<Button className="ml-2" size="sm" variant="outline" onClick={() => setRetry(r => r + 1)}>重试</Button></div> : !entry && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}
      {entry && <><LearningInfo learning={entry.learning} /><VocabDetail entry={entry} /></>}
    </DialogContent>
  </Dialog>
}
