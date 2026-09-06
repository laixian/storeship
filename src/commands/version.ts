import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { attachLatestBuild, cancelSubmissions, createVersion, listBuilds, listVersions, requireVersion, submitVersion, writeWhatsNew } from '../asc/versions.ts'
import { type Command, type Ctx } from '../ctx.ts'
import { StoreshipError, UsageError } from '../errors.ts'
import { table } from '../out.ts'

export async function status(ctx: Ctx): Promise<void> {
  const rows = await listVersions(ctx.client(), ctx.appId())
  ctx.out.emit(rows)
  for (const l of table([['VERSION', 'STATE', 'RELEASE', 'EARLIEST', 'ID'], ...rows.slice(0, 6).map((r) => [r.version, r.state, r.releaseType ?? '-', r.earliestReleaseDate ?? '-', r.id])])) ctx.out.log(l)
}

/** Collect What's New texts: --file <locale>=<path> …, or --dir DIR holding <locale>.txt, or config whatsNew.dir/<version>/<locale>.txt. */
export function whatsNewTexts(ctx: Ctx, version: string): Record<string, string> {
  const texts: Record<string, string> = {}
  for (const pair of ctx.args.all('file')) {
    const eq = pair.indexOf('=')
    if (eq < 0) throw new UsageError(`--file expects <locale>=<path>, got "${pair}"`)
    texts[pair.slice(0, eq)] = readFileSync(pair.slice(eq + 1), 'utf8')
  }
  const dir = ctx.args.str('dir') ?? (Object.keys(texts).length ? undefined : join(ctx.cfg.whatsNew.dir, version))
  if (dir) {
    for (const loc of ctx.locales()) {
      const f = join(dir, `${loc}.txt`)
      if (existsSync(f)) texts[loc] = readFileSync(f, 'utf8')
    }
    if (!Object.keys(texts).length) throw new StoreshipError(`no What's New files found in ${dir}`, `expected ${ctx.locales().map((l) => `${l}.txt`).join(', ')} there, or pass --file <locale>=<path>`)
  }
  return texts
}

export const versionCommand: Command = {
  name: 'version',
  summary: 'App Store version records: status, create, whatsnew, attach, submit, cancel',
  sub: [
    { name: 'status', summary: 'list versions with state and release schedule', run: status },
    {
      name: 'create',
      summary: 'create a version record; with a date it becomes a scheduled release',
      usage: 'version create <version> [--date YYYY-MM-DD]',
      flags: { date: 'schedule the release for this day (at release.scheduledTime from the config); without it the release is manual after approval' },
      run: async (ctx) => {
        const version = ctx.args.at(0, 'version')
        const r = await createVersion(ctx.client(), ctx.appId(), version, { date: ctx.args.str('date'), scheduledTime: ctx.cfg.release.scheduledTime })
        ctx.out.emit(r)
        ctx.out.log(r.created ? `created ${version} → ${r.row.id}${r.row.earliestReleaseDate ? ` (scheduled ${r.row.earliestReleaseDate})` : ''}` : `already exists: ${version} ${r.row.id} ${r.row.state}`)
      },
    },
    {
      name: 'whatsnew',
      summary: "write What's New for every locale",
      usage: 'version whatsnew <version> [--dir DIR | --file <locale>=<path> …] [--dry-run]',
      flags: {
        dir: 'directory holding <locale>.txt per configured locale; default: <whatsNew.dir>/<version>',
        file: 'one locale from one file, repeatable: --file en-US=notes/en.txt',
        'dry-run': 'print what would be written and stop',
      },
      booleans: ['dry-run'],
      run: async (ctx) => {
        const version = ctx.args.at(0, 'version')
        const texts = whatsNewTexts(ctx, version)
        if (ctx.args.bool('dry-run')) {
          ctx.out.emit(texts)
          for (const [loc, t] of Object.entries(texts)) ctx.out.log(`${loc}: ${[...t.trimEnd()].length} chars\n${t.trimEnd().split('\n').map((l) => '  │ ' + l).join('\n')}`)
          return
        }
        const v = await requireVersion(ctx.client(), ctx.appId(), version)
        const res = await writeWhatsNew(ctx.client(), v.id, texts)
        ctx.out.emit(res)
        for (const r of res) ctx.out.log(r.written === null ? `${r.locale}: skipped (no text given)` : `${r.locale}: wrote ${r.written} chars`)
      },
    },
    {
      name: 'attach',
      summary: 'attach the newest build (must be VALID); --wait polls until it is',
      usage: 'version attach <version> [--wait] [--timeout MIN]',
      flags: { wait: 'poll every 30 s until the newest build is VALID instead of failing', timeout: 'minutes to keep waiting with --wait; default 30' },
      booleans: ['wait'],
      run: async (ctx) => {
        const version = ctx.args.at(0, 'version')
        const r = await attachLatestBuild(ctx.client(), ctx.appId(), version, {
          wait: ctx.args.bool('wait'),
          timeoutMs: ctx.args.num('timeout', 30) * 60_000,
          onWait: (b) => ctx.out.note(`waiting: latest build ${b ? `${b.version} is ${b.processingState}` : 'not visible yet'} …`),
        })
        ctx.out.emit(r)
        if (r.attached) ctx.out.log(`attached build ${r.build.version} (${r.build.id}) to ${version}`)
        else {
          ctx.out.log(`latest build ${r.build.version} is ${r.build.processingState}, not VALID yet — retry, or use --wait`)
          process.exitCode = 1
        }
      },
    },
    {
      name: 'submit',
      summary: 'submit the version for review',
      usage: 'version submit <version>',
      run: async (ctx) => {
        const version = ctx.args.at(0, 'version')
        const r = await submitVersion(ctx.client(), ctx.appId(), version)
        ctx.out.emit(r)
        ctx.out.log(`submitted ${version}: ${r.state} (submission ${r.submissionId}${r.reused ? ', reused' : ''})`)
      },
    },
    {
      name: 'cancel',
      summary: 'withdraw the open review submission (one-way: the queue position is lost)',
      usage: 'version cancel --yes',
      flags: { yes: 'required: cancelling is one-way and forfeits the review queue position' },
      booleans: ['yes'],
      run: async (ctx) => {
        if (!ctx.args.bool('yes'))
          throw new UsageError(
            'cancel needs --yes',
            'cancelling forfeits the review queue position, and whether a re-submit is accepted is only known at re-submit time (account-level checks run then). If you only need to edit promotional text, that field is editable without cancelling.',
          )
        const r = await cancelSubmissions(ctx.client(), ctx.appId())
        ctx.out.emit(r)
        if (!r.length) ctx.out.log('no open submission to cancel')
        for (const s of r) ctx.out.log(`cancelled ${s.id}: ${s.from} → ${s.to}`)
      },
    },
  ],
  run: status,
}

export const buildsCommand: Command = {
  name: 'builds',
  summary: 'recent builds and their processing state',
  run: async (ctx) => {
    const rows = await listBuilds(ctx.client(), ctx.appId(), 10)
    ctx.out.emit(rows)
    for (const l of table([['BUILD', 'STATE', 'UPLOADED', 'ID'], ...rows.map((b) => [b.version, b.processingState, b.uploadedDate, b.id])])) ctx.out.log(l)
  },
}
