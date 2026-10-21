'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  if (!process.env.UFI_EXECUTABLE) throw new Error('Set UFI_EXECUTABLE to the extracted package launcher');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ufi-package-'));
  const env = { ...process.env, UFI_TEST_USER_DATA: temp, XDG_CONFIG_HOME: path.join(temp, 'config') }; delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({ executablePath: process.env.UFI_EXECUTABLE, args: process.env.UFI_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [], env, timeout: 30000 });
  try {
    const page = await instance.firstWindow(); await page.waitForSelector('#welcome');
    const info = await instance.evaluate(({ app }) => ({ packaged: app.isPackaged, defaultApp: !!process.defaultApp, appPath: app.getAppPath(), electron: process.versions.electron, userData: app.getPath('userData'), config: app.getPath('appData') }));
    assert.equal(info.packaged, true); assert.equal(info.userData, temp);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => typeof window.ufi.snapshot), 'function');
    const status = await page.evaluate(() => window.ufi.autostart()); assert.equal(status.supported, true);
    await page.evaluate(() => window.ufi.autostart(true));
    const file = path.join(info.config, 'autostart/ufi-panel-linux.desktop');
    const text = fs.readFileSync(file, 'utf8'); assert.ok(text.includes('Exec='));
    if (info.defaultApp) assert.ok(text.includes(info.appPath), 'system Electron autostart must include the app archive');
    await page.evaluate(() => window.ufi.autostart(false)); assert.equal(fs.existsSync(file), false);
    console.log(JSON.stringify({ result: 'passed', runtime: info.electron, systemElectron: info.defaultApp, chromiumSandbox: process.env.UFI_TEST_NO_SANDBOX !== '1', isolatedRenderer: true, autostartInTemporaryConfig: 'passed' }));
  } finally { await instance.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
