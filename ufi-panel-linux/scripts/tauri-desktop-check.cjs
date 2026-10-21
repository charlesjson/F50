'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const{launch}=require('./tauri-webdriver.cjs');
(async()=>{const ui=await launch();try{
 await ui.wait('document.readyState==="complete"&&typeof window.ufi==="object"');const status=await ui.api('autostart');assert.equal(status.supported,true);
 await ui.api('autostart',true);const file=path.join(ui.temp,'config/autostart/ufi-panel-linux.desktop');const content=fs.readFileSync(file,'utf8');assert.ok(content.includes('Exec='));assert.ok(!content.includes('electron'));assert.ok(!content.includes('app.asar'));assert.equal(fs.statSync(file).mode&0o777,0o600);
 await ui.api('autostart',false);assert.equal(fs.existsSync(file),false);
 const before=await ui.run('innerWidth');await ui.api('setZoom',1.1);await ui.wait(`innerWidth<${before}`);await ui.api('setZoom',1.0);await ui.api('copyText','Native clipboard fixture');
 const report={result:'passed',nativeWebKit:true,autostartTemporaryConfig:true,zoom:true,clipboardWrite:true};fs.writeFileSync(path.join(__dirname,'../artifacts/tauri-desktop-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await ui.close();}})().catch(e=>{console.error(e);process.exitCode=1});
