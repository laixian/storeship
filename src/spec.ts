/**
 * The machine-readable description of this CLI.
 *
 * `storeship spec --json` is how an agent discovers what it can run without
 * having read a README first: every command with its usage, flags, impact and
 * prerequisites, plus the exit-code and error-code tables it will have to
 * branch on. It is generated from the same command tree that produces `--help`
 * and `docs/commands.md`, so it cannot drift from the code.
 */
import { CODES, EXIT_MEANING, type ErrorCode } from './codes.ts'
import type { Command, Impact, Need } from './ctx.ts'
import { HINTS } from './hints.ts'
import { PROTOCOL, VERSION } from './meta.ts'

export type FlagSpec = { name: string; type: 'boolean' | 'value'; description: string; inheritedFrom?: string }

export type CommandSpec = {
  path: string
  summary: string
  usage: string
  impact: Impact
  needs: Need[]
  humanDecisions: string[]
  /** Present only on irreversible commands: why, and what `--yes` is accepting. */
  irreversible?: string
  flags: FlagSpec[]
  sub: CommandSpec[]
}

const isBool = (cmd: Command[], name: string, globalBooleans: string[]): boolean =>
  globalBooleans.includes(name) || cmd.some((c) => (c.booleans ?? []).includes(name))

export function commandSpec(chain: Command[], path: string[], globalBooleans: string[]): CommandSpec {
  const cmd = chain[chain.length - 1]!
  const flags: FlagSpec[] = []
  chain.forEach((c, i) => {
    for (const [name, description] of Object.entries(c.flags ?? {}))
      flags.push({
        name,
        type: isBool(chain, name, globalBooleans) ? 'boolean' : 'value',
        description,
        ...(i === chain.length - 1 ? {} : { inheritedFrom: path.slice(0, i + 1).join(' ') }),
      })
  })
  return {
    path: path.join(' '),
    summary: cmd.summary,
    usage: `storeship ${cmd.usage ?? path.join(' ')}`,
    impact: cmd.impact ?? 'read',
    needs: cmd.needs ?? [],
    humanDecisions: cmd.humanDecisions ?? [],
    ...(cmd.impact === 'irreversible' ? { irreversible: cmd.confirm ?? 'this cannot be undone' } : {}),
    flags,
    sub: (cmd.sub ?? []).map((s) => commandSpec([...chain, s], [...path, s.name], globalBooleans)),
  }
}

export type Spec = {
  storeship: string
  protocol: number
  envelope: Record<string, string>
  exitCodes: typeof EXIT_MEANING
  errorCodes: { code: ErrorCode; exit: number; retry: string; about: string; hint?: string; humanAction?: string }[]
  globalFlags: FlagSpec[]
  commands: CommandSpec[]
}

const ENVELOPE: Record<string, string> = {
  ok: 'true when the command ran. A negative answer (rejected, differs, over limit) is still ok:true — read the exit code',
  storeship: 'the version of this tool',
  protocol: 'the envelope version; bumped when a reader would break',
  command: 'the command path that produced this document',
  dryRun: 'present and true when --dry-run stopped it before writing',
  data: "the command's own result",
  changed: 'what this run changed, or would change under --dry-run: { kind, target, what, detail }',
  warnings: 'things that are true and worth knowing, that did not stop the command',
  next: 'commands worth running next: { command, why, impact }. Never an irreversible one',
  error: 'only when ok is false: { code, message, hint, retry, humanAction }',
}

export function fullSpec(commands: Command[], globalFlags: Record<string, string>, globalBooleans: string[]): Spec {
  return {
    storeship: VERSION,
    protocol: PROTOCOL,
    envelope: ENVELOPE,
    exitCodes: EXIT_MEANING,
    errorCodes: (Object.keys(CODES) as ErrorCode[]).map((code) => {
      const h = HINTS.find((x) => x.code === code)
      return { code, exit: CODES[code].exit, retry: CODES[code].retry, about: CODES[code].about, ...(h ? { hint: h.hint } : {}), ...(h?.humanAction ? { humanAction: h.humanAction } : {}) }
    }),
    globalFlags: Object.entries(globalFlags).map(([name, description]) => ({ name, type: globalBooleans.includes(name) ? ('boolean' as const) : ('value' as const), description })),
    commands: commands.map((c) => commandSpec([c], [c.name], globalBooleans)),
  }
}
