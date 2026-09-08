/**
 * Screen recording on the simulator.
 *
 * ⚠️ Stop with SIGINT to the `recordVideo` process itself. Killing the
 * `xcrun` wrapper (or letting a timeout kill it) leaks the session inside
 * CoreSimulator; every later recording fails with "Host recording is
 * already in progress", and the only fix is rebooting that simulator (and
 * re-applying the status bar override).
 *
 * The recording has no app audio and is VFR (see cut.ts).
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StoreshipError } from '../errors.ts'

const PID_FILE = join(tmpdir(), 'storeship-preview-record.json')

export function startRecording(udid: string, out: string, codec = 'h264'): { pid: number; out: string } {
  if (existsSync(PID_FILE)) {
    const prev = JSON.parse(readFileSync(PID_FILE, 'utf8')) as { pid: number; out: string }
    try {
      process.kill(prev.pid, 0)
      throw new StoreshipError(`a recording is already running (pid ${prev.pid} → ${prev.out})`, 'stop it with `storeship preview stop`', { code: 'CHECK_FAILED' })
    } catch (e) {
      if (e instanceof StoreshipError) throw e
      unlinkSync(PID_FILE)
    }
  }
  const child = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', `--codec=${codec}`, '--force', out], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''
  child.stderr?.on('data', (d) => (err += d))
  child.unref()
  // give it a moment to fail fast (leaked session, bad udid)
  const t0 = Date.now()
  while (Date.now() - t0 < 800) spawnSync('sleep', ['0.1'])
  if (child.exitCode !== null) {
    const hint = /already in progress/i.test(err) ? 'a previous recording leaked inside CoreSimulator; reboot that simulator (`xcrun simctl shutdown <udid>` then boot) and set the status bar again' : undefined
    throw new StoreshipError(`recordVideo exited immediately: ${err.trim()}`, hint)
  }
  writeFileSync(PID_FILE, JSON.stringify({ pid: child.pid, out }))
  return { pid: child.pid!, out }
}

export function stopRecording(): { pid: number; out: string } {
  if (!existsSync(PID_FILE)) {
    // fall back to any recordVideo process
    const r = spawnSync('pkill', ['-INT', '-f', 'simctl io .* recordVideo'])
    if (r.status !== 0) throw new StoreshipError('no recording is running', undefined, { code: 'NOT_FOUND' })
    return { pid: 0, out: '(unknown, stopped by name)' }
  }
  const rec = JSON.parse(readFileSync(PID_FILE, 'utf8')) as { pid: number; out: string }
  try {
    process.kill(rec.pid, 'SIGINT')
  } catch {
    /* already gone */
  }
  unlinkSync(PID_FILE)
  // wait for the file to be finalized
  const t0 = Date.now()
  while (Date.now() - t0 < 5000) {
    try {
      process.kill(rec.pid, 0)
      spawnSync('sleep', ['0.2'])
    } catch {
      break
    }
  }
  return rec
}
