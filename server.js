// ArrHub — jedinstveno sučelje za Radarr, Sonarr, NZBGet i qBittorrent
// Bez vanjskih ovisnosti, potreban Node.js 18+
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------- Konfiguracija ----------
function loadConfig() {
  const file = process.env.ARRHUB_CONFIG || path.join(__dirname, 'config.json');
  let cfg = {};
  if (fs.existsSync(file)) cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const env = process.env;
  const pick = (a, b) => (a !== undefined && a !== '' ? a : b);
  cfg.port = Number(pick(env.PORT, cfg.port || 8686));
  cfg.auth = cfg.auth || {};
  cfg.auth.user = pick(env.ARRHUB_USER, cfg.auth.user);
  cfg.auth.pass = pick(env.ARRHUB_PASS, cfg.auth.pass);
  cfg.radarr = { url: pick(env.RADARR_URL, cfg.radarr?.url), apiKey: pick(env.RADARR_KEY, cfg.radarr?.apiKey) };
  cfg.sonarr = { url: pick(env.SONARR_URL, cfg.sonarr?.url), apiKey: pick(env.SONARR_KEY, cfg.sonarr?.apiKey) };
  cfg.nzbget = { url: pick(env.NZBGET_URL, cfg.nzbget?.url), user: pick(env.NZBGET_USER, cfg.nzbget?.user), pass: pick(env.NZBGET_PASS, cfg.nzbget?.pass) };
  cfg.qbittorrent = { url: pick(env.QBIT_URL, cfg.qbittorrent?.url), user: pick(env.QBIT_USER, cfg.qbittorrent?.user), pass: pick(env.QBIT_PASS, cfg.qbittorrent?.pass) };
  for (const k of ['radarr', 'sonarr', 'nzbget', 'qbittorrent']) {
    if (cfg[k].url) cfg[k].url = cfg[k].url.replace(/\/+$/, '');
  }
  return cfg;
}
const cfg = loadConfig();

// ---------- Pomoćne funkcije ----------
const TIMEOUT = 10000;
async function req(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    return r;
  } finally { clearTimeout(t); }
}
async function json(url, opts) {
  const r = await req(url, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
function enabled(name) { return !!cfg[name]?.url; }

// ---------- Radarr / Sonarr (API v3) ----------
function arr(name) {
  const c = cfg[name];
  const call = (p, opts = {}) => json(`${c.url}/api/v3${p}`, {
    ...opts,
    headers: { 'X-Api-Key': c.apiKey, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  return {
    async summary() {
      const start = new Date(); start.setDate(start.getDate() - 1);
      const end = new Date(); end.setDate(end.getDate() + 14);
      const [status, queue, calendar, health, disk] = await Promise.all([
        call('/system/status'),
        call(`/queue?pageSize=50&includeUnknownMovieItems=true&includeUnknownSeriesItems=true&include${name === 'radarr' ? 'Movie' : 'Series'}=true${name === 'sonarr' ? '&includeEpisode=true' : ''}`),
        call(`/calendar?start=${start.toISOString()}&end=${end.toISOString()}${name === 'sonarr' ? '&includeSeries=true' : ''}`),
        call('/health').catch(() => []),
        call('/diskspace').catch(() => []),
      ]);
      const history = await call('/history?pageSize=15&sortKey=date&sortDirection=descending' + (name === 'radarr' ? '&includeMovie=true' : '&includeSeries=true&includeEpisode=true')).catch(() => ({ records: [] }));
      return { version: status.version, queue: queue.records || [], calendar, health, disk, history: history.records || [] };
    },
    lookup(term) {
      return call(`/${name === 'radarr' ? 'movie' : 'series'}/lookup?term=${encodeURIComponent(term)}`);
    },
    async options() {
      const [profiles, roots] = await Promise.all([call('/qualityprofile'), call('/rootfolder')]);
      return { profiles: profiles.map(p => ({ id: p.id, name: p.name })), roots: roots.map(r => ({ path: r.path, free: r.freeSpace })) };
    },
    async add(item, qualityProfileId, rootFolderPath, search) {
      const body = { ...item, qualityProfileId, rootFolderPath, monitored: true };
      if (name === 'radarr') body.addOptions = { searchForMovie: !!search };
      else { body.addOptions = { searchForMissingEpisodes: !!search, monitor: 'all' }; body.seasonFolder = true; }
      delete body.id;
      return call(`/${name === 'radarr' ? 'movie' : 'series'}`, { method: 'POST', body: JSON.stringify(body) });
    },
    removeQueue(id, blocklist) {
      return call(`/queue/${id}?removeFromClient=true&blocklist=${!!blocklist}`, { method: 'DELETE' });
    },
    command(nameCmd) {
      return call('/command', { method: 'POST', body: JSON.stringify({ name: nameCmd }) });
    },
  };
}

// ---------- qBittorrent (Web API v2) ----------
const qb = {
  sid: null,
  async login() {
    const c = cfg.qbittorrent;
    const r = await req(`${c.url}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: c.url },
      body: new URLSearchParams({ username: c.user || '', password: c.pass || '' }),
    });
    const txt = await r.text();
    const cookie = r.headers.get('set-cookie') || '';
    const m = cookie.match(/SID=([^;]+)/);
    if (m) this.sid = m[1];
    else if (!/Ok/i.test(txt)) throw new Error('qBittorrent prijava nije uspjela: ' + txt);
  },
  async call(p, form) {
    const c = cfg.qbittorrent;
    if (!this.sid) await this.login().catch(e => { if (c.user) throw e; });
    const doIt = () => req(`${c.url}/api/v2${p}`, {
      method: form ? 'POST' : 'GET',
      headers: {
        Referer: c.url,
        ...(this.sid ? { Cookie: `SID=${this.sid}` } : {}),
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form ? new URLSearchParams(form) : undefined,
    });
    let r = await doIt();
    if (r.status === 403) { await this.login(); r = await doIt(); }
    const text = await r.text();
    if (!r.ok) throw new Error(`${r.status}: ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { return text; }
  },
  async summary() {
    const [transfer, torrents, version] = await Promise.all([
      this.call('/transfer/info'),
      this.call('/torrents/info?sort=added_on&reverse=true'),
      this.call('/app/version').catch(() => ''),
    ]);
    return { version, transfer, torrents };
  },
  // qBittorrent 5.x koristi stop/start, starije verzije pause/resume
  async action(action, hashes, deleteFiles) {
    const h = { hashes: hashes.join('|') };
    if (action === 'delete') return this.call('/torrents/delete', { ...h, deleteFiles: String(!!deleteFiles) });
    const map = { pause: ['stop', 'pause'], resume: ['start', 'resume'] }[action];
    if (!map) throw new Error('Nepoznata akcija');
    try { return await this.call(`/torrents/${map[0]}`, h); }
    catch { return this.call(`/torrents/${map[1]}`, h); }
  },
  globalAction(action) {
    if (action === 'altspeed') return this.call('/transfer/toggleSpeedLimitsMode', {});
    return this.action(action, ['all']);
  },
};

// ---------- NZBGet (JSON-RPC) ----------
const nzb = {
  async rpc(method, params = []) {
    const c = cfg.nzbget;
    const headers = { 'Content-Type': 'application/json' };
    if (c.user) headers.Authorization = 'Basic ' + Buffer.from(`${c.user}:${c.pass || ''}`).toString('base64');
    const res = await json(`${c.url}/jsonrpc`, { method: 'POST', headers, body: JSON.stringify({ method, params, id: 1 }) });
    if (res.error) throw new Error(res.error.message || JSON.stringify(res.error));
    return res.result;
  },
  async summary() {
    const [status, groups, history, version] = await Promise.all([
      this.rpc('status'), this.rpc('listgroups', [0]), this.rpc('history', [false]), this.rpc('version').catch(() => ''),
    ]);
    return { version, status, groups, history: history.slice(0, 15) };
  },
  async action(action, ids) {
    if (action === 'pauseall') return this.rpc('pausedownload');
    if (action === 'resumeall') return this.rpc('resumedownload');
    const cmd = { pause: 'GroupPause', resume: 'GroupResume', delete: 'GroupFinalDelete' }[action];
    if (!cmd) throw new Error('Nepoznata akcija');
    return this.rpc('editqueue', [cmd, '', ids.map(Number)]);
  },
};

// ---------- HTTP poslužitelj ----------
function send(res, code, data, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}
function readBody(r) {
  return new Promise((ok, fail) => {
    let b = '';
    r.on('data', d => { b += d; if (b.length > 1e6) r.destroy(); });
    r.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { fail(e); } });
    r.on('error', fail);
  });
}
function checkAuth(r) {
  if (!cfg.auth.user) return true;
  const h = r.headers.authorization || '';
  const [u, p] = Buffer.from(h.replace(/^Basic /, ''), 'base64').toString().split(/:(.*)/s);
  return u === cfg.auth.user && p === cfg.auth.pass;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const PUBLIC = path.join(__dirname, 'public');

const routes = {
  'GET /api/config': async () => ({ radarr: enabled('radarr'), sonarr: enabled('sonarr'), nzbget: enabled('nzbget'), qbittorrent: enabled('qbittorrent') }),
  'GET /api/radarr': () => arr('radarr').summary(),
  'GET /api/sonarr': () => arr('sonarr').summary(),
  'GET /api/qbittorrent': () => qb.summary(),
  'GET /api/nzbget': () => nzb.summary(),
  'GET /api/:arr/lookup': (q, b, p) => arr(p.arr).lookup(q.get('term') || ''),
  'GET /api/:arr/options': (q, b, p) => arr(p.arr).options(),
  'POST /api/:arr/add': (q, b, p) => arr(p.arr).add(b.item, b.qualityProfileId, b.rootFolderPath, b.search),
  'POST /api/:arr/queue/remove': (q, b, p) => arr(p.arr).removeQueue(b.id, b.blocklist),
  'POST /api/:arr/command': (q, b, p) => arr(p.arr).command(b.name),
  'POST /api/qbittorrent/action': (q, b) => qb.action(b.action, b.hashes || [], b.deleteFiles),
  'POST /api/qbittorrent/global': (q, b) => qb.globalAction(b.action),
  'POST /api/nzbget/action': (q, b) => nzb.action(b.action, b.ids || []),
};

function match(method, pathname) {
  for (const [key, fn] of Object.entries(routes)) {
    const [m, pat] = key.split(' ');
    if (m !== method) continue;
    const a = pat.split('/'), b = pathname.split('/');
    if (a.length !== b.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i].startsWith(':')) params[a[i].slice(1)] = b[i];
      else if (a[i] !== b[i]) { ok = false; break; }
    }
    if (ok && params.arr && !['radarr', 'sonarr'].includes(params.arr)) continue;
    if (ok) return { fn, params };
  }
  return null;
}

const server = http.createServer(async (r, res) => {
  if (!checkAuth(r)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="ArrHub"' });
    return res.end('Potrebna prijava');
  }
  const u = new URL(r.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const m = match(r.method, u.pathname);
    if (!m) return send(res, 404, { error: 'Nije pronađeno' });
    const svc = u.pathname.split('/')[2];
    if (svc !== 'config' && !enabled(svc)) return send(res, 400, { error: `${svc} nije konfiguriran` });
    try {
      const body = r.method === 'POST' ? await readBody(r) : {};
      send(res, 200, (await m.fn(u.searchParams, body, m.params)) ?? { ok: true });
    } catch (e) {
      send(res, 502, { error: e.name === 'AbortError' ? 'Isteklo vrijeme čekanja' : e.message });
    }
    return;
  }
  let file = path.normalize(path.join(PUBLIC, u.pathname === '/' ? 'index.html' : u.pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Zabranjeno', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Nije pronađeno', 'text/plain');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
});

server.listen(cfg.port, () => {
  const on = ['radarr', 'sonarr', 'nzbget', 'qbittorrent'].filter(enabled);
  console.log(`ArrHub radi na http://0.0.0.0:${cfg.port} — usluge: ${on.join(', ') || 'nijedna (provjeri config.json)'}`);
});
