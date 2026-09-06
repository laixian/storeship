/**
 * Minimal App Store Connect API client: sign a JWT, make a request, follow
 * pagination, explain errors.
 *
 * ⚠️ The ES256 signature must be raw R‖S (`dsaEncoding: 'ieee-p1363'`), not
 * DER. Node's default is DER, and Apple answers a DER signature with a bare
 * 401 that says nothing about encoding.
 */
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { StoreshipError } from '../errors.ts'
import { hintFor } from '../hints.ts'

export const ASC_BASE = 'https://api.appstoreconnect.apple.com'

export type AscResult = { status: number; json: any; text: string }
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type ClientOptions = {
  keyId: string
  issuerId: string
  /** Path to the .p8; read lazily on first request. */
  keyPath?: string
  /** PEM contents, for tests or when the key is already in memory. */
  keyPem?: string
  fetch?: FetchLike
  base?: string
  /** Seconds since epoch; injectable for tests. */
  now?: () => number
}

const b64 = (o: unknown): string =>
  Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')

export function signJwt(o: { keyId: string; issuerId: string; keyPem: string; now?: number; ttl?: number }): string {
  const now = o.now ?? Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'ES256', kid: o.keyId, typ: 'JWT' })
  const body = b64({ iss: o.issuerId, iat: now, exp: now + (o.ttl ?? 900), aud: 'appstoreconnect-v1' })
  const signer = createSign('SHA256')
  signer.update(`${head}.${body}`)
  const sig = signer.sign({ key: o.keyPem, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${head}.${body}.${sig}`
}

export class AscError extends StoreshipError {
  readonly result: AscResult
  constructor(result: AscResult, context: string) {
    const detail = explain(result)
    super(`${context}: ${detail}`, hintFor(detail))
    this.name = 'AscError'
    this.result = result
  }
}

/** Flatten Apple's error array into readable lines, collapsing repeats (175 identical territory errors → one line ×175). */
export function explain(r: AscResult): string {
  const errs = r.json?.errors
  if (!Array.isArray(errs)) return `${r.status} ${r.text.slice(0, 400)}`
  const seen = new Map<string, number>()
  for (const e of errs) {
    const assoc = Array.isArray(e.meta?.associatedErrors)
      ? ''
      : e.meta?.associatedErrors
        ? ' ' + JSON.stringify(e.meta.associatedErrors).slice(0, 600)
        : ''
    const k = `${r.status} ${e.code ?? ''}${e.source?.pointer ? ` ${e.source.pointer}` : ''} → ${e.detail ?? e.title}${assoc}`
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  return [...seen].map(([k, n]) => (n > 1 ? `${k} (×${n})` : k)).join('\n')
}

export interface AscClient {
  readonly base: string
  token(): string
  request(method: string, path: string, body?: unknown): Promise<AscResult>
  get(path: string): Promise<AscResult>
  post(path: string, body: unknown): Promise<AscResult>
  patch(path: string, body: unknown): Promise<AscResult>
  delete(path: string): Promise<AscResult>
  /** Follow `links.next` until the collection is exhausted. */
  all(path: string): Promise<any[]>
  /** Raw fetch with the bearer token, for endpoints that return CSV / gzip. */
  raw(path: string, init?: RequestInit): Promise<Response>
}

export function createClient(o: ClientOptions): AscClient {
  const base = o.base ?? ASC_BASE
  const doFetch: FetchLike = o.fetch ?? ((url, init) => fetch(url, init))
  let pem = o.keyPem
  const keyPem = (): string => {
    if (pem) return pem
    if (!o.keyPath) throw new StoreshipError('no App Store Connect private key configured', 'set asc.keyPath or ASC_KEY_PATH, or put the .p8 at ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8')
    try {
      pem = readFileSync(o.keyPath, 'utf8')
    } catch {
      throw new StoreshipError(`cannot read the App Store Connect private key at ${o.keyPath}`, 'the .p8 can only be downloaded once from App Store Connect → Users and Access → Integrations; put it at that path with chmod 600')
    }
    return pem
  }
  const token = (): string => signJwt({ keyId: o.keyId, issuerId: o.issuerId, keyPem: keyPem(), now: o.now?.() })

  const request = async (method: string, path: string, body?: unknown): Promise<AscResult> => {
    const res = await doFetch(path.startsWith('http') ? path : base + path, {
      method,
      headers: {
        authorization: `Bearer ${token()}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      /* CSV / empty body */
    }
    return { status: res.status, json, text }
  }

  const all = async (path: string): Promise<any[]> => {
    const out: any[] = []
    let next: string | null = path
    while (next) {
      const r: AscResult = await request('GET', next)
      if (r.status !== 200) throw new AscError(r, `GET ${next}`)
      out.push(...(r.json?.data ?? []))
      next = r.json?.links?.next ?? null
    }
    return out
  }

  return {
    base,
    token,
    request,
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    patch: (p, b) => request('PATCH', p, b),
    delete: (p) => request('DELETE', p),
    all,
    raw: (p, init) =>
      doFetch(p.startsWith('http') ? p : base + p, {
        ...init,
        headers: { ...(init?.headers as Record<string, string> | undefined), authorization: `Bearer ${token()}` },
      }),
  }
}

/** Throw unless the status is one of `okStatuses`. */
export function ok(r: AscResult, context: string, okStatuses: number[] = [200, 201, 204]): AscResult {
  if (!okStatuses.includes(r.status)) throw new AscError(r, context)
  return r
}
