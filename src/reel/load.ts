import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { Config } from '../config.ts'
import { StoreshipError } from '../errors.ts'
import { defaultReelTemplate } from './defaultTemplate.ts'
import type { ReelContent, ReelTemplate } from './types.ts'

async function mod(file: string): Promise<any> {
  if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'))
  return import(pathToFileURL(file).href)
}

export async function loadReel(cfg: Config): Promise<{ content: ReelContent; template: ReelTemplate }> {
  const f = cfg.reel.content
  if (!f || !existsSync(f)) throw new StoreshipError(`reel content not found: ${f ?? '(unset)'}`, 'set reel.content in storeship.config.json (a .ts/.js/.json exporting { canvas, band, crop?, copy })', { code: 'CONFIG' })
  const m = await mod(f)
  const content: ReelContent = m.default ?? m.content ?? m
  for (const k of ['canvas', 'band'] as const) if (!content[k]) throw new StoreshipError(`${f}: missing "${k}"`, undefined, { code: 'CHECK_FAILED' })
  let template: ReelTemplate = m.template ?? defaultReelTemplate
  if (cfg.reel.template) {
    if (!existsSync(cfg.reel.template)) throw new StoreshipError(`reel template not found: ${cfg.reel.template}`, undefined, { code: 'CONFIG' })
    const t = await mod(cfg.reel.template)
    template = t.default ?? t.template ?? t
    if (typeof template.render !== 'function') throw new StoreshipError(`${cfg.reel.template} must export a template with render(ctx)`, undefined, { code: 'CHECK_FAILED' })
  }
  return { content, template }
}
