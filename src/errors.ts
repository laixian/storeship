/**
 * One error type for everything the CLI reports on purpose.
 *
 * Three fields earn their place beside the message. `code` is what an agent
 * branches on — the message is English prose that may change, the code may
 * not. `hint` is the real cause, because most failures on this path arrive
 * with a message that points the wrong way (see hints.ts). `retry` says
 * whether running the same command again can possibly help.
 *
 * The CLI prints message, hint and code, and exits with the code's exit
 * status (see codes.ts).
 */
import { CODES, type ErrorCode, type Retry } from './codes.ts'

export type ErrorInit = {
  code?: ErrorCode
  /** Overrides the code's default exit status. */
  exitCode?: number
  retry?: Retry
  /** What a person has to do; set only when no flag or command can do it. */
  humanAction?: string
}

export class StoreshipError extends Error {
  readonly code: ErrorCode
  readonly hint?: string
  readonly retry: Retry
  readonly humanAction?: string
  readonly exitCode: number
  constructor(message: string, hint?: string, init: ErrorInit = {}) {
    super(message)
    this.name = 'StoreshipError'
    this.code = init.code ?? 'UNKNOWN'
    this.hint = hint
    this.retry = init.retry ?? CODES[this.code].retry
    this.humanAction = init.humanAction
    this.exitCode = init.exitCode ?? CODES[this.code].exit
  }

  /** The `error` object of the JSON envelope. */
  toJSON(): { code: ErrorCode; message: string; hint: string | null; retry: Retry; humanAction: string | null } {
    return { code: this.code, message: this.message, hint: this.hint ?? null, retry: this.retry, humanAction: this.humanAction ?? null }
  }
}

export class UsageError extends StoreshipError {
  constructor(message: string, hint?: string) {
    super(message, hint, { code: 'USAGE' })
    this.name = 'UsageError'
  }
}

export class ConfigError extends StoreshipError {
  constructor(message: string, hint?: string) {
    super(message, hint, { code: 'CONFIG' })
    this.name = 'ConfigError'
  }
}

/**
 * A person has to act, and no flag can stand in for them: a GUI action, a
 * secret, or a step whose consequences are theirs to accept. Exits 5 so an
 * agent can stop on the exit code alone.
 */
export class NeedsHuman extends StoreshipError {
  constructor(message: string, humanAction: string, hint?: string) {
    super(message, hint, { code: 'NEEDS_HUMAN', humanAction })
    this.name = 'NeedsHuman'
  }
}

/** An offline validation said no. Exits 3: a result, not a failure. */
export class CheckFailed extends StoreshipError {
  constructor(message: string, hint?: string) {
    super(message, hint, { code: 'CHECK_FAILED' })
    this.name = 'CheckFailed'
  }
}

/** Turn anything thrown into a StoreshipError without losing what it was. */
export function asStoreshipError(e: unknown): StoreshipError {
  if (e instanceof StoreshipError) return e
  const err = new StoreshipError(e instanceof Error ? e.message : String(e))
  if (e instanceof Error && e.stack) err.stack = e.stack
  return err
}
