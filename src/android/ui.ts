import './compat'
import '../preload/index'
import { ipcRenderer } from './rendererBridge'
import { toast } from 'sonner'
import '../renderer/src/main'
import './mobile.css'
document.documentElement.dataset.platform = 'android'
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
  readText: async () => {
    const result = JSON.parse(window.AndroidUI.clipboard('read', ''))
    if (result.error) throw Error(result.error)
    return result.value || ''
  },
  writeText: async (value: string) => {
    const result = JSON.parse(window.AndroidUI.clipboard('write', value))
    if (result.error) throw Error(result.error)
  }
} })
ipcRenderer.on('storage:error', (_event, message) => toast.error(message, { duration: Infinity }))
