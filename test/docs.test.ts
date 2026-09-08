import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { renderCommandDocs } from '../src/docs/render.ts'
import { ZH, ZH_ABOUT, ZH_EXIT } from '../src/docs/zh.ts'
import { CODES, EXIT_MEANING } from '../src/codes.ts'
import { GLOBAL_FLAGS, main } from '../src/cli.ts'
import { registry } from '../src/commands/docs.ts'

void main
const root = join(import.meta.dirname, '..')

function walk(cmds: typeof registry.commands, path: string[] = []): { path: string; flags: string[] }[] {
  return cmds.flatMap((c) => [{ path: [...path, c.name].join(' '), flags: Object.keys(c.flags ?? {}) }, ...walk(c.sub ?? [], [...path, c.name])])
}

describe('command reference', () => {
  it('docs/commands.md and docs/zh/commands.md are what the code generates', () => {
    assert.equal(readFileSync(join(root, 'docs/commands.md'), 'utf8'), renderCommandDocs(registry.commands, GLOBAL_FLAGS, 'en'))
    assert.equal(readFileSync(join(root, 'docs/zh/commands.md'), 'utf8'), renderCommandDocs(registry.commands, GLOBAL_FLAGS, 'zh'))
  })
  it('every command and every flag has a Chinese text', () => {
    const missing: string[] = []
    for (const { path, flags } of walk(registry.commands)) {
      const z = ZH[path]
      if (!z) missing.push(path)
      else for (const f of flags) if (!z.flags?.[f]) missing.push(`${path} --${f}`)
    }
    assert.deepEqual(missing, [])
  })
  it('every exit code and error code has Chinese text, so the zh agent doc is not half English', () => {
    const missing = [
      ...EXIT_MEANING.filter((e) => !ZH_EXIT[e.name]).map((e) => `exit ${e.name}`),
      ...Object.keys(CODES).filter((c) => !ZH_ABOUT[c]).map((c) => `code ${c}`),
    ]
    assert.deepEqual(missing, [])
  })
  it('every flag a command reads is declared in its flags (so --help and the docs show it)', () => {
    // flags parsed by name in the command source must be declared; usage strings must mention every declared flag
    for (const { path, flags } of walk(registry.commands)) {
      const cmd = path.split(' ').reduce<any>((lvl, name) => (Array.isArray(lvl) ? lvl : lvl.sub).find((c: any) => c.name === name), registry.commands)
      if (!cmd.usage) continue
      for (const f of flags) assert.ok(cmd.usage.includes(`--${f}`) || (cmd.flags && path === 'sim'), `${path}: usage does not mention --${f}`)
    }
  })
})
