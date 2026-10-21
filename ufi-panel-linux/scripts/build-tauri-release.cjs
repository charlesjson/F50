'use strict';
const path=require('node:path');const{spawn}=require('node:child_process');const root=path.resolve(__dirname,'..');
const run=(exe,args)=>new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd:root,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${exe} failed: ${code}`)));});
(async()=>{
 await run(process.execPath,['scripts/build-tauri-ui.cjs']);
 await run('docker',['build','-f','packaging/tauri/Dockerfile.builder','-t','ufi-panel-tauri-builder:bookworm','.']);
 const user=require('node:os').userInfo(),home=user.homedir;
 await run('docker',['run','--init','--rm','--user',`${user.uid}:${user.gid}`,'--mount',`type=bind,src=${root},dst=/workspace`,'--mount',`type=bind,src=${path.join(home,'.cargo')},dst=/cargo`,'--mount',`type=bind,src=${path.join(home,'.rustup')},dst=/rustup,readonly`,'ufi-panel-tauri-builder:bookworm','cargo','build','--release','--locked','--manifest-path','src-tauri/Cargo.toml']);
 await run(process.execPath,['scripts/package-tauri.cjs']);
})().catch(e=>{console.error(e);process.exitCode=1});
