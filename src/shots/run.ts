/** The render loop: one stage per device × locale, one Chrome screenshot per slot. */
import { layout } from './layout.ts'
import type { ShotsSetup } from './load.ts'
import { paintSlot } from './paint.ts'
import { dataUri, pngSize, shoot } from './render.ts'
import type { Device, Img, Placed, StageCtx } from './types.ts'

export function stageFor(s: ShotsSetup, d: Device, locale: string): { ctx: StageCtx; placed: Placed[] } {
  const imgs = new Map<string, Img>()
  const img = (stem: string): Img => {
    let v = imgs.get(stem)
    if (!v) {
      const file = s.srcFile(d, locale, stem)
      v = { uri: dataUri(file), ...pngSize(file) }
      imgs.set(stem, v)
    }
    return v
  }
  const metrics = s.style.metrics(d, locale, s.theme)
  const ctx: StageCtx = { device: d, locale, theme: s.theme, slots: s.slots, W: d.w, H: d.h, stageW: d.w * s.slots.length, metrics, brand: s.content.brand, img }
  const isLand = (stem: string): boolean => {
    const { w, h } = pngSize(s.srcFile(d, locale, stem))
    return w > h
  }
  return { ctx, placed: layout(s.slots, d, metrics, isLand, s.style.look === 'bezel') }
}

/** Render every slot (or `only` these store positions) for one device × locale; returns the files written. */
export function renderSet(s: ShotsSetup, d: Device, locale: string, chrome: string, only?: number[], onFile?: (f: string) => void): string[] {
  const { ctx, placed } = stageFor(s, d, locale)
  const files: string[] = []
  s.slots.forEach((slot, i) => {
    if (only && !only.includes(slot.n)) return
    const out = s.outFile(d, locale, slot)
    shoot(chrome, paintSlot(s.style, ctx, placed, i, ctx.img), d.w, d.h, out, s.tmp)
    files.push(out)
    onFile?.(out)
  })
  return files
}
