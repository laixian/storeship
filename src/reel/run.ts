import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StoreshipError } from '../errors.ts'
import type { ReelContent } from './types.ts'

/** Compile a bundled Swift tool once (cached by mtime) and return the binary. */
export function swiftTool(name: string): string {
  const src = join(dirname(fileURLToPath(import.meta.url)), `${name}.swift`)
  const out = join(tmpdir(), `storeship-${name}`)
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(src).mtimeMs) {
    try {
      execFileSync('swiftc', ['-O', '-o', out, src], { stdio: 'pipe' })
    } catch (e) {
      throw new StoreshipError(`cannot compile ${name}.swift: ${(e as { stderr?: Buffer }).stderr?.toString().slice(-400)}`, 'Xcode (with its toolchain) is required for reel', { code: 'MISSING_TOOL' })
    }
  }
  return out
}

export type MakeOptions = { recording: string; card: string; out: string; start?: number; duration?: number; audio?: string; audioT0?: number }

export function makeReel(content: ReelContent, o: MakeOptions): string {
  const bin = swiftTool('reel')
  const c = content.crop ?? {}
  const args = [
    o.recording, o.card, o.out,
    '--canvas', `${content.canvas.w},${content.canvas.h}`,
    '--band', `${content.band.x},${content.band.y},${content.band.w},${content.band.h}`,
    '--crop', `${c.left ?? 0},${c.right ?? 0},${c.top ?? 0},${c.bottom ?? 0}`,
    '--fps', String(content.fps ?? 30),
    '--start', String(o.start ?? 0),
  ]
  if (o.duration !== undefined) args.push('--duration', String(o.duration))
  if (o.audio) args.push('--audio', o.audio, '--audio-t0', String(o.audioT0 ?? 0))
  if (content.rotate === false) args.push('--no-rotate')
  try {
    return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string }
    const msg = (err.stderr ?? '').trim() || (err.stdout ?? '').trim()
    throw new StoreshipError(msg.replace(/^✗ /, ''), /band height must be/.test(msg) ? 'band.h in the reel content must match the cropped recording; the template reads the same band, so change it in one place' : undefined, { code: 'CHECK_FAILED' })
  }
}

export function framePts(file: string): number[] {
  const bin = swiftTool('pts')
  const out = execFileSync(bin, [file], { encoding: 'utf8', maxBuffer: 64 << 20 })
  return out.split('\n').filter((l) => l.startsWith('t=')).map((l) => Number(l.slice(2)))
}

export type Run = { from: number; to: number; frames: number; gap: number; start: number }

/**
 * Pure: runs of ≥ `minFrames` consecutive frames with (almost) equal gaps.
 * On a beat-driven redraw the first frame of such a run is the first beat —
 * that is where offline-rendered audio belongs, not the frame where play
 * was pressed (the playhead starts one frame later).
 */
export function steadyRuns(pts: number[], minFrames = 4, tolerance = 0.06): Run[] {
  const runs: Run[] = []
  let i = 1
  while (i < pts.length) {
    const gap = pts[i]! - pts[i - 1]!
    let j = i
    while (j + 1 < pts.length && Math.abs(pts[j + 1]! - pts[j]! - gap) <= gap * tolerance) j++
    const frames = j - i + 2
    if (frames >= minFrames && gap > 0.05) runs.push({ from: i - 1, to: j, frames, gap: Math.round(((pts[j]! - pts[i - 1]!) / (frames - 1)) * 10000) / 10000, start: pts[i - 1]! })
    i = j + 1
  }
  return runs
}
