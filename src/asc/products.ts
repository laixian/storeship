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
import { type AscClient, ok } from './client.ts'
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
  for (const g of cat.groups) {
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
  territoryCount?: number
  availableInNewTerritories?: boolean
  screenshot?: { id: string; md5: string; fileName: string; state: string }
}
export type AscApp = { basePrice?: { territory: string; amount: string }; territoryCount?: number; availableInNewTerritories?: boolean }
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
export function currentPriceRow(rows: { startDate: string | null; pricePointId: string }[], now = today()): { startDate: string | null; pricePointId: string } | undefined {
  const inForce = rows.filter((r) => !r.startDate || r.startDate <= now)
  inForce.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
  return inForce.at(-1)
}

/** Territory → price point id in force today, across every territory. */
export async function currentPricePoints(c: AscClient, subId: string): Promise<Map<string, string>> {
  // Relationship `data` is only present for included types; ask for both.
  const { data } = await pages(c, `/v1/subscriptions/${subId}/prices?include=subscriptionPricePoint,territory&limit=200`)
  const byTerritory = new Map<string, { startDate: string | null; pricePointId: string }[]>()
  for (const p of data) {
    const t = p.relationships?.territory?.data?.id as string | undefined
    if (!t || !p.relationships?.subscriptionPricePoint?.data?.id) continue
    byTerritory.set(t, [...(byTerritory.get(t) ?? []), { startDate: p.attributes.startDate ?? null, pricePointId: p.relationships.subscriptionPricePoint.data.id }])
  }
  const out = new Map<string, string>()
  for (const [t, rows] of byTerritory) {
    const cur = currentPriceRow(rows)
    if (cur) out.set(t, cur.pricePointId)
  }
  return out
}

export async function readSubscriptionPrice(c: AscClient, subId: string, territory: string): Promise<AscSubscription['basePrice']> {
  const { data, included } = await pages(c, `/v1/subscriptions/${subId}/prices?filter[territory]=${territory}&include=subscriptionPricePoint&limit=200`)
  const rows = data.map((p: any) => ({ startDate: p.attributes.startDate as string | null, pricePointId: p.relationships.subscriptionPricePoint.data.id as string }))
  const cur = currentPriceRow(rows)
  if (!cur) return undefined
  const point = included.find((x: any) => x.type === 'subscriptionPricePoints' && x.id === cur.pricePointId)
  return { territory, amount: String(point?.attributes?.customerPrice ?? '?'), pricePointId: cur.pricePointId }
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
        sub.basePrice = await readSubscriptionPrice(c, sub.id, want.price.territory)
        sub.pricedTerritoryCount = (await currentPricePoints(c, sub.id)).size
      }
      const avRes = await c.get(`/v1/subscriptions/${sub.id}/subscriptionAvailability?include=availableTerritories`)
      if (avRes.status === 200 && avRes.json?.data) {
        const av = avRes.json
        sub.availableInNewTerritories = av.data.attributes?.availableInNewTerritories
        sub.territoryCount = av.data.relationships?.availableTerritories?.meta?.paging?.total ?? av.included?.length
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
  const av = await c.get(`/v2/appAvailabilities/${appId}?include=territoryAvailabilities`)
  if (av.status === 200) {
    app.availableInNewTerritories = av.json?.data?.attributes?.availableInNewTerritories
    app.territoryCount = av.json?.data?.relationships?.territoryAvailabilities?.meta?.paging?.total ?? av.json?.included?.length
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

const territoriesSame = (want: Territories | undefined, count: number | undefined, newOnes: boolean | undefined, total: number): boolean => {
  if (!want || want === 'all') return count === total && newOnes !== false
  return count === want.length
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
      if ((l.customAppName ?? null) !== (curLoc?.customAppName ?? null) && (l.customAppName !== undefined || curLoc)) attrs.customAppName = l.customAppName ?? null
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
      if (cur && territoriesSame(want, cur.territoryCount, cur.availableInNewTerritories, current.territoryTotal)) plan.same.push(`${ttag} (${cur.territoryCount})`)
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
      const wantCount = s.territories && s.territories !== 'all' ? s.territories.length : current.territoryTotal
      const baseSame = !!cp && cp.territory === s.price.territory && Number(cp.amount) === Number(s.price.amount) && !s.priceStart
      const filled = (cur?.pricedTerritoryCount ?? 0) >= wantCount
      if (baseSame && filled) plan.same.push(`${ptag} ${s.price.territory} ${cp!.amount} (${cur!.pricedTerritoryCount} territories)`)
      else if (baseSame && !filled) plan.actions.push({ target: ptag, what: `fill ${wantCount - (cur?.pricedTerritoryCount ?? 0)} territories without a price`, detail: 'equalized from the base territory', apply: (c) => priceApply(c, s, subIds, tag) })
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
            if (cur?.screenshot) ok(await c.delete(`/v1/subscriptionAppStoreReviewScreenshots/${cur.screenshot.id}`), 'delete old review screenshot')
            await uploadReviewScreenshot(c, sid, s.reviewScreenshot!, readFile)
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
      if (territoriesSame(a.territories, current.app.territoryCount, current.app.availableInNewTerritories, current.territoryTotal)) plan.same.push(`app territories (${current.app.territoryCount})`)
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
  const points = [base, ...(await equalizations(c, base.id))]
  for (const o of s.prices ?? []) {
    const p = pickPricePoint(await subscriptionPricePoints(c, sid, o.territory), o.amount)
    if (!p) throw new StoreshipError(`${tag}: no price point at or below ${o.territory} ${o.amount}`)
    const i = points.findIndex((x) => x.territory === o.territory)
    if (i >= 0) points[i] = p
    else points.push(p)
  }
  // Idempotent: a territory already on the target tier is skipped, so a run
  // that died half-way (or a base-only change) does not re-POST 175 rows.
  const have = await currentPricePoints(c, sid)
  for (const p of points) {
    if (!s.priceStart && have.get(p.territory) === p.id) continue
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
