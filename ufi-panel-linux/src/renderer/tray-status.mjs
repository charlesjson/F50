import { SidebarTelemetry } from './sidebar-telemetry.mjs';

const telemetry = new SidebarTelemetry(document.getElementById('sidebar-telemetry'));
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  let theme = 'system';
  try { theme = localStorage.getItem('theme') || theme; } catch {}
  document.documentElement.dataset.theme = theme === 'dark' || theme === 'system' && systemTheme.matches ? 'dark' : 'light';
}
applyTheme();
systemTheme.addEventListener('change', applyTheme);
addEventListener('storage', event => { if (event.key === 'theme') applyTheme(); });
window.__ufiTrayStatusUpdate = (status = {}) => {
  applyTheme();
  telemetry.render(status.snapshot, status);
  const name = document.getElementById('tray-device');
  name.textContent = status.connected ? status.name || '我的 UFI' : 'UFI Panel';
  name.title = name.textContent;
};
window.__ufiTrayStatusUpdate(window.__ufiTrayStatus);

const action = name => window.__TAURI__.core.invoke('tray_popup_action', { action: name }).catch(console.error);
document.getElementById('tray-drag').addEventListener('mousedown', event => {
  if (event.button !== 0) return;
  event.preventDefault();
  action('drag');
});
document.getElementById('tray-show-main').addEventListener('click', () => action('show-main'));
addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); action('hide'); } });
