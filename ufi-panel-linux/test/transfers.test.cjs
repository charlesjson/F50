'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { Transport } = require('../src/core/protocol.cjs');
const { Jobs } = require('../src/core/jobs.cjs');
const { multipartFile, speedConfig, targetHeaders, installUpdate } = require('../src/core/transfers.cjs');
const { Maintenance } = require('../src/core/maintenance.cjs');
async function server(t, handler) { const s=http.createServer(handler);s.listen(0,'127.0.0.1');await once(s,'listening');t.after(()=>{s.closeAllConnections();s.close()});return `http://127.0.0.1:${s.address().port}`; }
const json=(r,d)=>r.end(JSON.stringify(d));
test('streaming does not retain payload and cancellation terminates an ongoing request', async t => {
  let closed=false;
  const address=await server(t,(_req,res)=>{res.writeHead(200);const timer=setInterval(()=>res.write(Buffer.alloc(1024)),5);res.on('close',()=>{clearInterval(timer);closed=true})});
  const c=new Transport(address);t.after(()=>c.close());const controller=new AbortController();let bytes=0;
  const pending=c.request('/api/stream',{responseType:'stream',signal:controller.signal,onChunk:n=>{bytes+=n;if(bytes>=2048)controller.abort()}});
  await assert.rejects(pending,/取消/);assert.ok(bytes>=2048);
  await new Promise(r=>setTimeout(r,20));assert.equal(closed,true);assert.equal(c.pending.size,0);
});
test('multipart upload retains binary bytes and explicit content type', async t => {
  const payload=Buffer.from([0,255,1,128]);const file=multipartFile('sample.bin',payload);
  const address=await server(t,async(req,res)=>{let body=[];for await(const c of req)body.push(c);body=Buffer.concat(body);assert.ok(body.includes(payload));assert.match(req.headers['content-type'],/multipart\/form-data; boundary=/);json(res,{url:'/uploads/example.bin'})});
  const c=new Transport(address);t.after(()=>c.close());assert.equal((await c.request('/api/upload_img',{method:'POST',...file})).data.url,'/uploads/example.bin');
});
test('proxy debug can display a 4xx response without following redirects or exposing device auth as custom auth',async t=>{
 const address=await server(t,(_req,res)=>{res.writeHead(404,{'content-type':'text/plain'});res.end('missing')});const c=new Transport(address);t.after(()=>c.close());
 const result=await c.request('/api/proxy/--https://example.test/a',{responseType:'text',acceptAnyStatus:true});assert.equal(result.status,404);assert.equal(result.data,'missing');
 assert.deepEqual(targetHeaders({Authorization:'Bearer fixture'}),{'kano-authorization':'Bearer fixture'});assert.throws(()=>targetHeaders({host:'evil'}));
});
test('speed config accepts original endpoint headers and rejects unsupported protocols/methods',()=>{
 const config=speedConfig({mode:'duplex',duration:3,threads:1,downloadEndpoints:[{url:'https://example.test/data',headers:{Authorization:'fixture'}}],uploadEndpoints:[{url:'https://example.test/up',method:'PUT'}]});
 assert.equal(config.downloadEndpoints[0].headers['kano-authorization'],'fixture');assert.equal(config.uploadEndpoints[0].method,'PUT');
 assert.throws(()=>speedConfig({mode:'download',duration:3,threads:1,download:'file:///etc/passwd'}));
});
test('cancel before installation never submits install request',async()=>{
 const controller=new AbortController();let posted=false;
 const client={version:{app_ver:'1'},api:async path=>{if(path.includes('status')){controller.abort();return{status:'done'}}posted=true;return{result:'success'}}};
 await assert.rejects(installUpdate(client,{signal:controller.signal,update(){}}),/取消/);assert.equal(posted,false);
});
test('job cancellation and failures keep their own bounded outcome records',async()=>{
 const jobs=new Jobs();const id=jobs.start({title:'test',target:'fixture',kind:'speed',run:({signal})=>new Promise((_,reject)=>{if(signal.aborted)reject(new Error('cancelled'));else signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})})});
 jobs.cancel(id);await new Promise(r=>setImmediate(r));assert.equal(jobs.list()[0].state,'cancelled');assert.equal(jobs.list()[0].controller,undefined);
 const second=jobs.start({title:'uncertain',target:'fixture',run:async()=>{const e=new Error('unknown');e.uncertain=true;throw e}});await new Promise(r=>setImmediate(r));assert.equal(jobs.get(second).state,'unknown');
});
test('updating UFI password changes current auth only after success and masks confirmation',async()=>{
 const c={transport:{authorization:'old'},api:async(_path,options)=>{assert.equal(options.body.token,'new-test123');return{result:'success'}}};
 const action=new Maintenance(c).prepare('ufi-password',{password:'new-test123',repeat:'new-test123'});assert.ok(!action.detail.includes('new-test123'));assert.equal(c.transport.authorization,'old');await action.run();assert.notEqual(c.transport.authorization,'old');assert.equal(c.changedCredentials.token,c.transport.authorization);
});

test('UFI binary stream compatibility handles chunked plus length on an isolated connection',async t=>{
 const net=require('node:net');const server=net.createServer(socket=>socket.once('data',request=>{assert.match(request.toString(),/Connection: close/i);socket.end('HTTP/1.1 200 OK\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n4\r\ndata\r\n0\r\n\r\n')}));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const c=new Transport(`http://127.0.0.1:${server.address().port}`);t.after(()=>c.close());let received=0;const result=await c.request('/api/speedtest?ckSize=1',{responseType:'stream',legacyChunked:true,onChunk:bytes=>received+=bytes});assert.equal(received,4);assert.equal(result.bytes,4);
});

test('installation recovery observes the new version without replaying an uncertain install',async()=>{
 let installations=0;const client={version:{app_ver:'1'},transport:{closed:false},api:async path=>{if(path.endsWith('status'))return{status:'done'};if(path==='/api/install_apk'){installations++;throw new Error('ECONNRESET')}if(path==='/api/version_info')return{app_ver:'2'};throw new Error('unexpected')}};
 const result=await installUpdate(client,{signal:new AbortController().signal,update(){}});assert.equal(installations,1);assert.equal(result.before,'1');assert.equal(result.after,'2');assert.equal(client.version.app_ver,'2');
});
