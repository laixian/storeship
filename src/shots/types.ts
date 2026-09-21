/**
 * The contract between the tool and a project's screenshots.
 *
 * Three layers, and who owns each:
 *
 *  - **content** (project): which screens, in what order, what the titles say.
 *    No coordinates anywhere — a project cannot place a phone by hand.
 *  - **layout** (tool, fixed): where every phone goes. One phone size for the
 *    whole set, landscape phones run off the canvas instead of shrinking, only
 *    the hero may tilt, one phone per frame unless a pair is really needed and
 *    two pairs never sit side by side. These are rules, not defaults, so a new
 *    style cannot bring the clutter back.
 *  - **style** (built in or project): what it looks like — the backdrop that
 *    runs through the whole set, each frame's title block, the device finish,
 *    colours, type. A style supplies a few numbers to the layout (margins,
 *    baseline) and paints; it never moves a phone.
 *
 * Rendering puts the whole set on one stage N·W wide and screenshots it N
 * times, shifted by -i·W, so anything drawn across a seam lines up by
 * construction.
 */

/** Device body drawn around a screenshot, as shares of the screen's short side. */
export type DeviceBody = {
  kind: 'island' | 'home' | 'ipad'
  /** Metal rim width. */
  rim: number
  /** Black border between rim and glass, per side (for `home`, the long-edge borders are `chin`). */
  bezel: number
  /** Top/bottom border of a Home-button phone. */
  chin?: number
  /** Screen corner radius. */
  radius: number
  /** Buttons along the long edges: [side, start, length] as shares of the long edge; side a = left in portrait. */
  buttons: ['a' | 'b', number, number][]
}

export type Device = {
  id: string
  /** Source filename prefix: `<prefix>-<localeTag>-<stem>.png` */
  prefix: string
  /** Canvas pixels (portrait). Must be a size App Store Connect accepts for `displayType`. */
  w: number
  h: number
  /** Native pixels of the source screenshots (portrait; landscape is the same rotated). */
  srcW: number
  srcH: number
  /** Type/spacing scale hint for styles; 1 = 6.9" iPhone. */
  unit: number
  /** ASC screenshot set display type, e.g. APP_IPHONE_67. */
  displayType: string
  /** Body drawn around the screenshot. */
  body: DeviceBody
  /** Simulator profile for `storeship sim`. */
  sim?: { name: string; pt: [number, number]; px: number }
}

/** Title-like text: lines per ASC locale. */
export type Localized = Record<string, string[]>

/** A source screenshot: its stem (`<prefix>-<localeTag>-<stem>.png`), and for a landscape one which end stays on the canvas. */
export type Screen = string | { src: string; anchor?: 'start' | 'end' }

export type Frame = {
  /** Output filename part: `<prefix>-<localeTag>-<n>-<slug>.png`. */
  slug: string
  /** Short tag a style may print (a silkscreen label). */
  sn?: string
  /** Per-frame colour for styles that paint frame by frame, #RRGGBB. */
  bg?: string
  title: Localized
  /** The one phone on this frame. */
  screen?: Screen
  /** Two phones — the exception. Two pair frames may never be neighbours. */
  screens?: Screen[]
  /**
   * This frame spans two store slots with one tilted phone across the seam
   * (the only phone allowed to tilt). The first slot carries the brand, the
   * second this frame's title.
   */
  hero?: { seamAt?: number; tilt?: number }
}

export type Brand = {
  /** The logo, cropped from a real screenshot: [x, y, w, h] in source pixels. */
  logo?: { src: string; crop: [number, number, number, number] }
  tagline?: Localized
}

export type ShotsContent = {
  /** A built-in style id, a path to a style module, or a style object. Default `plain`. */
  style?: string | Style
  /** Style tokens (see `storeship shots styles`). */
  theme?: Record<string, string | number>
  brand?: Brand
  frames: Frame[]
  /** Extra or overridden device profiles. */
  devices?: Record<string, Partial<Device> & { id: string }>
}

// ── what the layout hands to a style ────────────────────────────────────────

export type Img = { uri: string; w: number; h: number }

/** A placed phone. Frame-local coordinates, or stage coordinates when `span`. */
export type Placed = {
  src: string
  land: boolean
  /** Outer box of the device body. */
  x: number
  y: number
  w: number
  h: number
  /** Screen size inside it. */
  sw: number
  sh: number
  rot: number
  /** Owning slot (0-based), or the first slot of a hero when `span`. */
  slot: number
  span: boolean
}

/** One store slot after heroes are expanded. */
export type Slot = {
  /** 1-based store position. */
  n: number
  frame: Frame
  /** 0 or 1 inside a hero; 0 otherwise. */
  half: 0 | 1
  hero: boolean
}

export type Metrics = {
  /** Outer width of a portrait phone. Landscape phones use the same scale. */
  phone: number
  /** Top edge of every non-hero phone. */
  baseline: number
  /** Vertical centre of the hero phone. */
  heroY: number
  /** Gap between two stacked phones. */
  gap: number
}

export type StageCtx = {
  device: Device
  locale: string
  theme: Record<string, string | number>
  slots: Slot[]
  /** Slot width/height (the canvas) and the whole stage width. */
  W: number
  H: number
  stageW: number
  metrics: Metrics
  brand?: Brand
  /** Data-URI image for a source stem in this locale (logo crops). */
  img(stem: string): Img
}

export type SlotCtx = StageCtx & {
  slot: Slot
  /** 0-based index of this slot. */
  i: number
  /** This slot's title lines in this locale. */
  title: string[]
  /** The hero phone crossing this slot, in stage coordinates (its y is the slot's too) — so a brand half can stay above it. */
  hero?: Placed
}

/**
 * What a style module may export instead of a `Style`: a factory that is
 * handed the running storeship's own style kit. The project then never
 * imports storeship at runtime, so the style is built against the storeship
 * that renders it, not whichever version sits in the project's node_modules.
 */
export type StyleFactory = (kit: { extendStyle: (base: string | Style, over: Partial<Style> | ((base: Style) => Partial<Style>)) => Style; STYLES: Record<string, Style>; styleKit: typeof import('./styles/common.ts') }) => Style

export type ThemeToken = { type: 'color' | 'number' | 'font'; default: string | number; doc: string }

export type Style = {
  id: string
  summary: string
  /** Tokens a content file may set under `theme`. */
  tokens: Record<string, ThemeToken>
  /** `bezel`: a drawn device; `card`: the bare screen, rounded, with a shadow. */
  look: 'bezel' | 'card'
  /** Required title lines (default 2). */
  titleLines?: number
  /** Cheap tripwire per locale: max characters per title line. */
  titleMax?: Record<string, number>
  /** Pattern `sn` must match when present. */
  snPattern?: RegExp
  /** Whether frames must set `bg`. */
  needsBg?: boolean
  metrics(device: Device, locale: string, theme: Record<string, string | number>): Metrics
  css(s: StageCtx): string
  /** Painted once in stage coordinates — the part that runs through the whole set. */
  backdrop(s: StageCtx): string
  /** Per slot, in slot coordinates, clipped to the slot. */
  header(s: SlotCtx): string
  /** The brand half of a hero, in slot coordinates. */
  brand(s: SlotCtx): string
}
