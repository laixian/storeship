import { createPreviewSet, createScreenshotSet, deleteMedia, mediaStatus, setItems, uploadMedia } from '../asc/media.ts'
import { type Command } from '../ctx.ts'
import { UsageError } from '../errors.ts'
import { mb } from '../out.ts'

const kindOf = (s: string): 'screenshot' | 'preview' => {
  if (s === 'screenshot' || s === 'shot') return 'screenshot'
  if (s === 'preview') return 'preview'
  throw new UsageError(`kind must be screenshot or preview, got "${s}"`)
}

export const mediaCommand: Command = {
  name: 'media',
  summary: 'screenshots and preview videos: status per locale × device, upload, create slots',
  sub: [
    {
      name: 'status',
      summary: 'how many screenshots / previews each locale × device slot has (and the set ids)',
      usage: 'media status <version>',
      run: async (ctx) => {
        const r = await mediaStatus(ctx.client(), ctx.appId(), ctx.args.at(0, 'version'))
        ctx.out.emit(r)
        for (const loc of r) {
          ctx.out.log(`\n${loc.locale}  (localization ${loc.localizationId})`)
          for (const s of loc.sets) {
            const states = Object.entries(s.states).filter(([k]) => k !== 'COMPLETE').map(([k, n]) => `${k}×${n}`).join(' ')
            ctx.out.log(`  ${s.kind.padEnd(11)} ${s.displayType.padEnd(28)} ${String(s.count).padStart(2)}   set=${s.id}${states ? `   ⚠️ ${states}` : ''}`)
          }
        }
      },
    },
    {
      name: 'upload',
      summary: 'upload files into a set (order = display order)',
      usage: 'media upload <screenshot|preview> <setId> <file> [file …]',
      run: async (ctx) => {
        const kind = kindOf(ctx.args.at(0, 'kind'))
        const setId = ctx.args.at(1, 'setId')
        const files = ctx.args.positional.slice(2)
        if (!files.length) throw new UsageError('give at least one file')
        const done = []
        for (const f of files) {
          const u = await uploadMedia(ctx.client(), kind, setId, f)
          done.push(u)
          ctx.out.log(`✅ ${f} → ${u.id} (${u.chunks} chunk${u.chunks === 1 ? '' : 's'}, ${mb(u.bytes)}, md5 ${u.md5})`)
        }
        ctx.out.emit(done)
      },
    },
    {
      name: 'list',
      summary: 'items in a set with their delivery state',
      usage: 'media list <screenshot|preview> <setId>',
      run: async (ctx) => {
        const items = await setItems(ctx.client(), kindOf(ctx.args.at(0, 'kind')), ctx.args.at(1, 'setId'))
        ctx.out.emit(items)
        for (const it of items) ctx.out.log(`${it.state.padEnd(18)} ${it.id}  ${it.fileName}`)
      },
    },
    {
      name: 'mkset',
      summary: 'create an empty set for a locale (needed once per device type before uploading)',
      usage: 'media mkset <screenshot|preview> <localizationId> <displayType>   e.g. preview <locId> IPHONE_67',
      run: async (ctx) => {
        const kind = kindOf(ctx.args.at(0, 'kind'))
        const loc = ctx.args.at(1, 'localizationId')
        const type = ctx.args.at(2, 'displayType')
        const id = kind === 'screenshot' ? await createScreenshotSet(ctx.client(), loc, type) : await createPreviewSet(ctx.client(), loc, type)
        ctx.out.emit({ id, kind, displayType: type })
        ctx.out.log(`created ${kind} set ${type} → ${id}`)
      },
    },
    {
      name: 'delete',
      summary: 'delete one screenshot / preview by id',
      usage: 'media delete <screenshot|preview> <id>',
      run: async (ctx) => {
        const kind = kindOf(ctx.args.at(0, 'kind'))
        const id = ctx.args.at(1, 'id')
        await deleteMedia(ctx.client(), kind, id)
        ctx.out.emit({ deleted: id })
        ctx.out.log(`deleted ${kind} ${id}`)
      },
    },
  ],
  run: async () => {
    throw new UsageError('media needs a subcommand', `storeship media <${mediaCommand.sub!.map((s) => s.name).join('|')}>`)
  },
}
