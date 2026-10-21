import { neighborCells } from './cells.mjs';
import { CALLING_CODES, searchCallingCodes } from './calling-codes.mjs';
import { bytes, number, parsed, cellularStatus } from './format.mjs';
const $ = id => document.getElementById(id);
const el = (tag, cls, content) => { const node = document.createElement(tag); if (cls) node.className = cls; if (content !== undefined) node.textContent = content; return node; };
const onOff = [['0', '关闭'], ['1', '开启']];
const boolValue = value => value === true || value === 'true' || value === '1' || value === 1 ? '1' : value === false || value === 'false' || value === '0' || value === 0 ? '0' : '';
const field = (key, label, value = '', options = {}) => ({ key, label, value, ...options });
const select = (key, label, value, choices, options = {}) => field(key, label, value, { choices, ...options });
const toggle = (key, label, value) => select(key, label, boolValue(value), onOff);
const button = (label, handler, cls = 'button secondary small') => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', handler); return b; };
const hint = message => el('p', 'feature-hint', message);
const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const featureViews = ['network', 'traffic', 'forward', 'tasks', 'device'];

export class FeatureUI {
  constructor({ toast, connected, changed }) {
    this.toast = toast; this.connected = connected; this.changed = changed;
    this.epoch = 0; this.active = ''; this.tab = 'network'; this.states = new Map(); this.pendingWrite = false;
    this.dateRange = { from: localDate(new Date(Date.now() - 6 * 86400000)), to: localDate(new Date()) };
    this.pluginRevision = null;
    for (const [key, title] of [['network', '蜂窝网络'], ['wifi', 'Wi-Fi'], ['apn', 'APN'], ['radio', '锁频 / 基站'], ['lan', 'LAN / DHCP']]) {
      const b = button(title, () => { this.tab = key; this.open('network'); }, 'subnav-button'); b.dataset.tab = key; $('network-tabs').append(b);
    }
    this.dialogDirty = false;
    $('feature-dialog').addEventListener('input', () => { this.dialogDirty = true; });
    $('close-feature-dialog').addEventListener('click', () => this.requestClose());
    $('feature-dialog').addEventListener('cancel', event => { event.preventDefault(); this.requestClose(); });
    $('feature-dialog').addEventListener('close', () => { if (this.dialogReturnFocus?.isConnected) this.dialogReturnFocus.focus(); this.dialogReturnFocus = null; this.dialogToken = null; this.dialogDirty = false; $('feature-dialog-body').replaceChildren(); });
    $('compose-sms').addEventListener('click', () => this.compose());
    $('manage-plugins').addEventListener('click', () => this.plugins());
  }
  reset() {
    this.reviewResolver?.(false);
    this.lastResult = null;
    this.epoch++; this.states.clear(); this.active = ''; this.pluginRevision = null;
    for (const view of featureViews) $(`${view}-host`).replaceChildren();
    $('feature-dialog').close();
  }
  async write(action, data) {
    if (!this.connected()) throw new Error('请先连接设备');
    if (this.pendingWrite) throw new Error('上一项操作仍在执行');
    const epoch = this.epoch; this.pendingWrite = true;
    try {
      const plan = await window.ufi.prepareOperation(action, data);
      if (!(await this.confirmPlan(plan))) { await window.ufi.cancelOperation(plan.id); return false; }
      if (epoch !== this.epoch) { await window.ufi.cancelOperation(plan.id); throw new Error('设备连接已变更'); }
      const result = await window.ufi.commitOperation(plan.id);
      if (epoch !== this.epoch) throw new Error('设备连接已变更');
      if (result?.cancelled) return false;
      this.dialogDirty = false; this.lastResult = result;
      this.toast(result?.warning || '设备已接受操作'); this.changed(action.startsWith('sms-') ? 'sms' : action.startsWith('plugin') ? 'plugins' : action.startsWith('client-') ? 'clients' : undefined); return true;
    } finally { this.pendingWrite = false; }
  }
  async requestClose() {
    if (this.reviewResolver) { this.reviewResolver(false); return; }
    if (this.dialogDirty) {
      const discard = await this.confirmPlan({ title: '放弃未保存的编辑？', detail: '当前输入尚未提交。选择返回可继续编辑。', target: '当前编辑', address: '' }, '放弃并关闭');
      if (!discard) return;
    }
    $('feature-dialog').close();
  }
  confirmPlan(plan, confirmLabel = '确认执行') {
    if (this.reviewResolver) return Promise.resolve(false);
    const dialog = $('feature-dialog'), body = $('feature-dialog-body');
    const wasOpen = dialog.open, title = $('feature-dialog-title').textContent, cls = dialog.className, dirty = this.dialogDirty;
    const focused = document.activeElement;
    if (!wasOpen) this.dialogReturnFocus = focused;
    const retained = [...body.childNodes];
    body.replaceChildren(); $('feature-dialog-title').textContent = plan.title;
    body.append(hint([plan.target, plan.address].filter(Boolean).join(' · ')), el('pre', 'operation-detail', plan.detail || '确认应用此操作。'));
    const actions = el('div', 'dialog-actions'); body.append(actions);
    return new Promise(resolve => {
      this.reviewResolver = accepted => {
        this.reviewResolver = null;
        if (wasOpen) { body.replaceChildren(...retained); $('feature-dialog-title').textContent = title; dialog.className = cls; this.dialogDirty = dirty; requestAnimationFrame(() => { if (dialog.open && focused?.isConnected) focused.focus(); }); }
        else { dialog.close(); body.replaceChildren(); }
        resolve(accepted);
      };
      const confirm = button(confirmLabel, () => this.reviewResolver(true), 'button primary'); confirm.dataset.confirmOperation = 'true';
      actions.append(button('返回', () => this.reviewResolver(false)), confirm);
      if (!dialog.open) dialog.showModal();
      actions.firstChild.focus();
    });
  }
  form(title, action, fields, { help, submit = '保存', extra = {}, after, state } = {}) {
    const form = el('form', 'card settings-form'); form.dataset.action = action;
    form.append(el('h3', '', title)); if (help) form.append(hint(help));
    const inputs = el('fieldset', 'form-grid');
    for (const f of fields) {
      const wrap = el('label', f.type === 'textarea' ? 'wide-field' : ''); wrap.append(el('span', '', f.label));
      const input = el(f.choices ? 'select' : f.type === 'textarea' ? 'textarea' : 'input');
      input.name = f.key; input.required = !f.optional; input.autocomplete = 'off';
      if (f.choices) {
        if (f.value === '' || f.value == null || !f.choices.some(([v]) => String(v) === String(f.value))) {
          const empty = el('option', '', f.value ? `当前：${f.value}（请选择）` : '请选择'); empty.value = ''; input.append(empty);
        }
        for (const [value, label] of f.choices) { const opt = el('option', '', label); opt.value = value; input.append(opt); }
      } else if (f.type === 'textarea') { input.rows = f.rows || 4; input.spellcheck = false; }
      else input.type = f.type || 'text';
      input.value = String(f.value ?? '');
      for (const key of ['min', 'max', 'step', 'maxLength', 'placeholder']) if (f[key] !== undefined) input[key] = f[key];
      if (f.readOnly) input.readOnly = true;
      wrap.append(input); if (f.hint) wrap.append(el('small', 'field-hint', f.hint)); inputs.append(wrap);
    }
    const status = el('p', 'form-error hidden'); status.setAttribute('role', 'status');
    const actions = el('div', 'form-actions'); const save = el('button', 'button primary small', submit); save.type = 'submit';
    actions.append(save); form.append(inputs, status, actions);
    form.addEventListener('input', () => { if (state) { state.dirtyForms.add(form); state.dirty = true; } });
    form.addEventListener('submit', async event => {
      event.preventDefault(); const epoch = this.epoch;
      const data = { ...extra, ...Object.fromEntries(new FormData(form)) };
      save.disabled = true; inputs.disabled = true; status.classList.add('hidden');
      try {
        if (await this.write(action, data)) {
          if (state) { state.dirtyForms.delete(form); state.dirty = state.dirtyForms.size > 0; }
          // Do not retain newly entered secrets after a successful save.
          form.querySelectorAll('input[type=password]').forEach(input => { input.value = ''; });
          if (after) await after(); else if (state) await this.load(state);
        }
      } catch (error) {
        if (epoch === this.epoch && form.isConnected) { status.textContent = error.message; status.classList.remove('hidden'); }
      } finally { save.disabled = false; inputs.disabled = false; }
    });
    return form;
  }
  modal(title) {
    if (!$('feature-dialog').open) this.dialogReturnFocus = document.activeElement;
    this.dialogDirty = false;
    $('feature-dialog-title').textContent = title; $('feature-dialog-body').replaceChildren();
    this.dialogToken = {}; $('feature-dialog').classList.remove('code-dialog');
    if (!$('feature-dialog').open) $('feature-dialog').showModal();
    return $('feature-dialog-body');
  }
  async action(name, data, after) {
    try { if (await this.write(name, data)) await after?.(); }
    catch (error) { this.toast(error.message); }
  }
  compose(number = '', content = '') {
    const body = this.modal('发送短信');
    const form = this.form('新短信', 'sms-send', [
      select('numberMode', '号码格式', 'original', [['original', '原样发送（本地号码、短号码或完整 +号码）'], ['international', '国际号码（选择国家／地区）']]),
      field('countryCode', '国家／地区代码', '86', { maxLength: 4, optional: true }),
      field('number', '收件号码', number, { maxLength: 64, type: 'tel', placeholder: '本地号码或 +447700900123' }),
      field('content', '内容', content, { type: 'textarea', maxLength: 2000, rows: 6 }),
    ], { help: '国际号码采用 +国家／地区代码和号码。短号码（如 10000）请选择原样发送。发送前会确认最终号码与内容；是否能发送到目的地及费用取决于运营商。', submit: '发送', after: () => $('feature-dialog').close() });
    const mode = form.elements.numberMode, code = form.elements.countryCode, recipient = form.elements.number;
    const country = el('div', 'wide-field country-picker'); country.classList.add('hidden');
    const searchLabel = el('label'), search = el('input'); search.type = 'search'; search.placeholder = '搜索国家名、英文名或区号'; search.setAttribute('aria-label', '搜索国家或地区');
    searchLabel.append(el('span', '', '查找国家／地区'), search);
    const regionLabel = el('label'), region = el('select'); region.setAttribute('aria-label', '国家或地区');
    regionLabel.append(el('span', '', '国家／地区与区号'), region);
    const matchHint = el('small', 'field-hint'); matchHint.setAttribute('role', 'status');
    country.append(searchLabel, regionLabel, matchHint);
    code.closest('label').before(country);
    let selected = 'CN', revision = 0;
    const renderCountries = () => {
      const matches = searchCallingCodes(search.value), chosen = CALLING_CODES.find(item => item.id === selected);
      region.replaceChildren();
      for (const item of matches) { const option = el('option', '', `${item.name} +${item.code}`); option.value = item.id; region.append(option); }
      if (chosen && !matches.some(item => item.id === selected)) { const retained = el('option', '', `${chosen.name} +${chosen.code}（当前选择）`); retained.value = chosen.id; region.append(retained); }
      const other = el('option', '', '其他国家／地区 · 手动填写区号'); other.value = 'custom'; region.append(other); region.value = selected;
      matchHint.textContent = matches.length ? `匹配 ${matches.length} 个常用国家／地区；未列出的地区可手动填写。` : '无匹配结果；已保留当前选择，也可手动填写区号。';
    };
    const preview = el('p', 'sms-number-preview'); preview.setAttribute('role', 'status');
    const guidance = hint('已输入完整 +号码时直接使用，不重复添加区号。本地拨号前缀请按目的地规则处理：例如英国 07700… 转为 +44 7700…；不要统一删除所有国家号码开头的 0。短信中心属于当前 SIM 的运营商，与收件人国家区号无关。');
    form.querySelector('.form-actions').before(preview, guidance);
    const updatePreview = async () => {
      const current = ++revision, international = mode.value === 'international';
      country.classList.toggle('hidden', !international);
      code.closest('label').classList.toggle('hidden', !international || selected !== 'custom');
      code.required = international && !recipient.value.trim().startsWith('+');
      recipient.placeholder = international ? '国际格式中的号码部分，或完整 +号码' : '本地号码或 +447700900123';
      if (!recipient.value.trim()) { preview.textContent = '最终收件号码：等待输入'; return; }
      try {
        const finalNumber = await window.ufi.smsNumberPreview({ number: recipient.value, numberMode: mode.value, countryCode: code.value });
        if (current === revision) preview.textContent = `最终收件号码：${finalNumber}${recipient.value.trim().startsWith('+') ? ' · 已使用完整国际号码' : ''}`;
      } catch (error) { if (current === revision) preview.textContent = error.message; }
    };
    search.addEventListener('input', renderCountries);
    region.addEventListener('change', () => { selected = region.value; code.value = selected === 'custom' ? '' : CALLING_CODES.find(item => item.id === selected).code; this.dialogDirty = true; updatePreview(); });
    for (const input of [mode, code, recipient]) { input.addEventListener('input', updatePreview); input.addEventListener('change', updatePreview); }
    renderCountries(); body.append(form); updatePreview();
  }
  rename(device) {
    this.modal('修改终端名称').append(this.form('终端名称', 'hostname', [field('name', '名称', device.name, { maxLength: 64 })], { extra: { mac: device.mac }, help: device.mac, after: () => { $('feature-dialog').close(); this.changed('clients'); } }));
  }
  async open(view) {
    this.active = view;
    const key = view === 'network' ? this.tab : view;
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === this.tab));
    const host = $(`${view}-host`);
    let state = this.states.get(key);
    if (!state) {
      const root = el('div'), status = el('div', 'list-status hidden'), content = el('div', 'settings-grid');
      root.append(status, content); host.append(root);
      state = { key, root, status, content, loaded: false, busy: false, dirty: false, dirtyForms: new Set() }; this.states.set(key, state);
    }
    [...host.children].forEach(child => child.classList.toggle('hidden', child !== state.root));
    if (!state.loaded) await this.load(state);
  }
  async refresh() {
    const key = this.active === 'network' ? this.tab : this.active;
    const state = this.states.get(key); if (state) await this.load(state);
  }
  async load(state, discard = false) {
    if (!this.connected() || state.busy) return;
    if (state.dirty && !discard) {
      state.status.replaceChildren(el('span', '', '有未保存的更改。'), button('放弃更改并重新读取', () => this.load(state, true)));
      state.status.classList.remove('hidden'); return;
    }
    const epoch = this.epoch; state.busy = true;
    state.status.replaceChildren(el('span', 'loading-label', '正在读取配置…')); state.status.classList.remove('hidden');
    try {
      const input = state.key === 'traffic' ? { startDate: this.dateRange.from, endDate: this.dateRange.to, startTime: new Date(`${this.dateRange.from}T00:00:00`).getTime(), endTime: new Date(`${this.dateRange.to}T23:59:59`).getTime() } : {};
      const data = await window.ufi.featureRead(state.key, input);
      if (epoch !== this.epoch) return;
      state.dirty = false; state.dirtyForms.clear(); state.loaded = true; state.content.replaceChildren();
      this.render(state, data);
      state.status.replaceChildren();
      if (data.warnings?.length) state.status.append(el('span', '', `部分功能读取失败：${data.warnings.join('；')}`));
      state.status.classList.toggle('hidden', !data.warnings?.length);
    } catch (error) {
      if (epoch === this.epoch) {
        state.status.replaceChildren(el('span', '', `${error.message}${state.loaded ? '；保留上次读取的配置。' : ''}`), button('重试', () => this.load(state, true)));
        state.status.classList.remove('hidden');
      }
    } finally { state.busy = false; }
  }
  table(title, columns, rows) {
    const card = el('article', 'card feature-table wide-card'); card.append(el('h3', '', title));
    if (!rows.length) { card.append(hint('设备未返回记录')); return card; }
    const table = el('table'), head = el('thead'), tr = el('tr'), body = el('tbody');
    for (const name of columns) { const th = el('th', '', name); th.scope = 'col'; tr.append(th); } head.append(tr);
    for (const row of rows) { const tr = el('tr'); for (const value of row) { const td = el('td'); value instanceof Node ? td.append(value) : td.textContent = String(value ?? '—'); tr.append(td); } body.append(tr); }
    table.append(head, body); const scroll = el('div', 'table-scroll'); scroll.append(table); card.append(scroll); return card;
  }
  render(state, d) {
    const root = state.content;
    const form = (title, action, fields, options = {}) => root.append(this.form(title, action, fields, { state, ...options }));
    switch (state.key) {
      case 'network': {
        const n = d.network;
        form('网络制式', 'network-mode', [select('mode', '优先模式', n.net_select, [['WL_AND_5G', '5G / 4G / 3G 自动'], ['Only_5G', '仅 5G SA'], ['LTE_AND_5G', '5G NSA / LTE'], ['Only_LTE', '仅 4G LTE']])], { help: `当前：${n.network_provider || '—'} · ${n.network_type || '—'}` });
        form('蜂窝数据', 'cellular', [select('enabled', '目标状态', '', [['1', '连接'], ['0', '断开']])], { help: `当前拨号状态：${cellularStatus(n.ppp_status)}` });
        form('数据漫游', 'roaming', [toggle('enabled', '允许数据漫游', n.roam_setting_option === 'on' ? '1' : n.roam_setting_option === 'off' ? '0' : '')]);
        form('SIM 卡槽', 'sim', [select('slot', '目标卡槽', '', [...((d.slots || ['0','1','2','11']).map(slot => [slot, `槽位 ${slot}`]))])], { help: `设备当前返回槽位 ${n.sim_slot ?? '未知'}。可用槽位取决于机型，切换会断网。` }); break;
      }
      case 'wifi': {
        form('Wi-Fi 开关', 'wifi-toggle', [toggle('enabled', '无线网络', d.enabled)]);
        if (d.points.length > 1 && !d.noChipSwitch) form('Wi-Fi 芯片 / 频段', 'wifi-chip', [select('chip', '切换到', '', [['chip1', '芯片 1（通常为 2.4 GHz）'], ['chip2', '芯片 2（通常为 5 GHz）']])], { help: '实际频段与双频并发能力取决于固件。' });
        if (!d.points.length) root.append(hint('此设备未提供可编辑热点配置。'));
        for (const p of d.points) {
          form(`热点 · 芯片 ${p.ChipIndex} / ${p.AccessPointIndex}`, 'wifi-save', [
            field('ssid', '网络名称', p.SSID, { maxLength: 32 }), select('auth', '认证方式', p.AuthMode, [['OPEN', '开放网络'], ['WPA2PSK', 'WPA2-PSK'], ['WPA3PSK', 'WPA3-PSK'], ['WPA2PSKWPA3PSK', 'WPA2 / WPA3']]),
            field('password', '新 Wi-Fi 口令', '', { type: 'password', optional: true, maxLength: 63, hint: '留空保留原口令' }), field('max', '终端上限', p.ApMaxStationNumber, { type: 'number', min: 1, max: 64 }),
            toggle('hidden', '隐藏 SSID', p.ApBroadcastDisabled), toggle('isolate', '终端隔离', p.ApIsolate || '0'),
          ], { extra: { chip: String(p.ChipIndex), point: String(p.AccessPointIndex) }, help: `热点状态：${p.AccessPointSwitchStatus === '1' ? '已开启' : '未开启'}。修改后可能需要重新连接 Wi-Fi。` });
        } break;
      }
      case 'radio': {
        const r = d.radio;
        if (!r) { root.append(hint('无法读取锁频状态，请先重试。')); break; }
        const cells = neighborCells(r.neighbor_cell_info, r.network_type);
        const loadedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const toolbar = el('div', 'wide-card feature-toolbar');
        toolbar.append(hint(`邻区读取于 ${loadedAt} · 选择列表中的基站即可确认锁定。`), button('刷新邻区', () => this.load(state)));
        root.append(toolbar);
        const rowsFor = selectedCells => selectedCells.map(cell => {
          const label = cell.rat === '16' ? '5G NR' : cell.rat === '12' ? '4G LTE' : '待选择';
          const choose = button('选择锁定', () => {
            const fields = [select('rat', '制式', cell.rat, [['12', '4G LTE'], ['16', '5G NR']]), field('pci', 'PCI', cell.pci, { readOnly: true }), field('earfcn', '频点', cell.earfcn, { readOnly: true }), ...(d.requireNrBand ? [field('band','5G 频段',cell.band ?? '',{type:'number',optional:true,min:1,max:1024})] : [])];
            const input = { rat: cell.rat, pci: String(cell.pci), earfcn: String(cell.earfcn), ...(cell.band != null ? { band: String(cell.band) } : {}) };
            if (!cell.rat || (d.requireNrBand && cell.rat === '16' && !(cell.band > 0))) {
              this.modal('确认邻区参数').append(this.form('已选择的邻区', 'cell-lock', fields, { help: 'PCI 和频点已从列表带入。设备未提供完整制式／频段，请补充后确认。', submit: '预览锁定', after: async () => { $('feature-dialog').close(); await this.load(state); } }));
            } else this.action('cell-lock', input, () => this.load(state));
          });
          choose.dataset.cellChoice = `${cell.rat}:${cell.earfcn}:${cell.pci}`;
          choose.setAttribute('aria-label', `选择锁定 ${label} PCI ${cell.pci ?? '未知'} 频点 ${cell.earfcn ?? '未知'}`);
          choose.disabled = !!cell.reason;
          const action = el('div'); action.append(choose); if (cell.reason) action.append(hint(cell.reason));
          const ratLabel = el('span', '', label); ratLabel.title = `制式来源：${cell.ratSource}`;
          return [ratLabel, cell.band == null ? '—' : `${cell.rat === '16' ? 'n' : cell.rat === '12' ? 'B' : ''}${cell.band}`, cell.earfcn, cell.pci, cell.rsrp, cell.rsrq, cell.sinr, action];
        });
        const filters = el('div', 'wide-card neighbor-filters');
        const query = el('input'); query.type = 'search'; query.placeholder = '搜索 PCI、频点或频段'; query.setAttribute('aria-label', '搜索邻区');
        const order = el('select'); order.setAttribute('aria-label', '邻区排序');
        for (const [value, label] of [['device','设备顺序'], ['signal','信号由强到弱'], ['frequency','按频点 / PCI']]) { const option = el('option', '', label); option.value = value; order.append(option); }
        const clear = button('清除筛选', () => { query.value = ''; order.value = 'device'; renderNeighbors(); query.focus(); });
        filters.append(query, order, clear); root.append(filters);
        const neighborHost = el('div', 'wide-card'); root.append(neighborHost);
        const renderNeighbors = () => {
          const text = query.value.trim().toLowerCase();
          const filtered = cells.filter(cell => `${cell.rat === '16' ? '5G NR n' : cell.rat === '12' ? '4G LTE B' : ''}${cell.band ?? ''} ${cell.pci ?? ''} ${cell.earfcn ?? ''}`.toLowerCase().includes(text));
          if (order.value === 'signal') filtered.sort((a,b) => (b.rsrp ?? -Infinity) - (a.rsrp ?? -Infinity));
          if (order.value === 'frequency') filtered.sort((a,b) => (a.earfcn ?? Infinity) - (b.earfcn ?? Infinity) || (a.pci ?? Infinity) - (b.pci ?? Infinity));
          const neighbors = this.table(`邻区基站 · ${filtered.length} / ${cells.length} 个`, ['制式', '频段', '频点', 'PCI', 'RSRP', 'RSRQ', 'SINR', '操作'], rowsFor(filtered));
          neighbors.dataset.neighborTable = 'true';
          if (!filtered.length && cells.length) neighbors.querySelector('.feature-hint').textContent = '没有匹配的邻区，可清除筛选重试。';
          neighbors.append(hint('制式优先使用邻区条目；条目未提供时依据当前网络制式，来源可在制式文字上查看。确认页会再次列出制式、PCI 和频点。'));
          neighborHost.replaceChildren(neighbors);
          clear.disabled = !query.value && order.value === 'device';
        };
        query.addEventListener('input', renderNeighbors); order.addEventListener('change', renderNeighbors); renderNeighbors();
        const locked = neighborCells(r.locked_cell_info, r.network_type);
        root.append(this.table('已锁定基站', ['制式', '频段', '频点', 'PCI'], locked.map(cell => [cell.rat === '16' ? '5G NR' : cell.rat === '12' ? '4G LTE' : '—', cell.band, cell.earfcn, cell.pci])));
        const unlock = el('article', 'card settings-form'); unlock.append(el('h3', '', '解除基站锁'), hint('解除设备记录的全部基站锁定。'), button('全部解锁', () => this.action('cell-unlock', {}, () => this.load(state)))); root.append(unlock);
        const manual = el('details', 'wide-card manual-cell-lock'); manual.append(el('summary', '', '手动输入基站参数'));
        manual.append(this.form('手动基站锁定', 'cell-lock', [select('rat', '制式', '', [['12', '4G LTE'], ['16', '5G NR']]), field('pci', 'PCI', '', { type: 'number', min: 0, max: 1007 }), field('earfcn', '频点（EARFCN / NR-ARFCN）', '', { type: 'number', min: 0, max: 3279165 }), ...(d.requireNrBand ? [field('band','5G 频段（锁定 NR 时必填）','',{type:'number',optional:true,min:1,max:1024})] : [])], { state, help: '用于邻区未列出的目标。锁定后可能暂时断网，不自动重启网络。', submit: '预览锁定' })); root.append(manual);
        for (const [rat, label, value] of (d.bandTargets || [['LTE', '4G LTE', r.lte_band_lock], ['NR', '5G NR', r.nr_band_lock]])) form(`${label} 频段锁`, 'bands', [field('bands', '频段列表', value || '', { optional: true, placeholder: rat.startsWith('NR') ? '例如 41,78' : '例如 1,3,8', hint: '逗号分隔；留空并保存可解锁。' })], { extra: { rat } });
        if (d.supported) root.append(hint(`设备报告的 NR 支持频段：${typeof d.supported.result === 'string' ? d.supported.result : JSON.stringify(d.supported)}`)); break;
      }
      case 'apn': {
        const actions = p => { const row = el('div', 'inline-actions'); row.append(button('设为默认', () => this.action('apn-default', { index: p.index }, () => this.load(state, true))), button('编辑', () => this.apnEditor(p, state)), button('删除', () => this.action('apn-delete', { index: p.index }, () => this.load(state, true)))); return row; };
        const tools = el('div', 'wide-card feature-toolbar'); tools.append(hint(`当前：${d.current || '—'} / ${d.apn || '—'} · ${d.mode === 'auto' ? '自动' : '手动'}`), button('自动 APN', () => this.action('apn-auto', {}, () => this.load(state, true))), button('新增配置', () => this.apnEditor({ index: Array.from({ length: 20 }, (_, i) => i).find(i => !d.profiles.some(p => p.index === i)) ?? 0 }, state), 'button primary small')); root.append(tools);
        root.append(this.table('APN 配置', ['索引', '名称', 'APN', 'PDP', '操作'], d.profiles.map(p => [p.index, p.name, p.apn, p.pdp, actions(p)]))); break;
      }
      case 'lan': {
        const l = d.lan;
        form('LAN / DHCP', 'lan', [field('lanIp', '网关 IP', l.lan_ipaddr, {readOnly:d.addressWritable===false}), field('lanNetmask', '子网掩码', l.lan_netmask, {readOnly:d.addressWritable===false}), toggle('enabled', 'DHCP 服务', l.dhcpEnabled), field('dhcpStart', '地址池起点', l.dhcpStart), field('dhcpEnd', '地址池终点', l.dhcpEnd), field('lease', '租约（小时）', l.dhcpLease_hour, { type: 'number', min: 1, max: 168 })], { help: '网关修改后需要重新获取电脑地址，并修改本客户端的连接地址。' }); break;
      }
      case 'traffic': {
        const query = el('form', 'wide-card traffic-query');
        for (const [key, label] of [['from', '开始日期'], ['to', '结束日期']]) { const wrap = el('label', '', label), input = el('input'); input.type = 'date'; input.name = key; input.required = true; input.value = this.dateRange[key]; wrap.append(input); query.append(wrap); }
        const submit = el('button', 'button secondary small', '查询'); query.append(submit);
        query.addEventListener('submit', e => { e.preventDefault(); this.dateRange = Object.fromEntries(new FormData(query)); this.load(state); }); root.append(query);
        if (d.usage) {
          const rows = Array.isArray(d.usage.usage) ? d.usage.usage : [];
          root.append(this.table(`区间用量 · ${bytes(rows.reduce((sum, r) => sum + (number(r.usage) || 0), 0))}`, ['日期', '蜂窝流量'], rows.map(r => [r.date, bytes(r.usage)])));
        }
        if (d.limit) { const l = d.limit; form('流量上限与提醒', 'traffic-limit', [toggle('enabled', '限制开关', l.data_flow_limit_enabled), field('gb', '上限（GB）', Number(l.data_flow_max_limit) > 0 ? (l.data_flow_max_limit / 1024 ** 3).toFixed(2) : '10', { type: 'number', min: .01, max: 100000, step: .01 }), select('period', '统计周期', l.data_flow_check_daily_or_monthly, [['daily', '每天'], ['monthly', '每月']]), select('reference', '数据来源', l.data_check_reference, [['android', 'Android 统计'], ['default', '原厂统计']]), toggle('notify', '达到上限时转发提醒', l.data_limit_status_forward_enabled)], { help: '提醒使用设备已配置的短信转发渠道。启用限制后，达到上限可能断开蜂窝网络。' }); } break;
      }
      case 'tasks': {
        const list = Array.isArray(d.tasks) ? d.tasks : [];
        root.append(this.table('设备定时任务', ['ID', '设备时间', '重复', '动作', '操作'], list.map(task => [task.id, task.time, task.repeatDaily ? '每天' : '一次', task.actionMap?.goformId || '其他动作', button('删除', () => this.action('task-remove', { id: task.id }, () => this.load(state, true)))])));
        form('添加 / 替换定时任务', 'task-add', [field('id', '任务 ID', '', { placeholder: 'daily_reboot', maxLength: 80 }), field('time', '设备本地时间', '03:00', { type: 'time' }), select('repeat', '重复', '1', [['1', '每天'], ['0', '仅一次']]), select('action', '动作', '', [['reboot', '重启设备'], ['connect', '连接蜂窝网络'], ['disconnect', '断开蜂窝网络'], ['wifiOn', '开启 Wi-Fi'], ['wifiOff', '关闭 Wi-Fi']])], { help: '由设备运行，退出桌面客户端仍有效。设备 UFI-TOOLS 需已配置中兴后台口令。' }); break;
      }
      case 'device': {
        if (d.supportsNickname !== false) form('设备别名', 'nickname', [field('nickname', '新别名', '', { maxLength: 255 })]);
        if (d.device) for (const [setting, label, key] of [['usb', 'USB 调试', 'usb_port_switch'], ['performance', '性能模式', 'performance_mode'], ['samba', 'SMB 文件共享', 'samba_switch'], ['led', '指示灯', 'indicator_light_switch']]) if (d.device[key] != null && d.device[key] !== '') form(label, 'device-toggle', [toggle('enabled', label, d.device[key])], { extra: { setting } });
        if (d.adb) form('无线 ADB 自启', 'adb', [toggle('enabled', '开关', d.adb.enabled), field('password', '中兴后台口令', '', { type: 'password', optional: true, hint: '开启时必填，服务端会保存此口令。' })]);
        if (d.log) form('调试日志', 'debug-log', [toggle('enabled', '记录调试日志', d.log.debug_log_enabled)]);
        if (d.mode === 'KANO') form('CPU 唤醒锁', 'wakelock', [select('enabled', '目标状态', '', onOff)], { help: '保持 CPU 唤醒可能增加功耗。' });
        if (d.device?.restart_schedule_switch != null) form('原厂定时重启', 'restart-schedule', [toggle('enabled', '启用', d.device.restart_schedule_switch), field('time', '设备时间', d.device.restart_time || '03:00', { type: 'time' })]);

        if (d.device && d.device.sleep_sysIdleTimeToSleep != null && d.device.sleep_sysIdleTimeToSleep !== '') form('Wi-Fi 自动休眠', 'wifi-sleep', [field('minutes','空闲分钟数',d.device.sleep_sysIdleTimeToSleep||'0',{type:'number',min:0,max:1440})]);
        if (['1',1,true].includes(d.device?.is_support_nfc_functions)) form('NFC', 'nfc', [toggle('enabled','开关',d.device.web_wifi_nfc_switch)]);
        if (d.mode === 'KANO') form('设备高级功能', 'advanced-mode', [select('enabled','目标状态','',onOff)], {help:'修改设备高级模式基础设施，按固件能力执行。'});
        const system = el('article', 'card settings-form'); system.append(el('h3', '', '系统操作'), hint('设备重启会暂时断开所有终端。'), button('重启设备', () => this.action('reboot', {}))); root.append(system);
        if (d.usb) { const info = el('article', 'card wide-card'); info.append(el('h3', '', 'USB 连接'), hint(`最高速率：${d.usb.maxSpeed || '—'}`), el('pre', 'device-details', typeof d.usb.details === 'string' ? d.usb.details : JSON.stringify(d.usb.details, null, 2))); root.append(info); } break;
      }
      case 'forward': {
        const current = d.method?.sms_forward_method || '未配置'; root.append(hint(`当前渠道：${current}。${d.separateTest ? '保存与测试发送是独立操作。' : '保存渠道配置时，设备会立即发送测试消息。'}`));
        if (d.separateTest) { root.append(button('发送测试消息', () => this.action('forward-test', {}))); form('Webhook 转发', 'forward-webhook', [field('url','HTTPS Webhook URL','',{type:'url'})]); }
        if (d.enabled) form('短信转发', 'forward-toggle', [toggle('enabled', '总开关', d.enabled.enabled)], { extra: { type: 'sms' } });
        if (d.power) form('电量转发', 'forward-toggle', [toggle('enabled', '开关', d.power.enabled)], { extra: { type: 'power' } });
        if (d.blacklist) form('转发黑名单', 'forward-blacklist', [field('phone', '号码（每行一个）', d.blacklist.phone || '', { type: 'textarea', optional: true }), field('keywords', '关键词（每行一个）', d.blacklist.keywords || '', { type: 'textarea', optional: true })]);
        form('SMTP 邮件转发', 'forward-smtp', [field('smtp_host', 'SMTP 服务器', d.smtp?.smtp_host || ''), field('smtp_port', '端口', String(d.smtp?.smtp_port || '465'), { type: 'number', min: 1, max: 65535 }), field('smtp_to', '收件邮箱', d.smtp?.smtp_to || '', { type: 'email' }), field('smtp_username', 'SMTP 用户名', d.smtp?.smtp_username || ''), field('smtp_password', 'SMTP 密码 / 授权码', '', { type: 'password', optional: true, hint: '留空沿用设备已保存的口令' }), field('smtp_from', '发件邮箱（可选）', '', { type: 'email', optional: true }), field('smtp_from_name', '发件人显示名称（可选）', '', { optional: true }), toggle('forward_dev_info', '附带设备信息', '0')], { submit: d.separateTest ? '保存配置' : '保存并发送测试邮件', help: '输入新的完整配置；已保存的服务密码不回显。' });
        form('钉钉机器人', 'forward-dingtalk', [field('webhook_url', 'Webhook URL', '', { type: 'url' }), field('secret', '加签密钥（可选）', '', { type: 'password', optional: true }), toggle('forward_dev_info', '附带设备信息', '0')], { submit: d.separateTest ? '保存配置' : '保存并发送测试消息' });
        if (!d.separateTest) form('自定义 curl 转发', 'forward-curl', [field('curl_text', 'curl 命令模板', '', { type: 'textarea', rows: 5 })], { submit: '保存并测试', help: '必须包含 {{sms-body}}、{{sms-time}}、{{sms-from}}。命令在设备端执行。' }); break;
      }
    }
  }
  apnEditor(profile, state) {
    this.modal('APN 配置').append(this.form('保存配置', 'apn-save', [field('index', '索引', profile.index, { type: 'number', min: 0, max: 19 }), field('name', '配置名称', profile.name || ''), field('apn', 'APN', profile.apn || ''), select('pdp', 'PDP 类型', profile.pdp || 'IPv4v6', [['IP', 'IPv4'], ['IPv6', 'IPv6'], ['IPv4v6', 'IPv4 / IPv6']]), select('auth', '认证方式', profile.auth || 'none', [['none', '无认证'], ['pap', 'PAP'], ['chap', 'CHAP']]), field('username', '用户名', profile.username || '', { optional: true }), field('password', '密码', '', { type: 'password', optional: true, hint: '空白会保存为空密码；编辑有认证的 APN 时需重新填写。' })], { after: async () => { $('feature-dialog').close(); await this.load(state, true); } }));
  }
  async plugins() {
    const body = this.modal('插件高级编辑'); const token = this.dialogToken, epoch = this.epoch;
    $('feature-dialog').classList.add('code-dialog'); body.append(hint('正在读取插件代码…'));
    try {
      const current = await window.ufi.featureRead('plugins-config');
      if (epoch !== this.epoch || token !== this.dialogToken) return;
      body.replaceChildren();
      body.append(this.form('设备插件代码', 'plugins-save', [field('text', 'HTML / JavaScript', current.text, { type: 'textarea', rows: 18, optional: true })], { extra: { revision: current.revision }, help: '此处编辑完整配置，包括未分组的历史内容；保存空白会清空全部插件。单个插件请使用列表中的管理操作。', submit: '保存到设备', after: () => $('feature-dialog').close() }));
    } catch (error) { if (epoch === this.epoch && token === this.dialogToken) body.replaceChildren(hint(error.message), button('重试', () => this.plugins())); }
  }
}

export { field, select, toggle, el, button, hint };
