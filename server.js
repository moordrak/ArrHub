// ArrHub — jedinstveno sučelje za Radarr, Sonarr, NZBGet, qBittorrent i Seerr
// Bez vanjskih ovisnosti, potreban Node.js 18+
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------- Konfiguracija ----------
const CONFIG_FILE = process.env.ARRHUB_CONFIG || path.join(__dirname, 'config.json');
const SERVICES = ['radarr', 'sonarr', 'nzbget', 'qbittorrent', 'seerr'];
const MASK = '********';
// [odjeljak, polje, varijabla okruženja, tajno?]
const FIELDS = [
  ['', 'port', 'PORT'], ['', 'refresh', 'ARRHUB_REFRESH'],
  ['auth', 'user', 'ARRHUB_USER'], ['auth', 'pass', 'ARRHUB_PASS', true],
  ['radarr', 'url', 'RADARR_URL'], ['radarr', 'apiKey', 'RADARR_KEY', true],
  ['sonarr', 'url', 'SONARR_URL'], ['sonarr', 'apiKey', 'SONARR_KEY', true],
  ['nzbget', 'url', 'NZBGET_URL'], ['nzbget', 'user', 'NZBGET_USER'], ['nzbget', 'pass', 'NZBGET_PASS', true],
  ['qbittorrent', 'url', 'QBIT_URL'], ['qbittorrent', 'user', 'QBIT_USER'], ['qbittorrent', 'pass', 'QBIT_PASS', true],
  ['seerr', 'url', 'SEERR_URL'], ['seerr', 'apiKey', 'SEERR_KEY', true],
  ['ui', 'theme', 'ARRHUB_THEME'], ['ui', 'accent', 'ARRHUB_ACCENT'], ['ui', 'background', 'ARRHUB_BACKGROUND'],
  ['ui', 'bgIntensity', 'ARRHUB_BG_INTENSITY'], ['ui', 'bgReactive', 'ARRHUB_BG_REACTIVE'],
];
const THEMES = ['auto', 'dark', 'oled', 'light', 'nord', 'dracula', 'catppuccin', 'tokyo', 'gruvbox', 'solarized'];
const BACKGROUNDS = ['none', 'aurora', 'stars', 'particles', 'waves', 'posters', 'fanart'];
function normalizeUi(u = {}) {
  return {
    theme: THEMES.includes(u.theme) ? u.theme : 'dark',
    accent: /^#[0-9a-f]{6}$/i.test(u.accent || '') ? u.accent.toLowerCase() : '',
    background: BACKGROUNDS.includes(u.background) ? u.background : 'none',
    bgIntensity: Math.max(0, Math.min(100, Math.round(Number(u.bgIntensity ?? 60)))) || 0,
    bgReactive: !(u.bgReactive === false || u.bgReactive === 'false'),
  };
}
const getF = (o, sec, f) => (sec ? o[sec]?.[f] : o[f]);
const setF = (o, sec, f, v) => { if (sec) (o[sec] ||= {})[f] = v; else o[f] = v; };
const envSet = name => process.env[name] !== undefined && process.env[name] !== '';

function readFileConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}
// Datoteka + varijable okruženja (okruženje ima prednost)
function loadConfig() {
  const file = readFileConfig();
  const c = { auth: {}, ui: {} };
  for (const k of SERVICES) c[k] = {};
  for (const [sec, f, env] of FIELDS) {
    const v = envSet(env) ? process.env[env] : getF(file, sec, f);
    if (v !== undefined) setF(c, sec, f, v);
  }
  c.port = Number(c.port) || 8686;
  c.refresh = Math.min(300, Math.max(2, Number(c.refresh) || 5));
  for (const k of SERVICES) if (c[k].url) c[k].url = String(c[k].url).trim().replace(/\/+$/, '');
  c.ui = normalizeUi(c.ui);
  return c;
}
let cfg = loadConfig();

// Postavke za prikaz (tajne maskirane, oznaka koja polja dolaze iz okruženja)
function settingsView() {
  const out = { values: {}, locked: [], file: CONFIG_FILE };
  for (const [sec, f, env, secret] of FIELDS) {
    const key = sec ? `${sec}.${f}` : f;
    const v = getF(cfg, sec, f);
    out.values[key] = secret ? (v ? MASK : '') : (v ?? '');
    if (envSet(env)) out.locked.push(key);
  }
  return out;
}
// Spaja unos iz sučelja s postojećim vrijednostima (maska = zadrži staru tajnu)
function mergeInput(values, base = cfg) {
  const c = { auth: {}, ui: {} };
  for (const [sec, f, , secret] of FIELDS) {
    const key = sec ? `${sec}.${f}` : f;
    let v = values?.[key];
    if (v === undefined || (secret && v === MASK)) v = getF(base, sec, f);
    if (typeof v === 'string') v = v.trim();
    if (v !== undefined && v !== '') setF(c, sec, f, v);
  }
  return c;
}
function validate(c) {
  for (const k of SERVICES) {
    const u = c[k]?.url;
    if (!u) continue;
    let p; try { p = new URL(u); } catch { throw new Error(`${k}: neispravan URL`); }
    if (!/^https?:$/.test(p.protocol)) throw new Error(`${k}: URL mora počinjati s http:// ili https://`);
    c[k].url = u.replace(/\/+$/, '');
  }
  for (const k of ['radarr', 'sonarr', 'seerr']) if (c[k]?.url && !c[k].apiKey) throw new Error(`${k[0].toUpperCase() + k.slice(1)} treba API ključ`);
  if (c.auth?.user && !c.auth.pass) throw new Error('Za prijavu u ArrHub treba i lozinka');
  if (c.port !== undefined) { const n = Number(c.port); if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Neispravan port'); c.port = n; }
  if (c.refresh !== undefined) c.refresh = Math.min(300, Math.max(2, Number(c.refresh) || 5));
  if (c.ui) {
    if (c.ui.theme !== undefined && !THEMES.includes(c.ui.theme)) throw new Error('Nepoznata tema');
    if (c.ui.background !== undefined && !BACKGROUNDS.includes(c.ui.background)) throw new Error('Nepoznata pozadina');
    if (c.ui.accent && !/^#[0-9a-f]{6}$/i.test(c.ui.accent)) throw new Error('Boja mora biti u obliku #rrggbb');
    c.ui = { ...c.ui, ...normalizeUi(c.ui) };
    if (!c.ui.accent) delete c.ui.accent;
  }
}
function saveSettings(values) {
  const merged = mergeInput(values);
  validate(merged);
  // polja zadana varijablama okruženja ne upisujemo u datoteku – zadržavamo što je u njoj
  const existing = readFileConfig();
  const file = {};
  for (const [sec, f, env] of FIELDS) {
    const v = envSet(env) ? getF(existing, sec, f) : getF(merged, sec, f);
    if (v !== undefined && v !== '') setF(file, sec, f, v);
  }
  for (const k of SERVICES) if (file[k] && !file[k].url) delete file[k];
  if (file.ui && !Object.keys(file.ui).length) delete file.ui;
  mediaCache.at = 0; mediaCache.data = null; coverFail.clear();
  const oldPort = cfg.port;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  cfg = loadConfig();
  qb.sid = null;
  return { ok: true, restartRequired: cfg.port !== oldPort };
}
async function testService(service, values) {
  if (!SERVICES.includes(service)) throw new Error('Nepoznata usluga');
  const c = mergeInput(values);
  validate(c);
  const s = c[service];
  if (!s?.url) throw new Error('URL nije upisan');
  if (service === 'radarr' || service === 'sonarr') {
    const st = await arr(service, s).call('/system/status');
    if (st.appName && st.appName.toLowerCase() !== service) throw new Error(`Na toj adresi je ${st.appName}, ne ${service}`);
    return { message: `${st.appName || service} ${st.version}` };
  }
  if (service === 'qbittorrent') {
    const client = makeQb(() => s);
    return { message: `qBittorrent ${await client.call('/app/version')}` };
  }
  if (service === 'seerr') {
    const client = makeSeerr(() => s);
    const [st, me] = await Promise.all([client.call('/status'), client.call('/auth/me')]);
    return { message: `Seerr ${st.version || ''} · ${me.displayName || me.username || me.email || 'korisnik'}` };
  }
  return { message: `NZBGet ${await makeNzb(() => s).rpc('version')}` };
}

// ---------- Pomoćne funkcije ----------
const TIMEOUT = 10000;
async function req(url, { timeout = TIMEOUT, ...opts } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
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
function arr(name, c = cfg[name]) {
  const call = (p, opts = {}) => json(`${c.url}/api/v3${p}`, {
    ...opts,
    headers: { 'X-Api-Key': c.apiKey, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  return {
    call,
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
function makeQb(conf) { return {
  sid: null,
  async login() {
    const c = conf();
    const r = await req(`${c.url}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: c.url },
      body: new URLSearchParams({ username: c.user || '', password: c.pass || '' }),
    });
    const txt = await r.text();
    const cookie = r.headers.get('set-cookie') || '';
    const m = cookie.match(/SID=([^;]+)/);
    if (m) this.sid = m[1];
    else if (!/Ok/i.test(txt)) throw new Error(/fail/i.test(txt) ? 'Pogrešno korisničko ime ili lozinka' : 'Prijava nije uspjela: ' + txt.slice(0, 100));
  },
  async call(p, form) {
    const c = conf();
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
}; }
const qb = makeQb(() => cfg.qbittorrent);

// ---------- NZBGet (JSON-RPC) ----------
function makeNzb(conf) { return {
  async rpc(method, params = []) {
    const c = conf();
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
}; }
const nzb = makeNzb(() => cfg.nzbget);

// ---------- Seerr (Overseerr/Jellyseerr API v1) ----------
const seerrMeta = new Map(); // 'movie:123' -> { title, year, poster, at }
// filtri koje Seerr API prihvaća; 'declined' nema, pa ga radimo sami (status 3)
const SEERR_FILTERS = ['all', 'pending', 'approved', 'processing', 'available', 'unavailable', 'failed', 'deleted', 'completed'];
const SEERR_LOCAL = { declined: r => r.status === 3 };
function makeSeerr(conf) {
  const call = (p, opts = {}) => {
    const c = conf();
    return json(`${c.url}/api/v1${p}`, { ...opts, headers: { 'X-Api-Key': c.apiKey, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  };
  async function meta(type, tmdbId) {
    const key = `${type}:${tmdbId}`;
    const hit = seerrMeta.get(key);
    if (hit && Date.now() - hit.at < 24 * 3600e3) return hit;
    try {
      const d = await call(`/${type === 'tv' ? 'tv' : 'movie'}/${tmdbId}`);
      const date = d.releaseDate || d.firstAirDate || '';
      const m = { title: d.title || d.name || d.originalTitle || d.originalName || `TMDB ${tmdbId}`, year: date.slice(0, 4), poster: d.posterPath || null, at: Date.now() };
      seerrMeta.set(key, m);
      if (seerrMeta.size > 3000) seerrMeta.delete(seerrMeta.keys().next().value);
      return m;
    } catch { return { title: `TMDB ${tmdbId}`, year: '', poster: null, at: 0 }; }
  }
  function posterUrl(path) {
    if (!path) return null;
    const id = hashId('seerr' + path);
    coverMap.set(id, { svc: 'seerr', local: null, remote: `https://image.tmdb.org/t/p/w154${path}`, kind: 'poster' });
    return `/api/cover/${id}`;
  }
  return {
    call,
    async summary(filter = 'all') {
      const local = SEERR_LOCAL[filter];
      if (!local && !SEERR_FILTERS.includes(filter)) filter = 'all';
      const [status, count, list] = await Promise.all([
        call('/status').catch(() => ({})),
        call('/request/count').catch(() => ({})),
        call(`/request?take=${local ? 200 : 40}&skip=0&sort=added&filter=${local ? 'all' : filter}`),
      ]);
      const results = (list.results || []).filter(local || (() => true)).slice(0, 40);
      // naslove i postere dohvaćamo zasebno (najviše 6 istovremeno), uz 24 h međuspremnik
      const metas = new Array(results.length);
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(6, results.length) }, async () => {
        while (i < results.length) {
          const n = i++; const r = results[n];
          metas[n] = r.media?.tmdbId ? await meta(r.type || r.media.mediaType, r.media.tmdbId) : { title: 'Nepoznato' };
        }
      }));
      const requests = results.map((r, n) => ({
        id: r.id, type: r.type || r.media?.mediaType, status: r.status, mediaStatus: r.media?.status,
        is4k: !!r.is4k, createdAt: r.createdAt,
        seasons: (r.seasons || []).map(x => x.seasonNumber).sort((a, b) => a - b),
        requestedBy: r.requestedBy?.displayName || r.requestedBy?.username || r.requestedBy?.email || '',
        title: metas[n].title, year: metas[n].year, poster: posterUrl(metas[n].poster),
        tmdbId: r.media?.tmdbId,
      }));
      return { version: status.version || '', updateAvailable: !!status.updateAvailable, count, filter, total: local ? requests.length : list.pageInfo?.results ?? requests.length, requests };
    },
    action(id, action) {
      id = Number(id);
      if (!Number.isInteger(id)) throw new Error('Neispravan ID');
      if (action === 'approve' || action === 'decline') return call(`/request/${id}/${action}`, { method: 'POST' });
      if (action === 'delete') return call(`/request/${id}`, { method: 'DELETE' });
      throw new Error('Nepoznata akcija');
    },
  };
}
const seerr = makeSeerr(() => cfg.seerr);

// ---------- Slike iz knjižnice (pozadine) ----------
// Klijent dobiva samo /api/cover/<id>; stvarne adrese (lokalni MediaCover + udaljeni TMDB/TVDB) ostaju na poslužitelju.
const mediaCache = { at: 0, data: null, pending: null };
const coverMap = new Map(); // id -> { svc, local, remote, kind }
const coverFail = new Map(); // svc -> { n, last } neuspjeli lokalni dohvati (nakon nekoliko ide se ravno na remote)
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const hashId = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
function remoteSized(u, kind) {
  if (!u || !/^https:\/\//.test(u)) return null;
  // TMDB podržava manje verzije slika
  return u.replace(/(image\.tmdb\.org\/t\/p\/)original\//, `$1${kind === 'poster' ? 'w342' : 'w1280'}/`);
}
async function buildMedia() {
  const posters = [], fanart = [], stats = {};
  await Promise.all(['radarr', 'sonarr'].filter(enabled).map(async k => {
    const st = stats[k] = { items: 0, posters: 0, fanart: 0, error: null };
    let list;
    try { list = await arr(k).call(k === 'radarr' ? '/movie' : '/series', { timeout: 90000 }); }
    catch (e) { st.error = friendlyError(e); return; }
    if (!Array.isArray(list)) { st.error = 'Neočekivan odgovor'; return; }
    st.items = list.length;
    for (const it of list) for (const im of it.images || []) {
      const kind = im.coverType === 'poster' ? 'poster' : im.coverType === 'fanart' ? 'fanart' : null;
      if (!kind) continue;
      let local = null;
      if (im.url && /\/MediaCover\//.test(im.url) && !im.url.includes('..')) {
        local = im.url.startsWith('http') ? im.url : null;
        if (!local) { try { local = new URL(im.url, new URL(cfg[k].url).origin + '/').toString(); } catch {} }
        if (local && kind === 'poster') local = local.replace(/poster(\.jpg)/, 'poster-500$1');
      }
      const remote = remoteSized(im.remoteUrl, kind);
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
  const ttl = ok ? 10 * 60000 : 30000; // prazan/neuspio rezultat pamti se samo 30 s
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
    if (r.status >= 300 && r.status < 400) throw new Error(`preusmjereno na prijavu (${r.status}) – uključena je autentifikacija`);
    if (r.status === 401 || r.status === 403) throw new Error(`pristup odbijen (${r.status})`);
    if (r.status === 404) throw new Error('slika ne postoji (404)');
    if (r.ok) throw new Error(`nije slika (${type.split(';')[0] || 'nepoznat tip'})`);
    throw new Error(`HTTP ${r.status}`);
  }
  return { __raw: Buffer.from(await r.arrayBuffer()), type };
}
async function cover(id) {
  const e = coverMap.get(id);
  if (!e) throw new Error('Nepoznata slika');
  const c = cfg[e.svc];
  const errors = [];
  const fail = coverFail.get(e.svc) || { n: 0, last: '' };
  if (e.local && fail.n >= 5) errors.push(`${e.svc} lokalno: ${fail.last}`);
  if (e.local && fail.n < 5) {
    try {
      const u = new URL(e.local);
      u.searchParams.set('apikey', c.apiKey);
      const img = await fetchImage(u.toString(), { 'X-Api-Key': c.apiKey });
      coverFail.delete(e.svc);
      return img;
    } catch (err) {
      const m = friendlyError(err);
      errors.push(`${e.svc} lokalno: ${m}`);
      coverFail.set(e.svc, { n: fail.n + 1, last: m });
    }
  }
  if (e.remote) {
    try { return await fetchImage(e.remote, { 'User-Agent': 'ArrHub' }); }
    catch (err) { errors.push('TMDB/TVDB: ' + friendlyError(err)); }
  } else errors.push('nema adrese na internetu');
  throw new Error(errors.join('; '));
}
setInterval(() => coverFail.clear(), 10 * 60000).unref();

function friendlyError(e) {
  if (e.name === 'AbortError') return 'Isteklo vrijeme čekanja (usluga ne odgovara)';
  if (e.code === 'EACCES' || e.code === 'EROFS') return `Nema dozvole za pisanje u ${CONFIG_FILE}`;
  const code = e.cause?.code || e.cause?.errors?.[0]?.code;
  const net = {
    ECONNREFUSED: 'Veza odbijena – provjeri adresu i port',
    ENOTFOUND: 'Adresa nije pronađena (DNS)',
    EHOSTUNREACH: 'Računalo nije dostupno',
    ENETUNREACH: 'Mreža nije dostupna',
    ETIMEDOUT: 'Isteklo vrijeme povezivanja',
    ECONNRESET: 'Veza prekinuta',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Samopotpisani TLS certifikat – koristi http:// ili valjan certifikat',
  }[code];
  if (net) return net;
  if (e.message === 'fetch failed') return 'Povezivanje nije uspjelo' + (e.cause?.message ? ` (${e.cause.message})` : '');
  if (/^401\b/.test(e.message)) return 'Neispravan API ključ ili korisničko ime/lozinka (401)';
  if (/^403\b/.test(e.message)) return 'Pristup odbijen – provjeri API ključ (403)';
  if (/^404\b/.test(e.message)) return 'Nije pronađeno (404) – provjeri URL i URL Base';
  return e.message;
}

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
  'GET /api/config': async () => ({ ...Object.fromEntries(SERVICES.map(k => [k, enabled(k)])), refresh: cfg.refresh, auth: !!cfg.auth.user, ui: cfg.ui }),
  'GET /api/media': q => libraryMedia(q.get('refresh') === '1'),
  'GET /api/cover/:id': (q, b, p) => cover(p.id),
  'GET /api/settings': async () => settingsView(),
  'POST /api/settings': (q, b) => saveSettings(b.values),
  'POST /api/settings/test': (q, b) => testService(b.service, b.values),
  'GET /api/radarr': () => arr('radarr').summary(),
  'GET /api/sonarr': () => arr('sonarr').summary(),
  'GET /api/qbittorrent': () => qb.summary(),
  'GET /api/nzbget': () => nzb.summary(),
  'GET /api/seerr': q => seerr.summary(q.get('filter') || 'all'),
  'POST /api/seerr/action': (q, b) => seerr.action(b.id, b.action),
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
    if (!['config', 'settings', 'media', 'cover'].includes(svc) && !enabled(svc)) return send(res, 400, { error: `${svc} nije konfiguriran` });
    try {
      const body = r.method === 'POST' ? await readBody(r) : {};
      const out = await m.fn(u.searchParams, body, m.params);
      if (out?.__raw) {
        res.writeHead(200, { 'Content-Type': out.type, 'Cache-Control': 'private, max-age=86400' });
        return res.end(out.__raw);
      }
      send(res, 200, out ?? { ok: true });
    } catch (e) {
      const msg = friendlyError(e);
      send(res, svc === 'settings' && !u.pathname.endsWith('/test') ? 400 : 502, { error: msg });
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
