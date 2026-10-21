'use strict';
function page() {
  const id = String(Date.now()) + Math.random(); let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const token = localStorage.getItem('kano_sms_token');
      const result = await fetch('/api/session-probe', { headers: token ? { authorization: token } : {} });
      await fetch('/fixture-session-report', { method: 'POST', body: JSON.stringify({
        id, authenticated: result.ok, hasPassword: !!localStorage.getItem('kano_sms_pwd'),
        manualPassword: localStorage.getItem('kano_sms_pwd') === 'manual-zte-password',
        preference: localStorage.getItem('panel-preference'), cookie: document.cookie.includes('panel-session=fixture'),
        exposedKeys: Object.keys(localStorage), bridge: typeof window.ufi,
      }) });
      const command = await (await fetch('/fixture-command?id=' + id)).json();
      if (command.type === 'remember') {
        localStorage.setItem('panel-preference', 'retained preference');
        document.cookie = 'panel-session=fixture; Max-Age=86400; Path=/; SameSite=Lax';
        localStorage.setItem('kano_sms_pwd', 'manual-zte-password');
      }
      if (command.type === 'expire') {
        localStorage.removeItem('kano_sms_token'); localStorage.removeItem('kano_sms_pwd');
      }
    } finally { busy = false; }
  };
  setInterval(() => tick().catch(() => {}), 150); tick().catch(() => {});
}
module.exports = `<!doctype html><meta charset="utf-8"><title>Session fixture</title><p>插件配置会话</p><script>(${page.toString()})();</script>`;
