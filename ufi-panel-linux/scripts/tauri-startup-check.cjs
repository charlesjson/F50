'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { startFixture } = require('./fixture-server.cjs');
const { launch } = require('./tauri-webdriver.cjs');
const { hashPassword } = require('../src/core/protocol.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const fixture=await startFixture(),other=await startFixture(),checks=[],directories=[];let ui;
  const seed=({secret=true,keyring=true,active='selected',token=hashPassword('fixture-password')}={})=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ufi-startup-'));directories.push(directory);
    const key=crypto.randomBytes(32),nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
    const bytes=Buffer.concat([cipher.update(JSON.stringify({token,ztePassword:''}),'utf8'),cipher.final()]);
    const saved=Buffer.concat([Buffer.from('UFI2'),nonce,cipher.getAuthTag(),bytes]).toString('base64');
    if(keyring)fs.writeFileSync(path.join(directory,'test-master-key'),key,{mode:0o600});
    fs.writeFileSync(path.join(directory,'profiles.json'),JSON.stringify({activeId:active,profiles:[
      {id:'other',name:'Other F50',mode:'KANO',loginMethod:'LOGIN',address:other.address,secret:saved},
      {id:'selected',name:'Saved F50',mode:'KANO',loginMethod:'LOGIN',address:fixture.address,...(secret?{secret:saved}:{})},
    ]}),{mode:0o600});
    return directory;
  };
  const open=async directory=>{ui=await launch({directory});await ui.wait('!!window.ufi && document.readyState==="complete"');};
  const close=async()=>{await ui?.close();ui=null;await delay(200);};
  const connected=()=>ui.wait('document.getElementById("connection-state").textContent.includes("已连接") && document.querySelector("#sidebar-clients .sidebar-number").textContent === "2"');
  try {
    let directory=seed();await open(directory);await connected();
    assert.equal((await ui.api('connectionInfo')).id,'selected');
    assert.equal((await ui.api('profiles')).profiles.length,2);
    assert.equal(await ui.run('document.getElementById("connection-dialog").open'),false);
    assert.equal(await ui.run('document.getElementById("password").value'),'');
    assert.equal(other.state.reads,0);
    const persisted=fs.readFileSync(path.join(directory,'profiles.json'),'utf8');
    assert.equal(persisted.includes(hashPassword('fixture-password')),false);assert.equal(persisted.includes('fixture-password'),false);
    checks.push('cold launch decrypts and connects only the last saved device without opening a login dialog, exposing credentials in inputs or duplicating profiles; sidebar and telemetry become live');
    await close();await open(directory);await connected();
    assert.equal((await ui.api('connectionInfo')).id,'selected');
    checks.push('a second native application launch restores the same saved profile again');await close();

    for(const options of [{secret:false},{keyring:false},{active:null}]){
      directory=seed(options);const before=fixture.state.reads;
      await open(directory);await ui.wait('document.getElementById("saved-profile").options.length===3');await delay(250);
      assert.equal(await ui.api('connectionInfo'),null);assert.equal(fixture.state.reads,before);assert.equal(other.state.reads,0);
      assert.equal(await ui.run('document.getElementById("connection-dialog").open'),false);await close();
    }
    checks.push('missing saved credentials, an unavailable keyring or no last-selected profile skip automatic connection and leave manual connection available');

    fixture.state.failBase=true;directory=seed();const original=fs.readFileSync(path.join(directory,'profiles.json'),'utf8');
    await open(directory);await ui.wait('document.getElementById("welcome-profile").textContent.includes("自动连接失败") && !document.getElementById("submit-connection").disabled');
    assert.equal(await ui.api('connectionInfo'),null);assert.equal(fs.readFileSync(path.join(directory,'profiles.json'),'utf8'),original);
    const attempts=fixture.state.reads;await delay(500);assert.equal(fixture.state.reads,attempts);
    fixture.state.failBase=false;await ui.click('#welcome-connect');await ui.click('#submit-connection');await connected();
    checks.push('a failed startup attempt preserves saved credentials, reports the failure, makes one attempt and allows a successful manual retry without retyping the password');await close();

    directory=seed({token:hashPassword('outdated-password')});const invalid=fs.readFileSync(path.join(directory,'profiles.json'),'utf8');
    await open(directory);await ui.wait('document.getElementById("welcome-profile").textContent.includes("自动连接失败")');
    assert.equal(await ui.api('connectionInfo'),null);assert.equal(fs.readFileSync(path.join(directory,'profiles.json'),'utf8'),invalid);
    await ui.click('#welcome-connect');await ui.fill('#password','fixture-password');await ui.click('#submit-connection');await connected();
    checks.push('expired credentials do not erase the profile; entering a replacement password connects normally');await close();

    fixture.state.slow=true;fixture.state.pending=null;directory=seed();await open(directory);
    await ui.wait('document.getElementById("welcome-profile").textContent.includes("正在自动连接") && document.getElementById("submit-connection").disabled');
    await ui.click('#welcome-connect');await ui.click('#cancel-connection');
    await ui.wait('!document.getElementById("connection-dialog").open && !document.getElementById("submit-connection").disabled');
    assert.equal(await ui.api('connectionInfo'),null);
    fixture.state.slow=false;fixture.state.pending?.();fixture.state.pending=null;
    await ui.click('#welcome-connect');await ui.click('#submit-connection');await connected();
    checks.push('a pending startup connection can be cancelled from the connection dialog; the next manual connection works and no automatic attempt replaces it');
    assert.equal(fixture.writes.length+other.writes.length,0);
    const report={result:'passed',version:require('../package.json').version,nativeWebKit:true,encryptedFixtureKey:true,checks,fixtureWrites:0};
    fs.writeFileSync(path.join(__dirname,'../artifacts/startup-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  }catch(error){console.error(ui?.diagnostics.slice(-3000));console.error(await ui?.run('({welcome:document.getElementById("welcome-profile").textContent,state:document.getElementById("connection-state").textContent,error:document.getElementById("connection-error").textContent})').catch(()=>null));throw error;}
  finally{await ui?.close();fixture.close();other.close();for(const directory of directories)fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
