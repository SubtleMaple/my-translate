import { app, dialog } from 'electron'

import { registerIpcHandlers } from './ipc'
import { flushSettings, loadSettings } from './settings'
import { createTray } from './tray'
import { createMainWindow, setQuitting, showMainWindow } from './window'
import { initDatabase } from './db/database'
import { flushDatabase as flushDbFile } from './db/persist'

// 单实例锁：第二个实例启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(async () => {
    loadSettings()
    try {
      const { needFlush } = await initDatabase()
      if (needFlush) {
        // force 写入：新建/迁移后 dirty 标记未必置位，必须强制落盘一次
        flushDbFile(true)
      }
    } catch (e) {
      console.error('[main] 数据库初始化失败:', e)
      dialog.showErrorBox('数据库初始化失败', String((e as Error).message ?? e))
    }
    registerIpcHandlers()
    createMainWindow()
    createTray()
  })

  app.on('before-quit', () => {
    // 标记退出状态（使窗口 close 不再被拦截）并强制落盘配置与数据库
    setQuitting(true)
    flushSettings()
    flushDbFile(true)
  })

  app.on('activate', () => {
    showMainWindow()
  })

  // 注意：不监听 window-all-closed 退出，应用常驻托盘，退出唯一入口是托盘菜单「退出」
}
