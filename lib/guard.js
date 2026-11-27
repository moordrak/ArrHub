// Request guards: login check and protection against other websites driving ArrHub through the browser
// (cross-site POSTs and cross-site WebSocket connections to the Docker terminal).
'use strict';

const crypto = require('crypto');
const config = require('./config');

// constant-time string comparison (hashing first makes the lengths equal)
function safeEqual(a, b) {
  const h = s => crypto.createHash('sha256').update(String(s ?? '')).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

function checkAuth(r) {
  const { user, pass } = config.cfg.auth;
  if (!user) return true;
  const h = String(r.headers.authorization || '');
  if (!/^Basic /i.test(h)) return false;
  const [u, p] = Buffer.from(h.slice(6), 'base64').toString().split(/:(.*)/s);
  // evaluate both so a wrong user name takes as long as a wrong password
  const okUser = safeEqual(u, user), okPass = safeEqual(p, pass);
  return okUser && okPass;
}

// extra origins allowed to call ArrHub (comma separated), e.g. https://dash.example.int
function extraOrigins() {
  return String(process.env.ARRHUB_ORIGINS || '').split(',').map(s => s.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);
}
const first = v => String(v || '').split(',')[0].trim().toLowerCase();

// true when the request comes from ArrHub's own page (or from a non-browser client, which sends no Origin)
function sameOrigin(r) {
  const origin = r.headers.origin;
  if (origin === undefined) {
    // browsers send Origin on every POST and WebSocket; without it, trust only what isn't marked cross-site
    const site = first(r.headers['sec-fetch-site']);
    return !site || site === 'same-origin' || site === 'none';
  }
  let o;
  try { o = new URL(origin); } catch { return false; }   // includes "null" (sandboxed frames, file://)
  if (!/^https?:$/.test(o.protocol)) return false;
  const host = o.host.toLowerCase();
  const hosts = [first(r.headers.host), first(r.headers['x-forwarded-host'])].filter(Boolean);
  if (hosts.includes(host)) return true;
  return extraOrigins().includes(o.origin.toLowerCase());
}

// a JSON content type makes a cross-site POST need a CORS preflight, which ArrHub never grants
function jsonBody(r) {
  return /^application\/json\b/i.test(String(r.headers['content-type'] || ''));
}

// Docker control can run anything on the Docker host, so it needs an ArrHub login
// unless the admin says a reverse proxy in front of ArrHub already asks for one
const dockerLocked = () => !!config.cfg.docker?.url && !config.cfg.auth.user && !config.cfg.docker.noAuth;

module.exports = { safeEqual, checkAuth, sameOrigin, jsonBody, dockerLocked };
