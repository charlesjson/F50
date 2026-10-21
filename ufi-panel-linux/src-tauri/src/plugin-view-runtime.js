// Runs inside the device page, with the ownership tracker. Keep the actual DOM
// in place: cloning or moving it breaks listeners, selectors and iframe state.
({ config, owners, ownerForElement, ownerForStack }) => {
  let selected = config.selected || null, full = false, header, status, toggle;
  let previous = new Map(), expanded = new WeakSet(), failure = '';
  const attribute = 'data-ufi-plugin-view';
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const set = (node, value) => {
    if (node.getAttribute(attribute) !== value) node.setAttribute(attribute, value);
  };
  const create = () => {
    if (header || !document.body) return;
    header = document.createElement('header'); header.id = 'ufi-plugin-view-header';
    const title = document.createElement('strong'); title.id = 'ufi-plugin-view-title';
    const actions = document.createElement('div');
    const refresh = document.createElement('button'); refresh.textContent = '刷新配置页面';
    refresh.onclick = () => location.reload();
    toggle = document.createElement('button');
    toggle.onclick = () => { full = !full; update(); };
    status = document.createElement('p'); status.setAttribute('role', 'status');
    actions.append(refresh, toggle); header.append(title, actions, status);
    document.body.prepend(header);
  };
  const update = () => {
    if (!selected || !document.body) return;
    create();
    document.documentElement.dataset.ufiPluginSelected = selected;
    document.documentElement.dataset.ufiPluginFull = String(full);
    const plugin = config.plugins.find(plugin => plugin.id === selected);
    text(header.querySelector('strong'), plugin?.name.replace(/\.(js|txt|html)$/i, '') || '其他插件配置');
    text(toggle, full ? '返回插件配置' : '显示完整设备页面');
    // Track only the branches needed to retain the plugin's original layout.
    // Hosts shared by several plugins stay in place, with unrelated siblings hidden.
    const next = new Map([[header, 'root']]);
    for (const node of document.body.querySelectorAll('*')) {
      if (node === header || header.contains(node) || ['SCRIPT', 'STYLE', 'LINK', 'META'].includes(node.tagName)) continue;
      if (owners.get(node) !== selected || ownerForElement(node.parentElement) === selected) continue;
      next.set(node, 'root');
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (!next.has(parent)) next.set(parent, 'path');
      }
    }
    // Toast/dialog helpers can run after an awaited request without an owned
    // callback. Their standard UFI overlay hosts must remain interactive too.
    for (const overlay of document.querySelectorAll('dialog[open],[role=dialog],.kano_fixed_toast,.toastkano,#toastContainer')) {
      if (ownerForElement(overlay) && ownerForElement(overlay) !== selected) continue;
      next.set(overlay, 'root');
      for (let parent = overlay.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (!next.has(parent)) next.set(parent, 'path');
      }
    }
    for (const [node] of previous) if (!next.has(node)) node.removeAttribute(attribute);
    for (const [node, value] of next) set(node, value);
    previous = next;
    for (const [node, kind] of next) {
      for (const section of kind === 'root' ? [node, ...node.querySelectorAll('.collapse[data-name]')] : [node]) {
        if (!section.matches('.collapse[data-name]') || expanded.has(section)) continue;
        expanded.add(section); section.dataset.name = 'open';
      }
    }
    const roots = [...next].filter(([node, kind]) => kind === 'root' && node !== header && owners.get(node) === selected);
    text(status, failure || (roots.length ? '' : '正在等待插件生成配置界面；如需登录，可显示完整设备页面。'));
    if (status.hidden !== !status.textContent) status.hidden = !status.textContent;
    document.documentElement.dataset.ufiPluginViewReady = 'true';
  };
  addEventListener('error', event => {
    // WebKit can report an inline script's document URL even when it has a
    // sourceURL. During synchronous dispatch currentScript still identifies it.
    if (!selected || (owners.get(document.currentScript) !== selected && ownerForStack(event.error?.stack || '') !== selected)) return;
    failure = '插件界面加载失败：' + event.message; update();
  });
  addEventListener('unhandledrejection', event => {
    if (!selected || ownerForStack(event.reason?.stack || '') !== selected) return;
    failure = '插件界面加载失败：' + (event.reason?.message || String(event.reason)); update();
  });
  return {
    update,
    select(id) { selected = id; full = false; update(); },
  };
}
