import { useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { VocabExportFormat, VocabExportResult } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function VocabExportDialog() {
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<VocabExportFormat>('json')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<VocabExportResult | null>(null)
  const pending = useRef(false)

  const exportAll = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setResult(null)
    try {
      const next = await window.api.exportVocab(format)
      setResult(next)
      if (next.status === 'saved') toast.success(`已导出 ${next.count} 个词条（${next.format.toUpperCase()}）`)
    } catch {
      setResult({ status: 'error', message: '导出请求未能完成，请重试。' })
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <>
    <Button size="sm" variant="outline" onClick={() => { setResult(null); setOpen(true) }}>
      <Download className="h-3.5 w-3.5" />导出
    </Button>
    <Dialog open={open} onOpenChange={(value) => { if (!pending.current) setOpen(value) }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>导出全部词条</DialogTitle>
          <DialogDescription className="leading-6">导出当前词库的全部词条及摘录来源，不受搜索或自测状态影响。生成中和失败的词条也会保留。</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="vocab-export-format">文件格式</Label>
          <Select value={format} disabled={busy} onValueChange={(value) => { setFormat(value as VocabExportFormat); setResult(null) }}>
            <SelectTrigger id="vocab-export-format" aria-label="导出格式"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="json">JSON · 完整结构（推荐）</SelectItem>
              <SelectItem value="csv">CSV · 表格分析</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs leading-5 text-muted-foreground">{format === 'json' ? '保留完整释义、备注与每处原句及选词位置，适合程序提取或大模型分析。' : '一行一个词条，支持 Excel / pandas；多处来源保存在 sources_json 列，长文本不截断。'}</p>
        </div>
        {busy && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />请选择保存位置，完成后将写入全量词库…</p>}
        {result?.status === 'saved' && <div role="status" className="space-y-1 rounded-lg bg-primary/5 p-3 text-sm">
          <p className="font-medium text-primary">已导出 {result.count} 个词条 · {result.format.toUpperCase()}</p>
          <p aria-label="导出文件路径" className="select-text break-all text-xs leading-5 text-muted-foreground">{result.filePath}</p>
        </div>}
        {result?.status === 'empty' && <p role="status" className="text-sm text-muted-foreground">词库还是空的，收录词条后再导出。</p>}
        {result?.status === 'cancelled' && <p role="status" className="text-xs text-muted-foreground">已取消保存，可重新选择位置。</p>}
        {result?.status === 'error' && <p role="alert" className="break-words rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{result.message}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>关闭</Button>
          <Button disabled={busy} onClick={() => void exportAll()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{busy ? '导出中' : '保存文件'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
