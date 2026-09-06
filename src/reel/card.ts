/**
 * The card layer: a canvas-sized PNG whose video band is a transparent hole.
 *
 * Why a foreground with a hole and not a background: in a frame produced by
 * `AVVideoCompositionCoreAnimationTool`, the area outside the video is
 * black, not transparent, so a background layer would be covered entirely.
 * The card therefore sits on top and exposes the video through the hole.
 *
 * The hole only stays transparent if nothing paints over it: the opaque
 * background must be four panes around the band, never a background on the
 * card itself. `panes()` builds those. Chrome needs
 * `--default-background-color=00000000` or the hole comes out white.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StoreshipError } from '../errors.ts'
import type { Rect, ReelContent, ReelTemplate } from './types.ts'

/** Four opaque rectangles around the band. */
export function panes(canvas: { w: number; h: number }, band: Rect, color: string): string {
  const r = band.x + band.w
  const b = band.y + band.h
  const pane = (x: number, y: number, w: number, h: number): string => `<div class="pane" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${color}"></div>`
  return pane(0, 0, canvas.w, band.y) + pane(0, b, canvas.w, canvas.h - b) + pane(0, band.y, band.x, band.h) + pane(r, band.y, canvas.w - r, band.h)
}

export function cardHtml(content: ReelContent, template: ReelTemplate): string {
  const ctx = { content, canvas: content.canvas, band: content.band, panes: '' }
  const bg = String((content.copy?.colors as Record<string, string> | undefined)?.bg ?? '#000000')
  ctx.panes = panes(content.canvas, content.band, bg)
  return `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${content.canvas.w}px;height:${content.canvas.h}px;background:transparent;overflow:hidden}
.card{position:relative;width:${content.canvas.w}px;height:${content.canvas.h}px;background:transparent;-webkit-font-smoothing:antialiased}
.pane{position:absolute}
${template.css?.(ctx) ?? ''}
</style><div class="card">${template.render(ctx)}</div>`
}

export function renderCard(chrome: string, html: string, canvas: { w: number; h: number }, out: string): void {
  const tmp = join(tmpdir(), `storeship-reel-card-${process.pid}.html`)
  writeFileSync(tmp, html)
  try {
    execFileSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--default-background-color=00000000', `--window-size=${canvas.w},${canvas.h}`, `--screenshot=${out}`, `file://${tmp}`], { stdio: 'pipe' })
  } finally {
    unlinkSync(tmp)
  }
  const b = readFileSync(out)
  // IHDR colour type at byte 25: 6 = RGBA. Without alpha the hole is opaque and the video is hidden.
  if (b[25] !== 6) throw new StoreshipError('the card PNG has no alpha channel, so the hole would be opaque', 'Chrome ignored --default-background-color; check the Chrome build, or set chrome in the config to a different binary')
}
