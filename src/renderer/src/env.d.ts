/// <reference types="vite/client" />

import type { RendererApi } from '@shared/types'

declare global {
  interface Window {
    /** preload 通过 contextBridge 暴露的主进程能力入口 */
    api: RendererApi
  }
}

export {}
