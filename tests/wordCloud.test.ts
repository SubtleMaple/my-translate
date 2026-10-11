import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { layoutWordCloud, type PlacedWord } from '../src/renderer/src/lib/wordCloud'

const measure = (word: string, size: number) => ({ width: word.length * size * 0.55, ascent: size * 0.8, descent: size * 0.2, left: 0 })
function check(words: PlacedWord[], width: number, height: number) {
  for (let i = 0; i < words.length; i++) {
    const a = words[i]
    assert.ok(a.x >= 0 && a.y >= 0 && a.x+a.width <= width && a.y+a.height <= height)
    assert.ok(a.fontSize >= 14)
    for (const b of words.slice(i + 1)) assert.ok(!(a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y), 'word bounds overlap')
  }
}
test('词云布局确定、按ID稳定、无重叠/越界，放不下的长词与短语有明确补充集合', () => {
  const input = Array.from({ length: 150 }, (_, id) => ({ id, word: id % 9 === 0 ? `a long phrase ${id}` : `word${id}`, fontSize: 14 + id % 25 }))
  input.push({ id: 999, word: 'a'.repeat(1000), fontSize: 38 })
  for (const [width,height] of [[290,260],[800,520]]) {
    const first = layoutWordCloud(input, width,height,measure)
    assert.deepEqual(first.placed, layoutWordCloud(input.filter(w => w.id !== 999), width,height,measure).placed, '放不下的极长词不应把其余词字号压小')
    assert.deepEqual(first, layoutWordCloud([...input].reverse(), width,height,measure))
    check(first.placed,width,height)
    assert.ok(first.placed.length > 0); assert.ok(first.unplaced.includes(999))
    assert.equal(new Set([...first.placed.map(w => w.id), ...first.unplaced]).size, input.length)
    assert.equal(first.placed.length + first.unplaced.length, input.length)
  }
})
test('空集合、极小窗口与重复ID有界处理，恢复窗口可重新排布', () => {
  assert.deepEqual(layoutWordCloud([],300,300,measure), { placed:[],unplaced:[] })
  const one = { id:1,word:'hello',fontSize:24 }
  assert.deepEqual(layoutWordCloud([one,one],0,260,measure), { placed:[],unplaced:[1] })
  assert.equal(layoutWordCloud([one,one],300,260,measure).placed.length,1)
})
