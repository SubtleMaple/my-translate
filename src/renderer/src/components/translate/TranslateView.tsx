import { Languages } from 'lucide-react'

/** 占位视图：翻译功能在 Phase 4 实现 */
export function TranslateView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <Languages className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">翻译功能将在 Phase 4 实现</p>
    </div>
  )
}
