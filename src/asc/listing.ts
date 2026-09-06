/**
 * Store listing as code: one Markdown file is the source of truth for the
 * six metadata fields, and the tool diffs it against App Store Connect
 * before it writes anything.
 *
 * ## Format
 *
 * ```markdown
 * # Anything
 * ## en-US
 * ### name
 * My App
 * ### subtitle
 * One line
 * ### keywords
 * a,b,c
 * ### description
 * Several paragraphs…
 * ### promotionalText
 * Optional.
 * ## zh-Hans
 * …
 * ```
 *
 * A `##` heading that looks like a locale code opens a locale; any other
 * `##` section is prose and ignored. Under a locale, `###` headings must be
 * field names. A field's value is the text up to the next heading, trimmed;
 * if that text is exactly one fenced block, the block's contents are used
 * verbatim (so descriptions can hold `#` or `---` safely).
 *
 * ## Where each field lives in ASC
 *
 * name / subtitle are on **appInfo** (shared across versions); keywords /
 * description / promotionalText are on **appStoreVersion** (per version).
 * ⚠️ An account has two appInfos once an app is live: the live one is
 * locked; writing to it gives a 409 that does not say which one you hit.
 */
import { readFileSync } from 'node:fs'
import { type AscClient, ok } from './client.ts'
import { StoreshipError } from '../errors.ts'
import { requireVersion } from './versions.ts'

export const FIELDS = ['name', 'subtitle', 'keywords', 'description', 'promotionalText'] as const
export type Field = (typeof FIELDS)[number]
export type Listing = Partial<Record<Field, string>>

/** ASC character limits. CJK counts as 1, same as `[...s].length`. */
export const LIMITS: Record<Field, number> = {
  name: 30,
  subtitle: 30,
  keywords: 100,
  description: 4000,
  promotionalText: 170,
}

export const INFO_FIELDS: Field[] = ['name', 'subtitle']
export const VERSION_FIELDS: Field[] = ['keywords', 'description', 'promotionalText']

export const len = (s: string): number => [...s].length

const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/
const ALIASES: Record<string, Field> = {
  name: 'name',
  subtitle: 'subtitle',
  keywords: 'keywords',
  description: 'description',
  promotionaltext: 'promotionalText',
  'promotional-text': 'promotionalText',
  promotional_text: 'promotionalText',
  promo: 'promotionalText',
}

function unfence(raw: string): string {
  const t = raw.trim()
  const m = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(t)
  return m ? m[1]! : t
}

export function parseListing(md: string, where = 'listing'): Record<string, Listing> {
  const out: Record<string, Listing> = {}
  let locale: string | undefined
  let field: Field | undefined
  let buf: string[] = []
  const flush = (): void => {
    if (locale && field) out[locale]![field] = unfence(buf.join('\n'))
    buf = []
  }
  const lines = md.split(/\r?\n/)
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^```/.test(line)) inFence = !inFence
    if (!inFence) {
      const h2 = /^##\s+(\S+)/.exec(line)
      const h3 = /^###\s+(\S+)/.exec(line)
      if (h3 && !line.startsWith('####')) {
        flush()
        if (!locale) throw new StoreshipError(`${where}:${i + 1}: "### ${h3[1]}" appears before any "## <locale>" heading`)
        const f = ALIASES[h3[1]!.toLowerCase()]
        if (!f) throw new StoreshipError(`${where}:${i + 1}: unknown field "${h3[1]}"`, `fields are: ${FIELDS.join(', ')}`)
        field = f
        continue
      }
      if (h2 && !line.startsWith('###')) {
        flush()
        field = undefined
        if (LOCALE_RE.test(h2[1]!)) {
          locale = h2[1]!
          out[locale] ??= {}
        } else locale = undefined
        continue
      }
    }
    if (locale && field) buf.push(line)
  }
  flush()
  if (!Object.keys(out).length) throw new StoreshipError(`${where}: no "## <locale>" sections found`, 'see the format in the storeship README (Store listing)')
  return out
}

export function readListing(file: string): Record<string, Listing> {
  let md: string
  try {
    md = readFileSync(file, 'utf8')
  } catch {
    throw new StoreshipError(`listing file not found: ${file}`, 'set listing.file in storeship.config.json')
  }
  return parseListing(md, file)
}

/** Over-limit fields, formatted; empty = compliant. */
export function overLimit(l: Listing): string[] {
  return FIELDS.filter((k) => l[k] !== undefined && len(l[k]!) > LIMITS[k]).map((k) => `${k} ${len(l[k]!)}/${LIMITS[k]}`)
}

export type FieldDiff = { locale: string; field: Field; current: string; wanted: string; same: boolean; target: 'appInfo' | 'version'; targetId: string }

/** Pure: compare wanted vs current for a locale, keeping only fields present in `wanted`. */
export function diffFields(locale: string, wanted: Listing, current: Record<string, string | null | undefined>, fields: Field[], target: 'appInfo' | 'version', targetId: string): FieldDiff[] {
  return fields
    .filter((f) => wanted[f] !== undefined)
    .map((f) => {
      const cur = current[f] ?? ''
      return { locale, field: f, current: cur, wanted: wanted[f]!, same: cur === wanted[f], target, targetId }
    })
}

/** Pick the editable appInfo; the live one is READY_FOR_DISTRIBUTION and locked. */
export async function editableAppInfo(c: AscClient, appId: string): Promise<{ id: string; state: string; all: { id: string; state: string }[] }> {
  const infos = (await c.all(`/v1/apps/${appId}/appInfos?limit=10`)).map((i: any) => ({ id: i.id, state: i.attributes.state as string }))
  const editable = infos.filter((i) => i.state !== 'READY_FOR_DISTRIBUTION')
  const pick = editable[0] ?? infos[0]
  if (!pick) throw new StoreshipError('the app has no appInfo records')
  return { ...pick, all: infos }
}

export async function diffListing(c: AscClient, appId: string, version: string, wanted: Record<string, Listing>): Promise<{ appInfo: { id: string; state: string; ambiguous: boolean }; diffs: FieldDiff[]; skipped: string[] }> {
  for (const [loc, l] of Object.entries(wanted)) {
    const over = overLimit(l)
    if (over.length) throw new StoreshipError(`${loc} exceeds App Store limits: ${over.join(', ')}`, 'shorten the listing file; nothing was written')
  }
  const v = await requireVersion(c, appId, version)
  const info = await editableAppInfo(c, appId)
  const infoLocs = await c.all(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=50`)
  const verLocs = await c.all(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=50`)
  const diffs: FieldDiff[] = []
  const seen = new Set<string>()
  for (const l of infoLocs) {
    const loc = l.attributes.locale as string
    seen.add(loc)
    if (wanted[loc]) diffs.push(...diffFields(loc, wanted[loc]!, l.attributes, INFO_FIELDS, 'appInfo', l.id))
  }
  for (const l of verLocs) {
    const loc = l.attributes.locale as string
    seen.add(loc)
    if (wanted[loc]) diffs.push(...diffFields(loc, wanted[loc]!, l.attributes, VERSION_FIELDS, 'version', l.id))
  }
  const skipped = Object.keys(wanted).filter((loc) => !seen.has(loc))
  return { appInfo: { id: info.id, state: info.state, ambiguous: info.all.filter((i) => i.state !== 'READY_FOR_DISTRIBUTION').length !== 1 }, diffs, skipped }
}

/** Write every differing field, grouped per localization so each locale is one PATCH. */
export async function pushListing(c: AscClient, diffs: FieldDiff[]): Promise<{ locale: string; target: string; fields: Field[] }[]> {
  const groups = new Map<string, FieldDiff[]>()
  for (const d of diffs.filter((d) => !d.same)) groups.set(`${d.target}:${d.targetId}`, [...(groups.get(`${d.target}:${d.targetId}`) ?? []), d])
  const out: { locale: string; target: string; fields: Field[] }[] = []
  for (const group of groups.values()) {
    const { target, targetId, locale } = group[0]!
    const type = target === 'appInfo' ? 'appInfoLocalizations' : 'appStoreVersionLocalizations'
    const attributes = Object.fromEntries(group.map((d) => [d.field, d.wanted]))
    const r = await c.patch(`/v1/${type}/${targetId}`, { data: { type, id: targetId, attributes } })
    if (r.status === 409 && target === 'appInfo')
      throw new StoreshipError(`409 writing ${locale} name/subtitle`, 'this is usually the locked (live) appInfo; the account has two and the editable one exists only while a new version is being prepared')
    ok(r, `write ${locale} ${Object.keys(attributes).join('/')}`)
    out.push({ locale, target, fields: group.map((d) => d.field) })
  }
  return out
}
