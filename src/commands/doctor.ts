import { existsSync, statSync } from 'node:fs'
import { type Command } from '../ctx.ts'
import { capture, which } from '../proc.ts'
import { resolveProject, xcodeAccounts } from '../ios/xcode.ts'
import { FFMPEG_HINT, findFfmpeg } from '../preview/ffmpeg.ts'
import { findChrome } from '../shots/render.ts'
import { findIdb } from '../sim/sim.ts'

type Check = { name: string; ok: boolean; detail: string; fix?: string }

export const doctorCommand: Command = {
  name: 'doctor',
  summary: 'check the machine, the config and the API key; explains each miss',
  run: async (ctx) => {
    const cfg = ctx.cfg
    const checks: Check[] = []
    const add = (name: string, ok: boolean, detail: string, fix?: string): void => void checks.push({ name, ok, detail, fix })

    const [maj, min] = process.versions.node.split('.').map(Number)
    add('node', maj! > 22 || (maj === 22 && min! >= 18), process.versions.node, 'Node ≥ 22.18 runs TypeScript directly; older versions cannot run this tool')
    add('config', !!cfg.file, cfg.file ?? 'no storeship.config.* found (walked up from cwd)', 'run `storeship init` in the repo')
    add('app id', !!cfg.app.id, cfg.app.id ?? '-', 'set app.id or ASC_APP_ID; `storeship init` looks it up by bundle id')
    add('locales', cfg.locales.length > 0, cfg.locales.join(', ') || '-', 'set locales, e.g. ["en-US"]')
    add('key id / issuer', !!(cfg.asc.keyId && cfg.asc.issuerId), `${cfg.asc.keyId ?? '-'} / ${cfg.asc.issuerId ?? '-'}`, 'set asc.keyId + asc.issuerId (App Store Connect → Users and Access → Integrations)')
    const keyOk = !!cfg.asc.keyPath && existsSync(cfg.asc.keyPath)
    add('private key', keyOk, cfg.asc.keyPath ?? '-', 'download the .p8 (once!) and put it there, chmod 600')
    if (keyOk) {
      const mode = statSync(cfg.asc.keyPath!).mode & 0o777
      add('key permissions', (mode & 0o077) === 0, mode.toString(8), `chmod 600 ${cfg.asc.keyPath}`)
    }
    add('team id', !!cfg.asc.teamId, cfg.asc.teamId ?? '-', 'set asc.teamId (developer.apple.com → Membership); needed for export')
    add('xcodebuild', !!which('xcodebuild'), capture('xcodebuild', ['-version'])?.split('\n').join(' ') ?? 'missing', 'install Xcode and `xcode-select -s /Applications/Xcode.app`')
    add('altool', !!capture('xcrun', ['--find', 'altool']), capture('xcrun', ['--find', 'altool']) ?? 'missing', 'comes with Xcode')
    const accounts = xcodeAccounts()
    add('Xcode account', accounts.length > 0, accounts.length ? `${accounts.length} signed in` : 'no Apple ID signed into Xcode', 'Xcode → Settings → Accounts → sign in with the developer account; without it `export` fails with "No Accounts" (sessions expire, Xcode updates drop them)')
    add('PlistBuddy', existsSync('/usr/libexec/PlistBuddy'), '/usr/libexec/PlistBuddy', 'macOS only')
    try {
      const p = resolveProject(cfg)
      add('ios project', existsSync(p.workspace), `${p.workspace} scheme=${p.scheme}${p.expo ? ' (expo)' : ''}`)
      add('Info.plist', existsSync(p.infoPlist), p.infoPlist, p.expo ? 'run `npx expo prebuild`' : 'set ios.infoPlist')
    } catch (e) {
      add('ios project', false, (e as Error).message, (e as { hint?: string }).hint)
    }
    add('listing file', existsSync(cfg.listing.file), cfg.listing.file, 'optional; needed for `listing` commands')
    if (keyOk && cfg.asc.keyId && cfg.asc.issuerId) {
      try {
        const r = await ctx.client().get(cfg.app.id ? `/v1/apps/${cfg.app.id}` : '/v1/apps?limit=1')
        add('API key works', r.status === 200, r.status === 200 ? (cfg.app.id ? `${r.json.data.attributes.name} (${r.json.data.attributes.bundleId})` : 'ok') : `${r.status} ${r.text.slice(0, 120)}`, 'see the hint printed for 401 / 403 above')
      } catch (e) {
        add('API key works', false, (e as Error).message, (e as { hint?: string }).hint)
      }
    }
    // Optional tooling for the media side
    let chrome: string | undefined
    try {
      chrome = findChrome(cfg.chrome)
    } catch {
      /* reported below */
    }
    add('Chrome (optional)', !!chrome, chrome ?? 'missing', 'needed only for `shots render`; set chrome in the config or STORESHIP_CHROME')
    if (cfg.shots.content) add('shots content (optional)', existsSync(cfg.shots.content), cfg.shots.content, 'set shots.content to the module exporting the shots')
    const idb = findIdb(cfg.sim.idb)
    add('idb (optional)', !!idb, idb?.bin ?? 'missing — `sim` falls back to CGEvent, which needs Accessibility permission', 'see README → Simulator driver for the install (brew does not work with full Xcode only)')
    let ffmpeg: string | undefined
    try {
      ffmpeg = findFfmpeg(cfg.ffmpeg)
    } catch {
      /* reported below */
    }
    add('ffmpeg (optional)', !!ffmpeg, ffmpeg ?? 'missing', `needed only for \`preview\` / \`reel\`; ${FFMPEG_HINT}`)

    ctx.out.emit(checks)
    for (const c of checks) ctx.out.log(`${c.ok ? '✓' : '✗'} ${c.name.padEnd(20)} ${c.detail}${!c.ok && c.fix ? `\n      → ${c.fix}` : ''}`)
    const bad = checks.filter((c) => !c.ok && !c.name.includes('optional'))
    if (bad.length) process.exitCode = 1
    ctx.out.log(bad.length ? `\n${bad.length} problem(s)` : '\nall good')
  },
}
