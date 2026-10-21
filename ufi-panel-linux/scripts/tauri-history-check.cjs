'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { startFixture } = require('./fixture-server.cjs');
const { launch } = require('./tauri-webdriver.cjs');

(async () => {
  const fixture = await startFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ufi-history-webkit-'));
  let ui;
  const checks = [];
  const boot = async () => {
    ui = await launch({directory});
    await ui.wait('document.readyState==="complete" && typeof window.ufi?.historyQuery === "function"');
    await ui.run('window.__historyErrors=[];addEventListener("error",e=>__historyErrors.push(e.message));addEventListener("unhandledrejection",e=>__historyErrors.push(String(e.reason)))');
    await ui.run(`window.__usagePaths={};
      for(const method of ['scale','moveTo','lineTo']){
        const original=CanvasRenderingContext2D.prototype[method];
        CanvasRenderingContext2D.prototype[method]=function(...args){
          const id=this.canvas.id;
          if(id.endsWith('-usage-chart')){
            if(method==='scale')__usagePaths[id]=[];
            else if(['#377a69','#537ba8'].includes(this.strokeStyle))(__usagePaths[id]||=[]).push(args);
          }
          return original.apply(this,args);
        };
      }`);
  };
  const query = async (id,raw=true) => ui.api('historyQuery',{deviceId:id,from:Date.now()-3600000,to:Date.now()+1000,raw});
  try {
    await boot();
    await ui.navigate('history');
    await ui.wait('document.getElementById("history-status").textContent.includes("还没有历史记录")');
    checks.push('empty local history opens before any device connection');
    await ui.select('#poll-interval','0');
    await ui.click('#connect-button'); await ui.fill('#address',fixture.address); await ui.fill('#password','fixture-password'); await ui.click('#submit-connection');
    await ui.wait('document.getElementById("connection-state").textContent.includes("已连接")');
    await ui.api('snapshot');
    fixture.state.nullRate = false; await ui.api('snapshot');
    fixture.state.failBase = true; await assert.rejects(ui.api('snapshot')); fixture.state.failBase = false;
    await ui.api('snapshot');
    const devices = await ui.api('historyDevices'); assert.equal(devices.devices.length,1);
    const id = devices.devices[0].id;
    let history = await query(id);
    assert.ok(history.summary.count>=4); assert.equal(history.summary.failures,1);
    assert.ok(history.points.some(p=>p.down===null)); assert.ok(history.points.some(p=>p.down===500000));
    assert.equal(history.summary.dailyBytes,3e9); assert.equal(history.summary.monthlyBytes,24e9);
    assert.equal(history.summary.cpu.max,12.8);
    assert.ok(history.points.find(p=>p.failures===1).cpu===null);
    checks.push('successful and failed samples persist with missing readings, exact peaks and cumulative counters');
    for(let i=1;i<=4;i++){
      fixture.state.baseOverrides={daily_data:3e9+i*100*1024**2,monthly_data:24e9+i*100*1024**2};
      await ui.api('snapshot');
    }
    history=await query(id);
    const reads = fixture.state.reads;
    await ui.navigate('history'); await ui.wait('!document.getElementById("history-fields").disabled && document.getElementById("history-status").textContent.includes("次采样")');
    await ui.select('#history-resolution','raw'); await ui.click('#history-search');
    await ui.wait('document.getElementById("history-status").textContent.includes("原始采样")');
    await ui.run('const local=at=>{const d=new Date(at);return new Date(at-d.getTimezoneOffset()*60000).toISOString().slice(0,19);};for(const [id,at] of [["history-from",arguments[0]],["history-to",arguments[1]]]){const input=document.getElementById(id);input.value=local(at);input.dispatchEvent(new Event("input",{bubbles:true}));}',[history.summary.firstAt-1000,history.summary.lastAt+2000]);
    assert.equal(await ui.run('document.getElementById("history-preset").value'),'custom');
    await ui.click('#history-search');
    await ui.wait('!document.getElementById("history-fields").disabled && document.getElementById("history-status").textContent.includes("原始采样")');
    assert.equal(fixture.state.reads,reads);
    assert.ok(await ui.run('document.querySelectorAll("#history-rows tr").length >= 4'));
    assert.ok((await ui.run('document.getElementById("history-summary").textContent')).includes('22.74 GB'));
    await ui.run('document.getElementById("history-rate-chart").dispatchEvent(new MouseEvent("mousemove",{clientX:500,bubbles:true}));');
    await ui.wait('document.getElementById("history-cursor").textContent.includes("CPU")');
    await ui.run('const canvas=document.getElementById("history-rate-chart"),bounds=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent("mousemove",{clientX:bounds.right-5,clientY:bounds.top+bounds.height/2,bubbles:true}));');
    await ui.wait('document.getElementById("history-rate-chart").parentElement.querySelector(".chart-tooltip")?.textContent.includes("488.28 KB/s")');
    assert.deepEqual(await ui.run('[...document.getElementById("history-rate-chart").parentElement.querySelectorAll(".chart-tooltip-row strong")].map(node=>node.textContent)'),['488.28 KB/s','195.31 KB/s']);
    ui.screenshot('tauri-history');
    checks.push('native WebKit charts, custom date range, hover readings, raw table and local queries without extra device reads');
    for(const id of ['daily','monthly']){
      const chartId=`history-${id}-usage-chart`;
      const chart=await ui.run(`const id=arguments[0],canvas=document.getElementById(id),ys=__usagePaths[id].map(p=>p[1]);
        canvas.scrollIntoView({block:'center'});
        const b=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent('mousemove',{clientX:b.right-5,clientY:b.top+b.height/2,bubbles:true}));
        return {height:Math.max(...ys)-Math.min(...ys),scale:canvas.closest('.card').querySelector('.card-heading .muted').textContent,note:canvas.closest('.card').querySelector('.history-chart-note').textContent};`,[chartId]);
      assert.ok(chart.height>=30,`${id} traffic increment is flattened to ${chart.height} px`);
      assert.ok(!chart.scale.startsWith('0 '),chart.scale);assert.ok(chart.note.includes('缩放'));
      await ui.wait(`document.getElementById(${JSON.stringify(chartId)}).parentElement.querySelector('.chart-tooltip')?.textContent.includes('GB')`);
    }
    ui.screenshot('tauri-history-usage');
    checks.push('Daily and monthly totals have independent fitted axes; a 400 MiB increase is visible and hover retains absolute cumulative readings');
    await ui.click('#edit-connection'); await ui.click('#disconnect-button');
    await ui.wait('document.getElementById("connection-state").textContent.includes("未连接")');
    await ui.click('#refresh-button');
    await ui.wait('!document.getElementById("history-fields").disabled && document.getElementById("history-status").textContent.includes("次采样")');
    assert.equal(fixture.state.reads,reads);
    assert.equal((await query(id)).summary.count,history.summary.count);
    checks.push('disconnect preserves locally accessible history and allows offline refresh');
    assert.deepEqual(await ui.run('window.__historyErrors'),[]);
    await ui.close(); ui = null;
    await boot(); await ui.navigate('history');
    await ui.wait('!document.getElementById("history-fields").disabled && document.querySelectorAll("#history-rows tr").length >= 1');
    const restarted = await query(id); assert.equal(restarted.summary.count,history.summary.count);
    assert.equal(restarted.summary.monthlyBytes,24e9+400*1024**2);
    const stored = fs.readFileSync(path.join(directory,'telemetry.sqlite3'));
    assert.equal(stored.includes(Buffer.from('fixture-password')),false);
    checks.push('database survives a complete application restart and excludes connection credentials');
    assert.deepEqual(await ui.run('window.__historyErrors'),[]);
    const report = {result:'passed',nativeWebKit:true,checks,samples:restarted.summary.count,fixtureWrites:fixture.writes.length};
    assert.equal(report.fixtureWrites,0);
    fs.writeFileSync(path.join(__dirname,'../artifacts/tauri-history-validation.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(ui?.diagnostics.slice(-3000));
    console.error(await ui?.run('({status:document.getElementById("history-status")?.textContent,errors:window.__historyErrors,connection:document.getElementById("connection-error")?.textContent})').catch(()=>null));
    throw error;
  } finally {
    await ui?.close(); fixture.close(); fs.rmSync(directory,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
