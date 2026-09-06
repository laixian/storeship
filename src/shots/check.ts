/**
 * Every failure on the screenshot path is silent: a crop past the edge only
 * leaks a sliver of background, bleeding on both sides only makes the card
 * read as a colour band, a wrong-sized source only looks a little soft. None
 * of it throws, and the person reviewing is busy reading the titles. So
 * everything that can be a rule is a rule, and all of them are reported in
 * one pass.
 */
import type { Device, Shot, ShotsContent, Template } from './types.ts'

export type CheckFs = { exists(file: string): boolean; pngSize(file: string): { w: number; h: number } }

export const stemOf = (shot: Shot, card: { src?: string }): string => card.src ?? `${shot.n}-${shot.slug}`

export function checkShots(
  content: ShotsContent,
  device: Device,
  locales: string[],
  o: { template: Template; srcFile: (d: Device, locale: string, stem: string) => string; fs: CheckFs; rel?: (f: string) => string },
): string[] {
  const bad: string[] = []
  const say = (m: string): number => bad.push(m)
  const rel = o.rel ?? ((f) => f)
  const lines = o.template.titleLines ?? 2
  const shots = content.shots

  if (shots.length < 1 || shots.length > 10) say(`a set is 1–10 screenshots, this one has ${shots.length}`)
  shots.forEach((s, i) => {
    const at = `#${s.n} ${s.slug}`
    if (s.n !== i + 1) say(`${at}: numbers must run 1..N in order; item ${i + 1} is numbered ${s.n}`)
    if (s.sn !== undefined && o.template.snPattern && !o.template.snPattern.test(s.sn)) say(`${at}: sn "${s.sn}" does not match ${o.template.snPattern}`)
    if (!/^#[0-9A-Fa-f]{6}$/.test(s.bg)) say(`${at}: bg must be #RRGGBB`)
    for (const locale of locales) {
      const t = s.title?.[locale]
      if (!t || t.length !== lines || t.some((l) => !l.trim())) {
        say(`${at}: ${locale} title must be ${lines} non-empty line(s)`)
        continue
      }
      const max = o.template.titleMax?.[locale]
      if (max) for (const l of t) if ([...l].length > max) say(`${at}: ${locale} "${l}" is ${[...l].length} chars, over ${max} — it will hit the edge`)
    }
    const cards = s.cards?.[device.id]
    if (!cards?.length) {
      say(`${at}: no layout for ${device.id} (cards.${device.id} is empty)`)
      return
    }
    cards.forEach((c, ci) => {
      const where = `${at} card ${ci + 1}`
      if (c.x < 0 && c.x + c.w > device.w) say(`${where}: bleeds on both sides — no corner is visible, it reads as a colour band`)
      if (c.x >= device.w || c.x + c.w <= 0 || c.y >= device.h || c.y + c.h <= 0) say(`${where}: entirely off the canvas`)
      for (const locale of locales) {
        const file = o.srcFile(device, locale, stemOf(s, c))
        if (!o.fs.exists(file)) {
          say(`${where}: missing source screenshot ${rel(file)}`)
          continue
        }
        const nat = o.fs.pngSize(file)
        const ok = (nat.w === device.srcW && nat.h === device.srcH) || (nat.w === device.srcH && nat.h === device.srcW)
        if (!ok) {
          say(`${where}: ${locale} source is ${nat.w}×${nat.h}, not ${device.id}'s native ${device.srcW}×${device.srcH}`)
          continue
        }
        const sw = c.sw ?? nat.w
        const sh = (sw * c.h) / c.w
        if ((c.sx ?? 0) + sw > nat.w + 1 || (c.sy ?? 0) + sh > nat.h + 1)
          say(`${where}: ${locale} crop out of bounds (needs ${Math.round(sw)}×${Math.round(sh)} at ${c.sx ?? 0},${c.sy ?? 0}; source is ${nat.w}×${nat.h}) — a strip of background will show`)
      }
    })
  })
  return bad
}
