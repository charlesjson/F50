'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Plugins } = require('../src/core/plugins.cjs');
const block = (name,source) => `<!-- [KANO_PLUGIN_START] ${name} -->\n${source}\n<!-- [KANO_PLUGIN_END] ${name} -->`;

test('generic menu discovery describes arbitrary enabled plugins without executing their source',async()=>{
  const source = '<script>window.__neverRunInHost = true;setTimeout(()=>makeButton("任意菜单"),50)</script>';
  let text = block('unknown-plugin.js',source)+'\n'+block('disabled.js','<!-- [kano_disabled]\n<script>bad()</script>\n[kano_disabled] -->');
  const plugins = new Plugins({mode:'KANO',transport:{address:'http://device.test/ufi'},api:async()=>({text})});
  const installed=await plugins.installed(),runtime=await plugins.runtime({revision:installed.revision});
  assert.equal(runtime.address,'http://device.test/ufi/');
  assert.equal(runtime.plugins.length,1);assert.equal(runtime.plugins[0].name,'unknown-plugin.js');
  assert.equal(runtime.plugins[0].scripts.length,1);assert.match(runtime.plugins[0].scripts[0],/^[a-f0-9]{8}$/);
  assert.equal(JSON.stringify(runtime).includes('__neverRunInHost'),false);assert.equal(global.__neverRunInHost,undefined);
  text+='\nchanged';await assert.rejects(plugins.runtime({revision:installed.revision}),/其他页面修改/);
});

test('external script plugins keep their own runtime group without requiring a known plugin adapter',async()=>{
  const text=block('arbitrary-loader.html','<script src="/uploads/plugin.js"></script>');
  const plugins=new Plugins({mode:'KANO',transport:{address:'http://device.test'},api:async()=>({text})});
  const installed=await plugins.installed(),runtime=await plugins.runtime({revision:installed.revision});
  assert.deepEqual(runtime.plugins[0].sources,['/uploads/plugin.js']);assert.deepEqual(runtime.plugins[0].scripts,[]);
});

test('menu attribution ignores inert manifests, comments and data scripts, and is unchanged by a plugin rename', async () => {
  const source = '<!-- <script>commentOnly()</script> -->' +
    '<script type="application/json" data-ufi-plugin-manifest>{"version":1,"settings":{"url":"./settings/"}}</script>' +
    '<script type="application/json">{"unused":true}</script>' +
    '<script title="a > b" type="module">window.futureMenu="测试😀"; // <!-- literal -->\r\n</script>' +
    '<SCRIPT SRC=/assets/future.js></SCRIPT>';
  let previous;
  for (const name of ['unknown-a.html', '另一个插件.txt']) {
    const text = block(name, source);
    const plugins = new Plugins({ mode: 'KANO', transport: { address: 'http://device.test/ufi' }, api: async () => ({ text }) });
    const list = await plugins.installed(), runtime = await plugins.runtime({ revision: list.revision });
    const { scripts, sources } = runtime.plugins[0];
    assert.equal(scripts.length, 1); assert.deepEqual(sources, ['/assets/future.js']);
    if (previous) assert.deepEqual({ scripts, sources }, previous);
    previous = { scripts, sources };
    assert.equal(list.items[0].settings.address, 'http://device.test/ufi/settings/');
    assert.equal(JSON.stringify(runtime).includes('futureMenu'), false);
  }
});
