import { number, parsed } from './format.mjs';
function ratOf(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (['16','NR','5G','5G NR','NR-SA','NR-NSA','5G SA','5G NSA','NR5G-SA','NR5G-NSA'].includes(text)) return '16';
  if (['12','LTE','4G','4G LTE'].includes(text)) return '12';
  return '';
}
export function neighborCells(raw, networkType = '') {
  const rows = parsed(raw, []);
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => row && typeof row === 'object').map(row => {
    const rawRat = row.rat ?? row.network_type ?? row.type;
    const explicit = ratOf(rawRat);
    const bandText = String(row.band ?? '').trim();
    const band = number(bandText.replace(/^[bn]/i, ''));
    const byBand = /^n\d+$/i.test(bandText) ? '16' : /^b\d+$/i.test(bandText) ? '12' : '';
    const rat = explicit || (rawRat != null && String(rawRat).trim() ? '' : byBand || ratOf(networkType));
    const pci = number(row.pci), earfcn = number(row.earfcn ?? row.arfcn ?? row.narfcn);
    const validPci = Number.isInteger(pci) && pci >= 0 && pci <= (rat === '12' ? 503 : 1007);
    const validChannel = Number.isInteger(earfcn) && earfcn >= 0 && earfcn <= 3279165;
    return { rat, ratSource: explicit || byBand ? '设备条目' : rat ? '当前网络制式' : '待选择', band, pci, earfcn,
      rsrp: number(row.rsrp ?? row.rsrp_dbm), rsrq: number(row.rsrq ?? row.rsrq_db), sinr: number(row.sinr ?? row.sinr_db),
      reason: !validPci ? '缺少有效 PCI' : !validChannel ? '缺少有效频点' : '',
    };
  });
}
