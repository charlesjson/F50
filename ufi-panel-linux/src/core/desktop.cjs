'use strict';
// System Electron launches an app archive through its default app. Preserve that
// archive argument when generating autostart, instead of opening bare Electron.
function autostartExec({ appImage, execPath, appPath, defaultApp }) {
  const quote = value => {
    if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error('无效启动路径');
    return '"' + value.replace(/\\/g, '\\\\\\\\').replace(/(["`$])/g, '\\\\$1').replace(/%/g, '%%') + '"';
  };
  const args = appImage ? [appImage, '--appimage-extract-and-run'] : defaultApp ? [execPath, appPath] : [execPath];
  return args.map(quote).join(' ');
}
module.exports = { autostartExec };
