import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listApps, registerDevice } from '../asc/misc.ts'
import { EXIT } from '../codes.ts'
import { type Command } from '../ctx.ts'
import { CheckFailed, UsageError } from '../errors.ts'
import { VERSION } from '../meta.ts'
import { registry } from '../registry.ts'
import { checkSkill, langOf, stampOf, syncSkill } from '../skills/sync.ts'

export const deviceCommand: Command = {
  name: 'device',
  summary: 'register a device for development signing',
  usage: 'device add <name> <udid>',
  impact: 'read',
  needs: ['credentials'],
  sub: [
    {
      name: 'add',
      summary: 'register a device',
      usage: 'device add <name> <udid>',
      impact: 'write',
      needs: ['credentials'],
      run: async (ctx) => {
        const r = await registerDevice(ctx.client(), ctx.args.at(0, 'name'), ctx.args.at(1, 'udid'))
        ctx.out.emit(r)
        ctx.out.changed({ kind: 'device', target: r.name, what: 'registered', detail: r.id })
        ctx.out.log(`registered ${r.name} (${r.id})`)
      },
    },
  ],
  run: async () => {
    throw new UsageError('device needs a subcommand', 'storeship device add <name> <udid>')
  },
}

export const appsCommand: Command = {
  name: 'apps',
  summary: 'apps in the account (to find the app id)',
  impact: 'read',
  needs: ['credentials'],
  run: async (ctx) => {
    const apps = await listApps(ctx.client())
    ctx.out.emit(apps)
    for (const a of apps) ctx.out.log(`${a.id}  ${a.bundleId}  ${a.name}`)
  },
}

/** The package's own skills directory, wherever the package is installed. */
export function skillsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills')
}

const skillFile = (dir: string, name: string): string => join(dir, name, 'SKILL.md')
const skillNames = (dir = skillsDir()): string[] => (existsSync(dir) ? readdirSync(dir).filter((n) => existsSync(skillFile(dir, n))).sort() : [])

/**
 * What `skill sync` / `skill check` operate on. With a directory, the skills in
 * it (that is how a project checks its own installed copies). Without one, this
 * package's skills *and* the agent-facing docs in the repo — they carry the same
 * generated blocks, and a doc that drifts from the code is the same bug.
 */
export function syncTargets(dir?: string): string[] {
  if (dir) return skillNames(dir).map((n) => skillFile(dir, n))
  const root = resolve(skillsDir(), '..')
  return [...skillNames().map((n) => skillFile(skillsDir(), n)), join(root, 'docs', 'agents.md'), join(root, 'docs', 'zh', 'agents.md')].filter(existsSync)
}

const label = (file: string): string => file.replace(resolve(skillsDir(), '..') + '/', '')

export const skillCommand: Command = {
  name: 'skill',
  summary: 'agent skills that drive this tool (Claude Code format): list, install into a project, check a copy for drift',
  impact: 'read',
  sub: [
    {
      name: 'list',
      summary: 'skills shipped with this version',
      impact: 'read',
      run: async (ctx) => {
        const names = skillNames()
        ctx.out.emit(names.map((n) => ({ name: n, stamp: stampOf(readFileSync(skillFile(skillsDir(), n), 'utf8')) ?? null })))
        for (const n of names) ctx.out.log(n)
      },
    },
    {
      name: 'install',
      summary: 'copy the skills into a project (default .claude/skills)',
      usage: 'skill install [--to DIR] [--only NAME]',
      flags: { to: 'target directory; default <config root>/.claude/skills', only: 'install one skill by name' },
      impact: 'write',
      run: async (ctx) => {
        const to = resolve(ctx.args.str('to') ?? join(ctx.cfg.root, '.claude', 'skills'))
        const only = ctx.args.str('only')
        const names = skillNames().filter((n) => !only || n === only)
        if (only && !names.length) throw new UsageError(`no skill named ${only}`, `shipped: ${skillNames().join(', ')}`)
        mkdirSync(to, { recursive: true })
        for (const n of names) cpSync(join(skillsDir(), n), join(to, n), { recursive: true })
        ctx.out.emit({ to, installed: names, storeship: VERSION })
        ctx.out.changed(...names.map((n) => ({ kind: 'skill', target: n, what: 'installed', detail: join(to, n) })))
        for (const n of names) ctx.out.log(`installed ${n} → ${join(to, n)}`)
        ctx.out.log('\nThese are copies. After upgrading storeship, run `storeship skill install` again; `storeship skill check --dir` says whether a copy is stale.')
      },
    },
    {
      name: 'check',
      summary: "a skill copy (or this repo's agent docs) against this version: stale generated blocks, stale stamp, commands that no longer exist (exit 3 when anything is wrong)",
      usage: 'skill check [--dir DIR]',
      flags: { dir: "directory holding storeship-* skills; default: this package's own skills plus the agent docs" },
      impact: 'read',
      run: async (ctx) => {
        const files = syncTargets(ctx.args.str('dir') ? resolve(ctx.args.str('dir')!) : undefined)
        const problems = files.flatMap((f) => checkSkill(label(f), readFileSync(f, 'utf8'), registry.commands))
        ctx.out.emit({ checked: files.map(label), problems })
        for (const p of problems) ctx.out.log(`✗ ${p.file}: ${p.problem}`)
        if (problems.length) {
          ctx.out.log(`\n${problems.length} problem(s)`)
          process.exitCode = EXIT.no
        } else ctx.out.log(`${files.length} file(s) match storeship ${VERSION}`)
      },
    },
    {
      name: 'sync',
      summary: "regenerate the marked blocks (protocol, error codes) and the version stamp in this package's skills and agent docs",
      usage: 'skill sync [--dir DIR] [--check]',
      flags: { dir: "directory holding storeship-* skills; default: this package's own skills plus the agent docs", check: 'do not write; exit 3 when a file would change (for CI)' },
      booleans: ['check'],
      impact: 'write',
      run: async (ctx) => {
        const changed: string[] = []
        for (const file of syncTargets(ctx.args.str('dir') ? resolve(ctx.args.str('dir')!) : undefined)) {
          const text = readFileSync(file, 'utf8')
          const next = syncSkill(text, VERSION, langOf(file))
          if (next === text) continue
          changed.push(label(file))
          if (!ctx.args.bool('check')) writeFileSync(file, next)
        }
        ctx.out.emit({ changed })
        ctx.out.changed(...changed.map((n) => ({ kind: 'skill', target: n, what: ctx.args.bool('check') ? 'out of date' : 'regenerated' })))
        if (ctx.args.bool('check') && changed.length) throw new CheckFailed(`${changed.length} file(s) out of date: ${changed.join(', ')}`, 'run `storeship skill sync`')
        ctx.out.log(changed.length ? `regenerated ${changed.join(', ')}` : 'skills and agent docs are up to date')
      },
    },
  ],
  run: async () => {
    throw new UsageError('skill needs a subcommand', 'storeship skill <list|install|check|sync>')
  },
}
