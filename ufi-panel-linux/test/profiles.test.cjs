'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProfileStore } = require('../src/core/profiles.cjs');
const { hashPassword } = require('../src/core/protocol.cjs');

function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ufi-profiles-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('no keyring or basic_text backend never persists secrets', t => {
  for (const backend of ['basic_text', 'unavailable']) {
    const dir = directory(t);
    const store = new ProfileStore(dir, { isEncryptionAvailable: () => backend === 'basic_text', getSelectedStorageBackend: () => backend });
    store.save({ name: 'F50', address: '192.168.0.1:2333', password: 'fixture-secret', ztePassword: 'fixture-zte', remember: true });
    const saved = fs.readFileSync(path.join(dir, 'profiles.json'), 'utf8');
    assert.ok(!saved.includes('fixture-secret')); assert.ok(!saved.includes('fixture-zte')); assert.ok(!saved.includes(hashPassword('fixture-secret')));
    assert.equal(store.list().profiles[0].hasSecret, false);
  }
});

test('keyring credentials never go back to renderer, and forgetting removes secret', t => {
  const dir = directory(t); const secrets = new Map();
  const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: s => { secrets.set('cipher', s); return Buffer.from('cipher'); }, decryptString: b => secrets.get(b.toString()) };
  const store = new ProfileStore(dir, storage);
  const profile = store.save({ name: 'F50', address: '192.168.0.1:2333', password: 'fixture-secret', ztePassword: 'fixture-zte', remember: true });
  assert.ok(!JSON.stringify(store.list()).includes('fixture-secret'));
  assert.equal(store.credentials(profile.id).token, hashPassword('fixture-secret'));
  assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
  store.save({ id: profile.id, name: 'F50', address: profile.address, remember: false });
  assert.equal(store.list().profiles[0].hasSecret, false);
});

test('failed persistence does not mutate the in-memory profiles', t => {
  const store = new ProfileStore(directory(t), { isEncryptionAvailable: () => false });
  const profile = store.save({ name: 'Original', address: 'http://router:2333' });
  const before = store.list();
  fs.mkdirSync(store.file + '.tmp');
  assert.throws(() => store.save({ id: profile.id, name: 'New', address: 'http://other:2333' }));
  assert.deepEqual(store.list(), before);
  assert.throws(() => store.remove(profile.id)); assert.deepEqual(store.list(), before);
});
