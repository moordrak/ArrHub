// Configuration: config.json + environment variables, own CA certificate, settings view and validation.
// The live configuration is `config.cfg` (replaced by reload() after the settings are saved).
'use strict';

const fs = require('fs');
const path = require('path');
const { LANGS, T } = require('./i18n');

let VERSION = 'dev';
try { VERSION = require('../package.json').version || VERSION; } catch {}

// ---------- Configuration ----------
const CONFIG_FILE = process.env.ARRHUB_CONFIG || path.join(__dirname, '..', 'config.json');
const SERVICES = ['radarr', 'sonarr', 'nzbget', 'qbittorrent', 'seerr', 'prowlarr', 'bazarr'];
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
  ['prowlarr', 'url', 'PROWLARR_URL'], ['prowlarr', 'apiKey', 'PROWLARR_KEY', true],
  ['bazarr', 'url', 'BAZARR_URL'], ['bazarr', 'apiKey', 'BAZARR_KEY', true],
  // optional address the browser opens from the cards (e.g. a public reverse-proxy URL); empty = the service URL
  ['radarr', 'link', 'RADARR_LINK'], ['sonarr', 'link', 'SONARR_LINK'], ['nzbget', 'link', 'NZBGET_LINK'],
  ['qbittorrent', 'link', 'QBIT_LINK'], ['seerr', 'link', 'SEERR_LINK'], ['prowlarr', 'link', 'PROWLARR_LINK'], ['bazarr', 'link', 'BAZARR_LINK'],
  // accept a self-signed / locally signed TLS certificate for that service only
  ['radarr', 'insecure', 'RADARR_INSECURE'], ['sonarr', 'insecure', 'SONARR_INSECURE'], ['nzbget', 'insecure', 'NZBGET_INSECURE'],
  ['qbittorrent', 'insecure', 'QBIT_INSECURE'], ['seerr', 'insecure', 'SEERR_INSECURE'], ['prowlarr', 'insecure', 'PROWLARR_INSECURE'], ['bazarr', 'insecure', 'BAZARR_INSECURE'],
  // own CA certificate(s) in PEM, trusted (together with the system CAs) for connections to the services
  ['tls', 'ca', 'ARRHUB_CA'],
  // offline mode: ArrHub only talks to the configured services (no update check, no TMDB/TVDB images)
  ['net', 'offline', 'ARRHUB_OFFLINE'],
  // Docker Engine API on the Docker host: http://host:2375 (socket proxy), https://host:2376 (TLS) or unix:///var/run/docker.sock
  ['docker', 'url', 'ARRHUB_DOCKER_URL'], ['docker', 'ca', 'ARRHUB_DOCKER_CA'], ['docker', 'cert', 'ARRHUB_DOCKER_CERT'],
  ['docker', 'key', 'ARRHUB_DOCKER_KEY', true], ['docker', 'cleanup', 'ARRHUB_DOCKER_CLEANUP'], ['docker', 'link', 'ARRHUB_DOCKER_LINK'],
  // Docker control without an ArrHub login (only when a reverse proxy in front of ArrHub asks for a login)
  ['docker', 'noAuth', 'ARRHUB_DOCKER_NOAUTH'],
  // ssh://user@host – private key for it (OpenSSH format, no passphrase)
  ['docker', 'sshKey', 'ARRHUB_DOCKER_SSH_KEY', true],
  // address of the Docker host for opening containers' web pages (default: host of the Docker address)
  ['docker', 'webHost', 'ARRHUB_DOCKER_WEB_HOST'],
  // Nginx Proxy Manager (optional): its proxy hosts give containers their https addresses
  ['npm', 'url', 'ARRHUB_NPM_URL'], ['npm', 'user', 'ARRHUB_NPM_USER'], ['npm', 'pass', 'ARRHUB_NPM_PASS', true],
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
  const c = { auth: {}, ui: {}, tls: {}, net: {}, docker: {}, npm: {} };
  for (const k of SERVICES) c[k] = {};
  for (const [sec, f, env] of FIELDS) {
    const v = envSet(env) ? process.env[env] : getF(file, sec, f);
    if (v !== undefined) setF(c, sec, f, v);
  }
  c.port = Number(c.port) || 8686;
  c.refresh = Math.min(300, Math.max(2, Number(c.refresh) || 5));
  for (const k of SERVICES) if (c[k].url) c[k].url = String(c[k].url).trim().replace(/\/+$/, '');
  for (const k of SERVICES) c[k].insecure = toBool(c[k].insecure);
  c.net.offline = toBool(c.net.offline);
  // Docker TLS files the Docker way: a directory with ca.pem, cert.pem and key.pem
  if (process.env.ARRHUB_DOCKER_CERT_PATH) for (const [f, file] of [['ca', 'ca.pem'], ['cert', 'cert.pem'], ['key', 'key.pem']]) {
    if (!c.docker[f]) try { c.docker[f] = fs.readFileSync(path.join(process.env.ARRHUB_DOCKER_CERT_PATH, file), 'utf8'); } catch {}
  }
  if (!c.docker.sshKey && process.env.ARRHUB_DOCKER_SSH_KEY_FILE) { try { c.docker.sshKey = fs.readFileSync(process.env.ARRHUB_DOCKER_SSH_KEY_FILE, 'utf8'); } catch (e) { console.error('ARRHUB_DOCKER_SSH_KEY_FILE:', e.message); } }
  if (c.docker.url) c.docker.url = String(c.docker.url).trim().replace(/\/+$/, '');
  c.docker.noAuth = toBool(c.docker.noAuth);
  c.docker.cleanup = c.docker.cleanup === undefined || c.docker.cleanup === '' ? true : toBool(c.docker.cleanup);
  if (!c.tls.ca && process.env.ARRHUB_CA_FILE) { try { c.tls.ca = fs.readFileSync(process.env.ARRHUB_CA_FILE, 'utf8'); } catch (e) { console.error('ARRHUB_CA_FILE:', e.message); } }
  try { caState = c.tls.ca ? parseCa(c.tls.ca) : null; } catch (e) { caState = null; console.error('CA certificate ignored:', e.message); }
  c.ui = normalizeUi(c.ui);
  return c;
}
// ---------- Own CA certificate ----------
const crypto_ = require('crypto');
let caState = null;   // { pem: [..], info: [{ subject, issuer, validTo, ca }] } for the saved CA
function parseCa(text) {
  const raw = String(text || '');
  if (/PRIVATE KEY-----/.test(raw)) throw new Error(T('caPrivateKey'));
  const pems = raw.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  if (!pems.length) throw new Error(T('caInvalid'));
  const info = pems.map(pem => {
    let x; try { x = new crypto_.X509Certificate(pem); } catch { throw new Error(T('caInvalid')); }
    const cn = (s) => (String(s).match(/CN=([^\n,]+)/) || [])[1] || String(s).split('\n')[0];
    return { subject: cn(x.subject), issuer: cn(x.issuer), validTo: new Date(x.validTo).toISOString(), ca: x.ca };
  });
  return { pem: pems, info };
}
const toBool = v => v === true || v === 1 || /^(true|1|yes|on)$/i.test(String(v ?? ''));
let cfg = loadConfig();

// Settings for the UI (secrets masked, flags fields that come from the environment)
function settingsView() {
  const out = { values: {}, locked: [], file: CONFIG_FILE, caInfo: caState?.info || [] };
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
  const c = { auth: {}, ui: {}, tls: {}, net: {}, docker: {}, npm: {} };
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
  if (c.net && c.net.offline !== undefined) c.net.offline = toBool(c.net.offline);
  if (c.docker?.url) {
    const u = String(c.docker.url).trim();
    if (!/^(unix:\/\/\/|\/|tcp:\/\/|https?:\/\/|ssh:\/\/)/i.test(u)) throw new Error(T('dockerBadUrl'));
    if (/^(tcp|https?|ssh):/i.test(u)) { try { const x = new URL(u.replace(/^tcp:/i, 'http:')); if (!x.hostname) throw 0; } catch { throw new Error(T('dockerBadUrl')); } }
  }
  if (c.docker?.cert && !/-----BEGIN CERTIFICATE-----/.test(c.docker.cert)) throw new Error(T('dockerBadCert'));
  if (c.npm?.url) { try { const x = new URL(c.npm.url); if (!/^https?:$/.test(x.protocol)) throw 0; } catch { throw new Error(T('npmBadUrl')); } c.npm.url = c.npm.url.trim().replace(/\/+$/, ''); }
  if (c.docker?.key && c.docker.key !== MASK && !/PRIVATE KEY-----/.test(c.docker.key)) throw new Error(T('dockerBadKey'));
  if (c.docker?.ca && !/-----BEGIN CERTIFICATE-----/.test(c.docker.ca)) throw new Error(T('dockerBadCert'));
  if (c.docker && c.docker.cleanup !== undefined) c.docker.cleanup = toBool(c.docker.cleanup);
  if (c.docker && c.docker.noAuth !== undefined) c.docker.noAuth = toBool(c.docker.noAuth);
  if (c.docker?.sshKey && c.docker.sshKey !== MASK) {
    if (!/PRIVATE KEY-----/.test(c.docker.sshKey)) throw new Error(T('sshBadKey'));
    if (/ENCRYPTED/.test(c.docker.sshKey)) throw new Error(T('sshPassphrase'));
  }
  if (c.tls?.ca) c.tls.ca = parseCa(c.tls.ca).pem.join('\n') + '\n';   // throws on junk or a private key
  for (const k of SERVICES) {
    const l = c[k]?.link;
    if (!l) continue;
    let p; try { p = new URL(l); } catch { throw new Error(T('linkInvalid', { svc: k })); }
    if (!/^https?:$/.test(p.protocol)) throw new Error(T('linkInvalid', { svc: k }));
    c[k].link = l.replace(/\/+$/, '');
  }
  for (const k of ['radarr', 'sonarr', 'seerr', 'prowlarr', 'bazarr']) if (c[k]?.url && !c[k].apiKey) throw new Error(T('needsKey', { svc: k[0].toUpperCase() + k.slice(1) }));
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

module.exports = { SERVICES, VERSION, CONFIG_FILE, mergeInput, validate, readFileConfig, FIELDS, envSet, getF, setF, loadConfig, parseCa, MASK, settingsView, get cfg() { return cfg; }, get caState() { return caState; }, reload() { cfg = loadConfig(); return cfg; } };
