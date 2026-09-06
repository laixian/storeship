/**
 * Tiny argv parser. `--k v`, `--k=v`, repeated `--k a --k b`, and boolean
 * flags. Whether `--k` swallows the next token is decided by the caller's
 * `booleans` set, not by guessing — `--wait 1.3.1` must not eat the version.
 */
import { UsageError } from './errors.ts'

export type Parsed = { positional: string[]; flags: Map<string, (string | true)[]> }

export function parseArgs(argv: string[], booleans: Iterable<string> = []): Parsed {
  const bools = new Set(booleans)
  const positional: string[] = []
  const flags = new Map<string, (string | true)[]>()
  const push = (k: string, v: string | true): void => {
    flags.set(k, [...(flags.get(k) ?? []), v])
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--') {
      positional.push(...argv.slice(i + 1))
      break
    }
    if (!a.startsWith('--')) {
      positional.push(a)
      continue
    }
    const eq = a.indexOf('=')
    if (eq > 0) {
      push(a.slice(2, eq), a.slice(eq + 1))
      continue
    }
    const k = a.slice(2)
    const next = argv[i + 1]
    if (bools.has(k) || next === undefined || next.startsWith('--')) push(k, true)
    else {
      push(k, next)
      i++
    }
  }
  return { positional, flags }
}

export class Args {
  readonly parsed: Parsed
  constructor(parsed: Parsed) {
    this.parsed = parsed
  }

  get positional(): string[] {
    return this.parsed.positional
  }

  /** Last value of a string flag, or undefined. */
  str(k: string): string | undefined {
    const v = this.parsed.flags.get(k)?.at(-1)
    return typeof v === 'string' ? v : undefined
  }

  bool(k: string): boolean {
    return this.parsed.flags.has(k)
  }

  /** Every string value of a repeatable flag. */
  all(k: string): string[] {
    return (this.parsed.flags.get(k) ?? []).filter((v): v is string => typeof v === 'string')
  }

  num(k: string, fallback: number): number {
    const s = this.str(k)
    if (s === undefined) return fallback
    const n = Number(s)
    if (!Number.isFinite(n)) throw new UsageError(`--${k} must be a number, got "${s}"`)
    return n
  }

  need(k: string, why?: string): string {
    const v = this.str(k)
    if (v === undefined) throw new UsageError(`--${k} is required${why ? ` (${why})` : ''}`)
    return v
  }

  /** Positional at index, or a usage error naming what was expected. */
  at(i: number, what: string): string {
    const v = this.parsed.positional[i]
    if (v === undefined) throw new UsageError(`missing argument: <${what}>`)
    return v
  }
}
