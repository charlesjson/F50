import { number, byteParts, temperature } from './format.mjs';

const percentage = value => { const n = number(value); return n !== null && n >= 0 && n <= 100 ? n : null; };
const reading = (value, unit, digits = 1) => value === null ? ['—', ''] : [value.toFixed(digits), unit];
const rateParts = value => { const [amount, unit] = byteParts(value); return [amount, unit ? unit + '/s' : '']; };

export function sidebarReadings(snapshot) {
  const b = snapshot?.base || {}, n = snapshot?.network || {};
  const cpu = percentage(b.cpu_usage), memory = percentage(b.mem_usage), clients = number(n.wifi_access_sta_num);
  return {
    cpu: reading(cpu, '%'), memory: reading(memory, '%'), temperature: reading(temperature(b.cpu_temp), '°C'),
    daily: byteParts(b.daily_data), monthly: byteParts(b.monthly_data),
    download: rateParts(n.realtime_rx_thrpt), upload: rateParts(n.realtime_tx_thrpt),
    clients: clients !== null && Number.isInteger(clients) && clients >= 0 ? [String(clients), '台'] : ['—', ''],
  };
}

// A view of the shared telemetry stream. No timers, device reads or chart state.
export class SidebarTelemetry {
  constructor(root) {
    this.root = root;
    this.nodes = Object.fromEntries([...root.querySelectorAll('[id]')].map(node => [node.id.replace(/^sidebar-/, ''), node]));
    this.render(null);
  }
  render(snapshot, { connected = false, interval = 2000, stale = false } = {}) {
    const values = sidebarReadings(connected ? snapshot : null);
    for (const name of ['cpu', 'memory', 'temperature', 'daily', 'monthly', 'download', 'upload', 'clients']) {
      const node = this.nodes[name], [amount, unit] = values[name];
      const valueNode = node.querySelector('.sidebar-number'), unitNode = node.querySelector('.sidebar-unit');
      if (valueNode.textContent !== amount) valueNode.textContent = amount;
      if (unitNode.textContent !== unit) unitNode.textContent = unit;
      node.title = [amount, unit].filter(Boolean).join(' ');
    }
    const state = !connected ? 'offline' : stale ? 'stale' : !snapshot ? 'waiting' : interval === 0 ? 'paused' : 'live';
    this.root.dataset.state = state;
    const labels = { offline: '未连接', waiting: '等待采样', stale: '数据过期', paused: '已暂停', live: '实时' };
    const status = this.nodes['telemetry-status'];
    if (status.textContent !== labels[state]) status.textContent = labels[state];
    if (this.nodes['clients-button']) this.nodes['clients-button'].disabled = !connected;
    const at = connected ? number(snapshot?.at) : null;
    const time = at !== null && Number.isFinite(new Date(at).getTime()) ? new Date(at).toLocaleTimeString('zh-CN', { hour12: false }) : '';
    const updated = !connected ? '连接设备后显示' : time ? `${stale ? '上次成功' : '更新于'} ${time}` : '等待设备读数';
    if (this.nodes.updated.textContent !== updated) this.nodes.updated.textContent = updated;
    this.root.title = `${labels[state]}${time ? ' · ' + time : ''}${interval === 0 && connected ? ' · 可手动刷新' : ''}`;
  }
}
