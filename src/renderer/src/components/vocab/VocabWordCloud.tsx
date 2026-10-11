import { useEffect, useMemo, useRef, useState } from 'react'
import { cloudFontSize, CLOUD_METRICS, LEARNING_LABELS, learningTooltip, STAGE_ORDER } from '@shared/learning'
import { Button } from '@/components/ui/button'
import { layoutWordCloud } from '@/lib/wordCloud'
import { useVocabStore } from '@/stores/vocabStore'

const FONT = "Georgia, 'Times New Roman', 'Microsoft YaHei UI', serif"
export function VocabWordCloud() {
  const { entries, cloudMetric, search, learningFilter, selectEntry } = useVocabStore()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [fontReady, setFontReady] = useState(false)
  const [limit, setLimit] = useState(150)
  const [remainingLimit, setRemainingLimit] = useState(60)
  useEffect(() => { setLimit(150); setRemainingLimit(60) }, [search, learningFilter])
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    let live = true
    void document.fonts.ready.then(() => { if (live) setFontReady(true) })
    return () => { live = false; observer.disconnect() }
  }, [])
  const height = Math.min(850, Math.max(260, Math.round(width * 0.65)) + Math.max(0, limit - 150) * 0.7)
  const candidates = useMemo(() => entries.map(entry => ({ id: entry.id, word: entry.word, fontSize: cloudFontSize(entry, cloudMetric) }))
    .sort((a, b) => b.fontSize - a.fontSize || a.id - b.id).slice(0, limit), [entries, cloudMetric, limit])
  const layout = useMemo(() => {
    if (!width || !fontReady) return { placed: [], unplaced: candidates.map(w => w.id) }
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return { placed: [], unplaced: candidates.map(w => w.id) }
    return layoutWordCloud(candidates, width, height, (word, size) => {
      context.font = `${size}px ${FONT}`
      const metrics = context.measureText(word)
      return { width: Math.max(metrics.width, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight),
        ascent: Math.max(size * 0.8, metrics.actualBoundingBoxAscent), descent: Math.max(size * 0.2, metrics.actualBoundingBoxDescent), left: metrics.actualBoundingBoxLeft }
    })
  }, [candidates, width, height, fontReady])
  const byId = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries])
  const shown = new Set(layout.placed.map(word => word.id))
  const remaining = entries.filter(entry => !shown.has(entry.id))
  return <section className="flex flex-col gap-3" aria-label="词云视图">
    <div className="order-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] sm:order-1" aria-label="词云图例">{STAGE_ORDER.map(stage => <span key={stage} data-learning-stage={stage} className="learning-ink">● {LEARNING_LABELS[stage]}</span>)}</div>
    <p className="order-3 text-xs leading-5 text-muted-foreground sm:order-2">{CLOUD_METRICS.find(m => m.value === cloudMetric)?.label} · 颜色代表长期熟悉度。{cloudMetric !== 'count' && '未自测采用中性字号。'}点击词语查看详情。</p>
    <div ref={ref} className="order-1 min-w-0 overflow-hidden rounded-2xl border bg-card sm:order-3">
      {width > 0 && fontReady ? <svg role="group" aria-label="可点击词云" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: FONT }}>
        {layout.placed.map(word => {
          const entry = byId.get(word.id)!
          return <g key={word.id} className="cloud-word" data-cloud-entry={word.id} data-learning-stage={entry.learning.stage} tabIndex={0} role="button" aria-label={`查看 ${entry.word}`}
            onClick={() => selectEntry(entry.id)} onKeyDown={event => { if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectEntry(entry.id) } }}>
            <title>{learningTooltip(entry)}</title>
            <rect x={word.x} y={word.y} width={word.width} height={word.height} rx={5} />
            <text x={word.textX} y={word.baseline} fontSize={word.fontSize} fill="currentColor">{entry.word}</text>
          </g>
        })}
      </svg> : <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">正在排布词云…</div>}
    </div>
    <div className="order-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span role="status">词云展示 {layout.placed.length} / {entries.length} 个词条 · 字号适配窗口</span>
      {entries.length > limit && limit < 450 && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLimit(n => n + 150)}>增加词云容量</Button>}
    </div>
    {!!remaining.length && <div className="order-5 space-y-2 rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">其余 {remaining.length} 个词条（含长词、短语和未布置词）</p>
      <div className="flex flex-wrap gap-2">{remaining.slice(0, remainingLimit).map(entry => <button key={entry.id} data-cloud-fallback={entry.id} data-learning-stage={entry.learning.stage}
        className="learning-tag max-w-full rounded-lg border bg-card px-2 py-1.5 text-xs hover:bg-accent" title={learningTooltip(entry)} aria-label={`查看 ${entry.word}`} onClick={() => selectEntry(entry.id)}>
        <span className="break-words [overflow-wrap:anywhere]">{entry.word}</span>
      </button>)}</div>
      {remaining.length > remainingLimit && <Button size="sm" variant="ghost" className="text-xs" onClick={() => setRemainingLimit(n => n + 60)}>继续显示其余词条（还有 {remaining.length - remainingLimit} 个）</Button>}
    </div>}
  </section>
}
