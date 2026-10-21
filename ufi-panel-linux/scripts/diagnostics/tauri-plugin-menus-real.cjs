'use strict';
// Read-only UI verification: do not click a device plugin action.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {launch}=require('../tauri-webdriver.cjs');
(async()=>{
  if(!process.env.UFI_CONNECTION_FILE)throw Error('需要 UFI_CONNECTION_FILE');
  const connection=JSON.parse(fs.readFileSync(process.env.UFI_CONNECTION_FILE,'utf8'));
  let ui;
  try {
    ui=await launch();await ui.wait('document.readyState==="complete" && !!window.ufi');
    await ui.run('window.__menuErrors=[];addEventListener("error",e=>__menuErrors.push(e.message));addEventListener("unhandledrejection",e=>__menuErrors.push(String(e.reason)))');
    await ui.select('#poll-interval','0');await ui.click('#welcome-connect');
    await ui.fill('#address',connection.address);await ui.fill('#password',connection.password);if(connection.ztePassword)await ui.fill('#zte-password',connection.ztePassword);
    await ui.click('#submit-connection');await ui.wait('document.getElementById("connection-state").textContent.includes("已连接")');
    await ui.navigate('plugins');
    await ui.wait('Array.from(document.querySelectorAll("[data-plugin-menu]")).some(el=>el.textContent.includes("安装SSH"))',30000);
    const menus=await ui.run('Array.from(document.querySelectorAll(".installed-plugin")).map(row=>({plugin:row.querySelector("h3")?.textContent,menus:Array.from(row.querySelectorAll("[data-plugin-menu]")).map(el=>el.textContent)}))');
    const labels=menus.flatMap(item=>item.menus);for(const expected of ['安装SSH','卸载SSH','上传公钥'])assert.ok(labels.includes(expected),expected);
    assert.deepEqual(await ui.run('window.__menuErrors'),[]);
    ui.screenshot('tauri-plugin-menus-device-'+require('../../package.json').version);
    const report={result:'passed',version:require('../../package.json').version,device:'F50 / UFI-TOOLS',menus,deviceActionsClicked:0,pluginConfigurationWrites:0};
    fs.writeFileSync(path.join(__dirname,'../../artifacts/plugin-menus-device-'+require('../../package.json').version+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  } catch(error) {
    console.error(ui?.diagnostics.slice(-16000));
    console.error(await ui?.run('({note:document.getElementById("plugin-note")?.textContent,items:document.getElementById("plugins-content")?.textContent,errors:window.__menuErrors})').catch(()=>null));
    throw error;
  } finally {await ui?.api('disconnect').catch(()=>{});await ui?.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
