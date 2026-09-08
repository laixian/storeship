/**
 * Raw simulator recordings → an App Preview.
 *
 * Three lessons that only simulator footage teaches:
 *
 * 1. `simctl io recordVideo` writes a frame only when something changes
 *    (VFR). A static tail has no frames, so `xfade` on the raw files breaks
 *    the stream at the seam — the symptom is "right duration, half the
 *    frames". Each segment is therefore rendered to a fixed-length CFR
 *    intermediate first (`fps=N` + `tpad` clone of the last frame + `-t`).
 * 2. The crossfade offsets must use the durations actually produced, not
 *    the ones requested: on VFR sources `-t 8.5` often yields less, and an
 *    offset computed from the request lands past the end of segment 1 —
 *    "the film is only as long as the first segment".
 * 3. Never trim the head: `trim=0.3` drops the pts=0 frame, and under VFR
 *    the next frame may be two seconds later, so the opening vanishes.
 *
 * Landscape UI recorded by a portrait simulator is rotated with
 * `transpose=2`; a `:p` segment is a portrait page and is letterboxed.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StoreshipError } from '../errors.ts'
import { probe, run } from './ffmpeg.ts'

export type Segment = { file: string; start: number; duration: number; portrait: boolean }

/** `file.mov:1.0:8.5[:p]` */
export function parseSegment(spec: string): Segment {
  const parts = spec.split(':')
  const portrait = parts.at(-1) === 'p'
  if (portrait) parts.pop()
  if (parts.length < 3) throw new StoreshipError(`segment "${spec}" must be <file>:<start>:<duration>[:p]`, undefined, { code: 'USAGE' })
  const duration = Number(parts.pop())
  const start = Number(parts.pop())
  const file = parts.join(':')
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) throw new StoreshipError(`segment "${spec}": start and duration must be numbers`, undefined, { code: 'USAGE' })
  return { file, start, duration, portrait }
}

/** Pure: the xfade filter graph for CFR parts of these real durations. */
export function xfadeChain(durations: number[], xf: number): { filter: string; last: string; total: number } {
  let filter = ''
  let prev = '0:v'
  let acc = durations[0] ?? 0
  for (let i = 1; i < durations.length; i++) {
    const off = Math.round((acc - xf) * 1000) / 1000
    filter += `[${prev}][${i}:v]xfade=transition=fade:duration=${xf}:offset=${off}[x${i}];`
    prev = `x${i}`
    acc = Math.round((acc + durations[i]! - xf) * 1000) / 1000
  }
  return { filter: filter.replace(/;$/, ''), last: prev, total: acc }
}

export type CutOptions = {
  out: string
  segments: Segment[]
  width: number
  height: number
  fps?: number
  xfade?: number
  music?: string
  crf?: number
  fadeIn?: number
  fadeOut?: number
  /** Rotation for landscape-UI segments; `transpose=2` = 90° counter-clockwise. */
  transpose?: 1 | 2
  onLog?: (line: string) => void
}

export type CutResult = { out: string; parts: { file: string; requested: number; actual: number }[]; total: number }

export function cutPreview(ff: string, o: CutOptions): CutResult {
  const fps = o.fps ?? 30
  const xf = o.xfade ?? 0.5
  const crf = String(o.crf ?? 18)
  const tmp = mkdtempSync(join(tmpdir(), 'storeship-preview-'))
  try {
    const parts: string[] = []
    const real: number[] = []
    o.segments.forEach((s, i) => {
      const rot = s.portrait ? '' : `transpose=${o.transpose ?? 2},`
      const fit = s.portrait ? `scale=-2:${o.height},pad=${o.width}:${o.height}:(${o.width}-iw)/2:0:black` : `scale=${o.width}:-2,pad=${o.width}:${o.height}:0:(${o.height}-ih)/2:black`
      const p = join(tmp, `p${i}.mp4`)
      run(ff, ['-ss', String(s.start), '-i', s.file, '-vf', `${rot}${fit},fps=${fps},tpad=stop_mode=clone:stop_duration=3,setsar=1`, '-t', String(s.duration), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', crf, '-preset', 'medium', '-y', p], `render segment ${i + 1} (${s.file})`)
      const d = probe(ff, p).duration
      parts.push(p)
      real.push(d)
      o.onLog?.(`segment ${i + 1}: requested ${s.duration}s, got ${d.toFixed(2)}s`)
    })
    const joined = join(tmp, 'v.mp4')
    if (parts.length === 1) run(ff, ['-i', parts[0]!, '-c', 'copy', '-y', joined], 'copy')
    else {
      const chain = xfadeChain(real, xf)
      run(ff, [...parts.flatMap((p) => ['-i', p]), '-filter_complex', chain.filter, '-map', `[${chain.last}]`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', crf, '-preset', 'medium', '-y', joined], 'crossfade')
    }
    const total = probe(ff, joined).duration
    const fin = o.fadeIn ?? 0.4
    const fout = o.fadeOut ?? 0.6
    const vf = `fade=t=in:st=0:d=${fin},fade=t=out:st=${Math.max(0, Math.round((total - fout) * 1000) / 1000)}:d=${fout}`
    if (o.music) {
      const afo = Math.max(0, Math.round((total - 1.5) * 1000) / 1000)
      run(ff, ['-i', joined, '-i', o.music, '-vf', vf, '-af', `afade=t=in:st=0:d=1.0,afade=t=out:st=${afo}:d=1.5`, '-t', String(total), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', crf, '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-shortest', '-movflags', '+faststart', '-y', o.out], 'final mix')
    } else run(ff, ['-i', joined, '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', crf, '-preset', 'medium', '-movflags', '+faststart', '-y', o.out], 'final encode')
    return { out: o.out, parts: o.segments.map((s, i) => ({ file: s.file, requested: s.duration, actual: real[i]! })), total }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
