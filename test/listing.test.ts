import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { diffFields, diffReviewFields, len, overLimit, parseListing, parseSections } from '../src/asc/listing.ts'

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

const MD_REVIEW = `## en-US
### name
App

## review
### notes
\`\`\`
Home → Charts → pick one.

# not a heading
\`\`\`
### contactFirstName
Ada
### contact-email
ada@example.com
### demoAccountName
reviewer@example.com
### demoAccountRequired
yes
`

describe('review section', () => {
  it('parses ## review with aliases and fenced notes; locales unaffected', () => {
    const p = parseSections(MD_REVIEW)
    assert.deepEqual(Object.keys(p.locales), ['en-US'])
    assert.equal(p.review!.notes, 'Home → Charts → pick one.\n\n# not a heading')
    assert.equal(p.review!.contactFirstName, 'Ada')
    assert.equal(p.review!.contactEmail, 'ada@example.com')
    assert.equal(p.review!.demoAccountRequired, 'yes')
    assert.equal(parseSections('## en-US\n### name\nx').review, undefined)
  })
  it('rejects unknown review fields and a bad demoAccountRequired', () => {
    assert.throws(() => parseSections('## en-US\n### name\nx\n## review\n### password\nx'), /unknown review field "password"/)
    assert.throws(() => parseSections('## en-US\n### name\nx\n## review\n### demoAccountRequired\nmaybe'), /must be true or false/)
  })
  it('diffs against the ASC record: trailing newline on notes is not a change, booleans normalise, password is write-only', () => {
    const wanted = parseSections(MD_REVIEW).review!
    const current = { notes: 'Home → Charts → pick one.\n\n# not a heading\n', contactFirstName: 'Ada', contactEmail: 'old@example.com', demoAccountName: 'reviewer@example.com', demoAccountRequired: true, demoAccountPassword: null }
    const d = diffReviewFields(wanted, current, undefined)
    assert.deepEqual(d.map((x) => [x.field, x.same]), [['notes', true], ['contactFirstName', true], ['contactEmail', false], ['demoAccountName', true], ['demoAccountRequired', true]])
    const withPw = diffReviewFields(wanted, current, 'hunter2')
    assert.deepEqual(withPw.at(-1), { field: 'demoAccountPassword', current: '(write-only)', wanted: 'hunter2', same: false })
    assert.equal(diffReviewFields({ notes: 'x' }, undefined, 'pw').length, 1, 'no demo account name anywhere → password not pushed')
    assert.equal(diffReviewFields({ notes: 'x' }, undefined, undefined)[0]!.same, false, 'no record yet → everything differs')
  })
})
