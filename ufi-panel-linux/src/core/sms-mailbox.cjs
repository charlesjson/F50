'use strict';
const FOLDERS = ['inbox', 'sent', 'draft', 'other'];
const PAGE_SIZE = 50;
const rawString = value => value == null ? '' : String(value).trim().toLowerCase();

function normalizeSms(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('设备返回了无效的短信记录');
  const tag = rawString(message.tag);
  let folder = 'other', status = '状态未知', unread = false;
  if (['0', '1', 'received', 'recv', 'inbox', 'read', 'unread'].includes(tag)) {
    folder = 'inbox';
    unread = tag === '1' || tag === 'unread' || message.unread === true || message.unread === 1 || message.unread === '1';
    status = unread ? '未读' : '已读';
  } else if (['2', 'sent', 'sentbox', 'outbox', 'out'].includes(tag)) {
    folder = 'sent'; status = '已发送';
  } else if (['3', 'unsent', 'pending', 'sending'].includes(tag)) {
    folder = 'sent'; status = tag === '3' ? '发出记录（状态 3）' : '待发送';
  } else if (['failed', 'send_failed', 'send-failed'].includes(tag)) {
    folder = 'sent'; status = '发送失败';
  } else if (['4', 'draft', 'drafts'].includes(tag)) {
    folder = 'draft'; status = '草稿';
  }
  return { ...message, folder, status, unread, rawTag: message.tag ?? null };
}
function queryOf(input = {}) {
  if (input != null && typeof input !== 'number' && (typeof input !== 'object' || Array.isArray(input))) throw new Error('无效的短信查询');
  const { page = 0, folder = 'inbox', refresh = false } = typeof input === 'number' ? { page: input } : input || {};
  if (!Number.isSafeInteger(page) || page < 0 || page > 200) throw new Error('无效的短信页码');
  if (![...FOLDERS, 'all'].includes(folder)) throw new Error('无效的短信分类');
  return { page, folder, refresh: refresh === true };
}
function mailboxPage(items, query, { complete = true, truncated = false, readAt = Date.now() } = {}) {
  const matches = query.folder === 'all' ? items : items.filter(item => item.folder === query.folder);
  const end = (query.page + 1) * PAGE_SIZE;
  const counts = Object.fromEntries(FOLDERS.map(folder => [folder, items.filter(item => item.folder === folder).length]));
  return { folder: query.folder, page: query.page, messages: matches.slice(query.page * PAGE_SIZE, end), counts,
    loadedCount: items.length, complete, truncated, readAt,
    scanning: !complete && !truncated && matches.length < end,
    hasMore: matches.length > end || (!complete && !truncated),
  };
}

// Shared reads preserve raw records across folders. Each transaction scans a
// bounded number of device pages, and commits only after every requested read succeeds.
class SmsMailbox {
  constructor(readPage, { now = Date.now, ttl = 15000, maxRecords = 10000, maxReads = 4 } = {}) {
    Object.assign(this, { readPage, now, ttl, maxRecords, maxReads });
    this.queue = Promise.resolve(); this.invalidate();
  }
  invalidate() { this.revision = (this.revision || 0) + 1; this.cache = null; }
  read(input) {
    let query;
    try { query = queryOf(input); } catch (error) { return Promise.reject(error); }
    const job = this.queue.then(() => this.load(query));
    this.queue = job.catch(() => {}); return job;
  }
  async load(query) {
    const revision = this.revision;
    const previous = !query.refresh && this.cache && this.now() - this.cache.readAt < this.ttl ? this.cache : null;
    const state = previous ? { ...previous, items: [...previous.items] } : { items: [], nextPage: 0, complete: false, truncated: false, readAt: this.now() };
    let reads = 0;
    while (!state.complete && !state.truncated) {
      const count = query.folder === 'all' ? state.items.length : state.items.filter(item => item.folder === query.folder).length;
      if (count >= (query.page + 1) * PAGE_SIZE || reads >= this.maxReads) break;
      const records = await this.readPage(state.nextPage);
      if (!Array.isArray(records)) throw new Error('设备返回了无效的短信列表');
      if (revision !== this.revision) throw new Error('短信状态已变更，请重新读取');
      const known = new Map(state.items.map((item, index) => [item.id == null ? null : `${item.sim_slot ?? ''}:${item.id}`, index]).filter(([id]) => id !== null));
      for (const record of records) {
        const item = normalizeSms(record), key = item.id == null ? null : `${item.sim_slot ?? ''}:${item.id}`;
        if (key !== null && known.has(key)) state.items[known.get(key)] = item;
        else if (state.items.length < this.maxRecords) { if (key !== null) known.set(key, state.items.length); state.items.push(item); }
      }
      state.nextPage++; reads++;
      state.complete = records.length < PAGE_SIZE;
      state.truncated = !state.complete && (state.items.length >= this.maxRecords || state.nextPage * PAGE_SIZE >= this.maxRecords);
    }
    if (revision !== this.revision) throw new Error('短信状态已变更，请重新读取');
    this.cache = state;
    return mailboxPage(state.items, query, state);
  }
}
module.exports = { SmsMailbox, normalizeSms, mailboxPage, queryOf, FOLDERS, PAGE_SIZE };
