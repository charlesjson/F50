'use strict';
// Feature inventory only: explicit read endpoints and official read fields.
// Do not replace this list with GET discovery: several device GETs mutate state.
const fs = require('node:fs');
const path = require('node:path');
const { UfiClient } = require('../../src/core/client.cjs');

const connectionFile = process.env.UFI_CONNECTION_FILE;
if (!connectionFile) throw new Error('请通过 UFI_CONNECTION_FILE 指定现有私有连接文件');
const input = JSON.parse(fs.readFileSync(connectionFile,'utf8'));
if (input.address !== 'http://192.168.0.1:2333') throw new Error('此检查仅用于本次用户指定的设备地址');
const output = path.resolve(process.argv[2] || 'artifacts/device-feature-audit-20261017.json');
const client = new UfiClient(input,{timeout:6000});
const reads = [
  '/api/version_info','/api/baseDeviceInfo','/api/connInfo','/api/usb_status','/api/SELinux',
  '/api/get_log_status','/api/get_data_limit','/api/adb_wifi_setting','/api/adb_alive',
  '/api/getSupportNrBandList?slot=0','/api/getSupportNrBandList?slot=1',
  '/api/hasTTYD?port=1146','/api/volte_status?slot=0','/api/volte_status?slot=1',
  '/api/vonr_status?slot=0','/api/vonr_status?slot=1','/api/get_theme','/api/get_res_server',
  '/api/list_tasks','/api/get_current_location',
  '/api/getEndcState?slot=0','/api/getBaseBandPreferToData?slot=0',
  '/api/getOnlyRndisSwitch','/api/sms_receive_mode','/api/getNetworkMode',
  '/api/getVoLteState?slot=0','/api/getVoNrState?slot=0','/api/getSubIds',
];
const groups = [
  ['networkCapabilities','net_select,usb_network_protocal,sleep_sysIdleTimeToSleep,is_support_nfc_functions,web_wifi_nfc_switch'],
  ['officialTraffic','monthly_rx_bytes,monthly_tx_bytes,wan_auto_clear_flow_data_switch,data_volume_limit_unit,data_volume_limit_size,traffic_clear_date,data_volume_alert_percent,data_volume_limit_switch,flux_auto_clear_flow_data_switch,flux_data_volume_limit_unit,flux_data_volume_limit_size,flux_clear_date,flux_data_volume_alert_percent,flux_data_volume_limit_switch'],
  ['accessControl','queryDeviceAccessControlList'],
];
function shape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return {type:'array',length:value.length,itemKeys:value.length && value[0] && typeof value[0] === 'object' ? Object.keys(value[0]) : undefined};
  if (typeof value === 'object') return {type:'object',keys:Object.keys(value)};
  if (typeof value === 'string') {
    try { const nested=JSON.parse(value);if(nested && typeof nested==='object') return {type:'encoded-json',shape:shape(nested)}; } catch {}
    return {type:'string',empty:value===''};
  }
  return {type:typeof value};
}
const safeValueKeys = new Set(['model','app_ver','app_ver_code','net_select','usb_network_protocal','sleep_sysIdleTimeToSleep','is_support_nfc_functions','web_wifi_nfc_switch','AclMode']);
function describe(data) {
  if (!data || typeof data !== 'object') return {shape:shape(data)};
  return {fields:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,shape(value)])),
    values:Object.fromEntries(Object.entries(data).filter(([key])=>safeValueKeys.has(key)))};
}
(async()=>{
  const report={checkedAt:new Date().toISOString(),address:input.address,clientVersion:require('../../package.json').version,
    method:'allowlisted GETs only; no AT, Shell, configuration writes, SMS content, credentials or precise location stored',
    endpoints:[],officialReads:[],skipped:['AT','user_shell','root_shell','smbPath','disable_fota','one_click_shell','speedtest','get_official_web_password','SMS content','forwarding credentials']};
  try {
    for (const route of reads) {
      const started=Date.now();
      try {
        const data=await client.api(route);
        report.endpoints.push({path:route,status:'read-ok',elapsedMs:Date.now()-started,...describe(data)});
      } catch(error) {
        report.endpoints.push({path:route,status:'read-failed',httpStatus:error.status || null,elapsedMs:Date.now()-started,
          reason:error.status ? `HTTP ${error.status}` : '无可用响应'});
      }
    }
    for(const [name,fields] of groups) {
      try {report.officialReads.push({name,status:'read-ok',...describe(await client.official(fields))});}
      catch(error){report.officialReads.push({name,status:'read-failed',httpStatus:error.status || null});}
    }
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({saved:output,endpoints:report.endpoints.map(({path,status,httpStatus})=>({path,status,httpStatus})),officialReads:report.officialReads.map(({name,status,values})=>({name,status,values}))}));
  } finally {client.close();}
})().catch(()=>{console.error('只读盘点未完成，请检查连接和输出路径');process.exitCode=1;});
