/**
 * Write storeship.config.json by looking at the project (expo config) and
 * asking App Store Connect for the app id and locales. Needs the key.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { appLocales, findAppByBundleId, listApps } from '../asc/misc.ts'
import { createClient } from '../asc/client.ts'
import { type Command } from '../ctx.ts'
import { defaultKeyPath, type RawConfig } from '../config.ts'
import { StoreshipError } from '../errors.ts'
import { expoConfig } from '../ios/xcode.ts'

export const initCommand: Command = {
  name: 'init',
  summary: 'create storeship.config.json from the project and App Store Connect',
  usage: 'init [--project DIR] [--key-id ID --issuer-id ID [--key-path P]] [--bundle-id ID] [--force]',
  flags: {
    project: 'the Expo / iOS project directory, relative to the config root; default: the root itself',
    'key-id': 'App Store Connect API key id (with --issuer-id the app id and locales are looked up)',
    'issuer-id': 'App Store Connect issuer id',
    'key-path': 'path to the .p8; default ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8',
    'bundle-id': 'bundle id to look up; default: read from expo config',
    force: 'overwrite an existing storeship.config.json',
  },
  booleans: ['force'],
  run: async (ctx) => {
    const root = ctx.cfg.file ? ctx.cfg.root : process.cwd()
    const target = join(root, 'storeship.config.json')
    if (existsSync(target) && !ctx.args.bool('force')) throw new StoreshipError(`${target} already exists`, 'pass --force to overwrite')
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
    ctx.out.emit({ file: target, config: raw })
    ctx.out.log(`wrote ${target}`)
    ctx.out.log('next: `storeship doctor`')
  },
}
