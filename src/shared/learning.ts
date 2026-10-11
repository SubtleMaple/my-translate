import type { CloudMetric, LearningStage, LearningSummary, VocabSortBy, VocabViewEntry } from './types'

export const LEARNING_LABELS: Record<LearningStage, string> = {
  unseen: '未自测', fragile: '待巩固', learning: '学习中', developing: '逐渐稳定', stable: '较稳固'
}
export const VOCAB_SORTS: { value: VocabSortBy; label: string }[] = [
  { value: 'time', label: '最新优先' }, { value: 'alpha', label: '字母 A–Z' }, { value: 'count', label: '出现次数' },
  { value: 'unfamiliar', label: '不熟优先' }, { value: 'familiar', label: '熟悉优先' }, { value: 'risk', label: '遗忘风险优先' }
]
export const CLOUD_METRICS: { value: CloudMetric; label: string }[] = [
  { value: 'weakness', label: '不熟程度更醒目' }, { value: 'count', label: '摘录次数更醒目' }, { value: 'familiarity', label: '熟悉程度更醒目' }
]
export const STAGE_ORDER: LearningStage[] = ['fragile', 'learning', 'developing', 'stable', 'unseen']
export function learningStageOrder(sortBy: VocabSortBy): LearningStage[] {
  return sortBy === 'familiar' ? ['stable', 'developing', 'learning', 'fragile', 'unseen'] : STAGE_ORDER
}
export function riskLabel(learning: LearningSummary): string {
  if (learning.risk === null) return '风险暂无估计'
  return `风险${learning.risk <= 0.1 ? '低' : learning.risk <= 0.25 ? '中' : '高'}`
}
export function learningTooltip(entry: VocabViewEntry): string {
  const m = entry.learning
  return [entry.word, m.unavailable ? '学习记录暂不可用' : LEARNING_LABELS[m.stage], riskLabel(m),
    m.hasReview ? `已自测 ${m.reviewCount} 次${m.limitedEvidence ? ' · 初步估计' : ''}` : '尚无自测记录',
    m.stabilityDays === null ? '' : `长期稳定性约 ${Number(m.stabilityDays.toFixed(1))} 天`,
    m.recall === null ? '' : `当前回忆率估计 ${Math.round(m.recall * 100)}%`,
    m.due ? '已到复习时间' : '', entry.brief].filter(Boolean).join(' · ')
}
export function compareVocabView(a: VocabViewEntry, b: VocabViewEntry, sortBy: VocabSortBy): number {
  const alpha = () => a.word.toLowerCase().localeCompare(b.word.toLowerCase(), 'en') || a.id - b.id
  if (sortBy === 'alpha') return alpha()
  if (sortBy === 'time') return b.createdAt - a.createdAt || b.id - a.id
  if (sortBy === 'count') return b.count - a.count || b.updatedAt - a.updatedAt || alpha()
  const x = a.learning, y = b.learning
  if (sortBy === 'risk') {
    if (x.risk === null || y.risk === null) return x.risk === y.risk ? alpha() : x.risk === null ? 1 : -1
    return y.risk - x.risk || Number(y.due) - Number(x.due) || alpha()
  }
  // 未自测/异常数据始终单独放在末尾，不将未知值解释为0分。
  if (x.stage === 'unseen' || y.stage === 'unseen') return x.stage === y.stage ? alpha() : x.stage === 'unseen' ? 1 : -1
  const direction = sortBy === 'familiar' ? -1 : 1
  return direction * (STAGE_ORDER.indexOf(x.stage) - STAGE_ORDER.indexOf(y.stage) || (x.stabilityDays ?? 0) - (y.stabilityDays ?? 0)) || alpha()
}

/** 字号是有界视觉权重，不是0–100的“掌握分数”；固定尺度避免搜索后无故变大。 */
export function cloudFontSize(entry: VocabViewEntry, metric: CloudMetric): number {
  if (metric === 'count') return Math.round(14 + 24 * Math.min(1, Math.log1p(Math.max(0, entry.count)) / Math.log(65)))
  const memory = entry.learning
  if (memory.stage === 'unseen' || memory.stabilityDays === null) return 18
  const withinStage = Math.min(0.9, Math.log1p(memory.stabilityDays) / Math.log(366))
  const relative = (STAGE_ORDER.indexOf(memory.stage) + withinStage) / 4
  return Math.round(14 + 24 * (metric === 'weakness' ? 1 - relative : relative))
}
