import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { StoreshipError } from '../errors.ts'
import { which } from '../proc.ts'
import type { Card, Device, Img, Shot, Template } from './types.ts'

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

/** Render an HTML document to a PNG of exactly w×h device pixels. */
export function shoot(chrome: string, html: string, w: number, h: number, out: string, tmpDir: string): void {
  mkdirSync(tmpDir, { recursive: true })
  const page = join(tmpDir, `page-${process.pid}.html`)
  writeFileSync(page, html)
  execFileSync(
    chrome,
    ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${w},${h}`, `--screenshot=${out}`, `file://${page}`],
    { stdio: 'ignore' },
  )
}

/**
 * Contact sheet: the set side by side, the way the store page shows it.
 * This is the only real acceptance test — each picture looks fine alone;
 * only the row shows clashing backgrounds or a progression that stalls.
 */
export function sheet(chrome: string, files: string[], out: string, tmpDir: string, thumb = 300): void {
  const tags = files.map((f) => `<img src="${dataUri(f)}">`).join('')
  const html = `<!doctype html><style>body{margin:0;background:#555;display:flex;gap:14px;padding:14px}img{width:${thumb}px;display:block}</style>${tags}`
  const h = Math.round((thumb * pngSize(files[0]!).h) / pngSize(files[0]!).w) + 28
  shoot(chrome, html, files.length * (thumb + 14) + 14, h, out, tmpDir)
}

export function renderShot(template: Template, shot: Shot, locale: string, device: Device, total: number, imgFor: (card: Card) => Img): string {
  const cards = (shot.cards[device.id] ?? []).map((card) => ({ card, img: imgFor(card) }))
  return template.render({ shot, locale, device, total, title: shot.title[locale] ?? [], cards })
}
