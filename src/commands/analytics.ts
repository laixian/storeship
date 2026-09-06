import { fetchReport, listReports, requestReport, salesReport } from '../asc/analytics.ts'
import { type Command } from '../ctx.ts'
import { UsageError } from '../errors.ts'
import { table } from '../out.ts'

export const analyticsCommand: Command = {
  name: 'analytics',
  summary: 'Analytics Reports API and daily sales (needs an Admin / Sales key)',
  sub: [
    {
      name: 'request',
      summary: 'ask Apple for a report snapshot (data arrives the next day)',
      usage: 'analytics request [--access ONE_TIME_SNAPSHOT|ONGOING]',
      flags: { access: 'ONE_TIME_SNAPSHOT (default) or ONGOING' },
      run: async (ctx) => {
        const r = await requestReport(ctx.client(), ctx.appId(), ctx.args.str('access'))
        ctx.out.emit(r)
        ctx.out.log(`requested ${r.id} (${r.accessType}); run \`storeship analytics list\` tomorrow`)
      },
    },
    {
      name: 'list',
      summary: 'requested reports and how many instances each has',
      run: async (ctx) => {
        const r = await listReports(ctx.client(), ctx.appId())
        ctx.out.emit(r)
        if (!r.length) ctx.out.log('no report requests; run `storeship analytics request` first')
        for (const q of r) {
          ctx.out.log(`\nrequest ${q.requestId}  ${q.accessType}${q.stopped ? '  (stopped for inactivity)' : ''}`)
          for (const rp of q.reports) ctx.out.log(`  ${rp.category.padEnd(14)} ${rp.name.padEnd(44)} instances ${rp.instances}`)
        }
      },
    },
    {
      name: 'fetch',
      summary: 'download the newest instance of a report as a table',
      usage: 'analytics fetch "<report name>" [--granularity DAILY|WEEKLY|MONTHLY]',
      flags: { granularity: 'DAILY (default), WEEKLY or MONTHLY' },
      run: async (ctx) => {
        const r = await fetchReport(ctx.client(), ctx.appId(), ctx.args.at(0, 'report name'), ctx.args.str('granularity'))
        ctx.out.emit(r)
        ctx.out.log(`processed ${r.processingDate} · ${r.rows.length - 1} rows\n`)
        for (const l of table(r.rows)) ctx.out.log(l)
      },
    },
    {
      name: 'sales',
      summary: 'daily sales summary for a vendor number',
      usage: 'analytics sales <vendorNumber> [YYYY-MM-DD]',
      run: async (ctx) => {
        const r = await salesReport(ctx.client(), ctx.args.at(0, 'vendorNumber'), ctx.args.positional[1])
        ctx.out.emit(r)
        const h = r.rows[0] ?? []
        const keep = ['Product Type Identifier', 'Units', 'Developer Proceeds', 'Currency of Proceeds', 'Country Code', 'Version', 'Device']
        const idx = keep.map((k) => h.indexOf(k))
        ctx.out.log(`sales ${r.date} · ${r.rows.length - 1} rows`)
        for (const l of table(r.rows.map((row) => idx.map((i) => (i >= 0 ? (row[i] ?? '') : ''))))) ctx.out.log(l)
      },
    },
  ],
  run: async () => {
    throw new UsageError('analytics needs a subcommand', 'storeship analytics <request|list|fetch|sales>')
  },
}
