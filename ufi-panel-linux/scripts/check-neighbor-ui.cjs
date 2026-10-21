'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { navigate, confirmOperation } = require('./ui-helpers.cjs');
(async () => {
  if (!process.env.UFI_CONNECTION_FILE) throw new Error('需要只读联调用 UFI_CONNECTION_FILE');
  const input = JSON.parse(fs.readFileSync(process.env.UFI_CONNECTION_FILE, 'utf8'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ufi-neighbor-'));
  const env = { ...process.env, UFI_TEST_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const args = process.env.UFI_EXECUTABLE ? [] : [path.join(__dirname, '..')];
  const instance = await electron.launch({ args, env, ...(process.env.UFI_EXECUTABLE ? { executablePath: process.env.UFI_EXECUTABLE } : {}) });
  const errors = [];
  try {
    const page = await instance.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.click('#welcome-connect'); await page.fill('#address', input.address); await page.fill('#password', input.password || ''); await page.fill('#zte-password', input.ztePassword || '');
    await page.uncheck('#remember'); await page.click('#submit-connection'); await page.waitForSelector('#view-overview:not(.hidden)');
    await navigate(page, 'radio');
    try { await page.waitForSelector('[data-neighbor-table] tbody tr', { timeout: 15000 }); }
    catch (error) { console.error(JSON.stringify({network:await page.locator('#network-host').textContent(), pageErrors:errors})); throw error; }
    const rows = await page.locator('[data-neighbor-table] tbody tr').count();
    const choice = page.locator('[data-cell-choice]:not([disabled])').first();
    const [rat, channel, pci] = (await choice.getAttribute('data-cell-choice')).split(':');
    assert.ok(['12','16'].includes(rat));
    await choice.click(); await page.waitForSelector('[data-confirm-operation]');
    const detail = await page.locator('.operation-detail').textContent();
    assert.ok(detail.includes(`PCI ${pci}`)); assert.ok(detail.includes(`频点 ${channel}`));
    await confirmOperation(page, false); // Never submit a real lock in the verification script.
    await page.screenshot({ path: path.join(__dirname, '../artifacts/neighbor-live.png'), fullPage: true });
    assert.deepEqual(errors, []);
    const report = { result: 'passed', deviceChecks: true, neighborRows: rows, selectable: await page.locator('[data-cell-choice]:not([disabled])').count(), confirmationMatched: true, lockSubmitted: false, pageErrors: errors };
    fs.writeFileSync(path.join(__dirname, '../artifacts/neighbor-live-validation.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await instance.close(); fs.rmSync(userData, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
