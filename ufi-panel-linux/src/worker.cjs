'use strict';
const readline=require('node:readline');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {createBackend}=require('./backend.cjs');
if(Number(process.versions.node.split('.')[0])<18)throw new Error('需要系统 Node.js 18 或以上版本');
let backend, next=0, key;
const pending=new Map();
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const host=(action,input)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});send({kind:'host',id,action,input});});
function storage(master) {
  key=master?Buffer.from(master,'base64'):null;
  if(key&&key.length!==32)throw new Error('无效密钥环数据');
  return {
    isEncryptionAvailable:()=>!!key,
    getSelectedStorageBackend:()=>key?'secret-service':'unavailable',
    encryptString(text){if(!key)throw new Error('系统密钥环不可用');const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([Buffer.from('UFI2'),iv,c.getAuthTag(),ciphertext]);},
    decryptString(bytes){if(!key||bytes.subarray(0,4).toString()!=='UFI2')throw new Error('旧版口令需要重新输入');const d=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(4,16));d.setAuthTag(bytes.subarray(16,32));return Buffer.concat([d.update(bytes.subarray(32)),d.final()]).toString('utf8');},
  };
}
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
lines.on('line',async line=>{
  let packet;
  try {
    packet=JSON.parse(line);
    if(packet.kind==='host-response'){
      const item=pending.get(packet.id);pending.delete(packet.id);if(item)packet.ok?item.resolve(packet.value):item.reject(new Error(packet.error));return;
    }
    if(packet.kind==='init'){
      if(backend)throw new Error('后端已启动');
      const file=path.join(packet.directory,'profiles.json');
      if(fs.existsSync(file)) {
        const old=JSON.parse(fs.readFileSync(file,'utf8'));
        if(old.profiles?.some(p=>p.secret&&Buffer.from(p.secret,'base64').subarray(0,4).toString()!=='UFI2')) {
          const backup=path.join(packet.directory,'profiles.electron-backup.json');
          if(!fs.existsSync(backup))fs.writeFileSync(backup,fs.readFileSync(file),{mode:0o600,flag:'wx'});
        }
      }
      backend=createBackend({directory:packet.directory,storage:storage(packet.masterKey),host,emit:(event,payload)=>send({kind:'event',event,payload})});
      send({kind:'ready'});return;
    }
    if(packet.kind==='shutdown'){backend?.close();key?.fill(0);process.exit(0);}
    if(!backend)throw new Error('后端尚未就绪');
    const value=await backend.dispatch(packet.action,packet.input);
    send({kind:'response',id:packet.id,ok:true,value:value??null});
  } catch(error) {if(packet?.kind==='init')send({kind:'startup-error',error:error.message||'后端初始化失败'});else send({kind:'response',id:packet?.id??0,ok:false,error:error.message||'操作失败'});}
});
lines.on('close',()=>{backend?.close();key?.fill(0);process.exit(0);});
process.on('SIGTERM',()=>{backend?.close();key?.fill(0);process.exit(0);});
