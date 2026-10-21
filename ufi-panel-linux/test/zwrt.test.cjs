'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const{once}=require('node:events');
const{ZwrtClient}=require('../src/core/zwrt.cjs');
test('ZWRT uses Basic enrollment then Bearer only, normalizes optional fields, and gates writes on capabilities',async t=>{
 const calls=[];const state={datad:{name:'zwrt-datad',version:'fixture'},device:{model_name:'MU5250'},system:{cpu_temp:45,cpu_usage:0,mem_used_pct:50},battery:{percent:0,charging:0},net:{type:'SA',nr_rsrp:-90,wan_status:'connected',net_select:'Only_5G'},sms:{unread:1,list:[{id:3,num:'10000',text:'你好😀',unread:1,tag:1,date:'10-15 12:00'}]},traffic:{today_rx_bytes:0,today_tx_bytes:0}};
 const server=http.createServer(async(req,res)=>{res.setHeader('content-type','application/json');assert.equal(req.headers['kano-sign'],undefined);
 if(req.url==='/auth/login'){assert.equal(req.headers.authorization,'Basic '+Buffer.from('admin:fixture-password').toString('base64'));res.end(JSON.stringify({ok:true,access_token:'fixture-token'}));return;}
 assert.equal(req.headers.authorization,'Bearer fixture-token');
 if(req.url==='/state'){res.end(JSON.stringify(state));return;}if(req.url==='/capabilities'){res.end(JSON.stringify({controls:['network.set_mode','sms.send_raw']}));return;}
 if(req.url==='/control'){let body='';for await(const b of req)body+=b;calls.push(JSON.parse(body));res.end(JSON.stringify({ok:true,result:{result:'success'}}));return;}
 res.writeHead(404);res.end('{}');
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close()});
 const c=new ZwrtClient({address:`http://127.0.0.1:${server.address().port}`,ztePassword:'fixture-password'});t.after(()=>c.close());await c.connect();
 const snapshot=await c.snapshot();assert.equal(snapshot.base.cpu_usage,0);assert.equal(snapshot.network.battery_vol_percent,0);assert.equal(snapshot.base.daily_data,0);assert.equal(snapshot.base.monthly_data,null);assert.equal((await c.sms()).messages[0].text,'你好😀');
 state.sms.list.push({id:4,num:'10086',text:'sent',tag:2,unread:0},{id:5,num:'10086',text:'draft',tag:4,unread:0},{id:6,num:'10086',text:'unknown',unread:0});
 const sent=await c.sms({folder:'sent'});assert.equal(sent.messages[0].tag,2);assert.equal(sent.messages[0].folder,'sent');assert.equal(sent.messages[0].unread,false);assert.equal((await c.sms({folder:'draft'})).messages[0].text,'draft');assert.equal((await c.sms({folder:'other'})).messages[0].text,'unknown');
 await c.features.prepare('network-mode',{mode:'Only_LTE'}).run();assert.deepEqual(calls[0],{action:'network.set_mode',params:{mode:'Only_LTE'}});
 await assert.rejects(c.features.prepare('reboot').run(),/未提供/);assert.equal(calls.length,1);
 await c.features.prepare('sms-send',{number:'10000',content:'你好😀'}).run();assert.equal(calls[1].params.message_hex,'4f60597dd83dde00');const international=c.features.prepare('sms-send',{number:'7700 900123',numberMode:'international',countryCode:'44',content:'Hello'});assert.match(international.detail,/\+447700900123/);await international.run();assert.equal(calls[2].params.number,'+447700900123');
 assert.match(calls[1].params.sms_time,/^\d{2};\d{2};\d{2};\d{2};\d{2};\d{2};\+32$/);
});
