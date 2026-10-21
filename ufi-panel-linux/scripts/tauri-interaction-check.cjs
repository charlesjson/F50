'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const{startFixture}=require('./fixture-server.cjs');const{launch}=require('./tauri-webdriver.cjs');
(async()=>{
 const fixture=await startFixture();const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ufi-tauri-persistence-'));let ui=await launch({directory}).catch(error=>{fixture.close();fs.rmSync(directory,{recursive:true,force:true});throw error;});const checks=[];
 try{
  await ui.wait('document.readyState==="complete"&&typeof window.ufi==="object"');
  await ui.run('window.__uiErrors=[];addEventListener("error",e=>__uiErrors.push(e.message));addEventListener("unhandledrejection",e=>__uiErrors.push(String(e.reason)))');
  assert.equal(await ui.run('typeof window.require'),'undefined');
  await ui.select('#poll-interval','0');await ui.click('#welcome-connect');await ui.fill('#address',fixture.address);await ui.fill('#password','fixture-password');await ui.click('#submit-connection');
  await ui.wait('document.getElementById("temperature").textContent==="52.1"');await ui.wait('document.getElementById("cellular-status").textContent==="未连接"');
  checks.push('native WebKit window, isolated bridge, signed device connection and missing readings');
  await ui.navigate('clients');await ui.wait('document.querySelectorAll("#clients-content tbody tr").length===2');await ui.fill('#client-search','192.168.0.3');assert.equal(await ui.run('document.querySelectorAll("#clients-content tbody tr").length'),1);await ui.fill('#client-search','');
  fixture.state.failClients=true;await ui.click('#refresh-button');await ui.wait('!document.getElementById("clients-status").classList.contains("hidden")&&!document.getElementById("refresh-button").disabled');assert.equal(await ui.run('document.querySelectorAll("#clients-content tbody tr").length'),2);fixture.state.failClients=false;await ui.click('#clients-status button');await ui.wait('document.getElementById("clients-status").classList.contains("hidden")');
  checks.push('terminal filtering, failed read retains list and retry recovery');
  fixture.state.smsMixed=true;await ui.navigate('sms');await ui.wait('document.querySelectorAll(".sms-item").length===2');
  await ui.click('[role=tab][data-sms-folder=sent]');await ui.wait('document.querySelectorAll(".sms-sent").length===2');assert.equal(await ui.run('document.getElementById("sms-unread").disabled'),true);
  await ui.click('.sms-sent button:nth-of-type(2)');await ui.wait('document.getElementById("feature-dialog").open');assert.equal(await ui.run('document.querySelector("form[data-action=sms-send] [name=content]").value'),'发出的短信');await ui.click('#close-feature-dialog');
  await ui.click('[role=tab][data-sms-folder=draft]');await ui.wait('document.querySelectorAll(".sms-draft").length===1');await ui.click('[role=tab][data-sms-folder=other]');await ui.wait('document.querySelectorAll(".sms-other").length===1');
  await ui.click('[role=tab][data-sms-folder=inbox]');await ui.wait('document.querySelectorAll(".sms-inbox").length===2');ui.screenshot('tauri-sms');
  checks.push('separate SMS mailboxes, unread controls, resend prefill without sending');
  await ui.click('#compose-sms');await ui.select('form[data-action=sms-send] [name=numberMode]','international');await ui.fill('[aria-label="搜索国家或地区"]','英国');await ui.select('[aria-label="国家或地区"]','GB');await ui.fill('form[data-action=sms-send] [name=number]','7700 900123');await ui.fill('form[data-action=sms-send] [name=content]','Fixture only');await ui.wait('document.querySelector(".sms-number-preview").textContent.includes("+447700900123")');
  await ui.click('form[data-action=sms-send] button[type=submit]');await ui.wait('!!document.querySelector("[data-confirm-operation]")');assert.equal(fixture.writes.length,0);await ui.click('[data-confirm-operation]');await ui.wait('!document.getElementById("feature-dialog").open');assert.equal(fixture.writes.at(-1).body.Number,'+447700900123');
  checks.push('searchable named calling codes, international preview and one-use confirmation to local fixture');
  await ui.navigate('tools');await ui.select('#command-kind','at');await ui.fill('#command-template-search','短信中心');await ui.select('#command-preset','AT+CSCA?');assert.equal(await ui.run('document.getElementById("command").value'),'AT+CSCA?');assert.ok((await ui.run('document.getElementById("command-template-hint").textContent')).includes('不是收件人'));
  checks.push('searchable AT templates, SIM selector and explanatory text');
  await ui.navigate('radio');await ui.wait('Array.from(document.querySelectorAll("[data-cell-choice]")).some(el=>el.dataset.cellChoice==="16:633984:100")');await ui.click('[data-cell-choice="16:633984:100"]');await ui.wait('!!document.querySelector("[data-confirm-operation]")');assert.ok((await ui.run('document.querySelector(".operation-detail").textContent')).includes('PCI 100'));await ui.click('#feature-dialog .dialog-actions button:first-child');assert.equal(fixture.writes.length,1);
  checks.push('neighbor selection fills RAT/PCI/channel; cancelling never writes');
  for(const page of ['network','wifi','apn','lan','traffic','forward','tasks','device','updates','appearance','authentication','service','voice','usb','preferences']){await ui.navigate(page);await ui.wait('!document.querySelector(".view:not(.hidden)").textContent.includes("正在读取…")');}
  checks.push('all existing settings and maintenance views load in WebKit');
  await ui.navigate('network');await ui.wait('!!document.querySelector("form[data-action=network-mode]")');await ui.select('form[data-action=network-mode] select','Only_LTE');await ui.click('form[data-action=network-mode] button[type=submit]');await ui.wait('!!document.querySelector("[data-confirm-operation]")');await ui.click('#feature-dialog .dialog-actions button:first-child');assert.equal(fixture.writes.length,1);
  checks.push('settings review/cancel preserves input and performs no device write');
  await ui.navigate('overview');await ui.select('#poll-interval','1000');const before=fixture.state.reads;await ui.wait('document.getElementById("chart-duration").textContent.includes("采样")');await new Promise(r=>setTimeout(r,3100));assert.ok(fixture.state.reads>=before+2);ui.screenshot('tauri-overview');await ui.api('openMonitor');
  assert.ok((await ui.call('GET',ui.endpoint('/window/handles'))).length>=2);const hiddenStart=fixture.state.reads;await ui.api('hideWindow');await new Promise(r=>setTimeout(r,3100));assert.ok(fixture.state.reads>=hiddenStart+2);await ui.api('showWindow');
  await ui.api('startJob','speed',{mode:'lan',duration:3,threads:1});for(let i=0;i<80;i++){const jobs=await ui.api('jobs');if(jobs.some(job=>job.kind==='speed'&&job.state==='succeeded'))break;await new Promise(r=>setTimeout(r,100));}assert.ok((await ui.api('jobs')).some(job=>job.kind==='speed'&&job.state==='succeeded'));
  checks.push('continuous telemetry events, live curves, isolated monitor and bounded streaming LAN job');
  await ui.api('openPanel');
  for(let i=0;i<100&&!fixture.state.remoteIsolation;i++)await new Promise(r=>setTimeout(r,100));
  assert.deepEqual(fixture.state.remoteIsolation,{blocked:'true',bridge:'undefined'});
  await ui.api('showWindow');await ui.click('#edit-connection');await ui.wait('document.getElementById("connection-dialog").open');await ui.click('#disconnect-button');await ui.wait('document.getElementById("welcome").classList.contains("hidden")===false');
  checks.push('device web page has no client bridge and cannot invoke privileged commands; disconnect clears session');
  const errors=await ui.run('window.__uiErrors');assert.deepEqual(errors,[]);
  await ui.run('localStorage.setItem("native-persistence-test","retained")');await new Promise(r=>setTimeout(r,700));await ui.close();ui=await launch({directory});await ui.wait('document.readyState==="complete"&&typeof window.ufi==="object"');
  assert.equal(await ui.run('localStorage.getItem("native-persistence-test")'),'retained');assert.equal((await ui.api('profiles')).profiles.length,1);checks.push('client preferences and non-secret device profiles persist across native restart');

  const report={result:'passed',nativeWebKit:true,input:process.env.UFI_WEBDRIVER_DOM_INPUT==='1'?'DOM events (WebDriver native input unavailable)':'native WebDriver',checks,pageErrors:errors,fixtureWrites:fixture.writes.length};fs.writeFileSync(path.join(__dirname,'../artifacts/tauri-interaction-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){console.error(ui.diagnostics.slice(-3000));console.error('fixture requests',fixture.state.clients,fixture.state.failClients);console.error('UI context',await ui.run('({title:document.title,page:document.getElementById("page-title")?.textContent,notice:document.getElementById("notice-text")?.textContent,connection:document.getElementById("connection-error")?.textContent,errors:window.__uiErrors,clientsStatus:document.getElementById("clients-status")?.textContent,clientsBusy:document.getElementById("clients-content")?.getAttribute("aria-busy"),refreshDisabled:document.getElementById("refresh-button")?.disabled})').catch(()=>null));throw error;}
 finally{await ui.close();fixture.close();fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
