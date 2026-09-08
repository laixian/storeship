import { createInterface } from 'node:readline/promises'
import { Args } from './args.ts'
import { type AscClient, createClient } from './asc/client.ts'
import { type Config, HOW, need } from './config.ts'
import { StoreshipError, NeedsHuman } from './errors.ts'
import { Out } from './out.ts'

/** Everything a command needs; the client and app id are resolved lazily so offline commands never ask for credentials. */
export class Ctx {
  private _client?: AscClient
  readonly cfg: Config
  readonly args: Args
  readonly out: Out
  constructor(cfg: Config, args: Args, out: Out) {
    this.cfg = cfg
    this.args = args
    this.out = out
  }

  client(): AscClient {
    if (!this._client) {
      this._client = createClient({
        keyId: need(this.cfg.asc.keyId, 'App Store Connect key id', HOW.keyId),
        issuerId: need(this.cfg.asc.issuerId, 'App Store Connect issuer id', HOW.issuerId),
        keyPath: this.cfg.asc.keyPath,
      })
    }
    return this._client
  }

  appId(): string {
    return need(this.cfg.app.id, 'App Store app id', HOW.appId)
  }

  locales(): string[] {
    return need(this.cfg.locales.length ? this.cfg.locales : undefined, 'locales', HOW.locales)
  }

  /** `--dry-run`: work out the change set, print it, write nothing. Marks the envelope. */
  dryRun(): boolean {
    const on = this.args.bool('dry-run')
    if (on) this.out.dryRun = true
    return on
  }

  /** True when nobody can answer a prompt: not a terminal, or told so explicitly. */
  get interactive(): boolean {
    return process.env.STORESHIP_NON_INTERACTIVE !== '1' && !!process.stdin.isTTY
  }

  /**
   * Ask before doing something whose consequences are the human's to accept.
   * `--yes` is the only way past it without a terminal — deliberately, so an
   * agent has to have been given that permission rather than infer it.
   */
  async confirm(question: string, why: string): Promise<void> {
    if (this.args.bool('yes')) return
    if (!this.interactive) throw new NeedsHuman(`${question} — refusing without --yes`, why, 'a person has to agree to this; then pass --yes')
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
    rl.close()
    if (a !== 'y' && a !== 'yes') throw new StoreshipError('aborted', undefined, { code: 'ABORTED' })
  }
}

/** What running a command can do to the outside world. `read` is the default. */
export type Impact = 'read' | 'write' | 'irreversible'

/** External things a command needs before it can work; `doctor` and `spec` report them. */
export type Need = 'credentials' | 'xcode' | 'chrome' | 'ffmpeg' | 'idb' | 'simulator'

export type Command = {
  name: string
  summary: string
  /** Full usage line, positional args in <>, optional in []. */
  usage?: string
  /** Flag name → what it does (with default). Shown by --help and in the generated docs. */
  flags?: Record<string, string>
  booleans?: string[]
  /**
   * Whether this command writes. `irreversible` is enforced: the CLI refuses to
   * run it without `--yes`, and `storeship state` never suggests one. It is a
   * field rather than a sentence in a skill so an agent can query it.
   */
  impact?: Impact
  needs?: Need[]
  /** Decisions this command must not make on its own; `spec` publishes them. */
  humanDecisions?: string[]
  /** Why an `irreversible` command cannot be undone. Printed when `--yes` is missing. */
  confirm?: string
  run: (ctx: Ctx) => Promise<void>
  sub?: Command[]
}
