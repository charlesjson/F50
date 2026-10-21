'use strict';
const { smsNumber } = require('./sms-number.cjs');
const { hashPassword } = require('./protocol.cjs');
const { isIP } = require('node:net');
const { Maintenance, READS, WRITES } = require('./maintenance.cjs');
const { Plugins, ACTIONS: PLUGIN_ACTIONS } = require('./plugins.cjs');
const { ClientAccess } = require('./client-access.cjs');

const str = (value, label, max = 256, optional = false) => {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim()) || value.includes('\0')) throw new Error(`${label}格式不正确`);
  return value;
};
const choice = (value, values, label) => { if (!values.includes(String(value))) throw new Error(`${label}选项无效`); return String(value); };
const integer = (value, min, max, label) => { const n = Number(value); if (value === '' || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label}应为 ${min}–${max} 的整数`); return n; };
const toggle = value => choice(value, ['0', '1'], '开关');
const json = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
const smsHex = value => Buffer.from(value, 'utf16le').swap16().toString('hex');
const NETWORK_FIELDS = 'net_select,ppp_status,sim_slot,dual_sim_support,roam_setting_option,dial_roam_setting_option,network_type,network_provider';
const DEVICE_FIELDS = 'usb_port_switch,performance_mode,usb_network_protocal,samba_switch,indicator_light_switch,restart_schedule_switch,restart_time,sleep_sysIdleTimeToSleep,is_support_nfc_functions,web_wifi_nfc_switch';
const APN_FIELDS = ['apn_mode','profile_name','wan_apn','apn_wan_apn','apn_Current_index','pdp_type', ...Array.from({ length: 20 }, (_, i) => `APN_config${i}`)].join(',');
const TASKS = { reboot: { goformId: 'REBOOT_DEVICE' }, connect: { goformId: 'CONNECT_NETWORK' }, disconnect: { goformId: 'DISCONNECT_NETWORK' }, wifiOn: { goformId: 'switchWiFiModule', SwitchOption: '1' }, wifiOff: { goformId: 'switchWiFiModule', SwitchOption: '0' } };
const TASK_NAMES = { reboot: '重启设备', connect: '连接蜂窝网络', disconnect: '断开蜂窝网络', wifiOn: '开启 Wi-Fi', wifiOff: '关闭 Wi-Fi' };

class DeviceFeatures {
  constructor(client) { this.client = client; this.busy = false; this.maintenance = new Maintenance(client); this.plugins = new Plugins(client); }
  async batch(entries) {
    const result = { warnings: [] };
    const settled = await Promise.allSettled(entries.map(([, operation]) => operation()));
    settled.forEach((item, i) => {
      const key = entries[i][0];
      if (item.status === 'fulfilled') result[key] = item.value;
      else result.warnings.push(`${key}：${item.reason.message}`);
    });
    if (settled.every(r => r.status === 'rejected')) throw new Error(result.warnings.join('；'));
    return result;
  }
  async read(name, input = {}) {
    if (READS.has(name)) return this.maintenance.read(name, input);
    const c = this.client;
    switch (name) {
      case 'network': return { network: await c.official(NETWORK_FIELDS) };
      case 'wifi': {
        const data = await c.official('queryWiFiModuleSwitch,queryAccessPointInfo');
        const list = json(data.ResponseList) || [];
        return { enabled: data.WiFiModuleSwitch, points: Array.isArray(list) ? list.map(({ Password, PasswordShow, ...point }) => ({ ...point, hasPassword: !!Password })) : [] };
      }
      case 'apn': {
        const data = await c.official(APN_FIELDS);
        const profiles = Array.from({ length: 20 }, (_, index) => {
          if (!data[`APN_config${index}`]) return null;
          const p = data[`APN_config${index}`].split('($)');
          return { index, name: p[0], apn: p[1], auth: p[4] || 'none', username: p[5] || '', hasPassword: !!p[6], pdp: p[7] || 'IPv4v6' };
        }).filter(Boolean);
        return { mode: data.apn_mode, current: data.profile_name, apn: data.wan_apn || data.apn_wan_apn, profiles };
      }
      case 'radio': return this.batch([
        ['radio', () => c.official('lte_band_lock,nr_band_lock,neighbor_cell_info,locked_cell_info,network_type')],
        ['supported', () => c.api('/api/getSupportNrBandList?slot=0')],
      ]);
      case 'lan': return { lan: await c.official('lan_ipaddr,lan_netmask,dhcpEnabled,dhcpStart,dhcpEnd,dhcpLease_hour') };
      case 'device': if (c.mode === 'GOFORM') return { device: await c.official(DEVICE_FIELDS), mode: 'GOFORM', supportsNickname: false, warnings: [] }; return this.batch([
        ['device', () => c.official(DEVICE_FIELDS)], ['usb', () => c.api('/api/usb_status')],
        ['adb', () => c.api('/api/adb_wifi_setting')], ['log', () => c.api('/api/get_log_status')],
        ['volte', () => c.api(`/api/volte_status?slot=${choice(input.slot ?? '0', ['0', '1'], '卡槽')}`)],
        ['vonr', () => c.api(`/api/vonr_status?slot=${choice(input.slot ?? '0', ['0', '1'], '卡槽')}`)],
      ]).then(result => ({ ...result, mode: c.mode || 'KANO' }));
      case 'traffic': {
        const startTime = integer(input.startTime, 0, Date.now() + 86400000, '开始时间');
        const endTime = integer(input.endTime, startTime, Date.now() + 86400000, '结束时间');
        if (endTime - startTime > 366 * 86400000) throw new Error('一次最多查询 366 天');
        return this.batch([['usage', () => c.api(`/api/cellularUsage?${new URLSearchParams({ startTime, endTime, method: 'date-range' })}`)], ['limit', () => c.api('/api/get_data_limit')]]);
      }
      case 'tasks': return c.api('/api/list_tasks');
      case 'plugins-config': {
        const { text, revision } = await this.plugins.read();
        return { text, revision };
      }
      case 'plugins-installed': return this.plugins.installed();
      case 'installed-plugin-source': return this.plugins.source(input);
      case 'plugin-source': {
        const name = str(input.name, '插件名', 256);
        const catalog = await c.api('/api/plugins_store');
        const items = catalog.res?.data?.content || catalog.data?.content || [];
        if (!items.some(i => i.name === name && !i.is_dir) || /[/\\]/.test(name)) throw new Error('插件不在当前目录中');
        const base = new URL(catalog.download_url);
        if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('插件仓库地址无效');
        const url = base.href.replace(/\/$/, '') + '/' + encodeURIComponent(name);
        const result = await c.transport.request('/api/proxy/--' + url, { responseType: 'text', timeout: 25000 });
        if (!result.data.trim()) throw new Error('插件内容为空');
        return { name, text: result.data };
      }
      case 'forward': return this.batch([
        ['smtp', async () => { const { smtp_password, ...visible } = await c.api('/api/sms_forward_mail'); return visible; }],
        ['method', () => c.api('/api/sms_forward_method')], ['enabled', () => c.api('/api/sms_forward_enabled')],
        ['power', () => c.api('/api/power_status_forward_enabled')], ['blacklist', () => c.api('/api/sms_forward_blacklist')],
      ]);
      default: throw new Error('未知设备功能');
    }
  }
  prepare(name, input = {}) {
    if (WRITES.has(name)) return this.maintenance.prepare(name, input);
    if (PLUGIN_ACTIONS.has(name)) return this.plugins.prepare(name, input);
    const c = this.client;
    let title, detail = '', run;
    const official = (label, fields, note = '') => { title = label; detail = note; run = async () => { const result = await c.postOfficial(fields); if (['SEND_SMS', 'DELETE_SMS', 'SET_MSG_READ'].includes(fields.goformId)) c.invalidateSms?.(); return result; }; };
    const api = (label, endpoint, body, note = '') => { title = label; detail = note; run = async () => {
      const result = await c.api(endpoint, { method: 'POST', ...(body === undefined ? {} : { body }) });
      if (result?.result && !['success', 'removed', 'added', 'cleared', 'true'].includes(String(result.result))) throw new Error(`设备未接受操作：${result.result}`);
      return result;
    }; };
    switch (name) {
      case 'sms-send': {
        const number = smsNumber(input);
        const content = str(input.content, '短信内容', 2000);
        official('发送短信', { goformId: 'SEND_SMS', Number: number, MessageBody: smsHex(content) }, `收件人：${number}\n内容：${content}\n发送可能产生运营商费用。`); break;
      }
      case 'sms-delete': case 'sms-read': {
        const id = str(String(input.id ?? ''), '短信 ID', 40);
        if (!/^\d+$/.test(id)) throw new Error('无效短信 ID');
        official(name === 'sms-delete' ? '删除短信' : '标记短信已读', { goformId: name === 'sms-delete' ? 'DELETE_SMS' : 'SET_MSG_READ', msg_id: id, notCallback: 'true' }, `短信 ID：${id}${name === 'sms-delete' ? '\n删除后无法恢复。' : ''}`); break;
      }
      case 'network-mode': official('切换网络制式', { goformId: 'SET_BEARER_PREFERENCE', BearerPreference: choice(input.mode, ['WL_AND_5G', 'Only_5G', 'LTE_AND_5G', 'Only_LTE'], '网络模式') }, `模式：${input.mode}\n蜂窝网络可能暂时断开。`); break;
      case 'cellular': official(input.enabled === '1' ? '连接蜂窝网络' : '断开蜂窝网络', { goformId: toggle(input.enabled) === '1' ? 'CONNECT_NETWORK' : 'DISCONNECT_NETWORK' }); break;
      case 'roaming': official('修改数据漫游', { goformId: 'SET_CONNECTION_MODE', ConnectionMode: 'auto_dial', roam_setting_option: toggle(input.enabled) === '1' ? 'on' : 'off', dial_roam_setting_option: input.enabled === '1' ? 'on' : 'off' }, `数据漫游：${input.enabled === '1' ? '开启' : '关闭'}`); break;
      case 'sim': official('切换 SIM 卡槽', { goformId: 'SET_SIM_SLOT', sim_slot: choice(input.slot, ['0', '1', '2', '11'], 'SIM 卡槽') }, `卡槽值：${input.slot}\n蜂窝网络将重新连接，具体卡槽取决于机型。`); break;
      case 'wifi-toggle': official('切换 Wi-Fi', { goformId: 'switchWiFiModule', SwitchOption: toggle(input.enabled) }, `Wi-Fi：${input.enabled === '1' ? '开启' : '关闭'}\n通过 Wi-Fi 连接时可能失去当前连接。`); break;
      case 'wifi-chip': official('切换 Wi-Fi 频段', { goformId: 'switchWiFiChip', ChipEnum: choice(input.chip, ['chip1', 'chip2'], 'Wi-Fi 芯片'), GuestEnable: '0' }, '切换无线芯片可能断开已连接的无线终端。'); break;
      case 'wifi-save': {
        const ssid = str(input.ssid, 'SSID', 32); if (Buffer.byteLength(ssid) > 32) throw new Error('SSID 最多 32 字节');
        const auth = choice(input.auth, ['OPEN', 'WPA2PSK', 'WPA3PSK', 'WPA2PSKWPA3PSK'], '认证方式');
        const password = str(input.password || '', 'Wi-Fi 口令', 63, true);
        if (password && (password.length < 8 || !/^[\x20-\x7e]+$/.test(password))) throw new Error('Wi-Fi 口令须为 8–63 位可打印 ASCII 字符');
        const fields = { goformId: 'setAccessPointInfo', SSID: ssid, AuthMode: auth, EncrypType: auth === 'OPEN' ? 'NONE' : 'CCMP', ApMaxStationNumber: integer(input.max, 1, 64, '终端上限'), ApBroadcastDisabled: toggle(input.hidden), ApIsolate: toggle(input.isolate), ChipIndex: integer(input.chip, 0, 8, '芯片'), AccessPointIndex: integer(input.point, 0, 8, '热点') };
        if (auth !== 'OPEN' && password) fields.Password = Buffer.from(password).toString('base64');
        official('保存 Wi-Fi 配置', fields, `SSID：${ssid}\n芯片 ${input.chip} / 热点 ${input.point}\n修改后无线终端可能需要重新连接。`); break;
      }
      case 'bands': {
        const rat = choice(input.rat, ['LTE', 'NR'], '制式');
        const values = str(input.bands || '', '频段', 512, true).split(/[,，\s]+/).filter(Boolean).map(v => integer(v.replace(/^[bn]/i, ''), 1, 1024, '频段'));
        const bands = [...new Set(values)].join(',');
        official(bands ? `锁定 ${rat} 频段` : `解除 ${rat} 频段锁`, { goformId: rat === 'NR' ? 'NR_BAND_LOCK' : 'LTE_BAND_LOCK', [rat === 'NR' ? 'nr_band_lock' : 'lte_band_lock']: bands }, `频段：${bands || '自动'}\n选择设备和运营商支持的频段；蜂窝网络可能中断。`); break;
      }
      case 'cell-lock': {
        const rat = choice(input.rat, ['12', '16'], '制式');
        official('锁定基站', { goformId: 'CELL_LOCK', rat, pci: integer(input.pci, 0, rat === '16' ? 1007 : 503, 'PCI'), earfcn: integer(input.earfcn, 0, 3279165, '频点') }, `${rat === '16' ? '5G NR' : '4G LTE'} / PCI ${input.pci} / 频点 ${input.earfcn}\n蜂窝网络可能中断。`); break;
      }
      case 'cell-unlock': official('解除所有基站锁', { goformId: 'UNLOCK_ALL_CELL' }); break;
      case 'apn-default': {
        const index = integer(input.index, 0, 19, 'APN 索引');
        official('切换默认 APN', { goformId: 'APN_PROC_EX', apn_mode: 'manual', apn_action: 'set_default', set_default_flag: '1', apn_pdp_type: '', index }, `配置索引：${index}\n蜂窝网络可能重新连接。`); break;
      }
      case 'apn-auto': official('启用自动 APN', { goformId: 'APN_PROC_EX', apn_mode: 'auto' }); break;
      case 'apn-delete': official('删除 APN 配置', { goformId: 'APN_PROC_EX', apn_mode: 'manual', apn_action: 'delete', index: integer(input.index, 0, 19, 'APN 索引') }, `删除配置 ${input.index}`); break;
      case 'apn-save': {
        const index = integer(input.index, 0, 19, 'APN 索引'), pdp = choice(input.pdp, ['IP', 'IPv6', 'IPv4v6'], 'PDP');
        const apn = str(input.apn, 'APN', 100), auth = choice(input.auth, ['none', 'pap', 'chap'], '认证方式');
        const username = str(input.username || '', '用户名', 100, true), password = str(input.password || '', '密码', 100, true);
        const fields = { goformId: 'APN_PROC_EX', apn_mode: 'manual', apn_action: 'save', index, profile_name: str(input.name, '配置名', 64), wan_dial: '*99#', apn_wan_dial: '*99#', apn_select: 'manual', apn_pdp_type: pdp, pdp_type: pdp, apn_pdp_select: 'auto', pdp_select: 'auto', pdp_addr: '', pdp_addr2: '', apn_wan_apn: apn, apn_ppp_auth_mode: auth, apn_ppp_username: username, apn_ppp_passwd: password };
        if (pdp !== 'IPv6') Object.assign(fields, { wan_apn: apn, ppp_auth_mode: auth, ppp_username: username, ppp_passwd: password, dns_mode: 'auto', prefer_dns_manual: '', standby_dns_manual: '' });
        if (pdp !== 'IP') Object.assign(fields, { apn_ipv6_wan_apn: apn, apn_ipv6_ppp_auth_mode: auth, apn_ipv6_ppp_username: username, apn_ipv6_ppp_passwd: password, ipv6_wan_apn: apn, ipv6_ppp_auth_mode: auth, ipv6_ppp_username: username, ipv6_ppp_passwd: password, ipv6_dns_mode: 'auto', ipv6_prefer_dns_manual: '', ipv6_standby_dns_manual: '' });
        official('保存 APN 配置', fields, `${input.name} / ${apn}\n索引：${index}；同索引的已有配置将被替换。`); break;
      }
      case 'hostname': {
        const mac = str(input.mac, 'MAC 地址', 17); if (!/^([\da-f]{2}:){5}[\da-f]{2}$/i.test(mac)) throw new Error('无效 MAC 地址');
        official('修改终端名称', { goformId: 'EDIT_HOSTNAME', mac, hostname: str(input.name, '终端名称', 64) }, `${mac} → ${input.name}`); break;
      }
      case 'client-block': case 'client-unblock': {
        const plan = (c.clientAccess ||= new ClientAccess(c)).prepare(name, input);
        ({ title, detail, run } = plan); break;
      }
      case 'lan': {
        const fields = { goformId: 'DHCP_SETTING', lanDhcpType: toggle(input.enabled), dhcpLease: integer(input.lease, 1, 168, '租约小时'), dhcp_reboot_flag: '1', mac_ip_reset: '0' };
        for (const key of ['lanIp', 'lanNetmask', 'dhcpStart', 'dhcpEnd']) { if (isIP(input[key]) !== 4) throw new Error(`${key} 应为 IPv4 地址`); fields[key] = input[key]; }
        const numeric = ip => ip.split('.').reduce((value, part) => value * 256 + Number(part), 0) >>> 0;
        const mask = numeric(input.lanNetmask), inverse = (~mask) >>> 0;
        if (!mask || (inverse & (inverse + 1)) !== 0) throw new Error('子网掩码必须连续');
        const gateway = numeric(input.lanIp), start = numeric(input.dhcpStart), end = numeric(input.dhcpEnd);
        if (start > end || (start & mask) !== (gateway & mask) || (end & mask) !== (gateway & mask)) throw new Error('DHCP 地址池必须按顺序位于网关子网内');
        official('修改 LAN / DHCP', fields, `网关：${input.lanIp}\n地址池：${input.dhcpStart}–${input.dhcpEnd}\n生效后需要在连接设置中修改设备地址。`); break;
      }
      case 'nickname': {
        const nickname = str(input.nickname, '设备别名', 255); title = '修改设备别名'; detail = nickname;
        run = async () => { const result = await c.api('/api/set_nickname', { method: 'POST', body: { nickname } }); c.version = { ...c.version, nickname }; return result; }; break;
      }
      case 'debug-log': api('设置调试日志', '/api/set_log_status', { debug_log_enabled: toggle(input.enabled) === '1' }); break;
      case 'wakelock': api('设置 CPU 唤醒锁', '/api/set_wakelock_status', { wakelock_enabled: toggle(input.enabled) === '1' }, '开启后可能增加功耗。'); break;
      case 'adb': {
        const enabled = toggle(input.enabled) === '1'; const password = str(input.password || '', '中兴后台口令', 256, !enabled);
        api('配置无线 ADB 自启', '/api/adb_wifi_setting', { enabled, password }, enabled ? '开启无线 ADB，并把填写的中兴口令保存到设备 UFI-TOOLS。' : '关闭无线 ADB 自启，并清除设备保存的中兴后台口令，可能影响定时任务。'); break;
      }
      case 'restart-schedule': {
        const time = str(input.time, '重启时间', 5); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('时间格式应为 HH:mm');
        official('设置原厂定时重启', { goformId: 'RESTART_SCHEDULE_SETTING', restart_schedule_switch: toggle(input.enabled), restart_time: time }, `设备本地时间 ${time}`); break;
      }
      case 'device-toggle': {
        const options = { usb: ['USB_PORT_SETTING', 'usb_port_switch', 'USB 调试'], performance: ['PERFORMANCE_MODE_SETTING', 'performance_mode', '性能模式'], samba: ['SAMBA_SETTING', 'samba_switch', 'SMB 共享'], led: ['INDICATOR_LIGHT_SETTING', 'indicator_light_switch', '指示灯'] };
        const option = options[input.setting]; if (!option) throw new Error('未知设备开关');
        official(`修改${option[2]}`, { goformId: option[0], [option[1]]: toggle(input.enabled) }, `${input.enabled === '1' ? '开启' : '关闭'}`); break;
      }
      case 'voice': {
        const type = choice(input.type, ['volte', 'vonr'], '语音模式');
        api(`设置 ${type.toUpperCase()}`, `/api/${type}_status`, { enabled: toggle(input.enabled), slot: choice(input.slot, ['0', '1'], '卡槽') }, `卡槽 ${input.slot}：${input.enabled === '1' ? '开启' : '关闭'}`); break;
      }
      case 'reboot': official('重启设备', { goformId: 'REBOOT_DEVICE' }, '设备及网络会暂时离线，重启完成后可重新连接。'); break;
      case 'traffic-limit': {
        const gb = Number(input.gb); if (!Number.isFinite(gb) || gb <= 0 || gb > 100000) throw new Error('流量上限须大于 0 且不超过 100000 GB');
        api('保存流量限制', '/api/set_data_limit', { data_flow_limit_enabled: toggle(input.enabled), data_limit_status_forward_enabled: toggle(input.notify), data_flow_max_limit: Math.round(gb * 1024 ** 3), data_flow_check_daily_or_monthly: choice(input.period, ['daily', 'monthly'], '统计周期'), data_check_reference: choice(input.reference, ['android', 'default'], '统计来源') }, `${input.gb} GB / ${input.period === 'daily' ? '每天' : '每月'}\n${input.enabled === '1' ? '达到阈值时可能断开蜂窝网络。' : '关闭流量限制。'}`); break;
      }
      case 'task-add': {
        const action = TASKS[input.action]; if (!action) throw new Error('任务动作无效');
        const time = str(input.time, '执行时间', 5); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('请填写 HH:mm 时间');
        const id = str(input.id, '任务 ID', 80); if (!/^[\w-]+$/.test(id)) throw new Error('任务 ID 仅支持字母、数字、下划线和短横线');
        api('保存设备定时任务', '/api/add_task', { id, time, repeatDaily: toggle(input.repeat) === '1', action }, `${id} / ${time}（设备本地时间）/ ${TASK_NAMES[input.action]}\n同 ID 任务会被替换。`); break;
      }
      case 'task-remove': api('删除设备定时任务', '/api/remove_task', { id: str(input.id, '任务 ID', 80) }, input.id); break;
      case 'plugins-save': {
        const text = str(input.text, '插件文本', 5 * 1024 * 1024, true);
        if (Buffer.byteLength(JSON.stringify({ text })) > 5 * 1024 * 1024) throw new Error('插件文本超过设备 5 MB 限制');
        const revision = str(input.revision, '配置版本', 64);
        title = '保存设备插件'; detail = `将替换设备上的插件代码（${Buffer.byteLength(text)} 字节）。代码仅在设备网页中执行。`;
        run = () => this.plugins.save(text, revision); break;
      }
      case 'forward-toggle': {
        const type = choice(input.type, ['sms', 'power'], '转发类型');
        api('修改转发开关', `/api/${type === 'sms' ? 'sms_forward_enabled' : 'power_status_forward_enabled'}?enable=${toggle(input.enabled)}`, undefined, `${type === 'sms' ? '短信' : '电量'}转发：${input.enabled === '1' ? '开启' : '关闭'}`); break;
      }
      case 'forward-blacklist': {
        const phone = str(input.phone || '', '号码列表', 5000, true); if (!/^[0-9\n\r]*$/.test(phone)) throw new Error('号码黑名单仅支持数字，每行一个号码');
        api('保存转发黑名单', '/api/sms_forward_blacklist', { phone, keywords: str(input.keywords || '', '关键词', 5000, true) }); break;
      }
      case 'forward-smtp': {
        const body = {}; for (const key of ['smtp_host', 'smtp_to', 'smtp_username']) body[key] = str(input[key], key, 512);
        body.smtp_password = str(input.smtp_password || '', 'SMTP 口令', 512, true);
        body.smtp_port = String(integer(input.smtp_port, 1, 65535, 'SMTP 端口'));
        for (const key of ['smtp_from', 'smtp_from_name']) body[key] = str(input[key] || '', key, 256, true);
        body.forward_dev_info = toggle(input.forward_dev_info);
        api('保存邮件转发并发送测试邮件', '/api/sms_forward_mail', body, `收件人：${body.smtp_to}\n服务端保存后会立即发送测试邮件。`);
        const save = run; run = async () => { if (!body.smtp_password) { const current = await c.api('/api/sms_forward_mail'); body.smtp_password = current.smtp_password || ''; if (!body.smtp_password) throw new Error('设备没有已保存的 SMTP 口令，请填写'); } return save(); }; break;
      }
      case 'forward-dingtalk': {
        const url = new URL(str(input.webhook_url, 'Webhook', 2048)); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Webhook 须为 HTTPS 地址');
        api('保存钉钉转发并发送测试消息', '/api/sms_forward_dingtalk', { webhook_url: url.href, secret: str(input.secret || '', '加签密钥', 256, true), forward_dev_info: toggle(input.forward_dev_info) }, `目标：${url.hostname}\n服务端保存后会立即发送测试消息。`); break;
      }
      case 'forward-curl': {
        const command = str(input.curl_text, 'curl 模板', 20000);
        if (!['{{sms-body}}', '{{sms-time}}', '{{sms-from}}'].every(v => command.includes(v))) throw new Error('模板须包含短信内容、时间和来源三个占位符');
        api('保存 curl 转发并发送测试消息', '/api/sms_forward_curl', { curl_text: command }, '设备会执行此 curl 模板，并立即发送一次测试转发。'); break;
      }
      default: throw new Error('未知写入操作');
    }
    return { title, detail, pluginsChanged: name === 'plugins-save', run: async () => {
      if (this.busy) throw new Error('上一项设备操作仍在执行');
      this.busy = true;
      try { return await run(); }
      catch (error) { if (/超时|ECONNRESET|EPIPE/.test(error.message)) throw new Error(`${error.message}。操作结果未知，请重新读取状态后确认，勿重复提交。`); throw error; }
      finally { this.busy = false; }
    } };
  }
}
module.exports = { DeviceFeatures, smsHex, TASK_NAMES };
