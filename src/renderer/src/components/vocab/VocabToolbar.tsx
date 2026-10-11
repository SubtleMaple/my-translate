import { Cloud, Layers, List, RefreshCw, Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { LEARNING_STAGES, type CloudMetric, type LearningFilter, type VocabSortBy, type VocabViewMode } from '@shared/types'
import { CLOUD_METRICS, LEARNING_LABELS, VOCAB_SORTS } from '@shared/learning'
import { Button } from '@/components/ui/button'
import { useVocabStore } from '@/stores/vocabStore'

/** 搜索/排序或词云指标 + 视图与学习状态筛选。 */
export function VocabToolbar() {
  const searchInput = useVocabStore((s) => s.searchInput)
  const setSearchInput = useVocabStore((s) => s.setSearchInput)
  const sortBy = useVocabStore((s) => s.sortBy)
  const setSortBy = useVocabStore((s) => s.setSortBy)
  const { viewMode, cloudMetric, learningFilter, stageCounts, matchedCount, evaluatedAt, loading,
    setViewMode, setCloudMetric, setLearningFilter, refresh } = useVocabStore()

  return (
    <div className="shrink-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-24 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索单词 / 释义 / 例句…"
            aria-label="搜索生词"
            className="pl-8"
          />
        </div>
        <Select value={viewMode === 'cloud' ? cloudMetric : sortBy} onValueChange={(v) => void (viewMode === 'cloud' ? setCloudMetric(v as CloudMetric) : setSortBy(v as VocabSortBy))}>
          <SelectTrigger aria-label={viewMode === 'cloud' ? '词云字号指标' : '生词排序'} className="w-36 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(viewMode === 'cloud' ? CLOUD_METRICS : VOCAB_SORTS).map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" disabled={loading} aria-label="刷新记忆状态" title={evaluatedAt ? `刷新记忆状态 · 快照 ${new Date(evaluatedAt).toLocaleTimeString()}` : '刷新记忆状态'} onClick={() => void refresh()}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="词库展示方式">
          {([{ mode: 'list', label: '列表', icon: List }, { mode: 'cloud', label: '词云', icon: Cloud }, { mode: 'groups', label: '分组', icon: Layers }] as const).map(({ mode, label, icon: Icon }) =>
            <Button key={mode} size="sm" variant={viewMode === mode ? 'secondary' : 'ghost'} className="h-8 gap-1 px-1.5 text-xs" aria-pressed={viewMode === mode} aria-label={`${label}视图`} onClick={() => void setViewMode(mode as VocabViewMode)}><Icon className="h-3.5 w-3.5" />{label}</Button>)}
        </div>
        <Select value={learningFilter} onValueChange={value => void setLearningFilter(value as LearningFilter)}>
          <SelectTrigger aria-label="学习状态筛选" className="h-8 w-28 text-xs"><SelectValue>{learningFilter === 'all' ? '全部状态' : LEARNING_LABELS[learningFilter]}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="all">全部状态 · {matchedCount}</SelectItem>{LEARNING_STAGES.map(stage => <SelectItem key={stage} value={stage}>{LEARNING_LABELS[stage]} · {stageCounts[stage]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  )
}
