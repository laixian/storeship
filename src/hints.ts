/**
 * Error text → the real cause, as data.
 *
 * Each entry here is a message that was chased in the wrong direction at least
 * once. The pattern is deliberately loose (a substring of Apple's wording); the
 * hint says what is actually going on and what to do, in one breath.
 *
 * Every entry carries a `code` from codes.ts, which is what an agent branches
 * on, and the code decides the exit status and whether a retry can help. The
 * bar for a new entry is unchanged: it really happened, and the message really
 * pointed the wrong way. Imagined traps do not go here.
 */
import type { ErrorCode } from './codes.ts'

export type Hint = {
  code: ErrorCode
  test: RegExp
  hint: string
  /** Set only when no command can fix it — the CLI reports it and stops with exit 5. */
  humanAction?: string
}

export const HINTS: Hint[] = [
  {
    code: 'AUTH',
    test: /NOT_AUTHORIZED|Authentication credentials are missing or invalid/i,
    hint:
      'Apple returns a bare 401 for all of: wrong key id or issuer id, a revoked key, a .p8 that does not belong to that key id, ' +
      'a DER-encoded signature (storeship signs raw R||S), or a clock more than 5 minutes off. ' +
      'Check ASC_KEY_ID / ASC_ISSUER_ID and that the .p8 file matches the key id.',
  },
  {
    code: 'KEY_ROLE',
    test: /The API key in use does not allow this request/i,
    hint:
      "The key's role is too low for this endpoint. Analytics reports need an Admin key; sales and finance reports need Admin or Sales/Finance. " +
      'Create a second key with that role and pass ASC_KEY_ID / ASC_KEY_PATH for this command only — leave the release key alone.',
  },
  {
    code: 'BUILD_NOT_PROCESSED',
    test: /pre-release build could not be added/i,
    hint:
      'Either the build is not processed yet (processingState is not VALID), or the build picked is an older one that already belongs to another version — a fresh upload takes minutes to show up in the list at all. ' +
      'Wait, and name the build: `storeship version attach <ver> --build <N> --wait`.',
  },
  {
    code: 'ICP_MISMATCH',
    test: /ICP_NUMBER_MIIT_PROVIDER_NAME_MISMATCH/,
    hint:
      "China mainland ICP filing: the filer's name on record with MIIT does not match your Apple developer name. " +
      'This cannot be read or changed through the API.',
    humanAction: 'Fix it in App Store Connect (App Information → China mainland ICP) and at the cloud provider that filed it; no command can do this.',
  },
  {
    code: 'XCODE_NO_ACCOUNT',
    test: /No Accounts/,
    hint:
      'Xcode has no Apple ID signed in, so -allowProvisioningUpdates cannot fetch the distribution certificate (the "No signing certificate" line next to it is a consequence, not the cause). ' +
      'The archive itself is fine — after signing in, resume with `storeship export <path.xcarchive>` or `storeship release <version> --archive <path.xcarchive>`; do not archive again.',
    humanAction: 'Open Xcode → Settings → Accounts and sign in with the developer account (sessions expire; an Xcode update can drop them). This is a GUI action.',
  },
  {
    code: 'CLOUD_SIGNING',
    test: /Cloud signing permission error|No signing certificate "iOS Distribution" found/i,
    hint:
      'Misleading message. xcodebuild switched to cloud signing, which happens when -authenticationKey* flags are passed to -exportArchive and the key lacks that permission. ' +
      'storeship never passes them. If you ran xcodebuild by hand, drop those three flags and keep only -allowProvisioningUpdates: Xcode creates the distribution certificate at export time, so it is expected that you cannot find one beforehand.',
  },
  {
    code: 'PRICING_INVALID',
    test: /An error occurred while processing the pricing information/i,
    hint:
      'Apple says nothing more, but two things cause it: the subscription has no availability yet (territories must be set before any price — `storeship products push` does that first), ' +
      "or the price point is not one of that subscription's tiers (`storeship products pricepoints <productId> <TERRITORY>`).",
  },
  {
    code: 'VERSION_NOT_EDITABLE',
    test: /ENTITY_STATE_INVALID|not in an editable state|STATE_ERROR/,
    hint:
      'The version is read-only in its current state — but only WAITING_FOR_REVIEW / IN_REVIEW are: `storeship version cancel` unlocks those, at the cost of the queue position. ' +
      'A version Apple REJECTED is already editable, so do not cancel it: fix the metadata and `version submit` again. ' +
      'If this came from a submit, read the associated errors above: account-level validations show up here too.',
  },
  {
    code: 'ALTOOL_KEY_NOT_FOUND',
    test: /Could not find the API key|private_keys/i,
    hint:
      'altool only looks in ./private_keys, ~/private_keys, ~/.private_keys and ~/.appstoreconnect/private_keys. Put AuthKey_<KEY_ID>.p8 in one of those.',
  },
  {
    code: 'ATTRIBUTE_IMMUTABLE',
    test: /ATTRIBUTE\.NOT_ALLOWED/,
    hint:
      'This attribute can only be set at creation (autoRenewEnabled on offer codes is the usual one). Create a new object with the right value and deactivate the old one.',
  },
  {
    code: 'NODE_TS_STRIPPING',
    test: /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/,
    hint: 'Node refuses to strip types from .ts files inside node_modules. Run storeship from a path outside node_modules (pnpm workspace links are fine) or install a published build.',
  },
]

/** The matching entry, or undefined. */
export function hintFor(text: string): Hint | undefined {
  return HINTS.find((h) => h.test.test(text))
}

/** Just the prose, for callers that only want to print something. */
export function hintTextFor(text: string): string | undefined {
  return hintFor(text)?.hint
}
