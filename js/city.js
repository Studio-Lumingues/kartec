// =====================================================================================
// city.js — identidade brasileira da pista "Cidade" (chamado por Tracks.build dentro de buildCity)
//
//   CityKit.reserve(ctx)  -> ANTES dos prédios: escolhe e reserva o espaço da praça e dos morros
//   CityKit.build(ctx)    -> DEPOIS dos prédios e postes: monta tudo o que foi reservado + detalhes de rua
//
// O que entra:
//   * Praça com fonte de três taças (água animada, jatos e respingos) e piso de pedras portuguesas em ondas,
//     bancos, canteiros e luminárias de jardim — ponto de referência na parte de dentro de uma curva.
//   * Morros com favela: relevo próprio (encostas de terra e rocha, topo verde) longe da pista, com casinhas
//     de 1 a 3 andares assentadas no terreno (a parede desce até o chão mais baixo do lote), laje ou telha de
//     fibrocimento, caixa-d'água azul, janelas e portas.
//   * Térreo dos prédios virado para a rua: portarias com porta de vidro e marquise, lojas com porta de aço
//     de enrolar e letreiro (padaria, farmácia, bar...), em módulos de um atlas de textura.
//   * Grafites coloridos nas laterais e pichações no alto das fachadas e em muros (atlas transparente).
//   * Mobiliário urbano: bancos, lixeiras laranja, pontos de ônibus, placas de rua azuis, placas de trânsito
//     (PARE, proibido estacionar, velocidade, curva) e fiação aérea entre os postes.
//
// Desempenho: cada família de objetos é UMA chamada de desenho (InstancedMesh ou geometria fundida com UV
// de atlas). Nenhuma textura nova é maior que 1024 px.
// =====================================================================================
(function () {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const INK = '#2a1d4a';

  // ---------- utilidades de geometria fundida ----------
  // acumulador de quads (posição, normal, uv) -> uma BufferGeometry no fim
  function QuadBuf() { this.p = []; this.n = []; this.uv = []; }
  // c = centro, r = direção "direita", u = "cima", n = normal; w,h = tamanho; t = [u0, v0, u1, v1] no atlas
  QuadBuf.prototype.quad = function (c, r, u, n, w, h, t) {
    const hw = w / 2, hh = h / 2, P = (sx, sy) => [c.x + r.x * sx * hw + u.x * sy * hh, c.y + r.y * sx * hw + u.y * sy * hh, c.z + r.z * sx * hw + u.z * sy * hh];
    const a = P(-1, -1), b = P(1, -1), cc = P(1, 1), d = P(-1, 1);
    this.p.push(...a, ...b, ...cc, ...a, ...cc, ...d);
    for (let i = 0; i < 6; i++) this.n.push(n.x, n.y, n.z);
    this.uv.push(t[0], t[1], t[2], t[1], t[2], t[3], t[0], t[1], t[2], t[3], t[0], t[3]);
  };
  QuadBuf.prototype.geometry = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere(); return g;
  };
  // geometria com cor por vértice (para instanciar objetos de várias cores com UM material)
  function colored(geo, hex, m4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); if (m4) g.applyMatrix4(m4); if (g.attributes.uv) g.deleteAttribute('uv');
    const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
  }
  function merge(parts) {
    let n = 0; parts.forEach(p => n += p.attributes.position.count);
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3); let o = 0;
    parts.forEach(p => { P.set(p.attributes.position.array, o * 3); N.set(p.attributes.normal.array, o * 3); C.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; p.dispose(); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.computeBoundingSphere(); return g;
  }
  const M4 = (x, y, z, sx, sy, sz, rx, ry, rz) => new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)), V3(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz));
  // InstancedMesh a partir de uma lista { x, y, z, ry, sx, sy, sz, c }
  function instanced(geo, mat, list, opts) {
    if (!list.length) return null; opts = opts || {};
    const im = new THREE.InstancedMesh(geo, mat, list.length), d = new THREE.Object3D(), col = new THREE.Color();
    list.forEach((o, i) => { d.position.set(o.x, o.y, o.z); d.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0); d.scale.set(o.sx || 1, o.sy || o.sx || 1, o.sz || o.sx || 1); d.updateMatrix(); im.setMatrixAt(i, d.matrix);
      if (opts.color) im.setColorAt(i, col.set(o.c !== undefined ? o.c : 0xffffff)); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = !!opts.shadow; im.receiveShadow = false; im.userData.noOutline = true;
    // esfera envolvente cobrindo todas as instâncias (frustum culling correto)
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const box = new THREE.Box3(); list.forEach(o => box.expandByPoint(V3(o.x, o.y, o.z)));
    const s = new THREE.Sphere(); box.getBoundingSphere(s); s.radius += geo.boundingSphere.radius * Math.max(...list.map(o => Math.max(o.sx || 1, o.sy || o.sx || 1, o.sz || o.sx || 1)));
    const g2 = new THREE.BufferGeometry(); for (const k in geo.attributes) g2.setAttribute(k, geo.attributes[k]); if (geo.index) g2.setIndex(geo.index); g2.boundingSphere = s; im.geometry = g2;
    return im;
  }

  // ---------- texturas (atlas em canvas) ----------
  const cv = (w, h) => TX.cvs(w, h);
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  // pedras portuguesas: ondas pretas sobre branco, com "pedrinhas" (textura repetível)
  function pedrasTex() {
    const c = cv(512, 512), g = c.getContext('2d'); g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#26232a';
    for (let band = -1; band < 5; band++) { g.beginPath(); for (let x = 0; x <= 512; x += 4) { const y = band * 128 + 40 + Math.sin(x / 512 * Math.PI * 4) * 30; x ? g.lineTo(x, y) : g.moveTo(x, y); }
      for (let x = 512; x >= 0; x -= 4) { const y = band * 128 + 82 + Math.sin(x / 512 * Math.PI * 4) * 30; g.lineTo(x, y); } g.closePath(); g.fill(); }
    // juntas das pedrinhas (grade irregular)
    let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    g.strokeStyle = 'rgba(120,110,100,.35)'; g.lineWidth = 1;
    for (let y = 0; y < 512; y += 9) for (let x = 0; x < 512; x += 9) { g.strokeRect(x + r() * 2, y + r() * 2, 7 + r() * 2, 7 + r() * 2); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = TX.aniso; return t;
  }
  // térreo: atlas 1024x512 com 4x4 módulos (256x128 cada); módulo 15 = parede lisa (laterais e topo)
  const SHOPS = ['PADARIA', 'FARMÁCIA', 'BAR DO ZÉ', 'AÇOUGUE', 'LANCHONETE', 'MERCADINHO', 'SALÃO', 'PASTELARIA', 'SORVETERIA', 'PAPELARIA'];
  function storefrontAtlas(lit) {
    const c = cv(1024, 512), g = c.getContext('2d'); if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 512); }
    let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const walls = ['#e9dcc4', '#d8e4ea', '#f0d2c0', '#e2e8d0', '#ece2f0', '#f4e6b8'];
    for (let k = 0; k < 16; k++) {
      const x0 = (k % 4) * 256, y0 = Math.floor(k / 4) * 128; g.save(); g.beginPath(); g.rect(x0, y0, 256, 128); g.clip(); g.translate(x0, y0);
      const kind = k === 15 ? 'wall' : k < 5 ? 'lobby' : k < 12 ? 'shop' : 'shut';
      if (!lit) { g.fillStyle = walls[k % walls.length]; g.fillRect(0, 0, 256, 128); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 116, 256, 12); }      // rodapé
      if (kind === 'lobby') {   // portaria: porta dupla de vidro com caixilho, número, interfone e floreira
        if (lit) { g.fillStyle = '#ffe2a0'; g.fillRect(84, 34, 88, 82); }
        else { g.fillStyle = INK; rr(g, 78, 28, 100, 92, 6); g.fill(); g.fillStyle = '#7fb8d8'; g.fillRect(86, 36, 40, 80); g.fillRect(130, 36, 40, 80);
          g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(90, 40, 10, 40); g.fillRect(134, 40, 10, 40); g.fillStyle = '#c8a050'; g.fillRect(120, 72, 4, 14); g.fillRect(132, 72, 4, 14);
          g.fillStyle = '#2a64c8'; rr(g, 196, 40, 34, 22, 4); g.fill(); g.fillStyle = '#fff'; g.font = '700 16px ' + CFG.FONT_UI; g.textAlign = 'center'; g.fillText(String(100 + ((r() * 900) | 0)), 213, 57);
          g.fillStyle = '#555'; g.fillRect(200, 70, 12, 18); g.fillStyle = '#5a3a22'; g.fillRect(14, 96, 52, 20); g.fillStyle = '#4caf50'; [24, 40, 56].forEach(x => { g.beginPath(); g.arc(x, 92, 10, 0, 7); g.fill(); }); }
      } else if (kind === 'shop') {   // loja: letreiro + porta de aço meio aberta + vitrine
        const sign = SHOPS[k % SHOPS.length], col = ['#e8302a', '#2a5ce8', '#1a8a3a', '#ff7a1a', '#8a3ae0', '#d81b60', '#00838f'][k % 7];
        if (lit) { g.fillStyle = '#ffd890'; g.fillRect(24, 64, 208, 52); g.fillStyle = '#fff6d0'; g.fillRect(16, 8, 224, 30); }
        else { g.fillStyle = col; rr(g, 12, 6, 232, 34, 6); g.fill(); g.font = '800 22px ' + CFG.FONT_UI; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(sign, 128, 24);
          g.fillStyle = '#3a2e2a'; g.fillRect(20, 44, 216, 76);
          g.fillStyle = '#b8bec8'; g.fillRect(24, 46, 208, 30); g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 48; y < 76; y += 5) g.fillRect(24, y, 208, 1.5);   // porta de enrolar (metade de cima)
          g.fillStyle = '#ffcf7a'; g.fillRect(24, 78, 208, 38); g.fillStyle = 'rgba(80,40,20,.55)'; for (let i = 0; i < 6; i++) g.fillRect(34 + i * 34, 88 + (i % 2) * 6, 20, 26 - (i % 2) * 6); }   // interior aceso
      } else if (kind === 'shut') {   // porta de aço fechada (com rabiscos)
        if (!lit) { g.fillStyle = '#9aa2ae'; g.fillRect(16, 16, 224, 104); g.fillStyle = 'rgba(0,0,0,.22)'; for (let y = 18; y < 120; y += 6) g.fillRect(16, y, 224, 2);
          g.strokeStyle = '#1a1a1a'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); for (let i = 0; i < 5; i++) { const x = 40 + i * 36; g.moveTo(x, 90); g.lineTo(x + 6, 50); g.lineTo(x + 14, 92); g.moveTo(x + 4, 72); g.lineTo(x + 14, 70); } g.stroke(); }
      } else if (!lit) { g.fillStyle = 'rgba(0,0,0,.06)'; for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 256, 1); }
      g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.anisotropy = TX.aniso; return t;
  }
  const tileUV = (k, inset) => { const e = inset || 0.002, u0 = (k % 4) / 4, v1 = 1 - Math.floor(k / 4) / 4; return [u0 + e, v1 - 0.25 + e, u0 + 0.25 - e, v1 - e]; };
  // grafites (8 peças coloridas) + pichações (4), atlas 1024² transparente: 2 colunas x 6 linhas de 512x170
  function graffitiAtlas() {
    const c = cv(1024, 1024), g = c.getContext('2d'), words = ['KARTEC', 'VAI!', 'TURBO', 'DRIFT', 'SAMBA', 'RUA', 'ZL 99', 'BR!'];
    const pal = [['#ff4d9a', '#ffd23f'], ['#3dd6ff', '#7a3cff'], ['#2ee6a8', '#ffd23f'], ['#ff7a1a', '#ff4d6d'], ['#ffd23f', '#2ee6a8'], ['#b08aff', '#ff4d9a'], ['#ff4d6d', '#3dd6ff'], ['#2ee6a8', '#ff7a1a']];
    for (let k = 0; k < 12; k++) {
      const x0 = (k % 2) * 512, y0 = Math.floor(k / 2) * 170; g.save(); g.translate(x0 + 256, y0 + 88);
      if (k < 8) {   // grafite "bubble letters": sombra, contorno grosso, degradê, brilho
        const [a, b] = pal[k], txt = words[k]; g.font = '900 ' + (txt.length > 5 ? 92 : 112) + 'px ' + CFG.FONT_DISPLAY; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
        g.rotate((k % 2 ? 1 : -1) * 0.06);
        g.lineWidth = 30; g.strokeStyle = '#1a1030'; g.strokeText(txt, 8, 10);
        g.lineWidth = 22; g.strokeStyle = '#fff'; g.strokeText(txt, 0, 0);
        const gr = g.createLinearGradient(0, -50, 0, 50); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillText(txt, 0, 0);
        g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.7)'; g.strokeText(txt, -3, -4);
        g.fillStyle = '#fff'; [[-200, -50], [190, 40], [-150, 50]].forEach(([x, y]) => { g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x + 4, y - 3); g.lineTo(x + 12, y); g.lineTo(x + 4, y + 3); g.lineTo(x, y + 12); g.lineTo(x - 4, y + 3); g.lineTo(x - 12, y); g.lineTo(x - 4, y - 3); g.closePath(); g.fill(); });
      } else {   // pichação: letras altas e angulosas, traço preto fino (estilo "pixo")
        let s = 31 + k * 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
        g.strokeStyle = '#141018'; g.lineWidth = 7; g.lineCap = 'square'; g.lineJoin = 'miter';
        const n = 6 + (k % 3); for (let i = 0; i < n; i++) { const x = -230 + i * (460 / n), H = 120; g.beginPath();
          const kind = (r() * 5) | 0;
          if (kind === 0) { g.moveTo(x, H / 2); g.lineTo(x, -H / 2); g.lineTo(x + 40, -H / 2); g.moveTo(x, 0); g.lineTo(x + 30, 0); }
          else if (kind === 1) { g.moveTo(x, H / 2); g.lineTo(x + 20, -H / 2); g.lineTo(x + 40, H / 2); g.moveTo(x + 8, 10); g.lineTo(x + 32, 10); }
          else if (kind === 2) { g.moveTo(x, -H / 2); g.lineTo(x, H / 2); g.moveTo(x + 36, -H / 2); g.lineTo(x + 36, H / 2); g.moveTo(x, -10); g.lineTo(x + 36, 10); }
          else if (kind === 3) { g.moveTo(x + 40, -H / 2); g.lineTo(x, -H / 2); g.lineTo(x, H / 2); g.lineTo(x + 40, H / 2); }
          else { g.moveTo(x, H / 2); g.lineTo(x, -H / 2); g.lineTo(x + 20, -10); g.lineTo(x + 40, -H / 2); g.lineTo(x + 40, H / 2); }
          g.stroke(); }
        g.lineWidth = 4; g.beginPath(); g.moveTo(-240, 72); g.lineTo(240, 66); g.stroke();
      }
      g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.anisotropy = TX.aniso; return t;
  }
  const grafUV = k => { const u0 = (k % 2) / 2, v1 = 1 - Math.floor(k / 2) * 170 / 1024; return [u0 + 0.004, v1 - 170 / 1024 + 0.004, u0 + 0.5 - 0.004, v1 - 0.004]; };
  // placas: atlas 512² com 4x4 (128 cada)
  const STREETS = ['R. DAS FLORES', 'AV. BRASIL', 'R. XV DE NOV.', 'AV. ATLÂNTICA', 'R. DO SAMBA', 'AV. DO KART'];
  function signAtlas() {
    const c = cv(512, 512), g = c.getContext('2d');
    const T = (k, f) => { const x0 = (k % 4) * 128, y0 = Math.floor(k / 4) * 128; g.save(); g.translate(x0, y0); f(); g.restore(); };
    // 0..5: placas de rua azuis (2:1, ocupam a metade de cima do quadro)
    STREETS.forEach((name, k) => T(k, () => { g.fillStyle = '#1e4fb4'; rr(g, 2, 32, 124, 62, 8); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 3; rr(g, 6, 36, 116, 54, 6); g.stroke();
      g.fillStyle = '#fff'; g.font = '800 15px ' + CFG.FONT_UI; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 64, 63); }));
    T(6, () => { g.fillStyle = '#fff'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); } g.closePath(); g.fill();
      g.fillStyle = '#d81b1b'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g.lineTo(64 + Math.cos(a) * 54, 64 + Math.sin(a) * 54); } g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.font = '900 34px ' + CFG.FONT_UI; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PARE', 64, 66); });
    T(7, () => { g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.lineWidth = 12; g.strokeStyle = '#d81b1b'; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke();
      g.fillStyle = '#111'; g.font = '900 54px ' + CFG.FONT_UI; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('E', 64, 68); g.beginPath(); g.moveTo(28, 28); g.lineTo(100, 100); g.stroke(); });
    T(8, () => { g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.lineWidth = 12; g.strokeStyle = '#d81b1b'; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke();
      g.fillStyle = '#111'; g.font = '900 40px ' + CFG.FONT_UI; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('40', 64, 62); g.font = '800 14px ' + CFG.FONT_UI; g.fillText('km/h', 64, 92); });
    T(9, () => { g.save(); g.translate(64, 64); g.rotate(Math.PI / 4); g.fillStyle = '#111'; g.fillRect(-44, -44, 88, 88); g.fillStyle = '#ffd21a'; g.fillRect(-40, -40, 80, 80); g.restore();
      g.strokeStyle = '#111'; g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.moveTo(52, 92); g.lineTo(52, 60); g.quadraticCurveTo(52, 40, 74, 40); g.stroke(); g.fillStyle = '#111'; g.beginPath(); g.moveTo(70, 28); g.lineTo(88, 40); g.lineTo(70, 52); g.closePath(); g.fill(); });
    T(10, () => { g.fillStyle = '#1e4fb4'; rr(g, 4, 4, 120, 120, 12); g.fill(); g.fillStyle = '#fff'; g.font = '900 64px ' + CFG.FONT_UI; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P', 64, 68); });
    T(11, () => { g.fillStyle = '#1e4fb4'; rr(g, 4, 4, 120, 120, 12); g.fill(); g.fillStyle = '#fff'; g.fillRect(30, 36, 68, 38); g.fillStyle = '#1e4fb4'; g.fillRect(36, 42, 56, 16); g.fillStyle = '#fff'; [44, 84].forEach(x => { g.beginPath(); g.arc(x, 82, 9, 0, 7); g.fill(); }); g.font = '800 14px ' + CFG.FONT_UI; g.textAlign = 'center'; g.fillText('ÔNIBUS', 64, 110); });
    const t = new THREE.CanvasTexture(c); t.anisotropy = TX.aniso; return t;
  }
  const signUV = (k, half) => { const u0 = (k % 4) / 4, v1 = 1 - Math.floor(k / 4) / 4; return half ? [u0 + 0.004, v1 - 0.25 + 0.25 * 0.26, u0 + 0.25 - 0.004, v1 - 0.25 * 0.24] : [u0 + 0.004, v1 - 0.25 + 0.004, u0 + 0.25 - 0.004, v1 - 0.004]; };

  // ---------- relevo dos morros ----------
  function hillHeight(hills, x, z) {
    let best = 0;
    for (const H of hills) { const d = Math.hypot(x - H.x, z - H.z); if (d >= H.R) continue; const t = d / H.R;
      const n = Math.sin(x * 0.045 + H.seed) * Math.cos(z * 0.038 - H.seed * 1.3) + 0.5 * Math.sin(x * 0.11 - z * 0.09 + H.seed * 2.1);
      const h = H.H * Math.pow(1 - t * t, 1.5) + n * H.H * 0.07 * (1 - t); if (h > best) best = h; }
    return best;
  }

  const CityKit = {
    // ---------------------------------------------------------------------------------------------------
    // reserva de espaço (antes dos prédios): praça numa curva visível + até 3 morros longe da pista
    // ---------------------------------------------------------------------------------------------------
    reserve(ctx) {
      const { T, S, N, W, side, nearTrack, nearRail, nearTunnel, inTun, si, blocks, rnd } = ctx, plan = { plaza: null, hills: [] };
      // ---- praça: centro do lado de dentro de uma curva fechada, perto da largada (vista logo na 1ª volta) ----
      const curv = i => { const a = T[(i - 12 + N) % N], b = T[(i + 12) % N]; return Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z); };   // giro em ~80 m
      const order = []; for (let k = 0; k < N; k++) order.push((si + 40 + k) % N);
      for (const i of order) {
        const c = curv(i); if (Math.abs(c) < 0.6 || inTun(i, 30)) continue;
        // lado de dentro: o ponto lateral que fica mais longe da pista vizinha
        for (const sgn of [1, -1]) { const R = 36, q = side(i, sgn * (W + 12 + R), 0);
          if (nearTrack({ x: q.x, z: q.z }, W + 10 + R) || nearRail(q.x, q.z, R + 6) || nearTunnel(q.x, q.z, R + 4) || Math.hypot(q.x - S[si].x, q.z - S[si].z) < 90) continue;
          plan.plaza = { x: q.x, z: q.z, R, i, face: Math.atan2(S[i].x - q.x, S[i].z - q.z) }; break; }
        if (plan.plaza) break;
      }
      if (plan.plaza) blocks.push({ x: plan.plaza.x, z: plan.plaza.z, r: plan.plaza.R + 4 });
      // ---- morros: pontos de maior folga em relação à pista, à linha do trem e entre si ----
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; S.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
      const dTrack = (x, z) => { let m = 1e9; for (let i = 0; i < N; i += 2) { const p = S[i], d = Math.hypot(p.x - x, p.z - z); if (d < m) m = d; } return m; };
      const cands = [];
      for (let x = x0 - 360; x <= x1 + 360; x += 30) for (let z = z0 - 360; z <= z1 + 360; z += 30) {
        const d = dTrack(x, z) - W - 30; if (d < 95) continue;
        const R = Math.min(150, d - 5); if (nearRail(x, z, R + 12) || nearTunnel(x, z, R + 10)) continue;
        if (plan.plaza && Math.hypot(x - plan.plaza.x, z - plan.plaza.z) < R + plan.plaza.R + 20) continue;
        cands.push({ x, z, R, d: d + rnd() * 12 });
      }
      cands.sort((a, b) => a.d - b.d);                                   // os mais PRÓXIMOS da pista primeiro (sem encostar nela): o morro aparece na corrida
      for (const c of cands) { if (plan.hills.length >= 3) break;
        if (plan.hills.some(h => Math.hypot(h.x - c.x, h.z - c.z) < h.R + c.R + 40)) continue;
        if (blocks.some(b => Math.hypot(b.x - c.x, b.z - c.z) < b.r + c.R + 6)) continue;
        plan.hills.push({ x: c.x, z: c.z, R: c.R, H: c.R * (0.34 + rnd() * 0.08), seed: rnd() * 10 }); blocks.push({ x: c.x, z: c.z, r: c.R + 6 });
        // corredor de visão: nenhum prédio entre o morro e o trecho de pista mais próximo (o morro aparece na corrida)
        let bi = 0, bd = 1e9; for (let i = 0; i < N; i += 2) { const d = Math.hypot(S[i].x - c.x, S[i].z - c.z); if (d < bd) { bd = d; bi = i; } }
        for (const di of [-24, 0, 24]) { const t = S[(bi + di + N) % N], L = Math.hypot(t.x - c.x, t.z - c.z);
          for (let r = c.R; r < L - W - 12; r += 20) { const f = r / L; blocks.push({ x: c.x + (t.x - c.x) * f, z: c.z + (t.z - c.z) * f, r: 16 }); } } }
      return plan;
    },

    // ---------------------------------------------------------------------------------------------------
    build(ctx, plan) {
      const { tr, T, S, N, W, side, inTun, si, add, rnd, plants, glowSpr } = ctx;
      const group = new THREE.Group(); group.userData.dynamic = true; add(group);   // tudo aqui já é instanciado/fundido
      const out = { plaza: !!plan.plaza, hills: plan.hills.length };
      this.hills(ctx, plan.hills, group, out);
      if (plan.plaza) this.plaza(ctx, plan.plaza, group, out);
      this.streetLevel(ctx, group, out);
      this.furniture(ctx, group, out);
      return out;
    },

    // ---------- morros com favela ----------
    hills(ctx, hills, group, out) {
      if (!hills.length) return;
      const { tr, rnd } = ctx, H = (x, z) => hillHeight(hills, x, z);
      // relevo: grade polar com saia abaixo do chão; cor por inclinação (rocha nas encostas íngremes,
      // terra batida na faixa das casas, grama no topo e no pé)
      const parts = [];
      hills.forEach(h => {
        const RJ = 22, SG = 64, pos = [], col = [], idx = [], cG = new THREE.Color(0x4f9a3a), cG2 = new THREE.Color(0x6aae48), cD = new THREE.Color(0x8b5a3c), cR = new THREE.Color(0x7d746c), tmp = new THREE.Color();
        for (let j = 0; j <= RJ; j++) for (let k = 0; k < SG; k++) {
          const t = j / RJ * 1.06, a = k / SG * Math.PI * 2, x = h.x + Math.cos(a) * t * h.R, z = h.z + Math.sin(a) * t * h.R;
          const y = t >= 1 ? -1.5 : Math.max(0.05, H(x, z)) - (t > 0.97 ? 0.4 : 0);
          pos.push(x, y, z);
          const gx = H(x + 2, z) - H(x - 2, z), gz = H(x, z + 2) - H(x, z - 2), slope = Math.hypot(gx, gz) / 4;
          const n = 0.5 + 0.5 * Math.sin(x * 0.21 + z * 0.17 + h.seed), band = t > 0.2 && t < 0.92;
          tmp.copy(n > 0.5 ? cG : cG2); if (band) tmp.lerp(cD, 0.55 + 0.3 * n); if (slope > 0.85) tmp.lerp(cR, Math.min(1, (slope - 0.85) * 2.5));
          col.push(tmp.r, tmp.g, tmp.b);
        }
        for (let j = 0; j < RJ; j++) for (let k = 0; k < SG; k++) { const a = j * SG + k, b = j * SG + (k + 1) % SG, c = (j + 1) * SG + k, d = (j + 1) * SG + (k + 1) % SG; idx.push(a, b, c, b, d, c); }   // ordem anti-horária vista de cima: normais para fora
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
        parts.push(g);
        tr.blockers.push({ x: h.x, y: h.H * 0.4, z: h.z, r: h.R * 0.8 });
        tr.minimap.push({ type: 'hill', x: h.x, z: h.z, r: h.R });
      });
      const hillM = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff });
      parts.forEach(g => { const m = new THREE.Mesh(g, hillM); m.receiveShadow = true; m.userData.noOutline = true; group.add(m); });
      // casinhas: em anéis (terraços) na faixa do meio do morro, de frente para a encosta abaixo
      const walls = [], slabs = [], tiles = [], tanks = [], lids = [], wins = [], doors = [];
      const paint = [0xc86b3c, 0xc86b3c, 0xb85a30, 0x9c9c9c, 0xf2c7d4, 0xfce38a, 0xa8dcf0, 0xb8e0a0, 0xd8c4f0, 0xf4f4ec, 0xffb38a];
      hills.forEach(h => {
        for (let ring = 0; ring < 10; ring++) {
          const rr0 = h.R * (0.2 + ring * 0.074), circ = Math.PI * 2 * rr0, n = Math.floor(circ / 7.6), a0 = rnd() * 6.28;
          for (let k = 0; k < n; k++) {
            if (rnd() < 0.16) continue;
            const a = a0 + k / n * Math.PI * 2 + (rnd() - 0.5) * 0.04, r1 = rr0 + (rnd() - 0.5) * 2.5, x = h.x + Math.cos(a) * r1, z = h.z + Math.sin(a) * r1;
            const w = 4.2 + rnd() * 2.6, d = 4 + rnd() * 2.2, floors = 1 + ((rnd() * 2.6) | 0), ry = Math.atan2(Math.cos(a), Math.sin(a)) + (rnd() - 0.5) * 0.35;
            const ca = Math.cos(ry), sa = Math.sin(ry), L = (lx, lz) => [x + lx * ca + lz * sa, z - lx * sa + lz * ca];
            let ymin = 1e9, ymax = -1e9; [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].forEach(([u, v]) => { const [px, pz] = L(u * w / 2, v * d / 2), y = H(px, pz); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); });
            if (ymax - ymin > 5.5) continue;                                // encosta íngreme demais para a casa
            const bottom = ymin - 0.5, top = ymax + floors * 2.7;
            walls.push({ x, y: bottom, z, ry, sx: w, sy: top - bottom, sz: d, c: paint[(rnd() * paint.length) | 0] });
            if (rnd() < 0.32) tiles.push({ x, y: top + 0.35, z, ry, rx: 0.16, sx: w + 0.6, sy: 1, sz: d + 0.6 });
            else { slabs.push({ x, y: top, z, ry, sx: w + 0.3, sy: 1, sz: d + 0.3 });
              if (rnd() < 0.85) { const [tx, tz] = L((rnd() < 0.5 ? -1 : 1) * w * 0.22, (rnd() < 0.5 ? -1 : 1) * d * 0.2); tanks.push({ x: tx, y: top + 0.2, z: tz, ry: 0 }); lids.push({ x: tx, y: top + 1.18, z: tz, ry: 0 }); } }
            // fachada (frente = +z local, virada para baixo do morro): porta no térreo e janelas por andar
            const [fx, fz] = L(0, d / 2), groundF = H(fx, fz), firstY = Math.max(groundF, top - floors * 2.7);
            const [dx, dz] = L(-w * 0.22, d / 2 + 0.04); doors.push({ x: dx, y: firstY + 1.05, z: dz, ry });
            for (let f = 0; f < floors; f++) { const y = top - 1.35 - f * 2.7; if (y < groundF + 0.9) continue;
              (w > 5.2 ? [-0.24, 0.24] : [0.2]).forEach(u => { if (f === floors - 1 && u < 0 && Math.abs(y - (firstY + 1.05)) < 1.2) return; const [wx, wz] = L(u * w, d / 2 + 0.04); wins.push({ x: wx, y, z: wz, ry }); }); }
          }
        }
      });
      const unitBox = new THREE.BoxGeometry(1, 1, 1); unitBox.translate(0, 0.5, 0);
      const wallM = new THREE.MeshLambertMaterial({ color: 0xffffff }), slabM = new THREE.MeshLambertMaterial({ color: 0xa4a4ac }), tileM = new THREE.MeshLambertMaterial({ color: 0x8aa0b4 });
      const tankM = new THREE.MeshLambertMaterial({ color: 0x2a6cd8 }), winM = new THREE.MeshLambertMaterial({ color: 0x2a3550 }), doorM = new THREE.MeshLambertMaterial({ color: 0x6a3e22 });
      [instanced(unitBox, wallM, walls, { color: true, shadow: true }), instanced(new THREE.BoxGeometry(1, 0.22, 1), slabM, slabs), instanced(new THREE.BoxGeometry(1, 0.14, 1), tileM, tiles),
        instanced(new THREE.CylinderGeometry(0.62, 0.62, 0.98, 12).translate(0, 0.49, 0), tankM, tanks), instanced(new THREE.ConeGeometry(0.7, 0.3, 12), tankM, lids),
        instanced(new THREE.BoxGeometry(1.0, 1.0, 0.1), winM, wins), instanced(new THREE.BoxGeometry(0.95, 2.0, 0.1), doorM, doors)].forEach(m => m && group.add(m));
      out.houses = walls.length;
    },

    // ---------- praça com fonte ----------
    plaza(ctx, P, group, out) {
      const { tr, rnd, plants, glowSpr } = ctx, R = P.R;
      // piso de pedras portuguesas + meio-fio de granito
      const floorM = new THREE.MeshLambertMaterial({ map: pedrasTex(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }); floorM.map.repeat.set(R / 4.5, R / 4.5);
      const fl = new THREE.Mesh(new THREE.CircleGeometry(R, 64), floorM); fl.rotation.x = -Math.PI / 2; fl.position.set(P.x, 0.09, P.z); fl.receiveShadow = true; group.add(fl);
      const curb = new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 6, 72).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xc8c4bc })); curb.scale.y = 0.6; curb.position.set(P.x, 0.12, P.z); group.add(curb);
      // fonte: tanque, coluna e duas taças (perfis de torno fechados)
      const stone = new THREE.MeshLambertMaterial({ color: 0xe6dfd2 }), stoneD = new THREE.MeshLambertMaterial({ color: 0xc9bfae });
      const lathe = (pts, m, y) => { const o = new THREE.Mesh(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), 40), m); o.position.set(P.x, y, P.z); o.castShadow = true; o.receiveShadow = true; group.add(o); return o; };
      lathe([[0, 0], [7.4, 0], [7.6, 0.25], [7.6, 1.0], [7.0, 1.1], [6.8, 0.95], [6.8, 0.3], [0, 0.3]], stone, 0.08);
      lathe([[0, 0], [1.2, 0], [1.0, 0.4], [0.62, 0.9], [0.55, 2.6], [0.8, 2.9], [0, 2.9]], stoneD, 0.3);
      lathe([[0, 0], [0.5, 0], [2.0, 0.3], [3.0, 0.75], [3.1, 1.0], [2.9, 1.05], [2.0, 0.6], [0, 0.45]], stone, 3.0);
      lathe([[0, 0], [0.35, 0], [0.4, 1.4], [0.6, 1.6], [0, 1.6]], stoneD, 3.6);
      lathe([[0, 0], [0.3, 0], [1.1, 0.2], [1.5, 0.5], [1.55, 0.7], [1.4, 0.72], [0.9, 0.4], [0, 0.32]], stone, 5.0);
      lathe([[0, 0], [0.18, 0], [0.12, 0.6], [0.25, 0.8], [0, 1.05]], stoneD, 5.6);
      // água: espelhos com ondinhas + cortinas caindo das bordas das taças (textura rolando) + jato central
      const rip = TX.get('ripple', 3, 3), waterM = new THREE.MeshLambertMaterial({ map: rip, color: 0x7fd4ff, transparent: true, opacity: 0.85, depthWrite: false });
      [[6.9, 0.98], [2.95, 3.95], [1.45, 5.6]].forEach(([r, y]) => { const w = new THREE.Mesh(new THREE.CircleGeometry(r, 40), waterM); w.rotation.x = -Math.PI / 2; w.position.set(P.x, y, P.z); w.renderOrder = 2; group.add(w); });
      const fallTex = TX.get('ripple', 4, 1); const fallM = new THREE.MeshBasicMaterial({ map: fallTex, color: 0xc8f0ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
      [[3.05, 4.0, 3.0], [1.52, 5.68, 1.7]].forEach(([r, yTop, hgt]) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.05, r + 0.4, hgt, 40, 1, true), fallM); c.position.set(P.x, yTop - hgt / 2, P.z); c.renderOrder = 3; group.add(c); });
      const jet = new THREE.Mesh(new THREE.ConeGeometry(0.16, 2.2, 10, 1, true), fallM); jet.position.set(P.x, 7.7, P.z); jet.renderOrder = 3; group.add(jet);
      // respingos: 70 gotinhas instanciadas em parábola (1 chamada de desenho, sem alocação por quadro)
      const DN = 70, drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ color: 0xe8f8ff }), DN), dd = [], d0 = new THREE.Object3D();
      for (let i = 0; i < DN; i++) dd.push({ a: rnd() * 6.28, sp: 1.5 + rnd() * 1.5, ph: rnd() });
      drops.frustumCulled = false; drops.userData.noOutline = true; group.add(drops);
      tr.animated.push((t, dt) => { fallTex.offset.y = (fallTex.offset.y - (dt || 0.016) * 0.9) % 1; rip.offset.x = (rip.offset.x + (dt || 0.016) * 0.02) % 1;
        for (let i = 0; i < DN; i++) { const o = dd[i], k = (t * 0.55 + o.ph) % 1, r = k * o.sp; d0.position.set(P.x + Math.cos(o.a) * r, 8.6 + k * 2.2 - k * k * 6.0, P.z + Math.sin(o.a) * r); d0.updateMatrix(); drops.setMatrixAt(i, d0.matrix); }
        drops.instanceMatrix.needsUpdate = true; });
      // bancos virados para a fonte, luminárias de jardim, canteiros e ipês
      const benches = [], lamps = [], beds = [];
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + 0.2, r = 13; benches.push({ x: P.x + Math.cos(a) * r, y: 0.09, z: P.z + Math.sin(a) * r, ry: Math.atan2(-Math.cos(a), -Math.sin(a)) });
        if (k % 2 === 0) lamps.push({ x: P.x + Math.cos(a + 0.39) * 17, z: P.z + Math.sin(a + 0.39) * 17 }); }
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, r = R - 6; beds.push({ x: P.x + Math.cos(a) * r, z: P.z + Math.sin(a) * r }); }
      this._benchList = (this._benchList || []).concat(benches);
      const bedM = new THREE.MeshLambertMaterial({ color: 0xbfb6a8 });
      beds.forEach(b => { const e = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.6, 20), bedM); e.position.set(b.x, 0.3, b.z); group.add(e);
        const soil = new THREE.Mesh(new THREE.CircleGeometry(3.0, 20), new THREE.MeshLambertMaterial({ color: 0x5a3a22 })); soil.rotation.x = -Math.PI / 2; soil.position.set(b.x, 0.61, b.z); group.add(soil); });
      plants('round', beds.map((b, i) => ({ x: b.x, y: 0.6, z: b.z, r: i, s: 0.8 })), 0xffd21a);
      // ipês e árvores de sombra no contorno da praça (entre os canteiros)
      const ring = []; for (let k = 0; k < 12; k++) { const a = (k + 0.5) / 12 * Math.PI * 2, r = R - 3.5; ring.push({ x: P.x + Math.cos(a) * r, y: 0.09, z: P.z + Math.sin(a) * r, r: k, s: 0.7 + rnd() * 0.25 }); }
      plants('round', ring.filter((_, k) => k % 3 !== 1), 0xff7ab8); plants('round', ring.filter((_, k) => k % 3 === 1), 0x5fd641);
      ring.forEach(o => tr.obstacles.push({ x: o.x, z: o.z, r: 0.5 }));
      const poleM = new THREE.MeshLambertMaterial({ color: 0x2a2c34 }), globeM = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
      const lampPoles = instanced(new THREE.CylinderGeometry(0.1, 0.16, 4.2, 8).translate(0, 2.1, 0), poleM, lamps.map(l => ({ x: l.x, y: 0.09, z: l.z })), { shadow: true });
      const globes = instanced(new THREE.SphereGeometry(0.42, 12, 8), globeM, lamps.map(l => ({ x: l.x, y: 4.6, z: l.z })));
      [lampPoles, globes].forEach(m => m && group.add(m));
      lamps.forEach(l => { const h = glowSpr(0xffd890, 6, 0.4); h.position.set(l.x, 4.6, l.z); tr.lamps.push(h); });
      tr.obstacles.push({ x: P.x, z: P.z, r: 7.8 });
      tr.minimap.push({ type: 'plaza', x: P.x, z: P.z, r: R });
    },

    // ---------- térreo dos prédios (portarias e lojas), grafites e pichações ----------
    streetLevel(ctx, group, out) {
      const { tr, S, N, rnd } = ctx, list = tr.minimap.filter(e => e.type === 'building' && e.h);
      if (!list.length) return;
      const near = (x, z) => { let best = 1e9, bi = 0; for (let i = 0; i < N; i += 2) { const d = (S[i].x - x) ** 2 + (S[i].z - z) ** 2; if (d < best) { best = d; bi = i; } } return { i: bi, d: Math.sqrt(best) }; };
      const shopQ = new QuadBuf(), grafQ = new QuadBuf(), marq = [], up = V3(0, 1, 0);
      const plain = tileUV(15, 0.02);
      list.forEach(b => {
        const nt = near(b.x, b.z); if (nt.d > 140) return;                      // só quem aparece da pista
        const ax = V3(Math.cos(b.rot), 0, -Math.sin(b.rot)), az = V3(Math.sin(b.rot), 0, Math.cos(b.rot)), to = V3(S[nt.i].x - b.x, 0, S[nt.i].z - b.z);
        const lx = to.dot(ax), lz = to.dot(az), useX = Math.abs(lx) / b.w > Math.abs(lz) / b.d;
        const n = useX ? ax.clone().multiplyScalar(Math.sign(lx) || 1) : az.clone().multiplyScalar(Math.sign(lz) || 1);
        const half = useX ? b.w / 2 : b.d / 2, faceW = useX ? b.d : b.w, right = V3(n.z, 0, -n.x);
        // térreo em módulos de ~8,8 m (cada um um quadro do atlas), 15 cm para fora da fachada
        const mods = Math.max(1, Math.round(faceW / 8.8)), mw = (faceW - 0.6) / mods, HH = 4.4;
        for (let m = 0; m < mods; m++) {
          const off = -faceW / 2 + 0.3 + mw * (m + 0.5), c = V3(b.x, HH / 2, b.z).addScaledVector(n, half + 0.16).addScaledVector(right, off);
          const k = m === Math.floor(mods / 2) && rnd() < 0.55 ? (rnd() * 5) | 0 : 5 + ((rnd() * 10) | 0);
          shopQ.quad(c, right, up, n, mw, HH, tileUV(k));
          shopQ.quad(c.clone().addScaledVector(up, HH / 2 + 0.06).addScaledVector(n, -0.08), right, n, up, mw, 0.16, plain);   // topo da faixa
          if (k < 5) marq.push({ x: c.x + n.x * 0.75, y: HH + 0.18, z: c.z + n.z * 0.75, ry: Math.atan2(n.x, n.z), sx: Math.min(mw * 0.8, 6.5), sy: 1, sz: 1.7 });
        }
        // laterais nas pontas da faixa
        [-1, 1].forEach(sd => { const c = V3(b.x, HH / 2, b.z).addScaledVector(n, half + 0.08).addScaledVector(right, sd * (faceW / 2 - 0.3)); shopQ.quad(c, n.clone().multiplyScalar(-sd), up, right.clone().multiplyScalar(sd), 0.16, HH, plain); });
        // grafite na lateral (rente ao chão) e pichação no alto da fachada
        if (rnd() < 0.55) { const sideN = right.clone().multiplyScalar(rnd() < 0.5 ? -1 : 1), sideHalf = useX ? b.d / 2 : b.w / 2, depth = useX ? b.w : b.d;
          const gw = Math.min(depth * 0.8, 11), c = V3(b.x, 1.4 + gw * 0.17, b.z).addScaledVector(sideN, sideHalf + 0.06).addScaledVector(n, half - depth * 0.45);
          grafQ.quad(c, V3(sideN.z, 0, -sideN.x), up, sideN, gw, gw * 0.33, grafUV((rnd() * 8) | 0)); }
        if (b.h > 12 && rnd() < 0.5) { const pw = Math.min(faceW * 0.7, 13), c = V3(b.x, b.h - 2.2, b.z).addScaledVector(n, half + 0.06).addScaledVector(right, (rnd() - 0.5) * (faceW - pw) * 0.8);
          grafQ.quad(c, right, up, n, pw, pw * 0.33, grafUV(8 + ((rnd() * 4) | 0))); }
      });
      const lit = storefrontAtlas(true), shopM = new THREE.MeshLambertMaterial({ map: storefrontAtlas(false), emissive: 0xffffff, emissiveMap: lit, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      shopM.userData.unique = true; tr.nightMats.push({ m: shopM, max: 0.85, min: 0 });
      const shops = new THREE.Mesh(shopQ.geometry(), shopM); shops.receiveShadow = true; shops.userData.noOutline = true; group.add(shops);
      const grafM = new THREE.MeshLambertMaterial({ map: graffitiAtlas(), transparent: true, alphaTest: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      grafM.userData.unique = true; const graf = new THREE.Mesh(grafQ.geometry(), grafM); graf.userData.noOutline = true; group.add(graf);
      const mq = instanced(new THREE.BoxGeometry(1, 0.22, 1), new THREE.MeshLambertMaterial({ color: 0xe8e4dc }), marq, { shadow: true }); if (mq) group.add(mq);
      out.storefronts = shopQ.p.length / 18;
    },

    // ---------- mobiliário urbano + placas + fiação ----------
    furniture(ctx, group, out) {
      const { tr, T, S, N, W, side, inTun, si, rnd } = ctx;
      const ok = (i, q, r) => !inTun(i, 4) && Math.abs(((i - si + N) % N)) > 14 && Math.abs(((i - si + N) % N) - N) > 14 && !tr.obstacles.some(o => Math.hypot(o.x - q.x, o.z - q.z) < o.r + r);
      const benches = (this._benchList || []).slice(), bins = [], stops = [], poles = [], signQ = new QuadBuf(); this._benchList = [];
      const up = V3(0, 1, 0);
      for (let i = 7; i < N; i += 23) [1, -1].forEach(sd => { const q = side(i, sd * (W + 6.2), 0.16), th = Math.atan2(T[i].x, T[i].z); if (!ok(i, q, 1.5)) return;
        benches.push({ x: q.x, y: 0.16, z: q.z, ry: th + (sd > 0 ? Math.PI / 2 : -Math.PI / 2) }); tr.obstacles.push({ x: q.x, z: q.z, r: 1.0 }); });
      for (let i = 15; i < N; i += 23) [1, -1].forEach(sd => { const q = side(i, sd * (W + 6.8), 0.16); if (!ok(i, q, 0.8)) return; bins.push({ x: q.x, y: 0.16, z: q.z, ry: Math.atan2(T[i].x, T[i].z) }); tr.obstacles.push({ x: q.x, z: q.z, r: 0.4 }); });
      // pontos de ônibus (abrigo + placa "ônibus")
      for (let k = 0; k < 8; k++) { const i = (50 + k * Math.floor(N / 8)) % N, sd = k % 2 ? 1 : -1, q = side(i, sd * (W + 6.1), 0.16), th = Math.atan2(T[i].x, T[i].z); if (!ok(i, q, 3.2)) continue;
        stops.push({ x: q.x, y: 0.16, z: q.z, ry: th + (sd > 0 ? Math.PI / 2 : -Math.PI / 2) }); tr.obstacles.push({ x: q.x, z: q.z, r: 2.4 });
        const n = V3(-Math.sin(th + (sd > 0 ? Math.PI / 2 : -Math.PI / 2)), 0, -Math.cos(th + (sd > 0 ? Math.PI / 2 : -Math.PI / 2))), pq = V3(q.x, 0, q.z).addScaledVector(V3(T[i].x, 0, T[i].z), 2.6);
        poles.push({ x: pq.x, y: 0.16, z: pq.z }); signQ.quad(V3(pq.x, 3.0, pq.z), V3(n.z, 0, -n.x), up, n, 0.9, 0.9, signUV(11)); signQ.quad(V3(pq.x, 3.0, pq.z), V3(-n.z, 0, n.x), up, n.clone().negate(), 0.9, 0.9, signUV(11)); }
      // placas de rua (azuis) e de trânsito antes das curvas
      const curv = i => { const a = T[(i - 12 + N) % N], b = T[(i + 12) % N]; return Math.abs(Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z)); };
      let last = -99, sn = 0;
      for (let i = 0; i < N; i++) { if (curv(i) < 0.75 || i - last < 45) continue; last = i;
        const j = (i - 26 + N) % N, sd = sn % 2 ? 1 : -1, q = side(j, sd * (W + 7.4), 0.16); if (!ok(j, q, 1.0)) { sn++; continue; }
        const th = Math.atan2(T[j].x, T[j].z), fwd = V3(T[j].x, 0, T[j].z), n = fwd.clone().negate(), right = V3(n.z, 0, -n.x);   // de frente para quem vem
        poles.push({ x: q.x, y: 0.16, z: q.z }); tr.obstacles.push({ x: q.x, z: q.z, r: 0.3 });
        signQ.quad(V3(q.x, 3.3, q.z).addScaledVector(n, 0.06), right, up, n, 1.3, 1.3, signUV([6, 7, 8, 9][sn % 4]));
        // placa de rua azul atravessada no alto do poste (lida dos dois lados)
        const sR = fwd.clone(), sN = V3(-fwd.z, 0, fwd.x), uvS = signUV(sn % 6, true);
        signQ.quad(V3(q.x, 4.45, q.z), sR, up, sN, 2.4, 1.2, uvS); signQ.quad(V3(q.x, 4.45, q.z), sR.clone().negate(), up, sN.clone().negate(), 2.4, 1.2, uvS);
        sn++; }
      // geometrias (cor por vértice) e instâncias
      const vc = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      const benchG = merge([colored(new THREE.BoxGeometry(2.4, 0.12, 0.62), 0xb07a46, M4(0, 0.62, 0, 1)), colored(new THREE.BoxGeometry(2.4, 0.5, 0.1), 0xb07a46, M4(0, 1.0, -0.3, 1, 1, 1, -0.15)),
        colored(new THREE.BoxGeometry(0.16, 0.62, 0.62), 0x8c8c94, M4(-1.0, 0.31, 0, 1)), colored(new THREE.BoxGeometry(0.16, 0.62, 0.62), 0x8c8c94, M4(1.0, 0.31, 0, 1))]);
      const binG = merge([colored(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), 0x3a3c44, M4(0, 0.6, 0, 1)), colored(new THREE.CylinderGeometry(0.34, 0.28, 0.62, 12), 0xff7a1a, M4(0, 1.0, 0.16, 1)),
        colored(new THREE.CylinderGeometry(0.36, 0.36, 0.06, 12), 0x2a2c34, M4(0, 1.33, 0.16, 1))]);
      const stopG = merge([colored(new THREE.BoxGeometry(4.6, 0.16, 1.8), 0x2a64c8, M4(0, 2.9, 0.1, 1)), colored(new THREE.BoxGeometry(0.14, 2.9, 0.14), 0x3a3c44, M4(-2.1, 1.45, -0.6, 1)), colored(new THREE.BoxGeometry(0.14, 2.9, 0.14), 0x3a3c44, M4(2.1, 1.45, -0.6, 1)),
        colored(new THREE.BoxGeometry(4.2, 2.0, 0.06), 0xa8d8f0, M4(0, 1.6, -0.62, 1)), colored(new THREE.BoxGeometry(3.6, 0.1, 0.5), 0x8c8c94, M4(0, 0.6, -0.3, 1)), colored(new THREE.BoxGeometry(0.12, 0.6, 0.4), 0x8c8c94, M4(0, 0.3, -0.3, 1))]);
      [instanced(benchG, vc, benches, { shadow: true }), instanced(binG, vc, bins), instanced(stopG, vc, stops, { shadow: true }),
        instanced(new THREE.CylinderGeometry(0.06, 0.06, 5.0, 6).translate(0, 2.5, 0), new THREE.MeshLambertMaterial({ color: 0x8c8e96 }), poles)].forEach(m => m && group.add(m));
      const signM = new THREE.MeshLambertMaterial({ map: signAtlas(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }); signM.userData.unique = true;
      const signs = new THREE.Mesh(signQ.geometry(), signM); signs.userData.noOutline = true; group.add(signs);
      // fiação aérea: catenárias entre postes vizinhos do mesmo lado (uma única LineSegments)
      const segs = [];
      [1, -1].forEach(sdw => { const tops = (tr.lampPoles || []).filter(p => p.sd === sdw).sort((a, b) => a.i - b.i);
      for (let a = 0; a < tops.length; a++) { const p = tops[a], q = tops[a + 1]; if (!q || q.i - p.i > 40 || Math.hypot(p.x - q.x, p.z - q.z) > 80 || inTun(Math.floor((p.i + q.i) / 2), 2)) continue;
        [-0.35, 0, 0.35].forEach((o, w) => { const A = V3(p.x + p.nx * o, 7.6 - w * 0.25, p.z + p.nz * o), B = V3(q.x + q.nx * o, 7.6 - w * 0.25, q.z + q.nz * o), L = A.distanceTo(B), sag = L * 0.035;
          let prev = A; for (let k = 1; k <= 8; k++) { const t = k / 8, P = V3(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t - Math.sin(t * Math.PI) * sag, A.z + (B.z - A.z) * t); segs.push(prev.x, prev.y, prev.z, P.x, P.y, P.z); prev = P; } }); } });
      if (segs.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3)); const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x22232a })); ls.userData.noOutline = true; group.add(ls); }
      out.benches = benches.length; out.bins = bins.length; out.stops = stops.length; out.signs = poles.length; out.wires = segs.length / 6;
    }
  };
  window.CityKit = CityKit;
})();
