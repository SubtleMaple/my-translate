import { useEffect } from 'react'
import { BookOpen, Languages, Loader2, Settings } from 'lucide-react'

import { TitleBar } from '@/components/TitleBar'
import { SettingsView } from '@/components/settings/SettingsView'
import { TranslateView } from '@/components/translate/TranslateView'
import { VocabView } from '@/components/vocab/VocabView'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTranslateStore } from '@/stores/translateStore'
import { useUiStore, type AppView } from '@/stores/uiStore'

const NAV_ITEMS: { key: AppView; label: string; icon: typeof Languages }[] = [
  { key: 'translate', label: '翻译', icon: Languages },
  { key: 'vocab', label: '生词本', icon: BookOpen },
  { key: 'settings', label: '设置', icon: Settings }
]

export default function App() {
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const load = useSettingsStore((s) => s.load)
  const loaded = useSettingsStore((s) => s.loaded)
  const syncAlwaysOnTop = useSettingsStore((s) => s.syncAlwaysOnTop)
  const bindTranslateEvents = useTranslateStore((s) => s.bindEvents)

  useEffect(() => {
    void load()
  }, [load])

  // 订阅托盘菜单的置顶切换
  useEffect(() => {
    return window.api.onAlwaysOnTopChanged(syncAlwaysOnTop)
  }, [syncAlwaysOnTop])

  // 订阅翻译流式事件（挂载一次，视图切换不丢失）
  useEffect(() => {
    return bindTranslateEvents()
  }, [bindTranslateEvents])

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TitleBar />
      <main className="flex-1 overflow-y-auto">
        {!loaded ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {view === 'translate' && <TranslateView />}
            {view === 'vocab' && <VocabView />}
            {view === 'settings' && <SettingsView />}
          </>
        )}
      </main>
      <nav className="flex h-12 shrink-0 items-stretch border-t">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent/60',
              view === key && 'bg-accent text-accent-foreground'
            )}
            onClick={() => setView(key)}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>
      <Toaster />
    </div>
  )
}
