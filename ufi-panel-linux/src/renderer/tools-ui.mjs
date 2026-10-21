import { el, button, hint, field, select, toggle } from './features.mjs';
import { bytes, rate } from './format.mjs';
const $ = id => document.getElementById(id);
export const toolViews = ['speed','proxy','updates','appearance','authentication','service','location','usb','preferences','voice','zwrt-recovery','zwrt-activity','zwrt-remote','zwrt-updates','zwrt-control'];
const jobNames = { running: '运行中', 'waiting-device': '等待设备', succeeded: '已完成', cancelled: '已停止', failed: '失败', unknown: '结果未知' };
export class ToolsUI {
  constructor(featureUI, { connected, toast }) {
    this.f = featureUI; this.connected = connected; this.toast = toast; this.epoch = 0; this.states = new Map(); this.records = []; this.active = '';
    this.profiles = []; this.selectedProfile = null; this.currentSpeed = null;
    window.ufi.onJobs(records => { this.records = records; this.updateJobs(); });
    window.ufi.jobs().then(records => { this.records = records; this.updateJobs(); }).catch(() => {});
    $('jobs-button').addEventListener('click', () => this.jobs());
    this.applyPreferences();
  }
  reset() { this.epoch++; this.states.clear(); this.currentSpeed = null; for (const view of toolViews) $(`${view}-host`).replaceChildren(); }
  async open(view) { this.active = view; if (!this.states.has(view)) { const state = { key: view, content: $(`${view}-host`), busy: false, dirty: false, dirtyForms: new Set() }; this.states.set(view, state); await this.load(state); } }
  async refresh() { const state = this.states.get(this.active); if (!state) return; if (state.content.querySelector('form[data-dirty="true"]') && !(await this.f.confirmPlan({title:'放弃未提交的内容并刷新？',detail:'当前请求或参数尚未提交。返回可继续编辑。',target:'当前页面',address:''},'放弃并刷新'))) return; await this.load(state); }
  async load(state, discard = false) {
    if (state.busy) return;
    if (state.dirty && !discard) { this.toast('本页有未保存的更改，保存后再刷新；重新连接会清除草稿。'); return; }
    const epoch = this.epoch; state.busy = true;
    if (!state.content.childNodes.length) state.content.append(hint('正在读取…'));
    try {
      if (state.key.startsWith('zwrt-')) { const connection = await window.ufi.connectionInfo(); if (connection?.mode !== 'ZWRT') throw new Error('此功能需要 ZWRT/datad 连接，当前设备使用的是 ' + (connection?.mode || '未连接')); }
      const data = ['speed','proxy','preferences'].includes(state.key) ? {} : await window.ufi.featureRead(state.key === 'usb' ? 'device' : state.key, state.key === 'voice' ? { slot: state.slot || '0' } : {});
      if (epoch !== this.epoch) return;
      state.dirty = false; state.dirtyForms.clear(); state.content.replaceChildren(); this.render(state, data);
    } catch (error) { if (epoch === this.epoch) { state.content.replaceChildren(hint(error.message), button('重新读取', () => this.load(state, true))); } }
    finally { state.busy = false; }
  }
  form(state, title, action, fields, options = {}) { return this.f.form(title, action, fields, { state, after: () => this.load(state), ...options }); }
  localForm(title, fields, submit, handler) {
    const form = el('form','card settings-form'); form.append(el('h3','',title));
    const inputs = el('div','form-grid');
    for (const f of fields) {
      const wrap = el('label', f.type === 'textarea' ? 'wide-field' : ''); wrap.append(el('span','',f.label));
      const input = el(f.choices ? 'select' : f.type === 'textarea' ? 'textarea' : 'input'); input.name = f.key; input.required = !f.optional;
      if (f.choices) for (const [v,label] of f.choices) { const option = el('option','',label); option.value = v; input.append(option); }
      else if (f.type === 'textarea') { input.rows = f.rows || 5; input.spellcheck = false; }
      else input.type = f.type || 'text';
      input.value = String(f.value ?? ''); for (const key of ['min','max','step','placeholder','maxLength']) if (f[key] !== undefined) input[key] = f[key];
      wrap.append(input); if (f.hint) wrap.append(hint(f.hint)); inputs.append(wrap);
    }
    const status = el('p','form-error hidden'); status.setAttribute('role','status');
    const actions = el('div','form-actions'), save = el('button','button primary small',submit); save.type = 'submit'; actions.append(save); form.append(inputs,status,actions);
    form.addEventListener('input', () => { form.dataset.dirty = 'true'; });
    form.addEventListener('submit', async event => { event.preventDefault(); save.disabled = true; status.classList.add('hidden'); try { const outcome = await handler(Object.fromEntries(new FormData(form)), form); if (!outcome?.cancelled) form.dataset.dirty = 'false'; } catch (e) { status.textContent = e.message; status.classList.remove('hidden'); } finally { save.disabled = false; } });
    return form;
  }
  async start(kind, data) { const result = await window.ufi.startJob(kind, data); if (!result.cancelled) { this.toast('任务已开始，可在任务中心查看'); if (kind === 'speed') { this.currentSpeed = result.id; $('speed-result')?.scrollIntoView({ block: 'nearest' }); } } return result; }
  updateJobs() {
    $('job-count').textContent = this.records.filter(j => ['running','waiting-device'].includes(j.state)).length;
    const job = this.records.find(j => j.id === this.currentSpeed);
    const output = $('speed-result');
    if (output && job) {
      const stopFocused = output.contains(document.activeElement);
      output.replaceChildren(el('strong','',job.stage === jobNames[job.state] ? job.stage : `${jobNames[job.state]} · ${job.stage}`));
      if (job.metrics) {
        const stats = el('div','transfer-metrics');
        for (const [label,value] of [['下载', rate(job.metrics.down)],['上传', rate(job.metrics.up)],['已下载',bytes(job.metrics.received)],['已上传',bytes(job.metrics.sent)]]) { const row = el('div'); row.append(el('small','',label),el('strong','',value)); stats.append(row); }
        output.append(stats,hint(`持续 ${job.metrics.elapsed.toFixed(1)} 秒。上传统计已收到成功响应的请求。`));
      }
      if (job.cancellable) { const stop = button('停止测速', () => window.ufi.cancelJob(job.id).catch(e=>this.toast(e.message))); output.append(stop); if (stopFocused) stop.focus({ preventScroll: true }); }
    }
    if (this.jobBody?.isConnected && $('feature-dialog').open && this.jobToken === this.f.dialogToken && !this.f.reviewResolver) this.drawJobs(this.jobBody);
  }
  jobs() { this.jobBody = this.f.modal('任务中心'); this.jobToken = this.f.dialogToken; this.drawJobs(this.jobBody); }
  drawJobs(body) {
    const focus = body.contains(document.activeElement) ? document.activeElement.dataset.jobAction : null;
    body.replaceChildren();
    if (!this.records.length) body.append(hint('暂无任务。测速、上传和更新操作会显示在这里。'));
    for (const job of this.records) {
      const card = el('article','job-item'); card.append(el('h3','',job.title),hint(job.target),el('p','',`${jobNames[job.state]} · ${job.stage}`));
      if (typeof job.progress === 'number') { const progress = el('progress'); progress.max=100; progress.value=job.progress; card.append(progress); }
      const controls = el('div','inline-actions');
      if (job.cancellable) { const cancel = button(job.cancelLabel || '取消', () => window.ufi.cancelJob(job.id).catch(e=>this.toast(e.message))); cancel.dataset.jobAction = job.id + ':cancel'; controls.append(cancel); }
      if (job.state === 'succeeded') controls.append(button('结果 / 导出', async () => {
        const result = await window.ufi.jobResult(job.id);
        this.jobBody = null; const area = this.f.modal(job.title);
        const pre = el('pre','device-details', typeof result?.data === 'string' ? result.data : JSON.stringify(result,null,2));
        area.append(pre,button('导出结果', () => window.ufi.saveText('ufi-result.json',JSON.stringify(result,null,2)).catch(e=>this.toast(e.message))));
      }));
      card.append(controls); body.append(card);
    }
    if (focus) { const target = [...body.querySelectorAll('[data-job-action]')].find(node => node.dataset.jobAction === focus); (target || $('close-feature-dialog')).focus({ preventScroll: true }); }
  }
  applyPreferences() {
    let theme='system',scale=1;
    try { theme=localStorage.getItem('theme')||'system'; scale=Number(localStorage.getItem('scale')||1); } catch {}
    const dark = theme==='dark'||(theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark?'dark':'light';
    if (scale>=.8&&scale<=1.2) window.ufi.setZoom(scale).catch(()=>{});
  }
  render(state, d) {
    const root=state.content;
    if (state.key === 'zwrt-control') {
      if(!d.controls?.length){root.append(hint('未取得设备能力列表，暂不允许控制请求。'));return;}
      root.append(this.form(state,'datad 能力控制台','zwrt-control',[select('action','设备公布的动作',d.controls[0],d.controls.map(name=>[name,name])),field('params','动作参数（JSON 对象）','{}',{type:'textarea',rows:9})],{help:'仅允许设备公布的控制动作。请按当前 datad 版本的参数契约填写；提交前显示目标与完整参数。敏感参数仅留在当前编辑会话。',submit:'预览并执行',after:()=>{const result=this.f.lastResult?.deviceResult;const body=this.f.modal('datad 返回结果');body.append(el('pre','device-details',JSON.stringify(result,null,2)),button('导出 JSON',()=>window.ufi.saveText('datad-result.json',JSON.stringify(result,null,2)).catch(e=>this.toast(e.message))));}}));return;
    }
    if (state.key === 'zwrt-recovery') {
      const config = d.config || {};
      root.append(this.f.table('自动恢复状态',['项目','值'],[['状态',d.status],['连续失败',d.consecutive_failures],['重拨次数',d.redials],['手动暂停',d.manual_paused],['下次允许动作',d.next_allowed]]));
      root.append(this.form(state,'断网恢复规则','zwrt-recovery-save',[
        toggle('enabled','启用',config.enabled),select('interval','检测间隔',String(config.interval_seconds||60),[['30','30 秒'],['60','60 秒'],['120','120 秒']]),
        field('failures','连续失败次数',config.failure_threshold??3,{type:'number',min:3,max:10}),field('cooldown','冷却（秒）',config.cooldown_seconds??300,{type:'number',min:180,max:3600}),field('redials','重拨上限',config.max_redials??3,{type:'number',min:1,max:5}),toggle('reboot','拨号仍失败时重启',config.reboot_after_failures),
      ],{help:'由设备独立执行。手动断网会暂停恢复；设备自身的每小时和重启限额仍然生效。'}));
      root.append(button('恢复自动检测',()=>this.f.action('zwrt-recovery-resume',{},()=>this.load(state,true))));return;
    }
    if (state.key === 'zwrt-activity') {
      const entries=d.entries||d.items||[];
      root.append(this.f.table('设备执行记录',['时间','分类','动作','结果'],entries.map(item=>[item.timestamp||item.ts,item.category,item.action||item.title,item.result||item.status||item.message])));
      root.append(button('清空全部执行记录',()=>this.f.action('zwrt-activity-clear',{},()=>this.load(state,true))));return;
    }
    if (state.key === 'zwrt-updates') {
      const status=d.status||{};root.append(this.f.table('datad 更新状态',['项目','值'],[['状态',status.state],['当前版本',status.current_version],['最新版本',status.latest_version],['进度',status.progress],['签名验证',status.signature_verified],['错误',status.error]]));
      root.append(button('检查更新',()=>this.f.action('zwrt-ota-check',{},()=>this.load(state,true))));
      if(d.candidate?.id)root.append(button('安装已检查版本',()=>this.f.action('zwrt-ota-install',{id:d.candidate.id},()=>this.load(state,true)),'button primary small'));
      root.append(hint('安装由设备执行，服务重启后需要重新连接读取结果。仅安装设备验证通过的候选，不接受任意 URL。'));return;
    }
    if (state.key === 'zwrt-remote') {
      const cfg=d.config?.config||{},status=d.status||{};root.append(this.f.table('NMS 状态',['项目','值'],[['状态',status.state],['最近上报',status.last_report_at],['错误',status.error],['平台',cfg.platform_url],['服务地址',cfg.broker],['已设置密码',d.config?.password_configured]]));
      root.append(this.form(state,'NMS 连接','zwrt-nms-save',[
        toggle('enabled','启用连接',cfg.enabled),field('broker','MQTT 地址',cfg.broker||'',{placeholder:'ssl://host:8883'}),field('platform_url','平台 HTTPS 地址',cfg.platform_url||'',{type:'url'}),field('username','用户名',cfg.username||''),field('password','新密码（留空保留）','',{type:'password',optional:true}),field('interval','上报间隔（秒）',cfg.report_interval_seconds||60,{type:'number',min:10,max:3600}),toggle('remote_enabled','允许远程后台',cfg.remote_enabled)
      ],{help:'仅更新本表单字段；已有身份、CA 和后台列表保留。保存会重新建立云端连接，现有远程会话可能结束。'}));return;
    }
    if (state.key === 'speed') {
      const tools=el('div','inline-actions section-toolbar');
      tools.append(button('导入 APK 测速方案',async()=>{try{const result=await window.ufi.importConfig();if(result.cancelled)return;const config=JSON.parse(result.text);if(config.format!=='SPEED_TEST_CONFIG'||!Array.isArray(config.profiles))throw new Error('不是有效 SPEED_TEST_CONFIG 配置');this.profiles=config.profiles.filter(p=>p&&typeof p.name==='string');if(!this.profiles.length)throw new Error('没有可用方案');this.selectedProfile=config.selectedProfileId;this.load(state,true);}catch(e){this.toast(e.message)}}),button('导出方案',()=>{
        const form=root.querySelector('form'); const data=Object.fromEntries(new FormData(form));
        const profiles=this.profiles.length?this.profiles:[{id:1,name:'自定义',downloadUrls:data.download?[data.download]:[],uploadUrls:data.upload?[data.upload]:[]}];
        window.ufi.saveText('speed-test.conf',JSON.stringify({format:'SPEED_TEST_CONFIG',version:2,selectedProfileId:this.selectedProfile||1,profiles},null,2)).catch(e=>this.toast(e.message));
      }));root.append(tools);
      const form=this.localForm('网络测速',[
        select('mode','链路 / 方向','lan',[['lan','内网：电脑 → 设备'],['download','外网：设备代理下载'],['upload','外网：设备代理上传'],['duplex','外网：上下行同时测速']]),
        select('profile','测速方案',String(this.selectedProfile||''),[['','手动填写'],...this.profiles.map(p=>[String(p.id),p.name])],{optional:true}),
        field('download','下载文件 URL','',{type:'url',optional:true}),field('upload','上传服务 URL','',{type:'url',optional:true}),
        field('duration','时长（秒）','10',{type:'number',min:3,max:60}),field('threads','并发数','1',{type:'number',min:1,max:3}),
      ],'开始测速',async data=>{
        const profile=this.profiles.find(p=>String(p.id)===data.profile);this.selectedProfile=profile?.id||null;
        const endpointList=(key,method)=>profile?.[key+'Endpoints']?.length?profile[key+'Endpoints']:profile?.[key+'Urls']?.map(url=>({url,method}));
        return await this.start('speed',{...data,...(profile?{downloadEndpoints:endpointList('download','GET'),uploadEndpoints:endpointList('upload','POST')}: {})});
      });
      const applyEndpointFields = () => {
        const mode = form.elements.mode.value, profile = this.profiles.find(p => String(p.id) === form.elements.profile.value);
        form.elements.profile.disabled = mode === 'lan';
        const profileHidden = mode === 'lan' || !this.profiles.length;
        form.elements.profile.closest('label').hidden = profileHidden;
        form.elements.mode.closest('label').classList.toggle('wide-field', profileHidden);
        for (const key of ['download','upload']) {
          const input = form.elements[key];
          if (profile) input.value = profile[key + 'Endpoints']?.[0]?.url || profile[key + 'Urls']?.[0] || '';
          const unused = mode === 'lan' || (key === 'download' && mode === 'upload') || (key === 'upload' && mode === 'download');
          input.closest('label').hidden = unused; input.closest('label').classList.toggle('wide-field', mode !== 'duplex');
          input.disabled = unused || !!profile;
        }
      };
      form.elements.mode.addEventListener('change', applyEndpointFields); form.elements.profile.addEventListener('change', applyEndpointFields); applyEndpointFields();
      root.append(form,hint('内网测速不等于蜂窝测速。外网请求经过设备代理，可能消耗套餐流量；方案及请求头仅保存在当前客户端会话。'));
      const result=el('article','card');result.id='speed-result';result.append(hint('尚未开始测速'));root.insertBefore(result, form);this.updateJobs();return;
    }
    if (state.key === 'proxy') {
      root.append(this.localForm('通过设备发送 HTTP 请求',[
        select('method','方法','GET',['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].map(v=>[v,v])),field('url','目标 URL','',{type:'url'}),
        field('headers','请求头（JSON）','{}',{type:'textarea',optional:true}),field('body','请求体','',{type:'textarea',optional:true}),
      ],'发送请求',async data=>{const result=await this.start('proxy',data);if(result.id)this.jobs();return result;}),hint('请求从设备发出。响应只作为文本显示；Authorization/Cookie 会转换为 UFI 代理专用转发头。设备会拒绝部分内网目标。'));return;
    }
    if (state.key === 'updates') {
      const toolbar=el('div','feature-toolbar');toolbar.append(hint(`设备 UFI-TOOLS：${d.currentVersion}`),button('查询设备下载状态',()=>this.start('ota-observe',{}).then(()=>this.jobs()).catch(e=>this.toast(e.message))),button('安装已下载更新',()=>this.start('ota-install',{}).then(()=>this.jobs()).catch(e=>this.toast(e.message)),'button primary small'));root.append(toolbar);
      root.append(this.f.table('更新目录',['文件','大小','操作'],d.files.map(file=>[file.name,bytes(file.size),button('下载到设备',()=>this.start('ota-download',{name:file.name}).then(()=>this.jobs()).catch(e=>this.toast(e.message)))])));
      const log=el('article','card panel-spaced');log.append(el('h3','','更新说明'),el('pre','device-details',d.changelog||'服务器未提供更新说明'));root.append(log,hint('下载、安装是独立操作。停止下载跟踪不会停止设备已开始的下载；安装后会等待服务恢复并读取版本。'));return;
    }
    if (state.key === 'appearance') {
      const toolbar=el('div','feature-toolbar');toolbar.append(button('上传背景 / 文件',async()=>{try{const file=await window.ufi.pickUpload();if(!file.cancelled){const result=await this.start('upload',{id:file.id});if(result.id)this.jobs();}}catch(e){this.toast(e.message)}}),button('恢复默认主题',()=>this.f.action('theme-reset',{},()=>this.load(state,true))));root.append(toolbar);
      root.append(this.form(state,'设备网页主题','theme-save',[
        select('backgroundEnabled','启用背景',String(d.backgroundEnabled),[['false','关闭'],['true','开启']]),field('backgroundUrl','背景 URL / 上传路径',d.backgroundUrl,{optional:true}),
        field('textColor','文字颜色',d.textColor),...['textColorPer','themeColor','colorPer','saturationPer','brightPer','opacityPer'].map((key,i)=>field(key,['文字百分比','主题色相','主题色百分比','饱和度','亮度','背景不透明度'][i],d[key],{type:'number',min:0,max:key==='themeColor'?360:100})),
        select('blurSwitch','背景模糊',String(d.blurSwitch),[['false','关闭'],['true','开启']]),select('overlaySwitch','遮罩',String(d.overlaySwitch),[['false','关闭'],['true','开启']]),
      ],{help:'这些设置只影响设备网页。本机明暗外观在“客户端设置”中修改。'}));
      root.append(this.form(state,'删除上传文件','file-delete',[field('name','设备返回的文件名','',{placeholder:'上传结果中的 UUID.png'})],{help:'上传完成后，可从任务结果复制设备返回路径。仅填写最后的文件名。'}));
      const danger=el('article','card');danger.append(el('h3','','上传目录'),hint('清空会删除全部上传内容，包括当前主题使用的背景。'),button('清空全部上传文件',()=>this.f.action('files-clear',{},()=>this.load(state,true))));root.append(danger);return;
    }
    if (state.key === 'authentication') {
      if (d.mode !== 'GOFORM') root.append(this.form(state,'UFI-TOOLS 登录口令','ufi-password',[field('password','新口令','',{type:'password',minLength:8,maxLength:128}),field('repeat','再次输入','',{type:'password',maxLength:128})],{help:'8–128 位，包含字母和数字。修改成功后同步更新当前会话和已保存凭据。'}));
      root.append(this.form(state,'中兴原厂后台口令','official-password',[field('old','旧中兴口令','',{type:'password'}),field('password','新中兴口令','',{type:'password'}),field('repeat','再次输入','',{type:'password'})],{help:'原厂会话将重新登录。设备自动化保存的原厂口令可能需要另行更新。'}));return;
    }
    if (state.key === 'service') {root.append(this.form(state,'更新与插件资源服务器','resource-server',[field('address','服务器地址',d.res_server||'',{type:'url'})],{help:'修改将影响设备端更新目录和默认插件资源来源。'}));return;}
    if (state.key === 'voice') {
      const selector=this.localForm('目标 SIM',[select('slot','卡槽',state.slot||'0',[['0','槽位 0'],['1','槽位 1']])],'读取此卡状态',async input=>{state.slot=input.slot;await this.load(state,true);});root.append(selector);
      for(const type of ['volte','vonr'])if(d[type])root.append(this.form(state,type.toUpperCase(),'voice',[toggle('enabled','启用',d[type].enabled)],{extra:{type,slot:d.slot},help:`当前读数与保存目标均为槽位 ${d.slot}`}));
      if(d.warnings?.length)root.append(hint(d.warnings.join('；')));return;
    }
    if (state.key === 'usb') {const card=el('article','card');card.append(el('h3','','USB 设备信息'),el('pre','device-details',typeof d.usb?.details==='string'?d.usb.details:JSON.stringify(d.usb||{},null,2)));root.append(card,this.form(state,'USB 网络协议','usb-protocol',[field('value','协议值',d.device?.usb_network_protocal||'0',{type:'number',min:0,max:5})],{help:'原厂固件定义协议值，修改可能断开当前 USB 网络。'}));return;}
    if (state.key === 'location') {root.append(this.f.table('设备定位',['字段','设备返回值'],Object.entries(d).map(([key,value])=>[key,typeof value==='object'?JSON.stringify(value):value])),button('播放提示音',()=>this.f.action('location-beep',{})));return;}
    if (state.key === 'preferences') {
      root.append(this.localForm('客户端外观',[select('theme','主题',localStorage.getItem('theme')||'system',[['system','跟随系统'],['light','浅色'],['dark','深色']]),select('scale','界面大小',localStorage.getItem('scale')||'1',[['0.8','80%'],['0.9','90%'],['1','100%'],['1.1','110%'],['1.2','120%']])],'应用',async data=>{localStorage.setItem('theme',data.theme);localStorage.setItem('scale',data.scale);this.applyPreferences();this.toast('外观已更新');}));
      const desktop=el('article','card');desktop.append(el('h3','','桌面功能'),hint('悬浮监控显示当前设备状态，主窗口隐藏时仍按需更新。'),button('打开悬浮监控',()=>window.ufi.openMonitor().catch(e=>this.toast(e.message))));if(window.ufi.hideWindow)desktop.append(button('隐藏到托盘',()=>window.ufi.hideWindow().catch(e=>this.toast(e.message))));root.append(desktop);
      window.ufi.autostart().then(info=>{if(!root.isConnected)return;desktop.append(hint(info.supported?'电脑登录时自动启动客户端':'源码模式不启用自启动；请使用发行包。'),button(info.enabled?'关闭电脑自启动':'启用电脑自启动',()=>window.ufi.autostart(!info.enabled).then(()=>this.load(state,true)).catch(e=>this.toast(e.message))));desktop.lastChild.disabled=!info.supported;}).catch(e=>desktop.append(hint(e.message)));return;
    }
  }
}
