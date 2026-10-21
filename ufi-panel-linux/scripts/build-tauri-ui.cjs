'use strict';
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'build/tauri-ui');fs.mkdirSync(out,{recursive:true});
for(const file of fs.readdirSync(path.join(root,'src/renderer')))fs.copyFileSync(path.join(root,'src/renderer',file),path.join(out,file));
const index=path.join(out,'index.html');fs.writeFileSync(index,fs.readFileSync(index,'utf8').replace('<script src="./app.js" type="module"></script>','<script src="./tauri-bridge.js"></script>\n  <script src="./app.js" type="module"></script>').replace("connect-src 'none'","connect-src ipc: http://ipc.localhost"));
fs.writeFileSync(index,fs.readFileSync(index,'utf8').replace('id="sidebar-version">Tauri</span>',`id="sidebar-version">Tauri · ${require('../package.json').version}</span>`));

const crypto=require('node:crypto');
const files=['package.json','src/backend.cjs','src/worker.cjs','src-tauri/Cargo.toml','src-tauri/tauri.conf.json','src-tauri/capabilities/main.json',...fs.readdirSync(path.join(root,'src-tauri/src')).map(name=>'src-tauri/src/'+name),...fs.readdirSync(path.join(root,'src/renderer')).map(name=>'src/renderer/'+name),...fs.readdirSync(path.join(root,'src/core')).map(name=>'src/core/'+name)];
const sources=Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
fs.writeFileSync(path.join(out,'build-manifest.json'),JSON.stringify({version:require('../package.json').version,framework:'Tauri',sources},null,2)+'\n');
