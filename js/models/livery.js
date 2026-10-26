// =====================================================================================
// models/livery.js — sistema de adesivos (decalques) sobre a pintura base
// Cada estampa desenha uma MÁSCARA num atlas 1024×1024 (vermelho = cor do adesivo, verde = branco,
// azul = contorno de tinta grosso, gerado automaticamente em volta de cada forma — traço de desenho animado):
//   metade de cima  -> lateral do kart (projeção em X; frente à direita)
//   quarto inf. esq -> capô/teto (projeção em Y; frente para cima, lado esquerdo do kart à esquerda)
//   quarto inf. dir -> placa com o número (círculo branco + algarismos)
// As funções de desenho trabalham em METROS do próprio kart (o desenho sai sem distorção na lataria,
// qualquer que seja o tamanho da caixa de projeção do modelo). A cor do adesivo vai no shader.
// Para criar uma estampa nova: Livery.register({ id, name, side(g, L, H), top(g, Wd, L) }).
// =====================================================================================
(function () {
  const RED = 'rgb(255,0,0)', GREEN = 'rgb(0,255,0)', BLUE = 'rgb(0,0,255)';
  const A = 1024;

  // estrela de n pontas
  function star(g, x, y, r, r2, n, rot) { g.beginPath(); for (let k = 0; k < n * 2; k++) { const a = (rot || 0) + Math.PI / 2 + k * Math.PI / n, rr = k % 2 ? r2 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); }
  // raio (zigue-zague) de a até b
  function bolt(g, x0, y0, x1, y1, w) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const P = (t, s) => [x0 + ux * L * t + nx * w * s, y0 + uy * L * t + ny * w * s];
    const pts = [P(0, 0), P(0.45, 1.6), P(0.42, 0.35), P(1, 0), P(0.55, -1.6), P(0.58, -0.35)];
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill();
  }
  // caveira estilizada (vazada: olhos, nariz e dentes ficam com a cor da lataria)
  function skull(g, x, y, s) {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = RED;
    g.beginPath(); g.ellipse(0, 0.12, 0.5, 0.46, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(-0.3, -0.18); g.lineTo(0.3, -0.18); g.lineTo(0.26, -0.48); g.quadraticCurveTo(0, -0.58, -0.26, -0.48); g.closePath(); g.fill();
    g.globalCompositeOperation = 'destination-out';
    [-1, 1].forEach(k => { g.beginPath(); g.ellipse(k * 0.19, 0.08, 0.14, 0.16, k * 0.25, 0, Math.PI * 2); g.fill(); });
    g.beginPath(); g.moveTo(0, -0.06); g.lineTo(-0.06, -0.18); g.lineTo(0.06, -0.18); g.closePath(); g.fill();
    for (let k = -2; k <= 2; k++) g.fillRect(k * 0.1 - 0.015, -0.47, 0.03, 0.2);
    g.globalCompositeOperation = 'source-over';
    [-1, 1].forEach(k => { g.save(); g.translate(k * 0.5, -0.55); g.rotate(k * 0.75); g.fillRect(-0.04, -0.32, 0.08, 0.64); g.beginPath(); g.arc(0, 0.32, 0.08, 0, 7); g.arc(0, -0.32, 0.08, 0, 7); g.fill(); g.restore(); });
    g.restore();
  }
  // língua de fogo (do ponto x0 para trás, ponta em x1)
  function flame(g, x0, y, x1, h, wav) {
    g.beginPath(); g.moveTo(x0, y - h);
    g.bezierCurveTo(x0 - (x0 - x1) * 0.35, y - h * 1.1, x0 - (x0 - x1) * 0.55, y - h * (0.3 + wav), x1, y);
    g.bezierCurveTo(x0 - (x0 - x1) * 0.55, y + h * (0.4 - wav), x0 - (x0 - x1) * 0.3, y + h * 1.1, x0, y + h);
    g.closePath(); g.fill();
  }
  // espinho tribal (curva afiada)
  function thorn(g, x0, y0, x1, y1, w, bend) {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + bend;
    g.beginPath(); g.moveTo(x0, y0 - w); g.quadraticCurveTo(mx, my - w * 0.6, x1, y1); g.quadraticCurveTo(mx, my + w * 0.8, x0, y0 + w); g.closePath(); g.fill();
  }

  // ---------- estampas ----------
  // side(g, L, H): L = comprimento (frente em x = L), H = altura | top(g, W, L): W = largura (lado esquerdo em x = 0), L = comprimento (frente em y = L)
  const PATTERNS = [
    { id: 'none', name: 'Sem adesivo', icon: '○' },
    { id: 'tribal', name: 'Tribal', icon: '〰',
      side(g, L, H) {
        const y = H * 0.5;
        thorn(g, L * 0.98, y, L * 0.30, y + H * 0.08, H * 0.12, -H * 0.12);
        thorn(g, L * 0.80, y + H * 0.08, L * 0.52, y + H * 0.34, H * 0.07, -H * 0.05);
        thorn(g, L * 0.80, y - H * 0.06, L * 0.50, y - H * 0.28, H * 0.06, H * 0.06);
        thorn(g, L * 0.55, y + H * 0.02, L * 0.10, y - H * 0.10, H * 0.07, H * 0.10);
        thorn(g, L * 0.40, y + H * 0.04, L * 0.18, y + H * 0.26, H * 0.045, -H * 0.04);
      },
      top(g, W, L) {
        [-1, 1].forEach(s => { const cx = W / 2;
          thorn(g, cx + s * 0.08, L * 0.97, cx + s * W * 0.42, L * 0.55, W * 0.07, 0);
          thorn(g, cx + s * W * 0.18, L * 0.80, cx + s * W * 0.06, L * 0.40, W * 0.05, 0);
          thorn(g, cx + s * W * 0.30, L * 0.62, cx + s * W * 0.44, L * 0.30, W * 0.04, 0); });
      } },
    { id: 'flames', name: 'Chamas', icon: '🔥',
      side(g, L, H) {
        const y = H * 0.48, tips = [[0.42, 0.18, 0.1], [0.28, 0.13, -0.2], [0.55, 0.12, 0.25], [0.18, 0.09, 0.05], [0.62, 0.08, -0.1]];
        g.fillRect(L * 0.86, y - H * 0.26, L * 0.14, H * 0.52);
        tips.forEach(([t, h, w], i) => flame(g, L * 0.9, y + (i - 2) * H * 0.1, L * t, H * h * 1.4, w));
      },
      top(g, W, L) {
        g.fillRect(0, L * 0.86, W, L * 0.14);
        [[0.2, 0.55, 0.08], [0.5, 0.42, 0.11], [0.8, 0.55, 0.08], [0.35, 0.62, 0.06], [0.65, 0.62, 0.06]].forEach(([x, t, w]) => {
          g.save(); g.translate(W * x, L * 0.9); g.rotate(-Math.PI / 2); flame(g, 0, 0, L * (0.9 - t), W * w, 0.1); g.restore(); });
      } },
    { id: 'stripes', name: 'Listras de corrida', icon: '∥',
      side(g, L, H) { g.fillRect(0, H * 0.58, L, H * 0.06); g.fillRect(0, H * 0.70, L, H * 0.03); },
      top(g, W, L) { [-1, 1].forEach(s => g.fillRect(W / 2 + s * W * 0.07 - (s < 0 ? W * 0.16 : 0), 0, W * 0.16, L)); } },
    { id: 'stars', name: 'Estrelas', icon: '★',
      side(g, L, H) { let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
        for (let k = 0; k < 9; k++) { const x = L * (0.08 + 0.84 * k / 8), y = H * (0.3 + r() * 0.45), sz = H * (0.07 + r() * 0.09); star(g, x, y, sz, sz * 0.45, 5, r() * 0.6); } },
      top(g, W, L) { star(g, W / 2, L * 0.7, W * 0.2, W * 0.09, 5, 0); [-1, 1].forEach(sx => { star(g, W / 2 + sx * W * 0.3, L * 0.45, W * 0.08, W * 0.035, 5, 0.3); star(g, W / 2 + sx * W * 0.22, L * 0.25, W * 0.06, W * 0.027, 5, 0.1); }); } },
    { id: 'skull', name: 'Caveira', icon: '☠',
      side(g, L, H) { skull(g, L * 0.5, H * 0.5, H * 0.42); },
      top(g, W, L) { skull(g, W / 2, L * 0.68, W * 0.34); } },
    { id: 'bolt', name: 'Raios', icon: '⚡',
      side(g, L, H) { bolt(g, L * 0.98, H * 0.58, L * 0.05, H * 0.46, H * 0.1); },
      top(g, W, L) { [-1, 1].forEach(s => bolt(g, W / 2 + s * W * 0.18, L * 0.98, W / 2 + s * W * 0.3, L * 0.15, W * 0.06)); } },
    { id: 'checker', name: 'Quadriculado', icon: '▦',
      side(g, L, H) { const c = H * 0.12; for (let i = 0; i * c < L * 0.36; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) g.fillRect(L - (i + 1) * c, H * 0.5 + (j - 1.5) * c, c, c); },
      top(g, W, L) { const c = W * 0.1; for (let i = 0; i * c < W; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) g.fillRect(i * c, L * 0.78 + j * c, c, c); } }
  ];

  // ---------- atlas (cache: estampa + número + caixa de projeção) ----------
  const cache = new Map();
  function texture(patternId, number, dims) {
    const key = patternId + '|' + number + '|' + dims.join(',');
    if (cache.has(key)) { const t = cache.get(key); cache.delete(key); cache.set(key, t); return t; }
    const c = TX.cvs(A, A), g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, A, A);
    const p = PATTERNS.find(x => x.id === patternId) || PATTERNS[0], [L, H, W, LT] = dims;
    g.fillStyle = RED; g.strokeStyle = RED; g.lineJoin = 'round';
    // lateral: metros -> pixels (y para cima)
    // duas passadas por área: 1ª = contorno grosso de tinta (canal azul), 2ª = preenchimento (vermelho)
    const area = (clip, tf, draw) => [true, false].forEach(ink => {
      g.save(); g.beginPath(); g.rect(...clip); g.clip(); g.setTransform(...tf);
      if (ink) { g.fillStyle = BLUE; g.strokeStyle = BLUE; g.lineWidth = 0.075; g.lineJoin = 'round'; g.lineCap = 'round';
        Object.defineProperty(g, 'fillStyle', { get: () => BLUE, set() {}, configurable: true });
        const f = g.fill, fr = g.fillRect; g.fill = function () { f.apply(g, arguments); g.stroke(); }; g.fillRect = function (x, y, w, h) { fr.call(g, x, y, w, h); g.strokeRect(x, y, w, h); };
        draw(); delete g.fill; delete g.fillRect; delete g.fillStyle; }
      else { g.fillStyle = RED; g.strokeStyle = RED; draw(); }
      g.restore(); });
    if (p.side) area([0, 0, A, A / 2], [A / L, 0, 0, -(A / 2) / H, 0, A / 2], () => p.side(g, L, H));
    if (p.top) area([0, A / 2, A / 2, A / 2], [(A / 2) / W, 0, 0, -(A / 2) / LT, 0, A], () => p.top(g, W, LT));
    // número: disco branco (verde) com algarismos na cor do adesivo (vermelho)
    if (number) {
      const cx = A * 0.75, cy = A * 0.75, r = A * 0.23;
      g.fillStyle = BLUE; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = GREEN; g.beginPath(); g.arc(cx, cy, r * 0.88, 0, Math.PI * 2); g.fill();
      g.font = '700 ' + Math.round(r * (String(number).length > 1 ? 1.1 : 1.35)) + 'px ' + CFG.FONT_DISPLAY; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = r * 0.16; g.strokeStyle = BLUE; g.strokeText(String(number), cx, cy + r * 0.06);
      g.fillStyle = RED; g.fillText(String(number), cx, cy + r * 0.06);
    }
    const t = new THREE.CanvasTexture(c); t.anisotropy = TX.aniso; t.minFilter = THREE.LinearMipmapLinearFilter;
    cache.set(key, t);
    while (cache.size > 10) { const k = cache.keys().next().value; cache.get(k).dispose(); cache.delete(k); }
    return t;
  }

  window.Livery = {
    patterns: PATTERNS,
    register(p) { PATTERNS.push(p); },
    // monta os parâmetros do shader para um modelo (box = caixas de projeção declaradas pelo modelo)
    build(spec, box) {
      const num = spec.number | 0, on = spec.decal !== 'none' || num > 0;
      const dims = [box.side[1] - box.side[0], box.side[3] - box.side[2], box.top[1] - box.top[0], box.top[3] - box.top[2]];
      return {
        on, color: spec.decalColor, texture: texture(spec.decal, num, dims), side: box.side, top: box.top,
        numSide: box.numSide ? box.numSide.concat(num > 0 ? 1 : 0) : [0, 0, 1, 0], numTop: box.numTop ? box.numTop.concat(num > 0 ? 1 : 0) : [0, 0, 1, 0]
      };
    }
  };
})();
