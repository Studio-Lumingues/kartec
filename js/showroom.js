// =====================================================================================
// showroom.js — vitrine 3D do menu principal e da Garagem (rework 2026: sem arquivo .glb, tudo montado por código)
//
// DUAS VISTAS da mesma construção, firmes no chão (nada flutuando):
//  * FORA (menu, preparar corrida, lobby): o veículo com o piloto parado no pátio, em frente à garagem da equipe:
//    fachada moderna com letreiro iluminado, portão seccionado, janela acesa, marquise, jardineiras, postes,
//    barreira de pneus, árvores, morros e nuvens ao fundo.
//  * DENTRO (tela da Garagem): showroom de alto padrão. Plataforma giratória com anel de LED, piso de epóxi polido
//    com reflexos pintados, parede ripada com a marca retroiluminada, barras e sancas de LED, anel de luz no teto.
//    SEM PILOTO: só o veículo. Câmera em 3/4 (45°), lente fechada (FOV 24) e profundidade de campo.
//
// ENTRADA NA GARAGEM: o portão abre com a câmera se aproximando -> a tela escurece (fade out) -> vista interna
// aparece (fade in) com a plataforma terminando de girar. Na saída: fade, volta para fora e o portão fecha.
//
// Sombras: a luz principal projeta a sombra do veículo e dos objetos (mapa de sombra de 2048); cantos, rodapés,
// poças de luz e reflexos são pintados nas texturas. Showroom.render() faz a profundidade de campo (main.js chama).
// Ajustes em CFG.GARAGEM3D (config.js), todos opcionais.
// =====================================================================================
(function () {
  const GAR = Object.assign({
    VEHICLE_SCALE: 1,        // tamanho do veículo na vitrine
    EXT_YAW: -32,            // giro do veículo parado no pátio (graus)
    CAM_AZIMUTH: 45,         // Garagem: ângulo entre a câmera e a frente do veículo (45 = visão 3/4; 135 = 3/4 de trás)
    CAM_FOV: 24,             // Garagem: abertura da lente (menor = mais fechada)
    CAM_DIST: 20,            // Garagem: distância inicial da câmera ao veículo (mais afastada: visão menos poluída)
    ZOOM_MIN: 8.5, ZOOM_MAX: 23.5,   // limites do zoom (roda do mouse / pinça): não entra no veículo nem atravessa a parede da frente
    PILOT_DIST: 19, PILOT_SCALE: 3.0,   // PILOT_SCALE = altura do personagem em pé (unidades; o kart tem ~4)
    PILOT_LOOK_Y: 1.05, PILOT_CAM_H: 2.6,   // aba Piloto: personagem em pé no prato giratório
    DAY_START: 0.3, DAY_SECONDS: 240,  // ciclo dia/noite do lobby (mesmo ritmo da corrida: 4 min por dia)
    CLOUD_H: 150,            // base das nuvens acima da câmera no lobby. Na corrida é 300, mas aqui a câmera olha quase na
                             // horizontal com lente fechada: a 300 m as nuvens só apareciam longe demais e sumiam na névoa
                             // do horizonte (ficava só o céu azul). Mais baixas, entram no quadro com o mesmo shader da pista.
    CAM_HEIGHT: 2.5,         // Garagem: altura da câmera
    LOOK_Y: 0.2,             // Garagem: altura do ponto olhado (menor = veículo mais alto na tela; a doca de cores fica embaixo)
    PILOT_IN_GARAGE: false,  // true mostra o piloto também dentro da Garagem
    DOOR_TIME: 1.15,         // segundos para o portão abrir/fechar
    FADE_TIME: 0.38,         // segundos de cada fade (out e in)
    DOF: 1,                  // profundidade de campo (0 desliga; 1 = padrão; 2 = o dobro do desfoque)
    DOF_SS: 1.5,             // a vitrine é desenhada com este fator de resolução e reduzida (bordas mais lisas)
    GLOW: 0.38,              // luz própria do cenário (ele nunca fica preto)
    SHADOW_MAP: 2048,
    SWAP_TIME: 0.75, SWAP_DIST: 2.7,   // troca de veículo no carrossel: duração (s) e deslize (unidades)
    BRAND: 'KARTEC', BRAND_TOP: 'SUPER', ACCENT: '#E8213A'
  }, (window.CFG && window.CFG.GARAGEM3D) || {});

  const U = 2;                                         // 1 metro do cenário = 2 unidades da cena (o kart tem ~4 unidades)
  const ZI = -38;                                      // centro da plataforma interna (z, em unidades); a fachada fica em z = -13
  const RW = 15, Z0 = -5.5, Z1 = 12.5, RD = Z1 - Z0, RH = 4;   // sala interna em metros (origem na plataforma)
  const DOOR_W = 5, DOOR_H = 2.9, FZ = -6.5, FW = 17, FH = 4.4;
  const WINS = [{ x: -5.5, y: 1.95, w: 3.7, h: 1.5 }, { x: 5.5, y: 1.95, w: 3.7, h: 1.5 }];   // janelas (a da direita fica onde era o "01")
  const SCONCES = [-7.9, -3.5, 3.5, 7.9];                                                     // 4 arandelas simétricas   // fachada em metros (origem no veículo do pátio)
  const ease = x => { x = Math.max(0, Math.min(1, x)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------------------------------------------------------------- texturas pintadas (canvas)
  let ENC = 3000, ANISO = 4, SRGB = false;
  const col = h => { const c = new THREE.Color(h); return SRGB ? c.convertSRGBToLinear() : c; };
  const FONT = () => (window.CFG && CFG.FONT_DISPLAY) || '"Titan One", "Arial Rounded MT Bold", sans-serif';
  function mkTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = ENC; t.anisotropy = ANISO; return t;
  }
  const speckle = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = (Math.random() < 0.5 ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + (Math.random() * a).toFixed(3) + ')'; const s = 1 + Math.random() * 2.5; g.fillRect(Math.random() * w, Math.random() * h, s, s); } };
  const lin = (g, x0, y0, x1, y1, a, b) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
  const rad = (g, x, y, r, stops) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); stops.forEach(s => gr.addColorStop(s[0], s[1])); return gr; };
  // texto em metros (fonte desenhada a 100 px e reduzida). flip: canvas com y para cima
  function label(g, txt, x, y, size, fill, o) {
    o = o || {}; g.save(); g.translate(x, y); g.scale(size / 100, size / 100 * (o.flip ? -1 : 1));
    g.font = '400 100px ' + FONT(); g.textAlign = o.align || 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
    if (o.glow) { g.shadowColor = o.glow[0]; g.shadowBlur = o.glow[1]; }
    (o.strokes || []).forEach(s => { g.strokeStyle = s[0]; g.lineWidth = s[1]; g.strokeText(txt, 0, 0); });
    g.fillStyle = fill; g.fillText(txt, 0, 0); g.restore();
  }
  const glowTex = () => mkTex(128, 128, g => { g.fillStyle = rad(g, 64, 64, 64, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(0, 0, 128, 128); });

  // ----- interior -----
  // piso: epóxi escuro polido; os "reflexos" das luzes (anel da plataforma, barras de LED, painel da marca) são pintados
  const floorTex = () => mkTex(2048, 2048, (g, W, H) => {
    g.fillStyle = lin(g, 0, 0, 0, H, '#1c1d20', '#28292d'); g.fillRect(0, 0, W, H);
    for (let i = 0; i < 50; i++) { const x = Math.random() * W, y = Math.random() * H, r = 90 + Math.random() * 260; g.fillStyle = rad(g, x, y, r, [[0, Math.random() < 0.5 ? 'rgba(255,255,255,.025)' : 'rgba(0,0,0,.07)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    speckle(g, W, H, 14000, 0.045);
    g.setTransform(W / RW, 0, 0, H / RD, W / 2, H * -Z0 / RD);                         // metros (x, z), origem na plataforma
    for (let x = -7.5; x <= 7.5; x += 2.5) { g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x - 0.01, Z0, 0.02, RD); g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x + 0.01, Z0, 0.01, RD); }
    for (let z = Z0 + 0.5; z <= Z1; z += 2.5) { g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(-7.5, z - 0.01, RW, 0.02); g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(-7.5, z + 0.01, RW, 0.01); }
    g.fillStyle = rad(g, 0, 0, 7, [[0, 'rgba(255,244,226,.3)'], [1, 'rgba(255,244,226,0)']]); g.fillRect(-7.5, Z0, RW, RD);               // poça de luz do anel do teto
    g.fillStyle = lin(g, 0, Z0, 0, Z0 + 3.2, 'rgba(232,33,58,.5)', 'rgba(232,33,58,0)'); g.fillRect(-7.5, Z0, RW, 3.2);                     // fita vermelha do rodapé
    [-4.3, 4.3].forEach(x => { g.save(); g.translate(x, Z0); g.scale(0.4, 4.6); g.fillStyle = rad(g, 0, 0, 1, [[0, 'rgba(255,240,215,.75)'], [1, 'rgba(255,240,215,0)']]); g.fillRect(-1, 0, 2, 1); g.restore(); });   // barras de LED
    g.save(); g.translate(0, Z0); g.scale(3.6, 2.6); g.fillStyle = rad(g, 0, 0, 1, [[0, 'rgba(255,225,205,.42)'], [1, 'rgba(255,225,205,0)']]); g.fillRect(-1, 0, 2, 1); g.restore();   // painel da marca
    g.strokeStyle = GAR.ACCENT; g.lineWidth = 0.05; g.globalAlpha = 0.75; [[0.5, 1.3], [1.85, 2.65], [3.64, 4.44], [5.0, 5.8]].forEach(a => { g.beginPath(); g.arc(0, 0, 3.3, a[0], a[1]); g.stroke(); }); g.globalAlpha = 1;
    g.fillStyle = lin(g, 0, Z0, 0, Z0 + 0.9, 'rgba(0,0,0,.55)', 'rgba(0,0,0,0)'); g.fillRect(-7.5, Z0, RW, 0.9);
    g.fillStyle = lin(g, -7.5, 0, -5.4, 0, 'rgba(0,0,0,.6)', 'rgba(0,0,0,0)'); g.fillRect(-7.5, Z0, 2.1, RD);
    g.fillStyle = lin(g, 7.5, 0, 5.4, 0, 'rgba(0,0,0,.6)', 'rgba(0,0,0,0)'); g.fillRect(5.4, Z0, 2.1, RD);
    g.fillStyle = lin(g, 0, Z1, 0, Z1 - 4, 'rgba(0,0,0,.6)', 'rgba(0,0,0,0)'); g.fillRect(-7.5, Z1 - 4, RW, 4);
  });
  // parede ripada escura com sanca de luz em cima e fita vermelha embaixo; a do fundo leva a marca retroiluminada
  const wallTex = (wm, brand) => mkTex(2048, 1024, (g, W, H) => {
    g.setTransform(W / wm, 0, 0, -H / RH, W / 2, H); const hw = wm / 2;                 // metros, y para cima
    g.fillStyle = '#0c0c0e'; g.fillRect(-hw, 0, wm, RH);
    for (let x = -hw; x < hw; x += 0.15) { g.fillStyle = lin(g, x, 0, x + 0.11, 0, '#34363b', '#1e1f23'); g.fillRect(x, 0, 0.11, RH); }
    g.fillStyle = lin(g, 0, RH, 0, 2.2, 'rgba(255,236,205,.62)', 'rgba(255,236,205,0)'); g.fillRect(-hw, 2.2, wm, RH - 2.2);
    g.fillStyle = lin(g, 0, 0, 0, 1.0, 'rgba(232,33,58,.6)', 'rgba(232,33,58,0)'); g.fillRect(-hw, 0, wm, 1.0);
    if (brand) {
      [-4.3, 4.3].forEach(x => { g.fillStyle = lin(g, x - 1.1, 0, x, 0, 'rgba(255,238,210,0)', 'rgba(255,238,210,.5)'); g.fillRect(x - 1.1, 0.2, 1.1, 2.6); g.fillStyle = lin(g, x, 0, x + 1.1, 0, 'rgba(255,238,210,.5)', 'rgba(255,238,210,0)'); g.fillRect(x, 0.2, 1.1, 2.6); });
      g.save(); g.shadowColor = 'rgba(255,232,200,.95)'; g.shadowBlur = 70; g.fillStyle = '#0b0b0d'; g.fillRect(-3.6, 0.82, 7.2, 1.36); g.shadowBlur = 30; g.fillRect(-3.6, 0.82, 7.2, 1.36); g.restore();
      g.fillStyle = lin(g, 0, 2.18, 0, 0.82, '#17181b', '#0b0b0d'); g.fillRect(-3.6, 0.82, 7.2, 1.36);
      g.fillStyle = GAR.ACCENT; g.fillRect(-2.9, 1.0, 5.8, 0.035); g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(-2.9, 0.955, 5.8, 0.012);
    }
    g.fillStyle = lin(g, -hw, 0, -hw + 1.4, 0, 'rgba(0,0,0,.55)', 'rgba(0,0,0,0)'); g.fillRect(-hw, 0, 1.4, RH);
    g.fillStyle = lin(g, hw, 0, hw - 1.4, 0, 'rgba(0,0,0,.55)', 'rgba(0,0,0,0)'); g.fillRect(hw - 1.4, 0, 1.4, RH);
    g.fillStyle = '#060607'; g.fillRect(-hw, 0, wm, 0.1);
  });
  const discTex = () => mkTex(1024, 1024, (g, W) => {
    const c = W / 2; g.fillStyle = rad(g, c, c, c, [[0, '#4a4c52'], [0.55, '#303238'], [1, '#232428']]); g.fillRect(0, 0, W, W);
    g.strokeStyle = GAR.ACCENT; g.lineWidth = 9; g.beginPath(); g.arc(c, c, c * 0.93, 0, 6.2832); g.stroke();
    g.fillStyle = rad(g, c, c, c * 0.8, [[0, 'rgba(255,246,230,.2)'], [1, 'rgba(255,246,230,0)']]); g.fillRect(0, 0, W, W);
  });
  const chestTex = () => mkTex(256, 256, (g, W, H) => {
    g.fillStyle = lin(g, 0, 0, 0, H, '#e42b42', '#a80f26'); g.fillRect(0, 0, W, H);
    for (let i = 0; i < 5; i++) { const y = 10 + i * 49; g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(8, y + 42, W - 16, 4); g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(8, y, W - 16, 3); g.fillStyle = '#d6dbe3'; g.fillRect(40, y + 16, W - 80, 9); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(40, y + 25, W - 80, 3); }
  });

  // ----- exterior -----
  // fachada: painéis metálicos grafite, base de concreto, friso vermelho; o vão do portão é transparente (alphaTest)
  const facadeTex = () => mkTex(2048, 512, (g, W, H) => {
    g.setTransform(W / FW, 0, 0, -H / FH, W / 2, H); const hw = FW / 2;
    g.fillStyle = lin(g, 0, FH, 0, 0, '#43464c', '#33353a'); g.fillRect(-hw, 0, FW, FH);
    for (let y = 0.45; y < FH; y += 0.55) { g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(-hw, y - 0.012, FW, 0.024); g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(-hw, y - 0.03, FW, 0.014); }
    for (let x = -hw; x <= hw; x += 1.7) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - 0.01, 0.45, 0.02, FH); }
    g.fillStyle = '#1c1d20'; g.fillRect(-3.0, DOOR_H, 6.0, FH - DOOR_H);                                          // painel do letreiro
    g.fillStyle = GAR.ACCENT; g.fillRect(-hw, DOOR_H + 0.02, FW, 0.07); g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(-hw, DOOR_H + 0.1, FW, 0.018);
    g.fillStyle = lin(g, 0, 0.45, 0, 0, '#a4a7ad', '#84878d'); g.fillRect(-hw, 0, FW, 0.45); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-hw, 0.44, FW, 0.02);
    [-2.5, 2.5].forEach(x => { const s = Math.sign(x); g.fillStyle = lin(g, x, 0, x + s * 1.3, 0, 'rgba(255,238,205,.45)', 'rgba(255,238,205,0)'); g.fillRect(Math.min(x, x + s * 1.3), 0, 1.3, DOOR_H); });   // luz da moldura do portão
    g.fillStyle = lin(g, 0, FH, 0, FH - 0.5, 'rgba(0,0,0,.45)', 'rgba(0,0,0,0)'); g.fillRect(-hw, FH - 0.5, FW, 0.5);
    g.fillStyle = lin(g, 0, 0, 0, 0.35, 'rgba(0,0,0,.4)', 'rgba(0,0,0,0)'); g.fillRect(-hw, 0, FW, 0.35);
    g.clearRect(-DOOR_W / 2, -0.1, DOOR_W, DOOR_H + 0.1);
    WINS.forEach(w => g.clearRect(w.x - w.w / 2, w.y - w.h / 2, w.w, w.h));   // vãos das janelas: vidro de verdade (o interior aparece)
  });
  const doorTex = () => mkTex(1024, 512, (g, W, H) => {
    const n = 5, sh = H / n;
    for (let i = 0; i < n; i++) { const y = i * sh; g.fillStyle = lin(g, 0, y, 0, y + sh, '#d4d8de', '#9aa0aa'); g.fillRect(0, y, W, sh); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, y + sh - 4, W, 4); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, y, W, 3);
      for (let k = 1; k < 4; k++) { g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(0, y + k * sh / 4, W, 2); } }
    for (let k = 0; k < 6; k++) { const x = 34 + k * 164, y = sh + 22; g.fillStyle = '#101216'; g.fillRect(x - 6, y - 6, 144, sh - 32); g.clearRect(x, y, 132, sh - 44); }   // vidros reais
    g.fillStyle = GAR.ACCENT; g.fillRect(0, H - sh * 0.5, W, 14);
    g.fillStyle = lin(g, 0, 0, 0, 70, 'rgba(0,0,0,.45)', 'rgba(0,0,0,0)'); g.fillRect(0, 0, W, 70);
  });
  const GX = 35, GZ1 = 22, GD = GZ1 - FZ;

  // ---------------------------------------------------------------- peças (caixas, cilindros, luzes) de um conjunto
  function kit(R, gTex) {
    const unit = new THREE.BoxGeometry(1, 1, 1), mats = {}, tag = m => { m.__ink = true; return m; };   // __ink: o main.js não mexe nas cores
    const std = (hex, rough, metal, map, k) => {
      const key = map ? map.uuid + '|' + rough : hex + '|' + rough + '|' + metal; if (mats[key]) return mats[key];
      const m = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : col(hex), roughness: rough, metalness: metal || 0, map: map || null });
      m.emissive = map ? new THREE.Color(0xffffff) : col(hex); m.emissiveMap = map || null; m.emissiveIntensity = GAR.GLOW * (k == null ? 1 : k); return (mats[key] = tag(m));
    };
    const soft = hex => mats['S' + hex] || (mats['S' + hex] = tag(new THREE.MeshLambertMaterial({ color: col(hex) })));
    const lit = hex => mats['L' + hex] || (mats['L' + hex] = tag(new THREE.MeshBasicMaterial({ color: col(hex) })));
    const put = (geo, mat, x, y, z, parent, cast) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast !== false && !mat.isMeshBasicMaterial; m.receiveShadow = !mat.isMeshBasicMaterial; (parent || R).add(m); return m; };
    const box = (w, h, d, mat, x, y, z, parent, cast) => { const m = put(unit, mat, x, y, z, parent, cast); m.scale.set(w, h, d); return m; };
    const cyl = (r0, r1, h, mat, x, y, z, parent, seg) => put(new THREE.CylinderGeometry(r0, r1, h, seg || 20), mat, x, y, z, parent);
    const plane = (w, h, mat, x, y, z, ry, parent) => { const m = put(new THREE.PlaneGeometry(w, h), mat, x, y, z, parent, false); m.rotation.y = ry || 0; return m; };
    const glow = (w, h, hex, op, x, y, z, ry, parent) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), tag(new THREE.MeshBasicMaterial({ map: gTex, color: col(hex), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false })));
      m.position.set(x, y, z); m.rotation.y = ry || 0; m.renderOrder = 2; (parent || R).add(m); return m; };
    const grp = (x, z, parent) => { const g = new THREE.Group(); g.position.set(x || 0, 0, z || 0); (parent || R).add(g); return g; };
    return { std, soft, lit, put, box, cyl, plane, glow, grp, tag, mats };
  }
  function tireStack(K, x, z, n, parent) {
    const g = K.grp(x, z, parent), rubber = K.std('#141415', 0.92, 0), rim = K.std('#b1b4ba', 0.35, 0.8);
    for (let i = 0; i < n; i++) { const y = 0.14 + i * 0.275, a = (Math.random() - 0.5) * 0.06; K.cyl(0.44, 0.44, 0.26, rubber, a, y, a, g, 28); K.cyl(0.23, 0.23, 0.268, rim, a, y, a, g, 18).castShadow = false; }
    return g;
  }

  // ---------------------------------------------------------------- DENTRO: showroom (metros; origem = plataforma)
  function buildInterior(gTex) {
    const R = new THREE.Group(); R.name = 'Showroom-interior'; const K = kit(R, gTex), zc = (Z0 + Z1) / 2;
    const fg = new THREE.PlaneGeometry(RW, RD); fg.rotateX(-Math.PI / 2);
    K.put(fg, K.std(null, 0.22, 0.25, floorTex(), 0.9), 0, 0, zc, R, false);
    const side = K.std(null, 0.75, 0.1, wallTex(RD, false)), W = (w, mat, x, z, ry) => K.plane(w, RH, mat, x, RH / 2, z, ry);
    W(RW, K.std(null, 0.7, 0.1, wallTex(RW, true), 1.5), 0, Z0, 0); W(RD, side, -RW / 2, zc, Math.PI / 2); W(RD, side, RW / 2, zc, -Math.PI / 2); W(RW, K.std(null, 0.75, 0.1, wallTex(RW, false)), 0, Z1, Math.PI);
    const ceil = K.plane(RW, RD, K.std('#131314', 0.9, 0), 0, RH, zc, 0); ceil.rotation.x = Math.PI / 2; ceil.receiveShadow = false;
    const steel = K.std('#2b2c30', 0.45, 0.7), dark = K.std('#18181a', 0.6, 0.3), led = K.lit('#fff4e2'), ledR = K.lit(GAR.ACCENT);
    // plataforma giratória com anel de LED
    K.cyl(2.4, 2.46, 0.12, steel, 0, 0.06, 0, R, 64);
    const top = K.put(new THREE.CircleGeometry(2.4, 64), K.std(null, 0.3, 0.55, discTex(), 0.8), 0, 0.121, 0, R, false); top.rotation.x = -Math.PI / 2;
    // parede do fundo: barras de LED, sanca, fita do rodapé, pilares
    [-4.3, 4.3].forEach(x => { K.box(0.18, 2.5, 0.08, dark, x, 1.5, Z0 + 0.04, R, false); K.box(0.07, 2.36, 0.05, led, x, 1.5, Z0 + 0.1); K.glow(1.7, 3.8, '#ffe6bd', 0.55, x, 1.5, Z0 + 0.13); });
    K.box(RW, 0.05, 0.05, led, 0, 3.42, Z0 + 0.12); K.box(RW, 0.16, 0.22, dark, 0, 3.3, Z0 + 0.11, R, false); K.glow(RW, 1.4, '#ffe6bd', 0.35, 0, 3.5, Z0 + 0.16);
    K.box(RW, 0.035, 0.03, ledR, 0, 0.05, Z0 + 0.03); K.glow(RW, 0.8, GAR.ACCENT, 0.4, 0, 0.14, Z0 + 0.06);
    [-7.3, 7.3].forEach(x => K.box(0.4, RH, 0.4, steel, x, RH / 2, Z0 + 0.2));
    // armário baixo com gaveteiro (esquerda) e mostruário de pneus (direita), junto à parede do fundo
    const cab = K.grp(-5.95, Z0 + 0.4), cT = chestTex(), red = K.std('#c2152c', 0.35, 0.4);
    K.box(2.3, 0.86, 0.62, dark, 0, 0.45, 0, cab); K.box(2.34, 0.05, 0.66, K.std('#3a3b40', 0.3, 0.8), 0, 0.905, 0, cab); K.box(2.3, 0.03, 0.02, ledR, 0, 0.82, 0.32, cab);
    K.box(1.0, 0.5, 0.48, red, -0.45, 1.18, -0.04, cab); K.plane(0.94, 0.44, K.std(null, 0.38, 0.35, cT), -0.45, 1.18, 0.205, 0, cab);
    K.cyl(0.08, 0.08, 0.3, K.std('#d9dce2', 0.3, 0.8), 0.55, 1.08, 0, cab, 14); K.cyl(0.06, 0.06, 0.22, K.std('#f2c418', 0.4, 0.2), 0.8, 1.04, 0.1, cab, 12);
    tireStack(K, 5.25, Z0 + 0.62, 4); tireStack(K, 6.3, Z0 + 0.6, 5); tireStack(K, 5.75, Z0 + 1.55, 2);
    // laterais: painéis de luz difusa (softbox) e carrinho de ferramentas / pneus
    [[-RW / 2 + 0.03, Math.PI / 2], [RW / 2 - 0.03, -Math.PI / 2]].forEach(s => { [-1.6, 3.6, 8.8].forEach(z => { K.plane(3.6, 1.7, K.lit('#fff1dc'), s[0], 2.15, z, s[1]); K.plane(3.8, 1.9, dark, s[0] + Math.sign(s[0]) * 0.012, 2.15, z, s[1]).receiveShadow = false; K.glow(5.4, 3.4, '#ffe9c8', 0.4, s[0] - Math.sign(s[0]) * 0.05, 2.15, z, s[1]); }); });
    const tr = K.grp(-6.5, 1.2); K.box(0.62, 0.95, 1.5, red, 0, 0.6, 0, tr); K.box(0.66, 0.04, 1.56, dark, 0, 1.09, 0, tr);
    const tp = K.plane(1.44, 0.89, K.std(null, 0.38, 0.35, cT), 0.315, 0.6, 0, Math.PI / 2, tr); tp.castShadow = false;
    tireStack(K, 6.55, 0.6, 3); tireStack(K, 6.5, 1.75, 4);
    // teto: anel de luz sobre a plataforma, réguas de LED e vigas
    const halo = K.put(new THREE.TorusGeometry(2.7, 0.06, 10, 96), led, 0, 3.35, 0, R); halo.rotation.x = Math.PI / 2;
    const halo2 = K.put(new THREE.TorusGeometry(2.7, 0.11, 10, 96), dark, 0, 3.43, 0, R, false); halo2.rotation.x = Math.PI / 2;
    [[-2.7, 0], [2.7, 0], [0, -2.7], [0, 2.7]].forEach(p => K.cyl(0.012, 0.012, RH - 3.45, dark, p[0], (RH + 3.45) / 2, p[1], R, 6).castShadow = false);
    [-5, 5].forEach(x => [-2.5, 2, 6, 10].forEach(z => { const p = K.plane(0.7, 2.6, led, x, RH - 0.03, z, 0); p.rotation.x = Math.PI / 2; }));
    [-3.4, 4.6, 9.6].forEach(z => K.box(RW, 0.22, 0.22, steel, 0, RH - 0.11, z, R, false));
    // logo OFICIAL (modelo 3D do menu) no painel retroiluminado da parede do fundo (antes: texto em fonte pintado na textura)
    if (window.Logo3D) Logo3D.whenReady(() => { try { const L = Logo3D.mesh(1.05, { maxW: 6.6, self: 0.3 }); L.position.set(0, 1.5, Z0 + 0.14 + L.userData.d / 2); R.add(L); } catch (e) { console.warn('[Vitrine] logo 3D (parede)', e); } });
    return R;
  }

  // ---------------------------------------------------------------- FORA: fachada e prédio (metros; origem = veículo)
  // O chão, a grama, as árvores, moitas, postes, cones e pneus são os MESMOS modelos/materiais da corrida: buildWorld().
  function buildExterior(gTex) {
    const R = new THREE.Group(); R.name = 'Showroom-exterior'; const K = kit(R, gTex), hw = FW / 2, nightUp = [];
    // prédio: fachada com os vãos do portão e das janelas, laterais, platibanda, marquise
    const fac = K.std(null, 0.55, 0.45, facadeTex(), 0.8); fac.alphaTest = 0.5; K.plane(FW, FH, fac, 0, FH / 2, FZ, 0);
    const clad = K.std('#3a3c41', 0.55, 0.45), dark = K.std('#1b1c1f', 0.6, 0.3), alu = K.std('#c9ccd2', 0.35, 0.8), led = K.lit('#fff4e2');
    const sideW = (x, ry) => { const m = K.plane(RD + 0.4, FH, clad, x, FH / 2, FZ - (RD + 0.4) / 2, ry); m.castShadow = false; };
    sideW(-hw, -Math.PI / 2); sideW(hw, Math.PI / 2);
    const roof = K.plane(FW, RD + 0.4, clad, 0, FH, FZ - (RD + 0.4) / 2, 0); roof.rotation.x = -Math.PI / 2;
    K.box(FW + 0.3, 0.14, 0.5, alu, 0, FH + 0.07, FZ - 0.12, R, false);
    [-1, 1].forEach(s => { K.box(0.16, DOOR_H, 0.34, dark, s * (DOOR_W / 2 + 0.08), DOOR_H / 2, FZ - 0.13, R, false); K.box(0.05, DOOR_H - 0.1, 0.05, led, s * (DOOR_W / 2 + 0.05), DOOR_H / 2, FZ + 0.05); K.glow(1.0, DOOR_H + 1, '#ffe6bd', 0.5, s * (DOOR_W / 2 + 0.05), DOOR_H / 2, FZ + 0.08); });
    K.box(DOOR_W + 0.32, 0.16, 0.34, dark, 0, DOOR_H + 0.08, FZ - 0.13, R, false);
    K.box(DOOR_W + 1.3, 0.1, 1.15, dark, 0, DOOR_H + 0.22, FZ + 0.55, R, false); K.box(DOOR_W + 1.0, 0.03, 0.06, led, 0, DOOR_H + 0.16, FZ + 1.0); K.glow(DOOR_W + 2.4, 0.9, '#ffe6bd', 0.45, 0, DOOR_H + 0.12, FZ + 1.04);
    // portão seccionado (enrola para cima: ver setDoor); as janelinhas dele são vazadas e levam vidro de verdade
    const dTex = doorTex(), dMat = K.std(null, 0.4, 0.55, dTex, 0.7); dMat.alphaTest = 0.5;
    const door = K.plane(DOOR_W, DOOR_H, dMat, 0, DOOR_H / 2, FZ - 0.1, 0);
    const bar = K.box(DOOR_W, 0.08, 0.08, K.std('#17181a', 0.8, 0), 0, 0.04, FZ - 0.08, R, false);
    // janelas: vidro 3D (reflexo + transparência: o interior REAL da garagem aparece), caixilho e peitoril
    const glass = [];
    WINS.forEach(w => {
      const gm = new THREE.Mesh(new THREE.PlaneGeometry(w.w, w.h), glassMaterial(null)); gm.position.set(w.x, w.y, FZ + 0.03); gm.renderOrder = 3; R.add(gm); glass.push(gm);
      const t = 0.07, d = 0.12, fy = w.y, fx = w.x;
      K.box(w.w + 2 * t, t, d, dark, fx, fy + w.h / 2 + t / 2, FZ + 0.04, R, false); K.box(w.w + 2 * t, t, d, dark, fx, fy - w.h / 2 - t / 2, FZ + 0.04, R, false);
      [-1, 1].forEach(sd => K.box(t, w.h, d, dark, fx + sd * (w.w / 2 + t / 2), fy, FZ + 0.04, R, false));
      [-1, 0, 1].forEach(k => K.box(0.04, w.h, 0.06, dark, fx + k * w.w / 4, fy, FZ + 0.05, R, false));
      K.box(w.w + 0.3, 0.08, 0.2, alu, fx, fy - w.h / 2 - 0.12, FZ + 0.09, R, false);
    });
    const dg = new THREE.Mesh(door.geometry, glassMaterial(dTex)); dg.position.z = -0.01; dg.renderOrder = 3; door.add(dg); glass.push(dg);
    // letreiro: painel escuro (pintado na fachada) com a LOGO OFICIAL 3D e luz de fundo que acende à noite
    const signGlow = K.glow(6.4, 1.9, '#ffd8b0', 0.25, 0, DOOR_H + 0.75, FZ + 0.02); nightUp.push({ o: signGlow, day: 0.18, night: 0.75 });
    let signLogo = null;
    if (window.Logo3D) Logo3D.whenReady(() => { try { const L = signLogo = Logo3D.mesh(1.08, { maxW: 5.6, self: 0.2 }); L.position.set(0, DOOR_H + 0.76, FZ + 0.06 + L.userData.d / 2); R.add(L); } catch (e) { console.warn('[Vitrine] logo 3D (letreiro)', e); } });
    // ARANDELAS (4, simétricas): corpo de metal, lentes de luz em cima e embaixo e feixes pintados na parede (acendem à noite)
    const wash = washTex(), bodyM = K.std('#22252b', 0.35, 0.7), lens = K.lit('#fff2d6');
    SCONCES.forEach(x => { const g = K.grp(x, FZ);
      K.box(0.2, 0.62, 0.04, bodyM, 0, 2.95, 0.02, g, false); K.box(0.06, 0.06, 0.22, bodyM, 0, 2.95, 0.12, g, false);
      K.cyl(0.1, 0.1, 0.46, bodyM, 0, 2.95, 0.25, g, 18);
      [-1, 1].forEach(sd => { const l = K.cyl(0.075, 0.075, 0.01, lens, 0, 2.95 + sd * 0.235, 0.25, g, 18); l.castShadow = false; });
      const up = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.5), K.tag(new THREE.MeshBasicMaterial({ map: wash, color: 0xffe2b8, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false })));
      up.position.set(0, 3.2 + 0.72, 0.015); up.renderOrder = 2; g.add(up);
      const dn = up.clone(); dn.material = up.material; dn.rotation.z = Math.PI; dn.scale.y = 1.55; dn.position.set(0, 2.7 - 1.1, 0.015); g.add(dn);
      nightUp.push({ o: up, day: 0.12, night: 0.9 });
      const h = K.glow(0.9, 0.9, '#ffe6bd', 0.5, 0, 2.95, 0.32, 0, g); nightUp.push({ o: h, day: 0.35, night: 1 }); });
    // morros ao fundo (verde dos morros da corrida)
    const hill = (x, z, r, hex) => { const m = K.put(new THREE.SphereGeometry(1, 28, 14), K.soft(hex), x, -r * 0.06, z, R, false); m.scale.set(r, r * 0.3, r); m.receiveShadow = false; };
    hill(-48, -62, 34, '#4a7b33'); hill(8, -84, 44, '#557f3a'); hill(54, -58, 30, '#4a7b33'); hill(-88, -50, 40, '#5f8a45'); hill(92, -80, 46, '#5f8a45'); hill(-20, -110, 50, '#6a9150');
    const mats = Object.values(K.mats).filter(m => m.isMeshStandardMaterial); mats.forEach(m => { m.userData.e0 = m.emissiveIntensity; });
    return { R, door, bar, dTex, glass, nightUp, mats, sign: () => signLogo };
  }
  // feixe de luz da arandela na parede (cone suave, mais forte perto da lâmpada)
  const washTex = () => mkTex(128, 256, (g, W, H) => { g.clearRect(0, 0, W, H);
    for (let y = 0; y < H; y++) { const t = 1 - y / H, half = W * (0.08 + 0.42 * (1 - t)), a = Math.pow(t, 1.6) * 0.9;
      const gr = g.createLinearGradient(W / 2 - half, 0, W / 2 + half, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,' + a.toFixed(3) + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, H - 1 - y, W, 1); } });

  // ---------------------------------------------------------------- vidro 3D (reflexo de ambiente + Fresnel + transparência)
  // tEnv: cubemap da própria cena (CubeCamera, atualizado de tempos em tempos: acompanha o dia/noite).
  // mask (opcional): textura do portão; o vidro só aparece onde ela é vazada (as janelinhas), uRepY acompanha o portão enrolando.
  const GLASS_U = { tEnv: { value: null } };
  function glassMaterial(mask) {
    const m = new THREE.ShaderMaterial({
      uniforms: { tEnv: GLASS_U.tEnv, tMask: { value: mask || null }, uUseMask: { value: mask ? 1 : 0 }, uRepY: { value: 1 }, uTint: { value: new THREE.Color(0x3f5466) }, uNight: { value: 0 } },
      vertexShader: 'varying vec3 vWP; varying vec3 vWN; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; vWN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform samplerCube tEnv; uniform sampler2D tMask; uniform float uUseMask; uniform float uRepY; uniform vec3 uTint; uniform float uNight;
        varying vec3 vWP; varying vec3 vWN; varying vec2 vUv;
        void main(){
          if (uUseMask > 0.5 && texture2D(tMask, vec2(vUv.x, vUv.y * uRepY)).a > 0.5) discard;
          vec3 V = normalize(vWP - cameraPosition), N = normalize(vWN); if (dot(N, V) > 0.0) N = -N;
          float c = clamp(-dot(N, V), 0.0, 1.0), F = 0.04 + 0.96 * pow(1.0 - c, 5.0);
          vec3 env = textureCube(tEnv, reflect(V, N)).rgb;
          float r = clamp(0.2 + 0.75 * F, 0.0, 0.92) * (1.0 - 0.55 * uNight);        // à noite o vidro reflete menos (o interior aceso aparece mais)
          float streak = smoothstep(0.035, 0.0, abs(fract(vUv.x * 0.8 + vUv.y * 0.55 + 0.15) - 0.5)) * 0.06;   // brilho diagonal sutil
          float base = 0.16;
          gl_FragColor = vec4(env * r + uTint * base + vec3(streak), r + base);
        }`,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, side: THREE.DoubleSide });
    m.__ink = true; return m;
  }

  // ---------------------------------------------------------------- mundo do lobby com os assets da CORRIDA (unidades da cena)
  // grama (GfxFX.grassTone + textura 'grass'), asfalto (GfxFX.asphaltMaterial), zebras ('curb'), pinheiros (Pines),
  // moitas (Bush), poste de luz (LampPost), cones e pneus (Props)
  function buildWorld(Wg) {
    const out = { lights: [], halos: [], lampGlass: null }, V = (x, z) => [x * U, z * U];
    // grama: mesmo chão da corrida (ladrilho de 7 unidades, variação de cor por vértice, tom natural)
    { const GS = 1400, g = new THREE.PlaneGeometry(GS, GS, 64, 64), p = g.attributes.position, c = [];
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = -p.getY(i);
        const m = 0.9 + 0.06 * Math.sin(x * 0.013 + 1.3) * Math.cos(z * 0.011) + 0.05 * Math.sin(x * 0.034 + z * 0.029) + 0.03 * Math.sin(x * 0.071 - z * 0.064 + 2);
        const h = Math.sin(x * 0.009 - z * 0.012 + 0.7) * 0.5 + 0.5; c.push(m * (1 + 0.07 * h), m, m * (1 - 0.07 * 1.4 * h)); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      const mat = window.GfxFX && GfxFX.grassTone ? GfxFX.grassTone(new THREE.MeshLambertMaterial({ map: TX.get('grass', GS / 7, GS / 7), vertexColors: true })) : new THREE.MeshLambertMaterial({ color: 0x5d8f3a });
      const m = new THREE.Mesh(g, mat); m.rotation.x = -Math.PI / 2; m.position.set(0, -0.02, -40); m.receiveShadow = true; Wg.add(m); }
    // pátio de asfalto (mesmo material da pista) com zebras nas bordas
    const AX0 = -32, AX1 = 32, AZ0 = FZ * U, AZ1 = 30, AW = AX1 - AX0, AD = AZ1 - AZ0;
    { const g = new THREE.PlaneGeometry(AW, AD); g.rotateX(-Math.PI / 2);
      const mat = window.GfxFX && GfxFX.asphaltMaterial ? GfxFX.asphaltMaterial(AW / 7, AD / 7) : new THREE.MeshPhongMaterial({ map: TX.get('asphalt', AW / 7, AD / 7) });
      mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;
      const m = new THREE.Mesh(g, mat); m.position.set((AX0 + AX1) / 2, 0.02, (AZ0 + AZ1) / 2); m.receiveShadow = true; Wg.add(m);
      const CB = 1.8, curb = (w, d, x, z, ry, len) => { const t = TX.get('curb', 1, len / 4); const cm = new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
        const pg = new THREE.PlaneGeometry(w, d); pg.rotateX(-Math.PI / 2); const cmm = new THREE.Mesh(pg, cm); cmm.rotation.y = ry; cmm.position.set(x, 0.04, z); cmm.receiveShadow = true; Wg.add(cmm); };
      curb(CB, AD, AX0 - CB / 2, (AZ0 + AZ1) / 2, 0, AD); curb(CB, AD, AX1 + CB / 2, (AZ0 + AZ1) / 2, Math.PI, AD); curb(CB, AW + 2 * CB, 0, AZ1 + CB / 2, Math.PI / 2, AW + 2 * CB); }
    // pinheiros da corrida (4 modelos, instanciados por modelo) onde ficavam as árvores de bolinhas
    if (window.Pines) {
      const T = [[-11.5, -9, 1.5], [-14.5, -5.5, 1.2], [-18, -12, 1.8], [-12, -17, 1.4], [-23, -4, 1.3], [-27, -14, 2], [12, -9, 1.4], [15.5, -13, 1.9], [19, -6, 1.2], [24, -11, 1.6], [11.5, -18, 1.3], [-33, -8, 1.7], [31, -17, 2.1]];
      const mat = Pines.material(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), { amp: 0.02, h0: 3.0, freq: 0.9 }), d = new THREE.Object3D();
      [0, 1, 2, 3].forEach(v => { const L = T.filter(t => Pines.variantAt(t[0], t[1]) === v); if (!L.length) return;
        const im = new THREE.InstancedMesh(Pines.attach(Pines.single('hi', v), L.map(() => v)), mat, L.length);
        L.forEach((t, n) => { const [x, z] = V(t[0], t[1]); d.position.set(x, 0, z); d.rotation.set(0, t[0] * 1.7, 0); d.scale.setScalar(0.55 + t[2] * 0.3); d.updateMatrix(); im.setMatrixAt(n, d.matrix); });
        im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = Pines.depthMaterial(); im.frustumCulled = false; Wg.add(im); }); }
    // moitas da corrida nas jardineiras (as jardineiras de concreto ficam)
    const PL = [-8.0, -3.55, 3.55, 8.0];
    { const conc = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.9 }), pg = new THREE.BoxGeometry(1.0 * U, 0.55 * U, 0.9 * U);
      PL.forEach(x => { const m = new THREE.Mesh(pg, conc); m.position.set(x * U, 0.275 * U, (FZ + 0.62) * U); m.castShadow = m.receiveShadow = true; Wg.add(m); });
      if (window.Bush) { const im = new THREE.InstancedMesh(Bush.geometry('hi'), Bush.material(), PL.length), d = new THREE.Object3D();
        PL.forEach((x, n) => { d.position.set(x * U, 0.55 * U - 0.05, (FZ + 0.62) * U); d.rotation.set(0, n * 1.9, 0); d.scale.set(0.95, 0.85, 0.85); d.updateMatrix(); im.setMatrixAt(n, d.matrix); });
        im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.customDepthMaterial = Bush.depthMaterial(); im.frustumCulled = false; Wg.add(im); } }
    // postes de luz da corrida (lampião clássico) com SpotLight e brilho que acendem à noite
    if (window.LampPost) {
      const LM = LampPost.materials(), LG = LampPost.geometries(), B = LampPost.baker(), heads = [];
      [[-10.5, -2.5, 0], [10.5, -2.5, Math.PI]].forEach(([x, z, a]) => { const M = new THREE.Matrix4().compose(new THREE.Vector3(x * U, 0, z * U), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(1, 1, 1));
        LampPost.place(LG, B.put, M); heads.push(new THREE.Vector3(LampPost.ARM, LampPost.LAMPY, 0).applyMatrix4(M)); });
      LampPost.merge(B.bake, LM).forEach(m => Wg.add(m)); Object.values(LG).forEach(g => g.dispose()); out.lampGlass = LM.glass;
      heads.forEach(H => { const L = new THREE.SpotLight(0xffc685, 0, 62, 1.0, 0.75, 1.4); L.position.copy(H); L.target.position.set(H.x, 0, H.z); Wg.add(L, L.target); out.lights.push(L);
        const mk = (c, s) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); sp.position.copy(H); sp.scale.setScalar(s); Wg.add(sp); return sp; };
        out.halos.push(mk(0xfff0d0, 2), mk(0xffb766, 7)); });
    }
    // cones e pilhas de pneus da corrida
    if (window.Props && Props.coneAssets) {
      const C = Props.coneAssets();
      [[4.3, 2.9], [5.1, -1.4], [-4.5, 3.6]].forEach(([x, z], i) => { const g = new THREE.Group(); g.position.set(x * U, 0.02, z * U); g.rotation.y = i * 0.7; g.scale.setScalar(1.15);
        const b = new THREE.Mesh(C.geo, C.body), bs = new THREE.Mesh(C.base, C.baseM); b.castShadow = true; bs.receiveShadow = true; g.add(b, bs); Wg.add(g); });
      const T = Props.tireAssets(), TR = Props.TIRE, STEP = TR.H * 2 * 0.96;
      [[-25.2, 7.8, 3], [-23.2, 7.8, 4], [-21.2, 7.8, 3], [-22.2, 9.8, 2]].forEach(([x, z, n], k) => { for (let h = 0; h < n; h++) { const m = new THREE.Mesh(T.geo, T.mat);
        m.position.set(x + Math.sin(k * 7 + h) * 0.05, TR.H - 0.04 + h * STEP, z); m.rotation.y = k * 1.3 + h * 0.8; m.castShadow = m.receiveShadow = true; Wg.add(m); } });
    }
    return out;
  }

  // ---------------------------------------------------------------- profundidade de campo (passo final de Showroom.render)
  const DOF_FRAG = `
    uniform sampler2D tC; uniform sampler2D tD; uniform vec2 uPx; uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uRange; uniform float uFall; uniform float uMax; uniform float uVig;
    varying vec2 vUv;
    float cocAt(vec2 uv) { float d = texture2D(tD, uv).x, z = uNear * uFar / (uFar - d * (uFar - uNear)), a = z - uFocus;
      return clamp((abs(a) - uRange) / uFall, 0.0, 1.0) * (a > 0.0 ? 1.0 : 0.55); }
    void main() {
      vec3 base = (texture2D(tC, vUv + uPx * vec2(0.375, 0.125)).rgb + texture2D(tC, vUv + uPx * vec2(-0.125, 0.375)).rgb + texture2D(tC, vUv + uPx * vec2(-0.375, -0.125)).rgb + texture2D(tC, vUv + uPx * vec2(0.125, -0.375)).rgb) * 0.25;
      float r = cocAt(vUv) * uMax; vec3 acc = base; float w = 1.0;
      if (r > 0.6) {
        for (int i = 0; i < 28; i++) { float fi = float(i) + 0.5, rr = sqrt(fi / 28.0) * r, an = fi * 2.39996323;
          vec2 uv = vUv + vec2(cos(an), sin(an)) * rr * uPx;
          float wi = clamp((cocAt(uv) * uMax - rr) / 1.5 + 1.0, 0.0, 1.0);        // o que está em foco não "vaza" para o fundo desfocado
          acc += texture2D(tC, uv).rgb * wi; w += wi; }
      }
      vec3 c = acc / w; vec2 q = vUv - 0.5; c *= 1.0 - uVig * smoothstep(0.25, 0.95, length(q) * 1.35);
      gl_FragColor = vec4(c, 1.0);
    }`;

  // ---------------------------------------------------------------- PILOTO EM DESTAQUE (aba Piloto da Garagem)
  // O mesmo personagem 3D do kart (Pilot.create), fora do veículo, em pé no prato giratório: uma mão na cintura, punho
  // erguido, peso numa perna. Respira, olha em volta e (Menina) as marias-chiquinhas balançam com o giro.
  const _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion(), _hq3 = new THREE.Quaternion(), _hv = new THREE.Vector3(), _AZ = new THREE.Vector3(0, 0, 1);
  class HeroPilot {
    constructor(spec) {
      this.rig = Pilot.create(Object.assign({}, spec)); this.root = this.rig.root; this.t = Math.random() * 10;
      this.S = GAR.PILOT_SCALE; this.root.scale.setScalar(this.S); this.root.rotation.y = -0.3;
      this.ok = !!(this.rig.bones && this.rig.dir && this.rig.bones.hips);
      this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
      if (!this.ok) this.root.position.y = 0.15;
    }
    setColors(spec) { if (this.rig.setColors) this.rig.setColors(spec); }
    arm(sf, up, fo, curl) {
      const r = this.rig, B = r.bones, b1 = B['upperarm' + sf], b2 = B['forearm' + sf]; if (!b1 || !b2) return;
      if (r.ua && r.ua[sf]) b1.position.copy(r.ua[sf]);
      this.root.getWorldQuaternion(_hq).invert(); b1.parent.getWorldQuaternion(_hq2).premultiply(_hq);   // peito, relativo à raiz
      const q1 = _hq3.setFromUnitVectors(r.dir['upperarm' + sf], _hv.copy(up).normalize());
      b1.quaternion.copy(_hq2).invert().multiply(q1);
      const q2 = new THREE.Quaternion().setFromUnitVectors(r.dir['forearm' + sf], _hv.copy(fo).normalize());
      b2.quaternion.copy(q1).invert().multiply(q2);
      if (B['hand' + sf]) B['hand' + sf].quaternion.identity();
      if (B['fingers' + sf]) B['fingers' + sf].quaternion.setFromAxisAngle(_AZ, (sf === '_L' ? -1 : 1) * curl);
      b1.updateMatrixWorld(true);
    }
    step(dt) {
      if (!this.ok) return; const r = this.rig, B = r.bones, t = (this.t += dt), br = Math.sin(t * 1.7);
      B.hips.position.y = r.bind.hips.y; B.hips.rotation.set(0, 0.05, 0.04);
      B.spine.rotation.set(-0.03 + 0.012 * br, -0.05, -0.03); B.chest.rotation.set(-0.06 + 0.018 * br, -0.08, -0.02);
      B.head.rotation.set(-0.05 + 0.025 * Math.sin(t * 0.7), 0.16 + 0.14 * Math.sin(t * 0.43), 0.05);
      const L = (n, x, y, z) => { if (B[n]) B[n].rotation.set(x, y, z); };
      L('thigh_L', 0.02, 0, 0.1); L('shin_L', 0.02, 0, 0); L('foot_L', -0.03, 0, -0.06);           // perna de apoio
      L('thigh_R', -0.2, 0.12, -0.11); L('shin_R', 0.32, 0, 0); L('foot_R', -0.14, 0, 0.08);       // perna solta, joelho dobrado
      this.root.updateMatrixWorld(true);
      // +x = esquerda do personagem, +z = frente
      this.arm('_L', new THREE.Vector3(0.5, -0.82, -0.24), new THREE.Vector3(-0.66, -0.36, 0.62), 1.2);                       // mão na cintura
      this.arm('_R', new THREE.Vector3(-0.78, 0.32 + 0.03 * br, 0.3), new THREE.Vector3(-0.16, 0.95, 0.2 + 0.03 * br), 1.45);   // punho erguido
      if (r.tpl && r.tpl.pigs && r.pigStep) r.pigStep(Math.min(dt, 1 / 30));
      // pés no chão do prato: ajusta a altura pela posição real dos tornozelos
      const fa = B.foot_L, fb = B.foot_R; if (fa && fb && this.root.parent) {
        this.root.parent.updateMatrixWorld(true); const py = this.root.parent.getWorldPosition(_hv).y;
        const y = Math.min(fa.getWorldPosition(new THREE.Vector3()).y, fb.getWorldPosition(new THREE.Vector3()).y) - py;
        this.root.position.y += 0.035 * this.S - y; this.root.updateMatrixWorld(true); }
    }
    dispose() { if (this.rig.dispose) this.rig.dispose(); else if (this.root.parent) this.root.parent.remove(this.root); }
  }

  const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color(), sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const Showroom = {
    rig: 'menu', mode: 'ext', goal: 'ext', fade: 0, userYaw: 0, drag: null, idle: 9, rev: 9, focus: 'vehicle', focusK: 0,
    build(renderer) {
      this.renderer = renderer; ENC = renderer.outputEncoding; SRGB = ENC === THREE.sRGBEncoding; ANISO = (window.TX && TX.aniso) || 4;
      const sc = this.scene = new THREE.Scene();
      this.cam = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 1, 1800);
      // CÉU, NUVENS, SOL e LUA: os mesmos shaders da corrida (js/sky.js) + névoa na cor do horizonte (igual à pista)
      sc.background = new THREE.Color(0xcdf3ff); sc.fog = new THREE.Fog(0xcdf3ff, 260, 900);
      this.sky = window.SkyKit ? SkyKit.build(sc, Math.min(1, this.cam.far * 0.85 / 1400)) : null;
      this.dayT = GAR.DAY_START; this.nightF = 0; this.SUNDIR = new THREE.Vector3(0.4, 0.7, 0.3).normalize();
      this.hemi = new THREE.HemisphereLight(0xf2f8ff, 0x8fb37a, 0.75); sc.add(this.hemi);
      const key = this.key = new THREE.DirectionalLight(0xffffff, 0.85); key.castShadow = true; key.shadow.mapSize.set(GAR.SHADOW_MAP, GAR.SHADOW_MAP);
      Object.assign(key.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 140 }); key.shadow.camera.updateProjectionMatrix();
      key.shadow.bias = -0.0006; key.shadow.normalBias = 0.03; sc.add(key, key.target);
      this.rim = new THREE.DirectionalLight(0xffe0b0, 0.5); sc.add(this.rim, this.rim.target);
      // cenário
      const gTex = glowTex();
      const ext = buildExterior(gTex); this.ext = ext.R; this.extK = ext; ext.R.scale.setScalar(U); sc.add(ext.R);
      this.world = new THREE.Group(); this.world.name = 'Showroom-mundo'; sc.add(this.world);
      try { this.worldK = buildWorld(this.world); } catch (e) { console.warn('[Vitrine] assets da corrida no lobby', e); this.worldK = { lights: [], halos: [] }; }
      this.int = buildInterior(gTex); this.int.scale.setScalar(U); this.int.position.set(0, 0, ZI); sc.add(this.int);
      this.door = { mesh: ext.door, bar: ext.bar, tex: ext.dTex, k: 0, lin: 0, target: 0 }; this.setDoor(0);
      // reflexo dos vidros: cubemap da própria cena
      try { this.cubeRT = new THREE.WebGLCubeRenderTarget(128, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
        this.cubeCam = new THREE.CubeCamera(1, 1200, this.cubeRT); this.cubeCam.position.set(0, 4.5, FZ * U + 6); sc.add(this.cubeCam); GLASS_U.tEnv.value = this.cubeRT.texture; this._cubeT = -1;
      } catch (e) { console.warn('[Vitrine] reflexo dos vidros', e); }
      // veículo
      this.turn = new THREE.Group(); sc.add(this.turn);
      this.spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); this.spark.scale.setScalar(12); sc.add(this.spark);
      this.t = 0; this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3(); this.snap = true;
      this.zoom = { vehicle: GAR.CAM_DIST, pilot: GAR.PILOT_DIST }; this.dist = GAR.CAM_DIST;
      const first = () => this.setSpec(Custom.spec);
      if (window.Toon && Toon.during) Toon.during(first); else first();
      this.applyMode('ext', true); this.initUi(); this.bindDrag(); this.initFx(); this.stepSky(0);
      window.Garagem3D = { status: 'ok', C: GAR };
      console.info('[Vitrine] cenário montado com os assets da corrida' + (this.fx ? ' (profundidade de campo ligada)' : ''));
    },
    initUi() {
      const st = document.createElement('style');
      st.textContent = '#garFade{position:fixed;inset:0;z-index:9;background:#000;opacity:0;pointer-events:none}#garage{transition:opacity .4s ease}body.garWait #garage{opacity:0!important}body.garWait #garage *{pointer-events:none!important}';
      document.head.appendChild(st);
      this.fadeEl = document.createElement('div'); this.fadeEl.id = 'garFade'; this.fadeEl.setAttribute('aria-hidden', 'true'); document.body.appendChild(this.fadeEl);
    },
    setDoor(k) {
      const D = this.door; D.k = k; const vis = Math.max(0.03, 1 - k * 0.97);
      D.mesh.scale.y = vis; D.mesh.position.y = DOOR_H - DOOR_H * vis / 2; D.tex.repeat.y = vis; D.bar.position.y = DOOR_H * (1 - vis) + 0.04;
      D.mesh.children.forEach(c => { if (c.material && c.material.uniforms && c.material.uniforms.uRepY) c.material.uniforms.uRepY.value = vis; });
    },
    applyMode(m, first) {
      this.mode = m; const int = m === 'int';
      if (this.swap) this.endSwap();
      this.ext.visible = !int; this.world.visible = !int; if (this.sky) ['sky', 'stars', 'moon', 'sunGlow', 'sunCore', 'moonGlow', 'cloudLayer'].forEach(k => { if (this.sky[k]) this.sky[k].visible = !int; });
      this.turn.position.set(0, int ? 0.122 * U : 0, int ? ZI : 0);
      const c = this.turn.position, K = this.key, R = this.rim, H = this.hemi;
      if (int) { H.intensity = 0.5; H.color.set(0xf4f1ea); H.groundColor.set(0x2a2622); K.intensity = 0.95; K.color.set(0xfff3e2); K.position.set(c.x - 9, 34, c.z + 20); R.intensity = 0.75; R.color.set(0xcfe2ff); R.position.set(c.x + 16, 12, c.z - 18); }
      else { R.intensity = 0.5; R.color.set(0xffe0b0); R.position.set(-12, 6, -10); this.stepSky(0); }
      K.target.position.set(c.x, 0, c.z); R.target.position.set(c.x, 0, c.z); K.target.updateMatrixWorld(); R.target.updateMatrixWorld();
      this.pilotVis(); this.snap = true; this.userYaw = 0; this.spinV = 0;
      if (int) { this.rev = 0; this.dist = this.zoom[this.focus] * 1.08; const g = document.getElementById('garage'); if (g) { g.classList.remove('enter'); void g.offsetWidth; g.classList.add('enter'); } }
      else { if (!first) this.setDoor(this.door.lin = 1); this.setFocus('vehicle', true); }
    },
    pilotVis() {
      const K = this.kart; if (!K) return; const show = this.mode !== 'int' || !!GAR.PILOT_IN_GARAGE;
      const po = K.pilot, obj = po && (po.isObject3D ? po : (po.group || po.root || po.obj || po.model));
      if (obj && obj.isObject3D) { if (obj.visible !== show) obj.visible = show; return; }
      K.group.traverse(o => { if ((o.isSkinnedMesh || o.isBone) && o.visible !== show) o.visible = show; });
    },
    stepMode(dt) {
      const D = this.door, want = this.goal; let fadeT = 0;
      if (this.mode !== want) {
        if (want === 'int' && !this._opened) { D.target = 1; if (D.k > 0.6 || reduceMotion()) this._opened = true; }
        else fadeT = 1;
        if (this.fade >= 0.999) this.applyMode(want);
      } else if (this.mode === 'ext') { D.target = 0; this._opened = false; }
      const v = dt / Math.max(0.05, GAR.FADE_TIME); this.fade = Math.max(0, Math.min(1, this.fade + Math.max(-v, Math.min(v, fadeT - this.fade))));
      const op = this.fade.toFixed(3); if (this.fadeEl && this._op !== op) { this._op = op; this.fadeEl.style.opacity = op; }
      if (D.lin !== D.target) { const s = dt / GAR.DOOR_TIME; D.lin = Math.max(0, Math.min(1, D.lin + (D.target > D.lin ? s : -s))); this.setDoor(ease(D.lin)); }
      const wait = want === 'int' && this.mode !== 'int'; if (wait !== this._wait) { this._wait = wait; document.body.classList.toggle('garWait', wait); }
    },
    setSpec(spec, dir) {
      const old = this.kart; this.endSwap();
      this.kart = buildKartModel(Object.assign({}, spec), {}); this.turn.add(this.kart.group);
      if (GAR.VEHICLE_SCALE !== 1) this.kart.group.scale.multiplyScalar(GAR.VEHICLE_SCALE);
      this.kart.group.traverse(o => { if (!o.isMesh) return; o.receiveShadow = false;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        if (ms.every(m => m && !(m.transparent && (m.opacity < 0.9 || m.depthWrite === false)) && !(m.userData && m.userData.outline))) o.castShadow = true; });
      this.kart.s0 = this.kart.group.scale.x; this.pilotVis();
      if (old && dir && this.mode === 'int' && this.focus === 'vehicle' && !reduceMotion()) {
        this.cam.updateMatrixWorld(); const side = new THREE.Vector3().setFromMatrixColumn(this.cam.matrixWorld, 0); side.y = 0; side.normalize();
        const local = side.clone().applyQuaternion(this.turn.getWorldQuaternion(new THREE.Quaternion()).invert());
        this.swap = { old, dir, t: 0, local, world: side, dist: GAR.SWAP_DIST, fov0: this.cam.fov };
        old.s0 = old.s0 || old.group.scale.x; this.poseSwap(0);
      } else { if (old) { this.turn.remove(old.group); old.dispose(); } this.pulse(spec.color); }
      this.applyFocus();
    },
    poseSwap(u) {
      const S = this.swap; if (!S) return;
      const outE = ease(Math.min(1, u / 0.55)), inU = Math.max(0, Math.min(1, (u - 0.3) / 0.7));
      const back = x => { const c1 = 1.55, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
      const inE = back(inU), slide = 1 - ease(inU), o = S.old.group, n = this.kart.group;
      o.position.copy(S.local).multiplyScalar(-S.dir * S.dist * outE); o.rotation.y = -S.dir * 1.1 * outE; o.scale.setScalar(S.old.s0 * Math.max(0.001, 1 - 0.9 * outE)); o.visible = outE < 0.999;
      n.position.copy(S.local).multiplyScalar(S.dir * S.dist * slide); n.rotation.y = S.dir * 1.1 * slide; n.scale.setScalar(this.kart.s0 * Math.max(0.001, 0.1 + 0.9 * inE)); n.visible = u > 0.3;
    },
    endSwap() {
      const S = this.swap; if (!S) return; this.swap = null;
      this.turn.remove(S.old.group); S.old.dispose();
      if (this.kart) { const g = this.kart.group; g.position.set(0, 0, 0); g.rotation.y = 0; g.scale.setScalar(this.kart.s0); g.visible = true; }
    },
    isSwapping() { return !!this.swap; },
    apply(id, spec) {
      if (!this.kart) return;
      if (!Custom.applyTo(this.kart, id)) { this.setSpec(spec, id === 'model' ? this.swapDir || 0 : 0); this.swapDir = 0; }
      else { this.pilotVis(); this.pulse(id === 'color' ? spec.color : null); }
      // piloto em destaque: troca de personagem remonta; cores só repintam
      if (this.hero) { if (id === 'pilot') { this.hero.dispose(); this.hero = null; this.makeHero(); this.pulse(spec.suit); } else if (id === 'suit' || id === 'helmet' || id === 'skin') { this.hero.setColors(spec); this.pulse(id === 'suit' ? spec.suit : null); } }
    },
    // ---------- aba Piloto: personagem em destaque no lugar do veículo ----------
    makeHero() { if (this.hero || !window.Pilot) return; try { const H = this.hero = new HeroPilot(Custom.spec); this.turn.add(H.root); H.step(0);
        // escala pela altura real (pescoço -> tornozelo), igual para Menino e Menina: o personagem fica com ~GAR.PILOT_SCALE de altura
        const B = H.rig.bones; if (H.ok && B.head && B.foot_L) { H.root.scale.setScalar(1); H.root.updateMatrixWorld(true);
          const hh = B.head.getWorldPosition(new THREE.Vector3()).y - B.foot_L.getWorldPosition(new THREE.Vector3()).y;
          if (hh > 1e-4) H.S = GAR.PILOT_SCALE * 0.78 / hh; H.root.scale.setScalar(H.S); H.root.position.y = 0; H.step(0); } this.applyFocus(); } catch (e) { console.warn('[Vitrine] piloto em destaque', e); this.hero = null; } },
    setFocus(f, instant) {
      f = f === 'pilot' ? 'pilot' : 'vehicle'; if (f === this.focus && !instant) return; this.focus = f;
      if (f === 'pilot') this.makeHero(); if (instant) this.focusK = f === 'pilot' ? 1 : 0; this.applyFocus(); this.idle = 9;
      this.zoom[f] = Math.max(GAR.ZOOM_MIN, Math.min(GAR.ZOOM_MAX, this.zoom[f]));
    },
    applyFocus() {
      const k = ease(this.focusK), back = x => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
      if (this.kart && !this.swap) { const g = this.kart.group; g.visible = k < 0.995; g.scale.setScalar(this.kart.s0 * Math.max(0.001, 1 - k)); }
      if (this.hero) { const h = this.hero.root, v = this.focusK; h.visible = v > 0.005; h.scale.setScalar(this.hero.S * Math.max(0.001, back(Math.max(0, Math.min(1, v))))); }
    },
    pulse(hex) { if (hex) this.spark.material.color.set(hex); this.spark.material.opacity = this.mode === 'int' ? 0.5 : 0.85; this.hop = 0.35; },
    setRig(name) { this.rig = name; this.goal = name === 'garage' ? 'int' : 'ext'; },
    // arrastar gira a plataforma (360°); roda do mouse / pinça = zoom com limites (ZOOM_MIN..ZOOM_MAX)
    bindDrag() {
      const el = this.renderer.domElement, on = () => window.Game && Game.state === 'garage' && this.mode === 'int', pts = new Map();
      el.addEventListener('pointerdown', e => { if (!on()) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2) { const [a, b] = [...pts.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoom[this.focus] }; this.drag = null; }
        else if (e.button === 0) { this.drag = { x: e.clientX }; this.spinV = 0; document.body.classList.add('dragging'); } });
      addEventListener('pointermove', e => { if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pinch && pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); this.setZoom(this.pinch.z * this.pinch.d / Math.max(20, d)); return; }
        if (!this.drag) return; const dx = e.clientX - this.drag.x; this.drag.x = e.clientX; this.userYaw += dx * 0.01; this.spinV = dx * 0.01; });
      const up = e => { pts.delete(e.pointerId); if (pts.size < 2) this.pinch = null; if (this.drag) { this.drag = null; this.idle = 0; document.body.classList.remove('dragging'); } };
      addEventListener('pointerup', up); addEventListener('pointercancel', up);
      el.addEventListener('wheel', e => { if (!on()) return; e.preventDefault(); const k = Math.exp(Math.max(-0.4, Math.min(0.4, (e.deltaMode ? e.deltaY * 30 : e.deltaY) * 0.0012))); this.setZoom(this.zoom[this.focus] * k); this.idle = 0; }, { passive: false });
    },
    setZoom(d) { this.zoom[this.focus] = Math.max(GAR.ZOOM_MIN, Math.min(GAR.ZOOM_MAX, d)); },
    // ---------- ciclo dia/noite do lobby (mesma conta e mesma paleta da corrida: main.js > Env.step) ----------
    stepSky(dt) {
      const S = this.sky; if (!S) return; const D = SkyKit.DN, mix = SkyKit.dnMix;
      const e0 = -Math.cos(this.dayT * 6.2832); this.dayT = (this.dayT + dt / GAR.DAY_SECONDS * (e0 < -0.15 ? 2 : 1)) % 1;
      const a = this.dayT * 6.2832; this.SUNDIR.set(Math.sin(a) * 0.85, -Math.cos(a), 0.45).normalize();
      const e = this.SUNDIR.y, nf = this.nightF = sm((0.08 - e) / 0.28);
      mix(D.top, e, _c1); mix(D.mid, e, _c2); mix(D.hor, e, _c3); S.skyU.uTop.value.copy(_c1); S.skyU.uMid.value.copy(_c2); S.skyU.uHor.value.copy(_c3);
      this.scene.fog.color.copy(_c3); this.scene.background.copy(_c3);
      const cp = this.cam.position, sv = sm((e + 0.12) / 0.2);
      S.sky.position.copy(cp); S.stars.position.copy(cp); S.stars.material.opacity = nf * 0.95; S.stars.rotation.y = this.dayT * 1.2;
      S.sunGlow.material.opacity = 0.8 * sv; S.sunCore.material.opacity = sv; mix(D.sun, e, S.sunGlow.material.color);
      S.sunGlow.position.copy(cp).addScaledVector(this.SUNDIR, 1300); S.sunCore.position.copy(S.sunGlow.position);
      S.skyU.uSun.value.copy(this.SUNDIR); S.skyU.uSunCol.value.copy(S.sunGlow.material.color).multiplyScalar(sv * (1 - nf * 0.85));
      S.moon.position.copy(cp).addScaledVector(this.SUNDIR, -1250); S.moonGlow.position.copy(S.moon.position);
      const mv = sm((-e + 0.12) / 0.2); S.moon.material.opacity = mv; S.moonGlow.material.opacity = 0.35 * mv;
      mix(D.cloud, e, S.cloudM.color);
      if (this.mode !== 'int') {   // luz do pátio: sol (ou lua) e céu
        const sunI = 0.95 * sm((e + 0.02) / 0.32), moonI = 0.32 * sm((-e - 0.02) / 0.25), K = this.key, H = this.hemi;
        if (sunI >= moonI) { K.intensity = sunI; mix(D.sun, e, K.color); } else { K.intensity = moonI; K.color.set(0x9db4ff); }
        const Ld = this.SUNDIR.clone(); if (sunI < moonI) Ld.negate(); if (Ld.y < 0.15) { Ld.y = 0.15; Ld.normalize(); }
        K.position.copy(K.target.position).addScaledVector(Ld, 60);
        H.intensity = 0.32 + 0.48 * sm((e + 0.15) / 0.45); mix(D.hS, e, H.color); mix(D.hG, e, H.groundColor);
        this.rim.intensity = 0.5 * (1 - nf * 0.7);
      }
      { const U2 = S.cloudU; S.cloudOff.x += dt * 18; S.cloudOff.y += dt * 7; S.cloudT += dt; U2.uT.value = S.cloudT;
        S.cloudLayer.position.set(cp.x, cp.y + GAR.CLOUD_H, cp.z); U2.uR.value = Math.min(2200, Math.sqrt(Math.max(1e4, this.cam.far * this.cam.far * 0.9 - 540 * 540))); U2.uCam.value.copy(cp); U2.uSun.value.copy(this.SUNDIR);
        U2.uLit.value.copy(S.cloudM.color); U2.uShade.value.copy(S.cloudM.color).multiplyScalar(0.74).lerp(this.hemi.color, 0.25);
        U2.uSunCol.value.copy(S.sunGlow.material.color).multiplyScalar(sv); U2.uFog.value.copy(this.scene.fog.color); }
      // à noite: cenário perde a luz própria, arandelas/letreiro/postes acendem, vidro reflete menos
      const X = this.extK; if (X) { X.mats.forEach(m => { m.emissiveIntensity = m.userData.e0 * (1 - 0.72 * nf); });
        X.nightUp.forEach(n => { n.o.material.opacity = n.day + (n.night - n.day) * nf; });
        X.glass.forEach(g => { g.material.uniforms.uNight.value = nf; });
        const L = X.sign && X.sign(); if (L) L.userData.U.uSelf.value = 0.2 + 0.55 * nf; }
      const W = this.worldK; if (W) { W.lights.forEach(l => { l.intensity = 2.6 * nf; }); W.halos.forEach((h, k) => { h.material.opacity = (k % 2 ? 0.32 : 0.95) * nf; });
        if (W.lampGlass) W.lampGlass.emissiveIntensity = 0.12 + 1.78 * nf; }
      if (window.GfxFX) GfxFX.windU.value = this.t;   // vento nas árvores e moitas (mesmo shader da corrida)
    },
    // reflexo dos vidros: renderiza o cubemap de vez em quando (o céu muda devagar)
    updateCube() {
      if (!this.cubeCam || this.mode === 'int') return; const now = performance.now() / 1000; if (this._cubeT >= 0 && now - this._cubeT < 4) return; this._cubeT = now;
      const r = this.renderer, X = this.extK, au = r.shadowMap.autoUpdate; X.glass.forEach(g => g.visible = false); const sp = this.spark.visible, cl = this.sky && this.sky.cloudLayer, clv = cl && cl.visible; this.spark.visible = false; if (cl) cl.visible = false;   // nuvens fora do reflexo (raymarch caro x6)
      try { r.shadowMap.autoUpdate = false; this.cubeCam.update(r, this.scene); } catch (e) { console.warn('[Vitrine] cubemap', e); this.cubeCam = null; }
      r.shadowMap.autoUpdate = au; X.glass.forEach(g => g.visible = true); this.spark.visible = sp; if (cl) cl.visible = clv;
    },
    step(dt) {
      dt = Math.min(0.1, dt || 0); this.t += dt; const t = this.t;
      this.stepMode(dt); this.stepSky(dt);
      const int = this.mode === 'int', c = this.cam, aspect = innerWidth / innerHeight, wide = innerWidth > 860, T = this.turn.position;
      // troca veículo <-> piloto em destaque
      const ft = int && this.focus === 'pilot' ? 1 : 0;
      if (this.focusK !== ft) { this.focusK = reduceMotion() ? ft : Math.max(0, Math.min(1, this.focusK + Math.sign(ft - this.focusK) * dt / 0.55)); this.applyFocus();
        if (this.focusK === 0 && this.hero && this.focus !== 'pilot') { this.hero.dispose(); this.hero = null; } }
      if (int) {
        this.rev += dt; const e = ease(this.rev / 1.9);
        if (!this.drag) { this.userYaw += (this.spinV || 0); this.spinV = (this.spinV || 0) * Math.max(0, 1 - 4 * dt); this.idle += dt;
          if (this.idle > 2.5) { this.userYaw = Math.atan2(Math.sin(this.userYaw), Math.cos(this.userYaw)); this.userYaw *= Math.exp(-2.5 * dt); } }
        this.turn.rotation.y = GAR.CAM_AZIMUTH * Math.PI / 180 + this.userYaw - (1 - e) * 0.8;
      } else this.turn.rotation.y = GAR.EXT_YAW * Math.PI / 180;
      if (this.kart) {
        this.hop = Math.max(0, (this.hop || 0) - dt);
        this.kart.body.position.y = Math.sin(this.hop / 0.35 * Math.PI) * (int ? 0.22 : 0.5);
        const st = int ? 0 : Math.sin(t * 0.9) * 0.5 + Math.sin(t * 2.3) * 0.15;
        this.kart.animate(dt, { steer: st, speed: 0, boost: false, drift: 0 });
        if (int && !GAR.PILOT_IN_GARAGE) this.pilotVis();
      }
      if (this.hero && this.hero.root.visible) this.hero.step(dt);
      this.spark.position.set(T.x, T.y + 2, T.z); this.spark.material.opacity *= Math.max(0, 1 - dt * 3);
      // câmera
      const P = new THREE.Vector3(), L = new THREE.Vector3(); let fov = 36, k = Math.min(1, 3 * dt);
      if (int) {
        const pf = ease(this.focusK), e = ease(this.rev / 2.2);
        this.dist += (this.zoom[this.focus] - this.dist) * Math.min(1, 8 * dt);
        const d = Math.min(GAR.ZOOM_MAX, this.dist * (1 + 0.06 * (1 - e)));                                   // nunca passa da parede da frente
        const fovV = Math.max(GAR.CAM_FOV, 2 * Math.atan(4.4 / (d * aspect)) * 180 / Math.PI), fovP = Math.max(GAR.CAM_FOV, 2 * Math.atan(2.8 / d) * 180 / Math.PI, 2 * Math.atan(2.0 / (d * aspect)) * 180 / Math.PI);
        fov = fovV + (fovP - fovV) * pf;
        const ly = GAR.LOOK_Y - (wide ? 0 : 0.5) + (GAR.PILOT_LOOK_Y - GAR.LOOK_Y) * pf;
        P.set(T.x + Math.sin(t * 0.3) * 0.35, GAR.CAM_HEIGHT + (GAR.PILOT_CAM_H - GAR.CAM_HEIGHT) * pf, T.z + d); L.set(T.x, ly, T.z); k = 1;
      } else if (this.goal === 'int') { P.set(-1.2, 3.6, 15); L.set(0, 2.6, -13); k = Math.min(1, 1.5 * dt); }
      else if (this.rig === 'setup') { if (wide) { P.set(0, 6.5, 24); L.set(0, 2.2, 0); } else { P.set(0, 8, 27); L.set(0, 4, 0); } }
      else if (wide) { P.set(-6.0, 4.6, 20); L.set(-5.6, 2.2, 0); } else { P.set(0, 7.5, 26); L.set(0, 4.6, 0); }
      if (this.snap || k >= 1) { this.camPos.copy(P); this.camLook.copy(L); this.snap = false; } else { this.camPos.lerp(P, k); this.camLook.lerp(L, k); }
      c.position.copy(this.camPos); c.lookAt(this.camLook);
      if (this.swap) {
        const S = this.swap; S.t += Math.min(0.05, dt); const u = Math.min(1, S.t / GAR.SWAP_TIME), w = Math.sin(Math.PI * u);
        this.poseSwap(u); c.position.addScaledVector(S.world, S.dir * 0.18 * w); c.lookAt(this.camLook.clone().addScaledVector(S.world, S.dir * 0.32 * w)); fov -= 2 * w;
        if (u >= 1) { this.endSwap(); this.applyFocus(); this.pulse(null); }
      }
      if (c.aspect !== aspect || Math.abs(c.fov - fov) > 1e-3) { c.aspect = aspect; c.fov = fov; c.updateProjectionMatrix(); }
      this.updateCube();
    },
    resize() { if (this.cam) { this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix(); } },

    // ---------- desenho: cena -> textura (cor + profundidade) -> profundidade de campo -> tela ----------
    initFx() {
      const r = this.renderer;
      try {
        if (!(GAR.DOF > 0) || !(r.capabilities.isWebGL2 || r.extensions.get('WEBGL_depth_texture'))) return;
        const rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, stencilBuffer: false });
        rt.texture.generateMipmaps = false; rt.texture.encoding = r.outputEncoding;
        rt.depthTexture = new THREE.DepthTexture(4, 4); rt.depthTexture.type = THREE.UnsignedIntType;
        const u = { tC: { value: rt.texture }, tD: { value: rt.depthTexture }, uPx: { value: new THREE.Vector2() }, uNear: { value: 1 }, uFar: { value: 400 }, uFocus: { value: 15 }, uRange: { value: 3 }, uFall: { value: 14 }, uMax: { value: 8 }, uVig: { value: 0 } };
        const mat = new THREE.ShaderMaterial({ uniforms: u, depthTest: false, depthWrite: false, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: DOF_FRAG });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; const scene = new THREE.Scene(); scene.add(quad);
        this.fx = { rt, u, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), size: new THREE.Vector2(), w: 0, h: 0 };
      } catch (e) { console.warn('[Vitrine] profundidade de campo indisponível', e); this.fx = null; }
    },
    render(renderer) {
      const r = renderer || this.renderer, F = this.fx;
      if (!F) { r.render(this.scene, this.cam); return; }
      try {
        r.getDrawingBufferSize(F.size); const ss = Math.min(GAR.DOF_SS, 2600 / Math.max(1, F.size.x)), w = Math.max(2, Math.round(F.size.x * Math.max(1, ss))), h = Math.max(2, Math.round(F.size.y * Math.max(1, ss)));
        if (w !== F.w || h !== F.h) { F.w = w; F.h = h; F.rt.setSize(w, h); }
        const c = this.cam, u = F.u, int = this.mode === 'int', T = this.turn.position;
        c.updateMatrixWorld(); const e = c.matrixWorld.elements;
        u.uFocus.value = Math.max(2, -((T.x - e[12]) * e[8] + (T.y + 1 - e[13]) * e[9] + (T.z - e[14]) * e[10]));   // foco no veículo
        u.uNear.value = c.near; u.uFar.value = c.far; u.uPx.value.set(1 / F.size.x, 1 / F.size.y);
        u.uRange.value = int ? 3.4 : 7; u.uFall.value = int ? 11 : 45; u.uMax.value = (int ? 10 : 5) * GAR.DOF * F.size.y / 1080; u.uVig.value = int ? 0.42 : 0.12;
        r.setRenderTarget(F.rt); r.render(this.scene, c); r.setRenderTarget(null); r.render(F.scene, F.cam);
      } catch (err) { console.warn('[Vitrine] profundidade de campo desligada', err); this.fx = null; r.setRenderTarget(null); r.render(this.scene, this.cam); }
    }
  };
  window.Showroom = Showroom;
})();
