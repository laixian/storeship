/**
 * The style registry. A new built-in style is one more entry here; a project
 * style is a module exporting a `Style`, usually `extendStyle('stage', …)`.
 * Styles paint — they never place phones (see `layout.ts`).
 */
import type { Style } from '../types.ts'
import { colorStyle } from './color.ts'
import { plainStyle } from './plain.ts'
import { stageStyle } from './stage.ts'

export const STYLES: Record<string, Style> = {
  plain: plainStyle,
  stage: stageStyle,
  color: colorStyle,
}

export const DEFAULT_STYLE = 'plain'

/**
 * A style built on another one. Overrides may be an object or a function of
 * the base (to wrap it: `backdrop: (s) => base.backdrop(s) + mine(s)`).
 */
export function extendStyle(base: string | Style, over: Partial<Style> | ((base: Style) => Partial<Style>)): Style {
  const b = typeof base === 'string' ? STYLES[base] : base
  if (!b) throw new Error(`unknown base style "${String(base)}" — built in: ${Object.keys(STYLES).join(', ')}`)
  const o = typeof over === 'function' ? over(b) : over
  return { ...b, ...o, tokens: { ...b.tokens, ...o.tokens } }
}

/** Token defaults overlaid with the content's `theme`. */
export function resolveTheme(style: Style, theme: Record<string, string | number> = {}): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const [k, t] of Object.entries(style.tokens)) out[k] = theme[k] ?? t.default
  return out
}
