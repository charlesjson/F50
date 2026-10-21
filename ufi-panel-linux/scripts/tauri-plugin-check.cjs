'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startFixture } = require('./fixture-server.cjs');
const { launch } = require('./tauri-webdriver.cjs');
const block = (name, code) => `<!-- [KANO_PLUGIN_START] ${name} -->\n${code}\n<!-- [KANO_PLUGIN_END] ${name} -->`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate, label) => { const until = Date.now() + 10000; while (Date.now() < until) { if (predicate()) return; await delay(100); } throw new Error('Native device view wait expired: ' + label); };
const windows = () => execFileSync('xwininfo', ['-root', '-tree'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C.UTF-8' } });
const clickDevice = (title, point) => {
  const env = { ...process.env, LC_ALL: 'C.UTF-8' };
  const line = windows().split('\n').find(line => line.includes(title) && line.includes('"'));
  assert.ok(line, 'device window must exist: ' + title);
  const id = line.match(/0x[0-9a-f]+/)[0];
  execFileSync('xdotool', ['windowactivate', '--sync', id, 'mousemove', '--window', id, String(Math.round(point.x)), String(Math.round(point.y)), 'click', '1'], { env });
};
(async () => {
  const fixture = await startFixture(), other = await startFixture(), checks = [];
  const legacy = '<style>/* retained legacy content */</style>\r\n';
  fixture.state.pluginText = legacy + block('tools-alpha.html', '<script type="application/json" data-ufi-plugin-manifest>{"version":1,"settings":{"url":"./ui/#/tasks"}}</script>') + '\n' + block('legacy-beta.txt', '<script>window.futurePlugin=true;</script>') + '\n' + block('unknown.js', '<script>window.__untrustedLocal=true;</script>');
  const original = fixture.state.pluginText;
  let ui;
  try {
    ui = await launch();
    await ui.wait('document.readyState==="complete" && !!window.ufi');
    await ui.run('window.__uiErrors=[];addEventListener("error",e=>__uiErrors.push(e.message));addEventListener("unhandledrejection",e=>__uiErrors.push(String(e.reason)))');
    await ui.select('#poll-interval', '0'); await ui.click('#welcome-connect'); await ui.fill('#address', fixture.address); await ui.fill('#password', 'fixture-password'); await ui.click('#submit-connection');
    await ui.wait('document.getElementById("temperature").textContent==="52.1"'); await ui.navigate('plugins');
    await ui.wait('document.querySelectorAll(".installed-plugin").length===3');
    assert.equal(await ui.run('window.__untrustedLocal'), null);
    checks.push('installed list discovers declared panels and arbitrary legacy plugins without running their code in the main view');

    fixture.state.failMarket = true; await ui.click('[data-plugin-tab=market]');
    await ui.wait('document.getElementById("plugins-status").textContent.includes("模拟设备暂时不可用")');
    await ui.click('[data-plugin-tab=installed]'); assert.equal(await ui.run('document.querySelectorAll(".installed-plugin").length'), 3);
    fixture.state.failMarket = false; await ui.click('[data-plugin-tab=market]');
    await ui.wait('document.querySelectorAll("#plugins-content .plugin-card").length===2');
    await ui.click('#plugins-content .plugin-card .plugin-link'); await ui.wait('!!document.querySelector("[data-plugin-install]")');
    await ui.click('[data-plugin-install]'); await ui.wait('!!document.querySelector("[data-confirm-operation]")');
    assert.equal(fixture.writes.length, 0); await ui.click('[data-confirm-operation]');
    await ui.wait('document.querySelectorAll(".installed-plugin").length===4'); assert.equal(fixture.writes.length, 1);
    assert.match(fixture.state.pluginText, /\[KANO_PLUGIN_START\] Mosdns.js/); assert.ok(fixture.state.pluginText.startsWith(original));
    checks.push('market failure is independent; confirmed installation uses native markers and immediately refreshes installed plugins');

    let installed = await ui.api('featureRead', 'plugins-installed'), added = installed.items.find(i => i.name === 'Mosdns.js');
    await ui.click(`[data-plugin-manage="${added.id}"]`); await ui.wait('!!document.querySelector("[data-plugin-toggle]")');
    await ui.click('[data-plugin-toggle]'); await ui.wait('!!document.querySelector("[data-confirm-operation]")'); await ui.click('[data-confirm-operation]');
    await ui.wait(`document.querySelector('[data-plugin-settings="${added.id}"]').disabled`); assert.equal(fixture.writes.length, 2);
    await ui.click(`[data-plugin-manage="${added.id}"]`); await ui.wait('!!document.querySelector("[data-plugin-toggle]")');
    await ui.click('[data-plugin-toggle]'); await ui.wait('!!document.querySelector("[data-confirm-operation]")'); await ui.click('[data-confirm-operation]');
    await ui.wait(`!document.querySelector('[data-plugin-settings="${added.id}"]').disabled`);
    await ui.click(`[data-plugin-manage="${added.id}"]`); await ui.wait('!!document.querySelector("[data-plugin-delete]")');
    await ui.click('[data-plugin-delete]'); await ui.wait('!!document.querySelector("[data-confirm-operation]")');
    await ui.click('#feature-dialog .dialog-actions button:first-child'); assert.equal(fixture.writes.length, 3);
    await ui.click('[data-plugin-delete]'); await ui.wait('!!document.querySelector("[data-confirm-operation]")'); await ui.click('[data-confirm-operation]');
    await ui.wait('document.querySelectorAll(".installed-plugin").length===3'); assert.equal(fixture.state.pluginText.trim(), original.trim());
    checks.push('per-plugin enable, disable, cancelled delete and confirmed delete preserve all neighboring and legacy code');

    ui.screenshot('tauri-plugin-center');
    installed = await ui.api('featureRead', 'plugins-installed'); const panel = installed.items.find(i => i.settings);
    await ui.click(`[data-plugin-settings="${panel.id}"]`);
    await waitFor(() => Object.values(fixture.state.pluginPages).some(p => p.pathname === '/ui/'), 'declared plugin panel loads');
    const remote = Object.values(fixture.state.pluginPages).find(p => p.pathname === '/ui/');
    assert.equal(remote.route, '#/tasks'); assert.deepEqual(remote.storage, []);
    assert.equal(remote.backdrop, 'none'); assert.equal(remote.privacyBlur, 'blur(4px)');
    checks.push('native device view disables backdrop filters before loading while preserving private-field blur');
    assert.ok(windows().includes('tools-alpha')); assert.deepEqual(fixture.state.remoteIsolation, { blocked: 'true', bridge: 'undefined' });
    await ui.api('showWindow'); await waitFor(() => fixture.state.pluginPages[remote.id].refresh === '开始刷新', 'pause device telemetry on blur');
    checks.push('generic settings declaration opens its exact URL and hash route without injected storage or exposing the local bridge');

    const upload = path.join(ui.temp, 'plugin-upload.txt'); fs.writeFileSync(upload, 'fixture upload');
    clickDevice('tools-alpha', fixture.state.pluginPages[remote.id].upload);
    await waitFor(() => /Open File|Select.*File|Choose.*File/i.test(windows()), 'native file picker');
    await delay(300);
    execFileSync('xdotool', ['key', 'ctrl+l']);
    execFileSync('xdotool', ['type', '--clearmodifiers', '--delay', '1', upload]);
    execFileSync('xdotool', ['key', 'Return']);
    await delay(500); execFileSync('xdotool', ['key', 'alt+o']);
    await waitFor(() => !!fixture.state.pluginUpload, 'device upload');
    assert.deepEqual(fixture.state.pluginUpload, { name: 'plugin-upload.txt', body: 'fixture upload' });
    checks.push('device WebKit native file chooser selects a file and uploads its bytes');
    fixture.state.pluginCommands[remote.id] = { type: 'download' };
    const downloads = path.join(ui.temp, 'downloads');
    await waitFor(() => fs.existsSync(downloads) && fs.readdirSync(downloads).some(name => fs.readFileSync(path.join(downloads, name), 'utf8') === 'fixture plugin backup'), 'device backup download');
    fixture.state.pluginCommands[remote.id] = { type: 'download' };
    await waitFor(() => fs.readdirSync(downloads).length === 2, 'repeated download creates a new file');
    checks.push('device WebKit settings support backup downloads without overwriting existing files');

    clickDevice('tools-alpha', fixture.state.pluginPages[remote.id].popup);
    await waitFor(() => windows().includes('设备面板'), 'device popup');
    fixture.state.pluginText += '\n<!-- changed in native browser -->';
    await ui.click('#refresh-button');
    await waitFor(() => !windows().includes('tools-alpha') && !windows().includes('设备面板'), 'external revision closes stale views');
    checks.push('device panel popup works; external plugin revisions invalidate old settings and popup windows');

    installed = await ui.api('featureRead', 'plugins-installed'); const legacyPlugin = installed.items.find(i => i.name === 'legacy-beta.txt');
    await ui.api('openPluginSettings', { id: legacyPlugin.id, revision: installed.revision });
    await waitFor(() => Object.values(fixture.state.pluginPages).some(p => p.pathname === '/'), 'legacy plugin native page');
    await ui.api('connect', { name: 'second fixture', address: other.address, password: 'fixture-password' });
    await waitFor(() => !windows().includes('legacy-beta'), 'device switch closes old view'); await ui.api('disconnect');
    checks.push('plugins without declarations retain a native page fallback; changing devices destroys previous settings');
    const errors = await ui.run('window.__uiErrors'); assert.deepEqual(errors, []);
    const result = { result: 'passed', version: require('../package.json').version, nativeWebKit: true, checks, fixtureWrites: fixture.writes.length, realDeviceWrites: false, errors };
    fs.writeFileSync(path.join(__dirname, '../artifacts/tauri-plugin-validation.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } catch (error) {
    if (ui) { execFileSync('xwd',['-root','-silent','-out',path.join(__dirname,'../artifacts/tauri-plugin-failure.xwd')]); console.error(ui.diagnostics.slice(-1800)); console.error('Device fixture:', fixture.state.pluginPages, fixture.state.remoteIsolation); console.error('Native windows:', windows().slice(0,2000)); console.error('Plugin UI state:', await ui.run('({title:document.title,toast:document.getElementById("toast")?.textContent,text:document.body.innerText.slice(0,1000),errors:window.__uiErrors})').catch(() => null)); }
    throw error;
  } finally { await ui?.close(); fixture.close(); other.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
