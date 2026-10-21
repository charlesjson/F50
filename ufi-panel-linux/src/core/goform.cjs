'use strict';
const { UfiClient, STATUS_FIELDS } = require('./client.cjs');
const { Transport } = require('./protocol.cjs');
class GoformClient extends UfiClient {
  constructor(credentials, options = {}) {
    super(credentials, options); this.transport.close();
    this.transport = new Transport(credentials.address, '', { ...options, signed: false, apiPrefix: '/goform/' });
    this.ztePassword = credentials.ztePassword || credentials.password || '';
    this.mode = 'GOFORM'; this.loginMethod = credentials.loginMethod || 'LOGIN';
  }
  async api(path, options = {}) {
    if (!path.startsWith('/api/goform/')) throw new Error('原厂直连不提供此 UFI-TOOLS 功能，请切换到 KANO 连接');
    const headers = { referer: this.transport.address + '/', origin: new URL(this.transport.address).origin, ...options.headers };
    if (headers['Kano-Cookie']) { headers.Cookie = headers['Kano-Cookie']; delete headers['Kano-Cookie']; }
    return (await this.transport.request(path.slice(4), { ...options, headers })).data;
  }
  async loginOfficial() {
    if ((await this.getOfficial('loginfo')).loginfo === 'ok') return;
    if (!this.ztePassword) throw new Error('请填写中兴原厂后台口令');
    const { hashPassword } = require('./protocol.cjs');
    const { LD } = await this.getOfficial('LD'); if (!LD) throw new Error('原厂后台未提供 LD');
    const fields = { goformId: this.loginMethod, user: 'admin', password: hashPassword(hashPassword(this.ztePassword).toUpperCase() + LD).toUpperCase(), isTest: 'false' };
    if (this.loginMethod === 'LOGIN_MULTI_USER') fields.IP = 'localhost';
    const result = await this.transport.request('/goform/goform_set_cmd_process', { method: 'POST', body: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', referer: this.transport.address + '/', origin: new URL(this.transport.address).origin } });
    if (result.data.result !== 'success') throw new Error(`原厂登录失败（${result.data.result ?? result.data.Error ?? '未知响应'}），请检查口令和登录模式`);
    const cookies = result.headers['set-cookie']; this.cookie = (Array.isArray(cookies) ? cookies : [cookies]).filter(Boolean).map(v => v.split(';')[0]).join('; ');
    if (!this.cookie) throw new Error('原厂后台未返回会话 Cookie');
  }
  async connect() {
    await this.ensureOfficial();
    const info = await this.getOfficial(STATUS_FIELDS.join(','));
    this.version = { model: info.model_name || '中兴设备', nickname: '原厂后台', app_ver: '', mode: 'GOFORM' };
    return { version: this.version, base: this.base(info), mode: 'GOFORM' };
  }
  base(n) { return { monthly_data: n.monthly_rx_bytes != null && n.monthly_rx_bytes !== '' && n.monthly_tx_bytes != null && n.monthly_tx_bytes !== '' ? Number(n.monthly_rx_bytes) + Number(n.monthly_tx_bytes) : null, battery: n.battery_value, battery_vol_percent: n.battery_vol_percent }; }
  async snapshot() { const network = await this.official(STATUS_FIELDS.join(',')); return { at: Date.now(), version: this.version, base: this.base(network), network, connections: {}, warnings: [] }; }
}
module.exports = { GoformClient };
