'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash, createHmac } = require('node:crypto');
const { once } = require('node:events');
const { Transport, canonicalPath, normalizeAddress, sign, hashPassword } = require('../src/core/protocol.cjs');
const { UfiClient, decodeSms } = require('../src/core/client.cjs');

async function server(t, handler) {
  const instance = http.createServer(handler);
  instance.listen(0, '127.0.0.1'); await once(instance, 'listening');
  t.after(() => { instance.closeAllConnections(); instance.close(); });
  return `http://127.0.0.1:${instance.address().port}`;
}
const json = (res, data) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); };

test('signature matches independent binary-digest reference, excluding query', () => {
  const timestamp = '1718438543772';
  const h = createHmac('md5', 'minikano_kOyXz0Ciz4V7wR0IeKmJFYFQ20jd').update('minikanoPOST/api/user' + timestamp).digest();
  const p1 = createHash('sha256').update(h.subarray(0, 8)).digest();
  const p2 = createHash('sha256').update(h.subarray(8)).digest();
  const expected = createHash('sha256').update(Buffer.concat([p1, p2])).digest('hex');
  assert.equal(sign('post', '/api/user?id=123', timestamp), expected);
  assert.equal(canonicalPath('/api/%25E4%25B8%25AD//test'), '/api/中/test');
  assert.equal(canonicalPath('/api/proxy/--https://example.com/path'), '/api/proxy/--https://example.com/path');
});

test('addresses accept reverse proxy prefixes and reject embedded credentials', () => {
  assert.equal(normalizeAddress('192.168.0.1:2333/'), 'http://192.168.0.1:2333');
  assert.equal(normalizeAddress('https://example.com/ufi/'), 'https://example.com/ufi');
  for (const value of ['file:///etc/passwd', 'http://admin:secret@example.com', 'https://example.com/?token=secret', 'https://example.com/#a', '']) assert.throws(() => normalizeAddress(value));
});

test('LAN transport sends valid signed auth and prefix is not signed', async t => {
  const token = hashPassword('示例口令');
  const address = await server(t, (req, res) => {
    assert.equal(req.url, '/ufi/api/baseDeviceInfo?a=1');
    assert.equal(req.headers.authorization, token);
    assert.equal(req.headers['kano-sign'], sign('GET', '/api/baseDeviceInfo', req.headers['kano-t']));
    json(res, { model: 'F50' });
  });
  const transport = new Transport(address + '/ufi/', token); t.after(() => transport.close());
  assert.equal((await transport.request('/api/baseDeviceInfo?a=1')).data.model, 'F50');
});

test('transport reports empty 401, rejects redirects and invalid JSON', async t => {
  const address = await server(t, (req, res) => {
    if (req.url === '/api/unauthorized') { res.writeHead(401); res.end(); }
    else if (req.url === '/api/redirect') { res.writeHead(302, { location: '/api/unauthorized' }); res.end(); }
    else res.end('<html>not an API</html>');
  });
  const transport = new Transport(address); t.after(() => transport.close());
  await assert.rejects(transport.request('/api/unauthorized'), error => error.status === 401);
  await assert.rejects(transport.request('/api/redirect'), /重定向/);
  await assert.rejects(transport.request('/api/html'), /JSON/);
});

test('transport bounds timeout and cancels pending requests on disconnect', async t => {
  const address = await server(t, () => {});
  const transport = new Transport(address, '', { timeout: 60 });
  await assert.rejects(transport.request('/api/slow'), /超时/);
  const pending = transport.request('/api/slow'); transport.close();
  await assert.rejects(pending, /关闭/);
  await assert.rejects(transport.request('/api/no'), /关闭/);
});

test('transport rejects oversized responses', async t => {
  const address = await server(t, (_req, res) => json(res, { content: 'x'.repeat(1000) }));
  const transport = new Transport(address, '', { maxBytes: 64 }); t.after(() => transport.close());
  await assert.rejects(transport.request('/api/large'), /大小/);
});

test('ZTE login uses uppercase challenge and keeps its cookie in memory', async t => {
  let loggedIn = false; let loginCount = 0; const writes = [];
  const address = await server(t, async (req, res) => {
    if (req.method === 'POST') {
      writes.push(req.url); let body = ''; for await (const chunk of req) body += chunk;
      assert.equal(new URLSearchParams(body).get('password'), hashPassword(hashPassword('admin').toUpperCase() + 'fixture-challenge').toUpperCase());
      loginCount++; loggedIn = true; res.setHeader('kano-cookie', 'stok=fixture; Path=/'); json(res, { result: 'success' });
    } else if (req.url === '/api/get_cookie') json(res, { cookie: '' });
    else if (req.url.includes('cmd=loginfo')) json(res, { loginfo: loggedIn && req.headers['kano-cookie'] === 'stok=fixture' ? 'ok' : '' });
    else if (req.url.includes('cmd=LD')) json(res, { LD: 'fixture-challenge' });
    else { assert.equal(req.headers['kano-cookie'], 'stok=fixture'); json(res, { station_list: [] }); }
  });
  const client = new UfiClient({ address, password: 'example', ztePassword: 'admin' }); t.after(() => client.close());
  await Promise.all([client.clients(), client.clients()]); await client.clients();
  assert.equal(loginCount, 1); assert.deepEqual(writes, ['/api/goform/goform_set_cmd_process']);
});

test('base snapshot survives optional endpoint errors without fabricating network data', async t => {
  const address = await server(t, (req, res) => {
    if (req.url === '/api/baseDeviceInfo') json(res, { cpu_temp: 55272 });
    else { res.statusCode = 404; json(res, { error: 'Unavailable' }); }
  });
  const client = new UfiClient({ address }); t.after(() => client.close());
  const data = await client.snapshot();
  assert.equal(data.base.cpu_temp, 55272); assert.equal(data.warnings.length, 2); assert.deepEqual(data.network, {});
});

test('SMS decodes base64 UTF-8 including supplementary characters', () => {
  const text = '您好，测试短信 📶';
  assert.equal(decodeSms(Buffer.from(text).toString('base64')), text);
});

test('Shell and AT retain exact JSON/query semantics without local execution', async t => {
  const calls = [];
  const address = await server(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ path: req.url, method: req.method, body: body ? JSON.parse(body) : undefined });
    json(res, { result: 'fixture output' });
  });
  const client = new UfiClient({ address }); t.after(() => client.close());
  await client.shell('uptime'); await client.shell('id', true); await client.at('AT+CSQ');
  assert.equal(calls[0].path, '/api/user_shell'); assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { command: 'uptime', timeout: 10000 });
  assert.equal(calls[1].path, '/api/root_shell'); assert.equal(calls[1].body.command, 'id');
  assert.equal(calls[2].path, '/api/AT?command=AT%2BCSQ&slot=0'); assert.equal(calls[2].method, 'GET');
  await assert.rejects(client.at('AT+CSQ\nAT+CFUN=0'), /单行/);
});
