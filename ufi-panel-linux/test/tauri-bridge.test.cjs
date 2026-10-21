'use strict';
const{test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('Tauri invocation errors remain Error-like for existing UI retry and stale-state paths',async()=>{
 const calls=[];const window={__TAURI__:{core:{invoke:async(name,input)=>{calls.push({name,input});if(input.action==='snapshot')throw'fixture offline';return {ok:true};}},event:{listen:()=>Promise.resolve(()=>{})}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/renderer/tauri-bridge.js'),'utf8'),{window});
 await assert.rejects(window.ufi.snapshot(),error=>error.message==='fixture offline');assert.deepEqual(JSON.parse(JSON.stringify(await window.ufi.profiles())),{ok:true});assert.equal(calls[0].name,'dispatch');
 const legacy=fs.readFileSync(require.resolve('../src/preload.cjs'),'utf8');const methods=[...legacy.matchAll(/^  (\w+):/gm)].map(match=>match[1]);for(const method of methods)assert.equal(typeof window.ufi[method],'function',method+' must survive migration');
 assert.equal(Object.isFrozen(window.ufi),true);
});
