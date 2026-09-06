/**
 * Vertical social video ("reel"): a simulator recording placed into a hole
 * in a designed card, with optional audio aligned to the recording's
 * timeline.
 */
export type Rect = { x: number; y: number; w: number; h: number }

export type ReelContent = {
  /** Output pixels, e.g. 1080×1440 (3:4) or 1080×1920 (9:16). */
  canvas: { w: number; h: number }
  /** Where the video shows through. `h` must equal the cropped, rotated recording scaled to `w` — `reel make` tells you the right number. */
  band: Rect
  /** Pixels trimmed from the rotated (landscape) recording before scaling. Left usually hides the Dynamic Island. */
  crop?: { left?: number; right?: number; top?: number; bottom?: number }
  /** Rotate the recording 90° (a landscape app recorded by a portrait simulator). Default true. */
  rotate?: boolean
  fps?: number
  /** Free-form copy for the template. The default template reads sn / title / points / brand / colors. */
  copy?: Record<string, unknown>
}

export type ReelTemplateContext = { content: ReelContent; canvas: { w: number; h: number }; band: Rect; panes: string }

export type ReelTemplate = {
  /** Inner HTML of the card (the tool supplies the document, transparent background and Chrome flags). */
  render(ctx: ReelTemplateContext): string
  /** Extra CSS for the card. */
  css?(ctx: ReelTemplateContext): string
}
