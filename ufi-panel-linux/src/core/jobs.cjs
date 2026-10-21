'use strict';
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
class Jobs extends EventEmitter {
  constructor() { super(); this.records = new Map(); }
  list() { return [...this.records.values()].map(({ controller, result, ...publicInfo }) => publicInfo).reverse(); }
  get(id) { const job = this.records.get(id); if (!job) throw new Error('任务不存在'); return job; }
  notify() { this.emit('change', this.list()); }
  start({ title, target, kind, cancelLabel = '取消', run }) {
    if ([...this.records.values()].filter(j => ['running', 'waiting-device'].includes(j.state)).length >= 4) throw new Error('同时运行的任务过多，请先停止已有任务');
    while (this.records.size >= 30) {
      const oldest = [...this.records.values()].find(j => !['running', 'waiting-device'].includes(j.state));
      if (!oldest) break; this.records.delete(oldest.id);
    }
    const job = { id: randomUUID(), title, target, kind, state: 'running', stage: '正在开始', startedAt: Date.now(), updatedAt: Date.now(), cancelLabel, cancellable: true, controller: new AbortController() };
    this.records.set(job.id, job); this.notify();
    const update = patch => { if (!['running', 'waiting-device'].includes(job.state)) return; Object.assign(job, patch, { updatedAt: Date.now() }); this.notify(); };
    Promise.resolve().then(() => run({ signal: job.controller.signal, update })).then(result => {
      job.result = result;
      Object.assign(job, { state: job.controller.signal.aborted ? 'cancelled' : 'succeeded', stage: job.controller.signal.aborted ? '已停止' : '已完成' });
    }).catch(error => {
      job.state = job.controller.signal.aborted ? 'cancelled' : error.uncertain ? 'unknown' : 'failed';
      job.stage = job.controller.signal.aborted ? (job.kind === 'ota-download' ? '已停止跟踪，设备下载可能仍在继续' : '已取消') : error.message;
    }).finally(() => { job.cancellable = false; job.finishedAt = Date.now(); job.updatedAt = Date.now(); this.notify(); });
    return job.id;
  }
  cancel(id) { const job = this.get(id); if (!job.cancellable || !['running', 'waiting-device'].includes(job.state)) throw new Error('此阶段不能取消'); job.controller.abort(); }
  stopTarget(target) { for (const job of this.records.values()) if (job.target === target && job.cancellable) job.controller.abort(); }
  close() { for (const job of this.records.values()) job.controller.abort(); }
}
module.exports = { Jobs };
