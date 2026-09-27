import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { md5Of } from '../src/asc/media.ts'
import { matchingPrefix } from '../src/shots/upload.ts'

describe('shots upload --replace resumes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeship-up-'))
  const files = ['a-1.png', 'a-2.png', 'a-3.png'].map((n, i) => {
    const f = join(dir, n)
    writeFileSync(f, `png ${i}`)
    return f
  })
  const item = (f: string, over: Partial<{ fileName: string; state: string; checksum: string }> = {}) => ({
    fileName: f.split('/').pop()!,
    state: 'COMPLETE',
    checksum: md5Of(f),
    ...over,
  })
  it('keeps the leading items that already are the right files', () => {
    assert.equal(matchingPrefix([item(files[0]!), item(files[1]!)], files), 2, 'a set a crashed run half-filled')
    assert.equal(matchingPrefix(files.map((f) => item(f)), files), 3, 'a finished set is left alone')
    assert.equal(matchingPrefix([], files), 0)
  })
  it('a re-shot frame with the same name is replaced, and so is everything after it', () => {
    assert.equal(matchingPrefix([item(files[0]!), item(files[1]!, { checksum: 'old' }), item(files[2]!)], files), 1)
  })
  it('out of order, unprocessed or without a checksum does not count', () => {
    assert.equal(matchingPrefix([item(files[1]!), item(files[0]!)], files), 0)
    assert.equal(matchingPrefix([item(files[0]!, { state: 'UPLOAD_COMPLETE' })], files), 0)
    assert.equal(matchingPrefix([{ fileName: 'a-1.png', state: 'COMPLETE' }], files), 0)
  })
})
