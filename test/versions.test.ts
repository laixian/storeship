import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { describe, it } from 'node:test'
import { createClient } from '../src/asc/client.ts'
import { attachLatestBuild, createVersion, submitVersion } from '../src/asc/versions.ts'
import { uploadMedia } from '../src/asc/media.ts'
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
    return new Response(JSON.stringify(body), { status: init?.method === 'POST' ? 201 : 200 })
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
