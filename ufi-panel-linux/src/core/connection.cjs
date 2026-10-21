'use strict';
const { UfiClient } = require('./client.cjs');
const { GoformClient } = require('./goform.cjs');
const { ZwrtClient } = require('./zwrt.cjs');
const { normalizeAddress } = require('./protocol.cjs');

// A new connection replaces the working session only after validation and saving.
class ConnectionManager {
  constructor(store, createClient = credentials => credentials.mode === 'ZWRT' ? new ZwrtClient(credentials) : credentials.mode === 'GOFORM' ? new GoformClient(credentials) : new UfiClient(credentials)) {
    this.store = store;
    this.createClient = createClient;
    this.current = null;
    this.pending = null;
    this.revision = 0;
  }
  cancel() {
    this.revision++;
    this.pending?.close();
    this.pending = null;
  }
  disconnect() {
    this.cancel();
    this.current?.client.close();
    this.current = null;
  }
  async connect(input) {
    this.cancel();
    const revision = this.revision;
    const address = normalizeAddress(input.address);
    const mode = input.mode || 'KANO';
    if (!['KANO', 'GOFORM', 'ZWRT'].includes(mode)) throw new Error('未知接入模式');
    const loginMethod = input.loginMethod || 'LOGIN';
    if (!['LOGIN', 'LOGIN_MULTI_USER'].includes(loginMethod)) throw new Error('未知原厂登录模式');
    const previous = this.store.list().profiles.find(p => p.id === input.id);
    let credentials = {};
    // Never forward a saved credential when the user changes the destination.
    if (previous?.address === address && (previous.mode || 'KANO') === mode) {
      try { credentials = this.store.credentials(input.id); }
      catch (error) { if (!(input.password || (mode !== 'KANO' && input.ztePassword))) throw error; }
    }
    if (this.current && this.current.profile.id === input.id && this.current.profile.address === address && (this.current.profile.mode || 'KANO') === mode) {
      credentials = { ...credentials, ...this.current.credentials };
    }
    credentials = {
      ...credentials, address, mode, loginMethod,
      ...(input.password ? { password: input.password, token: undefined } : {}),
      ...(input.ztePassword ? { ztePassword: input.ztePassword } : {}),
    };
    const candidate = this.createClient(credentials);
    this.pending = candidate;
    try {
      const info = await candidate.connect();
      if (revision !== this.revision) throw new Error('连接操作已取消');
      const profile = this.store.save({ ...input, address, mode, loginMethod }, credentials);
      const old = this.current;
      this.current = { client: candidate, profile, credentials };
      old?.client.close();
      return { profile, ...info };
    } catch (error) {
      candidate.close();
      throw error;
    } finally {
      if (this.pending === candidate) this.pending = null;
    }
  }
}
module.exports = { ConnectionManager };
