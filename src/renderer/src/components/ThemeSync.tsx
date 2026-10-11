import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

export function ThemeSync() {
  const { theme, palette } = useSettingsStore((s) => s.settings.ui)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
      useUiStore.setState({ dark })
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [theme])
  useEffect(() => { document.documentElement.dataset.palette = palette || 'bamboo' }, [palette])
  return null
}
