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
 *
 * ## App Review information
 *
 * A `## review` section (not a locale) holds what App Review asks for after
 * "Waiting for Review": the notes, the contact, the demo account. It maps to
 * one `appStoreReviewDetails` record per version (ASC copies the previous
 * version's into a new one, so the diff is usually empty). The demo password
 * is never in the file: it comes from `ASC_DEMO_PASSWORD` and, being
 * write-only in the API, is pushed whenever that variable is set.
 *
 * ```markdown
 * ## review
 * ### notes
 * ```
 * How to reach every feature on one device…
 * ```
 * ### contactFirstName
 * Ada
 * ### contactLastName
 * Lovelace
 * ### contactPhone
 * +1 555 0100
 * ### contactEmail
 * ada@example.com
 * ### demoAccountName
 * reviewer@example.com
 * ### demoAccountRequired
 * true
 * ```
 */
import { readFileSync } from 'node:fs'
import { type AscClient, ok } from './client.ts'
import { CheckFailed, ConfigError, StoreshipError } from '../errors.ts'
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

export const REVIEW_FIELDS = ['notes', 'contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail', 'demoAccountName', 'demoAccountRequired'] as const
export type ReviewField = (typeof REVIEW_FIELDS)[number]
/** Values as written in the file; `demoAccountRequired` is "true" / "false". */
export type Review = Partial<Record<ReviewField, string>>
export const REVIEW_LIMITS: Partial<Record<ReviewField, number>> = { notes: 4000 }
export const DEMO_PASSWORD_ENV = 'ASC_DEMO_PASSWORD'

export const INFO_FIELDS: Field[] = ['name', 'subtitle']
export const VERSION_FIELDS: Field[] = ['keywords', 'description', 'promotionalText']

export const len = (s: string): number => [...s].length

const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/
const REVIEW_HEADING = /^review$/i
const REVIEW_ALIASES: Record<string, ReviewField> = Object.fromEntries([
  ...REVIEW_FIELDS.map((f) => [f.toLowerCase(), f]),
  ['contact-first-name', 'contactFirstName'],
  ['contact-last-name', 'contactLastName'],
  ['contact-phone', 'contactPhone'],
  ['contact-email', 'contactEmail'],
  ['demo-account-name', 'demoAccountName'],
  ['demo-account-required', 'demoAccountRequired'],
  ['firstname', 'contactFirstName'],
  ['lastname', 'contactLastName'],
  ['phone', 'contactPhone'],
  ['email', 'contactEmail'],
]) as Record<string, ReviewField>
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

export type Parsed = { locales: Record<string, Listing>; review?: Review }

/**
 * One pass over the file. A `##` heading that is a locale code opens a locale;
 * `## review` opens the review section; any other `##` is prose. `###` under a
 * locale must be a listing field, under `review` a review field.
 */
export function parseSections(md: string, where = 'listing'): Parsed {
  const locales: Record<string, Listing> = {}
  let review: Review | undefined
  let section: { kind: 'locale'; locale: string } | { kind: 'review' } | undefined
  let field: Field | ReviewField | undefined
  let buf: string[] = []
  const flush = (): void => {
    if (section && field) {
      const value = unfence(buf.join('\n'))
      if (section.kind === 'locale') locales[section.locale]![field as Field] = value
      else (review ??= {})[field as ReviewField] = value
    }
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
        if (!section) throw new CheckFailed(`${where}:${i + 1}: "### ${h3[1]}" appears before any "## <locale>" or "## review" heading`)
        const key = h3[1]!.toLowerCase()
        if (section.kind === 'locale') {
          const f = ALIASES[key]
          if (!f) throw new CheckFailed(`${where}:${i + 1}: unknown field "${h3[1]}"`, `fields are: ${FIELDS.join(', ')}`)
          field = f
        } else {
          const f = REVIEW_ALIASES[key]
          if (!f) throw new CheckFailed(`${where}:${i + 1}: unknown review field "${h3[1]}"`, `review fields are: ${REVIEW_FIELDS.join(', ')} (the demo password comes from ${DEMO_PASSWORD_ENV})`)
          field = f
        }
        continue
      }
      if (h2 && !line.startsWith('###')) {
        flush()
        field = undefined
        if (LOCALE_RE.test(h2[1]!)) {
          section = { kind: 'locale', locale: h2[1]! }
          locales[h2[1]!] ??= {}
        } else if (REVIEW_HEADING.test(h2[1]!)) {
          section = { kind: 'review' }
          review ??= {}
        } else section = undefined
        continue
      }
    }
    if (section && field) buf.push(line)
  }
  flush()
  if (!Object.keys(locales).length) throw new CheckFailed(`${where}: no "## <locale>" sections found`, 'see the format in docs/listing.md')
  if (review?.demoAccountRequired !== undefined && !/^(true|false|yes|no)$/i.test(review.demoAccountRequired))
    throw new CheckFailed(`${where}: demoAccountRequired must be true or false, got "${review.demoAccountRequired}"`)
  return { locales, review }
}

/** The locale sections only (the shape every listing command used before `## review` existed). */
export function parseListing(md: string, where = 'listing'): Record<string, Listing> {
  return parseSections(md, where).locales
}

export function readListingFile(file: string): Parsed {
  let md: string
  try {
    md = readFileSync(file, 'utf8')
  } catch {
    throw new ConfigError(`listing file not found: ${file}`, 'set listing.file in storeship.config.json')
  }
  return parseSections(md, file)
}

export function readListing(file: string): Record<string, Listing> {
  return readListingFile(file).locales
}

export function overLimitReview(r: Review): string[] {
  return (Object.keys(REVIEW_LIMITS) as ReviewField[]).filter((k) => r[k] !== undefined && len(r[k]!) > REVIEW_LIMITS[k]!).map((k) => `${k} ${len(r[k]!)}/${REVIEW_LIMITS[k]}`)
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
  if (!pick) throw new StoreshipError('the app has no appInfo records', undefined, { code: 'NOT_FOUND' })
  return { ...pick, all: infos }
}

export async function diffListing(c: AscClient, appId: string, version: string, wanted: Record<string, Listing>): Promise<{ appInfo: { id: string; state: string; ambiguous: boolean }; diffs: FieldDiff[]; skipped: string[] }> {
  for (const [loc, l] of Object.entries(wanted)) {
    const over = overLimit(l)
    if (over.length) throw new CheckFailed(`${loc} exceeds App Store limits: ${over.join(', ')}`, 'shorten the listing file; nothing was written')
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
      throw new StoreshipError(`409 writing ${locale} name/subtitle`, 'this is usually the locked (live) appInfo; the account has two and the editable one exists only while a new version is being prepared', { code: 'API' })
    ok(r, `write ${locale} ${Object.keys(attributes).join('/')}`)
    out.push({ locale, target, fields: group.map((d) => d.field) })
  }
  return out
}

export type ReviewDiff = { field: ReviewField | 'demoAccountPassword'; current: string; wanted: string; same: boolean }
export type ReviewState = { detailId?: string; diffs: ReviewDiff[] }

const bool = (s: string): boolean => /^(true|yes)$/i.test(s)

/** Pure: compare the file's review section with the record ASC returned (attributes, or nothing). */
export function diffReviewFields(wanted: Review, current: Record<string, unknown> | undefined, password: string | undefined): ReviewDiff[] {
  const diffs: ReviewDiff[] = REVIEW_FIELDS.filter((f) => wanted[f] !== undefined).map((f) => {
    const raw = current?.[f]
    // ASC's web editor leaves a trailing newline on notes; a fenced block never has one. Not a difference.
    const cur = f === 'demoAccountRequired' ? String(raw ?? false) : String(raw ?? '').trimEnd()
    const want = f === 'demoAccountRequired' ? String(bool(wanted[f]!)) : wanted[f]!.trimEnd()
    return { field: f, current: cur, wanted: want, same: cur === want }
  })
  // The API never returns the password, so it cannot be compared; when the
  // variable is set it is pushed every time (idempotent, and the only way to rotate it).
  if (password !== undefined && (wanted.demoAccountName ?? current?.demoAccountName)) diffs.push({ field: 'demoAccountPassword', current: '(write-only)', wanted: password, same: false })
  return diffs
}

export async function diffReview(c: AscClient, versionId: string, wanted: Review, env: Record<string, string | undefined> = process.env): Promise<ReviewState> {
  const over = overLimitReview(wanted)
  if (over.length) throw new CheckFailed(`review exceeds App Store limits: ${over.join(', ')}`, 'shorten the notes; nothing was written')
  const r = ok(await c.get(`/v1/appStoreVersions/${versionId}/appStoreReviewDetail`), 'read review detail')
  const d = r.json?.data
  return { detailId: d?.id, diffs: diffReviewFields(wanted, d?.attributes, env[DEMO_PASSWORD_ENV]) }
}

/** One PATCH (or one POST when the version has no record yet) with every differing field. */
export async function pushReview(c: AscClient, versionId: string, state: ReviewState): Promise<ReviewDiff['field'][]> {
  const changed = state.diffs.filter((d) => !d.same)
  if (!changed.length) return []
  const attributes: Record<string, unknown> = Object.fromEntries(changed.map((d) => [d.field, d.field === 'demoAccountRequired' ? bool(d.wanted) : d.wanted]))
  if (state.detailId) {
    ok(await c.patch(`/v1/appStoreReviewDetails/${state.detailId}`, { data: { type: 'appStoreReviewDetails', id: state.detailId, attributes } }), 'write review detail')
  } else {
    ok(await c.post('/v1/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } } } }), 'create review detail')
  }
  return changed.map((d) => d.field)
}
