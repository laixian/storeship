import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkCatalog, currentPriceRow, parseCatalog, pickPricePoint, planCatalog, priceMatches, territoriesSame, type AscCatalog } from '../src/asc/products.ts'

const MD = `# Products

## app
- price: CHN 0
- territories: all

## group OverDrive Pro
### en-US
#### name
OverDrive Pro
### zh-Hans
#### name
OverDrive Pro会员

## subscription com.example.pro.monthly
- group: OverDrive Pro
- reference: Pro monthly
- period: ONE_MONTH
- level: 1
- familySharable: false
- price: USA 3.99
- prices: JPN 600, KOR 4900
### en-US
#### name
Monthly
#### description
Everything, billed monthly
### zh-Hans
#### name
月付
#### description
全部功能，按月
### reviewNote
\`\`\`
How to reach the paywall.

# not a heading
\`\`\`

## subscription com.example.pro.yearly
- group: OverDrive Pro
- reference: Pro yearly
- period: ONE_YEAR
- level: 2
- price: USA 39.99
- territories: USA, CHN, JPN
### en-US
#### name
Yearly
`

describe('products.md', () => {
  it('parses app, groups, subscriptions, scalars, localizations and fenced notes', () => {
    const c = parseCatalog(MD)
    assert.deepEqual(c.app, { price: { territory: 'CHN', amount: '0' }, territories: 'all' })
    assert.equal(c.groups.length, 1)
    assert.equal(c.groups[0]!.reference, 'OverDrive Pro')
    assert.equal(c.groups[0]!.localizations['zh-Hans']!.name, 'OverDrive Pro会员')
    const m = c.subscriptions[0]!
    assert.equal(m.productId, 'com.example.pro.monthly')
    assert.equal(m.period, 'ONE_MONTH')
    assert.equal(m.level, 1)
    assert.equal(m.familySharable, false)
    assert.deepEqual(m.price, { territory: 'USA', amount: '3.99' })
    assert.deepEqual(m.prices, [
      { territory: 'JPN', amount: '600' },
      { territory: 'KOR', amount: '4900' },
    ])
    assert.equal(m.localizations['zh-Hans']!.description, '全部功能，按月')
    assert.equal(m.reviewNote, 'How to reach the paywall.\n\n# not a heading')
    const y = c.subscriptions[1]!
    assert.deepEqual(y.territories, ['USA', 'CHN', 'JPN'])
    assert.equal(y.localizations['en-US']!.description, undefined, 'absent fields stay absent')
  })
  it('rejects bad values with the line number', () => {
    assert.throws(() => parseCatalog('## subscription x\n- period: MONTHLY'), /products:2: period must be one of/)
    assert.throws(() => parseCatalog('## subscription x\n- price: 3.99'), /price must be "<TERRITORY> <amount>"/)
    assert.throws(() => parseCatalog('## subscription x\n- price: USD 3.99'), /"USD" is a currency/)
    assert.throws(() => parseCatalog('## subscription x\n- colour: red'), /unknown subscription key "colour"/)
    assert.throws(() => parseCatalog('## group G\n- price: USA 1'), /groups take no/)
    assert.throws(() => parseCatalog('## subscription x\n### fr-FR\n#### title\nx'), /unknown localized field "title"/)
    assert.throws(() => parseCatalog('# nothing'), /nothing found/)
  })
  it('checkCatalog flags limits, duplicates and dangling groups', () => {
    const c = parseCatalog(MD)
    assert.deepEqual(checkCatalog(c), [])
    c.subscriptions[0]!.localizations['en-US']!.description = 'x'.repeat(46)
    c.subscriptions[1]!.group = 'Nope'
    c.subscriptions.push({ productId: 'com.example.pro.yearly', localizations: {} })
    const p = checkCatalog(c)
    assert.match(p[0]!, /description 46\/45/)
    assert.match(p[1]!, /group "Nope" is not defined/)
    assert.match(p[2]!, /listed twice/)
  })
  it('flags a duplicate group and a prices override with no base price', () => {
    const c = parseCatalog(MD)
    c.groups.push({ reference: 'OverDrive Pro', localizations: {} })
    c.subscriptions[1]!.price = undefined
    c.subscriptions[1]!.prices = [{ territory: 'JPN', amount: '600' }]
    const p = checkCatalog(c)
    assert.ok(p.some((x) => /group OverDrive Pro: listed twice/.test(x)))
    assert.ok(p.some((x) => /"prices" needs a "price" too/.test(x)))
  })
})

describe('territory comparison', () => {
  it('compares the set, not its size', () => {
    assert.equal(territoriesSame(['USA', 'CHN', 'JPN'], ['JPN', 'USA', 'CHN'], true, 175), true, 'order does not matter')
    assert.equal(territoriesSame(['USA', 'CHN', 'JPN'], ['USA', 'CHN', 'GBR'], true, 175), false, 'same size, different set')
    assert.equal(territoriesSame('all', ALL, true, 175), true)
    assert.equal(territoriesSame('all', ALL, false, 175), false, 'new territories switched off is a difference')
    assert.equal(territoriesSame('all', ALL.slice(1), true, 175), false)
    assert.equal(territoriesSame(['USA'], undefined, true, 175), false, 'no availability record yet')
  })
})

describe('price comparison', () => {
  const rows = [
    { startDate: null, pricePointId: 'a', amount: '3.99' },
    { startDate: '2027-01-01', pricePointId: 'b', amount: '4.99' },
  ]
  it('reads the price in force, or the one scheduled for a given day', () => {
    assert.equal(priceMatches(rows, '3.99'), true)
    assert.equal(priceMatches(rows, '4.99'), false, 'the future row is not in force')
    assert.equal(priceMatches(rows, '4.99', '2027-01-01'), true)
    assert.equal(priceMatches(rows, '5.99', '2027-01-01'), false)
    assert.equal(priceMatches(undefined, '3.99'), false)
  })
})

describe('price points', () => {
  const points = [
    { id: 'a', territory: 'USA', amount: '2.99' },
    { id: 'b', territory: 'USA', amount: '3.99' },
    { id: 'c', territory: 'USA', amount: '4.49' },
  ]
  it('picks the exact tier, else the closest below, never above', () => {
    assert.equal(pickPricePoint(points, '3.99')!.id, 'b')
    assert.equal(pickPricePoint(points, '4.00')!.id, 'b')
    assert.equal(pickPricePoint(points, '9')!.id, 'c')
    assert.equal(pickPricePoint(points, '1'), undefined)
  })
  it('currentPriceRow takes the row in force today, not a scheduled future one', () => {
    const rows = [
      { startDate: null, pricePointId: 'old' },
      { startDate: '2026-09-01', pricePointId: 'now' },
      { startDate: '2027-01-01', pricePointId: 'future' },
    ]
    assert.equal(currentPriceRow(rows, '2026-09-08')!.pricePointId, 'now')
    assert.equal(currentPriceRow([{ startDate: null, pricePointId: 'only' }], '2026-09-08')!.pricePointId, 'only')
  })
})

const NAMED = ['USA', 'CHN', 'JPN', 'KOR']
const ALL = [...NAMED, ...Array.from({ length: 171 }, (_, i) => `T${i}`)]
const AMOUNT: Record<string, string> = { USA: '3.99', JPN: '600', KOR: '4900' }
const priceTable = Object.fromEntries(ALL.map((t) => [t, [{ startDate: null, pricePointId: `pp-${t}`, amount: AMOUNT[t] ?? '3.99' }]]))

describe('planCatalog', () => {
  const current: AscCatalog = {
    territoryTotal: 175,
    app: { basePrice: { territory: 'CHN', amount: '0.0' }, territories: ALL, territoryCount: 175, availableInNewTerritories: true },
    groups: [
      {
        id: 'g1',
        reference: 'OverDrive Pro',
        localizations: [
          { id: 'gl1', locale: 'en-US', name: 'OverDrive Pro' },
          { id: 'gl2', locale: 'zh-Hans', name: 'OverDrive Pro会员' },
        ],
      },
    ],
    subscriptions: [
      {
        id: 's1',
        productId: 'com.example.pro.monthly',
        reference: 'Pro monthly',
        period: 'ONE_MONTH',
        level: 1,
        familySharable: false,
        state: 'APPROVED',
        reviewNote: 'How to reach the paywall.\n\n# not a heading\n',
        groupId: 'g1',
        localizations: [
          { id: 'l1', locale: 'en-US', name: 'Monthly', description: 'Everything, billed monthly' },
          { id: 'l2', locale: 'zh-Hans', name: '月付', description: '全部功能，按月' },
        ],
        basePrice: { territory: 'USA', amount: '3.99', pricePointId: 'pp-USA' },
        pricedTerritoryCount: 175,
        priceTable,
        territories: ALL,
        territoryCount: 175,
        availableInNewTerritories: true,
      },
    ],
  }
  it('is empty when ASC already matches (trailing newline on the note is not a change)', () => {
    const cat = parseCatalog(MD)
    cat.subscriptions.pop() // yearly does not exist in ASC in this fixture
    const plan = planCatalog(cat, current)
    assert.deepEqual(plan.actions, [])
    assert.ok(plan.same.includes('subscription com.example.pro.monthly price USA 3.99 (175 territories)'))
    assert.ok(plan.same.includes('app price CHN 0.0'))
  })
  it('creates what is missing, in order: subscription, localizations, availability (before price — Apple 409s otherwise), price', () => {
    const cat = parseCatalog(MD)
    const plan = planCatalog(cat, current)
    assert.deepEqual(
      plan.actions.map((a) => `${a.target}: ${a.what}`),
      ['subscription com.example.pro.yearly: create', 'subscription com.example.pro.yearly en-US: create localization', 'subscription com.example.pro.yearly territories: 3 territories', 'subscription com.example.pro.yearly price: set USA 39.99'],
    )
  })
  it('updates only what differs and warns about immutable fields and live price raises', () => {
    const cat = parseCatalog(MD)
    cat.subscriptions.pop()
    const m = cat.subscriptions[0]!
    m.period = 'ONE_YEAR'
    m.level = 2
    m.localizations['en-US']!.name = 'Monthly Pro'
    m.price = { territory: 'USA', amount: '4.99' }
    const plan = planCatalog(cat, current)
    assert.deepEqual(
      plan.actions.map((a) => `${a.target}: ${a.what}`),
      ['subscription com.example.pro.monthly: update groupLevel', 'subscription com.example.pro.monthly en-US: update name', 'subscription com.example.pro.monthly price: change USA 3.99 → 4.99'],
    )
    assert.equal(plan.warnings.length, 2)
    assert.match(plan.warnings[0]!, /cannot change after creation/)
    assert.match(plan.warnings[1]!, /subscriber consent/)
  })
  it('fills territories that have no price when the base price already matches', () => {
    const cat = parseCatalog(MD)
    cat.subscriptions.pop()
    const thin = Object.fromEntries(NAMED.map((t) => [t, priceTable[t]!]))
    const half = { ...current, subscriptions: [{ ...current.subscriptions[0]!, priceTable: thin }] }
    const plan = planCatalog(cat, half)
    assert.deepEqual(plan.actions.map((a) => `${a.target}: ${a.what}`), ['subscription com.example.pro.monthly price: fill 171 territories without a price'])
  })

  it('sees an edited per-territory override even though the base price is unchanged', () => {
    const cat = parseCatalog(MD)
    cat.subscriptions.pop()
    cat.subscriptions[0]!.prices = [
      { territory: 'JPN', amount: '800' },
      { territory: 'KOR', amount: '4900' },
    ]
    const plan = planCatalog(cat, current)
    assert.deepEqual(plan.actions.map((a) => `${a.target}: ${a.what}`), ['subscription com.example.pro.monthly price: change USA 3.99 → 3.99'])
  })

  it('a scheduled price is written once and then reported as the same', () => {
    const cat = parseCatalog(MD)
    cat.subscriptions.pop()
    const m = cat.subscriptions[0]!
    m.price = { territory: 'USA', amount: '4.99' }
    m.prices = undefined
    m.priceStart = '2027-01-01'
    assert.equal(planCatalog(cat, current).actions.length, 1, 'not scheduled yet → one action')
    const scheduled = Object.fromEntries(ALL.map((t) => [t, [...priceTable[t]!, { startDate: '2027-01-01', pricePointId: `later-${t}`, amount: '4.99' }]]))
    const after = { ...current, subscriptions: [{ ...current.subscriptions[0]!, priceTable: scheduled }] }
    assert.deepEqual(planCatalog(cat, after).actions, [], 'already scheduled → nothing to do')
  })

  it('leaves customAppName alone when the file omits it', () => {
    const cat = parseCatalog(MD)
    cat.subscriptions.length = 0
    const withCustom = { ...current, groups: [{ ...current.groups[0]!, localizations: [{ id: 'gl1', locale: 'en-US', name: 'OverDrive Pro', customAppName: 'Set in the web UI' }, current.groups[0]!.localizations[1]!] }] }
    assert.deepEqual(planCatalog(cat, withCustom).actions, [])
  })
  it('requires group / reference / period / level to create a subscription', () => {
    const cat = parseCatalog('## subscription com.example.new\n- price: USA 1')
    assert.throws(() => planCatalog(cat, current), /"group" is required to create it/)
  })
})
