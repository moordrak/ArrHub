// ArrHub — one dashboard for Radarr, Sonarr, Prowlarr, Bazarr, NZBGet, qBittorrent, Seerr and Docker
// No external dependencies, requires Node.js 18+
// HTTP server and API routes; the rest lives in lib/
'use strict';

require('./lib/log');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { MSG, T, langStore } = require('./lib/i18n');
const config = require('./lib/config');
const { SERVICES, VERSION, settingsView } = config;
const { enabled } = require('./lib/net');
const { arr, qb, nzb, seerr, prowlarr, makeProwlarr, bazarr, makeBazarr, PAGE_SIZES, lookupPosters } = require('./lib/services');
const { libraryMedia, serviceIcon, cover } = require('./lib/media');
const { serviceLogs, noteService } = require('./lib/logs');
const { serviceLinks, about, friendlyError } = require('./lib/about');
const { saveSettings, testService } = require('./lib/settings');
const { dockerOn, sshKeygen, sshPublic, dockerErr } = require('./lib/docker/api');
const { dockerTest, dockerSummary, dockerContainers, dockerInfo, dk, checkUpdates, startUpdate, dockerAction, dockerLogs, jobs } = require('./lib/docker/containers');
const { stackList, stackRead, stackOp, dockerImages, removeImages } = require('./lib/docker/stacks');
const { npmTest, containerWeb } = require('./lib/docker/web');
const { wsAccept, dockerTerminal } = require('./lib/docker/terminal');

function requestLang(r) {
  const h = String(r.headers['x-lang'] || '').toLowerCase();
  if (MSG[h]) return h;
  const conf = config.cfg?.ui?.lang;
  if (MSG[conf]) return conf;
  return /^hr\b/i.test(r.headers['accept-language'] || '') ? 'hr' : 'en';
}


// ---------- HTTP server ----------
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
  if (!config.cfg.auth.user) return true;
  const h = r.headers.authorization || '';
  const [u, p] = Buffer.from(h.replace(/^Basic /, ''), 'base64').toString().split(/:(.*)/s);
  return u === config.cfg.auth.user && p === config.cfg.auth.pass;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const PUBLIC = path.join(__dirname, 'public');

const routes = {
  'GET /api/config': async () => ({ ...Object.fromEntries(SERVICES.map(k => [k, enabled(k)])), docker: dockerOn(), refresh: config.cfg.refresh, auth: !!config.cfg.auth.user, ui: config.cfg.ui, version: VERSION, links: serviceLinks() }),
  'GET /api/media': q => libraryMedia(q.get('refresh') === '1'),
  'GET /api/about': q => about(q.get('refresh') === '1'),
  'GET /api/icon/:svc': async (q, b, p) => {
    const ic = await serviceIcon(p.svc, q.get('refresh') === '1');
    // served under our origin: lock it down so an SVG can never run script here
    return { __raw: ic.buf, type: ic.type, headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff' } };
  },
  'GET /api/cover/:id': (q, b, p) => cover(p.id),
  'GET /api/settings': async () => settingsView(),
  'GET /api/logs/:src': (q, b, p) => serviceLogs(p.src),
  'POST /api/settings': (q, b) => saveSettings(b.values),
  'POST /api/settings/test': (q, b) => b.service === 'docker' ? dockerTest(b.values) : b.service === 'npm' ? npmTest(b.values) : testService(b.service, b.values),
  'GET /api/docker': () => dockerSummary(),
  'POST /api/settings/docker-sshkey': () => sshKeygen(),
  'GET /api/settings/docker-sshpub': () => sshPublic(),
  'GET /api/docker/containers': async q => ({ containers: await dockerContainers(q.get('stats') === '1'), info: await dockerInfo().catch(() => null), checkedAt: dk.checkedAt || null, checking: dk.checking }),
  'POST /api/docker/check': async () => { checkUpdates(true).catch(() => {}); return { checking: true }; },
  'POST /api/docker/containers/:id/update': (q, b, p) => startUpdate(p.id),
  'POST /api/docker/containers/:id/:action': (q, b, p) => dockerAction(p.id, p.action),
  'GET /api/docker/containers/:id/logs': (q, b, p) => dockerLogs(p.id, q.get('tail')),
  'GET /api/docker/containers/:id/web': (q, b, p) => containerWeb(p.id),
  'GET /api/docker/stacks': () => stackList(),
  'GET /api/docker/stacks/:name': (q, b, p) => { const s = stackRead(p.name); if (!s) throw dockerErr(T('notFound'), { status: 404 }); return s; },
  'POST /api/docker/stacks/:name/:op': (q, b, p) => stackOp(p.name, p.op, b || {}),
  'GET /api/docker/images': () => dockerImages(),
  'POST /api/docker/images/remove': (q, b) => removeImages(b.ids, b.all === true),
  'GET /api/docker/jobs/:id': (q, b, p) => { const j = jobs.get(p.id); if (!j) throw dockerErr(T('notFound'), { status: 404 }); return j; },
  'GET /api/radarr': () => arr('radarr').summary(),
  'GET /api/sonarr': () => arr('sonarr').summary(),
  'GET /api/qbittorrent': () => qb.summary(),
  'GET /api/nzbget': () => nzb.summary(),
  'GET /api/seerr': q => seerr.summary(q.get('filter') || 'all', q.get('page'), q.get('size')),
  'POST /api/seerr/action': (q, b) => seerr.action(b.id, b.action),
  'GET /api/prowlarr': () => prowlarr.summary(),
  'POST /api/prowlarr/test': () => makeProwlarr(config.cfg.prowlarr).testAll(),
  'POST /api/prowlarr/sync': () => makeProwlarr(config.cfg.prowlarr).syncApps(),
  'GET /api/bazarr': () => bazarr.summary(),
  'POST /api/bazarr/search': () => makeBazarr(config.cfg.bazarr).searchWanted(),
  'GET /api/:svc/history': async (q, b, p) => {
    const size = PAGE_SIZES.includes(Number(q.get('size'))) ? Number(q.get('size')) : 10;
    const page = Math.max(1, Math.floor(Number(q.get('page'))) || 1);
    const src = p.svc === 'radarr' || p.svc === 'sonarr' ? arr(p.svc) : p.svc === 'nzbget' ? nzb : p.svc === 'qbittorrent' ? qb : p.svc === 'prowlarr' ? prowlarr : p.svc === 'bazarr' ? bazarr : null;
    if (!src) { const e = new Error(T('notFound')); e.status = 404; throw e; }
    if (!enabled(p.svc)) { const e = new Error(T('notConfigured', { svc: p.svc })); e.status = 400; throw e; }
    const d = await src.history(page, size);
    return { ...d, page, pageSize: size, pages: Math.max(1, Math.ceil(d.total / size)) };
  },
  'GET /api/:arr/lookup': async (q, b, p) => lookupPosters(await arr(p.arr).lookup(q.get('term') || '')),
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

const server = http.createServer((r, res) => langStore.run(requestLang(r), () => handle(r, res).catch(e => {
  // never let one bad request take the whole server down
  console.error(new Date().toISOString(), 'request failed:', r.method, String(r.url).slice(0, 200), '-', e?.message || e);
  try { if (!res.headersSent) send(res, 400, { error: T('badRequest') }); else res.end(); } catch {}
})));
server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {} });
// WebSocket: /api/docker/containers/<id>/terminal?cols=&rows=
server.on('upgrade', (r, socket, head) => {
  socket.on('error', () => {});
  const u = new URL(r.url, 'http://x');
  const m = /^\/api\/docker\/containers\/([^/]+)\/terminal$/.exec(u.pathname);
  if (!m) return socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
  if (!checkAuth(r)) return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
  if (!dockerOn()) return socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  const ws = wsAccept(r, socket, head);
  if (!ws) return;
  langStore.run(requestLang(r), () => dockerTerminal(ws, decodeURIComponent(m[1]), Number(u.searchParams.get('cols')) || 80, Number(u.searchParams.get('rows')) || 24)
    .catch(e => console.warn('docker: terminal – ' + e.message)));
});
// last line of defence: log and keep running instead of exiting
process.on('uncaughtException', e => console.error(new Date().toISOString(), 'uncaught error (ArrHub keeps running):', e?.stack || e));
process.on('unhandledRejection', e => console.error(new Date().toISOString(), 'unhandled rejection (ArrHub keeps running):', e?.stack || e));
async function handle(r, res) {
  if (!checkAuth(r)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="ArrHub"' });
    return res.end(T('loginRequired'));
  }
  const u = new URL(r.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const m = match(r.method, u.pathname);
    if (!m) return send(res, 404, { error: T('notFound') });
    const svc = u.pathname.split('/')[2];
    if (svc === 'docker' && !dockerOn()) return send(res, 400, { error: T('dockerNotConfigured') });
    if (!['config', 'settings', 'media', 'cover', 'about', 'icon', 'logs', 'docker'].includes(svc) && !enabled(svc)) return send(res, 400, { error: T('notConfigured', { svc }) });
    try {
      const body = r.method === 'POST' ? await readBody(r) : {};
      const out = await m.fn(u.searchParams, body, m.params);
      if (out?.__raw) {
        res.writeHead(200, { 'Content-Type': out.type, 'Cache-Control': 'private, max-age=86400', ...(out.headers || {}) });
        return res.end(out.__raw);
      }
      if (r.method === 'GET' && (SERVICES.includes(svc) || svc === 'docker') && u.pathname === `/api/${svc}`) noteService(svc);
      send(res, 200, out ?? { ok: true });
    } catch (e) {
      const msg = friendlyError(e);
      const logMsg = langStore.run('en', () => friendlyError(e));   // ArrHub's own log is always English
      if (SERVICES.includes(svc)) {
        if (r.method === 'GET' && u.pathname === `/api/${svc}`) noteService(svc, logMsg);
        else if (r.method === 'POST') console.warn(`${svc}: ${u.pathname.split('/').slice(3).join('/') || 'action'} – ${logMsg}`);
      } else if (svc === 'docker') {
        if (u.pathname === '/api/docker') noteService('docker', logMsg);
        else console.warn(`docker: ${u.pathname.split('/').slice(3).join('/')} – ${logMsg}`);
      }
      else if (svc === 'logs' || svc === 'cover') { /* logs: shown in the tab; covers: logged once per service in cover() */ }
      else console.warn(`${u.pathname}: ${logMsg}`);
      send(res, e.status || (svc === 'settings' && !u.pathname.endsWith('/test') ? 400 : 502), { error: msg });
    }
    return;
  }
  let file = path.normalize(path.join(PUBLIC, u.pathname === '/' ? 'index.html' : u.pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, T('forbidden'), 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, T('notFound'), 'text/plain');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

server.listen(config.cfg.port, () => {
  const on = SERVICES.filter(enabled);
  console.log(`ArrHub ${VERSION} listening on http://0.0.0.0:${config.cfg.port} — services: ${on.join(', ') || 'none (configure them in Settings)'}`);
});
