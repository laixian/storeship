#!/usr/bin/env node
/**
 * storeship — ship an Expo / React Native iOS app to the App Store from a Mac.
 *
 * Command tree lives in ./commands; this file only parses, dispatches, enforces
 * the one rule that cannot live in a command (an irreversible command needs
 * `--yes`), and turns errors into the JSON envelope or "message + hint" on
 * stderr with the exit code the error's code prescribes.
 */
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Args, parseArgs } from './args.ts'
import { EXIT } from './codes.ts'
import { loadConfig } from './config.ts'
import { type Command, Ctx } from './ctx.ts'
import { asStoreshipError, NeedsHuman, StoreshipError } from './errors.ts'
import { NAME, VERSION } from './meta.ts'
import { Out } from './out.ts'
import { commandSpec } from './spec.ts'
import { analyticsCommand } from './commands/analytics.ts'
import { doctorCommand } from './commands/doctor.ts'
import { docsCommand, registry } from './commands/docs.ts'
import { initCommand } from './commands/init.ts'
import { listingCommand } from './commands/listing.ts'
import { mediaCommand } from './commands/media.ts'
import { appsCommand, deviceCommand, skillCommand } from './commands/misc.ts'
import { offerCommand } from './commands/offer.ts'
import { productsCommand } from './commands/products.ts'
import { releaseCommand } from './commands/release.ts'
import { previewCommand } from './commands/preview.ts'
import { reelCommand } from './commands/reel.ts'
import { exportCommand, shipCommand, uploadCommand } from './commands/ship.ts'
import { shotsCommand } from './commands/shots.ts'
import { simCommand } from './commands/sim.ts'
import { specCommand } from './commands/spec.ts'
import { stateCommand } from './commands/state.ts'
import { buildsCommand, versionCommand } from './commands/version.ts'

export { NAME, VERSION } from './meta.ts'

const COMMANDS: Command[] = [
  initCommand,
  doctorCommand,
  stateCommand,
  specCommand,
  shipCommand,
  exportCommand,
  uploadCommand,
  releaseCommand,
  productsCommand,
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

/**
 * Flags that are boolean everywhere. `--yes` and `--dry-run` are in here rather
 * than per command so a command that forgot to declare them still parses them
 * as booleans — `--yes 1.4.0` must never eat the version.
 */
export const GLOBAL_BOOLEANS = ['json', 'help', 'version', 'raw', 'yes', 'dry-run']

export const GLOBAL_FLAGS: Record<string, string> = {
  json: 'machine-readable output on stdout; progress still goes to stderr',
  raw: 'with --json: the full payload where the default is a slimmed one',
  fields: 'with --json: comma list of top-level keys to keep in data',
  config: 'config file; default: storeship.config.* found walking up from cwd',
}

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
    ...Object.entries(GLOBAL_FLAGS).map(([k, v]) => `  --${k.padEnd(12)}${v}`),
    '',
    'for agents: `storeship state --json` says where the release is and what to run next;',
    '            `storeship spec --json` is the whole command tree, exit codes and error codes.',
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

registry.commands = COMMANDS
registry.globalFlags = GLOBAL_FLAGS
registry.globalBooleans = GLOBAL_BOOLEANS

function commandHelp(cmd: Command, path: string[], chain: Command[]): string {
  const lines = [`${NAME} ${cmd.usage ?? path.join(' ')}`, '', cmd.summary]
  const impact = cmd.impact ?? 'read'
  if (impact !== 'read') lines.push('', `impact: ${impact}${cmd.confirm ? ` — ${cmd.confirm}` : ''}`)
  if (cmd.humanDecisions?.length) lines.push('', `the human decides: ${cmd.humanDecisions.join('; ')}`)
  if (cmd.sub) lines.push('', help(cmd.sub, path.join(' ') + ' '))
  const flags = allFlags(chain)
  const names = Object.keys(flags)
  if (names.length) {
    const w = Math.max(...names.map((n) => n.length)) + 2
    lines.push('', 'flags:', ...names.map((n) => `  --${n.padEnd(w)}${flags[n]}`))
  }
  return lines.join('\n')
}

/**
 * The one rule the CLI enforces rather than each command: something that cannot
 * be undone is never done because an agent inferred it was fine. `--yes` is a
 * human's signature, and `storeship state` never puts one of these in `next`.
 */
function guardIrreversible(cmd: Command, args: Args): void {
  if (cmd.impact !== 'irreversible' || args.bool('yes')) return
  throw new NeedsHuman(
    `${cmd.name} is irreversible and needs --yes`,
    cmd.confirm ?? 'this cannot be undone; a person has to decide, then pass --yes',
    'nothing was touched',
  )
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
      if (pre.flags.has('json')) console.log(JSON.stringify(commandSpec(chain, path, GLOBAL_BOOLEANS), null, 2))
      else console.log(commandHelp(cmd, path, chain))
      return
    }
    if (pre.positional.length) {
      console.error(`unknown command: ${pre.positional.join(' ')}\n`)
      process.exitCode = EXIT.usage
    }
    console.log(usage())
    return
  }
  const parsed = parseArgs(rest, [...GLOBAL_BOOLEANS, ...(cmd.booleans ?? [])])
  const args = new Args(parsed)
  const out = new Out(parsed.flags.has('json'), { raw: args.bool('raw'), fields: args.str('fields')?.split(',').map((f) => f.trim()).filter(Boolean) })
  out.command = path.join(' ')
  try {
    const cfg = await loadConfig({ cwd: process.cwd(), file: args.str('config') })
    guardIrreversible(cmd, args)
    await cmd.run(new Ctx(cfg, args, out))
    out.finish()
  } catch (e) {
    const err = asStoreshipError(e)
    out.fail(err)
    if (!(e instanceof StoreshipError) && process.env.STORESHIP_DEBUG) console.error(err.stack)
    process.exitCode = err.exitCode
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
