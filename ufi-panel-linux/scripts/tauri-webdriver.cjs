'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const{spawn,execFileSync}=require('node:child_process');
exports.launch=async(options={})=>{
 const temp=options.directory||fs.mkdtempSync(path.join(os.tmpdir(),'ufi-tauri-ui-'));
 let wm;if(process.env.UFI_TEST_WINDOW_MANAGER==='1'){wm=spawn('openbox',['--sm-disable'],{stdio:'ignore'});await new Promise(r=>setTimeout(r,350));}
 const driver=spawn(process.env.UFI_TAURI_DRIVER||'/workspace/build/tauri-test-tools/bin/tauri-driver',['--port','4444','--native-port','4445','--native-driver',process.env.UFI_WEBKIT_DRIVER||['/usr/bin/WebKitWebDriver','/usr/libexec/webkit2gtk4.1/WebKitWebDriver','/usr/libexec/webkit2gtk-4.1/WebKitWebDriver','/usr/lib/webkit2gtk-4.1/WebKitWebDriver'].find(file=>fs.existsSync(file))||'/usr/bin/WebKitWebDriver'],{env:{...process.env,UFI_TEST_USER_DATA:temp,XDG_CONFIG_HOME:path.join(temp,'config'),WEBKIT_DISABLE_DMABUF_RENDERER:'1'},stdio:['ignore','pipe','pipe']});
 let diagnostics='',session;driver.stderr.on('data',d=>diagnostics+=d);driver.stdout.on('data',d=>diagnostics+=d);
 const call=async(method,endpoint,data)=>{const r=await fetch('http://127.0.0.1:4444'+endpoint,{method,signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const body=await r.json();if(body.value?.error)throw new Error(body.value.error+': '+body.value.message);return body.value;};
 for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:4444/status');break;}catch{if(driver.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}}
 try{const created=await call('POST','/session',{capabilities:{alwaysMatch:{'tauri:options':{application:process.env.UFI_EXECUTABLE||'/workspace/build/tauri-linux/usr/bin/ufi-panel-linux'}}}});session=created.sessionId;}catch(e){driver.kill();driver.stdout.destroy();driver.stderr.destroy();wm?.kill();if(!options.directory)fs.rmSync(temp,{recursive:true,force:true});throw new Error(e.message+'\n'+diagnostics.slice(-4000));}
 const endpoint=suffix=>`/session/${session}`+suffix;
 const run=(script,args=[])=>call('POST',endpoint('/execute/sync'),{script:script.trim().startsWith('return ')||script.includes(';')?script:'return ('+script+')',args});
 const asyncRun=(script,args=[])=>call('POST',endpoint('/execute/async'),{script,args});
 const api=async(name,...params)=>{const result=await asyncRun('const done=arguments[arguments.length-1];const [name,params]=arguments;window.ufi[name](...params).then(value=>done({ok:true,value:value??null})).catch(e=>done({ok:false,error:e.message}));',[name,params]);if(!result.ok)throw new Error(result.error);return result.value;};
 const wait=async(predicate,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await run('return ('+predicate+')'))return;await new Promise(r=>setTimeout(r,120));}throw new Error('UI wait expired: '+predicate);};
 const find=async selector=>(await call('POST',endpoint('/element'),{using:'css selector',value:selector}))['element-6066-11e4-a52e-4f735466cecf'];
 const actionable=selector=>wait('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');return !!el&&!el.matches(":disabled")&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0})()');
 // Fedora's GTK 4 WebDriver cannot synthesize input for GTK 3 windows. Keep
 // the explicit DOM mode separate from the default native input validation.
 const domInput=process.env.UFI_WEBDRIVER_DOM_INPUT==='1';
 const click=async selector=>{await actionable(selector);await run('document.querySelector(arguments[0]).scrollIntoView({block:"center",inline:"nearest"});',[selector]);if(domInput)return run('document.querySelector(arguments[0]).click();',[selector]);return call('POST',endpoint('/element/'+await find(selector)+'/click'),{});};
 const fill=async(selector,text)=>{await actionable(selector);if(domInput)return run('const el=document.querySelector(arguments[0]);el.focus();el.value=arguments[1];el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));',[selector,text]);const id=await find(selector);await call('POST',endpoint('/element/'+id+'/clear'),{});if(text)await call('POST',endpoint('/element/'+id+'/value'),{text});else await run('document.querySelector(arguments[0]).dispatchEvent(new Event("input",{bubbles:true}));',[selector]);};
 const select=(selector,value)=>run('const el=document.querySelector(arguments[0]);el.value=arguments[1];el.dispatchEvent(new Event("change",{bubbles:true}));',[selector,value]);
 const {NAV}=await import('../src/renderer/navigation.mjs');
 const navigate=async page=>{const group=NAV.find(g=>g.pages.some(([id])=>id===page));await click(`[data-group="${group.id}"]`);await click(`[data-view="${page}"]`);};
 const screenshot=name=>{const tree=execFileSync('xwininfo',['-root','-tree'],{encoding:'utf8'}),id=tree.match(/(0x[0-9a-f]+) "UFI Panel Linux"/)[1];execFileSync('xwd',['-id',id,'-silent','-out',path.join(__dirname,'../artifacts/'+name+'.xwd')]);};
 return{run,asyncRun,api,wait,click,fill,select,navigate,screenshot,call,endpoint,get diagnostics(){return diagnostics},temp,async close(){try{await call('DELETE',endpoint(''));}catch{}driver.kill();driver.stdout.destroy();driver.stderr.destroy();wm?.kill();if(!options.directory)fs.rmSync(temp,{recursive:true,force:true});}};
};
