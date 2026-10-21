'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SmsMailbox, normalizeSms, queryOf } = require('../src/core/sms-mailbox.cjs');
const records = (start, count, tag = '0') => Array.from({ length: count }, (_, i) => ({ id: String(start + i), tag, text: `text ${start+i}`, number: '10000' }));
test('SMS direction and unread are independent, preserving unknown raw state', () => {
  assert.equal(normalizeSms({tag:'0'}).folder,'inbox'); assert.equal(normalizeSms({tag:'1'}).unread,true);
  assert.equal(normalizeSms({tag:'2',unread:1}).folder,'sent'); assert.equal(normalizeSms({tag:'2',unread:1}).unread,false);
  assert.equal(normalizeSms({tag:'3'}).folder,'sent'); assert.equal(normalizeSms({tag:'3'}).status,'发出记录（状态 3）');
  assert.equal(normalizeSms({tag:4}).folder,'draft'); assert.equal(normalizeSms({tag:'failed'}).status,'发送失败');
  assert.equal(normalizeSms({tag:'new-tag'}).folder,'other'); assert.equal(normalizeSms({tag:'new-tag'}).rawTag,'new-tag');
  assert.equal(normalizeSms({unread:1}).folder,'other');
  assert.throws(()=>queryOf({folder:'invented'})); assert.throws(()=>queryOf({page:-1})); assert.throws(()=>queryOf('bad'));
});
test('folder pages find sent records beyond received pages and share the cached record set', async () => {
  const calls=[];
  const store=new SmsMailbox(async page=>{calls.push(page);return [records(0,50),records(50,50),records(100,3,'2')][page]||[];});
  const inbox=await store.read({folder:'inbox'});assert.equal(inbox.messages.length,50);assert.equal(inbox.hasMore,true);
  const sent=await store.read({folder:'sent'});assert.deepEqual(calls,[0,1,2]);assert.equal(sent.messages.length,3);assert.equal(sent.counts.inbox,100);assert.equal(sent.counts.sent,3);assert.equal(sent.complete,true);
  assert.ok(sent.messages.every(m=>m.folder==='sent'));
  const second=await store.read({folder:'inbox',page:1});assert.equal(second.messages[0].id,'50');assert.equal(second.messages.length,50);assert.equal(second.hasMore,false);assert.deepEqual(calls,[0,1,2]);
});
test('sparse folder scans resume the same page without losing intervening matches', async () => {
  const source=[...records(0,50),...records(50,50),...records(100,50,'2'),...records(150,1,'2')];
  const store=new SmsMailbox(async page=>source.slice(page*50,(page+1)*50),{maxReads:1});
  const first=await store.read({folder:'sent'});assert.equal(first.messages.length,0);assert.equal(first.scanning,true);assert.equal(first.hasMore,true);
  await store.read({folder:'sent'});
  const third=await store.read({folder:'sent'});assert.equal(third.messages.length,50);assert.equal(third.scanning,false);assert.equal(third.messages[0].id,'100');
  const fourth=await store.read({folder:'sent',page:1});assert.equal(fourth.messages.length,1);assert.equal(fourth.messages[0].id,'150');assert.equal(fourth.hasMore,false);
});
test('failed page reads do not replace a working cache and stale mutation responses are discarded', async () => {
  let fail=true,release;
  const store=new SmsMailbox(async page=>{if(page===0)return records(0,50);if(fail)throw new Error('offline');return records(50,1);});
  await store.read(0);await assert.rejects(store.read(1),/offline/);assert.equal(store.cache.items.length,50);assert.equal(store.cache.nextPage,1);
  fail=false;assert.equal((await store.read(1)).messages[0].id,'50');
  const delayed=new SmsMailbox(()=>new Promise(resolve=>release=resolve));const pending=delayed.read(0);await Promise.resolve();delayed.invalidate();release(records(0,1));
  await assert.rejects(pending,/已变更/);assert.equal(delayed.cache,null);
});
test('refresh rebuilds counts and reading is bounded even when a server repeats the same page', async () => {
  let list=records(0,2,'2');const store=new SmsMailbox(async()=>list);
  assert.equal((await store.read({folder:'sent'})).counts.sent,2);list=records(0,1,'0');
  const refreshed=await store.read({folder:'inbox',refresh:true});assert.equal(refreshed.counts.sent,0);assert.equal(refreshed.counts.inbox,1);
  const repeated=new SmsMailbox(async()=>records(0,50),{maxRecords:100});const bounded=await repeated.read({folder:'sent'});
  assert.equal(bounded.truncated,true);assert.equal(bounded.hasMore,false);assert.equal(bounded.loadedCount,50);
});
