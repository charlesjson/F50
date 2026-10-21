// Device values may be absent, numeric strings, or encoded JSON.
export function number(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
export const display = (value, digits = 1) => number(value) === null ? '—' : number(value).toFixed(digits);
export function byteParts(value) {
  let amount = number(value);
  if (amount === null || amount < 0) return ['—', ''];
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++; }
  return [amount.toFixed(unit ? 2 : 0), units[unit]];
}
export const bytes = value => byteParts(value).filter(Boolean).join(' ');
export const rate = value => number(value) === null || number(value) < 0 ? '—' : `${bytes(value)}/s`;
export const temperature = value => { const n = number(value); return n === null ? null : Math.abs(n) >= 1000 ? n / 1000 : n; };
export function parsed(value, fallback = {}) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}
export function cellularStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['ppp_connected', 'connected', 'ipv4_ipv6_connected', 'ipv4_connected', 'ipv6_connected'].includes(raw)) return '已连接';
  if (['ppp_disconnected', 'disconnected', 'disconnect'].includes(raw)) return '未连接';
  if (['ppp_connecting', 'connecting'].includes(raw)) return '连接中';
  return value || '—';
}
export function clientsFrom(data) {
  return [['station_list', 'Wi-Fi'], ['lan_station_list', '有线']].flatMap(([key, type]) => {
    const items = parsed(data[key], []);
    return Array.isArray(items) ? items.filter(d => d && typeof d === 'object').map(d => ({
      name: d.hostname || d.host_name || '未命名设备', ip: d.ip_addr || d.ip || '—', mac: d.mac_addr || d.mac || '—', type,
    })) : [];
  });
}
export function smsDate(value) {
  const raw = String(value || '');
  const parts = raw.split(',');
  if (parts.length < 6) return raw || '时间未知';
  const [year, month, day, hour, minute, second] = parts;
  return `${year.length === 2 ? '20' + year : year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`;
}
