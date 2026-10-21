'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Telemetry } = require('../src/core/telemetry.cjs');
function harness() {
  let now = 1000000, next, delay;
  const sampler = new Telemetry({ now: () => now, setTimer: (callback, ms) => { next = callback; delay = ms; return 1; }, clearTimer: () => { next = null; } });
  return { sampler, advance: ms => { now += ms; }, now: () => now, delay: () => next ? delay : null };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('monitor and manual refresh share one read and account for request duration', async () => {
  const h = harness(), pending = deferred(); let reads = 0;
  h.sampler.attach({ snapshot: () => { reads++; return pending.promise; } });
  const first = h.sampler.sample(), second = h.sampler.sample();
  assert.equal(first, second); await Promise.resolve(); assert.equal(reads, 1);
  h.advance(600); pending.resolve({ at: h.now(), base: {} }); await first;
  assert.equal(h.delay(), 1400); assert.equal(h.sampler.state().history.length, 1);
  h.sampler.close(); assert.equal(h.delay(), null);
});
test('failed reads leave gaps, back off and return to the requested cadence after recovery', async () => {
  const h = harness(); let fails = true;
  h.sampler.attach({ snapshot: async () => { if (fails) throw new Error('offline'); return { at: h.now() }; } });
  await assert.rejects(h.sampler.sample(), /offline/); assert.equal(h.delay(), 4000);
  await assert.rejects(h.sampler.sample(), /offline/); assert.equal(h.delay(), 8000);
  assert.equal(h.sampler.history.at(-1).error, 'offline');
  fails = false; await h.sampler.sample(); assert.equal(h.delay(), 2000); assert.equal(h.sampler.failures, 0);
});
test('switching devices discards late responses and disconnect stops the next read', async () => {
  const h = harness(), pending = deferred(); const emitted = [];
  h.sampler.on('sample', packet => emitted.push(packet));
  const oldSession = h.sampler.attach({ snapshot: () => pending.promise });
  const oldRead = h.sampler.sample(); await Promise.resolve();
  const newSession = h.sampler.attach({ snapshot: async () => ({ at: h.now(), base: { model: 'new' } }) });
  assert.notEqual(oldSession, newSession); await h.sampler.sample();
  pending.resolve({ at: h.now(), base: { model: 'old' } }); await oldRead;
  assert.equal(emitted.length, 1); assert.equal(h.sampler.history[0].snapshot.base.model, 'new');
  h.sampler.close(); assert.equal(h.delay(), null); assert.equal(h.sampler.history.length, 0);
});
test('pausing while a read is pending allows completion but never schedules another read', async () => {
  const h = harness(), pending = deferred(); h.sampler.attach({ snapshot: () => pending.promise });
  const read = h.sampler.sample(); h.sampler.configure(0); pending.resolve({ at: h.now() }); await read;
  assert.equal(h.delay(), null); h.sampler.configure(1000); assert.equal(h.delay(), 1000);
  assert.throws(() => h.sampler.configure(10), /无效/);
});
test('history is bounded by time and missing metrics remain gaps, including pause intervals', async () => {
  const { appendSample, sampleFrom } = await import('../src/renderer/telemetry-data.mjs');
  const sample = sampleFrom({ at: 1, snapshot: { base: { cpu_temp: 52100, cpu_usage: 0, mem_usage: '' }, network: { realtime_rx_thrpt: 0, realtime_tx_thrpt: -1 } } });
  assert.equal(sample.temperature, 52.1); assert.equal(sample.cpu, 0); assert.equal(sample.memory, null); assert.equal(sample.down, 0); assert.equal(sample.up, null);
  const history = appendSample([sample], { ...sample, at: 10000 }, 2000);
  assert.equal(history[1].cpu, null); assert.equal(history.length, 3);
  const h = harness(); h.sampler.attach({ snapshot: async () => ({ at: h.now() }) });
  for (let i = 0; i < 700; i++) { h.advance(1000); await h.sampler.sample(); }
  assert.equal(h.sampler.history.length, 601); assert.ok(h.sampler.history[0].at >= h.now() - 600000);
});
