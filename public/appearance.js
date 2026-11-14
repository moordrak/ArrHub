// ArrHub — teme i dinamičke pozadine
'use strict';
(() => {
  // ---------- Teme ----------
  const THEMES = {
    dark:      { name: 'Tamna',            scheme: 'dark',  bg: '#0f1115', panel: '#171a21', panel2: '#1e222b', line: '#2a2f3a', text: '#e6e8ec', muted: '#8b93a3', accent: '#e8a33d' },
    oled:      { name: 'OLED crna',        scheme: 'dark',  bg: '#000000', panel: '#0b0b0d', panel2: '#141418', line: '#22232a', text: '#e8e8ea', muted: '#85899a', accent: '#e8a33d' },
    light:     { name: 'Svijetla',         scheme: 'light', bg: '#f3f4f7', panel: '#ffffff', panel2: '#eef0f4', line: '#dde1e8', text: '#1b1f27', muted: '#5f6878', accent: '#c97f12' },
    nord:      { name: 'Nord',             scheme: 'dark',  bg: '#2e3440', panel: '#3b4252', panel2: '#434c5e', line: '#4c566a', text: '#eceff4', muted: '#a3adbf', accent: '#88c0d0' },
    dracula:   { name: 'Dracula',          scheme: 'dark',  bg: '#21222c', panel: '#282a36', panel2: '#313442', line: '#44475a', text: '#f8f8f2', muted: '#9ea3c0', accent: '#bd93f9' },
    catppuccin:{ name: 'Catppuccin Mocha', scheme: 'dark',  bg: '#11111b', panel: '#1e1e2e', panel2: '#282839', line: '#313244', text: '#cdd6f4', muted: '#9399b2', accent: '#cba6f7' },
    tokyo:     { name: 'Tokyo Night',      scheme: 'dark',  bg: '#16161e', panel: '#1a1b26', panel2: '#222433', line: '#2f3347', text: '#c0caf5', muted: '#8089b3', accent: '#7aa2f7' },
    gruvbox:   { name: 'Gruvbox',          scheme: 'dark',  bg: '#1d2021', panel: '#282828', panel2: '#32302f', line: '#3c3836', text: '#ebdbb2', muted: '#a89984', accent: '#fabd2f' },
    solarized: { name: 'Solarized',        scheme: 'dark',  bg: '#002b36', panel: '#073642', panel2: '#0a4150', line: '#124b5a', text: '#eee8d5', muted: '#93a1a1', accent: '#b58900' },
  };
  const BACKGROUNDS = {
    none:      'Bez pozadine',
    aurora:    'Aurora',
    stars:     'Zvjezdano nebo',
    particles: 'Mreža čestica',
    waves:     'Valovi',
    posters:   'Zid postera',
    fanart:    'Slike iz knjižnice',
  };

  const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const lum = h => { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  const rgba = (h, a) => `rgba(${hexRgb(h).join(',')},${a})`;

  function resolveTheme(id) {
    if (id === 'auto') return matchMedia('(prefers-color-scheme: light)').matches ? THEMES.light : THEMES.dark;
    return THEMES[id] || THEMES.dark;
  }
  let current = { theme: 'dark', accent: '' };
  function applyTheme(id, accent) {
    current = { theme: id, accent: accent || '' };
    const t = resolveTheme(id);
    const acc = /^#[0-9a-f]{6}$/i.test(accent || '') ? accent : t.accent;
    const vars = { '--bg': t.bg, '--panel': t.panel, '--panel2': t.panel2, '--line': t.line, '--text': t.text, '--muted': t.muted,
      '--accent': acc, '--on-accent': lum(acc) > .35 ? '#111111' : '#ffffff' };
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.style.colorScheme = t.scheme;
    root.dataset.scheme = t.scheme;
    try { localStorage.setItem('arrhub-theme', JSON.stringify({ vars, scheme: t.scheme })); } catch {}
    Bg.refreshColors();
  }
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (current.theme === 'auto') applyTheme('auto', current.accent); });

  // ---------- Pozadine ----------
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let root, canvas, ctx, imgLayer, shade, W = 0, H = 0, raf = 0, scene = null, last = 0, speed = 1;

  const Bg = {
    type: 'none', intensity: 60, reactive: true, activity: 0, colors: {}, media: null, mediaLoader: null,

    set(type, { intensity = 60, reactive = true } = {}) {
      this.intensity = Math.max(0, Math.min(100, Number(intensity)));
      this.reactive = !!reactive;
      const changed = type !== this.type;
      this.type = BACKGROUNDS[type] ? type : 'none';
      ensure();
      document.body.classList.toggle('has-bg', this.type !== 'none');
      root.style.display = this.type === 'none' ? 'none' : '';
      this.applyIntensity();
      if (changed || !scene) start();
    },
    setActivity(bytesPerSec) { this.activity = bytesPerSec || 0; },
    applyIntensity() {
      if (!root) return;
      const k = this.intensity / 100;
      const img = this.type === 'posters' || this.type === 'fanart';
      canvas.style.opacity = img ? 0 : k;
      imgLayer.style.opacity = img ? 1 : 0;
      shade.style.opacity = img ? Math.max(0.15, 1 - k * 0.8) : 0;
    },
    refreshColors() {
      const cs = getComputedStyle(document.documentElement);
      const g = n => cs.getPropertyValue(n).trim() || '#888888';
      this.colors = { accent: g('--accent'), text: g('--text'), bg: g('--bg'),
        series: [g('--accent'), g('--radarr'), g('--sonarr'), g('--nzb'), g('--qb')] };
      this.light = document.documentElement.dataset.scheme === 'light';
      if (reduce.matches && scene) drawStatic();
    },
  };

  function ensure() {
    if (root) return;
    root = document.createElement('div'); root.id = 'bg'; root.setAttribute('aria-hidden', 'true');
    canvas = document.createElement('canvas');
    imgLayer = document.createElement('div'); imgLayer.className = 'bg-img';
    shade = document.createElement('div'); shade.className = 'bg-shade';
    root.append(canvas, imgLayer, shade);
    document.body.prepend(root);
    ctx = canvas.getContext('2d');
    addEventListener('resize', () => { resize(); scene?.init?.(); if (reduce.matches) drawStatic(); });
    resize();
    Bg.refreshColors();
  }
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function targetSpeed() {
    if (!Bg.reactive) return 1;
    return 1 + Math.min(4, Math.log10(1 + Bg.activity / 262144) * 1.6);
  }
  function start() {
    cancelAnimationFrame(raf);
    scene?.destroy?.();
    ctx.clearRect(0, 0, W, H);
    imgLayer.innerHTML = '';
    Bg.fallbackMsg = null;
    scene = SCENES[Bg.type] ? SCENES[Bg.type]() : null;
    if (!scene) return;
    scene.init?.();
    Bg.applyIntensity();
    if (reduce.matches) return drawStatic();
    last = performance.now();
    const loop = now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      speed += (targetSpeed() - speed) * Math.min(1, dt * 1.5);
      scene.frame?.(dt, speed);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  function drawStatic() { if (scene?.frame) { ctx.clearRect(0, 0, W, H); scene.frame(0.016, 1); } }
  reduce.addEventListener('change', start);

  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- Scene ----------
  const SCENES = {
    aurora() {
      let blobs = [];
      return {
        init() {
          const cols = Bg.colors.series;
          blobs = Array.from({ length: 6 }, (_, i) => ({
            x: rnd(0, W), y: rnd(0, H), r: rnd(.35, .6) * Math.max(W, H),
            vx: rnd(-1, 1), vy: rnd(-1, 1), c: cols[i % cols.length], ph: rnd(0, 6.28),
          }));
        },
        frame(dt, k) {
          ctx.clearRect(0, 0, W, H);
          const cols = Bg.colors.series;
          blobs.forEach((b, i) => {
            b.c = cols[i % cols.length];
            b.ph += dt * .25 * k;
            b.x += (b.vx * 18 + Math.cos(b.ph) * 12) * dt * k;
            b.y += (b.vy * 14 + Math.sin(b.ph * .8) * 10) * dt * k;
            if (b.x < -b.r * .3 || b.x > W + b.r * .3) b.vx *= -1;
            if (b.y < -b.r * .3 || b.y > H + b.r * .3) b.vy *= -1;
            const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
            g.addColorStop(0, rgba(b.c, Bg.light ? .22 : .30));
            g.addColorStop(1, rgba(b.c, 0));
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
          });
        },
      };
    },

    stars() {
      let stars = [];
      const N = () => Math.round(Math.min(600, W * H / 3500));
      const make = z => ({ x: rnd(-1, 1), y: rnd(-1, 1), z: z ?? rnd(.05, 1) });
      return {
        init() { stars = Array.from({ length: N() }, () => make()); },
        frame(dt, k) {
          ctx.clearRect(0, 0, W, H);
          const cx = W / 2, cy = H / 2, f = Math.max(W, H) * .5;
          const col = Bg.light ? '#1b1f27' : '#ffffff';
          ctx.fillStyle = col; ctx.strokeStyle = col;
          const v = .045 * k * k;
          for (const s of stars) {
            const pz = s.z;
            s.z -= dt * v;
            if (s.z <= .02) Object.assign(s, make(1));
            const x = cx + s.x / s.z * f, y = cy + s.y / s.z * f;
            if (x < 0 || x > W || y < 0 || y > H) { Object.assign(s, make(1)); continue; }
            const a = Math.min(1, (1 - s.z) * 1.3);
            const r = Math.max(.4, (1 - s.z) * 1.8);
            if (k > 1.6) {
              const px = cx + s.x / pz * f, py = cy + s.y / pz * f;
              ctx.globalAlpha = a * .8; ctx.lineWidth = r;
              ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
            }
            ctx.globalAlpha = a;
            ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
          }
          ctx.globalAlpha = 1;
        },
      };
    },

    particles() {
      let pts = [];
      return {
        init() {
          const n = Math.round(Math.min(110, W * H / 16000));
          pts = Array.from({ length: n }, () => ({ x: rnd(0, W), y: rnd(0, H), vx: rnd(-1, 1), vy: rnd(-1, 1) }));
        },
        frame(dt, k) {
          ctx.clearRect(0, 0, W, H);
          const acc = Bg.colors.accent, D = 140;
          for (const p of pts) {
            p.x += p.vx * 22 * dt * k; p.y += p.vy * 22 * dt * k;
            if (p.x < 0 || p.x > W) p.vx *= -1;
            if (p.y < 0 || p.y > H) p.vy *= -1;
          }
          ctx.lineWidth = 1;
          for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
            const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = dx * dx + dy * dy;
            if (d < D * D) {
              ctx.strokeStyle = rgba(acc, (1 - Math.sqrt(d) / D) * .45);
              ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
            }
          }
          ctx.fillStyle = rgba(acc, .9);
          for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 6.283); ctx.fill(); }
        },
      };
    },

    waves() {
      let t = 0;
      return {
        frame(dt, k) {
          ctx.clearRect(0, 0, W, H);
          t += dt * .6 * k;
          const cols = Bg.colors.series;
          for (let l = 0; l < 4; l++) {
            const base = H * (.55 + l * .1), amp = 28 + l * 10, len = .0016 + l * .0007;
            ctx.beginPath(); ctx.moveTo(0, H);
            const wy = x => base + Math.sin(x * len + t * (1 + l * .3) + l) * amp + Math.sin(x * len * 2.3 - t * .7) * amp * .35;
            for (let x = 0; x < W; x += 12) ctx.lineTo(x, wy(x));
            ctx.lineTo(W, wy(W));
            ctx.lineTo(W, H); ctx.closePath();
            const g = ctx.createLinearGradient(0, base - amp, 0, H);
            g.addColorStop(0, rgba(cols[l % cols.length], Bg.light ? .18 : .22));
            g.addColorStop(1, rgba(cols[l % cols.length], 0));
            ctx.fillStyle = g; ctx.fill();
          }
        },
      };
    },

    posters() {
      let wall, y = 0, rowH = 1, alive = true;
      return {
        async init() {
          const media = await loadMedia();
          if (!alive) return;
          if (!media.posters.length) return fallback('Nema postera u knjižnici');
          imgLayer.innerHTML = '';
          const tw = W < 700 ? 110 : 150, th = tw * 1.5, gap = 10;
          const cols = Math.ceil((W * 1.4) / (tw + gap)) + 1, rows = Math.ceil((H * 1.4) / (th + gap)) + 2;
          wall = document.createElement('div'); wall.className = 'bg-wall';
          wall.style.gridTemplateColumns = `repeat(${cols}, ${tw}px)`;
          wall.style.gap = gap + 'px';
          const list = media.posters, badSet = new Set(), good = [];
          let ok = 0, bad = 0, cursor = 0;
          const nextSrc = () => {
            if (good.length && badSet.size > list.length / 2) return good[Math.floor(Math.random() * good.length)];
            for (let n = 0; n < list.length; n++) { const u = list[cursor++ % list.length]; if (!badSet.has(u)) return u; }
            return good[0] || null;
          };
          for (let i = 0; i < cols * rows * 2; i++) {
            const im = new Image(); im.decoding = 'async'; im.style.height = th + 'px';
            let tries = 0;
            im.onload = () => { ok++; const u = im.getAttribute('src'); if (!good.includes(u)) good.push(u); };
            im.onerror = () => {
              badSet.add(im.getAttribute('src')); bad++;
              if (bad >= Math.min(12, list.length) && ok === 0 && alive) return fallback('Posteri se ne mogu učitati');
              const n = ++tries <= 4 ? nextSrc() : null;
              if (n) im.src = n; else im.style.visibility = 'hidden';
            };
            im.src = nextSrc();
            wall.appendChild(im);
          }
          rowH = (th + gap) * rows;
          imgLayer.appendChild(wall);
          if (reduce.matches) wall.style.transform = 'translate(-15%,-10%) rotate(-8deg)';
        },
        frame(dt, k) {
          if (!wall) return;
          y = (y + dt * 14 * k) % rowH;
          wall.style.transform = `translate(-15%, -10%) rotate(-8deg) translateY(${-y}px)`;
        },
        destroy() { alive = false; },
      };
    },

    fanart() {
      let imgs = [], idx = 0, timer = 0, alive = true, a, b, fails = 0, shown = 0;
      const show = () => {
        if (!imgs.length) return;
        const next = imgs[idx++ % imgs.length];
        const pre = new Image();
        pre.onload = () => {
          if (!alive) return;
          fails = 0; shown++;
          [a, b] = [b, a];
          a.style.backgroundImage = `url("${next}")`;
          a.classList.remove('kb'); void a.offsetWidth; a.classList.add('kb');
          a.style.opacity = 1; b.style.opacity = 0;
        };
        pre.onerror = () => {
          if (!alive) return;
          if (++fails >= Math.min(8, imgs.length)) { if (!shown) fallback('Slike iz knjižnice se ne mogu učitati'); return; }
          show();
        };
        pre.src = next;
      };
      return {
        async init() {
          const media = await loadMedia();
          if (!alive) return;
          imgs = media.fanart.length ? media.fanart : media.posters;
          if (!imgs.length) return fallback('Nema slika u knjižnici');
          imgLayer.innerHTML = '';
          a = document.createElement('div'); b = document.createElement('div');
          a.className = b.className = 'bg-slide';
          imgLayer.append(a, b);
          show();
          clearInterval(timer);
          timer = setInterval(() => { if (!document.hidden) show(); }, 15000);
        },
        destroy() { alive = false; clearInterval(timer); },
      };
    },
  };

  let lastMediaLoad = 0;
  async function loadMedia() {
    const has = Bg.media && (Bg.media.posters.length || Bg.media.fanart.length);
    if (Bg.media && Date.now() - lastMediaLoad < (has ? 600000 : 30000)) return Bg.media;
    try { Bg.media = Bg.mediaLoader ? await Bg.mediaLoader() : { posters: [], fanart: [] }; }
    catch { Bg.media = { posters: [], fanart: [] }; }
    lastMediaLoad = Date.now();
    return Bg.media;
  }
  function fallback(msg) {
    if (Bg.fallbackMsg === msg && scene?.isFallback) return;
    Bg.fallbackMsg = msg;
    window.toast?.(msg + ' – prikazujem Auroru. Detalji su u Postavkama.');
    scene?.destroy?.();
    scene = SCENES.aurora(); scene.isFallback = true; scene.init();
    canvas.style.opacity = Bg.intensity / 100; imgLayer.style.opacity = 0; shade.style.opacity = 0;
    if (reduce.matches) drawStatic();
  }

  Bg.reloadMedia = () => { Bg.media = null; lastMediaLoad = 0; };
  Bg.restart = () => { if (root && Bg.type !== 'none') start(); };
  window.Appearance = { THEMES, BACKGROUNDS, applyTheme, Bg };
})();
