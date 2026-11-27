// API clients for the services: Radarr, Sonarr, Prowlarr, Bazarr, qBittorrent, NZBGet and Seerr
'use strict';

const { T } = require('./i18n');
const config = require('./config');
const { hashId, coverMap } = require('./util');
const { json, req, enabled } = require('./net');

// ---------- Radarr / Sonarr (API v3) ----------
function arr(name, c = config.cfg[name]) {
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

// ---------- Prowlarr (API v1) ----------
function makeProwlarr(c) {
  const call = (p, opts = {}) => json(`${c.url}/api/v1${p}`, { ...opts, headers: { 'X-Api-Key': c.apiKey, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const names = async () => Object.fromEntries((await call('/indexer').catch(() => [])).map(i => [i.id, i.name]));
  return {
    call,
    async summary() {
      const since = new Date(Date.now() - 86400000).toISOString();
      const [status, indexers, istatus, health, apps, stats] = await Promise.all([
        call('/system/status'), call('/indexer'), call('/indexerstatus').catch(() => []), call('/health').catch(() => []),
        call('/applications').catch(() => []), call(`/indexerstats?startDate=${encodeURIComponent(since)}`).catch(() => null),
      ]);
      const now = Date.now();
      const byId = Object.fromEntries(indexers.map(i => [i.id, i]));
      // an indexer is failing while Prowlarr has it disabled after errors (disabledTill in the future)
      const failing = (istatus || []).filter(x => byId[x.indexerId]?.enable && x.disabledTill && Date.parse(x.disabledTill) > now)
        .map(x => ({ name: byId[x.indexerId].name, until: x.disabledTill, since: x.mostRecentFailure || x.initialFailure || null }));
      const st = (stats?.indexers || []);
      const sum = k => st.reduce((a, x) => a + (Number(x[k]) || 0), 0);
      return {
        version: status.version, total: indexers.length, enabled: indexers.filter(i => i.enable).length, failing,
        apps: (apps || []).map(a => ({ name: a.name, app: a.implementationName || a.implementation, sync: a.syncLevel })),
        queries: sum('numberOfQueries'), grabs: sum('numberOfGrabs'), failedQueries: sum('numberOfFailedQueries') + sum('numberOfFailedGrabs'),
        health: health || [],
      };
    },
    async history(page, size) {
      const [d, n] = await Promise.all([call(`/history?page=${page}&pageSize=${size}&sortKey=date&sortDirection=descending`), names()]);
      const records = (d.records || []).map(r => ({ id: r.id, date: r.date, eventType: r.eventType, successful: r.successful !== false, indexer: n[r.indexerId] || '',
        query: r.data?.query || '', results: r.data?.queryResults != null ? Number(r.data.queryResults) : null, title: r.data?.grabTitle || r.data?.title || '',
        source: r.data?.source || '', host: r.data?.host || '', elapsed: r.data?.elapsedTime != null ? Number(r.data.elapsedTime) : null }));
      return { records, total: d.totalRecords ?? records.length };
    },
    // tests every enabled indexer; Prowlarr disables the ones that fail
    async testAll() {
      const [res, n] = await Promise.all([call('/indexer/testall', { method: 'POST', timeout: 120000 }), names()]);
      const list = Array.isArray(res) ? res : [];
      const bad = list.filter(x => x.isValid === false).map(x => ({ name: n[x.id] || `#${x.id}`, error: (x.validationFailures || []).map(f => f.errorMessage).filter(Boolean).join('; ') }));
      return { tested: list.length, ok: list.length - bad.length, bad };
    },
    syncApps() { return call('/command', { method: 'POST', body: JSON.stringify({ name: 'ApplicationIndexerSync' }) }); },
  };
}
const prowlarr = { summary: () => makeProwlarr(config.cfg.prowlarr).summary(), history: (p, s) => makeProwlarr(config.cfg.prowlarr).history(p, s), call: (p, o) => makeProwlarr(config.cfg.prowlarr).call(p, o) };

// ---------- Bazarr ----------
// Bazarr formats times as text: history "%x %X" (11/27/26 18:22:01), logs "27/11/2026 18:22:01" – both in Bazarr's local time
function bazarrTime(s) {
  if (!s) return null;
  if (/^\d{4}-\d\d-\d\dT/.test(s)) { const t = Date.parse(s); return Number.isNaN(t) ? null : t; }
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})[ ,T]+(\d{1,2}):(\d\d)(?::(\d\d))?/.exec(s);
  if (m) return new Date(2000 + Number(m[3]), m[1] - 1, Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime();
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,T]+(\d{1,2}):(\d\d)(?::(\d\d))?/.exec(s);
  if (m) return new Date(Number(m[3]), m[2] - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime();
  const t = Date.parse(s); return Number.isNaN(t) ? null : t;
}
function makeBazarr(c) {
  const call = (p, opts = {}) => json(`${c.url}/api${p}`, { ...opts, headers: { 'X-API-KEY': c.apiKey, Accept: 'application/json', ...(opts.headers || {}) } });
  const histItem = (r, kind) => ({
    kind, action: Number(r.action), title: kind === 'movie' ? r.title : r.seriesTitle, episode: kind === 'episode' ? [r.episode_number, r.episodeTitle].filter(Boolean).join(' · ') : '',
    language: r.language?.name || r.language?.code2 || (typeof r.language === 'string' ? r.language : ''), forced: !!r.language?.forced, hi: !!r.language?.hi,
    provider: r.provider || '', score: r.score || '', description: r.description || '',
    time: bazarrTime(r.parsed_timestamp) ?? bazarrTime(r.timestamp), when: r.timestamp || '',
  });
  return {
    call,
    async summary() {
      const [status, badges, health, providers] = await Promise.all([
        call('/system/status'), call('/badges').catch(() => ({})), call('/system/health').catch(() => ({ data: [] })), call('/providers').catch(() => ({ data: [] })),
      ]);
      return {
        version: status?.data?.bazarr_version || '', episodes: Number(badges.episodes) || 0, movies: Number(badges.movies) || 0,
        sonarr: status?.data?.sonarr_version || '', radarr: status?.data?.radarr_version || '',
        throttled: (providers?.data || []).map(p => ({ name: p.name, status: p.status, retry: p.retry })),
        health: (health?.data || []).map(h => ({ type: 'warning', message: [h.object, h.issue].filter(Boolean).join(': ') })),
      };
    },
    // episodes and movies come from two endpoints – merged newest first
    async history(page, size) {
      const n = page * size;
      const [e, m] = await Promise.all([
        call(`/episodes/history?start=0&length=${n}`).catch(err => ({ err })),
        call(`/movies/history?start=0&length=${n}`).catch(err => ({ err })),
      ]);
      if (e?.err && m?.err) throw e.err;
      const all = [...(e?.data || []).map(r => histItem(r, 'episode')), ...(m?.data || []).map(r => histItem(r, 'movie'))]
        .sort((a, b) => (b.time || 0) - (a.time || 0));
      return { records: all.slice((page - 1) * size, n), total: (Number(e?.total) || 0) + (Number(m?.total) || 0) };
    },
    // runs Bazarr's own "search for missing subtitles" tasks
    async searchWanted() {
      for (const taskid of ['wanted_search_missing_subtitles_series', 'wanted_search_missing_subtitles_movies']) {
        await call('/system/tasks', { method: 'POST', body: new URLSearchParams({ taskid }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      }
      return { ok: true };
    },
  };
}
const bazarr = { summary: () => makeBazarr(config.cfg.bazarr).summary(), history: (p, s) => makeBazarr(config.cfg.bazarr).history(p, s), call: (p, o) => makeBazarr(config.cfg.bazarr).call(p, o) };

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
  // free space in the download folder: /sync/maindata, incremental after the first call (rid) so it stays cheap
  rid: 0, serverState: {},
  async freeSpace() {
    try {
      const d = await this.call(`/sync/maindata?rid=${this.rid}`);
      if (d.full_update) this.serverState = {};
      Object.assign(this.serverState, d.server_state || {});
      this.rid = d.rid || 0;
    } catch { this.rid = 0; }
    return this.serverState.free_space_on_disk ?? null;
  },
  async summary() {
    const [transfer, torrents, version, freeSpace] = await Promise.all([
      this.call('/transfer/info'),
      this.call('/torrents/info?sort=added_on&reverse=true'),
      this.call('/app/version').catch(() => ''),
      this.freeSpace(),
    ]);
    return { version, transfer, torrents, freeSpace };
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
const qb = makeQb(() => config.cfg.qbittorrent);

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
const nzb = makeNzb(() => config.cfg.nzbget);

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
    const base = config.cfg.seerr?.url; if (!base) return null;
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
const seerr = makeSeerr(() => config.cfg.seerr);

// Add tab: normally the browser loads lookup posters straight from TMDB/TVDB. In offline mode they go
// through ArrHub instead – via Seerr's image proxy for TMDB posters, otherwise no poster.
function lookupPosters(list) {
  if (!config.cfg.net?.offline || !Array.isArray(list)) return list;
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

module.exports = { arr, qb, nzb, prowlarr, bazarr, bazarrTime, seerr, makeQb, makeSeerr, makeProwlarr, makeBazarr, makeNzb, PAGE_SIZES, lookupPosters };
