const { test } = require('node:test');
const assert = require('node:assert/strict');
test('neighbor selection uses observed fields and context, preserving zero PCI', async () => {
 const {neighborCells} = await import('../src/renderer/cells.mjs');
 const [cell]=neighborCells('[{"band":"78","earfcn":"633984","pci":"0","rsrp":"-107"}]','5G');
 assert.equal(cell.rat,'16');assert.equal(cell.earfcn,633984);assert.equal(cell.pci,0);assert.equal(cell.band,78);assert.equal(cell.reason,'');assert.equal(cell.ratSource,'当前网络制式');
 const [lte]=neighborCells([{rat:'LTE',band:3,arfcn:1650,pci:123,rsrp_dbm:-96,sinr_db:8}],'5G');
 assert.equal(lte.rat,'12');assert.equal(lte.rsrp,-96);assert.equal(lte.sinr,8);
});
test('unknown RAT remains unresolved, incomplete rows cannot be selected, no zero fabrication',async()=>{
 const {neighborCells}=await import('../src/renderer/cells.mjs');
 assert.equal(neighborCells([{band:3,earfcn:1650,pci:12}])[0].rat,'');
 assert.equal(neighborCells([{rat:'WCDMA',band:1,earfcn:100,pci:12}],'5G')[0].rat,'');
 assert.equal(neighborCells([{band:'n78',earfcn:633984,pci:12}])[0].rat,'16');
 assert.match(neighborCells([{rat:'LTE',earfcn:1650,pci:800}])[0].reason,/PCI/);
 assert.match(neighborCells([{rat:'NR',earfcn:'',pci:0}])[0].reason,/频点/);
 assert.equal(neighborCells([{rat:'NR',earfcn:633984,pci:0}])[0].rsrp,null);
 assert.deepEqual(neighborCells(null),[]);assert.deepEqual(neighborCells({}),[]);
});
