import { DEMO_PASSWORD_ENV, diffListing, diffReview, FIELDS, len, LIMITS, overLimit, overLimitReview, pushListing, pushReview, readListingFile, REVIEW_FIELDS, REVIEW_LIMITS, type Review } from '../asc/listing.ts'
import { requireVersion } from '../asc/versions.ts'
import { type Command, type Ctx } from '../ctx.ts'
import { StoreshipError } from '../errors.ts'

function check(ctx: Ctx): void {
  const { locales: wanted, review } = readListingFile(ctx.cfg.listing.file)
  const report = Object.entries(wanted).map(([loc, l]) => ({
    locale: loc,
    fields: FIELDS.filter((f) => l[f] !== undefined).map((f) => ({ field: f, length: len(l[f]!), limit: LIMITS[f] })),
    over: overLimit(l),
  }))
  for (const r of report) {
    ctx.out.log(`${r.locale}`)
    for (const f of r.fields) ctx.out.log(`  ${f.length > f.limit ? '✗' : '✓'} ${f.field.padEnd(16)} ${String(f.length).padStart(4)}/${f.limit}`)
  }
  const reviewReport = review ? { fields: REVIEW_FIELDS.filter((f) => review[f] !== undefined).map((f) => ({ field: f, length: len(review[f]!), limit: REVIEW_LIMITS[f] })), over: overLimitReview(review) } : undefined
  if (review && reviewReport) {
    ctx.out.log('review')
    for (const f of reviewReport.fields) ctx.out.log(`  ${f.limit && f.length > f.limit ? '✗' : '✓'} ${f.field.padEnd(20)} ${f.limit ? `${String(f.length).padStart(4)}/${f.limit}` : ''}`)
  }
  ctx.out.emit({ locales: report, review: reviewReport })
  const bad = report.filter((r) => r.over.length)
  if (bad.length || reviewReport?.over.length) throw new StoreshipError(`over limit: ${[...bad.map((r) => `${r.locale} ${r.over.join(', ')}`), ...(reviewReport?.over.length ? [`review ${reviewReport.over.join(', ')}`] : [])].join('; ')}`)
}

async function diff(ctx: Ctx, write: boolean): Promise<void> {
  const version = ctx.args.at(0, 'version')
  const { locales: wanted, review } = readListingFile(ctx.cfg.listing.file)
  const r = await diffListing(ctx.client(), ctx.appId(), version, wanted)
  ctx.out.log(`appInfo ${r.appInfo.id} (${r.appInfo.state})${r.appInfo.ambiguous ? '  ⚠️ editable appInfo is not exactly one — check before writing' : ''}`)
  for (const d of r.diffs) ctx.out.log(`  ${d.same ? '=' : '→'} ${d.locale.padEnd(8)} ${d.field.padEnd(16)} ${String(len(d.wanted)).padStart(4)}/${LIMITS[d.field]}${d.same ? '' : `  (ASC has ${len(d.current)})`}`)
  for (const loc of r.skipped) ctx.out.log(`  skipped ${loc}: not localized in ASC (add the language in App Information first)`)
  const changed = r.diffs.filter((d) => !d.same)
  let rv: Awaited<ReturnType<typeof diffReview>> | undefined
  if (review) {
    const v = await requireVersion(ctx.client(), ctx.appId(), version)
    rv = await diffReview(ctx.client(), v.id, review as Review)
    ctx.out.log(`review ${rv.detailId ? `(detail ${rv.detailId})` : '(no record yet — push creates it)'}`)
    for (const d of rv.diffs) {
      const lim = d.field === 'notes' ? `${String(len(d.wanted)).padStart(4)}/${REVIEW_LIMITS.notes}` : ''
      const note = d.field === 'demoAccountPassword' ? `from ${DEMO_PASSWORD_ENV}, write-only: pushed every time` : d.same ? '' : `(ASC has ${d.field === 'notes' ? len(d.current) : JSON.stringify(d.current)})`
      ctx.out.log(`  ${d.same ? '=' : '→'} ${d.field.padEnd(20)} ${lim.padEnd(9)} ${note}`)
    }
  }
  const reviewChanged = rv?.diffs.filter((d) => !d.same) ?? []
  const total = changed.length + reviewChanged.length
  if (!write) {
    ctx.out.emit({ ...r, review: rv, wrote: [], wroteReview: [] })
    ctx.out.log(total ? `\n${total} field(s) differ. Nothing written; run \`storeship listing push ${version}\` to write them.` : '\nASC matches the listing file.')
    return
  }
  const wrote = await pushListing(ctx.client(), changed)
  for (const w of wrote) ctx.out.log(`  ✅ ${w.locale} ${w.fields.join('/')} written`)
  let wroteReview: string[] = []
  if (rv && review) {
    const v = await requireVersion(ctx.client(), ctx.appId(), version)
    wroteReview = await pushReview(ctx.client(), v.id, rv)
    if (wroteReview.length) ctx.out.log(`  ✅ review ${wroteReview.join('/')} written`)
  }
  ctx.out.emit({ ...r, review: rv, wrote, wroteReview })
  if (!wrote.length && !wroteReview.length) ctx.out.log('\nnothing to write')
}

export const listingCommand: Command = {
  name: 'listing',
  summary: 'store metadata and App Review information from a Markdown file: check limits, diff against ASC, push',
  sub: [
    { name: 'check', summary: 'parse the listing file and check character limits (offline)', run: async (ctx) => void check(ctx) },
    { name: 'diff', summary: 'compare the listing file with what ASC has for a version', usage: 'listing diff <version>', run: (ctx) => diff(ctx, false) },
    { name: 'push', summary: 'write differing fields to ASC (name/subtitle on appInfo, the rest and the review information on the version)', usage: 'listing push <version>', run: (ctx) => diff(ctx, true) },
  ],
  run: async (ctx) => void check(ctx),
}
