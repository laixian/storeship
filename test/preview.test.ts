import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseSegment, xfadeChain } from '../src/preview/cut.ts'
import { parseDuration, parseProbe } from '../src/preview/ffmpeg.ts'
import { checkPreview, defaultSize } from '../src/preview/specs.ts'

describe('preview cut', () => {
  it('parses segment specs, including :p and paths with colons', () => {
    assert.deepEqual(parseSegment('a.mov:1.0:8.5'), { file: 'a.mov', start: 1, duration: 8.5, portrait: false })
    assert.deepEqual(parseSegment('/v:1/seg.mov:0:3:p'), { file: '/v:1/seg.mov', start: 0, duration: 3, portrait: true })
    assert.throws(() => parseSegment('a.mov:1'), /must be/)
    assert.throws(() => parseSegment('a.mov:x:2'), /numbers/)
  })
  it('xfade offsets accumulate from the real durations minus the overlap', () => {
    const c = xfadeChain([8, 6.7, 5], 0.5)
    assert.equal(c.filter, '[0:v][1:v]xfade=transition=fade:duration=0.5:offset=7.5[x1];[x1][2:v]xfade=transition=fade:duration=0.5:offset=13.7[x2]')
    assert.equal(c.last, 'x2')
    assert.equal(c.total, 18.7)
    assert.deepEqual(xfadeChain([9], 0.5), { filter: '', last: '0:v', total: 9 })
  })
})

describe('ffmpeg probe', () => {
  it('reads duration, size, fps, audio from ffmpeg -i output', () => {
    const p = parseProbe(`Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':
  Duration: 00:00:29.76, start: 0.000000, bitrate: 443 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x886, 300 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6D6F6461), 44100 Hz, stereo, fltp, 128 kb/s (default)`)
    assert.deepEqual(p, { duration: 29.76, width: 1920, height: 886, fps: 30, audio: true })
    assert.equal(parseDuration('00:01:02.5'), 62.5)
    assert.throws(() => parseProbe('x.mp4: No such file or directory'), /could not read/)
  })
})

describe('preview spec', () => {
  it('accepts a spec-size 15–30s film and names each violation', () => {
    assert.deepEqual(checkPreview({ duration: 29.76, width: 1920, height: 886, fps: 30, frames: 893, audio: true }, 'IPHONE_67'), [])
    const bad = checkPreview({ duration: 40, width: 1920, height: 1080, fps: 60, frames: 100, audio: false }, 'IPHONE_67')
    assert.match(bad[0]!, /outside 15–30s/)
    assert.match(bad[1]!, /60 fps/)
    assert.match(bad[2]!, /not a IPHONE_67 size/)
    assert.match(bad[3]!, /VFR seam/)
    assert.deepEqual(checkPreview({ duration: 20, width: 1200, height: 1600, fps: 30, audio: false }), [])
  })
  it('default canvas: landscape for iPhone, portrait for iPad', () => {
    assert.deepEqual(defaultSize('IPHONE_67'), [1920, 886])
    assert.deepEqual(defaultSize('IPAD_PRO_3GEN_129'), [1200, 1600])
    assert.deepEqual(defaultSize('IPHONE_67', 'portrait'), [886, 1920])
  })
})
