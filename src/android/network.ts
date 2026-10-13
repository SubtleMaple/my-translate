import { decodeBytes } from './native'

interface Packet { id: string; type: 'headers' | 'chunk' | 'end' | 'error'; status?: number; data?: string; message?: string }
const requests = new Map<string, (packet: Packet) => void>()
export function receiveNetwork(packet: Packet): void { requests.get(packet.id)?.(packet) }

/** All remote traffic goes through the Android network stack, never WebView fetch. */
export const nativeFetch: typeof fetch = (input, init = {}) => new Promise<Response>((resolve, reject) => {
  const id = crypto.randomUUID()
  let stream: ReadableStreamDefaultController<Uint8Array>
  let headersReceived = false
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller } })
  const cleanup = () => { requests.delete(id); init.signal?.removeEventListener('abort', abort) }
  const fail = (error: Error) => {
    if (headersReceived) stream.error(error)
    else reject(error)
    cleanup()
  }
  const abort = () => { AndroidHost.cancel(id); fail(new DOMException('Aborted', 'AbortError')) }
  if (init.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
  requests.set(id, (packet) => {
    if (packet.type === 'headers') {
      headersReceived = true
      resolve(new Response(body, { status: packet.status }))
    } else if (packet.type === 'chunk') stream.enqueue(decodeBytes(packet.data!))
    else if (packet.type === 'end') { stream.close(); cleanup() }
    else fail(Error(packet.message || '网络连接失败'))
  })
  init.signal?.addEventListener('abort', abort, { once: true })
  try {
    AndroidHost.request(JSON.stringify({ id, url: String(input), headers: Object.fromEntries(new Headers(init.headers)), body: init.body }))
  } catch (e) { fail(e as Error) }
})
