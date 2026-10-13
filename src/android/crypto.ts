export const randomUUID = () => crypto.randomUUID()
export function randomBytes(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  return { readUInt32LE: () => new DataView(bytes.buffer).getUint32(0, true) }
}
export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw Error('Unsupported hash')
  return { update: (text: string) => ({ digest: (_encoding: string) => AndroidHost.sha256(text) }) }
}
