import { type Command, type Ctx } from '../ctx.ts'
import { HOW, need } from '../config.ts'
import { StoreshipError } from '../errors.ts'
import { mb } from '../out.ts'
import { archive, exportArchive, readVersions, resolveProject, uploadIpa, type Versions } from '../ios/xcode.ts'

export async function preflight(ctx: Ctx): Promise<{ project: ReturnType<typeof resolveProject>; versions: Versions }> {
  const project = resolveProject(ctx.cfg)
  const versions = await readVersions(project)
  if (versions.problems.length && !ctx.args.bool('force'))
    throw new StoreshipError(`preflight:\n  ${versions.problems.join('\n  ')}`, 'fix the above, or pass --force to build what is in ios/ anyway', { code: 'PREFLIGHT' })
  if (ctx.cfg.app.bundleId && versions.native.bundleId && ctx.cfg.app.bundleId !== versions.native.bundleId)
    throw new StoreshipError(`bundle id mismatch: config says ${ctx.cfg.app.bundleId}, ios/ says ${versions.native.bundleId}`, undefined, { code: 'PREFLIGHT' })
  return { project, versions }
}

export const shipCommand: Command = {
  name: 'ship',
  summary: 'archive → export IPA → upload to App Store Connect (the version number is yours to set beforehand)',
  usage: 'ship [--skip-upload] [--force] [--quiet]',
  impact: 'write',
  needs: ['xcode', 'credentials'],
  humanDecisions: ['the version and build number: they live in app.config, and `npx expo prebuild` has to have run'],
  flags: {
    'skip-upload': 'archive and export only; print the IPA path for `upload`',
    force: 'build even when app.config and ios/ disagree on the version (i.e. prebuild was not run)',
    quiet: 'do not stream xcodebuild / altool output',
  },
  booleans: ['skip-upload', 'force', 'quiet'],
  run: async (ctx) => {
    const quiet = ctx.args.bool('quiet')
    const { project, versions } = await preflight(ctx)
    const v = versions.native
    ctx.out.note(`→ archiving ${project.scheme} ${v.version} (${v.build}) [${project.configuration}]`)
    const a = await archive(project, ctx.cfg, versions, { quiet })
    ctx.out.note(`→ exporting IPA (no API key here on purpose; see storeship --help ship)`)
    const e = await exportArchive(project, ctx.cfg, a.archivePath, { quiet })
    ctx.out.note(`   ${e.ipa} (${mb(e.bytes)})`)
    let uploaded = false
    if (!ctx.args.bool('skip-upload')) {
      ctx.out.note('→ uploading (this step needs the API key)')
      await uploadIpa(e.ipa, need(ctx.cfg.asc.keyId, 'key id', HOW.keyId), need(ctx.cfg.asc.issuerId, 'issuer id', HOW.issuerId), { quiet })
      uploaded = true
    }
    ctx.out.emit({ version: a.version, build: a.build, archive: a.archivePath, ipa: e.ipa, bytes: e.bytes, uploaded })
    ctx.out.changed(
      { kind: 'archive', target: a.archivePath, what: 'built' },
      { kind: 'ipa', target: e.ipa, what: 'exported', detail: mb(e.bytes) },
      ...(uploaded ? [{ kind: 'build', target: `${a.version} (${a.build})`, what: 'uploaded' }] : []),
    )
    ctx.out.next(
      uploaded
        ? { command: `storeship release ${a.version} --no-ship`, why: 'the build is uploaded; this creates the version, writes What\'s New, waits for processing, attaches and submits', impact: 'write' as const }
        : { command: `storeship upload ${e.ipa}`, why: 'the IPA is ready but not uploaded (--skip-upload)', impact: 'write' as const },
      { command: 'storeship state', why: 'what is done and what is left', impact: 'read' as const },
    )
    ctx.out.log(uploaded ? `\nuploaded ${a.version} (${a.build}). Processing takes minutes.` : `\nIPA ready at ${e.ipa}.`)
  },
}

/**
 * The resume path. Archiving is the slow step (minutes) and export is the one
 * that fails for reasons outside the project (no Apple ID visible to xcodebuild,
 * a sandboxed shell, an expired certificate). When it does, the archive is
 * fine — export it, do not rebuild it.
 */
export const exportCommand: Command = {
  name: 'export',
  summary: 'export an existing .xcarchive to an IPA (resume here when export failed after a good archive)',
  usage: 'export <path.xcarchive> [--quiet]',
  flags: { quiet: 'do not stream xcodebuild output' },
  booleans: ['quiet'],
  impact: 'write',
  needs: ['xcode'],
  run: async (ctx) => {
    const archivePath = ctx.args.at(0, 'path.xcarchive')
    const project = resolveProject(ctx.cfg)
    const e = await exportArchive(project, ctx.cfg, archivePath, { quiet: ctx.args.bool('quiet') })
    ctx.out.emit({ archive: archivePath, ipa: e.ipa, bytes: e.bytes })
    ctx.out.changed({ kind: 'ipa', target: e.ipa, what: 'exported', detail: mb(e.bytes) })
    ctx.out.next({ command: `storeship upload ${e.ipa}`, why: 'the archive is exported; this uploads it (the only step that needs the API key)', impact: 'write' })
    ctx.out.log(`IPA ready at ${e.ipa} (${mb(e.bytes)}).`)
  },
}

export const uploadCommand: Command = {
  name: 'upload',
  summary: 'upload an already exported IPA with altool',
  usage: 'upload <file.ipa> [--quiet]',
  flags: { quiet: 'do not stream altool output' },
  booleans: ['quiet'],
  impact: 'write',
  needs: ['xcode', 'credentials'],
  run: async (ctx) => {
    const ipa = ctx.args.at(0, 'file.ipa')
    await uploadIpa(ipa, need(ctx.cfg.asc.keyId, 'key id', HOW.keyId), need(ctx.cfg.asc.issuerId, 'issuer id', HOW.issuerId), { quiet: ctx.args.bool('quiet') })
    ctx.out.emit({ ipa, uploaded: true })
    ctx.out.changed({ kind: 'build', target: ipa, what: 'uploaded' })
    ctx.out.next({ command: 'storeship state', why: 'processing takes minutes; state says when the build is attachable', impact: 'read' })
    ctx.out.log(`uploaded ${ipa}`)
  },
}
