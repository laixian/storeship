/**
 * Write storeship.config.json by looking at the project (expo config) and
 * asking App Store Connect for the app id and locales. Needs the key.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { appLocales, findAppByBundleId, listApps } from '../asc/misc.ts'
import { createClient } from '../asc/client.ts'
import { type Command } from '../ctx.ts'
import { defaultKeyPath, type RawConfig } from '../config.ts'
import { StoreshipError } from '../errors.ts'
import { expoConfig } from '../ios/xcode.ts'
import { skillsDir } from './misc.ts'

/**
 * The permission rules that let an agent run this tool without a prompt per
 * command. `release` bundles xcodebuild, an upload and several App Store
 * Connect writes into one command line, and a permission classifier will often
 * refuse that while allowing each step — so the rule is written once, here,
 * instead of being a paragraph in a README that a human retypes.
 */
export const ALLOW_RULES = ['Bash(storeship *)', 'Bash(npx storeship *)', 'Bash(pnpm storeship *)']

/** Add the rules to a Claude Code settings file, keeping everything else in it. */
export function withAllowRules(existing: string | undefined): { text: string; added: string[] } {
  const settings = existing ? (JSON.parse(existing) as { permissions?: { allow?: string[] } }) : {}
  const allow = settings.permissions?.allow ?? []
  const added = ALLOW_RULES.filter((r) => !allow.includes(r))
  settings.permissions = { ...settings.permissions, allow: [...allow, ...added] }
  return { text: JSON.stringify(settings, null, 2) + '\n', added }
}

export const initCommand: Command = {
  name: 'init',
  summary: 'create storeship.config.json from the project and App Store Connect',
  usage: 'init [--project DIR] [--key-id ID --issuer-id ID [--key-path P]] [--bundle-id ID] [--force] [--no-skills] [--no-permissions]',
  flags: {
    project: 'the Expo / iOS project directory, relative to the config root; default: the root itself',
    'key-id': 'App Store Connect API key id (with --issuer-id the app id and locales are looked up)',
    'issuer-id': 'App Store Connect issuer id',
    'key-path': 'path to the .p8; default ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8',
    'bundle-id': 'bundle id to look up; default: read from expo config',
    force: 'overwrite an existing storeship.config.json',
    'no-skills': 'do not copy the agent skills into .claude/skills',
    'no-permissions': 'do not add the storeship allow rules to .claude/settings.local.json',
  },
  booleans: ['force', 'no-skills', 'no-permissions'],
  impact: 'write',
  run: async (ctx) => {
    const root = ctx.cfg.file ? ctx.cfg.root : process.cwd()
    const target = join(root, 'storeship.config.json')
    if (existsSync(target) && !ctx.args.bool('force')) throw new StoreshipError(`${target} already exists`, 'pass --force to overwrite', { code: 'USAGE' })
    const projectDir = ctx.args.str('project') ? join(root, ctx.args.str('project')!) : ctx.cfg.ios.projectDir
    const raw: RawConfig = { app: {}, asc: {}, locales: [], ios: {}, listing: { file: 'store-listing.md' }, whatsNew: { dir: 'whats-new' }, release: { scheduledTime: '00:00:00Z' }, products: {} }
    if (projectDir !== root) raw.ios!.projectDir = relative(root, projectDir)

    const isExpo = ['app.config.ts', 'app.config.js', 'app.json'].some((f) => existsSync(join(projectDir, f)))
    let bundleId = ctx.args.str('bundle-id') ?? ctx.cfg.app.bundleId
    if (isExpo) {
      ctx.out.note('reading expo config …')
      const c = await expoConfig(projectDir)
      raw.app!.name = c.name
      bundleId ??= c.ios?.bundleIdentifier
      if (c.ios?.appleTeamId) raw.asc!.teamId = c.ios.appleTeamId
    }
    raw.app!.bundleId = bundleId

    const keyId = ctx.args.str('key-id') ?? ctx.cfg.asc.keyId
    const issuerId = ctx.args.str('issuer-id') ?? ctx.cfg.asc.issuerId
    if (keyId && issuerId) {
      raw.asc!.keyId = keyId
      raw.asc!.issuerId = issuerId
      const keyPath = ctx.args.str('key-path') ?? ctx.cfg.asc.keyPath ?? defaultKeyPath(keyId)
      if (ctx.args.str('key-path')) raw.asc!.keyPath = keyPath
      const client = createClient({ keyId, issuerId, keyPath })
      if (bundleId) {
        ctx.out.note(`looking up ${bundleId} in App Store Connect …`)
        const app = await findAppByBundleId(client, bundleId)
        if (app) {
          raw.app!.id = app.id
          raw.app!.name ??= app.name
          raw.locales = await appLocales(client, app.id)
        } else {
          const apps = await listApps(client)
          ctx.out.note(`no app with bundle id ${bundleId}; the account has: ${apps.map((a) => `${a.bundleId} (${a.id})`).join(', ') || 'none'}`)
        }
      }
    } else ctx.out.note('no key id / issuer id given; app id and locales left blank (pass --key-id/--issuer-id, or export ASC_KEY_ID/ASC_ISSUER_ID)')

    writeFileSync(target, JSON.stringify(raw, null, 2) + '\n')
    ctx.out.changed({ kind: 'config', target, what: 'written' })
    ctx.out.log(`wrote ${target}`)

    // An agent-first tool finishes its own wiring: the skills and the one
    // permission rule are part of "configured", not homework in a README.
    const skills: string[] = []
    if (!ctx.args.bool('no-skills')) {
      const to = join(root, '.claude', 'skills')
      mkdirSync(to, { recursive: true })
      for (const n of readdirSync(skillsDir()).filter((n) => existsSync(join(skillsDir(), n, 'SKILL.md')))) {
        cpSync(join(skillsDir(), n), join(to, n), { recursive: true })
        skills.push(n)
      }
      ctx.out.changed(...skills.map((n) => ({ kind: 'skill', target: n, what: 'installed', detail: to })))
      ctx.out.log(`installed ${skills.length} skill(s) → ${to}`)
    }
    let permissions: string[] = []
    if (!ctx.args.bool('no-permissions')) {
      const settingsFile = join(root, '.claude', 'settings.local.json')
      const { text, added } = withAllowRules(existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : undefined)
      permissions = added
      if (added.length) {
        mkdirSync(dirname(settingsFile), { recursive: true })
        writeFileSync(settingsFile, text)
        ctx.out.changed({ kind: 'permissions', target: settingsFile, what: 'allowed', detail: added.join(', ') })
        ctx.out.log(`allowed ${added.join(', ')} in ${settingsFile}`)
      }
    }

    ctx.out.emit({ file: target, config: raw, skills, permissions })
    ctx.out.next(
      { command: 'storeship doctor', why: 'every prerequisite, with the fix for each miss', impact: 'read' },
      { command: 'storeship state', why: 'where the release is and what to run next', impact: 'read' },
    )
  },
}
