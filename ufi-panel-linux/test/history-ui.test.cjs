'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('custom history ranges round trip local wall time and reject inverted or invalid dates', async () => {
  const { localDateTime, historyRange } = await import('../src/renderer/history-ui.mjs');
  const start = Date.parse('2026-10-17T08:09:10Z'), end = start+86400000;
  assert.deepEqual(historyRange(localDateTime(start),localDateTime(end)),{from:start,to:end});
  assert.throws(() => historyRange('',localDateTime(end)),/时间/);
  assert.throws(() => historyRange(localDateTime(end),localDateTime(start)),/时间/);
});

test('history charts honor the requested time axis and break before reconnects and missing readings', async t => {
  const { drawSeries } = await import('../src/renderer/chart.mjs');
  const lines = [], moves = [];
  const context = {scale(){},beginPath(){},moveTo(x,y){moves.push([x,y]);},lineTo(x,y){lines.push([x,y]);},stroke(){},arc(){},fill(){},fillText(){},measureText(text){return {width:String(text).length*6};}};
  const previousWindow = global.window, previousStyle = global.getComputedStyle;
  global.window = {devicePixelRatio:1}; global.getComputedStyle = () => ({getPropertyValue:()=>''});
  t.after(() => {global.window=previousWindow;global.getComputedStyle=previousStyle;});
  const canvas = {getBoundingClientRect:()=>({width:104,height:100}),getContext:()=>context};
  const result = drawSeries(canvas,[{at:2000,cpu:10},{at:4000,cpu:20},{at:6000,cpu:30,breakBefore:true,breakAfter:true},{at:6500,cpu:35},{at:7000,cpu:null},{at:8000,cpu:40}],{series:[['cpu','green']],max:100,from:0,to:10000});
  assert.equal(result.count,6);
  assert.equal(lines.length,7); // Five grid lines, the vertical axis and one continuous data segment.
  assert.ok(moves.some(([x])=>x===result.plot.left+(result.plot.right-result.plot.left)*0.2));
  assert.equal(lines.at(-1)[0],result.plot.left+(result.plot.right-result.plot.left)*0.4);
});

test('daily and monthly cumulative charts use independent scales with distinct precise tick labels', async t => {
  const { historyCharts } = await import('../src/renderer/history-ui.mjs');
  const { drawSeries } = await import('../src/renderer/chart.mjs');
  const usageCharts = historyCharts.filter(chart => chart.series.some(([key]) => ['dailyBytes','monthlyBytes'].includes(key)));
  assert.equal(usageCharts.length,2);
  const labels = [];
  const context = {scale(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},fillText(text){labels.push(text);},measureText(text){return {width:String(text).length*6};}};
  const previousWindow = global.window, previousStyle = global.getComputedStyle;
  global.window = {devicePixelRatio:1}; global.getComputedStyle = () => ({getPropertyValue:()=>''});
  t.after(() => {global.window=previousWindow;global.getComputedStyle=previousStyle;});
  const canvas = {getBoundingClientRect:()=>({width:600,height:180}),getContext:()=>context};
  for (const increase of [400*1024**2,100]) {
    const points = [{at:1000,dailyBytes:13*1024**3,monthlyBytes:105*1024**3},{at:2000,dailyBytes:13*1024**3+increase,monthlyBytes:105*1024**3+increase}];
    for (const config of usageCharts) {
      labels.length=0;
      assert.equal(config.series.length,1);
      const frame = drawSeries(canvas,points,{...config,from:1000,to:2000});
      assert.ok(frame.plot.min>0);
      assert.equal(new Set(labels).size,5,'small changes must not round every axis label to the same total');
      if (increase>1024) assert.ok(increase/(frame.plot.max-frame.plot.min)*166>=30);
      assert.equal(config.formatReading(points[1][config.series[0][0]]).endsWith(' GB'),true);
    }
  }
});
