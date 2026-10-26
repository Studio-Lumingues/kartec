// =====================================================================================
// textures.js — texturas procedurais (canvas), sem nenhum arquivo de imagem
// Princípio usado nos jogos de kart dos anos 90: cada tipo de superfície tem uma textura pequena e
// repetível, quase neutra; a variação em grande escala vem da cor de vértice. Os ruídos aqui são
// "tileáveis" (sem emenda ao repetir). TX.get(nome, rx, ry) devolve uma textura pronta com repetição.
// =====================================================================================
(function () {
  const cvs = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  // ruído de valor tileável + fbm (soma de oitavas)
  function tnoise(w, h, cells, sd) {
    let s = sd; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const cx = cells, cy = Math.max(1, Math.round(cells * h / w)), g = new Float32Array(cx * cy);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = x / w * cx, fy = y / h * cy, ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const x1 = (ix + 1) % cx, y1 = (iy + 1) % cy;
      const a = g[iy * cx + ix], b = g[iy * cx + x1], c = g[y1 * cx + ix], d = g[y1 * cx + x1];
      out[y * w + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
    return out;
  }
  function fbm(w, h, base, oct, sd) {
    const o = new Float32Array(w * h); let amp = 0.5, tot = 0;
    for (let k = 0; k < oct; k++) { const n = tnoise(w, h, base << k, sd + k * 977); for (let i = 0; i < o.length; i++) o[i] += n[i] * amp; tot += amp; amp *= 0.5; }
    for (let i = 0; i < o.length; i++) o[i] /= tot;
    return o;
  }
  // pinta pixel a pixel: fn(x, y, i) -> [r, g, b, a?]
  function paint(w, h, fn) {
    const c = cvs(w, h), g = c.getContext('2d'), im = g.createImageData(w, h), d = im.data;
    for (let i = 0; i < w * h; i++) {
      const p = fn(i % w, (i / w) | 0, i);
      d[i * 4] = p[0]; d[i * 4 + 1] = p[1]; d[i * 4 + 2] = p[2]; d[i * 4 + 3] = p.length > 3 ? p[3] : 255;
    }
    g.putImageData(im, 0, 0); return c;
  }
  const wrapXY = (w, h, x, y, fn) => { for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) fn(x + dx, y + dy); };
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const jit = (c, j) => { const k = (rnd() - 0.5) * j; return [c[0] + k, c[1] + k, c[2] + k]; };
  const lines = (g, w, h, n, len, style, width) => {
    g.strokeStyle = style; g.lineWidth = width;
    for (let k = 0; k < n; k++) {
      let x = rnd() * w, y = rnd() * h; const pts = [[x, y]];
      for (let j = 0; j < 6; j++) { x += (rnd() - 0.5) * len; y += (rnd() - 0.5) * len; pts.push([x, y]); }
      wrapXY(w, h, 0, 0, (dx, dy) => { g.beginPath(); pts.forEach((p, j) => j ? g.lineTo(p[0] + dx, p[1] + dy) : g.moveTo(p[0] + dx, p[1] + dy)); g.stroke(); });
    }
  };

  // ---------------- geradores ----------------
  const GEN = {
    grass() {
      const S = 256, n = fbm(S, S, 4, 3, 101), n2 = fbm(S, S, 16, 2, 202);
      const c = paint(S, S, (x, y, i) => {
        const t = Math.min(1, Math.max(0, (n[i] - 0.3) * 1.8));
        let col = mixc([58, 140, 42], [104, 186, 66], t);
        col = mixc(col, [132, 176, 58], Math.max(0, n2[i] - 0.62) * 1.6);
        return jit(col, 18);
      }), g = c.getContext('2d');
      for (let k = 0; k < 2600; k++) {
        const x = rnd() * S, y = rnd() * S, l = 3 + rnd() * 6, a = -Math.PI / 2 + (rnd() - 0.5) * 1.1, lt = rnd();
        g.strokeStyle = lt < 0.5 ? 'rgba(40,110,30,' + (0.35 + rnd() * 0.35) + ')' : 'rgba(150,215,100,' + (0.25 + rnd() * 0.35) + ')';
        g.lineWidth = 1 + rnd();
        wrapXY(S, S, x, y, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
      }
      for (let k = 0; k < 26; k++) {
        const x = rnd() * S, y = rnd() * S, cc = rnd() < 0.6 ? '#fffbe8' : '#ffe14a';
        wrapXY(S, S, x, y, (px, py) => { g.fillStyle = cc; g.fillRect(px - 1, py - 1, 2, 2); });
      }
      return c;
    },
    asphalt() {
      const S = 256, n = fbm(S, S, 4, 3, 303);
      const c = paint(S, S, (x, y, i) => { const v = 96 + n[i] * 40, r = rnd(); const d = r < 0.08 ? 40 : r < 0.16 ? -34 : (rnd() - 0.5) * 14; return [v + d, v + d, v + d + 6]; }),
        g = c.getContext('2d');
      for (let k = 0; k < 9; k++) {
        const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 18;
        wrapXY(S, S, x, y, (px, py) => { const gr = g.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, 'rgba(20,20,30,.22)'); gr.addColorStop(1, 'rgba(20,20,30,0)'); g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2); });
      }
      lines(g, S, S, 3, 30, 'rgba(25,25,32,.28)', 1);
      return c;
    },
    curb() {
      return paint(64, 128, (x, y) => {
        const red = y < 64, u = x / 63, sh = 0.82 + 0.25 * Math.sin(u * Math.PI) - (y % 64 < 3 || y % 64 > 60 ? 0.12 : 0);
        const b = red ? [226, 44, 38] : [246, 246, 246];
        return jit(b.map(v => Math.min(255, v * sh)), 16);
      });
    },
    curbGray() { // meio-fio de concreto (cidade)
      return paint(64, 128, (x, y) => { const u = x / 63, sh = 0.8 + 0.25 * Math.sin(u * Math.PI) - (y % 32 < 2 ? 0.15 : 0); const b = (Math.floor(y / 64) % 2) ? [235, 214, 60] : [210, 210, 214]; return jit(b.map(v => Math.min(255, v * sh)), 14); });
    },
    paint() { return paint(64, 64, () => { const r = rnd(); return r < 0.07 ? [200, 200, 205] : jit([250, 250, 250], 10); }); },
    paintYellow() { return paint(64, 64, () => { const r = rnd(); return r < 0.07 ? [200, 170, 40] : jit([250, 205, 40], 10); }); },
    dirt() {
      const w = 128, h = 128, n = fbm(w, h, 4, 3, 404), e = fbm(w, h, 8, 2, 505);
      const c = paint(w, h, (x, y, i) => {
        const u = x / (w - 1), edge = u + (e[i] - 0.5) * 0.45;
        if (edge > 0.86) return [0, 0, 0, 0];
        if (edge > 0.7) { const t = (edge - 0.7) / 0.16; return jit(mixc([150, 120, 78], [78, 150, 52], t), 20); }
        return jit(mixc([146, 108, 66], [184, 148, 98], n[i]), 22);
      }), g = c.getContext('2d');
      for (let k = 0; k < 70; k++) {
        const x = rnd() * w * 0.66, y = rnd() * h, r = 1 + rnd() * 2.2, v = 150 + rnd() * 80;
        wrapXY(w, h, x, y, (px, py) => { g.fillStyle = 'rgb(' + v + ',' + (v - 14) + ',' + (v - 36) + ')'; g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill(); });
      }
      return c;
    },
    sandEdge() { // acostamento de areia com borda irregular (praia)
      const w = 128, h = 128, n = fbm(w, h, 4, 3, 414), e = fbm(w, h, 8, 2, 515);
      return paint(w, h, (x, y, i) => { const u = x / (w - 1), edge = u + (e[i] - 0.5) * 0.5; if (edge > 0.9) return [0, 0, 0, 0]; return jit(mixc([214, 182, 118], [240, 214, 152], n[i]), 20); });
    },
    sand() {
      const S = 128, n = fbm(S, S, 4, 3, 606);
      return paint(S, S, (x, y, i) => { const rip = 0.5 + 0.5 * Math.sin((y + n[i] * 30) * 0.45); return jit(mixc([222, 190, 122], [244, 218, 158], 0.35 * rip + 0.65 * n[i]), 22); });
    },
    wetSand() {
      const S = 128, n = fbm(S, S, 4, 3, 616);
      return paint(S, S, (x, y, i) => jit(mixc([168, 140, 96], [200, 172, 122], n[i]), 14));
    },
    pebble() {
      const S = 128, c = paint(S, S, () => jit([150, 116, 70], 20)), g = c.getContext('2d');
      for (let k = 0; k < 160; k++) {
        const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 5, v = 110 + rnd() * 90;
        wrapXY(S, S, x, y, (px, py) => {
          g.fillStyle = 'rgba(40,30,20,.45)'; g.beginPath(); g.ellipse(px + 1, py + 1.5, r, r * 0.75, 0, 0, 6.2832); g.fill();
          g.fillStyle = 'rgb(' + v + ',' + (v - 10) + ',' + (v - 30) + ')'; g.beginPath(); g.ellipse(px, py, r, r * 0.75, 0, 0, 6.2832); g.fill();
        });
      }
      return c;
    },
    rock() {
      const S = 128, n = fbm(S, S, 4, 4, 707), m = fbm(S, S, 6, 2, 808);
      const c = paint(S, S, (x, y, i) => { let col = mixc([96, 94, 106], [160, 156, 166], n[i]); if (m[i] > 0.64) col = mixc(col, [86, 136, 60], Math.min(1, (m[i] - 0.64) * 4)); return jit(col, 14); });
      lines(c.getContext('2d'), S, S, 6, 28, 'rgba(30,28,36,.4)', 1.2);
      return c;
    },
    leaf() {
      const S = 128, c = paint(S, S, () => jit([150, 160, 145], 14)), g = c.getContext('2d');
      for (let k = 0; k < 520; k++) {
        const x = rnd() * S, y = rnd() * S, r = 2.5 + rnd() * 4, a = rnd() * 6.28, v = rnd();
        const col = v < 0.3 ? 'rgba(70,80,66,.8)' : v < 0.75 ? 'rgba(205,215,195,.85)' : 'rgba(255,255,245,.9)';
        wrapXY(S, S, x, y, (px, py) => {
          g.fillStyle = 'rgba(40,48,36,.35)'; g.beginPath(); g.ellipse(px + 0.8, py + 1.2, r, r * 0.55, a, 0, 6.2832); g.fill();
          g.fillStyle = col; g.beginPath(); g.ellipse(px, py, r, r * 0.55, a, 0, 6.2832); g.fill();
        });
      }
      return c;
    },
    bark() {
      const w = 64, h = 128, n = fbm(w, h, 4, 3, 909);
      return paint(w, h, (x, y, i) => { const f = 0.5 + 0.5 * Math.sin(x * 0.88357 + Math.sin(y * 0.098175 + x * 0.19635) * 2.4 + n[i] * 5); const v = 110 + f * 120 + (rnd() - 0.5) * 16; return [v, v * 0.92, v * 0.8]; });
    },
    palmBark() { // anéis do coqueiro
      return paint(64, 64, (x, y) => { const ring = (y % 16) < 4 ? 0.62 : 0.9 + 0.1 * Math.sin(x * 0.3927); return jit([180 * ring, 140 * ring, 92 * ring], 16); });
    },
    palmLeaf() { // folha com nervura central e folíolos (canal alfa recorta o formato)
      const w = 64, h = 128;
      return paint(w, h, (x, y) => {
        const u = (x - 31.5) / 31.5, v = y / (h - 1), half = Math.sin(v * Math.PI) * 0.95;
        const comb = Math.abs(u) > half * (0.55 + 0.45 * Math.abs(Math.sin(y * 0.55))) ? 0 : 1;
        if (!comb) return [0, 0, 0, 0];
        const mid = Math.abs(u) < 0.06 ? 0.7 : 1;
        return jit([70 * mid, 150 * mid, 52 * mid], 20);
      });
    },
    brick() {
      const c = cvs(64, 64), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#c9c9d4';
      for (let r = 0; r < 4; r++) { const y = r * 16, o = (r % 2) * 16; g.fillRect(0, y, 64, 2); g.fillRect(o, y, 2, 16); g.fillRect(o + 32, y, 2, 16); }
      for (let i = 0; i < 120; i++) { const v = (200 + rnd() * 55) | 0; g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.fillRect((rnd() * 62) | 0, (rnd() * 62) | 0, 3, 2); }
      return c;
    },
    concrete() {
      const S = 128, n = fbm(S, S, 4, 3, 1001);
      const c = paint(S, S, (x, y, i) => { const joint = (x % 64 < 2 || y % 64 < 2) ? -38 : 0; const v = 168 + n[i] * 50 + joint; return jit([v, v, v - 4], 12); });
      return c;
    },
    calcadao() { // calçada de pedra portuguesa em ondas pretas e brancas (estilo orla carioca)
      const S = 128;
      return paint(S, S, (x, y) => {
        const wave = Math.sin((y / 32 + 0.18 * Math.sin(x / S * 6.2832 * 2)) * 6.2832);
        const stone = ((x * 7 + y * 13) % 5 === 0) || ((x % 4 === 0) && (y % 4 === 0)) ? -26 : 0;
        const base = wave > 0 ? [36, 36, 40] : [236, 232, 222];
        return jit(base.map(v => Math.max(0, v + stone)), 22);
      });
    },
    water() {
      const S = 128, n = fbm(S, S, 4, 3, 1101), m = fbm(S, S, 8, 2, 1202);
      return paint(S, S, (x, y, i) => {
        const cau = Math.pow(1 - Math.abs(m[i] - 0.5) * 2, 6);
        return mixc(mixc([38, 120, 196], [70, 180, 220], n[i]), [235, 250, 255], cau * 0.75);
      });
    },
    ripple() {
      const c = cvs(128, 128), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(110,185,255,.6)'; g.lineWidth = 3;
      for (let i = 0; i < 16; i++) { const x = rnd() * 128, y = rnd() * 128, r = 6 + rnd() * 10; wrapXY(128, 128, x, y, (px, py) => { g.beginPath(); g.arc(px, py, r, 0.2, Math.PI - 0.4); g.stroke(); }); }
      return c;
    },
    foam() {
      const w = 128, h = 32, n = fbm(w, h, 8, 3, 1303);
      return paint(w, h, (x, y, i) => { const v = y / (h - 1), a = Math.max(0, 1 - Math.abs(v - 0.5) * 2.2) * (0.55 + 0.45 * n[i]); return [255, 255, 255, a * 255]; });
    },
    wood() {
      const w = 64, h = 64, n = fbm(w, h, 2, 3, 1404);
      return paint(w, h, (x, y, i) => { const plank = (y % 16) < 1 ? 0.55 : 1; const grain = 0.85 + 0.15 * Math.sin(x * 0.4 + n[i] * 9); const v = plank * grain; return jit([170 * v, 118 * v, 70 * v], 12); });
    },
    thatch() {
      const w = 64, h = 64;
      const c = paint(w, h, () => jit([196, 160, 92], 20)), g = c.getContext('2d');
      for (let k = 0; k < 400; k++) { const x = rnd() * w, y = rnd() * h; g.strokeStyle = rnd() < 0.5 ? 'rgba(120,90,40,.6)' : 'rgba(240,210,140,.6)'; g.lineWidth = 1; wrapXY(w, h, x, y, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + (rnd() - 0.5) * 3, py + 8); g.stroke(); }); }
      return c;
    },
    roofTile() {
      return paint(64, 64, (x, y) => { const row = Math.floor(y / 8), off = (row % 2) * 8, arc = Math.sin(((x + off) % 16) / 16 * Math.PI); const v = 0.65 + 0.35 * arc * (1 - (y % 8) / 10); return jit([196 * v, 92 * v, 52 * v], 12); });
    },
    tiles() { // azulejos do túnel: brancos com rejunte, faixa azul e faixa amarela na altura dos olhos
      const S = 128;
      return paint(S, S, (x, y) => {
        const grout = (x % 16 < 1) || (y % 16 < 1); if (grout) return jit([120, 122, 130], 8);
        const row = Math.floor(y / 16), base = row === 3 ? [40, 92, 200] : row === 4 ? [250, 200, 40] : [232, 230, 222];
        const sh = 0.92 + 0.08 * Math.sin((x % 16) / 16 * Math.PI) * Math.sin((y % 16) / 16 * Math.PI);
        return jit(base.map(v => v * sh), 10);
      });
    },
    stripes() { // listras amarelo/preto (rampas)
      return paint(64, 64, (x, y) => (Math.floor((x + y) / 16) % 2) ? jit([30, 30, 34], 10) : jit([250, 200, 30], 10));
    },
    rainbow() {
      const c = cvs(64, 128), g = c.getContext('2d');
      const cols = ['#ff2a2a', '#ff8a1a', '#ffe81a', '#3ee03e', '#1ac8ff', '#3a4bff', '#b43aff'], bh = 128 / cols.length;
      cols.forEach((k, i) => { g.fillStyle = k; g.fillRect(0, i * bh, 64, bh + 1); });
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 4; i++) { const y = i * 32; g.beginPath(); g.moveTo(8, y + 22); g.lineTo(32, y + 6); g.lineTo(56, y + 22); g.lineTo(56, y + 29); g.lineTo(32, y + 13); g.lineTo(8, y + 29); g.closePath(); g.fill(); }
      g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(0, 0, 64, 128);
      return c;
    },
    startLine() {
      return paint(512, 64, (x, y) => { if (y < 4 || y >= 60) return jit([245, 245, 245], 8); const ix = Math.floor(x / 16), iy = Math.floor((y - 4) / 28); return ((ix + iy) % 2) ? jit([24, 24, 28], 10) : jit([246, 246, 246], 10); });
    },
    checker() { return paint(128, 96, (x, y) => ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) ? jit([20, 20, 24], 8) : jit([248, 248, 248], 8)); },
    tower() {
      return paint(64, 256, (x, y) => { const band = Math.floor((y + x * 0.5) / 32) % 2; const sh = 0.78 + 0.3 * Math.sin(x / 63 * Math.PI); return jit((band ? [255, 206, 26] : [38, 74, 214]).map(v => Math.min(255, v * sh)), 10); });
    },
    lighthouse() { return paint(32, 128, (x, y) => (Math.floor(y / 32) % 2) ? jit([230, 40, 40], 10) : jit([248, 248, 248], 8)); },
    sign() {
      const c = cvs(1024, 128), g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#2a56e8'); gr.addColorStop(1, '#14268a'); g.fillStyle = gr; g.fillRect(0, 0, 1024, 128);
      for (let x = 0; x < 1024; x += 16) for (let r = 0; r < 2; r++) {
        g.fillStyle = ((x / 16 + r) % 2) ? '#111' : '#fff'; g.fillRect(x, r * 10, 16, 10);
        g.fillStyle = ((x / 16 + r) % 2) ? '#fff' : '#111'; g.fillRect(x, 108 + r * 10, 16, 10);
      }
      g.font = '700 72px ' + CFG.FONT_DISPLAY; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = 14; g.strokeStyle = '#13183f'; g.strokeText('SUPER KARTEC', 512, 68);
      g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.strokeText('SUPER KARTEC', 512, 68);
      const tg = g.createLinearGradient(0, 36, 0, 96); tg.addColorStop(0, '#fff3a0'); tg.addColorStop(0.5, '#ffc928'); tg.addColorStop(1, '#ff8a00');
      g.fillStyle = tg; g.fillText('SUPER KARTEC', 512, 68);
      [[230, 64], [794, 64]].forEach(([x, y]) => { g.fillStyle = '#ffc928'; g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 9 : 22; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.lineWidth = 4; g.strokeStyle = '#13183f'; g.stroke(); g.fill(); });
      return c;
    },
    soft() {
      const c = cvs(64, 64), g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, 64, 64); return c;
    },
    glow() {
      const c = cvs(64, 64), g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, 64, 64); return c;
    },
    moon() {
      const c = cvs(64, 64), g = c.getContext('2d'); g.fillStyle = '#f4f1e0'; g.beginPath(); g.arc(32, 32, 28, 0, 6.2832); g.fill();
      g.fillStyle = 'rgba(150,150,170,.35)'; [[22, 24, 6], [40, 36, 8], [30, 44, 4], [42, 20, 4]].forEach(a => { g.beginPath(); g.arc(a[0], a[1], a[2], 0, 6.2832); g.fill(); });
      return c;
    }
  };

  // =====================================================================================
  // VISUAL CARTUM: substitui as texturas realistas por versões de cor chapada e formas simples
  // (sem ruído fotográfico). Mesmos nomes e proporções: as pistas usam sem mudar nada.
  // =====================================================================================
  const flat = (w, h, col) => { const c = cvs(w, h), g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, w, h); return [c, g]; };
  const blob = (g, x, y, r, col, W, H) => wrapXY(W, H, x, y, (px, py) => { g.fillStyle = col; g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill(); });
  const tuft = (g, x, y, s, col, W, H) => wrapXY(W, H, x, y, (px, py) => { g.fillStyle = col; g.beginPath(); g.moveTo(px - s, py + s * 0.4); g.quadraticCurveTo(px - s * 0.6, py - s * 0.6, px - s * 0.2, py - s * 1.3); g.quadraticCurveTo(px - s * 0.1, py - s * 0.3, px, py - s * 0.2); g.quadraticCurveTo(px + s * 0.2, py - s * 0.9, px + s * 0.6, py - s * 1.1); g.quadraticCurveTo(px + s * 0.5, py - s * 0.2, px + s, py + s * 0.4); g.closePath(); g.fill(); });
  // borda ondulada que se repete na vertical (transição para a grama)
  const wavy = (w, h, inner, outer, cut) => { const c = cvs(w, h), g = c.getContext('2d'), im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = x / (w - 1) + 0.05 * Math.sin(y / h * 6.2832 * 2) + 0.03 * Math.sin(y / h * 6.2832 * 5), i = (y * w + x) * 4;
      const col = u > cut ? null : u > cut - 0.13 ? outer : inner; if (col) { im.data[i] = col[0]; im.data[i + 1] = col[1]; im.data[i + 2] = col[2]; im.data[i + 3] = 255; } }
    g.putImageData(im, 0, 0); return c; };
  const TOON = {
    grass() { const S = 128, [c, g] = flat(S, S, '#5fd641');
      for (let k = 0; k < 26; k++) tuft(g, rnd() * S, rnd() * S, 3 + rnd() * 3, rnd() < 0.6 ? '#46bd34' : '#86ea5c', S, S);
      for (let k = 0; k < 6; k++) { const x = rnd() * S, y = rnd() * S; blob(g, x, y, 2.4, rnd() < 0.5 ? '#ffffff' : '#ffe14a', S, S); blob(g, x, y, 1, '#ff8a3d', S, S); }
      return c; },
    asphalt() { const S = 128, [c, g] = flat(S, S, '#5b5574');
      for (let k = 0; k < 22; k++) blob(g, rnd() * S, rnd() * S, 1 + rnd() * 2, rnd() < 0.6 ? '#6a6487' : '#524c69', S, S);
      return c; },
    curb() { const c = cvs(64, 128), g = c.getContext('2d');
      [[0, '#ff4d6d', '#ff8099', '#d6304f'], [64, '#fff7ee', '#ffffff', '#e2d7cf']].forEach(([y, base, hi, lo]) => { g.fillStyle = base; g.fillRect(0, y, 64, 64); g.fillStyle = lo; g.fillRect(0, y, 10, 64); g.fillRect(54, y, 10, 64); g.fillStyle = hi; g.fillRect(22, y, 12, 64); });
      return c; },
    curbGray() { const c = cvs(64, 128), g = c.getContext('2d');
      [[0, '#ffd23f'], [64, '#e4e0f0']].forEach(([y, col]) => { g.fillStyle = col; g.fillRect(0, y, 64, 64); g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(22, y, 12, 64); g.fillStyle = 'rgba(42,29,74,.18)'; g.fillRect(0, y, 8, 64); });
      return c; },
    paint() { return flat(16, 16, '#ffffff')[0]; },
    paintYellow() { return flat(16, 16, '#ffd23f')[0]; },
    dirt() { const c = wavy(128, 128, [226, 150, 92], [95, 214, 65], 0.86), g = c.getContext('2d');
      for (let k = 0; k < 10; k++) { g.fillStyle = rnd() < 0.5 ? '#c97f4c' : '#f0b47a'; g.beginPath(); g.arc(rnd() * 80, rnd() * 128, 2 + rnd() * 3, 0, 6.2832); g.fill(); }
      return c; },
    sandEdge() { return wavy(128, 128, [255, 216, 138], [255, 230, 170], 0.9); },
    sand() { const S = 128, [c, g] = flat(S, S, '#ffd98a'); g.strokeStyle = '#ffe9b5'; g.lineWidth = 3; g.lineCap = 'round';
      for (let k = 0; k < 8; k++) { const x = rnd() * S, y = rnd() * S; wrapXY(S, S, x, y, (px, py) => { g.beginPath(); g.moveTo(px - 10, py); g.quadraticCurveTo(px, py - 5, px + 10, py); g.stroke(); }); }
      return c; },
    wetSand() { return flat(16, 16, '#e8b46b')[0]; },
    pebble() { const S = 128, [c, g] = flat(S, S, '#d99b62'); const cols = ['#f2c48f', '#c7d0ff', '#ffb3c7', '#bfe9a8', '#fff1c9'];
      for (let k = 0; k < 40; k++) { const x = rnd() * S, y = rnd() * S, r = 3 + rnd() * 4, col = cols[k % cols.length]; wrapXY(S, S, x, y, (px, py) => { g.fillStyle = col; g.beginPath(); g.ellipse(px, py, r, r * 0.75, 0, 0, 6.2832); g.fill(); }); }
      return c; },
    rock() { const S = 64, [c, g] = flat(S, S, '#a99cd6');
      for (let k = 0; k < 7; k++) blob(g, rnd() * S, rnd() * S, 5 + rnd() * 7, rnd() < 0.5 ? '#b9aee2' : '#998cc8', S, S);
      return c; },
    leaf() { const S = 64, [c, g] = flat(S, S, '#e8e8e8');
      for (let k = 0; k < 7; k++) blob(g, rnd() * S, rnd() * S, 6 + rnd() * 6, '#ffffff', S, S);
      for (let k = 0; k < 5; k++) blob(g, rnd() * S, rnd() * S, 4 + rnd() * 4, '#cfcfcf', S, S);
      return c; },
    bark() { const [c, g] = flat(32, 64, '#c0844f'); g.strokeStyle = '#9a6538'; g.lineWidth = 3; g.lineCap = 'round';
      [6, 16, 26].forEach(x => { g.beginPath(); g.moveTo(x, -4); g.quadraticCurveTo(x + 4, 32, x, 68); g.stroke(); });
      return c; },
    palmBark() { const c = cvs(32, 32), g = c.getContext('2d'); g.fillStyle = '#d9a066'; g.fillRect(0, 0, 32, 32); g.fillStyle = '#b07a46'; g.fillRect(0, 0, 32, 7); return c; },
    concrete() { const S = 64, [c, g] = flat(S, S, '#dcd6ee'); g.fillStyle = '#c3bcdc'; g.fillRect(0, 0, S, 2); g.fillRect(0, 0, 2, S); return c; },
    water() { const S = 128, [c, g] = flat(S, S, '#2bc8f8'); g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.lineCap = 'round';
      for (let k = 0; k < 9; k++) { const x = rnd() * S, y = rnd() * S; wrapXY(S, S, x, y, (px, py) => { g.beginPath(); g.moveTo(px - 12, py); g.quadraticCurveTo(px - 6, py - 6, px, py); g.quadraticCurveTo(px + 6, py + 6, px + 12, py); g.stroke(); }); }
      return c; },
    ripple() { const S = 128, [c, g] = flat(S, S, '#ffffff'); g.strokeStyle = '#7fdcff'; g.lineWidth = 5; g.lineCap = 'round';
      for (let k = 0; k < 10; k++) { const x = rnd() * S, y = rnd() * S; wrapXY(S, S, x, y, (px, py) => { g.beginPath(); g.moveTo(px - 10, py); g.quadraticCurveTo(px - 5, py - 5, px, py); g.quadraticCurveTo(px + 5, py + 5, px + 10, py); g.stroke(); }); }
      return c; },
    wood() { const [c, g] = flat(64, 64, '#e2a066'); g.fillStyle = '#b8743f'; for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 3); return c; },
    thatch() { const [c, g] = flat(64, 64, '#ffcf6b'); g.strokeStyle = '#e8a83e'; g.lineWidth = 3; for (let x = 4; x < 64; x += 10) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x - 3, 64); g.stroke(); } return c; },
    roofTile() { const [c, g] = flat(64, 64, '#ff7a5c'); g.fillStyle = '#e05a40'; for (let y = 0; y < 64; y += 16) g.fillRect(0, y + 12, 64, 4); return c; },
    stripes() { return paint(64, 64, (x, y) => (Math.floor((x + y) / 16) % 2) ? [42, 29, 74] : [255, 210, 63]); },
    startLine() { return paint(512, 64, (x, y) => { if (y < 4 || y >= 60) return [255, 255, 255]; const ix = Math.floor(x / 16), iy = Math.floor((y - 4) / 28); return ((ix + iy) % 2) ? [42, 29, 74] : [255, 255, 255]; }); },
    checker() { return paint(128, 96, (x, y) => ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) ? [42, 29, 74] : [255, 255, 255]); },
    tower() { return paint(64, 256, (x, y) => (Math.floor((y + x * 0.5) / 32) % 2) ? [255, 210, 63] : [75, 110, 255]); },
    lighthouse() { return paint(32, 128, (x, y) => (Math.floor(y / 32) % 2) ? [255, 77, 109] : [255, 255, 255]); },
    sign() {
      const c = cvs(1024, 128), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 1024, 0);
      gr.addColorStop(0, '#ff4d9a'); gr.addColorStop(0.5, '#ff7a3d'); gr.addColorStop(1, '#ffc93d'); g.fillStyle = gr; g.fillRect(0, 0, 1024, 128);
      g.fillStyle = '#2a1d4a'; g.fillRect(0, 0, 1024, 12); g.fillRect(0, 116, 1024, 12);
      for (let x = 0; x < 1024; x += 64) { g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.arc(x + 32, 64, 22, 0, 6.2832); g.fill(); }
      g.font = '700 74px ' + CFG.FONT_DISPLAY; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = 16; g.strokeStyle = '#2a1d4a'; g.strokeText('SUPER KARTEC', 512, 68); g.fillStyle = '#ffffff'; g.fillText('SUPER KARTEC', 512, 68);
      return c;
    },
    // plataforma de turbo (padrão cartum): fundo roxo-tinta com degradê, setas amarelas com contorno; repete na vertical.
    // A ponta da seta fica no TOPO do canvas (= +V na textura), que a pista orienta para a frente.
    boostArrows() {
      const c = cvs(128, 128), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, '#7a3cff'); gr.addColorStop(0.5, '#ff4d9a'); gr.addColorStop(1, '#7a3cff'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      const chevron = (y, fill) => { g.beginPath(); g.moveTo(14, y + 44); g.lineTo(64, y + 6); g.lineTo(114, y + 44); g.lineTo(114, y + 60); g.lineTo(64, y + 24); g.lineTo(14, y + 60); g.closePath();
        g.lineJoin = 'round'; g.lineWidth = 8; g.strokeStyle = '#2a1d4a'; g.stroke(); g.fillStyle = fill; g.fill(); };
      chevron(0, '#ffd23f'); chevron(64, '#ffd23f');
      g.fillStyle = 'rgba(255,255,255,.55)'; [0, 64].forEach(y => { g.beginPath(); g.moveTo(30, y + 42); g.lineTo(64, y + 16); g.lineTo(98, y + 42); g.lineTo(98, y + 46); g.lineTo(64, y + 21); g.lineTo(30, y + 46); g.closePath(); g.fill(); });
      return c;
    },
    // moldura da plataforma: borda arredondada com faixas de bala (rosa/branco) e contorno; miolo transparente
    boostFrame() {
      const W = 128, H = 256, c = cvs(W, H), g = c.getContext('2d');
      const rr = (x, y, w, h, r, keep) => { if (!keep) g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
      g.save(); rr(2, 2, W - 4, H - 4, 26); rr(16, 18, W - 32, H - 36, 14, true); g.clip('evenodd');   // anel: borda externa menos o miolo
      for (let y = -W; y < H + W; y += 16) { g.fillStyle = (y / 16) % 2 ? '#ffffff' : '#ff4d9a'; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + W * 0.6); g.lineTo(W, y + W * 0.6 + 16); g.lineTo(0, y + 16); g.closePath(); g.fill(); }
      g.restore();
      g.lineWidth = 5; g.strokeStyle = '#2a1d4a'; rr(3, 3, W - 6, H - 6, 25); g.stroke(); rr(16, 18, W - 32, H - 36, 14); g.stroke();
      return c;
    },
    // fumaça de desenho: nuvenzinha de 4 bolas, branca com sombra lilás embaixo e borda nítida
    puff() {
      const c = cvs(64, 64), g = c.getContext('2d'), B = [[32, 34, 17], [20, 38, 12], [44, 38, 12], [30, 24, 12]];
      g.fillStyle = '#d6cdf0'; B.forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y + 3, r, 0, 6.2832); g.fill(); });
      g.fillStyle = '#ffffff'; B.forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r - 1.5, 0, 6.2832); g.fill(); });
      return c;
    },
    // faísca: estrelinha de 4 pontas
    star() {
      const c = cvs(32, 32), g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.beginPath();
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = k % 2 ? 4 : 15; g.lineTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r); } g.closePath(); g.fill();
      return c;
    }
  };
  Object.assign(GEN, TOON);

  // ---------- fachadas de prédio (cor + mapa de janelas acesas para a noite) ----------
  // paleta de bala para os prédios (visual cartum: cor chapada, janelas arredondadas, sem ruído)
  const FACADES = [
    { wall: [255, 214, 120], trim: [255, 138, 92], glass: [110, 200, 255] },   // amarelo-manteiga com laranja
    { wall: [120, 220, 230], trim: [255, 255, 255], glass: [80, 140, 255] },   // azul-piscina
    { wall: [255, 150, 170], trim: [255, 236, 240], glass: [120, 170, 255] },  // rosa-melancia
    { wall: [190, 160, 255], trim: [255, 230, 120], glass: [90, 210, 255] },   // lilás com amarelo
    { wall: [130, 225, 160], trim: [255, 255, 255], glass: [90, 160, 255] },   // menta
    { wall: [255, 180, 110], trim: [140, 90, 220], glass: [120, 220, 255] }    // laranja com roxo
  ];
  // fachada: 4 colunas x 8 andares (14 m x 28 m no prédio). Janela com profundidade desenhada (sombra no topo e à
  // esquerda do vão, caixilho claro, peitoril), reflexo no vidro, ar-condicionado em algumas janelas e, em 1/3 das
  // fachadas, varandas com guarda-corpo. A versão "lit" acende só os vidros (mesmas posições).
  function facade(k, lit) {
    const F = FACADES[k % FACADES.length], w = 256, h = 512, cols = 4, rows = 8, cw = w / cols, rh = h / rows;
    const c = cvs(w, h), g = c.getContext('2d'), rgb = a => 'rgb(' + a + ')';
    const rr = (x, y, ww, hh, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + ww, y, x + ww, y + hh, r); g.arcTo(x + ww, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + ww, y, r); g.closePath(); g.fill(); };
    const balcony = k % 3 === 0;
    if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
    else { g.fillStyle = rgb(F.wall); g.fillRect(0, 0, w, h); g.fillStyle = rgb(F.trim); for (let r = 0; r <= rows; r++) g.fillRect(0, r * rh - 4, w, 8);
      g.fillStyle = 'rgba(0,0,0,.05)'; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1); }                      // textura leve de reboco
    let s = 4000 + k * 31; const r2 = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x = q * cw + 14, y = r * rh + 16, ww = cw - 28, hh = rh - 30, on = r2() < 0.45, ac = r2() < 0.22;
      if (lit) { if (on) { g.fillStyle = r2() < 0.7 ? '#ffe08a' : '#bfe8ff'; rr(x + 4, y + 4, ww - 8, hh - 8, 6); } continue; }
      g.fillStyle = '#2a1d4a'; rr(x - 4, y - 4, ww + 8, hh + 8, 9);                                   // contorno
      g.fillStyle = rgb(F.trim); rr(x - 1, y - 1, ww + 2, hh + 2, 7);                                // caixilho claro
      g.fillStyle = 'rgba(20,14,40,.55)'; g.fillRect(x + 2, y + 2, ww - 4, 7); g.fillRect(x + 2, y + 2, 6, hh - 4);   // sombra do vão (profundidade)
      const gr = g.createLinearGradient(x, y, x, y + hh); gr.addColorStop(0, rgb(F.glass)); gr.addColorStop(1, 'rgba(255,255,255,.35)');
      g.fillStyle = gr; rr(x + 8, y + 9, ww - 12, hh - 13, 5);
      g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.moveTo(x + 12, y + hh - 10); g.lineTo(x + ww * 0.45, y + 12); g.lineTo(x + ww * 0.6, y + 12); g.lineTo(x + 22, y + hh - 10); g.closePath(); g.fill();   // reflexo
      g.fillStyle = 'rgba(42,29,74,.75)'; g.fillRect(x + ww / 2 - 1.5, y + 9, 3, hh - 13);         // divisória
      g.fillStyle = '#f4f2ee'; g.fillRect(x - 6, y + hh + 2, ww + 12, 6); g.fillStyle = '#2a1d4a'; g.fillRect(x - 6, y + hh + 8, ww + 12, 2);   // peitoril
      if (ac) { g.fillStyle = '#2a1d4a'; g.fillRect(x + ww - 22, y + hh + 9, 26, 16); g.fillStyle = '#e8e8ec'; g.fillRect(x + ww - 20, y + hh + 11, 22, 12);
        g.fillStyle = '#9aa0a8'; for (let i = 0; i < 4; i++) g.fillRect(x + ww - 18, y + hh + 13 + i * 2.5, 18, 1); }   // ar-condicionado
      if (balcony && r % 2 === 0) { g.fillStyle = rgb(F.trim); g.fillRect(q * cw + 4, y + hh - 18, cw - 8, 5); g.fillStyle = '#2a1d4a';
        for (let i = 0; i <= 8; i++) g.fillRect(q * cw + 6 + i * (cw - 14) / 8, y + hh - 14, 2, 14); g.fillRect(q * cw + 4, y + hh - 1, cw - 8, 3); }   // varanda
    }
    return c;
  }

  // ---------- cache + fábrica de texturas ----------
  const canvases = {};
  window.TX = {
    aniso: 4,
    canvas(name) { if (!canvases[name]) canvases[name] = GEN[name](); return canvases[name]; },
    // devolve uma textura nova (compartilha o canvas) com repetição própria
    get(name, rx, ry, opts) {
      const t = new THREE.CanvasTexture(this.canvas(name));
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx || 1, ry || 1);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = this.aniso;
      if (opts && opts.clamp) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
      return t;
    },
    facade(k, lit) {
      const key = 'facade' + k + (lit ? 'L' : '');
      if (!canvases[key]) canvases[key] = facade(k, lit);
      const t = new THREE.CanvasTexture(canvases[key]); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = this.aniso;
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
    },
    FACADE_COUNT: FACADES.length,
    // utilidades expostas para outros módulos (ex.: céu, minimapa)
    cvs, paint, fbm, rnd
  };
})();
