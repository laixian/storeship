/**
 * Run a child process, streaming its output to the terminal while also
 * keeping it, so a failure can be matched against hints.ts.
 */
import { spawn, spawnSync } from 'node:child_process'
import { StoreshipError } from './errors.ts'
import { hintFor } from './hints.ts'

export type RunResult = { code: number; output: string }

export function run(cmd: string, args: string[], opts: { cwd?: string; quiet?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const tap = (chunk: Buffer): void => {
      const s = chunk.toString()
      output += s
      if (!opts.quiet) process.stderr.write(s)
    }
    child.stdout.on('data', tap)
    child.stderr.on('data', tap)
    child.on('error', (e) => reject(new StoreshipError(`cannot run ${cmd}: ${e.message}`, cmd === 'xcodebuild' || cmd === 'xcrun' ? 'is Xcode installed and selected? `xcode-select -p`' : undefined)))
    child.on('close', (code) => resolve({ code: code ?? -1, output }))
  })
}

/** Run and throw a StoreshipError (with a hint if the output matches one) on non-zero exit. */
export async function must(cmd: string, args: string[], what: string, opts: { cwd?: string; quiet?: boolean } = {}): Promise<string> {
  const r = await run(cmd, args, opts)
  if (r.code !== 0) {
    const tail = r.output.split('\n').filter((l) => /error|fail|❌/i.test(l)).slice(-8).join('\n') || r.output.slice(-800)
    throw new StoreshipError(`${what} failed (exit ${r.code})\n${tail}`, hintFor(r.output))
  }
  return r.output
}

/** Synchronous capture for small tools (PlistBuddy, which). */
export function capture(cmd: string, args: string[], cwd?: string): string | undefined {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : undefined
}

export function which(bin: string): string | undefined {
  return capture('which', [bin])
}
