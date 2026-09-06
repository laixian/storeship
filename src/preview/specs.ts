/**
 * App Preview specs: 15–30 s, ≤ 30 fps, H.264, no device frame, and one
 * of the exact pixel sizes per preview type. ASC rejects anything else at
 * upload, with a message that names the size but not the type.
 */
import type { Probe } from './ffmpeg.ts'

export const PREVIEW_SIZES: Record<string, [number, number][]> = {
  IPHONE_67: [[886, 1920], [1920, 886]],
  IPHONE_65: [[886, 1920], [1920, 886]],
  IPHONE_61: [[886, 1920], [1920, 886]],
  IPHONE_58: [[886, 1920], [1920, 886]],
  IPHONE_55: [[1080, 1920], [1920, 1080]],
  IPAD_PRO_3GEN_129: [[1200, 1600], [1600, 1200]],
  IPAD_PRO_129: [[1200, 1600], [1600, 1200]],
  IPAD_PRO_3GEN_11: [[1200, 1600], [1600, 1200]],
  IPAD_105: [[1200, 1600], [1600, 1200]],
  IPAD_97: [[1200, 1600], [1600, 1200]],
}

export const PREVIEW_MIN_S = 15
export const PREVIEW_MAX_S = 30

/** Pure: problems with a probed file for a preview type (any type when undefined). */
export function checkPreview(p: Probe, previewType?: string): string[] {
  const bad: string[] = []
  if (p.duration < PREVIEW_MIN_S || p.duration > PREVIEW_MAX_S) bad.push(`duration ${p.duration.toFixed(2)}s is outside ${PREVIEW_MIN_S}–${PREVIEW_MAX_S}s`)
  if (p.fps > 30.01) bad.push(`${p.fps} fps is over 30`)
  const sizes = previewType ? (PREVIEW_SIZES[previewType] ?? []) : Object.values(PREVIEW_SIZES).flat()
  if (!sizes.some(([w, h]) => w === p.width && h === p.height)) {
    const want = previewType ? sizes.map(([w, h]) => `${w}×${h}`).join(' / ') : 'an App Preview size (e.g. 1920×886, 886×1920, 1200×1600)'
    bad.push(`${p.width}×${p.height} is not ${previewType ? `a ${previewType} size (${want})` : want}`)
  }
  if (p.frames !== undefined && p.duration > 0 && p.frames < p.duration * Math.min(p.fps || 30, 30) * 0.8)
    bad.push(`only ${p.frames} frames for ${p.duration.toFixed(1)}s — a VFR seam dropped frames (cut through \`storeship preview cut\`, which renders CFR parts first)`)
  return bad
}

/** Which of a type's sizes to use for a canvas: landscape for iPhone, portrait for iPad, unless asked. */
export function defaultSize(previewType: string, orientation?: 'landscape' | 'portrait'): [number, number] {
  const sizes = PREVIEW_SIZES[previewType]
  if (!sizes) throw new Error(`unknown preview type ${previewType}`)
  const want = orientation ?? (previewType.startsWith('IPAD') ? 'portrait' : 'landscape')
  return sizes.find(([w, h]) => (want === 'landscape' ? w > h : h > w)) ?? sizes[0]!
}
