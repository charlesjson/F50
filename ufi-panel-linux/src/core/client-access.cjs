'use strict';
const { createHash } = require('node:crypto');

const FIELDS = ['AclMode', 'WhiteMacList', 'BlackMacList', 'WhiteNameList', 'BlackNameList'];
const CLIENT_FIELDS = 'station_list,lan_station_list,hostNameList,queryDeviceAccessControlList';
const array = value => {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } }
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : null;
};
const mac = value => {
  if (typeof value !== 'string' || !/^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(value) ||
      value === '00:00:00:00:00:00' || (parseInt(value.slice(0,2),16) & 1)) throw new Error('无效的终端 MAC 地址');
  return value.toUpperCase();
};
const label = (value, fallback) => typeof value === 'string' && value.trim() ? value.replace(/[;\0\r\n]/g,' ').slice(0,64) : fallback;
function accessFrom(data) {
  const unavailable = reason => ({ supported: false, reason, blocked: [], revision: null });
  if (!FIELDS.every(key => typeof data[key] === 'string')) return { public: unavailable('设备未提供完整的终端黑名单接口，仍可查看在线终端。') };
  const config = Object.fromEntries(FIELDS.map(key => [key,data[key]]));
  // Keep whitelist fields byte-for-byte. This operation only edits one blacklist entry.
  const addresses = config.BlackMacList ? config.BlackMacList.split(';') : [];
  const names = config.BlackNameList.split(';');
  if (addresses.at(-1) === '') addresses.pop();
  if (names.length > addresses.length && names.at(-1) === '') names.pop();
  if (addresses.length > 256 || names.length > addresses.length || !addresses.every(v => { try { mac(v); return true; } catch { return false; } })) {
    return { public: unavailable('设备黑名单格式异常，请先在设备网页中检查。') };
  }
  const blocked = addresses.map((address,i) => ({ mac: address, name: names[i] || '' }));
  const revision = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  const supported = config.AclMode.trim() === '2';
  return { config, blocked, revision, public: { supported, revision, blocked,
    reason: supported ? '' : '当前访问控制未处于黑名单模式。请在设备网页中检查；客户端会保留现有模式和白名单。' } };
}

class ClientAccess {
  constructor(client) { this.client = client; this.snapshot = null; }
  async read() {
    let data;
    try {
      data = await this.client.official(CLIENT_FIELDS);
      if (!data || typeof data !== 'object' || Array.isArray(data) || (!Object.hasOwn(data,'station_list') && !Object.hasOwn(data,'lan_station_list'))) throw new Error('设备未返回终端列表');
    } catch {
      // Older firmwares can reject the entire combined query for an unknown
      // field. Retain the original read-only list even without ACL support.
      data = await this.client.official('station_list,lan_station_list,hostNameList');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('设备返回了无效的终端列表');
    const access = accessFrom(data);
    this.snapshot = { ...access, stations: array(data.station_list) };
    const visible = { ...data, clientAccess: access.public };
    for (const key of FIELDS) delete visible[key];
    return visible;
  }
  prepare(action, input) {
    if (!['client-block','client-unblock'].includes(action)) throw new Error('未知终端访问控制操作');
    const target = mac(input.mac), snapshot = this.snapshot;
    if (!snapshot?.public.supported) throw new Error(snapshot?.public.reason || '请先刷新终端列表后再操作');
    if (typeof input.revision !== 'string' || input.revision !== snapshot.revision) throw new Error('终端访问控制已变化，请刷新列表后再操作');
    const blocking = action === 'client-block';
    const blocked = snapshot.blocked.find(item => mac(item.mac) === target);
    const station = snapshot.stations?.find(item => {
      try { return mac(item.mac_addr ?? item.mac) === target; } catch { return false; }
    });
    if (blocking && !station) throw new Error('此终端不在当前 Wi-Fi 列表中，请刷新后再操作');
    if (blocking && blocked) throw new Error('此终端已在黑名单中，请刷新列表');
    if (!blocking && !blocked) throw new Error('此终端不在黑名单中，请刷新列表');
    const name = label(blocking ? station.hostname || station.host_name : blocked.name,'未命名设备');
    const ip = label(station?.ip_addr || station?.ip,'—');
    const expectedRevision = snapshot.revision;
    return {
      title: blocking ? '踢出并拉黑 Wi-Fi 终端' : '解除终端黑名单',
      detail: `终端：${name}\nIP：${ip}\nMAC：${target}\n\n${blocking ?
        '加入设备黑名单后会阻止该终端连接，并持续禁止重连，直到在黑名单中解除。\n若这是当前管理电脑，连接可能中断，可通过有线或 USB 网络重新连接并解除。' :
        '仅移除此 MAC 的黑名单记录，之后终端可使用正确的 Wi-Fi 口令重新连接。'}`,
      run: async () => {
        await this.read();
        const fresh = this.snapshot;
        if (!fresh.public.supported || fresh.revision !== expectedRevision) throw new Error('黑名单或访问控制已由其他页面修改，请刷新后重新确认');
        if (blocking && !fresh.stations?.some(item => { try { return mac(item.mac_addr ?? item.mac) === target; } catch { return false; } })) {
          throw new Error('目标已离线或连接方式已变化，请刷新终端列表后重新确认');
        }
        const entries = blocking ? [...fresh.blocked,{ mac: target, name }] : fresh.blocked.filter(item => mac(item.mac) !== target);
        if (entries.length > 256) throw new Error('设备黑名单条目过多，请先检查并移除不再需要的记录');
        const result = await this.client.postOfficial({ goformId: 'setDeviceAccessControlList', ...fresh.config,
          BlackMacList: entries.map(item => item.mac).join(';'), BlackNameList: entries.map(item => item.name).join(';') });
        this.snapshot = null;
        return result;
      },
    };
  }
}
module.exports = { ClientAccess };
