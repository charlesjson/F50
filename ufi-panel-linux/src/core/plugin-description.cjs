'use strict';

// The only optional desktop contract lives in inert JSON. Executable plugin
// source is used for runtime attribution, never for guessing settings or secrets.
function fingerprint(text) {
  // Display attribution only; device context and document revision identify a session.
  let hash = 2166136261;
  const source = text.replace(/\r\n?/g, '\n').trim();
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function describePlugin(source, deviceAddress) {
  const scripts = [], sources = [], declarations = [];
  // Skip HTML comments without stripping comment-shaped strings inside scripts.
  const elements = /<!--[\s\S]*?-->|<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of source.matchAll(elements)) {
    if (match[1] === undefined) continue;
    const attributes = new Map();
    for (const attribute of match[1].matchAll(/(?:^|\s)([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const name = attribute[1].toLowerCase();
      if (!attributes.has(name)) attributes.set(name, attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    }
    if (attributes.has('data-ufi-plugin-manifest')) {
      declarations.push({ type: attributes.get('type'), text: match[2] });
      continue;
    }
    const type = attributes.get('type')?.toLowerCase().trim();
    if (type && !['module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type)) continue;
    if (attributes.get('src')) sources.push(attributes.get('src'));
    else if (match[2].trim()) scripts.push(fingerprint(match[2]));
  }
  let settings = null;
  const warnings = [];
  if (declarations.length) {
    try {
      if (declarations.length !== 1) throw new Error('只能声明一个插件清单');
      const declaration = declarations[0];
      if (declaration.type?.trim().toLowerCase() !== 'application/json' || Buffer.byteLength(declaration.text) > 16384) throw new Error('插件清单需要使用不超过 16 KB 的 application/json');
      let manifest;
      try { manifest = JSON.parse(declaration.text); } catch { throw new Error('插件清单不是有效 JSON'); }
      if (!manifest || manifest.version !== 1) throw new Error('不支持的插件清单版本');
      if (manifest.settings !== undefined) {
        const entry = manifest.settings;
        if (!entry || typeof entry.url !== 'string' || !entry.url.trim() || entry.url.length > 2048 || /[\x00-\x20\x7f\\]/.test(entry.url)) throw new Error('无效的插件设置地址');
        const device = new URL(deviceAddress), address = new URL(entry.url, device);
        if (entry.port !== undefined) {
          if (!Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65535) throw new Error('无效的插件设置端口');
          address.port = String(entry.port);
        }
        if (address.protocol !== device.protocol || address.hostname !== device.hostname || address.username || address.password) throw new Error('插件设置地址必须指向当前设备的 HTTP/HTTPS 页面');
        if (!['http:', 'https:'].includes(address.protocol)) throw new Error('插件设置地址仅支持 HTTP/HTTPS');
        settings = { address: address.href };
      }
    } catch (error) {
      warnings.push(`插件清单未生效：${error.message}；仍可使用原生页面和自动发现的菜单。`);
    }
  }
  return { scripts, sources, settings, warnings };
}

module.exports = { describePlugin };
