import { rate } from './format.mjs';

function automaticStep(range, unitBase) {
  range = Math.max(1,range);
  const unit = unitBase > 1 ? unitBase ** Math.max(0,Math.floor(Math.log(range) / Math.log(unitBase))) : 1;
  const step = range / unit / 4;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const fraction = step / magnitude;
  const rounded = [1,1.5,2,2.5,5,7.5,10].find(value => fraction <= value + 1e-10);
  return rounded * magnitude * unit;
}

// Draw the actual observation times; missing values split a line instead of becoming zero.
export function drawSeries(canvas, samples, { series, min = 0, max, floor = 1, unitBase = 1, fit = false, format = String, windowMs = 300000, from, to } = {}) {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return null;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const end = to ?? (samples.at(-1)?.at ?? Date.now());
  const visible = samples.filter(sample => sample.at >= (from ?? end - windowMs) && sample.at <= end);
  const values = visible.flatMap(sample => series.map(([key]) => sample[key])).filter(Number.isFinite);
  let peak = fit && values.length ? -Infinity : floor, lowest = Infinity;
  for (const value of values) { peak = Math.max(peak,value); lowest = Math.min(lowest,value); }
  let lower = min, ceiling = max ?? min + automaticStep(peak * 1.1 - min,unitBase) * 4;
  if (fit && max == null && values.length) {
    // Fit each cumulative counter to its observed range, preserving absolute values.
    const span = Math.max(floor,peak-lowest,peak === lowest ? Math.abs(peak)*0.001 : 0), padding = span * 0.1;
    const step = automaticStep(span + padding * 2,unitBase);
    lower = Math.max(min,Math.floor((lowest-padding)/step)*step);
    ceiling = Math.max(lower+step*4,Math.ceil((peak+padding)/step)*step);
  }
  const style = getComputedStyle(canvas);
  ctx.font = `10px ${style.getPropertyValue('--mono').trim() || 'monospace'}`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const tickStep = (ceiling-lower)/4;
  const ticks = Array.from({ length: 5 }, (_, i) => format(ceiling - i * tickStep,tickStep));
  const left = Math.min(Math.ceil(Math.max(...ticks.map(label => ctx.measureText(label).width))) + 12, width * 0.45);
  const right = width - 4, top = 7, bottom = height - 7;
  ctx.strokeStyle = style.getPropertyValue('--line').trim() || '#e8ebee'; ctx.lineWidth = 1;
  ctx.fillStyle = style.getPropertyValue('--muted').trim() || '#66717b';
  for (const [i, label] of ticks.entries()) {
    const y = top + i * (bottom - top) / 4;
    ctx.fillText(label, left - 8, y, left - 10);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.stroke();
  const start = from ?? (visible.length > 1 ? visible[0].at : end - 2000);
  for (const [key, color] of series) {
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.8;
    let drawing = false, last, previous, segmentCount = 0;
    const dots = [];
    const endSegment = () => { if (segmentCount === 1) dots.push(last); segmentCount = 0; drawing = false; };
    for (const sample of visible) {
      if (sample.breakBefore || previous?.breakAfter || sample[key+'Gaps'] || previous?.[key+'Gaps']) endSegment();
      previous = sample;
      if (!Number.isFinite(sample[key])) { endSegment(); last = null; continue; }
      const x = left + (sample.at - start) / Math.max(1, end - start) * (right - left);
      const y = bottom - (Math.min(ceiling, Math.max(lower, sample[key])) - lower) / Math.max(1, ceiling - lower) * (bottom - top);
      if (drawing) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      drawing = true; segmentCount++; last = { x, y };
    }
    endSegment();
    ctx.stroke();
    if (last && dots.at(-1) !== last) dots.push(last);
    if (dots.length) {
      ctx.beginPath();
      for (const dot of dots) { ctx.moveTo(dot.x + 2.5,dot.y); ctx.arc(dot.x,dot.y,2.5,0,Math.PI * 2); }
      ctx.fillStyle = color; ctx.fill();
    }
  }
  return { scale: format(ceiling,tickStep), scaleMin: format(lower,tickStep), duration: visible.length > 1 ? Math.round((end - start) / 1000) : 0, count: visible.length, values, points: visible, from: start, to: end, plot: { left, right, top, bottom, min: lower, max: ceiling } };
}
export const drawTraffic = (canvas, samples, windowMs) => drawSeries(canvas, samples, { series: [['down', '#377a69'], ['up', '#537ba8']], floor: 1024, unitBase: 1024, format: rate, windowMs });
