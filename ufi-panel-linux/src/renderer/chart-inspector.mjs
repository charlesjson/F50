const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const date = at => at == null ? '—' : dateFormatter.format(new Date(at));

// Inspect the exact samples and time range used to draw a chart, including a frozen frame.
export class ChartInspector {
  constructor(canvas, { series, title, format, onSelect, onEnter, onLeave }) {
    this.canvas = canvas; this.format = format; this.onSelect = onSelect;
    const cursor = document.createElement('div'); cursor.className = 'chart-cursor hidden';
    const tooltip = document.createElement('div'); tooltip.className = 'chart-tooltip'; tooltip.id = `${canvas.id}-tooltip`; tooltip.setAttribute('role','tooltip');
    canvas.classList.add('inspectable-chart'); canvas.setAttribute('aria-describedby',tooltip.id);
    const timestamp = document.createElement('div'); timestamp.className = 'chart-tooltip-time'; tooltip.append(timestamp);
    this.readings = series.map(([key,color,label]) => {
      const row = document.createElement('div'); row.className = 'chart-tooltip-row';
      const name = document.createElement('span'); name.className = 'chart-tooltip-label';
      const dot = document.createElement('i'); dot.className = 'metric-dot'; dot.style.backgroundColor = color;
      name.append(dot,document.createTextNode(label || title));
      const value = document.createElement('strong'); row.append(name,value); tooltip.append(row);
      const marker = document.createElement('i'); marker.className = 'chart-sample-marker hidden'; marker.style.backgroundColor = color; marker.setAttribute('aria-hidden','true'); cursor.append(marker);
      return { key, value, marker };
    });
    const note = document.createElement('div'); note.className = 'chart-tooltip-note'; tooltip.append(note);
    cursor.append(tooltip); canvas.parentElement.append(cursor);
    this.cursor = cursor; this.tooltip = tooltip; this.timestamp = timestamp; this.note = note;
    canvas.addEventListener('mouseenter', () => onEnter?.());
    canvas.addEventListener('mousemove', event => this.queue(event));
    canvas.addEventListener('mouseleave', () => { this.hide(); onLeave?.(); });
  }
  update(frame) {
    this.hide(); this.frame = frame; this.point = null;
    if (frame) this.tooltip.style.maxWidth = `${Math.max(1,Math.min(280,frame.plot.right-frame.plot.left-8))}px`;
  }
  queue(event) {
    this.pending = { clientX:event.clientX, clientY:event.clientY };
    if (this.animation != null) return;
    this.animation = requestAnimationFrame(() => {
      this.animation = null;
      const pending = this.pending; this.pending = null;
      if (pending) this.inspect(pending);
    });
  }
  inspect(event) {
    const { points, plot, from, to } = this.frame || {};
    if (!points?.length) { this.hide(); return; }
    const bounds = this.canvas.getBoundingClientRect(), pointerX = event.clientX-bounds.left;
    if (pointerX < plot.left || pointerX > plot.right) { this.hide(); return; }
    const at = from + (pointerX-plot.left)/(plot.right-plot.left)*(to-from);
    let low = 0, high = points.length-1;
    while (low < high) { const middle = Math.floor((low+high)/2); if (points[middle].at < at) low = middle+1; else high = middle; }
    const point = low && at-points[low-1].at < points[low].at-at ? points[low-1] : points[low];
    const x = plot.left + Math.max(0,Math.min(1,(point.at-from)/Math.max(1,to-from))) * (plot.right-plot.left);
    this.cursor.style.left = `${x}px`; this.cursor.style.top = `${plot.top}px`; this.cursor.style.height = `${plot.bottom-plot.top}px`;
    this.cursor.classList.remove('hidden');
    if (this.point !== point) {
      this.timestamp.textContent = `${date(point.firstAt ?? point.at)}${point.count>1 ? ' 至 '+date(point.lastAt ?? point.at) : ''}`;
      for (const { key, value, marker } of this.readings) {
        const valid = Number.isFinite(point[key]);
        value.textContent = valid ? this.format(point[key]) : '—'; marker.classList.toggle('hidden',!valid);
        if (valid) marker.style.top = `${(plot.max-Math.min(plot.max,Math.max(plot.min,point[key]))) / Math.max(1,plot.max-plot.min) * (plot.bottom-plot.top)}px`;
      }
      this.note.textContent = point.count>1 ? `汇总 ${point.count} 次采样` : '';
      this.width = this.tooltip.offsetWidth; this.height = this.tooltip.offsetHeight; this.point = point;
    }
    const preferred = x+12+this.width <= plot.right ? x+12 : x-this.width-12;
    this.tooltip.style.left = `${Math.max(plot.left,Math.min(preferred,plot.right-this.width))-x}px`;
    this.tooltip.style.top = `${Math.max(plot.top,Math.min(event.clientY-bounds.top-this.height/2,plot.bottom-this.height))-plot.top}px`;
    if (this.selectedPoint !== point) { this.selectedPoint = point; this.onSelect?.(point); }
  }
  hide() {
    if (this.animation != null) cancelAnimationFrame(this.animation);
    this.animation = null; this.pending = null; this.selectedPoint = null;
    this.cursor.classList.add('hidden');
  }
}
