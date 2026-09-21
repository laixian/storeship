/**
 * The layout rules. Pure: frames + device + metrics + each source's
 * orientation in, placed phones out. Content has no coordinates, so every
 * position below is a consequence of a rule, and the rules are the ones a
 * set of real store pages taught us (2026-09-21, against od-mobile):
 *
 *  1. One phone size for the whole set. A landscape screen is the same phone
 *     turned sideways, so it is as tall as a portrait phone is wide and runs
 *     off one side of the canvas — shrinking it to fit made every frame a
 *     different scale, and the row read as a pile.
 *  2. Only the hero tilts. Arbitrary angles on ordinary frames were the other
 *     half of the pile.
 *  3. One phone per frame; a pair is the exception, and two pairs are never
 *     neighbours (the rules checker enforces that part).
 *  4. Every non-hero phone starts on the same baseline, centred on the same
 *     axis; a landscape phone keeps the portrait phone's left edge (`start`)
 *     or right edge (`end`).
 *  5. A hero is one phone across two slots, the seam at `seamAt` of its width;
 *     a portrait hero starts on the baseline, a landscape one is centred below it.
 */
import type { Device, Frame, Metrics, Placed, Screen, Slot } from './types.ts'

export const HERO_TILT = -4
export const HERO_SEAM = 0.46

export function screenOf(s: Screen): { src: string; anchor: 'start' | 'end' } {
  return typeof s === 'string' ? { src: s, anchor: 'start' } : { src: s.src, anchor: s.anchor ?? 'start' }
}

/** The screens a frame shows, in order. */
export function screensOf(f: Frame): { src: string; anchor: 'start' | 'end' }[] {
  if (f.screens?.length) return f.screens.map(screenOf)
  return f.screen !== undefined ? [screenOf(f.screen)] : []
}

/** Frames → store slots: a hero takes two. */
export function expand(frames: Frame[]): Slot[] {
  const out: Slot[] = []
  for (const frame of frames) {
    if (frame.hero) {
      out.push({ n: out.length + 1, frame, half: 0, hero: true })
      out.push({ n: out.length + 1, frame, half: 1, hero: true })
    } else out.push({ n: out.length + 1, frame, half: 0, hero: false })
  }
  return out
}

/**
 * Size of a device around a screen whose short side is `s` px.
 * `framed: false` is the bare-card look: the box is the screen.
 */
export function deviceBox(d: Device, s: number, land: boolean, framed: boolean): { w: number; h: number; sw: number; sh: number } {
  const long = Math.round((s * Math.max(d.srcW, d.srcH)) / Math.min(d.srcW, d.srcH))
  const b = framed ? Math.round((d.body.rim + d.body.bezel) * s) : 0
  const e = framed ? Math.round((d.body.rim + (d.body.chin ?? d.body.bezel)) * s) : 0
  return land ? { w: long + 2 * e, h: s + 2 * b, sw: long, sh: s } : { w: s + 2 * b, h: long + 2 * e, sw: s, sh: long }
}

/** Screen short side that makes a portrait device `outer` px wide. */
export function screenShort(d: Device, outer: number, framed: boolean): number {
  if (!framed) return outer
  let s = Math.round(outer / (1 + 2 * (d.body.rim + d.body.bezel)))
  // the body is rounded per side, so nudge until the device is exactly `outer` wide (or the closest under it)
  while (deviceBox(d, s + 1, false, true).w <= outer) s++
  while (s > 1 && deviceBox(d, s, false, true).w > outer) s--
  return s
}

export function layout(slots: Slot[], d: Device, m: Metrics, isLand: (src: string) => boolean, framed: boolean): Placed[] {
  const W = d.w
  const s = screenShort(d, m.phone, framed)
  const portrait = deviceBox(d, s, false, framed)
  const x0 = Math.round((W - portrait.w) / 2)
  const out: Placed[] = []
  slots.forEach((slot, i) => {
    const f = slot.frame
    if (slot.hero) {
      if (slot.half === 1) return
      const sc = screensOf(f)[0]
      if (!sc) return
      const land = isLand(sc.src)
      const box = deviceBox(d, s, land, framed)
      const seam = f.hero?.seamAt ?? HERO_SEAM
      // a landscape hero is short: centre it in the body; a portrait one is as tall as any phone: start it on the baseline
      const y = land ? Math.round(m.heroY - box.h / 2) : m.baseline
      out.push({ src: sc.src, land, ...box, x: (i + 1) * W - Math.round(seam * box.w), y, rot: f.hero?.tilt ?? HERO_TILT, slot: i, span: true })
      return
    }
    let y = m.baseline
    for (const sc of screensOf(f)) {
      const land = isLand(sc.src)
      const box = deviceBox(d, s, land, framed)
      const x = !land ? x0 : sc.anchor === 'end' ? W - x0 - box.w : x0
      out.push({ src: sc.src, land, ...box, x, y, rot: 0, slot: i, span: false })
      y += box.h + m.gap
    }
  })
  return out
}
