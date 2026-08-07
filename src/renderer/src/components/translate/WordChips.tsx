import { useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { tokenize } from '@/lib/tokenize'
import type { Token, WordToken } from '@/lib/tokenize'
import { useTranslateStore, type PhraseRange } from '@/stores/translateStore'

/** 位移超过该阈值判定为拖拽（否则视为点击） */
const DRAG_THRESHOLD_PX = 4

interface DragState {
  startIdx: number
  startX: number
  startY: number
  dragging: boolean
  currentIdx: number
}

/**
 * 原文单词 Chip：点击多选 + 按住拖动选连续短语（整段作为一条生词）
 * 已收录生词仍弱化展示（点击提示），但可被短语范围覆盖高亮
 */
export function WordChips() {
  const input = useTranslateStore((s) => s.input)
  const selectedWords = useTranslateStore((s) => s.selectedWords)
  const phraseRanges = useTranslateStore((s) => s.phraseRanges)
  const existedWords = useTranslateStore((s) => s.existedWords)
  const toggleWord = useTranslateStore((s) => s.toggleWord)
  const addPhraseRange = useTranslateStore((s) => s.addPhraseRange)
  const openConfirm = useTranslateStore((s) => s.openConfirm)

  const tokens = useMemo(() => tokenize(input), [input])
  // 单词 token 序号 → 词形（按顺序，供短语取词）
  const wordTokens = useMemo(
    () => tokens.filter((t): t is WordToken => t.type === 'word'),
    [tokens]
  )

  const dragRef = useRef<DragState | null>(null)
  const suppressClick = useRef(false)
  /** 拖拽过程中的实时高亮区间（未提交） */
  const [liveRange, setLiveRange] = useState<PhraseRange | null>(null)

  const selectionCount = selectedWords.size + phraseRanges.length

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      if (!d.dragging) {
        if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > DRAG_THRESHOLD_PX) {
          d.dragging = true
        } else {
          return
        }
      }
      setLiveRange(
        d.startIdx <= d.currentIdx
          ? { start: d.startIdx, end: d.currentIdx }
          : { start: d.currentIdx, end: d.startIdx }
      )
    }

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = null
      setLiveRange(null)
      if (d.dragging) {
        // 提交短语（拖拽结束；即使起止同一词也作为短语提交）
        suppressClick.current = true
        addPhraseRange(
          d.startIdx <= d.currentIdx
            ? { start: d.startIdx, end: d.currentIdx }
            : { start: d.currentIdx, end: d.startIdx }
        )
      }
    }

    const onBlur = () => {
      // 窗口失焦：取消未提交的拖拽，避免高亮残留
      dragRef.current = null
      setLiveRange(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [addPhraseRange])

  const startDrag = (idx: number, e: React.PointerEvent) => {
    // 每次新的按下都复位点击抑制（拖拽提交后置位，避免吞掉下一次正常点击）
    suppressClick.current = false
    dragRef.current = {
      startIdx: idx,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      currentIdx: idx
    }
  }

  const updateHover = (idx: number) => {
    const d = dragRef.current
    if (!d?.dragging) return
    d.currentIdx = idx
  }

  const handleChipClick = (t: WordToken) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    // 划线只提示「本次已加入」，不拦截：再次加入走 count+1
    toggleWord(t.text.toLowerCase())
  }

  const inLiveRange = (idx: number) =>
    liveRange !== null && idx >= liveRange.start && idx <= liveRange.end
  const inCommittedRange = (idx: number) =>
    phraseRanges.some((r) => idx >= r.start && idx <= r.end)

  let wordIdx = -1

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          原文单词（点击多选，按住拖动选短语，可多段）
        </span>
        {selectionCount > 0 && (
          <Button size="sm" onClick={openConfirm}>
            加入生词本（{selectionCount}）
          </Button>
        )}
      </div>
      <p className={cn('flex flex-wrap items-center gap-y-1.5 text-sm leading-relaxed', (liveRange || phraseRanges.length > 0) && 'select-none')}>
        {tokens.map((t, i) => {
          if (t.type === 'text') {
            return <span key={i}>{t.text}</span>
          }
          wordIdx += 1
          const idx = wordIdx
          const lower = t.text.toLowerCase()
          const existed = existedWords.has(lower)
          const inRange = inLiveRange(idx) || inCommittedRange(idx)
          const selected = selectedWords.has(lower)
          return (
            <button
              key={i}
              type="button"
              title={existed ? `「${t.text}」已在本次句子中加入，可再次加入（次数 +1）` : undefined}
              className={cn(
                'mx-0.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors',
                inRange && 'border-primary bg-primary text-primary-foreground',
                !inRange &&
                  (selected
                    ? 'cursor-pointer border-primary bg-primary text-primary-foreground'
                    : existed
                      ? 'cursor-pointer border-border bg-secondary/60 text-muted-foreground/70 line-through decoration-muted-foreground/40 hover:bg-accent'
                      : 'cursor-pointer border-border bg-secondary/60 hover:bg-accent')
              )}
              onPointerDown={(e) => startDrag(idx, e)}
              onPointerEnter={() => updateHover(idx)}
              onClick={() => handleChipClick(t)}
            >
              {t.text}
              {existed && !inRange && !selected && <Check className="h-3 w-3" />}
            </button>
          )
        })}
      </p>
    </div>
  )
}
