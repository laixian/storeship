/**
 * The iOS build side: resolve the project, read versions from both ends
 * (Expo config vs generated Info.plist), archive, export, upload.
 *
 * ⚠️ Export never receives -authenticationKey*. With those flags xcodebuild
 * switches to cloud signing, which an App Manager key cannot do, and the
 * error it prints is `No signing certificate "iOS Distribution" found` — a
 * sentence that sends you to the keychain when nothing is wrong there.
 * Archiving only needs a development certificate; with
 * -allowProvisioningUpdates Xcode requests the distribution certificate at
 * export time. Rule: export without the key, upload with the key.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { type Config, HOW, need } from '../config.ts'
import { StoreshipError } from '../errors.ts'
import { capture, must, run } from '../proc.ts'

export type Project = {
  projectDir: string
  expo: boolean
  workspace: string
  scheme: string
  infoPlist: string
  configuration: string
}

export function resolveProject(cfg: Config): Project {
  const projectDir = cfg.ios.projectDir
  const expo = cfg.ios.expo ?? ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.json'].some((f) => existsSync(join(projectDir, f)))
  const iosDir = join(projectDir, 'ios')
  let workspace = cfg.ios.workspace
  if (!workspace) {
    const found = existsSync(iosDir) ? readdirSync(iosDir).filter((f) => f.endsWith('.xcworkspace')) : []
    if (!found.length)
      throw new StoreshipError(`no .xcworkspace under ${iosDir}`, expo ? 'run `npx expo prebuild` first (the ios/ directory is generated), or set ios.workspace' : 'set ios.workspace in storeship.config.json', { code: 'PREFLIGHT' })
    workspace = join(iosDir, found[0]!)
  }
  const scheme = cfg.ios.scheme ?? basename(workspace, '.xcworkspace')
  const infoPlist = cfg.ios.infoPlist ?? join(iosDir, scheme, 'Info.plist')
  return { projectDir, expo, workspace, scheme, infoPlist, configuration: cfg.ios.configuration }
}

export function plistGet(plist: string, key: string): string | undefined {
  return capture('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist])
}

/**
 * Info.plist values are often build-setting references — `$(PRODUCT_BUNDLE_IDENTIFIER)`,
 * `$(MARKETING_VERSION)`, `$(CURRENT_PROJECT_VERSION)` — that Xcode substitutes at build
 * time from project.pbxproj. Resolve one against the build configuration(s) whose
 * INFOPLIST_FILE is this plist; prefer `configuration` (Debug and Release may differ,
 * e.g. a `.dev` bundle id), else accept a value all of them agree on. `undefined` when
 * it cannot be resolved, so the caller compares nothing rather than a placeholder.
 * (2026-09-07: the first real `release` refused with
 * "bundle id mismatch: config says com.overdrive.odmobile, ios/ says $(PRODUCT_BUNDLE_IDENTIFIER)".)
 */
export function resolveBuildSetting(value: string | undefined, pbxproj: string, infoPlistRel: string, configuration?: string): string | undefined {
  if (value === undefined) return undefined
  const ref = /^\$[({]([A-Za-z_][A-Za-z0-9_]*)[)}]$/.exec(value)
  if (!ref) return value
  const name = ref[1]!
  const norm = (s: string) => s.replace(/^"|"$/g, '').replace(/^\.\//, '')
  const setting = (body: string, key: string): string | undefined => {
    const m = new RegExp(`^\\s*${key} = ("([^"]*)"|([^;]*));`, 'm').exec(body)
    return m ? (m[2] ?? m[3] ?? '').trim() : undefined
  }
  const byConfig = new Map<string, string>()
  for (const m of pbxproj.matchAll(/buildSettings = \{([\s\S]*?)\n\s*\};\s*name = "?([^";]+)"?;/g)) {
    const body = m[1]!
    const plist = setting(body, 'INFOPLIST_FILE')
    if (plist === undefined || norm(plist) !== norm(infoPlistRel)) continue
    const v = setting(body, name)
    if (v !== undefined) byConfig.set(m[2]!, v)
  }
  if (configuration && byConfig.has(configuration)) return byConfig.get(configuration)
  const distinct = new Set(byConfig.values())
  return distinct.size === 1 ? [...distinct][0] : undefined
}

/**
 * Apple IDs signed into Xcode, from its preferences. `xcodebuild -exportArchive
 * -allowProvisioningUpdates` needs one to fetch the distribution certificate; with
 * none it fails with "No Accounts" (and a misleading "No signing certificate" next
 * to it). The list lives under DVTDeveloperAccountManagerAppleIDLists as a dict of
 * lists — one keyed by identifier objects, one by plain strings — so count every
 * entry of every list. Sessions expire and an Xcode update can drop them, which is
 * why `doctor` checks this before a seven-minute archive does.
 */
export function parseXcodeAccounts(json: string | undefined): string[] {
  if (!json) return []
  try {
    const lists = JSON.parse(json) as Record<string, unknown>
    const out: string[] = []
    for (const v of Object.values(lists)) {
      if (!Array.isArray(v)) continue
      for (const e of v) {
        if (typeof e === 'string') out.push(e)
        else if (e && typeof e === 'object' && typeof (e as { identifier?: unknown }).identifier === 'string') out.push((e as { identifier: string }).identifier)
      }
    }
    return [...new Set(out)]
  } catch {
    return []
  }
}

export function xcodeAccounts(): string[] {
  const plist = join(process.env.HOME ?? '', 'Library/Preferences/com.apple.dt.Xcode.plist')
  return parseXcodeAccounts(capture('plutil', ['-extract', 'DVTDeveloperAccountManagerAppleIDLists', 'json', '-o', '-', plist]))
}

/** project.pbxproj next to the workspace, if there is exactly one .xcodeproj. */
function pbxprojFor(p: Project): { text: string; infoPlistRel: string } | undefined {
  const iosDir = dirname(p.workspace)
  const projs = existsSync(iosDir) ? readdirSync(iosDir).filter((f) => f.endsWith('.xcodeproj')) : []
  const candidates = projs.map((f) => join(iosDir, f, 'project.pbxproj')).filter(existsSync)
  if (candidates.length !== 1) return undefined
  return { text: readFileSync(candidates[0]!, 'utf8'), infoPlistRel: relative(iosDir, p.infoPlist) }
}

export type ExpoConfig = { name?: string; version?: string; ios?: { bundleIdentifier?: string; buildNumber?: string; appleTeamId?: string } }

/** `expo config --type public --json`, tolerant of noise before the JSON. */
export async function expoConfig(projectDir: string): Promise<ExpoConfig> {
  const r = await run('npx', ['expo', 'config', '--type', 'public', '--json'], { cwd: projectDir, quiet: true })
  const i = r.output.indexOf('{')
  if (r.code !== 0 || i < 0) throw new StoreshipError(`expo config failed in ${projectDir}\n${r.output.slice(-600)}`, undefined, { code: 'PREFLIGHT' })
  try {
    return JSON.parse(r.output.slice(i)) as ExpoConfig
  } catch {
    throw new StoreshipError('could not parse `expo config --json` output', 'run it by hand in the project directory to see what it prints', { code: 'PREFLIGHT' })
  }
}

export type Versions = {
  native: { version?: string; build?: string; bundleId?: string }
  expo?: { version?: string; build?: string; bundleId?: string; teamId?: string; name?: string }
  problems: string[]
}

/** Read the version from the generated Info.plist and, for Expo projects, from app.config; report disagreement. */
export async function readVersions(p: Project): Promise<Versions> {
  const problems: string[] = []
  if (!existsSync(p.infoPlist)) problems.push(`Info.plist not found at ${p.infoPlist}${p.expo ? ' — run `npx expo prebuild`' : ''}`)
  const pbx = pbxprojFor(p)
  const read = (key: string) => {
    const raw = plistGet(p.infoPlist, key)
    return pbx ? resolveBuildSetting(raw, pbx.text, pbx.infoPlistRel, p.configuration) : raw
  }
  const native = {
    version: read('CFBundleShortVersionString'),
    build: read('CFBundleVersion'),
    bundleId: read('CFBundleIdentifier'),
  }
  let expo: Versions['expo']
  if (p.expo) {
    const c = await expoConfig(p.projectDir)
    expo = { version: c.version, build: c.ios?.buildNumber, bundleId: c.ios?.bundleIdentifier, teamId: c.ios?.appleTeamId, name: c.name }
    if (native.version && expo.version && native.version !== expo.version)
      problems.push(`version differs: app.config says ${expo.version}, ios/ says ${native.version} — run \`npx expo prebuild\``)
    if (native.build && expo.build && native.build !== expo.build)
      problems.push(`build number differs: app.config says ${expo.build}, ios/ says ${native.build} — run \`npx expo prebuild\``)
  }
  return { native, expo, problems }
}

export function exportOptionsPlist(teamId: string, extra: Record<string, unknown> = {}): string {
  const opts: Record<string, unknown> = {
    method: 'app-store-connect',
    teamID: teamId,
    signingStyle: 'automatic',
    uploadSymbols: true,
    destination: 'export',
    ...extra,
  }
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const val = (v: unknown): string =>
    typeof v === 'boolean' ? (v ? '<true/>' : '<false/>') : typeof v === 'number' ? `<integer>${v}</integer>` : typeof v === 'string' ? `<string>${esc(v)}</string>` : dict(v as Record<string, unknown>)
  const dict = (d: Record<string, unknown>): string => `<dict>\n${Object.entries(d).map(([k, v]) => `  <key>${esc(k)}</key>${val(v)}`).join('\n')}\n</dict>`
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${dict(opts)}\n</plist>\n`
}

export type Archived = { archivePath: string; version: string; build: string }

export async function archive(p: Project, cfg: Config, v: Versions, opts: { quiet?: boolean } = {}): Promise<Archived> {
  const version = v.native.version ?? 'unknown'
  const build = v.native.build ?? '0'
  const day = new Date().toISOString().slice(0, 10)
  const archivePath = join(cfg.ios.archiveDir, day, `${p.scheme} ${version} build ${build}.xcarchive`)
  await must(
    'xcodebuild',
    ['archive', '-workspace', p.workspace, '-scheme', p.scheme, '-configuration', p.configuration, '-destination', 'generic/platform=iOS', '-archivePath', archivePath, '-allowProvisioningUpdates', '-quiet'],
    'archive',
    { cwd: p.projectDir, quiet: opts.quiet },
  )
  return { archivePath, version, build }
}

export type Exported = { ipa: string; bytes: number; exportDir: string }

export async function exportArchive(p: Project, cfg: Config, archivePath: string, opts: { quiet?: boolean; exportDir?: string } = {}): Promise<Exported> {
  const teamId = need(cfg.asc.teamId ?? undefined, 'Apple team id', HOW.teamId)
  const exportDir = opts.exportDir ?? join(mkdtempSync(join(tmpdir(), 'storeship-')), 'export')
  const plist = join(exportDir, '..', 'ExportOptions.plist')
  writeFileSync(plist, exportOptionsPlist(teamId, cfg.ios.exportOptions))
  await must(
    'xcodebuild',
    ['-exportArchive', '-archivePath', archivePath, '-exportPath', exportDir, '-exportOptionsPlist', plist, '-allowProvisioningUpdates', '-quiet'],
    'export',
    { cwd: p.projectDir, quiet: opts.quiet },
  )
  const ipa = readdirSync(exportDir).find((f) => f.endsWith('.ipa'))
  if (!ipa) throw new StoreshipError(`export produced no .ipa in ${exportDir}`, 'the export step reported success but wrote nothing; check the xcodebuild output above', { code: 'UNKNOWN' })
  const full = join(exportDir, ipa)
  return { ipa: full, bytes: readFileSync(full).length, exportDir }
}

/** Upload with altool. This is the step that needs the API key. */
export async function uploadIpa(ipa: string, keyId: string, issuerId: string, opts: { quiet?: boolean } = {}): Promise<void> {
  await must('xcrun', ['altool', '--upload-app', '-f', ipa, '-t', 'ios', '--apiKey', keyId, '--apiIssuer', issuerId], 'upload', { quiet: opts.quiet })
}
