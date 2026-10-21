'use strict';
const { normalizeSms, mailboxPage, queryOf } = require('./sms-mailbox.cjs');
const { smsNumber } = require('./sms-number.cjs');
const { isIP } = require('node:net');
const { Transport, ApiError } = require('./protocol.cjs');
const sum = (a,b) => a == null || b == null || a === '' || b === '' ? null : Number(a)+Number(b);
const flag = value => value === true || value === 1 || value === '1';
const num = (value,min,max,label) => { const n=Number(value); if(value===''||!Number.isInteger(n)||n<min||n>max)throw new Error(`${label}超出范围`);return n; };
const text = (value,label,max=256) => { if(typeof value!=='string'||value.length>max||value.includes('\0'))throw new Error(`${label}格式无效`);return value; };
const option=(value,values)=>{if(!values.includes(String(value)))throw new Error('此选项不适用于 ZWRT');return String(value)};
class ZwrtClient {
  constructor({address,ztePassword='',password=''}, options={}) {
    this.mode='ZWRT';this.transport=new Transport(address,'',{...options,apiPrefix:'/',signed:false});
    this.password=ztePassword||password;this.token='';this.version=null;this.controls=null;this.features=new ZwrtFeatures(this);
  }
  close(){this.transport.close();this.password='';this.token='';}
  async request(path, options={}) {
    const result=await this.transport.request(path,{...options,headers:{...options.headers,...(this.token?{Authorization:`Bearer ${this.token}`}:{})}});
    if(result.data?.ok===false)throw new ApiError(result.data.error?.message||result.data.error?.code||'datad 拒绝操作');
    return result.data;
  }
  async connect(){
    if(!this.password)throw new Error('请填写中兴后台口令以登录 datad');
    const login=await this.transport.request('/auth/login',{method:'POST',headers:{Authorization:'Basic '+Buffer.from('admin:'+this.password).toString('base64')}});
    if(login.data.ok!==true||!login.data.access_token)throw new Error('datad 登录失败');this.token=login.data.access_token;
    const state=await this.request('/state');
    if(!state.datad?.name?.startsWith('zwrt-datad'))throw new Error('响应不是支持的 zwrt-datad 状态');
    try{const caps=await this.request('/capabilities');this.controls=new Set((caps.controls||[]).map(c=>typeof c==='string'?c:c.action||c.name).filter(Boolean));}catch{this.controls=null;}
    this.version={model:state.device?.model_name||state.system?.model||'ZWRT 设备',nickname:state.device?.nickname||state.device?.alias_name,app_ver:state.datad.version,mode:'ZWRT'};
    return {version:this.version,base:this.normalize(state).base,mode:this.mode};
  }
  normalize(s){const n=s.net||{},t=s.traffic||{},b=s.battery||{},sys=s.system||{};
    return {at:Date.now(),version:this.version,base:{cpu_temp:sys.cpu_temp,cpu_usage:sys.cpu_usage??(s.runtime?.cpu_usage_tenths!=null?s.runtime.cpu_usage_tenths/10:null),mem_usage:sys.mem_used_pct,daily_data:sum(t.today_rx_bytes,t.today_tx_bytes),monthly_data:sum(t.month_rx_bytes,t.month_tx_bytes)},network:{network_type:n.type,network_provider:n.operator,ppp_status:n.wan_status,net_select:n.net_select,sim_slot:s.sim?.current_slot,cr_version:sys.sw_version||s.device?.sw_version,realtime_rx_thrpt:t.rx_speed,realtime_tx_thrpt:t.tx_speed,wifi_access_sta_num:s.clients?.wifi,sms_unread_num:s.sms?.unread,battery_vol_percent:b.percent,battery_charging:b.charging,battery_voltage:b.bat_uv,battery_current:b.bat_ua,realtime_time:sys.uptime,imei:sys.imei,iccid:s.sim?.iccid,imsi:s.sim?.imsi,Z5g_rsrp:n.nr_rsrp,Nr_snr:n.nr_snr,nr_rsrq:n.nr_rsrq,Nr_bands:n.nr_band,Nr_fcn:n.nr_channel,Nr_pci:n.nr_pci,Nr_bands_widths:n.nr_bw,lte_rsrp:n.lte_rsrp,lte_rsrq:n.lte_rsrq,Lte_snr:n.lte_snr,Lte_bands:n.lte_band,Lte_fcn:n.lte_channel,Lte_pci:n.lte_pci,Lte_bands_widths:n.lte_bw},connections:{},warnings:[]};
  }
  async snapshot(){return this.normalize(await this.request('/state'));}
  async control(action,params={},readOnly=false){
    if(!readOnly){if(!this.controls)throw new Error('未取得 datad 能力列表，不能确认此操作受支持');if(!this.controls.has(action))throw new Error(`当前 datad 未提供 ${action}`);}
    const d=await this.request('/control',{method:'POST',body:{action,params},timeout:action==='sms.send_raw'?65000:15000});return d.result??d;
  }
  async clients(){const s=await this.request('/state');if(!s.clients)throw new Error('设备未提供终端列表');return{station_list:(s.clients.list||[]).filter(d=>d.band!=='lan').map(d=>({hostname:d.name,ip:d.ip,mac:d.mac})),lan_station_list:(s.clients.list||[]).filter(d=>d.band==='lan').map(d=>({hostname:d.name,ip:d.ip,mac:d.mac}))};}
  async sms(input = {}) { const query = queryOf(input); const s = await this.request('/state'); if (!s.sms) throw new Error('设备未提供短信'); if (s.sms.stale) throw new Error('设备短信缓存已过期，请稍后重试'); if (s.sms.list != null && !Array.isArray(s.sms.list)) throw new Error('设备返回了无效的短信列表'); return mailboxPage((s.sms.list || []).map(message => normalizeSms({ ...message, number: message.num })), query, { complete: !s.sms.truncated, truncated: !!s.sms.truncated }); }
  async plugins(){throw new Error('datad 不包含 UFI 插件系统，请使用 KANO 连接');}
  async api(){throw new Error('此 UFI-TOOLS 接口不适用于 ZWRT 连接');}
  async at(){throw new Error('此版本尚未接入 ZWRT AT 通道');}
  async shell(){throw new Error('此版本尚未接入 ZWRT WebSocket 终端');}
}
class ZwrtFeatures {
  constructor(client){this.c=client;}
  async read(name,input={}){const c=this.c;
    if(name==='zwrt-control') return { controls: [...(c.controls || [])], verifiedCapabilities: c.controls !== null };
    if(name==='zwrt-recovery'){const d=await c.request('/network/recovery');this.recovery=d.config;return d;}
    if(name==='zwrt-activity')return c.request('/activity');
    if(name==='zwrt-remote')return{config:await c.request('/cloud/app/config'),status:await c.request('/cloud/app/status')};
    if(name==='zwrt-updates')return c.request('/ota/app');
    if(name==='tasks'){const d=await c.request('/tasks');return{tasks:(d.tasks||[]).map(t=>({...t,repeatDaily:t.repeat_daily,actionMap:{goformId:t.action}}))};}
    if(name==='lan'){const l=await c.request('/lan');this.lan=l;return{addressWritable:l.address_writable,lan:{lan_ipaddr:l.ip,lan_netmask:l.netmask,dhcpEnabled:l.dhcp_enabled?'1':'0',dhcpStart:l.dhcp_start,dhcpEnd:l.dhcp_end,dhcpLease_hour:l.lease_seconds/3600}};}
    if(name==='traffic'){const start=new Date(input.startTime),end=new Date(input.endTime);if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime()))throw new Error('无效日期');const d=await c.request('/traffic/history?'+new URLSearchParams({start:input.startDate||`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`,end:input.endDate||`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`}));return{usage:{usage:(d.days||[]).map(r=>({date:r.date,usage:r.bytes}))},warnings:['此页面目前仅提供 datad 历史流量；限额设置待适配。']};}
    if(name==='wifi'){
      const result=await c.control('wifi.status',{},true);const s=await c.request('/state');
      const keys=['main_2g','main_5g','main_6g'].filter(key=>result[key]);this.wifiSections=keys;
      const auth=value=>value?.includes('sae-mixed')?'WPA2PSKWPA3PSK':value?.includes('sae')?'WPA3PSK':value==='none'?'OPEN':'WPA2PSK';
      return{enabled:s.wlan?.enabled,points:keys.map((key,i)=>{const p=result[key];return{ChipIndex:i,AccessPointIndex:0,SSID:p.ssid,hasPassword:!!p.key,AuthMode:auth(p.encryption),ApMaxStationNumber:p.maxassoc,ApBroadcastDisabled:p.hidden,ApIsolate:p.isolate,AccessPointSwitchStatus:p.disabled==='0'?'1':'0'}}),noChipSwitch:true};
    }
    if(name==='forward'){const data=await c.request('/sms/forward/config'),cfg=data.config||{},status=data.status||{};return{method:{sms_forward_method:cfg.method||status.method},enabled:{enabled:cfg.enabled?'1':'0'},power:{enabled:cfg.power_forward_enabled?'1':'0'},blacklist:{phone:(cfg.blacklist_phone||[]).join('\n'),keywords:(cfg.blacklist_keywords||[]).join('\n')},separateTest:true,smtp:{smtp_host:cfg.smtp?.host,smtp_port:cfg.smtp?.port,smtp_username:cfg.smtp?.username,smtp_to:cfg.smtp?.to},warnings:[]};}
    const s=await c.request('/state');
    if(name==='network')return{network:{...c.normalize(s).network,roam_setting_option:s.net?.roaming_allowed==null?'':flag(s.net.roaming_allowed)?'on':'off'},slots:s.sim?.dual_sim?['1','2']:[String(s.sim?.current_slot||'1')]};
    if(name==='radio')return{radio:{network_type:s.net?.type,lte_band_lock:s.net?.lte_bands,nr_band_lock:s.net?.nr_band,neighbor_cell_info:s.neighbor?.cells||[],locked_cell_info:[]},bandTargets:[['LTE','4G LTE',s.net?.lte_bands],['NR-SA','5G SA',s.net?.sa_bands??s.net?.nr5g_sa_band_lock],['NR-NSA','5G NSA',s.net?.nsa_bands??s.net?.nr5g_nsa_band_lock]],requireNrBand:true,supported:s.net?.band_capabilities||{result:'设备未报告'}};
    if(name==='device')return{device:{},mode:'ZWRT',supportsNickname:false,usb:{details:JSON.stringify(s.usb||{},null,2)},warnings:['设备控制按 datad 能力判断；KANO 专属开关不适用。']};
    throw new Error('此页面尚未适配 ZWRT；不会发送 KANO 请求到 datad');
  }
  prepare(name,input={}){const c=this.c;let title,action,params={},path,body;
    const enabled=()=>option(input.enabled,['0','1'])==='1';
    switch(name){
      case 'zwrt-control':{
        action=text(input.action,'动作',120);if(!c.controls?.has(action))throw new Error('动作不在设备公布的能力列表中');
        params=JSON.parse(text(input.params||'{}','JSON 参数',40000));if(!params||typeof params!=='object'||Array.isArray(params))throw new Error('参数须为 JSON 对象');
        title=`datad 控制：${action}`;break;
      }
      case 'lan':{
        title='修改 LAN / DHCP';path='/lan';
        for(const key of ['lanIp','lanNetmask','dhcpStart','dhcpEnd'])if(isIP(input[key])!==4)throw new Error('请输入有效 IPv4 地址');
        body={dhcp_enabled:enabled(),dhcp_start:input.dhcpStart,dhcp_end:input.dhcpEnd,lease_seconds:num(input.lease,1,720,'租约')*3600};
        if(this.lan?.address_writable){body.ip=input.lanIp;body.netmask=input.lanNetmask;}else if(this.lan?.ip!==input.lanIp||this.lan?.netmask!==input.lanNetmask)throw new Error('该设备网关与掩码只读，请重新读取');
        break;
      }
      case 'network-mode':title='切换网络制式';action='network.set_mode';params={mode:option(input.mode,['WL_AND_5G','Only_5G','LTE_AND_5G','Only_LTE'])};break;
      case 'cellular':title='切换蜂窝数据';action=enabled()?'cellular.connect':'cellular.disconnect';break;
      case 'roaming':title='修改漫游';action='cellular.set';params={roaming:enabled()?1:0};break;
      case 'sim':title='切换 SIM';action='sim.set_slot';params={slot:num(input.slot,1,2,'卡槽')};break;
      case 'wifi-toggle':title='切换 Wi-Fi';action='wifi.set_module';params={enabled:enabled()};break;
      case 'wifi-save':{
        const section=this.wifiSections?.[num(input.chip,0,2,'热点')];if(!section)throw new Error('请重新读取热点列表');const ssid=text(input.ssid,'SSID',32);if(!ssid||Buffer.byteLength(ssid)>32)throw new Error('SSID 最多 32 字节');
        title='保存 Wi-Fi 热点';action='wifi.configure';params={section,ssid,encryption:{OPEN:'none',WPA2PSK:'psk2',WPA3PSK:'sae',WPA2PSKWPA3PSK:'sae-mixed'}[option(input.auth,['OPEN','WPA2PSK','WPA3PSK','WPA2PSKWPA3PSK'])],maxassoc:num(input.max,1,64,'终端上限'),hidden:option(input.hidden,['0','1']),isolate:option(input.isolate,['0','1'])};
        if(input.password){if(input.password.length<8)throw new Error('Wi-Fi 口令至少 8 位');params.key=text(input.password,'Wi-Fi 口令',63);}break;
      }
      case 'bands':title='修改频段锁';action={LTE:'band.set_lte','NR-SA':'band.set_nr_sa','NR-NSA':'band.set_nr_nsa'}[option(input.rat,['LTE','NR-SA','NR-NSA'])];params={bands:text(input.bands||'','频段',512).split(/[,，\s]+/).filter(Boolean).map(n=>num(n.replace(/^[bn]/i,''),1,1024,'频段')).join(',')};break;
      case 'cell-lock':title='锁定基站';action=option(input.rat,['12','16'])==='16'?'cell.lock_nr':'cell.lock_lte';params={pci:num(input.pci,0,input.rat==='16'?1007:503,'PCI'),[input.rat==='16'?'arfcn':'earfcn']:num(input.earfcn,0,3279165,'频点')};if(input.rat==='16')params.band=num(input.band,1,1024,'NR 频段');break;
      case 'cell-unlock':title='解除基站锁';action='cell.unlock_all';break;
      case 'sms-send':{
        title='发送短信';action='sms.send_raw';const number=smsNumber(input);const content=text(input.content,'短信',280);if(!content)throw new Error('号码或内容无效');const date=new Date(),pad=v=>String(v).padStart(2,'0');
        params={number,message_hex:Buffer.from(content,'utf16le').swap16().toString('hex'),sms_time:[date.getFullYear()%100,date.getMonth()+1,date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds()].map(pad).join(';')+';+32',sender:'host'};break;
      }
      case 'sms-delete':case 'sms-read':title=name==='sms-delete'?'删除短信':'标记已读';action=name==='sms-delete'?'sms.delete':'sms.mark_read';params={ids:String(num(input.id,0,2147483647,'短信 ID'))+';'};break;
      case 'hostname':title='修改终端名称';action='client.rename';if(!/^([\da-f]{2}:){5}[\da-f]{2}$/i.test(input.mac))throw new Error('无效 MAC');params={mac:input.mac,hostname:text(input.name,'名称',64)};break;
      case 'reboot':title='重启设备';action='device.reboot';break;
      case 'shutdown':title='关闭设备';action='device.poweroff';break;
      case 'restart-schedule':title='设置定时重启';action='schedule.reboot.set';if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))throw new Error('无效时间');params={enabled:enabled(),time:input.time};break;
      case 'task-add':{
        title='保存设备任务';const actions={reboot:'device.reboot',connect:'cellular.connect',disconnect:'cellular.disconnect',wifiOn:'wifi.set_module',wifiOff:'wifi.set_module'};if(!actions[input.action])throw new Error('未知任务动作');if(!/^[\w-]{1,80}$/.test(input.id)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))throw new Error('任务参数无效');path='/tasks';body={id:input.id,time:input.time,repeat_daily:option(input.repeat,['0','1'])==='1',action:actions[input.action],params:input.action.startsWith('wifi')?{enabled:input.action==='wifiOn'}:{}};break;
      }
      case 'task-remove':title='删除任务';path='/tasks/remove';body={id:text(input.id,'任务 ID',80)};break;
      case 'forward-toggle':title='设置转发开关';path='/sms/forward/config';body=input.type==='power'?{power_forward_enabled:enabled()}:{enabled:enabled()};break;
      case 'forward-blacklist':title='保存转发黑名单';path='/sms/forward/config';body={blacklist_phone:text(input.phone||'','号码黑名单',4096).split(/\r?\n/).filter(Boolean),blacklist_keywords:text(input.keywords||'','关键词',4096).split(/\r?\n/).filter(Boolean)};break;
      case 'forward-smtp':title='保存邮件转发配置';path='/sms/forward/config';body={method:'smtp',smtp:{host:text(input.smtp_host,'SMTP 服务器'),port:Number(option(input.smtp_port,['465','587'])),username:text(input.smtp_username,'用户名'),to:text(input.smtp_to,'收件邮箱')},smtp_forward_device_info:option(input.forward_dev_info,['0','1'])==='1'};if(input.smtp_password)body.smtp.password=text(input.smtp_password,'SMTP 口令');break;
      case 'forward-dingtalk':title='保存钉钉转发配置';path='/sms/forward/config';body={method:'dingtalk',dingtalk_webhook:text(input.webhook_url,'Webhook',2048),dingtalk_forward_device_info:option(input.forward_dev_info,['0','1'])==='1'};if(input.secret)body.dingtalk_secret=text(input.secret,'密钥');break;
      case 'forward-webhook':{const u=new URL(input.url);if(u.protocol!=='https:')throw new Error('Webhook 须为 HTTPS');title='保存 Webhook 转发';path='/sms/forward/config';body={method:'webhook',webhook_url:u.href};break;}
      case 'forward-test':title='发送转发测试消息';path='/sms/forward/test';body={};break;
      case 'zwrt-nms-save':{
        title='保存 NMS 远程管理配置';path='/cloud/app/config';
        const broker=new URL(input.broker);if(!['ssl:','wss:'].includes(broker.protocol)||broker.username||broker.password)throw new Error('MQTT 使用 ssl:// 或 wss:// 地址');
        const platform=new URL(input.platform_url);if(platform.protocol!=='https:'||platform.username||platform.password)throw new Error('平台使用 HTTPS 地址');
        body={enabled:enabled(),broker:broker.href,platform_url:platform.href,username:text(input.username,'用户名'),report_interval_seconds:num(input.interval,10,3600,'上报间隔'),remote_enabled:option(input.remote_enabled,['0','1'])==='1'};
        if(input.password)body.password=text(input.password,'NMS 密码',512);
        break;
      }
      case 'zwrt-recovery-save':title='配置断网自动恢复';path='/network/recovery';body={enabled:enabled(),interval_seconds:Number(option(input.interval,['30','60','120'])),failure_threshold:num(input.failures,3,10,'连续失败次数'),cooldown_seconds:num(input.cooldown,180,3600,'冷却秒数'),max_redials:num(input.redials,1,5,'重拨上限'),reboot_after_failures:option(input.reboot,['0','1'])==='1',...(Array.isArray(this.recovery?.probe_urls)?{probe_urls:[...this.recovery.probe_urls]}:{})};break;
      case 'zwrt-recovery-resume':title='恢复自动检测';path='/network/recovery/resume';body={};break;
      case 'zwrt-activity-clear':title='清空执行记录';path='/activity/clear';body={};break;
      case 'zwrt-ota-check':title='检查 datad 更新';path='/ota/app/check';body={};break;
      case 'zwrt-ota-install':title='安装已检查的 datad 更新';path='/ota/app/install';body={candidate_id:text(input.id,'更新候选 ID',200)};break;
      default:throw new Error('此操作尚未适配 ZWRT，不会发送不匹配的原厂请求');
    }
    const detail=name==='zwrt-control'?JSON.stringify({action,params},null,2):name==='sms-send'?`收件人：${params.number}\n内容：${input.content}\n可能产生短信费用。`:`${title}\n目标为 ZWRT 设备；配置变更可能造成连接中断。`;
    return{title,detail,run:async()=>{const result=path?await c.request(path,{method:'POST',body}):await c.control(action,params);return{result:'success',deviceResult:result};}};
  }
}
module.exports={ZwrtClient,ZwrtFeatures};
