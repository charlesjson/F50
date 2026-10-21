'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const{once}=require('node:events');
const{GoformClient}=require('../src/core/goform.cjs');
test('GOFORM direct uses origin/referer, native Cookie, and no KANO signature headers',async t=>{
 let logged=false;
 const server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://fixture');assert.equal(req.headers['kano-sign'],undefined);assert.ok(req.headers.referer);assert.ok(req.headers.origin);res.setHeader('content-type','application/json');
 if(req.method==='POST'){let body='';for await(const b of req)body+=b;const fields=new URLSearchParams(body);assert.equal(fields.get('goformId'),'LOGIN_MULTI_USER');assert.equal(fields.get('IP'),'localhost');logged=true;res.setHeader('set-cookie','stok=fixture; Path=/');res.end(JSON.stringify({result:'success'}));return}
 const cmd=u.searchParams.get('cmd');res.end(JSON.stringify(cmd==='loginfo'?{loginfo:logged?'ok':''}:cmd==='LD'?{LD:'fixture'}:{network_type:'5G',cr_version:'B09',monthly_rx_bytes:'1024',monthly_tx_bytes:'2048'}));if(logged)assert.equal(req.headers.cookie,'stok=fixture');
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close()});
 const c=new GoformClient({address:`http://127.0.0.1:${server.address().port}`,ztePassword:'fixture',loginMethod:'LOGIN_MULTI_USER'});t.after(()=>c.close());await c.connect();const d=await c.snapshot();assert.equal(d.network.network_type,'5G');assert.equal(d.base.monthly_data,3072);await assert.rejects(c.api('/api/get_theme'),/不提供/);
});
