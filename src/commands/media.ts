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
  impact: 'read',
  needs: ['credentials'],
  sub: [
    {
      name: 'status',
      summary: 'how many screenshots / previews each locale × device slot has (and the set ids)',
      usage: 'media status <version>',
      impact: 'read',
      needs: ['credentials'],
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
      usage: 'media upload <screenshot|preview> <setId> <file> [file …] [--dry-run]',
      flags: { 'dry-run': 'list what would be uploaded and stop' },
      booleans: ['dry-run'],
      impact: 'write',
      needs: ['credentials'],
      run: async (ctx) => {
        const kind = kindOf(ctx.args.at(0, 'kind'))
        const setId = ctx.args.at(1, 'setId')
        const files = ctx.args.positional.slice(2)
        if (!files.length) throw new UsageError('give at least one file')
        if (ctx.dryRun()) {
          ctx.out.emit({ kind, setId, files })
          ctx.out.changed(...files.map((f) => ({ kind, target: setId, what: 'upload', detail: f })))
          for (const f of files) ctx.out.log(`would upload ${f} → ${setId}`)
          return
        }
        const done = []
        for (const f of files) {
          const u = await uploadMedia(ctx.client(), kind, setId, f)
          done.push(u)
          ctx.out.changed({ kind, target: setId, what: 'uploaded', detail: f })
          ctx.out.log(`✅ ${f} → ${u.id} (${u.chunks} chunk${u.chunks === 1 ? '' : 's'}, ${mb(u.bytes)}, md5 ${u.md5})`)
        }
        ctx.out.emit(done)
      },
    },
    {
      name: 'list',
      summary: 'items in a set with their delivery state',
      usage: 'media list <screenshot|preview> <setId>',
      impact: 'read',
      needs: ['credentials'],
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
      impact: 'write',
      needs: ['credentials'],
      run: async (ctx) => {
        const kind = kindOf(ctx.args.at(0, 'kind'))
        const loc = ctx.args.at(1, 'localizationId')
        const type = ctx.args.at(2, 'displayType')
        const id = kind === 'screenshot' ? await createScreenshotSet(ctx.client(), loc, type) : await createPreviewSet(ctx.client(), loc, type)
        ctx.out.emit({ id, kind, displayType: type })
        ctx.out.changed({ kind: `${kind} set`, target: id, what: 'created', detail: type })
        ctx.out.log(`created ${kind} set ${type} → ${id}`)
      },
    },
    {
      name: 'delete',
      summary: 'delete one screenshot / preview by id',
      usage: 'media delete <screenshot|preview> <id> --yes',
      flags: { yes: 'required: the file is gone from App Store Connect and has to be uploaded again' },
      booleans: ['yes'],
      impact: 'irreversible',
      needs: ['credentials'],
      confirm: 'the item is removed from App Store Connect; re-uploading is the only way back, and the display order of the set changes',
      run: async (ctx) => {
        const kind = kindOf(ctx.args.at(0, 'kind'))
        const id = ctx.args.at(1, 'id')
        await deleteMedia(ctx.client(), kind, id)
        ctx.out.emit({ deleted: id })
        ctx.out.changed({ kind, target: id, what: 'deleted' })
        ctx.out.log(`deleted ${kind} ${id}`)
      },
    },
  ],
  run: async () => {
    throw new UsageError('media needs a subcommand', `storeship media <${mediaCommand.sub!.map((s) => s.name).join('|')}>`)
  },
}
