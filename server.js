// ArrHub — one dashboard for Radarr, Sonarr, NZBGet, qBittorrent and Seerr
// No external dependencies, requires Node.js 18+
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

let VERSION = 'dev';
try { VERSION = require('./package.json').version || VERSION; } catch {}

// ---------- Server-side messages (en / hr) ----------
// The language of each request comes from the X-Lang header the UI sends (falls back to the configured UI language).
const MSG = {
  en: {
    urlInvalid: '{svc}: invalid URL', linkInvalid: '{svc}: the link must be a full http:// or https:// address', urlScheme: '{svc}: URL must start with http:// or https://',
    needsKey: '{svc} needs an API key', authNeedsPass: 'An ArrHub login also needs a password', badPort: 'Invalid port',
    badTheme: 'Unknown theme', badBackground: 'Unknown background', badColor: 'Colour must be in #rrggbb format', badLang: 'Unknown language',
    unknownService: 'Unknown service', urlMissing: 'URL is not set', wrongApp: 'That address is {app}, not {svc}', user: 'user',
    badLogin: 'Wrong username or password', loginFailed: 'Login failed: {msg}', unknownAction: 'Unknown action', unknown: 'Unknown',
    badId: 'Invalid ID', unexpectedResponse: 'Unexpected response',
    imgRedirect: 'redirected to login ({status}) – authentication is enabled', imgDenied: 'access denied ({status})', img404: 'image does not exist (404)',
    notImage: 'not an image ({type})', unknownImage: 'Unknown image', local: 'local', noRemote: 'no internet URL available',
    timeout: 'Timed out (service is not responding)', noWrite: 'No permission to write {file}',
    netRefused: 'Connection refused – check the address and port', netNotFound: 'Host not found (DNS)', netHost: 'Host unreachable',
    netNet: 'Network unreachable', netTimeout: 'Connection timed out', netReset: 'Connection reset',
    netSelfSigned: 'The certificate is self-signed or locally signed – enable “Accept self-signed certificate” for this service',
    netCertExpired: 'The TLS certificate has expired', netCertName: 'The TLS certificate does not match the address', fetchFailed: 'Connection failed',
    e401: 'Invalid API key or username/password (401)', e403: 'Access denied – check the API key (403)', e404: 'Not found (404) – check the URL and URL Base',
    noIcon: 'No icon found on the service', loginRequired: 'Login required', notFound: 'Not found', notConfigured: '{svc} is not configured', forbidden: 'Forbidden',
  },
  hr: {
    urlInvalid: '{svc}: neispravan URL', linkInvalid: '{svc}: poveznica mora biti puna http:// ili https:// adresa', urlScheme: '{svc}: URL mora počinjati s http:// ili https://',
    needsKey: '{svc} treba API ključ', authNeedsPass: 'Za prijavu u ArrHub treba i lozinka', badPort: 'Neispravan port',
    badTheme: 'Nepoznata tema', badBackground: 'Nepoznata pozadina', badColor: 'Boja mora biti u obliku #rrggbb', badLang: 'Nepoznat jezik',
    unknownService: 'Nepoznata usluga', urlMissing: 'URL nije upisan', wrongApp: 'Na toj adresi je {app}, ne {svc}', user: 'korisnik',
    badLogin: 'Pogrešno korisničko ime ili lozinka', loginFailed: 'Prijava nije uspjela: {msg}', unknownAction: 'Nepoznata akcija', unknown: 'Nepoznato',
    badId: 'Neispravan ID', unexpectedResponse: 'Neočekivan odgovor',
    imgRedirect: 'preusmjereno na prijavu ({status}) – uključena je autentifikacija', imgDenied: 'pristup odbijen ({status})', img404: 'slika ne postoji (404)',
    notImage: 'nije slika ({type})', unknownImage: 'Nepoznata slika', local: 'lokalno', noRemote: 'nema adrese na internetu',
    timeout: 'Isteklo vrijeme čekanja (usluga ne odgovara)', noWrite: 'Nema dozvole za pisanje u {file}',
    netRefused: 'Veza odbijena – provjeri adresu i port', netNotFound: 'Adresa nije pronađena (DNS)', netHost: 'Računalo nije dostupno',
    netNet: 'Mreža nije dostupna', netTimeout: 'Isteklo vrijeme povezivanja', netReset: 'Veza prekinuta',
    netSelfSigned: 'Certifikat je samopotpisan ili lokalno potpisan – uključi „Prihvati samopotpisani certifikat” za ovaj servis',
    netCertExpired: 'TLS certifikat je istekao', netCertName: 'TLS certifikat ne odgovara adresi', fetchFailed: 'Povezivanje nije uspjelo',
    e401: 'Neispravan API ključ ili korisničko ime/lozinka (401)', e403: 'Pristup odbijen – provjeri API ključ (403)', e404: 'Nije pronađeno (404) – provjeri URL i URL Base',
    noIcon: 'Servis nema dostupnu ikonu', loginRequired: 'Potrebna prijava', notFound: 'Nije pronađeno', notConfigured: '{svc} nije konfiguriran', forbidden: 'Zabranjeno',
  },
};
const LANGS = ['auto', 'en', 'hr'];
const langStore = new AsyncLocalStorage();
function T(key, vars = {}) {
  const lang = langStore.getStore() || 'en';
  const str = MSG[lang]?.[key] ?? MSG.en[key] ?? key;
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
function requestLang(r) {
  const h = String(r.headers['x-lang'] || '').toLowerCase();
  if (MSG[h]) return h;
  const conf = cfg?.ui?.lang;
  if (MSG[conf]) return conf;
  return /^hr\b/i.test(r.headers['accept-language'] || '') ? 'hr' : 'en';
}

// ---------- Configuration ----------
const CONFIG_FILE = process.env.ARRHUB_CONFIG || path.join(__dirname, 'config.json');
const SERVICES = ['radarr', 'sonarr', 'nzbget', 'qbittorrent', 'seerr'];
const MASK = '********';
// [section, field, environment variable, secret?]
const FIELDS = [
  ['', 'port', 'PORT'], ['', 'refresh', 'ARRHUB_REFRESH'],
  ['auth', 'user', 'ARRHUB_USER'], ['auth', 'pass', 'ARRHUB_PASS', true],
  ['radarr', 'url', 'RADARR_URL'], ['radarr', 'apiKey', 'RADARR_KEY', true],
  ['sonarr', 'url', 'SONARR_URL'], ['sonarr', 'apiKey', 'SONARR_KEY', true],
  ['nzbget', 'url', 'NZBGET_URL'], ['nzbget', 'user', 'NZBGET_USER'], ['nzbget', 'pass', 'NZBGET_PASS', true],
  ['qbittorrent', 'url', 'QBIT_URL'], ['qbittorrent', 'user', 'QBIT_USER'], ['qbittorrent', 'pass', 'QBIT_PASS', true],
  ['seerr', 'url', 'SEERR_URL'], ['seerr', 'apiKey', 'SEERR_KEY', true],
  // optional address the browser opens from the cards (e.g. a public reverse-proxy URL); empty = the service URL
  ['radarr', 'link', 'RADARR_LINK'], ['sonarr', 'link', 'SONARR_LINK'], ['nzbget', 'link', 'NZBGET_LINK'],
  ['qbittorrent', 'link', 'QBIT_LINK'], ['seerr', 'link', 'SEERR_LINK'],
  // accept a self-signed / locally signed TLS certificate for that service only
  ['radarr', 'insecure', 'RADARR_INSECURE'], ['sonarr', 'insecure', 'SONARR_INSECURE'], ['nzbget', 'insecure', 'NZBGET_INSECURE'],
  ['qbittorrent', 'insecure', 'QBIT_INSECURE'], ['seerr', 'insecure', 'SEERR_INSECURE'],
  ['ui', 'theme', 'ARRHUB_THEME'], ['ui', 'accent', 'ARRHUB_ACCENT'], ['ui', 'background', 'ARRHUB_BACKGROUND'],
  ['ui', 'bgIntensity', 'ARRHUB_BG_INTENSITY'], ['ui', 'bgReactive', 'ARRHUB_BG_REACTIVE'], ['ui', 'lang', 'ARRHUB_LANG'],
  ['ui', 'cardIcons', 'ARRHUB_CARD_ICONS'], ['ui', 'cardIconStrength', 'ARRHUB_CARD_ICON_STRENGTH'],
];
const THEMES = ['auto', 'dark', 'oled', 'light', 'nord', 'dracula', 'catppuccin', 'tokyo', 'gruvbox', 'matrix', 'neon', 'pastel-lavender', 'pastel-peach', 'solarized'];
const BACKGROUNDS = ['none', 'aurora', 'stars', 'particles', 'waves', 'posters', 'fanart'];
function normalizeUi(u = {}) {
  return {
    theme: THEMES.includes(u.theme) ? u.theme : 'dark',
    accent: /^#[0-9a-f]{6}$/i.test(u.accent || '') ? u.accent.toLowerCase() : '',
    background: BACKGROUNDS.includes(u.background) ? u.background : 'none',
    bgIntensity: Math.max(0, Math.min(100, Math.round(Number(u.bgIntensity ?? 60)))) || 0,
    bgReactive: !(u.bgReactive === false || u.bgReactive === 'false'),
    lang: LANGS.includes(u.lang) ? u.lang : 'en',
    cardIcons: !(u.cardIcons === false || u.cardIcons === 'false'),
    cardIconStrength: Math.max(3, Math.min(30, Math.round(Number(u.cardIconStrength ?? 10)) || 10)),
  };
}
const getF = (o, sec, f) => (sec ? o[sec]?.[f] : o[f]);
const setF = (o, sec, f, v) => { if (sec) (o[sec] ||= {})[f] = v; else o[f] = v; };
const envSet = name => process.env[name] !== undefined && process.env[name] !== '';

function readFileConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}
// File + environment variables (environment wins)
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
  for (const k of SERVICES) c[k].insecure = toBool(c[k].insecure);
  c.ui = normalizeUi(c.ui);
  return c;
}
const toBool = v => v === true || v === 1 || /^(true|1|yes|on)$/i.test(String(v ?? ''));
let cfg = loadConfig();

// Settings for the UI (secrets masked, flags fields that come from the environment)
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
// Merges UI input with current values (mask = keep the existing secret)
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
    let p; try { p = new URL(u); } catch { throw new Error(T('urlInvalid', { svc: k })); }
    if (!/^https?:$/.test(p.protocol)) throw new Error(T('urlScheme', { svc: k }));
    c[k].url = u.replace(/\/+$/, '');
  }
  for (const k of SERVICES) if (c[k] && c[k].insecure !== undefined) c[k].insecure = toBool(c[k].insecure);
  for (const k of SERVICES) {
    const l = c[k]?.link;
    if (!l) continue;
    let p; try { p = new URL(l); } catch { throw new Error(T('linkInvalid', { svc: k })); }
    if (!/^https?:$/.test(p.protocol)) throw new Error(T('linkInvalid', { svc: k }));
    c[k].link = l.replace(/\/+$/, '');
  }
  for (const k of ['radarr', 'sonarr', 'seerr']) if (c[k]?.url && !c[k].apiKey) throw new Error(T('needsKey', { svc: k[0].toUpperCase() + k.slice(1) }));
  if (c.auth?.user && !c.auth.pass) throw new Error(T('authNeedsPass'));
  if (c.port !== undefined) { const n = Number(c.port); if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(T('badPort')); c.port = n; }
  if (c.refresh !== undefined) c.refresh = Math.min(300, Math.max(2, Number(c.refresh) || 5));
  if (c.ui) {
    if (c.ui.theme !== undefined && !THEMES.includes(c.ui.theme)) throw new Error(T('badTheme'));
    if (c.ui.background !== undefined && !BACKGROUNDS.includes(c.ui.background)) throw new Error(T('badBackground'));
    if (c.ui.accent && !/^#[0-9a-f]{6}$/i.test(c.ui.accent)) throw new Error(T('badColor'));
    if (c.ui.lang !== undefined && !LANGS.includes(c.ui.lang)) throw new Error(T('badLang'));
    c.ui = { ...c.ui, ...normalizeUi(c.ui) };
    if (!c.ui.accent) delete c.ui.accent;
  }
}
function saveSettings(values) {
  const merged = mergeInput(values);
  validate(merged);
  // fields set via environment variables are not written to the file – keep whatever the file already has
  const existing = readFileConfig();
  const file = {};
  for (const [sec, f, env] of FIELDS) {
    const v = envSet(env) ? getF(existing, sec, f) : getF(merged, sec, f);
    if (v !== undefined && v !== '') setF(file, sec, f, v);
  }
  for (const k of SERVICES) if (file[k] && !file[k].url) delete file[k];
  if (file.ui && !Object.keys(file.ui).length) delete file.ui;
  mediaCache.at = 0; mediaCache.data = null; coverFail.clear(); iconCache.clear();
  const oldPort = cfg.port;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  cfg = loadConfig();
  qb.sid = null;
  return { ok: true, restartRequired: cfg.port !== oldPort };
}
async function testService(service, values) {
  if (!SERVICES.includes(service)) throw new Error(T('unknownService'));
  const c = mergeInput(values);
  validate(c);
  const s = c[service];
  if (!s?.url) throw new Error(T('urlMissing'));
  // the test follows the form's checkbox, not what is saved
  const o = originOf(s.url);
  return tlsStore.run({ allow: new Set(s.insecure ? [o] : []), deny: new Set(s.insecure ? [] : [o]) }, () => runServiceTest(service, s));
}
async function runServiceTest(service, s) {
  if (service === 'radarr' || service === 'sonarr') {
    const st = await arr(service, s).call('/system/status');
    if (st.appName && st.appName.toLowerCase() !== service) throw new Error(T('wrongApp', { app: st.appName, svc: service }));
    return { message: `${st.appName || service} ${st.version}` };
  }
  if (service === 'qbittorrent') {
    const client = makeQb(() => s);
    return { message: `qBittorrent ${await client.call('/app/version')}` };
  }
  if (service === 'seerr') {
    const client = makeSeerr(() => s);
    const [st, me] = await Promise.all([client.call('/status'), client.call('/auth/me')]);
    return { message: `Seerr ${st.version || ''} · ${me.displayName || me.username || me.email || T('user')}` };
  }
  return { message: `NZBGet ${await makeNzb(() => s).rpc('version')}` };
}

// ---------- Helpers ----------
const TIMEOUT = 10000;
const http_ = require('http'), https_ = require('https');
const tlsStore = new AsyncLocalStorage();   // per-call override for Test connection: { allow, deny } sets of origins
const originOf = u => { try { return new URL(u).origin; } catch { return null; } };
// origins of services that have "accept self-signed certificate" enabled
function allowsSelfSigned(url) {
  const o = originOf(url);
  if (!o || !o.startsWith('https:')) return false;
  const t = tlsStore.getStore();
  if (t?.deny.has(o)) return false;
  if (t?.allow.has(o)) return true;
  return SERVICES.some(k => cfg[k]?.insecure && cfg[k].url && originOf(cfg[k].url) === o);
}
// fetch-compatible request over https with certificate verification off – used ONLY for those origins
function insecureFetch(url, { method = 'GET', headers = {}, body, redirect = 'follow', signal } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const h = {};
    for (const [k, v] of Object.entries(headers instanceof Headers ? Object.fromEntries(headers) : headers)) h[k] = v;
    let payload = body;
    if (body instanceof URLSearchParams) { payload = body.toString(); h['Content-Type'] ??= 'application/x-www-form-urlencoded'; }
    if (payload !== undefined && payload !== null) h['Content-Length'] = Buffer.byteLength(payload);
    const r = https_.request(u, { method, headers: h, rejectUnauthorized: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const status = res.statusCode || 502;
        const loc = res.headers.location;
        if (redirect === 'follow' && status >= 300 && status < 400 && loc && hops < 5) {
          const next = new URL(loc, u).toString();
          const sameOrigin = originOf(next) === u.origin;
          const go = sameOrigin && next.startsWith('https:') ? insecureFetch : fetch;
          return resolve(go(next, { method: status === 303 ? 'GET' : method, headers, body: status === 303 ? undefined : body, redirect, signal }, hops + 1));
        }
        const hdrs = new Headers();
        for (const [k, v] of Object.entries(res.headers)) hdrs.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        const buf = Buffer.concat(chunks);
        resolve(new Response([101, 204, 205, 304].includes(status) ? null : buf, { status: Math.min(Math.max(status, 200), 599), headers: hdrs }));
      });
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
async function req(url, { timeout = TIMEOUT, ...opts } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const go = allowsSelfSigned(url) ? insecureFetch : fetch;
    return await go(url, { ...opts, signal: ctrl.signal });
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
    else if (!/Ok/i.test(txt)) throw new Error(/fail/i.test(txt) ? T('badLogin') : T('loginFailed', { msg: txt.slice(0, 100) }));
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
  // qBittorrent 5.x uses stop/start, older versions pause/resume
  async action(action, hashes, deleteFiles) {
    const h = { hashes: hashes.join('|') };
    if (action === 'delete') return this.call('/torrents/delete', { ...h, deleteFiles: String(!!deleteFiles) });
    const map = { pause: ['stop', 'pause'], resume: ['start', 'resume'] }[action];
    if (!map) throw new Error(T('unknownAction'));
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
    // NZBGet URLs are often written as http://user:pass@host:6789 – move those credentials into the header
    const u = new URL(c.url);
    const user = c.user || decodeURIComponent(u.username), pass = c.user ? (c.pass || '') : decodeURIComponent(u.password);
    u.username = ''; u.password = '';
    const headers = { 'Content-Type': 'application/json' };
    if (user) headers.Authorization = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    const res = await json(`${u.toString().replace(/\/+$/, '')}/jsonrpc`, { method: 'POST', headers, body: JSON.stringify({ method, params, id: 1 }) });
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
    if (!cmd) throw new Error(T('unknownAction'));
    return this.rpc('editqueue', [cmd, '', ids.map(Number)]);
  },
}; }
const nzb = makeNzb(() => cfg.nzbget);

// ---------- Seerr (Overseerr/Jellyseerr API v1) ----------
const seerrMeta = new Map(); // 'movie:123' -> { title, year, poster, at }
// filters accepted by the Seerr API; there is no 'declined', so we do it ourselves (status 3)
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
      // titles and posters are fetched separately (max 6 at a time), cached for 24 h
      const metas = new Array(results.length);
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(6, results.length) }, async () => {
        while (i < results.length) {
          const n = i++; const r = results[n];
          metas[n] = r.media?.tmdbId ? await meta(r.type || r.media.mediaType, r.media.tmdbId) : { title: T('unknown') };
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
      if (!Number.isInteger(id)) throw new Error(T('badId'));
      if (action === 'approve' || action === 'decline') return call(`/request/${id}/${action}`, { method: 'POST' });
      if (action === 'delete') return call(`/request/${id}`, { method: 'DELETE' });
      throw new Error(T('unknownAction'));
    },
  };
}
const seerr = makeSeerr(() => cfg.seerr);

// ---------- Library images (backgrounds) ----------
// The client only gets /api/cover/<id>; real URLs (local MediaCover + remote TMDB/TVDB) stay on the server.
const mediaCache = { at: 0, data: null, pending: null };
const coverMap = new Map(); // id -> { svc, local, remote, kind }
const coverFail = new Map(); // svc -> { n, last } failed local fetches (after a few, go straight to remote)
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const hashId = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
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
  const c = cfg[e.svc];
  const errors = [];
  const fail = coverFail.get(e.svc) || { n: 0, last: '' };
  if (e.local && fail.n >= 5) errors.push(`${e.svc} ${T('local')}: ${fail.last}`);
  if (e.local && fail.n < 5) {
    try {
      const u = new URL(e.local);
      u.searchParams.set('apikey', c.apiKey);
      const img = await fetchImage(u.toString(), { 'X-Api-Key': c.apiKey });
      coverFail.delete(e.svc);
      return img;
    } catch (err) {
      const m = friendlyError(err);
      errors.push(`${e.svc} ${T('local')}: ${m}`);
      coverFail.set(e.svc, { n: fail.n + 1, last: m });
    }
  }
  if (e.remote) {
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
};
const iconCache = new Map(); // svc -> { buf, type, at } | { missing: true, at }
function iconAuth(svc) {
  const c = cfg[svc];
  if (svc === 'radarr' || svc === 'sonarr' || svc === 'seerr') return { 'X-Api-Key': c.apiKey };
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
  const base = cfg[svc].url;               // may include a URL base, e.g. http://host:7878/radarr
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

// ---------- About / update check ----------
const REPO = 'moordrak/arrhub';
const aboutCache = { at: 0, ttl: 0, data: null };
const semver = v => String(v || '').replace(/^v/, '').split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
function newer(a, b) { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; }
async function about(force) {
  const base = { version: VERSION, repo: `https://github.com/${REPO}`, releaseUrl: VERSION === 'dev' ? null : `https://github.com/${REPO}/releases/tag/v${VERSION}` };
  if (!force && aboutCache.data && Date.now() - aboutCache.at < aboutCache.ttl) return { ...base, ...aboutCache.data };
  let data;
  try {
    const r = await json(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ArrHub' }, timeout: 8000 });
    const latest = { version: String(r.tag_name || '').replace(/^v/, ''), url: r.html_url, publishedAt: r.published_at };
    data = { latest, updateAvailable: VERSION !== 'dev' && newer(latest.version, VERSION), checkedAt: new Date().toISOString(), error: null };
    aboutCache.ttl = 6 * 3600e3;
  } catch (e) {
    data = { latest: null, updateAvailable: false, checkedAt: new Date().toISOString(), error: friendlyError(e) };
    aboutCache.ttl = 30 * 60e3;
  }
  aboutCache.data = data; aboutCache.at = Date.now();
  return { ...base, ...data };
}

function serviceLinks() {
  const out = {};
  for (const k of SERVICES) {
    if (!enabled(k)) continue;
    try {
      const u = new URL(cfg[k].link || cfg[k].url);
      u.username = ''; u.password = '';
      out[k] = u.toString().replace(/\/+$/, '') + '/';
    } catch {}
  }
  return out;
}

function friendlyError(e) {
  if (e.name === 'AbortError') return T('timeout');
  if (e.code === 'EACCES' || e.code === 'EROFS') return T('noWrite', { file: CONFIG_FILE });
  const code = e.cause?.code || e.cause?.errors?.[0]?.code;
  const net = {
    ECONNREFUSED: 'netRefused', ENOTFOUND: 'netNotFound', EHOSTUNREACH: 'netHost', ENETUNREACH: 'netNet',
    ETIMEDOUT: 'netTimeout', ECONNRESET: 'netReset', DEPTH_ZERO_SELF_SIGNED_CERT: 'netSelfSigned',
    SELF_SIGNED_CERT_IN_CHAIN: 'netSelfSigned', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'netSelfSigned',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'netSelfSigned', CERT_HAS_EXPIRED: 'netCertExpired', ERR_TLS_CERT_ALTNAME_INVALID: 'netCertName',
  }[code];
  if (net) return T(net);
  if (e.message === 'fetch failed') return T('fetchFailed') + (e.cause?.message ? ` (${e.cause.message})` : '');
  if (/^401\b/.test(e.message)) return T('e401');
  if (/^403\b/.test(e.message)) return T('e403');
  if (/^404\b/.test(e.message)) return T('e404');
  return e.message;
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
  if (!cfg.auth.user) return true;
  const h = r.headers.authorization || '';
  const [u, p] = Buffer.from(h.replace(/^Basic /, ''), 'base64').toString().split(/:(.*)/s);
  return u === cfg.auth.user && p === cfg.auth.pass;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const PUBLIC = path.join(__dirname, 'public');

const routes = {
  'GET /api/config': async () => ({ ...Object.fromEntries(SERVICES.map(k => [k, enabled(k)])), refresh: cfg.refresh, auth: !!cfg.auth.user, ui: cfg.ui, version: VERSION, links: serviceLinks() }),
  'GET /api/media': q => libraryMedia(q.get('refresh') === '1'),
  'GET /api/about': q => about(q.get('refresh') === '1'),
  'GET /api/icon/:svc': async (q, b, p) => {
    const ic = await serviceIcon(p.svc, q.get('refresh') === '1');
    // served under our origin: lock it down so an SVG can never run script here
    return { __raw: ic.buf, type: ic.type, headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff' } };
  },
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

const server = http.createServer((r, res) => langStore.run(requestLang(r), () => handle(r, res)));
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
    if (!['config', 'settings', 'media', 'cover', 'about', 'icon'].includes(svc) && !enabled(svc)) return send(res, 400, { error: T('notConfigured', { svc }) });
    try {
      const body = r.method === 'POST' ? await readBody(r) : {};
      const out = await m.fn(u.searchParams, body, m.params);
      if (out?.__raw) {
        res.writeHead(200, { 'Content-Type': out.type, 'Cache-Control': 'private, max-age=86400', ...(out.headers || {}) });
        return res.end(out.__raw);
      }
      send(res, 200, out ?? { ok: true });
    } catch (e) {
      const msg = friendlyError(e);
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

server.listen(cfg.port, () => {
  const on = SERVICES.filter(enabled);
  console.log(`ArrHub ${VERSION} listening on http://0.0.0.0:${cfg.port} — services: ${on.join(', ') || 'none (configure them in Settings)'}`);
});
