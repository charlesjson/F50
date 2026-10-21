'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

function drawing(t) {
  const labels = [], dots = [];
  const context = {scale(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},fillText(text){labels.push(text);},measureText(text){return {width:String(text).length*6};},arc(x,y){dots.push([x,y]);}};
  const previousWindow = global.window, previousStyle = global.getComputedStyle;
  global.window = {devicePixelRatio:1}; global.getComputedStyle = () => ({getPropertyValue:()=>''});
  t.after(() => {global.window=previousWindow;global.getComputedStyle=previousStyle;});
  return {labels,dots,canvas:{getBoundingClientRect:()=>({width:500,height:180}),getContext:()=>context}};
}

test('isolated observations remain visible across reconnects, missing metrics and a trailing failure', async t => {
  const {drawSeries} = await import('../src/renderer/chart.mjs');
  const {canvas,dots} = drawing(t);
  drawSeries(canvas,[{at:1000,cpu:10,breakAfter:true},{at:2000,cpu:20,breakBefore:true},{at:3000,cpu:null},{at:4000,cpu:30,cpuGaps:true},{at:5000,cpu:null}],{series:[['cpu','blue']],max:100,from:0,to:6000});
  assert.equal(dots.length,3);
  assert.ok(dots[0][0]<dots[1][0] && dots[1][0]<dots[2][0]);
});

test('automatic chart ticks use readable steps without changing fixed percentage ranges', async t => {
  const {drawSeries,drawTraffic} = await import('../src/renderer/chart.mjs');
  const {canvas,labels} = drawing(t);
  drawSeries(canvas,[{at:1000,temperature:52.1}],{series:[['temperature','orange']],floor:60,format:value=>value.toFixed(0)+'°C'});
  assert.deepEqual(labels,['80°C','60°C','40°C','20°C','0°C']);
  labels.length=0;
  drawTraffic(canvas,[{at:1000,down:500000,up:200000}],60000);
  assert.deepEqual(labels,['600.00 KB/s','450.00 KB/s','300.00 KB/s','150.00 KB/s','0 B/s']);
  labels.length=0;
  drawSeries(canvas,[{at:1000,cpu:12.8}],{series:[['cpu','blue']],max:100,format:value=>value.toFixed(0)+'%'});
  assert.deepEqual(labels,['100%','75%','50%','25%','0%']);
});

test('inspection retains the displayed time range and samples when the live buffer grows', async t => {
  const {drawSeries} = await import('../src/renderer/chart.mjs');
  const {canvas} = drawing(t);
  const samples = [{at:1000,cpu:10},{at:3000,cpu:20},{at:5000,cpu:null}];
  const frame = drawSeries(canvas,samples,{series:[['cpu','blue']],max:100,windowMs:2500});
  assert.equal(frame.from,3000); assert.equal(frame.to,5000);
  assert.deepEqual(frame.points,[samples[1],samples[2]]);
  samples.push({at:6000,cpu:40});
  assert.equal(frame.points.length,2); assert.equal(frame.to,5000);
  const explicit = drawSeries(canvas,samples,{series:[['cpu','blue']],max:100,from:0,to:10000});
  assert.equal(explicit.from,0); assert.equal(explicit.to,10000);
});

test('fitted cumulative traffic keeps a small increase visible above a large existing total', async t => {
  const {drawSeries} = await import('../src/renderer/chart.mjs');
  const {canvas} = drawing(t);
  const initial = 105 * 1024 ** 3, increase = 400 * 1024 ** 2;
  const points = [{at:1000,monthlyBytes:initial},{at:2000,monthlyBytes:null},{at:3000,monthlyBytes:initial+increase}];
  const frame = drawSeries(canvas,points,{series:[['monthlyBytes','blue']],fit:true,unitBase:1024,from:1000,to:3000});
  const pixels = increase / (frame.plot.max-frame.plot.min) * (frame.plot.bottom-frame.plot.top);
  assert.ok(pixels>=30,`400 MiB increase is flattened to ${pixels} pixels`);
  assert.ok(frame.plot.min>0);
  assert.ok(frame.plot.min<initial && frame.plot.max>initial+increase);
  assert.equal(frame.points[1].monthlyBytes,null);
});

test('fitted ranges keep constant totals flat, retain zero readings and exclude out-of-range samples', async t => {
  const {drawSeries} = await import('../src/renderer/chart.mjs');
  const {canvas,dots} = drawing(t);
  const points = [{at:0,bytes:0},{at:1000,bytes:105*1024**3},{at:2000,bytes:105*1024**3}];
  const frame = drawSeries(canvas,points,{series:[['bytes','blue']],fit:true,unitBase:1024,from:1000,to:2000});
  assert.ok(frame.plot.min>0);
  assert.ok(Number.isFinite(dots[0][1]));
  assert.equal(frame.points[0].bytes,frame.points[1].bytes);
  const zero = drawSeries(canvas,[{at:1000,bytes:0}],{series:[['bytes','blue']],fit:true,unitBase:1024});
  assert.equal(zero.plot.min,0); assert.ok(zero.plot.max>0);
  const reset = drawSeries(canvas,points,{series:[['bytes','blue']],fit:true,unitBase:1024,from:0,to:2000});
  assert.equal(reset.plot.min,0); assert.ok(reset.plot.max>=105*1024**3);
});
