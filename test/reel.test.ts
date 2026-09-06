import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cardHtml, panes } from '../src/reel/card.ts'
import { defaultReelTemplate } from '../src/reel/defaultTemplate.ts'
import { steadyRuns } from '../src/reel/run.ts'

describe('reel card', () => {
  it('panes tile the canvas around the band and leave the band uncovered', () => {
    const html = panes({ w: 1080, h: 1440 }, { x: 40, y: 412, w: 1000, h: 513 }, '#000')
    const rects = [...html.matchAll(/left:(\d+)px;top:(\d+)px;width:(\d+)px;height:(\d+)px/g)].map((m) => m.slice(1, 5).map(Number))
    assert.equal(rects.length, 4)
    const area = rects.reduce((a, [, , w, h]) => a + w! * h!, 0)
    assert.equal(area, 1080 * 1440 - 1000 * 513)
    for (const [x, y, w, h] of rects) assert.ok(x! + w! <= 40 || x! >= 1040 || y! + h! <= 412 || y! >= 925, 'pane overlaps the band')
  })
  it('the document never paints the card background, only the panes', () => {
    const html = cardHtml({ canvas: { w: 1080, h: 1440 }, band: { x: 40, y: 412, w: 1000, h: 513 }, copy: { title: ['A', 'B'], points: ['p'], colors: { bg: '#123456' } } }, defaultReelTemplate)
    assert.match(html, /html,body\{[^}]*background:transparent/)
    assert.match(html, /\.card\{[^}]*background:transparent/)
    assert.equal((html.match(/background:#123456/g) ?? []).length, 4)
    assert.match(html, /<h1>A<br>B<\/h1>/)
  })
})

describe('steady runs', () => {
  it('finds the beat cadence and its first frame, ignoring the play-press frame', () => {
    const beat = 0.652
    const pts = [0, 1.9, 3.31, 3.43, ...Array.from({ length: 8 }, (_, i) => 3.43 + beat * (i + 1)), 12.0]
    const runs = steadyRuns(pts)
    assert.equal(runs.length, 1)
    assert.equal(runs[0]!.start, 3.43)
    assert.equal(runs[0]!.frames, 9)
    assert.ok(Math.abs(runs[0]!.gap - beat) < 0.001)
    assert.deepEqual(steadyRuns([0, 1, 3, 3.5]), [])
  })
})
