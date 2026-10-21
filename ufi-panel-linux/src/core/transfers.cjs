'use strict';
const { randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
function url(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.hash) throw new Error('请输入不含账号、密码和锚点的 HTTP(S) 地址');
  return u.href;
}
function targetHeaders(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 40) throw new Error('请求头须为对象（最多 40 项）');
  const headers = {};
  for (const [key, v] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (!/^[a-zA-Z0-9-]+$/.test(key) || typeof v !== 'string' || v.length > 4096 || /[\r\n]/.test(v)) throw new Error('无效请求头');
    if ((['host','content-length','connection','transfer-encoding','kano-t','kano-sign'].includes(lower) || ['host','content-length','connection','transfer-encoding'].includes(lower.replace(/^kano-/,'')))) throw new Error(`不允许覆盖 ${key}`);
    headers[['authorization','cookie'].includes(lower) ? 'kano-' + lower : lower] = v;
  }
  return headers;
}
function speedConfig(input) {
  const mode = input.mode; if (!['lan', 'download', 'upload', 'duplex'].includes(mode)) throw new Error('未知测速模式');
  const duration = Number(input.duration), threads = Number(input.threads);
  if (!Number.isInteger(duration) || duration < 3 || duration > 60 || !Number.isInteger(threads) || threads < 1 || threads > 3) throw new Error('测速时长为 3–60 秒，并发为 1–3');
  const endpoints = (direction, used) => {
    if (!used) return [];
    const values = input[direction + 'Endpoints'] || [{ url: input[direction], method: direction === 'download' ? 'GET' : 'POST' }];
    if (!Array.isArray(values) || !values.length || values.length > 20) throw new Error('每个方向需 1–20 个测速地址');
    return values.map(value => {
      const method = String(value.method || (direction === 'download' ? 'GET' : 'POST')).toUpperCase();
      if (!(direction === 'download' ? ['GET'] : ['POST','PUT']).includes(method)) throw new Error('下载只支持 GET，上传支持 POST/PUT');
      return { url: url(value.url), method, headers: targetHeaders(value.headers) };
    });
  };
  const downloadEndpoints = endpoints('download', ['download','duplex'].includes(mode));
  const uploadEndpoints = endpoints('upload', ['upload','duplex'].includes(mode));
  return { mode, duration, threads, downloadEndpoints, uploadEndpoints, download: downloadEndpoints[0]?.url || '', upload: uploadEndpoints[0]?.url || '' };
}
async function speedTest(client, config, { signal, update }) {
  const deadline = new AbortController(), combined = AbortSignal.any([signal, deadline.signal]);
  let received = 0, sent = 0, previousReceived = 0, previousSent = 0, previousTime = Date.now(), failure;
  const started = Date.now();
  const stop = setTimeout(() => deadline.abort(), config.duration * 1000);
  const timer = setInterval(() => {
    const at = Date.now(), seconds = (at - previousTime) / 1000;
    update({ stage: '正在测速', progress: Math.min(100, (at - started) / (config.duration * 10)), metrics: { elapsed: (at - started) / 1000, down: (received - previousReceived) / seconds, up: (sent - previousSent) / seconds, received, sent } });
    previousTime = at; previousReceived = received; previousSent = sent;
  }, 500);
  const payload = ['upload', 'duplex'].includes(config.mode) ? randomBytes(1024 * 1024) : null;
  let downIndex = 0, upIndex = 0;
  async function worker(direction) {
    while (!combined.aborted) {
      try {
        const download = direction === 'download';
        const candidates = download ? config.downloadEndpoints : config.uploadEndpoints;
        const selected = config.mode === 'lan' ? null : candidates[(download ? downIndex++ : upIndex++) % candidates.length];
        const endpoint = config.mode === 'lan' ? '/api/speedtest?ckSize=4' : '/api/proxy/--' + selected.url;
        await client.transport.request(endpoint, { method: selected?.method || 'GET', headers: { ...(download ? {} : { 'content-type': 'application/octet-stream' }), ...selected?.headers }, ...(download ? {} : { body: payload }), responseType: 'stream', legacyChunked: true, signal: combined, timeout: 32000, maxBytes: 8 * 1024 ** 3, onChunk: bytes => { if (download) received += bytes; } });
        if (!download) sent += payload.length;
      } catch (error) { if (!combined.aborted) { failure = error; deadline.abort(); } break; }
    }
  }
  try {
    const workers = [];
    for (let i = 0; i < config.threads; i++) {
      if (config.mode !== 'upload') workers.push(worker('download'));
      if (['upload', 'duplex'].includes(config.mode)) workers.push(worker('upload'));
    }
    await Promise.all(workers);
    if (failure) throw failure;
    if (signal.aborted) throw new Error('测速已取消');
    if (!received && !sent) throw new Error('没有收到有效测速数据，请检查服务器地址');
    const elapsed = (Date.now() - started) / 1000;
    const metrics = { elapsed, down: received / elapsed, up: sent / elapsed, received, sent };
    update({ metrics, progress: 100 }); return { ...metrics, mode: config.mode, measuredAt: Date.now(), note: '下载统计收到的字节；上传仅统计收到成功响应的完整请求，不含中途取消的数据。' };
  } finally { clearInterval(timer); clearTimeout(stop); deadline.abort(); }
}
async function observeDownload(client, { signal, update }, startUrl) {
  if (startUrl) await client.api('/api/download_apk', { method: 'POST', body: { apk_url: url(startUrl) }, signal });
  const until = Date.now() + 20 * 60 * 1000;
  while (!signal.aborted && Date.now() < until) {
    const info = await client.api('/api/download_apk_status', { signal });
    const n = Number(info.percent);
    update({ stage: info.status === 'done' ? '设备下载完成' : '设备正在下载', ...(Number.isFinite(n) ? { progress: Math.max(0, Math.min(100, n)) } : {}) });
    if (info.status === 'done') return info;
    if (info.status === 'error') throw new Error(info.error || '设备下载失败');
    if (info.status === 'idle' && !startUrl) return info;
    await delay(1500, undefined, { signal });
  }
  throw new Error(signal.aborted ? '已停止跟踪' : '下载跟踪超时，请重新查询设备状态');
}
async function installUpdate(client, { signal, update }) {
  const before = client.version?.app_ver;
  const info = await client.api('/api/download_apk_status', { signal });
  if (signal.aborted) throw new Error('操作已取消');
  if (info.status !== 'done') throw new Error('设备尚未完成安装包下载');
  update({ cancellable: false, stage: '设备正在安装，此阶段不能取消', state: 'waiting-device' });
  let accepted = false, installError;
  try { const r = await client.api('/api/install_apk', { method: 'POST', timeout: 180000 }); if (r.result !== 'success') throw new Error(r.error || '设备未确认安装结果'); accepted = true; }
  catch (e) { installError = e; }
  const until = Date.now() + 90000;
  while (!signal.aborted && !client.transport?.closed && Date.now() < until) {
    try {
      const version = await client.api('/api/version_info', { timeout: 3000 });
      if (version.app_ver && (accepted || version.app_ver !== before)) { client.version = version; return { before, after: version.app_ver, accepted, version }; }
    } catch { /* Read-only recovery probes; never re-submit the installation. */ }
    update({ stage: '等待设备服务恢复并读取版本' }); await delay(2000, undefined, { signal });
  }
  const error = new Error(`安装结果未确认，请重新连接检查版本${installError ? '：' + installError.message : ''}`); error.uncertain = true; throw error;
}
function multipartFile(name, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 10 * 1024 * 1024) throw new Error('上传文件不能超过 10 MB');
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const boundary = 'ufi-' + randomBytes(16).toString('hex');
  return { body: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safe}"\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
module.exports = { speedConfig, speedTest, observeDownload, installUpdate, multipartFile, url, targetHeaders };
