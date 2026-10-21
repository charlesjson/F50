'use strict';
(() => {
  if(window.ufi||!window.__TAURI__)return;
  const invoke=async(action,input)=>{try{return await window.__TAURI__.core.invoke('dispatch',{action,input:input??null});}catch(error){throw new Error(typeof error==='string'?error:error?.message||'桌面操作失败');}};
  const subscribe=(name,callback)=>{const pending=window.__TAURI__.event.listen(name,event=>callback(event.payload));return()=>{pending.then(remove=>remove());};};
  const bridge={
    hideWindow:()=>invoke('hide-window'),showWindow:()=>invoke('show-window'),setZoom:value=>invoke('set-zoom',value),openMonitor:()=>invoke('monitor-open'),autostart:enabled=>invoke('autostart',enabled),
    connectionInfo:()=>invoke('connection-info'),profiles:()=>invoke('profiles'),removeProfile:id=>invoke('remove-profile',id),connect:input=>invoke('connect',input),disconnect:()=>invoke('disconnect'),cancelConnection:()=>invoke('cancel-connection'),copyText:value=>invoke('copy-text',value),
    snapshot:()=>invoke('snapshot'),smsNumberPreview:input=>invoke('sms-number-preview',input),telemetryConfigure:value=>invoke('telemetry-configure',value),telemetryState:()=>invoke('telemetry-state'),onTelemetry:callback=>subscribe('telemetry',callback),historyDevices:()=>invoke('history-devices'),historyQuery:input=>invoke('history-query',input),clients:()=>invoke('clients'),sms:input=>invoke('sms',input),plugins:()=>invoke('plugins'),
    featureRead:(name,data)=>invoke('feature-read',{name,data}),prepareOperation:(name,data)=>invoke('operation-prepare',{name,data}),commitOperation:id=>invoke('operation-commit',id),cancelOperation:id=>invoke('operation-cancel',id),
    jobs:()=>invoke('jobs'),startJob:(kind,data)=>invoke('job-start',{kind,data}),cancelJob:id=>invoke('job-cancel',id),jobResult:id=>invoke('job-result',id),onJobs:callback=>subscribe('jobs-changed',callback),pickUpload:()=>invoke('pick-upload'),saveText:(name,text)=>invoke('save-text',{name,text}),importConfig:()=>invoke('import-config'),openTerminal:port=>invoke('open-terminal',port),openPanel:()=>invoke('open-panel'),openPluginSettings:input=>invoke('open-plugin-settings',input),pluginMenus:input=>invoke('plugin-menus',input),openPluginMenu:input=>invoke('plugin-menu-open',input),releasePluginMenus:()=>invoke('plugin-menus-release'),onPluginMenus:callback=>subscribe('plugin-menus',callback),onPluginsChanged:callback=>subscribe('plugins-changed',callback),command:input=>invoke('command',input),export:()=>invoke('export')
  };
  Object.defineProperty(window,'ufi',{value:Object.freeze(bridge),writable:false,configurable:false});
})();
