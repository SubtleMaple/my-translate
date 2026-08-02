import { useMemo } from 'react'
import { Check } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { tokenize } from '@/lib/tokenize'
import { useTranslateStore } from '@/stores/translateStore'

/**
 * 原文单词 Chip：可多选；已收录生词弱化展示（不可选）
 */
export function WordChips() {
  const input = useTranslateStore((s) => s.input)
  const selectedWords = useTranslateStore((s) => s.selectedWords)
  const existedWords = useTranslateStore((s) => s.existedWords)
  const toggleWord = useTranslateStore((s) => s.toggleWord)
  const openConfirm = useTranslateStore((s) => s.openConfirm)

  const tokens = useMemo(() => tokenize(input), [input])

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">原文单词（点击多选）</span>
        {selectedWords.size > 0 && (
          <Button size="sm" onClick={openConfirm}>
            加入生词本（{selectedWords.size}）
          </Button>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-y-1.5 text-sm leading-relaxed">
        {tokens.map((t, i) => {
          if (t.type === 'text') {
            return <span key={i}>{t.text}</span>
          }
          const lower = t.text.toLowerCase()
          const selected = selectedWords.has(lower)
          const existed = existedWords.has(lower)
          return (
            <button
              key={i}
              type="button"
              title={existed ? `「${t.text}」已在生词本` : undefined}
              className={cn(
                'mx-0.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors',
                existed &&
                  'cursor-default border-transparent bg-muted text-muted-foreground/70 line-through decoration-muted-foreground/40',
                !existed &&
                  (selected
                    ? 'cursor-pointer border-primary bg-primary text-primary-foreground'
                    : 'cursor-pointer border-border bg-secondary/60 hover:bg-accent')
              )}
              onClick={() => {
                if (existed) {
                  toast.info(`「${t.text}」已在生词本中`)
                  return
                }
                toggleWord(lower)
              }}
            >
              {t.text}
              {existed && <Check className="h-3 w-3" />}
            </button>
          )
        })}
      </p>
    </div>
  )
}
