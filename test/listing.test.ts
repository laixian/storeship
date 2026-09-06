import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { diffFields, len, overLimit, parseListing } from '../src/asc/listing.ts'

const MD = `# Listing

## Notes
prose that is ignored, with ### fake heading? no: only under a locale

## en-US
### name
My App
### subtitle
Does a thing
### keywords
a,b,c
### description
\`\`\`
Line one.

# not a heading, inside a fence
---
\`\`\`
### promotionalText

Trailing blank lines are trimmed.


## zh-Hans
### name
我的应用
### keywords
甲,乙
`

describe('listing format', () => {
  it('parses locales, fields, fenced values verbatim, trims plain values', () => {
    const l = parseListing(MD)
    assert.deepEqual(Object.keys(l), ['en-US', 'zh-Hans'])
    assert.equal(l['en-US']!.name, 'My App')
    assert.equal(l['en-US']!.description, 'Line one.\n\n# not a heading, inside a fence\n---')
    assert.equal(l['en-US']!.promotionalText, 'Trailing blank lines are trimmed.')
    assert.equal(l['zh-Hans']!.name, '我的应用')
    assert.equal(l['zh-Hans']!.subtitle, undefined, 'absent fields stay absent so they are not diffed')
  })
  it('rejects unknown fields and fields outside a locale', () => {
    assert.throws(() => parseListing('## en-US\n### title\nx'), /unknown field "title"/)
    assert.throws(() => parseListing('### name\nx\n## en-US'), /before any "## <locale>"/)
    assert.throws(() => parseListing('# nothing here'), /no "## <locale>"/)
  })
  it('counts CJK as one character and flags limits', () => {
    assert.equal(len('汉字ab'), 4)
    assert.deepEqual(overLimit({ name: 'x'.repeat(31), subtitle: 'ok' }), ['name 31/30'])
  })
  it('diffFields only touches fields present in the file', () => {
    const d = diffFields('en-US', { name: 'New', keywords: 'k' }, { name: 'Old', subtitle: 'S' }, ['name', 'subtitle'], 'appInfo', 'loc1')
    assert.deepEqual(d.map((x) => [x.field, x.same]), [['name', false]])
  })
})
