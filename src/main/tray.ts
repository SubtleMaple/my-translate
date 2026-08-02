import { app, Menu, Tray } from 'electron'
import { join } from 'node:path'

import { IPC } from '../shared/ipc'
import { updateSettings } from './settings'
import { forceQuit, getMainWindow, showMainWindow } from './window'

/**
 * 系统托盘
 * 注意：tray 必须全局持有，否则会被 GC 导致图标消失（Electron 经典坑）
 */
let tray: Tray | null = null

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tray.ico')
    : join(app.getAppPath(), 'build', 'tray.ico')
}

export function createTray(): void {
  tray = new Tray(trayIconPath())
  tray.setToolTip('英汉翻译 · 生词本')
  tray.on('click', () => {
    const win = getMainWindow()
    if (win?.isVisible()) {
      win.hide()
    } else {
      showMainWindow()
    }
  })
  refreshTrayMenu()
}

export function refreshTrayMenu(): void {
  if (!tray) return
  const win = getMainWindow()
  const alwaysOnTop = win ? win.isAlwaysOnTop() : false

  const menu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏',
      click: () => {
        const w = getMainWindow()
        if (w?.isVisible()) {
          w.hide()
        } else {
          showMainWindow()
        }
      }
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: alwaysOnTop,
      click: (item) => {
        const flag = item.checked
        updateSettings({ window: { alwaysOnTop: flag } })
        const w = getMainWindow()
        w?.setAlwaysOnTop(flag)
        // 同步渲染端（标题栏图钉状态）
        w?.webContents.send(IPC.WindowAlwaysOnTopChanged, flag)
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => forceQuit()
    }
  ])

  tray.setContextMenu(menu)
}
