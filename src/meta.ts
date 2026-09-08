/** The package's own name and version, in one place both `cli.ts` and `out.ts` can read without a cycle. */
import { createRequire } from 'node:module'

export const NAME = 'storeship'
/** Read at run time so `npm version` is the only place the number lives; src/ and dist/ both sit one level under the package root. */
export const VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version
/** The shape of `--json`. Bumped when the envelope changes in a way that breaks a reader. */
export const PROTOCOL = 1
