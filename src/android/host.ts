import { flushDatabase } from './database'
type Handler = (_event: unknown, ...args: any[]) => unknown
export const handlers = new Map<string, Handler>()
export function emit(event: string, value?: unknown): void {
  // Persist before announcing data changes, including background detail generation.
  flushDatabase()
  AndroidHost.post(JSON.stringify({ event, value }))
}
export const ipcMain = { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) }
export const app = { getVersion: () => __APP_VERSION__, getPath: () => '' }
export const dialog = { showSaveDialog: () => { throw Error('Android uses document picker') } }
export const getMainWindow = () => ({
  webContents: { send: emit }, isDestroyed: () => false,
  minimize: () => {}, close: () => {}
})
export const applyAlwaysOnTop = () => {}
export const applyMinimalMode = () => {}
export const applyOpacity = () => {}
export const clampOpacity = (value: number) => Math.max(0.5, Math.min(1, value))
export const refreshTrayMenu = () => {}
export const join = (...parts: string[]) => parts.join('/')
declare const __APP_VERSION__: string
