import { diffListing, FIELDS, len, LIMITS, overLimit, pushListing, readListing } from '../asc/listing.ts'
import { type Command, type Ctx } from '../ctx.ts'
import { StoreshipError } from '../errors.ts'

function check(ctx: Ctx): Record<string, ReturnType<typeof readListing>[string]> {
  const wanted = readListing(ctx.cfg.listing.file)
  const report = Object.entries(wanted).map(([loc, l]) => ({
    locale: loc,
    fields: FIELDS.filter((f) => l[f] !== undefined).map((f) => ({ field: f, length: len(l[f]!), limit: LIMITS[f] })),
    over: overLimit(l),
  }))
  ctx.out.emit(report)
  for (const r of report) {
    ctx.out.log(`${r.locale}`)
    for (const f of r.fields) ctx.out.log(`  ${f.length > f.limit ? '✗' : '✓'} ${f.field.padEnd(16)} ${String(f.length).padStart(4)}/${f.limit}`)
  }
  const bad = report.filter((r) => r.over.length)
  if (bad.length) throw new StoreshipError(`over limit: ${bad.map((r) => `${r.locale} ${r.over.join(', ')}`).join('; ')}`)
  return wanted
}

async function diff(ctx: Ctx, write: boolean): Promise<void> {
  const version = ctx.args.at(0, 'version')
  const wanted = readListing(ctx.cfg.listing.file)
  const r = await diffListing(ctx.client(), ctx.appId(), version, wanted)
  ctx.out.log(`appInfo ${r.appInfo.id} (${r.appInfo.state})${r.appInfo.ambiguous ? '  ⚠️ editable appInfo is not exactly one — check before writing' : ''}`)
  for (const d of r.diffs) ctx.out.log(`  ${d.same ? '=' : '→'} ${d.locale.padEnd(8)} ${d.field.padEnd(16)} ${String(len(d.wanted)).padStart(4)}/${LIMITS[d.field]}${d.same ? '' : `  (ASC has ${len(d.current)})`}`)
  for (const loc of r.skipped) ctx.out.log(`  skipped ${loc}: not localized in ASC (add the language in App Information first)`)
  const changed = r.diffs.filter((d) => !d.same)
  if (!write) {
    ctx.out.emit({ ...r, wrote: [] })
    ctx.out.log(changed.length ? `\n${changed.length} field(s) differ. Nothing written; run \`storeship listing push ${version}\` to write them.` : '\nASC matches the listing file.')
    return
  }
  const wrote = await pushListing(ctx.client(), changed)
  ctx.out.emit({ ...r, wrote })
  for (const w of wrote) ctx.out.log(`  ✅ ${w.locale} ${w.fields.join('/')} written`)
  if (!wrote.length) ctx.out.log('\nnothing to write')
}

export const listingCommand: Command = {
  name: 'listing',
  summary: 'store metadata from a Markdown file: check limits, diff against ASC, push',
  sub: [
    { name: 'check', summary: 'parse the listing file and check character limits (offline)', run: async (ctx) => void check(ctx) },
    { name: 'diff', summary: 'compare the listing file with what ASC has for a version', usage: 'listing diff <version>', run: (ctx) => diff(ctx, false) },
    { name: 'push', summary: 'write differing fields to ASC (name/subtitle on appInfo, the rest on the version)', usage: 'listing push <version>', run: (ctx) => diff(ctx, true) },
  ],
  run: async (ctx) => void check(ctx),
}
