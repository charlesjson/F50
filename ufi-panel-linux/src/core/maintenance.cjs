'use strict';
const { hashPassword } = require('./protocol.cjs');
const { url } = require('./transfers.cjs');
const READS = new Set(['updates', 'appearance', 'authentication', 'service', 'location', 'voice']);
const WRITES = new Set(['theme-save','theme-reset','file-delete','files-clear','ufi-password','official-password','resource-server','location-beep','tasks-clear','shutdown','nfc','wifi-sleep','usb-protocol','traffic-calibrate','one-click-shell','advanced-mode']);
const bounded = (value, min, max, label) => { const n = Number(value); if (value === '' || !Number.isFinite(n) || n < min || n > max) throw new Error(`${label}应在 ${min}–${max} 之间`); return n; };
const string = (value, label, max = 2048) => { if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error(`${label}格式无效`); return value; };
const boolean = value => { if (![true, false, 'true', 'false', '0', '1'].includes(value)) throw new Error('无效开关'); return value === true || value === 'true' || value === '1'; };
const success = result => { if (result?.result != null && !['success','true','removed','cleared','added'].includes(String(result.result))) throw new Error(`设备未接受操作：${result.result}`); return result; };
class Maintenance {
  constructor(client) { this.client = client; }
  async read(name, input = {}) {
    const c = this.client;
    switch (name) {
      case 'updates': {
        const data = await c.api('/api/check_update', { timeout: 30000 });
        if (data.alist_res?.code && data.alist_res.code !== 200) throw new Error(data.alist_res.message || '更新源读取失败');
        return { currentVersion: c.version?.app_ver || '未知', baseUri: data.base_uri, files: (data.alist_res?.data?.content || []).filter(f => !f.is_dir && /\.apk$/i.test(f.name)), changelog: String(data.changelog || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '') };
      }
      case 'appearance': return c.api('/api/get_theme');
      case 'authentication': return c.mode === 'GOFORM' ? { mode: 'GOFORM' } : { ...(await c.api('/api/need_token')), ...(await c.api('/api/is_weak_token')) };
      case 'service': return c.api('/api/get_res_server');
      case 'location': return c.api('/api/get_current_location');
      case 'voice': {
        const slot = String(input.slot ?? '0'); if (!['0','1'].includes(slot)) throw new Error('无效卡槽');
        const results = await Promise.allSettled(['volte', 'vonr'].map(type => c.api(`/api/${type}_status?slot=${slot}`)));
        const response = { slot, warnings: [] };
        results.forEach((r,i) => { const type = ['volte','vonr'][i]; if (r.status === 'fulfilled') response[type] = r.value; else response.warnings.push(`${type}: ${r.reason.message}`); });
        if (!response.volte && !response.vonr) throw new Error(response.warnings.join('；')); return response;
      }
      default: throw new Error('未知维护功能');
    }
  }
  async packageUrl(name) {
    const data = await this.read('updates');
    if (!data.files.some(f => f.name === name) || /[/\\]/.test(name)) throw new Error('安装包不在当前更新目录内');
    return url(data.baseUri.replace(/\/$/, '') + '/' + encodeURIComponent(name));
  }
  prepare(name, input = {}) {
    const c = this.client; let title, detail = '', run;
    const post = (endpoint, body) => async () => success(await c.api(endpoint, { method: 'POST', ...(body === undefined ? {} : { body }) }));
    switch (name) {
      case 'theme-save': {
        const body = {};
        for (const key of ['backgroundEnabled','blurSwitch','overlaySwitch']) body[key] = String(boolean(input[key]));
        const background = string(input.backgroundUrl || '', '背景地址');
        if (background && !/^\/api\/uploads\/[\w.-]+$/.test(background) && !/^\/uploads\/[\w.-]+$/.test(background)) url(background);
        body.backgroundUrl = background;
        const color = string(input.textColor, '文字颜色', 80);
        if (!/^(#[a-f\d]{3,8}|rgba?\([\d.,\s%]+\))$/i.test(color)) throw new Error('文字颜色需为 HEX 或 rgb/rgba');
        body.textColor = color;
        for (const key of ['textColorPer','themeColor','colorPer','saturationPer','brightPer','opacityPer']) body[key] = String(bounded(input[key], 0, key === 'themeColor' ? 360 : 100, key));
        title = '保存设备网页主题'; detail = '修改 UFI 网页外观；Electron 客户端外观保持独立。'; run = post('/api/set_theme', body); break;
      }
      case 'theme-reset': title = '恢复设备网页默认主题'; run = post('/api/set_theme', {}); break;
      case 'file-delete': {
        const name = string(input.name, '文件名', 200); if (!/^[\w.-]+$/.test(name) || name.includes('..')) throw new Error('只允许上传目录中的单个文件名');
        title = '删除设备上传文件'; detail = name; run = post('/api/delete_img', { file_name: name }); break;
      }
      case 'files-clear': title = '清空设备上传目录'; detail = '删除所有背景和上传文件，此操作无法恢复。'; run = post('/api/delete_all_uploads_data'); break;
      case 'ufi-password': {
        const password = string(input.password, '新口令', 128);
        if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,128}$/.test(password) || password !== input.repeat) throw new Error('两次新口令须相同，包含字母和数字，长度为 8–128');
        title = '修改 UFI-TOOLS 管理口令'; detail = '修改后将更新当前连接使用的凭据；其他客户端需重新登录。';
        run = async () => {
          const result = await post('/api/set_token', { token: password })();
          c.transport.authorization = hashPassword(password);
          c.changedCredentials = { token: c.transport.authorization, password: undefined };
          return result;
        }; break;
      }
      case 'official-password': {
        const old = string(input.old, '旧中兴口令', 256), password = string(input.password, '新中兴口令', 128);
        if (!old || password.length < 6 || password !== input.repeat) throw new Error('请填写旧口令和两次相同的新口令（至少 6 位）');
        title = '修改中兴原厂后台口令'; detail = '修改后原厂会话失效；设备内保存的自动化口令可能需要重新配置。';
        run = async () => { const result = await c.postOfficial({ goformId: 'CHANGE_PASSWORD', oldPassword: hashPassword(old).toUpperCase(), newPassword: hashPassword(password).toUpperCase() }); c.ztePassword = password; c.cookie = ''; c.changedCredentials = { ztePassword: password }; return result; }; break;
      }
      case 'resource-server': title = '修改 UFI 资源服务器'; detail = url(input.address); run = post('/api/set_res_server', { res_server: detail }); break;
      case 'location-beep': title = '播放设备提示音'; run = post('/api/beep_my_device', { beep: '1' }); break;
      case 'tasks-clear': title = '清空设备定时任务'; detail = '删除全部已保存任务，无法恢复。'; run = post('/api/clear_task'); break;
      case 'shutdown': title = '关闭设备'; detail = '关机后将无法通过本客户端远程开机。'; run = () => c.postOfficial({ goformId: 'SHUTDOWN_DEVICE' }); break;
      case 'nfc': title = '修改 NFC 开关'; run = () => c.postOfficial({ goformId: 'WIFI_NFC_SET', web_wifi_nfc_switch: boolean(input.enabled) ? '1' : '0' }); break;
      case 'wifi-sleep': title = '设置 Wi-Fi 休眠'; run = () => c.postOfficial({ goformId: 'SET_WIFI_SLEEP_INFO', sleep_sysIdleTimeToSleep: String(bounded(input.minutes, 0, 1440, '分钟')) }); break;
      case 'usb-protocol': title = '切换 USB 网络协议'; detail = '可能断开当前 USB 网络；值由设备固件定义。'; run = () => c.postOfficial({ goformId: 'SET_USB_NETWORK_PROTOCAL', usb_network_protocal: String(bounded(input.value, 0, 5, '协议值')) }); break;
      case 'traffic-calibrate': title = '手动校准原厂流量'; detail = `已用流量设置为 ${input.gb} GB`; run = () => c.postOfficial({ goformId: 'FLOW_CALIBRATION_MANUAL', calibration_way: 'data', time: '0', data: String(Math.round(bounded(input.gb, 0, 100000, '流量') * 1024 ** 3)) }); break;
      case 'one-click-shell': title = '执行一键工程 Shell'; detail = '设备将进入工程模式并执行 /sdcard/one_click_shell.sh，可能暂时异常。'; run = () => c.api('/api/one_click_shell', { timeout: 180000 }); break;
      case 'advanced-mode': title = '配置设备高级功能'; detail = '改变设备高级模式基础设施，执行前确认该固件支持。'; run = () => c.api(`/api/smbPath?enable=${boolean(input.enabled) ? '1' : '0'}`, { timeout: 60000 }); break;
      default: throw new Error('未知维护操作');
    }
    return { title, detail, run };
  }
}
module.exports = { Maintenance, READS, WRITES };
