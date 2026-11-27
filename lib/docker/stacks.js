// Docker compose stacks and image cleanup
'use strict';

const fs = require('fs');
const path = require('path');
const compose = require('../../compose');
const { T } = require('../i18n');
const config = require('../config');
const { CONFIG_FILE } = config;
const { sleep } = require('../util');
const { friendlyError } = require('../about');
const { dockerErr, dockerApi, isSelf, enc } = require('./api');
const { jlog, pullImage, checkStarted, imgCache, jobs, newJob } = require('./containers');

// ---- compose stacks: paste a docker-compose.yml, ArrHub creates the networks, volumes and containers itself ----
const STACK_DIR = path.join(path.dirname(CONFIG_FILE), 'stacks');
const STACK_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const PROJECT_LABEL = 'com.docker.compose.project';
function stackPath(name, ext) {
  if (!STACK_RE.test(String(name || ''))) throw dockerErr(T('stackBadName'), { status: 400 });
  return path.join(STACK_DIR, `${name}.${ext}`);
}
function stackRead(name) {
  const f = stackPath(name, 'yml');
  if (!fs.existsSync(f)) return null;
  const e = stackPath(name, 'env');
  return { name, yml: fs.readFileSync(f, 'utf8'), env: fs.existsSync(e) ? fs.readFileSync(e, 'utf8') : '', updatedAt: fs.statSync(f).mtimeMs };
}
function stackWrite(name, yml, env) {
  if (typeof yml !== 'string' || !yml.trim()) throw dockerErr(T('stackEmpty'), { status: 400 });
  fs.mkdirSync(STACK_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(stackPath(name, 'yml'), yml.replace(/\r\n?/g, '\n'), { mode: 0o600 });
  const e = stackPath(name, 'env');
  if (env && String(env).trim()) fs.writeFileSync(e, String(env).replace(/\r\n?/g, '\n'), { mode: 0o600 }); else fs.rmSync(e, { force: true });
}
const cName = c => (c.Names?.[0] || c.Name || '').replace(/^\//, '');
async function stackList() {
  const saved = fs.existsSync(STACK_DIR) ? fs.readdirSync(STACK_DIR).filter(f => f.endsWith('.yml')).map(f => f.slice(0, -4)).filter(n => STACK_RE.test(n)) : [];
  let all = [];
  try { all = await dockerApi('GET', '/containers/json?all=1'); } catch (e) { if (!saved.length) throw e; }
  const byProj = {};
  for (const c of all) { const p = c.Labels?.[PROJECT_LABEL]; if (p) (byProj[p] ||= []).push({ name: cName(c), service: c.Labels['com.docker.compose.service'] || '', state: c.State, self: isSelf(c.Id), arrhub: c.Labels['arrhub.stack'] === p }); }
  const names = [...new Set([...saved, ...Object.keys(byProj)])].sort();
  return {
    dir: STACK_DIR,
    stacks: names.map(n => {
      const cs = byProj[n] || [], s = saved.includes(n) ? stackRead(n) : null;
      return { name: n, saved: !!s, updatedAt: s?.updatedAt || null, containers: cs, running: cs.filter(c => c.state === 'running').length, total: cs.length, importable: STACK_RE.test(n) };
    }),
  };
}
async function imageId(ref) { try { return (await dockerApi('GET', `/images/${enc(ref)}/json`)).Id; } catch (e) { if (e.dockerStatus === 404) return null; throw e; } }
async function inspectOrNull(kind, id) { try { return await dockerApi('GET', `/${kind}/${enc(id)}${kind === 'containers' ? '/json' : ''}`); } catch (e) { if (e.dockerStatus === 404) return null; throw e; } }
function stackCompile(name, yml, env) {
  stackPath(name, 'yml');
  try { return compose.plan(yml, env, name, true); }
  catch (e) { throw dockerErr(e.message, { status: 400, line: e.line }); }
}
// what a deploy would do, without doing it
async function stackCheck(name, yml, env) {
  const p = stackCompile(name, yml, env);
  const all = await dockerApi('GET', '/containers/json?all=1');
  const services = await Promise.all(p.services.map(async s => {
    const ex = all.find(c => cName(c) === s.container);
    const img = await imageId(s.image);
    let action = 'create';
    if (ex) {
      if (isSelf(ex.Id)) action = 'self';
      else if (ex.Labels?.[PROJECT_LABEL] !== name) action = 'replace';
      else action = ex.Labels?.['com.docker.compose.config-hash'] === s.hash && img && ex.ImageID === img ? (ex.State === 'running' ? 'unchanged' : 'start') : 'recreate';
    }
    return { service: s.service, container: s.container, image: s.image, action, imageLocal: !!img, ports: s.ports, network: s.body.HostConfig.NetworkMode || '', deps: s.deps.map(d => d.service), foreign: ex && action === 'replace' ? ex.Labels?.[PROJECT_LABEL] || '' : undefined };
  }));
  const orphans = all.filter(c => c.Labels?.[PROJECT_LABEL] === name && !p.services.some(s => s.service === c.Labels['com.docker.compose.service'] && s.container === cName(c))).map(cName);
  const networks = await Promise.all(p.networks.map(async n => ({ name: n.name, external: n.external, exists: !!(await inspectOrNull('networks', n.name)) })));
  const volumes = await Promise.all(p.volumes.map(async v => ({ name: v.name, external: v.external, exists: !!(await inspectOrNull('volumes', v.name)) })));
  return { project: name, services, orphans, networks, volumes, warnings: p.warnings, skipped: p.skipped };
}

async function waitFor(dep, cond, job) {
  const end = Date.now() + 180000;
  jlog(job, `wait for ${dep} (${cond.replace('service_', '')})`);
  for (;;) {
    const ins = await inspectOrNull('containers', dep);
    if (!ins) throw new Error(T('stackDepFailed', { name: dep, why: 'missing' }));
    const st = ins.State;
    if (cond === 'service_healthy') {
      if (!st.Health) throw new Error(T('stackDepFailed', { name: dep, why: 'no healthcheck' }));
      if (st.Health.Status === 'healthy') return;
      if (st.Health.Status === 'unhealthy') throw new Error(T('stackDepFailed', { name: dep, why: 'unhealthy' }));
    } else if (cond === 'service_completed_successfully') {
      if (st.Status === 'exited') { if (st.ExitCode === 0) return; throw new Error(T('stackDepFailed', { name: dep, why: `exit ${st.ExitCode}` })); }
    } else if (st.Running) return;
    if (Date.now() > end) throw new Error(T('stackDepFailed', { name: dep, why: 'timeout' }));
    await sleep(1500);
  }
}
async function removeContainer(c, job, why) {
  const id = c.Id, nm = cName(c);
  if (isSelf(id)) throw new Error(T('dockerSelf'));
  jlog(job, `remove ${nm}${why ? ` (${why})` : ''}`);
  if (c.State === 'running' || c.State?.Running || c.State === 'restarting' || c.State?.Restarting) await dockerApi('POST', `/containers/${id}/stop?t=${c.Config?.StopTimeout || 10}`, { timeout: 120000 });
  await dockerApi('DELETE', `/containers/${id}?force=1`);
}
async function stackDeploy(name, yml, env, opts, job) {
  const p = stackCompile(name, yml, env);
  for (const w of p.warnings) jlog(job, `warning: ${w}`);
  if (p.skipped.length) jlog(job, `skipped (profiles): ${p.skipped.join(', ')}`);
  let all = await dockerApi('GET', '/containers/json?all=1');
  const byName = n => all.find(c => cName(c) === n);
  // refuse before touching anything
  for (const s of p.services) {
    const ex = byName(s.container);
    if (ex && isSelf(ex.Id)) throw new Error(`${s.container}: ${T('dockerSelf')}`);
  }
  const foreign = p.services.map(s => byName(s.container)).filter(c => c && c.Labels?.[PROJECT_LABEL] !== name);
  if (foreign.length && !opts.replace) throw new Error(T('stackConflict', { names: foreign.map(cName).join(', ') }));
  job.step = 'preparing';
  for (const n of p.networks) {
    const ex = await inspectOrNull('networks', n.name);
    if (n.external) { if (!ex) throw new Error(T('stackNoNetwork', { name: n.name })); continue; }
    if (!ex) { jlog(job, `create network ${n.name}`); await dockerApi('POST', '/networks/create', { body: n.body }); }
  }
  for (const v of p.volumes) {
    const ex = await inspectOrNull('volumes', v.name);
    if (v.external) { if (!ex) throw new Error(T('stackNoVolume', { name: v.name })); continue; }
    if (!ex) { jlog(job, `create volume ${v.name}`); await dockerApi('POST', '/volumes/create', { body: v.body }); }
  }
  // images
  job.step = 'pulling';
  const imgs = [...new Map(p.services.map(s => [s.image, s])).values()];
  let k = 0;
  for (const s of imgs) {
    const have = await imageId(s.image);
    const want = s.pull === 'always' || (opts.pull && s.pull !== 'never') || (!have && s.pull !== 'never');
    if (!have && s.pull === 'never') throw new Error(T('stackNoImage', { image: s.image }));
    if (want) {
      jlog(job, `pull ${s.image}`);
      const sub = { log: job.log, progress: 0 };
      const tick = setInterval(() => { job.progress = Math.round((k + (sub.progress || 0) / 100) / imgs.length * 100); }, 300);
      try { await pullImage(s.image, sub); }
      catch (e) { if (!have) throw new Error(`${s.image}: ${e.message}`); jlog(job, `pull failed, using the local image: ${e.message}`); }
      finally { clearInterval(tick); }
    }
    k++; job.progress = Math.round(k / imgs.length * 100);
  }
  // containers, dependencies first
  const res = { created: [], recreated: [], unchanged: [], removed: [], problems: [] };
  const changed = new Set(), oldImages = new Set();
  for (const s of p.services) {
    job.step = 'creating';
    for (const d of s.deps) {
      const dep = p.services.find(x => x.service === d.service);
      try { await waitFor(dep.container, d.condition, job); } catch (e) { if (d.required) throw e; jlog(job, `${e.message} – continuing`); }
    }
    all = await dockerApi('GET', '/containers/json?all=1');
    const img = await imageId(s.image);
    const ex = byName(s.container);
    const sharesWithChanged = /^container:/.test(s.body.HostConfig.NetworkMode || '') && changed.has(s.body.HostConfig.NetworkMode.slice(10));
    // the same service under an older container_name
    for (const c of all.filter(c => c.Labels?.[PROJECT_LABEL] === name && c.Labels['com.docker.compose.service'] === s.service && cName(c) !== s.container)) { await removeContainer(c, job, 'renamed'); res.removed.push(cName(c)); }
    if (ex && ex.Labels?.[PROJECT_LABEL] === name && ex.Labels['com.docker.compose.config-hash'] === s.hash && ex.ImageID === img && !sharesWithChanged) {
      if (ex.State !== 'running') { jlog(job, `start ${s.container}`); await dockerApi('POST', `/containers/${ex.Id}/start`, { timeout: 60000 }); }
      else jlog(job, `${s.container} is up to date`);
      res.unchanged.push(s.container);
      continue;
    }
    if (ex) { await removeContainer(ex, job, ex.Labels?.[PROJECT_LABEL] === name ? 'changed' : 'replaced'); if (ex.ImageID !== img) oldImages.add(ex.ImageID); }
    jlog(job, `create ${s.container} (${s.image})`);
    const q = new URLSearchParams({ name: s.container }); if (s.platform) q.set('platform', s.platform);
    const id = (await dockerApi('POST', `/containers/create?${q}`, { body: s.body, timeout: 60000 })).Id;
    for (const c of s.connect) await dockerApi('POST', `/networks/${enc(c.network)}/connect`, { body: { Container: id, EndpointConfig: c.cfg } });
    job.step = 'starting'; jlog(job, `start ${s.container}`);
    try { await dockerApi('POST', `/containers/${id}/start`, { timeout: 60000 }); }
    catch (e) { res.problems.push(`${s.container}: ${e.message}`); jlog(job, `start failed: ${e.message}`); }
    changed.add(s.container);
    (ex ? res.recreated : res.created).push(s.container);
  }
  // services that are no longer in the file
  all = await dockerApi('GET', '/containers/json?all=1');
  for (const c of all.filter(c => c.Labels?.[PROJECT_LABEL] === name && !p.services.some(s => s.container === cName(c)))) {
    try { await removeContainer(c, job, 'not in the file any more'); res.removed.push(cName(c)); } catch (e) { res.problems.push(`${cName(c)}: ${e.message}`); }
  }
  if (config.cfg.docker?.cleanup !== false) for (const id of oldImages) { try { await dockerApi('DELETE', `/images/${id}`); jlog(job, `old image ${id.slice(7, 19)} removed`); } catch {} }
  job.step = 'verifying';
  const started = [...res.created, ...res.recreated];
  await Promise.all(started.map(async n => { const bad = await checkStarted(n).catch(e => e.message); if (bad) { res.problems.push(`${n}: ${bad}`); jlog(job, `${n}: ${bad}`); } }));
  imgCache.clear();
  return res;
}
async function stackDown(name, opts, job) {
  stackPath(name, 'yml');
  const all = await dockerApi('GET', `/containers/json?all=1&filters=${enc(JSON.stringify({ label: [`${PROJECT_LABEL}=${name}`] }))}`);
  if (all.some(c => isSelf(c.Id))) throw new Error(T('dockerSelf'));
  job.step = 'stopping';
  // containers that share another one's network go first
  all.sort((a, b) => (/^container:/.test(b.HostConfig?.NetworkMode) ? 1 : 0) - (/^container:/.test(a.HostConfig?.NetworkMode) ? 1 : 0));
  const removed = [];
  for (const c of all) { await removeContainer(c, job); removed.push(cName(c)); }
  job.step = 'cleanup';
  const lf = enc(JSON.stringify({ label: [`${PROJECT_LABEL}=${name}`] }));
  for (const n of await dockerApi('GET', `/networks?filters=${lf}`)) { try { await dockerApi('DELETE', `/networks/${n.Id}`); jlog(job, `remove network ${n.Name}`); } catch (e) { jlog(job, `network ${n.Name}: ${e.message}`); } }
  if (opts.volumes) for (const v of (await dockerApi('GET', `/volumes?filters=${lf}`)).Volumes || []) { try { await dockerApi('DELETE', `/volumes/${enc(v.Name)}`); jlog(job, `remove volume ${v.Name}`); } catch (e) { jlog(job, `volume ${v.Name}: ${e.message}`); } }
  if (opts.forget) { fs.rmSync(stackPath(name, 'yml'), { force: true }); fs.rmSync(stackPath(name, 'env'), { force: true }); jlog(job, 'stack file deleted'); }
  imgCache.clear();
  return { removed };
}
function stackJob(name, kind, fn) {
  if ([...jobs.values()].some(j => j.name === `stack:${name}` && j.state === 'running')) throw dockerErr(T('stackBusy'), { status: 409 });
  const job = newJob(`stack:${name}`);
  job.kind = kind;
  (async () => {
    try {
      console.log(`docker: stack ${name} – ${kind}`);
      job.result = await fn(job);
      job.state = job.result?.problems?.length ? 'error' : 'done';
      if (job.state === 'error') job.error = job.result.problems.join(' · ');
      job.step = 'done';
    } catch (e) {
      job.state = 'error'; job.error = friendlyError(e);
      console.warn(`docker: stack ${name} ${kind} failed – ${job.error}`);
    } finally { job.finishedAt = Date.now(); }
  })();
  return job;
}
async function stackOp(name, op, b) {
  if (op === 'save') { stackPath(name, 'yml'); stackCompile(name, b.yml, b.env); stackWrite(name, b.yml, b.env); return { saved: true }; }
  if (op === 'check') return stackCheck(name, b.yml, b.env);
  if (op === 'deploy') {
    stackCompile(name, b.yml, b.env);           // a broken file is never saved or started
    stackWrite(name, b.yml, b.env);
    return stackJob(name, 'deploy', job => stackDeploy(name, b.yml, b.env, { pull: !!b.pull, replace: !!b.replace }, job));
  }
  if (op === 'down') return stackJob(name, 'down', job => stackDown(name, { volumes: !!b.volumes, forget: !!b.forget }, job));
  if (op === 'delete') { stackPath(name, 'yml'); fs.rmSync(stackPath(name, 'yml'), { force: true }); fs.rmSync(stackPath(name, 'env'), { force: true }); return { deleted: true }; }
  if (op === 'start' || op === 'stop' || op === 'restart') {
    const all = await dockerApi('GET', `/containers/json?all=1&filters=${enc(JSON.stringify({ label: [`${PROJECT_LABEL}=${name}`] }))}`);
    const list = all.filter(c => !isSelf(c.Id));
    for (const c of op === 'stop' ? list.reverse() : list) { try { await dockerApi('POST', `/containers/${c.Id}/${op}`, { timeout: 120000 }); } catch (e) { if (e.dockerStatus !== 304) throw e; } }
    return { n: list.length };
  }
  throw dockerErr(T('notFound'), { status: 404 });
}

// ---- images: list, and remove the ones no container uses ----
async function dockerImages() {
  const [imgs, all] = await Promise.all([dockerApi('GET', '/images/json'), dockerApi('GET', '/containers/json?all=1')]);
  const used = {};
  for (const c of all) (used[c.ImageID] ||= []).push(cName(c));
  const images = imgs.map(i => {
    const tags = (i.RepoTags || []).filter(t => t !== '<none>:<none>');
    return { id: i.Id, tags, repo: tags.length ? '' : ((i.RepoDigests || [])[0] || '').split('@')[0], size: i.Size, created: i.Created * 1000, containers: used[i.Id] || [], dangling: !tags.length };
  }).sort((a, b) => (a.containers.length ? 1 : 0) - (b.containers.length ? 1 : 0) || b.size - a.size);
  const unused = images.filter(i => !i.containers.length);
  return { images, unusedCount: unused.length, unusedSize: unused.reduce((a, i) => a + i.size, 0) };
}
async function removeImages(ids, all) {
  const { images } = await dockerImages();
  const pick = all ? images.filter(i => !i.containers.length) : images.filter(i => (ids || []).includes(i.id));
  const removed = [], failed = [];
  let freed = 0;
  for (const i of pick) {
    if (i.containers.length) { failed.push({ id: i.id, name: i.tags[0] || i.id.slice(7, 19), error: T('imageInUse', { names: i.containers.join(', ') }) }); continue; }
    // force only untags an image that has several tags – it is not used by any container (checked above)
    try { await dockerApi('DELETE', `/images/${i.id}?force=1`, { timeout: 120000 }); removed.push(i.tags[0] || i.id.slice(7, 19)); freed += i.size; }
    catch (e) { if (e.dockerStatus === 404) continue; failed.push({ id: i.id, name: i.tags[0] || i.id.slice(7, 19), error: friendlyError(e) }); }
  }
  imgCache.clear();
  if (removed.length) console.log(`docker: removed ${removed.length} unused images (${(freed / 1048576).toFixed(0)} MB)`);
  return { removed, failed, freed };
}

module.exports = { imageId, stackList, stackRead, stackOp, dockerImages, removeImages };
