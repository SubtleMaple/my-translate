import { app, dialog, net } from 'electron'

import { registerIpcHandlers } from './ipc'
import { flushSettings, loadSettings } from './settings'
import { createTray } from './tray'
import { createMainWindow, setQuitting, showMainWindow } from './window'
import { initDatabase } from './db/database'
import { flushDatabase as flushDbFile } from './db/persist'
import { enqueueAllPending } from './services/vocabService'
import { setFetchImpl } from './llm/client'

// Development checks use a disposable profile, never the user's working vocabulary.
if (!app.isPackaged && process.env.MY_TRANSLATE_USER_DATA) {
  app.setPath('userData', process.env.MY_TRANSLATE_USER_DATA)
}

// 单实例锁：第二个实例启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(async () => {
    // LLM 请求改走 Chromium 网络栈：自动跟随系统代理（Clash 普通代理模式可用），
    // 未配置代理时直连（TUN 透明代理模式同样不受影响）
    setFetchImpl((input, init) =>
      net.fetch(input as Parameters<typeof net.fetch>[0], init as Parameters<typeof net.fetch>[1])
    )
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
    // 崩溃恢复：重启后遗留的 pending 词自动重新入队生成详情
    enqueueAllPending()
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
