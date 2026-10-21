'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { navigate } = require('./ui-helpers.cjs');
(async () => {
  if (!process.env.UFI_CONNECTION_FILE) throw new Error('需要 UFI_CONNECTION_FILE（只读短信分类验证）');
  const input = JSON.parse(fs.readFileSync(process.env.UFI_CONNECTION_FILE, 'utf8'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ufi-sms-'));
  const env = { ...process.env, UFI_TEST_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const args = process.env.UFI_EXECUTABLE ? [] : [path.join(__dirname, '..')];
  const instance = await electron.launch({ args, env, ...(process.env.UFI_EXECUTABLE ? { executablePath: process.env.UFI_EXECUTABLE } : {}) });
  const errors = [];
  try {
    const page = await instance.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.click('#welcome-connect'); await page.fill('#address', input.address); await page.fill('#password', input.password || ''); await page.fill('#zte-password', input.ztePassword || ''); await page.uncheck('#remember');
    await page.click('#submit-connection'); await page.waitForSelector('#view-overview:not(.hidden)');
    await navigate(page, 'sms'); await page.waitForSelector('.sms-item');
    const inbox = await page.locator('.sms-item').count();
    assert.ok(await page.locator('.sms-item').evaluateAll(items => items.every(item => item.dataset.smsFolder === 'inbox')));
    await page.locator('[role=tab][data-sms-folder=sent]').click();
    await page.waitForFunction(() => document.querySelector('[data-sms-folder=sent][role=tab]').getAttribute('aria-selected') === 'true' && !document.getElementById('sms-content').getAttribute('aria-busy')?.includes('true'));
    const sent = await page.locator('.sms-item').count();
    assert.ok(await page.locator('.sms-item').evaluateAll(items => items.every(item => item.dataset.smsFolder === 'sent')));
    assert.equal(await page.locator('#sms-unread').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '标记已读', exact: true }).count(), 0);
    if (sent) {
      const original = await page.locator('.sms-body').first().textContent();
      await page.locator('.sms-item').first().getByRole('button', { name: '再次发送', exact: true }).click();
      assert.equal(await page.inputValue('form[data-action="sms-send"] [name=content]'), original);
      await page.click('#close-feature-dialog'); // Never submit a real message.
    }
    await page.locator('[role=tab][data-sms-folder=all]').click();
    await page.waitForFunction(() => !document.getElementById('sms-content').getAttribute('aria-busy')?.includes('true'));
    const all = await page.locator('.sms-item').count(); assert.ok(all >= inbox + sent);
    assert.deepEqual(errors, []);
    const report = { result: 'passed', realDevice: true, inbox, sent, all, messageSent: false, readStatusChanged: false, pageErrors: errors };
    fs.writeFileSync(path.join(__dirname, '../artifacts/sms-live-validation.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await instance.close(); fs.rmSync(userData, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
