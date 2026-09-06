import { createOffer, deactivateOffer, downloadCodes, listOffers } from '../asc/offers.ts'
import { type Command, type Ctx } from '../ctx.ts'
import { StoreshipError, UsageError } from '../errors.ts'

function productId(ctx: Ctx): string {
  const p = ctx.args.str('product')
  const ids = ctx.cfg.products
  if (p) return ids[p] ?? p
  const first = Object.values(ids)[0]
  if (!first) throw new StoreshipError('no subscription product given', 'pass --product <alias|subscriptionId>, or set products in storeship.config.json')
  return first
}

export const offerCommand: Command = {
  name: 'offer',
  summary: 'subscription offer codes (no UI for these in App Store Connect)',
  sub: [
    {
      name: 'list',
      summary: 'offers and code batches per configured product',
      run: async (ctx) => {
        const products = ctx.args.str('product') ? { [ctx.args.str('product')!]: productId(ctx) } : ctx.cfg.products
        if (!Object.keys(products).length) throw new StoreshipError('no products configured', 'set products in storeship.config.json or pass --product <subscriptionId>')
        const all: Record<string, unknown> = {}
        for (const [alias, id] of Object.entries(products)) {
          const offers = await listOffers(ctx.client(), id)
          all[alias] = offers
          ctx.out.log(`\n── ${alias} (${id}): ${offers.length} offer(s)`)
          for (const o of offers) {
            ctx.out.log(`  ${o.active ? '●' : '○'} ${o.name}  ${o.id}`)
            ctx.out.log(`     ${o.offerMode} ${o.numberOfPeriods}×${o.duration} · eligible ${o.eligibilities.join('/')} · renews after ${o.autoRenewEnabled} · issued ${o.productionCodeCount}`)
            for (const b of o.batches) ctx.out.log(`       batch ${b.id}: ${b.numberOfCodes} codes · ${b.active ? 'active' : 'inactive'} · redeem by ${b.expirationDate}`)
          }
        }
        ctx.out.emit(all)
      },
    },
    {
      name: 'new',
      summary: 'create a free offer, issue one-time codes, download the CSV',
      usage: 'offer new --name NAME [--product P] [--duration ONE_YEAR] [--periods 1] [--codes 500] [--expires YYYY-MM-DD] [--eligibility NEW,EXISTING] [--renew] [--out FILE]',
      booleans: ['renew'],
      run: async (ctx) => {
        const name = ctx.args.need('name')
        const r = await createOffer(ctx.client(), productId(ctx), {
          name,
          duration: ctx.args.str('duration'),
          periods: ctx.args.str('periods') ? ctx.args.num('periods', 1) : undefined,
          codes: ctx.args.str('codes') ? ctx.args.num('codes', 500) : undefined,
          expires: ctx.args.str('expires'),
          eligibility: ctx.args.str('eligibility')?.split(','),
          autoRenew: ctx.args.bool('renew'),
        })
        ctx.out.log(`offer ${r.offerId}: ${r.territories} territories, renews after ${r.autoRenewEnabled}`)
        ctx.out.log(`batch ${r.batchId}: ${r.codes} codes, redeem by ${r.expires}`)
        const csv = await downloadCodes(ctx.client(), r.batchId, ctx.args.str('out') ?? `offer-codes-${name}.csv`)
        ctx.out.log(`CSV → ${csv.file} (${csv.rows} rows: code, redemption URL)`)
        ctx.out.emit({ ...r, csv })
      },
    },
    {
      name: 'csv',
      summary: 're-download a batch as CSV',
      usage: 'offer csv --batch ID [--out FILE]',
      run: async (ctx) => {
        const batch = ctx.args.need('batch')
        const csv = await downloadCodes(ctx.client(), batch, ctx.args.str('out') ?? `offer-codes-${batch}.csv`)
        ctx.out.emit(csv)
        ctx.out.log(`CSV → ${csv.file} (${csv.rows} rows)`)
      },
    },
    {
      name: 'off',
      summary: 'deactivate an offer and all its batches (codes stop working immediately)',
      usage: 'offer off --offer ID',
      run: async (ctx) => {
        const r = await deactivateOffer(ctx.client(), ctx.args.need('offer'))
        ctx.out.emit(r)
        ctx.out.log(`deactivated ${ctx.args.str('offer')} and ${r.batches.length} batch(es)`)
      },
    },
  ],
  run: async () => {
    throw new UsageError('offer needs a subcommand', 'storeship offer <list|new|csv|off>')
  },
}
