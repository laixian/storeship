/**
 * `storeship spec` — the interface, as data.
 *
 * This is the command an agent runs first: it answers "what can I run, what
 * does it change, what do the exit codes mean, what are the error codes"
 * without a README, and it is generated from the command tree, so it is
 * current by construction.
 */
import { type Command } from '../ctx.ts'
import { registry } from '../registry.ts'
import { fullSpec, type CommandSpec } from '../spec.ts'

const MARK: Record<string, string> = { read: ' ', write: '✎', irreversible: '⚠' }

function tree(cmds: CommandSpec[], out: (l: string) => void, depth = 0): void {
  for (const c of cmds) {
    out(`${'  '.repeat(depth)}${MARK[c.impact]} ${c.path}${c.needs.length ? `  [${c.needs.join(' ')}]` : ''}`)
    tree(c.sub, out, depth + 1)
  }
}

export const specCommand: Command = {
  name: 'spec',
  summary: 'the machine-readable interface: every command with its impact, plus the exit-code and error-code tables',
  usage: 'spec [--json]',
  impact: 'read',
  run: async (ctx) => {
    const s = fullSpec(registry.commands, registry.globalFlags, registry.globalBooleans)
    ctx.out.emit(s)
    ctx.out.log(`storeship ${s.storeship}, protocol ${s.protocol} — ✎ writes, ⚠ irreversible (needs --yes)\n`)
    tree(s.commands, (l) => ctx.out.log(l))
    ctx.out.log('\nexit codes:')
    for (const e of s.exitCodes) ctx.out.log(`  ${e.code}  ${e.name.padEnd(8)} ${e.meaning}`)
    ctx.out.log(`\n${s.errorCodes.length} error codes; run with --json for those and the flags.`)
  },
}
