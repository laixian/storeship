/**
 * Default card: label line, two-line title (with <em> accents), a glowing
 * ring around the hole, bullet points below, a brand line at the bottom.
 * Copy and colours come from `content.copy`.
 */
import type { ReelTemplate, ReelTemplateContext } from './types.ts'

type Copy = { sn?: string; title?: string[]; points?: string[]; brand?: string; brandName?: string; colors?: Record<string, string> }

const colors = (c: ReelTemplateContext): Required<NonNullable<Copy['colors']>> => ({
  bg: '#0A0E0D',
  text: '#F1F5F2',
  accent: '#2FE9DF',
  magenta: '#FF2D62',
  concrete: '#8A918B',
  ...((c.content.copy as Copy | undefined)?.colors ?? {}),
})

export const defaultReelTemplate: ReelTemplate = {
  css(ctx) {
    const C = colors(ctx)
    const { canvas, band } = ctx
    const bottom = band.y + band.h
    return `
.card{font-family:"PingFang SC","Helvetica Neue",sans-serif}
.sn{position:absolute;left:56px;top:88px;font-size:24px;letter-spacing:.42em;color:${C.concrete};font-weight:600}
.sn::after{content:"";display:inline-block;width:120px;height:2px;background:${C.concrete};opacity:.35;vertical-align:middle;margin-left:22px;margin-bottom:6px}
h1{position:absolute;left:56px;top:150px;width:${canvas.w - 112}px;font-size:92px;line-height:1.2;font-weight:700;color:${C.text};letter-spacing:-.02em}
h1 em{font-style:normal;color:${C.accent}}
.ring{position:absolute;left:${band.x - 1}px;top:${band.y - 1}px;width:${band.w + 2}px;height:${band.h + 2}px;border:1px solid ${C.accent}55;box-shadow:0 0 46px 6px ${C.accent}1f}
ul{position:absolute;left:56px;top:${bottom + 56}px;width:${canvas.w - 112}px;list-style:none}
li{position:relative;padding-left:38px;font-size:40px;line-height:1.42;color:${C.text};opacity:.94;margin-bottom:26px;font-weight:500}
li::before{content:"";position:absolute;left:4px;top:23px;width:14px;height:14px;border-radius:50%;background:${C.accent}}
.brand{position:absolute;left:56px;bottom:74px;font-size:34px;color:${C.concrete};font-weight:500}
.brand b{color:${C.text};font-weight:700}
.brand i{font-style:normal;color:${C.magenta};margin:0 14px}`
  },
  render(ctx) {
    const copy = (ctx.content.copy ?? {}) as Copy
    return (
      ctx.panes +
      (copy.sn ? `<div class="sn">${copy.sn}</div>` : '') +
      `<h1>${(copy.title ?? []).join('<br>')}</h1>` +
      `<div class="ring"></div>` +
      `<ul>${(copy.points ?? []).map((p) => `<li>${p}</li>`).join('')}</ul>` +
      (copy.brand || copy.brandName ? `<div class="brand">${copy.brandName ? `<b>${copy.brandName}</b><i>·</i>` : ''}${copy.brand ?? ''}</div>` : '')
    )
  },
}
