'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Plugins, parseDocument } = require('../src/core/plugins.cjs');
const { DeviceFeatures } = require('../src/core/features.cjs');

const block = (name, code) => `<!-- [KANO_PLUGIN_START] ${name} -->\n${code}\n<!-- [KANO_PLUGIN_END] ${name} -->`;
function fixture(text, address = 'http://192.168.0.1:2333') {
  const state = { text, writes: [] };
  const client = { mode: 'KANO', transport: { address }, api: async (path, options) => {
    if (path === '/api/get_custom_head') return { text: state.text };
    assert.equal(path, '/api/set_custom_head'); state.writes.push(options.body.text); state.text = options.body.text; return { result: 'success' };
  } };
  return { state, client, plugins: new Plugins(client) };
}

test('installed plugins come from marked device content and preserve ambiguous and legacy fragments', async () => {
  const legacy = '<style>.old { color: red }</style>\r\n';
  const broken = '<!-- [KANO_PLUGIN_START] broken -->left intact';
  const { plugins, state } = fixture(legacy + block('同名.js', '<script>one()</script>') + '\r\n' + block('同名.js', '<script>two()</script>') + broken);
  const list = await plugins.installed();
  assert.equal(list.items.length, 2); assert.notEqual(list.items[0].id, list.items[1].id);
  assert.ok(list.unmanagedBytes); assert.ok(list.warnings.some(w => w.includes('同名'))); assert.ok(list.warnings.some(w => w.includes('不完整')));
  const target = list.items[1];
  const plan = plugins.prepare('plugin-delete', { id: target.id, revision: list.revision });
  assert.equal(state.writes.length, 0);
  await plan.run();
  assert.equal(state.text, legacy + block('同名.js', '<script>one()</script>') + '\r\n' + broken);
  const nested = block('outer.js', block('inner.js', '<script>x()</script>'));
  assert.equal(parseDocument(nested).blocks.length, 0);
  assert.equal(parseDocument(nested).unmanagedBytes, Buffer.byteLength(nested));
});

test('disabling and enabling a single plugin round trips its exact source and retains neighboring bytes', async () => {
  const source = '\r\n<script>const label="[kano_disabled]"; // only a string\r\n</script>\r\n';
  const original = 'legacy\r\n' + block('A.js', source) + '\n' + block('B.js', '<script>b()</script>') + '\r\ntail';
  const { plugins, state } = fixture(original);
  let list = await plugins.installed(), id = list.items[0].id;
  assert.equal(list.items[0].enabled, true);
  await plugins.prepare('plugin-toggle', { id, revision: list.revision, enabled: false }).run();
  list = await plugins.installed(); assert.equal(list.items[0].enabled, false); assert.equal(list.items[0].id, id);
  await assert.rejects(plugins.settings({ id, revision: list.revision }), /先启用/);
  await plugins.prepare('plugin-toggle', { id, revision: list.revision, enabled: true }).run();
  assert.equal(state.text, original);
});

test('installation uses native markers; duplicate updates require an explicit target and preserve disabled status', async () => {
  const { plugins, state } = fixture('<!-- old-style plugin -->\n<script>legacy()</script>');
  let list = await plugins.installed();
  await plugins.prepare('plugin-install', { name: '新插件.txt', text: '<script>newPlugin()</script>', revision: list.revision }).run();
  assert.match(state.text, /\[KANO_PLUGIN_START\] 新插件.txt/);
  list = await plugins.installed(); const id = list.items[0].id;
  assert.throws(() => plugins.prepare('plugin-install', { name: '新插件.txt', text: 'update', revision: list.revision }), /选择更新目标/);
  await plugins.prepare('plugin-toggle', { id, revision: list.revision, enabled: false }).run();
  list = await plugins.installed();
  await plugins.prepare('plugin-install', { name: '新插件.txt', text: '<script>updated()</script>', replaceId: id, revision: list.revision }).run();
  list = await plugins.installed(); assert.equal(list.items.length, 1); assert.equal(list.items[0].enabled, false);
  assert.ok(state.text.startsWith('<!-- old-style plugin -->\n<script>legacy()</script>'));
});

test('stale confirmation, missing IDs, invalid names and escaping markers are rejected before writing', async () => {
  const { plugins, state } = fixture(block('A.js', '<script>a()</script>'));
  const list = await plugins.installed(), id = list.items[0].id;
  for (const data of [{ name: 'bad -->.js', text: 'x' }, { name: 'new.js', text: block('escape.js', 'x') }]) {
    assert.throws(() => plugins.prepare('plugin-install', { ...data, revision: list.revision }));
  }
  assert.throws(() => plugins.prepare('plugin-delete', { id: 'not-installed', revision: list.revision }), /不存在/);
  const plan = plugins.prepare('plugin-delete', { id, revision: list.revision });
  state.text += '<script>otherEditor()</script>';
  await assert.rejects(plan.run(), /其他页面修改/); assert.equal(state.writes.length, 0);
  await assert.rejects(plugins.source({ id, revision: list.revision }), /其他页面修改/);
});

const manifest = value => '<script type="application/json" data-ufi-plugin-manifest>' + JSON.stringify(value) + '</script>';

test('legacy plugins use one configuration renderer regardless of names, labels and code hints', async () => {
  const source = '<script>const mm_action_box="IFRAME_KANO"; runShellWithRoot("安装SSH"); const url=`http://${location.hostname}:7788/ui/#/setup?secret=do-not-extract`;</script>';
  for (const name of ['future-tools.js', '日程.html', 'OpenSSH.txt', '猫猫_TProxy_1.1.js']) {
    const { plugins, state } = fixture(block(name, source), 'https://gateway.example.test/device/f50');
    const list = await plugins.installed(); assert.equal(list.items[0].settings, null);
    const settings = await plugins.settings({ id: list.items[0].id, revision: list.revision, address: 'http://ignored.test/' });
    assert.deepEqual(Object.keys(settings).sort(), ['address', 'panel', 'revision', 'title', 'view']);
    assert.equal(settings.view.selected, list.items[0].id);
    assert.deepEqual(settings.view.plugins, (await plugins.runtime({ revision: list.revision })).plugins);
    assert.equal((await plugins.settings({ id: list.items[0].id, revision: list.revision, target: 'native' })).view, null);
    assert.equal(settings.address, 'https://gateway.example.test/device/f50/');
    assert.equal(JSON.stringify([list, settings]).includes('do-not-extract'), false);
    assert.equal(state.writes.length, 0);
  }
});

test('any plugin can declare a settings URL with reverse proxy paths, hash routes and optional same-device ports', async () => {
  for (const name of ['tools-alpha.js', 'completely-unrelated.html']) {
    const source = manifest({ version: 1, settings: { url: './settings/?tab=network#/details' } });
    const { plugins } = fixture(block(name, source), 'https://gateway.example.test/device/f50');
    const list = await plugins.installed(), input = { id: list.items[0].id, revision: list.revision };
    const target = await plugins.settings(input);
    assert.equal(target.view, null);
    assert.equal(target.address, 'https://gateway.example.test/device/f50/settings/?tab=network#/details');
    assert.deepEqual(list.items[0].settings, { address: target.address });
    assert.equal((await plugins.settings({ ...input, target: 'native' })).address, 'https://gateway.example.test/device/f50/');
    await assert.rejects(plugins.settings({ ...input, target: 'dashboard' }), /未知/);
  }
  const { plugins } = fixture(block('arbitrary-panel.js', manifest({ version: 1, settings: { url: '/console/#/jobs', port: 9123 } })));
  const list = await plugins.installed();
  assert.equal((await plugins.settings({ id: list.items[0].id, revision: list.revision })).address, 'http://192.168.0.1:9123/console/#/jobs');
});

test('invalid declarations fall back to the native page without breaking plugin source or granting another origin access', async () => {
  const invalid = [
    '{broken', JSON.stringify({ version: 2 }),
    ...['javascript:alert(1)', 'file:///tmp/file', 'https://other.test/', '//other.test/', 'http://user:password@192.168.0.1/', 'https://192.168.0.1/', '', '/bad\\path'].map(url => JSON.stringify({ version: 1, settings: { url } })),
    ...[0, 70000, 1.5, '9123'].map(port => JSON.stringify({ version: 1, settings: { url: '/ui/', port } })),
    JSON.stringify({ version: 1, settings: null }), ' '.repeat(16385)
  ];
  for (const json of invalid) {
    const source = '<script type="application/json" data-ufi-plugin-manifest>' + json + '</script><script>legacyMenu()</script>';
    const { plugins, state } = fixture(block('any-name.js', source));
    const list = await plugins.installed();
    assert.equal(list.items[0].settings, null); assert.equal(list.warnings.length, 1);
    assert.equal((await plugins.settings({ id: list.items[0].id, revision: list.revision })).address, 'http://192.168.0.1:2333/');
    assert.equal((await plugins.runtime({ revision: list.revision })).plugins[0].scripts.length, 1);
    assert.equal((await plugins.source({ id: list.items[0].id, revision: list.revision })).text.trim(), source);
    assert.equal(state.writes.length, 0);
  }
  const { plugins } = fixture(block('duplicate.js', manifest({ version: 1 }) + manifest({ version: 1 })));
  assert.match((await plugins.installed()).warnings[0], /只能声明一个/);
});

test('advanced and per-plugin writes share serialization and require a valid device response', async () => {
  const { client, state } = fixture(block('A.js', 'one'));
  const features = new DeviceFeatures(client), config = await features.read('plugins-config');
  const list = await features.read('plugins-installed');
  const original = client.api;
  let release;
  client.api = async (path, options) => { if (options?.method === 'POST') await new Promise(resolve => release = resolve); return original(path, options); };
  const first = features.prepare('plugin-edit', { id: list.items[0].id, revision: list.revision, text: '\ntwo\n' }).run();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(features.prepare('plugins-save', { revision: config.revision, text: '' }).run(), /上一项插件操作/);
  release(); await first; assert.equal(state.writes.length, 1);
  client.api = async () => ({ text: state.text, result: 'failed' });
  await assert.rejects(features.plugins.save('new', (await features.plugins.read()).revision), /未确认/);
});

test('non-KANO modes, invalid response types and oversized UTF-8 JSON never overwrite device content', async () => {
  const { plugins, state, client } = fixture('');
  client.mode = 'GOFORM'; await assert.rejects(plugins.installed(), /需要 KANO/);
  client.mode = 'KANO'; client.api = async () => ({ text: null }); await assert.rejects(plugins.read(), /有效的插件配置/);
  assert.throws(() => parseDocument('汉'.repeat(2 * 1024 * 1024)), /5 MB/); assert.equal(state.writes.length, 0);
});
