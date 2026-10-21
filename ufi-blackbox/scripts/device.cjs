'use strict';
const http=require('node:http'),https=require('node:https'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest();
const quote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
class Device {
 constructor(config){this.address=config.address;this.token=config.token||sha(config.password||'').toString('hex');}
 async api(path,{method='GET',body,headers={},timeout=20000}={}){
  const stamp=String(Date.now()),mac=crypto.createHmac('md5','minikano_kOyXz0Ciz4V7wR0IeKmJFYFQ20jd').update('minikano'+method+path.split('?')[0]+stamp).digest();
  const payload=body===undefined?undefined:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  return new Promise((resolve,reject)=>{
   const url=new URL(this.address+path),req=(url.protocol==='https:'?https:http).request(url,{method,headers:{authorization:this.token,'kano-t':stamp,'kano-sign':sha(Buffer.concat([sha(mac.subarray(0,8)),sha(mac.subarray(8))])).toString('hex'),...(payload?{'content-type':'application/json','content-length':payload.length}:{}),...headers}},res=>{
    const parts=[];let length=0;res.on('data',b=>{length+=b.length;if(length>8*1024*1024){req.destroy(Error('Response exceeded limit'));return;}parts.push(b)});res.on('error',reject);res.on('end',()=>{try{if(res.statusCode!==200)throw Error('Device HTTP '+res.statusCode);const value=JSON.parse(Buffer.concat(parts));if(value.error)throw Error('Device returned an API error');resolve(value)}catch(e){reject(e)}});
   });req.setTimeout(timeout,()=>req.destroy(Error('Device request timed out')));req.on('error',reject);req.end(payload);
  });
 }
 async shell(command){
  const response=await this.api('/api/root_shell',{method:'POST',body:{command,timeout:15000}});
  let value=response.result;for(let i=0;i<3&&typeof value==='object'&&value!==null;i++){if('content' in value)value=value.content;else if('result' in value)value=value.result;else break;}
  if(typeof value!=='string')throw Error('Unexpected shell response');return value.trim();
 }
 async upload(name,bytes){
  const boundary='blackbox-'+crypto.randomBytes(12).toString('hex');
  const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const result=await this.api('/api/upload_img',{method:'POST',body,headers:{'content-type':'multipart/form-data; boundary='+boundary},timeout:90000});
  if(!/^\/uploads\/[a-zA-Z0-9._-]+$/.test(result.url))throw Error('Unexpected uploaded file path');return result.url;
 }
 async installFile(name,bytes,target,mode){
  const uploaded=await this.upload(name,bytes),file=uploaded.split('/').at(-1),expected=sha(bytes).toString('hex');
  try{
   const url='http://127.0.0.1:2333/api'+uploaded;
   const command='/data/data/com.minikano.f50_sms/files/curl --fail --silent --show-error --max-time 30 '+quote(url)+' -o '+quote(target+'.new')+' && chmod '+mode+' '+quote(target+'.new')+' && sha256sum '+quote(target+'.new');
   const output=await this.shell(command);if(output.split(/\s/)[0]!==expected)throw Error('Uploaded file checksum mismatch');
   const moved=await this.shell('mv '+quote(target+'.new')+' '+quote(target)+' && echo BLACKBOX_FILE_OK');if(!moved.includes('BLACKBOX_FILE_OK'))throw Error('Cannot place installed file');
  }finally{await this.api('/api/delete_img',{method:'POST',body:{file_name:file}});}
 }
}
module.exports={Device,quote,sha};
