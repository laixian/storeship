import { basename } from 'node:path'
import { createPreviewSet, mediaStatus, setItems, deleteMedia, uploadMedia } from '../asc/media.ts'
import { type Command, type Ctx } from '../ctx.ts'
import { StoreshipError, UsageError } from '../errors.ts'
import { mb } from '../out.ts'
import { cutPreview, parseSegment } from '../preview/cut.ts'
import { findFfmpeg, probe } from '../preview/ffmpeg.ts'
import { startRecording, stopRecording } from '../preview/record.ts'
import { checkPreview, defaultSize, PREVIEW_SIZES } from '../preview/specs.ts'
import { DEVICES, PREVIEW_TYPE } from '../shots/devices.ts'
import { loadShots } from '../shots/load.ts'
import { bootedUdid } from '../sim/sim.ts'

async function deviceOf(ctx: Ctx): Promise<{ id: string; previewType: string; simName?: string } | undefined> {
  const id = ctx.args.str('device') ?? ctx.cfg.sim.profile
  if (!id) return undefined
  let devices = DEVICES
  try {
    devices = (await loadShots(ctx.cfg)).devices
  } catch {
    /* no shots config: built-in table */
  }
  const d = devices[id]
  if (!d) throw new UsageError(`unknown device "${id}"`, `known: ${Object.keys(devices).join(', ')}`)
  const previewType = PREVIEW_TYPE[d.displayType]
  if (!previewType) throw new StoreshipError(`${id} (${d.displayType}) has no App Preview type`)
  return { id, previewType, simName: d.sim?.name }
}

export const previewCommand: Command = {
  name: 'preview',
  summary: 'App Preview video: record the simulator, cut VFR footage into a spec-size film, check, upload',
  sub: [
    {
      name: 'record',
      summary: 'start recording the booted simulator (stop with `preview stop`; never kill the process)',
      usage: 'preview record <out.mov> [--device id | --udid U]',
      run: async (ctx) => {
        const out = ctx.args.at(0, 'out.mov')
        const d = await deviceOf(ctx)
        const udid = ctx.args.str('udid') ?? bootedUdid(d?.simName)
        const r = startRecording(udid, out)
        ctx.out.emit(r)
        ctx.out.log(`recording ${udid} → ${out} (pid ${r.pid}). Stop with: storeship preview stop`)
      },
    },
    {
      name: 'stop',
      summary: 'stop the recording cleanly (SIGINT), so the session is not leaked in CoreSimulator',
      run: async (ctx) => {
        const r = stopRecording()
        ctx.out.emit(r)
        ctx.out.log(`stopped → ${r.out}`)
      },
    },
    {
      name: 'cut',
      summary: 'segments → CFR parts → crossfade → fades (+ music) at the preview size for the device',
      usage: 'preview cut <out.mp4> <file:start:dur[:p]>… [--device id | --size WxH] [--portrait] [--music f.wav] [--fps 30] [--xfade 0.5]',
      booleans: ['portrait'],
      run: async (ctx) => {
        const out = ctx.args.at(0, 'out.mp4')
        const segments = ctx.args.positional.slice(1).map(parseSegment)
        if (!segments.length) throw new UsageError('give at least one segment: <file>:<start>:<duration>[:p]')
        const d = await deviceOf(ctx)
        let size: [number, number]
        if (ctx.args.str('size')) {
          const m = /^(\d+)x(\d+)$/.exec(ctx.args.str('size')!)
          if (!m) throw new UsageError('--size must be WxH')
          size = [Number(m[1]), Number(m[2])]
        } else if (d) size = defaultSize(d.previewType, ctx.args.bool('portrait') ? 'portrait' : undefined)
        else throw new UsageError('give --device <id> or --size WxH', `preview sizes: ${Object.entries(PREVIEW_SIZES).map(([t, s]) => `${t} ${s.map(([w, h]) => `${w}x${h}`).join('/')}`).join('; ')}`)
        const ff = findFfmpeg(ctx.cfg.ffmpeg)
        const r = cutPreview(ff, {
          out,
          segments,
          width: size[0],
          height: size[1],
          fps: ctx.args.num('fps', 30),
          xfade: ctx.args.num('xfade', 0.5),
          music: ctx.args.str('music'),
          onLog: (l) => ctx.out.note(`  ${l}`),
        })
        const p = probe(ff, out, true)
        const problems = checkPreview(p, d?.previewType)
        ctx.out.emit({ ...r, probe: p, problems })
        ctx.out.log(`${out}: ${p.width}×${p.height} ${p.duration.toFixed(2)}s ${p.fps}fps${p.frames ? ` ${p.frames} frames` : ''}${p.audio ? ' + audio' : ''}`)
        for (const b of problems) ctx.out.log(`  ⚠️ ${b}`)
      },
    },
    {
      name: 'check',
      summary: 'size / duration / fps / frame count against the App Preview spec',
      usage: 'preview check <file> [--device id]',
      run: async (ctx) => {
        const file = ctx.args.at(0, 'file')
        const d = await deviceOf(ctx)
        const p = probe(findFfmpeg(ctx.cfg.ffmpeg), file, true)
        const problems = checkPreview(p, d?.previewType)
        ctx.out.emit({ file, probe: p, previewType: d?.previewType ?? null, problems })
        ctx.out.log(`${file}: ${p.width}×${p.height} ${p.duration.toFixed(2)}s ${p.fps}fps ${p.frames ?? '?'} frames${p.audio ? ' + audio' : ''}`)
        for (const b of problems) ctx.out.log(`  ✗ ${b}`)
        if (problems.length) process.exitCode = 1
        else ctx.out.log(`  ✓ ok${d ? ` for ${d.previewType}` : ''}`)
      },
    },
    {
      name: 'upload',
      summary: 'upload a preview into the right slot for a locale × device (creates the slot if missing)',
      usage: 'preview upload <version> <file.mp4> --device id --locale L [--replace]',
      booleans: ['replace'],
      run: async (ctx) => {
        const version = ctx.args.at(0, 'version')
        const file = ctx.args.at(1, 'file.mp4')
        const d = await deviceOf(ctx)
        if (!d) throw new UsageError('--device <id> is required')
        const locale = ctx.args.need('locale')
        const problems = checkPreview(probe(findFfmpeg(ctx.cfg.ffmpeg), file, true), d.previewType)
        if (problems.length) throw new StoreshipError(`${file} does not meet the ${d.previewType} spec:\n  ${problems.join('\n  ')}`, 'ASC would reject it; fix with `storeship preview cut`')
        const status = await mediaStatus(ctx.client(), ctx.appId(), version)
        const loc = status.find((l) => l.locale === locale)
        if (!loc) throw new StoreshipError(`${locale} is not a localization of ${version}`)
        let set = loc.sets.find((s) => s.kind === 'previews' && s.displayType === d.previewType)
        let created = false
        let setId = set?.id
        if (!setId) {
          setId = await createPreviewSet(ctx.client(), loc.localizationId, d.previewType)
          created = true
        }
        const existing = await setItems(ctx.client(), 'preview', setId)
        if (existing.some((e) => e.fileName === basename(file)) && !ctx.args.bool('replace')) {
          ctx.out.emit({ setId, skipped: file })
          ctx.out.log(`${basename(file)} is already in ${locale} ${d.previewType}; pass --replace to re-upload`)
          return
        }
        let deleted = 0
        if (ctx.args.bool('replace')) for (const e of existing) {
          await deleteMedia(ctx.client(), 'preview', e.id)
          deleted++
        }
        const u = await uploadMedia(ctx.client(), 'preview', setId, file)
        ctx.out.emit({ setId, created, deleted, uploaded: u })
        ctx.out.log(`✅ ${basename(file)} → ${locale} ${d.previewType} (set ${setId}${created ? ', created' : ''}${deleted ? `, ${deleted} replaced` : ''}; ${u.chunks} chunks, ${mb(u.bytes)}). ASC processes it for a few minutes; pick the poster frame in the web UI.`)
      },
    },
  ],
  run: async () => {
    throw new UsageError('preview needs a subcommand', 'storeship preview <record|stop|cut|check|upload>')
  },
}
