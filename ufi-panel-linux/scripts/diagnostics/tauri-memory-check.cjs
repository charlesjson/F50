'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { startFixture } = require('../fixture-server.cjs');
const { launch } = require('../tauri-webdriver.cjs');
const mode = process.argv[2] || 'fixture', duration = Number(process.env.UFI_MEMORY_SECONDS || 45);
if (!['fixture', 'overview'].includes(mode)) throw new Error('Use fixture or overview; real device measurements use probe-device-memory.py --address');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function processes() {
  const results = [];
  for (const id of fs.readdirSync('/proc').filter(id => /^\d+$/.test(id))) {
    try {
      const status = fs.readFileSync(`/proc/${id}/status`, 'utf8');
      const name = status.match(/^Name:\s+(.+)$/m)?.[1];
      if (!['ufi-panel-linux', 'WebKitWebProces', 'WebKitNetworkPr', 'node'].includes(name)) continue;
      const value = key => Number(status.match(new RegExp('^' + key + ':\\s+(\\d+)', 'm'))?.[1] || 0);
      results.push({ pid: Number(id), name, rssKiB: value('VmRSS'), swapKiB: value('VmSwap') });
    } catch {}
  }
  return results;
}
(async () => {
  const fixture = await startFixture(), samples = []; let ui;
  fixture.state.pluginText = '<!-- [KANO_PLUGIN_START] arbitrary-tools.html -->\n<script type="application/json" data-ufi-plugin-manifest>{"version":1,"settings":{"url":"./ui/#/tasks"}}</script>\n<!-- [KANO_PLUGIN_END] arbitrary-tools.html -->';
  const started = Date.now(); let failure;
  try {
    ui = await launch(); await ui.wait('document.readyState==="complete"&&!!window.ufi');
    await ui.click('#welcome-connect'); await ui.fill('#address', fixture.address); await ui.fill('#password', 'fixture-password'); await ui.click('#submit-connection');
    await ui.wait('document.getElementById("temperature").textContent!=="—"');
    if (mode !== 'overview') {
      const installed = await ui.api('featureRead', 'plugins-installed');
      await ui.api('openPluginSettings', { id: installed.items[0].id, revision: installed.revision });
    }
    let baseline;
    for (let second = 0; second < duration; second++) {
      const list = processes(), totalKiB = list.reduce((sum, p) => sum + p.rssKiB + p.swapKiB, 0);
      if (second === 3) baseline = totalKiB;
      const sample = { second, totalKiB, processes: list }; samples.push(sample);
      if (second % 5 === 0) console.log(JSON.stringify(sample));
      if (baseline && totalKiB - baseline > 256 * 1024) {
        failure = 'Memory grew by more than 256 MiB in the bounded observation';
        for (const p of list.filter(p => p.name === 'ufi-panel-linux')) { try { process.kill(p.pid, 'SIGTERM'); } catch {} }
        break;
      }
      await delay(1000);
    }
    const result = { result: failure ? 'failed' : 'passed', mode, durationMs: Date.now() - started, failure, samples };
    fs.writeFileSync(path.join(__dirname, `../../artifacts/memory-${mode}.json`), JSON.stringify(result, null, 2));
    if (failure) throw new Error(failure);
  } finally { await ui?.close(); fixture.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
