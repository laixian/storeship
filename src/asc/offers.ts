/**
 * Subscription offer codes: create an offer, issue a batch of one-time codes,
 * export the CSV, deactivate.
 *
 * The App Store Connect web UI has no entry point for these (checked page by
 * page, 2026-08); the API is the only route.
 *
 * ## Three things only Apple's validator will tell you
 *
 * 1. Under FREE_TRIAL, `subscriptionPricePoint` must be null, yet `prices`
 *    is still required and non-empty: for a free offer it only says *where*
 *    the code can be redeemed. Including price points → 409, once per
 *    territory (175 identical errors).
 * 2. Territories must be listed one by one, as many as the product sells in.
 *    A territory left out cannot redeem. So the list is copied from the
 *    product's current price table, never typed.
 * 3. `autoRenewEnabled` can only be set at creation (PATCH → 409
 *    ATTRIBUTE.NOT_ALLOWED). Apple's default is true — the subscription
 *    renews at full price when the free period ends. This tool defaults to
 *    false; pass `--renew` to opt in.
 */
import { writeFileSync } from 'node:fs'
import { type AscClient, ok } from './client.ts'
import { StoreshipError } from '../errors.ts'

export type OfferRow = {
  id: string
  name: string
  active: boolean
  offerMode: string
  duration: string
  numberOfPeriods: number
  eligibilities: string[]
  autoRenewEnabled: boolean
  productionCodeCount: number
  batches: { id: string; numberOfCodes: number; active: boolean; expirationDate: string }[]
}

export async function listOffers(c: AscClient, subscriptionId: string): Promise<OfferRow[]> {
  const out: OfferRow[] = []
  for (const o of await c.all(`/v1/subscriptions/${subscriptionId}/offerCodes?limit=50`)) {
    const a = o.attributes
    const batches = (await c.all(`/v1/subscriptionOfferCodes/${o.id}/oneTimeUseCodes?limit=50`)).map((b: any) => ({
      id: b.id,
      numberOfCodes: b.attributes.numberOfCodes,
      active: b.attributes.active,
      expirationDate: b.attributes.expirationDate,
    }))
    out.push({
      id: o.id,
      name: a.name,
      active: a.active,
      offerMode: a.offerMode,
      duration: a.duration,
      numberOfPeriods: a.numberOfPeriods,
      eligibilities: a.customerEligibilities ?? [],
      autoRenewEnabled: a.autoRenewEnabled,
      productionCodeCount: a.productionCodeCount,
      batches,
    })
  }
  return out
}

export type CreateOfferOptions = {
  name: string
  duration?: string
  periods?: number
  codes?: number
  /** Redemption window end, YYYY-MM-DD. Max 6 months out; default today + 175 days. */
  expires?: string
  eligibility?: string[]
  autoRenew?: boolean
  offerMode?: string
}

export async function createOffer(c: AscClient, subscriptionId: string, o: CreateOfferOptions): Promise<{ offerId: string; autoRenewEnabled: boolean; territories: number; batchId: string; codes: number; expires: string }> {
  const duration = o.duration ?? 'ONE_YEAR'
  const count = o.codes ?? 500
  const expires = o.expires ?? new Date(Date.now() + 175 * 864e5).toISOString().slice(0, 10)
  const dup = (await c.all(`/v1/subscriptions/${subscriptionId}/offerCodes?limit=50`)).find((x: any) => x.attributes.name === o.name)
  if (dup) throw new StoreshipError(`an offer named "${o.name}" already exists (${dup.id})`, 'offer names must be unique; pick another or deactivate the old one', { code: 'CHECK_FAILED' })

  const prices = await c.all(`/v1/subscriptions/${subscriptionId}/prices?include=territory&limit=200`)
  const territories = [...new Set(prices.map((p: any) => p.relationships.territory.data.id as string))]
  if (!territories.length) throw new StoreshipError('the subscription has no prices, so no territories to offer in', 'set a price first: `storeship products push`', { code: 'CHECK_FAILED' })

  const included = territories.map((t, i) => ({
    type: 'subscriptionOfferCodePrices',
    id: `\${price-${i}}`,
    relationships: { territory: { data: { type: 'territories', id: t } } },
  }))
  const r = ok(
    await c.post('/v1/subscriptionOfferCodes', {
      data: {
        type: 'subscriptionOfferCodes',
        attributes: {
          name: o.name,
          customerEligibilities: o.eligibility ?? ['NEW'],
          offerEligibility: 'REPLACE_INTRO_OFFERS',
          duration,
          offerMode: o.offerMode ?? 'FREE_TRIAL',
          numberOfPeriods: o.periods ?? 1,
          autoRenewEnabled: o.autoRenew ?? false,
        },
        relationships: {
          subscription: { data: { type: 'subscriptions', id: subscriptionId } },
          prices: { data: included.map((p) => ({ type: p.type, id: p.id })) },
        },
      },
      included,
    }),
    `create offer "${o.name}"`,
    [201],
  )
  const offer = r.json.data
  const b = ok(
    await c.post('/v1/subscriptionOfferCodeOneTimeUseCodes', {
      data: {
        type: 'subscriptionOfferCodeOneTimeUseCodes',
        attributes: { numberOfCodes: count, expirationDate: expires },
        relationships: { offerCode: { data: { type: 'subscriptionOfferCodes', id: offer.id } } },
      },
    }),
    'issue code batch',
    [201],
  )
  return { offerId: offer.id, autoRenewEnabled: offer.attributes.autoRenewEnabled, territories: territories.length, batchId: b.json.data.id, codes: count, expires }
}

export async function downloadCodes(c: AscClient, batchId: string, out: string): Promise<{ file: string; rows: number }> {
  const res = await c.raw(`/v1/subscriptionOfferCodeOneTimeUseCodes/${batchId}/values`)
  const csv = await res.text()
  if (res.status !== 200) throw new StoreshipError(`download codes: ${res.status} ${csv.slice(0, 300)}`, undefined, { code: 'API' })
  writeFileSync(out, csv)
  return { file: out, rows: csv.split(/\r?\n/).filter((l) => l.trim()).length }
}

/** Deactivate an offer and all its batches; existing codes stop working immediately. */
export async function deactivateOffer(c: AscClient, offerId: string): Promise<{ batches: string[] }> {
  const batches: string[] = []
  for (const b of await c.all(`/v1/subscriptionOfferCodes/${offerId}/oneTimeUseCodes?limit=50`)) {
    ok(await c.patch(`/v1/subscriptionOfferCodeOneTimeUseCodes/${b.id}`, { data: { type: 'subscriptionOfferCodeOneTimeUseCodes', id: b.id, attributes: { active: false } } }), `deactivate batch ${b.id}`)
    batches.push(b.id)
  }
  ok(await c.patch(`/v1/subscriptionOfferCodes/${offerId}`, { data: { type: 'subscriptionOfferCodes', id: offerId, attributes: { active: false } } }), `deactivate offer ${offerId}`)
  return { batches }
}
