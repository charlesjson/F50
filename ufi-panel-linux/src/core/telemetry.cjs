'use strict';
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const INTERVALS = [0, 1000, 2000, 5000, 10000, 15000, 30000];

// One reader per connection, independent of renderer visibility and page edits.
class Telemetry extends EventEmitter {
  constructor({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    super(); Object.assign(this, { now, setTimer, clearTimer });
    this.interval = 2000; this.attach(null);
  }
  attach(client) {
    this.clearTimer(this.timer); this.timer = null;
    this.client = client; this.session = randomUUID(); this.pending = null;
    this.sequence = 0; this.failures = 0; this.history = [];
    this.schedule(this.interval);
    return this.session;
  }
  configure(interval) {
    if (!INTERVALS.includes(interval)) throw new Error('无效采集间隔');
    this.interval = interval; this.schedule(interval);
    return this.state();
  }
  state() { return { session: this.session, interval: this.interval, history: this.history }; }
  schedule(delay) {
    this.clearTimer(this.timer); this.timer = null;
    if (!this.client || !this.interval || this.pending) return;
    this.timer = this.setTimer(() => { this.timer = null; this.sample().catch(() => {}); }, delay);
    this.timer?.unref?.();
  }
  sample() {
    if (!this.client) return Promise.reject(new Error('请先连接设备'));
    if (this.pending) return this.pending.promise;
    this.clearTimer(this.timer); this.timer = null;
    const client = this.client, session = this.session, started = this.now(), job = {};
    this.pending = job;
    job.promise = Promise.resolve().then(() => client.snapshot()).then(snapshot => {
      if (this.session === session) {
        this.failures = 0; this.publish({ snapshot, at: snapshot.at });
      }
      return snapshot;
    }, error => {
      if (this.session === session) {
        this.failures++; this.publish({ error: error.message, at: this.now() });
      }
      throw error;
    }).finally(() => {
      if (this.pending !== job) return;
      this.pending = null;
      const cadence = Math.min(30000, this.interval * 2 ** Math.min(this.failures, 4));
      this.schedule(this.failures ? cadence : Math.max(100, cadence - (this.now() - started)));
    });
    return job.promise;
  }
  publish(data) {
    const packet = { ...data, session: this.session, sequence: ++this.sequence, failures: this.failures };
    this.history.push(packet);
    this.history = this.history.filter(item => item.at >= this.now() - 600000).slice(-601);
    this.emit('sample', packet);
  }
  close() { this.attach(null); }
}
module.exports = { Telemetry, INTERVALS };
