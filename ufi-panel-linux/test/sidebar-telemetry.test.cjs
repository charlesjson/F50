'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('sidebar reports device monthly usage and Wi-Fi counts without treating missing data as zero', async () => {
  const { sidebarReadings } = await import('../src/renderer/sidebar-telemetry.mjs');
  const data = sidebarReadings({ base: { cpu_usage: '12.8', mem_usage: 61, cpu_temp: '52100', daily_data: 1024 ** 3, monthly_data: 24 * 1024 ** 3 }, network: { realtime_rx_thrpt: '2048', realtime_tx_thrpt: 0, wifi_access_sta_num: '2', total_rx_bytes: 999999999999 } });
  assert.deepEqual(data.cpu, ['12.8', '%']); assert.deepEqual(data.memory, ['61.0', '%']); assert.deepEqual(data.temperature, ['52.1', '°C']);
  assert.deepEqual(data.daily, ['1.00', 'GB']); assert.deepEqual(data.monthly, ['24.00', 'GB']);
  assert.deepEqual(data.download, ['2.00', 'KB/s']); assert.deepEqual(data.upload, ['0', 'B/s']); assert.deepEqual(data.clients, ['2', '台']);
  const missing = sidebarReadings({});
  for (const key of ['cpu', 'memory', 'temperature', 'daily', 'monthly', 'download', 'upload', 'clients']) assert.deepEqual(missing[key], ['—', ''], key);
});

test('zero readings remain valid while impossible percentages, rates and fractional client counts stay absent', async () => {
  const { sidebarReadings } = await import('../src/renderer/sidebar-telemetry.mjs');
  const zero = sidebarReadings({ base: { cpu_usage: 0, mem_usage: '0', cpu_temp: 0, daily_data: 0, monthly_data: '0' }, network: { realtime_rx_thrpt: 0, realtime_tx_thrpt: '0', wifi_access_sta_num: 0 } });
  assert.deepEqual(zero.cpu, ['0.0', '%']); assert.deepEqual(zero.memory, ['0.0', '%']); assert.deepEqual(zero.temperature, ['0.0', '°C']);
  assert.deepEqual(zero.monthly, ['0', 'B']); assert.deepEqual(zero.clients, ['0', '台']); assert.deepEqual(zero.download, ['0', 'B/s']);
  const invalid = sidebarReadings({ base: { cpu_usage: -1, mem_usage: 101, cpu_temp: '', daily_data: -1 }, network: { realtime_rx_thrpt: -1, wifi_access_sta_num: '2.5' } });
  for (const key of ['cpu', 'memory', 'temperature', 'daily', 'download', 'clients']) assert.deepEqual(invalid[key], ['—', ''], key);
});
