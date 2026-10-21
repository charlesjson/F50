(() => {
  'use strict';
  if (window.top !== window) return;
  const config = __UFI_PLUGIN_MENUS__;
  if (!config || location.origin !== config.origin || location.pathname !== config.path) return;
  if (config.selected) document.documentElement.dataset.ufiPluginSelected = config.selected;
  const owners = new WeakMap(), targets = new Map(), tokens = new WeakMap();
  const newToken = () => {
    // LAN HTTP origins do not expose crypto.randomUUID in WebKitGTK.
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
    return `menu-${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  };
  let activeOwner=null;
  const scripts = new Map(), sources = new Map(), ranges = [], preparedScripts = new WeakSet();
  let nextLine = 100000, paddingBytes = 0;
  // WebKit ignores sourceURL for ordinary inline script stack frames. Distinct
  // bounded line ranges preserve attribution after native async/await resumes,
  // without eval, wrappers or changing global declaration semantics.
  const ownerForStack = stack => {
    const match = stack.match(/ufi-plugin-(plugin-[a-f0-9]{24}|legacy)\.js/);
    if(match)return match[1];
    for(const frame of stack.matchAll(/@(.+):(\d+):(\d+)(?:\n|$)/g)) {
      if(frame[1]!==location.href.split('#')[0])continue;
      const line=Number(frame[2]),range=ranges.find(range=>line>=range.first && line<=range.last);
      if(range)return range.owner;
    }
    for(const [source,owner] of sources)if(stack.includes(source))return owner;
    return null;
  };
  const executable = script => !script.type || ['module','text/javascript','application/javascript','text/ecmascript','application/ecmascript'].includes(script.type.trim().toLowerCase());
  for (const plugin of config.plugins) {
    for (const signature of plugin.scripts) scripts.set(signature,plugin.id);
    for (const source of plugin.sources || [])try{sources.set(new URL(source,location.href).href,plugin.id);}catch{}
  }
  const fingerprint = text => {
    let hash = 2166136261;
    text = text.replace(/\r\n?/g,'\n').trim();
    for (let i=0;i<text.length;i++) hash = Math.imul(hash ^ text.charCodeAt(i),16777619);
    return (hash>>>0).toString(16).padStart(8,'0');
  };
  const ownerForScript = script => {
    if (!script || !executable(script)) return null;
    return owners.get(script) || (script.src && sources.get(script.src)) || scripts.get(fingerprint(script.textContent || '')) || null;
  };
  const currentOwner = () => {
    if(activeOwner)return activeOwner;
    const direct = ownerForScript(document.currentScript);
    if (direct) return direct;
    const eventTarget=window.event?.currentTarget;
    if(eventTarget instanceof Element) {
      for(let node=eventTarget;node;node=node.parentElement)if(owners.has(node))return owners.get(node);
    }
    // sourceURL preserves attribution for timers, promises and event callbacks.
    const stack = new Error().stack || '';
    return ownerForStack(stack);
  };
  const bound = (callback,owner) => typeof callback!=='function' || !owner ? callback : function(...args) {
    const previous=activeOwner;activeOwner=owner;
    try{return callback.apply(this,args);}finally{activeOwner=previous;}
  };
  for(const name of ['setTimeout','setInterval','requestAnimationFrame','queueMicrotask']) {
    const original=window[name];if(!original)continue;
    window[name]=function(callback,...args){return original.call(this,bound(callback,currentOwner()),...args);};
  }
  const then=Promise.prototype.then;
  Promise.prototype.then=function(resolve,reject){const owner=currentOwner();return then.call(this,bound(resolve,owner),bound(reject,owner));};
  const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener,callbacks=new WeakMap();
  EventTarget.prototype.addEventListener=function(type,callback,options){
    const owner=currentOwner();
    if(typeof callback==='function' && owner){if(!callbacks.has(callback))callbacks.set(callback,bound(callback,owner));callback=callbacks.get(callback);}
    return add.call(this,type,callback,options);
  };
  EventTarget.prototype.removeEventListener=function(type,callback,options){
    remove.call(this,type,callback,options);
    if(typeof callback==='function' && callbacks.has(callback))remove.call(this,type,callbacks.get(callback),options);
  };
  const Observer=window.MutationObserver;
  window.MutationObserver=function(callback){return new Observer(bound(callback,currentOwner()));};
  window.MutationObserver.prototype=Observer.prototype;
  const tag = (node,owner) => {
    if (!owner || !(node instanceof Element)) return;
    if (!owners.has(node)) owners.set(node,owner);
  };
  const prepare = (node,owner) => {
    if (!(node instanceof Element)) return;
    if (node.tagName === 'SCRIPT') {
      // JSON templates and manifests must remain byte-for-byte data, even when
      // they were created from an attributed plugin callback.
      if (!executable(node)) return;
      const own = ownerForScript(node) || owner || (config.unmanaged ? 'legacy' : null);
      if (own) {
        owners.set(node,own);
        if (!node.src && !preparedScripts.has(node)) {
          preparedScripts.add(node);
          const source=node.textContent,lines=source.split(/\r\n?|\n|\u2028|\u2029/).length;
          if(paddingBytes+nextLine<=8*1024*1024 && nextLine+lines<=8*1024*1024) {
            ranges.push({first:nextLine+1,last:nextLine+lines,owner:own});
            node.textContent='\n'.repeat(nextLine)+source;
            paddingBytes+=nextLine;nextLine+=lines+32;
          }
          if(!/sourceURL=ufi-plugin-/.test(node.textContent))node.textContent+=`\n//# sourceURL=ufi-plugin-${own}.js\n`;
        }
      }
    } else tag(node,owner);
  };
  const create = Document.prototype.createElement;
  Document.prototype.createElement = function(...args) { const node=create.apply(this,args);tag(node,currentOwner());return node; };
  const appendChild = Node.prototype.appendChild, insertBefore = Node.prototype.insertBefore, replaceChild = Node.prototype.replaceChild;
  Node.prototype.appendChild = function(node) { prepare(node,currentOwner());return appendChild.call(this,node); };
  Node.prototype.insertBefore = function(node,reference) { prepare(node,currentOwner());return insertBefore.call(this,node,reference); };
  Node.prototype.replaceChild = function(node,reference) { prepare(node,currentOwner());return replaceChild.call(this,node,reference); };
  for (const name of ['append','prepend','replaceChildren']) {
    const original = Element.prototype[name];
    if (!original) continue;
    Element.prototype[name] = function(...nodes) { const owner=currentOwner();for(const node of nodes)prepare(node,owner);return original.apply(this,nodes); };
  }
  const html = Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  if (html?.set) Object.defineProperty(Element.prototype,'innerHTML',{...html,set(value){
    const owner=currentOwner(),before=owner?new Map():null;
    if(before)for(const child of this.children)before.set(child.outerHTML,(before.get(child.outerHTML)||0)+1);
    html.set.call(this,value);
    if(owner)for(const node of this.children){const count=before.get(node.outerHTML)||0;if(count)before.set(node.outerHTML,count-1);else tag(node,owner);}
  }});
  const adjacent = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function(position,value) {
    const owner=currentOwner(),parent=/beforebegin|afterend/i.test(position)?this.parentElement:this;
    const before = owner && parent ? new Set(parent.querySelectorAll('*')) : null;
    const result = adjacent.call(this,position,value);
    if(before)for(const node of parent.querySelectorAll('*'))if(!before.has(node))tag(node,owner);
    return result;
  };
  const ownerForElement = element => {
    for(let node=element;node && node!==document.body;node=node.parentElement)if(owners.has(node))return owners.get(node);
    return null;
  };
  const view = (__UFI_PLUGIN_VIEW_RENDERER__)({ config, owners, ownerForElement, ownerForStack });
  let timer, previous = '', ready = false;
  let nativeControls=new WeakSet();
  let extensionRoot=null,nativeIds=new Set();
  const collect = () => {
    timer = null;
    const items = [];targets.clear();
    for(const element of document.querySelectorAll('button,a[href],[role=button],input[type=button],input[type=submit],summary,select')) {
      // Older plugins sometimes resume an async function without an attributable
      // callback. New controls in UFI's extension menu still remain discoverable.
      const extension=extensionRoot?.contains(element);
      const owner=ownerForElement(element) || (!nativeControls.has(element) && !nativeIds.has(element.id) && extension ? 'legacy' : null);
      if(!owner || element.closest('dialog,[role=dialog],.modal,.modal_box,.kano_fixed_toast,.toastkano,#toastContainer'))continue;
      if(!ownerForElement(element))tag(element,owner);
      const text = (element.tagName==='SELECT' ? element.getAttribute('aria-label') || element.previousElementSibling?.textContent || element.title : element.textContent || element.value || element.getAttribute('aria-label') || element.title || '').replace(/\s+/g,' ').trim();
      if(!text || text.length>120)continue;
      let token=tokens.get(element);if(!token){token=newToken();tokens.set(element,token);}
      targets.set(token,{element,owner});
      const kind=element.tagName.toLowerCase();
      items.push({token,pluginId:owner,label:text,kind:['button','a','input','summary','select'].includes(kind)?kind:'button',disabled:!!element.disabled});
      if(items.length===128)break;
    }
    view.update();
    const payload = JSON.stringify({items,ready});
    if(payload===previous)return;previous=payload;
    window.webkit?.messageHandlers?.ufiPluginMenus?.postMessage(payload);
  };
  const schedule = () => { if(!timer)timer=setTimeout(collect,150); };
  // The native application can select an observed element, never provide code
  // or a selector to execute. Selection does not trigger its action.
  Object.defineProperty(window,'__ufiPluginMenuFocus',{value: token => {
    const entry=targets.get(token),target=entry?.element;
    if(!target?.isConnected)return false;
    view.select(entry.owner);
    for(let node=target.parentElement;node;node=node.parentElement)if(node.matches('.collapse,[data-name]') && node.dataset.name==='close')node.dataset.name='open';
    target.scrollIntoView({block:'center',inline:'nearest'});target.focus({preventScroll:true});
    target.style.outline='3px solid #529477';target.style.outlineOffset='5px';
    setTimeout(()=>{target.style.outline='';target.style.outlineOffset='';},4000);
    return true;
  }});
  const start = () => {
    nativeControls=new WeakSet([...document.querySelectorAll('button,a[href],[role=button],input[type=button],input[type=submit],summary,select')].filter(element=>!ownerForElement(element)));
    nativeIds=new Set([...document.querySelectorAll('[id]')].filter(element=>nativeControls.has(element)).map(element=>element.id));
    extensionRoot=document.querySelector('#collapseBtn_menu')?.nextElementSibling?.querySelector('.collapse_box') || document.querySelector('.collapse_box');
    ready=true;
    const observer=new MutationObserver(schedule);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','aria-label','title','open']});
    collect();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
