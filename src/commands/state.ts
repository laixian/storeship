/**
 * `storeship state` — where the release is, and what to run next.
 *
 * An agent crashes, gets a new context window, or is resumed a day later, and
 * then has to answer "where am I" before it can do anything. Without this it
 * takes six commands and a guess; with it, one call and a `next` list. Every
 * other command in this tool is a step; this one is the loop condition.
 *
 * Deliberately: it never suggests an irreversible command, it says which
 * decisions are the human's rather than making them, and it reads — nothing
 * here writes.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ErrorCode } from '../codes.ts'
import { EXIT } from '../codes.ts'
import { diffListing, diffReview, readListingFile, type Review } from '../asc/listing.ts'
import { planCatalog, readAscCatalog, readCatalog } from '../asc/products.ts'
import {
  APPROVED_VERSION_STATES,
  attachedBuild,
  type BuildRow,
  listBuilds,
  listVersions,
  readWatchSnapshot,
  REJECTED_VERSION_STATES,
  type VersionRow,
} from '../asc/versions.ts'
import { type Command, type Ctx } from '../ctx.ts'
import { readVersions, resolveProject } from '../ios/xcode.ts'

export type Stage =
  | 'no-config'
  | 'not-configured'
  | 'no-version'
  | 'no-build'
  | 'build-processing'
  | 'build-ready'
  | 'build-attached'
  | 'submitted'
  | 'rejected'
  | 'approved'
  | 'live'

type Blocker = { code: ErrorCode; what: string; fix?: string; humanAction?: string }

const IN_REVIEW = new Set(['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_APPLE_RELEASE'])

/** The version this run is about: the one asked for, the one `ios/` holds, else the newest that is still editable. */
export function pickVersion(rows: VersionRow[], wanted?: string, local?: string): VersionRow | undefined {
  if (wanted) return rows.find((v) => v.version === wanted)
  if (local) {
    const m = rows.find((v) => v.version === local)
    if (m) return m
  }
  return rows.find((v) => !APPROVED_VERSION_STATES.has(v.state) && v.state !== 'REPLACED_WITH_NEW_VERSION') ?? rows[0]
}

export function stageOf(v: VersionRow | undefined, build: BuildRow | undefined, newest: BuildRow | undefined, want: string | undefined): Stage {
  if (!v) return 'no-version'
  if (v.state === 'READY_FOR_SALE') return 'live'
  if (REJECTED_VERSION_STATES.has(v.state)) return 'rejected'
  if (IN_REVIEW.has(v.state)) return 'submitted'
  if (APPROVED_VERSION_STATES.has(v.state)) return 'approved'
  if (build) return 'build-attached'
  // No build on the version yet: is there one to attach?
  const candidate = want ? (newest?.version === want ? newest : undefined) : newest
  if (!candidate) return 'no-build'
  return candidate.processingState === 'VALID' ? 'build-ready' : 'build-processing'
}

async function run(ctx: Ctx): Promise<void> {
  const cfg = ctx.cfg
  const out = ctx.out
  const wanted = ctx.args.positional[0]
  const blockers: Blocker[] = []

  if (!cfg.file) {
    out.emit({ stage: 'no-config' satisfies Stage, config: null, blockers: [{ code: 'CONFIG', what: 'no storeship.config.* found walking up from cwd', fix: 'storeship init' }] })
    out.next({ command: 'storeship init', why: 'nothing is configured yet', impact: 'write' })
    out.log('no-config — run `storeship init`')
    process.exitCode = EXIT.no
    return
  }
  if (!cfg.app.id) blockers.push({ code: 'CONFIG', what: 'no app id', fix: 'storeship init, or set ASC_APP_ID' })
  if (!cfg.asc.keyId || !cfg.asc.issuerId) blockers.push({ code: 'CONFIG', what: 'no API key id / issuer id', fix: 'set asc.keyId and asc.issuerId; `storeship doctor` checks the whole set' })
  if (cfg.asc.keyPath && !existsSync(cfg.asc.keyPath))
    blockers.push({ code: 'KEY_MISSING', what: `no .p8 at ${cfg.asc.keyPath}`, humanAction: 'Apple hands the .p8 out exactly once; if it is lost, revoke the key in App Store Connect → Users and Access → Integrations and create a new one.' })

  // What the project on disk says. `expo config` costs a few seconds; it is the
  // only way to catch "prebuild was forgotten", which is the failure this whole
  // command exists to catch early.
  let local: { version?: string; build?: string; bundleId?: string; problems: string[] } | null = null
  try {
    const p = resolveProject(cfg)
    const v = await readVersions(p)
    local = { version: v.native.version, build: v.native.build, bundleId: v.native.bundleId, problems: v.problems }
    for (const problem of v.problems) blockers.push({ code: 'PREFLIGHT', what: problem, fix: 'npx expo prebuild' })
  } catch {
    /* not an iOS project here, or no ios/ yet: the App Store Connect half still works */
  }

  const offline = ctx.args.bool('offline')
  if (offline || blockers.some((b) => b.code === 'CONFIG' || b.code === 'KEY_MISSING')) {
    const stage: Stage = blockers.length ? 'not-configured' : 'no-version'
    out.emit({ stage, config: { file: cfg.file, appId: cfg.app.id ?? null, locales: cfg.locales }, local, version: null, builds: [], clean: {}, blockers })
    if (blockers.length) out.next({ command: 'storeship doctor', why: 'every prerequisite with the fix for each miss', impact: 'read' })
    out.log(`${stage}${blockers.length ? `\n${blockers.map((b) => `  ✗ ${b.what}${b.fix ? ` → ${b.fix}` : ''}`).join('\n')}` : ''}`)
    if (blockers.length) process.exitCode = EXIT.no
    return
  }

  const client = ctx.client()
  const appId = ctx.appId()
  const versions = await listVersions(client, appId, 10)
  const version = pickVersion(versions, wanted, local?.version)
  const builds = await listBuilds(client, appId, 5)
  const attached = version ? await attachedBuild(client, version.id) : undefined
  const newest = local?.build ? (builds.find((b) => b.version === local.build) ?? builds[0]) : builds[0]
  const stage = stageOf(version, attached, local?.build ? builds.find((b) => b.version === local.build) : newest, local?.build)

  // Verdict detail is only interesting once something was submitted.
  let verdict: string | undefined
  if (version && (stage === 'submitted' || stage === 'rejected')) verdict = (await readWatchSnapshot(client, appId, version.version)).verdict

  const clean: Record<string, boolean | null> = { listing: null, review: null, whatsNew: null, products: null }
  const differing: string[] = []
  if (version && existsSync(cfg.listing.file)) {
    try {
      const parsed = readListingFile(cfg.listing.file)
      const d = await diffListing(client, appId, version.version, parsed.locales)
      const changed = d.diffs.filter((x) => !x.same)
      clean.listing = changed.length === 0
      if (changed.length) differing.push(`listing: ${changed.map((c) => `${c.locale}/${c.field}`).join(', ')}`)
      if (parsed.review) {
        const rv = await diffReview(client, version.id, parsed.review as Review)
        const rc = rv.diffs.filter((x) => !x.same)
        clean.review = rc.length === 0
        if (rc.length) differing.push(`review: ${rc.map((c) => c.field).join(', ')}`)
      }
    } catch {
      /* the listing file is unreadable or the version has no localizations yet: `listing check` says why */
    }
  }
  if (version) {
    const dir = join(cfg.whatsNew.dir, version.version)
    const missing = ctx.cfg.locales.filter((l) => !existsSync(join(dir, `${l}.txt`)))
    clean.whatsNew = ctx.cfg.locales.length ? missing.length === 0 : null
    if (missing.length) differing.push(`What's New missing for ${missing.join(', ')} in ${dir}`)
  }
  if (ctx.args.bool('deep') && existsSync(cfg.catalog.file)) {
    try {
      const cat = readCatalog(cfg.catalog.file)
      const plan = planCatalog(cat, await readAscCatalog(client, appId, cat))
      clean.products = plan.actions.length === 0
      if (plan.actions.length) differing.push(`products: ${plan.actions.length} change(s)`)
    } catch {
      /* products.md missing or unparseable; `products check` says why */
    }
  }

  out.emit({
    stage,
    config: { file: cfg.file, appId, locales: cfg.locales },
    local,
    version: version ? { ...version, build: attached ?? null, verdict: verdict ?? null } : null,
    builds: builds.slice(0, 3),
    clean,
    differing,
    blockers,
  })

  const v = version?.version ?? local?.version ?? '<version>'
  const steps: Parameters<typeof out.next>[0][] = []
  switch (stage) {
    case 'no-version':
      steps.push({ command: `storeship version create ${v}`, why: 'no version record in App Store Connect yet; add --date YYYY-MM-DD for a scheduled release — that date is the human\'s call', impact: 'write' })
      break
    case 'no-build':
      steps.push({ command: 'storeship ship', why: `no build ${local?.build ?? ''} in App Store Connect; archive, export and upload`.trim(), impact: 'write' })
      break
    case 'build-processing':
      steps.push({ command: `storeship version attach ${v} --build ${local?.build ?? newest?.version ?? ''} --wait`.trim(), why: 'the build is still processing; --wait polls until it is VALID', impact: 'write' })
      break
    case 'build-ready':
      steps.push({ command: `storeship version attach ${v}${local?.build ? ` --build ${local.build}` : ''}`, why: 'a VALID build is waiting to be attached', impact: 'write' })
      break
    case 'build-attached':
      if (clean.listing === false || clean.review === false) steps.push({ command: `storeship listing diff ${v}`, why: 'the listing file and App Store Connect differ; show the human the diff before pushing', impact: 'read' })
      if (clean.whatsNew === false) steps.push({ command: `storeship version whatsnew ${v} --dry-run`, why: "What's New is missing for some locales — the text is the human's to write or approve", impact: 'read' })
      if (clean.listing !== false && clean.review !== false && clean.whatsNew !== false) steps.push({ command: `storeship version submit ${v}`, why: 'the build is attached and nothing differs', impact: 'write' })
      break
    case 'submitted':
      steps.push({ command: `storeship version watch ${v}`, why: 'in review; exits 0 approved, 3 rejected, 4 no verdict yet', impact: 'read' })
      break
    case 'rejected':
      steps.push({ command: `storeship listing check`, why: "Apple's reason is only in Resolution Center — ask the human to paste it, then fix the metadata. A rejected version is editable: do not cancel it", impact: 'read' })
      break
    case 'approved':
    case 'live':
      break
  }
  if (blockers.length) steps.unshift({ command: 'storeship doctor', why: 'something in the environment is in the way', impact: 'read' })
  out.next(...steps)

  out.log(`stage: ${stage}${version ? `   ${version.version} ${version.state}${attached ? ` build ${attached.version}` : ''}` : ''}`)
  if (local) out.log(`local: ${local.version ?? '?'} (${local.build ?? '?'})`)
  for (const d of differing) out.log(`  · ${d}`)
  for (const b of blockers) out.log(`  ✗ ${b.what}${b.fix ? ` → ${b.fix}` : ''}${b.humanAction ? `\n      👤 ${b.humanAction}` : ''}`)
  if (blockers.length) process.exitCode = EXIT.no
}

export const stateCommand: Command = {
  name: 'state',
  summary: 'where the release is and what to run next, in one call (the command an agent runs first)',
  usage: 'state [<version>] [--deep] [--offline]',
  flags: {
    deep: 'also compare products.md with App Store Connect (many more requests)',
    offline: 'skip App Store Connect: only what the config and the project say',
  },
  booleans: ['deep', 'offline'],
  impact: 'read',
  needs: ['credentials'],
  run,
}
