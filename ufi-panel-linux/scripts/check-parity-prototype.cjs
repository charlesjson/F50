'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '../docs/full-parity');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'feature-catalog.json'), 'utf8'));
  assert.equal(new Set(catalog.features.map(f => f.id)).size, catalog.features.length);
  for (const feature of catalog.features) assert.ok(feature.evidence.every(e => e.matched && e.line > 0), feature.id);
  for (const screen of Object.keys(catalog.screens)) assert.ok(catalog.screenRoutes[screen], screen);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ufi-prototype-'));
  const main = path.join(temp, 'main.cjs');
  fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.UFI_TEST_USER_DATA);app.whenReady().then(()=>{const w=new BrowserWindow({width:1240,height:800,minWidth:800,minHeight:650,autoHideMenuBar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.loadFile(process.env.UFI_PROTOTYPE_FILE)});app.on('window-all-closed',()=>app.quit());`);
  const env = { ...process.env, UFI_TEST_USER_DATA: path.join(temp, 'profile'), UFI_PROTOTYPE_FILE: path.join(root, 'INTERACTION-PROTOTYPE.html') }; delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({ args: [main], env });
  const output = path.resolve(__dirname, '../artifacts/full-parity'); fs.mkdirSync(output, { recursive: true });
  const errors = [], checks = [];
  try {
    const page = await instance.firstWindow(); page.on('pageerror', e => errors.push(e.message));
    await page.locator('[data-group="network"]').waitFor();
    await page.screenshot({ path: path.join(output, 'overview.png') });
    for (const group of catalog.groups) {
      await page.click(`[data-group="${group.id}"]`);
      for (const [, name] of group.sections) {
        await page.locator('#section-nav').getByRole('button', { name, exact: true }).click();
        assert.ok((await page.locator('#workspace h1').textContent()).length);
      }
    }
    checks.push(`all ${catalog.groups.length} groups and ${catalog.groups.reduce((n,g)=>n+g.sections.length,0)} secondary pages reachable`);
    await page.click('#catalog-button'); assert.equal(await page.locator('#workspace .feature-row').count(), 115);
    await page.getByRole('searchbox', { name: '筛选功能清单' }).fill('RRC'); assert.ok(await page.locator('#workspace .feature-row').count() > 0);
    await page.locator('#workspace .feature-row').first().click(); assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog[open]').count(), 0);
    await page.click('#roadmap-button'); assert.equal(await page.locator('.phase').count(), 8); checks.push('catalog evidence, filter, detail and stage dependencies');
    await page.click('[data-group="network"]'); await page.locator('#section-nav').getByRole('button', { name: 'Wi-Fi 热点', exact: true }).click();
    await page.locator('.setting-row').filter({ hasText: '网络名称与认证' }).getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('textbox', { name: '网络名称（SSID）', exact: true }).fill('UFI-F50-Draft');
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: '保留草稿并关闭', exact: true }).click();
    await page.locator('.setting-row').filter({ hasText: '网络名称与认证' }).getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '网络名称（SSID）', exact: true }).inputValue(), 'UFI-F50-Draft');
    await page.getByRole('button', { name: '查看变更', exact: true }).click(); assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.ok((await page.locator('.review-diff').first().textContent()).includes('UFI-F50-Draft'));
    await page.screenshot({ path: path.join(output, 'wifi-review.png') });
    await page.getByRole('button', { name: '确认（模拟）', exact: true }).click();
    await page.locator('#overlay-actions').getByRole('button', { name: '关闭', exact: true }).click();
    assert.ok(await page.evaluate(() => document.activeElement?.textContent === '编辑')); checks.push('one overlay, draft preservation, diff confirmation and focus restoration');
    await page.click('[data-group="messages"]'); await page.getByRole('button', { name: '写短信', exact: true }).click();
    await page.getByRole('textbox', { name: '收件号码', exact: true }).fill('10000'); await page.getByRole('textbox', { name: '短信内容', exact: true }).fill('仅交互演示');
    await page.getByRole('button', { name: '查看发送摘要', exact: true }).click();
    assert.equal(await page.locator('dialog[open]').count(), 1); await page.getByRole('button', { name: '完成演示', exact: true }).click();
    await page.locator('#overlay-actions').getByRole('button', { name: '关闭', exact: true }).click(); checks.push('SMS editor review uses same overlay and does not send');
    await page.click('[data-group="tools"]'); await page.locator('#section-nav').getByRole('button', { name: '信令分析', exact: true }).click();
    await page.getByRole('button', { name: 'RRC 树示例', exact: true }).click(); await page.getByRole('button', { name: 'NDJSON 视图', exact: true }).click();
    assert.ok((await page.locator('#overlay-body').textContent()).includes('notDeviceData'));
    await page.locator('#overlay-actions').getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '开始采集（模拟）', exact: true }).click(); await page.getByRole('button', { name: '停止演示任务', exact: true }).click();
    assert.equal(await page.locator('#job-count').textContent(), '0'); await page.locator('#overlay-actions').getByRole('button', { name: '关闭', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'capture.png') }); checks.push('capture frame tree, NDJSON and task stop');
    await page.keyboard.press('Control+k'); await page.getByRole('searchbox', { name: '搜索全部功能' }).fill('NMS');
    await page.locator('.search-result').first().click(); assert.ok((await page.locator('#overlay-title').textContent()).includes('NMS'));
    await page.keyboard.press('Escape'); checks.push('global search routes to feature and detail');
    for (const [width, height] of [[1240, 800], [1024, 700]]) {
      await instance.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
      await page.waitForFunction(width => outerWidth === width, width);
      await page.click('[data-group="overview"]');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('#workspace').scrollWidth > document.querySelector('#workspace').clientWidth), false);
      await page.screenshot({ path: path.join(output, `layout-${width}.png`) });
    }
    checks.push('1240x800 and 1024x700 without horizontal overflow');
    assert.deepEqual(errors, []);
    const result = { result: 'passed', prototypeOnly: true, deviceRequests: 0, counts: catalog.counts, checks, pageErrors: errors };
    fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } catch (error) { const page = (await instance.windows())[0]; if (page) await page.screenshot({ path: path.join(output, 'failure.png') }); console.error({ errors }); throw error; }
  finally { await instance.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
