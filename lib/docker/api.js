// Docker Engine API transport: socket proxy, TLS, unix socket or SSH
'use strict';

const fs = require('fs');
const path = require('path');
const crypto_ = require('crypto');
const tls_ = require('tls');
const http_ = require('http');
const https_ = require('https');
const { T } = require('../i18n');
const config = require('../config');
const { MASK, parseCa, CONFIG_FILE } = config;

// ---------- Docker (Engine API) ----------
// Talks to the Docker daemon on the Docker host – normally through a socket proxy (http://host:2375),
// or directly over TLS with client certificates (https://host:2376), or a local unix socket.
const os_ = require('os');
const dockerOn = () => !!config.cfg.docker?.url;
function dockerTarget(d = config.cfg.docker || {}) {
  const raw = String(d.url || '').trim();
  if (!raw) return null;
  if (/^unix:\/\//i.test(raw) || raw.startsWith('/')) return { socketPath: raw.replace(/^unix:\/\//i, '') };
  if (/^ssh:\/\//i.test(raw)) {
    const u = new URL(raw);
    return { ssh: { user: decodeURIComponent(u.username || ''), host: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || '', key: d.sshKey && d.sshKey !== MASK ? d.sshKey : '' } };
  }
  const url = new URL(raw.replace(/^tcp:\/\//i, d.cert ? 'https://' : 'http://'));
  const tls = url.protocol === 'https:' ? {
    ...(d.ca ? { ca: [...tls_.rootCertificates, ...(parseCa(d.ca).pem)] } : config.caState?.pem?.length ? { ca: [...tls_.rootCertificates, ...config.caState.pem] } : {}),
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
// the socket for one Docker API request over ssh. The ssh process may exit before the last bytes of its output
// have been read (Node then destroys its stdin at once), so the stream ends only when stdout has ended – never
// because the process exited – and writes after that are dropped instead of failing the request.
class SshSocket extends Duplex {
  constructor(child) {
    super({ allowHalfOpen: true });
    this.child = child; this.err = '';
    child.stdout.on('data', b => { if (!this.push(b)) child.stdout.pause(); });
    child.stdout.on('end', () => this.push(null));
    child.stdout.on('error', () => this.push(null));
    child.stdin.on('error', () => {});                      // EPIPE once the remote side is gone
    child.stderr.on('data', b => { this.err = (this.err + b).slice(-4000); });
    child.on('error', e => { this.spawnErr = e; this.destroy(e); });   // e.g. no ssh client installed
  }
  sshErr() { return this.err; }
  _read() { this.child.stdout.resume(); }
  _write(chunk, enc, cb) { const i = this.child.stdin; if (i.destroyed || !i.writable) return cb(); i.write(chunk, () => cb()); }
  _final(cb) { try { this.child.stdin.end(); } catch {} cb(); }
  _destroy(err, cb) { try { this.child.kill(); } catch {} cb(err); }
  setTimeout() { return this; } setNoDelay() { return this; } setKeepAlive() { return this; } ref() { return this; } unref() { return this; }
}
function sshStream(t) {
  return new SshSocket(spawn('ssh', sshArgs(t, { shared: !t.test }), { stdio: ['pipe', 'pipe', 'pipe'] }));
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
    const key = config.cfg.docker?.sshKey;
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
  if (/^\/containers\/[^/]+\/logs$/.test(path)) return 'ALLOW_LOGS=1';   // linuxserver socket-proxy: logs have their own switch
  if (/^\/containers\/[^/]+\/exec$/.test(path) || /^\/exec\//.test(path)) return 'EXEC=1 + POST=1';   // terminal
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

module.exports = { dockerApi, enc, parseRef, refName, isSelf, dockerTarget, dockerErr, sshStream, sshMessage, dockerOn, sshKeygen, sshPublic };
