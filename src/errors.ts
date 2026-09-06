/**
 * One error type for everything the CLI reports on purpose.
 *
 * `hint` is the part that earns its place: most of the failures this tool
 * meets come with a message that points the wrong way (see hints.ts), so the
 * hint is where the real cause goes. The CLI prints message and hint, exits 1.
 */
export class StoreshipError extends Error {
  readonly hint?: string
  readonly exitCode: number
  constructor(message: string, hint?: string, exitCode = 1) {
    super(message)
    this.hint = hint
    this.exitCode = exitCode
    this.name = 'StoreshipError'
  }
}

export class UsageError extends StoreshipError {
  constructor(message: string, hint?: string) {
    super(message, hint, 2)
    this.name = 'UsageError'
  }
}

export class ConfigError extends StoreshipError {
  constructor(message: string, hint?: string) {
    super(message, hint, 2)
    this.name = 'ConfigError'
  }
}
