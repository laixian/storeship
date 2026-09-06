import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Args, parseArgs } from '../src/args.ts'

describe('args', () => {
  it('positional, --k v, --k=v, repeated, and --', () => {
    const p = parseArgs(['a', '--x', '1', '--y=2', '--x', '3', 'b', '--', '--notaflag'])
    assert.deepEqual(p.positional, ['a', 'b', '--notaflag'])
    const a = new Args(p)
    assert.equal(a.str('x'), '3')
    assert.deepEqual(a.all('x'), ['1', '3'])
    assert.equal(a.str('y'), '2')
  })
  it('boolean flags never swallow the next token', () => {
    const a = new Args(parseArgs(['--wait', '1.3.1', '--json'], ['wait', 'json']))
    assert.deepEqual(a.positional, ['1.3.1'])
    assert.equal(a.bool('wait'), true)
    assert.equal(a.str('wait'), undefined)
  })
  it('an unknown flag at the end is boolean', () => {
    const a = new Args(parseArgs(['--force']))
    assert.equal(a.bool('force'), true)
  })
  it('num and need report usage errors', () => {
    const a = new Args(parseArgs(['--n', 'x']))
    assert.throws(() => a.num('n', 1), /must be a number/)
    assert.throws(() => a.need('missing'), /--missing is required/)
    assert.throws(() => a.at(0, 'version'), /<version>/)
  })
})
