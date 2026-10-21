'use strict';
const { SmsMailbox } = require('./sms-mailbox.cjs');
const { Transport, hashPassword, ApiError } = require('./protocol.cjs');
const { ClientAccess } = require('./client-access.cjs');

const STATUS_FIELDS = [
  'network_type', 'network_provider', 'ppp_status', 'network_signalbar', 'rssi', 'lte_rsrp', 'lte_rsrq', 'lte_snr',
  'Z5g_rsrp', 'Nr_snr', 'nr_rsrq', 'Nr_bands', 'Nr_fcn', 'Nr_bands_widths', 'Nr_pci', 'nr_rssi', 'Nr_cell_id',
  'Lte_snr', 'Lte_bands', 'Lte_fcn', 'Lte_bands_widths', 'Lte_pci', 'lte_rssi', 'Lte_cell_id',
  'realtime_rx_thrpt', 'realtime_tx_thrpt', 'monthly_rx_bytes', 'monthly_tx_bytes',
  'battery_value', 'battery_vol_percent', 'battery_charging', 'battery_voltage', 'battery_current', 'realtime_time', 'imei', 'iccid', 'imsi',
  'wifi_access_sta_num', 'sms_unread_num', 'sim_slot', 'cr_version', 'wa_inner_version', 'lan_ipaddr',
];

function decodeSms(content) {
  if (!content || typeof content !== 'string') return '';
  try { return Buffer.from(content, 'base64').toString('utf8'); } catch { return content; }
}

class UfiClient {
  constructor({ address, password = '', token, ztePassword = '', loginMethod = 'LOGIN' }, options) {
    this.transport = new Transport(address, token || hashPassword(password), options);
    this.ztePassword = ztePassword; this.loginMethod = loginMethod; this.mode = 'KANO';
    this.cookie = '';
    this.loginPromise = null;
    this.version = null;
    this.writeQueue = Promise.resolve();
    this.smsMailbox = new SmsMailbox(async page => {
      const data = await this.official('sms_data_total', { page: String(page), data_per_page: '50', mem_store: '1', tags: '100', order_by: 'order by id desc' });
      if (data.messages != null && !Array.isArray(data.messages)) throw new ApiError('设备返回了无效的短信列表');
      return (data.messages || []).map(message => ({ ...message, text: decodeSms(message.content) }));
    });
  }
  close() { this.smsMailbox.invalidate(); this.transport.close(); this.ztePassword = ''; this.cookie = ''; }
  async api(path, options) { return (await this.transport.request(path, options)).data; }

  async connect() {
    this.version = await this.api('/api/version_info');
    if (!this.version.model && !this.version.app_ver) throw new ApiError('此地址不是 UFI-TOOLS 服务');
    const base = await this.api('/api/baseDeviceInfo');
    return { version: this.version, base };
  }

  async getOfficial(fields, extra = {}, cookie = this.cookie) {
    const query = new URLSearchParams({ isTest: 'false', cmd: fields, multi_data: '1', ...extra, _: String(Date.now()) });
    return this.api(`/api/goform/goform_get_cmd_process?${query}`, { headers: cookie ? { 'Kano-Cookie': cookie } : {} });
  }

  async ensureOfficial() {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.loginOfficial();
    try { await this.loginPromise; } finally { this.loginPromise = null; }
  }
  async loginOfficial() {
    if (!this.cookie) {
      const saved = await this.api('/api/get_cookie');
      this.cookie = typeof saved.cookie === 'string' ? saved.cookie.split(';')[0] : '';
    }
    if ((await this.getOfficial('loginfo')).loginfo === 'ok') return;
    if (!this.ztePassword) throw new ApiError('请在连接设置中填写中兴后台口令，以读取此功能');
    const { LD } = await this.getOfficial('LD');
    if (!LD) throw new ApiError('中兴后台未返回登录随机数 LD');
    // APK k71.d() uses uppercase hexadecimal for the official ZTE challenge.
    const password = hashPassword(hashPassword(this.ztePassword).toUpperCase() + LD).toUpperCase();
    const result = await this.transport.request('/api/goform/goform_set_cmd_process', {
      method: 'POST', body: new URLSearchParams({ goformId: this.loginMethod, ...(this.loginMethod === 'LOGIN_MULTI_USER' ? { IP: 'localhost' } : {}), user: 'admin', password, isTest: 'false' }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    if (result.data.result !== 'success') throw new ApiError('中兴后台登录失败，请检查中兴后台口令');
    const cookie = result.headers['kano-cookie'];
    this.cookie = (Array.isArray(cookie) ? cookie[0] : cookie || '').split(';')[0];
    if (!this.cookie) throw new ApiError('中兴后台登录后未返回会话 Cookie');
    // Keep the session in this process; do not overwrite the web panel's shared cookie.
  }

  async official(fields, extra) {
    await this.ensureOfficial();
    return this.getOfficial(fields, extra);
  }
  postOfficial(fields) {
    // RD is a per-session challenge. Serialize writes and never retry a write
    // automatically: a timeout can mean the operation already took effect.
    const pending = this.writeQueue.then(async () => {
      await this.ensureOfficial();
      const info = await this.getOfficial('cr_version,wa_inner_version');
      const { RD } = await this.getOfficial('RD');
      if (!info.cr_version || !info.wa_inner_version || !RD) throw new ApiError('无法取得中兴写入校验信息');
      const digest = hashPassword(info.wa_inner_version + info.cr_version).toUpperCase();
      const data = await this.api('/api/goform/goform_set_cmd_process', {
        method: 'POST', body: new URLSearchParams({ ...fields, isTest: 'false', AD: hashPassword(digest + RD).toUpperCase() }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'Kano-Cookie': this.cookie },
      });
      if (data.result !== 'success') throw new ApiError(`设备未接受操作（${data.result ?? '未知响应'}），请检查固件支持与参数`);
      return data;
    });
    this.writeQueue = pending.catch(() => {});
    return pending;
  }
  async snapshot() {
    const [base, network, connections] = await Promise.allSettled([
      this.api('/api/baseDeviceInfo'), this.getOfficial(STATUS_FIELDS.join(',')), this.api('/api/connInfo'),
    ]);
    if (base.status === 'rejected') throw base.reason;
    const warnings = [];
    for (const [name, item] of [['网络状态', network], ['连接统计', connections]]) {
      if (item.status === 'rejected') warnings.push(`${name}：${item.reason.message}`);
    }
    return {
      at: Date.now(), version: this.version, base: base.value,
      network: network.status === 'fulfilled' ? network.value : {},
      connections: connections.status === 'fulfilled' ? connections.value : {}, warnings,
    };
  }
  async clients() { return (this.clientAccess ||= new ClientAccess(this)).read(); }
  sms(input = {}) { return this.smsMailbox.read(input); }
  invalidateSms() { this.smsMailbox.invalidate(); }
  async plugins() {
    const data = await this.api('/api/plugins_store', { timeout: 25000 });
    return { items: data.res?.data?.content || data.data?.content || [], total: data.res?.data?.total ?? null };
  }
  async shell(command, root = false) {
    if (typeof command !== 'string' || !command.trim() || command.length > 8192) throw new Error('请输入有效命令（最多 8192 字符）');
    return this.api(root ? '/api/root_shell' : '/api/user_shell', { method: 'POST', body: { command: command.trim(), timeout: 10000 }, timeout: 15000 });
  }
  async at(command, slot = '0') {
    if (!['0', '1'].includes(String(slot))) throw new Error('无效 SIM 卡槽');
    if (typeof command !== 'string' || !/^AT[^\r\n]{0,500}$/i.test(command)) throw new Error('请输入单行 AT 命令');
    return this.api(`/api/AT?${new URLSearchParams({ command, slot: String(slot) })}`, { timeout: 15000 });
  }
}
module.exports = { UfiClient, STATUS_FIELDS, decodeSms };
