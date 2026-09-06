import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { exportOptionsPlist } from '../src/ios/xcode.ts'

describe('ExportOptions.plist', () => {
  it('is app-store-connect / automatic / export, with extras merged and escaped', () => {
    const p = exportOptionsPlist('TEAM1', { uploadSymbols: false, provisioningProfiles: { 'com.x': 'P&P' } })
    assert.match(p, /<key>method<\/key><string>app-store-connect<\/string>/)
    assert.match(p, /<key>teamID<\/key><string>TEAM1<\/string>/)
    assert.match(p, /<key>destination<\/key><string>export<\/string>/)
    assert.match(p, /<key>uploadSymbols<\/key><false\/>/)
    assert.match(p, /<key>com\.x<\/key><string>P&amp;P<\/string>/)
    assert.doesNotMatch(p, /authenticationKey/)
  })
})
