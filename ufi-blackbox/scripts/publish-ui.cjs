'use strict';
const fs=require('node:fs'),path=require('node:path');const {Device}=require('./device.cjs');
const device=new Device(JSON.parse(fs.readFileSync(process.argv[2])));
(async()=>{
 const start='<!-- [KANO_PLUGIN_START] 网络黑匣子 -->',end='<!-- [KANO_PLUGIN_END] 网络黑匣子 -->';
 const source=fs.readFileSync(path.resolve(__dirname,'../plugin.html'),'utf8'),before=(await device.api('/api/get_custom_head')).text,a=before.indexOf(start),b=before.indexOf(end);
 if(a<0||b<a||before.indexOf(start,a+start.length)!==-1)throw Error('Cannot uniquely locate installed plugin');
 const next=before.slice(0,a)+start+'\n'+source+'\n'+end+before.slice(b+end.length);
 if((await device.api('/api/get_custom_head')).text!==before)throw Error('Concurrent edit');
 await device.api('/api/set_custom_head',{method:'POST',body:{text:next}});
 if((await device.api('/api/get_custom_head')).text.trim()!==next.trim())throw Error('Readback mismatch');console.log('Updated plugin UI; running collector unchanged');
})().catch(e=>{console.error(e.message);process.exitCode=1});
