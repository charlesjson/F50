'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalizeAddress, hashPassword } = require('./protocol.cjs');

class ProfileStore {
  constructor(directory, safeStorage) {
    this.file = path.join(directory, 'profiles.json');
    this.storage = safeStorage;
    this.data = { profiles: [], activeId: null };
    if (fs.existsSync(this.file)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (!Array.isArray(data.profiles)) throw new Error('bad profile format');
        this.data = data;
      } catch { throw new Error(`连接配置无法读取，请检查 ${this.file}`); }
    }
  }
  get canSaveSecrets() {
    return this.storage.isEncryptionAvailable() && this.storage.getSelectedStorageBackend?.() !== 'basic_text';
  }
  list() {
    return { profiles: this.data.profiles.map(({ id, name, address, secret, mode = 'KANO', loginMethod = 'LOGIN' }) => ({ id, name, address, mode, loginMethod, hasSecret: !!secret })), activeId: this.data.activeId, canSaveSecrets: this.canSaveSecrets };
  }
  credentials(id) {
    const profile = this.data.profiles.find(p => p.id === id);
    if (!profile) throw new Error('找不到该设备连接');
    let credentials = {};
    if (profile.secret) {
      if (!this.canSaveSecrets) throw new Error('系统密钥环不可用，请重新输入口令');
      try { credentials = JSON.parse(this.storage.decryptString(Buffer.from(profile.secret, 'base64'))); }
      catch { throw new Error('无法解锁已保存口令，请重新输入'); }
    }
    return { ...credentials, address: profile.address };
  }
  save(input, resolvedCredentials) {
    const id = input.id || randomUUID();
    const address = normalizeAddress(input.address);
    const previous = this.data.profiles.find(p => p.id === id);
    const profile = { id, name: String(input.name || '我的 UFI').slice(0, 60), address, mode: input.mode || 'KANO', loginMethod: input.loginMethod || 'LOGIN' };
    if (input.remember && this.canSaveSecrets) {
      let saved = {};
      if (resolvedCredentials) saved = resolvedCredentials;
      else if (previous?.secret && previous.address === address) {
        try { saved = this.credentials(id); }
        catch (error) { if (!input.password) throw error; }
      }
      const credentials = {
        token: input.password ? hashPassword(input.password) : saved.token || hashPassword(saved.password || ''),
        ztePassword: input.ztePassword || saved.ztePassword || '',
      };
      profile.secret = this.storage.encryptString(JSON.stringify(credentials)).toString('base64');
    }
    this.write({ ...this.data, profiles: [...this.data.profiles.filter(p => p.id !== id), profile], activeId: id });
    return { id, name: profile.name, address, mode: profile.mode, loginMethod: profile.loginMethod, hasSecret: !!profile.secret };
  }
  remove(id) {
    this.write({ ...this.data, profiles: this.data.profiles.filter(p => p.id !== id), activeId: this.data.activeId === id ? null : this.data.activeId });
  }
  write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
    this.data = data;
  }
}
module.exports = { ProfileStore };
