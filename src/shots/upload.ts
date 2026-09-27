/**
 * Push rendered screenshots into App Store Connect by display type, so
 * nobody has to copy set ids around. Existing files with the same name are
 * kept unless `replace`; new files are appended in store order.
 *
 * `replace` makes the set equal to the local files, and is safe to run again
 * after it died halfway (2026-09-28, Apple 500s on DELETE): the leading items
 * that already are the right files — same name, same MD5, same position,
 * processed — stay, and only the rest is deleted and uploaded. Without that a
 * rerun wiped the set it had just finished and went on to fail on the next one.
 */
import { basename } from 'node:path'
import type { AscClient } from '../asc/client.ts'
import { createScreenshotSet, deleteMedia, isBroken, md5Of, setItems, uploadMedia } from '../asc/media.ts'
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
    let have: Set<string>
    if (opts.replace) {
      const keep = matchingPrefix(existing, g.files)
      const doomed = existing.slice(keep)
      if (!opts.dryRun) for (const it of doomed) await deleteMedia(c, 'screenshot', it.id)
      deleted = doomed.length
      have = new Set(g.files.slice(0, keep).map((f) => basename(f)))
    } else {
      const broken = existing.filter((e) => isBroken(e.state))
      if (!opts.dryRun) for (const it of broken) await deleteMedia(c, 'screenshot', it.id)
      deleted = broken.length
      have = new Set(existing.filter((e) => !isBroken(e.state)).map((e) => e.fileName))
    }
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

/**
 * How many leading items of the set already are the leading local files.
 * Stops at the first difference: everything after it is out of order at best,
 * and the store shows screenshots in set order.
 * ⚠️ Same name is not enough — a re-shot frame keeps its file name
 * (`…-8-home.png`), so the MD5 decides.
 */
export function matchingPrefix(existing: { fileName: string; state: string; checksum?: string }[], files: string[]): number {
  let n = 0
  while (n < existing.length && n < files.length) {
    const e = existing[n]!
    const f = files[n]!
    if (e.fileName !== basename(f) || e.state !== 'COMPLETE' || !e.checksum || e.checksum !== md5Of(f)) break
    n++
  }
  return n
}
