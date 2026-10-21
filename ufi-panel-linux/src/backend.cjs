'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { ConnectionManager } = require('./core/connection.cjs');
const { ProfileStore } = require('./core/profiles.cjs');
const { DeviceFeatures } = require('./core/features.cjs');
const { Jobs } = require('./core/jobs.cjs');
const { smsNumber } = require('./core/sms-number.cjs');
const { Telemetry } = require('./core/telemetry.cjs');
const { speedConfig, speedTest, observeDownload, installUpdate, multipartFile, targetHeaders, url: checkedUrl } = require('./core/transfers.cjs');
const { randomUUID, createHash } = require('node:crypto');


function createBackend({ directory, storage, host, emit }) {
  const store = new ProfileStore(directory, storage), connections = new ConnectionManager(store);
  const jobs = new Jobs(), telemetry = new Telemetry(), operationPlans = new Map(), uploads = new Map(), handlers = new Map();
  let lastSnapshot, telemetryError, deviceContext = '', observedPluginRevision = null;
  const window = null;
  const dialog = {
    showMessageBox: (_window, options) => host('confirm', options),
    showOpenDialog: (_window, options) => host('file-open', options),
    showSaveDialog: (_window, options) => host('file-save', options),
  };
  const checkedString = (value, max = 2048) => { if (typeof value !== 'string' || value.length > max) throw new Error('参数格式错误'); return value; };
  const register = (name, handler) => handlers.set(name, handler);
  const pageSession = () => {
    const { profile, client, credentials } = connections.current;
    return {
      key: createHash('sha256').update(JSON.stringify([profile.id, profile.mode || 'KANO', profile.address])).digest('hex'),
      address: profile.address + '/',
      authorization: client.mode === 'KANO' ? client.transport.authorization : '',
      password: client.mode === 'KANO' ? credentials.ztePassword || '' : '',
      loginMethod: profile.loginMethod,
      persist: profile.hasSecret === true,
    };
  };
  function updateTray(snapshot) {
    const b = snapshot?.base || {}, raw = b.cpu_temp, value = Number(raw);
    emit('tray', { name: connections.current?.profile.name || '未连接', connected: !!connections.current, temperature: raw != null && raw !== '' && Number.isFinite(value) ? (value > 1000 ? value / 1000 : value) : null });
  }
  function updateMonitor() {
    const d=lastSnapshot, b=d?.base||{}, n=d?.network||{}, rate=v=>v==null||v===''?'—':(Number(v)/1024).toFixed(1)+' KB/s';
    const temp=Number(b.cpu_temp), valid=b.cpu_temp!=null&&b.cpu_temp!==''&&Number.isFinite(temp);
    const text=d?`${connections.current?.profile.name || '设备'} · ${new Date(d.at).toLocaleTimeString()}${telemetryError?' · 更新失败':!telemetry.interval?' · 已暂停':''}\n温度  ${valid?(temp>1000?temp/1000:temp).toFixed(1)+' °C':'—'}\n下载  ${rate(n.realtime_rx_thrpt)}\n上传  ${rate(n.realtime_tx_thrpt)}\nCPU  ${b.cpu_usage??'—'} %\n内存  ${b.mem_usage??'—'} %`:'尚未连接设备';
    // The tray is another view of the same sample, with no credentials or raw
    // device response and no additional requests when its window opens.
    const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null;
    const status = {
      name: connections.current?.profile.name || '', connected: !!connections.current,
      interval: telemetry.interval, stale: !!telemetryError,
      snapshot: d ? {
        at: numeric(d.at),
        base: Object.fromEntries(['cpu_usage', 'mem_usage', 'cpu_temp', 'daily_data', 'monthly_data'].map(key => [key, numeric(b[key])])),
        network: Object.fromEntries(['realtime_rx_thrpt', 'realtime_tx_thrpt', 'wifi_access_sta_num'].map(key => [key, numeric(n[key])])),
      } : null,
    };
    emit('monitor', { text, status });
  }
  function closeClient() {
    if(connections.current) jobs.stopTarget(connections.current.profile.address);
    operationPlans.clear(); uploads.clear(); telemetry.close(); connections.disconnect(); lastSnapshot=null; telemetryError=null;
    deviceContext = ''; observedPluginRevision = null; updateMonitor(); updateTray(); emit('device-clear', { context: deviceContext });
  }
  async function openPanel() {
    const client=connections.current?.client;
    if(!client) throw new Error('请先连接设备');
    if(client.mode==='ZWRT') throw new Error('datad 提供管理 API，没有 UFI 网页面板');
    return host('open-panel', { address: client.transport.address+'/', context: deviceContext, session: pageSession() });
  }
  telemetry.on('sample', packet => {
    const recovered = !!telemetryError && !!packet.snapshot;
    telemetryError = packet.error || null;
    if (packet.snapshot) { lastSnapshot = packet.snapshot; updateTray(lastSnapshot); }
    updateMonitor();
    if (recovered) emit('device-online', { context: deviceContext });
    const profile = connections.current?.profile;
    // The native recorder receives only this device identity and numeric readings;
    // credentials and the rest of the device response never enter the database.
    emit('telemetry', { ...packet, interval: telemetry.interval, device: profile ? {
      mode: profile.mode || 'KANO', address: profile.address, name: profile.name,
    } : null });
  });
  jobs.on('change', records=>emit('jobs-changed',records));
  register('set-zoom', value=>{if(typeof value!=='number'||value<.8||value>1.2)throw new Error('无效界面缩放');return host('set-zoom',value);});
  register('hide-window', ()=>host('hide-window'));
  register('show-window', ()=>host('show-window'));
  register('monitor-open', async()=>{await host('monitor-open');updateMonitor();return {opened:true};});
  register('autostart', enabled=>host('autostart',enabled));
  register('sms-number-preview', input=>smsNumber(input));
  register('telemetry-configure', value=>{const state=telemetry.configure(value);updateMonitor();return state;});
  register('telemetry-state', ()=>telemetry.state());
  register('connection-info', () => connections.current ? { ...connections.current.profile, mode: connections.current.client.mode || 'KANO' } : null);
  register('profiles', () => store.list());
  register('remove-profile', id => store.remove(checkedString(id, 80)));
  register('connect', async input => {
    if (!input || typeof input !== 'object') throw new Error('无效连接配置');
    const oldAddress = connections.current?.profile.address;
    const result = await connections.connect({
      mode: input.mode || 'KANO', loginMethod: input.loginMethod || 'LOGIN',
      id: input.id ? checkedString(input.id, 80) : undefined,
      name: checkedString(input.name || '我的 UFI', 60), address: checkedString(input.address),
      password: checkedString(!input.mode || input.mode === 'KANO' ? input.password || '' : '', 256), ztePassword: checkedString(input.ztePassword || '', 256),
      remember: input.remember === true,
    });
    if (oldAddress) jobs.stopTarget(oldAddress);
    lastSnapshot = null; telemetryError = null; updateMonitor();
    result.telemetrySession = telemetry.attach(connections.current.client);
    operationPlans.clear(); uploads.clear();
    deviceContext = randomUUID(); observedPluginRevision = null; emit('device-clear', { context: deviceContext });
    updateTray();
    return result;
  });
  register('cancel-connection', () => connections.cancel());
  register('copy-text', value => host('copy-text', checkedString(value, 1024 * 1024)));
  register('disconnect', () => closeClient());
  const withClient = callback => async args => {
    const current = connections.current?.client;
    if (!current) throw new Error('请先连接设备');
    const result = await callback(current, args);
    if (current !== connections.current?.client) throw new Error('设备连接已变更');
    return result;
  };
  register('snapshot', withClient(() => telemetry.sample()));
  register('clients', withClient(current => current.clients()));
  register('sms', withClient((current, page) => current.sms(page)));
  register('plugins', withClient(current => current.plugins()));
  const features = current => current.features ||= new DeviceFeatures(current);
  register('feature-read', withClient(async (current, input) => {
    const name = checkedString(input?.name, 80), result = await features(current).read(name, input?.data);
    if (name === 'plugins-installed' && current === connections.current?.client) {
      const changed = observedPluginRevision && observedPluginRevision !== result.revision;
      observedPluginRevision = result.revision;
      if (changed) emit('plugins-changed', { context: deviceContext });
    }
    return result;
  }));
  register('open-plugin-settings', withClient(async (current, input) => {
    const context = deviceContext;
    const target = await features(current).plugins.settings(input);
    if (current !== connections.current?.client || context !== deviceContext) throw new Error('设备连接已变更');
    return host('open-plugin-settings', { ...target, context, session: pageSession() });
  }));
  register('plugin-menus', withClient(async (current,input) => {
    const context=deviceContext,target=await features(current).plugins.runtime(input);
    if(current!==connections.current?.client || context!==deviceContext)throw new Error('设备连接已变更');
    return host('plugin-menus-start',{...target,context,session:pageSession(),refresh:input?.refresh===true});
  }));
  register('plugin-menu-open', withClient(async (current,input) => {
    const context=deviceContext;
    await features(current).plugins.runtime(input);
    if(current!==connections.current?.client || context!==deviceContext)throw new Error('设备连接已变更');
    return host('plugin-menu-open',{context,revision:input.revision,instance:checkedString(input.instance,80),token:checkedString(input.token,80)});
  }));
  register('plugin-menus-release',()=>deviceContext ? host('plugin-menus-release',{context:deviceContext}) : null);
  async function executeOperation(current, action) {
    if (current !== connections.current?.client) throw new Error('设备连接已变更，请重新操作');
    let result;
    try { result = await action.run(); }
    catch (error) { if (/超时|ECONNRESET|EPIPE/.test(error.message)) throw new Error(error.message + '。结果可能未知，请重新读取设备状态确认，不要直接重复执行。'); throw error; }
    if (action.pluginsChanged && current === connections.current?.client) { observedPluginRevision = null; emit('plugins-changed', { context: deviceContext }); }
    if (current.changedCredentials && current === connections.current?.client) {
      const active = connections.current;
      active.credentials = { ...active.credentials, ...current.changedCredentials };
      delete current.changedCredentials;
      try { active.profile = store.save({ ...active.profile, remember: active.profile.hasSecret }, active.credentials); }
      catch { return { result: 'success', warning: '设备口令已修改，当前连接已更新，但本机配置写入失败。下次连接请填写新口令。' }; }
    }
    return result;
  }
  register('operation-prepare', withClient((current, input) => {
    for (const [id, plan] of operationPlans) if (plan.expires < Date.now()) operationPlans.delete(id);
    if (operationPlans.size >= 10) operationPlans.clear();
    const action = features(current).prepare(checkedString(input?.name, 80), input?.data);
    const id = randomUUID();
    operationPlans.set(id, { current, action, expires: Date.now() + 300000 });
    return { id, title: action.title, detail: action.detail, target: connections.current.profile.name, address: current.transport.address };
  }));
  register('operation-commit', async id => {
    const plan = operationPlans.get(checkedString(id, 80)); operationPlans.delete(id);
    if (!plan || plan.expires < Date.now()) throw new Error('确认已过期，请重新预览操作');
    return executeOperation(plan.current, plan.action);
  });
  register('operation-cancel', id => operationPlans.delete(checkedString(id, 80)));
  register('jobs', () => jobs.list());
  register('job-cancel', id => jobs.cancel(checkedString(id, 80)));
  register('job-result', id => jobs.get(checkedString(id, 80)).result ?? null);
  register('job-start', withClient(async (current, input) => {
    if (current.mode !== 'KANO') throw new Error('此工具需要 KANO / UFI-TOOLS 连接');
    const kind = checkedString(input?.kind, 80), data = input?.data || {}, target = current.transport.address;
    let title, detail = '', run, cancelLabel;
    if (kind === 'speed') {
      const config = speedConfig(data); title = config.mode === 'lan' ? '内网测速' : '设备代理外网测速';
      detail = config.mode === 'lan' ? '' : `通过设备访问测速服务器，可能消耗蜂窝流量。\n下载：${config.download || '无'}\n上传：${config.upload || '无'}\n时长 ${config.duration} 秒`;
      run = context => speedTest(current, config, context);
    } else if (kind === 'ota-download') {
      const apkUrl = await features(current).maintenance.packageUrl(checkedString(data.name, 256));
      title = '下载安装包到设备'; detail = `${data.name}\n来源：${new URL(apkUrl).hostname}\n停止跟踪不会停止设备已开始的下载。`;
      run = context => observeDownload(current, context, apkUrl); cancelLabel = '停止跟踪';
    } else if (kind === 'ota-observe') {
      title = '查询设备下载状态'; run = context => observeDownload(current, context); cancelLabel = '停止跟踪';
    } else if (kind === 'ota-install') {
      title = '安装设备 UFI-TOOLS 更新'; detail = '将安装设备已下载的安装包。安装期间服务可能重启，请保持设备供电。';
      run = context => installUpdate(current, context);
    } else if (kind === 'upload') {
      const file = uploads.get(checkedString(data.id, 80));
      if (!file || file.client !== current || file.expires < Date.now()) throw new Error('文件选择已过期，请重新选择');
      uploads.delete(data.id); title = '上传文件到设备'; detail = `${file.name} · ${file.size} 字节`;
      run = async ({ signal, update }) => {
        update({ stage: '正在上传到设备' });
        const bytes = await fs.readFile(file.path);
        if (bytes.length !== file.size) throw new Error('文件在选择后已变化，请重新选择');
        const result = await current.api('/api/upload_img', { method: 'POST', ...multipartFile(file.name, bytes), timeout: 60000, signal });
        return { name: file.name, ...result };
      };
    } else if (kind === 'proxy') {
      const destination = checkedUrl(checkedString(data.url));
      const method = checkedString(data.method || 'GET', 10).toUpperCase();
      if (!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method)) throw new Error('无效请求方法');
      const body = checkedString(data.body || '', 1024 * 1024);
      const parsed = JSON.parse(checkedString(data.headers || '{}', 20000));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求头应为 JSON 对象');
      const headers = targetHeaders(parsed);
      title = 'HTTP 代理请求'; detail = `${method} ${new URL(destination).origin}\n由设备发起，请求体 ${Buffer.byteLength(body)} 字节。`;
      run = async ({ signal, update }) => { update({ stage: '等待目标响应' }); return current.transport.request('/api/proxy/--' + destination, { method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body }), responseType: 'text', acceptAnyStatus: true, signal, timeout: 35000 }); };
    } else throw new Error('未知任务类型');
    if (detail) {
      const answer = await dialog.showMessageBox(window, { type: 'question', title, message: title, detail: `设备：${connections.current.profile.name}\n${detail}`, buttons: ['取消', '执行'], defaultId: 0, cancelId: 0, noLink: true });
      if (answer.response !== 1) return { cancelled: true };
    }
    if (current !== connections.current?.client) throw new Error('设备连接已变更');
    if (['speed','ota-download','ota-install'].includes(kind) && jobs.list().some(job => job.target === target && job.kind === kind && ['running','waiting-device'].includes(job.state))) throw new Error('同一设备的此类任务仍在运行，请先等待或停止');
    const id = jobs.start({ title, target, kind, cancelLabel, run }); return { id };
  }));
  register('pick-upload', withClient(async current => {
    const selected = await dialog.showOpenDialog(window, { title: '选择上传到设备的文件', properties: ['openFile'] });
    if (selected.canceled || !selected.filePaths[0]) return { cancelled: true };
    if (current !== connections.current?.client) throw new Error('设备连接已变更');
    const file = selected.filePaths[0], stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('请选择不超过 10 MB 的文件');
    const id = randomUUID(), name = path.basename(file);
    uploads.set(id, { path: file, name, size: stat.size, client: current, expires: Date.now() + 300000 });
    return { id, name, size: stat.size };
  }));
  register('save-text', async input => {
    const content = checkedString(input?.text, 10 * 1024 * 1024);
    const filename = path.basename(checkedString(input?.name || 'ufi-export.txt', 200));
    const result = await dialog.showSaveDialog(window, { title: '导出文件', defaultPath: filename });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await fs.writeFile(result.filePath, content, { mode: 0o600 }); return { saved: true };
  });
  register('import-config', async () => {
    const result = await dialog.showOpenDialog(window, { title: '导入测速配置', properties: ['openFile'], filters: [{ name: 'JSON / CONF', extensions: ['json','conf'] }] });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    const stat = await fs.stat(result.filePaths[0]); if (stat.size > 1024 * 1024) throw new Error('配置文件不能超过 1 MB');
    return { text: await fs.readFile(result.filePaths[0], 'utf8') };
  });
  register('open-terminal', withClient(async (current, value) => {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('请输入有效端口');
    const status = await current.api(`/api/hasTTYD?port=${port}`);
    if (![true, 'true'].includes(status.result)) throw new Error('设备此端口未检测到 TTYD');
    if (current !== connections.current?.client) throw new Error('设备连接已变更');
    const target = new URL(current.transport.address); target.port = port; target.pathname = '/';
    await host('open-terminal', { address: target.href, context: deviceContext, session: pageSession() }); return { opened: true };
  }));
  register('open-panel', openPanel);
  register('command', withClient(async (current, input) => {
    const kind = input?.kind;
    if (!['user', 'root', 'at'].includes(kind)) throw new Error('未知命令类型');
    const command = checkedString(input.command, 8192).trim();
    const slot = String(input.slot ?? '0');
    if (!command) throw new Error('请输入命令');
    if (kind === 'at' && (!['0', '1'].includes(slot) || !/^AT[^\r\n]{0,500}$/i.test(command))) throw new Error('请选择有效卡槽并输入单行 AT 命令');
    const answer = await dialog.showMessageBox(window, {
      type: 'question', title: '执行设备命令',
      message: `在 ${connections.current.profile.name} 上执行${kind === 'root' ? ' Root Shell' : kind === 'at' ? ' AT 命令' : ' Shell'}？`,
      detail: `${command}\n\n目标：${current.transport.address}${kind === 'at' ? `\nSIM 卡槽：${slot}` : ''}\n命令可能改变设备设置，请确认内容。`,
      buttons: ['取消', '执行'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (answer.response !== 1) return { cancelled: true };
    if (current !== connections.current?.client) throw new Error('设备连接已变更，请重试');
    return kind === 'at' ? current.at(command, slot) : current.shell(command, kind === 'root');
  }));
  register('export', withClient(async current => {
    const snapshot = await telemetry.sample();
    if (current !== connections.current?.client) throw new Error('设备连接已变更');
    const result = await dialog.showSaveDialog(window, {
      title: '导出设备状态', defaultPath: `ufi-status-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    if (current !== connections.current?.client) throw new Error('设备连接已变更');
    await fs.writeFile(result.filePath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    return { saved: true };
  }));

  return {
    async dispatch(name, input) { const handler=handlers.get(name); if(!handler) throw new Error('未知客户端操作'); return handler(input); },
    close() { jobs.close(); closeClient(); },
  };
}
module.exports={createBackend};
