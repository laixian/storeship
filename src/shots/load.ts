import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Config } from '../config.ts'
import { StoreshipError } from '../errors.ts'
import { defaultTemplate } from './defaultTemplate.ts'
import { mergeDevices } from './devices.ts'
import type { Device, Shot, ShotsContent, Template } from './types.ts'

export type ShotsSetup = {
  content: ShotsContent
  template: Template
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
  outFile: (d: Device, locale: string, shot: Shot) => string
}

async function importModule(file: string): Promise<any> {
  if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'))
  return import(pathToFileURL(file).href)
}

export async function loadShots(cfg: Config): Promise<ShotsSetup> {
  const s = cfg.shots
  const contentFile = s.content
  if (!contentFile || !existsSync(contentFile)) throw new StoreshipError(`shots content file not found: ${contentFile ?? '(unset)'}`, 'set shots.content in storeship.config.json (a .ts/.js/.json exporting { shots, devices?, template? } or a Shot[])')
  const mod = await importModule(contentFile)
  const raw = mod.default ?? mod.shots ?? mod.SHOTS ?? mod
  const content: ShotsContent = Array.isArray(raw) ? { shots: raw } : { shots: raw.shots ?? mod.shots ?? mod.SHOTS, devices: raw.devices ?? mod.devices, template: raw.template ?? mod.template }
  if (!Array.isArray(content.shots)) throw new StoreshipError(`${contentFile} does not export a shots array`)

  let template: Template = content.template ?? defaultTemplate
  if (s.template) {
    if (!existsSync(s.template)) throw new StoreshipError(`shots template not found: ${s.template}`)
    const t = await importModule(s.template)
    template = t.default ?? t.template ?? (typeof t.render === 'function' ? t : undefined)
    if (!template || typeof template.render !== 'function') throw new StoreshipError(`${s.template} must export a template with render(ctx)`)
  }

  const devices = mergeDevices(content.devices)
  const deviceIds = s.devices ?? [...new Set(content.shots.flatMap((sh) => Object.keys(sh.cards ?? {})))].filter((id) => devices[id])
  for (const id of deviceIds) if (!devices[id]) throw new StoreshipError(`unknown device "${id}"`, `known: ${Object.keys(devices).join(', ')}`)
  const locales = s.locales ?? cfg.locales
  if (!locales.length) throw new StoreshipError('no locales', 'set locales (or shots.locales) in storeship.config.json')
  const tags = s.localeTags ?? {}
  const tag = (l: string): string => tags[l] ?? l
  const src = s.src ?? resolve(cfg.root, 'store/screenshots')
  const out = s.out ?? resolve(cfg.root, 'store/shots')
  return {
    content,
    template,
    devices,
    deviceIds,
    locales,
    src,
    out,
    tmp: join(tmpdir(), 'storeship-shots'),
    tag,
    srcFile: (d, locale, stem) => join(src, `${d.prefix}-${tag(locale)}-${stem}.png`),
    outFile: (d, locale, shot) => join(out, `${d.prefix}-${tag(locale)}-${shot.n}-${shot.slug}.png`),
  }
}
