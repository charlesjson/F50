(() => {
  const start = () => {
    // This is the UFI host's telemetry control, independent of installed plugins.
    // Only resume refresh if this view paused it, respecting a user's own pause.
    let paused;
    const pause = () => {
      if (paused) return;
      const control = document.querySelector('button.REFRESH_BTN');
      const label = typeof t === 'function' ? t('stop_refresh') : '停止刷新';
      if (control?.onclick && control.textContent.trim() === label) { control.click(); paused = { control, label: control.textContent }; }
    };
    const resume = () => {
      if (paused?.control.isConnected && paused.control.textContent === paused.label) paused.control.click();
      paused = null;
    };
    document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume());
    window.addEventListener('blur', pause); window.addEventListener('focus', () => { if (!document.hidden) resume(); });
    const reconcile = () => document.hidden || !document.hasFocus() ? pause() : resume();
    reconcile(); setInterval(reconcile, 1000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
