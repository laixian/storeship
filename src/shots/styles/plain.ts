/**
 * `plain` — the look storeship shipped with before styles existed, kept as a
 * style: each frame's flat bg, a step counter, a big bold title, and the bare
 * screens as rounded cards with a shadow and a hairline. The layout rules
 * (one scale, one baseline, landscape running off the side) apply as they do
 * to every style.
 */
import type { Style } from '../types.ts'
import { brandBox, counter, esc, logo, panes, tok } from './common.ts'

const TITLE_TOP = 240, BASE = 820

const size = (u: number, lines: string[]) => Math.round((lines.join('').length > 24 ? 110 : 140) * u)

export const plainStyle: Style = {
  id: 'plain',
  summary: 'the original look: flat bg per frame, step counter, bold title, bare screens as rounded cards',
  look: 'card',
  needsBg: true,
  tokens: {
    ink: { type: 'color', default: '#111111', doc: 'title and counter' },
    font: { type: 'font', default: '-apple-system,"PingFang SC","Helvetica Neue",sans-serif', doc: 'all text' },
  },
  metrics(d) {
    const u = d.unit
    const baseline = Math.round(BASE * u)
    // bare cards have no bezel, so the same outer width would make every screen bigger than in the framed styles
    return { phone: Math.round(d.w * 0.8), baseline, heroY: Math.round(baseline + (d.h - baseline) * 0.45), gap: Math.round(90 * u) }
  },
  css(s) {
    const u = s.device.unit, r = (n: number) => Math.round(n * u), ink = tok(s, 'ink')
    return `.slot,.tag{font-family:${tok(s, 'font')}}
.step{position:absolute;left:${r(100)}px;top:${r(150)}px;font-size:${r(40)}px;letter-spacing:.2em;color:${ink}99;font-weight:600}
.title{position:absolute;left:${r(100)}px;top:${r(TITLE_TOP)}px;width:${s.W - r(200)}px;line-height:1.14;font-weight:700;letter-spacing:-.02em;color:${ink}}
.tag{position:absolute;left:0;right:0;text-align:center;font-size:${r(56)}px;font-weight:600;color:${ink}}
.card{border-radius:${r(48)}px;box-shadow:0 ${r(40)}px ${r(80)}px rgba(0,0,0,.3),0 0 0 1px rgba(0,0,0,.2)}`
  },
  backdrop: (s) => panes(s),
  header(s) {
    const sn = s.slot.frame.sn
    return `<div class="step">${sn ? esc(sn) + ' · ' : ''}${counter(s)}</div>` +
      `<div class="title" style="font-size:${size(s.device.unit, s.title)}px">${s.title.map(esc).join('<br>')}</div>`
  },
  brand(s) {
    const u = s.device.unit
    const tag = s.brand?.tagline?.[s.locale]
    // with a tagline, the logo gives up the bottom of the box to it
    const box = brandBox(s, Math.round(300 * u), Math.round(100 * u), Math.round(960 * u))
    const tagH = tag ? Math.round((tag.length * 70 + 40) * u) : 0
    return logo(s, { ...box, h: box.h - tagH }, false) +
      (tag ? `<div class="tag" style="top:${box.y + box.h - tagH + Math.round(40 * u)}px">${tag.map(esc).join('<br>')}</div>` : '')
  },
}
