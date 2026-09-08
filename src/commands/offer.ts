import { createOffer, deactivateOffer, downloadCodes, listOffers } from '../asc/offers.ts'
import { type Command, type Ctx } from '../ctx.ts'
import { StoreshipError, UsageError } from '../errors.ts'

function productId(ctx: Ctx): string {
  const p = ctx.args.str('product')
  const ids = ctx.cfg.products
  if (p) return ids[p] ?? p
  const first = Object.values(ids)[0]
  if (!first) throw new StoreshipError('no subscription product given', 'pass --product <alias|subscriptionId>, or set products in storeship.config.json', { code: 'CONFIG' })
  return first
}

export const offerCommand: Command = {
  name: 'offer',
  summary: 'subscription offer codes (no UI for these in App Store Connect)',
  impact: 'read',
  needs: ['credentials'],
  sub: [
    {
      name: 'list',
      summary: 'offers and code batches per configured product',
      usage: 'offer list [--product ALIAS|ID]',
      flags: { product: 'one product only (alias from config or a subscription id); default: every configured product' },
      impact: 'read',
      needs: ['credentials'],
      run: async (ctx) => {
        const products = ctx.args.str('product') ? { [ctx.args.str('product')!]: productId(ctx) } : ctx.cfg.products
        if (!Object.keys(products).length) throw new StoreshipError('no products configured', 'set products in storeship.config.json or pass --product <subscriptionId>', { code: 'CONFIG' })
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
      usage: 'offer new --name NAME [--product P] [--duration ONE_YEAR] [--periods 1] [--codes 500] [--expires YYYY-MM-DD] [--eligibility NEW,EXISTING] [--renew] [--out FILE] [--dry-run]',
      flags: {
        name: 'offer name; must be unique per product',
        product: 'alias from config or a subscription id; default: the first configured product',
        duration: 'free period unit: THREE_DAYS, ONE_WEEK, TWO_WEEKS, ONE_MONTH, TWO_MONTHS, THREE_MONTHS, SIX_MONTHS, ONE_YEAR; default ONE_YEAR',
        periods: 'how many of those units; default 1',
        codes: 'number of one-time codes to issue; default 500',
        expires: 'last day the codes can be redeemed (YYYY-MM-DD, at most ~6 months out); default today + 175 days',
        eligibility: 'comma list of NEW, EXISTING, EXPIRED; default NEW',
        renew: 'let the subscription auto-renew at full price when the free period ends (Apple\'s default; this tool defaults to off and it cannot be changed afterwards)',
        out: 'CSV path; default offer-codes-<name>.csv',
        'dry-run': 'print the offer that would be created and stop',
      },
      booleans: ['renew', 'dry-run'],
      impact: 'write',
      needs: ['credentials'],
      humanDecisions: ['how many codes, how long the free period is, and who is eligible'],
      run: async (ctx) => {
        const name = ctx.args.need('name')
        if (ctx.dryRun()) {
          const offer = {
            product: productId(ctx),
            name,
            duration: ctx.args.str('duration') ?? 'ONE_YEAR',
            periods: ctx.args.str('periods') ?? '1',
            codes: ctx.args.str('codes') ?? '500',
            expires: ctx.args.str('expires') ?? '(today + 175 days)',
            eligibility: ctx.args.str('eligibility') ?? 'NEW',
            autoRenew: ctx.args.bool('renew'),
          }
          ctx.out.emit(offer)
          ctx.out.changed({ kind: 'offer', target: name, what: 'create', detail: `${offer.codes} codes on ${offer.product}` })
          ctx.out.log(`would create offer ${name} on ${offer.product}: ${offer.periods}×${offer.duration} free, ${offer.codes} codes, eligible ${offer.eligibility}, auto-renew ${offer.autoRenew}`)
          return
        }
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
        ctx.out.changed({ kind: 'offer', target: name, what: 'created', detail: `${r.codes} codes, batch ${r.batchId}` }, { kind: 'file', target: csv.file, what: 'written', detail: `${csv.rows} rows` })
      },
    },
    {
      name: 'csv',
      summary: 're-download a batch as CSV',
      usage: 'offer csv --batch ID [--out FILE]',
      flags: { batch: 'batch id from `offer list`', out: 'CSV path; default offer-codes-<batch>.csv' },
      impact: 'write',
      needs: ['credentials'],
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
      usage: 'offer off --offer ID --yes',
      flags: { offer: 'offer id from `offer list`; all its batches are deactivated too and existing codes stop working', yes: 'required: every code already handed out stops working immediately' },
      booleans: ['yes'],
      impact: 'irreversible',
      needs: ['credentials'],
      confirm: 'every code already handed out stops working the moment this runs, and the offer cannot be reactivated — a replacement has to be created and the codes redistributed',
      run: async (ctx) => {
        const r = await deactivateOffer(ctx.client(), ctx.args.need('offer'))
        ctx.out.emit(r)
        ctx.out.changed({ kind: 'offer', target: ctx.args.need('offer'), what: 'deactivated', detail: `${r.batches.length} batch(es)` })
        ctx.out.log(`deactivated ${ctx.args.str('offer')} and ${r.batches.length} batch(es)`)
      },
    },
  ],
  run: async () => {
    throw new UsageError('offer needs a subcommand', 'storeship offer <list|new|csv|off>')
  },
}
