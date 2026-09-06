/**
 * The contract between the tool and a project's screenshot content/template.
 *
 * The tool owns: device profiles (pixel sizes ASC accepts, simulator names),
 * validation, rendering, the contact sheet, and uploading by display type.
 * The project owns: which screens, what the titles say, how each card is
 * cropped (content), and what the canvas looks like (template).
 */

/** A piece of a real screenshot placed on the canvas. `sx/sy/sw` is a rectangle on the source image; height follows the card's aspect. */
export type Card = {
  x: number
  y: number
  w: number
  h: number
  sx?: number
  sy?: number
  sw?: number
  /** Use another screen's screenshot: the `<n>-<slug>` stem. Default: this shot's own. */
  src?: string
}

export type Shot = {
  /** Store order, 1-based and contiguous. */
  n: number
  /** Filename stem of the source screenshot and default `src`. */
  slug: string
  /** Optional short tag the template may print (e.g. a silkscreen label). */
  sn?: string
  /** Canvas background, #RRGGBB. */
  bg: string
  /** Title lines per locale (ASC locale codes). */
  title: Record<string, string[]>
  /** Layout per device id. A missing device is an error, never a silently wrong picture. */
  cards: Record<string, Card[]>
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
  /** Type/spacing scale hint for templates; 1 = 6.9" iPhone. */
  unit: number
  /** ASC screenshot set display type, e.g. APP_IPHONE_67. */
  displayType: string
  /** Simulator profile for `storeship sim`. */
  sim?: { name: string; pt: [number, number]; px: number }
}

export type Img = { uri: string; w: number; h: number }

export type TemplateContext = {
  shot: Shot
  locale: string
  device: Device
  total: number
  title: string[]
  cards: { card: Card; img: Img }[]
}

export type Template = {
  render(ctx: TemplateContext): string
  /** Required number of title lines (default 2). */
  titleLines?: number
  /** Cheap tripwire per locale: max characters per title line. The real check is the contact sheet. */
  titleMax?: Record<string, number>
  /** Pattern `sn` must match when present. */
  snPattern?: RegExp
}

export type ShotsContent = {
  shots: Shot[]
  /** Extra or overridden device profiles. */
  devices?: Record<string, Partial<Device> & { id: string }>
  template?: Template
}
