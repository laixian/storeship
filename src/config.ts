/**
 * Configuration: one file in the repo (`storeship.config.{ts,mjs,js,json}`)
 * plus environment overrides for the credentials.
 *
 * Identifiers (app id, key id, issuer id, team id) are not secrets and belong
 * in the committed file. The only secret is the `.p8`, which lives outside the
 * repo at altool's own convention (`~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`)
 * so there is one place to put it for both this tool and Apple's.
 *
 * Every relative path in the file resolves from the file's directory, never
 * from the shell's cwd — commands must work from any subdirectory.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ConfigError } from './errors.ts'

export type RawConfig = {
  app?: { id?: string; bundleId?: string; name?: string }
  asc?: { keyId?: string; issuerId?: string; keyPath?: string; teamId?: string }
  /** ASC locale codes in the order you think about them, e.g. ["zh-Hans", "en-US"]. */
  locales?: string[]
  ios?: {
    /** Directory holding app.config.* / app.json and `ios/`. Default: the config file's directory. */
    projectDir?: string
    /** Path to the .xcworkspace. Default: the first one under `<projectDir>/ios`. */
    workspace?: string
    /** Default: the workspace's basename without extension. */
    scheme?: string
    /** Default: `<projectDir>/ios/<scheme>/Info.plist`. */
    infoPlist?: string
    configuration?: string
    /** Where .xcarchive bundles go. Default: Xcode's own Archives folder, so Organizer sees them. */
    archiveDir?: string
    /** Extra keys merged into the generated ExportOptions.plist. */
    exportOptions?: Record<string, unknown>
    /** Set false for a bare native project; default: auto-detect app.config.* / app.json. */
    expo?: boolean
  }
  listing?: { file?: string }
  whatsNew?: { dir?: string }
  release?: {
    /** Time of day + UTC offset used for scheduled releases, e.g. "08:00:00-07:00". */
    scheduledTime?: string
  }
  /** Subscription aliases → ASC subscription ids, for `offer` commands. */
  products?: Record<string, string>
}

export type Config = {
  root: string
  file?: string
  app: { id?: string; bundleId?: string; name?: string }
  asc: { keyId?: string; issuerId?: string; keyPath?: string; teamId?: string }
  locales: string[]
  ios: {
    projectDir: string
    workspace?: string
    scheme?: string
    infoPlist?: string
    configuration: string
    archiveDir: string
    exportOptions: Record<string, unknown>
    expo?: boolean
  }
  listing: { file: string }
  whatsNew: { dir: string }
  release: { scheduledTime: string }
  products: Record<string, string>
}

export const CONFIG_NAMES = [
  'storeship.config.ts',
  'storeship.config.mjs',
  'storeship.config.js',
  'storeship.config.json',
]

export function defaultKeyPath(keyId: string, home = homedir()): string {
  return join(home, '.appstoreconnect', 'private_keys', `AuthKey_${keyId}.p8`)
}

/** Walk up from `from` until a config file is found. */
export function findConfigFile(from: string): string | undefined {
  let dir = resolve(from)
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const p = join(dir, name)
      if (existsSync(p)) return p
    }
    const up = dirname(dir)
    if (up === dir) return undefined
    dir = up
  }
}

const rel = (root: string, p: string | undefined): string | undefined =>
  p === undefined ? undefined : isAbsolute(p) ? p : resolve(root, p)

/** Pure: merge a raw file with the environment into a fully-defaulted config. */
export function resolveConfig(
  raw: RawConfig,
  root: string,
  env: Record<string, string | undefined> = {},
  file?: string,
  home = homedir(),
): Config {
  const keyId = env.ASC_KEY_ID ?? raw.asc?.keyId
  const projectDir = rel(root, raw.ios?.projectDir) ?? root
  return {
    root,
    file,
    app: {
      id: env.ASC_APP_ID ?? raw.app?.id,
      bundleId: raw.app?.bundleId,
      name: raw.app?.name,
    },
    asc: {
      keyId,
      issuerId: env.ASC_ISSUER_ID ?? raw.asc?.issuerId,
      keyPath: rel(root, env.ASC_KEY_PATH ?? raw.asc?.keyPath) ?? (keyId ? defaultKeyPath(keyId, home) : undefined),
      teamId: env.ASC_TEAM_ID ?? raw.asc?.teamId,
    },
    locales: raw.locales ?? [],
    ios: {
      projectDir,
      workspace: rel(root, raw.ios?.workspace),
      scheme: raw.ios?.scheme,
      infoPlist: rel(root, raw.ios?.infoPlist),
      configuration: raw.ios?.configuration ?? 'Release',
      archiveDir: rel(root, raw.ios?.archiveDir) ?? join(home, 'Library', 'Developer', 'Xcode', 'Archives'),
      exportOptions: raw.ios?.exportOptions ?? {},
      expo: raw.ios?.expo,
    },
    listing: { file: rel(root, raw.listing?.file) ?? resolve(root, 'store-listing.md') },
    whatsNew: { dir: rel(root, raw.whatsNew?.dir) ?? resolve(root, 'whats-new') },
    release: { scheduledTime: raw.release?.scheduledTime ?? '00:00:00Z' },
    products: raw.products ?? {},
  }
}

export async function loadConfig(opts: { cwd: string; file?: string; env?: Record<string, string | undefined> }): Promise<Config> {
  const env = opts.env ?? process.env
  const file = opts.file ? resolve(opts.cwd, opts.file) : findConfigFile(opts.cwd)
  if (!file) return resolveConfig({}, resolve(opts.cwd), env)
  if (!existsSync(file)) throw new ConfigError(`config file not found: ${file}`)
  let raw: RawConfig
  if (file.endsWith('.json')) {
    try {
      raw = JSON.parse(readFileSync(file, 'utf8')) as RawConfig
    } catch (e) {
      throw new ConfigError(`${file}: ${(e as Error).message}`)
    }
  } else {
    const mod = (await import(pathToFileURL(file).href)) as { default?: RawConfig }
    raw = mod.default ?? (mod as RawConfig)
  }
  return resolveConfig(raw, dirname(file), env, file)
}

/** Insist on a value, saying where it comes from when it is missing. */
export function need<T>(value: T | undefined, what: string, how: string): T {
  if (value === undefined || value === '') throw new ConfigError(`${what} is not configured`, how)
  return value
}

export const HOW = {
  appId: 'set app.id in storeship.config.json (run `storeship init` to look it up by bundle id) or export ASC_APP_ID',
  keyId: 'set asc.keyId in storeship.config.json or export ASC_KEY_ID',
  issuerId: 'set asc.issuerId in storeship.config.json or export ASC_ISSUER_ID',
  teamId: 'set asc.teamId in storeship.config.json or export ASC_TEAM_ID',
  locales: 'set locales in storeship.config.json, e.g. ["en-US"]',
}
