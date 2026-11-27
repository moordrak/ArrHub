// Library images (backgrounds, covers) and the services' own icons
'use strict';

const { T, langStore } = require('./i18n');
const config = require('./config');
const { SERVICES } = config;
const { hashId, coverMap } = require('./util');
const { enabled, req } = require('./net');
const { arr, qb } = require('./services');
const { friendlyError } = require('./about');

// ---------- Library images (backgrounds) ----------
// The client only gets /api/cover/<id>; real URLs (local MediaCover + remote TMDB/TVDB) stay on the server.
const mediaCache = { at: 0, data: null, pending: null };

const coverFail = new Map(); // svc -> { n, last } failed local fetches (after a few, go straight to remote)
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function remoteSized(u, kind) {
  if (!u || !/^https:\/\//.test(u)) return null;
  // TMDB serves smaller image sizes
  return u.replace(/(image\.tmdb\.org\/t\/p\/)original\//, `$1${kind === 'poster' ? 'w342' : 'w1280'}/`);
}
async function buildMedia() {
  const posters = [], fanart = [], stats = {};
  await Promise.all(['radarr', 'sonarr'].filter(enabled).map(async k => {
    const st = stats[k] = { items: 0, posters: 0, fanart: 0, error: null };
    let list;
    try { list = await arr(k).call(k === 'radarr' ? '/movie' : '/series', { timeout: 90000 }); }
    catch (e) { st.error = friendlyError(e); return; }
    if (!Array.isArray(list)) { st.error = T('unexpectedResponse'); return; }
    st.items = list.length;
    for (const it of list) for (const im of it.images || []) {
      const kind = im.coverType === 'poster' ? 'poster' : im.coverType === 'fanart' ? 'fanart' : null;
      if (!kind) continue;
      let local = null;
      if (im.url && /\/MediaCover\//.test(im.url) && !im.url.includes('..')) {
        let u = im.url.startsWith('http') ? im.url : null;
        if (!u) { try { u = new URL(im.url, new URL(config.cfg[k].url).origin + '/').toString(); } catch {} }
        if (u && kind === 'poster') u = u.replace(/poster(\.jpg)/, 'poster-500$1');
        // /api/v3/mediacover/<id>/<file> accepts the API key even when Radarr/Sonarr require a login
        // (the plain /MediaCover/ path then redirects to the login page); the plain path stays as fallback
        const m = u && /\/MediaCover\/(\d+)\/([^/?#]+\.(?:jpe?g|png|gif))/i.exec(u);
        local = m ? [`${config.cfg[k].url}/api/v3/mediacover/${m[1]}/${m[2]}`, u] : u;
      }
      const remote = config.cfg.net?.offline ? null : remoteSized(im.remoteUrl, kind);
      if (!local && !remote) continue;
      const id = hashId(k + (im.url || im.remoteUrl));
      coverMap.set(id, { svc: k, local, remote, kind });
      (kind === 'poster' ? posters : fanart).push(`/api/cover/${id}`);
      if (kind === 'poster' && !st.sample) st.sample = `/api/cover/${id}`;
      st[kind === 'poster' ? 'posters' : 'fanart']++;
    }
  }));
  if (coverMap.size > 20000) [...coverMap.keys()].slice(0, coverMap.size - 20000).forEach(k => coverMap.delete(k));
  return { posters: shuffle(posters).slice(0, 150), fanart: shuffle(fanart).slice(0, 80), stats };
}
async function libraryMedia(force) {
  const ok = mediaCache.data && (mediaCache.data.posters.length || mediaCache.data.fanart.length);
  const ttl = ok ? 10 * 60000 : 30000; // empty/failed result is cached for 30 s only
  if (!force && mediaCache.data && Date.now() - mediaCache.at < ttl) return mediaCache.data;
  mediaCache.pending ||= buildMedia().then(d => { mediaCache.data = d; mediaCache.at = Date.now(); return d; })
    .finally(() => { mediaCache.pending = null; });
  return mediaCache.pending;
}
async function fetchImage(url, headers) {
  const r = await req(url, { headers, redirect: 'manual', timeout: 20000 });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !/^image\//.test(type)) {
    r.body?.cancel?.();
    if (r.status >= 300 && r.status < 400) throw new Error(T('imgRedirect', { status: r.status }));
    if (r.status === 401 || r.status === 403) throw new Error(T('imgDenied', { status: r.status }));
    if (r.status === 404) throw new Error(T('img404'));
    if (r.ok) throw new Error(T('notImage', { type: type.split(';')[0] || '?' }));
    throw new Error(`HTTP ${r.status}`);
  }
  return { __raw: Buffer.from(await r.arrayBuffer()), type };
}
async function cover(id) {
  const e = coverMap.get(id);
  if (!e) throw new Error(T('unknownImage'));
  const c = config.cfg[e.svc];
  const errors = [];
  const fail = coverFail.get(e.svc) || { n: 0, last: '' };
  const locals = [].concat(e.local || []);
  if (locals.length && fail.n >= 5) errors.push(`${e.svc} ${T('local')}: ${fail.last}`);
  if (locals.length && fail.n < 5) {
    let m = '';
    for (const l of locals) {
      try {
        const u = new URL(l);
        u.searchParams.set('apikey', c.apiKey);
        const img = await fetchImage(u.toString(), { 'X-Api-Key': c.apiKey });
        coverFail.delete(e.svc);
        return img;
      } catch (err) { m = friendlyError(err); }
    }
    errors.push(`${e.svc} ${T('local')}: ${m}`);
    if (!fail.n) langStore.run('en', () => console.warn(`${e.svc}: local images failing – ${m}`));
    coverFail.set(e.svc, { n: fail.n + 1, last: m });
  }
  if (e.remote && config.cfg.net?.offline) errors.push(T('offlineNoRemote'));
  else if (e.remote) {
    try { return await fetchImage(e.remote, { 'User-Agent': 'ArrHub' }); }
    catch (err) { errors.push('TMDB/TVDB: ' + friendlyError(err)); }
  } else errors.push(T('noRemote'));
  throw new Error(errors.join('; '));
}
setInterval(() => coverFail.clear(), 10 * 60000).unref();

// ---------- Service icons (fetched from the user's own instances) ----------
// Known icon paths per service, tried in order; then <link rel="icon"> from the service's start page.
const ICON_PATHS = {
  radarr: ['/Content/Images/logo.svg', '/Content/Images/Icons/android-chrome-192x192.png', '/Content/Images/Icons/apple-touch-icon.png', '/favicon.ico'],
  sonarr: ['/Content/Images/logo.svg', '/Content/Images/Icons/android-chrome-192x192.png', '/Content/Images/Icons/apple-touch-icon.png', '/favicon.ico'],
  qbittorrent: ['/images/qbittorrent-tray.svg', '/images/qbittorrent.svg', '/images/qbittorrent32.png', '/favicon.ico'],
  nzbget: ['/img/favicon-256x256.png', '/img/favicon.png', '/img/favicon.ico', '/favicon.ico'],
  seerr: ['/os_icon.svg', '/android-chrome-512x512.png', '/apple-touch-icon.png', '/favicon.ico'],
  prowlarr: ['/Content/Images/logo.svg', '/Content/Images/Icons/android-chrome-192x192.png', '/Content/Images/Icons/apple-touch-icon.png', '/favicon.ico'],
  bazarr: ['/images/logo128.png', '/images/logo64.png', '/images/apple-touch-icon.png', '/images/favicon.ico', '/favicon.ico'],
};
const iconCache = new Map(); // svc -> { buf, type, at } | { missing: true, at }
function iconAuth(svc) {
  const c = config.cfg[svc];
  if (svc === 'radarr' || svc === 'sonarr' || svc === 'seerr' || svc === 'prowlarr' || svc === 'bazarr') return { 'X-Api-Key': c.apiKey };
  if (svc === 'nzbget' && c.user) return { Authorization: 'Basic ' + Buffer.from(`${c.user}:${c.pass || ''}`).toString('base64') };
  if (svc === 'qbittorrent' && qb.sid) return { Cookie: `SID=${qb.sid}` };
  return {};
}
async function tryIcon(url, headers) {
  const r = await req(url, { headers: { ...headers, 'User-Agent': 'ArrHub' }, redirect: 'manual', timeout: 8000 });
  const type = (r.headers.get('content-type') || '').split(';')[0].trim();
  if (!r.ok || !/^image\//.test(type)) { r.body?.cancel?.(); return null; }
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > 1024 * 1024) return null;
  return { buf, type };
}
async function serviceIcon(svc, force) {
  if (!SERVICES.includes(svc) || !enabled(svc)) throw Object.assign(new Error(T('notConfigured', { svc })), { status: 400 });
  const hit = iconCache.get(svc);
  if (!force && hit && Date.now() - hit.at < (hit.missing ? 30 * 60e3 : 24 * 3600e3)) {
    if (hit.missing) throw Object.assign(new Error(T('noIcon')), { status: 404 });
    return hit;
  }
  const base = config.cfg[svc].url;               // may include a URL base, e.g. http://host:7878/radarr
  if (svc === 'qbittorrent' && !qb.sid) await qb.login().catch(() => {});
  const headers = iconAuth(svc);
  let found = null;
  for (const p of ICON_PATHS[svc]) {
    found = await tryIcon(base + p, headers).catch(() => null);
    if (found) break;
  }
  if (!found) {
    // fall back to <link rel="icon"> / apple-touch-icon from the start page, largest first
    try {
      const r = await req(base + '/', { headers, timeout: 8000 });
      const html = (await r.text()).slice(0, 200000);
      const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0])
        .filter(l => /rel=["'][^"']*(icon|apple-touch-icon)[^"']*["']/i.test(l))
        .map(l => ({ href: (l.match(/href=["']([^"']+)["']/i) || [])[1], size: parseInt((l.match(/sizes=["'](\d+)/i) || [])[1] || (/svg/i.test(l) ? 9999 : 16), 10) }))
        .filter(l => l.href && !/^data:/i.test(l.href)).sort((a, b) => b.size - a.size);
      for (const l of links) {
        const u = new URL(l.href, base + '/');
        if (u.origin !== new URL(base).origin) continue;   // only the service's own host
        found = await tryIcon(u.toString(), headers).catch(() => null);
        if (found) break;
      }
    } catch {}
  }
  if (!found) { iconCache.set(svc, { missing: true, at: Date.now() }); throw Object.assign(new Error(T('noIcon')), { status: 404 }); }
  const entry = { ...found, at: Date.now() };
  iconCache.set(svc, entry);
  return entry;
}

module.exports = { mediaCache, coverFail, iconCache, libraryMedia, serviceIcon, cover };
