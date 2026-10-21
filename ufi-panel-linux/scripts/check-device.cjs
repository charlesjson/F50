'use strict';
// UFI_CONNECTION_FILE points to a mode-0600 JSON file, never committed to the repo.
const fs = require('node:fs');
const { UfiClient } = require('../src/core/client.cjs');
(async () => {
  let input;
  if (process.env.UFI_CONNECTION_FILE) input = JSON.parse(fs.readFileSync(process.env.UFI_CONNECTION_FILE, 'utf8'));
  else input = { address: process.env.UFI_ADDRESS || 'http://192.168.0.1:2333', password: process.env.UFI_PASSWORD || '', ztePassword: process.env.ZTE_PASSWORD || '' };
  const client = new UfiClient(input);
  try {
    const { version } = await client.connect();
    const data = await client.snapshot();
    const clients = await client.clients();
    const sms = await client.sms();
    const plugins = await client.plugins();
    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(), version,
      temperatureC: data.base.cpu_temp > 1000 ? data.base.cpu_temp / 1000 : data.base.cpu_temp,
      cpuUsage: data.base.cpu_usage, memoryUsage: data.base.mem_usage,
      network: data.network.network_type, rsrp: data.network.Z5g_rsrp,
      wifiClients: (clients.station_list || []).length, smsCount: sms.messages.length,
      pluginCount: plugins.items.length, warnings: data.warnings,
      operations: 'Read-only API checks. No shell commands, SMS sends, or device configuration writes.',
    }, null, 2));
  } finally { client.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
