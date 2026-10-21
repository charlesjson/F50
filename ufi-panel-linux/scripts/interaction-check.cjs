'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { navigate, confirmOperation } = require('./ui-helpers.cjs');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashPassword } = require('../src/core/protocol.cjs');

async function run() {
  const state = { smsDelayMs: 0, smsMixed: false, smsReads: 0, reads: 0, live: false, clients: 0, failClients: false, failSms: false, failBase: false, slow: false, pending: null, label: '工作电脑', nullRate: true };
  const output = path.join(__dirname, '../artifacts'); fs.mkdirSync(output, { recursive: true });
  const writes = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture'), cmd = url.searchParams.get('cmd');
    const json = data => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); };
    const fail = () => { res.statusCode = 503; json({ error: '模拟设备暂时不可用' }); };
    if (url.pathname === '/api/version_info') {
      if (state.slow) { state.pending = () => json({ model: 'F50', app_ver: '4.1.5' }); return; }
      return json({ model: 'F50', app_ver: '4.1.5' });
    }
    if (req.headers.authorization !== hashPassword('fixture-password')) { res.statusCode = 401; return json({}); }
    if (url.pathname === '/api/speedtest') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); const timer = setInterval(() => res.write(Buffer.alloc(4096)), 5); res.on('close', () => clearInterval(timer)); return; }
    if (url.pathname === '/api/get_theme') return json({ backgroundEnabled: 'false', backgroundUrl: '', textColor: 'rgba(255,255,255,1)', textColorPer: '100', themeColor: '201', colorPer: '67', saturationPer: '100', brightPer: '21', opacityPer: '21', blurSwitch: 'true', overlaySwitch: 'true' });
    if (url.pathname === '/api/check_update') return json({ base_uri: 'https://updates.example.test/', alist_res: { code: 200, data: { content: [{ name: 'ufi-tools-4.1.5.apk', size: 12345 }] } }, changelog: 'Fixture update' });
    if (url.pathname === '/api/download_apk_status') return json({ status: 'done', percent: 100 });
    if (url.pathname === '/api/need_token') return json({ need_token: true });
    if (url.pathname === '/api/is_weak_token') return json({ is_weak: false });
    if (url.pathname === '/api/get_res_server') return json({ res_server: 'https://updates.example.test' });
    if (url.pathname === '/api/sms_forward_mail') return json({ smtp_host: '', smtp_port: '465', smtp_username: '', smtp_to: '' });
    if (url.pathname.startsWith('/api/proxy/')) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('<script>untrusted response</script>'); return; }
    if (req.method === 'POST') { let body = ''; for await (const chunk of req) body += chunk; writes.push({ path: url.pathname, body: req.headers['content-type']?.includes('json') ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body)) }); return json({ result: 'success' }); }
    if (url.pathname === '/api/baseDeviceInfo') {
      state.reads++;
      if (state.failBase) return fail();
      return json({ cpu_temp: state.live ? 51000 + state.reads * 10 : 52100, cpu_usage: state.live ? state.reads % 100 : 12.8, mem_usage: 61, memInfo: { mem_used_kb: 900000, mem_total_kb: 1500000 }, daily_data: 3e9, monthly_data: 24e9, internal_used_storage: 2e9, internal_total_storage: 24e9, cpu_temp_list: [{ type: 'CPU', temp: 52100 }, { type: 'Modem', temp: 48000 }] });
    }
    if (url.pathname === '/api/connInfo') return json({});
    if (url.pathname === '/api/get_cookie') return json({ cookie: 'stok=fixture' });
    if (cmd === 'RD') return json({ RD: 'fixture-rd' });
    if (cmd === 'cr_version,wa_inner_version') return json({ cr_version: 'B09', wa_inner_version: 'web' });
    if (cmd?.includes('net_select')) return json({ net_select: 'WL_AND_5G', sim_slot: '1', roam_setting_option: 'off', ppp_status: 'ppp_connected' });
    if (cmd?.includes('queryAccessPointInfo')) return json({ WiFiModuleSwitch: '1', ResponseList: [{ ChipIndex: '0', AccessPointIndex: '0', SSID: 'Fixture Wi-Fi', Password: 'ZmFrZQ==', AuthMode: 'WPA2PSK', ApMaxStationNumber: 10, ApBroadcastDisabled: '0', ApIsolate: '0' }] });
    if (cmd?.includes('APN_config')) return json({ apn_mode: 'auto', profile_name: 'Carrier', APN_config0: 'Carrier($)internet($)manual($)*99#($)none($)($)($)IPv4v6' });
    if (cmd?.includes('lte_band_lock')) return json({ lte_band_lock: '', nr_band_lock: '', network_type: '5G', neighbor_cell_info: [{ band: 78, pci: 100, earfcn: 633984, rsrp: -90 }, { rat:'LTE',band:3,pci:12,earfcn:1650,rsrp:-95 }, {rat:'NR',band:78,pci:3,earfcn:'',rsrp:-110}], locked_cell_info: [] });
    if (cmd?.includes('lan_netmask')) return json({ lan_ipaddr: '192.168.0.1', lan_netmask: '255.255.255.0', dhcpEnabled: '1', dhcpStart: '192.168.0.100', dhcpEnd: '192.168.0.200', dhcpLease_hour: '24' });
    if (cmd?.includes('performance_mode')) return json({ usb_port_switch: '0', performance_mode: '0', samba_switch: '1', indicator_light_switch: '1' });
    if (url.pathname === '/api/get_custom_head') return json({ text: '<script>existingPlugin()</script>' });
    if (url.pathname === '/api/list_tasks') return json({ tasks: [] });
    if (url.pathname === '/api/cellularUsage') return json({ usage: [{ date: '2026-10-15', usage: '1024' }] });
    if (url.pathname === '/api/get_data_limit') return json({ data_flow_limit_enabled: '0', data_flow_max_limit: -1, data_flow_check_daily_or_monthly: 'monthly', data_check_reference: 'android', data_limit_status_forward_enabled: '0' });
    if (url.pathname === '/api/getSupportNrBandList') return json({ result: '41,78' });
    if (url.pathname === '/api/usb_status') return json({ maxSpeed: '480M', details: 'USB device' });
    if (['/api/adb_wifi_setting', '/api/volte_status', '/api/vonr_status', '/api/sms_forward_enabled', '/api/power_status_forward_enabled'].includes(url.pathname)) return json({ enabled: '0' });
    if (url.pathname === '/api/get_log_status') return json({ debug_log_enabled: false });
    if (url.pathname === '/api/sms_forward_method') return json({ sms_forward_method: '' });
    if (url.pathname === '/api/sms_forward_blacklist') return json({ phone: '', keywords: '' });
    if (cmd === 'loginfo') return json({ loginfo: 'ok' });
    if (cmd?.includes('network_type')) return json({ ppp_status: 'ppp_disconnected', network_type: '5G', network_provider: '测试运营商', cr_version: 'B09', wifi_access_sta_num: '2', sms_unread_num: '1', realtime_rx_thrpt: state.nullRate ? '' : 5e5, realtime_tx_thrpt: state.nullRate ? '' : 2e5, Z5g_rsrp: '-85' });
    if (cmd?.includes('station_list')) {
      state.clients++;
      if (state.failClients) return fail();
      return json({ station_list: [{ hostname: state.label, ip_addr: '192.168.0.3', mac_addr: '00:11:22:33:44:55' }], lan_station_list: [{ hostname: '有线终端', ip_addr: '192.168.0.12', mac_addr: '00:11:22:33:44:66' }] });
    }
    if (cmd === 'sms_data_total') {
      state.smsReads++;
      if (state.smsDelayMs) await new Promise(resolve => setTimeout(resolve, state.smsDelayMs));
      const page = Number(url.searchParams.get('page'));
      if (state.smsMixed) return json({messages:[
        {id:'401',number:'10000',tag:'1',text:'',content:Buffer.from('收到的未读短信').toString('base64')},
        {id:'402',number:'10001',tag:'0',content:Buffer.from('收到的已读短信').toString('base64')},
        {id:'403',number:'+447700900123',tag:'2',content:Buffer.from('发出的短信').toString('base64')},
        {id:'404',number:'10002',tag:'3',content:Buffer.from('其他发出记录').toString('base64')},
        {id:'405',number:'10003',tag:'4',content:Buffer.from('设备草稿').toString('base64')},
        {id:'406',number:'10004',tag:'99',content:Buffer.from('未知设备状态').toString('base64')},
      ]});
      if (state.failSms && page === 1) return fail();
      return json({ messages: Array.from({ length: page === 0 ? 50 : 1 }, (_, i) => ({ number: '10000', tag: i === 0 ? '1' : '0', date: '26,10,15,9,4,2,+32', content: Buffer.from(page ? '第二页短信' : `测试通知 ${i + 1}`).toString('base64') })) });
    }
    if (url.pathname === '/api/plugins_store') return json({ res: { data: { content: [{ name: 'Mosdns.js', size: 2048, modified: '2026-10-15T01:00:00Z' }, { name: 'Network.js', size: 4096, modified: '2026-10-14T01:00:00Z' }] } } });
    res.statusCode = 404; json({ error: 'Unexpected fixture request' });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = `http://127.0.0.1:${server.address().port}`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ufi-interaction-'));
  const env = { ...process.env, UFI_TEST_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const args = process.env.UFI_EXECUTABLE ? [] : [path.join(__dirname, '..')];
  if (process.env.UFI_TEST_NO_SANDBOX === '1') args.unshift('--no-sandbox');
  let instance;
  const errors = [], checks = [];
  try {
    instance = await electron.launch({ args, env, ...(process.env.UFI_EXECUTABLE ? { executablePath: process.env.UFI_EXECUTABLE } : {}), timeout: 30000 });
    const page = await instance.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    const visible = selector => page.locator(selector).first().waitFor({ state: 'visible' });
    const textIs = (id, value) => page.waitForFunction(({ id, value }) => document.getElementById(id).textContent === value, { id, value });
    await visible('#welcome'); assert.equal(await page.locator('#refresh-button').isDisabled(), true);
    await page.selectOption('#poll-interval', '0');
    await page.click('#welcome-connect'); await page.fill('#address', address); await page.fill('#password', 'fixture-password');
    await page.click('[data-toggle-password="password"]'); assert.equal(await page.locator('#password').getAttribute('type'), 'text');
    await page.click('#submit-connection'); await textIs('temperature', '52.1');
    await page.waitForFunction(() => document.getElementById('cellular-status').textContent === '未连接');
    assert.equal(await page.locator('#download-speed').textContent(), '—'); await visible('#chart-placeholder');
    checks.push('missing values and disconnected cellular state');
    await navigate(page, 'clients'); await visible('#clients-content table');
    await page.fill('#client-search', '192.168.0.3'); assert.equal(await page.locator('#clients-content tbody tr').count(), 1);
    await page.click('.copy-address'); assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), '192.168.0.3');
    await page.fill('#client-search', ''); await page.selectOption('#client-type', '有线'); assert.equal(await page.locator('#clients-content tbody tr').count(), 1);
    await page.selectOption('#client-type', '');
    state.label = '重命名终端'; await page.click('#refresh-button'); await page.getByRole('cell', { name: '重命名终端', exact: true }).waitFor();
    state.failClients = true; await page.click('#refresh-button'); await visible('#clients-status button');
    assert.ok((await page.locator('#clients-content').textContent()).includes('重命名终端'));
    state.failClients = false; await page.click('#clients-status button'); await page.locator('#clients-status').waitFor({ state: 'hidden' });
    checks.push('contextual refresh, retained list, retry, filtering, clipboard');
    await page.screenshot({ path: path.join(output, 'clients-fixture.png') });
    await navigate(page, 'sms'); await visible('.sms-item'); assert.equal(await page.locator('.sms-item').count(), 50);
    await page.check('#sms-unread'); assert.equal(await page.locator('.sms-item').count(), 1); await page.uncheck('#sms-unread');
    state.failSms = true; await page.click('#sms-next'); await visible('#sms-status button'); await textIs('sms-page', '第 1 页');
    assert.equal(await page.locator('.sms-item').count(), 50);
    state.failSms = false; await page.click('#sms-status button'); await textIs('sms-page', '第 2 页');
    assert.equal(await page.locator('.sms-item').count(), 1); assert.equal(await page.locator('#sms-next').isDisabled(), true);
    await page.locator('.sms-item').getByRole('button', { name: '复制', exact: true }).click(); assert.equal(await instance.evaluate(({ clipboard }) => clipboard.readText()), '第二页短信');
    await page.screenshot({ path: path.join(output, 'sms-fixture.png') });
    checks.push('transactional SMS pagination, failed-page retry, unread and copy');
    state.smsMixed = true; await page.click('#refresh-button');
    await page.waitForFunction(() => document.querySelector('#sms-mailbox-note').textContent.includes('6 条'));
    await page.locator('[role=tab][data-sms-folder=sent]').click();
    await page.waitForFunction(() => document.querySelectorAll('.sms-item').length === 2 && [...document.querySelectorAll('.sms-item')].every(n=>n.dataset.smsFolder==='sent'));
    assert.equal(await page.locator('#sms-unread').isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'回复',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'标记已读',exact:true}).count(),0);
    await page.screenshot({path:path.join(output,'sms-sent-fixture.png'),fullPage:true});
    await page.locator('.sms-item').first().getByRole('button',{name:'再次发送',exact:true}).click();
    assert.equal(await page.inputValue('form[data-action="sms-send"] [name=number]'),'+447700900123');
    assert.equal(await page.inputValue('form[data-action="sms-send"] [name=content]'),'发出的短信');
    await page.click('#close-feature-dialog');
    await page.locator('[role=tab][data-sms-folder=draft]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.sms-item').length===1 && document.querySelector('.sms-item').dataset.smsFolder==='draft');
    await page.getByRole('button',{name:'继续编辑',exact:true}).click();
    assert.equal(await page.inputValue('form[data-action="sms-send"] [name=content]'),'设备草稿');await page.click('#close-feature-dialog');
    await page.locator('[role=tab][data-sms-folder=other]').click();await page.getByText('设备状态 99',{exact:true}).waitFor();
    await page.locator('[role=tab][data-sms-folder=all]').click();await page.waitForFunction(()=>document.querySelectorAll('.sms-item').length===6);
    await page.locator('[role=tab][data-sms-folder=inbox]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.sms-item').length===2 && [...document.querySelectorAll('.sms-item')].every(n=>n.dataset.smsFolder==='inbox'));
    await page.check('#sms-unread');assert.equal(await page.locator('.sms-item').count(),1);await page.uncheck('#sms-unread');
    await page.screenshot({path:path.join(output,'sms-inbox-fixture.png'),fullPage:true});
    const beforeSend=writes.length;
    assert.equal(writes.slice(0,beforeSend).some(w=>['SEND_SMS','SET_MSG_READ','DELETE_SMS'].includes(w.body?.goformId)),false,'switching folders and reviewing resend never sends or changes read state');
    state.smsDelayMs=400; await page.click('#refresh-button');
    await page.locator('#sms-content[aria-busy=true]').waitFor();
    await page.locator('[role=tab][data-sms-folder=sent]').click();
    await page.waitForFunction(()=>document.querySelector('#sms-content').getAttribute('aria-busy')==='false' && document.querySelectorAll('.sms-item').length===2 && [...document.querySelectorAll('.sms-item')].every(n=>n.dataset.smsFolder==='sent'));
    assert.equal(await page.locator('[role=tab][data-sms-folder=sent]').getAttribute('aria-selected'),'true');
    state.smsDelayMs=0;await page.locator('[role=tab][data-sms-folder=inbox]').click();
    await page.waitForFunction(()=>document.querySelector('#sms-content').getAttribute('aria-busy')==='false' && document.querySelectorAll('.sms-item').length===2 && [...document.querySelectorAll('.sms-item')].every(n=>n.dataset.smsFolder==='inbox'));
    checks.push('separate inbox/sent/draft/unknown, counts, direction-aware actions, resend draft and stale folder response');

    await navigate(page, 'plugins'); await visible('.plugin-card'); assert.equal(await page.locator('.plugin-card').count(), 2);
    await page.selectOption('#plugin-sort', 'size'); assert.equal(await page.locator('.plugin-card h3').first().textContent(), 'Network');
    await page.fill('#plugin-search', 'no-match'); await visible('#plugins-content .empty button'); await page.click('#plugins-content .empty button'); assert.equal(await page.locator('.plugin-card').count(), 2);
    checks.push('plugin auto-load, sorting, empty filter recovery');
    await page.click('#edit-connection'); await page.fill('#password', 'wrong-password'); await page.click('#submit-connection'); await visible('#connection-error:not(.hidden)');
    assert.ok((await page.locator('#connection-state').textContent()).includes('已连接'));
    await page.click('#cancel-connection'); await navigate(page, 'overview'); await page.click('#refresh-button'); await textIs('temperature', '52.1');
    await page.click('#edit-connection'); await page.click('#submit-connection'); await page.locator('#connection-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.inputValue('#password'), ''); assert.equal(await page.locator('#password').getAttribute('type'), 'password');
    checks.push('failed switch keeps connection; blank reconnect reuses session credentials');
    state.slow = true; await page.click('#edit-connection'); await page.click('#submit-connection');
    await page.waitForFunction(() => document.getElementById('submit-connection').textContent === '正在验证…');
    await page.click('#cancel-connection'); await page.locator('#connection-dialog').waitFor({ state: 'hidden' });
    state.slow = false; state.pending?.();
    await page.waitForFunction(() => !document.getElementById('submit-connection').disabled);
    await page.click('#refresh-button'); await textIs('temperature', '52.1'); checks.push('cancel pending connection retains live session');
    state.failBase = true; await page.click('#refresh-button'); await visible('#retry-snapshot');
    assert.ok((await page.locator('#connection-state').textContent()).includes('连接中断'));
    state.failBase = false; state.nullRate = false; await page.click('#retry-snapshot'); await page.locator('#notice').waitFor({ state: 'hidden' });
    await page.locator('#chart-placeholder').waitFor({ state: 'hidden' }); checks.push('stale status and recovery');
    await navigate(page, 'overview'); state.live = true;
    await page.selectOption('#poll-interval', '1000');
    const liveStart = state.reads;
    for (let i = 0; state.reads < liveStart + 3 && i < 30; i++) await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(state.reads >= liveStart + 3);
    assert.ok((await page.locator('#cpu-chart').getAttribute('aria-label')).includes('有效读数'));
    await page.evaluate(() => window.ufi.openMonitor());
    const liveMonitor = (await instance.windows()).find(p => p !== page);
    const backgroundStart = state.reads;
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).hide());
    await new Promise(resolve => setTimeout(resolve, 3200));
    assert.ok(state.reads >= backgroundStart + 2, 'main process keeps polling with the dashboard hidden');
    assert.match(await liveMonitor.locator('#monitor-data').textContent(), /CPU/);
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).show());
    await liveMonitor.close();
    state.failBase = true;
    await page.waitForFunction(() => document.getElementById('last-update').textContent.includes('数据已过期'));
    assert.equal(await page.locator('#view-overview.telemetry-stale').count(), 1);
    state.failBase = false;
    await page.waitForFunction(() => !document.getElementById('view-overview').classList.contains('telemetry-stale'));
    await page.selectOption('#chart-window', '60000');
    await page.screenshot({ path: path.join(output, 'telemetry-fixture.png'), fullPage: true });
    await page.selectOption('#poll-interval', '0');
    await new Promise(resolve => setTimeout(resolve, 200));
    const pausedReads = state.reads;
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(state.reads, pausedReads, 'paused collection makes no more requests');
    await page.click('#refresh-button');
    for (let i = 0; state.reads === pausedReads && i < 20; i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(state.reads > pausedReads, 'manual refresh still works while paused');
    state.live = false;
    checks.push('continuous telemetry, background collection, shared monitor, stale recovery, pause and manual refresh');

    await navigate(page, 'tools'); await textIs('page-title', '终端');
    await page.selectOption('#command-kind', 'at'); await page.selectOption('#command-preset', 'AT+CSQ'); assert.equal(await page.inputValue('#command'), 'AT+CSQ');
    await page.selectOption('#command-kind', 'user'); await page.selectOption('#command-preset', 'uptime'); assert.equal(await page.inputValue('#command'), 'uptime');
    await page.selectOption('#command-kind', 'at');
    await page.fill('#command-template-search', '短信中心');
    assert.equal(await page.locator('#command-preset option').count(), 2);
    await page.selectOption('#command-preset', 'AT+CSCA?');
    assert.equal(await page.inputValue('#command'), 'AT+CSCA?');
    assert.match(await page.locator('#command-template-hint').textContent(), /不是收件人/);
    assert.equal(writes.some(w => w.path === '/api/AT'), false);
    await page.screenshot({ path: path.join(output, 'at-templates.png'), fullPage: true });
    await page.fill('#command-template-search', '');
    assert.equal(await page.locator('#command-preset optgroup').count(), 4);
    await instance.evaluate(({ dialog }) => { dialog.showMessageBox = async (_window, options) => { globalThis.__commandPrompt = options; return { response: 0 }; }; });
    await page.selectOption('#command-slot', '1'); await page.click('#run-command');
    await page.waitForFunction(() => document.getElementById('command-status').textContent.includes('已取消'));
    const commandPrompt = await instance.evaluate(() => globalThis.__commandPrompt);
    assert.match(commandPrompt.detail, /SIM 卡槽：1/); assert.match(commandPrompt.detail, /AT\+CSCA\?/);
    assert.equal(await page.inputValue('#command'), 'AT+CSCA?');
    checks.push('keyboard navigation, searchable grouped AT templates, description and fill without execution');
    // All writes below target the local fixture server. Native confirmation is
    // replaced for job dialogs only in this fixture process; settings exercise the real review UI.
    await instance.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
    await navigate(page, 'network'); await visible('form[data-action="network-mode"]');
    await page.selectOption('form[data-action="network-mode"] select', 'Only_LTE');
    await page.locator('form[data-action="network-mode"]').getByRole('button', { name: '保存', exact: true }).click();
    await confirmOperation(page, false);
    await page.waitForFunction(() => !document.querySelector('form[data-action="network-mode"] button').disabled);
    assert.equal(writes.length, 0, 'cancelled confirmation must never write');
    await page.click('#refresh-button'); await visible('#network-host .list-status button');
    await page.click('#network-host .list-status button');
    await page.waitForFunction(() => document.querySelector('form[data-action="network-mode"] select').value === 'WL_AND_5G');
    await instance.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await page.selectOption('form[data-action="network-mode"] select', 'Only_LTE');
    await page.locator('form[data-action="network-mode"]').getByRole('button', { name: '保存', exact: true }).click();
    await confirmOperation(page, true);
    await page.waitForFunction(() => !document.querySelector('form[data-action="network-mode"] button').disabled);
    assert.equal(writes.at(-1).body.BearerPreference, 'Only_LTE');
    for (const tab of ['wifi', 'apn', 'radio', 'lan']) { await navigate(page, tab); await page.waitForFunction(() => [...document.querySelectorAll('#network-host > div:not(.hidden) .list-status')].every(n => n.classList.contains('hidden'))); }
    await navigate(page, 'radio'); await visible('[data-neighbor-table]');
    assert.equal(await page.locator('.manual-cell-lock').getAttribute('open'), null);
    assert.equal(await page.locator('[data-cell-choice="16:null:3"]').isDisabled(), true);
    const writesBeforeCell = writes.length;
    await page.locator('[data-cell-choice="16:633984:100"]').click();
    await page.waitForSelector('[data-confirm-operation]');
    assert.match(await page.locator('.operation-detail').textContent(), /5G NR \/ PCI 100 \/ 频点 633984/);
    assert.equal(writes.length, writesBeforeCell, 'choosing a cell only opens confirmation');
    await confirmOperation(page, false);
    assert.equal(writes.length, writesBeforeCell);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.cellChoice), '16:633984:100');
    await page.getByRole('searchbox', { name: '搜索邻区', exact: true }).fill('1650');
    assert.equal(await page.locator('[data-neighbor-table] tbody tr').count(), 1);
    await page.locator('[data-cell-choice="12:1650:12"]').click(); await confirmOperation(page, true);
    await page.locator('#feature-dialog').waitFor({ state: 'hidden' });
    assert.equal(writes.at(-1).body.goformId, 'CELL_LOCK'); assert.equal(writes.at(-1).body.rat, '12'); assert.equal(writes.at(-1).body.pci, '12'); assert.equal(writes.at(-1).body.earfcn, '1650');
    await page.waitForSelector('[data-cell-choice="16:633984:100"]');
    await page.screenshot({ path: path.join(output, 'neighbor-selection.png'), fullPage: true });
    await page.getByRole('searchbox', { name: '搜索邻区', exact: true }).fill('no-match');
    assert.match(await page.locator('[data-neighbor-table]').textContent(), /没有匹配/);
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    assert.equal(await page.locator('[data-neighbor-table] tbody tr').count(), 3);
    checks.push('neighbor selection, automatic RAT/PCI/channel, missing fields, filter reset and confirmation focus');
    for (const view of ['traffic', 'forward', 'tasks', 'device']) { await navigate(page, view); await page.locator(`#${view}-host form`).first().waitFor(); }
    await navigate(page, 'sms'); await page.click('#compose-sms');
    await page.fill('form[data-action="sms-send"] [name="number"]', '10000'); await page.fill('form[data-action="sms-send"] [name="content"]', '测试😀');
    await page.locator('form[data-action="sms-send"]').getByRole('button', { name: '发送', exact: true }).click();
    await confirmOperation(page, true);
    await page.locator('#feature-dialog').waitFor({ state: 'hidden' }); assert.equal(writes.at(-1).body.goformId, 'SEND_SMS');
    assert.equal(writes.at(-1).body.Number, '10000');
    await page.click('#compose-sms');
    const smsForm = page.locator('form[data-action="sms-send"]');
    await smsForm.locator('[name=numberMode]').selectOption('international');
    await page.getByRole('searchbox', { name: '搜索国家或地区', exact: true }).fill('英国');
    const regions = page.getByRole('combobox', { name: '国家或地区', exact: true });
    assert.match(await regions.locator('option[value=GB]').textContent(), /英国 \+44/);
    await regions.selectOption('GB');
    await smsForm.locator('[name=number]').fill('7700 900123');
    await smsForm.locator('[name=content]').fill('International fixture only');
    await page.waitForFunction(() => document.querySelector('.sms-number-preview').textContent.includes('+447700900123'));
    await page.screenshot({ path: path.join(output, 'sms-international.png'), fullPage: true });
    await page.getByRole('searchbox', { name: '搜索国家或地区', exact: true }).fill('United States');
    assert.match(await regions.locator('option[value=US]').textContent(), /美国 \+1/);
    assert.equal(await regions.inputValue(), 'GB', 'filtering never silently changes the selected country');
    await page.getByRole('searchbox', { name: '搜索国家或地区', exact: true }).fill('+852');
    assert.match(await regions.locator('option[value=HK]').textContent(), /中国香港/);
    await regions.selectOption('custom'); await smsForm.locator('[name=countryCode]').fill('44');
    await smsForm.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForSelector('[data-confirm-operation]');
    assert.match(await page.locator('.operation-detail').textContent(), /\+447700900123/);
    await confirmOperation(page, false);
    assert.equal(await smsForm.locator('[name=number]').inputValue(), '7700 900123');
    await smsForm.getByRole('button', { name: '发送', exact: true }).click();
    await confirmOperation(page, true); await page.locator('#feature-dialog').waitFor({ state: 'hidden' });
    assert.equal(writes.at(-1).body.Number, '+447700900123');
    checks.push('named country codes, Chinese/English/code search, custom prefix, preview and final SMS recipient');

    await navigate(page, 'plugins'); await page.click('#manage-plugins'); await visible('form[data-action="plugins-save"]');
    await page.fill('form[data-action="plugins-save"] textarea', '<script>editedPlugin()</script>');
    await page.locator('form[data-action="plugins-save"]').getByRole('button', { name: '保存到设备', exact: true }).click();
    await confirmOperation(page, true);
    await page.locator('#feature-dialog').waitFor({ state: 'hidden' }); assert.equal(writes.at(-1).body.text, '<script>editedPlugin()</script>');
    checks.push('single-layer confirmation cancel/accept, all settings pages, unsaved edits, SMS send and plugin save against fixture');
    await navigate(page, 'speed');
    await page.locator('#speed-host input[name="duration"]').fill('3');
    await page.locator('#speed-host').getByRole('button', { name: '开始测速', exact: true }).click();
    const duplicateSpeed = await page.evaluate(() => window.ufi.startJob('speed', { mode: 'lan', duration: 3, threads: 1 }).then(() => '', error => error.message)); assert.ok(duplicateSpeed.includes('仍在运行'));
    await page.click('#jobs-button'); await page.waitForSelector('#feature-dialog[open]'); await page.click('#close-feature-dialog');
    await navigate(page, 'sms'); await page.click('#compose-sms'); await page.fill('form[data-action="sms-send"] [name="content"]', '后台任务不能覆盖此草稿');
    await page.waitForFunction(() => document.getElementById('speed-result').textContent.includes('已完成'), null, { timeout: 15000 });
    assert.equal(await page.inputValue('form[data-action="sms-send"] [name="content"]'), '后台任务不能覆盖此草稿');
    await page.click('#close-feature-dialog'); await page.getByRole('button', { name: '放弃并关闭', exact: true }).click();
    await navigate(page, 'speed');

    assert.ok((await page.locator('#speed-result').textContent()).includes('KB'));
    await page.screenshot({ path: path.join(output, 'speed-fixture.png') });
    await navigate(page, 'appearance'); await page.locator('form[data-action="theme-save"]').waitFor();
    await page.locator('form[data-action="theme-save"] [name="themeColor"]').fill('150');
    await page.locator('form[data-action="theme-save"]').getByRole('button', { name: '保存', exact: true }).click(); await confirmOperation(page, true);
    await page.waitForFunction(() => !document.querySelector('form[data-action="theme-save"] button[type="submit"]').disabled);
    assert.equal(writes.at(-1).body.themeColor, '150');
    await navigate(page, 'updates'); await page.getByRole('button', { name: '下载到设备', exact: true }).click();
    await page.waitForSelector('#feature-dialog[open]');
    await page.waitForFunction(() => document.getElementById('feature-dialog-body').textContent.includes('已完成'));
    await page.click('#close-feature-dialog'); assert.ok(writes.some(w => w.path === '/api/download_apk'));
    await navigate(page, 'proxy'); await page.fill('#proxy-host input[name="url"]', 'https://example.test/check');
    await page.getByRole('button', { name: '发送请求', exact: true }).click(); await page.waitForSelector('#feature-dialog[open]');
    await page.waitForFunction(() => document.getElementById('feature-dialog-body').textContent.includes('HTTP 代理请求'));
    await page.click('#close-feature-dialog');
    const proxyJobs = await page.evaluate(() => window.ufi.jobs());
    const proxyJob = proxyJobs.find(j => j.kind === 'proxy');
    await page.waitForFunction(id => window.ufi.jobs().then(jobs => jobs.find(j => j.id === id)?.state === 'succeeded'), proxyJob.id);
    const response = await page.evaluate(id => window.ufi.jobResult(id), proxyJob.id); assert.equal(response.status, 404); assert.ok(response.data.includes('<script>'));
    await navigate(page, 'preferences'); const monitorOpened = instance.waitForEvent('window'); await page.getByRole('button', { name: '打开悬浮监控', exact: true }).click();
    const monitor = await monitorOpened; await monitor.locator('#monitor-data').waitFor(); assert.ok(monitor); assert.equal(await monitor.evaluate(() => typeof window.ufi), 'undefined'); await monitor.close();
    await navigate(page, 'voice'); await page.waitForSelector('form[data-action="voice"]');
    checks.push('stream speed job, theme save, OTA download tracking, text-only proxy response, isolated monitor and per-slot voice UI');

    await navigate(page, 'overview');
    for (const [width, height] of [[1240, 800], [1024, 700]]) {
      await instance.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
      await page.waitForFunction(width => window.outerWidth === width, width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('.content').scrollWidth > document.querySelector('.content').clientWidth), false);
      await page.screenshot({ path: path.join(output, `layout-${width}.png`) });
      await navigate(page, 'network'); await navigate(page, 'network');
      assert.equal(await page.evaluate(() => document.querySelector('.content').scrollWidth > document.querySelector('.content').clientWidth), false);
      await page.screenshot({ path: path.join(output, `settings-${width}.png`) });
      await navigate(page, 'overview');
    }
    await page.click('#edit-connection'); await page.click('#disconnect-button'); await visible('#welcome');
    assert.equal(await page.locator('#view-overview').isVisible(), false); assert.equal(await page.locator('#refresh-button').isDisabled(), true);
    await page.screenshot({ path: path.join(output, 'offline.png') });
    assert.equal(fs.readFileSync(path.join(userData, 'profiles.json'), 'utf8').includes('fixture-password'), false);
    assert.deepEqual(errors, []); checks.push('window sizes, clear disconnect, no plaintext credentials or page errors');
    console.log(JSON.stringify({ result: 'passed', checks, pageErrors: errors }, null, 2));
    fs.writeFileSync(path.join(output, 'interaction-validation.json'), JSON.stringify({ result: 'passed', checks, pageErrors: errors }, null, 2));
  } catch (error) {
    if (instance) {
      const page = (await instance.windows())[0];
      if (page) {
        await page.screenshot({ path: path.join(output, 'interaction-failure.png') });
        console.error({ connectionError: await page.locator('#connection-error').textContent(), state: await page.locator('#connection-state').textContent(), errors });
      }
    }
    throw error;
  } finally {
    if (instance) await instance.close(); server.closeAllConnections(); server.close(); fs.rmSync(userData, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
