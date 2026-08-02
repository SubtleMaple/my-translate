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
  const llmConfigured = Boolean(getActiveLlm(useSettingsStore((s) => s.settings.llm)).config.apiKey)

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Textarea
        placeholder="输入或粘贴英文句子，点击「翻译」…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={busy}
        className="min-h-24 resize-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void translate()
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || !input.trim()} onClick={() => void translate()}>
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
          onClick={clear}
        >
          清空
        </Button>
      </div>

      {input.trim() && <WordChips />}
      <AddConfirmDialog />

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

        {output && (
          <div className="rounded-lg border bg-card p-3">
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
