'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startFixture } = require('./fixture-server.cjs');
const { launch } = require('./tauri-webdriver.cjs');
const block = (name, code) => `<!-- [KANO_PLUGIN_START] ${name} -->\n${code}\n<!-- [KANO_PLUGIN_END] ${name} -->`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (predicate, label) => {
  const until = Date.now() + 15000;
  while (Date.now() < until) { const result = predicate(); if (result) return result; await delay(100); }
  throw new Error('Plugin view wait expired: ' + label);
};
const windows = () => execFileSync('xwininfo', ['-root', '-tree'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C.UTF-8' } });
const click = (title, point) => {
  assert.ok(point?.visible, 'control must be visible');
  const line = windows().split('\n').find(line => line.includes(title)); assert.ok(line, title);
  const id = line.match(/0x[0-9a-f]+/)[0];
  execFileSync('xdotool', ['windowactivate', '--sync', id, 'mousemove', '--window', id, String(Math.round(point.x)), String(Math.round(point.y)), 'click', '1']);
};
const screenshot = (title, name) => {
  const line=windows().split('\n').find(line=>line.includes(title));assert.ok(line,title);
  execFileSync('xwd',['-id',line.match(/0x[0-9a-f]+/)[0],'-silent','-out',path.join(__dirname,'../artifacts/'+name+'.xwd')]);
};
function arbitraryPlugin() {
  window.__untrustedLocal = true;
  const host = document.querySelector('.functions-container');
  host.insertAdjacentHTML('afterend', `<section id="fixture-view" data-fixture-plugin-actions><h2>任意插件表单</h2>
    <div class="collapse" data-name="close"><div class="collapse_box">
      <input id="fixture-view-input" value="initial" aria-label="配置值"><select id="fixture-view-select"><option>第一个</option><option>第二个</option></select>
      <textarea id="fixture-view-textarea">现有配置</textarea><button id="fixture-view-save">保存配置</button><button id="fixture-view-upload">导入配置</button>
      <iframe id="fixture-view-frame" src="about:blank" style="width:100%;height:120px"></iframe>
    </div></div></section>`);
  document.querySelector('#fixture-view-frame').src=window.fixtureEmbeddedURL;
  const input = document.querySelector('#fixture-view-input');
  document.querySelector('#fixture-view-save').onclick = async () => {
    await runShellWithRoot('fixture-save ' + input.value);
    fixtureDialog('已保存：' + input.value);
  };
  document.querySelector('#fixture-view-upload').onclick = () => {
    const file = document.createElement('input'); file.type = 'file';
    file.onchange = async () => { await fetch('/fixture-upload?name=' + encodeURIComponent(file.files[0].name), { method: 'POST', body: file.files[0] }); };
    document.body.append(file); file.click();
  };
  setTimeout(() => Promise.resolve().then(() => {
    const button = document.createElement('button'); button.textContent = '异步生成的配置'; button.dataset.lateMenu = 'true';
    document.querySelector('#fixture-view .collapse_box').append(button);
  }), 400);
}
(async () => {
  const fixture = await startFixture(), other = await startFixture(), checks = []; let ui;
  fixture.state.pluginMenuFixture = true;
  fixture.state.pluginScripts = { '/fixture-plugin-source/view.js': `(async()=>{await new Promise(resolve=>setTimeout(resolve,350));const section=document.createElement('section');section.innerHTML='<h2>另一插件配置</h2><button>外部插件按钮</button>';document.body.append(section);})();` };
  fixture.state.pluginText = block('arbitrary-form.html', `<script>window.fixtureEmbeddedURL=${JSON.stringify(other.address+'/fixture-embedded-panel')};(async()=>{await new Promise(resolve=>setTimeout(resolve,30));(${arbitraryPlugin.toString()})();})()</script>`) + block('external-view.js', '<script src="/fixture-plugin-source/view.js"></script>') + block('disabled-view.js', '<!-- [kano_disabled]\n<script>throw Error("must not run")</script>\n[kano_disabled] -->');
  try {
    ui = await launch(); await ui.wait('document.readyState==="complete" && !!window.ufi');
    await ui.select('#poll-interval', '0'); await ui.click('#welcome-connect'); await ui.fill('#address', fixture.address); await ui.fill('#password', 'fixture-password'); await ui.click('#submit-connection');
    await ui.wait('document.getElementById("temperature").textContent==="52.1"'); await ui.navigate('plugins');
    const installed = await ui.api('featureRead', 'plugins-installed'), form = installed.items.find(item => item.name === 'arbitrary-form.html'), external = installed.items.find(item => item.name === 'external-view.js');
    await ui.click(`[data-plugin-settings="${form.id}"]`);
    const current = () => Object.values(fixture.state.pluginPages).find(page => page.viewSelected === form.id);
    await wait(() => current()?.viewControls.some(control => control.label === '异步生成的配置' && control.visible), 'asynchronous form renders');
    assert.equal(current().nativeVisible, false); assert.equal(current().viewFull, 'false');
    assert.ok(['INPUT', 'TEXTAREA', 'SELECT', 'IFRAME'].every(tag => current().viewControls.some(control => control.tag === tag && control.visible)));
    await wait(()=>other.state.embeddedLoads>0,'same-device panel on another port loads');
    assert.ok(current().viewControls.filter(control => control.label === '外部插件按钮').every(control => !control.visible));
    assert.equal(fixture.state.menuActions?.length || 0, 0); assert.equal(fixture.writes.length, 0);
    assert.equal(await ui.run('window.__untrustedLocal'), null); assert.deepEqual(fixture.state.remoteIsolation, { blocked: 'true', bridge: 'undefined' });
    screenshot('arbitrary-form','plugin-view-form');
    checks.push('arbitrary plugin renders its full dynamic form, collapsed content and iframe; native UI and other plugins stay hidden; no action executes on open');
    const control = label => current().viewControls.find(control => control.label === label && control.visible);
    fixture.state.pluginCommands[current().id] = { type: 'edit-view', value: 'preserved value' };
    await wait(() => current().viewControls.some(control => control.id === 'fixture-view-input' && control.value === 'preserved value'), 'edited value');
    const loads = other.state.embeddedLoads;
    click('arbitrary-form', control('显示完整设备页面'));
    await wait(() => current()?.viewFull === 'true' && current().nativeVisible, 'full page login fallback');
    click('arbitrary-form', control('返回插件配置'));
    await wait(() => current()?.viewFull === 'false' && !current().nativeVisible, 'return to form');
    assert.ok(current().viewControls.some(control => control.id === 'fixture-view-input' && control.value === 'preserved value'));
    assert.equal(other.state.embeddedLoads, loads);
    click('arbitrary-form', control('保存配置'));
    await wait(() => current()?.dialog?.includes('已保存：preserved value'), 'async original listener and dialog');
    assert.equal(fixture.state.menuActions.length, 1); assert.equal(fixture.state.menuActions[0].command, 'fixture-save preserved value');
    execFileSync('xdotool', ['key', 'Escape']);
    checks.push('switching to the complete device page and back preserves edited values and iframe state; original async click handler and modal still work');
    const upload = path.join(ui.temp, 'plugin-view-config.txt'); fs.writeFileSync(upload, 'plugin view upload bytes');
    click('arbitrary-form', control('导入配置'));
    await wait(() => /Open File|Select.*File|Choose.*File/i.test(windows()), 'native file picker');
    execFileSync('xdotool', ['key', 'ctrl+l']); execFileSync('xdotool', ['type', '--clearmodifiers', '--delay', '1', upload]); execFileSync('xdotool', ['key', 'Return']);
    await delay(500); execFileSync('xdotool', ['key', 'alt+o']);
    await wait(() => fixture.state.pluginUpload, 'uploaded file bytes');
    assert.deepEqual(fixture.state.pluginUpload, { name: 'plugin-view-config.txt', body: 'plugin view upload bytes' });
    checks.push('projected upload control retains a genuine native file chooser and uploads the selected bytes');
    await ui.api('showWindow'); await ui.click(`[data-plugin-settings="${external.id}"]`);
    await wait(() => Object.values(fixture.state.pluginPages).some(page => page.viewSelected === external.id && page.viewControls.some(control => control.label === '外部插件按钮' && control.visible)), 'switch plugin on same device and revision');
    assert.ok(!windows().includes('arbitrary-form'));
    checks.push('switching plugins on the same device revision replaces the selected configuration and supports external scripts');
    const samplePaths = JSON.parse(process.env.UFI_PLUGIN_SAMPLE_FILES || '[]');
    if (samplePaths.length) {
      fixture.state.pluginText = samplePaths.map((file, index) => block(`supplied-sample-${index + 1}.js`, fs.readFileSync(file, 'utf8'))).join('\n');
      await ui.click('#refresh-button');
      await ui.wait(`document.querySelectorAll('.installed-plugin[data-plugin-id]').length===${samplePaths.length}`);
      const samples = await ui.api('featureRead', 'plugins-installed');
      for (const sample of samples.items) {
        await ui.click(`[data-plugin-settings="${sample.id}"]`);
        const report = () => Object.values(fixture.state.pluginPages).find(page => page.viewSelected === sample.id);
        await wait(() => report()?.viewControls.some(control => control.visible && ['订阅链接', '上传公钥'].includes(control.label)), 'supplied sample renders');
        const cat = report().viewControls.find(control => control.label === '订阅链接' && control.visible);
        if (cat) {
          assert.ok(report().viewControls.some(control => control.tag === 'IFRAME' && control.visible));
          screenshot(sample.name.replace(/\.js$/, ''),'plugin-view-supplied-cat');
          click(sample.name.replace(/\.js$/, ''), cat);
          await wait(() => report()?.viewControls.some(control => control.id === 'mm_sub_url1_input' && control.visible), 'supplied subscription dialog');
          click(sample.name.replace(/\.js$/, ''), report().viewControls.find(control => control.id === 'mm_sub_close_btn'));
        } else {
          assert.ok(['安装SSH', '卸载SSH', '上传公钥'].every(label => report().viewControls.some(control => control.label === label && control.visible)));
          assert.ok(!report().viewControls.some(control => control.tag === 'IFRAME' && control.visible));
          screenshot(sample.name.replace(/\.js$/, ''),'plugin-view-supplied-ssh');
        }
        assert.equal(report().nativeVisible, false); assert.deepEqual(report().errors, []);
      }
      checks.push('both supplied unmodified scripts render in the fake UFI host: cat controls, iframe and subscription dialog; SSH install, remove and public-key buttons');
    }
    const pages = Object.values(fixture.state.pluginPages).filter(page => page.viewSelected); assert.deepEqual(pages.flatMap(page => page.errors), []);
    fixture.state.pluginText=block('empty-future.html','<script>/* no controls until login */</script>');
    await ui.click('#refresh-button');await ui.wait('document.querySelectorAll(".installed-plugin[data-plugin-id]").length===1');
    const empty=await ui.api('featureRead','plugins-installed');
    await ui.click(`[data-plugin-settings="${empty.items[0].id}"]`);
    const emptyReport=()=>Object.values(fixture.state.pluginPages).filter(page=>page.viewSelected===empty.items[0].id).sort((a,b)=>b.at-a.at)[0];
    await wait(()=>emptyReport()?.viewStatus?.includes('等待'),'empty configuration login fallback');
    click('empty-future',emptyReport().viewControls.find(control=>control.label==='显示完整设备页面'));
    await wait(()=>emptyReport()?.nativeVisible,'empty configuration still exposes complete page');
    fixture.state.pluginText=block('empty-future.html','<script>throw new Error("模拟插件异常")</script>');
    await ui.click('#refresh-button');await ui.wait('document.getElementById("plugins-content").getAttribute("aria-busy")==="false"');
    await ui.api('featureRead','plugins-installed');
    await ui.click(`[data-plugin-settings="${empty.items[0].id}"]`);
    await wait(()=>emptyReport()?.viewStatus?.includes('模拟插件异常'),'script failure message');
    checks.push('empty or failed plugins retain a visible loading/error message, reload and complete-page login fallback');
    await ui.api('connect', { name: 'other', address: other.address, password: 'fixture-password' });
    await wait(() => !/external-view|supplied-sample|empty-future/.test(windows()), 'switch device closes projection');
    await assert.rejects(ui.api('openPluginSettings', { id: form.id, revision: installed.revision }), /其他页面修改/);
    checks.push('device switch closes old configuration views and rejects stale settings requests');
    const report = { result: 'passed', nativeWebKit: true, checks, realDeviceWrites: 0 };
    fs.writeFileSync(path.join(__dirname, '../artifacts/plugin-view-validation.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  } catch (error) { console.error(ui?.diagnostics.slice(-2000)); console.error(windows().split('\n').filter(line=>line.includes('"')));console.error(await ui?.run('({toast:document.getElementById("toast").textContent,note:document.getElementById("plugin-note").textContent})').catch(()=>null));console.error(JSON.stringify({pages:Object.values(fixture.state.pluginPages).slice(-3),actions:fixture.state.menuActions})); throw error; }
  finally { await ui?.close(); fixture.close(); other.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
