import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listApps, registerDevice } from '../asc/misc.ts'
import { type Command } from '../ctx.ts'
import { UsageError } from '../errors.ts'

export const deviceCommand: Command = {
  name: 'device',
  summary: 'register a device for development signing',
  usage: 'device add <name> <udid>',
  sub: [
    {
      name: 'add',
      summary: 'register a device',
      usage: 'device add <name> <udid>',
      run: async (ctx) => {
        const r = await registerDevice(ctx.client(), ctx.args.at(0, 'name'), ctx.args.at(1, 'udid'))
        ctx.out.emit(r)
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

export const skillCommand: Command = {
  name: 'skill',
  summary: 'agent skills that drive this tool (Claude Code format)',
  sub: [
    {
      name: 'list',
      summary: 'skills shipped with this version',
      run: async (ctx) => {
        const names = readdirSync(skillsDir()).filter((n) => existsSync(join(skillsDir(), n, 'SKILL.md')))
        ctx.out.emit(names)
        for (const n of names) ctx.out.log(n)
      },
    },
    {
      name: 'install',
      summary: 'copy the skills into a project (default .claude/skills)',
      usage: 'skill install [--to DIR] [--only NAME]',
      run: async (ctx) => {
        const to = resolve(ctx.args.str('to') ?? join(ctx.cfg.root, '.claude', 'skills'))
        const only = ctx.args.str('only')
        const names = readdirSync(skillsDir()).filter((n) => existsSync(join(skillsDir(), n, 'SKILL.md')) && (!only || n === only))
        mkdirSync(to, { recursive: true })
        for (const n of names) cpSync(join(skillsDir(), n), join(to, n), { recursive: true })
        ctx.out.emit({ to, installed: names })
        for (const n of names) ctx.out.log(`installed ${n} → ${join(to, n)}`)
      },
    },
  ],
  run: async () => {
    throw new UsageError('skill needs a subcommand', 'storeship skill <list|install>')
  },
}
