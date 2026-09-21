/** Pieces the built-in styles share. Exported so a project style can reuse them. */
import type { Brand, Crop, Device, Metrics, SlotCtx, StageCtx } from '../types.ts'

export const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const isCjk = (locale: string): boolean => /^(zh|ja|ko)/.test(locale)

/** `02/08` — slots are counted as the store shows them, hero halves included. */
export const counter = (s: SlotCtx): string => `${String(s.slot.n).padStart(2, '0')}/${String(s.slots.length).padStart(2, '0')}`

export const tok = (s: { theme: Record<string, string | number> }, k: string): string => String(s.theme[k])

/**
 * The standard vertical rhythm: label row, two-line title, a rule under it,
 * phones from the baseline down, the hero centred in what is left.
 */
export function rhythm(u: number, W: number, H: number, titleSize: number, lines: number): Metrics & { titleTop: number; rule: number } {
  const titleTop = Math.round(268 * u)
  const rule = Math.round(titleTop + titleSize * 1.16 * lines + 74 * u)
  const baseline = Math.round(rule + 110 * u)
  return { titleTop, rule, baseline, phone: Math.round(W * 0.8485), heroY: Math.round(baseline + (H - baseline) * 0.45), gap: Math.round(90 * u) }
}

/** The logo crop for this device (a plain crop, or the entry for `device.id`). */
export function cropFor(logo: NonNullable<Brand['logo']>, d: Device): Crop | undefined {
  return Array.isArray(logo.crop) ? logo.crop : logo.crop[d.id]
}

/**
 * The box a brand half may use: from `top` down to just above the hero phone
 * (or `maxBottom`, whichever is higher). Tilt is allowed for.
 */
export function brandBox(s: SlotCtx, top: number, side: number, maxBottom: number): { x: number; y: number; w: number; h: number } {
  const u = s.device.unit
  let bottom = maxBottom
  if (s.hero) {
    const lift = Math.abs(Math.sin((s.hero.rot * Math.PI) / 180)) * s.hero.w * 0.5
    bottom = Math.min(bottom, Math.round(s.hero.y - lift - 80 * u))
  }
  return { x: side, y: top, w: s.W - 2 * side, h: Math.max(Math.round(200 * u), bottom - top) }
}

/** How far in from each edge a feathered logo fades, in percent of its width / height. */
export const FEATHER_X = 12
export const FEATHER_Y = 14

/** The logo crop, fitted into a box (slot coordinates). `feather` fades its edges into the background; otherwise it is a plate. */
export function logo(s: SlotCtx, box: { x: number; y: number; w: number; h: number }, feather: boolean): string {
  const l = s.brand?.logo
  if (!l) return ''
  const crop = cropFor(l, s.device)
  if (!crop) return ''
  const img = s.img(l.src)
  const [cx, cy, cw, ch] = crop
  const k = Math.min(box.w / cw, box.h / ch)
  const w = Math.round(cw * k), h = Math.round(ch * k)
  const x = box.x + Math.round((box.w - w) / 2), y = box.y + Math.round((box.h - h) / 2)
  const u = s.device.unit
  // Feather only a thin band along each edge — enough to lose the crop's rectangle. An oval
  // fade (0.4.0) ate the ends of a wide logo's tagline: a crop is wider than it is tall, and
  // whatever sits near its left and right edges fell outside the ellipse.
  const fade = (dir: string, at: number) => `linear-gradient(${dir},transparent,#000 ${at}%,#000 ${100 - at}%,transparent)`
  const edges = `${fade('90deg', FEATHER_X)},${fade('180deg', FEATHER_Y)}`
  const look = feather
    ? `mask-image:${edges};mask-composite:intersect;-webkit-mask-image:${edges};-webkit-mask-composite:source-in`
    : `border-radius:${Math.round(56 * u)}px;box-shadow:0 ${Math.round(40 * u)}px ${Math.round(80 * u)}px rgba(0,0,0,.3)`
  return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:url(${img.uri}) ${-Math.round(cx * k)}px ${-Math.round(cy * k)}px/${Math.round(img.w * k)}px ${Math.round(img.h * k)}px no-repeat;${look}"></div>`
}

/**
 * A progress rail through the whole set, drawn in stage coordinates: a thin
 * line with a bead every `gap`, lit up to a head in the middle of the last
 * slot. Starts after the brand half of a leading hero.
 */
export function rail(s: StageCtx, top: number): string {
  const u = s.device.unit
  const from = s.slots[0]?.hero ? s.W : 0
  const width = s.stageW - from
  const head = s.stageW - s.W / 2 - from
  const gap = Math.round(110 * u), bead = Math.round(18 * u)
  const beads: string[] = []
  for (let x = Math.round(112 * u); x < width; x += gap)
    beads.push(`<i style="left:${x - bead / 2}px;opacity:${x <= head ? 0.92 : 0.25}"></i>`)
  return (
    `<div class="rail" style="left:${from}px;top:${top}px;width:${width}px">` +
    `<u style="width:${head}px"></u>${beads.join('')}<em style="left:${head}px"></em></div>`
  )
}

export function railCss(u: number, color: string): string {
  const r = (n: number) => Math.round(n * u)
  return `.rail{position:absolute;height:${r(22)}px}
.rail u,.rail i,.rail em{position:absolute;display:block}
.rail u{left:0;top:${r(9)}px;height:${Math.max(2, r(4))}px;background:${color};opacity:.92}
.rail::after{content:"";position:absolute;left:0;right:0;top:${r(10)}px;height:2px;background:${color};opacity:.2}
.rail i{top:${r(2)}px;width:${r(18)}px;height:${r(18)}px;border-radius:50%;background:${color}}
.rail em{top:${r(-9)}px;width:${r(8)}px;height:${r(40)}px;border-radius:${r(4)}px;background:${color}}`
}

/** Vertical hairlines every `gap` px across the whole stage. */
export const seams = (color: string, gap: number): string =>
  `<div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,${color} 0 2px,transparent 2px ${gap}px)"></div>`

/** Flat colour per slot (each frame's `bg`). */
export const panes = (s: StageCtx): string =>
  s.slots.map((sl, i) => `<div style="position:absolute;top:0;left:${i * s.W}px;width:${s.W}px;height:${s.H}px;background:${sl.frame.bg ?? '#FFFFFF'}"></div>`).join('')
