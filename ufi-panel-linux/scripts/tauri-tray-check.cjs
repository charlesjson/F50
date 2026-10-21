'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { startFixture } = require('./fixture-server.cjs');
const { launch } = require('./tauri-webdriver.cjs');
const fields = ['cpu', 'memory', 'temperature', 'daily', 'monthly', 'download', 'upload', 'clients'];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (exe, args) => execFileSync(exe, args, { encoding: 'utf8', env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } }).trim();
const mapped = id => command('xwininfo', ['-id', id]).includes('Map State: IsViewable');
async function until(predicate, message, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await predicate()) return; await delay(100); }
  throw new Error('Tray wait expired: ' + message);
}

(async () => {
  const fixture = await startFixture(), checks = [], layouts = []; let ui, other;
  const values = () => ui.run(`return Object.fromEntries(arguments[0].map(name=>{const n=document.getElementById('sidebar-'+name);return [name,[n.querySelector('.sidebar-number').textContent,n.querySelector('.sidebar-unit').textContent]]}));`, [fields]);
  try {
    fixture.state.nullRate = false;
    ui = await launch(); await ui.wait('document.readyState === "complete" && !!window.ufi');
    const mainHandle = await ui.call('GET', ui.endpoint('/window'));
    const mainId = command('xdotool', ['search', '--name', '^UFI Panel Linux$']).split('\n').at(-1);
    const names = command('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.ListNames']);
    const service = names.match(/org\.kde\.StatusNotifierItem-\d+-\d+/)?.[0];
    assert.ok(service, 'native StatusNotifierItem is registered');
    const dbus = (method, ...args) => command('gdbus', ['call', '--session', '--dest', service, '--object-path', '/StatusNotifierItem', '--method', method, ...args]);
    const activate = (x = '1260', y = '1000') => dbus('org.kde.StatusNotifierItem.Activate', x, y);
    const menu = command('gdbus', ['call', '--session', '--dest', service, '--object-path', '/MenuBar', '--method', 'com.canonical.dbusmenu.GetLayout', '--', '0', '-1', '[]']);
    for (const label of ['显示管理台', '完整 UFI 面板', '退出']) assert.ok(menu.includes(label), label);
    assert.ok(dbus('org.freedesktop.DBus.Properties.Get', 'org.kde.StatusNotifierItem', 'ItemIsMenu').includes('false'));
    checks.push('Linux StatusNotifierItem registers a left-click Activate handler and exports the original three-item right-click menu');

    await ui.select('#poll-interval', '0'); await ui.click('#welcome-connect');
    await ui.fill('#profile-name', 'F50 托盘'); await ui.fill('#address', fixture.address); await ui.fill('#password', 'fixture-password'); await ui.click('#submit-connection');
    await ui.wait('!document.getElementById("connection-dialog").open && document.querySelector("#sidebar-cpu .sidebar-number").textContent === "12.8"');
    const sidebar = await values();
    await ui.api('hideWindow'); assert.equal(mapped(mainId), false);
    const before = [fixture.state.reads, fixture.state.networkReads, fixture.state.connectionReads, fixture.state.clients];
    activate();
    await until(() => command('xwininfo', ['-root', '-tree']).includes('UFI · 设备状态'), 'popup creation');
    const popupId = command('xwininfo', ['-root', '-tree']).match(/(0x[0-9a-f]+) "UFI · 设备状态"/)[1];
    await until(() => mapped(popupId), 'popup mapped');
    assert.equal(mapped(mainId), false, 'left click leaves management window hidden');
    const handles = await ui.call('GET', ui.endpoint('/window/handles'));
    const popupHandle = handles.find(h => h !== mainHandle); assert.ok(popupHandle);
    await ui.call('POST', ui.endpoint('/window'), { handle: popupHandle });
    await ui.wait('typeof window.__ufiTrayStatusUpdate === "function" && document.querySelector("#sidebar-cpu .sidebar-number").textContent === "12.8"');
    assert.deepEqual(await values(), sidebar);
    assert.equal(await ui.run('document.getElementById("sidebar-telemetry").dataset.state'), 'paused');
    assert.equal(await ui.run('document.getElementById("tray-device").textContent'), 'F50 托盘');
    assert.equal(await ui.run('typeof window.ufi'), 'undefined');
    const denied = await ui.asyncRun('const done=arguments[arguments.length-1];window.__TAURI__.core.invoke("dispatch",{action:"profiles"}).then(()=>done(false),error=>done(String(error)));');
    assert.match(denied, /不允许/);
    assert.deepEqual([fixture.state.reads, fixture.state.networkReads, fixture.state.connectionReads, fixture.state.clients], before);
    checks.push('tray left click opens the small independent window, shows exactly the eight sidebar readings without restoring main or reading the device, and cannot access the backend bridge');

    const properties = command('xprop', ['-id', popupId, '_NET_WM_STATE', '_MOTIF_WM_HINTS', 'WM_NORMAL_HINTS']);
    assert.ok(properties.includes('_NET_WM_STATE_ABOVE') && properties.includes('_NET_WM_STATE_SKIP_TASKBAR'));
    await ui.wait('innerWidth === 276 && innerHeight === 408');
    const dimensions = await ui.run('({width:innerWidth,height:innerHeight})');
    assert.deepEqual(dimensions, { width: 276, height: 408 });
    const frame = await ui.call('GET', ui.endpoint('/window/rect'));
    assert.equal(frame.x, 1004); assert.equal(frame.y, 586, 'first show uses the full popup height and leaves a gap above the tray');
    await ui.run('window.__trayErrors=[];addEventListener("error",e=>__trayErrors.push(e.message));addEventListener("unhandledrejection",e=>__trayErrors.push(String(e.reason)));');
    for (const theme of ['light', 'dark']) {
      await ui.run('localStorage.setItem("theme",arguments[0]);window.__ufiTrayStatusUpdate(window.__ufiTrayStatus);', [theme]);
      const layout = await ui.run(`const rows=[...document.querySelectorAll('.sidebar-readings>div')].map(row=>{const label=row.querySelector('dt'),number=row.querySelector('.sidebar-number'),unit=row.querySelector('.sidebar-unit'),a=label.getBoundingClientRect(),b=number.getBoundingClientRect(),c=unit.getBoundingClientRect();return {top:a.top,label:a.left,number:b.right,unit:c.left,fits:[label,number,unit].every(n=>n.scrollWidth<=n.clientWidth+1)}});const button=document.getElementById('tray-show-main').getBoundingClientRect();return {rows,bottom:button.bottom,last:document.getElementById('sidebar-updated').getBoundingClientRect().bottom,height:innerHeight,theme:document.documentElement.dataset.theme};`);
      assert.equal(layout.theme, theme); assert.equal(layout.rows.length, 8); assert.ok(layout.bottom <= layout.height && layout.last < layout.bottom - 10);
      for (let i = 0; i < layout.rows.length; i++) {
        const row = layout.rows[i], first = layout.rows[0];
        assert.ok(row.fits && Math.abs(row.label-first.label)<1 && Math.abs(row.number-first.number)<1 && Math.abs(row.unit-first.unit)<1);
        assert.ok(!i || row.top > layout.rows[i - 1].top + 15);
      }
      layouts.push({ theme, width: dimensions.width, height: dimensions.height, alignedRows: 8 });
      command('xwd', ['-id', popupId, '-silent', '-out', path.join(__dirname, '../artifacts/tray-' + theme + '.xwd')]);
    }
    checks.push('popup is frameless, fixed size, above other windows and absent from the taskbar; all eight rows align labels, numbers and units without clipping in light/dark themes');

    const drag = await ui.run('const r=document.getElementById("tray-drag").getBoundingClientRect();return {x:Math.round(r.x+35),y:Math.round(r.y+12),cursor:getComputedStyle(document.getElementById("tray-drag")).cursor};');
    assert.equal(drag.cursor, 'grab');
    command('xdotool', ['mousemove', '--window', popupId, String(drag.x), String(drag.y), 'mousedown', '1']);
    await delay(200);
    command('xdotool', ['mousemove', '--sync', String(frame.x+drag.x-160), String(frame.y+drag.y-80)]);
    await delay(150); command('xdotool', ['mouseup', '1']);
    await until(async () => { const moved=await ui.call('GET',ui.endpoint('/window/rect'));return moved.x<frame.x-100&&moved.y<frame.y-40; }, 'dragging the header moves the native window');
    assert.equal(mapped(popupId), true); assert.deepEqual(await values(), sidebar);
    checks.push('holding the left button on the status header moves the native window without dismissing it or changing its readings');

    other = spawn('xmessage', ['-title', 'Other application', '-geometry', '180x100+40+80', 'Click this other window'], { stdio: 'ignore' });
    await until(() => { try { return !!command('xdotool', ['search', '--name', '^Other application$']); } catch { return false; } }, 'other application');
    const otherId = command('xdotool', ['search', '--name', '^Other application$']).split('\n').at(-1);
    // Creating another window also loses focus; reopen before testing pointer motion.
    activate(); await until(() => mapped(popupId), 'reopened popup');
    command('xdotool', ['mousemove', '--window', otherId, '30', '35']); await delay(350); assert.equal(mapped(popupId), true);
    command('xdotool', ['mousemove', '--window', popupId, '40', '18', 'click', '1']); await delay(250); assert.equal(mapped(popupId), true);
    command('xdotool', ['mousemove', '--window', otherId, '30', '35', 'click', '1']);
    await until(() => !mapped(popupId), 'hide after an actual click in another application');
    activate(); await until(() => mapped(popupId), 'reopen after blur');
    await until(() => BigInt(command('xdotool', ['getactivewindow'])) === BigInt(popupId), 'popup receives keyboard focus');
    await delay(150);
    command('xdotool', ['key', 'Escape']); await until(() => !mapped(popupId), 'Escape hides popup');
    checks.push('moving the pointer away or clicking inside keeps the popup visible; clicking another application hides it; another tray click reopens it and Escape hides it');

    await ui.call('POST', ui.endpoint('/window'), { handle: mainHandle });
    fixture.state.baseOverrides = { cpu_usage: 0, mem_usage: 0, cpu_temp: 0, daily_data: 0, monthly_data: 0 };
    fixture.state.networkOverrides = { wifi_access_sta_num: 0, realtime_rx_thrpt: 0, realtime_tx_thrpt: 0 };
    await ui.api('snapshot'); await ui.api('hideWindow'); activate();
    await ui.call('POST', ui.endpoint('/window'), { handle: popupHandle });
    await ui.wait('document.querySelector("#sidebar-cpu .sidebar-number").textContent === "0.0"');
    assert.deepEqual(await values(), { cpu: ['0.0', '%'], memory: ['0.0', '%'], temperature: ['0.0', '°C'], daily: ['0', 'B'], monthly: ['0', 'B'], download: ['0', 'B/s'], upload: ['0', 'B/s'], clients: ['0', '台'] });
    await ui.call('POST', ui.endpoint('/window'), { handle: mainHandle });
    fixture.state.baseOverrides = { cpu_usage: null, mem_usage: null, cpu_temp: null, daily_data: null, monthly_data: null };
    fixture.state.networkOverrides = { wifi_access_sta_num: null, realtime_rx_thrpt: null, realtime_tx_thrpt: null };
    await ui.api('snapshot'); await ui.api('hideWindow'); activate();
    await ui.call('POST', ui.endpoint('/window'), { handle: popupHandle });
    await ui.wait('document.querySelector("#sidebar-cpu .sidebar-number").textContent === "—"');
    for (const value of Object.values(await values())) assert.deepEqual(value, ['—', '']);

    await ui.call('POST', ui.endpoint('/window'), { handle: mainHandle });
    fixture.state.baseOverrides = {}; fixture.state.networkOverrides = {}; fixture.state.live = true;
    await ui.api('telemetryConfigure', 1000); await ui.api('snapshot'); await ui.api('hideWindow'); activate();
    await ui.call('POST', ui.endpoint('/window'), { handle: popupHandle });
    await ui.wait('document.getElementById("sidebar-telemetry").dataset.state === "live"');
    const cpu = (await values()).cpu[0], reads = fixture.state.reads;
    await ui.wait('document.querySelector("#sidebar-cpu .sidebar-number").textContent !== ' + JSON.stringify(cpu), 5000);
    assert.ok(fixture.state.reads > reads); assert.equal(mapped(popupId), true);
    const good = await values(); fixture.state.failBase = true;
    await ui.wait('document.getElementById("sidebar-telemetry").dataset.state === "stale"', 5000);
    assert.deepEqual(await values(), good);
    fixture.state.failBase = false;
    await ui.wait('document.getElementById("sidebar-telemetry").dataset.state === "live"', 7000);
    checks.push('valid zeros and absent values render correctly; shared one-second sampling updates an open popup, marks retained readings stale on failure and resumes after recovery');

    await ui.click('#tray-show-main'); await until(() => mapped(mainId) && !mapped(popupId), 'open management button');
    await ui.call('POST', ui.endpoint('/window'), { handle: mainHandle });
    await ui.api('telemetryConfigure', 0); await ui.api('disconnect'); await ui.api('hideWindow'); activate();
    await ui.call('POST', ui.endpoint('/window'), { handle: popupHandle });
    await ui.wait('document.getElementById("sidebar-telemetry").dataset.state === "offline"');
    for (const value of Object.values(await values())) assert.deepEqual(value, ['—', '']);
    assert.equal(await ui.run('document.getElementById("tray-device").textContent'), 'UFI Panel');
    assert.deepEqual(await ui.run('window.__trayErrors'), []);
    checks.push('opening the management console hides the popup and restores main; disconnect clears cached readings and device name on the next tray open');
    command('gdbus', ['call', '--session', '--dest', service, '--object-path', '/MenuBar', '--method', 'com.canonical.dbusmenu.Event', '1', 'clicked', '<0>', '0']);
    await until(() => mapped(mainId) && !mapped(popupId), 'right-click menu restores main');
    checks.push('the native right-click menu action restores main and hides the popup');
    assert.equal(fixture.writes.length, 0);
    const report = { result: 'passed', version: require('../package.json').version, nativeWebKit: true, nativeSNI: true, checks, layouts, fixtureWrites: 0 };
    fs.writeFileSync(path.join(__dirname, '../artifacts/tray-validation.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(ui?.diagnostics.slice(-5000)); console.error(command('xwininfo', ['-root', '-tree']).split('\n').filter(line=>line.includes('UFI')||line.includes('Other application')).join('\n')); throw error;
  } finally { other?.kill(); await ui?.close(); fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
