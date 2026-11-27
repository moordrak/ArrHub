// Outgoing HTTP(S) requests: timeouts, TLS options per service (self-signed / own CA), offline mode
'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const crypto_ = require('crypto');
const tls_ = require('tls');
const { T } = require('./i18n');
const config = require('./config');
const { SERVICES } = config;

const TIMEOUT = 10000;
const https_ = require('https');
const tlsStore = new AsyncLocalStorage();   // per-call override for Test connection: { allow, deny } sets of origins
const originOf = u => { try { return new URL(u).origin; } catch { return null; } };
// TLS options for a request: null = normal fetch; otherwise used by httpsFetch.
// Only the services' own https origins are affected: "accept self-signed" turns verification off,
// an own CA adds trusted roots (system CAs + own CA, full verification incl. host name).
function tlsFor(url) {
  const o = originOf(url);
  if (!o || !o.startsWith('https:')) return null;
  const t = tlsStore.getStore();
  const isService = t?.origin === o || SERVICES.some(k => config.cfg[k]?.url && originOf(config.cfg[k].url) === o);
  if (!isService) return null;
  const insecure = t?.deny.has(o) ? false : t?.allow.has(o) ? true : SERVICES.some(k => config.cfg[k]?.insecure && config.cfg[k].url && originOf(config.cfg[k].url) === o);
  if (insecure) return { agent: tlsAgent('insecure', { rejectUnauthorized: false }) };
  const ca = t && 'ca' in t ? t.ca : config.caState;
  if (ca?.pem?.length) {
    const key = 'ca:' + crypto_.createHash('sha256').update(ca.pem.join('')).digest('hex');
    return { agent: tlsAgent(key, () => ({ secureContext: tls_.createSecureContext({ ca: [...tls_.rootCertificates, ...ca.pem] }), rejectUnauthorized: true })) };
  }
  return null;
}
// One agent per TLS setup. The trusted set (system CAs + own CA) is built once, not on every connection,
// and each setup has its own connection pool and TLS session cache, so a session verified (or not verified)
// under one setup is never reused under another.
const tlsAgents = new Map();
function tlsAgent(key, opts) {
  let a = tlsAgents.get(key);
  if (!a) {
    if (tlsAgents.size >= 8) { const [k0, a0] = tlsAgents.entries().next().value; a0.destroy(); tlsAgents.delete(k0); }
    a = new https_.Agent({ keepAlive: true, ...(typeof opts === 'function' ? opts() : opts) });
    tlsAgents.set(key, a);
  }
  return a;
}
// fetch-compatible request over https with custom TLS options (see tlsFor)
function httpsFetch(url, { method = 'GET', headers = {}, body, redirect = 'follow', signal } = {}, tlsOpts = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const h = {};
    for (const [k, v] of Object.entries(headers instanceof Headers ? Object.fromEntries(headers) : headers)) h[k] = v;
    let payload = body;
    if (body instanceof URLSearchParams) { payload = body.toString(); h['Content-Type'] ??= 'application/x-www-form-urlencoded'; }
    if (payload !== undefined && payload !== null) h['Content-Length'] = Buffer.byteLength(payload);
    const r = https_.request(u, { method, headers: h, ...tlsOpts }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try {
        const status = res.statusCode || 502;
        const loc = res.headers.location;
        if (redirect === 'follow' && status >= 300 && status < 400 && loc && hops < 5) {
          const next = new URL(loc, u).toString();
          const sameOrigin = originOf(next) === u.origin;
          const o2 = { method: status === 303 ? 'GET' : method, headers, body: status === 303 ? undefined : body, redirect, signal };
          return resolve(sameOrigin && next.startsWith('https:') ? httpsFetch(next, o2, tlsOpts, hops + 1) : fetch(next, o2));
        }
        const hdrs = new Headers();
        for (const [k, v] of Object.entries(res.headers)) hdrs.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        const buf = Buffer.concat(chunks);
        resolve(new Response([101, 204, 205, 304].includes(status) ? null : buf, { status: Math.min(Math.max(status, 200), 599), headers: hdrs }));
      } catch (e) { reject(Object.assign(new TypeError('fetch failed'), { cause: e })); } });
      res.on('error', reject);
    });
    r.on('error', err => reject(Object.assign(new TypeError('fetch failed'), { cause: err })));
    if (signal) {
      if (signal.aborted) { r.destroy(); return reject(new DOMException('aborted', 'AbortError')); }
      signal.addEventListener('abort', () => { r.destroy(); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
    }
    if (payload !== undefined && payload !== null) r.write(payload);
    r.end();
  });
}
// in offline mode only the configured services (and the one being tested) may be contacted
function isServiceUrl(url) {
  const o = originOf(url);
  return !!o && (tlsStore.getStore()?.origin === o || SERVICES.some(k => config.cfg[k]?.url && originOf(config.cfg[k].url) === o));
}
async function req(url, { timeout = TIMEOUT, ...opts } = {}) {
  if (config.cfg.net?.offline && !isServiceUrl(url)) throw new Error(T('offlineBlocked', { host: originOf(url) || url }));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const tlsOpts = tlsFor(url);
    return await (tlsOpts ? httpsFetch(url, { ...opts, signal: ctrl.signal }, tlsOpts) : fetch(url, { ...opts, signal: ctrl.signal }));
  } finally { clearTimeout(t); }
}
async function json(url, opts) {
  const r = await req(url, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
function enabled(name) { return !!config.cfg[name]?.url; }

module.exports = { json, req, enabled, originOf, tlsStore };
