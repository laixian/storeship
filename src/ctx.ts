import { Args } from './args.ts'
import { type AscClient, createClient } from './asc/client.ts'
import { type Config, HOW, need } from './config.ts'
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
}

export type Command = {
  name: string
  summary: string
  usage?: string
  booleans?: string[]
  run: (ctx: Ctx) => Promise<void>
  sub?: Command[]
}
