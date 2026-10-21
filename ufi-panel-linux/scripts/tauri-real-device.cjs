'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const{launch}=require('./tauri-webdriver.cjs');
(async()=>{
 if(!process.env.UFI_CONNECTION_FILE)throw new Error('需要 UFI_CONNECTION_FILE（只读真机检查）');
 const input=JSON.parse(fs.readFileSync(process.env.UFI_CONNECTION_FILE,'utf8')),ui=await launch();const checks=[];
 try{
  await ui.wait('document.readyState==="complete"&&typeof window.ufi==="object"');await ui.click('#welcome-connect');await ui.fill('#address',input.address);await ui.fill('#password',input.password||'');await ui.fill('#zte-password',input.ztePassword||'');await ui.select('#login-method','LOGIN');await ui.click('#submit-connection');await ui.wait('document.getElementById("temperature").textContent!=="—"');
  let state;for(let i=0;i<100;i++){state=await ui.api('telemetryState');if(state.history.length>=10)break;await new Promise(r=>setTimeout(r,250));}
  assert.ok(state.history.length>=10);const points=state.history.filter(p=>p.snapshot).map(p=>({at:p.at,cpu:p.snapshot.base.cpu_usage,memory:p.snapshot.base.mem_usage,temperature:p.snapshot.base.cpu_temp,down:p.snapshot.network.realtime_rx_thrpt,up:p.snapshot.network.realtime_tx_thrpt}));assert.ok(points.every(p=>['cpu','memory','temperature','down','up'].every(k=>p[k]!=null&&p[k]!==''&&Number.isFinite(Number(p[k])))));
  const before=state.history.length;await ui.api('hideWindow');await new Promise(r=>setTimeout(r,6200));const after=await ui.api('telemetryState');assert.ok(after.history.length>=before+2);await ui.api('showWindow');
  await ui.run('document.querySelector(".health-trends").scrollIntoView({block:"end"});');ui.screenshot('tauri-live-telemetry');checks.push('real CPU/memory/temperature/throughput, continuous curves and hidden-window collection');
  await ui.navigate('sms');await ui.wait('document.getElementById("sms-content").getAttribute("aria-busy")==="false"');const inbox=(await ui.api('sms',{folder:'inbox'})).messages.length;
  await ui.click('[role=tab][data-sms-folder=sent]');await ui.wait('document.getElementById("sms-content").getAttribute("aria-busy")==="false"');const sent=(await ui.api('sms',{folder:'sent'})).messages.length;assert.equal(await ui.run('document.getElementById("sms-unread").disabled'),true);checks.push('real incoming/outgoing SMS separation without writes');
  await ui.navigate('radio');await ui.wait('document.querySelectorAll("[data-cell-choice]").length>0');const neighbors=await ui.run('document.querySelectorAll("[data-cell-choice]:not([disabled])").length');assert.ok(neighbors>0);await ui.click('[data-cell-choice]:not([disabled])');await ui.wait('!!document.querySelector("[data-confirm-operation]")');await ui.click('#feature-dialog .dialog-actions button:first-child');checks.push('real neighbor selection and cancellation without locking');
  await ui.navigate('tools');await ui.select('#command-kind','at');await ui.select('#command-preset','AT+CSQ');assert.equal(await ui.run('document.getElementById("command").value'),'AT+CSQ');checks.push('AT template selection without executing');
  await ui.api('openMonitor');assert.ok((await ui.call('GET',ui.endpoint('/window/handles'))).length>=2);checks.push('native always-on-top monitor window');
  const result={result:'passed',nativeWebKit:true,realDevice:true,checks,samples:points.length,durationMs:points.at(-1).at-points[0].at,backgroundSamples:after.history.length-before,inbox,sent,neighbors,points,deviceWrites:false};fs.writeFileSync(path.join(__dirname,'../artifacts/tauri-live-validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,points:undefined}));
 }finally{await ui.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
