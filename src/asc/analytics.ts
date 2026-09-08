/**
 * Analytics Reports API + Sales Reports.
 *
 * ⚠️ An App Manager key gets 403 on both (`The API key in use does not allow
 * this request`). Analytics needs an Admin key; sales/finance needs Admin or
 * Sales/Finance role plus the vendor number (ASC → Payments and Financial
 * Reports, top left; not exposed by the API).
 */
import { gunzipSync } from 'node:zlib'
import { type AscClient, ok } from './client.ts'
import { StoreshipError } from '../errors.ts'

const inflate = (buf: Buffer): string => (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8')
const tsv = (text: string): string[][] => text.trim().split('\n').map((l) => l.split('\t'))

export async function requestReport(c: AscClient, appId: string, accessType = 'ONE_TIME_SNAPSHOT'): Promise<{ id: string; accessType: string }> {
  const r = ok(
    await c.post('/v1/analyticsReportRequests', {
      data: { type: 'analyticsReportRequests', attributes: { accessType }, relationships: { app: { data: { type: 'apps', id: appId } } } },
    }),
    'request analytics report',
    [201],
  )
  return { id: r.json.data.id, accessType: r.json.data.attributes.accessType }
}

export async function listReports(c: AscClient, appId: string): Promise<{ requestId: string; accessType: string; stopped: boolean; reports: { id: string; category: string; name: string; instances: number }[] }[]> {
  const out = []
  for (const q of await c.all(`/v1/apps/${appId}/analyticsReportRequests`)) {
    const reports = []
    for (const rp of await c.all(`/v1/analyticsReportRequests/${q.id}/reports?limit=200`)) {
      const inst = await c.all(`/v1/analyticsReports/${rp.id}/instances?limit=200`)
      reports.push({ id: rp.id, category: rp.attributes.category, name: rp.attributes.name, instances: inst.length })
    }
    out.push({ requestId: q.id, accessType: q.attributes.accessType, stopped: !!q.attributes.stoppedDueToInactivity, reports })
  }
  return out
}

export async function fetchReport(c: AscClient, appId: string, name: string, granularity = 'DAILY'): Promise<{ processingDate: string; rows: string[][] }> {
  let found: any = null
  for (const q of await c.all(`/v1/apps/${appId}/analyticsReportRequests`)) {
    const reports = await c.all(`/v1/analyticsReportRequests/${q.id}/reports?filter[name]=${encodeURIComponent(name)}`)
    if (reports.length) {
      found = reports[0]
      break
    }
  }
  if (!found) throw new StoreshipError(`no report named "${name}"`, 'run `storeship analytics list` for the names', { code: 'NOT_FOUND' })
  const inst = (await c.all(`/v1/analyticsReports/${found.id}/instances?filter[granularity]=${granularity}&limit=200`)).sort((a, b) =>
    String(b.attributes.processingDate).localeCompare(String(a.attributes.processingDate)),
  )
  if (!inst.length) throw new StoreshipError(`"${name}" has no ${granularity} instances yet`, 'Apple produces data the day after the request', { code: 'PENDING' })
  const rows: string[][] = []
  for (const s of await c.all(`/v1/analyticsReportInstances/${inst[0].id}/segments`)) {
    const res = await fetch(s.attributes.url)
    const t = tsv(inflate(Buffer.from(await res.arrayBuffer())))
    rows.push(...(rows.length ? t.slice(1) : t))
  }
  return { processingDate: inst[0].attributes.processingDate, rows }
}

export async function salesReport(c: AscClient, vendorNumber: string, date?: string): Promise<{ date: string; rows: string[][] }> {
  const day = date ?? new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  const res = await c.raw(
    `/v1/salesReports?filter[frequency]=DAILY&filter[reportSubType]=SUMMARY&filter[reportType]=SALES&filter[vendorNumber]=${vendorNumber}&filter[reportDate]=${day}`,
  )
  if (res.status !== 200) throw new StoreshipError(`sales report: ${res.status} ${(await res.text()).slice(0, 400)}`, undefined, { code: 'API' })
  // gzip binary: never go through res.text()
  return { date: day, rows: tsv(inflate(Buffer.from(await res.arrayBuffer()))) }
}
