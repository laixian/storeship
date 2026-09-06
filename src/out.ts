/**
 * Output channel. Human mode prints lines as they happen; `--json` mode
 * swallows them and prints one JSON document at the end, so an agent gets a
 * structure instead of scraping. Progress that must reach a human even in
 * JSON mode (e.g. "waiting for build…") goes to stderr.
 */
export class Out {
  private data: unknown = undefined
  readonly json: boolean
  constructor(json: boolean) {
    this.json = json
  }

  log(line = ''): void {
    if (!this.json) console.log(line)
  }

  /** Always visible; for progress, never for results. */
  note(line: string): void {
    console.error(line)
  }

  emit(data: unknown): void {
    this.data = data
  }

  finish(): void {
    if (this.json) console.log(JSON.stringify(this.data ?? null, null, 2))
  }
}

export const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)}MB`

/** Pad columns; every row is a string array. */
export function table(rows: string[][]): string[] {
  if (!rows.length) return []
  const width = (s: string): number => [...s].length
  const w = rows[0]!.map((_, c) => Math.max(...rows.map((r) => width(r[c] ?? ''))))
  return rows.map((r) => r.map((v, c) => (v ?? '') + ' '.repeat(Math.max(0, w[c]! - width(v ?? '')))).join('  ').trimEnd())
}
