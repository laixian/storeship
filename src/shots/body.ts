/**
 * The device drawn around a real screenshot, in CSS only — no bezel images to
 * license or ship. Layers, outside in: a metal rim with a highlight, a black
 * border, the screenshot clipped to the screen's corner radius, a faint glare.
 * The Dynamic Island is not drawn: simulator screenshots already contain it.
 */
import type { Device, Placed } from './types.ts'

export function bodyCss(u: number): string {
  return `.ph{position:absolute;transform-origin:50% 50%}
.ph .rim{position:absolute;inset:0;background:linear-gradient(135deg,#a3a8ae 0%,#3b3f44 12%,#6c7178 45%,#2e3136 80%,#b4b9bf 100%);box-shadow:inset 0 0 0 ${Math.max(1, Math.round(2 * u))}px rgba(255,255,255,.35),inset 0 0 0 ${Math.max(2, Math.round(5 * u))}px rgba(0,0,0,.35)}
.ph .bz{position:absolute;background:#030404}
.ph .scr{position:absolute;overflow:hidden;background:#000}
.ph .scr img{display:block;width:100%;height:100%}
.ph .glare{position:absolute;background:linear-gradient(118deg,rgba(255,255,255,.10) 0%,rgba(255,255,255,.03) 32%,transparent 33%)}
.ph .btn{position:absolute;background:linear-gradient(90deg,#50555b,#a9aeb4,#50555b);border-radius:3px}
.ph .home{position:absolute;border-radius:50%;box-shadow:inset 0 0 0 ${Math.max(2, Math.round(4 * u))}px #3b3f44}
.card{position:absolute;overflow:hidden}
.card img{display:block;width:100%;height:100%}`
}

/** One device. `p` is in whatever coordinates the caller is painting in. */
export function deviceHtml(d: Device, p: Placed, uri: string, framed: boolean, cardRadius = 0): string {
  const pos = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px${p.rot ? `;transform:rotate(${p.rot}deg)` : ''}`
  if (!framed) return `<div class="card" style="${pos};border-radius:${cardRadius}px"><img src="${uri}"></div>`
  const b = d.body
  const s = Math.min(p.sw, p.sh)
  const rim = Math.max(3, Math.round(b.rim * s))
  const side = Math.round((b.rim + b.bezel) * s)
  const end = Math.round((b.rim + (b.chin ?? b.bezel)) * s)
  const sR = Math.round(b.radius * s)
  const oR = Math.max(sR + side, Math.round((b.kind === 'home' ? 0.16 : b.kind === 'ipad' ? 0.075 : 0) * s))
  // screen inset: portrait → side left/right, end top/bottom; landscape (turned so the top is on the left) swaps them
  const inset = p.land ? `${side}px ${end}px` : `${end}px ${side}px`
  const long = p.land ? p.w : p.h
  const t = Math.max(3, Math.round(rim * 1.1))
  const btns = b.buttons
    .map(([at, from, len]) => {
      const q = Math.round(from * long), l = Math.round(len * long)
      if (!p.land) return `<i class="btn" style="${at === 'a' ? 'left' : 'right'}:${-t + 1}px;top:${q}px;width:${t}px;height:${l}px"></i>`
      return `<i class="btn" style="${at === 'a' ? 'bottom' : 'top'}:${-t + 1}px;left:${q}px;height:${t}px;width:${l}px"></i>`
    })
    .join('')
  let home = ''
  if (b.kind === 'home') {
    const r = Math.round(0.16 * s)
    home = p.land
      ? `<i class="home" style="right:${Math.round((end - r) / 2)}px;top:${Math.round((p.h - r) / 2)}px;width:${r}px;height:${r}px"></i>`
      : `<i class="home" style="bottom:${Math.round((end - r) / 2)}px;left:${Math.round((p.w - r) / 2)}px;width:${r}px;height:${r}px"></i>`
  }
  return (
    `<div class="ph" style="${pos}">${btns}` +
    `<div class="rim" style="border-radius:${oR}px"></div>` +
    `<div class="bz" style="inset:${rim}px;border-radius:${Math.max(0, oR - rim)}px"></div>` +
    `<div class="scr" style="inset:${inset};border-radius:${sR}px"><img src="${uri}"></div>` +
    `<div class="glare" style="inset:${inset};border-radius:${sR}px"></div>${home}</div>`
  )
}
