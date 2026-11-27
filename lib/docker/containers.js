// Docker containers: list, stats, actions, logs, image update checks and updates (pull + recreate)
'use strict';

const crypto_ = require('crypto');
const { langStore, T } = require('../i18n');
const config = require('../config');
const { mergeInput } = config;
const { friendlyError } = require('../about');
const { dockerApi, enc, parseRef, refName, isSelf, dockerTarget, dockerErr } = require('./api');
const { npmRefresh, npmState, webLinks } = require('./web');

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
  const np = npmRefresh();
  if (!npmState.at && config.cfg.npm?.url) await Promise.race([np, new Promise(r => setTimeout(r, 4000))]);
  const out = await Promise.all(list.map(async c => {
    const image = await containerRef(c);
    const ports = [...new Set((c.Ports || []).filter(x => x.PublicPort).map(x => `${x.PublicPort}:${x.PrivatePort}/${x.Type}`))];
    return {
      id: c.Id, name: (c.Names?.[0] || '').replace(/^\//, ''), image, state: c.State, status: c.Status, created: c.Created,
      project: c.Labels?.['com.docker.compose.project'] || '', service: c.Labels?.['com.docker.compose.service'] || '',
      health: (/\((healthy|unhealthy|health: starting)\)/.exec(c.Status || '') || [])[1]?.replace('health: ', '') || '',
      ports, networkMode: c.HostConfig?.NetworkMode || '', self: isSelf(c.Id), update: await updateStateFor(image, c.ImageID),
      web: webLinks(c, image),
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
  if (config.cfg.docker?.cleanup !== false) {
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

module.exports = { jlog, pullImage, checkStarted, imgCache, jobs, newJob, dockerTest, dockerSummary, dockerContainers, dockerInfo, dk, checkUpdates, startUpdate, dockerAction, dockerLogs };
