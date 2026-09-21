/**
 * `stage` — one dark room for the whole set. The ground, soft accent glows,
 * vertical hairlines and a progress rail all run through every seam, so the
 * row reads as one picture; the logo is feathered into the dark.
 */
import type { Style } from '../types.ts'
import { brandBox, counter, esc, isCjk, logo, rail, railCss, rhythm, seams, tok } from './common.ts'

const size = (u: number, locale: string) => Math.round((isCjk(locale) ? 150 : 118) * u)

export const stageStyle: Style = {
  id: 'stage',
  summary: 'dark ground and accent glows running through the whole set, framed devices, a progress rail under the titles',
  look: 'bezel',
  tokens: {
    bg: { type: 'color', default: '#0B0F0E', doc: 'the ground of the whole set' },
    ink: { type: 'color', default: '#F2F5F4', doc: 'titles' },
    accent: { type: 'color', default: '#2FE9DF', doc: 'labels, the rail, the main glow' },
    accent2: { type: 'color', default: '#FF2D62', doc: 'the second glow' },
    titleFont: { type: 'font', default: '"PingFang SC","Hiragino Sans GB",-apple-system,sans-serif', doc: 'title face' },
    labelFont: { type: 'font', default: '"DIN Condensed","DIN Alternate",-apple-system,sans-serif', doc: 'label and counter face' },
  },
  metrics: (d, locale) => rhythm(d.unit, d.w, d.h, size(d.unit, locale), 2),
  css(s) {
    const u = s.device.unit, r = (n: number) => Math.round(n * u)
    return `.lab{position:absolute;left:${r(112)}px;right:${r(112)}px;top:${r(158)}px;display:flex;align-items:center;gap:${r(26)}px;font:700 ${r(42)}px/1 ${tok(s, 'labelFont')};letter-spacing:.18em;color:${tok(s, 'accent')}}
.lab b{flex:1;height:2px;background:#ffffff3d}
.title{position:absolute;left:${r(112)}px;width:${s.W - r(190)}px;font-family:${tok(s, 'titleFont')};font-weight:600;line-height:1.16;letter-spacing:-.02em;color:${tok(s, 'ink')};-webkit-text-stroke:${r(3)}px ${tok(s, 'ink')}}
.tag{position:absolute;left:0;right:0;text-align:center;font:500 ${r(52)}px/1.3 ${tok(s, 'titleFont')};letter-spacing:.2em;color:${tok(s, 'ink')};opacity:.7}
.ph{filter:drop-shadow(0 ${r(50)}px ${r(70)}px rgba(0,0,0,.7))}
${railCss(u, tok(s, 'accent'))}`
  },
  backdrop(s) {
    const u = s.device.unit
    const glows: string[] = []
    for (let k = 0, x = s.W; x < s.stageW; k++, x += Math.round(2.5 * s.W)) {
      const c = k % 2 ? tok(s, 'accent2') : tok(s, 'accent')
      const d = Math.round(1600 * u)
      glows.push(`<div style="position:absolute;left:${x - d / 2}px;top:${Math.round((k % 2 ? 1300 : 900) * u)}px;width:${d}px;height:${d}px;background:radial-gradient(closest-side,${c}2e,transparent)"></div>`)
    }
    const m = rhythm(u, s.W, s.H, size(u, s.locale), 2)
    return `<div style="position:absolute;inset:0;background:${tok(s, 'bg')}"></div>${glows.join('')}${seams('#ffffff10', Math.round(110 * u))}${rail(s, m.rule)}`
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
    const box = brandBox(s, Math.round(300 * u), Math.round(60 * u), Math.round(1040 * u))
    const tagH = tag ? Math.round((tag.length * 70 + 40) * u) : 0
    return logo(s, { ...box, h: box.h - tagH }, true) +
      (tag ? `<div class="tag" style="top:${box.y + box.h - tagH + Math.round(40 * u)}px">${tag.map(esc).join('<br>')}</div>` : '')
  },
}
