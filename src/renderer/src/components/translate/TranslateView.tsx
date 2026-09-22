import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, ClipboardPaste, Copy, Loader2, Play, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { WordChips } from '@/components/translate/WordChips'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getActiveLlm } from '@shared/llm'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTranslateStore } from '@/stores/translateStore'
import { useUiStore } from '@/stores/uiStore'

export function TranslateView() {
  const { input, revision, setInput, status, output, outputWarning, error, translate, stop, clear } = useTranslateStore()
  const minimal = useSettingsStore((s) => s.settings.ui.minimal)
  const llmConfigured = Boolean(getActiveLlm(useSettingsStore((s) => s.settings.llm)).config.apiKey)
  const busy = status === 'loading' || status === 'streaming'
  const [showTranslation, setShowTranslation] = useState(status === 'done')
  const [pasting, setPasting] = useState(false)
  const pastePending = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setShowTranslation(false) }, [revision])
  useEffect(() => { if (status === 'done' || status === 'streaming') setShowTranslation(true) }, [status])
  const readOnly = minimal && showTranslation && (busy || Boolean(output))

  const doTranslate = () => { setShowTranslation(true); void translate() }
  const doClear = () => { setShowTranslation(false); clear(); textareaRef.current?.focus() }
  const paste = async (quick: boolean) => {
    if (pastePending.current) return
    const before = useTranslateStore.getState().revision
    const start = textareaRef.current?.selectionStart ?? input.length
    const end = textareaRef.current?.selectionEnd ?? input.length
    pastePending.current = true
    setPasting(true)
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) { toast.info('剪贴板中没有文本'); return }
      if (before !== useTranslateStore.getState().revision) { toast.info('原文已变化，请重新粘贴'); return }
      const replace = quick || readOnly
      setInput(replace ? text : input.slice(0, start) + text + input.slice(end))
      setShowTranslation(false)
      if (quick) doTranslate()
      else requestAnimationFrame(() => {
        textareaRef.current?.focus()
        const caret = replace ? text.length : start + text.length
        textareaRef.current?.setSelectionRange(caret, caret)
      })
    } catch { toast.error('无法读取剪贴板，请在原文中按 Ctrl+V 粘贴') }
    finally { setPasting(false); pastePending.current = false }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(output); toast.success('译文已复制') }
    catch { toast.error('复制失败，请选中译文手动复制') }
  }
  const keyboard = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doTranslate() }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') { e.preventDefault(); void paste(true) }
  }
  const incomplete = status === 'stopped' || (status === 'error' && Boolean(output))
  const statusText = busy ? '正在翻译…' : incomplete ? '未完成' : status === 'done' ? '翻译完成' : '译文'
  const notices = <>
    {status === 'error' && <div role="alert" className="flex flex-wrap items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 break-words">{error}</span>
      {!llmConfigured && <button className="shrink-0 underline" onClick={async () => {
        if (minimal) await useSettingsStore.getState().setMinimal(false)
        useUiStore.getState().setView('settings')
      }}>去设置</button>}
    </div>}
    {status === 'stopped' && <p role="status" className="text-xs text-muted-foreground">已停止 · {output ? '当前译文未完成' : '尚未生成译文'}</p>}
    {outputWarning && <div role="alert" className="flex gap-1.5 rounded-md border bg-muted p-2 text-xs"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span>输出疑似执行了输入中的指令，请谨慎参考。</span></div>}
  </>

  if (minimal) return <div className="flex h-full min-h-0 flex-col" onKeyDown={keyboard}>
    <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-card px-2">
      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="粘贴新原文并翻译 (Ctrl+Shift+V)" aria-label="粘贴并翻译" disabled={pasting} onClick={() => void paste(true)}><ClipboardPaste className="h-3.5 w-3.5" /></Button>
      <Button size="sm" className="h-7 px-2 text-xs" disabled={!busy && !input.trim()} onClick={busy ? stop : doTranslate}>{busy ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}{busy ? '停止' : '翻译'}</Button>
      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="清空" aria-label="清空" disabled={!input && !output} onClick={doClear}><Trash2 className="h-3.5 w-3.5" /></Button>
      <div className="min-w-0 flex-1" />
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!output && !busy} onClick={() => setShowTranslation((v) => !v)}>{readOnly ? '原文' : '译文'}</Button>
      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="复制译文" aria-label="复制译文" disabled={!output} onClick={() => void copy()}><Copy className="h-3.5 w-3.5" /></Button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {(error || outputWarning || status === 'stopped') && <div className="shrink-0 space-y-1.5 p-2">{notices}</div>}
      <label htmlFor="minimal-text" className="flex shrink-0 items-center gap-1 px-3 pt-1 text-[10px] text-muted-foreground">{busy && <Loader2 className="h-2.5 w-2.5 animate-spin" />}{readOnly ? statusText : '原文 · 英文'}</label>
      <Textarea id="minimal-text" ref={textareaRef} value={readOnly ? output : input} readOnly={readOnly}
        placeholder={readOnly ? '正在等待译文…' : '粘贴英文，Ctrl+Enter 翻译'}
        onChange={(e) => setInput(e.target.value)}
        onPaste={(e) => {
          if (!readOnly) return
          e.preventDefault()
          const text = e.clipboardData.getData('text')
          if (!text.trim()) { toast.info('剪贴板中没有文本'); return }
          setInput(text)
          setShowTranslation(false)
        }}
        onContextMenu={(e) => { e.preventDefault(); void paste(false) }}
        className="min-h-8 flex-1 resize-none rounded-none border-0 px-3 py-1.5 leading-relaxed shadow-none focus-visible:ring-0" />
    </div>
  </div>

  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-3 sm:p-5" onKeyDown={keyboard}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h1 className="text-base font-semibold tracking-tight">读懂，再记住</h1><p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">翻译英文，留住值得复习的词。</p></div>
      <Button size="sm" variant="outline" disabled={pasting} title="替换为剪贴板文本并翻译 (Ctrl+Shift+V)" onClick={() => void paste(true)}><ClipboardPaste className="h-3.5 w-3.5" />粘贴并翻译</Button>
    </div>
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      <section className="flex min-w-0 flex-col rounded-xl border bg-card p-3">
        <div className="mb-2 flex items-center justify-between"><label htmlFor="source-text" className="text-xs font-semibold text-muted-foreground">原文 · 英文</label><span className="text-[10px] text-muted-foreground">Ctrl+Enter 翻译</span></div>
        <Textarea id="source-text" ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onContextMenu={(e) => { e.preventDefault(); void paste(false) }} placeholder="输入或粘贴想读懂的英文…" className="h-24 min-h-20 flex-1 resize-y border-0 bg-transparent p-0 text-sm leading-relaxed shadow-none focus-visible:ring-0 sm:min-h-28" />
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5">
          <Button size="sm" disabled={!busy && !input.trim()} onClick={busy ? stop : doTranslate}>{busy ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{busy ? '停止翻译' : '翻译'}</Button>
          <Button size="sm" variant="ghost" disabled={!input && !output} onClick={doClear}>清空</Button>
          <span className="ml-auto text-[10px] text-muted-foreground">{input.length ? `${input.length} 字符` : '右键也可粘贴'}</span>
        </div>
      </section>
      <section className="min-w-0 rounded-xl border bg-card p-3" aria-label="中文译文" aria-busy={busy}>
        <div className="mb-2 flex items-center justify-between gap-2"><h2 className="flex items-center gap-1.5 text-xs font-semibold text-primary">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{statusText} · 中文</h2>
          <Button size="icon" variant="ghost" className="h-6 w-6" title="复制译文" aria-label="复制译文" disabled={!output} onClick={() => void copy()}><Copy className="h-3.5 w-3.5" /></Button></div>
        <div className="space-y-2">{notices}
          {output ? <p className="whitespace-pre-wrap break-words text-sm leading-7">{output}</p> : !error && <p className="py-3 text-sm leading-6 text-muted-foreground">{busy ? '正在等待译文…' : input.trim() ? '原文就绪，点击翻译。' : '译文会出现在这里。'}<span className="mt-1 block text-xs">修改原文后，旧译文会自动清除。</span></p>}
        </div>
      </section>
    </div>
    {input.trim() && <WordChips />}
    {!input.trim() && <p className="px-1 py-2 text-xs leading-5 text-muted-foreground">复制一段英文 → 粘贴并翻译 → 点选生词直接收藏。<br />日后到生词本开启「自测」，先回想，再揭晓。</p>}
  </div>
}
