import assert from 'node:assert/strict'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, it } from 'node:test'
import { createClient, explain, signJwt } from '../src/asc/client.ts'
import { hintFor } from '../src/hints.ts'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

describe('jwt', () => {
  it('signs ES256 with a raw R||S signature that verifies as ieee-p1363', () => {
    const t = signJwt({ keyId: 'KID', issuerId: 'ISS', keyPem: pem, now: 1000 })
    const [h, b, s] = t.split('.')
    assert.deepEqual(JSON.parse(Buffer.from(h!, 'base64url').toString()), { alg: 'ES256', kid: 'KID', typ: 'JWT' })
    const body = JSON.parse(Buffer.from(b!, 'base64url').toString())
    assert.equal(body.iss, 'ISS')
    assert.equal(body.exp - body.iat, 900)
    assert.equal(body.aud, 'appstoreconnect-v1')
    const sig = Buffer.from(s!, 'base64url')
    assert.equal(sig.length, 64, 'raw R||S is exactly 64 bytes; DER would be 70-72')
    const v = createVerify('SHA256')
    v.update(`${h}.${b}`)
    assert.ok(v.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, sig))
  })
})

describe('client', () => {
  it('sends a bearer token, follows links.next, and explains errors with a hint', async () => {
    const calls: string[] = []
    const fetchLike = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push(url)
      assert.match((init?.headers as Record<string, string>).authorization, /^Bearer /)
      if (url.endsWith('/p1')) return new Response(JSON.stringify({ data: [1], links: { next: 'https://api.appstoreconnect.apple.com/p2' } }))
      if (url.endsWith('/p2')) return new Response(JSON.stringify({ data: [2] }))
      return new Response(JSON.stringify({ errors: [{ status: '401', code: 'NOT_AUTHORIZED', detail: 'Authentication credentials are missing or invalid.' }] }), { status: 401 })
    }
    const c = createClient({ keyId: 'K', issuerId: 'I', keyPem: pem, fetch: fetchLike })
    assert.deepEqual(await c.all('/p1'), [1, 2])
    await assert.rejects(c.all('/nope'), (e: any) => {
      assert.match(e.message, /NOT_AUTHORIZED/)
      assert.match(e.hint, /DER-encoded/)
      return true
    })
    assert.equal(calls.length, 3)
  })
  it('explain collapses repeated errors', () => {
    const r = { status: 409, text: '', json: { errors: Array.from({ length: 3 }, () => ({ code: 'X', detail: 'same', source: { pointer: '/data' } })) } }
    assert.equal(explain(r), '409 X /data → same (×3)')
  })
  it('a missing key file is reported with where to put it', () => {
    const c = createClient({ keyId: 'K', issuerId: 'I', keyPath: '/nonexistent/AuthKey_K.p8' })
    assert.throws(() => c.token(), /cannot read the App Store Connect private key/)
  })
})

describe('hints', () => {
  it('maps the misleading messages to their real cause', () => {
    assert.match(hintFor('error: exportArchive No signing certificate "iOS Distribution" found')!, /cloud signing/)
    assert.match(hintFor('The specified pre-release build could not be added')!, /--wait/)
    assert.match(hintFor('STATE_ERROR.ICP_NUMBER_MIIT_PROVIDER_NAME_MISMATCH')!, /ICP/)
    assert.equal(hintFor('all fine'), undefined)
  })
})
