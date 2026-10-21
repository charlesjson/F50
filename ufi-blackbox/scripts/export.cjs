'use strict';
const fs=require('node:fs'),path=require('node:path');const {Device}=require('./device.cjs');
const connection=process.argv[2],destination=process.argv[3];
if(!connection||!destination)throw Error('Usage: node scripts/export.cjs /private/connection.json /output/log.jsonl');
const device=new Device(JSON.parse(fs.readFileSync(connection)));
(async()=>{
 const plan=JSON.parse(await device.shell('/data/adb/ufi-blackbox/blackbox export-plan'));
 const output=path.resolve(destination),temporary=output+'.partial';
 fs.mkdirSync(path.dirname(output),{recursive:true});const fd=fs.openSync(temporary,'wx',0o600);let bytes=0;
 try{
  for(const f of plan.files){
   if(!/^records-[0-4]\.jsonl$/.test(f.name)||!/^\d+$/.test(String(f.inode))||!Number.isSafeInteger(f.size)||f.size<0||f.size>4*1024*1024)throw Error('Invalid log manifest');
   for(let offset=0;offset<f.size;){
    const response=JSON.parse(await device.shell('/data/adb/ufi-blackbox/blackbox export-chunk '+f.name+' '+offset+' '+f.size+' '+f.inode));
    if(response.error)throw Error(response.error);
    const chunk=Buffer.from(response.data,'base64');
    if(!chunk.length||response.next!==offset+chunk.length||response.next>f.size)throw Error('Invalid export chunk');
    fs.writeSync(fd,chunk);bytes+=chunk.length;offset=response.next;
   }
  }
 }catch(e){fs.closeSync(fd);fs.unlinkSync(temporary);throw e;}
 fs.closeSync(fd);fs.renameSync(temporary,output);
 console.log('Exported '+bytes+' bytes to '+output);
})().catch(e=>{console.error(e.message);process.exitCode=1});
