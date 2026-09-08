import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { attachLatestBuild, cancelSubmissions, createVersion, findVersion, listBuilds, listVersions, openSubmissions, requireVersion, submitVersion, watchVersion, writeWhatsNew } from '../asc/versions.ts'
import { EXIT } from '../codes.ts'
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
    if (!Object.keys(texts).length) throw new StoreshipError(`no What's New files found in ${dir}`, `expected ${ctx.locales().map((l) => `${l}.txt`).join(', ')} there, or pass --file <locale>=<path>`, { code: 'NOT_FOUND' })
  }
  return texts
}

export const versionCommand: Command = {
  name: 'version',
  summary: 'App Store version records: status, create, whatsnew, attach, submit, cancel',
  impact: 'read',
  needs: ['credentials'],
  sub: [
    { name: 'status', summary: 'list versions with state and release schedule', impact: 'read', needs: ['credentials'], run: status },
    {
      name: 'create',
      summary: 'create a version record; with a date it becomes a scheduled release',
      usage: 'version create <version> [--date YYYY-MM-DD] [--dry-run]',
      flags: {
        date: 'schedule the release for this day (at release.scheduledTime from the config); without it the release is manual after approval',
        'dry-run': 'say what would be created and stop',
      },
      booleans: ['dry-run'],
      impact: 'write',
      needs: ['credentials'],
      humanDecisions: ['the version number', 'the release date'],
      run: async (ctx) => {
        const version = ctx.args.at(0, 'version')
        const date = ctx.args.str('date')
        if (ctx.dryRun()) {
          const existing = await findVersion(ctx.client(), ctx.appId(), version)
          ctx.out.emit({ version, exists: !!existing, row: existing ?? null, date: date ?? null })
          if (!existing) ctx.out.changed({ kind: 'version', target: version, what: 'create', detail: date ? `scheduled ${date}` : 'manual release after approval' })
          ctx.out.log(existing ? `already exists: ${version} ${existing.id} ${existing.state}` : `would create ${version}${date ? ` scheduled ${date}` : ''}`)
          return
        }
        const r = await createVersion(ctx.client(), ctx.appId(), version, { date, scheduledTime: ctx.cfg.release.scheduledTime })
        ctx.out.emit(r)
        if (r.created) ctx.out.changed({ kind: 'version', target: version, what: 'created', detail: r.row.earliestReleaseDate ?? undefined })
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
      impact: 'write',
      needs: ['credentials'],
      humanDecisions: ["the What's New text itself"],
      run: async (ctx) => {
        const version = ctx.args.at(0, 'version')
        const texts = whatsNewTexts(ctx, version)
        if (ctx.dryRun()) {
          ctx.out.changed(...Object.entries(texts).map(([locale, t]) => ({ kind: "what's new", target: locale, what: 'write', detail: `${[...t.trimEnd()].length} chars` })))
          ctx.out.emit(texts)
          for (const [loc, t] of Object.entries(texts)) ctx.out.log(`${loc}: ${[...t.trimEnd()].length} chars\n${t.trimEnd().split('\n').map((l) => '  │ ' + l).join('\n')}`)
          return
        }
        const v = await requireVersion(ctx.client(), ctx.appId(), version)
        const res = await writeWhatsNew(ctx.client(), v.id, texts)
        ctx.out.emit(res)
        ctx.out.changed(...res.filter((r) => r.written !== null).map((r) => ({ kind: "what's new", target: r.locale, what: 'written', detail: `${r.written} chars` })))
        for (const r of res) ctx.out.log(r.written === null ? `${r.locale}: skipped (no text given)` : `${r.locale}: wrote ${r.written} chars`)
      },
    },
    {
      name: 'attach',
      summary: 'attach a build (must be VALID); --wait polls until it is',
      usage: 'version attach <version> [--build N] [--wait] [--timeout MIN]',
      flags: { build: 'build number (CFBundleVersion) to attach; default: the newest build in the account', wait: 'poll every 30 s until the build is VALID (or, with --build, until it appears and is VALID) instead of failing', timeout: 'minutes to keep waiting with --wait; default 30' },
      booleans: ['wait'],
      impact: 'write',
      needs: ['credentials'],
      run: async (ctx) => {
        const version = ctx.args.at(0, 'version')
        const want = ctx.args.str('build')
        const r = await attachLatestBuild(ctx.client(), ctx.appId(), version, {
          build: want,
          wait: ctx.args.bool('wait'),
          timeoutMs: ctx.args.num('timeout', 30) * 60_000,
          onWait: (b) => ctx.out.note(`waiting: build ${want ?? '(newest)'} ${b ? `${b.version} is ${b.processingState}` : 'not visible yet'} …`),
        })
        ctx.out.emit(r)
        if (r.attached) {
          ctx.out.changed({ kind: 'build', target: version, what: 'attached', detail: r.build.version })
          ctx.out.next({ command: `storeship version submit ${version}`, why: 'the build is attached; check the listing diff first', impact: 'write' })
          ctx.out.log(`attached build ${r.build.version} (${r.build.id}) to ${version}`)
        } else {
          // Not a failure: the build exists and is not ready yet. Exit 4 says "ask again".
          ctx.out.log(`build ${r.build.version} is ${r.build.processingState}, not VALID yet — retry, or use --wait`)
          ctx.out.next({ command: `storeship version attach ${version} --build ${r.build.version} --wait`, why: 'processing takes minutes; --wait polls instead of failing', impact: 'write' })
          process.exitCode = EXIT.pending
        }
      },
    },
    {
      name: 'watch',
      summary: 'poll until the review reaches a verdict; exit 0 approved, 3 rejected, 4 no decision yet',
      usage: 'version watch <version> [--interval MIN] [--timeout MIN] [--once]',
      flags: { interval: 'minutes between polls; default 10, floor 2 (a review state does not change faster than that)', timeout: 'minutes to keep watching; default 1440 (24 h)', once: 'check once and exit instead of polling' },
      booleans: ['once'],
      impact: 'read',
      needs: ['credentials'],
      run: async (ctx) => {
        const version = ctx.args.at(0, 'version')
        // Floor the interval here rather than in the library: three requests a poll at
        // two minutes is still only ~90 an hour against Apple's 3600, and nothing about
        // a review moves faster than that.
        const interval = Math.max(2, ctx.args.num('interval', 10))
        const snap = await watchVersion(ctx.client(), ctx.appId(), version, {
          intervalMs: interval * 60_000,
          timeoutMs: ctx.args.num('timeout', 1440) * 60_000,
          once: ctx.args.bool('once'),
          onPoll: (s, changed) => ctx.out.note(`${s.versionState}${s.submissionState ? ` / submission ${s.submissionState}` : ''}${changed ? '  ← changed' : ''}`),
          onRetry: (status, attempt) => ctx.out.note(`   ${status === 429 ? 'throttled' : `server error ${status}`}; backing off (${attempt}/5)`),
        })
        ctx.out.emit(snap)
        const rejectedItems = snap.items.filter((i) => i.state === 'REJECTED')
        if (snap.verdict === 'rejected') {
          ctx.out.log(`${version} was rejected (${snap.versionState}${snap.submissionState ? `, submission ${snap.submissionState}` : ''}).`)
          if (rejectedItems.length) ctx.out.log(`  rejected item(s): ${rejectedItems.map((i) => i.version ?? i.id).join(', ')}`)
          ctx.out.log("Apple's reason is only in Resolution Center, which is not in the API — read it there (or in the email) and paste it in before changing anything.")
          ctx.out.next({ command: `storeship listing diff ${version}`, why: 'a rejected version is editable: fix the metadata Apple named and submit again — do not cancel, and do not rebuild unless the app itself must change', impact: 'read' })
          process.exitCode = EXIT.no
        } else if (snap.verdict === 'approved') {
          ctx.out.log(`${version} is ${snap.versionState}.`)
        } else {
          ctx.out.log(`${version} is still ${snap.versionState}; no verdict yet.`)
          ctx.out.next({ command: `storeship version watch ${version}`, why: 'no verdict yet; run it again later or leave it polling', impact: 'read' })
          process.exitCode = EXIT.pending
        }
      },
    },
    {
      name: 'submit',
      summary: 'submit the version for review',
      usage: 'version submit <version> [--dry-run]',
      flags: { 'dry-run': 'report what would be submitted and stop' },
      booleans: ['dry-run'],
      impact: 'write',
      needs: ['credentials'],
      humanDecisions: ['whether the version is ready to go to review'],
      run: async (ctx) => {
        const version = ctx.args.at(0, 'version')
        if (ctx.dryRun()) {
          const v = await requireVersion(ctx.client(), ctx.appId(), version)
          const open = await openSubmissions(ctx.client(), ctx.appId())
          ctx.out.emit({ version: v, openSubmissions: open.length })
          ctx.out.changed({ kind: 'submission', target: version, what: 'submit for review', detail: open.length ? 'joins the open submission' : 'creates a submission' })
          ctx.out.log(`would submit ${version} (${v.state})${open.length ? `; an open submission already exists` : ''}`)
          return
        }
        const r = await submitVersion(ctx.client(), ctx.appId(), version)
        ctx.out.emit(r)
        ctx.out.changed({ kind: 'submission', target: version, what: 'submitted', detail: r.state })
        ctx.out.next({ command: `storeship version watch ${version}`, why: 'poll until the review decides: exit 0 approved, 3 rejected, 4 no verdict yet', impact: 'read' })
        ctx.out.log(`submitted ${version}: ${r.state} (submission ${r.submissionId}${r.reused ? ', reused' : ''})`)
      },
    },
    {
      name: 'cancel',
      summary: 'withdraw the open review submission (one-way: the queue position is lost)',
      usage: 'version cancel --yes',
      flags: { yes: 'required: cancelling is one-way and forfeits the review queue position' },
      booleans: ['yes'],
      impact: 'irreversible',
      needs: ['credentials'],
      confirm:
        'cancelling forfeits the review queue position, and whether a re-submit is accepted is only known at re-submit time (account-level checks run then). A version Apple already rejected is editable without cancelling, and promotional text is editable while in review.',
      humanDecisions: ['whether to give up the queue position'],
      run: async (ctx) => {
        const r = await cancelSubmissions(ctx.client(), ctx.appId())
        ctx.out.emit(r)
        ctx.out.changed(...r.map((x) => ({ kind: 'submission', target: x.id, what: 'cancelled', detail: `${x.from} → ${x.to}` })))
        if (!r.length) ctx.out.log('no open submission to cancel')
        for (const x of r) ctx.out.log(`cancelled ${x.id}: ${x.from} → ${x.to}`)
      },
    },
  ],
  run: status,
}

export const buildsCommand: Command = {
  name: 'builds',
  summary: 'recent builds and their processing state',
  impact: 'read',
  needs: ['credentials'],
  run: async (ctx) => {
    const rows = await listBuilds(ctx.client(), ctx.appId(), 10)
    ctx.out.emit(rows)
    for (const l of table([['BUILD', 'STATE', 'UPLOADED', 'ID'], ...rows.map((b) => [b.version, b.processingState, b.uploadedDate, b.id])])) ctx.out.log(l)
  },
}
