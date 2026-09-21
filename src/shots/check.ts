/**
 * Every failure on the screenshot path is silent: a missing source only shows
 * as a blank phone, a pair next to a pair only reads as clutter once the row
 * is on the store page, a hero that overhangs its two slots just loses a
 * corner. None of it throws, and the person reviewing is busy reading the
 * titles. So everything that can be a rule is a rule, and all of them are
 * reported in one pass.
 *
 * The layout rules themselves (one scale, one baseline, no tilt outside the
 * hero) cannot be broken from content — there is nowhere to write a
 * coordinate or an angle. What is checked here is what content *can* say.
 */
import { expand, layout, screensOf } from './layout.ts'
import type { Device, ShotsContent, Style } from './types.ts'

export type CheckFs = { exists(file: string): boolean; pngSize(file: string): { w: number; h: number } }

export const MAX_SLOTS = 10
export const MAX_TILT = 8

const HEX = /^#[0-9A-Fa-f]{6}$/

export function checkShots(
  content: ShotsContent,
  style: Style,
  device: Device,
  locales: string[],
  o: { srcFile: (d: Device, locale: string, stem: string) => string; fs: CheckFs; rel?: (f: string) => string },
): string[] {
  const bad: string[] = []
  const say = (m: string): number => bad.push(m)
  const rel = o.rel ?? ((f) => f)
  const lines = style.titleLines ?? 2
  const frames = content.frames ?? []
  const slots = expand(frames)

  if (!frames.length) say('no frames')
  if (slots.length > MAX_SLOTS) say(`a set is at most ${MAX_SLOTS} screenshots; these frames make ${slots.length} (a hero counts twice)`)

  for (const [k, v] of Object.entries(content.theme ?? {})) {
    const t = style.tokens[k]
    if (!t) say(`theme.${k}: style "${style.id}" has no such token (it has: ${Object.keys(style.tokens).join(', ')})`)
    else if (t.type === 'color' && !HEX.test(String(v))) say(`theme.${k} must be #RRGGBB`)
  }

  // orientation of each source, taken from the first locale that has it
  const size = new Map<string, { w: number; h: number }>()
  const probe = (stem: string, locale: string, where: string): { w: number; h: number } | undefined => {
    const file = o.srcFile(device, locale, stem)
    if (!o.fs.exists(file)) {
      say(`${where}: missing source screenshot ${rel(file)}`)
      return undefined
    }
    const nat = o.fs.pngSize(file)
    const ok = (nat.w === device.srcW && nat.h === device.srcH) || (nat.w === device.srcH && nat.h === device.srcW)
    if (!ok) {
      say(`${where}: ${locale} source ${rel(file)} is ${nat.w}×${nat.h}, not ${device.id}'s native ${device.srcW}×${device.srcH} — a phone shows the whole screen, so it must be a whole native screenshot`)
      return undefined
    }
    const seen = size.get(stem)
    if (seen && seen.w !== nat.w) say(`${where}: ${stem} is landscape in one locale and portrait in another`)
    if (!seen) size.set(stem, nat)
    return nat
  }

  const seenSlugs = new Set<string>()
  let prevPair = false
  frames.forEach((f, i) => {
    const at = `frame ${i + 1} (${f.slug})`
    if (!/^[a-z0-9][a-z0-9-]*$/.test(f.slug ?? '')) say(`${at}: slug must be lowercase letters, digits and dashes`)
    if (seenSlugs.has(f.slug)) say(`${at}: slug "${f.slug}" is used twice`)
    seenSlugs.add(f.slug)
    if (f.sn !== undefined && style.snPattern && !style.snPattern.test(f.sn)) say(`${at}: sn "${f.sn}" does not match ${style.snPattern}`)
    if (f.bg !== undefined && !HEX.test(f.bg)) say(`${at}: bg must be #RRGGBB`)
    if (style.needsBg && f.bg === undefined) say(`${at}: style "${style.id}" paints each frame's own colour — set bg`)

    for (const locale of locales) {
      const t = f.title?.[locale]
      if (!t || t.length !== lines || t.some((l) => !l.trim())) {
        say(`${at}: ${locale} title must be ${lines} non-empty line(s)`)
        continue
      }
      const max = style.titleMax?.[locale]
      if (max) for (const l of t) if ([...l].length > max) say(`${at}: ${locale} "${l}" is ${[...l].length} chars, over ${max} — it will hit the edge`)
    }

    if (f.screen !== undefined && f.screens !== undefined) say(`${at}: set screen or screens, not both`)
    const scr = screensOf(f)
    const pair = scr.length === 2
    if (!scr.length) say(`${at}: no screen`)
    if (scr.length > 2) say(`${at}: at most two phones on a frame, this one has ${scr.length}`)
    if (pair && prevPair) say(`${at}: two frames with two phones in a row — the row reads as clutter; make one of them a single phone`)
    prevPair = pair && !f.hero

    if (f.hero) {
      if (scr.length !== 1) say(`${at}: a hero is one phone across two slots`)
      const seam = f.hero.seamAt ?? 0.46
      if (seam < 0.3 || seam > 0.7) say(`${at}: hero.seamAt ${seam} — the seam must cut the phone between 30% and 70% so both halves read on their own`)
      if (Math.abs(f.hero.tilt ?? 0) > MAX_TILT) say(`${at}: hero.tilt ${f.hero.tilt}° is over ${MAX_TILT}°`)
      if (!content.brand?.logo && !content.brand?.tagline) say(`${at}: the first half of a hero carries the brand — set brand.logo and/or brand.tagline`)
    }

    for (const s of scr) {
      let nat: { w: number; h: number } | undefined
      for (const locale of locales) nat = probe(s.src, locale, at) ?? nat
      const explicit = f.screens?.some((x) => typeof x !== 'string' && x.src === s.src && x.anchor) || (typeof f.screen === 'object' && f.screen.anchor)
      if (nat && nat.w < nat.h && explicit) say(`${at}: ${s.src} is portrait; anchor only applies to landscape screens`)
    }
  })

  const logo = content.brand?.logo
  if (logo) {
    for (const locale of locales) {
      const nat = probe(logo.src, locale, 'brand.logo')
      const [x, y, w, h] = logo.crop
      if (nat && (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > nat.w || y + h > nat.h)) say(`brand.logo: crop [${logo.crop.join(', ')}] is outside ${logo.src} (${nat.w}×${nat.h})`)
    }
  }
  for (const locale of locales) {
    const t = content.brand?.tagline?.[locale]
    if (content.brand?.tagline && (!t || !t.length)) say(`brand.tagline: no ${locale} lines`)
  }

  // a hero must fit its two slots, tilt included
  if (!bad.length) {
    for (const locale of locales) {
      const m = style.metrics(device, locale, content.theme ?? {})
      const placed = layout(slots, device, m, (src) => (size.get(src)?.w ?? 0) > (size.get(src)?.h ?? 0), style.look === 'bezel')
      for (const p of placed.filter((q) => q.span)) {
        const a = (Math.abs(p.rot) * Math.PI) / 180
        const half = (p.w * Math.cos(a) + p.h * Math.sin(a)) / 2
        const cx = p.x + p.w / 2
        if (cx - half < p.slot * device.w || cx + half > (p.slot + 2) * device.w)
          say(`hero (${slots[p.slot]!.frame.slug}) on ${device.id}/${locale}: the phone overhangs its two slots — move seamAt toward 0.5 or reduce the tilt`)
      }
    }
  }
  return bad
}
