'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startFixture } = require('./fixture-server.cjs');
const { launch } = require('./tauri-webdriver.cjs');

(async () => {
  const fixture = await startFixture(); fixture.state.live = true; fixture.state.nullRate = false;
  let ui;
  const baseline = process.argv.includes('--baseline');
  const checks = [];
  try {
    ui = await launch();
    await ui.wait('document.readyState === "complete" && typeof window.ufi?.historyQuery === "function"');
    await ui.run(`window.__liveErrors = []; window.__liveDraws = {};
      addEventListener('error', e => __liveErrors.push(e.message));
      addEventListener('unhandledrejection', e => __liveErrors.push(String(e.reason)));
      const original = CanvasRenderingContext2D.prototype.scale;
      CanvasRenderingContext2D.prototype.scale = function(...args) {
        __liveDraws[this.canvas.id] = (__liveDraws[this.canvas.id] || 0) + 1;
        return original.apply(this, args);
      };`);
    await ui.select('#poll-interval','0');
    await ui.click('#connect-button'); await ui.fill('#address',fixture.address); await ui.fill('#password','fixture-password'); await ui.click('#submit-connection');
    await ui.wait('document.getElementById("connection-state").textContent.includes("已连接")');
    for (let i = 0; i < 3; i++) { await ui.api('snapshot'); await new Promise(resolve => setTimeout(resolve,120)); }
    const move = points => ui.call('POST',ui.endpoint('/actions'),{actions:[{type:'pointer',id:'live-chart-pointer',parameters:{pointerType:'mouse'},actions:points.map(({x,y})=>({type:'pointerMove',duration:40,origin:'viewport',x:Math.round(x),y:Math.round(y)}))}]});
    const hover = async id => {
      const point = await ui.run(`const canvas = document.getElementById(arguments[0]); canvas.scrollIntoView({block:'center'});
        const bounds = canvas.getBoundingClientRect(); return {x:bounds.left+bounds.width*0.65,y:bounds.top+bounds.height/2};`,[id]);
      await move([{x:50,y:150},point]);
    };
    const state = id => ui.run(`const canvas = document.getElementById(arguments[0]), wrap = canvas.parentElement;
      const tip = wrap.querySelector('.chart-tooltip'), guide = wrap.querySelector('.chart-cursor');
      const card = canvas.closest('.card');
      return {draws:__liveDraws[canvas.id] || 0,image:canvas.toDataURL(),guideVisible:!!guide&&!guide.classList.contains('hidden'),
        text:tip?.textContent || '',readings:[...wrap.querySelectorAll('.chart-tooltip-row strong')].map(node=>node.textContent),
        paused:card.classList.contains('chart-frozen'),current:canvas.id==='traffic-chart'?document.getElementById('download-speed').textContent:card.querySelector('.card-heading strong')?.textContent,
        badge:card.querySelector('.chart-hover-status')?.textContent || ''};`,[id]);
    const historyCount = async () => {
      const devices = await ui.api('historyDevices');
      const history = await ui.api('historyQuery',{deviceId:devices.devices[0].id,from:Date.now()-3600000,to:Date.now()+1000,raw:true});
      return history.summary.count;
    };
    if (baseline) {
      await hover('cpu-chart'); const before = await state('cpu-chart'); await ui.api('snapshot'); const after = await state('cpu-chart');
      console.log(JSON.stringify({guideVisible:before.guideVisible,tooltip:before.text,drawsBefore:before.draws,drawsAfter:after.draws,updatesWhileHovered:after.draws>before.draws}));
      return;
    }
    for (const [id,units] of [['traffic-chart',['/s','/s']],['temperature-chart',['°C']],['cpu-chart',['%']],['memory-chart',['%']]]) {
      await hover(id);
      await ui.wait(`document.getElementById(${JSON.stringify(id)}).closest('.card').classList.contains('chart-frozen')`);
      await ui.wait(`!!document.getElementById(${JSON.stringify(id)}).parentElement.querySelector('.chart-cursor:not(.hidden) .chart-tooltip')`);
      const before = await state(id), count = await historyCount(), other = id === 'cpu-chart' ? 'memory-chart' : 'cpu-chart';
      const otherBefore = await state(other);
      assert.equal(before.guideVisible,true,id); assert.equal(before.readings.length,units.length);
      assert.ok(before.readings.every((value,index)=>value.endsWith(units[index])),JSON.stringify(before.readings));
      assert.ok(before.text.includes('2026')); assert.ok(before.badge.includes('采样继续'));
      for (let i = 0; i < 3; i++) await ui.api('snapshot');
      const held = await state(id), otherAfter = await state(other);
      assert.equal(held.draws,before.draws,id+' must not redraw'); assert.equal(held.image,before.image,id+' bitmap must remain fixed');
      assert.equal(held.text,before.text,id+' hover reading must remain fixed'); assert.equal(held.current,before.current,id+' chart summary must remain fixed');
      assert.ok(otherAfter.draws>otherBefore.draws,other+' continues updating'); assert.ok(await historyCount()>=count+3,'hover must not stop saved history');
      if (id === 'cpu-chart') ui.screenshot('tauri-live-chart-hover');
      await move([{x:50,y:150}]);
      await ui.wait(`!document.getElementById(${JSON.stringify(id)}).closest('.card').classList.contains('chart-frozen')`);
      const resumed = await state(id); assert.ok(resumed.draws>held.draws,id+' catches up on leave'); assert.equal(resumed.guideVisible,false);
    }
    checks.push('All four live charts show a sample guide, timestamp, values and units; hovering freezes only that chart and its summary');
    checks.push('Incoming device samples, other charts and SQLite history continue while a chart is frozen; leaving catches up to the latest data');
    await ui.select('#poll-interval','1000'); await hover('cpu-chart');
    const beforeTimer = await state('cpu-chart'), reads = fixture.state.reads, stored = await historyCount();
    const end = Date.now()+7000;
    while (fixture.state.reads<reads+2 && Date.now()<end) await new Promise(resolve=>setTimeout(resolve,150));
    assert.ok(fixture.state.reads>=reads+2,'scheduled telemetry must keep running');
    assert.equal((await state('cpu-chart')).image,beforeTimer.image); assert.ok(await historyCount()>=stored+2);
    await move([{x:50,y:150}]); await ui.select('#poll-interval','0');
    checks.push('The normal one-second sampling timer continues collecting and persisting samples during hover');
    await hover('cpu-chart'); await ui.navigate('history');
    assert.equal((await state('cpu-chart')).paused,false,'navigation clears frozen state');
    await ui.navigate('overview'); await move([{x:50,y:150}]);
    fixture.state.nullRate = true; await ui.api('snapshot'); await hover('traffic-chart');
    const canvasBounds = await ui.run('const b=document.getElementById("traffic-chart").getBoundingClientRect();return {x:b.right-5,y:b.top+b.height/2};');
    await move([canvasBounds]);
    await ui.wait('document.getElementById("traffic-chart").parentElement.querySelector(".chart-tooltip")?.textContent.includes("—")');
    assert.deepEqual((await state('traffic-chart')).readings,['—','—']);
    await move([{x:50,y:150}]);
    checks.push('Navigation releases frozen charts and missing throughput stays missing in the tooltip');
    assert.deepEqual(await ui.run('window.__liveErrors'),[]); assert.equal(fixture.writes.length,0);
    const report = {result:'passed',nativeWebKit:true,version:require('../package.json').version,checks,fixtureWrites:0};
    fs.writeFileSync(path.join(__dirname,'../artifacts/live-charts-validation.json'),JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report));
  } catch (error) { console.error(ui?.diagnostics.slice(-2000)); throw error; }
  finally { await ui?.close(); fixture.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
