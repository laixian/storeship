/**
 * The built-in template: flat background, a step counter, big title, the
 * cards with a shadow and a hairline. Deliberately plain — a project's own
 * template replaces this; see the README for the contract.
 */
import type { Template, TemplateContext } from './types.ts'

const INK = '#111111'

export const defaultTemplate: Template = {
  titleLines: 2,
  render(ctx: TemplateContext): string {
    const { device: d, shot, total, title } = ctx
    const u = d.unit
    const L = Math.round(100 * u)
    const size = Math.round((title.join('').length > 24 ? 110 : 140) * u)
    const cards = ctx.cards
      .map(({ card: c, img }) => {
        const sw = c.sw ?? img.w
        const imgW = Math.round((c.w * img.w) / sw)
        const scale = imgW / img.w
        return (
          `<div class="card" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px">` +
          `<img src="${img.uri}" style="width:${imgW}px;left:${Math.round(-(c.sx ?? 0) * scale)}px;top:${Math.round(-(c.sy ?? 0) * scale)}px"></div>`
        )
      })
      .join('')
    return `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${d.w}px;height:${d.h}px;overflow:hidden}
.canvas{position:relative;width:${d.w}px;height:${d.h}px;background:${shot.bg};overflow:hidden;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
.step{position:absolute;left:${L}px;top:${Math.round(150 * u)}px;font-size:${Math.round(40 * u)}px;letter-spacing:.2em;color:${INK}99;font-weight:600}
.title{position:absolute;left:${L}px;top:${Math.round(240 * u)}px;width:${d.w - L * 2}px;font-size:${size}px;line-height:1.14;font-weight:700;letter-spacing:-.02em;color:${INK}}
.card{position:absolute;border-radius:${Math.round(48 * u)}px;overflow:hidden;box-shadow:0 ${Math.round(40 * u)}px ${Math.round(80 * u)}px rgba(0,0,0,.3),0 0 0 1px rgba(0,0,0,.2)}
.card img{position:absolute;display:block}
</style><div class="canvas"><div class="step">${shot.sn ? shot.sn + ' · ' : ''}${String(shot.n).padStart(2, '0')}/${String(total).padStart(2, '0')}</div><div class="title">${title.join('<br>')}</div>${cards}</div>`
  },
}
