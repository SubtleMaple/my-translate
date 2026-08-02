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
import { tokenize } from '@/lib/tokenize'
import { useTranslateStore } from '@/stores/translateStore'

/**
 * 加入生词本二次确认
 * 确认后立即写入本地数据库（详情生成管线在 Phase 5 接入）
 */
export function AddConfirmDialog() {
  const confirmOpen = useTranslateStore((s) => s.confirmOpen)
  const closeConfirm = useTranslateStore((s) => s.closeConfirm)
  const input = useTranslateStore((s) => s.input)
  const selectedWords = useTranslateStore((s) => s.selectedWords)
  const adding = useTranslateStore((s) => s.adding)
  const addToVocab = useTranslateStore((s) => s.addToVocab)

  // 按原文顺序展示选中的词
  const words = useMemo(
    () =>
      tokenize(input)
        .filter((t) => t.type === 'word' && selectedWords.has(t.text.toLowerCase()))
        .map((t) => t.text),
    [input, selectedWords]
  )

  const onConfirm = async () => {
    const result = await addToVocab()
    if (!result) return
    const existedTip =
      result.existed.length > 0 ? `，${result.existed.length} 个已存在已跳过` : ''
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
            以下单词将逐词生成音标、释义、例句等详细信息。确认加入？
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
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={adding} onClick={closeConfirm}>
            取消
          </Button>
          <Button disabled={adding} onClick={() => void onConfirm()}>
            {adding && <Loader2 className="h-4 w-4 animate-spin" />}
            确认加入（{words.length}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
