// Container terminal: docker exec with a TTY, attached over a WebSocket
'use strict';

const crypto_ = require('crypto');
const http_ = require('http');
const https_ = require('https');
const { T } = require('../i18n');
const { friendlyError } = require('../about');
const { dockerTarget, dockerErr, sshStream, sshMessage, dockerApi, enc } = require('./api');

// ---- terminal: docker exec with a TTY, attached over a WebSocket ----
// raw stream to the daemon (HTTP upgrade / hijack) over the same transport as every other call
function dockerHijack(p, body) {
  const target = dockerTarget();
  return new Promise((resolve, reject) => {
    if (!target) return reject(dockerErr(T('dockerNotConfigured')));
    const isTls = !!target.url && target.url.protocol === 'https:';
    const base = target.url ? target.url.pathname.replace(/\/+$/, '') : '';
    const payload = Buffer.from(JSON.stringify(body));
    const o = { method: 'POST', path: base + p, headers: { Host: target.url ? target.url.host : 'docker', 'Content-Type': 'application/json', 'Content-Length': payload.length, Connection: 'Upgrade', Upgrade: 'tcp' } };
    let sock = null;
    if (target.ssh) o.createConnection = () => (sock = sshStream(target.ssh));
    else if (target.socketPath) o.socketPath = target.socketPath;
    else { o.hostname = target.url.hostname; o.port = target.url.port || (isTls ? 443 : 80); if (isTls) Object.assign(o, target.tls); }
    const r = (isTls ? https_ : http_).request(o);
    const tm = setTimeout(() => { r.destroy(); reject(dockerErr(T('netTimeout'))); }, 20000);
    r.on('upgrade', (res, socket, head) => { clearTimeout(tm); if (head?.length) socket.unshift(head); resolve(socket); });
    r.on('response', res => {
      clearTimeout(tm);
      let b = ''; res.on('data', d => { b += d; }); res.on('end', () => {
        if (res.statusCode === 403 && !/^\s*\{/.test(b)) return reject(dockerErr(T('dockerForbiddenVar', { what: 'POST ' + p, vars: 'EXEC=1 + POST=1' })));
        let m = b; try { m = JSON.parse(b).message || b; } catch {}
        reject(dockerErr(String(m).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || `HTTP ${res.statusCode}`));
      });
    });
    r.on('error', e => { clearTimeout(tm); reject(target.ssh ? dockerErr(sshMessage(sock?.sshErr(), sock?.spawnErr || e)) : Object.assign(new TypeError('fetch failed'), { cause: e })); });
    r.end(payload);
  });
}
// minimal WebSocket (RFC 6455) – server side only, no extensions
const EventEmitter_ = require('events');
function wsAccept(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return null; }
  const accept = crypto_.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay?.(true);
  const ws = new EventEmitter_();
  let buf = Buffer.alloc(0), frag = null, fragBin = false, closed = false;
  const frame = (op, p) => {
    const n = p.length;
    const h = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const x = Buffer.alloc(10); x[0] = 0x80 | op; x[1] = 127; x.writeBigUInt64BE(BigInt(n), 2); return x; })();
    return Buffer.concat([h, p]);
  };
  ws.send = (data, binary) => { if (!closed && socket.writable) socket.write(frame(binary ? 2 : 1, Buffer.isBuffer(data) ? data : Buffer.from(String(data)))); };
  ws.close = (code = 1000) => { if (closed) return; closed = true; try { socket.end(frame(8, Buffer.from([code >> 8, code & 255]))); } catch {} ws.emit('close'); };
  const feed = chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 4 * 1024 * 1024) return ws.close(1009);
      const mOff = off; if (masked) off += 4;
      if (buf.length < off + len) return;
      let pl = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < pl.length; i++) pl[i] ^= buf[mOff + (i & 3)];
      buf = buf.subarray(off + len);
      if (op === 8) return ws.close();
      if (op === 9) { socket.write(frame(10, pl)); continue; }
      if (op === 10) continue;
      if (op === 0) { frag = Buffer.concat([frag || Buffer.alloc(0), pl]); if (fin) { ws.emit('message', frag, fragBin); frag = null; } continue; }
      if (!fin) { frag = pl; fragBin = op === 2; continue; }
      ws.emit('message', pl, op === 2);
    }
  };
  socket.on('data', feed);
  socket.on('close', () => { if (!closed) { closed = true; ws.emit('close'); } });
  socket.on('error', () => {});
  if (head?.length) feed(head);
  return ws;
}
async function dockerTerminal(ws, id, cols, rows) {
  let sock = null, execId = null, name = id;
  const say = (msg, color = 31) => ws.send(`\r\n\x1b[${color}m${msg}\x1b[0m\r\n`, true);
  const resize = (c, r) => {
    c = Math.max(10, Math.min(500, Number(c) || 80)); r = Math.max(4, Math.min(200, Number(r) || 24));
    if (execId) dockerApi('POST', `/exec/${execId}/resize?h=${r}&w=${c}`).catch(() => {});
  };
  ws.on('close', () => { try { sock?.destroy(); } catch {} if (execId) console.log(`docker: terminal closed – ${name}`); });
  try {
    const ins = await dockerApi('GET', `/containers/${enc(id)}/json`);
    name = ins.Name.replace(/^\//, '');
    if (!ins.State.Running) { say(T('termNotRunning')); return ws.close(); }
    const ex = await dockerApi('POST', `/containers/${ins.Id}/exec`, { body: {
      AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true,
      Env: ['TERM=xterm-256color', `COLUMNS=${cols}`, `LINES=${rows}`],
      // bash when the image has it, otherwise sh
      Cmd: ['/bin/sh', '-c', 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'],
    } });
    execId = ex.Id;
    sock = await dockerHijack(`/exec/${execId}/start`, { Detach: false, Tty: true });
    console.log(`docker: terminal opened – ${name}`);
    let first = true;
    sock.on('data', d => {
      ws.send(d, true);
      if (first) { first = false; if (/exec: "\/bin\/sh": stat \/bin\/sh: no such file|executable file not found/.test(d.toString())) say(T('termNoShell'), 33); }
    });
    sock.on('end', () => { say(T('termEnded'), 90); ws.close(); });
    sock.on('error', () => ws.close());
    ws.on('message', (data, bin) => {
      if (bin) return sock.writable && sock.write(data);
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      if (m.t === 'resize') resize(m.cols, m.rows);
      else if (m.t === 'in' && typeof m.d === 'string' && sock.writable) sock.write(m.d);
    });
    resize(cols, rows);
  } catch (e) {
    say(friendlyError(e)); ws.close();
  }
}

module.exports = { wsAccept, dockerTerminal };
