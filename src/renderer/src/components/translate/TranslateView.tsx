import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'

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

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Textarea
        placeholder="输入或粘贴英文句子，点击「翻译」…"
        value={displayValue}
        onChange={(e) => setInput(e.target.value)}
        disabled={busy}
        readOnly={displayReadOnly}
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
        {minimal && output && !busy && (
          <Button size="sm" variant="outline" onClick={() => setShowTranslation((v) => !v)}>
            {showTranslation ? '查看原句' : '查看译文'}
          </Button>
        )}
      </div>

      {!minimal && input.trim() && <WordChips />}
      {!minimal && <AddConfirmDialog />}

      <div className="flex-1 overflow-y-auto">
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

        {!minimal && output && (
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              译文
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{output}</p>
          </div>
        )}

        {!minimal && status === 'idle' && !output && !error && input.trim() && (
          <p className="py-2 text-xs text-muted-foreground">点击「翻译」获取译文，Ctrl+Enter 也可触发</p>
        )}
      </div>
    </div>
  )
}
