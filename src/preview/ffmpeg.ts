/**
 * ffmpeg location and probing. ffmpeg is not vendored: point at a static
 * single-file build (STORESHIP_FFMPEG / `ffmpeg` in the config) or have it
 * on PATH.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { StoreshipError } from '../errors.ts'
import { which } from '../proc.ts'

export const FFMPEG_HINT =
  'put a static ffmpeg at ~/.local/opt/ffmpeg/ffmpeg (macOS arm64 builds: https://www.osxexperts.net/ or https://evermeet.cx/ffmpeg/), or set ffmpeg in storeship.config.json / STORESHIP_FFMPEG, or `brew install ffmpeg`'

export function findFfmpeg(configured?: string): string {
  const c = process.env.STORESHIP_FFMPEG ?? configured
  if (c) {
    if (!existsSync(c)) throw new StoreshipError(`ffmpeg not found at ${c}`, FFMPEG_HINT, { code: 'MISSING_TOOL' })
    return c
  }
  const p = which('ffmpeg')
  if (p) return p
  const conventional = join(homedir(), '.local', 'opt', 'ffmpeg', 'ffmpeg')
  if (existsSync(conventional)) return conventional
  throw new StoreshipError('ffmpeg not found', FFMPEG_HINT, { code: 'MISSING_TOOL' })
}

export type Probe = { duration: number; width: number; height: number; fps: number; frames?: number; audio: boolean }

/** `00:00:29.76` → 29.76 */
export function parseDuration(s: string): number {
  const [h, m, sec] = s.split(':').map(Number)
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (sec ?? 0)
}

/** Pure: read what `ffmpeg -i` prints on stderr. */
export function parseProbe(stderr: string): Omit<Probe, 'frames'> {
  const d = /Duration: ([0-9:.]+)/.exec(stderr)
  const v = /Stream #\d+:\d+.*Video: .*?(\d{2,5})x(\d{2,5})/.exec(stderr)
  const f = /(\d+(?:\.\d+)?) fps/.exec(stderr)
  if (!d || !v) throw new StoreshipError(`could not read the video: ${stderr.split('\n').filter((l) => /error|Invalid|No such/i.test(l)).join(' ') || 'no video stream'}`, undefined, { code: 'CHECK_FAILED' })
  return { duration: parseDuration(d[1]!), width: Number(v[1]), height: Number(v[2]), fps: f ? Number(f[1]) : 0, audio: /Audio: /.test(stderr) }
}

export function probe(ff: string, file: string, countFrames = false): Probe {
  if (!existsSync(file)) throw new StoreshipError(`no such file: ${file}`, undefined, { code: 'NOT_FOUND' })
  const r = spawnSync(ff, ['-hide_banner', '-i', file], { encoding: 'utf8' })
  const p: Probe = parseProbe(r.stderr)
  if (countFrames) {
    const c = spawnSync(ff, ['-hide_banner', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'], { encoding: 'utf8' })
    const m = [...c.stderr.matchAll(/frame=\s*(\d+)/g)].at(-1)
    if (m) p.frames = Number(m[1])
  }
  return p
}

export function run(ff: string, args: string[], what: string): void {
  const r = spawnSync(ff, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new StoreshipError(`${what} failed:\n${(r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n')}`)
}
