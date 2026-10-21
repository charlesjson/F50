'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Device,quote}=require('./device.cjs');
const ROOT=path.resolve(__dirname,'..'),HOME='/data/adb/ufi-blackbox',NAME='网络黑匣子';
const start=`<!-- [KANO_PLUGIN_START] ${NAME} -->`,end=`<!-- [KANO_PLUGIN_END] ${NAME} -->`;
const hookStart='# UFI_BLACKBOX_START',hookEnd='# UFI_BLACKBOX_END';
function replaceBlock(text,first,last,replacement){
 const a=text.indexOf(first),b=text.indexOf(last);
 if(a===-1&&b===-1)return replacement?text+(text.endsWith('\n')?'':'\n')+replacement+'\n':text;
 if(a<0||b<a||text.indexOf(first,a+first.length)!==-1||text.indexOf(last,b+last.length)!==-1)throw Error('Ambiguous plugin markers; no content overwritten');
 return text.slice(0,a)+replacement+text.slice(b+last.length);
}
async function main(){
 const index=process.argv.indexOf('--connection'),file=index>=0?process.argv[index+1]:process.env.UFI_CONNECTION_FILE;
 if(!file)throw Error('Usage: node scripts/install.cjs --connection /private/connection.json [--uninstall]');
 const device=new Device(JSON.parse(fs.readFileSync(file,'utf8'))),version=await device.api('/api/version_info');
 if(version.model!=='F50')throw Error('This installer has been validated for F50 only');
 const id=await device.shell('id -u');if(id!=='0')throw Error('Working UFI advanced/root shell is required');
 const uninstall=process.argv.includes('--uninstall');
 const before=(await device.api('/api/get_custom_head')).text;
 if(typeof before!=='string')throw Error('Invalid plugin document');
 const bootEncoded=await device.shell('if [ -f /sdcard/ufi_tools_boot.sh ]; then base64 /sdcard/ufi_tools_boot.sh; fi');
 const boot=Buffer.from(bootEncoded,'base64').toString('utf8');
 const backup=path.join(ROOT,'private',new Date().toISOString().replace(/[:.]/g,'-'));
 fs.mkdirSync(backup,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(backup,'plugins-before.html'),before,{mode:0o600});fs.writeFileSync(path.join(backup,'boot-before.sh'),boot,{mode:0o600});
 async function putText(target,value,mode='600'){
  const base64=Buffer.from(value).toString('base64');
  const result=await device.shell('umask 077; printf %s '+quote(base64)+' | base64 -d > '+quote(target+'.new')+' && chmod '+mode+' '+quote(target+'.new')+' && mv '+quote(target+'.new')+' '+quote(target)+' && echo BLACKBOX_TEXT_OK');
  if(!result.includes('BLACKBOX_TEXT_OK'))throw Error('Cannot write '+target);
 }
 const nextBoot=replaceBlock(boot,hookStart,hookEnd,uninstall?'':hookStart+'\n/system/bin/sh '+HOME+'/service.sh start >/dev/null 2>&1\n'+hookEnd);
 if(uninstall){
  await device.shell('/system/bin/sh '+HOME+'/service.sh stop');
  const latest=await device.api('/api/get_custom_head');if(latest.text!==before)throw Error('Plugins changed concurrently; retry uninstall');
  await device.api('/api/set_custom_head',{method:'POST',body:{text:replaceBlock(before,start,end,'')}});
  await putText('/sdcard/ufi_tools_boot.sh',nextBoot,'755');
  console.log('Uninstalled menu and startup hook; stopped recorder. Private logs remain at '+HOME);return;
 }
 const directory=await device.shell('if [ -e '+HOME+' ]; then if [ -L '+HOME+' ] || [ ! -f '+HOME+'/OWNER ]; then echo BLACKBOX_CONFLICT; else echo BLACKBOX_OWNED; fi; else mkdir '+HOME+' && chmod 700 '+HOME+' && echo ufi-blackbox > '+HOME+'/OWNER && echo BLACKBOX_CREATED; fi');
 if(!/BLACKBOX_(OWNED|CREATED)/.test(directory))throw Error('Installation directory is not owned by this plugin');
 const abi=await device.shell('getprop ro.product.cpu.abilist'),arch=abi.includes('arm64-v8a')?'arm64':'armv7';
 const binary=fs.readFileSync(path.join(ROOT,'build','blackbox-'+arch+'.bin'));
 console.log('Installing UFI Blackbox on '+version.model+' / UFI '+version.app_ver+' ('+arch+'); binary '+(binary.length/1024/1024).toFixed(2)+' MiB');
 // Stop only our collector. The old executable remains available until the new upload verifies.
 await device.shell('if [ -x '+HOME+'/blackbox ]; then '+HOME+'/blackbox stop; fi');
 await device.installFile('ufi-blackbox.bin',binary,HOME+'/blackbox','700');
 const installed=await device.shell(HOME+'/blackbox version');if(installed!=='0.1.0')throw Error('Installed binary did not run: '+installed);
 await device.installFile('ufi-blackbox-service.sh',fs.readFileSync(path.join(ROOT,'service.sh')),HOME+'/service.sh','700');
 await putText(HOME+'/config.json',JSON.stringify({address:'http://127.0.0.1:2333',authorization:device.token}));
 const started=JSON.parse(await device.shell('/system/bin/sh '+HOME+'/service.sh start'));if(!started.running)throw Error('Collector could not start');
 const status=JSON.parse(await device.shell(HOME+'/blackbox status'));if(!status.running)throw Error('Collector is not responding');
 const next=start+'\n'+fs.readFileSync(path.join(ROOT,'plugin.html'),'utf8')+'\n'+end;
 const latest=await device.api('/api/get_custom_head');if(latest.text!==before)throw Error('Plugins changed concurrently; collector running but menu was not changed');
 const saved=replaceBlock(before,start,end,next);
 await device.api('/api/set_custom_head',{method:'POST',body:{text:saved}});
 if((await device.api('/api/get_custom_head')).text.trim()!==saved.trim())throw Error('Plugin readback did not match');
 await putText('/sdcard/ufi_tools_boot.sh',nextBoot,'755');
 const report={model:version.model,ufi:version.app_ver,version:status.version,arch,binary_bytes:binary.length,pid:status.pid,rss_kb:status.rss_kb,log_limit_bytes:status.log_limit_bytes,other_plugins_preserved:true,boot_hook_installed:true,backup};
 fs.mkdirSync(path.join(ROOT,'artifacts'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts','installation.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
