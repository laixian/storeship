/**
 * `color` — a flat brand colour per frame, dark ink, framed devices. The
 * hairlines and the progress rail still run through every seam, so the row
 * holds together even though the ground changes colour frame to frame.
 */
import type { Style } from '../types.ts'
import { brandBox, counter, esc, isCjk, logo, panes, rail, railCss, rhythm, seams, tok } from './common.ts'

const size = (u: number, locale: string) => Math.round((isCjk(locale) ? 150 : 118) * u)

export const colorStyle: Style = {
  id: 'color',
  summary: "each frame's own bg colour, dark ink, framed devices, a progress rail through the set",
  look: 'bezel',
  needsBg: true,
  tokens: {
    ink: { type: 'color', default: '#0A0E0D', doc: 'titles, labels, rail, hairlines' },
    titleFont: { type: 'font', default: '"PingFang SC","Hiragino Sans GB",-apple-system,sans-serif', doc: 'title face' },
    labelFont: { type: 'font', default: '"DIN Condensed","DIN Alternate",-apple-system,sans-serif', doc: 'label and counter face' },
  },
  metrics: (d, locale) => rhythm(d.unit, d.w, d.h, size(d.unit, locale), 2),
  css(s) {
    const u = s.device.unit, r = (n: number) => Math.round(n * u), ink = tok(s, 'ink')
    return `.lab{position:absolute;left:${r(112)}px;right:${r(112)}px;top:${r(158)}px;display:flex;align-items:center;gap:${r(26)}px;font:700 ${r(42)}px/1 ${tok(s, 'labelFont')};letter-spacing:.18em;color:${ink}b8}
.lab b{flex:1;height:2px;background:${ink}3d}
.title{position:absolute;left:${r(112)}px;width:${s.W - r(190)}px;font-family:${tok(s, 'titleFont')};font-weight:600;line-height:1.16;letter-spacing:-.02em;color:${ink};-webkit-text-stroke:${r(3)}px ${ink}}
.tag{position:absolute;left:0;right:0;text-align:center;font:500 ${r(52)}px/1.3 ${tok(s, 'titleFont')};letter-spacing:.2em;color:${ink};opacity:.75}
.ph{filter:drop-shadow(0 ${r(50)}px ${r(70)}px rgba(0,0,0,.38))}
${railCss(u, ink)}`
  },
  backdrop(s) {
    const u = s.device.unit
    const m = rhythm(u, s.W, s.H, size(u, s.locale), 2)
    return `${panes(s)}${seams(`${tok(s, 'ink')}10`, Math.round(110 * u))}${rail(s, m.rule)}`
  },
  header(s) {
    const u = s.device.unit, size_ = size(u, s.locale)
    const m = rhythm(u, s.W, s.H, size_, 2)
    return `<div class="lab"><span>${esc(s.slot.frame.sn ?? '')}</span><b></b><span>${counter(s)}</span></div>` +
      `<div class="title" style="top:${m.titleTop}px;font-size:${size_}px">${s.title.map(esc).join('<br>')}</div>`
  },
  brand(s) {
    const u = s.device.unit
    const tag = s.brand?.tagline?.[s.locale]
    // with a tagline, the logo gives up the bottom of the box to it
    const box = brandBox(s, Math.round(300 * u), Math.round(112 * u), Math.round(960 * u))
    const tagH = tag ? Math.round((tag.length * 70 + 40) * u) : 0
    return logo(s, { ...box, h: box.h - tagH }, false) +
      (tag ? `<div class="tag" style="top:${box.y + box.h - tagH + Math.round(40 * u)}px">${tag.map(esc).join('<br>')}</div>` : '')
  },
}
