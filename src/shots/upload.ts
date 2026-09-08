/**
 * Push rendered screenshots into App Store Connect by display type, so
 * nobody has to copy set ids around. Existing files with the same name are
 * kept unless `replace`; new files are appended in store order.
 */
import { basename } from 'node:path'
import type { AscClient } from '../asc/client.ts'
import { createScreenshotSet, deleteMedia, setItems, uploadMedia } from '../asc/media.ts'
import { requireVersion, versionLocalizations } from '../asc/versions.ts'
import { StoreshipError } from '../errors.ts'

export type UploadPlan = { locale: string; displayType: string; setId: string; created: boolean; files: string[]; skipped: string[]; deleted: number }

export async function uploadShots(
  c: AscClient,
  appId: string,
  version: string,
  groups: { locale: string; displayType: string; files: string[] }[],
  opts: { replace?: boolean; dryRun?: boolean; onFile?: (f: string) => void } = {},
): Promise<UploadPlan[]> {
  const v = await requireVersion(c, appId, version)
  const locs = await versionLocalizations(c, v.id)
  const plans: UploadPlan[] = []
  for (const g of groups) {
    const loc = locs.find((l) => l.locale === g.locale)
    if (!loc) throw new StoreshipError(`${g.locale} is not a localization of ${version}`, 'add the language in App Store Connect → App Information first', { code: 'NOT_FOUND' })
    const sets = await c.all(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`)
    let set = sets.find((s: any) => s.attributes.screenshotDisplayType === g.displayType)
    let created = false
    let setId: string
    if (set) setId = set.id
    else if (opts.dryRun) setId = '(new)'
    else {
      setId = await createScreenshotSet(c, loc.id, g.displayType)
      created = true
    }
    const existing = set ? await setItems(c, 'screenshot', setId) : []
    let deleted = 0
    if (opts.replace && existing.length && !opts.dryRun) {
      for (const it of existing) await deleteMedia(c, 'screenshot', it.id)
      deleted = existing.length
    }
    const have = new Set(opts.replace ? [] : existing.map((e) => e.fileName))
    const files: string[] = []
    const skipped: string[] = []
    for (const f of g.files) {
      if (have.has(basename(f))) {
        skipped.push(f)
        continue
      }
      files.push(f)
      if (!opts.dryRun) {
        await uploadMedia(c, 'screenshot', setId, f)
        opts.onFile?.(f)
      }
    }
    plans.push({ locale: g.locale, displayType: g.displayType, setId, created, files, skipped, deleted })
  }
  return plans
}
