import type { LlmError } from '../llm/client'
import { generateWordDetail } from '../llm/wordDetail'
import { getSettings } from '../settings'
import { getVocabById, listVocab, resetVocabToPending, updateVocabDetail } from '../db/vocabRepo'

/**
 * 生词详情生成队列
 * - 串行执行（for await 逐词，规避并发触发 RPM 限制），每词间隔 ~300ms
 * - 429 指数退避重试 ≤2 次（2s / 4s）
 * - 幂等：同一 id 已在队列/处理中则忽略；仅接受 status='pending' 的词
 * - 每词完成（成功或失败）经 setVocabChangedListener 注册的回调广播，由 ipc.ts 接线
 * - 崩溃恢复：应用启动时调用 enqueueAllPending() 扫描 status='pending' 自动重新入队
 */

let queue: number[] = []
const inQueue = new Set<number>()
let running = false
let onChange: (() => void) | null = null

/** ipc.ts 注册：详情状态变更 → 广播 VocabChanged（避免 vocabService ↔ ipc 循环依赖） */
export function setVocabChangedListener(cb: () => void): void {
  onChange = cb
}

function notify(): void {
  onChange?.()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 入队（幂等：已在队列/处理中、或不存在、或非 pending 状态则忽略） */
export function enqueueDetail(id: number): void {
  if (inQueue.has(id)) return
  const entry = getVocabById(id)
  if (!entry || entry.status !== 'pending') return
  inQueue.add(id)
  queue.push(id)
  void pump()
}

/** 启动扫描：应用重启后把遗留的 pending 词重新入队 */
export function enqueueAllPending(): void {
  for (const entry of listVocab()) {
    if (entry.status === 'pending') enqueueDetail(entry.id)
  }
}

/** 失败/已 ready 词的重新生成入口：置回 pending → 入队 */
export function regenerateDetail(id: number): void {
  const entry = getVocabById(id)
  if (!entry || entry.status === 'pending') return
  resetVocabToPending(id)
  enqueueDetail(id)
  notify()
}

async function pump(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length > 0) {
      const id = queue.shift()!
      inQueue.delete(id)
      await processOne(id)
      await delay(300)
    }
  } finally {
    running = false
  }
}

async function processOne(id: number): Promise<void> {
  const entry = getVocabById(id)
  if (!entry || entry.status !== 'pending') return

  const settings = getSettings().llm
  // 1 次正常调用 + ≤2 次 429 指数退避重试（2s / 4s）
  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const generated = await generateWordDetail(
        entry.word,
        entry.contextSentence,
        settings
      )
      updateVocabDetail(id, { ...generated, status: 'ready' })
      notify()
      return
    } catch (e) {
      const err = e as LlmError
      const is429 = err.status === 429
      if (is429 && attempt < maxAttempts - 1) {
        await delay(1000 * 2 ** (attempt + 1))
        continue
      }
      // 失败：保留已有字段（COALESCE 部分更新），只回写状态与原因
      updateVocabDetail(id, {
        status: 'failed',
        failReason: err.message || String(e)
      })
      notify()
      return
    }
  }
}
