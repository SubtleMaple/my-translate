/** Electron preload runs unchanged against this strictly limited Android UI transport. */
import { IPC } from '../shared/ipc'
import { encodeArguments } from './rpc'
declare global { interface Window { AndroidUI: { post: (message: string) => void; clipboard: (operation: string, value: string) => string } } }
const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const listeners = new Map<string, Set<(...args: any[]) => void>>()
Object.assign(window, { receiveHost: (message: { id?: string; event?: string; value?: unknown; error?: string }) => {
  if (message.event) listeners.get(message.event)?.forEach((cb) => cb({}, message.value))
  if (message.id) {
    const call = pending.get(message.id)
    if (!call) return
    clearTimeout(call.timer)
    pending.delete(message.id)
    if (message.error) call.reject(Error(message.error)); else call.resolve(message.value)
  }
} })
export type IpcRendererEvent = unknown
export const ipcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => new Promise<any>((resolve, reject) => {
    const id = crypto.randomUUID()
    // The system document picker may stay open indefinitely.
    const timeout = channel === IPC.VocabExport ? 24 * 60 * 60_000 : 180_000
    const timer = setTimeout(() => { pending.delete(id); reject(Error('操作超时，请重试')) }, timeout)
    pending.set(id, { resolve, reject, timer })
    window.AndroidUI.post(JSON.stringify({ id, channel, ...encodeArguments(args) }))
  }),
  on: (event: string, cb: (...args: any[]) => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(cb) },
  removeListener: (event: string, cb: (...args: any[]) => void) => { listeners.get(event)?.delete(cb) }
}
export const contextBridge = { exposeInMainWorld: (name: string, api: unknown) => Object.assign(window, { [name]: api }) }
