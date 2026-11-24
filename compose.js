// ArrHub — docker-compose support without the docker CLI: a small YAML parser and
// a translator from a compose file to Docker Engine API requests (one container per service).
'use strict';
const crypto = require('crypto');

class YamlError extends Error { constructor(msg, line) { super(line ? `line ${line}: ${msg}` : msg); this.line = line; } }

// ---------------- YAML (the subset compose files use) ----------------
// block maps and sequences, plain / quoted / block (| >) scalars, flow [..] {..}, anchors, aliases, << merge
function parseYaml(src) {
  const raw = String(src).replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
  const anchors = {};
  let i = 0;
  const ind = s => s.length - s.trimStart().length;
  const blank = s => { const t = s.trim(); return !t || t.startsWith('#'); };
  // the line content without a trailing comment (a # at the start or after whitespace, outside quotes)
  function stripComment(s) {
    let q = null;
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (q) { if (ch === '\\' && q === '"') k++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { if (k === 0 || /[\s[{,:-]/.test(s[k - 1])) q = ch; continue; }
      if (ch === '#' && (k === 0 || /\s/.test(s[k - 1]))) return s.slice(0, k).trimEnd();
    }
    return s.trimEnd();
  }
  // virtual lines: a sequence item "- a: 1" is re-read as "a: 1" at a deeper indent
  let over = null;   // {line, indent, text}
  function skip() { while (i < raw.length && blank(raw[i]) && !(over && over.line === i)) i++; }
  function cur() {
    skip();
    if (i >= raw.length) return null;
    if (over && over.line === i) return over;
    if (/^(---|\.\.\.)\s*$/.test(raw[i].trim()) && ind(raw[i]) === 0) { i++; return cur(); }
    return { line: i, indent: ind(raw[i]), text: stripComment(raw[i].trim()) };
  }
  const next = () => { over = null; i++; };
  const KEY = /^((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^']|'')*')|(?:[^\s"'#\-[\]{},&*!|>%@`?][^#]*?|-[^\s#][^#]*?|\?[^\s][^#]*?))\s*:(?:\s+(.*)|)$/;
  function keyOf(text) {
    if (text.startsWith('- ') || text === '-') return null;
    const m = KEY.exec(text);
    if (!m) return null;
    // "a:b" is a plain scalar, but a flow/quoted start is never a key here
    return { key: unq(m[1]), rest: (m[2] || '').trim() };
  }
  const unq = k => k.startsWith('"') ? dq(k.slice(1, -1)) : k.startsWith("'") ? k.slice(1, -1).replace(/''/g, "'") : k;
  function dq(s) {
    return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, e) => {
      const m = { n: '\n', t: '\t', r: '\r', 0: '\0', '"': '"', '\\': '\\', '/': '/', ' ': ' ', e: '\x1b', b: '\b', f: '\f', a: '\x07', v: '\v', N: '\x85', _: '\xa0' }[e];
      if (m !== undefined) return m;
      if (/^[xuU]/.test(e)) return String.fromCodePoint(parseInt(e.slice(1), 16));
      return '\\' + e;
    });
  }
  function scalar(s, line) {
    if (s === '' || s === '~' || /^null$/i.test(s)) return null;
    if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
    if (/^[-+]?\d+$/.test(s)) { const n = Number(s); return Number.isSafeInteger(n) ? n : s; }
    if (/^0o[0-7]+$/.test(s)) return parseInt(s.slice(2), 8);
    if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
    if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
    if (/^[-+]?\.inf$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
    if (/^\.nan$/i.test(s)) return NaN;
    if (s.startsWith('*')) { const a = s.slice(1); if (!(a in anchors)) throw new YamlError(`unknown alias *${a}`, line + 1); return clone(anchors[a]); }
    return s;
  }
  const clone = v => v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  // flow collections may continue on the next lines until the brackets balance
  function flow(text, line) {
    let s = text;
    const balanced = t => { let d = 0, q = null; for (let k = 0; k < t.length; k++) { const c = t[k]; if (q) { if (c === '\\' && q === '"') k++; else if (c === q) q = null; } else if ((c === '"' || c === "'") && /[[{,:\s]/.test(t.slice(0, k).trimEnd().slice(-1) || '[')) q = c; else if ('[{'.includes(c)) d++; else if (']}'.includes(c)) d--; } return d <= 0; };
    // comments are stripped over the joined text, so a "#" inside a multi-line quoted string survives
    const strip = t => { let o = '', q = null; for (let k = 0; k < t.length; k++) { const c = t[k]; if (q) { if (c === '\\' && q === '"') { o += c + (t[k + 1] || ''); k++; continue; } if (c === q) q = null; o += c; continue; } if ((c === '"' || c === "'") && /[[{,:\s]/.test(o.trimEnd().slice(-1) || '[')) q = c; if (c === '#' && (!o || /\s/.test(o.slice(-1)))) { while (k < t.length && t[k] !== '\n') k++; o += '\n'; continue; } o += c; } return o; };
    let acc = s;
    while (!balanced(s = strip(acc))) { next(); if (i >= raw.length) throw new YamlError('unclosed [ or {', line + 1); acc += '\n' + raw[i].trim(); }
    const fold = t => t.replace(/[ \t]*(?:\n[ \t]*)+/g, m => { const n = m.split('\n').length - 1; return n === 1 ? ' ' : '\n'.repeat(n - 1); });
    let p = 0;
    const ws = () => { while (p < s.length && /[\s]/.test(s[p])) p++; };
    function val() {
      ws();
      const c = s[p];
      if (c === '[') { p++; const a = []; ws(); if (s[p] === ']') { p++; return a; } for (;;) { a.push(val()); ws(); if (s[p] === ',') { p++; ws(); if (s[p] === ']') { p++; return a; } continue; } if (s[p] === ']') { p++; return a; } throw new YamlError(`expected , or ] in flow list`, line + 1); } }
      if (c === '{') { p++; const o = {}; ws(); if (s[p] === '}') { p++; return o; } for (;;) { const k = val(); ws(); let v = null; if (s[p] === ':') { p++; v = val(); } o[String(k)] = v; ws(); if (s[p] === ',') { p++; ws(); if (s[p] === '}') { p++; return o; } continue; } if (s[p] === '}') { p++; return o; } throw new YamlError(`expected , or } in flow map`, line + 1); } }
      if (c === '"') { let e = p + 1; while (e < s.length && s[e] !== '"') { if (s[e] === '\\') e++; e++; } const r = dq(fold(s.slice(p + 1, e))); p = e + 1; return r; }
      if (c === "'") { let e = p + 1; for (; e < s.length; e++) { if (s[e] === "'") { if (s[e + 1] === "'") { e++; continue; } break; } } const r = fold(s.slice(p + 1, e)).replace(/''/g, "'"); p = e + 1; return r; }
      let e = p;
      while (e < s.length && !',]}'.includes(s[e]) && !(s[e] === ':' && /[\s,\]}]/.test(s[e + 1] || ' '))) e++;
      const r = scalar(fold(s.slice(p, e)).trim(), line); p = e; return r;
    }
    const v = val(); ws();
    if (p < s.length) throw new YamlError(`unexpected "${s.slice(p, p + 10)}" after ${s[0] === '[' ? ']' : '}'}`, line + 1);
    next();
    return v;
  }
  function blockScalar(head, parentIndent, line) {
    const m = /^([|>])([+-]?)(\d?)([+-]?)$/.exec(head);
    const fold = m[1] === '>', chomp = m[2] || m[4] || '';
    next();
    const lines = [];
    let bi = m[3] ? parentIndent + Number(m[3]) : null;
    while (i < raw.length) {
      const l = raw[i];
      if (!l.trim()) { lines.push(''); i++; continue; }
      if (bi === null) bi = ind(l);
      if (ind(l) < bi || ind(l) <= parentIndent) break;
      lines.push(l.slice(bi)); i++;
    }
    let trail = 0; while (lines.length && lines[lines.length - 1] === '') { lines.pop(); trail++; }
    let out;
    if (!fold) out = lines.join('\n');
    else {
      out = ''; let prevMore = false;
      lines.forEach((l, k) => {
        const more = /^\s/.test(l);
        if (k === 0) out = l;
        else if (l === '') out += '\n';
        else if (more || prevMore || out.endsWith('\n')) out += (out.endsWith('\n') ? '' : '\n') + l;
        else out += ' ' + l;
        prevMore = more;
      });
    }
    if (chomp === '-') return out;
    if (chomp === '+') return out + '\n' + '\n'.repeat(trail);
    return lines.length ? out + '\n' : '';
  }
  // a value written after "key:" or "- " on the same line
  function inline(rest, parentIndent, line) {
    let anchor = null;
    const am = /^&([^\s]+)\s*(.*)$/.exec(rest);
    if (am) { anchor = am[1]; rest = am[2]; }
    if (rest.startsWith('!')) rest = rest.replace(/^!\S*\s*/, '');   // tags are ignored
    let v;
    if (rest === '') {
      next();
      const n = cur();
      if (n && (n.indent > parentIndent || (n.indent === parentIndent && (n.text === '-' || n.text.startsWith('- '))))) v = node(n.indent);
      else v = null;
    } else if (/^[|>]/.test(rest)) v = blockScalar(rest, parentIndent, line);
    else if (rest[0] === '[' || rest[0] === '{') v = flow(rest, line);
    else if (rest[0] === '"' || rest[0] === "'") {
      const q = rest[0];
      let s = rest;
      const closed = t => { if (q === "'") return /^'(?:[^']|'')*'\s*$/.test(t); return /^"(?:[^"\\]|\\.)*"\s*$/.test(t); };
      // a quoted scalar may span lines (folded with spaces)
      while (!closed(s)) {
        next();
        if (i >= raw.length) throw new YamlError(`unclosed ${q}`, line + 1);
        const t = raw[i].trim();
        s += t ? (s.endsWith('\\') && q === '"' ? t : s.endsWith('\n') ? t : ' ' + t) : '\n';
        if (closed(stripComment(s))) { s = stripComment(s); break; }
      }
      v = q === '"' ? dq(s.trim().slice(1, -1)) : s.trim().slice(1, -1).replace(/''/g, "'");
      next();
    } else {
      // plain scalar, possibly continued on more indented lines
      let s = rest;
      next();
      for (;;) {
        const n = cur();
        if (!n || n.indent <= parentIndent || keyOf(n.text) || n.text.startsWith('- ')) break;
        s += ' ' + n.text; next();
      }
      v = scalar(s, line);
    }
    if (anchor) anchors[anchor] = clone(v);
    return v;
  }
  function node(indent) {
    const n = cur();
    if (!n) return null;
    if (n.text === '-' || n.text.startsWith('- ')) {
      const a = [];
      for (;;) {
        const c = cur();
        if (!c || c.indent !== indent || !(c.text === '-' || c.text.startsWith('- '))) { if (c && c.indent > indent) throw new YamlError('bad indentation', c.line + 1); break; }
        const rest = c.text === '-' ? '' : c.text.slice(2).trimStart();
        if (rest && (keyOf(rest) || rest.startsWith('- ')) && !/^&\S+\s*$/.test(rest)) {
          // "- key: value" → a map (or nested list) starting at the item's content column
          const col = c.indent + (c.text.length - rest.length);
          over = { line: c.line, indent: col, text: rest };
          a.push(node(col));
        } else a.push(inline(rest, indent, c.line));
      }
      return a;
    }
    const k0 = keyOf(n.text);
    if (!k0) { const v = inline(n.text, indent - 1, n.line); return v; }
    const o = {}, merges = [];
    for (;;) {
      const c = cur();
      if (!c || c.indent < indent) break;
      if (c.indent > indent) throw new YamlError('bad indentation', c.line + 1);
      const kv = keyOf(c.text);
      if (!kv) { if (c.text === '-' || c.text.startsWith('- ')) break; throw new YamlError(`expected "key: value", got "${c.text.slice(0, 40)}"`, c.line + 1); }
      const v = inline(kv.rest, indent, c.line);
      if (kv.key === '<<') merges.push(...(Array.isArray(v) ? v : [v]));
      else { if (Object.prototype.hasOwnProperty.call(o, kv.key)) throw new YamlError(`duplicate key "${kv.key}"`, c.line + 1); o[kv.key] = v; }
    }
    if (merges.length) { const m = {}; for (const x of merges) if (x && typeof x === 'object' && !Array.isArray(x)) Object.assign(m, x); return Object.assign(m, o); }
    return o;
  }
  const first = cur();
  if (!first) return null;
  const doc = node(first.indent);
  const left = cur();
  if (left) throw new YamlError(`unexpected "${left.text.slice(0, 40)}" (check the indentation)`, left.line + 1);
  return doc;
}

// ---------------- .env + ${VAR} interpolation ----------------
function parseEnv(text) {
  const env = {};
  String(text || '').replace(/\r/g, '').split('\n').forEach(l => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(l);
    if (!m || l.trim().startsWith('#')) return;
    let v = m[2].trim();
    if (/^"(.*)"$/.test(v)) v = v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    else if (/^'(.*)'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    env[m[1]] = v;
  });
  return env;
}
function interpolate(v, env, missing, errors) {
  if (typeof v === 'string') return sub(v);
  if (Array.isArray(v)) return v.map(x => interpolate(x, env, missing, errors));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, interpolate(x, env, missing, errors)]));
  return v;
  function sub(s) {
    let out = '';
    for (let k = 0; k < s.length; k++) {
      if (s[k] !== '$') { out += s[k]; continue; }
      if (s[k + 1] === '$') { out += '$'; k++; continue; }
      if (s[k + 1] === '{') {
        let d = 1, e = k + 2;
        for (; e < s.length && d; e++) { if (s[e] === '{') d++; else if (s[e] === '}') d--; }
        if (d) { out += s.slice(k); break; }
        const body = s.slice(k + 2, e - 1);
        const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])([\s\S]*))?$/.exec(body);
        if (!m) { errors.push(`invalid variable \${${body}}`); k = e - 1; continue; }
        const [, name, op, arg = ''] = m, has = Object.prototype.hasOwnProperty.call(env, name), val = env[name];
        const set = op && op.startsWith(':') ? has && val !== '' : has;
        if (!op) { if (!has) missing.add(name); out += has ? val : ''; }
        else if (op.endsWith('-')) out += set ? val : sub(arg);
        else if (op.endsWith('+')) out += set ? sub(arg) : '';
        else if (op.endsWith('?')) { if (!set) errors.push(`${name}: ${sub(arg) || 'required variable is missing'}`); out += set ? val : ''; }
        k = e - 1; continue;
      }
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(k + 1));
      if (m) { const name = m[0]; if (!(name in env)) missing.add(name); out += env[name] ?? ''; k += name.length; continue; }
      out += '$';
    }
    return out;
  }
}

// ---------------- compose → Engine API ----------------
const str = v => v === null || v === undefined ? '' : typeof v === 'boolean' ? String(v) : String(v);
const list = v => v == null ? [] : Array.isArray(v) ? v : [v];
function kvList(v, sep = '=') {   // map or ["k=v"] → [[k, v|null]]
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(x => { const s = str(x), p = s.indexOf(sep); return p < 0 ? [s, null] : [s.slice(0, p), s.slice(p + 1)]; });
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => [k, x === null ? null : str(x)]);
  throw new Error('expected a list or a map');
}
function shellSplit(s) {
  const out = []; let cur = '', q = null, has = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (q === '"') { if (c === '"') q = null; else if (c === '\\' && '"\\$`'.includes(s[k + 1])) cur += s[++k]; else cur += c; continue; }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\' && k + 1 < s.length) { cur += s[++k]; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
    cur += c;
  }
  if (q) throw new Error(`unclosed quote in "${s}"`);
  if (cur || has) out.push(cur);
  return out;
}
const cmd = v => v == null ? undefined : Array.isArray(v) ? v.map(str) : shellSplit(str(v));
function duration(v, what) {   // → nanoseconds
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return Math.round(v * 1e9);
  const s = String(v).trim(); let ns = 0, m, rest = s;
  const U = { h: 3600e9, m: 60e9, s: 1e9, ms: 1e6, us: 1e3, 'µs': 1e3, ns: 1 };
  const re = /^(\d+(?:\.\d+)?)(ms|us|µs|ns|h|m|s)/;
  if (!rest) return undefined;
  while (rest && (m = re.exec(rest))) { ns += Number(m[1]) * U[m[2]]; rest = rest.slice(m[0].length); }
  if (rest) throw new Error(`${what}: "${s}" is not a duration (e.g. 30s, 1m30s)`);
  return Math.round(ns);
}
function bytes(v, what) {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return Math.round(v);
  const m = /^(\d+(?:\.\d+)?)\s*([bkmgt]?)(?:i?b)?$/i.exec(String(v).trim());
  if (!m) throw new Error(`${what}: "${v}" is not a size (e.g. 512m, 2g)`);
  return Math.round(Number(m[1]) * { '': 1, b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }[m[2].toLowerCase()]);
}
function ports(svc, v) {   // → { exposed: {"80/tcp":{}}, bind: {"80/tcp":[{HostIp,HostPort}]} }
  const exposed = {}, bind = {};
  const range = s => { const m = /^(\d+)(?:-(\d+))?$/.exec(s); if (!m) throw new Error(`${svc}: bad port "${s}"`); const a = Number(m[1]), b = Number(m[2] || m[1]); if (b < a || b - a > 1000) throw new Error(`${svc}: bad port range "${s}"`); return Array.from({ length: b - a + 1 }, (_, k) => a + k); };
  for (const p of list(v)) {
    let ip = '', host = '', cont, proto = 'tcp';
    if (p && typeof p === 'object') {
      cont = str(p.target); host = p.published == null ? '' : str(p.published); proto = p.protocol || 'tcp'; ip = p.host_ip || '';
    } else {
      let s = str(p);
      const sl = s.lastIndexOf('/'); if (sl > 0) { proto = s.slice(sl + 1); s = s.slice(0, sl); }
      let m;
      if ((m = /^\[([^\]]+)\]:(.*)$/.exec(s))) { ip = m[1]; s = m[2]; const parts = s.split(':'); host = parts.length > 1 ? parts[0] : ''; cont = parts[parts.length - 1]; }
      else { const parts = s.split(':'); if (parts.length > 3) throw new Error(`${svc}: bad port "${p}"`); cont = parts.pop(); host = parts.pop() || ''; ip = parts.pop() || ''; }
    }
    if (!/^(tcp|udp|sctp)$/.test(proto)) throw new Error(`${svc}: bad port protocol "${proto}"`);
    const cs = range(cont), hs = host ? range(host) : null;
    if (hs && hs.length !== cs.length && hs.length !== 1) throw new Error(`${svc}: port ranges "${host}" and "${cont}" differ in size`);
    cs.forEach((c, k) => {
      const key = `${c}/${proto}`; exposed[key] = {};
      (bind[key] ||= []).push({ HostIp: ip, HostPort: hs ? String(hs.length === 1 && cs.length > 1 ? hs[0] + k : hs[k] ?? hs[0]) : '' });
    });
  }
  return { exposed, bind };
}
const isPath = s => /^(\/|\.{1,2}(\/|$)|~)/.test(s) || /^[A-Za-z]:[\\/]/.test(s);
function restartPolicy(svc, v, deploy) {
  if (v == null && deploy?.restart_policy) {
    const c = deploy.restart_policy.condition || 'any';
    return { Name: { any: 'always', none: 'no', 'on-failure': 'on-failure' }[c] || 'no', MaximumRetryCount: Number(deploy.restart_policy.max_attempts) || 0 };
  }
  if (v == null || v === false || v === 'no') return { Name: 'no' };
  const m = /^(always|unless-stopped|on-failure)(?::(\d+))?$/.exec(str(v));
  if (!m) throw new Error(`${svc}: restart must be no, always, unless-stopped or on-failure`);
  return { Name: m[1], MaximumRetryCount: Number(m[2]) || 0 };
}
const SERVICE_KEYS = new Set(['image', 'container_name', 'command', 'entrypoint', 'environment', 'env_file', 'ports', 'expose', 'volumes', 'tmpfs', 'restart', 'labels',
  'networks', 'network_mode', 'depends_on', 'hostname', 'domainname', 'user', 'working_dir', 'privileged', 'cap_add', 'cap_drop', 'devices', 'dns', 'dns_search', 'dns_opt',
  'extra_hosts', 'shm_size', 'mem_limit', 'memswap_limit', 'mem_reservation', 'cpus', 'cpu_shares', 'cpuset', 'pids_limit', 'security_opt', 'sysctls', 'ulimits', 'stop_signal',
  'stop_grace_period', 'tty', 'stdin_open', 'init', 'healthcheck', 'logging', 'group_add', 'ipc', 'pid', 'runtime', 'read_only', 'deploy', 'gpus', 'platform', 'pull_policy',
  'profiles', 'links', 'mac_address', 'oom_score_adj', 'volumes_from', 'userns_mode', 'cgroup_parent', 'device_cgroup_rules', 'scale', 'build', 'storage_opt', 'annotations', 'attach', 'uts']);

/**
 * Translate a compose file into what has to be created.
 * returns { project, services:[{service, container, image, pull, body, connect:[{network, cfg}], deps:[{service, condition}], hash, nameExplicit}],
 *           networks:[{key, name, external, body}], volumes:[{key, name, external, body}], warnings:[], skipped:[] }
 */
function plan(yml, envText, project, stackEnvAll) {
  const warnings = [], skipped = [];
  let doc;
  try { doc = parseYaml(yml); } catch (e) { throw Object.assign(new Error(`YAML: ${e.message}`), { line: e.line }); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('the file must be a compose map with "services:"');
  const env = { ...parseEnv(envText) };
  const missing = new Set(), ierr = [];
  doc = interpolate(doc, env, missing, ierr);
  if (ierr.length) throw new Error(ierr.join('; '));
  if (missing.size) warnings.push(`variables not set (empty): ${[...missing].join(', ')}`);
  const services = doc.services;
  if (!services || typeof services !== 'object' || Array.isArray(services) || !Object.keys(services).length) throw new Error('no services: found');
  for (const k of Object.keys(doc)) if (!['version', 'name', 'services', 'networks', 'volumes', 'secrets', 'configs'].includes(k) && !k.startsWith('x-')) warnings.push(`top-level "${k}" is ignored`);
  if (doc.secrets || doc.configs) warnings.push('secrets and configs are not supported – mount the files with volumes');
  const P = project;
  const L = (extra = {}) => ({ 'com.docker.compose.project': P, ...extra });

  // networks
  const nets = {};
  const netDef = doc.networks || {};
  if (typeof netDef !== 'object' || Array.isArray(netDef)) throw new Error('networks: must be a map');
  const needNet = key => {
    if (nets[key]) return nets[key];
    const d = netDef[key] || (key === 'default' ? {} : null);
    if (d === null && !(key in netDef)) throw new Error(`network "${key}" is used but not defined under networks:`);
    const n = d || {};
    const ext = n.external === true || (n.external && typeof n.external === 'object');
    const name = ext ? (n.external?.name || n.name || key) : (n.name || `${P}_${key}`);
    const ipam = n.ipam ? { Driver: n.ipam.driver || 'default', Config: list(n.ipam.config).map(c => ({ Subnet: c.subnet, Gateway: c.gateway, IPRange: c.ip_range, AuxiliaryAddresses: c.aux_addresses })), Options: n.ipam.options } : undefined;
    return (nets[key] = { key, name, external: ext, body: ext ? null : clean({ Name: name, Driver: n.driver || 'bridge', Internal: !!n.internal, Attachable: !!n.attachable, EnableIPv6: !!n.enable_ipv6, Options: n.driver_opts, IPAM: ipam, Labels: { ...Object.fromEntries(kvList(n.labels).map(([k, v]) => [k, v ?? ''])), ...L({ 'com.docker.compose.network': key }) } }) });
  };
  // volumes
  const vols = {};
  const volDef = doc.volumes || {};
  const needVol = key => {
    if (vols[key]) return vols[key];
    if (!(key in volDef)) throw new Error(`volume "${key}" is used but not defined under volumes: (or write a path, e.g. ./${key} or /data/${key})`);
    const v = volDef[key] || {};
    const ext = v.external === true || (v.external && typeof v.external === 'object');
    const name = ext ? (v.external?.name || v.name || key) : (v.name || `${P}_${key}`);
    return (vols[key] = { key, name, external: ext, body: ext ? null : clean({ Name: name, Driver: v.driver || 'local', DriverOpts: v.driver_opts, Labels: { ...Object.fromEntries(kvList(v.labels).map(([k, x]) => [k, x ?? ''])), ...L({ 'com.docker.compose.volume': key }) } }) });
  };

  const names = {};
  for (const [svc, s] of Object.entries(services)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(svc)) throw new Error(`service name "${svc}" is not valid`);
    if (!s || typeof s !== 'object') throw new Error(`${svc}: must be a map`);
    names[svc] = s.container_name ? str(s.container_name) : `${P}-${svc}-1`;
  }
  const out = [];
  for (const [svc, s] of Object.entries(services)) {
    if (s.profiles) { skipped.push(svc); continue; }
    const W = m => warnings.push(`${svc}: ${m}`);
    for (const k of Object.keys(s)) if (!SERVICE_KEYS.has(k) && !k.startsWith('x-')) W(`"${k}" is not supported and is ignored`);
    if (!s.image) throw new Error(s.build ? `${svc}: build: is not supported – build the image first and set image:` : `${svc}: image: is missing`);
    if (s.build) W('build: is ignored, the image is pulled');
    if (s.scale > 1 || s.deploy?.replicas > 1) W('only one container is created (replicas / scale are ignored)');
    const image = str(s.image);
    const cname = names[svc];
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(cname)) throw new Error(`${svc}: container_name "${cname}" is not valid`);
    // environment (env_file means the stack's environment variables – that is how Portainer uses stack.env)
    const envMap = {};
    if (s.env_file) {
      Object.assign(envMap, stackEnvAll ? env : {});
      const files = list(s.env_file).map(f => typeof f === 'object' ? f.path : f);
      if (files.some(f => !/(^|\/)(stack\.env|\.env)$/.test(String(f)))) W(`env_file ${files.join(', ')}: the stack's environment variables are used instead`);
    }
    for (const [k, v] of kvList(s.environment)) { if (v === null) { if (k in env) envMap[k] = env[k]; } else envMap[k] = v; }
    // ports
    const pr = ports(svc, s.ports);
    for (const e of list(s.expose)) { const x = str(e); pr.exposed[x.includes('/') ? x : `${x}/tcp`] = {}; }
    // volumes
    const binds = [], mounts = [], anon = {}, tmpfs = {};
    for (const v of list(s.volumes)) {
      if (v && typeof v === 'object') {
        const type = v.type || (v.source ? (isPath(String(v.source)) ? 'bind' : 'volume') : 'volume');
        if (!v.target) throw new Error(`${svc}: a volume needs target:`);
        if (type === 'tmpfs') { tmpfs[v.target] = v.tmpfs?.size ? `size=${bytes(v.tmpfs.size, 'tmpfs size')}` : ''; continue; }
        let src = v.source == null ? undefined : str(v.source);
        if (type === 'bind') { if (!src || !src.startsWith('/')) throw new Error(`${svc}: bind mount "${src}" must be an absolute path on the Docker host (e.g. /srv/${svc})`); }
        else if (type === 'volume' && src) src = needVol(src).name;
        mounts.push(clean({ Type: type, Source: src, Target: v.target, ReadOnly: !!v.read_only, BindOptions: type === 'bind' ? clean({ Propagation: v.bind?.propagation, CreateMountpoint: v.bind?.create_host_path !== false ? true : undefined }) : undefined, VolumeOptions: type === 'volume' && v.volume?.nocopy ? { NoCopy: true } : undefined }));
        continue;
      }
      const sv = str(v);
      const parts = sv.split(':');
      if (/^[A-Za-z]$/.test(parts[0]) && parts.length > 2) parts.splice(0, 2, parts[0] + ':' + parts[1]);   // c:\path
      if (parts.length === 1) { anon[parts[0]] = {}; continue; }
      const [src, dst, mode] = parts;
      if (!dst?.startsWith('/')) throw new Error(`${svc}: volume "${sv}" – the path inside the container must start with /`);
      if (isPath(src)) {
        if (!src.startsWith('/')) throw new Error(`${svc}: "${src}" is a relative path – ArrHub has no folder on the Docker host, write the full path (e.g. /srv/${svc}${src.replace(/^\.\/?|^~/, '/')})`.replace(/\/\/+/g, '/'));
        binds.push(mode ? `${src}:${dst}:${mode}` : `${src}:${dst}`);
      } else binds.push(`${needVol(src).name}:${dst}${mode ? ':' + mode : ''}`);
    }
    for (const t of list(s.tmpfs)) { const [p, o] = str(t).split(':'); tmpfs[p] = o || ''; }
    // networks
    let networkMode, endpoints = [];
    if (s.network_mode) {
      const nm = str(s.network_mode);
      if (nm.startsWith('service:')) { const other = nm.slice(8); if (!names[other]) throw new Error(`${svc}: network_mode ${nm} – no such service`); networkMode = `container:${names[other]}`; }
      else networkMode = nm;
      if (s.networks) W('networks: is ignored with network_mode');
      if (s.ports && /^(container:|service:|host$|none$)/.test(nm)) { W(`ports: are ignored with network_mode ${nm} – publish them on the other service`); pr.bind = {}; }
    } else {
      const ns = s.networks == null ? { default: null } : Array.isArray(s.networks) ? Object.fromEntries(s.networks.map(n => [str(n), null])) : s.networks;
      endpoints = Object.entries(ns).map(([key, o]) => {
        const n = needNet(key);
        o = o || {};
        return { network: n.name, cfg: clean({ Aliases: [svc, ...list(o.aliases).map(str)], IPAMConfig: o.ipv4_address || o.ipv6_address ? clean({ IPv4Address: o.ipv4_address, IPv6Address: o.ipv6_address }) : undefined, Links: s.links ? list(s.links).map(l => { const [a, b] = str(l).split(':'); return `${names[a] || a}:${b || a}`; }) : undefined, MacAddress: o.mac_address }), priority: Number(o.priority) || 0 };
      }).sort((a, b) => b.priority - a.priority);
      networkMode = endpoints[0]?.network;
    }
    // depends_on
    const deps = [];
    if (s.depends_on) {
      const d = Array.isArray(s.depends_on) ? Object.fromEntries(s.depends_on.map(x => [str(x), {}])) : s.depends_on;
      for (const [o, c] of Object.entries(d)) {
        if (!services[o]) throw new Error(`${svc}: depends_on "${o}" – no such service`);
        deps.push({ service: o, condition: c?.condition || 'service_started', required: c?.required !== false });
      }
    }
    if (networkMode?.startsWith('container:')) { const other = Object.keys(names).find(k => `container:${names[k]}` === networkMode); if (other && !deps.some(d => d.service === other)) deps.push({ service: other, condition: 'service_started', required: true }); }
    // healthcheck
    let health;
    if (s.healthcheck) {
      const h = s.healthcheck;
      if (h.disable) health = { Test: ['NONE'] };
      else health = clean({ Test: h.test == null ? undefined : Array.isArray(h.test) ? h.test.map(str) : ['CMD-SHELL', str(h.test)], Interval: duration(h.interval, `${svc} healthcheck interval`), Timeout: duration(h.timeout, `${svc} healthcheck timeout`), Retries: h.retries == null ? undefined : Number(h.retries), StartPeriod: duration(h.start_period, `${svc} healthcheck start_period`), StartInterval: duration(h.start_interval, `${svc} healthcheck start_interval`) });
    }
    const lim = s.deploy?.resources?.limits || {}, res = s.deploy?.resources?.reservations || {};
    const devReq = [];
    if (s.gpus) devReq.push({ Driver: '', Count: s.gpus === 'all' ? -1 : Number(s.gpus) || -1, Capabilities: [['gpu']] });
    for (const d of list(res.devices)) devReq.push(clean({ Driver: d.driver || '', Count: d.count === 'all' ? -1 : d.count == null && !d.device_ids ? -1 : Number(d.count) || 0, DeviceIDs: d.device_ids ? list(d.device_ids).map(str) : undefined, Capabilities: [list(d.capabilities).map(str)], Options: d.options }));
    const labels = Object.fromEntries(kvList(s.labels).map(([k, v]) => [k, v ?? '']));
    const sg = s.stop_grace_period != null ? Math.round(duration(s.stop_grace_period, `${svc} stop_grace_period`) / 1e9) : undefined;
    const ul = s.ulimits ? Object.entries(s.ulimits).map(([n, v]) => typeof v === 'object' ? { Name: n, Soft: Number(v.soft), Hard: Number(v.hard) } : { Name: n, Soft: Number(v), Hard: Number(v) }) : undefined;
    const body = clean({
      Image: image, Hostname: s.hostname, Domainname: s.domainname, User: s.user == null ? undefined : str(s.user), WorkingDir: s.working_dir,
      Cmd: cmd(s.command), Entrypoint: cmd(s.entrypoint), Env: Object.entries(envMap).map(([k, v]) => `${k}=${v}`),
      Tty: !!s.tty, OpenStdin: !!s.stdin_open, StopSignal: s.stop_signal, StopTimeout: sg, Healthcheck: health,
      ExposedPorts: Object.keys(pr.exposed).length ? pr.exposed : undefined, Volumes: Object.keys(anon).length ? anon : undefined, MacAddress: s.mac_address,
      Labels: { ...labels, 'com.docker.compose.project': P, 'com.docker.compose.service': svc, 'com.docker.compose.container-number': '1', 'com.docker.compose.oneoff': 'False', 'com.docker.compose.project.config_files': `arrhub:${P}`, 'arrhub.stack': P },
      HostConfig: clean({
        Binds: binds.length ? binds : undefined, Mounts: mounts.length ? mounts : undefined, Tmpfs: Object.keys(tmpfs).length ? tmpfs : undefined,
        PortBindings: Object.keys(pr.bind).length ? pr.bind : undefined, RestartPolicy: restartPolicy(svc, s.restart, s.deploy), NetworkMode: networkMode,
        Privileged: !!s.privileged, ReadonlyRootfs: !!s.read_only, Init: s.init == null ? undefined : !!s.init, CapAdd: s.cap_add && list(s.cap_add).map(str), CapDrop: s.cap_drop && list(s.cap_drop).map(str),
        Devices: s.devices && list(s.devices).map(d => { if (typeof d === 'object') return { PathOnHost: d.source, PathInContainer: d.target || d.source, CgroupPermissions: d.permissions || 'rwm' }; const [h, c, p] = str(d).split(':'); return { PathOnHost: h, PathInContainer: c || h, CgroupPermissions: p || 'rwm' }; }),
        DeviceCgroupRules: s.device_cgroup_rules && list(s.device_cgroup_rules).map(str), DeviceRequests: devReq.length ? devReq : undefined,
        Dns: s.dns && list(s.dns).map(str), DnsSearch: s.dns_search && list(s.dns_search).map(str), DnsOptions: s.dns_opt && list(s.dns_opt).map(str),
        ExtraHosts: s.extra_hosts && kvList(s.extra_hosts, Array.isArray(s.extra_hosts) && s.extra_hosts.some(x => str(x).includes('=')) ? '=' : ':').map(([h, ip]) => `${h}:${ip}`),
        ShmSize: bytes(s.shm_size, `${svc} shm_size`), Memory: bytes(s.mem_limit ?? lim.memory, `${svc} mem_limit`), MemorySwap: bytes(s.memswap_limit, `${svc} memswap_limit`), MemoryReservation: bytes(s.mem_reservation ?? res.memory, `${svc} mem_reservation`),
        NanoCpus: s.cpus ?? lim.cpus ? Math.round(Number(s.cpus ?? lim.cpus) * 1e9) : undefined, CpuShares: s.cpu_shares == null ? undefined : Number(s.cpu_shares), CpusetCpus: s.cpuset == null ? undefined : str(s.cpuset), PidsLimit: s.pids_limit ?? lim.pids ?? undefined,
        SecurityOpt: s.security_opt && list(s.security_opt).map(str), Sysctls: s.sysctls && Object.fromEntries(kvList(s.sysctls).map(([k, v]) => [k, v ?? ''])), Ulimits: ul,
        LogConfig: s.logging ? clean({ Type: s.logging.driver || 'json-file', Config: s.logging.options && Object.fromEntries(Object.entries(s.logging.options).map(([k, v]) => [k, str(v)])) }) : undefined,
        GroupAdd: s.group_add && list(s.group_add).map(str), IpcMode: s.ipc, PidMode: s.pid, UTSMode: s.uts, UsernsMode: s.userns_mode, Runtime: s.runtime, CgroupParent: s.cgroup_parent, OomScoreAdj: s.oom_score_adj,
        VolumesFrom: s.volumes_from && list(s.volumes_from).map(v => { const [n, m] = str(v).replace(/^container:/, '').split(':'); return `${names[n] || n}${m ? ':' + m : ''}`; }), StorageOpt: s.storage_opt,
      }),
      NetworkingConfig: endpoints.length ? { EndpointsConfig: { [endpoints[0].network]: endpoints[0].cfg } } : undefined,
    });
    if (body.Env && !body.Env.length) delete body.Env;
    const pullPolicy = s.pull_policy || 'missing';
    const connect = endpoints.slice(1).map(e => ({ network: e.network, cfg: e.cfg }));
    const hash = crypto.createHash('sha256').update(JSON.stringify([body, connect])).digest('hex');
    body.Labels['com.docker.compose.config-hash'] = hash;
    out.push({ service: svc, container: cname, image, pull: pullPolicy, platform: s.platform, body, connect, deps, hash, ports: Object.entries(pr.bind).flatMap(([k, bs]) => bs.map(b => `${b.HostIp ? b.HostIp + ':' : ''}${b.HostPort || '?'}→${k}`)) });
  }
  // a dependency on a service skipped by profiles is dropped
  for (const s of out) s.deps = s.deps.filter(d => out.some(x => x.service === d.service));
  const containers = out.map(s => s.container);
  const dup = containers.find((c, k) => containers.indexOf(c) !== k);
  if (dup) throw new Error(`two services use the container name "${dup}"`);
  return { project: P, services: order(out), networks: Object.values(nets), volumes: Object.values(vols), warnings, skipped };
}
// dependencies first; a cycle is an error
function order(svcs) {
  const by = Object.fromEntries(svcs.map(s => [s.service, s])), done = new Set(), seen = new Set(), out = [];
  const visit = (s, path) => {
    if (done.has(s.service)) return;
    if (seen.has(s.service)) throw new Error(`depends_on loop: ${[...path, s.service].join(' → ')}`);
    seen.add(s.service);
    for (const d of s.deps) visit(by[d.service], [...path, s.service]);
    done.add(s.service); out.push(s);
  };
  svcs.forEach(s => visit(s, []));
  return out;
}
function clean(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === false && !['ReadOnly', 'Tty', 'OpenStdin', 'Privileged', 'ReadonlyRootfs', 'Internal', 'Attachable', 'EnableIPv6', 'Init'].includes(k)) delete o[k];
  for (const k of ['Tty', 'OpenStdin', 'Privileged', 'ReadonlyRootfs', 'Internal', 'Attachable', 'EnableIPv6', 'ReadOnly']) if (o[k] === false) delete o[k];
  return o;
}

module.exports = { parseYaml, parseEnv, interpolate, shellSplit, plan, duration, bytes, YamlError };
