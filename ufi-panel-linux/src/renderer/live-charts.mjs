import { drawSeries } from './chart.mjs';
import { ChartInspector } from './chart-inspector.mjs';
import { rate, display } from './format.mjs';

const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const charts = [
  { id:'traffic', title:'实时速率', series:[['down','#377a69','下载'],['up','#537ba8','上传']], floor:1024, unitBase:1024, format:rate },
  { id:'temperature', title:'CPU 温度', series:[['temperature','#bd8951']], floor:60, unit:'°C' },
  { id:'cpu', title:'CPU 使用率', series:[['cpu','#537ba8']], max:100, unit:'%' },
  { id:'memory', title:'内存使用率', series:[['memory','#377a69']], max:100, unit:'%' },
];

export class LiveCharts {
  constructor() {
    this.samples = []; this.windowMs = 300000; this.visible = false;
    this.charts = charts.map(config => {
      const canvas = $(config.id+'-chart'), card = canvas.closest('.card');
      card.classList.add('live-chart');
      const badge = document.createElement('small'); badge.className = 'chart-hover-status hidden'; badge.textContent = '画面已固定 · 采样继续'; card.append(badge);
      const chart = { config, canvas, card, badge, frozen:false, frame:null };
      chart.inspector = new ChartInspector(canvas, {
        ...config, format:config.format || (value => display(value)+' '+config.unit),
        onEnter:() => this.freeze(chart), onLeave:() => this.resume(chart),
      });
      return chart;
    });
    this.observer = new ResizeObserver(entries => {
      if (!this.visible) return;
      for (const chart of this.charts) if (entries.some(entry => entry.target === chart.canvas.parentElement)) this.render(chart,true);
    });
    for (const chart of this.charts) this.observer.observe(chart.canvas.parentElement);
  }
  update(samples, windowMs) {
    if (this.windowMs !== windowMs) this.release();
    this.samples = samples; this.windowMs = windowMs;
    if (this.visible) for (const chart of this.charts) if (!chart.frozen) this.render(chart);
  }
  setVisible(visible) {
    this.visible = visible;
    if (!visible) this.release();
  }
  freeze(chart) {
    if (!this.visible || document.hidden || !chart.frame?.points.length) return;
    chart.frozen = true; chart.card.classList.add('chart-frozen'); chart.badge.classList.remove('hidden');
  }
  resume(chart) {
    chart.inspector.hide(); chart.frozen = false;
    chart.card.classList.remove('chart-frozen'); chart.badge.classList.add('hidden');
    if (this.visible) this.render(chart);
  }
  release() {
    for (const chart of this.charts) {
      chart.inspector.hide(); chart.frozen = false;
      chart.card.classList.remove('chart-frozen'); chart.badge.classList.add('hidden');
    }
  }
  reset() {
    this.release(); this.samples = [];
    for (const chart of this.charts) { chart.frame = null; chart.inspector.update(null); }
  }
  render(chart, resize = false) {
    if (chart.frozen && !resize) return;
    const { config, canvas } = chart;
    const frozen = chart.frozen && chart.frame;
    const data = frozen ? chart.frame.points : this.samples;
    const result = drawSeries(canvas,data,{
      ...config, format:config.format || (value => value.toFixed(0)+config.unit), windowMs:this.windowMs,
      ...(frozen ? { from:chart.frame.from, to:chart.frame.to } : {}),
    });
    if (!result) return;
    chart.frame = result; chart.inspector.update(result);
    const current = result.points.at(-1);
    const empty = $(config.id === 'traffic' ? 'chart-placeholder' : config.id+'-chart-placeholder');
    empty.classList.toggle('hidden',result.values.length > 0);
    if (config.id === 'traffic') {
      text('download-speed',rate(current?.down)); text('upload-speed',rate(current?.up));
      text('chart-scale',result.count ? `上限 ${result.scale}` : '—');
      text('chart-duration',result.count > 1 ? `最近 ${result.duration < 60 ? `${result.duration || '不足 1'} 秒` : `${Math.floor(result.duration / 60)} 分 ${result.duration % 60} 秒`} · ${result.count} 次采样` : '等待后续采样');
      canvas.setAttribute('aria-label',`最近 ${result.count} 次采样；下载 ${rate(current?.down)}，上传 ${rate(current?.up)}`);
    } else {
      text(config.id+'-trend-summary',result.values.length ? `最低 ${Math.min(...result.values).toFixed(1)} · 最高 ${Math.max(...result.values).toFixed(1)} ${config.unit}` : '等待有效读数');
      text(config.id+'-trend-scale','0–'+result.scale);
      text(config.id+'-trend-current',display(current?.[config.id])+' '+config.unit);
      canvas.setAttribute('aria-label',`${config.title}，当前 ${display(current?.[config.id])} ${config.unit}；${result.values.length} 个有效读数`);
    }
    // If the first sample arrives under a stationary pointer, hold that first visible frame.
    if (canvas.matches(':hover')) this.freeze(chart);
  }
}
