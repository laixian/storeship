import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkShots } from '../src/shots/check.ts'
import { DEVICES, mergeDevices } from '../src/shots/devices.ts'
import { deviceBox, expand, layout, screenShort } from '../src/shots/layout.ts'
import { paintSlot } from '../src/shots/paint.ts'
import { STYLES, extendStyle, resolveTheme } from '../src/shots/styles/index.ts'
import type { Frame, ShotsContent, StageCtx } from '../src/shots/types.ts'

const dev = DEVICES.iphone69!
const stage = STYLES.stage!
const L = ['en-US', 'zh-Hans']
const frame = (over: Partial<Frame> = {}): Frame => ({
  slug: 'home',
  sn: 'HOME',
  bg: '#112233',
  title: { 'en-US': ['Line one', 'Line two'], 'zh-Hans': ['一', '二'] },
  ...(over.screens ? {} : { screen: 'home' }),
  ...over,
})
const brand = { logo: { src: 'home', crop: [0, 0, 600, 300] as [number, number, number, number] } }
/** Stems containing "land" are landscape; "missing" does not exist; "small" is the wrong size. */
const fs = {
  exists: (f: string) => !f.includes('missing'),
  pngSize: (f: string) => (f.includes('small') ? { w: 1290, h: 2796 } : f.includes('land') ? { w: 2868, h: 1320 } : { w: 1320, h: 2868 }),
}
const opts = { srcFile: (d: any, l: string, stem: string) => `${d.prefix}-${l}-${stem}.png`, fs }
const check = (c: ShotsContent, style = stage) => checkShots(c, style, dev, L, opts)

describe('shots layout', () => {
  const m = stage.metrics(dev, 'en-US', {})
  const isLand = (s: string) => s.includes('land')

  it('a hero takes two store slots; numbering counts both', () => {
    const slots = expand([frame({ slug: 'a', hero: {} }), frame({ slug: 'b' })])
    assert.deepEqual(slots.map((s) => [s.n, s.frame.slug, s.half]), [[1, 'a', 0], [2, 'a', 1], [3, 'b', 0]])
  })

  it('one scale everywhere: a landscape phone is the portrait phone turned, and runs off the canvas', () => {
    const placed = layout(expand([frame({ slug: 'p' }), frame({ slug: 'l', screen: 'land' }), frame({ slug: 'e', screen: { src: 'land', anchor: 'end' } })]), dev, m, isLand, true)
    const [p, l, e] = placed
    assert.equal(p!.w, m.phone)
    assert.equal(l!.h, p!.w)
    assert.equal(l!.sh, p!.sw)
    assert.ok(l!.x + l!.w > dev.w, 'start-anchored landscape runs off the right')
    assert.equal(l!.x, p!.x, 'keeps the portrait left edge')
    assert.equal(e!.x + e!.w, p!.x + p!.w, 'end-anchored keeps the portrait right edge')
    assert.ok(e!.x < 0)
    assert.deepEqual(placed.map((q) => [q.y, q.rot]), [[m.baseline, 0], [m.baseline, 0], [m.baseline, 0]])
  })

  it('a pair stacks from the baseline at the same scale', () => {
    const [a, b] = layout(expand([frame({ screens: ['land', 'home'] })]), dev, m, isLand, true)
    assert.equal(a!.y, m.baseline)
    assert.equal(b!.y, m.baseline + a!.h + m.gap)
    assert.equal(a!.sh, b!.sw)
  })

  it('the hero is the only tilted phone, cut by the seam at seamAt', () => {
    const placed = layout(expand([frame({ slug: 'h', screen: 'land', hero: { seamAt: 0.5, tilt: -3 } }), frame({ slug: 'x' })]), dev, m, isLand, true)
    const h = placed.find((p) => p.span)!
    assert.equal(h.rot, -3)
    assert.equal(h.x + h.w / 2, dev.w)
    assert.ok(placed.filter((p) => !p.span).every((p) => p.rot === 0))
  })

  it('the bare-card look has no body: the box is the screen', () => {
    const s = screenShort(dev, 1000, false)
    assert.deepEqual(deviceBox(dev, s, false, false), { w: 1000, h: 2173, sw: 1000, sh: 2173 })
    assert.ok(deviceBox(dev, screenShort(dev, 1000, true), false, true).sw < 1000)
  })
})

describe('shots check', () => {
  it('passes a well-formed set', () => {
    assert.deepEqual(check({ brand, frames: [frame({ slug: 'a', screen: 'land', hero: {} }), frame({ slug: 'b' }), frame({ slug: 'c', screens: ['land', 'home'] })] }), [])
  })

  it('reports every problem in one pass', () => {
    const bad = check({
      theme: { nope: 1, accent: 'teal' },
      frames: [
        frame({ slug: 'a', hero: { seamAt: 0.9, tilt: 12 } }),
        frame({ slug: 'b', screens: ['home', 'land'], title: { 'en-US': ['only one'], 'zh-Hans': ['一', '二'] } }),
        frame({ slug: 'c', screens: ['home', 'home'] }),
        frame({ slug: 'c', screen: 'missing', bg: 'red' }),
        frame({ slug: 'd', screen: { src: 'home', anchor: 'end' } }),
        frame({ slug: 'e', screen: 'small' }),
        frame({ slug: 'f', screen: undefined }),
      ],
    }).join('\n')
    for (const re of [/no such token/, /theme.accent must be #RRGGBB/, /seamAt 0.9/, /tilt 12° is over 8°/, /carries the brand/, /en-US title must be 2/, /two frames with two phones in a row/, /slug "c" is used twice/, /missing source screenshot/, /bg must be #RRGGBB/, /anchor only applies to landscape/, /not iphone69's native/, /no screen/])
      assert.match(bad, re)
  })

  it('counts a hero twice against the 10-screenshot limit', () => {
    const frames = [frame({ slug: 'h', hero: {} }), ...Array.from({ length: 9 }, (_, i) => frame({ slug: `f${i}` }))]
    assert.match(check({ brand, frames }).join('\n'), /at most 10 .* make 11/)
  })

  it('a hero must fit its two slots', () => {
    const bad = check({ brand, frames: [frame({ slug: 'h', screen: 'land', hero: { seamAt: 0.3, tilt: 8 } }), frame({ slug: 'x' })] })
    assert.match(bad.join('\n'), /overhangs its two slots/)
  })

  it('style tripwires: bg required, title length, sn pattern', () => {
    const t = extendStyle('color', { titleMax: { 'en-US': 5 }, snPattern: /^[A-Z]{2,4}$/ })
    const bad = check({ frames: [frame({ sn: 'toolong1', bg: undefined })] }, t).join('\n')
    assert.match(bad, /set bg/)
    assert.match(bad, /over 5/)
    assert.match(bad, /sn "toolong1"/)
    assert.deepEqual(check({ frames: [frame({ bg: undefined })] }), [], 'stage does not need bg')
  })

  it('brand logo crop must lie inside its source', () => {
    const bad = check({ brand: { logo: { src: 'home', crop: [1000, 0, 600, 300] } }, frames: [frame({ slug: 'h', hero: {} })] })
    assert.match(bad.join('\n'), /iphone69 crop \[1000, 0, 600, 300\] is outside/)
    const table = { logo: { src: 'home', crop: { ipad13: [0, 0, 10, 10] as [number, number, number, number] } } }
    assert.match(check({ brand: table, frames: [frame({ slug: 'h', hero: {} })] }).join('\n'), /no crop for iphone69/)
    assert.deepEqual(check({ brand: { logo: { src: 'home', crop: { iphone69: [0, 0, 600, 300] } } }, frames: [frame({ slug: 'h', hero: {} })] }), [])
  })
})

describe('shots paint', () => {
  const frames = [frame({ slug: 'h', screen: 'land', hero: {}, title: { 'en-US': ['A & B', 'two'] } }), frame({ slug: 'x', screen: 'home' })]
  const ctx = (style = stage): StageCtx => {
    const slots = expand(frames)
    return { device: dev, locale: 'en-US', theme: resolveTheme(style), slots, W: dev.w, H: dev.h, stageW: dev.w * slots.length, metrics: style.metrics(dev, 'en-US', {}), brand, img: (s) => ({ uri: `data:${s}`, w: 1320, h: 2868 }) }
  }
  const isLand = (s: string) => s.includes('land')

  it('shifts the stage, carries the hero into both halves, inlines only what the slot shows', () => {
    const c = ctx()
    const placed = layout(c.slots, dev, c.metrics, isLand, true)
    const html = [0, 1, 2].map((i) => paintSlot(stage, c, placed, i, c.img))
    assert.match(html[1]!, /translateX\(-1320px\)/)
    assert.ok(html[0]!.includes('data:land') && html[1]!.includes('data:land'))
    assert.ok(!html[2]!.includes('data:land'))
    assert.ok(html[2]!.includes('<img src="data:home"'))
    assert.match(html[1]!, /A &amp; B<br>two/)
    assert.match(html[1]!, /02\/03/)
    assert.ok(html[0]!.includes('data:home'), 'the brand half shows the logo crop')
  })

  it('every built-in style paints every slot', () => {
    for (const st of Object.values(STYLES)) {
      const c = ctx(st)
      const placed = layout(c.slots, dev, c.metrics, isLand, st.look === 'bezel')
      for (let i = 0; i < c.slots.length; i++) assert.match(paintSlot(st, c, placed, i, c.img), st.look === 'bezel' ? /class="ph"/ : /class="card"/, st.id)
    }
  })

  it('extendStyle wraps a base and merges its tokens', () => {
    const st = extendStyle('stage', (b) => ({ id: 'mine', tokens: { extra: { type: 'color', default: '#000000', doc: 'x' } }, backdrop: (s) => b.backdrop(s) + '<i id="mine"></i>' }))
    assert.ok(st.tokens.accent && st.tokens.extra)
    assert.match(st.backdrop(ctx(st)), /id="mine"/)
    assert.throws(() => extendStyle('nope', {}), /unknown base style/)
  })
})

describe('devices', () => {
  it('merges overrides and requires sizes for new ids', () => {
    const m = mergeDevices({ iphone69: { id: 'iphone69', prefix: 'ip' }, custom: { id: 'custom', w: 100, h: 200, displayType: 'X' } })
    assert.equal(m.iphone69!.prefix, 'ip')
    assert.equal(m.iphone69!.w, 1320)
    assert.equal(m.custom!.srcW, 100)
    assert.equal(m.custom!.body.kind, 'island')
    assert.throws(() => mergeDevices({ nope: { id: 'nope' } }), /needs w, h/)
  })
})

describe('style modules', () => {
  it('a module may export a factory; it gets the running storeship kit', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { resolveStyle } = await import('../src/shots/load.ts')
    const dir = mkdtempSync(join(tmpdir(), 'ss-style-'))
    writeFileSync(join(dir, 'mine.mjs'), `export default ({ extendStyle, styleKit }) => extendStyle('color', { id: 'mine', summary: typeof styleKit.rail })`)
    const st = await resolveStyle('./mine.mjs', dir)
    assert.equal(st.id, 'mine')
    assert.equal(st.summary, 'function')
    assert.equal(st.look, 'bezel')
    await assert.rejects(resolveStyle('nope', dir), /unknown style/)
  })
})
