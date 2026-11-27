// Web pages of containers: published ports, labels, ArrHub's services and Nginx Proxy Manager hosts
'use strict';

const tls_ = require('tls');
const http_ = require('http');
const https_ = require('https');
const os_ = require('os');
const { T, langStore } = require('../i18n');
const config = require('../config');
const { SERVICES, mergeInput } = config;
const { enabled } = require('../net');
const { friendlyError } = require('../about');
const { dockerTarget, dockerApi, dockerErr } = require('./api');

// ---- web pages of containers: published TCP ports on the Docker host, or a label ----
function dockerWebHost() {
  if (config.cfg.docker?.webHost) return String(config.cfg.docker.webHost).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const t = (() => { try { return dockerTarget(); } catch { return null; } })();
  if (t?.ssh) return t.ssh.host;
  if (t?.url) return t.url.hostname;
  // unix socket: the Docker host is this machine – its first LAN address
  for (const list of Object.values(os_.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return null;                                   // browser falls back to the address ArrHub was opened with
}
// which of ArrHub's services is this container? (name, compose service or image)
const SVC_MATCH = { radarr: /radarr/, sonarr: /sonarr/, nzbget: /nzbget/, qbittorrent: /qbittorrent/, prowlarr: /prowlarr/, bazarr: /bazarr/, seerr: /(^|[\s\/_.-])(seerr|overseerr|jellyseerr)([\s:\/_.-]|$)/ };
function serviceOf(c, image) {
  const hay = `${(c.Names?.[0] || '').replace(/^\//, '')} ${c.Labels?.['com.docker.compose.service'] || ''} ${image || c.Image || ''}`.toLowerCase();
  return SERVICES.find(k => enabled(k) && SVC_MATCH[k]?.test(hay)) || null;
}
const cleanUrl = u => { try { const x = new URL(u); x.username = ''; x.password = ''; return x.toString().replace(/\/+$/, '') + '/'; } catch { return null; } };
// addresses to open a container at, best first: label → https (NPM, ArrHub's service settings) → http → published ports
function webLinks(c, image) {
  const cand = [];
  const add = (url, label, rank) => { if (url) cand.push({ url, label, rank }); };
  const L = c.Labels || {};
  for (const k of ['arrhub.url', 'homepage.href']) if (/^https?:\/\//i.test(L[k] || '')) add(L[k].trim(), L[k].trim().replace(/^https?:\/\//i, '').replace(/\/$/, ''), 0);
  // Nginx Proxy Manager proxy hosts that forward to this container
  const name = (c.Names?.[0] || '').replace(/^\//, '').toLowerCase();
  const names = new Set([name, String(L['com.docker.compose.service'] || '').toLowerCase()].filter(Boolean));
  const cIps = Object.values(c.NetworkSettings?.Networks || {}).map(n => n.IPAddress).filter(Boolean);
  const pub = new Set((c.Ports || []).filter(p => p.PublicPort && p.Type === 'tcp').map(p => p.PublicPort));
  const priv = new Set((c.Ports || []).filter(p => p.Type === 'tcp').map(p => p.PrivatePort));
  const dHost = String(dockerWebHost() || '').toLowerCase();
  for (const h of npmState.hosts) {
    // forwarded to the container itself (by name or IP – then any port, it may not be published) or to a port on the Docker host
    const toContainer = names.has(h.host) || cIps.includes(h.host) || h.ips.some(ip => cIps.includes(ip));
    const toDockerHost = h.host === dHost || h.ips.some(ip => npmState.dockerIps.includes(ip));
    if (toContainer || (toDockerHost && pub.has(h.port)))
      add(`${h.https ? 'https' : 'http'}://${h.domain}/`, h.domain, h.https ? 1 : 3);
  }
  // the address of the matching service in ArrHub's settings (its link first, then its URL)
  const svc = serviceOf(c, image);
  if (svc) for (const u of [config.cfg[svc].link, config.cfg[svc].url]) { const x = u && cleanUrl(u); if (x) add(x, x.replace(/^https?:\/\//, '').replace(/\/$/, ''), x.startsWith('https:') ? 2 : 4); }
  const host = dockerWebHost(), hh = host && host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  for (const p of c.Ports || []) {
    if (!p.PublicPort || p.Type !== 'tcp' || /^127\.|^::1$/.test(p.IP || '')) continue;
    const https = [443, 8443, 9443].includes(p.PrivatePort) || [443, 8443, 9443].includes(p.PublicPort);
    add(`${https ? 'https' : 'http'}://${hh || '{host}'}:${p.PublicPort}/`, `:${p.PublicPort}`, https ? 2 : 5);
  }
  const seen = new Set();
  return cand.sort((a, b) => a.rank - b.rank).filter(x => !seen.has(x.url) && seen.add(x.url)).map(({ url, label }) => ({ url, label }));
}

// ---- Nginx Proxy Manager: read its proxy hosts (every 5 min) ----
const dns_ = require('dns');
const npmState = { hosts: [], dockerIps: [], at: 0, err: null, run: null };
function npmReq(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), isTls = u.protocol === 'https:';
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const o = { method, headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, timeout: 10000 };
    if (isTls && config.caState?.pem?.length) o.ca = [...tls_.rootCertificates, ...config.caState.pem];
    const r = (isTls ? https_ : http_).request(u, o, res => {
      let b = ''; res.on('data', d => { b += d; }); res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) return reject(new Error(T('npmAuth')));
        if (res.statusCode === 404) return reject(new Error(T('npmNotNpm')));
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(b)); } catch { reject(new Error(T('npmNotNpm'))); }
      });
    });
    r.on('timeout', () => r.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    r.on('error', e => reject(Object.assign(new TypeError('fetch failed'), { cause: e })));
    if (payload) r.write(payload);
    r.end();
  });
}
const lookupAll = async h => { if (!h) return []; if (/^[\d.]+$|:/.test(h)) return [h]; try { return (await dns_.promises.lookup(h, { all: true })).map(a => a.address); } catch { return []; } };
async function npmLoad(c = config.cfg.npm || {}) {
  if (!c.url) return { hosts: [] };
  const tok = await npmReq('POST', `${c.url}/api/tokens`, { identity: c.user || '', secret: c.pass || '' });
  if (!tok?.token) throw new Error(T('npmAuth'));
  const list = await npmReq('GET', `${c.url}/api/nginx/proxy-hosts`, null, tok.token);
  if (!Array.isArray(list)) throw new Error(T('npmNotNpm'));
  const hosts = await Promise.all(list.filter(h => h.enabled !== false && h.enabled !== 0 && h.domain_names?.length).map(async h => ({
    domain: String(h.domain_names[0]).toLowerCase(), https: Number(h.certificate_id) > 0 || h.certificate_id === 'new',
    host: String(h.forward_host || '').toLowerCase(), port: Number(h.forward_port), ips: await lookupAll(String(h.forward_host || '').toLowerCase()),
  })));
  return { hosts };
}
function npmRefresh(force) {
  if (!config.cfg.npm?.url) { npmState.hosts = []; return Promise.resolve(); }
  if (npmState.run) return npmState.run;
  if (!force && Date.now() - npmState.at < 5 * 60e3) return Promise.resolve();
  npmState.run = (async () => {
    try {
      const [{ hosts }, ips] = await Promise.all([npmLoad(), lookupAll(String(dockerWebHost() || '').toLowerCase())]);
      npmState.hosts = hosts; npmState.dockerIps = ips; npmState.err = null;
    } catch (e) { npmState.err = langStore.run('en', () => friendlyError(e)); console.warn('npm: could not read proxy hosts – ' + npmState.err); }
    finally { npmState.at = Date.now(); npmState.run = null; }
  })();
  return npmState.run;
}
async function npmTest(values) {
  const c = mergeInput(values || {});
  if (!/^https?:\/\/[^/]/i.test(c.npm?.url || '')) throw new Error(T('npmBadUrl'));
  const { hosts } = await npmLoad(c.npm);
  return { ok: true, message: T('npmOk', { n: hosts.length, https: hosts.filter(h => h.https).length }) };
}

// may the page be shown inside ArrHub? (X-Frame-Options / CSP frame-ancestors) – asked from the server, on the LAN
function frameCheck(url) {
  return new Promise(resolve => {
    let u; try { u = new URL(url); } catch { return resolve({ frameable: true }); }
    const mod = u.protocol === 'https:' ? https_ : http_;
    const r = mod.request(u, { method: 'GET', rejectUnauthorized: false, timeout: 5000, headers: { Accept: 'text/html' } }, res => {
      const xfo = String(res.headers['x-frame-options'] || '').toLowerCase();
      const fa = /frame-ancestors([^;]*)/i.exec(String(res.headers['content-security-policy'] || ''))?.[1]?.trim() || '';
      res.resume();
      if (xfo === 'deny' || xfo === 'sameorigin') return resolve({ frameable: false, reason: `X-Frame-Options: ${xfo.toUpperCase()}` });
      if (fa && !/(^|\s)\*(\s|$)/.test(fa)) return resolve({ frameable: false, reason: `Content-Security-Policy: frame-ancestors ${fa}` });
      resolve({ frameable: true, status: res.statusCode });
    });
    r.on('timeout', () => { r.destroy(); resolve({ frameable: true, unreachable: true }); });
    r.on('error', () => resolve({ frameable: true, unreachable: true }));
    r.end();
  });
}
async function containerWeb(id) {
  const list = await dockerApi('GET', '/containers/json?all=1');
  const c = list.find(x => x.Id === id || x.Id.startsWith(id) || (x.Names || []).includes('/' + id));
  if (!c) throw dockerErr(T('notFound'), { status: 404 });
  await npmRefresh();
  const links = webLinks(c, c.Image);
  return { name: (c.Names?.[0] || '').replace(/^\//, ''), links: await Promise.all(links.map(async l => ({ ...l, ...(l.url.includes('{host}') ? { frameable: true } : await frameCheck(l.url)) }))) };
}

module.exports = { npmState, npmRefresh, webLinks, npmTest, containerWeb };
