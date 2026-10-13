/** Only the isolated Android service WebView receives this bridge. */
export interface NativeHost {
  read(name: string): string
  write(name: string, value: string): string
  sha256(value: string): string
  post(message: string): void
  request(message: string): void
  cancel(id: string): void
  exportFile(message: string): void
}
declare global { var AndroidHost: NativeHost }

export function readStored(name: string): string | null {
  const result = JSON.parse(AndroidHost.read(name))
  if (result.error) throw Error(result.error)
  return result.value
}
export function writeStored(name: string, value: string): void {
  const result = JSON.parse(AndroidHost.write(name, value))
  if (result.error) throw Error(result.error)
}
export function encodeBytes(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}
export function decodeBytes(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}
