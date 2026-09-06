import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Command } from '../ctx.ts'
import { UsageError } from '../errors.ts'
import { cardHtml, renderCard } from '../reel/card.ts'
import { loadReel } from '../reel/load.ts'
import { framePts, makeReel, steadyRuns } from '../reel/run.ts'
import { findChrome } from '../shots/render.ts'

export const reelCommand: Command = {
  name: 'reel',
  summary: 'vertical social video: a simulator recording inside a designed card, audio aligned by frame timestamps',
  sub: [
    {
      name: 'card',
      summary: 'render the card layer (transparent hole for the video) to a PNG',
      usage: 'reel card <out.png>',
      run: async (ctx) => {
        const out = ctx.args.at(0, 'out.png')
        const { content, template } = await loadReel(ctx.cfg)
        renderCard(findChrome(ctx.cfg.chrome), cardHtml(content, template), content.canvas, out)
        ctx.out.emit({ out, canvas: content.canvas, band: content.band })
        ctx.out.log(`card → ${out} (${content.canvas.w}×${content.canvas.h}, hole ${content.band.w}×${content.band.h} @ ${content.band.x},${content.band.y})`)
      },
    },
    {
      name: 'make',
      summary: 'recording (+ audio) → mp4; renders the card fresh each time',
      usage: 'reel make <recording.mov> <out.mp4> [--start s] [--duration s] [--audio f.wav --audio-t0 s] [--card card.png]',
      run: async (ctx) => {
        const recording = ctx.args.at(0, 'recording.mov')
        const out = ctx.args.at(1, 'out.mp4')
        const { content, template } = await loadReel(ctx.cfg)
        const tmp = mkdtempSync(join(tmpdir(), 'storeship-reel-'))
        try {
          let card = ctx.args.str('card')
          if (!card) {
            card = join(tmp, 'card.png')
            renderCard(findChrome(ctx.cfg.chrome), cardHtml(content, template), content.canvas, card)
          }
          const log = makeReel(content, {
            recording,
            card,
            out,
            start: ctx.args.str('start') ? ctx.args.num('start', 0) : undefined,
            duration: ctx.args.str('duration') ? ctx.args.num('duration', 0) : undefined,
            audio: ctx.args.str('audio'),
            audioT0: ctx.args.str('audio-t0') ? ctx.args.num('audio-t0', 0) : undefined,
          })
          ctx.out.emit({ out, log: log.trim() })
          ctx.out.log(log.trim())
        } finally {
          rmSync(tmp, { recursive: true, force: true })
        }
      },
    },
    {
      name: 'pts',
      summary: 'frame timestamps of a recording, and the steady-cadence runs (the first frame of one is where audio t=0 belongs)',
      usage: 'reel pts <recording.mov> [--all]',
      booleans: ['all'],
      run: async (ctx) => {
        const file = ctx.args.at(0, 'recording.mov')
        const pts = framePts(file)
        const runs = steadyRuns(pts)
        ctx.out.emit({ frames: pts.length, duration: pts.at(-1) ?? 0, runs, pts: ctx.args.bool('all') ? pts : undefined })
        ctx.out.log(`${pts.length} frames, last at ${(pts.at(-1) ?? 0).toFixed(3)}s`)
        if (ctx.args.bool('all')) pts.forEach((t, i) => ctx.out.log(`${String(i).padStart(3)}  t=${t.toFixed(3)}  gap=${(i ? t - pts[i - 1]! : 0).toFixed(3)}`))
        for (const r of runs) ctx.out.log(`steady run: frames ${r.from}–${r.to} (${r.frames}) every ${r.gap}s (≈ ${Math.round(60 / r.gap)} BPM if one frame per beat) starting at t=${r.start.toFixed(3)}s`)
        if (!runs.length) ctx.out.log('no steady cadence found (needs ≥4 frames with equal gaps)')
      },
    },
  ],
  run: async () => {
    throw new UsageError('reel needs a subcommand', 'storeship reel <card|make|pts>')
  },
}
