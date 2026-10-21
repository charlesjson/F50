'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  if (!process.env.UFI_CONNECTION_FILE) throw new Error('需要 UFI_CONNECTION_FILE（只读真机测试）');
  const input = JSON.parse(fs.readFileSync(process.env.UFI_CONNECTION_FILE, 'utf8'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ufi-live-'));
  const env = { ...process.env, UFI_TEST_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const args = process.env.UFI_EXECUTABLE ? [] : [path.join(__dirname, '..')];
  const instance = await electron.launch({ args, env, ...(process.env.UFI_EXECUTABLE ? { executablePath: process.env.UFI_EXECUTABLE } : {}) });
  const errors = [];
  try {
    const page = await instance.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.click('#welcome-connect'); await page.fill('#address', input.address); await page.fill('#password', input.password || ''); await page.fill('#zte-password', input.ztePassword || '');
    await page.uncheck('#remember'); await page.click('#submit-connection');
    const deadline = Date.now() + 45000;
    while ((await page.evaluate(() => window.ufi.telemetryState())).history.length < 10) {
      if (Date.now() > deadline) throw new Error('实时采样不足 10 次');
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const before = await page.evaluate(() => window.ufi.telemetryState());
    assert.equal(before.interval, 2000); assert.ok(before.history.every(p => !p.error));
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    await new Promise(resolve => setTimeout(resolve, 6200));
    const after = await page.evaluate(() => window.ufi.telemetryState());
    assert.ok(after.history.length >= before.history.length + 2, 'hidden dashboard continues acquiring device data');
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await page.waitForFunction(() => document.getElementById('cpu-chart').getAttribute('aria-label').includes('有效读数'));
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1240, 1000));
    await page.evaluate(() => { document.querySelector('.content').scrollTop = 0; });
    await page.screenshot({ path: path.join(__dirname, '../artifacts/telemetry-live.png'), fullPage: true });
    const points = after.history.map(p => ({ at: p.at, cpu: p.snapshot?.base.cpu_usage, memory: p.snapshot?.base.mem_usage, temperature: p.snapshot?.base.cpu_temp, down: p.snapshot?.network.realtime_rx_thrpt, up: p.snapshot?.network.realtime_tx_thrpt }));
    for (const field of ['cpu', 'memory', 'temperature', 'down', 'up']) assert.ok(points.every(p => p[field] != null && p[field] !== '' && Number.isFinite(Number(p[field]))), field + ' real readings');
    assert.deepEqual(errors, []);
    const report = { result: 'passed', realDevice: true, interval: after.interval, samples: points.length, durationMs: points.at(-1).at - points[0].at, backgroundSamples: after.history.length - before.history.length, points, pageErrors: errors };
    fs.writeFileSync(path.join(__dirname, '../artifacts/telemetry-live-validation.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, points: undefined }));
  } finally { await instance.close(); fs.rmSync(userData, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
