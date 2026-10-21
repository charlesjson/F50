'use strict';
const { hashPassword, normalizeAddress } = require('./protocol.cjs');
const { describePlugin } = require('./plugin-description.cjs');

const LIMIT = 5 * 1024 * 1024;
const ACTIONS = new Set(['plugin-install', 'plugin-edit', 'plugin-toggle', 'plugin-delete']);
const disabledWrapper = /^\s*<!--\s*\[kano_disabled\]\r?\n([\s\S]*)\r?\n\[kano_disabled\]\s*-->\s*$/;
const conflict = () => new Error('设备上的插件已被其他页面修改，请刷新插件列表后重试');
function checkedText(text) {
  if (typeof text !== 'string' || text.includes('\0')) throw new Error('插件文本格式不正确');
  if (Buffer.byteLength(JSON.stringify({ text })) > LIMIT) throw new Error('插件文本超过设备 5 MB 限制');
  return text;
}
function checkedName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 256 || /[<>\x00-\x1f\x7f]|--/.test(name)) throw new Error('插件名称格式不正确');
  return name.trim();
}
function description(block, address) {
  const source = block.enabled ? block.content : block.content.match(disabledWrapper)[1];
  return describePlugin(source, normalizeAddress(address) + '/');
}

// Only complete, unambiguous pairs are editable. Everything else remains in
// the original document, including legacy code outside the marked blocks.
function parseDocument(text) {
  checkedText(text);
  const markers = /<!--\s*\[KANO_PLUGIN_(START|END)\][ \t]*([^\r\n]*?)\s*-->/g;
  const stack = [], blocks = [], warnings = [], occurrences = new Map();
  let malformed = false;
  for (const match of text.matchAll(markers)) {
    const token = { name: match[2].trim(), start: match.index, end: match.index + match[0].length };
    if (match[1] === 'START') {
      if (stack.length) { stack[0].invalid = true; malformed = true; }
      stack.push(token); continue;
    }
    const start = stack.pop();
    if (!start) { malformed = true; continue; }
    if (stack.length) { stack[0].invalid = true; continue; }
    if (start.invalid || start.name !== token.name) { malformed = true; continue; }
    try { checkedName(start.name); } catch { malformed = true; continue; }
    const occurrence = occurrences.get(start.name) || 0;
    occurrences.set(start.name, occurrence + 1);
    const content = text.slice(start.end, token.start);
    blocks.push({ id: 'plugin-' + hashPassword(start.name + '\0' + occurrence).slice(0, 24), name: start.name, start: start.start, end: token.end, bodyStart: start.end, bodyEnd: token.start, content, enabled: !disabledWrapper.test(content) });
  }
  if (stack.length) malformed = true;
  if (malformed) warnings.push('部分插件标记不完整或存在嵌套，相关内容已保留，可在高级编辑中处理。');
  if ([...occurrences.values()].some(n => n > 1)) warnings.push('存在同名插件，更新时请选择具体项目。');
  let remainder = '', offset = 0;
  for (const block of blocks) { remainder += text.slice(offset, block.start); offset = block.end; }
  remainder += text.slice(offset);
  const unmanagedBytes = remainder.trim() ? Buffer.byteLength(remainder) : 0;
  if (unmanagedBytes) warnings.push('设备还有未分组的自定义内容，已原样保留，可在高级编辑中查看。');
  return { text, revision: hashPassword(text), blocks, warnings, unmanagedBytes };
}
function summary(document, address) {
  const warnings = [...document.warnings];
  const items = document.blocks.map(block => {
    const entry = description(block, address);
    warnings.push(...entry.warnings.map(message => `${block.name}：${message}`));
    return { id: block.id, name: block.name, enabled: block.enabled, size: Buffer.byteLength(block.content), settings: entry.settings };
  });
  return { revision: document.revision, warnings, unmanagedBytes: document.unmanagedBytes, items };
}
function runtimePlugins(document, address) {
  return document.blocks.filter(block => block.enabled).map(block => {
    const { scripts, sources } = description(block, address);
    return { id: block.id, name: block.name, scripts, sources };
  });
}

class Plugins {
  constructor(client) { this.client = client; this.document = null; this.busy = false; }
  requireKano() { if (this.client.mode && this.client.mode !== 'KANO') throw new Error('插件设置需要 KANO / UFI-TOOLS 连接'); }
  async read() {
    this.requireKano();
    const result = await this.client.api('/api/get_custom_head');
    if (typeof result.text !== 'string') throw new Error('设备没有返回有效的插件配置');
    return this.document = parseDocument(result.text);
  }
  async installed() { return summary(await this.read(), this.client.transport.address); }
  async runtime(input = {}) {
    const document = await this.read();
    if (document.revision !== input.revision) throw conflict();
    return { address: normalizeAddress(this.client.transport.address)+'/', revision: document.revision,
      plugins: runtimePlugins(document, this.client.transport.address),
      unmanaged: document.unmanagedBytes > 0 };
  }
  current(revision) {
    if (!this.document || this.document.revision !== revision) throw conflict();
    return this.document;
  }
  block(document, id) {
    const block = document.blocks.find(item => item.id === id);
    if (!block) throw new Error('插件已不存在，请刷新列表');
    return block;
  }
  async source(input) {
    const document = await this.read();
    if (document.revision !== input.revision) throw conflict();
    const block = this.block(document, input.id);
    return { id: block.id, name: block.name, text: block.content, enabled: block.enabled, revision: document.revision };
  }
  async save(text, revision) {
    checkedText(text); this.requireKano();
    if (this.busy) throw new Error('上一项插件操作仍在执行');
    this.busy = true;
    try {
      if ((await this.read()).revision !== revision) throw conflict();
      const result = await this.client.api('/api/set_custom_head', { method: 'POST', body: { text } });
      if (result?.result !== 'success') throw new Error('设备未确认插件配置已保存，请重新读取确认');
      this.document = null;
      return result;
    } finally { this.busy = false; }
  }
  prepare(action, input = {}) {
    this.requireKano();
    const document = this.current(input.revision);
    let next, title, name;
    if (action === 'plugin-install') {
      name = checkedName(input.name);
      const source = checkedText(input.text);
      if (!source.trim()) throw new Error('插件内容为空');
      // A source may contain arbitrary HTML, but cannot escape its own wrapper.
      if (/<!--\s*\[KANO_PLUGIN_(?:START|END)\]/.test(source)) throw new Error('插件源码包含管理标记，请在高级编辑中处理');
      const matches = document.blocks.filter(block => block.name === name);
      if (input.replaceId) {
        const block = this.block(document, input.replaceId);
        if (block.name !== name) throw new Error('更新目标与插件名称不一致');
        const content = block.enabled ? '\n' + source + '\n' : '<!-- [kano_disabled]\n' + '\n' + source + '\n' + '\n[kano_disabled] -->';
        next = document.text.slice(0, block.bodyStart) + content + document.text.slice(block.bodyEnd);
        title = '更新设备插件';
      } else {
        if (matches.length) throw new Error('同名插件已安装，请选择更新目标');
        next = document.text + '\n<!-- [KANO_PLUGIN_START] ' + name + ' -->\n' + source + '\n<!-- [KANO_PLUGIN_END] ' + name + ' -->\n';
        title = '安装设备插件';
      }
    } else {
      const block = this.block(document, input.id); name = block.name;
      if (action === 'plugin-delete') {
        next = document.text.slice(0, block.start) + document.text.slice(block.end); title = '删除设备插件';
      } else {
        let content;
        if (action === 'plugin-toggle') {
          if (typeof input.enabled !== 'boolean') throw new Error('无效插件开关');
          if (input.enabled === block.enabled) throw new Error('插件已经处于目标状态，请刷新列表');
          content = input.enabled ? block.content.match(disabledWrapper)[1] : '<!-- [kano_disabled]\n' + block.content + '\n[kano_disabled] -->';
          title = input.enabled ? '启用设备插件' : '禁用设备插件';
        } else if (action === 'plugin-edit') {
          content = checkedText(input.text);
          if (/<!--\s*\[KANO_PLUGIN_(?:START|END)\]/.test(content)) throw new Error('插件源码包含管理标记，请在高级编辑中处理');
          if (disabledWrapper.test(content) !== !block.enabled) throw new Error('请保留禁用包装，或使用启用／禁用操作切换状态');
          title = '保存插件源码';
        } else throw new Error('未知插件操作');
        next = document.text.slice(0, block.bodyStart) + content + document.text.slice(block.bodyEnd);
      }
    }
    checkedText(next);
    return { title, detail: `${name}\n只修改此插件的网页代码。禁用或删除前端插件不会停止设备上已安装的服务。`, pluginsChanged: true, run: () => this.save(next, document.revision) };
  }
  async settings(input = {}) {
    const document = await this.read();
    if (document.revision !== input.revision) throw conflict();
    const block = this.block(document, input.id);
    if (!block.enabled) throw new Error('请先启用此插件，再打开设置');
    if (input.target && !['settings', 'native'].includes(input.target)) throw new Error('未知插件设置入口');
    const panel = normalizeAddress(this.client.transport.address) + '/';
    const entry = description(block, panel);
    const address = input.target === 'native' ? panel : entry.settings?.address || panel;
    const view = input.target !== 'native' && !entry.settings ? {
      selected: block.id, plugins: runtimePlugins(document, panel), unmanaged: document.unmanagedBytes > 0,
    } : null;
    return { address, panel, title: `${block.name.replace(/\.(js|txt)$/i, '')} · 插件设置`, revision: document.revision, view };
  }
}
module.exports = { Plugins, ACTIONS, parseDocument, checkedText };
