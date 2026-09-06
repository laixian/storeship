/**
 * Error text → the real cause.
 *
 * Each entry here is a message that was chased in the wrong direction at least
 * once. The pattern is deliberately loose (a substring of Apple's wording);
 * the hint says what is actually going on and what to do, in one breath.
 */
export type Hint = { test: RegExp; hint: string }

export const HINTS: Hint[] = [
  {
    test: /NOT_AUTHORIZED|Authentication credentials are missing or invalid/i,
    hint:
      'Apple returns a bare 401 for all of: wrong key id or issuer id, a revoked key, a .p8 that does not belong to that key id, ' +
      'a DER-encoded signature (storeship signs raw R||S), or a clock more than 5 minutes off. ' +
      'Check ASC_KEY_ID / ASC_ISSUER_ID and that the .p8 file matches the key id.',
  },
  {
    test: /The API key in use does not allow this request/i,
    hint:
      "The key's role is too low for this endpoint. Analytics reports need an Admin key; sales and finance reports need Admin or Sales/Finance. " +
      'Create a second key with that role and pass ASC_KEY_ID / ASC_KEY_PATH for this command only — leave the release key alone.',
  },
  {
    test: /pre-release build could not be added/i,
    hint: 'The build is uploaded but not processed yet (processingState is not VALID). Wait a few minutes, or use `storeship version attach <ver> --wait`.',
  },
  {
    test: /ICP_NUMBER_MIIT_PROVIDER_NAME_MISMATCH/,
    hint:
      "China mainland ICP filing: the filer's name on record with MIIT does not match your Apple developer name. " +
      'This cannot be read or changed through the API; fix it in App Store Connect (App Information → China mainland ICP) and at the cloud provider that filed it.',
  },
  {
    test: /Cloud signing permission error|No signing certificate "iOS Distribution" found/i,
    hint:
      'Misleading message. xcodebuild switched to cloud signing, which happens when -authenticationKey* flags are passed to -exportArchive and the key lacks that permission. ' +
      'storeship never passes them. If you ran xcodebuild by hand, drop those three flags and keep only -allowProvisioningUpdates: Xcode creates the distribution certificate at export time, so it is expected that you cannot find one beforehand.',
  },
  {
    test: /ENTITY_STATE_INVALID|not in an editable state|STATE_ERROR/,
    hint:
      'The version is read-only in its current state (waiting for review / in review). `storeship version cancel` unlocks it, at the cost of the review queue position. ' +
      'If this came from a submit, read the associated errors above: account-level validations show up here too.',
  },
  {
    test: /Could not find the API key|private_keys/i,
    hint:
      'altool only looks in ./private_keys, ~/private_keys, ~/.private_keys and ~/.appstoreconnect/private_keys. Put AuthKey_<KEY_ID>.p8 in one of those.',
  },
  {
    test: /ATTRIBUTE\.NOT_ALLOWED/,
    hint:
      'This attribute can only be set at creation (autoRenewEnabled on offer codes is the usual one). Create a new object with the right value and deactivate the old one.',
  },
  {
    test: /Start request repeated too quickly/,
    hint: 'systemd rate limit after a crash loop; the real fault is earlier in the journal. `systemctl reset-failed <unit>` before restarting.',
  },
  {
    test: /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/,
    hint: 'Node refuses to strip types from .ts files inside node_modules. Run storeship from a path outside node_modules (pnpm workspace links are fine) or install a published build.',
  },
]

export function hintFor(text: string): string | undefined {
  return HINTS.find((h) => h.test.test(text))?.hint
}
