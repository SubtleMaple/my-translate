import { BookOpen } from 'lucide-react'

/** 占位视图：生词本功能在 Phase 6 实现 */
export function VocabView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <BookOpen className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">生词本将在 Phase 6 实现</p>
    </div>
  )
}
