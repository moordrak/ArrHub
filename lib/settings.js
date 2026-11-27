// Saving the settings from the UI and the "Test connection" buttons
'use strict';

const fs = require('fs');
const { T } = require('./i18n');
const config = require('./config');
const { mergeInput, validate, readFileConfig, FIELDS, envSet, getF, setF, SERVICES, CONFIG_FILE, parseCa } = config;
const { originOf, tlsStore } = require('./net');
const { qb, arr, makeQb, makeSeerr, makeProwlarr, makeBazarr, makeNzb } = require('./services');
const { mediaCache, coverFail, iconCache } = require('./media');
const { aboutCache } = require('./about');
const { npmState } = require('./docker/web');

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
  const oldPort = config.cfg.port;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  config.reload();
  qb.sid = null;
  mediaCache.at = 0; aboutCache.at = 0; npmState.at = 0;   // offline mode / service URLs / NPM may have changed
  console.log('Settings saved' + (config.cfg.net?.offline ? ' (offline mode)' : ''));
  return { ok: true, restartRequired: config.cfg.port !== oldPort };
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
  if (service === 'prowlarr') {
    const st = await makeProwlarr(s).call('/system/status');
    if (st.appName && st.appName.toLowerCase() !== 'prowlarr') throw new Error(T('wrongApp', { app: st.appName, svc: 'Prowlarr' }));
    const idx = await makeProwlarr(s).call('/indexer').catch(() => []);
    return { message: `Prowlarr ${st.version} · ${T('nIndexers', { n: Array.isArray(idx) ? idx.length : 0 })}` };
  }
  if (service === 'bazarr') {
    const st = await makeBazarr(s).call('/system/status');
    const v = st?.data?.bazarr_version;
    if (!v) throw new Error(T('wrongApp', { app: '?', svc: 'Bazarr' }));
    return { message: `Bazarr ${v}` };
  }
  return { message: `NZBGet ${await makeNzb(() => s).rpc('version')}` };
}

module.exports = { saveSettings, testService };
