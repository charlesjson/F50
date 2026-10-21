'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { navigate, confirmOperation } = require('./ui-helpers.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ufi-ui-'));
  const output = path.join(__dirname, '../artifacts'); fs.mkdirSync(output, { recursive: true });
  const env = { ...process.env, UFI_TEST_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const args = process.env.UFI_EXECUTABLE ? [] : [path.join(__dirname, '..')];
  // CI can explicitly opt into --no-sandbox only if its environment lacks a sandbox.
  if (process.env.UFI_TEST_NO_SANDBOX === '1') args.unshift('--no-sandbox');
  const instance = await electron.launch({ args, env, ...(process.env.UFI_EXECUTABLE ? { executablePath: process.env.UFI_EXECUTABLE } : {}), timeout: 30000 });
  const errors = [];
  try {
    const page = await instance.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#page-title');
    assert.equal(await page.title(), 'UFI Panel Linux');
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    await navigate(page, 'signal'); assert.ok((await page.locator('#page-title').textContent()).includes('信号监测'));
    await navigate(page, 'overview'); await page.click('#connect-button');
    await page.waitForSelector('#connection-dialog[open]');
    if (process.env.UFI_CONNECTION_FILE) {
      const input = JSON.parse(fs.readFileSync(process.env.UFI_CONNECTION_FILE, 'utf8'));
      await page.fill('#address', input.address); await page.fill('#password', input.password || ''); await page.fill('#zte-password', input.ztePassword || '');
      await page.uncheck('#remember'); await page.click('#submit-connection');
      await page.waitForFunction(() => document.getElementById('connection-state').textContent.includes('已连接'), { timeout: 20000 });
      await page.waitForFunction(() => document.getElementById('temperature').textContent !== '—');
      assert.ok(Number(await page.locator('#temperature').textContent()) < 150);
      assert.equal(await page.inputValue('#password'), '');
      await page.evaluate(() => document.getElementById('toast').classList.add('hidden'));
      await page.screenshot({ path: path.join(output, 'overview.png'), fullPage: true });
      await navigate(page, 'signal'); await page.screenshot({ path: path.join(output, 'signal.png'), fullPage: true });
      await navigate(page, 'clients'); await page.waitForSelector('#clients-content table');
      assert.ok(await page.locator('#clients-content tr').count() > 1);
      await navigate(page, 'sms'); await page.waitForSelector('.sms-item');
      await navigate(page, 'plugins'); await page.waitForSelector('.plugin-card', { timeout: 30000 });
      await page.screenshot({ path: path.join(output, 'plugins.png') });
      await page.fill('#plugin-search', 'Mosdns'); assert.ok(await page.locator('.plugin-card').count() > 0);
      await navigate(page, 'tools'); await page.selectOption('#command-preset', 'uptime');
      assert.equal(await page.inputValue('#command'), 'uptime');
      await navigate(page, 'network'); await page.waitForSelector('form[data-action="network-mode"]');
      await page.screenshot({ path: path.join(output, 'network.png') });
      for (const tab of ['wifi', 'apn', 'radio', 'lan']) {
        await navigate(page, tab);
        await page.waitForFunction(() => document.querySelector('#network-host > div:not(.hidden) .settings-grid').children.length > 0);
        assert.equal(await page.locator('#network-host > div:not(.hidden) .list-status button').count(), 0);
        if (tab === 'radio') await page.screenshot({ path: path.join(output, 'radio.png') });
      }
      for (const view of ['traffic', 'tasks', 'forward', 'device']) {
        await navigate(page, view); await page.locator(`#${view}-host form`).first().waitFor();
        assert.equal(await page.locator(`#${view}-host .list-status button`).count(), 0);
      }
      await page.screenshot({ path: path.join(output, 'device.png') });
      await navigate(page, 'plugins'); await page.click('#manage-plugins');
      await page.waitForSelector('form[data-action="plugins-save"]'); await page.click('#close-feature-dialog');
      for (const target of ['updates', 'appearance', 'authentication', 'service', 'voice', 'usb']) {
        await navigate(page, target);
        await page.waitForFunction(id => { const n = document.getElementById(id + '-host'); return n && !n.textContent.includes('正在读取…') && n.children.length > 0; }, target);
        assert.equal(await page.locator(`#${target}-host`).getByRole('button', { name: '重新读取', exact: true }).count(), 0);
        if (target === 'updates' || target === 'appearance') await page.screenshot({ path: path.join(output, `${target}.png`) });
      }
      // Commands and setting writes are deliberately not submitted on the real device.
      await navigate(page, 'overview');
      await page.locator('.health-trends').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, 'telemetry-live.png'), fullPage: true });
      await page.locator('[data-open-panel]').first().click();
      await new Promise(resolve => setTimeout(resolve, 1000));
      const windows = await instance.windows(); assert.equal(windows.length, 2);
      const remote = windows.find(p => p !== page);
      assert.equal(await remote.evaluate(() => typeof window.ufi), 'undefined');
      assert.equal(await remote.evaluate(() => typeof window.require), 'undefined');
      await remote.close();
      await page.click('#edit-connection');
      await page.screenshot({ path: path.join(output, 'connection.png') });
      await page.click('#disconnect-button');
      await page.waitForFunction(() => document.getElementById('connection-state').textContent.includes('未连接'));
      assert.ok(!fs.readFileSync(path.join(userData, 'profiles.json'), 'utf8').includes(input.password));
    } else {
      await page.fill('#address', 'http://127.0.0.1:1'); await page.click('#submit-connection');
      await page.waitForSelector('#connection-error:not(.hidden)');
      await page.click('#close-dialog'); await page.screenshot({ path: path.join(output, 'offline.png') });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', deviceChecks: !!process.env.UFI_CONNECTION_FILE, pageErrors: errors, screenshots: output }));
  } catch (error) {
    const page = (await instance.windows())[0];
    if (page) console.error({ page: await page.locator('#page-title').textContent(), pluginStatus: await page.locator('#plugins-status').textContent(), clientsStatus: await page.locator('#clients-status').textContent(), clientsContent: await page.locator('#clients-content').textContent(), pageErrors: errors });
    throw error;
  } finally { await instance.close(); fs.rmSync(userData, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
