import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { AddConfirmDialog } from '@/components/translate/AddConfirmDialog'
import { WordChips } from '@/components/translate/WordChips'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getActiveLlm } from '@shared/llm'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTranslateStore } from '@/stores/translateStore'
import { useUiStore } from '@/stores/uiStore'

export function TranslateView() {
  const input = useTranslateStore((s) => s.input)
  const setInput = useTranslateStore((s) => s.setInput)
  const status = useTranslateStore((s) => s.status)
  const output = useTranslateStore((s) => s.output)
  const outputWarning = useTranslateStore((s) => s.outputWarning)
  const error = useTranslateStore((s) => s.error)
  const translate = useTranslateStore((s) => s.translate)
  const stop = useTranslateStore((s) => s.stop)
  const clear = useTranslateStore((s) => s.clear)

  const busy = status === 'loading' || status === 'streaming'
  const minimal = useSettingsStore((s) => s.settings.ui.minimal)
  const llmConfigured = Boolean(getActiveLlm(useSettingsStore((s) => s.settings.llm)).config.apiKey)

  // 极简模式：原句/译文切换（翻译完成自动切到译文；编辑输入时回到原句侧）
  const [showTranslation, setShowTranslation] = useState(false)
  const prevStatus = useRef(status)
  useEffect(() => {
    if (
      (prevStatus.current === 'loading' || prevStatus.current === 'streaming') &&
      status === 'idle' &&
      output
    ) {
      setShowTranslation(true)
    }
    prevStatus.current = status
  }, [status, output])

  const displayValue = minimal && showTranslation ? output : input
  const displayReadOnly = minimal && showTranslation

  const doTranslate = () => {
    setShowTranslation(false)
    void translate()
  }

  const doClear = () => {
    setShowTranslation(false)
    clear()
  }

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /** 右键直接粘贴剪贴板文本（替换默认菜单；粘贴到光标处） */
  const handleContextMenu = async (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      text = ''
    }
    if (!text.trim()) {
      toast.info('剪贴板中没有可粘贴的文本')
      return
    }
    const el = textareaRef.current
    if (el) {
      // 光标/选区位置（译文只读态时追加到末尾）
      const start = el.selectionStart ?? input.length
      const end = el.selectionEnd ?? input.length
      const pos = displayReadOnly ? input.length : Math.min(start, input.length)
      const next = input.slice(0, pos) + text + input.slice(pos)
      setInput(next)
      setShowTranslation(false)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(pos + text.length, pos + text.length)
      })
    } else {
      setInput(input + text)
    }
  }

  // 极简模式：整个客户区 = 操作栏 + 全幅文本框（随窗口缩放自适应），无嵌套容器
  if (minimal) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
          <Button size="sm" disabled={busy || !input.trim()} onClick={doTranslate}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? '翻译中…' : '翻译'}
          </Button>
          {busy && (
            <Button size="sm" variant="outline" onClick={stop}>
              停止
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || (!input.trim() && !output)}
            onClick={doClear}
          >
            清空
          </Button>
          <div className="flex-1" />
          {output && !busy && (
            <Button size="sm" variant="outline" onClick={() => setShowTranslation((v) => !v)}>
              {showTranslation ? '查看原句' : '查看译文'}
            </Button>
          )}
        </div>

        {status === 'error' && (
          <div className="flex shrink-0 items-center gap-1 border-b bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">{error}</span>
          </div>
        )}

        {outputWarning && (
          <div className="flex shrink-0 items-center gap-1 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">输出疑似执行了输入中的指令，请谨慎参考</span>
          </div>
        )}

        <Textarea
          ref={textareaRef}
          placeholder="输入或粘贴英文句子，点击「翻译」…（右键可直接粘贴剪贴板）"
          value={displayValue}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          readOnly={displayReadOnly}
          onContextMenu={(e) => void handleContextMenu(e)}
          className="min-h-0 flex-1 resize-none rounded-none border-0 p-3 shadow-none focus-visible:ring-0 disabled:opacity-100"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              doTranslate()
            }
          }}
        />
      </div>
    )
  }

  return (
    // 完整模式：整页随内容增高，由外层 main 滚动（不锁 h-full，长译文不会被挤出窗口）
    <div className="flex flex-col gap-3 p-3">
      <Textarea
        ref={textareaRef}
        placeholder="输入或粘贴英文句子，点击「翻译」…（右键可直接粘贴剪贴板）"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={busy}
        onContextMenu={(e) => void handleContextMenu(e)}
        className="min-h-24 resize-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            doTranslate()
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || !input.trim()} onClick={doTranslate}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? '翻译中…' : '翻译'}
        </Button>
        {busy && (
          <Button size="sm" variant="outline" onClick={stop}>
            停止
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || (!input.trim() && !output)}
          onClick={doClear}
        >
          清空
        </Button>
      </div>

      {input.trim() && <WordChips />}
      <AddConfirmDialog />

      <div>
        {status === 'loading' && (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在翻译…
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <span>{error}</span>
            {!llmConfigured && (
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 text-destructive"
                onClick={() => useUiStore.getState().setView('settings')}
              >
                去设置
              </Button>
            )}
          </div>
        )}

        {output && (
          <div className="rounded-lg border bg-card p-3">
            {outputWarning && (
              <div className="mb-2 flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                输出疑似执行了输入中的指令，请谨慎参考
              </div>
            )}
            <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              译文
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{output}</p>
          </div>
        )}

        {status === 'idle' && !output && !error && input.trim() && (
          <p className="py-2 text-xs text-muted-foreground">点击「翻译」获取译文，Ctrl+Enter 也可触发</p>
        )}
      </div>
    </div>
  )
}
