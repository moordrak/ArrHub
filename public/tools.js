// ArrHub — Tools: generates a Docker compose file and a Proxmox LXC install script for the whole arr stack.
// The generators at the top have no DOM access (also used from Node: `node -e "require('./public/tools.js')"`).
'use strict';
(() => {
  const APPS = ['radarr', 'sonarr', 'prowlarr', 'bazarr', 'nzbget', 'qbittorrent', 'seerr', 'arrhub'];
  const NAME = { radarr: 'Radarr', sonarr: 'Sonarr', prowlarr: 'Prowlarr', bazarr: 'Bazarr', nzbget: 'NZBGet', qbittorrent: 'qBittorrent', seerr: 'Seerr', arrhub: 'ArrHub', npm: 'Nginx Proxy Manager' };
  const PORT = { radarr: 7878, sonarr: 8989, prowlarr: 9696, bazarr: 6767, nzbget: 6789, qbittorrent: 8080, seerr: 5055, arrhub: 8686 };
  // Proxmox defaults: cores, RAM MB, disk GB (same as proxmox/arr-stack-lxc.sh)
  const RES = { radarr: [2, 1024, 4], sonarr: [2, 1024, 4], prowlarr: [1, 512, 2], bazarr: [1, 1024, 4], nzbget: [2, 1024, 4], qbittorrent: [2, 1024, 4], seerr: [2, 2048, 8], arrhub: [1, 512, 4] };
  const SCRIPT_URL = 'https://raw.githubusercontent.com/moordrak/arrhub/main/proxmox/arr-stack-lxc.sh';

  const DEFAULTS = {
    apps: [...APPS], npm: false,
    tz: 'Europe/Zagreb', puid: 1000, pgid: 1000, domain: 'int',
    // compose
    project: 'arr', cfgPath: '/opt/arr/config', dataPath: '/opt/arr/data', socket: true, ports: true,
    // proxmox
    ctid: '', prefix: '', storage: 'local-lvm', tplStorage: 'local', bridge: 'vmbr0', vlan: '', net: 'dhcp', ipStart: '', gw: '', dns: '',
    mediaHost: '', unpriv: true, onboot: true, caFile: '', qbUser: 'admin', nzbUser: 'nzbget', arrhubUser: '', lang: 'en',
    res: {},
  };

  const yq = v => /^[\w./:@-]*$/.test(String(v)) && String(v) !== '' ? String(v) : JSON.stringify(String(v));   // YAML scalar
  const sq = v => `'${String(v).replace(/'/g, `'\\''`)}'`;                                                    // shell single quotes
  const trimSlash = p => String(p || '').trim().replace(/\/+$/, '') || '/';

  // ---------------- Docker compose ----------------
  function genCompose(o) {
    o = { ...DEFAULTS, ...o };
    const on = new Set(o.apps), cfg = trimSlash(o.cfgPath), data = trimSlash(o.dataPath);
    const env = (extra = []) => ['    environment:', `      - PUID=${o.puid}`, `      - PGID=${o.pgid}`, `      - TZ=${o.tz}`, '      - UMASK=002', ...extra.map(e => `      - ${e}`)];
    const ports = list => o.ports ? ['    ports:', ...list.map(p => `      - "${p}"`)] : [];
    const L = [];
    const svc = (name, lines) => { if (on.has(name)) L.push('', ...lines); };
    L.push(
      '# ArrHub – the whole arr stack in Docker (generated in ArrHub → Tools)',
      '#',
      '# Assumptions – change them to match your setup:',
      `#  - every app runs as ${o.puid}:${o.pgid} (PUID/PGID) and owns ${cfg} and ${data}`,
      `#  - one shared folder ${data} → /data in every app that touches files, so Radarr/Sonarr can`,
      '#    hardlink instead of copy:  /data/torrents/{movies,tv}  /data/usenet/complete/{movies,tv}  /data/media/{movies,tv}',
      '#  - the apps find each other by service name on the stack network (http://radarr:7878, http://qbittorrent:8080, …)',
      o.ports ? '#  - web UI ports are published on the Docker host; behind Nginx Proxy Manager you can remove them' : '#  - no ports are published: reach the apps through Nginx Proxy Manager on the same network',
      '#  - images: linuxserver.io where there is one, the official image for Seerr and ArrHub',
      '#',
      `# Before the first start:  mkdir -p ${data}/{torrents/{movies,tv},usenet/{incomplete,complete/{movies,tv}},media/{movies,tv}} ${cfg}`,
      `#                          chown -R ${o.puid}:${o.pgid} ${data} ${cfg}`,
      `# Deploy: Portainer → Stacks → Add stack, ArrHub → Docker → Compose stacks, or  docker compose up -d`,
      '',
      ...(o.project ? [`name: ${yq(o.project)}`, ''] : []),
      'services:');
    svc('radarr', ['  radarr:', '    image: lscr.io/linuxserver/radarr:latest', '    container_name: radarr', ...env(),
      '    volumes:', `      - ${cfg}/radarr:/config`, `      - ${data}:/data`, ...ports(['7878:7878']), '    restart: unless-stopped']);
    svc('sonarr', ['  sonarr:', '    image: lscr.io/linuxserver/sonarr:latest', '    container_name: sonarr', ...env(),
      '    volumes:', `      - ${cfg}/sonarr:/config`, `      - ${data}:/data`, ...ports(['8989:8989']), '    restart: unless-stopped']);
    svc('prowlarr', ['  prowlarr:', '    image: lscr.io/linuxserver/prowlarr:latest', '    container_name: prowlarr', ...env(),
      '    volumes:', `      - ${cfg}/prowlarr:/config`, ...ports(['9696:9696']), '    restart: unless-stopped']);
    svc('bazarr', ['  bazarr:', '    image: lscr.io/linuxserver/bazarr:latest', '    container_name: bazarr', ...env(),
      '    volumes:', `      - ${cfg}/bazarr:/config`, `      - ${data}/media:/data/media`, ...ports(['6767:6767']), '    restart: unless-stopped']);
    svc('nzbget', ['  nzbget:', '    image: lscr.io/linuxserver/nzbget:latest', '    container_name: nzbget',
      ...env([`NZBGET_USER=${o.nzbUser || 'nzbget'}`, 'NZBGET_PASS=change-me   # change it here or in NZBGet → Settings → Security']),
      '    # NZBGet → Settings → Paths: MainDir /data/usenet, DestDir /data/usenet/complete, InterDir /data/usenet/incomplete',
      '    volumes:', `      - ${cfg}/nzbget:/config`, `      - ${data}:/data`, ...ports(['6789:6789']), '    restart: unless-stopped']);
    svc('qbittorrent', ['  qbittorrent:', '    image: lscr.io/linuxserver/qbittorrent:latest', '    container_name: qbittorrent',
      ...env(['WEBUI_PORT=8080', 'TORRENTING_PORT=6881']),
      '    # first login: user admin, temporary password in the container log (docker logs qbittorrent)',
      '    # qBittorrent → Options → Downloads: default save path /data/torrents',
      '    volumes:', `      - ${cfg}/qbittorrent:/config`, `      - ${data}:/data`,
      '    ports:', ...(o.ports ? ['      - "8080:8080"'] : []), '      - "6881:6881"', '      - "6881:6881/udp"', '    restart: unless-stopped']);
    svc('seerr', ['  seerr:', '    image: ghcr.io/seerr-team/seerr:latest', '    container_name: seerr', '    init: true',
      `    # runs as user 1000 – ${cfg}/seerr must be writable for it`,
      '    environment:', `      - TZ=${o.tz}`, '      - LOG_LEVEL=info', '      - PORT=5055',
      '    volumes:', `      - ${cfg}/seerr:/app/config`, ...ports(['5055:5055']), '    restart: unless-stopped']);
    if (on.has('arrhub')) {
      const url = k => on.has(k) ? [`${k === 'qbittorrent' ? 'QBIT' : k.toUpperCase()}_URL=http://${k}:${PORT[k]}`] : [];
      L.push('', '  arrhub:', '    image: ghcr.io/moordrak/arrhub:latest', '    container_name: arrhub',
        '    # the addresses below are fixed here; API keys and passwords go in ArrHub → Settings',
        '    environment:', `      - TZ=${o.tz}`, `      - ARRHUB_LANG=${o.lang || 'en'}`,
        ...['radarr', 'sonarr', 'prowlarr', 'bazarr', 'nzbget', 'qbittorrent', 'seerr'].flatMap(url).map(e => `      - ${e}`),
        ...(on.has('nzbget') ? [`      - NZBGET_USER=${o.nzbUser || 'nzbget'}`] : []),
        ...(o.socket ? ['      - ARRHUB_DOCKER_URL=unix:///var/run/docker.sock'] : []),
        ...(o.socket ? ['    # Docker control: the socket is root:docker – put the docker group id of the host here (getent group docker)', '    group_add:', '      - "999"'] : []),
        '    volumes:', `      - ${cfg}/arrhub:/app/data`, ...(o.socket ? ['      - /var/run/docker.sock:/var/run/docker.sock'] : []),
        ...ports(['8686:8686']), '    restart: unless-stopped');
    }
    if (o.npm) {
      L.push('', '  npm:', '    image: jc21/nginx-proxy-manager:latest', '    container_name: nginx-proxy-manager',
        `    # admin UI on :81; proxy hosts like radarr.${o.domain || 'int'} → http://radarr:7878 (same network, no published ports needed)`,
        '    # own CA: SSL Certificates → Add → Custom certificate (certificate + key signed by your CA)',
        '    environment:', `      - TZ=${o.tz}`,
        '    volumes:', `      - ${cfg}/npm/data:/data`, `      - ${cfg}/npm/letsencrypt:/etc/letsencrypt`,
        '    ports:', '      - "80:80"', '      - "443:443"', '      - "81:81"', '    restart: unless-stopped');
    }
    return L.join('\n') + '\n';
  }

  // ---------------- Proxmox ----------------
  // variables for proxmox/arr-stack-lxc.sh (only what differs from its own defaults, except the essentials)
  function lxcVars(o) {
    o = { ...DEFAULTS, ...o };
    const v = [['PRESET', '1'], ['APPS', APPS.filter(a => o.apps.includes(a)).join(' ')]];
    const add = (k, val, def) => { if (val !== undefined && val !== null && String(val) !== '' && String(val) !== String(def ?? '')) v.push([k, String(val)]); };
    add('CTID_START', o.ctid); add('HOST_PREFIX', o.prefix);
    add('CT_STORAGE', o.storage); add('TPL_STORAGE', o.tplStorage); add('CT_BRIDGE', o.bridge, 'vmbr0'); add('CT_VLAN', o.vlan);
    v.push(['NET_MODE', o.net === 'static' ? 'static' : 'dhcp']);
    if (o.net === 'static') { add('IP_START', o.ipStart); add('CT_GW', o.gw); }
    add('CT_DNS', o.dns); add('CT_DOMAIN', o.domain);
    v.push(['UNPRIVILEGED', o.unpriv ? '1' : '0'], ['ONBOOT', o.onboot ? '1' : '0']);
    add('MEDIA_HOST_PATH', o.mediaHost);
    if (o.mediaHost) { v.push(['MEDIA_UID', String(o.puid)], ['MEDIA_GID', String(o.pgid)]); }
    add('TZ_NAME', o.tz); add('CA_FILE', o.caFile);
    if (o.apps.includes('qbittorrent')) add('QBIT_USER', o.qbUser, 'admin');
    if (o.apps.includes('nzbget')) add('NZBGET_USER', o.nzbUser, 'nzbget');
    if (o.apps.includes('arrhub')) { add('ARRHUB_USER', o.arrhubUser); add('ARRHUB_LANG', o.lang, 'en'); }
    for (const a of APPS) {
      if (!o.apps.includes(a)) continue;
      const r = o.res?.[a] || [], U = a.toUpperCase();
      ['CORES', 'RAM', 'DISK'].forEach((k, i) => add(`CT_${U}_${k}`, r[i], RES[a][i]));
    }
    return v;
  }
  // one line for the Proxmox shell: settings + the script straight from GitHub
  function lxcCommand(o) {
    const vars = lxcVars(o).map(([k, val]) => `${k}=${/^[\w./:@-]+$/.test(val) ? val : sq(val)}`).join(' ');
    return `${vars} bash -c "$(curl -fsSL ${SCRIPT_URL})"`;
  }
  // the whole script with the settings built in (they are only defaults: the script still asks, environment variables still win)
  function lxcScript(o, script, stamp = '') {
    const block = [`# ---- settings from ArrHub → Tools${stamp ? ' (' + stamp + ')' : ''}; environment variables still win ----`,
      ...lxcVars(o).map(([k, val]) => `[[ -v ${k} ]] || ${k}=${sq(val)}`), '# ----'].join('\n');
    return String(script).replace(/^# @@ARRHUB-PRESET@@.*$/m, () => block);
  }

  const ArrStack = { APPS, NAME, PORT, RES, DEFAULTS, SCRIPT_URL, genCompose, lxcVars, lxcCommand, lxcScript };
  if (typeof module === 'object' && module.exports) module.exports = ArrStack;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.ArrStack = ArrStack;

  // ---------------- UI (ArrHub → Tools) ----------------
  const $ = s => document.querySelector(s);
  const KEY = 'arrhub-tools';
  const tl = { mode: 'compose', o: null, script: null, scriptErr: null };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ mode: tl.mode, o: tl.o })); } catch {} };

  function readForm() {
    const f = $('#tlForm'), o = { ...tl.o };
    o.apps = [...f.querySelectorAll('[name=app]:checked')].map(i => i.value).filter(a => APPS.includes(a));
    o.npm = !!f.querySelector('[name=app][value=npm]')?.checked;
    f.querySelectorAll('[data-k]').forEach(el => { o[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
    o.res = {};
    f.querySelectorAll('[data-res]').forEach(el => { const [a, i] = el.dataset.res.split(':'); (o.res[a] ||= [...RES[a]])[i] = Number(el.value) || RES[a][i]; });
    return o;
  }
  function fillForm() {
    const f = $('#tlForm'), o = tl.o;
    f.querySelectorAll('[name=app]').forEach(i => { i.checked = i.value === 'npm' ? !!o.npm : o.apps.includes(i.value); });
    f.querySelectorAll('[data-k]').forEach(el => { const v = o[el.dataset.k] ?? DEFAULTS[el.dataset.k]; if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; });
  }
  function renderRes() {
    const o = tl.o, box = $('#tlRes');
    box.innerHTML = `<div class="tlres-h"><span></span><span>${t('tl.cores')}</span><span>${t('tl.ram')}</span><span>${t('tl.disk')}</span></div>` +
      APPS.filter(a => o.apps.includes(a)).map(a => {
        const r = o.res?.[a] || RES[a];
        return `<div class="tlres-r"><span>${NAME[a]}</span>${[0, 1, 2].map(i => `<input type="number" min="1" data-res="${a}:${i}" value="${r[i] ?? RES[a][i]}">`).join('')}</div>`;
      }).join('');
  }
  function warnings(o) {
    const w = [];
    if (!o.apps.length && !(tl.mode === 'compose' && o.npm)) w.push(t('tl.w.noApps'));
    if (tl.mode === 'lxc') {
      if (o.net === 'static' && !/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(o.ipStart)) w.push(t('tl.w.ip'));
      if (o.net === 'static' && !o.gw) w.push(t('tl.w.gw'));
      if (o.mediaHost && !o.mediaHost.startsWith('/')) w.push(t('tl.w.path'));
      if (o.ctid && !/^\d+$/.test(o.ctid)) w.push(t('tl.w.ctid'));
    }
    return w;
  }
  async function ensureScript() {
    if (tl.script || tl.scriptErr) return;
    try {
      const r = await fetch('/api/tools/lxc-script');
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      tl.script = await r.text();
    } catch (e) { tl.scriptErr = e.message; }
    render();
  }
  function output() {
    const o = tl.o;
    if (tl.mode === 'compose') return genCompose(o);
    if (!tl.script) return tl.scriptErr ? t('c.error', { msg: tl.scriptErr }) : t('c.loading');
    return lxcScript(o, tl.script, new Date().toLocaleString(I18N.locale));
  }
  function render() {
    if (!tl.o || !$('#tlForm')) return;
    const lxc = tl.mode === 'lxc';
    document.querySelectorAll('#tlMode button').forEach(b => b.classList.toggle('on', b.dataset.m === tl.mode));
    document.querySelectorAll('#v-tools [data-only]').forEach(el => el.classList.toggle('hidden', el.dataset.only !== tl.mode));
    $('#tlStatic').classList.toggle('hidden', !(lxc && tl.o.net === 'static'));
    if (lxc) { renderRes(); ensureScript(); }
    const w = warnings(tl.o);
    $('#tlWarn').innerHTML = w.map(x => `<div>⚠ ${x}</div>`).join('');
    $('#tlWarn').classList.toggle('hidden', !w.length);
    $('#tlCmd').textContent = lxcCommand(tl.o);
    const out = output();
    $('#tlOut').textContent = out;
    $('#tlLines').textContent = t('tl.lines', { n: out.split('\n').length - 1 });
    $('#tlFile').textContent = lxc ? 'arr-stack-lxc.sh' : 'docker-compose.yml';
    $('#tlDeploy').classList.toggle('hidden', lxc || !window.dockerReady?.());
  }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast(t('set.copied'));
    if (btn) { btn.classList.add('ok'); setTimeout(() => btn.classList.remove('ok'), 1200); }
  }
  function download() {
    const lxc = tl.mode === 'lxc', text = output();
    if (lxc && !tl.script) return toast(t('c.loading'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: lxc ? 'text/x-shellscript' : 'text/yaml' }));
    a.download = lxc ? 'arr-stack-lxc.sh' : 'docker-compose.yml';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function deploy() {
    // open the generated file in Docker → Compose stacks (nothing is started before Check / Deploy there)
    if (typeof window.openStackWith === 'function') window.openStackWith(tl.o.project || 'arr', genCompose(tl.o));
  }

  function init() {
    const f = $('#tlForm'); if (!f || tl.o) return;
    const s = load();
    tl.mode = s.mode === 'lxc' ? 'lxc' : 'compose';
    tl.o = { ...DEFAULTS, lang: I18N.lang, ...(s.o || {}) };
    fillForm();
    f.addEventListener('input', () => { tl.o = readForm(); save(); render(); });
    f.addEventListener('change', () => { tl.o = readForm(); save(); render(); });
    $('#tlMode').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; tl.mode = b.dataset.m; save(); render(); });
    $('#tlCopy').onclick = e => (tl.mode === 'lxc' && !tl.script) ? toast(t('c.loading')) : copy(output(), e.currentTarget);
    $('#tlCmdCopy').onclick = e => copy($('#tlCmd').textContent, e.currentTarget);
    $('#tlDownload').onclick = download;
    $('#tlDeploy').onclick = deploy;
    $('#tlReset').onclick = () => { tl.o = { ...DEFAULTS, lang: I18N.lang }; fillForm(); save(); render(); };
  }
  window.Tools = { show() { init(); render(); }, render, state: tl };
})();
