import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { type Command, type Ctx } from '../ctx.ts'
import { StoreshipError, UsageError } from '../errors.ts'
import { must } from '../proc.ts'
import { checkShots } from '../shots/check.ts'
import { loadShots, type ShotsSetup } from '../shots/load.ts'
import { dataUri, findChrome, pngSize, renderShot, sheet, shoot } from '../shots/render.ts'
import { uploadShots } from '../shots/upload.ts'
import type { Device } from '../shots/types.ts'

function selection(ctx: Ctx, s: ShotsSetup): { devices: Device[]; locales: string[]; only?: number[] } {
  const devices = (ctx.args.str('device')?.split(',') ?? s.deviceIds).map((id) => {
    const d = s.devices[id]
    if (!d) throw new UsageError(`unknown device "${id}"`, `known: ${Object.keys(s.devices).join(', ')}`)
    return d
  })
  const locales = ctx.args.str('locale')?.split(',') ?? s.locales
  const only = ctx.args.str('only')?.split(',').map(Number)
  return { devices, locales, only }
}

function runChecks(ctx: Ctx, s: ShotsSetup, devices: Device[], locales: string[]): Record<string, string[]> {
  const fs = { exists: existsSync, pngSize }
  const problems: Record<string, string[]> = {}
  for (const d of devices) {
    const bad = checkShots(s.content, d, locales, { template: s.template, srcFile: s.srcFile, fs, rel: (f) => f.replace(ctx.cfg.root + '/', '') })
    if (bad.length) problems[d.id] = bad
  }
  return problems
}

function report(ctx: Ctx, problems: Record<string, string[]>): void {
  for (const [id, bad] of Object.entries(problems)) {
    ctx.out.log(`\n${id}: ${bad.length} problem(s)`)
    for (const b of bad) ctx.out.log(`  · ${b}`)
  }
}

export const shotsCommand: Command = {
  name: 'shots',
  summary: 'App Store screenshots: validate, render from real screenshots + template, contact sheet, upload by device type',
  sub: [
    {
      name: 'check',
      summary: 'validate content, sources, crops for every device (all problems at once)',
      usage: 'shots check [--device a,b] [--locale x,y]',
      run: async (ctx) => {
        const s = await loadShots(ctx.cfg)
        const { devices, locales } = selection(ctx, s)
        const problems = runChecks(ctx, s, devices, locales)
        ctx.out.emit({ shots: s.content.shots.length, devices: devices.map((d) => d.id), locales, problems })
        report(ctx, problems)
        if (Object.keys(problems).length) throw new StoreshipError('shots check failed', 'fix every line above; nothing was rendered')
        ctx.out.log(`ok: ${s.content.shots.length} shots × ${devices.map((d) => d.id).join(', ')} × ${locales.join(', ')}`)
      },
    },
    {
      name: 'render',
      summary: 'render the set (checks first); --sheet also writes a contact sheet per device × locale',
      usage: 'shots render [--device a,b] [--locale x,y] [--only 1,2] [--sheet]',
      booleans: ['sheet'],
      run: async (ctx) => {
        const s = await loadShots(ctx.cfg)
        const { devices, locales, only } = selection(ctx, s)
        const problems = runChecks(ctx, s, devices, locales)
        if (Object.keys(problems).length) {
          report(ctx, problems)
          throw new StoreshipError('shots check failed', 'fix every line above; nothing was rendered')
        }
        const chrome = findChrome(ctx.cfg.chrome)
        mkdirSync(s.out, { recursive: true })
        const made: { device: string; locale: string; file: string }[] = []
        const sheets: string[] = []
        const total = s.content.shots.length
        for (const d of devices) {
          for (const locale of locales) {
            const files: string[] = []
            for (const shot of s.content.shots) {
              if (only && !only.includes(shot.n)) continue
              const out = s.outFile(d, locale, shot)
              const html = renderShot(s.template, shot, locale, d, total, (c) => {
                const file = s.srcFile(d, locale, c.src ?? `${shot.n}-${shot.slug}`)
                const nat = pngSize(file)
                return { uri: dataUri(file), w: nat.w, h: nat.h }
              })
              shoot(chrome, html, d.w, d.h, out, s.tmp)
              files.push(out)
              made.push({ device: d.id, locale, file: out })
              ctx.out.log(`  ${out.replace(ctx.cfg.root + '/', '')}`)
            }
            if (ctx.args.bool('sheet') && files.length) {
              const sf = join(s.tmp, `sheet-${d.id}-${s.tag(locale)}.png`)
              sheet(chrome, files, sf, s.tmp)
              sheets.push(sf)
              ctx.out.log(`  contact sheet → ${sf}`)
            }
          }
        }
        ctx.out.emit({ out: s.out, files: made, sheets })
        ctx.out.log(`\n→ ${s.out}${sheets.length ? '\nopen the contact sheet(s) and look at the row — that is the acceptance test' : ''}`)
      },
    },
    {
      name: 'upload',
      summary: 'push rendered screenshots into App Store Connect by display type (new files only unless --replace)',
      usage: 'shots upload <version> [--device a,b] [--locale x,y] [--replace] [--dry-run]',
      booleans: ['replace', 'dry-run'],
      run: async (ctx) => {
        const version = ctx.args.at(0, 'version')
        const s = await loadShots(ctx.cfg)
        const { devices, locales } = selection(ctx, s)
        const groups = []
        for (const locale of locales) {
          for (const d of devices) {
            const files = s.content.shots.map((shot) => s.outFile(d, locale, shot))
            const missing = files.filter((f) => !existsSync(f))
            if (missing.length) throw new StoreshipError(`not rendered yet: ${missing.map((f) => f.replace(ctx.cfg.root + '/', '')).join(', ')}`, 'run `storeship shots render` first')
            groups.push({ locale, displayType: d.displayType, files })
          }
        }
        const plans = await uploadShots(ctx.client(), ctx.appId(), version, groups, {
          replace: ctx.args.bool('replace'),
          dryRun: ctx.args.bool('dry-run'),
          onFile: (f) => ctx.out.note(`  ↑ ${f.replace(ctx.cfg.root + '/', '')}`),
        })
        ctx.out.emit(plans)
        for (const p of plans)
          ctx.out.log(`${p.locale} ${p.displayType} set=${p.setId}${p.created ? ' (created)' : ''}: ${p.files.length} ${ctx.args.bool('dry-run') ? 'to upload' : 'uploaded'}, ${p.skipped.length} already there${p.deleted ? `, ${p.deleted} deleted` : ''}`)
      },
    },
    {
      name: 'seed',
      summary: "run the project's demo-data script against the simulator (args passed through)",
      usage: 'shots seed [-- args…]',
      run: async (ctx) => {
        const script = ctx.cfg.shots.seed
        if (!script) throw new StoreshipError('shots.seed is not configured', 'point it at a script that plants demo data in the simulator sandbox')
        await must('node', [script, ...ctx.args.positional], 'seed')
        ctx.out.emit({ script, args: ctx.args.positional })
      },
    },
  ],
  run: async () => {
    throw new UsageError('shots needs a subcommand', 'storeship shots <check|render|upload|seed>')
  },
}
