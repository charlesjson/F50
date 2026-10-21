import { bytes, byteParts, rate, display } from './format.mjs';
import { drawSeries } from './chart.mjs';
import { ChartInspector } from './chart-inspector.mjs';

const $ = id => document.getElementById(id);
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const date = at => at == null ? '—' : dateFormatter.format(new Date(at));
export function localDateTime(at) {
  const d = new Date(at), pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function historyRange(from, to) {
  const start = new Date(from).getTime(), end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('请选择有效的时间范围，结束时间须晚于开始时间');
  return { from: start, to: end };
}
function usageAxis(value, step) {
  const [,unit] = byteParts(value), size = 1024 ** ['B','KB','MB','GB','TB'].indexOf(unit);
  const digits = unit === 'B' ? 0 : Math.max(2,Math.min(12,Math.ceil(Math.log10(size/Math.max(1,step)))));
  return `${(value/size).toFixed(digits)} ${unit}`;
}
const usage = { fit:true, floor:1024, unitBase:1024, format:usageAxis, formatReading:bytes, note:'纵轴按读数缩放；空白处为缺失采样。' };
export const historyCharts = [
  { id: 'rate', title: '上下行网速', wide:true, series: [['down','#377a69','下载'],['up','#537ba8','上传']], floor: 1024, unitBase: 1024, format: rate },
  { id: 'cpu', title: 'CPU 使用率', series: [['cpu','#537ba8']], max: 100, format: v => `${v.toFixed(0)}%`, formatReading: v => `${display(v)}%` },
  { id: 'memory', title: '内存使用率', series: [['memory','#377a69']], max: 100, format: v => `${v.toFixed(0)}%`, formatReading: v => `${display(v)}%` },
  { id: 'temperature', title: 'CPU 温度', wide:true, series: [['temperature','#bd8951']], floor: 60, format: v => `${v.toFixed(0)}°C`, formatReading: v => `${display(v)}°C` },
  { ...usage, id:'daily-usage', title:'当日累计流量', series:[['dailyBytes','#377a69','当日累计']] },
  { ...usage, id:'monthly-usage', title:'当月累计流量', series:[['monthlyBytes','#537ba8','当月累计']] },
];

export class HistoryUI {
  constructor({ profile, changed }) {
    this.profile = profile; this.changed = changed; this.revision = 0; this.visible = false;
    this.busy = false; this.devices = []; this.result = null; this.page = 0;
    this.inspectors = new Map();
    this.preset();
    $('history-query').addEventListener('submit', event => { event.preventDefault(); this.load(); });
    $('history-device').addEventListener('change', () => this.load());
    $('history-preset').addEventListener('change', () => { this.preset(); this.load(); });
    for (const id of ['history-from','history-to']) $(id).addEventListener('input', () => { $('history-preset').value = 'custom'; });
    $('history-previous').addEventListener('click', () => { this.page--; this.table(); });
    $('history-next').addEventListener('click', () => { this.page++; this.table(); });
    const root = $('history-charts');
    for (const config of historyCharts) {
      const card = document.createElement('article'); card.className = 'card history-chart';
      if (config.wide) card.classList.add('history-chart-wide');
      const heading = document.createElement('div'); heading.className = 'card-heading';
      const title = document.createElement('h3'); title.textContent = config.title;
      const scale = document.createElement('span'); scale.id = `history-${config.id}-scale`; scale.className = 'muted';
      heading.append(title,scale);
      const wrap = document.createElement('div'); wrap.className = 'chart-wrap';
      const canvas = document.createElement('canvas'); canvas.id = `history-${config.id}-chart`; canvas.setAttribute('aria-label',config.title);
      const placeholder = document.createElement('div'); placeholder.className = 'chart-placeholder'; placeholder.id = `history-${config.id}-empty`; placeholder.textContent = '此范围尚无有效读数';
      wrap.append(canvas,placeholder); card.append(heading,wrap);
      const axis = document.createElement('div'); axis.className = 'chart-axis';
      const start = document.createElement('span'), end = document.createElement('span');
      start.dataset.historyStart = ''; end.dataset.historyEnd = ''; axis.append(start,end); card.append(axis);
      if (config.note) { const note = document.createElement('p'); note.className = 'muted history-chart-note'; note.textContent = config.note; card.append(note); }
      root.append(card);
      const inspector = new ChartInspector(canvas, { ...config, format:config.formatReading || config.format, onSelect:point => this.showReading(point,canvas) });
      this.inspectors.set(canvas,inspector);
    }
    const observer = new ResizeObserver(() => { if (this.visible) this.draw(); });
    for (const card of root.children) observer.observe(card);
  }
  preset() {
    const hours = Number($('history-preset').value);
    if (!hours) return;
    const now = Date.now();
    $('history-from').value = localDateTime(now-hours*3600000);
    // The upper bound is exclusive, including observations from this second.
    $('history-to').value = localDateTime(now+1000);
  }
  status(message, error = false) {
    $('history-status').textContent = message;
    $('history-status').classList.toggle('history-error',error);
  }
  setBusy(value) {
    this.busy = value;
    $('history-fields').disabled = value;
    $('view-history').setAttribute('aria-busy',String(value));
    this.changed();
  }
  async open() {
    this.visible = true;
    await this.refresh();
  }
  leave() { this.visible = false; this.revision++; this.hideCursor(); this.setBusy(false); }
  async refresh() {
    if (this.busy) return;
    if (!window.ufi.historyDevices) { this.status('历史监控需要使用 Tauri 客户端。',true); return; }
    const revision = ++this.revision; this.setBusy(true); this.status('正在读取本地记录…');
    try {
      const data = await window.ufi.historyDevices();
      if (revision !== this.revision) return;
      this.devices = data.devices;
      const select = $('history-device'), previous = select.value, active = this.profile();
      select.replaceChildren();
      for (const device of data.devices) {
        const option = document.createElement('option'); option.value = String(device.id);
        option.textContent = `${device.name} · ${device.mode} · ${device.address}`; select.append(option);
      }
      if (data.devices.some(d => String(d.id) === previous)) select.value = previous;
      else {
        const current = data.devices.find(d => d.address === active?.address && d.mode === (active?.mode || 'KANO'));
        if (current) select.value = String(current.id);
      }
      $('history-storage').textContent = `本地记录占用 ${bytes(data.databaseBytes)} · 原始采样长期保留`;
      $('history-storage').title = data.path;
      if (data.error) this.status(`部分记录未保存：${data.error}`,true);
      this.recordingError = data.error;
      this.setBusy(false);
      if (!data.devices.length) {
        this.result = null; this.render(); this.status('还没有历史记录。连接设备后会自动记录，之后可离线查看。');
        return;
      }
      this.preset();
      await this.load();
    } catch (error) {
      if (revision === this.revision) this.status(`读取历史失败：${error.message}`,true);
    } finally { if (revision === this.revision) this.setBusy(false); }
  }
  async load() {
    if (this.busy || !$('history-device').value) return;
    const revision = ++this.revision;
    try {
      const range = historyRange($('history-from').value,$('history-to').value);
      this.setBusy(true); this.status('正在查询本地历史…');
      const result = await window.ufi.historyQuery({ deviceId: Number($('history-device').value), ...range, raw: $('history-resolution').value === 'raw' });
      if (revision !== this.revision) return;
      this.recordingError = result.recordingError;
      this.result = result; this.page = 0; this.render();
      const summary = result.summary;
      const resolution = result.resolutionMs ? `图表每点约 ${Math.max(1,Math.round(result.resolutionMs/1000))} 秒的平均值；峰值按原始采样统计` : '显示每次原始采样';
      this.status(summary.count ? `${summary.count.toLocaleString()} 次采样 · ${summary.failures} 次采集失败 · ${resolution}${this.recordingError ? '；部分记录未保存：'+this.recordingError : ''}` : '所选时间范围内没有采样，请调整日期或设备。',!!this.recordingError);
    } catch (error) {
      if (revision === this.revision) {
        this.result = null; this.render(); this.status(`查询失败：${error.message}`,true);
      }
    } finally { if (revision === this.revision) this.setBusy(false); }
  }
  render() {
    const summary = this.result?.summary;
    const cards = [
      ['CPU 平均 / 最高',summary ? `${display(summary.cpu.average)} / ${display(summary.cpu.max)} %` : '—'],
      ['内存平均 / 最高',summary ? `${display(summary.memory.average)} / ${display(summary.memory.max)} %` : '—'],
      ['温度平均 / 最高',summary ? `${display(summary.temperature.average)} / ${display(summary.temperature.max)} °C` : '—'],
      ['下载 / 上传峰值',summary ? `${rate(summary.down.max)} / ${rate(summary.up.max)}` : '—'],
      ['末次当日 / 当月累计',summary ? `${bytes(summary.dailyBytes)} / ${bytes(summary.monthlyBytes)}` : '—'],
    ];
    const root = $('history-summary'); root.replaceChildren();
    for (const [label,value] of cards) {
      const card = document.createElement('div'); card.className = 'history-stat';
      const title = document.createElement('span'); title.textContent = label;
      const strong = document.createElement('strong'); strong.textContent = value; card.append(title,strong); root.append(card);
    }
    $('history-cursor').textContent = summary?.count ? `实际记录：${date(summary.firstAt)} 至 ${date(summary.lastAt)}。移动到曲线上查看读数，也可在下表逐项查看。` : '尚无采样数据';
    this.table(); this.draw();
  }
  draw() {
    this.hideCursor();
    if (!this.visible) return;
    const points = this.result?.points || [], from = this.result?.from, to = this.result?.to;
    for (const config of historyCharts) {
      const canvas = $(`history-${config.id}-chart`);
      const result = drawSeries(canvas,points,{ ...config, from, to });
      if (!result) continue;
      this.inspectors.get(canvas).update(result);
      const axis = canvas.closest('.history-chart').querySelector('.chart-axis');
      axis.style.paddingLeft = `${result.plot.left}px`; axis.style.paddingRight = '4px';
      $(`history-${config.id}-empty`).classList.toggle('hidden',result.values.length > 0);
      $(`history-${config.id}-scale`).textContent = result.values.length ? `${result.scaleMin}–${result.scale}` : '—';
      canvas.setAttribute('aria-label',`${config.title}，${points.length} 个显示点；详细读数见下方记录表`);
    }
    for (const node of document.querySelectorAll('[data-history-start]')) node.textContent = from == null ? '' : date(from);
    for (const node of document.querySelectorAll('[data-history-end]')) node.textContent = to == null ? '' : date(to);
  }
  showReading(p, canvas) {
    for (const [other,inspector] of this.inspectors) if (other !== canvas) inspector.hide();
    $('history-cursor').textContent = `${date(p.firstAt)}${p.count>1 ? ' 至 '+date(p.lastAt)+' · '+p.count+' 次采样' : ''} · CPU ${display(p.cpu)}% · 内存 ${display(p.memory)}% · ${display(p.temperature)}°C · 下载 ${rate(p.down)} · 上传 ${rate(p.up)} · 当日 ${bytes(p.dailyBytes)} · 当月 ${bytes(p.monthlyBytes)}`;
  }
  hideCursor() { for (const inspector of this.inspectors.values()) inspector.hide(); }
  table() {
    const points = this.result?.points || [], pages = Math.max(1,Math.ceil(points.length/100));
    this.page = Math.max(0,Math.min(pages-1,this.page));
    const body = $('history-rows'); body.replaceChildren();
    for (const p of points.slice(this.page*100,(this.page+1)*100)) {
      const row = document.createElement('tr');
      const values = [date(p.lastAt),display(p.cpu)+' %',display(p.memory)+' %',display(p.temperature)+' °C',rate(p.down),rate(p.up),bytes(p.dailyBytes),bytes(p.monthlyBytes),display(p.clients,0),display(p.battery)+' %',display(p.lteRsrp)+' / '+display(p.nrRsrp)];
      for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      row.firstChild.title = `${date(p.firstAt)} 至 ${date(p.lastAt)} · ${p.count} 次采样 · ${p.failures} 次失败`;
      body.append(row);
    }
    if (!points.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 11; cell.className = 'empty'; cell.textContent = '此范围没有记录'; row.append(cell); body.append(row); }
    $('history-page').textContent = `第 ${this.page+1} / ${pages} 页 · ${points.length} 个显示点`;
    $('history-previous').disabled = !this.page;
    $('history-next').disabled = this.page+1 >= pages;
  }
}
