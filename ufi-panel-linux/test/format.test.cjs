'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const format = import('../src/renderer/format.mjs');

test('absent readings stay absent, while zero remains a valid reading', async () => {
  const { number, bytes, rate, temperature } = await format;
  for (const value of [null, undefined, '', ' ', false, [], {}, 'NaN', Infinity]) assert.equal(number(value), null);
  assert.equal(number('0'), 0); assert.equal(rate(null), '—'); assert.equal(rate('0'), '0 B/s');
  assert.equal(bytes(null), '—'); assert.equal(bytes(-1), '—'); assert.equal(bytes(1024), '1.00 KB'); assert.equal(temperature(59120), 59.12);
});

test('disconnected cellular states are never reported as connected', async () => {
  const { cellularStatus } = await format;
  for (const value of ['disconnected', 'ppp_disconnected']) assert.equal(cellularStatus(value), '未连接');
  for (const value of ['ppp_connected', 'connected', 'ipv4_ipv6_connected']) assert.equal(cellularStatus(value), '已连接');
  assert.equal(cellularStatus(null), '—');
});

test('client rows support encoded arrays and tolerate missing endpoints', async () => {
  const { clientsFrom } = await format;
  assert.deepEqual(clientsFrom({ station_list: JSON.stringify([{ hostname: 'Laptop', ip_addr: '192.168.0.3', mac_addr: '00:11' }]), lan_station_list: 'null' }), [{ name: 'Laptop', ip: '192.168.0.3', mac: '00:11', type: 'Wi-Fi' }]);
  assert.deepEqual(clientsFrom({ station_list: 'bad', lan_station_list: {} }), []);
});

test('SMS dates preserve the reported local time and display readable separators', async () => {
  const { smsDate } = await format;
  assert.equal(smsDate('26,10,15,9,4,2,+32'), '2026-10-15 09:04:02'); assert.equal(smsDate('2026-10-15'), '2026-10-15');
});
