import { number, display, byteParts, bytes, rate, temperature, parsed, cellularStatus, clientsFrom, smsDate } from './format.mjs';
import { LiveCharts } from './live-charts.mjs';
import { sampleFrom, appendSample } from './telemetry-data.mjs';
import { AT_PRESETS } from './at-presets.mjs';
import { FeatureUI, featureViews } from './features.mjs';
import { Navigation, NAV, NETWORK_PAGES } from './navigation.mjs';
import { ToolsUI, toolViews } from './tools-ui.mjs';
import { PluginsUI } from './plugins-ui.mjs';
import { HistoryUI } from './history-ui.mjs';
import { SidebarTelemetry } from './sidebar-telemetry.mjs';
const $ = id => document.getElementById(id);
const titles = {
  overview: ['设备总览', '设备状态与蜂窝网络用量'],
  history: ['历史监控', '按设备与时间查看保存在本机的监控数据'],
  signal: ['信号监测', '当前网络信号与设备温度'],
  clients: ['连接终端', '当前设备的在线终端'],
  sms: ['短信', '设备上的收件与发件记录'],
  plugins: ['插件中心', '已安装插件、设置与插件市场'],
  tools: ['终端', 'Shell 与 AT 命令'],
  network: ['网络设置', '蜂窝网络、Wi-Fi、APN 与频段配置'],
  traffic: ['流量统计', '按日期查询用量，设置上限与提醒'],
  forward: ['短信转发', '配置设备上的邮件、钉钉或自定义转发'],
  tasks: ['定时任务', '在设备上定时执行，无需保持客户端运行'],
  device: ['设备管理', '设备开关与系统操作'],
  wifi: ['Wi-Fi', '热点配置与无线状态'], radio: ['频段与基站', '频段选择、邻区与小区锁定'], apn: ['APN', '接入点配置'], lan: ['LAN / DHCP', '网关与地址分配'],
  'zwrt-control': ['datad 控制台','按设备能力构造已受支持的控制请求'],
  'zwrt-recovery': ['断网自动恢复','设备端检测、重拨与恢复限额'], 'zwrt-activity': ['通知与执行记录','设备侧通知、任务和恢复日志'], 'zwrt-remote': ['NMS 远程管理','设备云端连接配置与状态'], 'zwrt-updates': ['datad 更新','签名更新、候选版本与安装状态'],
  speed: ['网络测速', '内网链路与设备代理上下行测速'], proxy: ['HTTP 代理', '构造从设备发出的 HTTP 请求'], updates: ['软件更新', '设备 UFI-TOOLS 下载、安装与版本核对'], appearance: ['外观与文件', '设备网页主题与上传文件'], authentication: ['认证设置', 'UFI-TOOLS 与原厂后台口令'], service: ['资源服务器', '更新与插件资源来源'], location: ['设备定位', '读取设备提供的位置'], usb: ['USB 信息', '接口、速率与网络协议'], preferences: ['客户端设置', '外观、缩放与 Linux 桌面功能'], voice: ['VoLTE / VoNR', '按卡槽读取和修改语音状态'],
};
const listKinds = ['clients', 'sms'];
let connected = false, connecting = false, profiles = [], activeProfile = null, savedState, view = 'overview';
let generation = 0, connectAttempt = 0, snapshotJob = null, failures = 0, toastTimer;
let startupConnectionAllowed = true;
let telemetrySession = null, telemetrySequence = 0, chartWindow = 300000;
let samples = [], clientItems = [], messages = [], smsPage = 0, commandBusy = false;
const liveCharts = new LiveCharts();
const sidebarTelemetry = new SidebarTelemetry($('sidebar-telemetry'));
let clientAccess = null, clientAccessBusy = false;
const freshPages = () => Object.fromEntries(listKinds.map(kind => [kind, { loadedAt: 0, job: null, error: '' }]));
let pages = freshPages();
const smsFolders = [['inbox', '收件箱'], ['sent', '发件箱'], ['draft', '草稿'], ['other', '其他'], ['all', '全部']];
let smsFolder = 'inbox', smsMeta = null;
let interval = 2000;
try { const stored = Number(localStorage.getItem('refreshInterval')); if ([0, 1000, 2000, 5000, 10000, 15000, 30000].includes(stored) && localStorage.getItem('refreshInterval') !== null) interval = stored; } catch { /* Preferences are optional. */ }
const text = (id, value) => { $(id).textContent = value; };
const time = value => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
function toast(message) {
  text('toast', message); $('toast').classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 3500);
}
function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = String(content);
  return node;
}
function progress(id, value) { $(id).style.width = `${Math.max(0, Math.min(100, number(value) || 0))}%`; }
function setStatus(status) {
  const state = $('connection-state');
  state.replaceChildren(element('i', `status-dot ${status === 'online' ? 'online' : status === 'stale' ? 'stale' : ''}`));
  state.append(status === 'online' ? '已连接' : status === 'stale' ? '连接中断' : '未连接');
  $('mini-dot').className = `status-dot ${status === 'online' ? 'online' : status === 'stale' ? 'stale' : ''}`;
}
function notice(message, retry = false) { text('notice-text', message); $('notice').classList.toggle('hidden', !message); $('retry-snapshot').classList.toggle('hidden', !retry); }
function renderSnapshot(data, sampled = true) {
  savedState = data;
  const b = data.base, n = data.network || {}, version = data.version || {};
  setStatus('online'); $('view-overview').classList.remove('telemetry-stale');
  text('last-update', `状态更新于 ${time(data.at)}`);
  text('device-tag', version.model || b.model || 'UFI-TOOLS');
  text('device-name', version.nickname || version.model || b.model || 'UFI-TOOLS');
  $('device-tag').classList.toggle('hidden', $('device-tag').textContent === $('device-name').textContent);
  text('device-subtitle', [n.network_provider, n.ppp_status ? `蜂窝网络${cellularStatus(n.ppp_status)}` : ''].filter(Boolean).join(' · ') || '设备已连接');
  text('network-chip', n.network_type || '—');
  text('firmware-chip', n.cr_version || '—');
  text('server-chip', version.app_ver || b.app_ver || '—');
  const battery = number(n.battery_vol_percent ?? n.battery_value ?? b.battery);
  text('battery-value', battery !== null && battery >= 0 && battery <= 100 ? battery.toFixed(0) : '—');
  text('battery-hint', battery !== null && battery >= 0 && battery <= 100 ? (['1','true'].includes(String(n.battery_charging)) ? '正在充电' : '未充电') : '设备未提供电池读数');
  const temp = temperature(b.cpu_temp);
  text('temperature', display(temp)); text('temperature-hint', temp === null ? '未提供读数' : '最高传感器读数');
  const [amount, unit] = byteParts(b.daily_data); text('daily-data', amount); text('daily-unit', unit);
  text('cpu-usage', display(b.cpu_usage)); text('mem-usage', display(b.mem_usage)); progress('cpu-progress', b.cpu_usage);
  const mem = parsed(b.memInfo);
  text('memory-detail', mem.mem_total_kb ? `${bytes(mem.mem_used_kb * 1024)} / ${bytes(mem.mem_total_kb * 1024)}` : '设备报告的内存使用率');
  text('cellular-status', cellularStatus(n.ppp_status));
  text('client-count', number(n.wifi_access_sta_num) === null ? '—' : `${n.wifi_access_sta_num} 台`);
  text('unread-count', number(n.sms_unread_num) === null ? '—' : `${n.sms_unread_num} 条`);
  text('monthly-data', bytes(b.monthly_data));
  const ratio = number(b.internal_total_storage) > 0 && number(b.internal_used_storage) !== null ? number(b.internal_used_storage) / number(b.internal_total_storage) * 100 : null;
  text('storage-ratio', ratio === null ? '—' : `${ratio.toFixed(1)}%`); progress('storage-progress', ratio);
  text('storage-detail', `已用 ${bytes(b.internal_used_storage)} / 共 ${bytes(b.internal_total_storage)}`);
  if (sampled) samples = appendSample(samples, sampleFrom({ at: data.at, snapshot: data }), interval);
  drawChart(); renderSignals(data);
  notice((data.warnings || []).join('；'));
  renderSidebar();
}
function renderSidebar() { sidebarTelemetry.render(savedState, { connected, interval, stale: failures > 0 }); }
function drawChart() {
  liveCharts.update(samples,chartWindow);
}
function renderSignals(data = {}) {
  const n = data.network || {};
  const root = $('signal-grid'); root.replaceChildren();
  for (const config of [
    { name: '5G NR', sub: '新空口信号', values: [['RSRP', n.Z5g_rsrp, 'dBm'], ['SINR', n.Nr_snr, 'dB'], ['RSRQ', n.nr_rsrq, 'dB']], details: [['频段', n.Nr_bands], ['PCI', n.Nr_pci], ['频点', n.Nr_fcn], ['带宽', n.Nr_bands_widths]] },
    { name: '4G LTE', sub: 'LTE 信号', values: [['RSRP', n.lte_rsrp, 'dBm'], ['SINR', number(n.Lte_snr) === null ? n.lte_snr : n.Lte_snr, 'dB'], ['RSRQ', n.lte_rsrq, 'dB']], details: [['频段', n.Lte_bands], ['PCI', n.Lte_pci], ['频点', n.Lte_fcn], ['带宽', n.Lte_bands_widths]] },
  ]) {
    const card = element('article', 'card'); const heading = element('div', 'signal-head');
    heading.append(element('span', '', config.name)); card.append(heading);
    const metrics = element('div', 'signal-metrics');
    for (const [label, value, unit] of config.values) {
      const metric = element('div'); metric.append(element('label', '', label), element('strong', '', display(value)), element('small', '', unit)); metrics.append(metric);
    }
    card.append(metrics); const details = element('div', 'signal-details');
    for (const [label, value] of config.details) { const line = element('div', '', label); line.append(element('b', '', value === '' || value == null ? '—' : value)); details.append(line); }
    card.append(details); root.append(card);
  }
  const sensors = parsed(data.base?.cpu_temp_list, []); const area = $('sensors'); area.replaceChildren();
  if (!Array.isArray(sensors) || !sensors.length) { area.append(element('p', 'empty', '设备未返回温度传感器数据。')); return; }
  for (const sensor of sensors) { const item = element('div', 'sensor'); item.append(element('span', '', sensor.type || '传感器'), element('strong', '', `${display(temperature(sensor.temp))}°C`)); area.append(item); }
}

function syncControls() {
  const busy = view === 'history' ? historyUI.busy : view === 'plugins' ? pluginsUI.busy : listKinds.includes(view) ? !!pages[view].job : !!snapshotJob;
  $('refresh-button').disabled = (view !== 'history' && !connected) || busy;
  $('refresh-button').classList.toggle('busy', busy);
  $('refresh-button').setAttribute('aria-busy', String(busy));
  $('refresh-button').classList.toggle('hidden', view === 'tools');
  $('retry-snapshot').disabled = !!snapshotJob;
  $('export-button').disabled = !connected;
  $('compose-sms').disabled = !connected; $('manage-plugins').disabled = !connected || !pluginsUI.supported || pluginsUI.working;
  $('disconnect-button').disabled = !connected || connecting;
  $('run-command').disabled = !connected || commandBusy || !$('command').value.trim();
  for (const id of ['command-kind', 'command-slot', 'command-preset', 'command-template-search', 'command']) $(id).disabled = commandBusy;
  $('sms-previous').disabled = !connected || !!pages.sms.job || smsPage === 0;
  $('sms-next').disabled = !connected || !!pages.sms.job || !smsMeta?.hasMore;
  text('sms-next', smsMeta?.scanning ? '继续查找' : '下一页');
  for (const button of document.querySelectorAll('[data-open-panel]')) button.disabled = !connected || activeProfile?.mode === 'ZWRT';
  for (const button of document.querySelectorAll('[data-client-access]')) button.disabled = !connected || clientAccessBusy || !clientAccess?.supported;
}
function schedule() {
  text('poll-description', !connected ? '采集间隔' : interval ? `持续采集${document.hidden ? ' · 后台运行' : ''}${failures ? ' · 重试中' : ''}` : '已暂停 · 可手动刷新');
  renderSidebar();
}
function receiveTelemetry(packet) {
  if (!connected || packet.session !== telemetrySession || packet.sequence <= telemetrySequence) return;
  telemetrySequence = packet.sequence; failures = packet.failures;
  text('history-warning', packet.historyError ? `历史记录保存异常：${packet.historyError}。实时监控仍在运行。` : '');
  $('history-warning').classList.toggle('hidden', !packet.historyError);
  if (packet.snapshot) {
    renderSnapshot(packet.snapshot);
    if (interval && ['clients', 'sms'].includes(view) && !document.hidden && !$('feature-dialog').open && pages[view].loadedAt && (view !== 'sms' || smsPage === 0) && Date.now() - pages[view].loadedAt > 15000) loadPage(view, { refresh: true });
  }
  else {
    setStatus('stale'); $('view-overview').classList.add('telemetry-stale');
    samples = appendSample(samples, sampleFrom(packet), interval); drawChart();
    notice(`更新失败：${packet.error}。正在显示 ${savedState ? time(savedState.at) : '上次'} 的数据。`, true);
    text('last-update', savedState ? `上次成功 ${time(savedState.at)} · 数据已过期` : '数据暂不可用');
  }
  schedule();
}
window.ufi.onTelemetry(receiveTelemetry);
window.ufi.telemetryConfigure(interval).catch(error => toast(error.message));
function refresh() {
  if (!connected) return Promise.resolve();
  if (snapshotJob) return snapshotJob.promise;
  const rev = generation;
  const job = {};
  snapshotJob = job;
  job.promise = (async () => {
    try {
      await window.ufi.snapshot();
    } catch (error) {
      // The main-process sample event carries the stale state and the history gap.
      if (rev === generation && !failures) notice(error.message, true);
    } finally {
      if (snapshotJob === job) { snapshotJob = null; syncControls(); }
    }
  })();
  syncControls();
  return job.promise;
}
async function refreshCurrent(automatic = false) {
  if (view === 'history' && !automatic) return historyUI.refresh();
  if (!connected) return;
  const tasks = [refresh()];
  if (!automatic && (featureViews.includes(view) || NETWORK_PAGES.includes(view))) tasks.push(featureUI.refresh());
  if (!automatic && toolViews.includes(view)) tasks.push(toolsUI.refresh());
  if (listKinds.includes(view)) tasks.push(loadPage(view, { refresh: true }));
  if (!automatic && view === 'plugins') tasks.push(pluginsUI.refresh());
  await Promise.all(tasks);
  if (!automatic) schedule();
}
function pageStatus(kind) {
  const state = pages[kind], container = $(`${kind}-status`);
  container.replaceChildren();
  container.classList.toggle('hidden', !state.job && !state.error);
  $(`${kind}-content`).setAttribute('aria-busy', String(!!state.job));
  if (state.job) container.append(element('span', 'loading-label', state.loadedAt ? '正在更新…' : '正在读取设备…'));
  else if (state.error) {
    container.append(element('span', '', `${state.error}${state.loadedAt ? '；保留上次列表。' : ''}`));
    const retry = element('button', 'button secondary small', '重试');
    retry.addEventListener('click', () => loadPage(kind, { page: state.requestedPage ?? smsPage, refresh: state.requestedRefresh })); container.append(retry);
  }
}
function loadPage(kind, { page = smsPage, force = true, refresh = false } = {}) {
  if (!connected) return Promise.resolve();
  const state = pages[kind];
  if (state.job) return state.job;
  if (!force && state.loadedAt && Date.now() - state.loadedAt < 30000) return Promise.resolve();
  const rev = generation, requestedFolder = smsFolder;
  state.error = ''; state.requestedPage = page; state.requestedRefresh = refresh;
  if (!state.loadedAt) $(`${kind}-content`).replaceChildren();
  state.job = (async () => {
    try {
      const data = await (kind === 'sms' ? window.ufi.sms({ page, folder: requestedFolder, refresh }) : window.ufi[kind]());
      if (rev !== generation || (kind === 'sms' && requestedFolder !== smsFolder)) return;
      state.loadedAt = Date.now();
      if (kind === 'clients') { clientItems = clientsFrom(data); clientAccess = data.clientAccess || null; renderClients(); }
      if (kind === 'sms') {
        messages = Array.isArray(data.messages) ? data.messages : []; smsPage = page; smsMeta = data;
        text('sms-page', `第 ${smsPage + 1} 页`); renderSms();
      }
    } catch (error) { if (rev === generation && (kind !== 'sms' || requestedFolder === smsFolder)) state.error = error.message; }
    finally {
      if (rev === generation) { state.job = null; pageStatus(kind); syncControls(); if (kind === 'sms' && requestedFolder !== smsFolder) loadPage('sms', { page: 0 }); }
    }
  })();
  pageStatus(kind); syncControls();
  return state.job;
}
async function copy(value) {
  try { await window.ufi.copyText(value); toast('已复制'); } catch (error) { toast(error.message); }
}
function empty(container, message, clear) {
  const block = element('div', 'empty'); block.append(element('p', '', message));
  if (clear) {
    const button = element('button', 'button secondary small', '清除筛选');
    button.addEventListener('click', clear); block.append(button);
  }
  container.append(block);
}
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
function renderClients() {
  renderClientAccess();
  const query = $('client-search').value.trim().toLowerCase(), type = $('client-type').value;
  const items = clientItems.filter(d => (!type || d.type === type) && `${d.name} ${d.ip} ${d.mac}`.toLowerCase().includes(query));
  const sort = $('client-sort').value;
  items.sort((a, b) => collator.compare(a[sort], b[sort]));
  text('clients-total', `${items.length} / ${clientItems.length} 台`);
  text('clients-updated', `更新于 ${time(pages.clients.loadedAt)}`);
  const container = $('clients-content'); container.className = 'table-scroll'; container.replaceChildren();
  if (!items.length) return empty(container, clientItems.length ? '没有匹配的终端' : '当前没有在线终端', clientItems.length ? () => { $('client-search').value = ''; $('client-type').value = ''; renderClients(); } : null);
  const table = element('table'), head = element('thead'), row = element('tr'), body = element('tbody');
  for (const label of ['设备名称', 'IP 地址', 'MAC 地址', '连接方式', '操作']) { const th = element('th', '', label); th.scope = 'col'; row.append(th); }
  head.append(row); table.append(head, body);
  for (const device of items) {
    const tr = element('tr'), ip = element('td', 'mono');
    if (device.ip === '—') ip.textContent = '—';
    else { const button = element('button', 'copy-address', device.ip); button.title = `复制 IP 地址 ${device.ip}`; button.addEventListener('click', () => copy(device.ip)); ip.append(button); }
    const name = element('td'); const rename = element('button', 'text-button', device.name);
    rename.title = '修改终端名称'; rename.addEventListener('click', () => featureUI.rename(device)); name.append(rename);
    const actions = element('td');
    if (device.type === 'Wi-Fi' && clientAccess?.supported && /^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(device.mac)) {
      if (clientAccess.blocked.some(item => item.mac.toLowerCase() === device.mac.toLowerCase())) actions.textContent = '已拉黑';
      else actions.append(clientAccessButton('踢出并拉黑','client-block',device.mac));
    } else actions.textContent = '—';
    tr.append(name, ip, element('td', 'mono', device.mac), element('td', 'device-type', device.type), actions); body.append(tr);
  }
  container.append(table);
}
function clientAccessButton(title, action, mac) {
  const button = element('button', `button secondary small${action === 'client-block' ? ' client-block-button' : ''}`, title);
  button.type = 'button'; button.dataset.clientAccess = action; button.dataset.clientMac = mac;
  button.disabled = !connected || clientAccessBusy || !clientAccess?.supported;
  button.addEventListener('click', async () => {
    if (clientAccessBusy || !connected || !clientAccess?.supported) return;
    const rev = generation; clientAccessBusy = true; syncControls();
    try {
      await featureUI.write(action,{ mac, revision: clientAccess.revision });
    } catch (error) { if (rev === generation) toast(error.message); }
    finally {
      if (rev === generation) {
        await pages.clients.job;
        if (rev === generation) { await loadPage('clients',{refresh:true}); clientAccessBusy = false; syncControls(); }
      }
    }
  });
  return button;
}
function renderClientAccess() {
  const access = clientAccess;
  text('clients-access-note', access?.supported ? '“踢出并拉黑”会持续禁止该 Wi-Fi 终端重连；可在下方设备黑名单中解除。' : access?.reason || '此接入模式尚未提供终端黑名单功能，仍可查看在线终端。');
  $('blocked-clients-card').classList.toggle('hidden', !access?.revision);
  const root = $('blocked-clients-content'); root.replaceChildren();
  text('blocked-clients-total', `${access?.blocked?.length || 0} 台`);
  if (!access?.blocked?.length) { root.append(element('div','empty','黑名单为空')); return; }
  const table = element('table'), head = element('thead'), heading = element('tr'), body = element('tbody');
  for (const label of ['设备名称','MAC 地址','操作']) { const cell = element('th','',label); cell.scope = 'col'; heading.append(cell); }
  head.append(heading); table.append(head,body);
  for (const device of access.blocked) {
    const row = element('tr'), actions = element('td');
    actions.append(clientAccessButton('解除','client-unblock',device.mac));
    row.append(element('td','',device.name || '未命名设备'),element('td','mono',device.mac),actions); body.append(row);
  }
  root.append(table);
}
function renderSmsTabs() {
  for (const [folder, title] of smsFolders) {
    const tab = document.querySelector(`[data-sms-folder="${folder}"]`);
    tab.setAttribute('aria-selected', String(folder === smsFolder));
    tab.classList.toggle('active', folder === smsFolder);
    const count = smsMeta ? folder === 'all' ? smsMeta.loadedCount : smsMeta.counts?.[folder] : null;
    tab.querySelector('span').textContent = count == null ? '—' : count;
    tab.title = `${title} · ${count == null ? '尚未读取' : `${smsMeta?.complete ? '共' : '已加载'} ${count} 条`}`;
  }
}
function switchSmsFolder(folder) {
  if (smsFolder === folder) return;
  smsFolder = folder; smsPage = 0; messages = [];
  $('sms-unread').checked = false; $('sms-search').value = '';
  pages.sms.loadedAt = 0; pages.sms.error = '';
  text('sms-page', '第 1 页'); renderSms(); loadPage('sms', { page: 0 });
}
function renderSms() {
  const inbox = ['inbox', 'all'].includes(smsFolder);
  $('sms-unread').disabled = !inbox;
  const query = $('sms-search').value.trim().toLowerCase(), unread = inbox && $('sms-unread').checked;
  const filtered = messages.filter(m => (!unread || m.unread) && `${m.number} ${m.text}`.toLowerCase().includes(query));
  const folderTitle = smsFolders.find(([id]) => id === smsFolder)[1];
  text('sms-total', `${folderTitle} · 本页 ${filtered.length} / ${messages.length} 条`);
  renderSmsTabs();
  text('sms-mailbox-note', smsMeta ? `${smsMeta.complete ? '已读取' : '已加载'}设备上的 ${smsMeta.loadedCount} 条短信 · ${smsMeta.complete ? '分类数量为设备已读取记录' : '分类数量仅统计已加载记录'}${smsMeta.truncated ? ' · 已达到读取上限，部分历史未加载' : ''}${smsMeta.scanning ? ' · 此分类仍有记录待查找' : ''}${smsFolder === 'sent' ? ' · 发出记录不代表对方已收到' : ''}` : '从设备读取收件与发件记录；查看不会标记已读。');
  const container = $('sms-content'); container.replaceChildren();
  if (!filtered.length) return empty(container, messages.length ? '本页没有符合条件的短信' : smsMeta?.scanning ? `已加载记录中暂未找到${folderTitle}短信，可点“继续查找”` : smsMeta?.hasMore ? `本页没有${folderTitle}短信，可继续下一页` : smsPage > 0 ? '本页已无短信，可返回上一页' : `暂无${folderTitle}短信`, messages.length ? () => { $('sms-search').value = ''; $('sms-unread').checked = false; renderSms(); } : null);
  for (const message of filtered) {
    const card = element('article', `card sms-item sms-${message.folder}`), heading = element('div', 'sms-heading');
    card.dataset.smsFolder = message.folder;
    const sender = element('strong', '', `${message.folder === 'inbox' ? '发件人' : ['sent', 'draft'].includes(message.folder) ? '收件人' : '号码'}：${message.number || '未知号码'}`);
    sender.append(element('span', `sms-state ${message.unread ? 'unread-badge' : ''}`, message.status || '状态未知'));
    if (message.folder === 'other' && message.rawTag != null) sender.append(element('small', 'sms-raw-tag', `设备状态 ${message.rawTag}`));
    const actions = element('div', 'sms-actions');
    const button = element('button', 'text-button', '复制'); button.title = '复制短信内容'; button.addEventListener('click', () => copy(message.text || ''));
    actions.append(element('time', '', smsDate(message.date)), button);
    const reply = element('button', 'text-button', message.folder === 'inbox' ? '回复' : message.folder === 'draft' ? '继续编辑' : message.folder === 'sent' ? '再次发送' : '写给此号码');
    reply.disabled = !message.number;
    reply.addEventListener('click', () => featureUI.compose(message.number || '', ['sent', 'draft'].includes(message.folder) ? message.text || '' : '')); actions.append(reply);
    const id = message.id ?? message.msg_id;
    if (id != null) {
      for (const [action, label] of [...(message.folder === 'inbox' && message.unread ? [['sms-read', '标记已读']] : []), ['sms-delete', '删除']]) {
        const b = element('button', 'text-button', label); b.addEventListener('click', () => featureUI.action(action, { id: String(id) }, () => loadPage('sms', { refresh: true }))); actions.append(b);
      }
    }
    heading.append(sender, actions); card.append(heading, element('p', 'sms-body', message.text || '（空短信）')); container.append(card);
  }
}
function navigate(next) {
  if (!titles[next]) return;
  const changed = view !== next; view = next;
  navigation.select(next);
  const local = next === 'preferences' || next === 'history';
  const target = NETWORK_PAGES.includes(next) ? 'network' : next;
  document.querySelectorAll('.view').forEach(section => section.classList.toggle('hidden', (!connected && !local) || section.id !== `view-${target}`));
  $('welcome').classList.toggle('hidden', connected || local);
  text('page-title', titles[next][0]); text('breadcrumb', titles[next][0]); text('page-description', titles[next][1]);
  if (changed) document.querySelector('.content').scrollTop = 0;
  liveCharts.setVisible(next === 'overview' && connected);
  if (next === 'overview') requestAnimationFrame(drawChart);
  if (next === 'history') historyUI.open(); else historyUI.leave();
  if (listKinds.includes(next) && connected) loadPage(next, { force: false });
  if (next === 'plugins' && connected) pluginsUI.open(); else pluginsUI.leave();
  if (NETWORK_PAGES.includes(next) && connected) { featureUI.tab = next; featureUI.open('network'); }
  else if (featureViews.includes(next) && connected) featureUI.open(next);
  if (toolViews.includes(next) && (connected || local)) toolsUI.open(next);
  syncControls();
}
function resetDeviceData() {
  featureUI.reset(); toolsUI.reset(); pluginsUI.reset();
  liveCharts.reset();
  generation++; snapshotJob = null; failures = 0; samples = []; savedState = null; telemetrySession = null; telemetrySequence = 0;
  renderSidebar();
  clearTimeout(toastTimer); $('toast').classList.add('hidden');
  pages = freshPages(); clientItems = []; clientAccess = null; clientAccessBusy = false; renderClientAccess(); messages = []; smsPage = 0; smsFolder = 'inbox'; smsMeta = null; renderSmsTabs();
  for (const kind of listKinds) { $(`${kind}-content`).replaceChildren(); pageStatus(kind); }
  for (const id of ['client-search', 'sms-search', 'plugin-search']) $(id).value = '';
  $('sms-unread').checked = false; $('client-type').value = '';
  text('sms-page', '第 1 页'); text('clients-total', '—'); text('clients-updated', ''); text('sms-total', '尚未加载'); text('plugin-count', '尚未加载');
  clearOutput(); notice('');
}
async function loadProfiles() {
  const result = await window.ufi.profiles(); profiles = result.profiles;
  const select = $('saved-profile'); select.replaceChildren(element('option', '', '添加设备')); select.firstChild.value = '';
  for (const profile of profiles) { const option = element('option', '', profile.name); option.value = profile.id; select.append(option); }
  select.value = profiles.some(p => p.id === activeProfile?.id) ? activeProfile.id : result.activeId || '';
  $('remember').disabled = !result.canSaveSecrets;
  text('keyring-hint', result.canSaveSecrets ? '使用系统密钥环加密保存。' : '系统密钥环不可用，口令仅用于本次连接。');
  text('welcome-connect', profiles.length ? '连接已保存的设备' : '添加连接');
  const recent = profiles.find(p => p.id === result.activeId);
  text('welcome-profile', recent ? `上次使用：${recent.name} · ${recent.address}` : '常用地址：192.168.0.1:2333');
  selectProfile();
  return result;
}
function selectProfile() {
  const profile = profiles.find(p => p.id === $('saved-profile').value);
  $('connection-mode').value = profile?.mode || 'KANO'; $('login-method').value = profile?.loginMethod || 'LOGIN_MULTI_USER';
  $('profile-name').value = profile?.name || 'F50'; $('address').value = profile?.address || 'http://192.168.0.1:2333';
  clearPasswords(); $('remember').checked = !$('remember').disabled && !!profile?.hasSecret;
  $('delete-profile').disabled = !profile;
  $('connection-error').classList.add('hidden');
  updatePasswordHints();
}
function updatePasswordHints() {
  const direct = $('connection-mode').value !== 'KANO';
  text('zte-password-hint', direct ? '用于登录当前设备后台。' : '读取短信和终端列表时使用。');
  document.querySelector('label[for="zte-password"] .muted').textContent = direct ? '' : '（可选）';
  $('password').disabled = direct; $('zte-password').required = direct && !$('saved-profile').value;
  $('password').closest('.password-field').classList.toggle('hidden', direct);
  document.querySelector('label[for="password"]').classList.toggle('hidden', direct);
  const profile = profiles.find(p => p.id === $('saved-profile').value);
  // UI hint is conservative; the main process performs normalized address checks.
  const unchanged = profile && (profile.mode || 'KANO') === $('connection-mode').value && $('address').value.replace(/\/$/, '') === profile.address;
  const reuse = unchanged && (profile.hasSecret || activeProfile?.id === profile.id);
  $('zte-password').required = direct && !reuse;
  $('password').placeholder = reuse ? '留空沿用当前口令' : '输入此设备的面板口令';
  $('zte-password').placeholder = reuse ? '留空沿用当前中兴口令' : '通常为 admin';
  text('connection-help', connected ? '验证成功后切换；连接失败时保留当前设备。' : '选择已保存的设备，或添加新的连接。');
}
async function openConnection() {
  startupConnectionAllowed = false;
  try {
    await loadProfiles();
    if (!$('connection-dialog').open) $('connection-dialog').showModal();
    syncControls();
  } catch (error) { toast(error.message); }
}
function connectionBusy(value) {
  connecting = value; $('connection-fields').disabled = value; $('submit-connection').disabled = value;
  text('submit-connection', value ? '正在验证…' : '连接'); text('cancel-connection', value ? '取消连接' : '取消'); syncControls();
}
async function closeConnection() {
  if (connecting) {
    // Let the pending connect settle so a success racing with cancel is still reflected.
    try { await window.ufi.cancelConnection(); } catch (error) { toast(error.message); }
  }
  $('connection-dialog').close();
}
function clearPasswords() {
  for (const id of ['password', 'zte-password']) { $(id).value = ''; $(id).type = 'password'; }
  for (const button of document.querySelectorAll('[data-toggle-password]')) { button.textContent = '显示'; button.setAttribute('aria-pressed', 'false'); }
}
async function disconnect() {
  startupConnectionAllowed = false;
  connectAttempt++;
  await window.ufi.disconnect();
  connected = false; activeProfile = null; resetDeviceData();
  connectionBusy(false); setStatus('offline');
  text('connect-button', '连接设备'); text('mini-name', '未连接设备'); text('mini-address', '尚未选择设备'); text('last-update', '已断开连接');
  navigate(view); await loadProfiles(); schedule(); toast('已断开连接');
}
function clearOutput() {
  text('command-output', '尚未执行命令'); text('command-status', '输出');
  $('copy-output').disabled = true; $('clear-output').disabled = true;
}
function updatePresets() {
  const at = $('command-kind').value === 'at';
  $('command-template-search').classList.toggle('hidden', !at);
  $('command-slot').classList.toggle('hidden', !at);
  const query = at ? $('command-template-search').value.trim().toLowerCase() : '';
  const select = $('command-preset'); select.replaceChildren();
  const empty = element('option', '', at ? '选择 AT 查询模板' : '常用查询'); empty.value = ''; select.append(empty);
  if (at) {
    const matches = AT_PRESETS.filter(p => `${p.group} ${p.label} ${p.command} ${p.description}`.toLowerCase().includes(query));
    for (const group of [...new Set(matches.map(p => p.group))]) {
      const optgroup = element('optgroup'); optgroup.label = group;
      for (const preset of matches.filter(p => p.group === group)) { const option = element('option', '', `${preset.label} · ${preset.command}`); option.value = preset.command; optgroup.append(option); }
      select.append(optgroup);
    }
    text('command-template-hint', matches.length ? `${matches.length} 个查询模板。选择后填入，可编辑；执行前确认目标卡槽。固件不支持的指令可能返回 ERROR。` : '没有匹配的模板，可直接输入 AT 指令。');
  } else {
    for (const [value, label] of [['uptime', '运行时间'], ['df -h /data', '存储空间'], ['getprop ro.build.display.id', '固件版本'], ['cat /proc/meminfo', '内存信息']]) { const option = element('option', '', label); option.value = value; select.append(option); }
    text('command-template-hint', '选择常用查询后可编辑，执行前确认命令。');
  }
  $('command').placeholder = at ? 'AT+CSQ' : 'uptime';
}

const featureUI = new FeatureUI({ toast, connected: () => connected, changed: kind => { refresh(); if (listKinds.includes(kind)) loadPage(kind, { refresh: true }); if (kind === 'plugins') pluginsUI.refreshInstalled(); } });
const toolsUI = new ToolsUI(featureUI, { toast, connected: () => connected });
const pluginsUI = new PluginsUI(featureUI, { toast, connected: () => connected, mode: () => activeProfile?.mode, changed: syncControls });
const historyUI = new HistoryUI({ profile: () => activeProfile, changed: syncControls });
const navigation = new Navigation(navigate);

$('device-details-button').addEventListener('click', () => {
  if (!savedState) return;
  const body = featureUI.modal('设备详细信息'), n = savedState.network || {}, b = savedState.base || {};
  const rows = [['型号', savedState.version?.model], ['固件', n.cr_version], ['运行时间（秒）', n.realtime_time], ['电压', n.battery_voltage ?? (number(b.voltage_now) === null ? '—' : (Number(b.voltage_now)/1000000).toFixed(3)+' V')], ['电流', n.battery_current ?? (number(b.current_now) === null ? '—' : (Number(b.current_now)/1000).toFixed(1)+' mA')], ['网络', n.network_type], ['运营商', n.network_provider]];
  body.append(featureUI.table('设备返回值', ['项目','值'], rows));
  for (const key of ['imei','iccid','imsi']) {
    const value = String(n[key] || ''); if (!value) continue;
    const row = element('div','summary-row'), label = element('span','',key.toUpperCase()), masked = element('span','mono','••••••' + value.slice(-4)), reveal = element('button','text-button','显示');
    reveal.addEventListener('click', () => { masked.textContent = value; reveal.disabled = true; }); row.append(label,masked,reveal); body.append(row);
  }
});
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.go)));
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); navigate('overview'); });
for (const id of ['connect-button', 'edit-connection', 'welcome-connect']) $(id).addEventListener('click', openConnection);
for (const id of ['close-dialog', 'cancel-connection']) $(id).addEventListener('click', closeConnection);
$('connection-dialog').addEventListener('cancel', event => { event.preventDefault(); closeConnection(); });
$('connection-dialog').addEventListener('close', clearPasswords);
$('saved-profile').addEventListener('change', selectProfile);
$('address').addEventListener('input', updatePasswordHints);
$('connection-mode').addEventListener('change', () => { $('password').value = ''; if ($('connection-mode').value === 'ZWRT' && ['http://192.168.0.1','http://192.168.0.1:2333'].includes($('address').value)) $('address').value = 'http://192.168.0.1:9461'; if ($('connection-mode').value === 'GOFORM') $('login-method').value = 'LOGIN_MULTI_USER'; if ($('connection-mode').value === 'GOFORM' && $('address').value === 'http://192.168.0.1:2333') $('address').value = 'http://192.168.0.1'; updatePasswordHints(); });
$('delete-profile').addEventListener('click', async () => {
  const id = $('saved-profile').value; if (!id) return;
  try {
    await window.ufi.removeProfile(id); await loadProfiles();
    toast('已删除本机保存的连接配置');
  } catch (error) { toast(error.message); }
});
async function connectDevice(input, { automatic = false } = {}) {
  if (connecting) return;
  const attempt = ++connectAttempt;
  connectionBusy(true); $('connection-error').classList.add('hidden');
  if (automatic) text('welcome-profile', `正在自动连接 ${input.name}…`);
  try {
    const result = await window.ufi.connect(input);
    if (attempt !== connectAttempt) return;
    resetDeviceData(); connected = true; activeProfile = result.profile; telemetrySession = result.telemetrySession;
    text('mini-name', result.profile.name); text('mini-address', result.profile.address.replace(/^https?:\/\//, '')); text('connect-button', '连接设置');
    $('mini-address').title = result.profile.address;
    $('connection-dialog').close(); clearPasswords();
    renderSnapshot({ at: Date.now(), base: result.base, version: result.version, network: {} }, false);
    navigate(view); pluginsUI.connectedDevice(); refreshCurrent(); toast(`已连接 ${result.profile.name}`);
  } catch (error) {
    if (attempt !== connectAttempt) return;
    if ($('connection-dialog').open) {
      text('connection-error', `${error.message}${connected ? '。原设备连接保持可用。' : ''}`); $('connection-error').classList.remove('hidden');
    }
    if (automatic && !connected) text('welcome-profile', `自动连接失败：${error.message}。可手动连接。`);
  } finally { if (attempt === connectAttempt) connectionBusy(false); }
}
async function restoreConnection() {
  const result = await loadProfiles();
  if (!startupConnectionAllowed || connecting || connected || connectAttempt || $('connection-dialog').open) return;
  const profile = result.profiles.find(profile => profile.id === result.activeId && profile.hasSecret);
  if (!result.canSaveSecrets || !profile) return;
  await connectDevice({ id: profile.id, mode: profile.mode, loginMethod: profile.loginMethod,
    name: profile.name, address: profile.address, remember: true }, { automatic: true });
}
$('connection-form').addEventListener('submit', async event => {
  event.preventDefault(); startupConnectionAllowed = false;
  const input = { mode: $('connection-mode').value, loginMethod: $('login-method').value, id: $('saved-profile').value || undefined, name: $('profile-name').value.trim(), address: $('address').value.trim(), password: $('connection-mode').value === 'KANO' ? $('password').value : '', ztePassword: $('zte-password').value, remember: $('remember').checked };
  await connectDevice(input);
});
$('disconnect-button').addEventListener('click', () => disconnect().then(() => $('connection-dialog').close()).catch(error => toast(error.message)));
for (const button of document.querySelectorAll('[data-toggle-password]')) button.addEventListener('click', () => {
  const input = $(button.dataset.togglePassword), show = input.type === 'password';
  input.type = show ? 'text' : 'password'; button.textContent = show ? '隐藏' : '显示'; button.setAttribute('aria-pressed', String(show));
});
$('refresh-button').addEventListener('click', () => refreshCurrent());
$('retry-snapshot').addEventListener('click', () => refreshCurrent());
$('poll-interval').value = String(interval);
$('poll-interval').addEventListener('change', () => {
  interval = Number($('poll-interval').value);
  try { localStorage.setItem('refreshInterval', String(interval)); } catch { /* Optional preference. */ }
  window.ufi.telemetryConfigure(interval).catch(error => toast(error.message));
  schedule();
});
$('chart-window').addEventListener('change', () => { chartWindow = Number($('chart-window').value); drawChart(); });
document.addEventListener('visibilitychange', async () => {
  schedule();
  if (document.hidden) liveCharts.release();
  if (!document.hidden && connected) {
    try { const state = await window.ufi.telemetryState(); for (const packet of state.history) receiveTelemetry(packet); drawChart(); }
    catch (error) { toast(error.message); }
  }
});
for (const id of ['client-search', 'client-type', 'client-sort']) $(id).addEventListener(id === 'client-search' ? 'input' : 'change', () => { if (pages.clients.loadedAt) renderClients(); });
for (const id of ['sms-search', 'sms-unread']) $(id).addEventListener(id === 'sms-search' ? 'input' : 'change', () => { if (pages.sms.loadedAt) renderSms(); });
$('sms-previous').addEventListener('click', () => loadPage('sms', { page: smsPage - 1 }));
$('sms-next').addEventListener('click', () => loadPage('sms', { page: smsMeta?.scanning ? smsPage : smsPage + 1 }));
document.querySelectorAll('[data-open-panel]').forEach(button => button.addEventListener('click', async () => {
  try { await window.ufi.openPanel(); } catch (error) { toast(error.message); }
}));
$('export-button').addEventListener('click', async () => {
  $('export-button').disabled = true;
  try { const result = await window.ufi.export(); if (result.saved) toast('状态已导出'); }
  catch (error) { toast(error.message); } finally { syncControls(); }
});
$('one-click-shell').addEventListener('click', () => featureUI.action('one-click-shell', {}));
$('open-ttyd').addEventListener('click', () => {
  const body = featureUI.modal('TTYD 网页终端');
  body.append(toolsUI.localForm('连接设备终端', [{ key: 'port', label: '设备端口', value: '1146', type: 'number', min: 1, max: 65535 }], '检测并打开', async data => { await window.ufi.openTerminal(Number(data.port)); $('feature-dialog').close(); }));
});
$('command-preset').addEventListener('change', () => { if ($('command-preset').value) { $('command').value = $('command-preset').value; const preset = AT_PRESETS.find(p => p.command === $('command').value); if (preset) text('command-template-hint', preset.description); $('command').focus(); syncControls(); } });
$('command-kind').addEventListener('change', updatePresets);
$('command-template-search').addEventListener('input', updatePresets);
$('command').addEventListener('input', syncControls);
$('copy-output').addEventListener('click', () => copy($('command-output').textContent));
$('clear-output').addEventListener('click', clearOutput);
$('command-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!connected || commandBusy || !$('command').value.trim()) return;
  const rev = generation, started = performance.now(); commandBusy = true; syncControls();
  text('command-status', '等待确认与执行…');
  try {
    const result = await window.ufi.command({ kind: $('command-kind').value, command: $('command').value, slot: $('command-slot').value });
    if (rev !== generation) return;
    if (result.cancelled) { text('command-status', '已取消 · 保留上次输出'); toast('已取消执行'); }
    else {
      text('command-output', typeof result.result === 'string' ? result.result : JSON.stringify(result, null, 2));
      text('command-status', `完成 · ${((performance.now() - started) / 1000).toFixed(1)} 秒`);
      $('copy-output').disabled = false; $('clear-output').disabled = false;
    }
  } catch (error) {
    if (rev === generation) { text('command-output', error.message); text('command-status', '执行失败'); $('clear-output').disabled = false; $('copy-output').disabled = false; }
  } finally { commandBusy = false; syncControls(); }
});
document.addEventListener('keydown', event => {
  if ($('connection-dialog').open || $('feature-dialog').open) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') event.preventDefault(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') { event.preventDefault(); refreshCurrent(); }
  if (event.altKey && /^[1-6]$/.test(event.key)) { event.preventDefault(); navigate(NAV[Number(event.key) - 1].pages[0][0]); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && view === 'tools') { event.preventDefault(); $('command-form').requestSubmit(); }
});
const smsTabs = $('sms-folders');
for (const [folder, title] of smsFolders) {
  const tab = element('button', 'sms-folder-tab', title); tab.type = 'button'; tab.dataset.smsFolder = folder; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'sms-content');
  tab.append(element('span', 'count-badge', '—')); tab.addEventListener('click', () => switchSmsFolder(folder)); smsTabs.append(tab);
}
smsTabs.addEventListener('keydown', event => {
  const tabs = [...smsTabs.children], index = tabs.indexOf(event.target);
  if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
  tabs[next].focus(); tabs[next].click();
});
renderSmsTabs();
updatePresets(); renderSignals(); navigate('overview'); schedule();
restoreConnection().catch(error => toast(error.message));
