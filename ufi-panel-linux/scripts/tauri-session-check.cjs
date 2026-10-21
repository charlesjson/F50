'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startFixture } = require('./fixture-server.cjs');
const { launch } = require('./tauri-webdriver.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, label, ms = 12000) => {
  const end=Date.now()+ms;while(Date.now()<end){const value=predicate();if(value)return value;await delay(120);}throw new Error('Session wait expired: '+label);
};
const closePanel = () => {
  const tree=execFileSync('xwininfo',['-root','-tree'],{encoding:'utf8',env:{...process.env,LC_ALL:'C.UTF-8'}});
  const line=tree.split('\n').find(line=>line.includes('session-panel'));
  if(line)execFileSync('xdotool',['windowactivate','--sync',line.match(/0x[0-9a-f]+/)[0],'key','alt+F4']);
};
(async()=>{
  const fixture=await startFixture(),other=await startFixture(),checks=[];
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ufi-web-session-test-'));let ui,profile;
  fixture.state.sessionFixture=other.state.sessionFixture=true;
  fixture.state.pluginText='<!-- [KANO_PLUGIN_START] session-panel.js -->\n<script type="application/json" data-ufi-plugin-manifest>{"version":1,"settings":{"url":"./ui/"}}</script>\n<!-- [KANO_PLUGIN_END] session-panel.js -->';
  const current=()=>Object.values(fixture.state.authPages||{}).at(-1);
  const connect=async(ztePassword='')=>{
    await ui.api('telemetryConfigure',0);
    const connected=await ui.api('connect',{id:profile?.id,address:fixture.address,name:'Session F50',password:'fixture-password',ztePassword,remember:false});profile=connected.profile;
  };
  const open=async()=>{const installed=await ui.api('featureRead','plugins-installed');await ui.api('openPluginSettings',{id:installed.items[0].id,revision:installed.revision});};
  try{
    ui=await launch({directory});await ui.wait('!!window.ufi');await connect();await open();
    const first=await until(()=>current()?.authenticated&&current(),'automatic UFI authorization');
    assert.equal(first.hasPassword,false);assert.equal(first.bridge,'undefined');
    for(const key of ['kano_sms_token','kano_sms_pwd','kano_remembered_loginfo'])assert.equal(first.exposedKeys.includes(key),false);
    fixture.state.pluginCommands[first.id]={type:'remember'};
    await until(()=>current()?.manualPassword&&current().cookie&&current().preference==='retained preference','manual web login and normal panel storage');
    closePanel();await delay(300);await open();
    await until(()=>current()?.id!==first.id&&current()?.authenticated&&current()?.manualPassword,'manual web credentials restored when reopening');
    checks.push('opening plugin configuration supplies the validated UFI token before page scripts; manual web login is captured and restored on reopening without exposing raw auth keys in localStorage or granting the backend bridge');

    const healthy=current().id;
    fixture.state.failBase=true;await assert.rejects(ui.api('snapshot'));
    fixture.state.pluginCommands[healthy]={type:'expire'};
    await until(()=>current()?.id===healthy&&!current().authenticated,'web page expires active login while offline');
    fixture.state.failBase=false;await ui.api('snapshot');
    await until(()=>current()?.id===healthy&&current().authenticated&&current().manualPassword,'automatic recovery without replacing the page');
    assert.equal(current().preference,'retained preference');
    checks.push('a failed device sample followed by recovery restores the page login in place and preserves configuration state');

    closePanel();await delay(300);fixture.state.failBase=true;await assert.rejects(ui.api('snapshot'));
    fixture.state.sessionPageOffline=true;await open();await delay(600);
    const failed=current().id;
    fixture.state.sessionPageOffline=false;fixture.state.failBase=false;await ui.api('snapshot');
    await until(()=>current()?.id!==failed&&current()?.authenticated,'failed native navigation reloads when CPE returns');
    checks.push('a configuration window whose initial navigation fails reloads after device telemetry recovers');

    const originalId=current().id;await ui.api('disconnect');await connect();await open();
    await until(()=>current()?.id!==originalId&&current()?.authenticated&&current()?.preference==='retained preference'&&current()?.cookie,'browser session persists across disconnect/reconnect');
    const reconnectId=current().id;await ui.close();ui=null;
    await delay(600);ui=await launch({directory});await ui.wait('!!window.ufi');await connect('native-zte-password');await open();
    await until(()=>current()?.id!==reconnectId&&current()?.authenticated&&current()?.hasPassword&&current()?.preference==='retained preference'&&current()?.cookie,'browser state survives native restart and current credentials restore login');
    checks.push('device browser preferences and persistent cookies survive disconnect and native restart; current connection credentials restore UFI authorization');

    fixture.state.pluginText='<!-- [KANO_PLUGIN_START] other-panel.js -->\n<script type="application/json" data-ufi-plugin-manifest>'+JSON.stringify({version:1,settings:{url:other.address+'/ui/'}})+'</script>\n<!-- [KANO_PLUGIN_END] other-panel.js -->';
    await open();
    const foreign=await until(()=>Object.values(other.state.authPages||{}).at(-1),'different-port panel');
    assert.equal(foreign.authenticated,false);assert.equal(foreign.hasPassword,false);assert.equal(foreign.preference,null);
    checks.push('UFI credentials are never supplied to a plugin panel on another port');
    assert.equal(fixture.writes.length+other.writes.length,0);
    const report={result:'passed',version:require('../package.json').version,nativeWebKit:true,checks,sqlitePersistence:'covered by encrypted-store Rust tests; native fixture runs without a keyring and keeps credentials only in memory',fixtureWrites:0};
    fs.writeFileSync(path.join(__dirname,'../artifacts/session-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  }catch(error){console.error(ui?.diagnostics.slice(-3500));console.error({pages:fixture.state.authPages});throw error;}
  finally{await ui?.close();fixture.close();other.close();fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
