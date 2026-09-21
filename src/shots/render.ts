import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { StoreshipError } from '../errors.ts'
import { which } from '../proc.ts'

/** Width/height from the PNG IHDR (first 24 bytes) — no image library needed. */
export function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file)
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) throw new StoreshipError(`${file} is not a PNG`, undefined, { code: 'CHECK_FAILED' })
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

const uriCache = new Map<string, string>()
export function dataUri(file: string): string {
  let v = uriCache.get(file)
  if (!v) {
    v = `data:image/png;base64,${readFileSync(file).toString('base64')}`
    uriCache.set(file, v)
  }
  return v
}

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

export function findChrome(configured?: string): string {
  const c = process.env.STORESHIP_CHROME ?? configured
  if (c) {
    if (!existsSync(c)) throw new StoreshipError(`chrome not found at ${c}`, undefined, { code: 'MISSING_TOOL' })
    return c
  }
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p
  for (const b of ['google-chrome', 'chromium', 'chromium-browser']) {
    const p = which(b)
    if (p) return p
  }
  throw new StoreshipError('no Chrome / Chromium found', 'install Google Chrome, or set chrome in storeship.config.json / STORESHIP_CHROME', { code: 'MISSING_TOOL' })
}

/** How long one Chrome screenshot may take before it counts as hung. */
export const SHOOT_TIMEOUT_MS = 60_000
/** Chrome fails now and then for reasons that are gone a second later; one more try before giving up. */
export const SHOOT_ATTEMPTS = 2

/** Why a finished Chrome run did not give us the picture, or undefined when it did. */
function badOutput(file: string, w: number, h: number): string | undefined {
  if (!existsSync(file)) return 'Chrome exited normally but wrote no file'
  try {
    const got = pngSize(file)
    return got.w === w && got.h === h ? undefined : `Chrome wrote ${got.w}×${got.h} instead of ${w}×${h}`
  } catch {
    return 'Chrome wrote something that is not a PNG'
  }
}

/** A failed execFileSync, in one line: timeout, or exit status plus the tail of stderr. */
function describeFailure(e: unknown): string {
  const x = e as { code?: string; signal?: string; status?: number | null; stderr?: Buffer | string; message?: string }
  if (x.code === 'ENOENT') return 'the Chrome binary could not be started'
  if (x.signal === 'SIGTERM' || x.code === 'ETIMEDOUT') return `Chrome did not finish within ${SHOOT_TIMEOUT_MS / 1000}s`
  const tail = String(x.stderr ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-3)
    .join(' | ')
  return `Chrome exited with ${x.status ?? x.signal ?? 'an error'}${tail ? `: ${tail}` : ''}`
}

/**
 * Render an HTML document to a PNG of exactly w×h device pixels.
 *
 * A render used to fail as a bare UNKNOWN with `retry: never` — no word of
 * which picture, no stderr (it was discarded), and the advice was wrong: the
 * failure that prompted this went away on the next run. Now stderr is kept,
 * the output is checked for existence and size, a hang is cut off, one retry
 * is made, and a failure is RENDER_FAILED naming `label`.
 *
 * ⚠️ Do not give Chrome its own `--user-data-dir`: it looks like good
 * isolation, but with one set (Chrome 2026-09, macOS) headless Chrome writes
 * the screenshot and then never exits — every call runs into the timeout.
 * The picture is written to the temp dir and copied into place only when it
 * is right, so a failed run never leaves a missing or half-written file in
 * the output folder.
 */
export function shoot(chrome: string, html: string, w: number, h: number, out: string, tmpDir: string, label = basename(out)): void {
  mkdirSync(tmpDir, { recursive: true })
  const page = join(tmpDir, `page-${process.pid}.html`)
  const shot = join(tmpDir, `shot-${process.pid}.png`)
  writeFileSync(page, html)
  const args = ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${w},${h}`, `--screenshot=${shot}`, `file://${page}`]
  const tries: string[] = []
  try {
    for (let attempt = 1; attempt <= SHOOT_ATTEMPTS; attempt++) {
      rmSync(shot, { force: true })
      try {
        execFileSync(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: SHOOT_TIMEOUT_MS })
      } catch (e) {
        tries.push(describeFailure(e))
        continue
      }
      const bad = badOutput(shot, w, h)
      if (!bad) {
        copyFileSync(shot, out)
        return
      }
      tries.push(bad)
    }
  } finally {
    rmSync(shot, { force: true })
  }
  const why = tries.map((t, i) => `attempt ${i + 1}: ${t}`).join('; ')
  throw new StoreshipError(`could not render ${label} — ${why}`, 'run the same command again; if it fails the same way, run `storeship doctor` and check the Chrome it found', { code: 'RENDER_FAILED' })
}

/**
 * Contact sheet: the set side by side, the way the store page shows it.
 * This is the only real acceptance test — each picture looks fine alone;
 * only the row shows clashing backgrounds or a progression that stalls.
 * `seamless` butts the frames together to check what runs across the seams;
 * the default spaces and rounds them like the store does, which is how
 * people will actually see the seams.
 */
export function sheet(chrome: string, files: string[], out: string, tmpDir: string, o: { thumb?: number; seamless?: boolean } = {}): void {
  const thumb = o.thumb ?? 300
  const gap = o.seamless ? 0 : 14
  const radius = o.seamless ? 0 : Math.round(thumb * 0.06)
  const tags = files.map((f) => `<img src="${dataUri(f)}">`).join('')
  const html = `<!doctype html><style>body{margin:0;background:#555;display:flex;gap:${gap}px;padding:14px}img{width:${thumb}px;display:block;border-radius:${radius}px}</style>${tags}`
  const first = pngSize(files[0]!)
  const h = Math.round((thumb * first.h) / first.w) + 28
  shoot(chrome, html, files.length * (thumb + gap) - gap + 28, h, out, tmpDir, `contact sheet ${basename(out)}`)
}
