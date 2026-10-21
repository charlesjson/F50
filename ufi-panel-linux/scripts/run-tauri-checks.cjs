'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),real=process.argv.includes('--device');
const test=process.argv.includes('--startup')?'scripts/tauri-startup-check.cjs':process.argv.includes('--sessions')?'scripts/tauri-session-check.cjs':process.argv.includes('--tray')?'scripts/tauri-tray-check.cjs':real?'scripts/tauri-real-device.cjs':process.argv.includes('--plugins')?'scripts/tauri-plugin-check.cjs':process.argv.includes('--plugin-view')?'scripts/tauri-plugin-view-check.cjs':process.argv.includes('--plugin-menus')?'scripts/tauri-plugin-menu-check.cjs':process.argv.includes('--sidebar')?'scripts/tauri-sidebar-check.cjs':process.argv.includes('--history')?'scripts/tauri-history-check.cjs':process.argv.includes('--live-charts')?'scripts/tauri-live-charts-check.cjs':process.argv.includes('--client-access')?'scripts/tauri-client-access-check.cjs':'scripts/tauri-interaction-check.cjs';
const run=(exe,args)=>new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd:root,env:process.env,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${exe} exited with ${code}`)));});
(async()=>{
 if(process.env.UFI_TAURI_DRIVER&&process.env.UFI_EXECUTABLE){await run(process.execPath,[test]);return;}
 if(!fs.existsSync(path.join(root,'build/tauri-stage/usr/bin/ufi-panel-linux')))throw new Error('先运行 npm run dist 生成 Tauri 发行包');
 const home=os.homedir(),user=os.userInfo();
 const mounts=['--mount',`type=bind,src=${root},dst=/workspace`];
 if(!fs.existsSync(path.join(root,'build/tauri-test-tools/bin/tauri-driver'))){await run('docker',['run','--init','--rm','--user',`${user.uid}:${user.gid}`,...mounts,'--mount',`type=bind,src=${path.join(home,'.cargo')},dst=/cargo`,'--mount',`type=bind,src=${path.join(home,'.rustup')},dst=/rustup,readonly`,'ufi-panel-tauri-builder:bookworm','cargo','install','tauri-driver','--version','2.1.0','--locked','--root','/workspace/build/tauri-test-tools','--target-dir','/workspace/build/tauri-driver-debian-target']);}
 const args=['run','--init','--rm','--user',`${user.uid}:${user.gid}`,'--shm-size=256m',...mounts,'-e','UFI_TAURI_DRIVER=/workspace/build/tauri-test-tools/bin/tauri-driver','-e','UFI_EXECUTABLE=/workspace/build/tauri-stage/usr/bin/ufi-panel-linux','-e','WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1','-e','UFI_TEST_WINDOW_MANAGER=1'];
 if(real){if(!process.env.UFI_CONNECTION_FILE)throw new Error('需要 UFI_CONNECTION_FILE（只读联调）');args.push('--mount',`type=bind,src=${path.resolve(process.env.UFI_CONNECTION_FILE)},dst=/tmp/ufi-connection.json,readonly`,'-e','UFI_CONNECTION_FILE=/tmp/ufi-connection.json');}
 args.push('ufi-panel-tauri-builder:bookworm','xvfb-run','-a','dbus-run-session','--','node',test);await run('docker',args);
})().catch(error=>{console.error(error.message);process.exitCode=1});
