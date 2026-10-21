'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ClientAccess } = require('../src/core/client-access.cjs');
const { DeviceFeatures } = require('../src/core/features.cjs');

function fixture() {
  const state = {
    AclMode: '2', WhiteMacList: '02:AA:BB:CC:DD:01', WhiteNameList: '保留白名单',
    BlackMacList: '00:aa:bb:cc:dd:01;00:AA:BB:CC:DD:02', BlackNameList: '已有甲;已有乙',
    station_list: [{ hostname: '测试电脑', ip_addr: '192.168.0.3', mac_addr: '00:11:22:33:44:55' }],
    lan_station_list: [{ hostname: '有线终端', mac_addr: '00:11:22:33:44:66' }],
  };
  const writes = [], reads = [];
  const client = { official: async fields => { reads.push(fields); return structuredClone(state); }, postOfficial: async fields => { writes.push(fields); return { result: 'success' }; } };
  const access = client.clientAccess = new ClientAccess(client);
  return { state,writes,reads,client,access,features:new DeviceFeatures(client) };
}
const block = revision => ({ mac: '00:11:22:33:44:55', revision });

test('blocking one Wi-Fi terminal preserves all existing blacklist names, whitelist fields and ACL mode',async () => {
  const f = fixture(), list = await f.access.read();
  assert.equal(list.clientAccess.supported,true); assert.equal(list.clientAccess.blocked.length,2);
  assert.equal(Object.hasOwn(list,'WhiteMacList'),false);
  const plan = f.features.prepare('client-block',block(list.clientAccess.revision));
  assert.equal(f.writes.length,0); assert.match(plan.detail,/测试电脑/); assert.match(plan.detail,/192\.168\.0\.3/); assert.match(plan.detail,/持续禁止重连/);
  await plan.run();
  assert.deepEqual(f.writes,[{goformId:'setDeviceAccessControlList',AclMode:'2',WhiteMacList:f.state.WhiteMacList,WhiteNameList:f.state.WhiteNameList,
    BlackMacList:f.state.BlackMacList+';00:11:22:33:44:55',BlackNameList:'已有甲;已有乙;测试电脑'}]);
  assert.match(f.reads[0],/queryDeviceAccessControlList/);
  assert.throws(()=>f.features.prepare('client-block',block(list.clientAccess.revision)),/刷新/);
});

test('unblocking an offline MAC removes only its matching name and keeps neighboring entries unchanged',async () => {
  const f=fixture(), data=await f.access.read();
  await f.features.prepare('client-unblock',{mac:'00:AA:BB:CC:DD:01',revision:data.clientAccess.revision}).run();
  assert.equal(f.writes[0].BlackMacList,'00:AA:BB:CC:DD:02');assert.equal(f.writes[0].BlackNameList,'已有乙');
  assert.equal(f.writes[0].WhiteMacList,f.state.WhiteMacList);
});

test('wired, missing, multicast, broadcast and malformed targets cannot be blocked',async () => {
  const f=fixture(), data=await f.access.read();
  for(const target of ['00:11:22:33:44:66','00:11:22:33:44:88','01:11:22:33:44:55','FF:FF:FF:FF:FF:FF','00:00:00:00:00:00','00:11:22:33:44:55;reboot']) {
    assert.throws(()=>f.features.prepare('client-block',{mac:target,revision:data.clientAccess.revision}));
  }
  assert.throws(()=>f.features.prepare('client-block',block('stale-revision')),/变化/);assert.equal(f.writes.length,0);
});

test('concurrent changes to any ACL field abort before writing instead of replacing another page changes',async () => {
  for(const [key,value] of [['BlackMacList','00:AA:BB:CC:DD:03'],['WhiteNameList','另一个页面修改'],['AclMode','1']]) {
    const f=fixture(), data=await f.access.read();
    const plan=f.features.prepare('client-block',block(data.clientAccess.revision));f.state[key]=value;
    await assert.rejects(plan.run(),/其他页面修改/);assert.equal(f.writes.length,0);
  }
});

test('a terminal that goes offline or moves to LAN while confirmation is open is never blocked',async () => {
  const f=fixture(), data=await f.access.read();
  const plan=f.features.prepare('client-block',block(data.clientAccess.revision));f.state.station_list=[];
  await assert.rejects(plan.run(),/离线或连接方式/);assert.equal(f.writes.length,0);
});

test('unsupported ACLs and whitelist mode retain the client list and cannot change the device mode',async () => {
  for(const change of [s=>{delete s.BlackMacList;},s=>{s.AclMode='1';},s=>{s.AclMode='0';},s=>{s.BlackMacList='bad';}]) {
    const f=fixture();change(f.state);const data=await f.access.read();
    assert.equal(data.station_list.length,1);assert.equal(data.clientAccess.supported,false);
    assert.throws(()=>f.features.prepare('client-block',block(data.clientAccess.revision)));assert.equal(f.writes.length,0);
  }
});

test('encoded station lists, missing names and separator characters do not corrupt the saved blacklist',async () => {
  const f=fixture();f.state.BlackNameList='';
  f.state.station_list=JSON.stringify([{hostname:'电脑;第二段\n第三段',mac_addr:'00:11:22:33:44:55'}]);
  const data=await f.access.read();await f.features.prepare('client-block',block(data.clientAccess.revision)).run();
  assert.equal(f.writes[0].BlackNameList,';;电脑 第二段 第三段');
  assert.equal(f.writes[0].BlackMacList.split(';').length,3);
});

test('a timed out blacklist write is submitted once and keeps an unknown outcome',async () => {
  const f=fixture(), data=await f.access.read();
  f.client.postOfficial=async fields=>{f.writes.push(fields);throw new Error('设备响应超时');};
  await assert.rejects(f.features.prepare('client-block',block(data.clientAccess.revision)).run(),/操作结果未知/);
  assert.equal(f.writes.length,1);
});

test('old firmware rejecting the ACL query still provides its original online terminal list',async () => {
  const f=fixture();
  f.client.official=async fields=>{
    if(fields.includes('queryDeviceAccessControlList'))throw new Error('unsupported command');
    return {station_list:structuredClone(f.state.station_list),lan_station_list:[]};
  };
  const data=await f.access.read();assert.equal(data.station_list.length,1);assert.equal(data.clientAccess.supported,false);
  assert.equal(f.writes.length,0);
});
