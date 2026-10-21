'use strict';
function page() {
  window.__menuErrors=[];window.__errorDetails=[];addEventListener('error',e=>{__menuErrors.push(e.message);__errorDetails.push({filename:e.filename,stack:e.error?.stack,sourceURL:document.currentScript?.textContent.match(/sourceURL=([^\n]+)/)?.[1],tracked:Node.prototype.appendChild.toString().includes('prepare')});});
  const id=crypto.randomUUID(),headers={authorization:'__FIXTURE_AUTH__'};
  // Match ordinary private-LAN HTTP, where WebKit has no randomUUID API.
  Object.defineProperty(crypto,'randomUUID',{value:undefined});
  setTimeout(()=>{const button=document.createElement('button');button.textContent='设备原生异步按钮';document.getElementById('native-section').appendChild(button);},250);
  window.runShellWithRoot=async command=>{
    await fetch('/fixture-menu-action',{method:'POST',body:JSON.stringify({command})});
    const content=command==='whoami'?'root':command.includes('grep -q')?'0':command.includes('pgrep')?'42':command.includes('ls ')?command:'fixture output';
    return {success:true,content};
  };
  // Small UFI host contract for exercising supplied plugins against a fake
  // device. These functions never invoke a real shell or install software.
  window.UFI_DATA={lan_ipaddr:''};setTimeout(()=>{UFI_DATA.lan_ipaddr=location.hostname;},200);window.KANO_baseURL='/api';window.common_headers=headers;
  window.wait=()=>new Promise(resolve=>setTimeout(resolve,20));window.t=key=>key==='close_btn'?'关闭':key;
  window.requestInterval=(callback,ms)=>{const timer=setInterval(callback,ms);return()=>clearInterval(timer);};
  window.createFixedToast=(id,html)=>{
    const el=document.createElement('div');el.id=id;el.className='toastkano kano_fixed_toast';el.innerHTML=html;document.body.append(el);
    return {el,close:()=>el.remove()};
  };
  window.createToast=html=>{const {el,close}=createFixedToast('fixture-toast',html);setTimeout(close,1000);return el;};
  window.collapseGen=(selector,target,key,callback)=>{
    const section=document.querySelector(target),input=document.createElement('input');input.type='checkbox';input.checked=localStorage.getItem(key)!=='close';
    section.dataset.name=input.checked?'open':'close';
    input.onchange=()=>{section.dataset.name=input.checked?'open':'close';callback?.(section.dataset.name);};document.querySelector(selector).append(input);
  };
  document.querySelector('.REFRESH_BTN').onclick=event=>{event.target.textContent=event.target.textContent==='停止刷新'?'开始刷新':'停止刷新';};
  window.fixtureDialog=title=>{
    const dialog=document.createElement('dialog');dialog.textContent=title;const close=document.createElement('button');close.textContent='关闭弹窗';close.onclick=()=>dialog.remove();dialog.append(close);document.body.append(dialog);dialog.showModal();
  };
  (async()=>{
    const result=await(await fetch('/api/get_custom_head',{headers})).json();
    const dom=new DOMParser().parseFromString(result.text,'text/html');
    for(const node of dom.querySelectorAll('script')) {
      const script=document.createElement('script');
      for(const attribute of node.attributes)script.setAttribute(attribute.name,attribute.value);
      script.textContent=node.textContent;document.body.appendChild(script);
    }
    let blocked=true;
    if(window.__TAURI__)try{await window.__TAURI__.core.invoke('dispatch',{action:'profiles',input:null});blocked=false;}catch{}
    await fetch('/isolation-result?blocked='+blocked+'&bridge='+typeof window.ufi);
  })();
  const tick=async()=>{
    const targets=[...document.querySelectorAll('[data-fixture-plugin-actions] button,[data-fixture-plugin-actions] a')].map(el=>{const r=el.getBoundingClientRect();return{label:el.textContent,x:r.x+r.width/2,y:r.y+r.height/2,outlined:!!el.style.outline};});
    const visible=element=>{
      const rect=element.getBoundingClientRect();if(!rect.width || !rect.height || getComputedStyle(element).visibility==='hidden')return false;
      for(let parent=element.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent),clip=parent.getBoundingClientRect();
        if(/hidden|clip|auto|scroll/.test(style.overflowY) && (rect.bottom<=clip.top || rect.top>=clip.bottom))return false;
        if(/hidden|clip|auto|scroll/.test(style.overflowX) && (rect.right<=clip.left || rect.left>=clip.right))return false;
      }return true;
    };
    const viewControls=[...document.querySelectorAll('button,input,textarea,select,iframe')].map(element=>{const r=element.getBoundingClientRect();return{tag:element.tagName,id:element.id,label:element.textContent,type:element.type,value:element.value,src:element.getAttribute('src'),visible:visible(element),x:r.x+r.width/2,y:r.y+r.height/2};});
    await fetch('/fixture-page-report',{method:'POST',body:JSON.stringify({id,menuFixture:true,targets,errors:__menuErrors,errorDetails:__errorDetails,viewControls,viewSelected:document.documentElement.dataset.ufiPluginSelected,viewFull:document.documentElement.dataset.ufiPluginFull,viewStatus:document.querySelector('#ufi-plugin-view-header p')?.textContent,nativeVisible:visible(document.querySelector('h1')),focused:document.activeElement===document.body?null:document.activeElement?.textContent?.slice(0,120),dialog:document.querySelector('dialog')?.textContent})});
    const command=await(await fetch('/fixture-command?id='+id)).json();
    if(command.type==='add-menu')window.fixtureAddMenu?.();
    if(command.type==='remove-menu')document.querySelector('[data-late-menu]')?.remove();
    if(command.type==='edit-view')document.querySelector('#fixture-view-input').value=command.value;
  };
  setInterval(()=>tick().catch(()=>{}),200);tick().catch(()=>{});
}
const {hashPassword}=require('../src/core/protocol.cjs');
module.exports=`<!doctype html><html><head><meta charset="utf-8"><title>Plugin menus fixture</title><style>body{font:16px system-ui;padding:30px}button,a{padding:12px;margin:8px}.collapse_box{display:flex;flex-wrap:wrap}.kano_fixed_toast{position:fixed;inset:15%;background:#eef4f0;padding:20px;z-index:100}.collapse[data-name=close]{height:0;overflow:hidden}</style></head><body><h1>设备插件菜单</h1><button class="REFRESH_BTN">停止刷新</button><button>设备原生按钮</button><div id="collapseBtn_menu"></div><div class="functions-container collapse" data-name="open"><div id="menus" class="collapse_box" data-fixture-plugin-actions></div></div><div id="native-section" class="collapse_box"></div><script>(${page.toString().replace('__FIXTURE_AUTH__',hashPassword('fixture-password'))})();</script></body></html>`;
