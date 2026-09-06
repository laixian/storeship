/**
 * Screenshots and app previews: status per locale × device slot, upload
 * (reserve → chunked PUT → commit with checksum), create slots.
 *
 * ⚠️ `sourceFileChecksum` is MD5 of the whole file. A wrong value fails
 * validation silently after UPLOAD_COMPLETE and shows as a grey tile in ASC.
 * ⚠️ A new version inherits the previous version's screenshots and previews,
 * so a release only needs the files that changed — and a slot that was
 * empty last time is still empty (English previews went missing for versions
 * that way).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { type AscClient, ok } from './client.ts'
import { requireVersion, versionLocalizations } from './versions.ts'

export type MediaSet = { kind: 'screenshots' | 'previews'; id: string; displayType: string; count: number; states: Record<string, number> }
export type LocaleMedia = { locale: string; localizationId: string; sets: MediaSet[] }

export async function mediaStatus(c: AscClient, appId: string, version: string): Promise<LocaleMedia[]> {
  const v = await requireVersion(c, appId, version)
  const out: LocaleMedia[] = []
  for (const loc of await versionLocalizations(c, v.id)) {
    const sets: MediaSet[] = []
    for (const [kind, setType, itemType] of [
      ['screenshots', 'appScreenshotSets', 'appScreenshots'],
      ['previews', 'appPreviewSets', 'appPreviews'],
    ] as const) {
      for (const set of await c.all(`/v1/appStoreVersionLocalizations/${loc.id}/${setType}?limit=50`)) {
        const items = await c.all(`/v1/${setType}/${set.id}/${itemType}?limit=50`)
        const states: Record<string, number> = {}
        for (const it of items) {
          const s = it.attributes.assetDeliveryState?.state ?? 'UNKNOWN'
          states[s] = (states[s] ?? 0) + 1
        }
        sets.push({ kind, id: set.id, displayType: set.attributes.screenshotDisplayType ?? set.attributes.previewType, count: items.length, states })
      }
    }
    out.push({ locale: loc.locale, localizationId: loc.id, sets })
  }
  return out
}

export type Uploaded = { id: string; file: string; bytes: number; chunks: number; md5: string }

export async function uploadMedia(c: AscClient, kind: 'screenshot' | 'preview', setId: string, file: string, fetchLike: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)): Promise<Uploaded> {
  const bytes = readFileSync(file)
  const isShot = kind === 'screenshot'
  const type = isShot ? 'appScreenshots' : 'appPreviews'
  const setType = isShot ? 'appScreenshotSets' : 'appPreviewSets'
  const setKey = isShot ? 'appScreenshotSet' : 'appPreviewSet'

  const created = ok(
    await c.post(`/v1/${type}`, {
      data: {
        type,
        attributes: { fileName: basename(file), fileSize: bytes.length },
        relationships: { [setKey]: { data: { type: setType, id: setId } } },
      },
    }),
    `reserve ${kind} upload`,
  )
  const id = created.json.data.id as string
  const ops: any[] = created.json.data.attributes.uploadOperations ?? []
  for (const op of ops) {
    const headers: Record<string, string> = {}
    for (const h of op.requestHeaders ?? []) headers[h.name] = h.value
    const res = await fetchLike(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) })
    if (!res.ok) throw new Error(`chunk PUT failed ${res.status} at offset ${op.offset}`)
  }
  const md5 = createHash('md5').update(bytes).digest('hex')
  ok(
    await c.patch(`/v1/${type}/${id}`, { data: { type, id, attributes: { uploaded: true, sourceFileChecksum: md5 } } }),
    `commit ${kind} upload`,
  )
  return { id, file, bytes: bytes.length, chunks: ops.length, md5 }
}

export async function createPreviewSet(c: AscClient, localizationId: string, previewType: string): Promise<string> {
  const r = ok(
    await c.post('/v1/appPreviewSets', {
      data: {
        type: 'appPreviewSets',
        attributes: { previewType },
        relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: localizationId } } },
      },
    }),
    `create preview set ${previewType}`,
  )
  return r.json.data.id
}

export async function createScreenshotSet(c: AscClient, localizationId: string, displayType: string): Promise<string> {
  const r = ok(
    await c.post('/v1/appScreenshotSets', {
      data: {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: displayType },
        relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: localizationId } } },
      },
    }),
    `create screenshot set ${displayType}`,
  )
  return r.json.data.id
}

export async function deleteMedia(c: AscClient, kind: 'screenshot' | 'preview', id: string): Promise<void> {
  ok(await c.delete(`/v1/${kind === 'screenshot' ? 'appScreenshots' : 'appPreviews'}/${id}`), `delete ${kind} ${id}`)
}

/** Items in a set, in display order. */
export async function setItems(c: AscClient, kind: 'screenshot' | 'preview', setId: string): Promise<{ id: string; fileName: string; state: string }[]> {
  const [setType, itemType] = kind === 'screenshot' ? ['appScreenshotSets', 'appScreenshots'] : ['appPreviewSets', 'appPreviews']
  return (await c.all(`/v1/${setType}/${setId}/${itemType}?limit=50`)).map((it: any) => ({
    id: it.id,
    fileName: it.attributes.fileName,
    state: it.attributes.assetDeliveryState?.state ?? 'UNKNOWN',
  }))
}
