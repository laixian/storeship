/**
 * Simulator driver: tap, drag, screenshot, status bar, accessibility tree.
 *
 * Two input channels. **idb first** (`idb ui tap` drives CoreSimulator HID
 * directly): it takes device logical points, needs no window geometry, no
 * focus, no Accessibility grant. **CGEvent fallback** when idb is missing:
 * synthesize mouse events at screen coordinates computed from the
 * simulator window (AppleScript), with four known traps — `osascript`'s
 * `click at` does not work (-25204); with two simulators open the target
 * window must be AXRaise'd or the first click is eaten as focus; coordinates
 * must be measured on the device screenshot ÷ px, never on a thumbnail; and
 * the terminal needs Accessibility permission or clicks silently no-op.
 *
 * ⚠️ `brew install idb-companion` needs standalone Command Line Tools and
 * fails on a machine with only full Xcode. The reliable install is the
 * GitHub prebuilt tarball + pip into ~/.local/opt/idb (see README).
 *
 * Landscape: the simulator hardware stays portrait while the app rotates,
 * so screenshots come out sideways (`sips --rotate 270` fixes them) and a
 * point measured on the rotated image must go back through
 * `raw = (W_pt·px − y, x)` before tapping. `ltap` does that on both channels.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StoreshipError } from '../errors.ts'
import { which } from '../proc.ts'

export type SimProfile = { name: string; pt: [number, number]; px: number }

export type SimOptions = { idb?: string; udid?: string; profile: SimProfile }

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function findIdb(configured?: string): { bin: string; env: NodeJS.ProcessEnv } | undefined {
  const home = join(homedir(), '.local', 'opt', 'idb')
  const env = { ...process.env, PATH: `${home}:${process.env.PATH ?? ''}` } // idb must find idb_companion
  for (const cand of [process.env.STORESHIP_IDB, configured, join(home, 'venv', 'bin', 'idb'), which('idb')]) {
    if (!cand) continue
    const r = spawnSync(cand, ['--help'], { env, encoding: 'utf8' })
    if (r.status === 0) return { bin: cand, env }
  }
  return undefined
}

export function simctl(args: string[]): string {
  return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' })
}

/** UDID of the booted simulator named `name`, or the only booted one when name is undefined. */
export function bootedUdid(name?: string): string {
  const list = JSON.parse(simctl(['list', 'devices', 'booted', '-j'])) as { devices: Record<string, { name: string; udid: string; state: string }[]> }
  const booted = Object.values(list.devices).flat().filter((d) => d.state === 'Booted')
  const pick = name ? booted.find((d) => d.name === name) : booted[0]
  if (!pick) throw new StoreshipError(name ? `no booted simulator named "${name}"` : 'no booted simulator', `booted: ${booted.map((d) => d.name).join(', ') || 'none'}. Boot one in Simulator.app or \`xcrun simctl boot "<name>"\``)
  if (!name && booted.length > 1) throw new StoreshipError(`${booted.length} simulators are booted; say which with --profile or --udid`, booted.map((d) => `${d.name} ${d.udid}`).join('\n'))
  return pick.udid
}

export class Sim {
  readonly idb: { bin: string; env: NodeJS.ProcessEnv } | undefined
  readonly udid: string
  readonly profile: SimProfile
  constructor(o: SimOptions) {
    this.idb = findIdb(o.idb)
    this.profile = o.profile
    this.udid = o.udid ?? bootedUdid(o.profile.name)
  }

  channel(): string {
    return this.idb ? `idb (${this.idb.bin})` : 'CGEvent fallback (no idb; see README for the install)'
  }

  // ---- CGEvent fallback -------------------------------------------------
  private hid(): string {
    const out = join(tmpdir(), 'storeship-sim-hid')
    const src = join(dirname(fileURLToPath(import.meta.url)), 'sim-hid.swift')
    if (!existsSync(out) || statSync(out).mtimeMs < statSync(src).mtimeMs) execFileSync('swiftc', ['-O', '-o', out, src])
    return out
  }
  private osa(script: string): string {
    return execFileSync('osascript', ['-e', script], { encoding: 'utf8' }).trim()
  }
  private window(): { x: number; y: number; scale: number } {
    const s = this.osa(`tell application "System Events" to tell process "Simulator"
      repeat with w in windows
        if name of w contains "${this.profile.name}" then return (position of w) & (size of w)
      end repeat
    end tell`)
    const [x, y, w, h] = s.split(',').map((v) => Number(v.trim())) as [number, number, number, number]
    const scale = w / this.profile.pt[0]
    return { x, y: y + (h - this.profile.pt[1] * scale), scale }
  }
  private toScreen(dx: number, dy: number): [number, number] {
    const { x, y, scale } = this.window()
    return [Math.round(x + dx * scale), Math.round(y + dy * scale)]
  }
  private activate(): void {
    this.osa('tell application "Simulator" to activate')
    this.osa(`tell application "System Events" to tell process "Simulator"
      repeat with w in windows
        if name of w contains "${this.profile.name}" then perform action "AXRaise" of w
      end repeat
    end tell`)
    sleep(400)
  }

  // ---- actions ------------------------------------------------------------
  tap(dx: number, dy: number): void {
    if (this.idb) {
      execFileSync(this.idb.bin, ['ui', 'tap', '--udid', this.udid, String(Math.round(dx)), String(Math.round(dy))], { env: this.idb.env, stdio: 'ignore' })
      sleep(600)
      return
    }
    this.activate()
    const [sx, sy] = this.toScreen(dx, dy)
    execFileSync(this.hid(), ['click', String(sx), String(sy)])
    sleep(700)
  }

  /** Landscape page: pixel coordinates on the rotated (landscape) screenshot. */
  ltap(lx: number, ly: number): void {
    const px = this.profile.px
    this.tap((this.profile.pt[0] * px - ly) / px, lx / px)
  }

  drag(x1: number, y1: number, x2: number, y2: number): void {
    if (this.idb) {
      execFileSync(this.idb.bin, ['ui', 'swipe', '--udid', this.udid, ...[x1, y1, x2, y2].map((v) => String(Math.round(v)))], { env: this.idb.env, stdio: 'ignore' })
      sleep(600)
      return
    }
    this.activate()
    const a = this.toScreen(x1, y1)
    const b = this.toScreen(x2, y2)
    execFileSync(this.hid(), ['drag', String(a[0]), String(a[1]), String(b[0]), String(b[1])])
    sleep(600)
  }

  shot(out: string, rotate?: number): void {
    simctl(['io', this.udid, 'screenshot', out])
    if (rotate) execFileSync('sips', ['--rotate', String(rotate), out], { stdio: 'ignore' })
  }

  /** The App Store status bar: 9:41, full battery, full signal. */
  statusBar(time = '9:41'): void {
    simctl(['status_bar', this.udid, 'override', '--time', time, '--batteryState', 'charged', '--batteryLevel', '100', '--wifiBars', '3', '--cellularBars', '4'])
  }

  text(s: string): void {
    if (!this.idb) throw new StoreshipError('typing needs idb')
    execFileSync(this.idb.bin, ['ui', 'text', '--udid', this.udid, s], { env: this.idb.env, stdio: 'ignore' })
  }

  // ---- accessibility -------------------------------------------------------
  tree(): any[] {
    if (!this.idb) throw new StoreshipError('the accessibility tree needs idb')
    const out = execFileSync(this.idb.bin, ['ui', 'describe-all', '--udid', this.udid], { env: this.idb.env, encoding: 'utf8', maxBuffer: 64 << 20 })
    return (JSON.parse(out) as any[]).filter((e) => e.frame)
  }

  /** a11y frames are in app coordinates; on a landscape route idb wants device (portrait) points: dev = (W_dev − y, x). */
  toDevice(x: number, y: number): [number, number] {
    const app = this.tree().find((e) => e.type === 'Application')?.frame
    if (!app || app.width <= app.height) return [x, y]
    return [app.height - y, x]
  }

  find(label: string, nth = 0): any | undefined {
    const hits = this.tree().filter((e) => `${e.AXLabel ?? ''} ${e.AXValue ?? ''}`.toLowerCase().includes(label.toLowerCase()))
    return hits[nth]
  }

  tapLabel(label: string, nth = 0): { label: string; app: [number, number]; dev: [number, number] } {
    const e = this.find(label, nth)
    if (!e) throw new StoreshipError(`no element matching "${label}"`, 'list them with `storeship sim ls [pattern]`')
    const x = e.frame.x + e.frame.width / 2
    const y = e.frame.y + e.frame.height / 2
    const dev = this.toDevice(x, y)
    this.tap(dev[0], dev[1])
    return { label: e.AXLabel, app: [x, y], dev }
  }
}
