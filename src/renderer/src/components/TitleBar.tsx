import { Languages, Maximize2, Minus, Minimize2, Moon, Pin, PinOff, Sun, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

const btnClass =
  'no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'

/**
 * 无边框窗口自定义标题栏
 * 整栏为 drag 区域，所有按钮必须 no-drag（否则点击会变成拖动）
 */
export function TitleBar() {
  const { dark, toggleDark } = useUiStore()
  const alwaysOnTop = useSettingsStore((s) => s.settings.window.alwaysOnTop)
  const setAlwaysOnTop = useSettingsStore((s) => s.setAlwaysOnTop)
  const minimal = useSettingsStore((s) => s.settings.ui.minimal)
  const setMinimal = useSettingsStore((s) => s.setMinimal)

  return (
    <header className="drag flex h-9 shrink-0 select-none items-center justify-between border-b pl-3 pr-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Languages className="h-3.5 w-3.5" />
        <span>译 · 生词本</span>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          className={cn(btnClass, alwaysOnTop && 'bg-accent text-accent-foreground')}
          title={alwaysOnTop ? '取消置顶' : '始终置顶'}
          onClick={() => setAlwaysOnTop(!alwaysOnTop)}
        >
          {alwaysOnTop ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </button>
        <button className={btnClass} title="切换深浅色" onClick={toggleDark}>
          {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
        <button
          className={cn(btnClass, minimal && 'bg-accent text-accent-foreground')}
          title={minimal ? '退出极简模式' : '极简模式'}
          onClick={() => void setMinimal(!minimal)}
        >
          {minimal ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
        <button className={btnClass} title="最小化" onClick={() => window.api.minimizeWindow()}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          className={cn(btnClass, 'hover:bg-destructive hover:text-destructive-foreground')}
          title="关闭（最小化到系统托盘）"
          onClick={() => window.api.closeWindow()}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  )
}
