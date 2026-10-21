'use strict';
const { _electron: electron } = require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const{navigate}=require('./ui-helpers.cjs');
(async()=>{
 if(!process.env.UFI_CONNECTION_FILE)throw new Error('Set UFI_CONNECTION_FILE for authorized device verification');
 const input=JSON.parse(fs.readFileSync(process.env.UFI_CONNECTION_FILE,'utf8'));const target=new URL(input.address);target.port='';
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ufi-goform-ui-'));const env={...process.env,UFI_TEST_USER_DATA:temp};delete env.ELECTRON_RUN_AS_NODE;
 const instance=await electron.launch({args:process.env.UFI_EXECUTABLE?[]:[path.resolve(__dirname,'..')],env,...(process.env.UFI_EXECUTABLE?{executablePath:process.env.UFI_EXECUTABLE}:{})});const errors=[];
 try{
  const page=await instance.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.click('#connect-button');await page.selectOption('#connection-mode','GOFORM');await page.fill('#address',target.href);await page.fill('#zte-password',input.ztePassword);await page.click('#submit-connection');await page.waitForFunction(()=>document.getElementById('connection-state').textContent.includes('已连接'));
  await page.waitForFunction(()=>document.getElementById('network-chip').textContent!=='—');assert.equal(await page.locator('#temperature').textContent(),'—');
  await navigate(page,'clients');await page.waitForSelector('#clients-content table');await navigate(page,'sms');await page.waitForSelector('.sms-item');await navigate(page,'network');await page.waitForSelector('form[data-action="network-mode"]');
  await page.screenshot({path:path.resolve(__dirname,'../artifacts/goform.png')});assert.deepEqual(errors,[]);console.log(JSON.stringify({mode:'GOFORM',login:'LOGIN_MULTI_USER',result:'passed',deviceWrites:'none (authentication only)',pageErrors:errors}));
 }catch(e){const p=(await instance.windows())[0];if(p)console.error({state:await p.locator('#connection-state').textContent(),error:await p.locator('#connection-error').textContent(),mode:await p.inputValue('#connection-mode'),method:await p.inputValue('#login-method'),pageErrors:errors});throw e;}finally{await instance.close();fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e.message);process.exitCode=1});
