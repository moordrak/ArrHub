// ArrHub — one dashboard for Radarr, Sonarr, NZBGet, qBittorrent and Seerr
// No external dependencies, requires Node.js 18+
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const util = require('util');

// ---------- ArrHub's own log: everything written to the console is also kept in memory for the Logs tab ----------
const LOG_MAX = 1000;
const logBuf = [];
let logSeq = 0;
for (const [m, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
  const orig = console[m].bind(console);
  console[m] = (...args) => {
    orig(...args);
    try {
      const message = args.map(a => a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : util.inspect(a, { depth: 3 }))
        .join(' ').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s+/, '');
      logBuf.push({ id: ++logSeq, time: new Date().toISOString(), level, message });
      if (logBuf.length > LOG_MAX) logBuf.shift();
    } catch {}
  };
}

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
    netSelfSigned: 'The certificate is self-signed or locally signed – add your CA certificate in Settings or enable “Accept self-signed certificate” for this service',
    caInvalid: 'The CA certificate is not valid – paste the PEM text starting with -----BEGIN CERTIFICATE-----',
    caPrivateKey: 'That is a private key – paste only the CA certificate (-----BEGIN CERTIFICATE-----), never the key',
    netCertExpired: 'The TLS certificate has expired', netCertName: 'The TLS certificate does not match the address – the URL must use a name or IP listed in the certificate', fetchFailed: 'Connection failed',
    e401: 'Invalid API key or username/password (401)', e403: 'Access denied – check the API key (403)', e404: 'Not found (404) – check the URL and URL Base',
    noIcon: 'No icon found on the service', loginRequired: 'Login required', notFound: 'Not found', notConfigured: '{svc} is not configured', forbidden: 'Forbidden', badRequest: 'Bad request', offlineBlocked: 'Offline mode – ArrHub does not connect to {host}', offlineNoRemote: 'offline mode – no image from the internet',
    dockerNotConfigured: 'Docker is not configured', dockerBadUrl: 'Docker address must start with http://, https://, tcp://, ssh:// or unix:///',
    dockerBadCert: 'The Docker certificate must be PEM text starting with -----BEGIN CERTIFICATE-----', dockerBadKey: 'The Docker client key must be a PEM private key',
    dockerForbidden: 'The Docker socket proxy refused this request – allow CONTAINERS, IMAGES, NETWORKS, DISTRIBUTION, INFO and POST',
    dockerForbiddenVar: 'The Docker socket proxy refused {what} – set {vars} on the socket-proxy container and recreate it',
    dockerNoSocket: 'Docker socket {path} not found', dockerSocketPerm: 'No permission for the Docker socket {path}',
    dockerOk: 'Connected – Docker {version}, {n} containers', dockerSelf: 'This is ArrHub\'s own container – it cannot stop or replace itself',
    dockerPinned: 'The image is pinned to a fixed version (digest) – change it in your compose file', dockerNoImage: 'The image could not be found after pulling',
    dockerAutoRemove: 'The container was started with --rm and would disappear when stopped – recreate it with docker compose',
    dockerCrashed: 'The new container stopped or kept restarting right after starting (exit code {code})',
    sshMissing: 'The ssh client is not installed (install the openssh-client package)', sshAuth: 'SSH login refused – add ArrHub\'s public key to ~/.ssh/authorized_keys of that user on the Docker host',
    sshHostKey: 'The Docker host\'s SSH key has changed – if that is expected, delete its line from {file}', sshNoDocker: 'Docker is not installed for that user on the Docker host (docker: command not found)',
    sshDockerGroup: 'That SSH user may not use Docker – add it to the docker group on the Docker host (sudo usermod -aG docker <user>)',
    sshBadKey: 'The SSH key is not a valid private key (OpenSSH format, -----BEGIN OPENSSH PRIVATE KEY-----)', sshPassphrase: 'The SSH key is protected with a passphrase – use a key without one',
    sshClosed: 'The SSH connection was closed by the Docker host', dockerUnhealthy: 'The new container reports itself as unhealthy',
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
    netSelfSigned: 'Certifikat je samopotpisan ili lokalno potpisan – dodaj svoj CA certifikat u Postavkama ili uključi „Prihvati samopotpisani certifikat” za ovaj servis',
    caInvalid: 'CA certifikat nije ispravan – zalijepi PEM tekst koji počinje s -----BEGIN CERTIFICATE-----',
    caPrivateKey: 'To je privatni ključ – zalijepi samo CA certifikat (-----BEGIN CERTIFICATE-----), nikad ključ',
    netCertExpired: 'TLS certifikat je istekao', netCertName: 'TLS certifikat ne odgovara adresi – URL mora koristiti ime ili IP naveden u certifikatu', fetchFailed: 'Povezivanje nije uspjelo',
    e401: 'Neispravan API ključ ili korisničko ime/lozinka (401)', e403: 'Pristup odbijen – provjeri API ključ (403)', e404: 'Nije pronađeno (404) – provjeri URL i URL Base',
    noIcon: 'Servis nema dostupnu ikonu', loginRequired: 'Potrebna prijava', notFound: 'Nije pronađeno', notConfigured: '{svc} nije konfiguriran', forbidden: 'Zabranjeno', badRequest: 'Neispravan zahtjev', offlineBlocked: 'Način bez interneta – ArrHub se ne spaja na {host}', offlineNoRemote: 'način bez interneta – nema slike s interneta',
    dockerNotConfigured: 'Docker nije podešen', dockerBadUrl: 'Adresa Dockera mora počinjati s http://, https://, tcp://, ssh:// ili unix:///',
    dockerBadCert: 'Docker certifikat mora biti PEM tekst koji počinje s -----BEGIN CERTIFICATE-----', dockerBadKey: 'Docker klijentski ključ mora biti PEM privatni ključ',
    dockerForbidden: 'Docker socket proxy je odbio zahtjev – dopusti CONTAINERS, IMAGES, NETWORKS, DISTRIBUTION, INFO i POST',
    dockerForbiddenVar: 'Docker socket proxy je odbio {what} – postavi {vars} na socket-proxy kontejneru i ponovno ga pokreni',
    dockerNoSocket: 'Docker socket {path} nije pronađen', dockerSocketPerm: 'Nema dozvole za Docker socket {path}',
    dockerOk: 'Spojeno – Docker {version}, {n} kontejnera', dockerSelf: 'Ovo je ArrHubov vlastiti kontejner – ne može sam sebe zaustaviti ni zamijeniti',
    dockerPinned: 'Image je vezan na fiksnu verziju (digest) – promijeni ga u compose datoteci', dockerNoImage: 'Image nije pronađen nakon preuzimanja',
    dockerAutoRemove: 'Kontejner je pokrenut s --rm i nestao bi kad se zaustavi – ponovno ga stvori s docker compose',
    dockerCrashed: 'Novi kontejner se zaustavio ili se stalno ponovno pokreće odmah nakon pokretanja (izlazni kod {code})',
    sshMissing: 'SSH klijent nije instaliran (instaliraj paket openssh-client)', sshAuth: 'SSH prijava odbijena – dodaj ArrHubov javni ključ u ~/.ssh/authorized_keys tog korisnika na Docker hostu',
    sshHostKey: 'SSH ključ Docker hosta se promijenio – ako je to očekivano, obriši njegov redak iz {file}', sshNoDocker: 'Docker nije instaliran za tog korisnika na Docker hostu (docker: command not found)',
    sshDockerGroup: 'Taj SSH korisnik ne smije koristiti Docker – dodaj ga u grupu docker na Docker hostu (sudo usermod -aG docker <korisnik>)',
    sshBadKey: 'SSH ključ nije ispravan privatni ključ (OpenSSH format, -----BEGIN OPENSSH PRIVATE KEY-----)', sshPassphrase: 'SSH ključ je zaštićen lozinkom – koristi ključ bez nje',
    sshClosed: 'Docker host je zatvorio SSH vezu', dockerUnhealthy: 'Novi kontejner javlja da nije zdrav (unhealthy)',
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
  // own CA certificate(s) in PEM, trusted (together with the system CAs) for connections to the services
  ['tls', 'ca', 'ARRHUB_CA'],
  // offline mode: ArrHub only talks to the configured services (no update check, no TMDB/TVDB images)
  ['net', 'offline', 'ARRHUB_OFFLINE'],
  // Docker Engine API on the Docker host: http://host:2375 (socket proxy), https://host:2376 (TLS) or unix:///var/run/docker.sock
  ['docker', 'url', 'ARRHUB_DOCKER_URL'], ['docker', 'ca', 'ARRHUB_DOCKER_CA'], ['docker', 'cert', 'ARRHUB_DOCKER_CERT'],
  ['docker', 'key', 'ARRHUB_DOCKER_KEY', true], ['docker', 'cleanup', 'ARRHUB_DOCKER_CLEANUP'], ['docker', 'link', 'ARRHUB_DOCKER_LINK'],
  // ssh://user@host – private key for it (OpenSSH format, no passphrase)
  ['docker', 'sshKey', 'ARRHUB_DOCKER_SSH_KEY', true],
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
  const c = { auth: {}, ui: {}, tls: {}, net: {}, docker: {} };
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
  c.docker.cleanup = c.docker.cleanup === undefined || c.docker.cleanup === '' ? true : toBool(c.docker.cleanup);
  if (!c.tls.ca && process.env.ARRHUB_CA_FILE) { try { c.tls.ca = fs.readFileSync(process.env.ARRHUB_CA_FILE, 'utf8'); } catch (e) { console.error('ARRHUB_CA_FILE:', e.message); } }
  try { caState = c.tls.ca ? parseCa(c.tls.ca) : null; } catch (e) { caState = null; console.error('CA certificate ignored:', e.message); }
  c.ui = normalizeUi(c.ui);
  return c;
}
// ---------- Own CA certificate ----------
const crypto_ = require('crypto'), tls_ = require('tls');
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
  const c = { auth: {}, ui: {}, tls: {}, net: {}, docker: {} };
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
  if (c.docker?.key && c.docker.key !== MASK && !/PRIVATE KEY-----/.test(c.docker.key)) throw new Error(T('dockerBadKey'));
  if (c.docker?.ca && !/-----BEGIN CERTIFICATE-----/.test(c.docker.ca)) throw new Error(T('dockerBadCert'));
  if (c.docker && c.docker.cleanup !== undefined) c.docker.cleanup = toBool(c.docker.cleanup);
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
  mediaCache.at = 0; aboutCache.at = 0;   // offline mode / service URLs may have changed
  console.log('Settings saved' + (cfg.net?.offline ? ' (offline mode)' : ''));
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
  const ca = c.tls?.ca ? parseCa(c.tls.ca) : null;
  return tlsStore.run({ allow: new Set(s.insecure ? [o] : []), deny: new Set(s.insecure ? [] : [o]), origin: o, ca }, () => runServiceTest(service, s));
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
// TLS options for a request: null = normal fetch; otherwise used by httpsFetch.
// Only the services' own https origins are affected: "accept self-signed" turns verification off,
// an own CA adds trusted roots (system CAs + own CA, full verification incl. host name).
function tlsFor(url) {
  const o = originOf(url);
  if (!o || !o.startsWith('https:')) return null;
  const t = tlsStore.getStore();
  const isService = t?.origin === o || SERVICES.some(k => cfg[k]?.url && originOf(cfg[k].url) === o);
  if (!isService) return null;
  const insecure = t?.deny.has(o) ? false : t?.allow.has(o) ? true : SERVICES.some(k => cfg[k]?.insecure && cfg[k].url && originOf(cfg[k].url) === o);
  if (insecure) return { agent: tlsAgent('insecure', { rejectUnauthorized: false }) };
  const ca = t && 'ca' in t ? t.ca : caState;
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
  return !!o && (tlsStore.getStore()?.origin === o || SERVICES.some(k => cfg[k]?.url && originOf(cfg[k].url) === o));
}
async function req(url, { timeout = TIMEOUT, ...opts } = {}) {
  if (cfg.net?.offline && !isServiceUrl(url)) throw new Error(T('offlineBlocked', { host: originOf(url) || url }));
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
      return { version: status.version, queue: queue.records || [], calendar, health, disk };
    },
    // one page of history, newest first – Radarr/Sonarr do the paging
    async history(page, size) {
      const d = await call(`/history?page=${page}&pageSize=${size}&sortKey=date&sortDirection=descending` + (name === 'radarr' ? '&includeMovie=true' : '&includeSeries=true&includeEpisode=true'));
      return { records: d.records || [], total: d.totalRecords ?? (d.records || []).length };
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
  // qBittorrent keeps no download history: completed torrents still in the list, newest completion first
  async history(page, size) {
    const all = await this.call('/torrents/info?filter=completed&sort=completion_on&reverse=true');
    const list = (Array.isArray(all) ? all : []).filter(x => x.completion_on > 0);
    const pick = ({ name, hash, completion_on, size: sz, total_size, category, ratio, state, tags }) => ({ name, hash, completion_on, size: total_size || sz, category, ratio, state, tags });
    return { records: list.slice((page - 1) * size, page * size).map(pick), total: list.length };
  },
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
    const [status, groups, version] = await Promise.all([
      this.rpc('status'), this.rpc('listgroups', [0]), this.rpc('version').catch(() => ''),
    ]);
    return { version, status, groups };
  },
  // NZBGet always returns its whole history (newest first); ArrHub cuts out the page
  async history(page, size) {
    const h = await this.rpc('history', [false]) || [];
    return { records: h.slice((page - 1) * size, page * size), total: h.length };
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
const PAGE_SIZES = [10, 20, 30, 50, 100];
const SEERR_PAGE_SIZES = PAGE_SIZES;
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
  // Seerr's own image proxy/cache: /imageproxy/tmdb/... (Seerr, Jellyseerr 2.x) or /imageproxy/... (Overseerr)
  function seerrProxy(tmdbPath) {
    const base = cfg.seerr?.url; if (!base) return null;
    return [`${base}/imageproxy/tmdb${tmdbPath}`, `${base}/imageproxy${tmdbPath}`];
  }
  function posterUrl(path) {
    if (!path) return null;
    const id = hashId('seerr' + path);
    coverMap.set(id, { svc: 'seerr', local: seerrProxy(`/t/p/w154${path}`), remote: `https://image.tmdb.org/t/p/w154${path}`, kind: 'poster' });
    return `/api/cover/${id}`;
  }
  return {
    call, seerrProxy,
    async summary(filter = 'all', page = 1, size = 30) {
      const local = SEERR_LOCAL[filter];
      if (!local && !SEERR_FILTERS.includes(filter)) filter = 'all';
      size = SEERR_PAGE_SIZES.includes(Number(size)) ? Number(size) : 30;
      page = Math.max(1, Math.floor(Number(page)) || 1);
      const skip = (page - 1) * size;
      const [status, count, list] = await Promise.all([
        call('/status').catch(() => ({})),
        call('/request/count').catch(() => ({})),
        // Seerr pages for us; filters it doesn't know (declined) are filtered here from the newest 1000
        call(local ? '/request?take=1000&skip=0&sort=added&filter=all' : `/request?take=${size}&skip=${skip}&sort=added&filter=${filter}`),
      ]);
      const matched = local ? (list.results || []).filter(local) : null;
      const total = local ? matched.length : (list.pageInfo?.results ?? (list.results || []).length);
      const results = local ? matched.slice(skip, skip + size) : (list.results || []).slice(0, size);
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
      return { version: status.version || '', updateAvailable: !!status.updateAvailable, count, filter, total, page, pageSize: size, pages: Math.max(1, Math.ceil(total / size)), requests };
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

// Add tab: normally the browser loads lookup posters straight from TMDB/TVDB. In offline mode they go
// through ArrHub instead – via Seerr's image proxy for TMDB posters, otherwise no poster.
function lookupPosters(list) {
  if (!cfg.net?.offline || !Array.isArray(list)) return list;
  return list.map(r => {
    const remote = r.remotePoster || r.images?.find(x => x.coverType === 'poster')?.remoteUrl || '';
    const m = /image\.tmdb\.org\/t\/p\/[^/]+(\/[^/?#]+)/.exec(remote);
    let poster = null;
    if (m && enabled('seerr')) {
      const id = hashId('lookup' + m[1]);
      coverMap.set(id, { svc: 'seerr', local: seerr.seerrProxy(`/t/p/w154${m[1]}`), remote: null, kind: 'poster' });
      poster = `/api/cover/${id}`;
    }
    return { ...r, arrhubPoster: poster };
  });
}

// ---------- Logs (ArrHub + the services' own logs, normalised) ----------
const lvl = v => { v = String(v || '').toLowerCase(); return /fatal|error|crit/.test(v) ? 'error' : /warn/.test(v) ? 'warn' : /debug|trace|detail/.test(v) ? 'debug' : 'info'; };
const LOG_SOURCES = ['arrhub', ...SERVICES];
async function serviceLogs(src) {
  if (!LOG_SOURCES.includes(src)) { const e = new Error(T('notFound')); e.status = 404; throw e; }
  if (src !== 'arrhub' && !enabled(src)) { const e = new Error(T('notConfigured', { svc: src })); e.status = 400; throw e; }
  let entries;
  if (src === 'arrhub') entries = logBuf.slice().reverse().map(e => ({ time: e.time, level: e.level, message: e.message }));
  else if (src === 'radarr' || src === 'sonarr') {
    const d = await arr(src).call('/log?page=1&pageSize=250&sortKey=time&sortDirection=descending');
    entries = (d.records || []).map(r => ({ time: r.time, level: lvl(r.level), source: r.logger, message: r.message, detail: r.exception || undefined }));
  } else if (src === 'qbittorrent') {
    const d = await qb.call('/log/main?last_known_id=-1');
    entries = (Array.isArray(d) ? d : []).slice(-250).reverse().map(r => ({
      time: new Date(r.timestamp * 1000).toISOString(), message: r.message,
      level: r.type & 8 ? 'error' : r.type & 4 ? 'warn' : 'info',
    }));
  } else if (src === 'nzbget') {
    const d = await nzb.rpc('log', [0, 250]);
    entries = (d || []).slice().reverse().map(r => ({ time: new Date(r.Time * 1000).toISOString(), level: lvl(r.Kind), message: r.Text }));
  } else if (src === 'seerr') {
    const d = await seerr.call('/settings/logs?take=250&skip=0&filter=debug');
    entries = (d.results || []).map(r => ({ time: r.timestamp, level: lvl(r.level), source: r.label, message: r.message, detail: r.data && Object.keys(r.data).length ? JSON.stringify(r.data, null, 2) : undefined }));
  }
  return { source: src, entries };
}
// note in ArrHub's own log when a service goes down or comes back (once per change, not on every refresh)
const svcState = {};
function noteService(svc, err) {
  const prev = svcState[svc];
  if (err) { if (prev !== err) console.warn(`${svc}: ${err}`); svcState[svc] = err; }
  else { if (prev) console.log(`${svc}: connection restored`); svcState[svc] = ''; }
}

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
        let u = im.url.startsWith('http') ? im.url : null;
        if (!u) { try { u = new URL(im.url, new URL(cfg[k].url).origin + '/').toString(); } catch {} }
        if (u && kind === 'poster') u = u.replace(/poster(\.jpg)/, 'poster-500$1');
        // /api/v3/mediacover/<id>/<file> accepts the API key even when Radarr/Sonarr require a login
        // (the plain /MediaCover/ path then redirects to the login page); the plain path stays as fallback
        const m = u && /\/MediaCover\/(\d+)\/([^/?#]+\.(?:jpe?g|png|gif))/i.exec(u);
        local = m ? [`${cfg[k].url}/api/v3/mediacover/${m[1]}/${m[2]}`, u] : u;
      }
      const remote = cfg.net?.offline ? null : remoteSized(im.remoteUrl, kind);
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
  if (e.remote && cfg.net?.offline) errors.push(T('offlineNoRemote'));
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
  if (cfg.net?.offline) return { ...base, offline: true, latest: null, updateAvailable: false, error: null };
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
  if (cfg.docker?.link) { try { const u = new URL(cfg.docker.link); out.docker = u.toString().replace(/\/+$/, '') + '/'; } catch {} }
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


// ---------- Docker (Engine API) ----------
// Talks to the Docker daemon on the Docker host – normally through a socket proxy (http://host:2375),
// or directly over TLS with client certificates (https://host:2376), or a local unix socket.
const os_ = require('os');
const dockerOn = () => !!cfg.docker?.url;
function dockerTarget(d = cfg.docker || {}) {
  const raw = String(d.url || '').trim();
  if (!raw) return null;
  if (/^unix:\/\//i.test(raw) || raw.startsWith('/')) return { socketPath: raw.replace(/^unix:\/\//i, '') };
  if (/^ssh:\/\//i.test(raw)) {
    const u = new URL(raw);
    return { ssh: { user: decodeURIComponent(u.username || ''), host: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || '', key: d.sshKey && d.sshKey !== MASK ? d.sshKey : '' } };
  }
  const url = new URL(raw.replace(/^tcp:\/\//i, d.cert ? 'https://' : 'http://'));
  const tls = url.protocol === 'https:' ? {
    ...(d.ca ? { ca: [...tls_.rootCertificates, ...(parseCa(d.ca).pem)] } : caState?.pem?.length ? { ca: [...tls_.rootCertificates, ...caState.pem] } : {}),
    ...(d.cert ? { cert: d.cert } : {}), ...(d.key && d.key !== MASK ? { key: d.key } : {}),
  } : null;
  return { url, tls };
}

// ---- Docker over SSH: like `DOCKER_HOST=ssh://…` – ssh runs `docker system dial-stdio` on the Docker host and the
// Docker API goes through that connection. Uses the system ssh client (openssh-client); one shared connection
// (ControlMaster) keeps it fast.
const { spawn, execFile } = require('child_process');
const { Duplex } = require('stream');
const sshDir = (() => {
  const d = path.join(os_.tmpdir(), `arrhub-ssh-${typeof process.getuid === 'function' ? process.getuid() : 'u'}`);
  try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.chmodSync(d, 0o700); } catch {}
  return d;
})();
// host keys are remembered next to config.json (first connection is trusted, a changed key is refused)
const knownHosts = (() => {
  const f = path.join(path.dirname(CONFIG_FILE), 'docker_known_hosts');
  try { fs.accessSync(path.dirname(f), fs.constants.W_OK); return f; } catch { return path.join(sshDir, 'known_hosts'); }
})();
const keyHash = k => crypto_.createHash('sha256').update(k || '').digest('hex').slice(0, 10);
function sshKeyFile(key) {
  if (!key) return null;
  const f = path.join(sshDir, `key-${keyHash(key)}`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, key.replace(/\r\n/g, '\n').trim() + '\n', { mode: 0o600 });
  return f;
}
function sshArgs(t, { shared = true } = {}) {
  const a = ['-F', '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30', '-o', 'LogLevel=ERROR',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${knownHosts}`];
  const kf = sshKeyFile(t.key);
  if (kf) a.push('-i', kf, '-o', 'IdentitiesOnly=yes');
  if (shared) a.push('-o', 'ControlMaster=auto', '-o', `ControlPath=${sshDir}/cm-${keyHash(t.key)}-%C`, '-o', 'ControlPersist=300');
  else a.push('-o', 'ControlMaster=no', '-o', 'ControlPath=none');
  if (t.port) a.push('-p', String(t.port));
  a.push(t.user ? `${t.user}@${t.host}` : t.host, '--', 'docker', 'system', 'dial-stdio');
  return a;
}
function sshStream(t) {
  const child = spawn('ssh', sshArgs(t, { shared: !t.test }), { stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', b => { err = (err + b).slice(-4000); });
  const d = Duplex.from({ readable: child.stdout, writable: child.stdin });
  d.sshErr = () => err;
  child.on('error', e => { d.spawnErr = e; d.destroy(e); });
  child.on('exit', () => setTimeout(() => d.destroy(), 50));
  d.on('close', () => { try { child.kill(); } catch {} });
  for (const m of ['setTimeout', 'setNoDelay', 'setKeepAlive', 'ref', 'unref']) if (typeof d[m] !== 'function') d[m] = () => d;
  return d;
}
function sshMessage(stderr, e) {
  const s = String(stderr || '').trim();
  if (e?.code === 'ENOENT' && /spawn/.test(e.syscall || e.message || '')) return T('sshMissing');
  if (/Permission denied \(/i.test(s)) return T('sshAuth');
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(s)) return T('sshHostKey', { file: knownHosts });
  if (/Could not resolve hostname/i.test(s)) return T('netNotFound');
  if (/Connection refused/i.test(s)) return T('netRefused');
  if (/timed out/i.test(s)) return T('netTimeout');
  if (/No route to host/i.test(s)) return T('netHost');
  if (/docker.*(command )?not found/i.test(s)) return T('sshNoDocker');
  if (/permission denied.*docker daemon socket|docker\.sock.*permission denied/i.test(s)) return T('sshDockerGroup');
  if (/load key|invalid format|error in libcrypto|passphrase/i.test(s)) return T('sshBadKey');
  return s.split('\n').filter(Boolean).pop() || (e?.message === 'socket hang up' ? T('sshClosed') : e?.message) || T('sshClosed');
}
// new key pair for ArrHub (Settings → Docker → Generate)
function sshKeygen() {
  return new Promise((resolve, reject) => {
    const f = path.join(sshDir, `gen-${crypto_.randomBytes(4).toString('hex')}`);
    execFile('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'arrhub', '-f', f], err => {
      if (err) return reject(new Error(err.code === 'ENOENT' ? T('sshMissing') : err.message));
      try {
        const priv = fs.readFileSync(f, 'utf8'), pub = fs.readFileSync(f + '.pub', 'utf8').trim();
        resolve({ privateKey: priv, publicKey: pub, authorizedKeys: authLine(pub) });
      } catch (e) { reject(e); }
      finally { fs.rm(f, () => {}); fs.rm(f + '.pub', () => {}); }
    });
  });
}
const authLine = pub => `command="docker system dial-stdio",restrict ${pub}`;
// the public half of the saved key, for the authorized_keys line shown in Settings
function sshPublic() {
  return new Promise(resolve => {
    const key = cfg.docker?.sshKey;
    if (!key) return resolve({ publicKey: null });
    let f; try { f = sshKeyFile(key); } catch { return resolve({ publicKey: null }); }
    execFile('ssh-keygen', ['-y', '-f', f], (err, out) => {
      const pub = !err && String(out).trim();
      resolve(pub ? { publicKey: pub, authorizedKeys: authLine(pub) } : { publicKey: null });
    });
  });
}
const dockerErr = (msg, extra = {}) => Object.assign(new Error(msg), extra);
// socket proxy (linuxserver / tecnativa) environment variables that allow a request
function proxyVars(method, p) {
  const path = p.split('?')[0].replace(/^\/v[\d.]+/, '');
  const sec = { _ping: 'PING', version: 'VERSION', info: 'INFO', containers: 'CONTAINERS', images: 'IMAGES', distribution: 'DISTRIBUTION', networks: 'NETWORKS' }[path.split('/')[1]] || path.split('/')[1].toUpperCase();
  const act = /^\/containers\/[^/]+\/(start|stop|restart|pause|unpause)$/.exec(path)?.[1];
  if (act) return `${sec}=1 + ALLOW_${{ start: 'START', stop: 'STOP', restart: 'RESTARTS', pause: 'PAUSE', unpause: 'UNPAUSE' }[act]}=1`;
  return method === 'GET' || method === 'HEAD' ? `${sec}=1` : `${sec}=1 + POST=1`;
}
function dockerApi(method, p, { body, timeout = 20000, raw = false, onData, target } = {}) {
  target = target || dockerTarget();
  return new Promise((resolve, reject) => {
    if (!target) return reject(dockerErr(T('dockerNotConfigured'), { status: 400 }));
    const isTls = !!target.url && target.url.protocol === 'https:';
    const mod = isTls ? https_ : http_;
    const base = target.url ? target.url.pathname.replace(/\/+$/, '') : '';
    const o = { method, path: base + p, headers: { Host: target.url ? target.url.host : 'docker', Accept: 'application/json' } };
    let sock = null;
    if (target.ssh) { o.createConnection = () => (sock = sshStream(target.ssh)); o.headers.Connection = 'close'; }   // no agent: one ssh stream per request
    else if (target.socketPath) o.socketPath = target.socketPath;
    else { o.hostname = target.url.hostname; o.port = target.url.port || (isTls ? 443 : 80); }
    if (isTls) Object.assign(o, target.tls);
    let payload;
    if (body !== undefined) { payload = Buffer.from(JSON.stringify(body)); o.headers['Content-Type'] = 'application/json'; o.headers['Content-Length'] = payload.length; }
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(tm); fn(v); } };
    const r = mod.request(o, res => {
      const chunks = [];
      res.on('data', c => { if (onData && res.statusCode < 400) onData(c); else chunks.push(c); });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          let msg = buf.toString().trim().slice(0, 400), json = false;
          try { msg = JSON.parse(buf).message || msg; json = true; } catch {}
          // a socket proxy answers 403 with an HTML page – say which of its switches is off instead
          if (res.statusCode === 403 && !json) return finish(reject, dockerErr(T('dockerForbiddenVar', { what: `${method} ${p.split('?')[0]}`, vars: proxyVars(method, p) }), { dockerStatus: 403 }));
          return finish(reject, dockerErr(msg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || `HTTP ${res.statusCode}`, { dockerStatus: res.statusCode }));
        }
        if (raw) return finish(resolve, buf);
        if (!buf.length) return finish(resolve, null);
        try { finish(resolve, JSON.parse(buf)); } catch { finish(resolve, buf.toString()); }
      });
      res.on('error', e => finish(reject, target.ssh ? dockerErr(sshMessage(sock?.sshErr(), e)) : Object.assign(new TypeError('fetch failed'), { cause: e })));
    });
    const tm = setTimeout(() => { const se = sock?.sshErr(); r.destroy(); finish(reject, se ? dockerErr(sshMessage(se)) : Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } })); }, timeout);
    r.on('error', e => {
      if (target.ssh) return setTimeout(() => finish(reject, dockerErr(sshMessage(sock?.sshErr(), sock?.spawnErr || e))), 80);   // let ssh finish writing its error
      if (target.socketPath && e.code === 'ENOENT') return finish(reject, dockerErr(T('dockerNoSocket', { path: target.socketPath })));
      if (target.socketPath && e.code === 'EACCES') return finish(reject, dockerErr(T('dockerSocketPerm', { path: target.socketPath })));
      finish(reject, Object.assign(new TypeError('fetch failed'), { cause: e }));
    });
    if (payload) r.write(payload);
    r.end();
  });
}
const enc = encodeURIComponent;
// "lscr.io/linuxserver/sonarr:latest" -> { repo: "lscr.io/linuxserver/sonarr", tag: "latest" }
function parseRef(ref) {
  ref = String(ref || '');
  if (/^sha256:/.test(ref) || ref.includes('@')) return { pinned: true, repo: ref.split('@')[0], tag: '' };
  const slash = ref.lastIndexOf('/'), colon = ref.lastIndexOf(':');
  return colon > slash ? { repo: ref.slice(0, colon), tag: ref.slice(colon + 1) } : { repo: ref, tag: 'latest' };
}
const refName = ref => { const r = parseRef(ref); return r.pinned ? ref : `${r.repo}:${r.tag}`; };
// is this container ArrHub itself? (then it must not stop or replace itself)
const selfIds = [os_.hostname()].filter(Boolean);
const isSelf = id => selfIds.some(h => h.length >= 12 && id.startsWith(h));

// ---- update check: the Docker host asks the registry, ArrHub itself never goes to the internet ----
const imgCache = new Map();      // image id -> { repoDigests }
const refState = new Map();      // image ref -> { remote, localId, error, at }
const dk = { checking: false, checkedAt: 0, info: null, infoAt: 0, version: null };
async function imageInfo(id) {
  if (imgCache.has(id)) return imgCache.get(id);
  const i = await dockerApi('GET', `/images/${enc(id)}/json`);
  const v = { id: i.Id, repoDigests: (i.RepoDigests || []).map(d => d.split('@')[1]).filter(Boolean), config: i.Config || {}, created: i.Created };
  if (imgCache.size > 300) imgCache.delete(imgCache.keys().next().value);
  imgCache.set(id, v);
  return v;
}
function checkUpdates(force = false) {
  if (dk.checkRun) return dk.checkRun;
  if (!force && Date.now() - dk.checkedAt < 6 * 3600e3) return Promise.resolve();
  dk.checkRun = runCheck().finally(() => { dk.checkRun = null; });
  return dk.checkRun;
}
// the image name a container was created from; when its tag has since moved to a newer image the list only
// shows the image ID, so ask the container itself (cached per container + image)
const refCache = new Map();
async function containerRef(c) {
  if (!/^sha256:/.test(c.Image || '')) return c.Image;
  const key = c.Id + c.ImageID;
  if (!refCache.has(key)) {
    try { refCache.set(key, (await dockerApi('GET', `/containers/${c.Id}/json`)).Config.Image); } catch { return c.Image; }
    if (refCache.size > 500) refCache.delete(refCache.keys().next().value);
  }
  return refCache.get(key);
}
async function runCheck() {
  dk.checking = true;
  try {
    const list = await dockerApi('GET', '/containers/json?all=1');
    const refs = [...new Set((await Promise.all(list.map(containerRef))).filter(r => r && !parseRef(r).pinned).map(refName))];
    let i = 0;
    const worker = async () => {
      while (i < refs.length) {
        const ref = refs[i++];
        const st = { at: Date.now() };
        try { st.localId = (await dockerApi('GET', `/images/${enc(ref)}/json`)).Id; } catch {}
        try { st.remote = (await dockerApi('GET', `/distribution/${enc(ref)}/json`, { timeout: 30000 }))?.Descriptor?.digest || null; }
        catch (e) { st.error = langStore.run('en', () => friendlyError(e)); }
        refState.set(ref, st);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    dk.checkedAt = Date.now();
    const errs = [...refState.values()].filter(x => x.error);
    if (errs.length) console.warn(`docker: update check failed for ${errs.length} image(s) – ${errs[0].error}`);
  } catch (e) { console.warn('docker: update check failed – ' + langStore.run('en', () => friendlyError(e))); }
  finally { dk.checking = false; }
}
async function updateStateFor(ref, imageId) {
  if (parseRef(ref).pinned) return { state: 'pinned' };
  const st = refState.get(refName(ref));
  if (!st) return { state: 'unknown' };
  if (st.localId && st.localId !== imageId) return { state: 'available', local: true };   // newer image already pulled
  if (st.error && !st.remote) return { state: 'error', error: st.error };
  if (!st.remote) return { state: 'unknown' };
  try { const img = await imageInfo(imageId); return { state: img.repoDigests.includes(st.remote) ? 'current' : 'available' }; }
  catch { return { state: 'unknown' }; }
}

// ---- containers ----
const prevCpu = new Map();
function calcStats(id, s) {
  const cpu = s.cpu_stats || {}, pre = s.precpu_stats || {};
  const cur = { total: cpu.cpu_usage?.total_usage || 0, sys: cpu.system_cpu_usage || 0 };
  const p = pre.system_cpu_usage ? { total: pre.cpu_usage?.total_usage || 0, sys: pre.system_cpu_usage } : prevCpu.get(id);
  prevCpu.set(id, cur);
  let cpuPct = null;
  if (p && cur.sys > p.sys) cpuPct = Math.max(0, ((cur.total - p.total) / (cur.sys - p.sys)) * (cpu.online_cpus || cpu.cpu_usage?.percpu_usage?.length || 1) * 100);
  const m = s.memory_stats || {};
  const cache = m.stats?.inactive_file ?? m.stats?.total_inactive_file ?? m.stats?.cache ?? 0;
  let rx = 0, tx = 0;
  for (const n of Object.values(s.networks || {})) { rx += n.rx_bytes || 0; tx += n.tx_bytes || 0; }
  return { cpu: cpuPct === null ? null : Math.round(cpuPct * 10) / 10, mem: m.usage ? Math.max(0, m.usage - cache) : null, memLimit: m.limit || null, rx, tx };
}
async function dockerContainers(withStats) {
  const list = await dockerApi('GET', '/containers/json?all=1');
  const chk = checkUpdates().catch(() => {});           // refresh update info in the background (every 6 h)
  if (!dk.checkedAt) await Promise.race([chk, new Promise(r => setTimeout(r, 4000))]);   // first time: wait a moment for it
  const out = await Promise.all(list.map(async c => {
    const image = await containerRef(c);
    const ports = [...new Set((c.Ports || []).filter(x => x.PublicPort).map(x => `${x.PublicPort}:${x.PrivatePort}/${x.Type}`))];
    return {
      id: c.Id, name: (c.Names?.[0] || '').replace(/^\//, ''), image, state: c.State, status: c.Status, created: c.Created,
      project: c.Labels?.['com.docker.compose.project'] || '', service: c.Labels?.['com.docker.compose.service'] || '',
      health: (/\((healthy|unhealthy|health: starting)\)/.exec(c.Status || '') || [])[1]?.replace('health: ', '') || '',
      ports, networkMode: c.HostConfig?.NetworkMode || '', self: isSelf(c.Id), update: await updateStateFor(image, c.ImageID),
    };
  }));
  if (withStats) {
    await Promise.all(out.filter(c => c.state === 'running').map(async c => {
      try { c.stats = calcStats(c.id, await dockerApi('GET', `/containers/${c.id}/stats?stream=false&one-shot=true`, { timeout: 8000 })); } catch {}
    }));
  }
  for (const c of out) c.job = [...jobs.values()].reverse().find(j => j.name === c.name && (!j.finishedAt || Date.now() - j.finishedAt < 60000)) || null;
  out.sort((a, b) => (a.project || '~').localeCompare(b.project || '~') || a.name.localeCompare(b.name));
  return out;
}
async function dockerInfo(force) {
  if (!force && dk.info && Date.now() - dk.infoAt < 60000) return dk.info;
  const [i, v] = await Promise.all([dockerApi('GET', '/info'), dockerApi('GET', '/version').catch(() => ({}))]);
  dk.info = { name: i.Name, version: i.ServerVersion || v.Version, api: v.ApiVersion, os: i.OperatingSystem, cpus: i.NCPU, mem: i.MemTotal,
    containers: i.Containers, running: i.ContainersRunning, images: i.Images };
  dk.infoAt = Date.now();
  return dk.info;
}
async function dockerSummary() {
  const list = await dockerContainers(false);
  const info = await dockerInfo().catch(() => null);
  return {
    version: info?.version || '', host: info?.name || '', total: list.length,
    running: list.filter(c => c.state === 'running').length, stopped: list.filter(c => c.state !== 'running').length,
    unhealthy: list.filter(c => c.health === 'unhealthy').length, updates: list.filter(c => c.update.state === 'available').length,
    checkedAt: dk.checkedAt || null,
  };
}
async function dockerTest(values) {
  const c = mergeInput(values || {});
  const target = dockerTarget(c.docker || {});
  if (!target) throw new Error(T('dockerNotConfigured'));
  if (target.ssh) target.ssh.test = true;
  await dockerApi('GET', '/_ping', { target });
  const v = await dockerApi('GET', '/version', { target });
  const n = await dockerApi('GET', '/containers/json?all=1', { target });
  return { ok: true, version: v?.Version || '', message: T('dockerOk', { version: v?.Version || '?', n: n.length }) };
}
const ACTIONS = ['start', 'stop', 'restart', 'pause', 'unpause'];
async function dockerAction(id, action) {
  if (!ACTIONS.includes(action)) throw dockerErr(T('notFound'), { status: 404 });
  if (isSelf(id) && action !== 'start' && action !== 'restart') throw dockerErr(T('dockerSelf'), { status: 400 });
  const name = await containerName(id);
  await dockerApi('POST', `/containers/${enc(id)}/${action}${action === 'stop' || action === 'restart' ? '?t=30' : ''}`, { timeout: 60000 });
  console.log(`docker: ${action} ${name}`);
  return { ok: true };
}
async function containerName(id) { try { return (await dockerApi('GET', `/containers/${enc(id)}/json`)).Name.replace(/^\//, ''); } catch { return id.slice(0, 12); } }
// logs: multiplexed stream (8-byte frame headers) unless the container has a TTY
async function dockerLogs(id, tail = 300) {
  tail = Math.max(10, Math.min(5000, Number(tail) || 300));
  const ins = await dockerApi('GET', `/containers/${enc(id)}/json`);
  const buf = await dockerApi('GET', `/containers/${enc(id)}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`, { raw: true, timeout: 30000 });
  const parts = [];
  if (ins.Config?.Tty) parts.push(['out', buf.toString('utf8')]);
  else for (let i = 0; i + 8 <= buf.length;) {
    const type = buf[i], size = buf.readUInt32BE(i + 4);
    parts.push([type === 2 ? 'err' : 'out', buf.slice(i + 8, i + 8 + size).toString('utf8')]);
    i += 8 + size;
  }
  const lines = [];
  for (const [stream, text] of parts) for (const l of text.split('\n')) {
    if (!l) continue;
    const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) ?(.*)$/.exec(l);
    lines.push({ stream, time: m ? m[1] : null, text: (m ? m[2] : l).replace(/\x1b\[[0-9;]*m/g, '') });
  }
  return { name: ins.Name.replace(/^\//, ''), lines: lines.slice(-tail) };
}

// ---- update = pull the image, then recreate the container with the same settings ----
const jobs = new Map();
function newJob(name) {
  const job = { id: crypto_.randomBytes(6).toString('hex'), name, step: 'queued', progress: null, log: [], state: 'running', startedAt: Date.now() };
  jobs.set(job.id, job);
  if (jobs.size > 50) jobs.delete(jobs.keys().next().value);
  return job;
}
const jlog = (job, msg) => { job.log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`); };
async function pullImage(ref, job) {
  const { repo, tag } = parseRef(ref);
  const layers = {};
  let pullErr = null, pending = '';
  await dockerApi('POST', `/images/create?fromImage=${enc(repo)}&tag=${enc(tag)}`, {
    timeout: 20 * 60e3,
    onData: c => {
      pending += c.toString();
      const lines = pending.split('\n'); pending = lines.pop();
      for (const l of lines) {
        let m; try { m = JSON.parse(l); } catch { continue; }
        if (m.error) pullErr = m.error;
        if (m.id && m.progressDetail?.total) layers[m.id] = { cur: m.progressDetail.current || 0, total: m.progressDetail.total, st: m.status };
        if (m.id && /complete|already exists/i.test(m.status || '') && layers[m.id]) layers[m.id].cur = layers[m.id].total;
        const ls = Object.values(layers), tot = ls.reduce((a, x) => a + x.total, 0);
        if (tot) job.progress = Math.min(100, Math.round(ls.reduce((a, x) => a + Math.min(x.cur, x.total), 0) / tot * 100));
        if (m.status && !m.id) jlog(job, m.status);
      }
    },
  });
  if (pullErr) throw new Error(pullErr);
}
// the old container's settings, minus what came from the old image (so the new image's defaults apply)
function createBody(old, oldImg, image, networkMode) {
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const img = oldImg?.config || {};
  const C = JSON.parse(JSON.stringify(old.Config || {}));
  C.Image = image;
  if (img.Env) C.Env = (C.Env || []).filter(e => !img.Env.includes(e));
  if (img.Labels && C.Labels) for (const [k, v] of Object.entries(img.Labels)) if (C.Labels[k] === v) delete C.Labels[k];
  for (const k of ['Cmd', 'Entrypoint', 'WorkingDir', 'User', 'Healthcheck', 'StopSignal', 'Shell', 'OnBuild', 'ArgsEscaped']) if (same(C[k], img[k])) delete C[k];
  for (const k of ['ExposedPorts', 'Volumes']) if (img[k] && C[k]) { for (const x of Object.keys(img[k])) delete C[k][x]; if (!Object.keys(C[k]).length) delete C[k]; }
  if (!C.Hostname || old.Id.startsWith(C.Hostname)) delete C.Hostname;
  if (!C.Domainname) delete C.Domainname;
  delete C.MacAddress;
  const H = JSON.parse(JSON.stringify(old.HostConfig || {}));
  if (networkMode) H.NetworkMode = networkMode;
  // keep anonymous volumes: reattach them by name, the way docker compose does
  const used = new Set([...(H.Binds || []).map(b => b.split(':')[1]), ...(H.Mounts || []).map(m => m.Target)]);
  for (const m of old.Mounts || []) {
    if (m.Type === 'volume' && /^[0-9a-f]{64}$/.test(m.Name || '') && !used.has(m.Destination)) (H.Binds ||= []).push(`${m.Name}:${m.Destination}${m.RW === false ? ':ro' : ''}`);
  }
  const shared = /^container:/.test(H.NetworkMode || '');
  if (shared) { delete C.Hostname; delete C.Domainname; delete C.ExposedPorts; H.PortBindings = {}; H.PublishAllPorts = false; H.Dns = []; H.DnsSearch = []; H.ExtraHosts = []; }
  const nets = old.NetworkSettings?.Networks || {};
  const names = Object.keys(nets);
  const ep = n => ({
    Aliases: (n.Aliases || []).filter(a => !old.Id.startsWith(a)), Links: n.Links || null,
    ...(n.IPAMConfig && Object.values(n.IPAMConfig).some(Boolean) ? { IPAMConfig: n.IPAMConfig } : {}), DriverOpts: n.DriverOpts || null,
  });
  let first = null, extra = [];
  if (!shared && !/^(host|none)$/.test(H.NetworkMode || '') && names.length) {
    first = nets[H.NetworkMode] ? H.NetworkMode : names[0];
    extra = names.filter(x => x !== first).map(x => [x, ep(nets[x])]);
  }
  return { body: { ...C, HostConfig: H, ...(first ? { NetworkingConfig: { EndpointsConfig: { [first]: ep(nets[first]) } } } : {}) }, extra };
}
// is the new container healthy? it must keep running for a few seconds without restarting (restart policies would
// hide a crash loop) and, if it has a health check, become healthy. Returns null when fine, otherwise the reason.
async function checkStarted(id) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let ins, healthUntil = Date.now() + 90000;
  for (const end = Date.now() + 8000; Date.now() < end; await sleep(700)) {
    ins = await dockerApi('GET', `/containers/${id}/json`);
    const st = ins.State;
    if (st.Restarting || ins.RestartCount > 0 || (!st.Running && !st.Paused)) return T('dockerCrashed', { code: st.ExitCode }) + (st.Error ? ` – ${st.Error}` : '');
  }
  while (ins.State.Health && ins.State.Health.Status === 'starting' && Date.now() < healthUntil) { await sleep(2000); ins = await dockerApi('GET', `/containers/${id}/json`); }
  if (ins.State.Health?.Status === 'unhealthy') return T('dockerUnhealthy');
  return null;
}
// stop + rename the old one, create + start the new one; any failure puts the old container back
async function recreate(old, image, job, networkMode) {
  const name = old.Name.replace(/^\//, '');
  const wasRunning = old.State?.Running || old.State?.Restarting;
  if (old.HostConfig?.AutoRemove) throw new Error(T('dockerAutoRemove'));
  let oldImg = null; try { oldImg = await imageInfo(old.Image); } catch {}
  const { body, extra } = createBody(old, oldImg, image, networkMode);
  const tmp = `${name}-arrhub-old-${Date.now().toString(36)}`;
  let created = null, renamed = false;
  try {
    if (wasRunning) { job.step = 'stopping'; jlog(job, `stop ${name}`); await dockerApi('POST', `/containers/${old.Id}/stop?t=30`, { timeout: 90000 }); }
    await dockerApi('POST', `/containers/${old.Id}/rename?name=${enc(tmp)}`); renamed = true;
    job.step = 'creating'; jlog(job, `create ${name} (${image})`);
    created = (await dockerApi('POST', `/containers/create?name=${enc(name)}`, { body, timeout: 60000 })).Id;
    for (const [net, cfgEp] of extra) await dockerApi('POST', `/networks/${enc(net)}/connect`, { body: { Container: created, EndpointConfig: cfgEp } });
    if (wasRunning) {
      job.step = 'starting'; jlog(job, `start ${name}`);
      await dockerApi('POST', `/containers/${created}/start`, { timeout: 60000 });
      job.step = 'verifying';
      const bad = await checkStarted(created);
      if (bad) throw new Error(bad);
    }
  } catch (e) {
    jlog(job, `failed: ${e.message} – restoring the previous container`);
    try { if (created) await dockerApi('DELETE', `/containers/${created}?force=1`); } catch {}
    try { if (renamed) await dockerApi('POST', `/containers/${old.Id}/rename?name=${enc(name)}`); } catch {}
    try { if (wasRunning) await dockerApi('POST', `/containers/${old.Id}/start`); } catch {}
    e.rolledBack = true;
    throw e;
  }
  job.step = 'cleanup';
  try { await dockerApi('DELETE', `/containers/${old.Id}?v=0`); } catch (e) { jlog(job, `could not remove the old container: ${e.message}`); }
  return created;
}
async function updateContainer(id, job) {
  const old = await dockerApi('GET', `/containers/${enc(id)}/json`);
  const name = old.Name.replace(/^\//, '');
  const image = old.Config.Image;
  if (isSelf(old.Id)) throw new Error(T('dockerSelf'));
  if (parseRef(image).pinned) throw new Error(T('dockerPinned'));
  job.step = 'pulling'; jlog(job, `pull ${refName(image)}`);
  let pullErr = null;
  try { await pullImage(image, job); } catch (e) { pullErr = e; jlog(job, `pull failed: ${e.message}`); }
  const fresh = await dockerApi('GET', `/images/${enc(refName(image))}/json`).catch(() => null);
  if (!fresh) throw pullErr || new Error(T('dockerNoImage'));
  if (fresh.Id === old.Image) {
    if (pullErr) throw pullErr;
    jlog(job, 'already up to date'); job.result = 'current';
    refState.set(refName(image), { ...(refState.get(refName(image)) || {}), localId: fresh.Id, at: Date.now() });
    return;
  }
  // containers that share this one's network (network_mode: container:<this>) must be recreated too
  const all = await dockerApi('GET', '/containers/json?all=1');
  const deps = all.filter(c => [`container:${old.Id}`, `container:${name}`].includes(c.HostConfig?.NetworkMode));
  const newId = await recreate(old, image, job, null);
  for (const d of deps) {
    const dIns = await dockerApi('GET', `/containers/${d.Id}/json`);
    const mode = dIns.HostConfig.NetworkMode === `container:${name}` ? null : `container:${newId}`;
    jlog(job, `recreate ${dIns.Name.replace(/^\//, '')} (shares the network of ${name})`);
    try { await recreate(dIns, dIns.Config.Image, job, mode); } catch (e) { jlog(job, `could not recreate ${dIns.Name}: ${e.message}`); }
  }
  if (cfg.docker?.cleanup !== false) {
    try { await dockerApi('DELETE', `/images/${old.Image}`); jlog(job, 'old image removed'); } catch { /* still used by another container */ }
  }
  imgCache.delete(old.Image);
  refState.set(refName(image), { ...(refState.get(refName(image)) || {}), localId: fresh.Id, at: Date.now() });
  job.result = 'updated';
}
function startUpdate(id) {
  const job = newJob(id);
  (async () => {
    try {
      job.name = await containerName(id);
      console.log(`docker: updating ${job.name}`);
      await updateContainer(id, job);
      job.state = 'done'; job.step = 'done';
      console.log(`docker: ${job.name} ${job.result === 'current' ? 'already up to date' : 'updated'}`);
    } catch (e) {
      job.state = 'error'; job.error = langStore.run('en', () => friendlyError(e)) + (e.rolledBack ? ' – the previous container was restored' : '');
      console.warn(`docker: update of ${job.name} failed – ${job.error}`);
    } finally { job.finishedAt = Date.now(); }
  })();
  return job;
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
  'GET /api/config': async () => ({ ...Object.fromEntries(SERVICES.map(k => [k, enabled(k)])), docker: dockerOn(), refresh: cfg.refresh, auth: !!cfg.auth.user, ui: cfg.ui, version: VERSION, links: serviceLinks() }),
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
  'POST /api/settings/test': (q, b) => b.service === 'docker' ? dockerTest(b.values) : testService(b.service, b.values),
  'GET /api/docker': () => dockerSummary(),
  'POST /api/settings/docker-sshkey': () => sshKeygen(),
  'GET /api/settings/docker-sshpub': () => sshPublic(),
  'GET /api/docker/containers': async q => ({ containers: await dockerContainers(q.get('stats') === '1'), info: await dockerInfo().catch(() => null), checkedAt: dk.checkedAt || null, checking: dk.checking }),
  'POST /api/docker/check': async () => { checkUpdates(true).catch(() => {}); return { checking: true }; },
  'POST /api/docker/containers/:id/update': (q, b, p) => startUpdate(p.id),
  'POST /api/docker/containers/:id/:action': (q, b, p) => dockerAction(p.id, p.action),
  'GET /api/docker/containers/:id/logs': (q, b, p) => dockerLogs(p.id, q.get('tail')),
  'GET /api/docker/jobs/:id': (q, b, p) => { const j = jobs.get(p.id); if (!j) throw dockerErr(T('notFound'), { status: 404 }); return j; },
  'GET /api/radarr': () => arr('radarr').summary(),
  'GET /api/sonarr': () => arr('sonarr').summary(),
  'GET /api/qbittorrent': () => qb.summary(),
  'GET /api/nzbget': () => nzb.summary(),
  'GET /api/seerr': q => seerr.summary(q.get('filter') || 'all', q.get('page'), q.get('size')),
  'POST /api/seerr/action': (q, b) => seerr.action(b.id, b.action),
  'GET /api/:svc/history': async (q, b, p) => {
    const size = PAGE_SIZES.includes(Number(q.get('size'))) ? Number(q.get('size')) : 10;
    const page = Math.max(1, Math.floor(Number(q.get('page'))) || 1);
    const src = p.svc === 'radarr' || p.svc === 'sonarr' ? arr(p.svc) : p.svc === 'nzbget' ? nzb : p.svc === 'qbittorrent' ? qb : null;
    if (!src) { const e = new Error(T('notFound')); e.status = 404; throw e; }
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

server.listen(cfg.port, () => {
  const on = SERVICES.filter(enabled);
  console.log(`ArrHub ${VERSION} listening on http://0.0.0.0:${cfg.port} — services: ${on.join(', ') || 'none (configure them in Settings)'}`);
});
