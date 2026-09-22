import { Toaster as Sonner } from 'sonner'
import { useSettingsStore } from '@/stores/settingsStore'

type ToasterProps = React.ComponentProps<typeof Sonner>

/**
 * shadcn/ui 风格的 sonner 封装（不依赖 next-themes，
 * 主题由 uiStore 通过 document.documentElement 的 .dark class 控制）
 */
function Toaster({ ...props }: ToasterProps) {
  const minimal = useSettingsStore((s) => s.settings.ui.minimal)
  return (
    <Sonner
      position="bottom-center"
      offset={minimal ? 8 : 60}
      duration={2400}
      visibleToasts={1}
      className="toaster group"
      toastOptions={{
        // Informational notices must not intercept rapid add/copy/navigation clicks.
        style: { pointerEvents: 'none' },
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground'
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
