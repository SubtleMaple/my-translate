import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { phraseByWordIndex, tokenize } from '@/lib/tokenize'
import { useTranslateStore } from '@/stores/translateStore'

/**
 * 加入生词本二次确认
 * 条目 = 点击选中的单词 + 拖拽选中的短语（整段一条）；确认后立即写入本地数据库
 */
export function AddConfirmDialog() {
  const confirmOpen = useTranslateStore((s) => s.confirmOpen)
  const closeConfirm = useTranslateStore((s) => s.closeConfirm)
  const input = useTranslateStore((s) => s.input)
  const selectedWords = useTranslateStore((s) => s.selectedWords)
  const phraseRanges = useTranslateStore((s) => s.phraseRanges)
  const adding = useTranslateStore((s) => s.adding)
  const addToVocab = useTranslateStore((s) => s.addToVocab)

  // 按原文顺序展示选中的单词
  const words = useMemo(
    () =>
      tokenize(input)
        .filter((t) => t.type === 'word' && selectedWords.has(t.text.toLowerCase()))
        .map((t) => t.text),
    [input, selectedWords]
  )

  // 拖拽选中的短语列表（每段一条）
  const phrases = useMemo(
    () => phraseRanges.map((r) => phraseByWordIndex(input, r.start, r.end)).filter(Boolean),
    [input, phraseRanges]
  )

  const itemCount = words.length + phrases.length

  const onConfirm = async () => {
    const result = await addToVocab()
    if (!result) return
    const existedTip =
      result.existed.length > 0 ? `，${result.existed.length} 个已存在（次数 +1）` : ''
    toast.success(`已加入 ${result.added.length} 个生词${existedTip}，正在生成详情…`)
  }

  return (
    <Dialog
      open={confirmOpen}
      onOpenChange={(open) => {
        if (!open && !adding) closeConfirm()
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>加入生词本</DialogTitle>
          <DialogDescription>
            以下单词/短语将逐条生成音标、释义、例句等详细信息。确认加入？
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-40 flex-wrap content-start gap-1.5 overflow-y-auto">
          {words.map((w) => (
            <span
              key={w.toLowerCase()}
              className="inline-flex items-center rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 text-sm"
            >
              {w}
            </span>
          ))}
          {phrases.map((p) => (
            <span
              key={p.toLowerCase()}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-sm"
            >
              {p}
              <span className="text-[10px] font-medium text-primary">短语</span>
            </span>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={adding} onClick={closeConfirm}>
            取消
          </Button>
          <Button disabled={adding} onClick={() => void onConfirm()}>
            {adding && <Loader2 className="h-4 w-4 animate-spin" />}
            确认加入（{itemCount}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
