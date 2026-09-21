import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Config } from '../config.ts'
import { StoreshipError } from '../errors.ts'
import { mergeDevices } from './devices.ts'
import { expand } from './layout.ts'
import * as styleKit from './styles/common.ts'
import { DEFAULT_STYLE, STYLES, extendStyle, resolveTheme } from './styles/index.ts'
import type { Device, ShotsContent, Slot, Style } from './types.ts'

export type ShotsSetup = {
  content: ShotsContent
  style: Style
  theme: Record<string, string | number>
  slots: Slot[]
  devices: Record<string, Device>
  /** Device ids to render by default. */
  deviceIds: string[]
  locales: string[]
  src: string
  out: string
  tmp: string
  /** Locale code → tag used in filenames (default: the code itself). */
  tag: (locale: string) => string
  srcFile: (d: Device, locale: string, stem: string) => string
  outFile: (d: Device, locale: string, slot: Slot) => string
}

async function importModule(file: string): Promise<any> {
  if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'))
  return import(pathToFileURL(file).href)
}

const MIGRATE = 'the shots/cards/template format was removed in 0.4 — export { style, frames } instead; see docs/media.md#screenshots'

export async function resolveStyle(spec: string | Style | undefined, base: string): Promise<Style> {
  if (spec === undefined) return STYLES[DEFAULT_STYLE]!
  if (typeof spec === 'object') return spec
  if (STYLES[spec]) return STYLES[spec]!
  if (!/[./]/.test(spec)) throw new StoreshipError(`unknown style "${spec}"`, `built in: ${Object.keys(STYLES).join(', ')}; or a path to a module exporting a Style`, { code: 'CONFIG' })
  const file = resolve(base, spec)
  if (!existsSync(file)) throw new StoreshipError(`style module not found: ${file}`, undefined, { code: 'CONFIG' })
  const m = await importModule(file)
  const exp = m.default ?? m.style
  const st = typeof exp === 'function' ? exp({ extendStyle, STYLES, styleKit }) : exp
  if (!st || typeof st.header !== 'function' || typeof st.backdrop !== 'function') throw new StoreshipError(`${spec} must export a Style, or a function ({ extendStyle, STYLES, styleKit }) => Style`, undefined, { code: 'CHECK_FAILED' })
  return st
}

export async function loadShots(cfg: Config): Promise<ShotsSetup> {
  const s = cfg.shots
  const contentFile = s.content
  if (!contentFile || !existsSync(contentFile)) throw new StoreshipError(`shots content file not found: ${contentFile ?? '(unset)'}`, 'set shots.content in storeship.config.json (a .ts/.js/.json exporting { style, frames, brand?, theme?, devices? })', { code: 'CONFIG' })
  if ((s as { template?: string }).template) throw new StoreshipError('shots.template is no longer read', MIGRATE, { code: 'CONFIG' })
  const mod = await importModule(contentFile)
  const raw = mod.default ?? mod
  if (Array.isArray(raw) || raw.shots || mod.shots) throw new StoreshipError(`${contentFile} uses the old shots format`, MIGRATE, { code: 'CONFIG' })
  const content = raw as ShotsContent
  if (!Array.isArray(content.frames)) throw new StoreshipError(`${contentFile} does not export frames`, 'export default { style, frames: [...] }', { code: 'CHECK_FAILED' })

  const style = await resolveStyle(content.style, dirname(contentFile))
  const devices = mergeDevices(content.devices)
  const deviceIds = s.devices ?? ['iphone69']
  for (const id of deviceIds) if (!devices[id]) throw new StoreshipError(`unknown device "${id}"`, `known: ${Object.keys(devices).join(', ')}`, { code: 'CONFIG' })
  const locales = s.locales ?? cfg.locales
  if (!locales.length) throw new StoreshipError('no locales', 'set locales (or shots.locales) in storeship.config.json', { code: 'CONFIG' })
  const tags = s.localeTags ?? {}
  const tag = (l: string): string => tags[l] ?? l
  const src = s.src ?? resolve(cfg.root, 'store/screenshots')
  const out = s.out ?? resolve(cfg.root, 'store/shots')
  return {
    content,
    style,
    theme: resolveTheme(style, content.theme),
    slots: expand(content.frames),
    devices,
    deviceIds,
    locales,
    src,
    out,
    tmp: join(tmpdir(), 'storeship-shots'),
    tag,
    srcFile: (d, locale, stem) => join(src, `${d.prefix}-${tag(locale)}-${stem}.png`),
    outFile: (d, locale, slot) => join(out, `${d.prefix}-${tag(locale)}-${slot.n}-${slot.frame.slug}.png`),
  }
}
