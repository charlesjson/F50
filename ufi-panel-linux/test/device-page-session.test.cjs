'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../src-tauri/src/device-page-session.js'), 'utf8');
function page({ origin = 'http://device.test:2333', pathname = '/prefix/', iframe = false } = {}) {
  const session = { origin: 'http://device.test:2333', path: '/prefix/', authorization: 'verified-token', password: 'zte-secret', loginMethod: '1' };
  const context = vm.createContext({ location: { origin, pathname } });
  vm.runInContext(`class Storage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.get(String(key)) ?? null; }
    setItem(key,value) { this.values.set(String(key),String(value)); }
    removeItem(key) { this.values.delete(String(key)); }
    clear() { this.values.clear(); }
  };var localStorage = new Storage(), sessionStorage = new Storage(), window = {}, top = window;`, context);
  if (iframe) vm.runInContext('top = {};', context);
  vm.runInContext(source.replace('__UFI_WEB_SESSION__', JSON.stringify(session)), context);
  return { read: code => vm.runInContext(code, context), session };
}
test('UFI web credentials are supplied before page scripts and never persisted with plugin preferences', () => {
  const p = page();
  assert.equal(p.read('localStorage.getItem("kano_sms_token")'), p.session.authorization);
  assert.equal(p.read('localStorage.getItem("kano_sms_pwd")'), p.session.password);
  p.read('localStorage.setItem("plugin-preference","retained");localStorage.setItem("kano_sms_pwd","manual-login");localStorage.setItem("kano_remembered_loginfo","weakly-encrypted-secret");');
  assert.equal(p.read('localStorage.getItem("kano_sms_pwd")'), 'manual-login');
  assert.deepEqual(JSON.parse(p.read('JSON.stringify([...localStorage.values])')), [['plugin-preference', 'retained']]);
  p.read('sessionStorage.setItem("kano_sms_token","unrelated");');
  assert.equal(p.read('sessionStorage.getItem("kano_sms_token")'), 'unrelated');
  p.read('localStorage.removeItem("kano_sms_token");');
  assert.equal(p.read('localStorage.getItem("kano_sms_token")'), null);
  p.read('localStorage.clear();');
  assert.equal(p.read('localStorage.getItem("kano_sms_pwd")'), null);
  p.read('window.__ufiRestoreWebSession();');
  assert.equal(p.read('localStorage.getItem("kano_sms_pwd")'), 'manual-login');
});
test('device credentials never reach another origin, port, prefix or embedded frame', () => {
  for (const options of [{origin:'http://other.test:2333'}, {origin:'http://device.test:7788'}, {origin:'https://device.test:2333'}, {pathname:'/prefix-other/'}, {iframe:true}]) {
    const p = page(options);
    assert.equal(p.read('localStorage.getItem("kano_sms_token")'), null);
    assert.equal(p.read('localStorage.getItem("kano_sms_pwd")'), null);
  }
  assert.equal(page({pathname:'/prefix'}).read('localStorage.getItem("kano_sms_token")'), 'verified-token');
});
