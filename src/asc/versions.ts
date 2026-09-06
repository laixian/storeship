/**
 * App Store version lifecycle: list, create (optionally scheduled), write
 * What's New, attach the latest build, submit for review, cancel.
 *
 * ⚠️ Cancelling is one-way: the queue position is gone the moment you do it,
 * and whether a re-submit will be accepted is only known at re-submit time
 * (account-level validations run then). Submit first, cancel only if needed.
 */
import { type AscClient, ok } from './client.ts'
import { StoreshipError } from '../errors.ts'

export type VersionRow = {
  id: string
  version: string
  state: string
  releaseType?: string
  earliestReleaseDate?: string
  platform?: string
}

const row = (v: any): VersionRow => ({
  id: v.id,
  version: v.attributes.versionString,
  state: v.attributes.appVersionState ?? v.attributes.appStoreState,
  releaseType: v.attributes.releaseType ?? undefined,
  earliestReleaseDate: v.attributes.earliestReleaseDate ?? undefined,
  platform: v.attributes.platform,
})

export async function listVersions(c: AscClient, appId: string, limit = 20): Promise<VersionRow[]> {
  return (await c.all(`/v1/apps/${appId}/appStoreVersions?limit=${limit}`)).map(row)
}

export async function findVersion(c: AscClient, appId: string, version: string): Promise<VersionRow | undefined> {
  return (await listVersions(c, appId)).find((v) => v.version === version)
}

export async function requireVersion(c: AscClient, appId: string, version: string): Promise<VersionRow> {
  const v = await findVersion(c, appId, version)
  if (!v) throw new StoreshipError(`no App Store version ${version}`, `create it with \`storeship version create ${version}\``)
  return v
}

/**
 * Create a version record. With `date` (YYYY-MM-DD) the release is scheduled
 * for that day at `scheduledTime` ("HH:MM:SS±HH:MM" or "HH:MM:SSZ").
 */
export async function createVersion(
  c: AscClient,
  appId: string,
  version: string,
  opts: { date?: string; scheduledTime?: string; platform?: string } = {},
): Promise<{ created: boolean; row: VersionRow }> {
  const existing = await findVersion(c, appId, version)
  if (existing) return { created: false, row: existing }
  const attributes: Record<string, unknown> = { platform: opts.platform ?? 'IOS', versionString: version }
  if (opts.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new StoreshipError(`release date must be YYYY-MM-DD, got "${opts.date}"`)
    attributes.releaseType = 'SCHEDULED'
    attributes.earliestReleaseDate = `${opts.date}T${opts.scheduledTime ?? '00:00:00Z'}`
  }
  const r = ok(
    await c.post('/v1/appStoreVersions', {
      data: { type: 'appStoreVersions', attributes, relationships: { app: { data: { type: 'apps', id: appId } } } },
    }),
    `create version ${version}`,
  )
  return { created: true, row: row(r.json.data) }
}

export async function versionLocalizations(c: AscClient, versionId: string): Promise<{ id: string; locale: string; attributes: any }[]> {
  return (await c.all(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=50`)).map((l: any) => ({
    id: l.id,
    locale: l.attributes.locale,
    attributes: l.attributes,
  }))
}

/** Write What's New per locale. Locales without text are skipped and reported. */
export async function writeWhatsNew(
  c: AscClient,
  versionId: string,
  texts: Record<string, string>,
): Promise<{ locale: string; written: number | null }[]> {
  const out: { locale: string; written: number | null }[] = []
  for (const loc of await versionLocalizations(c, versionId)) {
    const whatsNew = texts[loc.locale]?.trimEnd()
    if (!whatsNew) {
      out.push({ locale: loc.locale, written: null })
      continue
    }
    ok(
      await c.patch(`/v1/appStoreVersionLocalizations/${loc.id}`, {
        data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { whatsNew } },
      }),
      `write What's New (${loc.locale})`,
    )
    out.push({ locale: loc.locale, written: [...whatsNew].length })
  }
  return out
}

export type BuildRow = { id: string; version: string; processingState: string; uploadedDate: string }

export async function listBuilds(c: AscClient, appId: string, limit = 10): Promise<BuildRow[]> {
  return (await c.all(`/v1/builds?filter[app]=${appId}&limit=${limit}&sort=-uploadedDate`)).map((b: any) => ({
    id: b.id,
    version: String(b.attributes.version),
    processingState: b.attributes.processingState,
    uploadedDate: b.attributes.uploadedDate,
  }))
}

/**
 * Attach the newest build to a version. Builds take minutes to become VALID
 * after upload; with `wait` we poll instead of failing.
 */
export async function attachLatestBuild(
  c: AscClient,
  appId: string,
  version: string,
  opts: { wait?: boolean; timeoutMs?: number; intervalMs?: number; onWait?: (b: BuildRow | undefined) => void; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ build: BuildRow; attached: boolean }> {
  const v = await requireVersion(c, appId, version)
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60_000)
  for (;;) {
    const build = (await listBuilds(c, appId, 5))[0]
    if (build && build.processingState === 'VALID') {
      ok(
        await c.patch(`/v1/appStoreVersions/${v.id}/relationships/build`, { data: { type: 'builds', id: build.id } }),
        `attach build ${build.version} to ${version}`,
      )
      return { build, attached: true }
    }
    if (!opts.wait) {
      if (!build) throw new StoreshipError('no builds in the account yet', 'upload one first: `storeship ship`')
      return { build, attached: false }
    }
    opts.onWait?.(build)
    if (Date.now() > deadline) throw new StoreshipError(`gave up waiting for a VALID build after ${Math.round((opts.timeoutMs ?? 30 * 60_000) / 60_000)} min`, 'check `storeship builds`; a build that fails processing gets an email from Apple, not a state change')
    await sleep(opts.intervalMs ?? 30_000)
  }
}

const OPEN = 'READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW'

export async function openSubmissions(c: AscClient, appId: string): Promise<any[]> {
  return c.all(`/v1/apps/${appId}/reviewSubmissions?filter[state]=${OPEN}&limit=5`)
}

/** Create/reuse a review submission, add the version to it, submit. */
export async function submitVersion(c: AscClient, appId: string, version: string, platform = 'IOS'): Promise<{ submissionId: string; state: string; reused: boolean }> {
  const v = await requireVersion(c, appId, version)
  let sub = (await openSubmissions(c, appId))[0]
  const reused = !!sub
  if (!sub) {
    sub = ok(
      await c.post('/v1/reviewSubmissions', {
        data: { type: 'reviewSubmissions', attributes: { platform }, relationships: { app: { data: { type: 'apps', id: appId } } } },
      }),
      'create review submission',
    ).json.data
  }
  const items = await c.all(`/v1/reviewSubmissions/${sub.id}/items?limit=10`)
  if (!items.length) {
    ok(
      await c.post('/v1/reviewSubmissionItems', {
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } },
            appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } },
          },
        },
      }),
      `add ${version} to the submission`,
    )
  }
  const r = ok(
    await c.patch(`/v1/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } }),
    `submit ${version} for review`,
  )
  return { submissionId: sub.id, state: r.json.data.attributes.state, reused }
}

export async function cancelSubmissions(c: AscClient, appId: string): Promise<{ id: string; from: string; to: string }[]> {
  const out: { id: string; from: string; to: string }[] = []
  for (const sub of await openSubmissions(c, appId)) {
    const r = ok(
      await c.patch(`/v1/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { canceled: true } } }),
      `cancel submission ${sub.id}`,
    )
    out.push({ id: sub.id, from: sub.attributes.state, to: r.json.data.attributes.state })
  }
  return out
}
