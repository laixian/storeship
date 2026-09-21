/**
 * One slot's HTML. The whole set is one stage `stageW` wide; this document
 * shows it shifted by -i·W in a W×H window, so the style's backdrop and a
 * hero phone line up across seams without any image slicing. Everything that
 * belongs to one slot is clipped to it — a phone running off a frame must not
 * reappear in the next one. Only images this slot can show are inlined.
 */
import { bodyCss, deviceHtml } from './body.ts'
import type { Img, Placed, SlotCtx, StageCtx, Style } from './types.ts'

export function slotCtx(s: StageCtx, i: number, placed: Placed[] = []): SlotCtx {
  const slot = s.slots[i]!
  const hero = placed.find((p) => p.span && (p.slot === i || p.slot + 1 === i))
  return { ...s, slot, i, title: slot.frame.title[s.locale] ?? [], hero }
}

export function paintSlot(style: Style, s: StageCtx, placed: Placed[], i: number, imgFor: (src: string) => Img): string {
  const { W, H, device: d } = s
  const framed = style.look === 'bezel'
  const cardR = Math.round(48 * d.unit)
  const phone = (p: Placed) => deviceHtml(d, p, imgFor(p.src).uri, framed, cardR)
  const spans = placed.filter((p) => p.span && (p.slot === i || p.slot + 1 === i)).map(phone).join('')
  const ctx = slotCtx(s, i, placed)
  const own = placed.filter((p) => !p.span && p.slot === i).map(phone).join('')
  const head = ctx.slot.hero && ctx.slot.half === 0 ? style.brand(ctx) : style.header(ctx)
  return `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden}
.stage{position:absolute;left:0;top:0;width:${s.stageW}px;height:${H}px;transform:translateX(${-i * W}px)}
.slot{position:absolute;top:0;width:${W}px;height:${H}px;overflow:hidden}
${bodyCss(d.unit)}
${style.css(s)}
</style><div class="stage">${style.backdrop(s)}${spans}<div class="slot" style="left:${i * W}px">${head}${own}</div></div>`
}
