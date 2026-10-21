'use strict';
// Remote device views intentionally use a separate, non-automated WebKit
// context. This fixture reports its own DOM state without adding test IPC to
// the app or sharing the local view's browser context.
function deviceFixture() {
  const id = crypto.randomUUID(); let busy = false, downloadClicks = 0;
  const download = document.querySelector('#fixture-download');
  download.href = URL.createObjectURL(new Blob(['fixture plugin backup'], { type: 'text/plain' })); download.download = 'fixture-config.txt';
  setTimeout(() => { const control = document.querySelector('.REFRESH_BTN'); control.onclick = () => { control.textContent = control.textContent === '停止刷新' ? '开始刷新' : '停止刷新'; }; }, 600);
  document.querySelector('#fixture-file').onchange = async event => {
    const file = event.target.files[0];
    await fetch('/fixture-upload?name=' + encodeURIComponent(file.name), { method: 'POST', body: file });
  };
  (async () => {
    let blocked = true;
    if (window.__TAURI__) { try { await window.__TAURI__.core.invoke('dispatch', { action: 'profiles', input: null }); blocked = false; } catch {} }
    await fetch('/isolation-result?blocked=' + blocked + '&bridge=' + typeof window.ufi);
  })();
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
      await fetch('/fixture-page-report', { method: 'POST', body: JSON.stringify({ id, pathname: location.pathname, route: location.hash, storage: Object.keys(localStorage), refresh: document.querySelector('.REFRESH_BTN').textContent, popup: rect('#fixture-popup'), upload: rect('#fixture-file'), backup: rect('#fixture-download'), downloadClicks, backdrop: getComputedStyle(document.querySelector('#fixture-backdrop')).backdropFilter, privacyBlur: getComputedStyle(document.querySelector('#fixture-private')).filter }) });
      const command = await (await fetch('/fixture-command?id=' + id)).json();
      if (command.type === 'download') { downloadClicks++;document.querySelector('#fixture-download').click(); }
    } finally { busy = false; }
  };
  setInterval(() => tick().catch(() => {}), 150); tick().catch(() => {});
}
module.exports = `<!doctype html><html><head><meta charset="utf-8"><title>Device fixture</title></head><body><h1>Device fixture</h1>
<button class="REFRESH_BTN">停止刷新</button>
<section><button>任意插件操作</button></section>
<div id="fixture-backdrop" style="backdrop-filter:blur(4px)!important;-webkit-backdrop-filter:blur(4px)!important">背景滤镜测试</div><span id="fixture-private" style="filter:blur(4px)">隐私字段</span>
<a id="fixture-popup" href="/dashboard/" target="_blank">打开面板</a>
<input type="file" id="fixture-file"><a id="fixture-download" href="/fixture-download.txt" download>备份配置</a>
<script>(${deviceFixture.toString()})();</script></body></html>`;
