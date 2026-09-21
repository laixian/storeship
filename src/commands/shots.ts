import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { type Command, type Ctx } from '../ctx.ts'
import { CheckFailed, StoreshipError, UsageError } from '../errors.ts'
import { must } from '../proc.ts'
import { checkShots } from '../shots/check.ts'
import { loadShots, type ShotsSetup } from '../shots/load.ts'
import { findChrome, pngSize, sheet } from '../shots/render.ts'
import { renderSet } from '../shots/run.ts'
import { STYLES } from '../shots/styles/index.ts'
import { uploadShots } from '../shots/upload.ts'
import type { Device } from '../shots/types.ts'

/** What `shots styles` prints; the rules themselves live in shots/layout.ts and shots/check.ts. */
const LAYOUT_RULES = [
  'one phone size for the whole set; a landscape screen is the same phone turned, running off one side (anchor start|end)',
  'only a hero tilts (≤ 8°); a hero is one phone across two slots, the seam at seamAt (0.3–0.7) of its width',
  'one phone per frame; two is the exception, and two-phone frames are never neighbours',
  'every other phone starts on the same baseline, on the same axis',
  'anything owned by a frame is clipped to it; only the hero and the style backdrop cross seams',
]

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
    const bad = checkShots(s.content, s.style, d, locales, { srcFile: s.srcFile, fs, rel: (f) => f.replace(ctx.cfg.root + '/', '') })
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
  summary: 'App Store screenshots: validate, render real screenshots in a style, contact sheet, upload by device type',
  impact: 'read',
  sub: [
    {
      name: 'check',
      summary: 'validate frames, titles, sources and the layout rules for every device (all problems at once)',
      usage: 'shots check [--device a,b] [--locale x,y]',
      flags: { device: 'comma list of device ids; default: shots.devices (or iphone69)', locale: 'comma list of locales; default: the configured ones' },
      impact: 'read',
      run: async (ctx) => {
        const s = await loadShots(ctx.cfg)
        const { devices, locales } = selection(ctx, s)
        const problems = runChecks(ctx, s, devices, locales)
        ctx.out.emit({ style: s.style.id, frames: s.content.frames.length, slots: s.slots.length, devices: devices.map((d) => d.id), locales, problems })
        report(ctx, problems)
        if (Object.keys(problems).length) throw new CheckFailed('shots check failed', 'fix every line above; nothing was rendered')
        ctx.out.log(`ok: ${s.slots.length} screenshots (${s.style.id}) × ${devices.map((d) => d.id).join(', ')} × ${locales.join(', ')}`)
      },
    },
    {
      name: 'render',
      summary: 'render the set (checks first); --sheet also writes contact sheets per device × locale',
      usage: 'shots render [--device a,b] [--locale x,y] [--only 1,2] [--sheet]',
      flags: { device: 'comma list of device ids', locale: 'comma list of locales', only: 'comma list of store positions to re-render (a hero is two)', sheet: 'also write two contact sheets per device × locale into the temp dir: store spacing, and seamless for checking the seams' },
      booleans: ['sheet'],
      impact: 'write',
      needs: ['chrome'],
      run: async (ctx) => {
        const s = await loadShots(ctx.cfg)
        const { devices, locales, only } = selection(ctx, s)
        const problems = runChecks(ctx, s, devices, locales)
        if (Object.keys(problems).length) {
          report(ctx, problems)
          throw new CheckFailed('shots check failed', 'fix every line above; nothing was rendered')
        }
        const chrome = findChrome(ctx.cfg.chrome)
        mkdirSync(s.out, { recursive: true })
        const made: { device: string; locale: string; file: string }[] = []
        const sheets: string[] = []
        for (const d of devices) {
          for (const locale of locales) {
            const files = renderSet(s, d, locale, chrome, only, (f) => {
              made.push({ device: d.id, locale, file: f })
              ctx.out.log(`  ${f.replace(ctx.cfg.root + '/', '')}`)
            })
            if (ctx.args.bool('sheet') && files.length) {
              for (const seamless of [false, true]) {
                const sf = join(s.tmp, `sheet-${d.id}-${s.tag(locale)}${seamless ? '-seamless' : ''}.png`)
                sheet(chrome, files, sf, s.tmp, { seamless })
                sheets.push(sf)
                ctx.out.log(`  contact sheet → ${sf}`)
              }
            }
          }
        }
        ctx.out.emit({ out: s.out, files: made, sheets })
        ctx.out.changed(...made.map((m) => ({ kind: 'screenshot', target: `${m.device}/${m.locale}`, what: 'rendered', detail: m.file })))
        ctx.out.log(`\n→ ${s.out}${sheets.length ? '\nopen the contact sheet(s) and look at the row — that is the acceptance test' : ''}`)
      },
    },
    {
      name: 'upload',
      summary: 'push rendered screenshots into App Store Connect by display type (new files only unless --replace)',
      usage: 'shots upload <version> [--device a,b] [--locale x,y] [--replace] [--dry-run]',
      flags: { device: 'comma list of device ids', locale: 'comma list of locales', replace: 'delete every screenshot in the set first', 'dry-run': 'show what would be uploaded, touch nothing' },
      booleans: ['replace', 'dry-run'],
      impact: 'write',
      needs: ['credentials'],
      run: async (ctx) => {
        const version = ctx.args.at(0, 'version')
        const s = await loadShots(ctx.cfg)
        const { devices, locales } = selection(ctx, s)
        const groups = []
        for (const locale of locales) {
          for (const d of devices) {
            const files = s.slots.map((slot) => s.outFile(d, locale, slot))
            const missing = files.filter((f) => !existsSync(f))
            if (missing.length) throw new StoreshipError(`not rendered yet: ${missing.map((f) => f.replace(ctx.cfg.root + '/', '')).join(', ')}`, 'run `storeship shots render` first', { code: 'CHECK_FAILED' })
            groups.push({ locale, displayType: d.displayType, files })
          }
        }
        const dry = ctx.dryRun()
        const plans = await uploadShots(ctx.client(), ctx.appId(), version, groups, {
          replace: ctx.args.bool('replace'),
          dryRun: dry,
          onFile: (f) => ctx.out.note(`  ↑ ${f.replace(ctx.cfg.root + '/', '')}`),
        })
        ctx.out.emit(plans)
        ctx.out.changed(...plans.flatMap((p) => p.files.map((f) => ({ kind: 'screenshot', target: `${p.locale}/${p.displayType}`, what: dry ? 'would upload' : 'uploaded', detail: f }))))
        for (const p of plans)
          ctx.out.log(`${p.locale} ${p.displayType} set=${p.setId}${p.created ? ' (created)' : ''}: ${p.files.length} ${dry ? 'to upload' : 'uploaded'}, ${p.skipped.length} already there${p.deleted ? `, ${p.deleted} deleted` : ''}`)
      },
    },
    {
      name: 'styles',
      summary: 'list the built-in styles, their theme tokens, and the layout rules every style follows',
      usage: 'shots styles',
      flags: {},
      impact: 'read',
      run: async (ctx) => {
        const styles = Object.values(STYLES).map((st) => ({
          id: st.id,
          summary: st.summary,
          look: st.look,
          needsBg: !!st.needsBg,
          tokens: Object.fromEntries(Object.entries(st.tokens).map(([k, t]) => [k, { type: t.type, default: t.default, doc: t.doc }])),
        }))
        ctx.out.emit({ styles, rules: LAYOUT_RULES })
        for (const st of styles) {
          ctx.out.log(`${st.id} — ${st.summary}`)
          for (const [k, t] of Object.entries(st.tokens)) ctx.out.log(`    theme.${k} (${t.type}, default ${t.default}): ${t.doc}`)
        }
        ctx.out.log(`\nlayout rules (every style):\n${LAYOUT_RULES.map((r) => `  · ${r}`).join('\n')}`)
      },
    },
    {
      name: 'seed',
      summary: "run the project's demo-data script against the simulator (args passed through)",
      usage: 'shots seed [-- args…]',
      flags: {},
      impact: 'write',
      needs: ['simulator'],
      run: async (ctx) => {
        const script = ctx.cfg.shots.seed
        if (!script) throw new StoreshipError('shots.seed is not configured', 'point it at a script that plants demo data in the simulator sandbox', { code: 'CONFIG' })
        await must('node', [script, ...ctx.args.positional], 'seed')
        ctx.out.emit({ script, args: ctx.args.positional })
      },
    },
  ],
  run: async () => {
    throw new UsageError('shots needs a subcommand', 'storeship shots <check|render|upload|styles|seed>')
  },
}
