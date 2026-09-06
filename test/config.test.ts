import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultKeyPath, resolveConfig } from '../src/config.ts'

describe('config', () => {
  it('env overrides the file; key path defaults to the altool convention', () => {
    const c = resolveConfig({ app: { id: '1' }, asc: { keyId: 'K1', issuerId: 'I1' } }, '/repo', { ASC_KEY_ID: 'K2' }, '/repo/storeship.config.json', '/home/u')
    assert.equal(c.app.id, '1')
    assert.equal(c.asc.keyId, 'K2')
    assert.equal(c.asc.keyPath, '/home/u/.appstoreconnect/private_keys/AuthKey_K2.p8')
    assert.equal(defaultKeyPath('X', '/h'), '/h/.appstoreconnect/private_keys/AuthKey_X.p8')
  })
  it('relative paths resolve from the config directory, absolute ones stay', () => {
    const c = resolveConfig({ ios: { projectDir: 'apps/mobile', workspace: '/abs/A.xcworkspace' }, listing: { file: 'docs/l.md' } }, '/repo', {}, undefined, '/h')
    assert.equal(c.ios.projectDir, '/repo/apps/mobile')
    assert.equal(c.ios.workspace, '/abs/A.xcworkspace')
    assert.equal(c.listing.file, '/repo/docs/l.md')
    assert.equal(c.ios.archiveDir, '/h/Library/Developer/Xcode/Archives')
    assert.equal(c.release.scheduledTime, '00:00:00Z')
  })
})
