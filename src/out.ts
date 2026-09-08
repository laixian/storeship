/**
 * Output channel, and the JSON envelope that is this tool's agent interface.
 *
 * Human mode prints lines as they happen. `--json` mode swallows them and
 * prints one document at the end — always the same shape, whether the command
 * worked or not:
 *
 *   { ok, storeship, protocol, command, dryRun?, data, changed, warnings, next }
 *   { ok: false, …, error: { code, message, hint, retry, humanAction }, next }
 *
 * `ok` says whether the command ran, never whether the answer was yes: a
 * rejected review or a non-empty diff is `ok: true` with exit 3. Progress that
 * must reach a human even in JSON mode goes to stderr via `note`.
 */
import type { Impact } from './ctx.ts'
import type { StoreshipError } from './errors.ts'
import { PROTOCOL, VERSION } from './meta.ts'

/** One thing this run changed (or would change, under --dry-run). */
export type Change = { kind: string; target?: string; what: string; detail?: string }
/** A command worth running next, and why. Never an irreversible one. */
export type NextStep = { command: string; why: string; impact?: Impact }

export class Out {
  private data: unknown = undefined
  private full: unknown = undefined
  private changes: Change[] = []
  private warnings: string[] = []
  private steps: NextStep[] = []
  readonly json: boolean
  readonly raw: boolean
  readonly fields?: string[]
  /** Set by the CLI from the command path, so the envelope names what produced it. */
  command = ''
  /** Set by a command that stopped before writing because of --dry-run. */
  dryRun = false

  constructor(json: boolean, opts: { raw?: boolean; fields?: string[] } = {}) {
    this.json = json
    this.raw = opts.raw ?? false
    this.fields = opts.fields?.length ? opts.fields : undefined
  }

  log(line = ''): void {
    if (!this.json) console.log(line)
  }

  /** Always visible; for progress, never for results. */
  note(line: string): void {
    console.error(line)
  }

  /**
   * The result. `full` is the unprojected payload for `--raw`; give it when the
   * slim version drops something an agent might occasionally need, so the
   * default stays small without hiding anything.
   */
  emit(data: unknown, full?: unknown): void {
    this.data = data
    this.full = full
  }

  changed(...c: Change[]): void {
    this.changes.push(...c)
  }

  warn(...w: string[]): void {
    this.warnings.push(...w)
    if (!this.json) for (const line of w) console.log(`  ⚠️ ${line}`)
  }

  next(...s: NextStep[]): void {
    this.steps.push(...s)
  }

  private payload(): unknown {
    const d = this.raw && this.full !== undefined ? this.full : this.data
    return this.fields ? project(d, this.fields) : d
  }

  private envelope(ok: boolean, extra: Record<string, unknown>): Record<string, unknown> {
    return {
      ok,
      storeship: VERSION,
      protocol: PROTOCOL,
      command: this.command,
      ...(this.dryRun ? { dryRun: true } : {}),
      ...extra,
      data: this.payload() ?? null,
      changed: this.changes,
      warnings: this.warnings,
      next: this.steps,
    }
  }

  finish(): void {
    if (this.json) console.log(JSON.stringify(this.envelope(true, {}), null, 2))
    else this.trailer()
  }

  fail(err: StoreshipError): void {
    if (this.json) console.log(JSON.stringify(this.envelope(false, { error: err.toJSON() }), null, 2))
    else {
      console.error(`✗ ${err.message}`)
      if (err.hint) console.error(`  → ${err.hint}`)
      if (err.humanAction) console.error(`  👤 ${err.humanAction}`)
      console.error(`  [${err.code}, retry: ${err.retry}]`)
      this.trailer()
    }
  }

  /** In human mode the suggestions are worth as much as they are to an agent. */
  private trailer(): void {
    if (!this.steps.length) return
    console.log('')
    for (const s of this.steps) console.log(`→ ${s.command}${s.why ? `\n    ${s.why}` : ''}`)
  }
}

/** Keep only these top-level keys, on an object or on every element of an array. */
export function project(data: unknown, fields: string[]): unknown {
  if (Array.isArray(data)) return data.map((d) => project(d, fields))
  if (!data || typeof data !== 'object') return data
  const out: Record<string, unknown> = {}
  for (const f of fields) if (f in (data as Record<string, unknown>)) out[f] = (data as Record<string, unknown>)[f]
  return out
}

export const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)}MB`

/** Pad columns; every row is a string array. */
export function table(rows: string[][]): string[] {
  if (!rows.length) return []
  const width = (s: string): number => [...s].length
  const w = rows[0]!.map((_, c) => Math.max(...rows.map((r) => width(r[c] ?? ''))))
  return rows.map((r) => r.map((v, c) => (v ?? '') + ' '.repeat(Math.max(0, w[c]! - width(v ?? '')))).join('  ').trimEnd())
}
