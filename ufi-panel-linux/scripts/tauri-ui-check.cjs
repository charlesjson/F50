'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');const assert=require('node:assert/strict');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ufi-tauri-ui-'));
 const driver=spawn(process.env.UFI_TAURI_DRIVER||'/tmp/ufi-tauri-test-tools/bin/tauri-driver',['--port','4444','--native-port','4445','--native-driver',process.env.UFI_WEBKIT_DRIVER||'/usr/bin/WebKitWebDriver'],{env:{...process.env,UFI_TEST_USER_DATA:temp,XDG_CONFIG_HOME:path.join(temp,'config'),WEBKIT_DISABLE_DMABUF_RENDERER:'1'},stdio:['ignore','pipe','pipe']});
 let diagnostics='';driver.stderr.on('data',d=>{diagnostics+=d});driver.stdout.on('data',d=>{diagnostics+=d});let session;
 const call=async(method,endpoint,data)=>{const r=await fetch('http://127.0.0.1:4444'+endpoint,{method,signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const v=await r.json();if(v.value?.error)throw new Error(v.value.error+': '+v.value.message);return v.value;};
 try{
  for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:4444/status');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  const created=await call('POST','/session',{capabilities:{alwaysMatch:{'tauri:options':{application:process.env.UFI_EXECUTABLE||'/workspace/build/tauri-linux/usr/bin/ufi-panel-linux'}}}});session=created.sessionId;
  const run=script=>call('POST',`/session/${session}/execute/sync`,{script,args:[]});
  const value=await run('return {title:document.title,bridge:typeof window.ufi,tauri:typeof window.__TAURI__,body:document.body.innerText.slice(0,800)}');
  console.log(JSON.stringify(value));
  const profiles=await call('POST',`/session/${session}/execute/async`,{script:'const done=arguments[arguments.length-1];window.ufi.profiles().then(v=>done({ok:true,value:v})).catch(e=>done({ok:false,error:e.message}));',args:[]});
  console.log(JSON.stringify({profiles}));assert.equal(value.bridge,'object');assert.equal(profiles.ok,true);
  console.log(JSON.stringify(await run('return {hidden:document.hidden,width:innerWidth,height:innerHeight,welcome:document.getElementById(\"welcome\").getBoundingClientRect().toJSON()}')));
  console.log(JSON.stringify({result:'passed',nativeWebKit:true}));
 }catch(e){console.error(diagnostics.slice(-6000));throw e;}finally{if(session)await call('DELETE',`/session/${session}`).catch(()=>{});driver.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
