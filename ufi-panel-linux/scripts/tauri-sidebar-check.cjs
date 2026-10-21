'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startFixture } = require('./fixture-server.cjs');
const { launch } = require('./tauri-webdriver.cjs');
const fields = ['cpu', 'memory', 'temperature', 'daily', 'monthly', 'download', 'upload', 'clients'];

(async () => {
  const fixture = await startFixture(), other = await startFixture(), checks = [], layouts = []; let ui;
  fixture.state.nullRate = false;
  const values = () => ui.run(`return Object.fromEntries(arguments[0].map(name=>{const node=document.getElementById('sidebar-'+name);return [name,[node.querySelector('.sidebar-number').textContent,node.querySelector('.sidebar-unit').textContent]]}));`, [fields]);
  const connect = async (address, name = 'F50') => {
    await ui.fill('#profile-name', name); await ui.fill('#address', address); await ui.fill('#password', 'fixture-password'); await ui.click('#submit-connection');
    await ui.wait('!document.getElementById("connection-dialog").open');
  };
  try {
    ui = await launch(); await ui.wait('document.readyState==="complete" && !!window.ufi');
    await ui.run('window.__sidebarErrors=[];addEventListener("error",event=>__sidebarErrors.push(event.message));addEventListener("unhandledrejection",event=>__sidebarErrors.push(String(event.reason)))');
    assert.equal(await ui.run('document.getElementById("sidebar-version").textContent'), 'Tauri · ' + require('../package.json').version);
    assert.equal(await ui.run('document.getElementById("sidebar-telemetry").dataset.state'), 'offline');
    for (const [key, value] of Object.entries(await values())) assert.deepEqual(value, ['—', ''], key);
    await ui.select('#poll-interval', '0'); await ui.click('#welcome-connect'); await connect(fixture.address);
    await ui.wait('document.querySelector("#sidebar-cpu .sidebar-number").textContent==="12.8" && document.querySelector("#sidebar-clients .sidebar-number").textContent==="2"');
    assert.deepEqual(await values(), { cpu: ['12.8', '%'], memory: ['61.0', '%'], temperature: ['52.1', '°C'], daily: ['2.79', 'GB'], monthly: ['22.35', 'GB'], download: ['488.28', 'KB/s'], upload: ['195.31', 'KB/s'], clients: ['2', '台'] });
    assert.equal(await ui.run('document.getElementById("sidebar-telemetry").dataset.state'), 'paused');
    checks.push('sidebar shows CPU, memory, temperature, daily/monthly usage, both rates and the device Wi-Fi count; disconnected readings stay absent and the displayed app version matches the package');

    await ui.api('snapshot');
    const before = { base: fixture.state.reads, network: fixture.state.networkReads, connections: fixture.state.connectionReads, clients: fixture.state.clients };
    fixture.state.baseOverrides = { cpu_usage: 64.8, mem_usage: 73.2, cpu_temp: 56100, daily_data: 4 * 1024 ** 3, monthly_data: 28 * 1024 ** 3 };
    fixture.state.networkOverrides = { wifi_access_sta_num: 4 };
    await ui.api('snapshot'); await ui.wait('document.querySelector("#sidebar-cpu .sidebar-number").textContent==="64.8"');
    assert.deepEqual({ base: fixture.state.reads - before.base, network: fixture.state.networkReads - before.network, connections: fixture.state.connectionReads - before.connections, clients: fixture.state.clients - before.clients }, { base: 1, network: 1, connections: 1, clients: 0 });
    assert.deepEqual((await values()).monthly, ['28.00', 'GB']);
    checks.push('sidebar consumes the existing snapshot: exactly one base/network/connection read and no terminal-list request per manual sample');

    fixture.state.baseOverrides = { cpu_usage: 0, mem_usage: 0, cpu_temp: 0, daily_data: 0, monthly_data: 0 };
    fixture.state.networkOverrides = { wifi_access_sta_num: 0, realtime_rx_thrpt: 0, realtime_tx_thrpt: 0 };
    await ui.api('snapshot'); await ui.wait('document.querySelector("#sidebar-cpu .sidebar-number").textContent==="0.0"');
    assert.deepEqual(await values(), { cpu: ['0.0', '%'], memory: ['0.0', '%'], temperature: ['0.0', '°C'], daily: ['0', 'B'], monthly: ['0', 'B'], download: ['0', 'B/s'], upload: ['0', 'B/s'], clients: ['0', '台'] });
    fixture.state.baseOverrides = { cpu_usage: null, mem_usage: null, cpu_temp: null, daily_data: null, monthly_data: null };
    fixture.state.networkOverrides = { wifi_access_sta_num: null, realtime_rx_thrpt: null, realtime_tx_thrpt: null };
    await ui.api('snapshot'); await ui.wait('document.querySelector("#sidebar-cpu .sidebar-number").textContent==="—"');
    for (const [key, value] of Object.entries(await values())) assert.deepEqual(value, ['—', ''], key);
    checks.push('valid zero readings remain zero; missing CPU, memory, temperature, usage, rates and count clear previous values');

    fixture.state.baseOverrides = { cpu_usage: 24.7 }; fixture.state.networkOverrides = {};
    await ui.api('snapshot'); await ui.wait('document.querySelector("#sidebar-cpu .sidebar-number").textContent==="24.7"');
    const good = await values(); fixture.state.failBase = true;
    await assert.rejects(ui.api('snapshot'));
    await ui.wait('document.getElementById("sidebar-telemetry").dataset.state==="stale"');
    assert.deepEqual(await values(), good);
    assert.ok((await ui.run('document.getElementById("sidebar-updated").textContent')).startsWith('上次成功'));
    fixture.state.failBase = false; await ui.api('snapshot');
    await ui.wait('document.getElementById("sidebar-telemetry").dataset.state==="paused"');
    checks.push('failed reads mark retained values stale and show the last successful update; recovery restores the paused/live state');

    const point = await ui.run('const canvas=document.getElementById("cpu-chart");canvas.scrollIntoView({block:"center"});const b=canvas.getBoundingClientRect();return {x:Math.round(b.x+b.width*.65),y:Math.round(b.y+b.height/2)};');
    await ui.call('POST', ui.endpoint('/actions'), { actions: [{ type: 'pointer', id: 'sidebar-hover', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', duration: 30, origin: 'viewport', x: point.x, y: point.y }] }] });
    await ui.wait('document.getElementById("cpu-chart").closest(".card").classList.contains("chart-frozen")');
    const held = await ui.run('document.getElementById("cpu-trend-current").textContent');
    fixture.state.baseOverrides.cpu_usage = 72.6; await ui.api('snapshot');
    await ui.wait('document.querySelector("#sidebar-cpu .sidebar-number").textContent==="72.6"');
    assert.equal(await ui.run('document.getElementById("cpu-trend-current").textContent'), held);
    await ui.call('POST', ui.endpoint('/actions'), { actions: [{ type: 'pointer', id: 'sidebar-hover', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', duration: 30, origin: 'viewport', x: 250, y: 90 }] }] });
    checks.push('sidebar continues showing the newest CPU reading while the hovered overview chart and its summary stay fixed');

    fixture.state.live = true; delete fixture.state.baseOverrides.cpu_usage;
    await ui.select('#poll-interval', '1000'); await ui.navigate('preferences');
    const reads = fixture.state.reads;
    await ui.wait('document.getElementById("sidebar-telemetry").dataset.state==="live" && document.querySelector("#sidebar-cpu .sidebar-number").textContent!=="72.6"', 7000);
    assert.ok(fixture.state.reads > reads);
    await ui.click('#sidebar-clients-button'); await ui.wait('document.getElementById("page-title").textContent==="连接终端"');
    checks.push('scheduled telemetry updates the sidebar on other pages; clicking the count opens connected terminals');
    await ui.navigate('overview');

    for (const [width, height] of [[1240, 800], [900, 650]]) {
      await ui.call('POST', ui.endpoint('/window/rect'), { width, height });
      for (const theme of ['light', 'dark']) {
        await ui.run('document.documentElement.dataset.theme=arguments[0];', [theme]);
        const layout = await ui.run(`const root=document.getElementById('sidebar-telemetry'),box=root.getBoundingClientRect();
          const rows=[...root.querySelectorAll('.sidebar-readings>div'),root.querySelector('.sidebar-clients')].map(row=>{
            const label=row.firstElementChild,num=row.querySelector('.sidebar-number'),unit=row.querySelector('.sidebar-unit');
            const a=label.getBoundingClientRect(),b=num.getBoundingClientRect(),c=unit.getBoundingClientRect();
            return {top:row.getBoundingClientRect().top,labelLeft:a.left,labelRight:a.right,numberRight:b.right,unitLeft:c.left,
              labelFits:label.scrollWidth<=label.clientWidth+1,numberFits:num.scrollWidth<=num.clientWidth+1,unitFits:unit.scrollWidth<=unit.clientWidth+1};
          });return {width:innerWidth,height:innerHeight,top:box.top,bottom:box.bottom,deviceTop:document.querySelector('.device-mini').getBoundingClientRect().top,rows};`);
        assert.equal(layout.rows.length, 8); assert.ok(layout.top >= 0 && layout.bottom <= layout.height && layout.bottom <= layout.deviceTop);
        for (let i = 0; i < layout.rows.length; i++) {
          const row = layout.rows[i], first = layout.rows[0];
          assert.ok(!i || row.top > layout.rows[i - 1].top + 10, 'one metric per row');
          assert.ok(Math.abs(row.labelLeft - first.labelLeft) < 1 && Math.abs(row.numberRight - first.numberRight) < 1 && Math.abs(row.unitLeft - first.unitLeft) < 1, JSON.stringify(row));
          assert.ok(row.labelFits && row.numberFits && row.unitFits && row.labelRight <= row.numberRight, 'no clipped readings');
        }
        layouts.push({ width: layout.width, height: layout.height, theme, rows: 8, aligned: true });
        ui.screenshot(`sidebar-${width}-${theme}`);
      }
    }
    checks.push('light/dark themes at normal and small window sizes keep all eight metrics on separate rows, labels/numbers/units in aligned columns, and device information visible');

    await ui.select('#poll-interval', '0'); await ui.click('#edit-connection');
    other.state.baseOverrides = { cpu_usage: 7, mem_usage: 20, cpu_temp: 32000, daily_data: 1024, monthly_data: 1024 ** 3 };
    await connect(other.address, '第二台设备');
    await ui.wait('document.querySelector("#sidebar-cpu .sidebar-number").textContent==="7.0" && document.querySelector("#sidebar-monthly .sidebar-number").textContent==="1.00"');
    await ui.click('#edit-connection'); await ui.click('#disconnect-button');
    await ui.wait('document.getElementById("sidebar-telemetry").dataset.state==="offline"');
    for (const [key, value] of Object.entries(await values())) assert.deepEqual(value, ['—', ''], key);
    assert.equal(await ui.run('document.getElementById("sidebar-clients-button").disabled'), true);
    checks.push('switching devices replaces all old readings; disconnect clears values and disables the terminal shortcut');
    assert.deepEqual(await ui.run('window.__sidebarErrors'), []); assert.equal(fixture.writes.length + other.writes.length, 0);
    const report = { result: 'passed', version: require('../package.json').version, nativeWebKit: true, checks, layouts, realDeviceWrites: 0 };
    fs.writeFileSync(path.join(__dirname, '../artifacts/sidebar-validation.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  } catch (error) {
    console.error(ui?.diagnostics.slice(-2000)); console.error(await ui?.run('({sidebar:document.getElementById("sidebar-telemetry").outerHTML,errors:window.__sidebarErrors})').catch(() => null)); throw error;
  } finally { await ui?.close(); fixture.close(); other.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
