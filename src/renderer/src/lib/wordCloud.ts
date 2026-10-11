export interface CloudWord { id: number; word: string; fontSize: number }
export interface WordMeasure { width: number; ascent: number; descent: number; left: number }
export interface PlacedWord extends CloudWord { x: number; y: number; width: number; height: number; textX: number; baseline: number }
export interface CloudLayout { placed: PlacedWord[]; unplaced: number[] }

const hash = (word: string) => {
  let value = 2166136261
  for (let i = 0; i < word.length; i++) value = Math.imul(value ^ word.charCodeAt(i), 16777619)
  return value >>> 0
}
const overlap = (a: PlacedWord, b: PlacedWord) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

/** 有界螺旋搜索+网格碰撞检测；完整词条为一个元素，长词放不下则交给补充列表。 */
export function layoutWordCloud(input: CloudWord[], width: number, height: number, measure: (word: string, size: number) => WordMeasure): CloudLayout {
  const words = [...new Map(input.map(word => [word.id, word])).values()].sort((a, b) => b.fontSize - a.fontSize || a.id - b.id)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 40 || height < 40) return { placed: [], unplaced: words.map(w => w.id) }
  const totalArea = words.reduce((area, word) => {
    const minimum = measure(word.word, 14)
    if (minimum.width + 12 > width - 8 || minimum.ascent + minimum.descent + 8 > height - 8) return area
    const m = measure(word.word, word.fontSize)
    return area + (m.width + 12) * (m.ascent + m.descent + 8)
  }, 0)
  const scale = Math.min(1, Math.sqrt(width * height * 0.6 / Math.max(1, totalArea)))
  const placed: PlacedWord[] = [], unplaced: number[] = [], grid = new Map<string, PlacedWord[]>()
  const cells = (r: PlacedWord) => {
    const keys: string[] = []
    for (let x = Math.floor(r.x / 32); x <= Math.floor((r.x + r.width) / 32); x++)
      for (let y = Math.floor(r.y / 32); y <= Math.floor((r.y + r.height) / 32); y++) keys.push(`${x}:${y}`)
    return keys
  }
  for (const word of words) {
    const fontSize = Math.max(14, Math.round(word.fontSize * scale)), m = measure(word.word, fontSize)
    const w = Math.ceil(m.width) + 12, h = Math.ceil(m.ascent + m.descent) + 8
    if (![w, h, m.left, m.ascent].every(Number.isFinite) || w > width - 8 || h > height - 8) { unplaced.push(word.id); continue }
    const start = hash(`${word.id}:${word.word}`) / 4294967296 * Math.PI * 2
    let found = false
    for (let step = 0; step < 1400; step++) {
      const angle = start + step * 0.41, radius = Math.sqrt(step / 1400) * height * 0.75
      const x = Math.round(width / 2 + Math.cos(angle) * radius * width / height - w / 2)
      const y = Math.round(height / 2 + Math.sin(angle) * radius - h / 2)
      if (x < 4 || y < 4 || x + w > width - 4 || y + h > height - 4) continue
      const rect: PlacedWord = { ...word, fontSize, x, y, width: w, height: h, textX: x + 6 + Math.max(0, m.left), baseline: y + 4 + m.ascent }
      const keys = cells(rect)
      if (keys.some(key => grid.get(key)?.some(other => overlap(rect, other)))) continue
      placed.push(rect)
      for (const key of keys) { const bucket = grid.get(key) || []; bucket.push(rect); grid.set(key, bucket) }
      found = true; break
    }
    if (!found) unplaced.push(word.id)
  }
  return { placed, unplaced }
}
