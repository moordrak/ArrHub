// ArrHub — UI logic
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { cfg: {}, data: {}, err: {}, view: 'overview', addType: 'radarr', opts: {}, seerrFilter: 'pending', seerrPage: 1, seerrSize: 30 };
try { const n = Number(localStorage.getItem('arrhub-req-size')); if ([10, 20, 30, 50, 100].includes(n)) state.seerrSize = n; } catch {}
const seerrPath = () => `seerr?filter=${state.seerrFilter}&page=${state.seerrPage}&size=${state.seerrSize}`;
const COLORS = { radarr: 'var(--radarr)', sonarr: 'var(--sonarr)', nzbget: 'var(--nzb)', qbittorrent: 'var(--qb)', seerr: 'var(--seerr)', docker: 'var(--docker)' };
const NAMES = { radarr: 'Radarr', sonarr: 'Sonarr', nzbget: 'NZBGet', qbittorrent: 'qBittorrent', seerr: 'Seerr', docker: 'Docker' };
const SVCS = ['radarr', 'sonarr', 'nzbget', 'qbittorrent', 'seerr'];

// ---- formatting ----
function size(b) { if (!b && b !== 0) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return b.toFixed(i > 1 ? 1 : 0) + ' ' + u[i]; }
const speed = b => size(b) + '/s';
function eta(s) { if (!s || s < 0 || s >= 8640000) return '∞'; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : m ? `${m}m` : `${Math.floor(s)}s`; }
function tleft(v) { if (!v) return ''; const p = v.split(/[.:]/).map(Number); if (p.length === 4) return eta(p[0] * 86400 + p[1] * 3600 + p[2] * 60 + p[3]); return eta(p[0] * 3600 + p[1] * 60 + p[2]); }
function ago(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return t('time.now');
  if (s < 3600) return t('time.min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('time.h', { n: Math.floor(s / 3600) });
  return t('time.d', { n: Math.floor(s / 86400) });
}
const fmtDay = d => new Intl.DateTimeFormat(I18N.locale, { weekday: 'long', day: 'numeric', month: 'numeric' }).format(d);
const fmtTime = d => new Intl.DateTimeFormat(I18N.locale, { hour: '2-digit', minute: '2-digit' }).format(d);
const ep = e => `S${String(e.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')}`;

function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(el._h); el._h = setTimeout(() => el.classList.remove('show'), 2600); }
window.toast = toast;

async function api(path, body) {
  const headers = { 'X-Lang': I18N.lang };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api/' + path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}

// ---- data ----
// one refresh at a time: timer ticks are skipped while one is running,
// an explicit refresh (e.g. after an action) runs once more when it finishes
let refreshing = null, refreshAgain = false;
function refresh() {
  if (refreshing) { refreshAgain = true; return refreshing; }
  refreshing = (async () => {
    try { do { refreshAgain = false; await doRefresh(); } while (refreshAgain); }
    finally { refreshing = null; }
  })();
  return refreshing;
}
async function doRefresh() {
  await Promise.all([state.view === 'history' ? loadAllHistory() : null, state.view === 'docker' ? loadDocker() : null,
    state.cfg.docker ? api('docker').then(d => { state.data.docker = d; delete state.err.docker; }, e => { state.err.docker = e.message; }) : null,
    ...SVCS.filter(k => state.cfg[k]).map(async k => {
    try { state.data[k] = await api(k === 'seerr' ? seerrPath() : k); delete state.err[k]; }
    catch (e) { state.err[k] = e.message; }
  })]);
  render();
}

// ---- rendering ----
function render() {
  renderSpeeds(); renderCards(); renderOverview();
  renderQb(); renderNzb(); renderArrQueue('radarr'); renderArrQueue('sonarr');
  renderCalendar(); renderHistory(); renderRequests();
}

function renderSpeeds() {
  const q = state.data.qbittorrent?.transfer, n = state.data.nzbget?.status;
  let dl = 0, ul = 0;
  if (q) { dl += q.dl_info_speed; ul += q.up_info_speed; }
  if (n) dl += n.DownloadRate;
  $('#speeds').innerHTML = `<span>↓ <b>${speed(dl)}</b></span><span>↑ <b>${speed(ul)}</b></span>`;
  Appearance.Bg.setActivity(dl);
}

// link to the service's own web UI (opens in a new tab)
const LINK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';
function svcLink(k) {
  const href = state.cfg.links?.[k];
  if (!href) return '';
  const label = esc(t('c.openService', { svc: NAMES[k] }));
  return `<a class="svc-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${label}" aria-label="${label}">${LINK_ICON}</a>`;
}
// static cards (Downloads, History, Requests): add/refresh the link in their title
function decorateStaticLinks() {
  document.querySelectorAll('.card[data-icon]:not(.svc)').forEach(card => {
    const k = card.dataset.icon, h2 = card.querySelector('h2');
    if (!h2) return;
    h2.querySelector('.svc-link')?.remove();
    const html = svcLink(k);
    if (!html) return;
    const sp = h2.querySelector('.sp');
    sp ? sp.insertAdjacentHTML('afterend', html) : h2.insertAdjacentHTML('beforeend', html);
  });
}
function svcCard(k, body) {
  const err = state.err[k];
  return `<div class="card svc" data-icon="${k}" style="--c:${COLORS[k]}">
    <h2><span class="dot" style="background:${err ? 'var(--err)' : 'var(--ok)'}"></span>${NAMES[k]}<span class="sp"></span><span class="muted mono" style="text-transform:none;letter-spacing:0">${esc(state.data[k]?.version || '')}</span>${svcLink(k)}</h2>
    ${err ? `<div class="error">${esc(err)}</div>` : state.data[k] ? body(state.data[k]) : `<div class="empty">${t('c.loading')}</div>`}
  </div>`;
}
function disks(d) {
  const seen = new Set();
  return (d || []).filter(x => x.totalSpace > 0 && !seen.has(x.totalSpace + '' + x.freeSpace) && seen.add(x.totalSpace + '' + x.freeSpace)).slice(0, 2).map(x => {
    const used = 1 - x.freeSpace / x.totalSpace;
    return `<div class="disk"><div class="lbl"><span class="mono">${esc(x.path)}</span><span>${t('c.free', { size: size(x.freeSpace) })}</span></div><div class="bar" style="--c:${used > .9 ? 'var(--err)' : 'var(--c)'}"><i style="width:${used * 100}%"></i></div></div>`;
  }).join('');
}
function health(h) { return (h || []).slice(0, 2).map(x => `<div class="health ${x.type === 'error' ? 'error' : ''}">${esc(x.message)}</div>`).join(''); }
const row = (label, value) => `<div class="row"><span>${label}</span><span>${value}</span></div>`;

function renderCards() {
  const out = [];
  if (state.cfg.radarr) out.push(svcCard('radarr', d => `<div class="big">${d.queue.length}</div><div class="sub">${t('card.inQueue')}</div>
    ${row(t('card.comingSoon'), d.calendar.filter(m => !m.hasFile).length)}${disks(d.disk)}${health(d.health)}`));
  if (state.cfg.sonarr) out.push(svcCard('sonarr', d => `<div class="big">${d.queue.length}</div><div class="sub">${t('card.inQueue')}</div>
    ${row(t('card.episodes14'), d.calendar.length)}${disks(d.disk)}${health(d.health)}`));
  if (state.cfg.qbittorrent) out.push(svcCard('qbittorrent', d => {
    const act = d.torrents.filter(x => /downloading|forcedDL|metaDL|stalledDL/.test(x.state)).length;
    const seed = d.torrents.filter(x => /uploading|stalledUP|forcedUP/.test(x.state)).length;
    return `<div class="big">${speed(d.transfer.dl_info_speed)}</div><div class="sub">↑ ${speed(d.transfer.up_info_speed)} · ${esc(d.transfer.connection_status)}</div>
    ${row(t('card.downloading'), act)}${row(t('card.seeding'), seed)}${row(t('card.total'), d.torrents.length)}`;
  }));
  if (state.cfg.nzbget) out.push(svcCard('nzbget', d => `<div class="big">${speed(d.status.DownloadRate)}</div><div class="sub">${d.status.DownloadPaused ? `<span class="tag warn">${t('card.paused')}</span>` : t('card.active')}</div>
    ${row(t('card.queued'), d.groups.length)}${row(t('card.remaining'), size(d.status.RemainingSizeMB * 1048576))}${row(t('card.diskFree'), size(d.status.FreeDiskSpaceMB * 1048576))}`));
  if (state.cfg.seerr) out.push(svcCard('seerr', d => {
    const c = d.count || {};
    return `<div class="big">${c.pending ?? 0}</div><div class="sub">${t('card.pendingReq')}${d.updateAvailable ? ` · <span class="tag warn">${t('card.newVersion')}</span>` : ''}</div>
    ${row(t('card.approved'), c.approved ?? 0)}${row(t('card.processing'), c.processing ?? 0)}${row(t('card.available'), c.available ?? 0)}
    <div class="link"><button class="btn" onclick="show('requests')">${t('card.openRequests')}</button></div>`;
  }));
  if (state.cfg.docker) out.push(svcCard('docker', d => `<div class="big">${d.running}<span class="muted" style="font-size:.55em"> / ${d.total}</span></div><div class="sub">${t('dk.runningOf')}</div>
    ${row(t('dk.stoppedN'), d.stopped ? `<span class="tag err">${d.stopped}</span>` : 0)}${row(t('dk.unhealthyN'), d.unhealthy ? `<span class="tag err">${d.unhealthy}</span>` : 0)}
    ${row(t('dk.updatesN'), d.updates ? `<span class="tag warn">${d.updates}</span>` : 0)}
    <div class="link"><button class="btn" onclick="show('docker')">${t('dk.open')}</button></div>`));
  $('#svcCards').innerHTML = out.join('');
}

function renderOverview() {
  const items = [];
  (state.data.qbittorrent?.torrents || []).filter(x => /downloading|forcedDL|metaDL|stalledDL/.test(x.state)).forEach(x =>
    items.push({ c: COLORS.qbittorrent, name: x.name, p: x.progress, meta: [speed(x.dlspeed), 'ETA ' + eta(x.eta), size(x.size)] }));
  (state.data.nzbget?.groups || []).forEach(g => {
    const tot = g.FileSizeMB || 1; items.push({ c: COLORS.nzbget, name: g.NZBName, p: 1 - g.RemainingSizeMB / tot, meta: [g.Status.toLowerCase(), size(tot * 1048576)] });
  });
  $('#ovActive').innerHTML = items.length ? items.slice(0, 10).map(i => `<div class="item" style="--c:${i.c}">
    <div class="t" title="${esc(i.name)}">${esc(i.name)}</div><div class="mono muted">${(i.p * 100).toFixed(1)}%</div>
    <div class="bar"><i style="width:${i.p * 100}%"></i></div><div class="m">${i.meta.map(esc).join('<span>·</span>')}</div></div>`).join('')
    : `<div class="empty">${t('ov.nothingDownloading')}</div>`;

  const up = calendarEvents().filter(e => e.date >= new Date(new Date().setHours(0, 0, 0, 0))).slice(0, 8);
  $('#ovUpcoming').innerHTML = up.length ? up.map(e => `<div class="item" style="--c:${e.c}">
    <div class="t"><span class="dot" style="background:${e.c};margin-right:8px"></span>${esc(e.title)}</div><div class="muted">${fmtDay(e.date)}</div>
    <div class="m">${esc(e.sub)}${e.hasFile ? `<span class="tag ok">${t('c.downloaded')}</span>` : ''}</div></div>`).join('')
    : `<div class="empty">${t('ov.noUpcoming')}</div>`;
}

let qbFilter = 'active';
const qbMatch = {
  all: () => true,
  active: x => x.dlspeed > 0 || x.upspeed > 0,
  downloading: x => /downloading|forcedDL|metaDL|stalledDL|queuedDL|checkingDL/.test(x.state),
  seeding: x => /uploading|stalledUP|forcedUP|queuedUP/.test(x.state),
  paused: x => /paused|stopped/i.test(x.state),
  error: x => /error|missingFiles/.test(x.state),
};
function qbState(s) {
  if (/error|missingFiles/.test(s)) return [t('qb.error'), 'err'];
  if (/paused|stopped/i.test(s)) return [t('qb.stopped'), 'warn'];
  if (/stalledDL/.test(s)) return [t('qb.stalled'), 'warn'];
  if (/downloading|forcedDL|metaDL/.test(s)) return [t('qb.downloading'), ''];
  if (/uploading|stalledUP|forcedUP/.test(s)) return [t('qb.seeding'), 'ok'];
  if (/queued/.test(s)) return [t('qb.queued'), ''];
  if (/checking/.test(s)) return [t('qb.checking'), ''];
  return [s, ''];
}
function renderQb() {
  const el = $('#qbList'); if (!state.cfg.qbittorrent) return;
  if (state.err.qbittorrent) { el.innerHTML = `<div class="error">${esc(state.err.qbittorrent)}</div>`; return; }
  const ts = (state.data.qbittorrent?.torrents || []).filter(qbMatch[qbFilter]);
  el.innerHTML = ts.length ? ts.slice(0, 60).map(x => {
    const [st, cl] = qbState(x.state); const paused = /paused|stopped/i.test(x.state);
    return `<div class="item">
    <div class="t" title="${esc(x.name)}">${esc(x.name)}</div>
    <div class="a"><button class="btn i" title="${paused ? t('c.start') : t('c.stop')}" onclick="qbAct('${paused ? 'resume' : 'pause'}','${x.hash}')">${paused ? '▶' : '⏸'}</button>
    <button class="btn i d" title="${t('c.delete')}" onclick="qbDel('${x.hash}')">✕</button></div>
    <div class="bar"><i style="width:${x.progress * 100}%"></i></div>
    <div class="m"><span class="tag ${cl}">${st}</span><span class="mono">${(x.progress * 100).toFixed(1)}%</span><span>${size(x.size)}</span>
    ${x.progress < 1 ? `<span>↓ ${speed(x.dlspeed)}</span><span>ETA ${eta(x.eta)}</span>` : ''}<span>↑ ${speed(x.upspeed)}</span><span>${t('c.ratio', { r: x.ratio.toFixed(2) })}</span>${x.category ? `<span class="tag">${esc(x.category)}</span>` : ''}</div></div>`;
  }).join('') : `<div class="empty">${t('dl.noTorrents')}</div>`;
}
function renderNzb() {
  const el = $('#nzbList'); if (!state.cfg.nzbget) return;
  if (state.err.nzbget) { el.innerHTML = `<div class="error">${esc(state.err.nzbget)}</div>`; return; }
  const gs = state.data.nzbget?.groups || [];
  el.innerHTML = gs.length ? gs.map(g => {
    const p = g.FileSizeMB ? 1 - g.RemainingSizeMB / g.FileSizeMB : 0; const paused = /PAUSED/.test(g.Status);
    return `<div class="item">
    <div class="t" title="${esc(g.NZBName)}">${esc(g.NZBName)}</div>
    <div class="a"><button class="btn i" title="${paused ? t('c.start') : t('c.stop')}" onclick="nzbAct('${paused ? 'resume' : 'pause'}',${g.NZBID})">${paused ? '▶' : '⏸'}</button>
    <button class="btn i d" title="${t('c.delete')}" onclick="nzbDel(${g.NZBID})">✕</button></div>
    <div class="bar"><i style="width:${p * 100}%"></i></div>
    <div class="m"><span class="tag ${paused ? 'warn' : ''}">${esc(g.Status.toLowerCase())}</span><span class="mono">${(p * 100).toFixed(1)}%</span><span>${size(g.FileSizeMB * 1048576)}</span>${g.Category ? `<span class="tag">${esc(g.Category)}</span>` : ''}</div></div>`;
  }).join('') : `<div class="empty">${t('dl.queueEmpty')}</div>`;
}
function renderArrQueue(k) {
  const el = $('#' + k + 'Queue'); if (!state.cfg[k]) return;
  if (state.err[k]) { el.innerHTML = `<div class="error">${esc(state.err[k])}</div>`; return; }
  const q = state.data[k]?.queue || [];
  el.innerHTML = q.length ? q.map(r => {
    const p = r.size ? 1 - r.sizeleft / r.size : 0;
    const title = k === 'radarr' ? (r.movie ? `${r.movie.title} (${r.movie.year})` : r.title) : (r.series ? `${r.series.title} ${r.episode ? ep(r.episode) : ''}` : r.title);
    const warn = r.trackedDownloadStatus && r.trackedDownloadStatus !== 'ok';
    return `<div class="item" style="--c:${COLORS[k]}">
    <div class="t" title="${esc(r.title)}">${esc(title)}</div>
    <div class="a"><button class="btn i d" title="${t('c.remove')}" onclick="arrRemove('${k}',${r.id})">✕</button></div>
    <div class="bar"><i style="width:${p * 100}%"></i></div>
    <div class="m"><span class="tag ${warn ? 'warn' : ''}">${esc(r.trackedDownloadState || r.status)}</span><span class="mono">${(p * 100).toFixed(1)}%</span><span>${esc(r.protocol)}</span><span>${esc(r.downloadClient || '')}</span>${r.timeleft ? `<span>ETA ${tleft(r.timeleft)}</span>` : ''}
    ${warn && r.statusMessages?.length ? `<span style="color:var(--warn)">${esc(r.statusMessages[0].messages?.[0] || r.statusMessages[0].title)}</span>` : ''}</div></div>`;
  }).join('') : `<div class="empty">${t('c.empty')}</div>`;
}

function calendarEvents() {
  const ev = [];
  (state.data.radarr?.calendar || []).forEach(m => {
    const kinds = [['digitalRelease', 'cal.digital'], ['physicalRelease', 'cal.physical'], ['inCinemas', 'cal.cinemas']];
    for (const [f, key] of kinds) if (m[f]) ev.push({ c: COLORS.radarr, date: new Date(m[f]), title: m.title, sub: `${m.year} · ${t(key)}`, hasFile: m.hasFile });
  });
  (state.data.sonarr?.calendar || []).forEach(e => ev.push({ c: COLORS.sonarr, date: new Date(e.airDateUtc), title: e.series?.title || t('c.series'), sub: `${ep(e)} · ${e.title || ''} · ${fmtTime(new Date(e.airDateUtc))}`, hasFile: e.hasFile }));
  const from = new Date(); from.setDate(from.getDate() - 1); from.setHours(0, 0, 0, 0);
  const to = new Date(); to.setDate(to.getDate() + 15);
  return ev.filter(e => e.date >= from && e.date <= to).sort((a, b) => a.date - b.date);
}
function renderCalendar() {
  const byDay = {};
  calendarEvents().forEach(e => { const k = e.date.toDateString(); (byDay[k] ||= []).push(e); });
  const today = new Date().toDateString();
  const keys = Object.keys(byDay);
  $('#calGrid').innerHTML = keys.length ? keys.map(k => `<div class="day ${k === today ? 'today' : ''}"><h3>${fmtDay(new Date(k))}</h3>
    ${byDay[k].map(e => `<div class="ev" style="--c:${e.c}">${esc(e.title)} ${e.hasFile ? '✓' : ''}<div class="muted">${esc(e.sub)}</div></div>`).join('')}</div>`).join('')
    : `<div class="empty">${t('cal.none')}</div>`;
}
const EVT = {
  grabbed: ['ev.grabbed', ''], downloadFolderImported: ['ev.imported', 'ok'], episodeFileImported: ['ev.imported', 'ok'], movieFileImported: ['ev.imported', 'ok'],
  downloadFailed: ['ev.failed', 'err'], movieFileDeleted: ['ev.deleted', 'warn'], episodeFileDeleted: ['ev.deleted', 'warn'],
  movieFileRenamed: ['ev.renamed', ''], episodeFileRenamed: ['ev.renamed', ''], downloadIgnored: ['ev.ignored', 'warn'],
};
// History: every card is paged on its own (default 10 per page, size remembered per service)
const HIST_EL = { radarr: 'radarrHist', sonarr: 'sonarrHist', nzbget: 'nzbHist', qbittorrent: 'qbitHist' };
const PAGE_SIZES = [10, 20, 30, 50, 100];
const hist = {};
function histState(k) {
  if (!hist[k]) {
    let size = 10;
    try { const n = Number(localStorage.getItem('arrhub-hist-size-' + k)); if (PAGE_SIZES.includes(n)) size = n; } catch {}
    hist[k] = { page: 1, size, data: null, err: null, pagerKey: '' };
  }
  return hist[k];
}
async function loadHistory(k) {
  const h = histState(k), page = h.page, size = h.size;
  try {
    const d = await api(`${k}/history?page=${page}&size=${size}`);
    if (h.page !== page || h.size !== size) return;               // stale after a page/size change
    if (d.page > d.pages) { h.page = d.pages; return loadHistory(k); } // page vanished (history got shorter)
    h.data = d; h.err = null;
  } catch (e) { if (h.page === page && h.size === size) h.err = e.message; }
  renderHistory();
}
const loadAllHistory = () => Promise.all(Object.keys(HIST_EL).filter(k => state.cfg[k]).map(loadHistory));
function pagerHtml(d, size) {
  const from = (d.page - 1) * d.pageSize + 1, to = Math.min(d.total, from + d.records.length - 1);
  return `<span class="muted">${esc(t('req.range', { from, to, total: d.total }))}</span><span class="sp"></span>
    <label class="muted"><span>${esc(t('req.perPage'))}</span><select data-size>${PAGE_SIZES.map(n => `<option${n === size ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
    <div class="pgbtns">
      <button class="btn" type="button" data-pg="first" title="${esc(t('req.first'))}"${d.page <= 1 ? ' disabled' : ''}>«</button>
      <button class="btn" type="button" data-pg="prev" title="${esc(t('req.prev'))}"${d.page <= 1 ? ' disabled' : ''}>‹</button>
      <span class="mono pgnum">${esc(t('req.page', { page: d.page, pages: d.pages }))}</span>
      <button class="btn" type="button" data-pg="next" title="${esc(t('req.next'))}"${d.page >= d.pages ? ' disabled' : ''}>›</button>
      <button class="btn" type="button" data-pg="last" title="${esc(t('req.last'))}"${d.page >= d.pages ? ' disabled' : ''}>»</button>
    </div>`;
}
function histRow(k, r) {
  if (k === 'qbittorrent') {
    const [st, c] = qbState(r.state);
    return `<div class="item"><div class="t" title="${esc(r.name)}">${esc(r.name)}</div><div class="muted">${ago(r.completion_on * 1000)}</div>
      <div class="m"><span class="tag ${c}">${esc(st)}</span><span>${size(r.size)}</span><span>${t('c.ratio', { r: Number(r.ratio || 0).toFixed(2) })}</span>${r.category ? `<span class="tag">${esc(r.category)}</span>` : ''}</div></div>`;
  }
  if (k === 'nzbget') {
    const ok = /^SUCCESS/.test(r.Status);
    return `<div class="item"><div class="t" title="${esc(r.Name)}">${esc(r.Name)}</div><div class="muted">${ago(r.HistoryTime * 1000)}</div>
      <div class="m"><span class="tag ${ok ? 'ok' : /FAILURE/.test(r.Status) ? 'err' : 'warn'}">${esc(r.Status.toLowerCase())}</span><span>${size(r.FileSizeMB * 1048576)}</span>${r.Category ? `<span class="tag">${esc(r.Category)}</span>` : ''}</div></div>`;
  }
  const [key, c] = EVT[r.eventType] || [null, ''];
  const label = key ? t(key) : r.eventType;
  const title = k === 'radarr' ? (r.movie?.title || r.sourceTitle) : (r.series ? `${r.series.title} ${r.episode ? ep(r.episode) : ''}` : r.sourceTitle);
  return `<div class="item"><div class="t" title="${esc(r.sourceTitle)}">${esc(title)}</div><div class="muted">${ago(r.date)}</div><div class="m"><span class="tag ${c}">${esc(label)}</span><span>${esc(r.quality?.quality?.name || '')}</span></div></div>`;
}
function renderHistory() {
  for (const k of Object.keys(HIST_EL)) {
    if (!state.cfg[k]) continue;
    const h = histState(k), el = $('#' + HIST_EL[k]), pg = document.querySelector(`.pager[data-hist="${k}"]`);
    const recs = h.data?.records || [];
    el.innerHTML = h.err ? `<div class="error">${esc(h.err)}</div>`
      : !h.data ? `<div class="empty">${t('c.loading')}</div>`
      : recs.length ? recs.map(r => histRow(k, r)).join('') : `<div class="empty">${t('c.noRecords')}</div>`;
    if (k === 'qbittorrent' && h.data && !h.err) el.insertAdjacentHTML('beforeend', `<div class="muted" style="font-size:11.5px;padding-top:8px">${esc(t('hist.qbNote'))}</div>`);
    const show = !!(h.data && h.data.total);
    pg.classList.toggle('hidden', !show);
    // rebuild the pager only when it changed, so an open "per page" list isn't closed by auto-refresh
    const key = show ? [h.data.page, h.data.pages, h.data.total, recs.length, h.size, I18N.locale].join('|') : '';
    if (show && key !== h.pagerKey) pg.innerHTML = pagerHtml(h.data, h.size);
    h.pagerKey = key;
  }
}
$('#v-history').addEventListener('click', e => {
  const b = e.target.closest('[data-pg]'), pg = b?.closest('.pager[data-hist]');
  if (!pg || b.disabled) return;
  const k = pg.dataset.hist, h = histState(k), pages = h.data?.pages || 1;
  h.page = Math.min(pages, Math.max(1, { first: 1, prev: h.page - 1, next: h.page + 1, last: pages }[b.dataset.pg]));
  $('#' + HIST_EL[k]).style.opacity = '.5';
  loadHistory(k).then(() => { $('#' + HIST_EL[k]).style.opacity = ''; pg.closest('.card').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
});
$('#v-history').addEventListener('change', e => {
  const sel = e.target.closest('select[data-size]'), pg = sel?.closest('.pager[data-hist]'); if (!pg) return;
  const k = pg.dataset.hist, h = histState(k);
  h.size = Number(sel.value) || 10; h.page = 1;
  try { localStorage.setItem('arrhub-hist-size-' + k, h.size); } catch {}
  loadHistory(k);
});

// ---- Seerr requests ----
const REQ_STATUS = { 1: ['req.s.pending', 'warn'], 2: ['req.s.approved', 'ok'], 3: ['req.s.declined', 'err'], 4: ['req.s.failed', 'err'], 5: ['req.s.completed', 'ok'] };
const MEDIA_STATUS = { 2: ['req.m.waiting', ''], 3: ['req.m.processing', ''], 4: ['req.m.partial', 'warn'], 5: ['req.m.available', 'ok'], 6: ['req.m.deleted', 'err'], 7: ['req.m.deleted', 'err'] };
function seasonsText(arr) {
  if (!arr?.length) return '';
  // 1,2,3,5 -> S1–3, S5
  const out = []; let a = arr[0], b = arr[0];
  for (const n of [...arr.slice(1), null]) { if (n === b + 1) { b = n; continue; } out.push(a === b ? `S${a}` : `S${a}–${b}`); a = b = n; }
  return out.join(', ');
}
function renderRequests() {
  if (!state.cfg.seerr) return;
  const el = $('#reqList');
  if (state.err.seerr) { el.innerHTML = `<div class="error">${esc(state.err.seerr)}</div>`; return; }
  const d = state.data.seerr; if (!d) { el.innerHTML = `<div class="empty">${t('c.loading')}</div>`; return; }
  if (d.filter !== state.seerrFilter || (d.page && (d.page !== state.seerrPage || d.pageSize !== state.seerrSize))) return; // stale response after a filter/page change
  // the current page no longer exists (e.g. after deleting the last request on it): go to the last one
  if (d.pages && state.seerrPage > d.pages) { state.seerrPage = d.pages; loadRequests(); return; }
  renderReqPager(d);
  $('#seerrVer').textContent = d.version || '';
  const c = d.count || {};
  const cnt = (key, v) => `<span>${t(key)} <b>${v ?? 0}</b></span>`;
  $('#reqCounts').innerHTML = cnt('req.total', c.total) + cnt('req.pending', c.pending) + cnt('req.approved', c.approved) + cnt('req.available', c.available) + cnt('req.declined', c.declined);
  el.innerHTML = d.requests.length ? d.requests.map(r => {
    const [rk, rc] = REQ_STATUS[r.status] || [null, ''];
    const ms = r.status === 2 && MEDIA_STATUS[r.mediaStatus];
    return `<div class="req">
      ${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'np'}))">` : '<div class="np"></div>'}
      <div class="info">
        <div class="t" title="${esc(r.title)}">${esc(r.title)} <span class="muted" style="font-weight:400">${esc(r.year || '')}</span></div>
        <div class="m"><span class="tag">${r.type === 'tv' ? t('c.series') : t('c.movie')}</span>${r.is4k ? '<span class="tag">4K</span>' : ''}${r.type === 'tv' && r.seasons.length ? `<span>${seasonsText(r.seasons)}</span>` : ''}</div>
        <div class="m"><span class="tag ${rc}">${rk ? t(rk) : r.status}</span>${ms ? `<span class="tag ${ms[1]}">${t(ms[0])}</span>` : ''}</div>
        <div class="m">${esc(r.requestedBy)}${r.createdAt ? ` · ${ago(r.createdAt)}` : ''}</div>
        <div class="act">
          ${r.status === 1 ? `<button class="btn ok" onclick="seerrAct(${r.id},'approve')">${t('req.approve')}</button><button class="btn d" onclick="seerrAct(${r.id},'decline')">${t('req.decline')}</button>` : ''}
          <button class="btn d" title="${t('req.deleteTitle')}" onclick="seerrAct(${r.id},'delete')">${t('c.delete')}</button>
        </div>
      </div></div>`;
  }).join('') : `<div class="empty">${state.seerrFilter === 'pending' ? t('req.noPending') : t('req.none')}</div>`;
}
function seerrAct(id, action) {
  if (action === 'delete' && !confirm(t('req.confirmDelete'))) return;
  if (action === 'decline' && !confirm(t('req.confirmDecline'))) return;
  run('seerr/action', { id, action }, t({ approve: 'req.approvedToast', decline: 'req.declinedToast', delete: 'req.deletedToast' }[action]));
}
async function loadRequests(scroll) {
  $('#reqList').innerHTML = `<div class="empty">${t('c.loading')}</div>`;
  $('#reqPager').classList.add('hidden');
  if (scroll) $('#v-requests').scrollIntoView({ block: 'start', behavior: 'smooth' });
  try { state.data.seerr = await api(seerrPath()); delete state.err.seerr; } catch (err) { state.err.seerr = err.message; }
  renderRequests(); renderCards();
}
function renderReqPager(d) {
  const pg = $('#reqPager');
  if (!d.total) { pg.classList.add('hidden'); return; }
  pg.classList.remove('hidden');
  const from = (d.page - 1) * d.pageSize + 1, to = Math.min(d.total, from + d.requests.length - 1);
  $('#reqRange').textContent = t('req.range', { from, to, total: d.total });
  $('#reqPage').textContent = t('req.page', { page: d.page, pages: d.pages });
  $('#reqSize').value = String(state.seerrSize);
  pg.querySelectorAll('[data-pg]').forEach(b => { b.disabled = (b.dataset.pg === 'first' || b.dataset.pg === 'prev') ? d.page <= 1 : d.page >= d.pages; });
  pg.dataset.pages = d.pages;
}
$('#reqFilter').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  state.seerrFilter = b.dataset.f; state.seerrPage = 1;
  [...$('#reqFilter').children].forEach(x => x.classList.toggle('on', x === b));
  loadRequests();
};
$('#reqPager').onclick = e => {
  const b = e.target.closest('[data-pg]'); if (!b || b.disabled) return;
  const pages = Number($('#reqPager').dataset.pages) || 1;
  state.seerrPage = { first: 1, prev: state.seerrPage - 1, next: state.seerrPage + 1, last: pages }[b.dataset.pg];
  state.seerrPage = Math.min(pages, Math.max(1, state.seerrPage));
  loadRequests(true);
};
$('#reqSize').onchange = e => {
  state.seerrSize = Number(e.target.value) || 30; state.seerrPage = 1;
  try { localStorage.setItem('arrhub-req-size', state.seerrSize); } catch {}
  loadRequests();
};

// ---- actions ----
async function run(p, body, msg) { try { await api(p, body); toast(msg); setTimeout(refresh, 600); } catch (e) { toast(t('c.error', { msg: e.message })); } }
const qbAct = (a, h) => run('qbittorrent/action', { action: a, hashes: [h] }, a === 'pause' ? t('act.stopped') : t('act.started'));
const qbGlobal = a => run('qbittorrent/global', { action: a }, a === 'altspeed' ? t('act.altSpeed') : t('c.done'));
function qbDel(h) { if (!confirm(t('confirm.delTorrent'))) return; const files = confirm(t('confirm.delFiles')); run('qbittorrent/action', { action: 'delete', hashes: [h], deleteFiles: files }, t('c.deleted')); }
const nzbAct = (a, id) => run('nzbget/action', { action: a, ids: id ? [id] : [] }, t('c.done'));
function nzbDel(id) { if (confirm(t('confirm.delNzb'))) run('nzbget/action', { action: 'delete', ids: [id] }, t('c.deleted')); }
function arrRemove(k, id) { if (!confirm(t('confirm.arrRemove'))) return; const bl = confirm(t('confirm.blocklist')); run(k + '/queue/remove', { id, blocklist: bl }, t('c.removed')); }
const arrCmd = (k, name) => run(k + '/command', { name }, t('act.cmdSent'));

// ---- add ----
let lastResults = [];
async function loadOptions() {
  const k = state.addType;
  if (!state.cfg[k]) { $('#profileSel').innerHTML = $('#rootSel').innerHTML = ''; return; }
  try {
    const o = state.opts[k] ||= await api(k + '/options');
    $('#profileSel').innerHTML = o.profiles.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    $('#rootSel').innerHTML = o.roots.map(r => `<option value="${esc(r.path)}">${esc(r.path)} (${size(r.free)})</option>`).join('');
  } catch (e) { toast(t('c.error', { msg: e.message })); }
}
$('#addType').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  state.addType = b.dataset.t; [...$('#addType').children].forEach(x => x.classList.toggle('on', x === b)); $('#results').innerHTML = ''; loadOptions();
};
function renderResults() {
  const k = state.addType;
  $('#results').innerHTML = lastResults.length ? lastResults.slice(0, 24).map((r, i) => {
    const poster = 'arrhubPoster' in r ? (r.arrhubPoster || '') : (r.remotePoster || r.images?.find(x => x.coverType === 'poster')?.remoteUrl || '');
    const exists = r.id > 0;
    return `<div class="res"><img src="${esc(poster)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
    <div class="info"><div><b>${esc(r.title)}</b> <span class="muted">${r.year || ''}</span></div>
    <div class="muted" style="font-size:12px">${k === 'sonarr' ? `${t('add.seasons', { n: r.seasonCount || r.seasons?.length || 0 })} · ${esc(r.network || '')} · ${esc(r.status || '')}` : `${r.runtime ? r.runtime + ' min · ' : ''}${esc((r.genres || []).slice(0, 3).join(', '))}`}</div>
    <div class="ov">${esc(r.overview || '')}</div>
    <div class="act">${exists ? `<span class="tag ok">${t('add.inLibrary')}</span>` : `<button class="btn p" onclick="addItem(${i},true)">${t('add.addSearch')}</button><button class="btn" onclick="addItem(${i},false)">${t('add.addOnly')}</button>`}</div></div></div>`;
  }).join('') : `<div class="empty">${t('add.noResults')}</div>`;
}
$('#searchForm').onsubmit = async e => {
  e.preventDefault(); const term = $('#searchTerm').value.trim(); if (!term) return;
  const k = state.addType; if (!state.cfg[k]) return toast(t('c.notConfigured', { svc: NAMES[k] }));
  $('#results').innerHTML = `<div class="empty">${t('add.searching')}</div>`;
  try { lastResults = await api(`${k}/lookup?term=${encodeURIComponent(term)}`); renderResults(); }
  catch (e2) { $('#results').innerHTML = `<div class="error">${esc(e2.message)}</div>`; }
};
async function addItem(i, search) {
  const k = state.addType;
  try {
    await api(k + '/add', { item: lastResults[i], qualityProfileId: Number($('#profileSel').value), rootFolderPath: $('#rootSel').value, search });
    toast(t('add.added', { title: lastResults[i].title })); lastResults[i].id = 1; $('#searchForm').requestSubmit();
  } catch (e) { toast(t('c.error', { msg: e.message })); }
}

// ---- navigation ----
function show(v) {
  state.view = v;
  document.querySelectorAll('main > section').forEach(s => s.classList.toggle('hidden', s.id !== 'v-' + v));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'add') loadOptions();
  if (v === 'logs') { renderLogSources(); loadLogs(); }
  if (v === 'history') loadAllHistory();
  if (v === 'docker') { $('#dkList').innerHTML ||= `<div class="empty">${t('c.loading')}</div>`; loadDocker(); }
  if (v === 'settings') loadSettings();
  else if (state.cfg.ui) applyUi(state.cfg.ui);
  history.replaceState(null, '', '#' + v);
}
$('#nav').onclick = e => { const b = e.target.closest('button'); if (b) { show(b.dataset.v); document.body.classList.remove('menu-open'); } };
// narrow screens: ☰ opens the menu, tapping outside or Esc closes it
$('#menuBtn').onclick = () => document.body.classList.toggle('menu-open');
$('#scrim').onclick = () => document.body.classList.remove('menu-open');
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.body.classList.remove('menu-open'); });
$('#qbFilter').onchange = e => { qbFilter = e.target.value; renderQb(); };

// ---- logs ----
const LOG_RANK = { debug: 0, info: 1, warn: 2, error: 3 };
const log = { src: 'arrhub', entries: [], at: null, err: null, busy: false, timer: null };
function logSources() { return ['arrhub', ...SVCS.filter(k => state.cfg[k])]; }
function renderLogSources() {
  const el = $('#logSrc'); if (!el) return;
  if (!logSources().includes(log.src)) log.src = 'arrhub';
  el.innerHTML = logSources().map(k => `<button type="button" data-src="${k}" class="${k === log.src ? 'on' : ''}">${k === 'arrhub' ? '' : `<span class="dot" style="background:${COLORS[k]}"></span>`}${k === 'arrhub' ? 'ArrHub' : NAMES[k]}</button>`).join('');
}
async function loadLogs() {
  if (log.busy) return;
  log.busy = true;
  const src = log.src;
  if (!log.entries.length) $('#logInfo').textContent = t('log.loading');
  try { const d = await api('logs/' + src); if (src === log.src) { log.entries = d.entries || []; log.err = null; log.at = new Date(); } }
  catch (e) { if (src === log.src) log.err = e.message; }
  finally { log.busy = false; }
  if (src === log.src) renderLogs();
}
function logFiltered() {
  const min = LOG_RANK[$('#logLevel').value] ?? 1;
  const q = $('#logSearch').value.trim().toLowerCase();
  return log.entries.filter(e => (LOG_RANK[e.level] ?? 1) >= min && (!q || `${e.source || ''} ${e.message} ${e.detail || ''}`.toLowerCase().includes(q)));
}
const fmtLogTime = d => new Intl.DateTimeFormat(I18N.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(d));
function renderLogs() {
  const list = $('#logList'); if (!list || state.view !== 'logs') return;
  const rows = logFiltered();
  const info = log.at ? t('log.info', { shown: rows.length, total: log.entries.length, time: fmtTime(log.at) }) : '';
  $('#logInfo').innerHTML = log.err ? `<span class="error">${esc(log.err)}</span>` : esc(info) + (log.src === 'arrhub' && info ? ' · ' + esc(t('log.arrhubNote')) : '');
  if (!rows.length) { list.innerHTML = log.err ? '' : `<div class="logempty">${esc(log.at ? t('log.empty') : t('log.loading'))}</div>`; return; }
  const top = list.scrollTop;
  list.innerHTML = rows.slice(0, 1000).map(e => {
    const msg = String(e.message ?? ''), nl = msg.indexOf('\n');
    const head = nl < 0 ? msg : msg.slice(0, nl);
    const more = [nl < 0 ? '' : msg.slice(nl + 1), e.detail || ''].filter(Boolean).join('\n');
    const src = e.source ? `<span class="ls">${esc(e.source)}: </span>` : '';
    const body = more ? `<details><summary>${src}${esc(head)}</summary><pre>${esc(more)}</pre></details>` : src + esc(head);
    return `<div class="logrow lv-${esc(e.level)}"><span class="lt">${esc(fmtLogTime(e.time))}</span><span class="ll">${esc(String(e.level).toUpperCase())}</span><div class="lm">${body}</div></div>`;
  }).join('');
  list.scrollTop = top;
}
$('#logSrc').onclick = e => {
  const b = e.target.closest('button'); if (!b || b.dataset.src === log.src) return;
  log.src = b.dataset.src; log.entries = []; log.at = null; log.err = null;
  renderLogSources(); renderLogs(); loadLogs();
};
$('#logLevel').onchange = renderLogs;
$('#logSearch').oninput = renderLogs;
$('#logReload').onclick = loadLogs;
$('#logDownload').onclick = () => {
  const lines = logFiltered().slice().reverse().map(e => `${e.time} [${String(e.level).toUpperCase()}] ${e.source ? e.source + ': ' : ''}${e.message}${e.detail ? '\n' + e.detail : ''}`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }));
  a.download = `${log.src}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
// while the Logs tab is open: refresh every 10 s (never while the tab is hidden or a load is running)
setInterval(() => { if (state.view === 'logs' && $('#logAuto').checked && !document.hidden) loadLogs(); }, 10000);

// ---- Docker ----
const dk = { list: [], info: null, filter: 'all', q: '', checkedAt: null, checking: false, err: null, busy: false, jobs: {}, queue: [] };
async function loadDocker() {
  if (dk.busy) return;
  dk.busy = true;
  try {
    const d = await api('docker/containers?stats=1');
    dk.list = d.containers; dk.info = d.info; dk.checkedAt = d.checkedAt; dk.checking = d.checking; dk.err = null;
    for (const c of dk.list) if (c.job && !dk.jobs[c.name]) dk.jobs[c.name] = c.job;   // jobs started elsewhere / before a reload
  } catch (e) { dk.err = e.message; }
  finally { dk.busy = false; }
  renderDocker();
}
const dkUptime = c => c.status || '';
function dkFiltered() {
  const q = dk.q.toLowerCase();
  return dk.list.filter(c => (dk.filter === 'all' || (dk.filter === 'running' ? c.state === 'running' : dk.filter === 'stopped' ? c.state !== 'running' : c.update.state === 'available'))
    && (!q || `${c.name} ${c.image} ${c.project}`.toLowerCase().includes(q)));
}
function dkUpdBadge(c) {
  const u = c.update || {};
  if (u.state === 'available') return `<span class="tag warn" title="${esc(u.local ? t('dk.updLocal') : '')}">${t('dk.updAvailable')}</span>`;
  if (u.state === 'current') return `<span class="tag ok">${t('dk.updCurrent')}</span>`;
  if (u.state === 'pinned') return `<span class="tag" title="${esc(t('dk.pinnedHint'))}">${t('dk.pinned')}</span>`;
  if (u.state === 'error') return `<span class="tag" title="${esc(u.error || '')}">${t('dk.updUnknown')}</span>`;
  return '';
}
function dkJob(c) {
  const j = dk.jobs[c.name];
  if (!j) return '';
  const log = j.log?.length ? `<details><summary>${t('dk.showLog')}</summary><pre>${esc(j.log.join('\n'))}</pre></details>` : '';
  if (j.state === 'running') return `<div class="job"><span>${esc(t('dk.step.' + (j.step || 'queued')))}${j.step === 'pulling' && j.progress != null ? ` ${j.progress}%` : ''}</span>
    <div class="bar"><i style="width:${j.step === 'pulling' ? (j.progress || 3) : { stopping: 70, creating: 80, starting: 88, verifying: 94, cleanup: 98 }[j.step] || 5}%"></i></div>${log}</div>`;
  if (j.state === 'error') return `<div class="job err">✕ ${esc(j.error || '')}${log}</div>`;
  return `<div class="job" style="color:var(--ok)">✓ ${esc(j.result === 'current' ? t('dk.alreadyCurrent') : t('dk.updated'))}${log}</div>`;
}
function dkRow(c) {
  const run = c.state === 'running', busy = dk.jobs[c.name]?.state === 'running';
  const st = c.stats;
  const cpu = st && st.cpu != null ? `${st.cpu.toFixed(1)} %` : '–';
  const mem = st && st.mem != null ? size(st.mem) : '–';
  const memPct = st?.mem && st?.memLimit ? Math.min(100, st.mem / st.memLimit * 100) : 0;
  const dis = busy ? ' disabled' : '';
  const acts = [
    run ? `<button class="btn" data-dk="stop"${dis || (c.self ? ' disabled' : '')}>${t('dk.stop')}</button>` : `<button class="btn" data-dk="start"${dis}>${t('dk.start')}</button>`,
    `<button class="btn" data-dk="restart"${dis}>${t('dk.restart')}</button>`,
    `<button class="btn" data-dk="logs">${t('dk.logs')}</button>`,
    c.update.state !== 'pinned' && !c.self ? `<button class="btn${c.update.state === 'available' ? ' upd' : ''}" data-dk="update"${dis}>${t('dk.update')}</button>` : '',
  ].join('');
  return `<div class="card dkrow" data-id="${esc(c.id)}" data-name="${esc(c.name)}">
    <div><div class="nm"><span class="sdot ${esc(c.state)}" title="${esc(c.state)}"></span><b title="${esc(c.name)}">${esc(c.name)}</b>
      ${c.health ? `<span class="tag ${c.health === 'healthy' ? 'ok' : c.health === 'unhealthy' ? 'err' : 'warn'}">${esc(t('dk.h.' + c.health))}</span>` : ''}${c.self ? `<span class="tag">ArrHub</span>` : ''}</div>
      <div class="img" title="${esc(c.image)}">${esc(c.image)}</div></div>
    <div><div class="st">${esc(dkUptime(c))}</div><div class="m" style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap">${dkUpdBadge(c)}${c.ports.slice(0, 3).map(p => `<span class="tag mono">${esc(p)}</span>`).join('')}${/^container:/.test(c.networkMode) ? `<span class="tag" title="${esc(c.networkMode)}">${t('dk.sharedNet')}</span>` : ''}</div></div>
    <div class="meter"><span>CPU ${cpu}</span><div class="bar"><i style="width:${Math.min(100, st?.cpu || 0)}%"></i></div></div>
    <div class="meter"><span>RAM ${mem}</span><div class="bar"><i style="width:${memPct}%"></i></div></div>
    <div class="acts">${acts}</div>
    ${dkJob(c)}
  </div>`;
}
function renderDocker() {
  if (state.view !== 'docker') return;
  $('#dkAuthWarn').classList.toggle('hidden', !!state.cfg.auth);
  if (dk.err) { $('#dkList').innerHTML = `<div class="card" style="margin-top:16px"><div class="error">${esc(dk.err)}</div></div>`; return; }
  const L = dk.list, upd = L.filter(c => c.update.state === 'available' && !c.self);
  $('#dkHost').textContent = dk.info ? `${dk.info.name} · Docker ${dk.info.version}` : '';
  $('#dkChips').innerHTML = [
    [t('dk.f.running'), L.filter(c => c.state === 'running').length, 'var(--ok)'], [t('dk.f.stopped'), L.filter(c => c.state !== 'running').length, 'var(--err)'],
    [t('dk.unhealthyN'), L.filter(c => c.health === 'unhealthy').length, 'var(--warn)'], [t('dk.f.updates'), upd.length, 'var(--accent)'],
  ].map(([l, n, col]) => `<span class="dkchip"><span class="dot" style="background:${col}"></span>${esc(l)} <b>${n}</b></span>`).join('');
  $('#dkChecked').textContent = dk.checking ? t('dk.checking') : dk.checkedAt ? t('dk.checkedAgo', { ago: ago(dk.checkedAt) }) : '';
  const ua = $('#dkUpdAll'); ua.classList.toggle('hidden', !upd.length); ua.textContent = t('dk.updateAll', { n: upd.length }); ua.disabled = dk.queue.length > 0;
  const rows = dkFiltered();
  if (!rows.length) { $('#dkList').innerHTML = `<div class="card" style="margin-top:16px"><div class="empty">${t('c.noRecords')}</div></div>`; return; }
  const groups = {};
  for (const c of rows) (groups[c.project || ''] ||= []).push(c);
  // keep open "log" details open across refreshes
  const open = new Set([...document.querySelectorAll('.dkrow details[open]')].map(d => d.closest('.dkrow').dataset.name));
  $('#dkList').innerHTML = Object.entries(groups).map(([g, cs]) => `<div class="dkgrp"><h3>${esc(g || t('dk.noProject'))} <span>${cs.length}</span></h3>${cs.map(dkRow).join('')}</div>`).join('');
  open.forEach(n => document.querySelector(`.dkrow[data-name="${CSS.escape(n)}"] details`)?.setAttribute('open', ''));
}
async function dkUpdate(c) {
  try {
    const j = await api(`docker/containers/${encodeURIComponent(c.id)}/update`, {});
    dk.jobs[c.name] = j; renderDocker();
    while (true) {
      await new Promise(r => setTimeout(r, 1200));
      const s = await api('docker/jobs/' + j.id);
      dk.jobs[c.name] = s; renderDocker();
      if (s.state !== 'running') { toast(s.state === 'done' ? `${c.name}: ${s.result === 'current' ? t('dk.alreadyCurrent') : t('dk.updated')}` : `${c.name}: ${s.error}`); break; }
    }
  } catch (e) { toast(t('c.error', { msg: e.message })); }
  loadDocker();
}
$('#dkList').addEventListener('click', async e => {
  const b = e.target.closest('[data-dk]'); if (!b) return;
  const row = b.closest('.dkrow'), c = dk.list.find(x => x.id === row.dataset.id); if (!c) return;
  const a = b.dataset.dk;
  if (a === 'logs') return dkOpenLogs(c);
  if (a === 'update') { if (confirm(t('dk.confirmUpdate', { name: c.name }))) dkUpdate(c); return; }
  if ((a === 'stop' || a === 'restart') && !confirm(t('dk.confirm.' + a, { name: c.name }))) return;
  b.disabled = true;
  try { await api(`docker/containers/${encodeURIComponent(c.id)}/${a}`, {}); toast(`${c.name}: ${t('dk.done.' + a)}`); }
  catch (err) { toast(t('c.error', { msg: err.message })); }
  loadDocker();
});
$('#dkFilter').onclick = e => { const b = e.target.closest('button'); if (!b) return; dk.filter = b.dataset.f; [...$('#dkFilter').children].forEach(x => x.classList.toggle('on', x === b)); renderDocker(); };
$('#dkSearch').oninput = e => { dk.q = e.target.value.trim(); renderDocker(); };
$('#dkCheck').onclick = async () => { try { await api('docker/check', {}); dk.checking = true; renderDocker(); setTimeout(loadDocker, 2500); setTimeout(loadDocker, 8000); } catch (e) { toast(t('c.error', { msg: e.message })); } };
$('#dkUpdAll').onclick = async () => {
  const list = dk.list.filter(c => c.update.state === 'available' && !c.self);
  if (!list.length || !confirm(t('dk.confirmUpdateAll', { n: list.length, names: list.map(c => c.name).join(', ') }))) return;
  dk.queue = list.map(c => c.name); renderDocker();
  for (const c of list) { await dkUpdate(c); dk.queue.shift(); }
  dk.queue = []; renderDocker();
};
// container logs in a dialog
const dkm = { c: null, lines: [], timer: null };
async function dkLoadLogs() {
  if (!dkm.c) return;
  try { dkm.lines = (await api(`docker/containers/${encodeURIComponent(dkm.c.id)}/logs?tail=${$('#dkmTail').value}`)).lines; }
  catch (e) { dkm.lines = [{ stream: 'err', time: null, text: e.message }]; }
  const box = $('#dkmBody'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = dkm.lines.length ? dkm.lines.map(l => `<div class="logrow ${l.stream === 'err' ? 'lv-stderr' : ''}"><span class="lt">${l.time ? esc(fmtLogTime(l.time)) : ''}</span><span class="ll">${l.stream === 'err' ? 'ERR' : 'OUT'}</span><div class="lm">${esc(l.text)}</div></div>`).join('')
    : `<div class="logempty">${t('log.empty')}</div>`;
  if (atBottom) box.scrollTop = box.scrollHeight;
}
function dkOpenLogs(c) {
  dkm.c = c; $('#dkmTitle').textContent = c.name; $('#dkModal').classList.remove('hidden'); $('#dkmBody').innerHTML = `<div class="logempty">${t('log.loading')}</div>`;
  dkLoadLogs().then(() => { $('#dkmBody').scrollTop = 1e9; });
  clearInterval(dkm.timer); dkm.timer = setInterval(() => { if ($('#dkmAuto').checked && !document.hidden) dkLoadLogs(); }, 3000);
}
function dkCloseLogs() { $('#dkModal').classList.add('hidden'); clearInterval(dkm.timer); dkm.c = null; }
$('#dkmClose').onclick = dkCloseLogs;
$('#dkModal').onclick = e => { if (e.target.id === 'dkModal') dkCloseLogs(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && dkm.c) dkCloseLogs(); });
$('#dkmTail').onchange = dkLoadLogs;
$('#dkmDl').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([dkm.lines.map(l => `${l.time || ''} ${l.stream === 'err' ? 'ERR' : 'OUT'} ${l.text}`).join('\n') + '\n'], { type: 'text/plain' }));
  a.download = `${dkm.c?.name || 'container'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`; a.click();
};

// ---- settings ----
const setForm = $('#setForm');
let setLoaded = null;
function settingsTexts() {
  if (!setLoaded) return;
  const s = setLoaded;
  $('#setInfo').textContent = t('set.savedIn', { file: s.file }) + (s.locked.length ? ' · ' + t('set.lockedN', { n: s.locked.length }) : '');
  $('#authHint').textContent = s.values['auth.user'] ? '' : t('set.authHint');
  const ci = $('#caInfo');
  if (ci) ci.textContent = (s.caInfo || []).length
    ? t('set.caLoaded', { list: s.caInfo.map(c => `${c.subject}${c.ca ? ' (CA)' : ''} – ${t('set.caValid', { date: new Date(c.validTo).toLocaleDateString(I18N.locale) })}`).join(' · ') })
    : t('set.caNone');
  for (const el of setForm.elements) if (el.dataset.locked === '1') el.title = t('set.lockedTitle');
}
async function loadSettings() {
  try {
    const s = await api('settings'); setLoaded = s;
    for (const el of setForm.elements) {
      if (!el.name) continue;
      const val = s.values[el.name];
      if (el.type === 'radio') el.checked = el.value === String(val);
      else if (el.type === 'checkbox') el.checked = (val === undefined || val === '') ? el.defaultChecked : (val === true || val === 'true');
      else el.value = val ?? '';
      const locked = s.locked.includes(el.name);
      el.disabled = locked; el.dataset.locked = locked ? '1' : ''; el.title = '';
    }
    setForm.querySelectorAll('.test .r').forEach(r => { r.textContent = ''; r.className = 'r'; });
    showAuthLine(''); loadSshPub();
    settingsTexts();
    syncAppearanceControls(); previewAppearance();
  } catch (e) { toast(t('c.error', { msg: e.message })); }
}
function formValues() {
  const v = {};
  for (const el of setForm.elements) {
    if (!el.name || el.dataset.locked === '1') continue;
    if (el.type === 'radio') { if (el.checked) v[el.name] = el.value; }
    else if (el.type === 'checkbox') v[el.name] = el.checked;
    else v[el.name] = el.value;
  }
  return v;
}
setForm.addEventListener('click', async e => {
  const b = e.target.closest('[data-test]'); if (!b) return;
  const r = b.nextElementSibling; r.className = 'r'; r.textContent = t('set.checking'); b.disabled = true;
  try { const res = await api('settings/test', { service: b.dataset.test, values: formValues() }); r.className = 'r ok'; r.textContent = '✓ ' + res.message; }
  catch (err) { r.className = 'r err'; r.textContent = '✕ ' + err.message; }
  finally { b.disabled = false; }
});
$('#setReset').onclick = loadSettings;
// Docker over SSH: generate a key pair and show the authorized_keys line for the Docker host
function showAuthLine(line) { $('#dkPubBox').classList.toggle('hidden', !line); $('#dkPub').value = line || ''; }
async function loadSshPub() {
  const url = setForm.querySelector('[name="docker.url"]')?.value || '';
  if (!/^ssh:\/\//i.test(url)) return;
  $('#dkSsh').open = true;
  try { const r = await api('settings/docker-sshpub'); showAuthLine(r.authorizedKeys); } catch {}
}
$('#dkGenKey').onclick = async () => {
  const r = $('#dkGenR'); r.className = 'r'; r.textContent = t('set.checking');
  try {
    const k = await api('settings/docker-sshkey', {});
    setForm.querySelector('[name="docker.sshKey"]').value = k.privateKey;
    showAuthLine(k.authorizedKeys); r.className = 'r ok'; r.textContent = '✓ ' + t('set.dockerGenDone');
  } catch (e) { r.className = 'r err'; r.textContent = '✕ ' + e.message; }
};
$('#dkCopyPub').onclick = async () => {
  try { await navigator.clipboard.writeText($('#dkPub').value); } catch { $('#dkPub').select(); document.execCommand('copy'); }
  toast(t('set.copied'));
};
setForm.onsubmit = async e => {
  e.preventDefault();
  const v = formValues();
  const authChanged = setLoaded && (v['auth.user'] !== setLoaded.values['auth.user'] || v['auth.pass'] !== setLoaded.values['auth.pass']);
  try {
    const res = await api('settings', { values: v });
    toast(res.restartRequired ? t('set.savedRestart') : t('set.saved'));
    if (authChanged) { setTimeout(() => location.reload(), 1200); return; }
    state.opts = {}; state.data = {}; state.err = {};
    await applyConfig(); await loadSettings(); refresh(); loadAbout(true);
  } catch (err) { toast(t('c.error', { msg: err.message })); }
};

// ---- service icons on cards ----
// Official icons come from the user's own instances via /api/icon/<svc>; generic line icons are the fallback.
const GENERIC_ICONS = {
  radarr: '<rect x="4" y="16" width="40" height="26" rx="3"/><path d="M4 16l2-8 38-4 1 8z"/><path d="M14 7l-3 7M24 6l-3 7M34 5l-3 7"/><path d="M20 24l10 5-10 5z" fill="C"/>',
  sonarr: '<rect x="3" y="10" width="42" height="28" rx="4"/><path d="M16 3l8 7 8-7"/><path d="M14 44h20"/><path d="M20 19l10 5-10 5z" fill="C"/>',
  qbittorrent: '<path d="M10 6v16a14 14 0 0 0 28 0V6"/><path d="M10 6h8v16a6 6 0 0 0 12 0V6h8"/><path d="M10 14h8M30 14h8"/>',
  nzbget: '<path d="M14 36h-2a9 9 0 0 1-1-17.9A12 12 0 0 1 34 16a8 8 0 0 1 2 15.8"/><path d="M24 22v20M17 35l7 7 7-7"/>',
  seerr: '<path d="M6 26l6-18h24l6 18v14H6z"/><path d="M6 26h11l2 5h10l2-5h11"/><path d="M24 10v10M19 15l5 5 5-5"/>',
  docker: '<path d="M24 4 42 14v20L24 44 6 34V14z"/><path d="M6 14l18 10 18-10M24 24v20"/><path d="M15 9l18 10"/>',
};
const ICON_VARS = { radarr: '--radarr', sonarr: '--sonarr', qbittorrent: '--qb', nzbget: '--nzb', seerr: '--seerr', docker: '--docker' };
const iconState = {}; // svc -> 'official' | 'generic'
let iconStamp = Date.now();
function genericIcon(k) {
  const col = getComputedStyle(document.documentElement).getPropertyValue(ICON_VARS[k]).trim() || '#888888';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="${col}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${GENERIC_ICONS[k].replaceAll('fill="C"', `fill="${col}"`)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
function setIconVar(k) {
  const v = iconState[k] === 'official' ? `url("/api/icon/${k}?v=${iconStamp}")` : genericIcon(k);
  document.documentElement.style.setProperty('--icon-' + k, v);
}
function refreshGenericIcons() { [...SVCS, 'docker'].forEach(k => { if (iconState[k] !== 'official') setIconVar(k); }); }
async function loadIcons(force) {
  if (force) iconStamp = Date.now();
  await Promise.all(SVCS.filter(k => state.cfg[k]).map(k => new Promise(done => {
    iconState[k] ??= 'generic'; setIconVar(k);            // generic right away, swap when the official one loads
    const img = new Image();
    img.onload = () => { iconState[k] = 'official'; setIconVar(k); done(); };
    img.onerror = () => { iconState[k] = 'generic'; setIconVar(k); done(); };
    img.src = `/api/icon/${k}?v=${iconStamp}${force ? '&refresh=1' : ''}`;
  })));
  renderIconStatus();
}
function renderIconStatus() {
  const el = $('#iconStatus'); if (!el) return;
  el.textContent = SVCS.filter(k => state.cfg[k] && iconState[k])
    .map(k => `${NAMES[k]}: ${t(iconState[k] === 'official' ? 'set.iconOfficial' : 'set.iconGeneric')}`).join(' · ');
}
function applyCardIcons(ui) {
  document.body.classList.toggle('card-icons', ui.cardIcons !== false);
  document.documentElement.style.setProperty('--card-icon-opacity', String((ui.cardIconStrength ?? 10) / 100));
}
$('#iconReload').onclick = () => loadIcons(true);

// ---- about / version ----
let aboutData = null;
function renderAbout() {
  const d = aboutData, v = state.cfg.version || d?.version || 'dev';
  $('#aboutVer').textContent = 'ArrHub v' + v;
  $('#aboutRepo').href = d?.repo || 'https://github.com/moordrak/arrhub';
  const notes = $('#aboutNotes');
  notes.classList.toggle('hidden', !d?.releaseUrl); if (d?.releaseUrl) notes.href = d.releaseUrl;
  const st = $('#aboutStatus'), nav = $('#navVer');
  nav.textContent = 'v' + v; nav.classList.remove('hidden');
  nav.classList.toggle('upd', !!d?.updateAvailable);
  nav.title = d?.updateAvailable ? t('about.newVersion', { v: d.latest.version }) : 'ArrHub v' + v;
  nav.onclick = () => show('settings');
  if (!d) { st.className = 'st'; st.textContent = t('about.checking'); return; }
  if (d.offline) { st.className = 'st'; st.textContent = t('about.offline'); return; }
  if (d.error) { st.className = 'st'; st.textContent = t('about.checkFailed', { msg: d.error }); return; }
  if (d.updateAvailable) {
    st.className = 'st upd';
    st.innerHTML = `${esc(t('about.newVersion', { v: d.latest.version }))} · <a href="${esc(d.latest.url)}" target="_blank" rel="noopener">${esc(t('about.whatsNew'))}</a>`;
  } else { st.className = 'st ok'; st.textContent = v === 'dev' ? t('about.dev') : t('about.upToDate'); }
}
async function loadAbout(force) {
  if (force) { aboutData = null; renderAbout(); }
  try { aboutData = await api('about' + (force ? '?refresh=1' : '')); } catch (e) { aboutData = { error: e.message }; }
  renderAbout();
}
$('#aboutCheck').onclick = () => loadAbout(true);

// ---- appearance & language ----
const { THEMES, BACKGROUNDS, applyTheme, Bg } = Appearance;
Bg.mediaLoader = () => api('media');
const BG_ICONS = { none: '∅', aurora: '◐', stars: '✦', particles: '⁘', waves: '≈', posters: '▦', fanart: '▣' };
const themeName = (id, th) => (['auto', 'dark', 'oled', 'light', 'pastel-lavender', 'pastel-peach'].includes(id) ? t('theme.' + id) : th.name);
$('#themeList').innerHTML = [['auto', { auto: true }], ...Object.entries(THEMES)].map(([id, th]) => {
  const pv = th.auto
    ? `<div class="pv" style="background:linear-gradient(90deg,${THEMES.light.bg} 50%,${THEMES.dark.bg} 50%)"><i style="background:linear-gradient(90deg,${THEMES.light.panel} 50%,${THEMES.dark.panel} 50%)"></i><b style="background:${THEMES.dark.accent}"></b></div>`
    : `<div class="pv" style="background:${th.bg}"><i style="background:${th.panel};border:1px solid ${th.line}"></i><b style="background:${th.accent}"></b></div>`;
  return `<label class="theme-opt"><input type="radio" name="ui.theme" value="${id}">${pv}<div class="nm" data-theme="${id}"></div></label>`;
}).join('');
$('#bgList').innerHTML = BACKGROUNDS.map(id =>
  `<label class="bg-opt"><input type="radio" name="ui.background" value="${id}"><span>${BG_ICONS[id] || ''}</span><span data-i18n="bg.${id}"></span></label>`).join('');
function labelAppearance() {
  document.querySelectorAll('#themeList .nm').forEach(el => { const id = el.dataset.theme; el.textContent = themeName(id, THEMES[id] || {}); });
}

// Re-render everything that contains translated text
function relabel() {
  I18N.apply(); renderLogSources(); renderLogs(); labelAppearance(); settingsTexts(); renderAbout(); renderIconStatus(); decorateStaticLinks(); render();
  if (lastResults.length && state.view === 'add') renderResults();
}
function applyUi(ui) {
  if (!ui) return;
  if (I18N.setLang(ui.lang)) relabel();
  applyTheme(ui.theme, ui.accent);
  refreshGenericIcons();
  applyCardIcons(ui);
  Bg.set(ui.background, { intensity: ui.bgIntensity, reactive: ui.bgReactive });
}
function currentUiFromForm() {
  const v = formValues();
  return {
    theme: v['ui.theme'] || 'dark', accent: v['ui.accent'] || '', background: v['ui.background'] || 'none',
    bgIntensity: Number(v['ui.bgIntensity'] ?? 60), bgReactive: v['ui.bgReactive'] !== false, lang: v['ui.lang'] || 'en',
    cardIcons: v['ui.cardIcons'] !== false, cardIconStrength: Number(v['ui.cardIconStrength'] ?? 10),
  };
}
function syncAppearanceControls() {
  const ui = currentUiFromForm();
  const th = ui.theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? THEMES.light : THEMES.dark) : THEMES[ui.theme] || THEMES.dark;
  $('#accentPick').value = ui.accent || th.accent;
  $('#accentReset').disabled = !ui.accent;
  $('#bgIntVal').textContent = ui.bgIntensity + '%';
  $('#iconStrVal').textContent = ui.cardIconStrength + '%';
  setForm.elements['ui.cardIconStrength'].disabled = !ui.cardIcons;
  $('#iconReload').disabled = !ui.cardIcons;
  const off = ui.background === 'none';
  setForm.elements['ui.bgIntensity'].disabled = off;
  setForm.elements['ui.bgReactive'].disabled = off || ui.background === 'fanart';
  const lib = ui.background === 'posters' || ui.background === 'fanart';
  const diag = $('#mediaDiag'), wasHidden = diag.classList.contains('hidden');
  diag.classList.toggle('hidden', !lib);
  if (lib && wasHidden) checkMedia();
}
function previewAppearance() { applyUi(currentUiFromForm()); }
async function checkMedia() {
  const r = $('#mediaDiag .r'); r.className = 'r'; r.textContent = t('set.fetchingLib');
  try {
    const m = await api('media?refresh=1');
    Bg.reloadMedia();
    const entries = Object.entries(m.stats || {});
    if (!entries.length) { r.className = 'r err'; r.textContent = '✕ ' + t('set.noArr'); return; }
    let anyOk = false;
    const parts = await Promise.all(entries.map(async ([k, st]) => {
      if (st.error) return `${NAMES[k]}: ✕ ${st.error}`;
      let img = t('set.noImg');
      if (st.sample) {
        const res = await fetch(st.sample, { headers: { 'X-Lang': I18N.lang } });
        if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) { img = t('set.imgOk'); anyOk = true; }
        else { const e = await res.json().catch(() => ({})); img = t('set.imgFail', { msg: e.error || res.status }); }
      }
      return t('set.libLine', { svc: NAMES[k], items: st.items, kind: t(k === 'radarr' ? 'set.movies' : 'set.seriesPl'), posters: st.posters, fanart: st.fanart, img });
    }));
    r.className = 'r ' + (anyOk ? 'ok' : 'err');
    r.innerHTML = parts.map(esc).join('<br>');
    if (anyOk) { previewAppearance(); Bg.restart(); }
  } catch (e) { r.className = 'r err'; r.textContent = '✕ ' + e.message; }
}
$('#mediaCheck').onclick = checkMedia;
$('#accentPick').addEventListener('input', e => { setForm.elements['ui.accent'].value = e.target.value; syncAppearanceControls(); previewAppearance(); });
$('#accentReset').onclick = () => { setForm.elements['ui.accent'].value = ''; syncAppearanceControls(); previewAppearance(); };
const onUiChange = e => { if (e.target.name?.startsWith('ui.')) { syncAppearanceControls(); previewAppearance(); } };
setForm.addEventListener('input', onUiChange);
setForm.addEventListener('change', onUiChange);

let timer;
async function applyConfig() {
  state.cfg = await api('config');
  $('.logo').title = 'ArrHub ' + (state.cfg.version || '');
  applyUi(state.cfg.ui);
  const any = SVCS.some(k => state.cfg[k]) || state.cfg.docker;
  iconState.docker = 'generic'; setIconVar('docker');
  loadIcons(false);
  $('#setupNotice').classList.toggle('hidden', any);
  document.querySelectorAll('[data-svc]').forEach(el => el.classList.toggle('hidden', !state.cfg[el.dataset.svc]));
  decorateStaticLinks();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden && !refreshing) refresh(); }, (state.cfg.refresh || 5) * 1000);
  return any;
}

(async () => {
  I18N.apply(); labelAppearance();
  const any = await applyConfig();
  renderAbout(); loadAbout(false);
  show(location.hash.slice(1) || (any ? 'overview' : 'settings'));
  await refresh();
})();
