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
    minWidth: 340,
    minHeight: 420,
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
