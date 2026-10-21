'use strict';
const { createHash, createHmac } = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

const KEY = 'minikano_kOyXz0Ciz4V7wR0IeKmJFYFQ20jd';
const sha = value => createHash('sha256').update(value).digest();
const hashPassword = value => sha(value).toString('hex');

function normalizeAddress(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error('请输入设备地址');
  const input = value.trim();
  const url = new URL(/^[a-z]+:\/\//i.test(input) ? input : `http://${input}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('设备地址仅支持 HTTP/HTTPS，不应包含账号、查询参数或锚点');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.some(p => !/^[a-zA-Z0-9._~-]+$/.test(p))) throw new Error('反向代理前缀包含不支持的字符');
  url.pathname = parts.length ? `/${parts.join('/')}/` : '/';
  return url.href.replace(/\/$/, '');
}

// Mirrors the APK's r74 interceptor: exclude query and strip reverse proxy prefix.
function canonicalPath(path) {
  let value = path.split('?')[0];
  if (/^\/+api\/proxy(?:\/|$)/.test(value)) return `/${value.replace(/^\/+/, '').replace(/\\/g, '/')}`;
  for (let i = 0; i < 2; i++) {
    try { value = decodeURIComponent(value.replace(/\+/g, ' ')); } catch { /* Malformed encoding stays literal. */ }
  }
  return `/${value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '')}`;
}

function sign(method, path, timestamp) {
  const hmac = createHmac('md5', KEY).update(`minikano${method.toUpperCase()}${canonicalPath(path)}${timestamp}`).digest();
  return sha(Buffer.concat([sha(hmac.subarray(0, 8)), sha(hmac.subarray(8))])).toString('hex');
}

class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'ApiError'; this.status = status; }
}

class Transport {
  constructor(address, authorization = '', { timeout = 10000, maxBytes = 6 * 1024 * 1024, apiPrefix = '/api/', signed = true } = {}) {
    this.address = normalizeAddress(address);
    this.authorization = authorization;
    this.timeout = timeout;
    this.maxBytes = maxBytes;
    this.apiPrefix = apiPrefix; this.signed = signed;
    this.pending = new Set();
    this.closed = false;
  }

  close() {
    this.closed = true;
    for (const request of this.pending) request.destroy(new ApiError('连接已关闭'));
    this.pending.clear();
  }

  async request(path, { method = 'GET', body, headers = {}, timeout = this.timeout, responseType = 'json', signal, onChunk, maxBytes = this.maxBytes, acceptAnyStatus = false, legacyChunked = false } = {}) {
    if (this.closed) throw new ApiError('连接已关闭');
    if (signal?.aborted) throw new ApiError('操作已取消');
    if (!path.startsWith(this.apiPrefix) || /[\r\n#]/.test(path) || path.startsWith('//')) throw new ApiError('无效的 API 路径');
    const url = new URL(this.address + path);
    const timestamp = String(Date.now());
    const payload = body === undefined ? undefined : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    const requestHeaders = {
      accept: 'application/json', ...headers,
      ...(this.signed ? { 'kano-t': timestamp, 'kano-sign': sign(method, path, timestamp), authorization: this.authorization } : {}),
    };
    if (payload !== undefined) {
      requestHeaders['content-type'] ||= 'application/json';
      requestHeaders['content-length'] = Buffer.byteLength(payload);
    }
    // Direct LAN requests: environment HTTP(S)_PROXY must not intercept device credentials.
    return new Promise((resolve, reject) => {
      const engine = url.protocol === 'https:' ? https : http;
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.pending.delete(request);
        error ? reject(error) : resolve(value);
      };
      const abort = () => request.destroy(new ApiError('操作已取消'));
      // Some UFI binary streams send both Content-Length and chunked encoding.
      // Only the bounded streaming reader opts in, on an isolated connection.
      const compatibility = legacyChunked && responseType === 'stream' && this.signed;
      const request = engine.request(url, { method, headers: requestHeaders, ...(compatibility ? { insecureHTTPParser: true, agent: false } : {}) }, response => {
        const chunks = [];
        let bytes = 0;
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            const error = new ApiError('设备响应超过大小限制');
            finish(error);
            request.destroy(error);
            response.destroy();
          } else if (responseType === 'stream') {
            if (response.statusCode >= 200 && response.statusCode < 300) onChunk?.(chunk.length);
          } else chunks.push(chunk);
        });
        response.on('error', error => finish(error));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = response.statusCode;
          if (!acceptAnyStatus && (status === 401 || status === 403)) return finish(new ApiError(this.signed ? '鉴权失败，请检查 UFI-TOOLS 登录口令和电脑时间' : '设备鉴权失败，请检查账号口令或重新登录', status));
          if (!acceptAnyStatus && status >= 300 && status < 400) return finish(new ApiError('设备返回重定向，请输入最终服务地址（含反代前缀）', status));
          if (responseType === 'stream') {
            if (status < 200 || status >= 300) return finish(new ApiError(`设备请求失败：HTTP ${status}`, status));
            return finish(null, { bytes, headers: response.headers, status });
          }
          if (responseType === 'text') {
            if (!acceptAnyStatus && (status < 200 || status >= 300)) return finish(new ApiError(`设备请求失败：HTTP ${status}`, status));
            return finish(null, { data: text, headers: response.headers, status });
          }
          let data;
          try { data = text ? JSON.parse(text) : {}; }
          catch { return finish(new ApiError(`设备未返回 JSON（HTTP ${status}），请检查端口和路径`, status)); }
          if (status < 200 || status >= 300 || data?.error) return finish(new ApiError((typeof data?.error === 'string' ? data.error : data?.error?.message || data?.error?.code) || `设备请求失败：HTTP ${status}`, status));
          finish(null, { data, headers: response.headers, status });
        });
      });
      this.pending.add(request);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(() => request.destroy(new ApiError('设备响应超时，请检查网络和地址')), timeout);
      request.on('error', error => finish(error instanceof ApiError ? error : new ApiError(`无法连接设备：${error.code || error.message}`)));
      request.end(payload);
    });
  }
}

module.exports = { sign, canonicalPath, hashPassword, normalizeAddress, Transport, ApiError };
