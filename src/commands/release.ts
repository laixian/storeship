/**
 * The whole release in one command. Each step is idempotent, so a run that
 * died half-way can simply be repeated.
 *
 * What it will not do: choose the version number (that is a judgement,
 * edit app.config / Info.plist and prebuild), verify the UI (screenshots,
 * device walkthroughs — a release tool that fails on a screenshot diff is a
 * release tool nobody dares to run), or cancel anything.
 */
import { createInterface } from 'node:readline/promises'
import { attachLatestBuild, createVersion, requireVersion, submitVersion, writeWhatsNew } from '../asc/versions.ts'
import { type Command, type Ctx } from '../ctx.ts'
import { HOW, need } from '../config.ts'
import { StoreshipError } from '../errors.ts'
import { mb } from '../out.ts'
import { archive, exportArchive, uploadIpa } from '../ios/xcode.ts'
import { preflight } from './ship.ts'
import { whatsNewTexts } from './version.ts'

async function confirm(ctx: Ctx, question: string): Promise<void> {
  if (ctx.args.bool('yes')) return
  if (!process.stdin.isTTY) throw new StoreshipError('not a terminal; pass --yes to run without confirmation')
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
  rl.close()
  if (a !== 'y' && a !== 'yes') throw new StoreshipError('aborted', undefined, 130)
}

export const releaseCommand: Command = {
  name: 'release',
  summary: 'the whole thing: ship + version create + whatsnew + attach --wait + submit',
  usage: 'release <version> [--date YYYY-MM-DD] [--whatsnew DIR] [--no-ship] [--no-submit] [--yes] [--quiet]',
  booleans: ['no-ship', 'no-submit', 'yes', 'quiet', 'force'],
  run: async (ctx) => {
    const version = ctx.args.at(0, 'version')
    const doShip = !ctx.args.bool('no-ship')
    const doSubmit = !ctx.args.bool('no-submit')
    const date = ctx.args.str('date')
    const quiet = ctx.args.bool('quiet')
    const client = ctx.client()
    const appId = ctx.appId()

    // Everything that can fail offline fails before anything is touched.
    const pre = doShip ? await preflight(ctx) : undefined
    if (pre && pre.versions.native.version !== version)
      throw new StoreshipError(`ios/ is at ${pre.versions.native.version}, but you asked to release ${version}`, 'set the version in app.config (and ios.buildNumber), run `npx expo prebuild`, then retry')
    let texts: Record<string, string> = {}
    try {
      if (ctx.args.str('whatsnew')) ctx.args.parsed.flags.set('dir', [ctx.args.str('whatsnew')!])
      texts = whatsNewTexts(ctx, version)
    } catch (e) {
      if (ctx.args.str('whatsnew')) throw e
      // no What's New given: fine, but say so
    }
    const plan = [
      doShip ? `archive + export + upload ${version} (${pre!.versions.native.build})` : 'skip build/upload (--no-ship)',
      `version create ${version}${date ? ` scheduled ${date}` : ''} (no-op if it exists)`,
      Object.keys(texts).length ? `What's New for ${Object.keys(texts).join(', ')}` : "no What's New (none given)",
      'attach the newest VALID build (waiting for processing)',
      doSubmit ? 'submit for review' : 'stop before submitting (--no-submit)',
    ]
    ctx.out.note(`plan for ${version}:\n${plan.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`)
    await confirm(ctx, 'go?')

    const steps: Record<string, unknown> = {}
    if (doShip && pre) {
      const a = await archive(pre.project, ctx.cfg, pre.versions, { quiet })
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
    const att = await attachLatestBuild(client, appId, version, {
      wait: true,
      timeoutMs: ctx.args.num('timeout', 40) * 60_000,
      onWait: (b) => ctx.out.note(`   waiting for build: ${b ? `${b.version} ${b.processingState}` : 'not visible yet'}`),
    })
    ctx.out.note(`   attached build ${att.build.version}`)
    steps.attach = att
    if (doSubmit) {
      steps.submit = await submitVersion(client, appId, version)
      ctx.out.note(`   submitted: ${(steps.submit as { state: string }).state}`)
    }
    ctx.out.emit(steps)
    ctx.out.log(doSubmit ? `\n${version} is in the review queue.` : `\n${version} is ready; submit with \`storeship version submit ${version}\`.`)
  },
}
