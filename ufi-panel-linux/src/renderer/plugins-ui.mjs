import { el, button, hint, field } from './features.mjs';
import { bytes } from './format.mjs';
const $ = id => document.getElementById(id);
const fresh = () => ({ data: null, at: 0, job: null, error: '' });
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export class PluginsUI {
  constructor(featureUI, { connected, mode, toast, changed }) {
    this.ui = featureUI; this.connected = connected; this.mode = mode; this.toast = toast; this.changed = changed;
    this.epoch = 0; this.tab = 'installed'; this.active = false; this.working = false;
    this.states = { installed: fresh(), market: fresh() };
    this.menuState=null;this.menuJob=null;this.menuError='';
    for (const [tab, title] of [['installed', '已安装'], ['market', '插件市场']]) {
      const b = button(title, () => this.select(tab), 'subnav-button'); b.dataset.pluginTab = tab; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'plugins-content'); $('plugin-tabs').append(b);
    }
    $('plugin-search').addEventListener('input', () => this.render());
    $('plugin-sort').addEventListener('change', () => this.render());
    const resume = () => { if (this.active && !document.hidden && !$('feature-dialog').open && !this.working) { this.load('installed');this.ensureMenus(); } };
    window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    window.ufi.onPluginsChanged?.(() => { if (this.connected()) this.refreshInstalled(); });
    window.ufi.onPluginMenus?.(state=>{
      if(this.active && this.menuState?.instance===state?.instance && state.revision===this.states.installed.data?.revision) {
        this.menuState=state.closed?null:state;this.updateMenus();if(state.closed)this.ensureMenus();
      }
    });
    this.render();
  }
  get supported() { return !this.mode() || this.mode() === 'KANO'; }
  get busy() { return this.working || !!this.states[this.tab].job; }
  reset() {
    this.leave(); this.epoch++; this.working = false; this.tab = 'installed';
    this.states = { installed: fresh(), market: fresh() }; this.menuState=null;this.menuJob=null;this.menuError='';$('plugin-search').value = ''; this.render();
  }
  connectedDevice() { if (this.supported) this.load('installed', true); }
  open() {
    this.active = true; this.load(this.tab);
    this.ensureMenus();
    if (!this.timer) this.timer = setInterval(() => {
      if (!document.hidden && !$('feature-dialog').open && !this.working) this.load('installed');
    }, 15000);
  }
  leave() {
    this.active = false; clearInterval(this.timer); this.timer = null;
    this.menuState=null;
    window.ufi.releasePluginMenus?.().catch(()=>{});
  }
  select(tab) { this.tab = tab; $('plugin-search').value = ''; this.render(); if (this.connected()) this.load(tab); }
  async refresh() { await this.load(this.tab,true);if(this.tab==='installed')await this.ensureMenus(true); }
  refreshInstalled() { return this.load('installed', true); }
  load(tab, force = false) {
    if (!this.connected() || !this.supported) { this.render(); return Promise.resolve(); }
    const state = this.states[tab];
    if (state.job) return state.job;
    if (!force && state.at && Date.now() - state.at < 10000) return Promise.resolve();
    const epoch = this.epoch; state.error = '';
    state.job = (async () => {
      try {
        const data = tab === 'installed' ? await window.ufi.featureRead('plugins-installed') : await window.ufi.plugins();
        if (epoch !== this.epoch) return;
        if(tab==='installed' && state.data?.revision!==data.revision)this.menuState=null;
        state.data = data; state.at = Date.now();
        if(tab==='installed')this.ensureMenus();
      } catch (error) { if (epoch === this.epoch) state.error = error.message; }
      finally { if (epoch === this.epoch) { state.job = null; this.render(); this.changed(); } }
    })();
    this.render(); this.changed(); return state.job;
  }
  async ensureMenus(refresh = false) {
    const installed=this.states.installed.data;
    if(!this.active || !this.connected() || !this.supported || !installed || this.menuJob || !window.ufi.pluginMenus)return;
    if(!refresh && this.menuState?.revision===installed.revision)return;
    if(!installed.items.some(item=>item.enabled) && !installed.unmanagedBytes)return;
    const epoch=this.epoch,revision=installed.revision,job={};this.menuJob=job;this.menuError='';
    try {
      const state=await window.ufi.pluginMenus({revision,refresh});
      if(epoch===this.epoch && this.active && this.states.installed.data?.revision===revision) {this.menuState=state;this.updateMenus();}
    } catch(error) {if(epoch===this.epoch && this.active){this.menuError=error.message;this.updateMenus();}}
    finally {if(this.menuJob===job){this.menuJob=null;if(!this.active)window.ufi.releasePluginMenus?.().catch(()=>{});else if(this.states.installed.data?.revision!==revision)this.ensureMenus();}}
  }
  menuButtons(items) {
    const root=el('div','plugin-runtime-actions');
    this.patchMenuButtons(root,items);return root;
  }
  patchMenuButtons(root,items) {
    const existing=new Map([...root.children].map(node=>[node.dataset.pluginMenu,node]));
    for(const item of items) {
      let open=existing.get(item.token);
      if(!open) {
        open=button(item.label,()=>this.perform(()=>window.ufi.openPluginMenu({revision:this.menuState.revision,instance:this.menuState.instance,token:item.token})),'button secondary small');
        open.dataset.pluginMenu=item.token;open.title='打开并定位到插件原生操作';root.append(open);
      }
      open.textContent=item.label;open.disabled=item.disabled || this.working;existing.delete(item.token);
    }
    for(const node of existing.values())node.remove();
  }
  updateMenus() {
    if(this.tab!=='installed')return;
    this.renderNote();
    const query=$('plugin-search').value.trim().toLowerCase(),content=$('plugins-content');
    const items=this.states.installed.data?.items || [];
    const expected=items.filter(item=>`${item.name} ${(this.menuState?.items || []).filter(menu=>menu.pluginId===item.id).map(menu=>menu.label).join(' ')}`.toLowerCase().includes(query));
    const rows=[...content.querySelectorAll('.installed-plugin[data-plugin-id]')];
    if(rows.length!==expected.length || rows.some(row=>!expected.some(item=>item.id===row.dataset.pluginId))) {this.render();return;}
    for(const row of rows) {
      const menus=(this.menuState?.items || []).filter(menu=>menu.pluginId===row.dataset.pluginId);
      let actions=row.querySelector('.plugin-runtime-actions');
      if(!menus.length)actions?.remove();
      else {if(!actions){actions=el('div','plugin-runtime-actions');row.append(actions);}this.patchMenuButtons(actions,menus);}
    }
    const legacy=(this.menuState?.items || []).filter(menu=>menu.pluginId==='legacy' && (!query || menu.label.toLowerCase().includes(query)));
    let section=content.querySelector('[data-legacy-plugin-menus]');
    if(!legacy.length)section?.remove();
    else {
      if(!section){section=el('article','installed-plugin');section.dataset.legacyPluginMenus='true';section.append(el('h3','','其他插件菜单'),this.menuButtons([]));content.append(section);}
      this.patchMenuButtons(section.querySelector('.plugin-runtime-actions'),legacy);
    }
  }
  renderNote() {
    const installed=this.states.installed.data;
    $('plugin-note').textContent = this.supported ? (this.tab === 'installed' ? [...(installed?.warnings || []), '配置页面自动展示插件生成的控件、表单和内嵌面板；也可用下方菜单定位具体操作。',this.menuError ? '菜单读取失败：'+this.menuError : this.menuState?.ready ? '' : this.active && installed?.items.some(item=>item.enabled) ? '正在发现插件菜单…' : '', '启用状态指插件界面；服务运行状态可在插件设置中查看。'].filter(Boolean).join(' ') : '选择插件可查看源码并安装。市场不可用时，仍可管理已安装列表。') : '此设备模式不支持 UFI-TOOLS 插件，请使用 KANO 连接。';
  }
  async perform(operation) {
    if (this.working) return;
    const epoch = this.epoch; this.working = true; this.render(); this.changed();
    try { await operation(); }
    catch (error) { if (epoch === this.epoch) { this.toast(error.message); this.refreshInstalled(); } }
    finally { if (epoch === this.epoch) { this.working = false; this.render(); this.changed(); } }
  }
  render() {
    const installed = this.states.installed.data, state = this.states[this.tab];
    for (const b of $('plugin-tabs').children) {
      b.classList.toggle('active', b.dataset.pluginTab === this.tab); b.setAttribute('aria-selected', String(b.dataset.pluginTab === this.tab));
      b.textContent = b.dataset.pluginTab === 'installed' ? `已安装${installed ? ` (${installed.items.length})` : ''}` : '插件市场';
    }
    const content = $('plugins-content'), status = $('plugins-status'); content.replaceChildren(); status.replaceChildren();
    content.setAttribute('aria-busy', String(!!state.job)); status.classList.toggle('hidden', !state.job && !state.error);
    if (state.job) status.append(hint(state.at ? '正在更新插件列表…' : '正在读取插件列表…'));
    else if (state.error) status.append(hint(state.error + (state.data ? '；保留上次读取的列表。' : '')), button('重试', () => this.load(this.tab, true)));
    $('plugin-market-heading').classList.toggle('hidden', this.tab !== 'market');
    this.renderNote();
    $('manage-plugins').disabled = !this.connected() || !this.supported || this.working;
    $('plugin-sort').querySelector('[value="modified"]').disabled = this.tab !== 'market';
    if (this.tab !== 'market' && $('plugin-sort').value === 'modified') $('plugin-sort').value = 'name';
    const items = (state.data?.items || []).filter(i => i && !i.is_dir), query = $('plugin-search').value.trim().toLowerCase(), sort = $('plugin-sort').value;
    const filtered = items.filter(i => `${i.name} ${(this.menuState?.items || []).filter(menu=>menu.pluginId===i.id).map(menu=>menu.label).join(' ')}`.toLowerCase().includes(query));
    filtered.sort((a, b) => sort === 'size' ? (b.size || 0) - (a.size || 0) : sort === 'modified' ? (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0) : collator.compare(a.name, b.name));
    $('plugin-count').textContent = `${filtered.length} / ${items.length} 个插件`;
    const legacy=this.tab==='installed' ? (this.menuState?.items || []).filter(menu=>menu.pluginId==='legacy' && (!query || menu.label.toLowerCase().includes(query))) : [];
    if (!filtered.length && !legacy.length) {
      const message = !this.connected() ? '连接设备后读取插件。' : !this.supported ? '此设备模式不支持插件。' : items.length ? '没有匹配的插件。' : state.data ? this.tab === 'market' ? '插件市场暂时没有项目。' : installed?.unmanagedBytes ? '未识别到完整的插件项目，可通过高级编辑查看历史自定义内容。' : '尚未安装插件，可前往插件市场添加。' : state.error ? '插件列表读取失败，可重试。' : '正在读取插件…';
      content.append(el('p', 'empty', message)); return;
    }
    for (const item of filtered) {
      if (this.tab === 'market') {
        const row = el('article', 'plugin-card'), heading = el('h3'); heading.append(button(item.name.replace(/\.(js|txt)$/i, ''), () => this.install(item.name), 'plugin-link'));
        const date = new Date(item.modified); row.append(heading, el('span', '', Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN')), el('span', '', bytes(item.size))); content.append(row); continue;
      }
      const row = el('article', 'installed-plugin'); row.dataset.pluginId = item.id;
      const info = el('div', 'installed-plugin-info'), name = el('h3'); name.append(button(item.name.replace(/\.(js|txt)$/i, ''), () => this.details(item), 'plugin-link'));
      info.append(name, el('span', `plugin-state ${item.enabled ? 'enabled' : ''}`, item.enabled ? '已启用' : '已禁用'), el('span', 'muted', bytes(item.size)));
      const actions = el('div', 'inline-actions');
      const settings = button(item.settings ? '设置面板' : '配置页面', () => this.openSettings(item)); settings.dataset.pluginSettings = item.id; settings.disabled = !item.enabled || this.working; actions.append(settings);
      const manage = button('管理', () => this.details(item)); manage.disabled = this.working; manage.dataset.pluginManage = item.id; actions.append(manage); row.append(info, actions);
      const menus=(this.menuState?.items || []).filter(menu=>menu.pluginId===item.id);
      if(item.enabled && menus.length)row.append(this.menuButtons(menus));
      content.append(row);
    }
    if(this.tab==='installed') {
      if(legacy.length) {const section=el('article','installed-plugin');section.dataset.legacyPluginMenus='true';section.append(el('h3','','其他插件菜单'),this.menuButtons(legacy));content.append(section);}
    }
  }
  openSettings(item, target = 'settings') {
    const revision = this.states.installed.data?.revision;
    return this.perform(() => window.ufi.openPluginSettings({ id: item.id, revision, target }));
  }
  async details(item) {
    const epoch = this.epoch, revision = this.states.installed.data?.revision, body = this.ui.modal(`插件 · ${item.name}`), token = this.ui.dialogToken;
    $('feature-dialog').classList.add('code-dialog'); body.append(hint('正在读取插件…'));
    try {
      const source = await window.ufi.featureRead('installed-plugin-source', { id: item.id, revision });
      if (epoch !== this.epoch || token !== this.ui.dialogToken) return;
      body.replaceChildren(hint(`${item.enabled ? '已启用' : '已禁用'}。禁用或删除插件界面不会停止设备上的服务；服务启停请使用插件设置。`));
      const actions = el('div', 'dialog-actions');
      const native = button('原生页面', () => this.openSettings(item, 'native')); native.disabled = !item.enabled || this.working; actions.append(native);
      const toggle = button(item.enabled ? '禁用插件' : '启用插件', () => this.perform(async () => {
        if (await this.ui.write('plugin-toggle', { id: item.id, revision, enabled: !item.enabled })) { $('feature-dialog').close(); await this.refreshInstalled(); }
      })); toggle.dataset.pluginToggle = item.id;
      const remove = button('删除插件', () => this.perform(async () => {
        if (await this.ui.write('plugin-delete', { id: item.id, revision })) { $('feature-dialog').close(); await this.refreshInstalled(); }
      })); remove.dataset.pluginDelete = item.id; actions.append(toggle, remove); body.append(actions);
      body.append(this.ui.form('插件源码', 'plugin-edit', [field('text', 'HTML / JavaScript', source.text, { type: 'textarea', rows: 18, optional: true })], { extra: { id: item.id, revision }, submit: '保存此插件', help: '保存只替换当前插件内容，其他插件保持原样。', after: async () => { $('feature-dialog').close(); await this.refreshInstalled(); } }));
    } catch (error) { if (epoch === this.epoch && token === this.ui.dialogToken) body.replaceChildren(hint(error.message), button('刷新列表', async () => { $('feature-dialog').close(); await this.refreshInstalled(); })); }
  }
  async install(name) {
    const epoch = this.epoch, body = this.ui.modal(`安装插件 · ${name}`), token = this.ui.dialogToken;
    $('feature-dialog').classList.add('code-dialog'); body.append(hint('正在读取插件源码…'));
    try {
      const installed = await window.ufi.featureRead('plugins-installed');
      const source = await window.ufi.featureRead('plugin-source', { name });
      if (epoch !== this.epoch || token !== this.ui.dialogToken) return;
      this.states.installed.data = installed; this.states.installed.at = Date.now(); this.render();
      body.replaceChildren(hint('以下源码会保存到设备，并在设备网页中执行。请确认插件来源与内容。'));
      const preview = el('textarea', 'plugin-code'); preview.rows = 18; preview.readOnly = true; preview.value = source.text; preview.setAttribute('aria-label', '插件源码'); body.append(preview);
      const matches = installed.items.filter(item => item.name === name); let target;
      if (matches.length) {
        body.append(hint('此插件已安装，将更新所选项目，并保留其启用状态。'));
        target = el('select'); target.setAttribute('aria-label', '更新目标');
        matches.forEach((item, index) => { const option = el('option', '', `${index + 1}. ${item.name} · ${item.enabled ? '已启用' : '已禁用'}`); option.value = item.id; target.append(option); }); body.append(target);
      }
      const install = button(matches.length ? '更新所选插件' : '安装到设备', () => this.perform(async () => {
        install.disabled = true;
        try { if (await this.ui.write('plugin-install', { name, text: source.text, revision: installed.revision, ...(target ? { replaceId: target.value } : {}) })) { $('feature-dialog').close(); this.tab = 'installed'; await this.refreshInstalled(); } }
        finally { if (install.isConnected) install.disabled = false; }
      }), 'button primary'); install.dataset.pluginInstall = 'true'; body.append(install);
    } catch (error) { if (epoch === this.epoch && token === this.ui.dialogToken) body.replaceChildren(hint(error.message), button('重试', () => this.install(name))); }
  }
}
