import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkShots } from '../src/shots/check.ts'
import { defaultTemplate } from '../src/shots/defaultTemplate.ts'
import { DEVICES, mergeDevices } from '../src/shots/devices.ts'
import { renderShot } from '../src/shots/render.ts'
import type { Shot } from '../src/shots/types.ts'

const dev = DEVICES.iphone69!
const shot = (over: Partial<Shot> = {}): Shot => ({
  n: 1,
  slug: 'home',
  sn: 'HOME',
  bg: '#112233',
  title: { 'en-US': ['Line one', 'Line two'], 'zh-Hans': ['一', '二'] },
  cards: { iphone69: [{ x: 70, y: 800, w: 1180, h: 1200, sx: 0, sy: 0, sw: 1320 }] },
  ...over,
})
const fsOk = { exists: () => true, pngSize: () => ({ w: 1320, h: 2868 }) }
const opts = { template: defaultTemplate, srcFile: (d: any, l: string, stem: string) => `${d.prefix}-${l}-${stem}.png`, fs: fsOk }

describe('shots check', () => {
  it('passes a well-formed set', () => {
    assert.deepEqual(checkShots({ shots: [shot()] }, dev, ['en-US', 'zh-Hans'], opts), [])
  })
  it('reports every problem in one pass', () => {
    const bad = checkShots(
      {
        shots: [
          shot({ n: 2, bg: 'red', title: { 'en-US': ['only one'], 'zh-Hans': ['一', '二'] } }),
          shot({ n: 3, slug: 'b', cards: { iphone69: [{ x: -10, y: 0, w: 1400, h: 100 }, { x: 0, y: 2000, w: 1000, h: 1000, sx: 500, sy: 2000, sw: 1000 }] } }),
          shot({ n: 4, slug: 'c', cards: {} }),
        ],
      },
      dev,
      ['en-US', 'zh-Hans'],
      opts,
    )
    const text = bad.join('\n')
    assert.match(text, /numbers must run 1\.\.N/)
    assert.match(text, /bg must be #RRGGBB/)
    assert.match(text, /en-US title must be 2/)
    assert.match(text, /bleeds on both sides/)
    assert.match(text, /crop out of bounds/)
    assert.match(text, /no layout for iphone69/)
    assert.ok(bad.length >= 6)
  })
  it('accepts landscape sources and flags wrong sizes / missing files', () => {
    const land = { exists: (f: string) => !f.includes('missing'), pngSize: () => ({ w: 2868, h: 1320 }) }
    const wide = shot({ cards: { iphone69: [{ x: 70, y: 800, w: 1180, h: 500, sx: 0, sy: 0, sw: 1320 }] } })
    assert.deepEqual(checkShots({ shots: [wide] }, dev, ['en-US'], { ...opts, fs: land }), [])
    // a portrait-shaped crop taller than the landscape source is out of bounds, and says so
    assert.match(checkShots({ shots: [shot()] }, dev, ['en-US'], { ...opts, fs: land })[0]!, /crop out of bounds/)
    const wrong = { exists: () => true, pngSize: () => ({ w: 1290, h: 2796 }) }
    assert.match(checkShots({ shots: [shot()] }, dev, ['en-US'], { ...opts, fs: wrong })[0]!, /not iphone69's native/)
    assert.match(checkShots({ shots: [shot({ slug: 'missing' })] }, dev, ['en-US'], { ...opts, fs: land })[0]!, /missing source screenshot/)
  })
  it('template tripwires: title length and sn pattern', () => {
    const t = { ...defaultTemplate, titleMax: { 'en-US': 5 }, snPattern: /^[A-Z]{2,4}$/ }
    const bad = checkShots({ shots: [shot({ sn: 'toolong1' })] }, dev, ['en-US'], { ...opts, template: t })
    assert.match(bad.join('\n'), /over 5/)
    assert.match(bad.join('\n'), /sn "toolong1"/)
  })
})

describe('devices', () => {
  it('merges overrides and requires sizes for new ids', () => {
    const m = mergeDevices({ iphone69: { id: 'iphone69', prefix: 'ip' }, custom: { id: 'custom', w: 100, h: 200, displayType: 'X' } })
    assert.equal(m.iphone69!.prefix, 'ip')
    assert.equal(m.iphone69!.w, 1320)
    assert.equal(m.custom!.srcW, 100)
    assert.throws(() => mergeDevices({ nope: { id: 'nope' } }), /needs w, h/)
  })
})

describe('render', () => {
  it('the default template places cards with the crop math and prints the step', () => {
    const html = renderShot(defaultTemplate, shot({ cards: { iphone69: [{ x: 10, y: 20, w: 660, h: 500, sx: 100, sy: 50, sw: 660 }] } }), 'en-US', dev, 7, () => ({ uri: 'data:x', w: 1320, h: 2868 }))
    assert.match(html, /01\/07/)
    assert.match(html, /Line one<br>Line two/)
    assert.match(html, /width:1320px;left:-100px;top:-50px/)
    assert.match(html, /background:#112233/)
  })
})
