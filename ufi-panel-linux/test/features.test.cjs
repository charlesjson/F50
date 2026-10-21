'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { UfiClient } = require('../src/core/client.cjs');
const { DeviceFeatures, smsHex } = require('../src/core/features.cjs');
const { hashPassword } = require('../src/core/protocol.cjs');

async function server(t, handler) { const s = http.createServer(handler); s.listen(0, '127.0.0.1'); await once(s, 'listening'); t.after(() => { s.closeAllConnections(); s.close(); }); return `http://127.0.0.1:${s.address().port}`; }
const json = (r, data) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(data)); };

test('official writes use fresh uppercase AD challenges and serialize SMS sends', async t => {
  let rd = 0; const forms = [];
  const address = await server(t, async (req, res) => {
    const url = new URL(req.url, 'http://test'), cmd = url.searchParams.get('cmd');
    if (url.pathname === '/api/get_cookie') return json(res, { cookie: 'stok=fixture' });
    if (cmd === 'loginfo') return json(res, { loginfo: 'ok' });
    if (cmd === 'cr_version,wa_inner_version') return json(res, { cr_version: 'firmware', wa_inner_version: 'web' });
    if (cmd === 'RD') return json(res, { RD: 'challenge-' + ++rd });
    let body = ''; for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    assert.equal(req.headers['kano-cookie'], 'stok=fixture');
    assert.equal(form.get('AD'), hashPassword(hashPassword('webfirmware').toUpperCase() + 'challenge-' + rd).toUpperCase());
    forms.push(Object.fromEntries(form)); json(res, { result: 'success' });
  });
  const client = new UfiClient({ address }); t.after(() => client.close()); const f = new DeviceFeatures(client);
  const plan = f.prepare('sms-send', { number: '+8613800000000', content: '你好😀' });
  assert.equal(forms.length, 0, 'preparing confirmation must not send a message');
  await Promise.all([plan.run(), client.postOfficial({ goformId: 'SET_MSG_READ', msg_id: '3' })]);
  assert.equal(rd, 2); assert.equal(forms[0].MessageBody, '4f60597dd83dde00'); assert.equal(forms[0].Number, '+8613800000000');
  assert.equal(forms[1].goformId, 'SET_MSG_READ');
});

test('Wi-Fi updates preserve Unicode SSIDs, encode credentials, and keep blank passwords unchanged', async () => {
  const calls = []; const c = { postOfficial: async data => calls.push(data), official: async () => ({ WiFiModuleSwitch: '1', ResponseList: [{ SSID: '路由器', Password: 'hidden-secret', ChipIndex: '1', AccessPointIndex: '0' }] }) };
  const f = new DeviceFeatures(c);
  assert.equal(JSON.stringify(await f.read('wifi')).includes('hidden-secret'), false);
  const input = { ssid: '路由器', auth: 'WPA2PSK', password: 'new-password', max: '10', hidden: '0', isolate: '1', chip: '1', point: '0' };
  await f.prepare('wifi-save', input).run(); assert.equal(Buffer.from(calls[0].Password, 'base64').toString(), 'new-password'); assert.equal(calls[0].ChipIndex, 1);
  await f.prepare('wifi-save', { ...input, password: '' }).run(); assert.equal(Object.hasOwn(calls[1], 'Password'), false);
  assert.throws(() => f.prepare('wifi-save', { ...input, ssid: '中'.repeat(20) }), /32 字节/);
});

test('invalid settings and arbitrary actions are rejected before any write', () => {
  const f = new DeviceFeatures({});
  for (const [action, input] of [['sms-send', { number: '123,456', content: 'test' }], ['cell-lock', { rat: '12', pci: '999', earfcn: '10' }], ['network-mode', { mode: 'invented' }], ['bands', { rat: 'NR', bands: '78; reboot' }], ['task-add', { id: 'x', time: '25:99', repeat: '1', action: 'reboot' }], ['reboot-arbitrary', {}]]) assert.throws(() => f.prepare(action, input));
  assert.equal(smsHex('A😀'), '0041d83dde00');
});

test('plugin save detects concurrent changes and preserves the existing source', async () => {
  let stored = '<script>one()</script>', writes = 0;
  const f = new DeviceFeatures({ api: async (_path, options) => { if (options?.method === 'POST') { writes++; stored = options.body.text; return { result: 'success' }; } return { text: stored }; } });
  const current = await f.read('plugins-config'); const stalePlan = f.prepare('plugins-save', { text: 'replacement', revision: current.revision });
  stored = 'changed-by-web'; await assert.rejects(stalePlan.run(), /其他页面修改/); assert.equal(stored, 'changed-by-web'); assert.equal(writes, 0);
  const latest = await f.read('plugins-config'); await f.prepare('plugins-save', { text: '', revision: latest.revision }).run(); assert.equal(stored, ''); assert.equal(writes, 1);
});

test('APN writes preserve paired IPv4/IPv6 fields and task time uses an explicit device action', async () => {
  const calls = [];
  const f = new DeviceFeatures({ postOfficial: async body => { calls.push(body); }, api: async (path, options) => { calls.push({ path, body: options.body }); return { result: 'success' }; } });
  await f.prepare('apn-save', { index: '2', name: 'Carrier', apn: 'internet', pdp: 'IPv4v6', auth: 'pap', username: 'test', password: 'example' }).run();
  assert.equal(calls[0].apn_wan_apn, 'internet'); assert.equal(calls[0].ipv6_wan_apn, 'internet'); assert.equal(calls[0].apn_ipv6_ppp_passwd, 'example');
  await f.prepare('task-add', { id: 'daily', time: '03:10', repeat: '1', action: 'wifiOff' }).run();
  assert.deepEqual(calls[1].body.action, { goformId: 'switchWiFiModule', SwitchOption: '0' });
});

test('uncertain writes are not retried and return an actionable outcome', async () => {
  let calls = 0; const f = new DeviceFeatures({ postOfficial: async () => { calls++; throw new Error('设备响应超时'); } });
  await assert.rejects(f.prepare('reboot').run(), /操作结果未知/); assert.equal(calls, 1);
});

test('LAN settings reject invalid masks and pools outside the gateway subnet', () => {
  const f = new DeviceFeatures({});
  const config = { enabled: '1', lease: '24', lanIp: '192.168.0.1', lanNetmask: '255.255.255.0', dhcpStart: '192.168.0.100', dhcpEnd: '192.168.0.200' };
  assert.doesNotThrow(() => f.prepare('lan', config));
  assert.throws(() => f.prepare('lan', { ...config, lanNetmask: '255.0.255.0' }), /掩码/);
  assert.throws(() => f.prepare('lan', { ...config, dhcpEnd: '192.168.1.2' }), /子网/);
});

test('VoNR slot is sent in the JSON body, not only the query', async () => {
  let call;
  const f = new DeviceFeatures({ api: async (path, options) => { call = { path, options }; return { result: 'success' }; } });
  await f.prepare('voice', { type: 'vonr', enabled: '1', slot: '1' }).run();
  assert.equal(call.path, '/api/vonr_status'); assert.deepEqual(call.options.body, { enabled: '1', slot: '1' });
});
