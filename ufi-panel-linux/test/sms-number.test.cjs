'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { smsNumber } = require('../src/core/sms-number.cjs');
const { DeviceFeatures } = require('../src/core/features.cjs');
test('international recipients use an explicit prefix without duplicating a complete number', () => {
  assert.equal(smsNumber({ number: '7700 900-123', numberMode: 'international', countryCode: '44' }), '+447700900123');
  assert.equal(smsNumber({ number: '+44 7700 900123', numberMode: 'international', countryCode: '86' }), '+447700900123');
  assert.equal(smsNumber({ number: '10000' }), '10000');
  assert.equal(smsNumber({ number: '13800000000' }), '13800000000');
  assert.equal(smsNumber({ number: '0212345678', numberMode: 'international', countryCode: '39' }), '+390212345678');
  for (const input of [{number:'+012345'}, {number:'+1234567890123456'}, {number:'123,456'}, {number:'123\n456'}, {number:'1234',numberMode:'international',countryCode:'0'}, {number:'1234',numberMode:'unknown'}]) assert.throws(() => smsNumber(input));
});
test('confirmation and device payload use exactly the same normalized recipient', async () => {
  const sent = []; const features = new DeviceFeatures({ postOfficial: async fields => sent.push(fields) });
  const plan = features.prepare('sms-send', { number:'7700 900123',numberMode:'international',countryCode:'44',content:'Hello' });
  assert.match(plan.detail, /收件人：\+447700900123/); assert.equal(sent.length, 0);
  await plan.run(); assert.equal(sent[0].Number, '+447700900123');
});
test('country lookup supports names, codes and distinct regions sharing a code', async () => {
  const { searchCallingCodes } = await import('../src/renderer/calling-codes.mjs');
  assert.equal(searchCallingCodes('英国')[0].code, '44');
  assert.equal(searchCallingCodes('united kingdom')[0].name, '英国');
  assert.equal(searchCallingCodes('+852')[0].name, '中国香港');
  assert.ok(searchCallingCodes('1').some(r => r.id === 'US'));
  assert.ok(searchCallingCodes('1').some(r => r.id === 'CA'));
  assert.deepEqual(searchCallingCodes('不存在的地区'), []);
});
