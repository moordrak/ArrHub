// About / update check, links to the services and readable error messages
'use strict';

const { T } = require('./i18n');
const config = require('./config');
const { VERSION, SERVICES, CONFIG_FILE } = config;
const { json, enabled } = require('./net');

// ---------- About / update check ----------
const REPO = 'moordrak/arrhub';
const aboutCache = { at: 0, ttl: 0, data: null };
const semver = v => String(v || '').replace(/^v/, '').split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
function newer(a, b) { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; }
async function about(force) {
  const base = { version: VERSION, repo: `https://github.com/${REPO}`, releaseUrl: VERSION === 'dev' ? null : `https://github.com/${REPO}/releases/tag/v${VERSION}` };
  if (config.cfg.net?.offline) return { ...base, offline: true, latest: null, updateAvailable: false, error: null };
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
      const u = new URL(config.cfg[k].link || config.cfg[k].url);
      u.username = ''; u.password = '';
      out[k] = u.toString().replace(/\/+$/, '') + '/';
    } catch {}
  }
  if (config.cfg.docker?.link) { try { const u = new URL(config.cfg.docker.link); out.docker = u.toString().replace(/\/+$/, '') + '/'; } catch {} }
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

module.exports = { friendlyError, aboutCache, serviceLinks, about };
