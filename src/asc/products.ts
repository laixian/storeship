/**
 * Products as code: subscription groups, subscriptions, prices, availability and
 * the app's own price, from one Markdown file, diffed against App Store Connect
 * before anything is written. The shape mirrors `listing.ts`; the reasons are in
 * docs/design.md §7.
 *
 * ## Format
 *
 * ```markdown
 * ## app
 * - price: CHN 0
 * - territories: all
 *
 * ## group OverDrive Pro                 ← referenceName
 * ### en-US
 * #### name
 * OverDrive Pro
 *
 * ## subscription com.example.pro.monthly   ← productId (immutable once created)
 * - group: OverDrive Pro
 * - reference: Pro monthly
 * - period: ONE_MONTH
 * - level: 1
 * - familySharable: false
 * - price: USA 3.99                       ← base territory + amount; the rest equalized
 * - priceStart: 2026-10-01                 ← optional; without it, effective now
 * - prices: JPN 600, KOR 4900              ← optional per-territory overrides
 * - territories: all                       ← or a comma list of territory codes
 * ### en-US
 * #### name
 * Monthly
 * #### description
 * Everything, billed monthly
 * ### reviewNote
 * ```
 * How to reach the paywall…
 * ```
 * ### reviewScreenshot
 * store/iap/monthly.png
 * ```
 *
 * ## Order matters
 *
 * Availability (the territories) must exist before any price: without it every
 * `subscriptionPrices` POST is a 409 that only says "An error occurred while
 * processing the pricing information" (2026-09-08, verified on a fresh
 * subscription). So the plan writes territories first, then prices.
 *
 * ## Pricing model
 *
 * Apple's price points are discrete per territory (~800 each). The file names
 * one base territory and an amount; the tool picks the point at or just below
 * that amount, then asks `/equalizations` for the matching point in every other
 * territory — exactly what the web UI does behind "generate prices for other
 * territories". Changing a price never edits the old row: it POSTs a new
 * `subscriptionPrices` row (with `startDate` when scheduled), which is the API's
 * own model and keeps the history.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { AscError, type AscClient, ok } from './client.ts'
import { StoreshipError } from '../errors.ts'
import { len } from './listing.ts'

export const PERIODS = ['ONE_WEEK', 'ONE_MONTH', 'TWO_MONTHS', 'THREE_MONTHS', 'SIX_MONTHS', 'ONE_YEAR'] as const
export type Period = (typeof PERIODS)[number]

export type Price = { territory: string; amount: string }
export type Territories = 'all' | string[]

export type AppBlock = { price?: Price; territories?: Territories }
export type GroupBlock = { reference: string; localizations: Record<string, { name: string; customAppName?: string }> }
export type SubscriptionBlock = {
  productId: string
  group?: string
  reference?: string
  period?: Period
  level?: number
  familySharable?: boolean
  price?: Price
  priceStart?: string
  prices?: Price[]
  territories?: Territories
  localizations: Record<string, { name?: string; description?: string }>
  reviewNote?: string
  reviewScreenshot?: string
}
export type Catalog = { app?: AppBlock; groups: GroupBlock[]; subscriptions: SubscriptionBlock[] }

/** ASC limits (characters; CJK counts as one). */
export const PRODUCT_LIMITS = { groupName: 30, customAppName: 30, reference: 64, name: 30, description: 45, reviewNote: 4000 }

const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/
const SUB_SCALARS = ['group', 'reference', 'period', 'level', 'familySharable', 'price', 'priceStart', 'prices', 'territories'] as const
const APP_SCALARS = ['price', 'territories'] as const
const SUB_TEXT = ['reviewNote', 'reviewScreenshot'] as const

function unfence(raw: string): string {
  const t = raw.trim()
  const m = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(t)
  return m ? m[1]! : t
}

export function parsePrice(s: string, where: string): Price {
  const m = /^([A-Z]{3})\s+(\d+(?:\.\d+)?)$/.exec(s.trim())
  if (!m) throw new StoreshipError(`${where}: price must be "<TERRITORY> <amount>", e.g. "USA 3.99" or "CHN 12", got "${s}"`)
  const currency = CURRENCY_TO_TERRITORY[m[1]!]
  if (currency) throw new StoreshipError(`${where}: "${m[1]}" is a currency; prices are per territory (ISO 3166 alpha-3)`, `write "${currency} ${m[2]}"`)
  return { territory: m[1]!, amount: m[2]! }
}

/** The currencies people reach for by reflex; Apple keys everything by territory. */
const CURRENCY_TO_TERRITORY: Record<string, string> = { USD: 'USA', CNY: 'CHN', RMB: 'CHN', JPY: 'JPN', GBP: 'GBR', KRW: 'KOR', HKD: 'HKG', TWD: 'TWN', AUD: 'AUS', CAD: 'CAN', SGD: 'SGP', INR: 'IND', BRL: 'BRA', MXN: 'MEX', CHF: 'CHE', SEK: 'SWE', NOK: 'NOR', DKK: 'DNK', RUB: 'RUS', TRY: 'TUR', THB: 'THA', IDR: 'IDN', MYR: 'MYS', PHP: 'PHL', VND: 'VNM', NZD: 'NZL' }

function parseTerritories(s: string): Territories {
  const t = s.trim()
  if (/^all$/i.test(t)) return 'all'
  return t.split(/[,\s]+/).filter(Boolean).map((x) => x.toUpperCase())
}

/** One pass; fence-aware; the same heading conventions as listing.md plus `- key: value` scalars. */
export function parseCatalog(md: string, where = 'products'): Catalog {
  const cat: Catalog = { groups: [], subscriptions: [] }
  type Block = { kind: 'app'; app: AppBlock } | { kind: 'group'; group: GroupBlock } | { kind: 'subscription'; sub: SubscriptionBlock }
  let block: Block | undefined
  let locale: string | undefined
  let text: (typeof SUB_TEXT)[number] | undefined
  let field: 'name' | 'description' | 'customAppName' | undefined
  let buf: string[] = []
  const at = (i: number): string => `${where}:${i + 1}`
  const flush = (): void => {
    const value = unfence(buf.join('\n'))
    buf = []
    if (!block) return
    if (text && block.kind === 'subscription') {
      block.sub[text] = value
    } else if (locale && field) {
      if (block.kind === 'group') {
        const loc = (block.group.localizations[locale] ??= { name: '' })
        if (field === 'name') loc.name = value
        else if (field === 'customAppName') loc.customAppName = value
      } else if (block.kind === 'subscription') {
        const loc = (block.sub.localizations[locale] ??= {})
        if (field === 'name' || field === 'description') loc[field] = value
      }
    }
  }
  const lines = md.split(/\r?\n/)
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^```/.test(line)) inFence = !inFence
    if (inFence) {
      buf.push(line)
      continue
    }
    const h4 = /^####\s+(\S+)/.exec(line)
    const h3 = /^###\s+(\S+)/.exec(line)
    const h2 = /^##\s+(\S+)(?:\s+(.*))?$/.exec(line)
    const kv = /^-\s+([A-Za-z]+)\s*:\s*(.*)$/.exec(line)
    if (h4) {
      flush()
      if (!block || !locale) throw new StoreshipError(`${at(i)}: "#### ${h4[1]}" must be under a "### <locale>" heading`)
      const f = h4[1]!
      if (f !== 'name' && f !== 'description' && f !== 'customAppName') throw new StoreshipError(`${at(i)}: unknown localized field "${f}"`, 'fields are: name, description (subscriptions), customAppName (groups)')
      field = f
      continue
    }
    if (h3 && !line.startsWith('####')) {
      flush()
      field = undefined
      locale = undefined
      text = undefined
      if (!block) throw new StoreshipError(`${at(i)}: "### ${h3[1]}" appears before any "## app / group / subscription" heading`)
      const h = h3[1]!
      if (LOCALE_RE.test(h)) locale = h
      else if ((SUB_TEXT as readonly string[]).includes(h) && block.kind === 'subscription') text = h as (typeof SUB_TEXT)[number]
      else throw new StoreshipError(`${at(i)}: unknown section "${h}"`, `expected a locale code or, under a subscription, one of: ${SUB_TEXT.join(', ')}`)
      continue
    }
    if (h2 && !line.startsWith('###')) {
      flush()
      field = undefined
      locale = undefined
      text = undefined
      const kind = h2[1]!.toLowerCase()
      const rest = (h2[2] ?? '').trim()
      if (kind === 'app') {
        cat.app ??= {}
        block = { kind: 'app', app: cat.app }
      } else if (kind === 'group') {
        if (!rest) throw new StoreshipError(`${at(i)}: "## group" needs a reference name, e.g. "## group Pro"`)
        const group: GroupBlock = { reference: rest, localizations: {} }
        cat.groups.push(group)
        block = { kind: 'group', group }
      } else if (kind === 'subscription') {
        if (!rest) throw new StoreshipError(`${at(i)}: "## subscription" needs a product id, e.g. "## subscription com.example.pro.monthly"`)
        const sub: SubscriptionBlock = { productId: rest, localizations: {} }
        cat.subscriptions.push(sub)
        block = { kind: 'subscription', sub }
      } else block = undefined
      continue
    }
    if (kv && block && !locale && !text) {
      const key = kv[1]!
      const value = kv[2]!.trim()
      if (block.kind === 'app') {
        if (!(APP_SCALARS as readonly string[]).includes(key)) throw new StoreshipError(`${at(i)}: unknown app key "${key}"`, `keys are: ${APP_SCALARS.join(', ')}`)
        if (key === 'price') block.app.price = parsePrice(value, at(i))
        if (key === 'territories') block.app.territories = parseTerritories(value)
      } else if (block.kind === 'subscription') {
        const s = block.sub
        if (!(SUB_SCALARS as readonly string[]).includes(key)) throw new StoreshipError(`${at(i)}: unknown subscription key "${key}"`, `keys are: ${SUB_SCALARS.join(', ')}`)
        if (key === 'group') s.group = value
        else if (key === 'reference') s.reference = value
        else if (key === 'period') {
          if (!(PERIODS as readonly string[]).includes(value)) throw new StoreshipError(`${at(i)}: period must be one of ${PERIODS.join(', ')}`)
          s.period = value as Period
        } else if (key === 'level') {
          if (!/^\d+$/.test(value)) throw new StoreshipError(`${at(i)}: level must be an integer (1 = highest)`)
          s.level = Number(value)
        } else if (key === 'familySharable') {
          if (!/^(true|false|yes|no)$/i.test(value)) throw new StoreshipError(`${at(i)}: familySharable must be true or false`)
          s.familySharable = /^(true|yes)$/i.test(value)
        } else if (key === 'price') s.price = parsePrice(value, at(i))
        else if (key === 'priceStart') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new StoreshipError(`${at(i)}: priceStart must be YYYY-MM-DD`)
          s.priceStart = value
        } else if (key === 'prices') s.prices = value.split(',').map((p) => parsePrice(p, at(i)))
        else if (key === 'territories') s.territories = parseTerritories(value)
      } else throw new StoreshipError(`${at(i)}: groups take no "- key: value" lines (only "### <locale>" / "#### name")`)
      continue
    }
    if (block && (text || (locale && field))) buf.push(line)
  }
  flush()
  if (!cat.app && !cat.groups.length && !cat.subscriptions.length) throw new StoreshipError(`${where}: nothing found`, 'expected "## app", "## group <name>" or "## subscription <productId>" sections')
  return cat
}

export function readCatalog(file: string): Catalog {
  let md: string
  try {
    md = readFileSync(file, 'utf8')
  } catch {
    throw new StoreshipError(`products file not found: ${file}`, 'set catalog.file in storeship.config.json (default products.md)')
  }
  const cat = parseCatalog(md, file)
  // screenshot paths are relative to the file
  for (const s of cat.subscriptions) if (s.reviewScreenshot) s.reviewScreenshot = resolve(dirname(file), s.reviewScreenshot)
  return cat
}

/** Offline problems: limits, references, missing files. Empty = fine. */
export function checkCatalog(cat: Catalog): string[] {
  const out: string[] = []
  const groups = new Set(cat.groups.map((g) => g.reference))
  const seenGroups = new Set<string>()
  for (const g of cat.groups) {
    if (seenGroups.has(g.reference)) out.push(`group ${g.reference}: listed twice`)
    seenGroups.add(g.reference)
    if (len(g.reference) > PRODUCT_LIMITS.reference) out.push(`group ${g.reference}: reference name ${len(g.reference)}/${PRODUCT_LIMITS.reference}`)
    for (const [loc, l] of Object.entries(g.localizations)) {
      if (!l.name) out.push(`group ${g.reference} ${loc}: name missing`)
      if (len(l.name) > PRODUCT_LIMITS.groupName) out.push(`group ${g.reference} ${loc}: name ${len(l.name)}/${PRODUCT_LIMITS.groupName}`)
      if (l.customAppName && len(l.customAppName) > PRODUCT_LIMITS.customAppName) out.push(`group ${g.reference} ${loc}: customAppName ${len(l.customAppName)}/${PRODUCT_LIMITS.customAppName}`)
    }
  }
  const seen = new Set<string>()
  for (const s of cat.subscriptions) {
    const id = `subscription ${s.productId}`
    if (seen.has(s.productId)) out.push(`${id}: listed twice`)
    seen.add(s.productId)
    if (s.group && !groups.has(s.group)) out.push(`${id}: group "${s.group}" is not defined in this file`)
    if (s.reference && len(s.reference) > PRODUCT_LIMITS.reference) out.push(`${id}: reference ${len(s.reference)}/${PRODUCT_LIMITS.reference}`)
    for (const [loc, l] of Object.entries(s.localizations)) {
      if (l.name !== undefined && len(l.name) > PRODUCT_LIMITS.name) out.push(`${id} ${loc}: name ${len(l.name)}/${PRODUCT_LIMITS.name}`)
      if (l.description !== undefined && len(l.description) > PRODUCT_LIMITS.description) out.push(`${id} ${loc}: description ${len(l.description)}/${PRODUCT_LIMITS.description}`)
    }
    if (s.reviewNote && len(s.reviewNote) > PRODUCT_LIMITS.reviewNote) out.push(`${id}: reviewNote ${len(s.reviewNote)}/${PRODUCT_LIMITS.reviewNote}`)
    if (s.reviewScreenshot && !existsSync(s.reviewScreenshot)) out.push(`${id}: reviewScreenshot not found: ${s.reviewScreenshot}`)
    if (s.prices?.length && !s.price) out.push(`${id}: "prices" needs a "price" too — the base territory is what every other territory is equalized from`)
    if (s.prices?.some((p) => p.territory === s.price?.territory)) out.push(`${id}: prices overrides the base territory ${s.price!.territory}; change "price" instead`)
  }
  return out
}

// ---------------------------------------------------------------- ASC read

export type AscLocalization = { id: string; locale: string; name: string; description?: string; customAppName?: string; state?: string }
export type AscGroup = { id: string; reference: string; localizations: AscLocalization[] }
export type AscSubscription = {
  id: string
  productId: string
  reference: string
  period: string
  level: number
  familySharable: boolean
  state: string
  reviewNote: string
  groupId: string
  localizations: AscLocalization[]
  /** Current (startDate null or past) price in the territory the file names, if asked for. */
  basePrice?: { territory: string; amount: string; pricePointId: string }
  /** How many territories have a price in force (should equal the availability count). */
  pricedTerritoryCount?: number
  /** Every price row per territory, so the plan can compare overrides and scheduled changes too. */
  priceTable?: Record<string, PriceRow[]>
  /** The territories it is available in. Compared as a set: a same-sized different list is a change. */
  territories?: string[]
  territoryCount?: number
  availableInNewTerritories?: boolean
  screenshot?: { id: string; md5: string; fileName: string; state: string }
}
export type AscApp = { basePrice?: { territory: string; amount: string }; territories?: string[]; territoryCount?: number; availableInNewTerritories?: boolean }
export type AscCatalog = { app: AscApp; groups: AscGroup[]; subscriptions: AscSubscription[]; territoryTotal: number }

async function pages(c: AscClient, path: string): Promise<{ data: any[]; included: any[] }> {
  const data: any[] = []
  const included: any[] = []
  let next: string | null = path
  while (next) {
    let r = await c.get(next)
    if (r.status >= 500) {
      await new Promise((res) => setTimeout(res, 1500))
      r = await c.get(next)
    }
    ok(r, `GET ${next}`)
    data.push(...(r.json?.data ?? []))
    included.push(...(r.json?.included ?? []))
    next = r.json?.links?.next ?? null
  }
  return { data, included }
}

const today = (): string => new Date().toISOString().slice(0, 10)

/** The price in force in one territory: the row with no startDate, or the latest startDate ≤ today. */
export function currentPriceRow<T extends { startDate: string | null }>(rows: T[], now = today()): T | undefined {
  const inForce = rows.filter((r) => !r.startDate || r.startDate <= now)
  inForce.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
  return inForce.at(-1)
}

export type PriceRow = { startDate: string | null; pricePointId: string; amount: string }

/**
 * Every price row of every territory, in one paginated read: current prices,
 * scheduled ones, and the amount of each. The plan compares against this, so
 * per-territory overrides and scheduled changes are seen, not just the base.
 * Relationship `data` is only present for included types; ask for both.
 */
export async function readPriceTable(c: AscClient, subId: string): Promise<Record<string, PriceRow[]>> {
  const { data, included } = await pages(c, `/v1/subscriptions/${subId}/prices?include=subscriptionPricePoint,territory&limit=200`)
  const amounts = new Map<string, string>()
  for (const x of included) if (x.type === 'subscriptionPricePoints') amounts.set(x.id, String(x.attributes?.customerPrice))
  const out: Record<string, PriceRow[]> = {}
  for (const p of data) {
    const t = p.relationships?.territory?.data?.id as string | undefined
    const pp = p.relationships?.subscriptionPricePoint?.data?.id as string | undefined
    if (!t || !pp) continue
    ;(out[t] ??= []).push({ startDate: p.attributes?.startDate ?? null, pricePointId: pp, amount: amounts.get(pp) ?? '?' })
  }
  return out
}

/** Does this territory already carry `amount` — in force, or scheduled for `start`? Pure. */
export function priceMatches(rows: PriceRow[] | undefined, amount: string, start?: string): boolean {
  if (start) return (rows ?? []).some((r) => r.startDate === start && Number(r.amount) === Number(amount))
  const cur = currentPriceRow(rows ?? [])
  return !!cur && Number(cur.amount) === Number(amount)
}

/** Is any price set for this territory (in force, or scheduled for `start`)? Pure. */
export function pricePresent(rows: PriceRow[] | undefined, start?: string): boolean {
  if (start) return (rows ?? []).some((r) => r.startDate === start)
  return !!currentPriceRow(rows ?? [])
}

export async function readSubscriptionPrice(c: AscClient, subId: string, territory: string): Promise<AscSubscription['basePrice']> {
  const cur = currentPriceRow((await readPriceTable(c, subId))[territory] ?? [])
  return cur ? { territory, amount: cur.amount, pricePointId: cur.pricePointId } : undefined
}

export async function readAscCatalog(c: AscClient, appId: string, wanted?: Catalog): Promise<AscCatalog> {
  const territoryTotal = (await c.all('/v1/territories?limit=200')).length
  const g = await pages(c, `/v1/apps/${appId}/subscriptionGroups?include=subscriptionGroupLocalizations&limit=50`)
  const groups: AscGroup[] = g.data.map((x: any) => ({
    id: x.id,
    reference: x.attributes.referenceName,
    localizations: (x.relationships?.subscriptionGroupLocalizations?.data ?? [])
      .map((ref: any) => g.included.find((i: any) => i.type === 'subscriptionGroupLocalizations' && i.id === ref.id))
      .filter(Boolean)
      .map((l: any) => ({ id: l.id, locale: l.attributes.locale, name: l.attributes.name, customAppName: l.attributes.customAppName ?? undefined, state: l.attributes.state })),
  }))
  const subscriptions: AscSubscription[] = []
  for (const grp of groups) {
    // ⚠️ Do not `include=subscriptionAvailability` here: a subscription that has no
    // availability record yet (just created) makes the whole list 404 with
    // "no resource of type subscriptionAvailabilities" (2026-09-08). Read the
    // to-one records per subscription instead and tolerate 404 / null.
    const s = await pages(c, `/v1/subscriptionGroups/${grp.id}/subscriptions?include=subscriptionLocalizations&limit=50`)
    for (const x of s.data) {
      const a = x.attributes
      const locs = (x.relationships?.subscriptionLocalizations?.data ?? [])
        .map((ref: any) => s.included.find((i: any) => i.type === 'subscriptionLocalizations' && i.id === ref.id))
        .filter(Boolean)
        .map((l: any) => ({ id: l.id, locale: l.attributes.locale, name: l.attributes.name, description: l.attributes.description ?? '', state: l.attributes.state }))
      const shotRes = await c.get(`/v1/subscriptions/${x.id}/appStoreReviewScreenshot`)
      const shot = shotRes.status === 200 ? shotRes.json?.data : undefined
      const sub: AscSubscription = {
        id: x.id,
        productId: a.productId,
        reference: a.name,
        period: a.subscriptionPeriod,
        level: a.groupLevel,
        familySharable: !!a.familySharable,
        state: a.state,
        reviewNote: a.reviewNote ?? '',
        groupId: grp.id,
        localizations: locs,
        screenshot: shot ? { id: shot.id, md5: shot.attributes.sourceFileChecksum ?? '', fileName: shot.attributes.fileName, state: shot.attributes.assetDeliveryState?.state ?? '' } : undefined,
      }
      const want = wanted?.subscriptions.find((w) => w.productId === sub.productId)
      if (want?.price) {
        sub.priceTable = await readPriceTable(c, sub.id)
        const base = currentPriceRow(sub.priceTable[want.price.territory] ?? [])
        if (base) sub.basePrice = { territory: want.price.territory, amount: base.amount, pricePointId: base.pricePointId }
        sub.pricedTerritoryCount = Object.values(sub.priceTable).filter((rows) => !!currentPriceRow(rows)).length
      }
      const avRes = await c.get(`/v1/subscriptions/${sub.id}/subscriptionAvailability`)
      if (avRes.status === 200 && avRes.json?.data) {
        sub.availableInNewTerritories = avRes.json.data.attributes?.availableInNewTerritories
        // The included list is one page; the ids have to come from the relationship endpoint.
        sub.territories = (await pages(c, `/v1/subscriptionAvailabilities/${avRes.json.data.id}/availableTerritories?limit=200`)).data.map((t: any) => t.id as string)
        sub.territoryCount = sub.territories.length
      } else if (avRes.status !== 404) ok(avRes, 'read availability')
      subscriptions.push(sub)
    }
  }
  const app: AscApp = {}
  const sched = await c.get(`/v1/apps/${appId}/appPriceSchedule?include=baseTerritory`)
  if (sched.status === 200 && sched.json?.data) {
    const base = sched.json.data.relationships?.baseTerritory?.data?.id as string | undefined
    const mp = await pages(c, `/v1/appPriceSchedules/${appId}/manualPrices?include=appPricePoint,territory&limit=200`)
    const rows = mp.data
      .filter((p: any) => p.relationships?.territory?.data?.id === base)
      .map((p: any) => ({ startDate: p.attributes.startDate as string | null, pricePointId: p.relationships.appPricePoint.data.id as string }))
    const cur = currentPriceRow(rows)
    const point = cur ? mp.included.find((x: any) => x.type === 'appPricePoints' && x.id === cur.pricePointId) : undefined
    if (base && point) app.basePrice = { territory: base, amount: String(point.attributes.customerPrice) }
  }
  const av = await c.get(`/v2/appAvailabilities/${appId}`)
  if (av.status === 200 && av.json?.data) {
    app.availableInNewTerritories = av.json.data.attributes?.availableInNewTerritories
    // ⚠️ A territoryAvailabilities record exists for territories the app is NOT sold in
    // too, with `available: false` — counting records would call an app that sells
    // nowhere "all 175 territories". Keep only the available ones.
    const rows = await pages(c, `/v2/appAvailabilities/${av.json.data.id}/territoryAvailabilities?include=territory&limit=200`)
    app.territories = rows.data.filter((t: any) => t.attributes?.available !== false).map((t: any) => t.relationships?.territory?.data?.id as string).filter(Boolean)
    app.territoryCount = app.territories.length
  }
  return { app, groups, subscriptions, territoryTotal }
}

// ---------------------------------------------------------------- price points

export type PricePoint = { id: string; territory: string; amount: string }

/** The point at `amount`, else the closest one below it (never above). Pure. */
export function pickPricePoint(points: PricePoint[], amount: string): PricePoint | undefined {
  const target = Number(amount)
  const exact = points.find((p) => Number(p.amount) === target)
  if (exact) return exact
  return points.filter((p) => Number(p.amount) < target).sort((a, b) => Number(b.amount) - Number(a.amount))[0]
}

export async function subscriptionPricePoints(c: AscClient, subId: string, territory: string): Promise<PricePoint[]> {
  const { data } = await pages(c, `/v1/subscriptions/${subId}/pricePoints?filter[territory]=${territory}&include=territory&limit=200`)
  return data.map((p: any) => ({ id: p.id, territory: p.relationships?.territory?.data?.id ?? territory, amount: String(p.attributes.customerPrice) }))
}

export async function equalizations(c: AscClient, pricePointId: string): Promise<PricePoint[]> {
  const { data } = await pages(c, `/v1/subscriptionPricePoints/${pricePointId}/equalizations?include=territory&limit=200`)
  return data.map((p: any) => ({ id: p.id, territory: p.relationships?.territory?.data?.id, amount: String(p.attributes.customerPrice) }))
}

export async function appPricePoints(c: AscClient, appId: string, territory: string): Promise<PricePoint[]> {
  const { data } = await pages(c, `/v1/apps/${appId}/appPricePoints?filter[territory]=${territory}&include=territory&limit=200`)
  return data.map((p: any) => ({ id: p.id, territory: p.relationships?.territory?.data?.id ?? territory, amount: String(p.attributes.customerPrice) }))
}

// ---------------------------------------------------------------- plan

export type Action = { target: string; what: string; detail?: string; apply: (c: AscClient, appId: string) => Promise<void> }
export type Plan = { same: string[]; actions: Action[]; warnings: string[] }

/**
 * Pure. `have` is the list ASC actually sells in; comparing sizes was not enough —
 * swapping GBR for JPN keeps the count and would have been reported as "no change".
 * Unknown (`undefined`) means there is no availability record yet, so: not the same.
 */
export function territoriesSame(want: Territories | undefined, have: string[] | undefined, newOnes: boolean | undefined, total: number): boolean {
  if (!have) return false
  if (!want || want === 'all') return have.length === total && newOnes !== false
  return have.length === want.length && new Set(have).size === new Set([...have, ...want]).size
}

/**
 * Pure: what has to change so ASC matches the file. Each action carries the
 * request it will make; `applyPlan` runs them in order (groups before
 * subscriptions, subscriptions before their localizations and prices).
 */
export function planCatalog(wanted: Catalog, current: AscCatalog, opts: { readFile?: (p: string) => Buffer } = {}): Plan {
  const plan: Plan = { same: [], actions: [], warnings: [] }
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p))
  const groupIds = new Map<string, string | undefined>(current.groups.map((g) => [g.reference, g.id]))

  for (const g of wanted.groups) {
    const cur = current.groups.find((x) => x.reference === g.reference)
    const tag = `group ${g.reference}`
    if (!cur) {
      plan.actions.push({
        target: tag,
        what: 'create',
        apply: async (c, appId) => {
          const r = ok(await c.post('/v1/subscriptionGroups', { data: { type: 'subscriptionGroups', attributes: { referenceName: g.reference }, relationships: { app: { data: { type: 'apps', id: appId } } } } }), `create ${tag}`)
          groupIds.set(g.reference, r.json.data.id)
        },
      })
    } else plan.same.push(tag)
    for (const [locale, l] of Object.entries(g.localizations)) {
      const curLoc = cur?.localizations.find((x) => x.locale === locale)
      const ltag = `${tag} ${locale}`
      const attrs: Record<string, unknown> = {}
      if (!curLoc || curLoc.name !== l.name) attrs.name = l.name
      // Omitted = leave alone, the same contract as every other field. Clearing it
      // takes an explicit empty value; otherwise adopting products.md for a group whose
      // custom app name was set in the web UI would wipe it on the first push.
      if (l.customAppName !== undefined && l.customAppName !== (curLoc?.customAppName ?? '')) attrs.customAppName = l.customAppName
      if (!curLoc) {
        plan.actions.push({
          target: ltag,
          what: 'create localization',
          detail: l.name,
          apply: async (c) => {
            const gid = groupIds.get(g.reference)
            ok(await c.post('/v1/subscriptionGroupLocalizations', { data: { type: 'subscriptionGroupLocalizations', attributes: { locale, name: l.name, ...(l.customAppName ? { customAppName: l.customAppName } : {}) }, relationships: { subscriptionGroup: { data: { type: 'subscriptionGroups', id: gid } } } } }), `create ${ltag}`)
          },
        })
      } else if (Object.keys(attrs).length) {
        plan.actions.push({ target: ltag, what: `update ${Object.keys(attrs).join('/')}`, detail: `${JSON.stringify(curLoc.name)} → ${JSON.stringify(l.name)}`, apply: async (c) => void ok(await c.patch(`/v1/subscriptionGroupLocalizations/${curLoc.id}`, { data: { type: 'subscriptionGroupLocalizations', id: curLoc.id, attributes: attrs } }), `update ${ltag}`) })
      } else plan.same.push(ltag)
    }
  }

  const subIds = new Map<string, string | undefined>(current.subscriptions.map((s) => [s.productId, s.id]))
  for (const s of wanted.subscriptions) {
    const cur = current.subscriptions.find((x) => x.productId === s.productId)
    const tag = `subscription ${s.productId}`
    if (!cur) {
      for (const k of ['group', 'reference', 'period', 'level'] as const) if (s[k] === undefined) throw new StoreshipError(`${tag}: "${k}" is required to create it`)
      plan.actions.push({
        target: tag,
        what: 'create',
        detail: `${s.period}, level ${s.level}, in group ${s.group}`,
        apply: async (c) => {
          const gid = groupIds.get(s.group!)
          if (!gid) throw new StoreshipError(`${tag}: group "${s.group}" does not exist in App Store Connect`, 'add a "## group" section for it')
          const r = ok(
            await c.post('/v1/subscriptions', {
              data: {
                type: 'subscriptions',
                attributes: { name: s.reference, productId: s.productId, subscriptionPeriod: s.period, groupLevel: s.level, familySharable: s.familySharable ?? false, ...(s.reviewNote !== undefined ? { reviewNote: s.reviewNote } : {}) },
                relationships: { group: { data: { type: 'subscriptionGroups', id: gid } } },
              },
            }),
            `create ${tag}`,
          )
          subIds.set(s.productId, r.json.data.id)
        },
      })
    } else {
      if (s.period && s.period !== cur.period) plan.warnings.push(`${tag}: period is ${cur.period} in ASC and cannot change after creation; the file says ${s.period}`)
      if (s.group && current.groups.find((g) => g.id === cur.groupId)?.reference !== s.group) plan.warnings.push(`${tag}: it belongs to another group in ASC; a subscription cannot move between groups`)
      const attrs: Record<string, unknown> = {}
      if (s.reference !== undefined && s.reference !== cur.reference) attrs.name = s.reference
      if (s.level !== undefined && s.level !== cur.level) attrs.groupLevel = s.level
      if (s.familySharable !== undefined && s.familySharable !== cur.familySharable) attrs.familySharable = s.familySharable
      if (s.reviewNote !== undefined && s.reviewNote.trimEnd() !== cur.reviewNote.trimEnd()) attrs.reviewNote = s.reviewNote
      if (Object.keys(attrs).length) plan.actions.push({ target: tag, what: `update ${Object.keys(attrs).join('/')}`, apply: async (c) => void ok(await c.patch(`/v1/subscriptions/${cur.id}`, { data: { type: 'subscriptions', id: cur.id, attributes: attrs } }), `update ${tag}`) })
      else plan.same.push(tag)
    }
    for (const [locale, l] of Object.entries(s.localizations)) {
      const curLoc = cur?.localizations.find((x) => x.locale === locale)
      const ltag = `${tag} ${locale}`
      const attrs: Record<string, unknown> = {}
      if (l.name !== undefined && l.name !== curLoc?.name) attrs.name = l.name
      if (l.description !== undefined && l.description !== (curLoc?.description ?? '')) attrs.description = l.description
      if (!curLoc) {
        if (l.name === undefined) throw new StoreshipError(`${ltag}: "#### name" is required to create the localization`)
        plan.actions.push({
          target: ltag,
          what: 'create localization',
          detail: l.name,
          apply: async (c) => void ok(await c.post('/v1/subscriptionLocalizations', { data: { type: 'subscriptionLocalizations', attributes: { locale, name: l.name, description: l.description ?? '' }, relationships: { subscription: { data: { type: 'subscriptions', id: subIds.get(s.productId) } } } } }), `create ${ltag}`),
        })
      } else if (Object.keys(attrs).length) {
        plan.actions.push({ target: ltag, what: `update ${Object.keys(attrs).join('/')}`, apply: async (c) => void ok(await c.patch(`/v1/subscriptionLocalizations/${curLoc.id}`, { data: { type: 'subscriptionLocalizations', id: curLoc.id, attributes: attrs } }), `update ${ltag}`) })
      } else plan.same.push(ltag)
    }
    if (s.territories !== undefined || !cur) {
      const want = s.territories ?? 'all'
      const ttag = `${tag} territories`
      if (cur && territoriesSame(want, cur.territories, cur.availableInNewTerritories, current.territoryTotal)) plan.same.push(`${ttag} (${cur.territoryCount})`)
      else
        plan.actions.push({
          target: ttag,
          what: want === 'all' ? `all ${current.territoryTotal} territories` : `${want.length} territories`,
          apply: async (c) => {
            const sid = subIds.get(s.productId)
            const list = want === 'all' ? (await c.all('/v1/territories?limit=200')).map((t: any) => t.id as string) : want
            ok(
              await c.post('/v1/subscriptionAvailabilities', {
                data: {
                  type: 'subscriptionAvailabilities',
                  attributes: { availableInNewTerritories: want === 'all' },
                  relationships: { subscription: { data: { type: 'subscriptions', id: sid } }, availableTerritories: { data: list.map((t) => ({ type: 'territories', id: t })) } },
                },
              }),
              `availability ${s.productId}`,
            )
          },
        })
    }
    if (s.price) {
      const ptag = `${tag} price`
      const cp = cur?.basePrice
      const table = cur?.priceTable
      const explicit = s.territories && s.territories !== 'all' ? s.territories : undefined
      const wantCount = explicit?.length ?? current.territoryTotal
      // Every amount the file states has to hold, not just the base one: an edited
      // `prices:` override used to be invisible because only basePrice was compared.
      const baseSame = priceMatches(table?.[s.price.territory], s.price.amount, s.priceStart)
      const overridesSame = (s.prices ?? []).every((o) => priceMatches(table?.[o.territory], o.amount, s.priceStart))
      const priced = explicit ? explicit.filter((t) => pricePresent(table?.[t], s.priceStart)).length : Object.values(table ?? {}).filter((rows) => pricePresent(rows, s.priceStart)).length
      const filled = priced >= wantCount
      if (baseSame && overridesSame && filled) plan.same.push(`${ptag} ${s.price.territory} ${s.price.amount} (${priced} territories${s.priceStart ? `, from ${s.priceStart}` : ''})`)
      else if (baseSame && overridesSame && !filled) plan.actions.push({ target: ptag, what: `fill ${wantCount - priced} territories without a price`, detail: 'equalized from the base territory', apply: (c) => priceApply(c, s, subIds, tag) })
      else {
        if (cp && cur?.state === 'APPROVED' && Number(s.price.amount) > Number(cp.amount)) plan.warnings.push(`${tag}: raising a live price (${cp.territory} ${cp.amount} → ${s.price.amount}) triggers Apple's subscriber consent flow`)
        plan.actions.push({
          target: ptag,
          what: cp ? `change ${cp.territory} ${cp.amount} → ${s.price.amount}` : `set ${s.price.territory} ${s.price.amount}`,
          detail: `equalized to every territory${s.priceStart ? `, from ${s.priceStart}` : ''}${s.prices?.length ? `; overrides: ${s.prices.map((p) => `${p.territory} ${p.amount}`).join(', ')}` : ''}`,
          apply: (c) => priceApply(c, s, subIds, tag),
        })
      }
    }
    if (s.reviewScreenshot) {
      const stag = `${tag} reviewScreenshot`
      const md5 = createHash('md5').update(readFile(s.reviewScreenshot)).digest('hex')
      if (cur?.screenshot && cur.screenshot.md5 === md5) plan.same.push(stag)
      else
        plan.actions.push({
          target: stag,
          what: cur?.screenshot ? 'replace' : 'upload',
          detail: basename(s.reviewScreenshot),
          apply: async (c) => {
            const sid = subIds.get(s.productId)!
            const old = cur?.screenshot?.id
            // Upload first, delete the old one only once the new one is committed. The old
            // order lost the existing screenshot whenever the new file was rejected — and
            // this slot rejects anything but 1242×2208, so that is the common case.
            try {
              await uploadReviewScreenshot(c, sid, s.reviewScreenshot!, readFile)
            } catch (e) {
              if (!old || !(e instanceof AscError) || e.result.status !== 409) throw e
              // ASC keeps at most one: it refused the second, so make room and retry.
              ok(await c.delete(`/v1/subscriptionAppStoreReviewScreenshots/${old}`), 'delete old review screenshot')
              await uploadReviewScreenshot(c, sid, s.reviewScreenshot!, readFile)
              return
            }
            if (old) ok(await c.delete(`/v1/subscriptionAppStoreReviewScreenshots/${old}`), 'delete old review screenshot')
          },
        })
    }
  }

  if (wanted.app) {
    const a = wanted.app
    if (a.price) {
      const cp = current.app.basePrice
      if (cp && cp.territory === a.price.territory && Number(cp.amount) === Number(a.price.amount)) plan.same.push(`app price ${cp.territory} ${cp.amount}`)
      else
        plan.actions.push({
          target: 'app price',
          what: cp ? `change ${cp.territory} ${cp.amount} → ${a.price.territory} ${a.price.amount}` : `set ${a.price.territory} ${a.price.amount}`,
          apply: async (c, appId) => {
            const p = pickPricePoint(await appPricePoints(c, appId, a.price!.territory), a.price!.amount)
            if (!p) throw new StoreshipError(`app price: no price point at or below ${a.price!.territory} ${a.price!.amount}`)
            ok(
              await c.post('/v1/appPriceSchedules', {
                data: {
                  type: 'appPriceSchedules',
                  relationships: { app: { data: { type: 'apps', id: appId } }, baseTerritory: { data: { type: 'territories', id: p.territory } }, manualPrices: { data: [{ type: 'appPrices', id: '${price1}' }] } },
                },
                included: [{ type: 'appPrices', id: '${price1}', attributes: { startDate: null }, relationships: { appPricePoint: { data: { type: 'appPricePoints', id: p.id } } } }],
              }),
              'app price schedule',
            )
          },
        })
    }
    if (a.territories !== undefined) {
      if (territoriesSame(a.territories, current.app.territories, current.app.availableInNewTerritories, current.territoryTotal)) plan.same.push(`app territories (${current.app.territoryCount})`)
      else
        plan.actions.push({
          target: 'app territories',
          what: a.territories === 'all' ? `all ${current.territoryTotal} territories` : `${a.territories.length} territories`,
          apply: async (c, appId) => {
            const list = a.territories === 'all' ? (await c.all('/v1/territories?limit=200')).map((t: any) => t.id as string) : a.territories!
            ok(
              await c.post('/v2/appAvailabilities', {
                data: {
                  type: 'appAvailabilities',
                  attributes: { availableInNewTerritories: a.territories === 'all' },
                  relationships: { app: { data: { type: 'apps', id: appId } }, territoryAvailabilities: { data: list.map((_, i) => ({ type: 'territoryAvailabilities', id: `\${t${i}}` })) } },
                },
                included: list.map((t, i) => ({ type: 'territoryAvailabilities', id: `\${t${i}}`, attributes: { available: true }, relationships: { territory: { data: { type: 'territories', id: t } } } })),
              }),
              'app availability',
            )
          },
        })
    }
  }
  return plan
}

async function priceApply(c: AscClient, s: SubscriptionBlock, subIds: Map<string, string | undefined>, tag: string): Promise<void> {
  const sid = subIds.get(s.productId)
  if (!sid) throw new StoreshipError(`${tag}: not created yet`)
  const tiers = await subscriptionPricePoints(c, sid, s.price!.territory)
  if (!tiers.length) throw new StoreshipError(`${tag}: App Store Connect has no price points for territory "${s.price!.territory}"`, 'territory codes are ISO 3166 alpha-3 (USA, CHN, JPN, GBR, DEU…), not currencies')
  const base = pickPricePoint(tiers, s.price!.amount)
  if (!base) throw new StoreshipError(`${tag}: no price point at or below ${s.price!.territory} ${s.price!.amount} (lowest is ${tiers.map((t) => Number(t.amount)).sort((a, b) => a - b)[0]})`, `run \`storeship products pricepoints ${s.productId} ${s.price!.territory}\` to see the tiers`)
  // Keyed by territory: the equalization list can repeat one, and an override has to
  // replace the equalized row rather than be POSTed next to it.
  const byTerritory = new Map<string, PricePoint>()
  for (const p of [base, ...(await equalizations(c, base.id))]) if (p.territory) byTerritory.set(p.territory, p)
  for (const o of s.prices ?? []) {
    const p = pickPricePoint(await subscriptionPricePoints(c, sid, o.territory), o.amount)
    if (!p) throw new StoreshipError(`${tag}: no price point at or below ${o.territory} ${o.amount}`)
    byTerritory.set(o.territory, p)
  }
  const only = s.territories && s.territories !== 'all' ? new Set(s.territories) : undefined
  const points = [...byTerritory.values()].filter((p) => !only || only.has(p.territory))
  // Idempotent, scheduled changes included: a territory that already carries this tier
  // (in force, or scheduled for the same day) is skipped, so a re-run writes nothing.
  const have = await readPriceTable(c, sid)
  for (const p of points) {
    const rows = have[p.territory] ?? []
    const already = s.priceStart ? rows.some((r) => r.startDate === s.priceStart && r.pricePointId === p.id) : currentPriceRow(rows)?.pricePointId === p.id
    if (already) continue
    const body = {
      data: {
        type: 'subscriptionPrices',
        ...(s.priceStart ? { attributes: { startDate: s.priceStart } } : {}),
        relationships: { subscription: { data: { type: 'subscriptions', id: sid } }, subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: p.id } } },
      },
    }
    // 175 POSTs in a row; Apple answers a stray 500 now and then (NLD, SLE on 2026-09-08). Retry those, fail on anything else.
    let r = await c.post('/v1/subscriptionPrices', body)
    for (let attempt = 0; r.status >= 500 && attempt < 3; attempt++) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)))
      r = await c.post('/v1/subscriptionPrices', body)
    }
    ok(r, `price ${s.productId} ${p.territory} ${p.amount}`)
  }
}

export async function applyPlan(c: AscClient, appId: string, plan: Plan, onStep?: (a: Action) => void): Promise<void> {
  for (const a of plan.actions) {
    onStep?.(a)
    await a.apply(c, appId)
  }
}

async function uploadReviewScreenshot(c: AscClient, subId: string, file: string, readFile: (p: string) => Buffer, fetchLike: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)): Promise<void> {
  const bytes = readFile(file)
  const type = 'subscriptionAppStoreReviewScreenshots'
  const created = ok(await c.post(`/v1/${type}`, { data: { type, attributes: { fileName: basename(file), fileSize: bytes.length }, relationships: { subscription: { data: { type: 'subscriptions', id: subId } } } } }), 'reserve review screenshot')
  const id = created.json.data.id as string
  for (const op of created.json.data.attributes.uploadOperations ?? []) {
    const headers: Record<string, string> = {}
    for (const h of op.requestHeaders ?? []) headers[h.name] = h.value
    const res = await fetchLike(op.url, { method: op.method, headers, body: new Uint8Array(bytes.subarray(op.offset, op.offset + op.length)) })
    if (!res.ok) throw new Error(`chunk PUT failed ${res.status} at offset ${op.offset}`)
  }
  const md5 = createHash('md5').update(bytes).digest('hex')
  ok(await c.patch(`/v1/${type}/${id}`, { data: { type, id, attributes: { uploaded: true, sourceFileChecksum: md5 } } }), 'commit review screenshot')
}

/** Only subscriptions that were never submitted can be deleted; ASC refuses the rest. */
export async function deleteSubscription(c: AscClient, subId: string): Promise<void> {
  ok(await c.delete(`/v1/subscriptions/${subId}`), `delete subscription ${subId}`)
}

export async function deleteGroup(c: AscClient, groupId: string): Promise<void> {
  ok(await c.delete(`/v1/subscriptionGroups/${groupId}`), `delete subscription group ${groupId}`)
}
