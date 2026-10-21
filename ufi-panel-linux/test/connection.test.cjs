'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConnectionManager } = require('../src/core/connection.cjs');

function fixture() {
  const clients = [], saves = [];
  const store = {
    list: () => ({ profiles: [{ id: 'a', address: 'http://router:2333', hasSecret: true }] }),
    credentials: () => ({ token: 'saved-token', ztePassword: 'saved-zte' }),
    save: (input, credentials) => { saves.push({ input, credentials }); return { ...input, id: input.id || 'a' }; },
  };
  const manager = new ConnectionManager(store, credentials => {
    const client = { credentials, closed: false, close() { this.closed = true; } };
    client.connect = () => new Promise((resolve, reject) => { client.resolve = resolve; client.reject = reject; });
    clients.push(client); return client;
  });
  const input = { id: 'a', name: 'First', address: 'http://router:2333', password: 'session-password', ztePassword: 'session-zte' };
  return { manager, clients, saves, store, input };
}
async function initial(f) { const promise = f.manager.connect(f.input); f.clients[0].resolve({ base: {} }); await promise; }

test('failed replacement keeps the live session and does not save failed input', async () => {
  const f = fixture(); await initial(f);
  const promise = f.manager.connect({ ...f.input, name: 'Wrong', password: 'wrong' });
  f.clients[1].reject(new Error('Unauthorized')); await assert.rejects(promise, /Unauthorized/);
  assert.equal(f.manager.current.client, f.clients[0]); assert.equal(f.clients[0].closed, false);
  assert.equal(f.clients[1].closed, true); assert.equal(f.saves.length, 1);
});

test('cancelling or superseding a slow connection cannot replace the live session', async () => {
  const f = fixture(); await initial(f);
  const pending = f.manager.connect(f.input); f.manager.cancel();
  f.clients[1].resolve({}); await assert.rejects(pending, /取消/);
  assert.equal(f.manager.current.client, f.clients[0]);
  const slow = f.manager.connect(f.input); const latest = f.manager.connect(f.input);
  f.clients[3].resolve({}); await latest;
  f.clients[2].resolve({}); await assert.rejects(slow, /取消/);
  assert.equal(f.manager.current.client, f.clients[3]);
  assert.equal(f.clients[0].closed, true); assert.equal(f.clients[2].closed, true);
  f.manager.disconnect(); assert.equal(f.clients[3].closed, true); assert.equal(f.manager.current, null);
});

test('blank credentials reuse current secrets only for the same profile and address', async () => {
  const f = fixture(); await initial(f);
  const same = f.manager.connect({ ...f.input, address: 'http://router:2333/', password: '', ztePassword: '' });
  assert.equal(f.clients[1].credentials.password, 'session-password'); assert.equal(f.clients[1].credentials.ztePassword, 'session-zte');
  f.clients[1].resolve({}); await same;
  const other = f.manager.connect({ ...f.input, address: 'http://other:2333', password: '', ztePassword: '' });
  assert.equal(f.clients[2].credentials.password, undefined); assert.equal(f.clients[2].credentials.token, undefined); assert.equal(f.clients[2].credentials.ztePassword, undefined);
  f.clients[2].resolve({}); await other;
});

test('saving failure leaves the working client intact', async () => {
  const f = fixture(); await initial(f); f.store.save = () => { throw new Error('disk full'); };
  const promise = f.manager.connect(f.input); f.clients[1].resolve({});
  await assert.rejects(promise, /disk full/);
  assert.equal(f.manager.current.client, f.clients[0]); assert.equal(f.clients[0].closed, false); assert.equal(f.clients[1].closed, true);
});

test('first connection without an existing profile creates a session', async () => {
  const f = fixture();
  const pending = f.manager.connect({ ...f.input, id: undefined });
  f.clients[0].resolve({ version: { model: 'F50' } });
  const result = await pending;
  assert.equal(result.profile.id, 'a'); assert.equal(f.manager.current.client, f.clients[0]);
});
