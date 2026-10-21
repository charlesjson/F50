import { number, temperature } from './format.mjs';
const percentage = value => { const n = number(value); return n !== null && n >= 0 && n <= 100 ? n : null; };
const throughput = value => { const n = number(value); return n !== null && n >= 0 ? n : null; };
export function sampleFrom(packet) {
  const b = packet.snapshot?.base || {}, n = packet.snapshot?.network || {};
  return { at: packet.at, down: throughput(n.realtime_rx_thrpt), up: throughput(n.realtime_tx_thrpt), temperature: temperature(b.cpu_temp), cpu: percentage(b.cpu_usage), memory: percentage(b.mem_usage) };
}
export function appendSample(samples, sample, interval) {
  const previous = samples.at(-1);
  // A paused, suspended or unreachable period must not look continuously measured.
  if (previous && sample.at - previous.at > Math.max(5000, interval * 2.5)) samples.push({ at: previous.at + 1, down: null, up: null, temperature: null, cpu: null, memory: null });
  samples.push(sample);
  return samples.filter(item => item.at >= sample.at - 600000).slice(-601);
}
