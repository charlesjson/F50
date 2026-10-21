(() => {
  const session = __UFI_WEB_SESSION__;
  const prefix = session.path.replace(/\/$/, '');
  if (window !== top || location.origin !== session.origin || !(location.pathname === prefix || location.pathname.startsWith(prefix + '/'))) return;

  // UFI's host UI reads these keys before loading any plugins. Supply the
  // validated connection's credentials in memory, without a plaintext copy in
  // WebKit's persistent localStorage. Other origins/ports receive no credentials.
  const store = localStorage, prototype = Storage.prototype;
  const get = prototype.getItem, set = prototype.setItem, remove = prototype.removeItem, clear = prototype.clear;
  const credentials = new Map([
    ['kano_sms_token', session.authorization], ['kano_sms_pwd', session.password || null],
    ['kano_remembered_loginfo', null], ['login_method', session.loginMethod],
  ]);
  for (const key of credentials.keys()) remove.call(store, key);
  let lastLogin = { authorization: session.authorization, password: session.password || '', loginMethod: session.loginMethod };
  window.__ufiRestoreWebSession = () => {
    credentials.set('kano_sms_token', lastLogin.authorization);
    credentials.set('kano_sms_pwd', lastLogin.password || null);
    credentials.set('login_method', lastLogin.loginMethod);
    try { if (typeof KANO_TOKEN !== 'undefined') KANO_TOKEN = lastLogin.authorization; } catch {}
    try { if (typeof KANO_PASSWORD !== 'undefined') KANO_PASSWORD = lastLogin.password; } catch {}
    try { if (typeof common_headers === 'object') common_headers.authorization = lastLogin.authorization; } catch {}
  };
  let pending = false;
  const changed = () => {
    if (credentials.get('kano_sms_token')) lastLogin = {
      authorization: credentials.get('kano_sms_token'), password: credentials.get('kano_sms_pwd') || '',
      loginMethod: credentials.get('login_method'),
    };
    if (pending) return;
    pending = true;
    Promise.resolve().then(() => {
      pending = false;
      window.webkit?.messageHandlers?.ufiWebSession?.postMessage(JSON.stringify({
        nonce: session.nonce, authorization: credentials.get('kano_sms_token') || '',
        password: credentials.get('kano_sms_pwd') || '', loginMethod: credentials.get('login_method'),
      }));
    });
  };
  prototype.getItem = function(key) {
    key = String(key);
    return this === store && credentials.has(key) ? credentials.get(key) : get.call(this, key);
  };
  prototype.setItem = function(key, value) {
    key = String(key);
    if (this === store && credentials.has(key)) { credentials.set(key, String(value)); changed(); return; }
    return set.call(this, key, value);
  };
  prototype.removeItem = function(key) {
    key = String(key);
    if (this === store && credentials.has(key)) { credentials.set(key, null); changed(); return; }
    return remove.call(this, key);
  };
  prototype.clear = function() {
    if (this === store) { for (const key of credentials.keys()) credentials.set(key, null); changed(); }
    return clear.call(this);
  };
})();
