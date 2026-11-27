// Logs tab: ArrHub's own log + the services' logs, normalised; up/down notes for the services
'use strict';

const { logBuf } = require('./log');
const { T } = require('./i18n');
const { SERVICES } = require('./config');
const { enabled } = require('./net');
const { arr, qb, nzb, prowlarr, bazarr, bazarrTime, seerr } = require('./services');

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
  } else if (src === 'prowlarr') {
    const d = await prowlarr.call('/log?page=1&pageSize=250&sortKey=time&sortDirection=descending');
    entries = (d.records || []).map(r => ({ time: r.time, level: lvl(r.level), source: r.logger, message: r.message, detail: r.exception || undefined }));
  } else if (src === 'bazarr') {
    const d = await bazarr.call('/system/logs');
    entries = (d?.data || []).map(r => { const t = bazarrTime(r.timestamp); return { time: t ? new Date(t).toISOString() : r.timestamp, level: lvl(r.type), message: r.message, detail: r.exception || undefined, _t: t || 0 }; })
      .sort((a, b) => b._t - a._t).slice(0, 250).map(({ _t, ...r }) => r);
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

module.exports = { serviceLogs, noteService };
