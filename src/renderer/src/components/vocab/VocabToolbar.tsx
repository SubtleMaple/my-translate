import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { VocabSortBy } from '@shared/types'
import { useVocabStore } from '@/stores/vocabStore'

/** 搜索框（防抖）+ 排序下拉 */
export function VocabToolbar() {
  const searchInput = useVocabStore((s) => s.searchInput)
  const setSearchInput = useVocabStore((s) => s.setSearchInput)
  const sortBy = useVocabStore((s) => s.sortBy)
  const setSortBy = useVocabStore((s) => s.setSortBy)

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="搜索单词 / 释义 / 例句…"
          className="pl-8"
        />
      </div>
      <Select value={sortBy} onValueChange={(v) => void setSortBy(v as VocabSortBy)}>
        <SelectTrigger className="w-[7.5rem] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="time">最新优先</SelectItem>
          <SelectItem value="alpha">字母 A–Z</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
