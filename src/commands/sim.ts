import { type Command, type Ctx } from '../ctx.ts'
import { UsageError } from '../errors.ts'
import { DEVICES, mergeDevices } from '../shots/devices.ts'
import { loadShots } from '../shots/load.ts'
import { Sim } from '../sim/sim.ts'

async function sim(ctx: Ctx): Promise<Sim> {
  let devices = DEVICES
  try {
    devices = (await loadShots(ctx.cfg)).devices
  } catch {
    devices = mergeDevices()
  }
  const id = ctx.args.str('profile') ?? ctx.cfg.sim.profile
  const d = id ? devices[id] : undefined
  if (id && !d) throw new UsageError(`unknown device profile "${id}"`, `known: ${Object.keys(devices).join(', ')}`)
  const profile = d?.sim ?? { name: undefined as unknown as string, pt: [0, 0] as [number, number], px: 1 }
  if (id && !d?.sim) throw new UsageError(`device "${id}" has no simulator profile`)
  return new Sim({ idb: ctx.cfg.sim.idb, udid: ctx.args.str('udid'), profile })
}

const n = (ctx: Ctx, i: number, what: string): number => {
  const v = Number(ctx.args.at(i, what))
  if (!Number.isFinite(v)) throw new UsageError(`<${what}> must be a number`)
  return v
}

export const simCommand: Command = {
  name: 'sim',
  summary: 'drive the booted simulator: tap / drag / screenshot / status bar / accessibility tree (idb first, CGEvent fallback)',
  usage: 'sim <which|tap|ltap|drag|shot|statusbar|ls|find|text> … [--profile iphone69] [--udid U]',
  sub: [
    { name: 'which', summary: 'input channel and target simulator', run: async (ctx) => { const s = await sim(ctx); ctx.out.emit({ channel: s.channel(), udid: s.udid, profile: s.profile }); ctx.out.log(`${s.channel()}\n${s.profile.name ?? '(any booted)'} ${s.udid}`) } },
    { name: 'tap', summary: 'tap at device logical points (portrait)', usage: 'sim tap <x> <y>', run: async (ctx) => { const s = await sim(ctx); s.tap(n(ctx, 0, 'x'), n(ctx, 1, 'y')); ctx.out.emit({ tapped: [n(ctx, 0, 'x'), n(ctx, 1, 'y')] }) } },
    { name: 'ltap', summary: 'tap at pixel coordinates measured on the rotated (landscape) screenshot', usage: 'sim ltap <x> <y>', run: async (ctx) => { const s = await sim(ctx); s.ltap(n(ctx, 0, 'x'), n(ctx, 1, 'y')); ctx.out.emit({ ltapped: [n(ctx, 0, 'x'), n(ctx, 1, 'y')] }) } },
    { name: 'drag', summary: 'drag between two device points', usage: 'sim drag <x1> <y1> <x2> <y2>', run: async (ctx) => { const s = await sim(ctx); s.drag(n(ctx, 0, 'x1'), n(ctx, 1, 'y1'), n(ctx, 2, 'x2'), n(ctx, 3, 'y2')); ctx.out.emit({ dragged: true }) } },
    { name: 'shot', summary: 'screenshot; give 270 for a landscape page', usage: 'sim shot <out.png> [rotate]', run: async (ctx) => { const s = await sim(ctx); const out = ctx.args.at(0, 'out.png'); const rot = ctx.args.positional[1] ? Number(ctx.args.positional[1]) : undefined; s.shot(out, rot); ctx.out.emit({ file: out, rotate: rot ?? null }); ctx.out.log(out) } },
    { name: 'statusbar', summary: 'override the status bar to 9:41 / full battery / full signal', usage: 'sim statusbar [--time 9:41]', run: async (ctx) => { const s = await sim(ctx); s.statusBar(ctx.args.str('time')); ctx.out.emit({ statusBar: 'overridden' }); ctx.out.log('status bar overridden') } },
    { name: 'ls', summary: 'accessibility elements (needs idb); optional substring filter', usage: 'sim ls [pattern]', run: async (ctx) => { const s = await sim(ctx); const pat = (ctx.args.positional[0] ?? '').toLowerCase(); const rows = s.tree().filter((e) => (e.AXLabel ?? '').toLowerCase().includes(pat)).map((e) => ({ type: e.type, label: e.AXLabel ?? '', x: e.frame.x, y: e.frame.y, w: e.frame.width, h: e.frame.height })); ctx.out.emit(rows); for (const r of rows) ctx.out.log(`${String(r.type).padEnd(14)} ${String(r.label).slice(0, 44).padEnd(46)} @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`) } },
    { name: 'find', summary: 'tap the nth element whose label contains the text (needs idb)', usage: 'sim find <label> [nth]', run: async (ctx) => { const s = await sim(ctx); const r = s.tapLabel(ctx.args.at(0, 'label'), ctx.args.positional[1] ? Number(ctx.args.positional[1]) : 0); ctx.out.emit(r); ctx.out.log(`tapped "${r.label}" app@${r.app.map(Math.round).join(',')} dev@${r.dev.map(Math.round).join(',')}`) } },
    { name: 'text', summary: 'type text into the focused field (needs idb)', usage: 'sim text <string>', run: async (ctx) => { const s = await sim(ctx); s.text(ctx.args.at(0, 'text')); ctx.out.emit({ typed: ctx.args.positional[0] }) } },
  ],
  run: async () => {
    throw new UsageError('sim needs a subcommand', 'storeship sim <which|tap|ltap|drag|shot|statusbar|ls|find|text>')
  },
}
