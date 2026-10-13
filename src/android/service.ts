import './compat'
import './native'
import { initDatabase, flushDatabase } from './database'
import { getSettings } from './settings'
import { handlers } from './host'
import { receiveNetwork, nativeFetch } from './network'
import { receiveExport } from './exporter'
import { decodeArguments } from './rpc'
import { registerIpcHandlers } from '../main/ipc'
import { setFetchImpl } from '../main/llm/client'
import { enqueueAllPending } from '../main/services/vocabService'

Object.assign(window, {
  receiveNetwork, receiveExport,
  flushStorage: () => flushDatabase(),
  invokeService: async (request: { id: string; channel: string; args: unknown[]; undefinedArgs?: number[] }) => {
    try {
      const handler = handlers.get(request.channel)
      if (!handler) throw Error('不支持的操作')
      const value = await handler({}, ...decodeArguments(request))
      flushDatabase()
      AndroidHost.post(JSON.stringify({ id: request.id, value }))
    } catch (e) { AndroidHost.post(JSON.stringify({ id: request.id, error: (e as Error).message })) }
  }
})
async function boot() {
  setFetchImpl(nativeFetch)
  getSettings()
  await initDatabase()
  registerIpcHandlers()
  AndroidHost.post(JSON.stringify({ ready: true }))
  enqueueAllPending()
}
void boot().catch((e) => AndroidHost.post(JSON.stringify({ fatal: (e as Error).message })))
