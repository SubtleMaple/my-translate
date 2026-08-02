import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, NotebookPen, RefreshCw, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { VocabEntry } from '@shared/types'
import { useVocabStore } from '@/stores/vocabStore'

/**
 * 生词完整详情：原句回顾 + Markdown 渲染 + 个人备注 + 删除/重新生成
 */
export function VocabDetail({ entry }: { entry: VocabEntry }) {
  const [note, setNote] = useState(entry.note)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    setNote(entry.note)
  }, [entry.note])

  const saveNote = async () => {
    if (note === entry.note) return
    setSaving(true)
    try {
      await window.api.updateVocabNote(entry.id, note.trim())
      toast.success('备注已保存')
    } catch {
      toast.error('备注保存失败')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      await window.api.deleteVocab(entry.id)
      toast.success(`已删除「${entry.word}」`)
    } catch {
      toast.error('删除失败')
    } finally {
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  const regenerate = async () => {
    await window.api.regenerateDetail(entry.id)
    toast.success('已重新生成详情')
  }

  return (
    <div className="space-y-3 pt-3">
      {entry.contextSentence && (
        <div className="rounded-md bg-muted/60 px-3 py-2 text-xs italic text-muted-foreground">
          “{entry.contextSentence}”
        </div>
      )}

      {entry.status === 'pending' && (
        <div className="space-y-2 py-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在生成音标、释义、例句…
          </div>
        </div>
      )}

      {entry.status === 'failed' && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span className="flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {entry.failReason || '详情生成失败'}
          </span>
          <Button size="sm" variant="ghost" className="shrink-0 text-destructive" onClick={regenerate}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            重新生成
          </Button>
        </div>
      )}

      {entry.status === 'ready' && entry.detail && (
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.detail}</ReactMarkdown>
        </div>
      )}

      {entry.status === 'ready' && !entry.detail && (
        <p className="py-2 text-sm text-muted-foreground">暂无详情内容</p>
      )}

      <div className="space-y-1.5 border-t pt-2.5">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <NotebookPen className="h-3.5 w-3.5" />
          我的备注
        </div>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="记录自己的记忆方法、易错点…"
          className="min-h-16 resize-none text-sm"
        />
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            disabled={note === entry.note || saving}
            onClick={() => void saveNote()}
          >
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            保存备注
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            删除
          </Button>
        </div>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除生词</DialogTitle>
            <DialogDescription>
              确定删除「{entry.word}」吗？该词及其全部学习资料将被永久移除，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
