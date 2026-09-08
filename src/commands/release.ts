/**
 * The whole release in one command. Each step is idempotent, so a run that
 * died half-way can simply be repeated.
 *
 * What it will not do: choose the version number (that is a judgement,
 * edit app.config / Info.plist and prebuild), verify the UI (screenshots,
 * device walkthroughs — a release tool that fails on a screenshot diff is a
 * release tool nobody dares to run), or cancel anything.
 */
import { attachLatestBuild, createVersion, requireVersion, submitVersion, writeWhatsNew } from '../asc/versions.ts'
import { type Command } from '../ctx.ts'
import { HOW, need } from '../config.ts'
import { StoreshipError } from '../errors.ts'
import { mb } from '../out.ts'
import { archive, exportArchive, uploadIpa } from '../ios/xcode.ts'
import { preflight } from './ship.ts'
import { whatsNewTexts } from './version.ts'

export const releaseCommand: Command = {
  name: 'release',
  summary: 'the whole thing: ship + version create + whatsnew + attach --wait + submit',
  usage: 'release <version> [--date YYYY-MM-DD] [--whatsnew DIR] [--archive PATH.xcarchive] [--build N] [--no-ship] [--no-submit] [--dry-run] [--yes] [--quiet] [--force] [--timeout MIN]',
  impact: 'write',
  needs: ['credentials', 'xcode'],
  humanDecisions: ['the version and build number (they live in app.config)', 'the release date', "the What's New text", 'whether to submit at all'],
  flags: {
    date: 'scheduled release day; without it the release is manual after approval',
    whatsnew: "directory with <locale>.txt What's New files; default <whatsNew.dir>/<version>, silently skipped when absent",
    archive: 'export + upload this existing .xcarchive instead of archiving again (resume here when export or upload failed)',
    build: 'build number to attach; default: the one just built, or with --no-ship the newest in the account',
    'no-ship': 'skip archive / export / upload (the build is already in App Store Connect)',
    'no-submit': 'stop after attaching the build',
    'dry-run': 'print the plan as data and stop; nothing is built, uploaded or written',
    yes: 'skip the confirmation (required when not in a terminal)',
    quiet: 'do not stream xcodebuild / altool output',
    force: 'build even when app.config and ios/ disagree on the version',
    timeout: 'minutes to wait for the build to become VALID; default 40',
  },
  booleans: ['no-ship', 'no-submit', 'dry-run', 'yes', 'quiet', 'force'],
  run: async (ctx) => {
    const version = ctx.args.at(0, 'version')
    const doShip = !ctx.args.bool('no-ship')
    const doSubmit = !ctx.args.bool('no-submit')
    const date = ctx.args.str('date')
    const archivePath = ctx.args.str('archive')
    const quiet = ctx.args.bool('quiet')
    const client = ctx.client()
    const appId = ctx.appId()

    // Everything that can fail offline fails before anything is touched.
    const pre = doShip ? await preflight(ctx) : undefined
    if (pre && pre.versions.native.version !== version)
      throw new StoreshipError(`ios/ is at ${pre.versions.native.version}, but you asked to release ${version}`, 'set the version in app.config (and ios.buildNumber), run `npx expo prebuild`, then retry', { code: 'PREFLIGHT' })
    let texts: Record<string, string> = {}
    try {
      if (ctx.args.str('whatsnew')) ctx.args.parsed.flags.set('dir', [ctx.args.str('whatsnew')!])
      texts = whatsNewTexts(ctx, version)
    } catch (e) {
      if (ctx.args.str('whatsnew')) throw e
      // no What's New given: fine, but say so
    }
    // The plan is data, not a paragraph on stderr: --dry-run hands the same list
    // to an agent that a human sees before answering "go?".
    const plan = [
      { step: 'ship', what: doShip ? (archivePath ? `export + upload ${archivePath}` : `archive + export + upload ${version} (${pre!.versions.native.build})`) : 'skipped (--no-ship)', skipped: !doShip },
      { step: 'version create', what: `${version}${date ? ` scheduled ${date}` : ' (manual release after approval)'}; no-op if it exists`, skipped: false },
      { step: "what's new", what: Object.keys(texts).length ? `write for ${Object.keys(texts).join(', ')}` : 'none given, skipped', skipped: !Object.keys(texts).length },
      { step: 'attach', what: `build ${ctx.args.str('build') ?? pre?.versions.native.build ?? '(newest)'} once it is VALID`, skipped: false },
      { step: 'submit', what: doSubmit ? 'submit for review' : 'skipped (--no-submit)', skipped: !doSubmit },
    ]
    if (ctx.dryRun()) {
      ctx.out.emit({ version, plan })
      ctx.out.changed(...plan.filter((p) => !p.skipped).map((p) => ({ kind: 'release-step', target: p.step, what: p.what })))
      ctx.out.log(`plan for ${version}:\n${plan.map((p, i) => `  ${i + 1}. ${p.step}: ${p.what}`).join('\n')}`)
      ctx.out.next({ command: `storeship release ${version}${date ? ` --date ${date}` : ''} --yes`, why: 'run the plan above once a human has agreed to it', impact: 'write' })
      return
    }
    ctx.out.note(`plan for ${version}:\n${plan.map((p, i) => `  ${i + 1}. ${p.step}: ${p.what}`).join('\n')}`)
    await ctx.confirm('go?', `this builds, uploads${doSubmit ? ' and submits for review' : ''} — the version number, the date and the text are already decided by the human`)

    const steps: Record<string, unknown> = {}
    if (doShip && pre) {
      const a = archivePath ? { archivePath, version, build: pre.versions.native.build ?? '0' } : await archive(pre.project, ctx.cfg, pre.versions, { quiet })
      const e = await exportArchive(pre.project, ctx.cfg, a.archivePath, { quiet })
      ctx.out.note(`   IPA ${mb(e.bytes)}; uploading`)
      await uploadIpa(e.ipa, need(ctx.cfg.asc.keyId, 'key id', HOW.keyId), need(ctx.cfg.asc.issuerId, 'issuer id', HOW.issuerId), { quiet })
      steps.ship = { archive: a.archivePath, ipa: e.ipa }
    }
    const created = await createVersion(client, appId, version, { date, scheduledTime: ctx.cfg.release.scheduledTime })
    ctx.out.note(`   version ${version}: ${created.created ? 'created' : `exists (${created.row.state})`}`)
    steps.version = created
    if (Object.keys(texts).length) {
      const v = await requireVersion(client, appId, version)
      steps.whatsNew = await writeWhatsNew(client, v.id, texts)
      ctx.out.note(`   What's New written`)
    }
    const want = ctx.args.str('build') ?? pre?.versions.native.build
    const att = await attachLatestBuild(client, appId, version, {
      build: want,
      wait: true,
      timeoutMs: ctx.args.num('timeout', 40) * 60_000,
      onWait: (b) => ctx.out.note(`   waiting for build ${want ?? '(newest)'}: ${b ? `${b.version} ${b.processingState}` : 'not visible yet'}`),
    })
    ctx.out.note(`   attached build ${att.build.version}`)
    steps.attach = att
    if (doSubmit) {
      steps.submit = await submitVersion(client, appId, version)
      ctx.out.note(`   submitted: ${(steps.submit as { state: string }).state}`)
    }
    ctx.out.emit(steps)
    ctx.out.changed(...plan.filter((p) => !p.skipped).map((p) => ({ kind: 'release-step', target: p.step, what: p.what })))
    ctx.out.next(
      doSubmit
        ? { command: `storeship version watch ${version}`, why: 'poll until the review decides: exit 0 approved, 3 rejected, 4 no verdict yet', impact: 'read' as const }
        : { command: `storeship version submit ${version}`, why: 'the build is attached; nothing is in review yet', impact: 'write' as const },
    )
    ctx.out.log(doSubmit ? `\n${version} is in the review queue.` : `\n${version} is ready.`)
  },
}
