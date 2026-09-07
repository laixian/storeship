import { createInterface } from 'node:readline/promises'
import { applyPlan, checkCatalog, deleteGroup, deleteSubscription, pickPricePoint, planCatalog, PRODUCT_LIMITS, readAscCatalog, readCatalog, subscriptionPricePoints } from '../asc/products.ts'
import { len } from '../asc/listing.ts'
import { type Command, type Ctx } from '../ctx.ts'
import { StoreshipError } from '../errors.ts'

async function confirm(ctx: Ctx, question: string): Promise<void> {
  if (ctx.args.bool('yes')) return
  if (!process.stdin.isTTY) throw new StoreshipError('not a terminal; pass --yes to run without confirmation')
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
  rl.close()
  if (a !== 'y' && a !== 'yes') throw new StoreshipError('aborted', undefined, 130)
}

function check(ctx: Ctx): ReturnType<typeof readCatalog> {
  const cat = readCatalog(ctx.cfg.catalog.file)
  const problems = checkCatalog(cat)
  const rows: { item: string; length: number; limit: number }[] = []
  for (const g of cat.groups) for (const [loc, l] of Object.entries(g.localizations)) rows.push({ item: `group ${g.reference} ${loc} name`, length: len(l.name), limit: PRODUCT_LIMITS.groupName })
  for (const s of cat.subscriptions) {
    for (const [loc, l] of Object.entries(s.localizations)) {
      if (l.name !== undefined) rows.push({ item: `${s.productId} ${loc} name`, length: len(l.name), limit: PRODUCT_LIMITS.name })
      if (l.description !== undefined) rows.push({ item: `${s.productId} ${loc} description`, length: len(l.description), limit: PRODUCT_LIMITS.description })
    }
    if (s.reviewNote !== undefined) rows.push({ item: `${s.productId} reviewNote`, length: len(s.reviewNote), limit: PRODUCT_LIMITS.reviewNote })
  }
  ctx.out.emit({ app: cat.app, groups: cat.groups.length, subscriptions: cat.subscriptions.map((s) => s.productId), rows, problems })
  for (const r of rows) ctx.out.log(`  ${r.length > r.limit ? '✗' : '✓'} ${r.item.padEnd(48)} ${String(r.length).padStart(4)}/${r.limit}`)
  for (const p of problems) ctx.out.log(`  ✗ ${p}`)
  if (problems.length) throw new StoreshipError(`${problems.length} problem(s) in ${ctx.cfg.catalog.file}`)
  ctx.out.log(`\n${cat.groups.length} group(s), ${cat.subscriptions.length} subscription(s)${cat.app ? ', app pricing' : ''} — ok`)
  return cat
}

async function status(ctx: Ctx): Promise<void> {
  const cat = (() => {
    try {
      return readCatalog(ctx.cfg.catalog.file)
    } catch {
      return undefined
    }
  })()
  const cur = await readAscCatalog(ctx.client(), ctx.appId(), cat)
  ctx.out.emit(cur)
  ctx.out.log(`app: ${cur.app.basePrice ? `${cur.app.basePrice.territory} ${cur.app.basePrice.amount}` : 'no price schedule'}; ${cur.app.territoryCount ?? '?'}/${cur.territoryTotal} territories`)
  for (const g of cur.groups) {
    ctx.out.log(`group ${g.reference} (${g.id})  ${g.localizations.map((l) => `${l.locale}=${JSON.stringify(l.name)}`).join('  ')}`)
    for (const s of cur.subscriptions.filter((s) => s.groupId === g.id)) {
      ctx.out.log(`  ${s.productId.padEnd(44)} ${s.period.padEnd(12)} L${s.level}  ${s.state.padEnd(22)} ${s.basePrice ? `${s.basePrice.territory} ${s.basePrice.amount}` : ''}  ${s.territoryCount ?? '?'} terr  shot:${s.screenshot ? s.screenshot.state.toLowerCase() : 'none'}`)
      for (const l of s.localizations) ctx.out.log(`      ${l.locale.padEnd(8)} ${JSON.stringify(l.name)} — ${JSON.stringify(l.description ?? '')}`)
    }
  }
}

async function diff(ctx: Ctx, write: boolean): Promise<void> {
  const cat = check(ctx)
  const cur = await readAscCatalog(ctx.client(), ctx.appId(), cat)
  const plan = planCatalog(cat, cur)
  for (const s of plan.same) ctx.out.log(`  = ${s}`)
  for (const a of plan.actions) ctx.out.log(`  → ${a.target}: ${a.what}${a.detail ? `  (${a.detail})` : ''}`)
  for (const w of plan.warnings) ctx.out.log(`  ⚠️ ${w}`)
  if (!write) {
    ctx.out.emit({ same: plan.same, actions: plan.actions.map((a) => ({ target: a.target, what: a.what, detail: a.detail })), warnings: plan.warnings, wrote: [] })
    ctx.out.log(plan.actions.length ? `\n${plan.actions.length} change(s). Nothing written; run \`storeship products push\` to apply them.` : '\nASC matches the products file.')
    return
  }
  if (!plan.actions.length) {
    ctx.out.emit({ same: plan.same, actions: [], warnings: plan.warnings, wrote: [] })
    ctx.out.log('\nnothing to write')
    return
  }
  await confirm(ctx, `apply ${plan.actions.length} change(s)?`)
  const wrote: string[] = []
  await applyPlan(ctx.client(), ctx.appId(), plan, (a) => {
    ctx.out.note(`  ✅ ${a.target}: ${a.what}`)
    wrote.push(`${a.target}: ${a.what}`)
  })
  ctx.out.emit({ same: plan.same, actions: plan.actions.map((a) => ({ target: a.target, what: a.what, detail: a.detail })), warnings: plan.warnings, wrote })
  ctx.out.log(`\n${wrote.length} change(s) written. A new subscription is submitted together with the next app version (\`storeship version submit\`).`)
}

export const productsCommand: Command = {
  name: 'products',
  summary: 'subscription groups, subscriptions, prices, availability and app price from products.md: check, diff against ASC, push',
  sub: [
    { name: 'check', summary: 'parse the products file and check limits and references (offline)', run: async (ctx) => void check(ctx) },
    { name: 'status', summary: 'what App Store Connect has: groups, subscriptions, state, base price, territories, review screenshot', run: status },
    { name: 'diff', summary: 'compare the products file with App Store Connect and print every change it would make; writes nothing', run: (ctx) => diff(ctx, false) },
    {
      name: 'push',
      summary: 'apply the diff: create groups / subscriptions / localizations, set prices (base territory equalized everywhere), availability, review screenshot',
      usage: 'products push [--yes]',
      flags: { yes: 'skip the confirmation (required when not in a terminal)' },
      booleans: ['yes'],
      run: (ctx) => diff(ctx, true),
    },
    {
      name: 'pricepoints',
      summary: "price tiers Apple offers for a subscription in a territory (they are discrete; look before writing a price)",
      usage: 'products pricepoints <productId> <TERRITORY> [--near AMOUNT]',
      flags: { near: 'show only tiers around this amount' },
      run: async (ctx) => {
        const productId = ctx.args.at(0, 'productId')
        const territory = ctx.args.at(1, 'TERRITORY').toUpperCase()
        const cur = await readAscCatalog(ctx.client(), ctx.appId())
        const sub = cur.subscriptions.find((s) => s.productId === productId)
        if (!sub) throw new StoreshipError(`no subscription ${productId} in App Store Connect`, 'create it first: add it to products.md and `storeship products push`')
        // Sort before windowing: ASC does not promise an order, and "the tiers around
        // this amount" is meaningless on an arbitrary one.
        let points = (await subscriptionPricePoints(ctx.client(), sub.id, territory)).sort((a, b) => Number(a.amount) - Number(b.amount))
        const near = ctx.args.str('near')
        // Pick from the full list, then window around it, so the marked tier is the one
        // `products push` would actually choose.
        const picked = near ? pickPricePoint(points, near) : undefined
        if (near) {
          const i = picked ? points.findIndex((p) => p.id === picked.id) : 0
          points = points.slice(Math.max(0, i - 5), i + 6)
        }
        ctx.out.emit({ territory, near, picked, points })
        for (const p of points) ctx.out.log(`  ${p.territory} ${p.amount}${picked?.id === p.id ? '   ← picked for ' + near : ''}`)
      },
    },
    {
      name: 'delete',
      summary: 'delete a subscription that was never submitted (the only kind ASC lets you delete); an emptied group goes too',
      usage: 'products delete <productId> --yes [--with-group]',
      flags: { yes: 'required: deleting is permanent', 'with-group': 'also delete the subscription group if this was its last subscription' },
      booleans: ['yes', 'with-group'],
      run: async (ctx) => {
        const productId = ctx.args.at(0, 'productId')
        if (!ctx.args.bool('yes')) throw new StoreshipError('refusing without --yes', `this deletes ${productId} from App Store Connect for good (only possible while it was never submitted)`)
        const cur = await readAscCatalog(ctx.client(), ctx.appId())
        const sub = cur.subscriptions.find((s) => s.productId === productId)
        if (!sub) throw new StoreshipError(`no subscription ${productId} in App Store Connect`)
        await deleteSubscription(ctx.client(), sub.id)
        ctx.out.log(`deleted subscription ${productId} (${sub.id})`)
        const left = cur.subscriptions.filter((s) => s.groupId === sub.groupId && s.id !== sub.id)
        const groupName = cur.groups.find((g) => g.id === sub.groupId)?.reference
        // The group is a second irreversible deletion that --yes never named, so it is
        // opt-in. An empty group costs nothing to leave behind.
        let groupDeleted = false
        if (!left.length && ctx.args.bool('with-group')) {
          await deleteGroup(ctx.client(), sub.groupId)
          groupDeleted = true
          ctx.out.log(`deleted its group ${groupName} (${sub.groupId}), now empty`)
        } else if (!left.length) ctx.out.log(`its group ${groupName} (${sub.groupId}) is now empty; pass --with-group to delete that too`)
        ctx.out.emit({ deleted: productId, subscriptionId: sub.id, groupDeleted })
      },
    },
  ],
  run: async (ctx) => void check(ctx),
}
