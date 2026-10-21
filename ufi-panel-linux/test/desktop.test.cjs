'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { autostartExec } = require('../src/core/desktop.cjs');
test('system Electron autostart retains the application archive; packaged Electron does not need it', () => {
  assert.equal(autostartExec({ execPath:'/usr/lib/electron43/electron',appPath:'/usr/lib/ufi-panel-linux/app.asar',defaultApp:true }), '"/usr/lib/electron43/electron" "/usr/lib/ufi-panel-linux/app.asar"');
  assert.equal(autostartExec({execPath:'/opt/ufi-panel-linux/ufi-panel-linux',appPath:'/opt/ufi-panel-linux/resources/app.asar',defaultApp:false}), '"/opt/ufi-panel-linux/ufi-panel-linux"');
  assert.equal(autostartExec({appImage:'/data/UFI Panel.AppImage'}), '"/data/UFI Panel.AppImage" "--appimage-extract-and-run"');
  assert.throws(()=>autostartExec({execPath:'/tmp/a\nExec=evil'}), /无效/);
  assert.ok(autostartExec({execPath:'/tmp/100%/panel'}).includes('100%%'));
});
