'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Device}=require('./device.cjs');
const connection=process.env.UFI_CONNECTION_FILE||process.argv[2];
if(!connection)throw Error('Connection file required');
const device=new Device(JSON.parse(fs.readFileSync(connection)));
async function sample(){
 const status=JSON.parse(await device.shell('/data/adb/ufi-blackbox/blackbox status'));
 const raw=await device.shell('cat /proc/'+status.pid+'/stat; cat /proc/uptime; getconf CLK_TCK; grep -E "VmRSS|VmHWM" /proc/'+status.pid+'/status');
 const lines=raw.split('\n'),stat=lines[0].slice(lines[0].lastIndexOf(')')+2).trim().split(/\s+/);
 return {pid:status.pid,uptime:Number(lines[1].split(' ')[0]),hz:Number(lines[2]),ticks:Number(stat[11])+Number(stat[12]),rss_kb:status.rss_kb,hwm_kb:Number(raw.match(/VmHWM:\s+(\d+)/)?.[1]||0),log_bytes:status.log_bytes,sample_at:status.last_sample_at,probe_at:status.last_probe_at,samples:status.records.filter(r=>r.kind==='sample').length,probes:status.records.filter(r=>r.kind==='probe').length,latest:status.records.filter(r=>r.kind==='sample').at(-1)?.data};
}
(async()=>{
 const before=await sample();console.log('Measuring collector for 90 seconds; initial RSS '+before.rss_kb+' KiB');
 await new Promise(resolve=>setTimeout(resolve,45000));const middle=await sample();console.log('45s: RSS '+middle.rss_kb+' KiB; sampling continues');
 await new Promise(resolve=>setTimeout(resolve,45000));const after=await sample();
 if(before.pid!==after.pid)throw Error('Collector restarted during measurement');
 const elapsed=after.uptime-before.uptime,cpuSeconds=(after.ticks-before.ticks)/after.hz;
 const report={duration_seconds:elapsed,cpu_seconds:cpuSeconds,cpu_percent_of_one_core:cpuSeconds/elapsed*100,rss_kb:[before.rss_kb,middle.rss_kb,after.rss_kb],high_water_rss_kb:after.hwm_kb,new_samples:after.samples-before.samples,new_probes:after.probes-before.probes,log_bytes_added:after.log_bytes-before.log_bytes,estimated_log_bytes_per_day:(after.log_bytes-before.log_bytes)/elapsed*86400,latest_sample:after.latest,measurements:[before,middle,after]};
 const output=path.resolve(__dirname,'../artifacts/resources.json');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,measurements:undefined},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
