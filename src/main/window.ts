import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

import { getSettings, updateSettings } from './settings'
import type { WindowBounds } from '../shared/types'

/**
 * 主窗口管理：无边框悬浮窗
 * - bounds 记忆与恢复（恢复前校验落在某块屏幕可见区域内）
 * - 关闭 → 隐藏到托盘（quitting 标记为 true 时才真正退出）
 * - 置顶 / 透明度的应用入口（编排逻辑在 ipc.ts / tray.ts，避免循环依赖）
 */

let mainWindow: BrowserWindow | null = null
let quitting = false

/** 完整模式最小尺寸 */
const FULL_MIN = { width: 340, height: 420 }
/** 极简模式最小尺寸（无底部导航：TitleBar 36 + padding 24 + 输入框 64 + 按钮行 ~32） */
const MINIMAL_MIN = { width: 260, height: 180 }
/** 进入极简模式时自动缩小到的紧凑默认尺寸 */
const MINIMAL_DEFAULT = { width: 320, height: 240 }
/** 进入极简模式前的窗口尺寸（退出时恢复） */
let minimalBoundsBefore: WindowBounds | null = null

export function isQuitting(): boolean {
  return quitting
}

export function setQuitting(v: boolean): void {
  quitting = v
}

export function forceQuit(): void {
  quitting = true
  app.quit()
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function clampOpacity(v: number): number {
  return Math.min(1, Math.max(0.5, v))
}

/** 校验 bounds 与当前任一显示器工作区有交集（防拔扩展屏后窗口"消失"） */
function boundsVisible(b: WindowBounds): boolean {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    return (
      b.x < wa.x + wa.width && b.x + b.width > wa.x && b.y < wa.y + wa.height && b.y + b.height > wa.y
    )
  })
}

function saveBounds(win: BrowserWindow): void {
  if (win.isMinimized()) return
  try {
    updateSettings({ window: { bounds: win.getBounds() } })
  } catch (e) {
    console.error('[window] 保存窗口位置失败:', e)
  }
}

export function createMainWindow(): BrowserWindow {
  const settings = getSettings()
  const saved = settings.window.bounds
  const useSaved = saved !== null && boundsVisible(saved)

  const win = new BrowserWindow({
    width: useSaved ? saved.width : 400,
    height: useSaved ? saved.height : 560,
    ...(useSaved ? { x: saved.x, y: saved.y } : {}),
    minWidth: FULL_MIN.width,
    minHeight: FULL_MIN.height,
    frame: false,
    resizable: true,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow = win

  win.setAlwaysOnTop(settings.window.alwaysOnTop)
  win.setOpacity(clampOpacity(settings.window.opacity))
  // 启动即按极简模式设置最小尺寸（不自动缩小，尊重已保存的 bounds）
  applyMinimalMode(settings.ui.minimal, false)

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('close', (e) => {
    saveBounds(win)
    if (!quitting) {
      // 关闭 = 隐藏到托盘
      e.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export function showMainWindow(): void {
  const win = getMainWindow() ?? createMainWindow()
  if (!win.isVisible()) win.show()
  if (win.isMinimized()) win.restore()
  win.focus()
}

export function applyAlwaysOnTop(flag: boolean): void {
  getMainWindow()?.setAlwaysOnTop(flag)
}

export function applyOpacity(value: number): void {
  getMainWindow()?.setOpacity(clampOpacity(value))
}

/**
 * 极简模式窗口适配
 * - 进入：记忆当前 bounds → 放开最小尺寸（260×180）→ shrink=true 时自动缩到紧凑默认（320×240）
 * - 退出：恢复完整最小尺寸（340×420）→ 当前小于完整最小则用进入前尺寸恢复（用户手动拉大则保持）
 * @param shrink 运行期切换时才自动缩小；启动恢复（shrink=false）只设最小尺寸，尊重已保存 bounds
 */
export function applyMinimalMode(minimal: boolean, shrink = true): void {
  const win = getMainWindow()
  if (!win) return

  if (minimal) {
    if (minimalBoundsBefore === null) {
      minimalBoundsBefore = win.getBounds()
    }
    win.setMinimumSize(MINIMAL_MIN.width, MINIMAL_MIN.height)
    if (shrink) {
      const b = win.getBounds()
      const w = Math.min(b.width, MINIMAL_DEFAULT.width)
      const h = Math.min(b.height, MINIMAL_DEFAULT.height)
      if (w < b.width || h < b.height) {
        win.setSize(w, h)
      }
    }
  } else {
    win.setMinimumSize(FULL_MIN.width, FULL_MIN.height)
    const b = win.getBounds()
    if (b.width < FULL_MIN.width || b.height < FULL_MIN.height) {
      if (minimalBoundsBefore !== null) {
        win.setBounds(minimalBoundsBefore)
      } else {
        win.setSize(Math.max(b.width, FULL_MIN.width), Math.max(b.height, FULL_MIN.height))
      }
    }
    minimalBoundsBefore = null
  }
}
