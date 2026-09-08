/**
 * The agent contract: what a failure is called and what an exit code means.
 *
 * Both tables are part of the published interface — `storeship spec --json`
 * emits them, `docs/agents.md` documents them, and the skills branch on them.
 * An agent must never have to match English prose to decide what to do next,
 * so every failure this tool reports on purpose carries a `code` from here.
 */

/**
 * Exit codes. 0/1/2 are the usual shell meanings; 3–5 split "the command ran
 * and the answer is no" from "it failed" from "only a human can continue",
 * because those three call for completely different behaviour from an agent.
 */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  no: 3,
  pending: 4,
  human: 5,
  aborted: 130,
} as const

export type ExitName = keyof typeof EXIT

export const EXIT_MEANING: { code: number; name: ExitName; meaning: string; agent: string }[] = [
  { code: 0, name: 'ok', meaning: 'the command did what it says', agent: 'continue' },
  { code: 1, name: 'error', meaning: 'the command failed', agent: 'read error.code and error.retry; do not repeat a `never`' },
  { code: 2, name: 'usage', meaning: 'the command line was wrong', agent: 'fix the command, never retry it unchanged' },
  { code: 3, name: 'no', meaning: 'it ran, and the answer is negative: rejected, over limit, out of date, something differs', agent: 'branch on the data; this is a result, not a failure' },
  { code: 4, name: 'pending', meaning: 'no verdict yet: still processing, still in review, still building', agent: 'wait and ask again; the answer will change on its own' },
  { code: 5, name: 'human', meaning: 'only a person can continue: a GUI action, a secret, or an irreversible step', agent: 'stop and tell the human exactly what error.humanAction says' },
  { code: 130, name: 'aborted', meaning: 'a person answered no at a confirmation', agent: 'stop' },
]

/** What a caller should do about an error. */
export type Retry = 'now' | 'after-wait' | 'never'

export type CodeMeta = { exit: number; retry: Retry; about: string }

/**
 * Every code the CLI can put in `error.code`. Adding one is adding to the
 * published contract: it belongs here, not inline at a throw site.
 */
export const CODES = {
  UNKNOWN: { exit: EXIT.error, retry: 'never', about: 'an error this tool did not recognise; the message is raw' },
  USAGE: { exit: EXIT.usage, retry: 'never', about: 'wrong arguments or flags' },
  CONFIG: { exit: EXIT.usage, retry: 'never', about: 'the config file or an identifier it should hold is missing' },
  NEEDS_HUMAN: { exit: EXIT.human, retry: 'never', about: 'a confirmation, a secret, or a GUI action that no flag can supply' },
  ABORTED: { exit: EXIT.aborted, retry: 'never', about: 'a person answered no' },
  CHECK_FAILED: { exit: EXIT.no, retry: 'never', about: 'an offline validation found problems; nothing was written' },
  DIFFERS: { exit: EXIT.no, retry: 'never', about: 'the files and App Store Connect do not agree; nothing was written' },
  PREFLIGHT: { exit: EXIT.error, retry: 'never', about: 'the project on disk is not what you asked to build (prebuild, version, bundle id)' },
  NOT_FOUND: { exit: EXIT.error, retry: 'never', about: 'the object does not exist in App Store Connect' },
  TIMEOUT: { exit: EXIT.pending, retry: 'after-wait', about: 'gave up waiting; the thing being waited for may still arrive' },
  MISSING_TOOL: { exit: EXIT.error, retry: 'never', about: 'something this command needs from outside is not there (Chrome, ffmpeg, idb, Xcode, a booted simulator)' },
  PENDING: { exit: EXIT.pending, retry: 'after-wait', about: 'it exists but is not ready yet; asking later gives a different answer' },
  API: { exit: EXIT.error, retry: 'never', about: "App Store Connect refused, and the reason is only in Apple's message" },
  AUTH: { exit: EXIT.error, retry: 'never', about: 'Apple rejected the API key' },
  KEY_ROLE: { exit: EXIT.error, retry: 'never', about: "the key's role is too low for this endpoint" },
  KEY_MISSING: { exit: EXIT.human, retry: 'never', about: 'the .p8 is not where it should be, and it can only be downloaded once' },
  ALTOOL_KEY_NOT_FOUND: { exit: EXIT.error, retry: 'never', about: 'altool looks for the .p8 in its own four directories and found none' },
  BUILD_NOT_PROCESSED: { exit: EXIT.pending, retry: 'after-wait', about: 'the build is not VALID yet, or is not listed yet' },
  VERSION_NOT_EDITABLE: { exit: EXIT.error, retry: 'never', about: 'the version is read-only in its current state' },
  XCODE_NO_ACCOUNT: { exit: EXIT.human, retry: 'never', about: 'Xcode has no Apple ID signed in, so export cannot fetch the certificate' },
  CLOUD_SIGNING: { exit: EXIT.error, retry: 'never', about: 'xcodebuild switched to cloud signing; the message names the wrong cause' },
  ICP_MISMATCH: { exit: EXIT.human, retry: 'never', about: 'a China mainland ICP filing mismatch, fixable only outside the API' },
  PRICING_INVALID: { exit: EXIT.error, retry: 'never', about: 'the price point or the availability behind it is not valid for that subscription' },
  ATTRIBUTE_IMMUTABLE: { exit: EXIT.error, retry: 'never', about: 'the attribute can only be set when the object is created' },
  NODE_TS_STRIPPING: { exit: EXIT.error, retry: 'never', about: 'Node refuses to run .ts from inside node_modules' },
} as const satisfies Record<string, CodeMeta>

export type ErrorCode = keyof typeof CODES

export const codeMeta = (code: ErrorCode): CodeMeta => CODES[code]
