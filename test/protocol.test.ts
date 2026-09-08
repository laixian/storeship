import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { CODES, EXIT, EXIT_MEANING } from '../src/codes.ts'
import { CheckFailed, NeedsHuman, StoreshipError, UsageError, asStoreshipError } from '../src/errors.ts'
import { HINTS } from '../src/hints.ts'
import { Out, project } from '../src/out.ts'
import { fullSpec, type CommandSpec } from '../src/spec.ts'
import { checkSkill, mentionedCommands, stampOf, syncSkill } from '../src/skills/sync.ts'
import { pickVersion, stageOf } from '../src/commands/state.ts'
import { ALLOW_RULES, withAllowRules } from '../src/commands/init.ts'
import { GLOBAL_BOOLEANS, GLOBAL_FLAGS, main } from '../src/cli.ts'
import { registry } from '../src/registry.ts'
import { VERSION } from '../src/meta.ts'

void main
const root = join(import.meta.dirname, '..')

function flat(cmds: CommandSpec[]): CommandSpec[] {
  return cmds.flatMap((c) => [c, ...flat(c.sub)])
}

/** Capture one JSON envelope written by Out. */
function capture(fn: (out: Out) => void, opts: { raw?: boolean; fields?: string[] } = {}): any {
  const out = new Out(true, opts)
  const lines: string[] = []
  const log = console.log
  console.log = (l: string) => void lines.push(l)
  try {
    fn(out)
  } finally {
    console.log = log
  }
  return JSON.parse(lines.join('\n'))
}

describe('error codes', () => {
  it('every code has an exit status that exists in the table', () => {
    const known = new Set(EXIT_MEANING.map((e) => e.code))
    for (const [code, meta] of Object.entries(CODES)) assert.ok(known.has(meta.exit), `${code} exits ${meta.exit}, which is not in EXIT_MEANING`)
  })
  it('the exit status comes from the code, and a hint can override nothing by accident', () => {
    assert.equal(new UsageError('x').exitCode, EXIT.usage)
    assert.equal(new CheckFailed('x').exitCode, EXIT.no)
    assert.equal(new NeedsHuman('x', 'sign in').exitCode, EXIT.human)
    assert.equal(new StoreshipError('x', undefined, { code: 'BUILD_NOT_PROCESSED' }).exitCode, EXIT.pending)
    assert.equal(new StoreshipError('x').code, 'UNKNOWN')
  })
  it('every hint names a code that exists, and retry comes from it', () => {
    for (const h of HINTS) assert.ok(CODES[h.code], `${h.code} is not in CODES`)
    assert.equal(new StoreshipError('x', undefined, { code: 'XCODE_NO_ACCOUNT' }).retry, 'never')
  })
  it('anything thrown becomes a StoreshipError without losing the message', () => {
    const e = asStoreshipError(new TypeError('boom'))
    assert.equal(e.code, 'UNKNOWN')
    assert.match(e.message, /boom/)
  })
})

describe('the JSON envelope', () => {
  it('is the same shape whether the command worked or not', () => {
    const okDoc = capture((out) => {
      out.command = 'version status'
      out.emit([{ version: '1.0.0' }])
      out.changed({ kind: 'version', what: 'created' })
      out.next({ command: 'storeship version submit 1.0.0', why: 'ready' })
      out.finish()
    })
    assert.equal(okDoc.ok, true)
    assert.equal(okDoc.command, 'version status')
    assert.equal(okDoc.storeship, VERSION)
    assert.deepEqual(okDoc.changed, [{ kind: 'version', what: 'created' }])
    assert.equal(okDoc.next[0].command, 'storeship version submit 1.0.0')

    const failDoc = capture((out) => {
      out.command = 'version attach'
      out.fail(new StoreshipError('nope', 'wait', { code: 'BUILD_NOT_PROCESSED' }))
    })
    assert.equal(failDoc.ok, false)
    assert.deepEqual(Object.keys(failDoc.error), ['code', 'message', 'hint', 'retry', 'humanAction'])
    assert.equal(failDoc.error.retry, 'after-wait')
    // Same keys either way, so a reader never has to special-case failure.
    for (const k of ['data', 'changed', 'warnings', 'next']) assert.ok(k in failDoc, `missing ${k}`)
  })
  it('--raw swaps in the full payload, --fields narrows it', () => {
    const slim = (o: Out): void => {
      o.emit({ a: 1, b: 2 }, { a: 1, b: 2, c: 3 })
      o.finish()
    }
    assert.deepEqual(capture(slim).data, { a: 1, b: 2 })
    assert.deepEqual(capture(slim, { raw: true }).data, { a: 1, b: 2, c: 3 })
    assert.deepEqual(capture(slim, { fields: ['b'] }).data, { b: 2 })
  })
  it('projection reaches into an array of rows', () => {
    assert.deepEqual(project([{ a: 1, b: 2 }, { a: 3, b: 4 }], ['a']), [{ a: 1 }, { a: 3 }])
    assert.deepEqual(project('scalar', ['a']), 'scalar')
  })
})

describe('the published spec', () => {
  const spec = fullSpec(registry.commands, GLOBAL_FLAGS, GLOBAL_BOOLEANS)
  const all = flat(spec.commands)

  it('every command that does anything declares its impact explicitly', () => {
    // A command that only dispatches to subcommands may inherit the default;
    // a leaf that runs must say what it changes, or the guarantee is a guess.
    const undeclared = all.filter((c) => !c.sub.length && !registry.globalBooleans.includes(c.path)).filter((c) => !hasImpact(c.path))
    assert.deepEqual(undeclared.map((c) => c.path), [])
  })
  it('every irreversible command explains itself and takes --yes', () => {
    for (const c of all.filter((c) => c.impact === 'irreversible')) {
      assert.ok(c.irreversible && c.irreversible.length > 20, `${c.path}: no explanation of what --yes accepts`)
      assert.ok(c.flags.some((f) => f.name === 'yes'), `${c.path}: --yes is not documented`)
    }
  })
  it('carries the tables an agent branches on', () => {
    assert.ok(spec.exitCodes.length >= 6)
    assert.equal(spec.errorCodes.length, Object.keys(CODES).length)
    assert.ok(spec.commands.some((c) => c.path === 'state'))
    for (const key of ['ok', 'error', 'next', 'changed', 'data']) assert.ok(spec.envelope[key], `envelope.${key} is undocumented`)
  })
  it('boolean flags are typed as boolean, so an agent does not pass them a value', () => {
    const attach = all.find((c) => c.path === 'version attach')!
    assert.equal(attach.flags.find((f) => f.name === 'wait')!.type, 'boolean')
    assert.equal(attach.flags.find((f) => f.name === 'build')!.type, 'value')
  })

  function hasImpact(path: string): boolean {
    const cmd = path.split(' ').reduce<any>((lvl, name) => (Array.isArray(lvl) ? lvl : lvl.sub).find((c: any) => c.name === name), registry.commands)
    return !!cmd?.impact
  }
})

describe('release stages', () => {
  const v = (version: string, state: string): any => ({ id: version, version, state })
  const build = (version: string, processingState: string): any => ({ id: version, version, processingState, uploadedDate: '' })

  it('picks the version asked for, else the one on disk, else the newest editable one', () => {
    const rows = [v('1.4.0', 'PREPARE_FOR_SUBMISSION'), v('1.3.0', 'READY_FOR_SALE')]
    assert.equal(pickVersion(rows, '1.3.0')!.version, '1.3.0')
    assert.equal(pickVersion(rows, undefined, '1.3.0')!.version, '1.3.0')
    assert.equal(pickVersion(rows)!.version, '1.4.0')
    assert.equal(pickVersion([v('1.3.0', 'READY_FOR_DISTRIBUTION')])!.version, '1.3.0')
  })
  it('separates "no build" from "still processing" from "ready to attach"', () => {
    assert.equal(stageOf(undefined, undefined, undefined, undefined), 'no-version')
    const ver = v('1.4.0', 'PREPARE_FOR_SUBMISSION')
    assert.equal(stageOf(ver, undefined, undefined, '42'), 'no-build')
    assert.equal(stageOf(ver, undefined, build('42', 'PROCESSING'), '42'), 'build-processing')
    assert.equal(stageOf(ver, undefined, build('42', 'VALID'), '42'), 'build-ready')
    assert.equal(stageOf(ver, build('42', 'VALID'), build('42', 'VALID'), '42'), 'build-attached')
  })
  it('a build that is not the one just built does not count as ready', () => {
    assert.equal(stageOf(v('1.4.0', 'PREPARE_FOR_SUBMISSION'), undefined, build('41', 'VALID'), '42'), 'no-build')
  })
  it('review states map to a verdict stage', () => {
    assert.equal(stageOf(v('1.4.0', 'IN_REVIEW'), undefined, undefined, undefined), 'submitted')
    assert.equal(stageOf(v('1.4.0', 'METADATA_REJECTED'), undefined, undefined, undefined), 'rejected')
    assert.equal(stageOf(v('1.4.0', 'PENDING_DEVELOPER_RELEASE'), undefined, undefined, undefined), 'approved')
    assert.equal(stageOf(v('1.4.0', 'READY_FOR_SALE'), undefined, undefined, undefined), 'live')
  })
})

describe('agent wiring written by init', () => {
  it('adds the allow rules and keeps whatever else is in the settings file', () => {
    const existing = JSON.stringify({ permissions: { allow: ['Bash(git *)'], deny: ['Bash(rm *)'] }, model: 'opus' })
    const { text, added } = withAllowRules(existing)
    const settings = JSON.parse(text)
    assert.deepEqual(added, ALLOW_RULES)
    assert.deepEqual(settings.permissions.allow, ['Bash(git *)', ...ALLOW_RULES])
    assert.deepEqual(settings.permissions.deny, ['Bash(rm *)'])
    assert.equal(settings.model, 'opus')
  })
  it('is idempotent, so running init twice does not duplicate a rule', () => {
    const once = withAllowRules(undefined).text
    const twice = withAllowRules(once)
    assert.deepEqual(twice.added, [])
    assert.equal(twice.text, once)
  })
})

describe('shipped skills', () => {
  const names = ['storeship-release', 'storeship-products', 'storeship-shots', 'storeship-preview', 'storeship-reel']
  const read = (n: string): string => readFileSync(join(root, 'skills', n, 'SKILL.md'), 'utf8')

  it('are generated for this version and mention only commands that exist', () => {
    const problems = names.flatMap((n) => checkSkill(n, read(n), registry.commands))
    assert.deepEqual(problems.map((p) => `${p.file}: ${p.problem}`), [])
  })
  it('every skill carries the protocol, so one loaded on its own is still usable', () => {
    for (const n of names) assert.match(read(n), /\| exit \| meaning \| what to do \|/, `${n} has no protocol block`)
  })
  it('syncing twice changes nothing', () => {
    for (const n of names) assert.equal(syncSkill(syncSkill(read(n))), syncSkill(read(n)))
  })
  it('only backticked commands count as mentions, and a wrong one is caught', () => {
    const tree = registry.commands
    assert.deepEqual(mentionedCommands('storeship defaults it to false', tree), [])
    assert.deepEqual(mentionedCommands('run `storeship version attach 1.0 --wait`', tree), [{ path: 'version attach', ok: true }])
    assert.deepEqual(mentionedCommands('run `storeship publish`', tree), [{ path: 'publish', ok: false }])
  })
  it('a stale stamp is what tells a project its copy is out of date', () => {
    assert.equal(stampOf(read('storeship-release')), VERSION)
    assert.equal(stampOf('# no stamp here'), undefined)
    const problems = checkSkill('x', read('storeship-release').replace(VERSION, '0.0.1'), registry.commands)
    assert.ok(problems.some((p) => /out of date/.test(p.problem)))
  })
})
