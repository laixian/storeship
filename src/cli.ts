#!/usr/bin/env node
/**
 * storeship — ship an Expo / React Native iOS app to the App Store from a Mac.
 *
 * Command tree lives in ./commands; this file only parses, dispatches, and
 * turns errors into "message + hint" on stderr with a non-zero exit.
 */
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Args, parseArgs } from './args.ts'
import { loadConfig } from './config.ts'
import { type Command, Ctx } from './ctx.ts'
import { StoreshipError } from './errors.ts'
import { Out } from './out.ts'
import { analyticsCommand } from './commands/analytics.ts'
import { doctorCommand } from './commands/doctor.ts'
import { docsCommand, registry } from './commands/docs.ts'
import { initCommand } from './commands/init.ts'
import { listingCommand } from './commands/listing.ts'
import { mediaCommand } from './commands/media.ts'
import { appsCommand, deviceCommand, skillCommand } from './commands/misc.ts'
import { offerCommand } from './commands/offer.ts'
import { releaseCommand } from './commands/release.ts'
import { previewCommand } from './commands/preview.ts'
import { reelCommand } from './commands/reel.ts'
import { exportCommand, shipCommand, uploadCommand } from './commands/ship.ts'
import { shotsCommand } from './commands/shots.ts'
import { simCommand } from './commands/sim.ts'
import { buildsCommand, versionCommand } from './commands/version.ts'

export const NAME = 'storeship'
export const VERSION = '0.1.0'

const COMMANDS: Command[] = [
  initCommand,
  doctorCommand,
  shipCommand,
  exportCommand,
  uploadCommand,
  releaseCommand,
  versionCommand,
  buildsCommand,
  listingCommand,
  mediaCommand,
  offerCommand,
  deviceCommand,
  appsCommand,
  analyticsCommand,
  shotsCommand,
  previewCommand,
  reelCommand,
  simCommand,
  skillCommand,
  docsCommand,
]

const GLOBAL_BOOLEANS = ['json', 'help', 'version']

function help(cmds: Command[], prefix = ''): string {
  const w = Math.max(...cmds.map((c) => c.name.length))
  return cmds.map((c) => `  ${prefix}${c.name.padEnd(w)}  ${c.summary}`).join('\n')
}

function usage(): string {
  return [
    `${NAME} ${VERSION} — ship an iOS app to the App Store from your Mac`,
    '',
    'usage: storeship <command> [subcommand] [args] [--json] [--config FILE]',
    '',
    help(COMMANDS),
    '',
    'global flags:',
    '  --json          machine-readable output (progress still goes to stderr)',
    '  --config FILE   config file (default: storeship.config.* found upward from cwd)',
    '',
    'credentials: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, ASC_APP_ID, ASC_TEAM_ID override the config file.',
  ].join('\n')
}

function resolveCommand(argv: string[]): { cmd?: Command; rest: string[]; path: string[]; chain: Command[] } {
  let level: Command[] | undefined = COMMANDS
  let cmd: Command | undefined
  const path: string[] = []
  const chain: Command[] = []
  let i = 0
  while (level && i < argv.length && !argv[i]!.startsWith('--')) {
    const next: Command | undefined = level.find((c) => c.name === argv[i])
    if (!next) break
    cmd = next
    path.push(next.name)
    chain.push(next)
    level = next.sub
    i++
  }
  return { cmd, rest: argv.slice(i), path, chain }
}

/** Flags of a command plus those inherited from its parents (e.g. sim's --profile). */
export function allFlags(chain: Command[]): Record<string, string> {
  return Object.assign({}, ...chain.map((c) => c.flags ?? {}), GLOBAL_FLAGS)
}

export const GLOBAL_FLAGS: Record<string, string> = {
  json: 'machine-readable output on stdout; progress still goes to stderr',
  config: 'config file; default: storeship.config.* found walking up from cwd',
}

registry.commands = COMMANDS
registry.globalFlags = GLOBAL_FLAGS

function commandHelp(cmd: Command, path: string[], chain: Command[]): string {
  const lines = [`${NAME} ${cmd.usage ?? path.join(' ')}`, '', cmd.summary]
  if (cmd.sub) lines.push('', help(cmd.sub, path.join(' ') + ' '))
  const flags = allFlags(chain)
  const names = Object.keys(flags)
  if (names.length) {
    const w = Math.max(...names.map((n) => n.length)) + 2
    lines.push('', 'flags:', ...names.map((n) => `  --${n.padEnd(w)}${flags[n]}`))
  }
  return lines.join('\n')
}

export async function main(argv: string[]): Promise<void> {
  const pre = parseArgs(argv, GLOBAL_BOOLEANS)
  if (pre.flags.has('version') && !pre.positional.length) {
    console.log(VERSION)
    return
  }
  const { cmd, rest, path, chain } = resolveCommand(argv)
  if (!cmd || pre.flags.has('help')) {
    if (cmd) {
      console.log(commandHelp(cmd, path, chain))
      return
    }
    if (pre.positional.length) {
      console.error(`unknown command: ${pre.positional.join(' ')}\n`)
      process.exitCode = 2
    }
    console.log(usage())
    return
  }
  const parsed = parseArgs(rest, [...GLOBAL_BOOLEANS, ...(cmd.booleans ?? [])])
  const out = new Out(parsed.flags.has('json'))
  const configFile = parsed.flags.get('config')?.at(-1)
  try {
    const cfg = await loadConfig({ cwd: process.cwd(), file: typeof configFile === 'string' ? configFile : undefined })
    await cmd.run(new Ctx(cfg, new Args(parsed), out))
    out.finish()
  } catch (e) {
    const err = e as StoreshipError
    if (out.json) console.log(JSON.stringify({ error: err.message, hint: err.hint ?? null }, null, 2))
    else {
      console.error(`✗ ${err.message}`)
      if (err.hint) console.error(`  → ${err.hint}`)
      if (!(e instanceof StoreshipError) && process.env.STORESHIP_DEBUG) console.error(err.stack)
    }
    process.exitCode = err.exitCode ?? 1
  }
}

// Entry detection must survive pnpm's .bin shim (unresolved `..` in argv[1]) and symlinked installs.
const isEntry = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isEntry) await main(process.argv.slice(2))
