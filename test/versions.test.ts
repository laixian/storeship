import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { describe, it } from 'node:test'
import { createClient } from '../src/asc/client.ts'
import { attachLatestBuild, classifyVersion, createVersion, submitVersion, watchVersion } from '../src/asc/versions.ts'
import { uploadMedia } from '../src/asc/media.ts'
import { diffReview, pushReview } from '../src/asc/listing.ts'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

type Route = (url: string, init?: RequestInit) => unknown | Promise<unknown>
function fake(routes: Record<string, Route>): { client: ReturnType<typeof createClient>; log: string[] } {
  const log: string[] = []
  const fetchLike = async (url: string, init?: RequestInit): Promise<Response> => {
    const key = `${init?.method ?? 'GET'} ${url.replace('https://api.appstoreconnect.apple.com', '')}`
    log.push(key)
    const r = Object.entries(routes).find(([k]) => (k.startsWith('^') ? new RegExp(k).test(key) : key.startsWith(k)))
    if (!r) return new Response(JSON.stringify({ errors: [{ detail: `no route for ${key}` }] }), { status: 404 })
    const body = await r[1](url, init)
    // A route can force a status by putting `__status` in what it returns.
    const status = (body as any)?.__status ?? (init?.method === 'POST' ? 201 : 200)
    return new Response(JSON.stringify(body), { status })
  }
  return { client: createClient({ keyId: 'K', issuerId: 'I', keyPem: pem, fetch: fetchLike }), log }
}

const versions = (state = 'PREPARE_FOR_SUBMISSION') => ({ data: [{ id: 'v1', attributes: { versionString: '1.0', appVersionState: state, platform: 'IOS' } }] })

describe('versions', () => {
  it('create is idempotent and schedules with the configured time', async () => {
    let created: any
    const { client } = fake({
      'GET /v1/apps/A/appStoreVersions': () => ({ data: [] }),
      'POST /v1/appStoreVersions': (_u, init) => {
        created = JSON.parse(init!.body as string)
        return { data: { id: 'new', attributes: { versionString: '2.0', appVersionState: 'PREPARE_FOR_SUBMISSION', earliestReleaseDate: created.data.attributes.earliestReleaseDate } } }
      },
    })
    const r = await createVersion(client, 'A', '2.0', { date: '2026-09-21', scheduledTime: '08:00:00-07:00' })
    assert.equal(r.created, true)
    assert.equal(created.data.attributes.releaseType, 'SCHEDULED')
    assert.equal(created.data.attributes.earliestReleaseDate, '2026-09-21T08:00:00-07:00')
    const { client: c2 } = fake({ 'GET /v1/apps/A/appStoreVersions': () => versions() })
    assert.equal((await createVersion(c2, 'A', '1.0')).created, false)
    await assert.rejects(createVersion(c2, 'A', '3.0', { date: '21/09/2026' }), /YYYY-MM-DD/)
  })

  it('attach waits until the newest build is VALID, then PATCHes the relationship', async () => {
    let polls = 0
    let patched: any
    const { client } = fake({
      'GET /v1/apps/A/appStoreVersions': () => versions(),
      'GET /v1/builds': () => ({ data: [{ id: 'b9', attributes: { version: '9', processingState: ++polls < 3 ? 'PROCESSING' : 'VALID', uploadedDate: 'd' } }] }),
      'PATCH /v1/appStoreVersions/v1/relationships/build': (_u, init) => {
        patched = JSON.parse(init!.body as string)
        return {}
      },
    })
    const waits: string[] = []
    const r = await attachLatestBuild(client, 'A', '1.0', { wait: true, sleep: async () => {}, onWait: (b) => waits.push(b!.processingState) })
    assert.equal(r.attached, true)
    assert.deepEqual(waits, ['PROCESSING', 'PROCESSING'])
    assert.deepEqual(patched, { data: { type: 'builds', id: 'b9' } })
  })

  it('attach with a build number waits for that build, ignoring an older VALID one', async () => {
    let polls = 0
    let patched: any
    const { client } = fake({
      'GET /v1/apps/A/appStoreVersions': () => versions(),
      'GET /v1/builds': () => {
        polls++
        const b9 = { id: 'b9', attributes: { version: '9', processingState: 'VALID', uploadedDate: 'd' } }
        const b10 = { id: 'b10', attributes: { version: '10', processingState: polls < 3 ? 'PROCESSING' : 'VALID', uploadedDate: 'e' } }
        return { data: polls < 2 ? [b9] : [b10, b9] }
      },
      'PATCH /v1/appStoreVersions/v1/relationships/build': (_u, init) => {
        patched = JSON.parse(init!.body as string)
        return {}
      },
    })
    const waits: string[] = []
    const r = await attachLatestBuild(client, 'A', '1.0', { build: '10', wait: true, sleep: async () => {}, onWait: (b) => waits.push(b ? b.processingState : 'none') })
    assert.equal(r.build.version, '10')
    assert.deepEqual(waits, ['none', 'PROCESSING'])
    assert.deepEqual(patched, { data: { type: 'builds', id: 'b10' } })
  })

  it('attach without --wait reports a non-VALID build instead of failing', async () => {
    const { client } = fake({
      'GET /v1/apps/A/appStoreVersions': () => versions(),
      'GET /v1/builds': () => ({ data: [{ id: 'b', attributes: { version: '9', processingState: 'PROCESSING', uploadedDate: 'd' } }] }),
    })
    const r = await attachLatestBuild(client, 'A', '1.0')
    assert.equal(r.attached, false)
    assert.equal(r.build.processingState, 'PROCESSING')
  })

  it('submit creates a submission, adds the version once, and flips submitted', async () => {
    const { client, log } = fake({
      'GET /v1/apps/A/appStoreVersions': () => versions(),
      'GET /v1/apps/A/reviewSubmissions': () => ({ data: [] }),
      'POST /v1/reviewSubmissions': () => ({ data: { id: 's1', attributes: { state: 'READY_FOR_REVIEW' } } }),
      'GET /v1/reviewSubmissions/s1/items': () => ({ data: [] }),
      'POST /v1/reviewSubmissionItems': () => ({ data: { id: 'i1' } }),
      'PATCH /v1/reviewSubmissions/s1': () => ({ data: { id: 's1', attributes: { state: 'WAITING_FOR_REVIEW' } } }),
    })
    const r = await submitVersion(client, 'A', '1.0')
    assert.deepEqual(r, { submissionId: 's1', state: 'WAITING_FOR_REVIEW', reused: false })
    assert.ok(log.includes('POST /v1/reviewSubmissionItems'))
  })
})

describe('media upload', () => {
  it('reserves, PUTs every chunk with the given headers, commits with the MD5', async () => {
    const file = join(tmpdir(), `storeship-test-${process.pid}.png`)
    const bytes = Buffer.alloc(10, 7)
    writeFileSync(file, bytes)
    const puts: { url: string; len: number; h: Record<string, string> }[] = []
    let commit: any
    const { client } = fake({
      'POST /v1/appScreenshots': () => ({
        data: {
          id: 'shot1',
          attributes: {
            uploadOperations: [
              { method: 'PUT', url: 'https://up/1', offset: 0, length: 6, requestHeaders: [{ name: 'X-A', value: '1' }] },
              { method: 'PUT', url: 'https://up/2', offset: 6, length: 4, requestHeaders: [] },
            ],
          },
        },
      }),
      'PATCH /v1/appScreenshots/shot1': (_u, init) => {
        commit = JSON.parse(init!.body as string)
        return { data: {} }
      },
    })
    const r = await uploadMedia(client, 'screenshot', 'set1', file, async (url, init) => {
      puts.push({ url, len: (init.body as Buffer).length, h: init.headers as Record<string, string> })
      return new Response('', { status: 200 })
    })
    assert.equal(r.chunks, 2)
    assert.deepEqual(puts.map((p) => p.len), [6, 4])
    assert.equal(puts[0]!.h['X-A'], '1')
    assert.equal(commit.data.attributes.sourceFileChecksum, createHash('md5').update(bytes).digest('hex'))
    assert.equal(commit.data.attributes.uploaded, true)
  })
})

describe('review detail', () => {
  it('PATCHes an existing record with only the differing fields', async () => {
    let patched: any
    const { client } = fake({
      'GET /v1/appStoreVersions/v1/appStoreReviewDetail': () => ({ data: { id: 'rd1', type: 'appStoreReviewDetails', attributes: { notes: 'old', contactEmail: 'a@b.c', demoAccountRequired: false } } }),
      'PATCH /v1/appStoreReviewDetails/rd1': (_u, init) => {
        patched = JSON.parse(init!.body as string)
        return {}
      },
    })
    const st = await diffReview(client, 'v1', { notes: 'new', contactEmail: 'a@b.c', demoAccountRequired: 'true' }, {})
    assert.equal(st.detailId, 'rd1')
    assert.deepEqual(await pushReview(client, 'v1', st), ['notes', 'demoAccountRequired'])
    assert.deepEqual(patched, { data: { type: 'appStoreReviewDetails', id: 'rd1', attributes: { notes: 'new', demoAccountRequired: true } } })
  })
  it('POSTs a new record linked to the version when there is none, including the env password', async () => {
    let posted: any
    const { client } = fake({
      'GET /v1/appStoreVersions/v1/appStoreReviewDetail': () => ({ data: null }),
      'POST /v1/appStoreReviewDetails': (_u, init) => {
        posted = JSON.parse(init!.body as string)
        return { data: { id: 'rd2' } }
      },
    })
    const st = await diffReview(client, 'v1', { notes: 'n', demoAccountName: 'demo' }, { ASC_DEMO_PASSWORD: 'pw' })
    assert.equal(st.detailId, undefined)
    assert.deepEqual(await pushReview(client, 'v1', st), ['notes', 'demoAccountName', 'demoAccountPassword'])
    assert.deepEqual(posted.data.relationships, { appStoreVersion: { data: { type: 'appStoreVersions', id: 'v1' } } })
    assert.deepEqual(posted.data.attributes, { notes: 'n', demoAccountName: 'demo', demoAccountPassword: 'pw' })
  })
})

describe('watching a review', () => {
  it('classifies from the version state first, then the submission and its items', () => {
    assert.equal(classifyVersion('WAITING_FOR_REVIEW'), 'pending')
    assert.equal(classifyVersion('IN_REVIEW'), 'pending')
    assert.equal(classifyVersion('REJECTED'), 'rejected')
    assert.equal(classifyVersion('METADATA_REJECTED'), 'rejected')
    assert.equal(classifyVersion('PENDING_DEVELOPER_RELEASE'), 'approved')
    assert.equal(classifyVersion('READY_FOR_DISTRIBUTION'), 'approved')
    // The submission can turn before the version does; an item can too.
    assert.equal(classifyVersion('IN_REVIEW', 'UNRESOLVED_ISSUES'), 'rejected')
    assert.equal(classifyVersion('IN_REVIEW', 'IN_REVIEW', ['APPROVED', 'REJECTED']), 'rejected')
    assert.equal(classifyVersion('IN_REVIEW', 'IN_REVIEW', ['APPROVED']), 'pending')
    // …but an approved version is never overridden by a stale submission row.
    assert.equal(classifyVersion('READY_FOR_DISTRIBUTION', 'UNRESOLVED_ISSUES'), 'approved')
  })

  it('polls until the verdict changes, and names the rejected item', async () => {
    let polls = 0
    const { client } = fake({
      'GET /v1/apps/A/appStoreVersions': () => ({ data: [{ id: 'v1', attributes: { versionString: '1.0', appVersionState: ++polls < 3 ? 'IN_REVIEW' : 'REJECTED', platform: 'IOS' } }] }),
      'GET /v1/apps/A/reviewSubmissions': () => ({ data: [{ id: 'sub1', attributes: { state: polls < 3 ? 'IN_REVIEW' : 'UNRESOLVED_ISSUES' } }] }),
      'GET /v1/reviewSubmissions/sub1/items': () => ({
        data: [{ id: 'i1', attributes: { state: polls < 3 ? 'READY_FOR_REVIEW' : 'REJECTED' }, relationships: { appStoreVersion: { data: { id: 'v1' } } } }],
        included: [{ type: 'appStoreVersions', id: 'v1', attributes: { versionString: '1.0' } }],
      }),
    })
    const seen: string[] = []
    const snap = await watchVersion(client, 'A', '1.0', { intervalMs: 1, sleep: async () => {}, onPoll: (s, changed) => seen.push(`${s.versionState}${changed ? '*' : ''}`) })
    assert.equal(snap.verdict, 'rejected')
    assert.deepEqual(seen, ['IN_REVIEW', 'IN_REVIEW', 'REJECTED*'])
    assert.deepEqual(snap.items, [{ id: 'i1', state: 'REJECTED', version: '1.0' }])
  })

  it('--once returns whatever is true right now instead of waiting', async () => {
    const { client } = fake({
      'GET /v1/apps/A/appStoreVersions': () => ({ data: [{ id: 'v1', attributes: { versionString: '1.0', appVersionState: 'WAITING_FOR_REVIEW', platform: 'IOS' } }] }),
      'GET /v1/apps/A/reviewSubmissions': () => ({ data: [] }),
    })
    const snap = await watchVersion(client, 'A', '1.0', { once: true, sleep: async () => assert.fail('must not sleep') })
    assert.equal(snap.verdict, 'pending')
    assert.equal(snap.submissionState, undefined)
  })

  it('ignores a COMPLETE submission that is not this version', async () => {
    const { client } = fake({
      'GET /v1/apps/A/appStoreVersions': () => ({ data: [{ id: 'v1', attributes: { versionString: '1.0', appVersionState: 'PENDING_DEVELOPER_RELEASE', platform: 'IOS' } }] }),
      'GET /v1/apps/A/reviewSubmissions': () => ({ data: [{ id: 'old', attributes: { state: 'COMPLETE' } }] }),
    })
    const snap = await watchVersion(client, 'A', '1.0', { once: true })
    assert.equal(snap.verdict, 'approved')
    assert.equal(snap.submissionId, undefined)
  })
})

describe('watch backs off instead of dying', () => {
  const versionRoute = { 'GET /v1/apps/A/appStoreVersions': () => ({ data: [{ id: 'v1', attributes: { versionString: '1.0', appVersionState: 'IN_REVIEW', platform: 'IOS' } }] }) }
  it('retries a 429 with a growing wait, then carries on', async () => {
    let calls = 0
    const { client } = fake({
      ...versionRoute,
      'GET /v1/apps/A/reviewSubmissions': () => (++calls <= 2 ? { __status: 429, errors: [{ detail: 'rate limit' }] } : { data: [] }),
    })
    const waits: number[] = []
    const retries: number[] = []
    const snap = await watchVersion(client, 'A', '1.0', {
      intervalMs: 1000,
      timeoutMs: 60_000,
      sleep: async (ms) => void waits.push(ms),
      onRetry: (_s, attempt) => retries.push(attempt),
      onPoll: (s) => {
        if (s.verdict === 'pending') throw new Error('stop')
      },
    }).catch((e) => e)
    assert.equal((snap as Error).message, 'stop', 'reached a real poll after the throttling')
    assert.deepEqual(retries, [1, 2])
    assert.deepEqual(waits, [1000, 2000], 'the wait grows with each consecutive failure')
  })
  it('gives up on an error that will not fix itself', async () => {
    const { client } = fake({ ...versionRoute, 'GET /v1/apps/A/reviewSubmissions': () => ({ __status: 401, errors: [{ detail: 'NOT_AUTHORIZED' }] }) })
    await assert.rejects(watchVersion(client, 'A', '1.0', { intervalMs: 1, sleep: async () => {} }), /NOT_AUTHORIZED/)
  })
})
