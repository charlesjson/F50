'use strict';
const http=require('node:http');const{once}=require('node:events');const{hashPassword}=require('../src/core/protocol.cjs');
exports.startFixture=async()=>{
  const state = { smsDelayMs: 0, smsMixed: false, smsReads: 0, reads: 0, live: false, clients: 0, failClients: false, failSms: false, failBase: false, slow: false, pending: null, label: '工作电脑', nullRate: true, pluginText: '<script>existingPlugin()</script>', pluginReads: 0, failMarket: false, pluginPages: {}, pluginCommands: {} };
  const writes = [];
  state.clientAcl = { AclMode: '2', WhiteMacList: '', BlackMacList: '', WhiteNameList: '', BlackNameList: '' };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture'), cmd = url.searchParams.get('cmd');
    const json = data => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); };
    const fail = () => { res.statusCode = 503; json({ error: '模拟设备暂时不可用' }); };
    if (url.pathname === '/fixture-embedded-panel') { state.embeddedLoads=(state.embeddedLoads||0)+1;res.setHeader('content-type','text/html');res.end('<!doctype html><title>Embedded plugin panel</title><p>插件内嵌面板</p>');return; }
    if (['/', '/ui/', '/dashboard/'].includes(url.pathname)) {
      if (state.sessionPageOffline) { req.socket.destroy(); return; }
      res.setHeader('content-type','text/html'); res.end(require(state.sessionFixture ? './fixture-session-page.cjs' : state.pluginMenuFixture ? './fixture-plugin-menu-page.cjs' : './fixture-plugin-page.cjs')); return;
    }
    if (url.pathname === '/fixture-session-report') { let body='';for await(const chunk of req)body+=chunk;const report=JSON.parse(body);(state.authPages ||= {})[report.id] = report;json({ok:true});return; }
    if (Object.hasOwn(state.pluginScripts || {}, url.pathname)) { res.setHeader('content-type', 'application/javascript'); res.end(state.pluginScripts[url.pathname]); return; }
    if (url.pathname === '/fixture-menu-action') {let body='';for await(const chunk of req)body+=chunk;(state.menuActions ||= []).push(JSON.parse(body));json({ok:true});return;}
    if (url.pathname === '/fixture-page-report') { let body='';for await(const chunk of req)body+=chunk;const report=JSON.parse(body);state.pluginPages[report.id]={...report,at:Date.now()};json({ok:true});return; }
    if (url.pathname === '/fixture-command') { const id=url.searchParams.get('id'),command=state.pluginCommands[id]||{};delete state.pluginCommands[id];json(command);return; }
    if (url.pathname === '/fixture-upload') { let body='';for await(const chunk of req)body+=chunk;state.pluginUpload={name:url.searchParams.get('name'),body};json({ok:true});return; }
    if (url.pathname === '/fixture-download.txt') { res.setHeader('content-type','text/plain');res.setHeader('content-disposition','attachment; filename="fixture-config.txt"');res.end('fixture plugin backup');return; }
    if (url.pathname === '/isolation-result') { state.remoteIsolation=Object.fromEntries(url.searchParams); json({ok:true}); return; }
    if (url.pathname === '/api/version_info') {
      if (state.slow) { state.pending = () => json({ model: 'F50', app_ver: '4.1.5' }); return; }
      return json({ model: 'F50', app_ver: '4.1.5' });
    }
    if (req.headers.authorization !== hashPassword('fixture-password')) { res.statusCode = 401; return json({}); }
    if (url.pathname === '/api/session-probe') return json({ok:true});
    if (url.pathname === '/api/speedtest') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); const timer = setInterval(() => res.write(Buffer.alloc(4096)), 5); res.on('close', () => clearInterval(timer)); return; }
    if (url.pathname === '/api/get_theme') return json({ backgroundEnabled: 'false', backgroundUrl: '', textColor: 'rgba(255,255,255,1)', textColorPer: '100', themeColor: '201', colorPer: '67', saturationPer: '100', brightPer: '21', opacityPer: '21', blurSwitch: 'true', overlaySwitch: 'true' });
    if (url.pathname === '/api/check_update') return json({ base_uri: 'https://updates.example.test/', alist_res: { code: 200, data: { content: [{ name: 'ufi-tools-4.1.5.apk', size: 12345 }] } }, changelog: 'Fixture update' });
    if (url.pathname === '/api/download_apk_status') return json({ status: 'done', percent: 100 });
    if (url.pathname === '/api/need_token') return json({ need_token: true });
    if (url.pathname === '/api/is_weak_token') return json({ is_weak: false });
    if (url.pathname === '/api/get_res_server') return json({ res_server: 'https://updates.example.test' });
    if (url.pathname === '/api/sms_forward_mail') return json({ smtp_host: '', smtp_port: '465', smtp_username: '', smtp_to: '' });
    if (url.pathname.startsWith('/api/proxy/')) { if(url.pathname.endsWith('/Mosdns.js')||url.pathname.endsWith('/Network.js')){res.setHeader('content-type','text/plain');return res.end('<script>window.__untrustedLocal=true;</script>');} res.writeHead(404, { 'content-type': 'text/plain' }); res.end('<script>untrusted response</script>'); return; }
    if (req.method === 'POST') { let body = ''; for await (const chunk of req) body += chunk; const parsed=req.headers['content-type']?.includes('json') ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body));writes.push({ path: url.pathname, body: parsed });if(url.pathname==='/api/set_custom_head')state.pluginText=parsed.text;if(parsed.goformId==='setDeviceAccessControlList')for(const key of Object.keys(state.clientAcl))state.clientAcl[key]=parsed[key]; return json({ result: 'success' }); }
    if (url.pathname === '/api/baseDeviceInfo') {
      state.reads++;
      if (state.failBase) return fail();
      return json({ cpu_temp: state.live ? 51000 + state.reads * 10 : 52100, cpu_usage: state.live ? state.reads % 100 : 12.8, mem_usage: 61, memInfo: { mem_used_kb: 900000, mem_total_kb: 1500000 }, daily_data: 3e9, monthly_data: 24e9, internal_used_storage: 2e9, internal_total_storage: 24e9, cpu_temp_list: [{ type: 'CPU', temp: 52100 }, { type: 'Modem', temp: 48000 }], ...state.baseOverrides });
    }
    if (url.pathname === '/api/connInfo') { state.connectionReads=(state.connectionReads||0)+1;return json({}); }
    if (url.pathname === '/api/get_cookie') return json({ cookie: 'stok=fixture' });
    if (cmd === 'RD') return json({ RD: 'fixture-rd' });
    if (cmd === 'cr_version,wa_inner_version') return json({ cr_version: 'B09', wa_inner_version: 'web' });
    if (cmd?.includes('net_select')) return json({ net_select: 'WL_AND_5G', sim_slot: '1', roam_setting_option: 'off', ppp_status: 'ppp_connected' });
    if (cmd?.includes('queryAccessPointInfo')) return json({ WiFiModuleSwitch: '1', ResponseList: [{ ChipIndex: '0', AccessPointIndex: '0', SSID: 'Fixture Wi-Fi', Password: 'ZmFrZQ==', AuthMode: 'WPA2PSK', ApMaxStationNumber: 10, ApBroadcastDisabled: '0', ApIsolate: '0' }] });
    if (cmd?.includes('APN_config')) return json({ apn_mode: 'auto', profile_name: 'Carrier', APN_config0: 'Carrier($)internet($)manual($)*99#($)none($)($)($)IPv4v6' });
    if (cmd?.includes('lte_band_lock')) return json({ lte_band_lock: '', nr_band_lock: '', network_type: '5G', neighbor_cell_info: [{ band: 78, pci: 100, earfcn: 633984, rsrp: -90 }, { rat:'LTE',band:3,pci:12,earfcn:1650,rsrp:-95 }, {rat:'NR',band:78,pci:3,earfcn:'',rsrp:-110}], locked_cell_info: [] });
    if (cmd?.includes('lan_netmask')) return json({ lan_ipaddr: '192.168.0.1', lan_netmask: '255.255.255.0', dhcpEnabled: '1', dhcpStart: '192.168.0.100', dhcpEnd: '192.168.0.200', dhcpLease_hour: '24' });
    if (cmd?.includes('performance_mode')) return json({ usb_port_switch: '0', performance_mode: '0', samba_switch: '1', indicator_light_switch: '1' });
    if (url.pathname === '/api/get_custom_head') { state.pluginReads++; return json({ text: state.pluginText }); }
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
    if (cmd?.includes('network_type')) { state.networkReads=(state.networkReads||0)+1;return json({ ppp_status: 'ppp_disconnected', network_type: '5G', network_provider: '测试运营商', cr_version: 'B09', wifi_access_sta_num: '2', sms_unread_num: '1', realtime_rx_thrpt: state.nullRate ? '' : 5e5, realtime_tx_thrpt: state.nullRate ? '' : 2e5, Z5g_rsrp: '-85', ...state.networkOverrides }); }
    if (cmd?.includes('station_list')) {
      state.clients++;
      if (state.failClients) return fail();
      const blocked = state.clientAcl.BlackMacList.toUpperCase().split(';');
      return json({ station_list: blocked.includes('00:11:22:33:44:55') ? [] : [{ hostname: state.label, ip_addr: '192.168.0.3', mac_addr: '00:11:22:33:44:55' }], lan_station_list: [{ hostname: '有线终端', ip_addr: '192.168.0.12', mac_addr: '00:11:22:33:44:66' }], ...(state.clientAclMissing ? {} : state.clientAcl) });
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
    if (url.pathname === '/api/plugins_store') { if(state.failMarket)return fail(); return json({ download_url:`http://${req.headers.host}/plugins`,res: { data: { content: [{ name: 'Mosdns.js', size: 2048, modified: '2026-10-15T01:00:00Z' }, { name: 'Network.js', size: 4096, modified: '2026-10-14T01:00:00Z' }] } } }); }
    res.statusCode = 404; json({ error: 'Unexpected fixture request' });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = `http://127.0.0.1:${server.address().port}`;
  return {address,state,writes,close:()=>{server.closeAllConnections();server.close();}};

};
