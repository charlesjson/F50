'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (action, input) => {
  const result = await ipcRenderer.invoke(`ufi:${action}`, input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('ufi', Object.freeze({
  setZoom: value => invoke('set-zoom', value),
  openMonitor: () => invoke('monitor-open'),
  autostart: enabled => invoke('autostart', enabled),
  connectionInfo: () => invoke('connection-info'),
  profiles: () => invoke('profiles'),
  removeProfile: id => invoke('remove-profile', id),
  connect: input => invoke('connect', input),
  disconnect: () => invoke('disconnect'),
  cancelConnection: () => invoke('cancel-connection'),
  copyText: value => invoke('copy-text', value),
  snapshot: () => invoke('snapshot'),
  smsNumberPreview: input => invoke('sms-number-preview', input),
  telemetryConfigure: interval => invoke('telemetry-configure', interval),
  telemetryState: () => invoke('telemetry-state'),
  onTelemetry: callback => { const listener = (_event, packet) => callback(packet); ipcRenderer.on('ufi:telemetry', listener); return () => ipcRenderer.removeListener('ufi:telemetry', listener); },
  clients: () => invoke('clients'),
  sms: page => invoke('sms', page),
  plugins: () => invoke('plugins'),
  featureRead: (name, data) => invoke('feature-read', { name, data }),
  prepareOperation: (name, data) => invoke('operation-prepare', { name, data }),
  commitOperation: id => invoke('operation-commit', id),
  cancelOperation: id => invoke('operation-cancel', id),
  jobs: () => invoke('jobs'),
  startJob: (kind, data) => invoke('job-start', { kind, data }),
  cancelJob: id => invoke('job-cancel', id),
  jobResult: id => invoke('job-result', id),
  onJobs: callback => { const listener = (_event, jobs) => callback(jobs); ipcRenderer.on('ufi:jobs-changed', listener); return () => ipcRenderer.removeListener('ufi:jobs-changed', listener); },
  pickUpload: () => invoke('pick-upload'),
  saveText: (name, text) => invoke('save-text', { name, text }),
  importConfig: () => invoke('import-config'),
  openTerminal: port => invoke('open-terminal', port),
  openPanel: () => invoke('open-panel'),
  command: input => invoke('command', input),
  export: () => invoke('export'),
}));
