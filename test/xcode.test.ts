import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { exportOptionsPlist, parseXcodeAccounts, resolveBuildSetting } from '../src/ios/xcode.ts'

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

const PBX = `
		13B07F941A680F5B00A75B9A /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CURRENT_PROJECT_VERSION = 1;
				INFOPLIST_FILE = OverDrive/Info.plist;
				MARKETING_VERSION = 1.3.2;
				PRODUCT_BUNDLE_IDENTIFIER = com.overdrive.odmobile.dev;
			};
			name = Debug;
		};
		13B07F951A680F5B00A75B9A /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CURRENT_PROJECT_VERSION = 10;
				INFOPLIST_FILE = OverDrive/Info.plist;
				MARKETING_VERSION = 1.3.2;
				PRODUCT_BUNDLE_IDENTIFIER = com.overdrive.odmobile;
			};
			name = Release;
		};
		AB01 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				INFOPLIST_FILE = "../targets/rehearsal-live/Info.plist";
				PRODUCT_BUNDLE_IDENTIFIER = com.overdrive.odmobile.widget;
			};
			name = Release;
		};
`

describe('Info.plist build-setting references', () => {
  it('passes literal values through', () => {
    assert.equal(resolveBuildSetting('1.3.2', PBX, 'OverDrive/Info.plist'), '1.3.2')
    assert.equal(resolveBuildSetting(undefined, PBX, 'OverDrive/Info.plist'), undefined)
  })
  it('resolves $(VAR) from the configuration whose INFOPLIST_FILE is this plist, not the widget', () => {
    assert.equal(resolveBuildSetting('$(PRODUCT_BUNDLE_IDENTIFIER)', PBX, 'OverDrive/Info.plist', 'Release'), 'com.overdrive.odmobile')
    assert.equal(resolveBuildSetting('$(PRODUCT_BUNDLE_IDENTIFIER)', PBX, 'OverDrive/Info.plist', 'Debug'), 'com.overdrive.odmobile.dev')
    assert.equal(resolveBuildSetting('${CURRENT_PROJECT_VERSION}', PBX, 'OverDrive/Info.plist', 'Release'), '10')
  })
  it('accepts a value all configurations agree on, and gives up when they differ', () => {
    assert.equal(resolveBuildSetting('$(MARKETING_VERSION)', PBX, 'OverDrive/Info.plist'), '1.3.2')
    assert.equal(resolveBuildSetting('$(PRODUCT_BUNDLE_IDENTIFIER)', PBX, 'OverDrive/Info.plist'), undefined)
    assert.equal(resolveBuildSetting('$(NOPE)', PBX, 'OverDrive/Info.plist', 'Release'), undefined)
  })
})

describe('Xcode accounts', () => {
  it('counts identifier objects and plain strings across every list, and tolerates junk', () => {
    assert.deepEqual(parseXcodeAccounts('{"IDE.Prod":[],"IDE.Identifiers.Prod":[]}'), [])
    assert.deepEqual(parseXcodeAccounts('{"IDE.Prod":["a@b.c"],"IDE.Identifiers.Prod":[{"identifier":"9CFD"}]}'), ['a@b.c', '9CFD'])
    assert.deepEqual(parseXcodeAccounts(undefined), [])
    assert.deepEqual(parseXcodeAccounts('not json'), [])
  })
})
