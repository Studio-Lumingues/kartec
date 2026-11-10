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
    CAM_DIST: 15,            // Garagem: distância da câmera ao veículo
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
  const ZI = -30;                                      // centro da plataforma interna (z, em unidades); a fachada fica em z = -13
  const RW = 15, Z0 = -5.5, Z1 = 8.5, RD = Z1 - Z0, RH = 4;   // sala interna em metros (origem na plataforma)
  const DOOR_W = 5, DOOR_H = 2.9, FZ = -6.5, FW = 17, FH = 4.4;   // fachada em metros (origem no veículo do pátio)
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
    g.fillStyle = rad(g, 0, 0, 3.9, [[0, 'rgba(255,255,255,0)'], [0.6, 'rgba(255,255,255,0)'], [0.645, 'rgba(255,250,240,.75)'], [0.72, 'rgba(255,240,220,.28)'], [1, 'rgba(255,240,220,0)']]); g.fillRect(-4, -4, 8, 8);   // anel de LED da plataforma
    g.fillStyle = lin(g, 0, Z0, 0, Z0 + 3.2, 'rgba(232,33,58,.5)', 'rgba(232,33,58,0)'); g.fillRect(-7.5, Z0, RW, 3.2);                     // fita vermelha do rodapé
    [-4.3, 4.3].forEach(x => { g.save(); g.translate(x, Z0); g.scale(0.4, 4.6); g.fillStyle = rad(g, 0, 0, 1, [[0, 'rgba(255,240,215,.75)'], [1, 'rgba(255,240,215,0)']]); g.fillRect(-1, 0, 2, 1); g.restore(); });   // barras de LED
    g.save(); g.translate(0, Z0); g.scale(3.6, 2.6); g.fillStyle = rad(g, 0, 0, 1, [[0, 'rgba(255,225,205,.42)'], [1, 'rgba(255,225,205,0)']]); g.fillRect(-1, 0, 2, 1); g.restore();   // painel da marca
    g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 0.03; g.beginPath(); g.arc(0, 0, 3.15, 0, 6.2832); g.stroke();
    g.strokeStyle = GAR.ACCENT; g.lineWidth = 0.05; g.globalAlpha = 0.75; [[0.5, 1.3], [1.85, 2.65], [3.64, 4.44], [5.0, 5.8]].forEach(a => { g.beginPath(); g.arc(0, 0, 3.3, a[0], a[1]); g.stroke(); }); g.globalAlpha = 1;
    label(g, GAR.BRAND + '  SHOWROOM', 0, 4.25, 0.3, 'rgba(255,255,255,.3)');
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
      const red = g.createLinearGradient(0, -78, 0, 0); red.addColorStop(0, '#FFB3A8'); red.addColorStop(0.4, '#FF4D5E'); red.addColorStop(1, '#C4102B');
      label(g, GAR.BRAND, 0, 1.2, 0.92, red, { flip: true, glow: ['rgba(255,60,80,.9)', 40], strokes: [['#ffffff', 11]] });
      g.fillStyle = GAR.ACCENT; g.fillRect(-2.9, 1.0, 5.8, 0.035); g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(-2.9, 0.955, 5.8, 0.012);
    }
    g.fillStyle = lin(g, -hw, 0, -hw + 1.4, 0, 'rgba(0,0,0,.55)', 'rgba(0,0,0,0)'); g.fillRect(-hw, 0, 1.4, RH);
    g.fillStyle = lin(g, hw, 0, hw - 1.4, 0, 'rgba(0,0,0,.55)', 'rgba(0,0,0,0)'); g.fillRect(hw - 1.4, 0, 1.4, RH);
    g.fillStyle = '#060607'; g.fillRect(-hw, 0, wm, 0.1);
  });
  const discTex = () => mkTex(1024, 1024, (g, W) => {
    const c = W / 2; g.fillStyle = rad(g, c, c, c, [[0, '#4a4c52'], [0.55, '#303238'], [1, '#232428']]); g.fillRect(0, 0, W, W);
    for (let r = 14; r < c; r += 7) { g.strokeStyle = 'rgba(255,255,255,' + (0.02 + Math.random() * 0.05).toFixed(3) + ')'; g.lineWidth = 1; g.beginPath(); g.arc(c, c, r, 0, 6.2832); g.stroke(); }
    g.strokeStyle = GAR.ACCENT; g.lineWidth = 9; g.beginPath(); g.arc(c, c, c * 0.93, 0, 6.2832); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; g.beginPath(); g.arc(c, c, c * 0.905, 0, 6.2832); g.stroke();
    for (let a = 0; a < 24; a++) { const an = a / 24 * 6.2832, r0 = c * 0.8, r1 = c * (a % 6 ? 0.84 : 0.87); g.lineWidth = a % 6 ? 3 : 6; g.beginPath(); g.moveTo(c + Math.cos(an) * r0, c + Math.sin(an) * r0); g.lineTo(c + Math.cos(an) * r1, c + Math.sin(an) * r1); g.stroke(); }
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
    label(g, '01', 5.7, 0.95, 1.5, 'rgba(255,255,255,.14)', { flip: true, strokes: [['rgba(255,255,255,.55)', 3]] });
    g.fillStyle = lin(g, 0, 0.45, 0, 0, '#a4a7ad', '#84878d'); g.fillRect(-hw, 0, FW, 0.45); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-hw, 0.44, FW, 0.02);
    [-2.5, 2.5].forEach(x => { const s = Math.sign(x); g.fillStyle = lin(g, x, 0, x + s * 1.3, 0, 'rgba(255,238,205,.45)', 'rgba(255,238,205,0)'); g.fillRect(Math.min(x, x + s * 1.3), 0, 1.3, DOOR_H); });   // luz da moldura do portão
    [-7.2, 3.5, 7.9].forEach(x => { g.save(); g.translate(x, 2.75); g.scale(0.75, 2.4); g.fillStyle = rad(g, 0, 0, 1, [[0, 'rgba(255,232,190,.55)'], [1, 'rgba(255,232,190,0)']]); g.fillRect(-1, -1, 2, 1); g.restore(); });   // arandelas
    g.fillStyle = lin(g, 0, FH, 0, FH - 0.5, 'rgba(0,0,0,.45)', 'rgba(0,0,0,0)'); g.fillRect(-hw, FH - 0.5, FW, 0.5);
    g.fillStyle = lin(g, 0, 0, 0, 0.35, 'rgba(0,0,0,.4)', 'rgba(0,0,0,0)'); g.fillRect(-hw, 0, FW, 0.35);
    g.clearRect(-DOOR_W / 2, -0.1, DOOR_W, DOOR_H + 0.1);
  });
  const signTex = () => mkTex(1024, 256, (g, W, H) => {
    g.setTransform(W / 5.6, 0, 0, H / 1.4, W / 2, 0);
    label(g, GAR.BRAND_TOP + ' ' + GAR.BRAND, 0, 0.98, 0.78, '#fff6e6', { glow: ['rgba(255,214,150,.95)', 26] });
    label(g, GAR.BRAND_TOP + ' ' + GAR.BRAND, 0, 0.98, 0.78, '#ffffff');
    g.fillStyle = GAR.ACCENT; g.fillRect(-2.3, 1.12, 4.6, 0.05);
  });
  const windowTex = () => mkTex(512, 256, (g, W, H) => {
    g.fillStyle = lin(g, 0, 0, 0, H, '#ffe3a8', '#ff9f4d'); g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(90,40,10,.35)'; [[40, 150, 90, 106], [150, 120, 60, 136], [300, 96, 130, 160], [250, 170, 40, 86]].forEach(r => g.fillRect(r[0], r[1], r[2], r[3]));
    g.fillStyle = 'rgba(255,255,255,.28)'; g.beginPath(); g.moveTo(60, 0); g.lineTo(190, 0); g.lineTo(70, H); g.lineTo(-60, H); g.fill();
    g.fillStyle = '#17181b'; for (let i = 0; i <= 4; i++) g.fillRect(i * (W - 10) / 4, 0, 10, H); g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10);
  });
  const doorTex = () => mkTex(1024, 512, (g, W, H) => {
    const n = 5, sh = H / n;
    for (let i = 0; i < n; i++) { const y = i * sh; g.fillStyle = lin(g, 0, y, 0, y + sh, '#d4d8de', '#9aa0aa'); g.fillRect(0, y, W, sh); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, y + sh - 4, W, 4); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, y, W, 3);
      for (let k = 1; k < 4; k++) { g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(0, y + k * sh / 4, W, 2); } }
    for (let k = 0; k < 6; k++) { const x = 34 + k * 164, y = sh + 22; g.fillStyle = '#101216'; g.fillRect(x - 6, y - 6, 144, sh - 32); g.fillStyle = lin(g, x, y, x + 132, y + sh - 44, '#3d4b5e', '#141a22'); g.fillRect(x, y, 132, sh - 44);
      g.fillStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.moveTo(x + 20, y); g.lineTo(x + 60, y); g.lineTo(x + 20, y + sh - 44); g.lineTo(x, y + sh - 44); g.lineTo(x, y + 40); g.fill(); }
    g.fillStyle = GAR.ACCENT; g.fillRect(0, H - sh * 0.5, W, 14);
    g.fillStyle = lin(g, 0, 0, 0, 70, 'rgba(0,0,0,.45)', 'rgba(0,0,0,0)'); g.fillRect(0, 0, W, 70);
  });
  // pátio: asfalto, laje de concreto em frente ao portão, vaga pintada onde o veículo fica, faixas
  const GX = 35, GZ1 = 22, GD = GZ1 - FZ;
  const groundTex = () => mkTex(2048, 1024, (g, W, H) => {
    g.fillStyle = '#4b4e55'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) { const x = Math.random() * W, y = Math.random() * H, r = 50 + Math.random() * 200; g.fillStyle = rad(g, x, y, r, [[0, Math.random() < 0.5 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.08)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    speckle(g, W, H, 26000, 0.09);
    g.setTransform(W / (2 * GX), 0, 0, H / GD, W / 2, H * -FZ / GD);                    // metros (x, z), origem no veículo
    g.fillStyle = '#8f9299'; g.fillRect(-3.4, FZ, 6.8, 9.9);                             // laje
    g.fillStyle = 'rgba(0,0,0,.28)'; for (let z = FZ + 2.2; z < 3.4; z += 2.2) g.fillRect(-3.4, z, 6.8, 0.04); g.fillRect(-0.02, FZ, 0.04, 9.9);
    g.fillStyle = '#f2f3f5'; g.fillRect(-3.5, FZ, 0.12, 9.9); g.fillRect(3.38, FZ, 0.12, 9.9); g.fillRect(-3.5, 3.34, 7, 0.12);
    g.save(); g.beginPath(); g.rect(-2.5, FZ, 5, 0.4); g.clip(); g.fillStyle = '#f2c418'; g.fillRect(-2.5, FZ, 5, 0.4); g.fillStyle = '#17181b'; for (let x = -3; x < 3; x += 0.5) { g.beginPath(); g.moveTo(x, FZ); g.lineTo(x + 0.25, FZ); g.lineTo(x + 0.65, FZ + 0.4); g.lineTo(x + 0.4, FZ + 0.4); g.fill(); } g.restore();
    g.strokeStyle = GAR.ACCENT; g.lineWidth = 0.1; g.lineCap = 'butt';                      // vaga do veículo (cantoneiras)
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(c => { g.beginPath(); g.moveTo(c[0] * 1.9, c[1] * 2.4 - c[1] * 0.9); g.lineTo(c[0] * 1.9, c[1] * 2.4); g.lineTo(c[0] * 1.9 - c[0] * 0.9, c[1] * 2.4); g.stroke(); });
    g.fillStyle = 'rgba(242,243,245,.8)'; for (let x = -34; x < 34; x += 3) { if (Math.abs(x + 1) < 5) continue; g.fillRect(x, 6.4, 1.6, 0.14); }
    for (let k = 0; k < 6; k++) g.fillRect(-12 + k * -2.6, FZ + 0.6, 0.1, 4.4);            // vagas à esquerda
    label(g, GAR.BRAND, -15, 1.6, 1.5, 'rgba(242,243,245,.5)');
    [[-0.9, 20, -0.6, 4], [0.9, 20, 0.6, 4]].forEach(a => { g.strokeStyle = 'rgba(8,8,10,.22)'; g.lineWidth = 0.2; g.lineCap = 'round'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a[2], a[3]); g.stroke(); });
    g.fillStyle = lin(g, 0, FZ, 0, FZ + 1.3, 'rgba(0,0,0,.5)', 'rgba(0,0,0,0)'); g.fillRect(-GX, FZ, 2 * GX, 1.3);
    g.fillStyle = rad(g, 0, FZ, 5, [[0, 'rgba(255,236,200,.25)'], [1, 'rgba(255,236,200,0)']]); g.fillRect(-5, FZ, 10, 5);
  });

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
    return { std, soft, lit, put, box, cyl, plane, glow, grp, tag };
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
    const ring = K.put(new THREE.TorusGeometry(2.5, 0.022, 8, 96), led, 0, 0.03, 0, R); ring.rotation.x = Math.PI / 2;
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
    [[-RW / 2 + 0.03, Math.PI / 2], [RW / 2 - 0.03, -Math.PI / 2]].forEach(s => { [-1.6, 3.6].forEach(z => { K.plane(3.6, 1.7, K.lit('#fff1dc'), s[0], 2.15, z, s[1]); K.plane(3.8, 1.9, dark, s[0] + Math.sign(s[0]) * 0.012, 2.15, z, s[1]).receiveShadow = false; K.glow(5.4, 3.4, '#ffe9c8', 0.4, s[0] - Math.sign(s[0]) * 0.05, 2.15, z, s[1]); }); });
    const tr = K.grp(-6.5, 1.2); K.box(0.62, 0.95, 1.5, red, 0, 0.6, 0, tr); K.box(0.66, 0.04, 1.56, dark, 0, 1.09, 0, tr);
    const tp = K.plane(1.44, 0.89, K.std(null, 0.38, 0.35, cT), 0.315, 0.6, 0, Math.PI / 2, tr); tp.castShadow = false;
    tireStack(K, 6.55, 0.6, 3); tireStack(K, 6.5, 1.75, 4);
    // teto: anel de luz sobre a plataforma, réguas de LED e vigas
    const halo = K.put(new THREE.TorusGeometry(2.7, 0.06, 10, 96), led, 0, 3.35, 0, R); halo.rotation.x = Math.PI / 2;
    const halo2 = K.put(new THREE.TorusGeometry(2.7, 0.11, 10, 96), dark, 0, 3.43, 0, R, false); halo2.rotation.x = Math.PI / 2;
    [[-2.7, 0], [2.7, 0], [0, -2.7], [0, 2.7]].forEach(p => K.cyl(0.012, 0.012, RH - 3.45, dark, p[0], (RH + 3.45) / 2, p[1], R, 6).castShadow = false);
    [-5, 5].forEach(x => [-2.5, 2, 6].forEach(z => { const p = K.plane(0.7, 2.6, led, x, RH - 0.03, z, 0); p.rotation.x = Math.PI / 2; }));
    [-3.4, 4.6].forEach(z => K.box(RW, 0.22, 0.22, steel, 0, RH - 0.11, z, R, false));
    return R;
  }

  // ---------------------------------------------------------------- FORA: fachada, pátio e paisagem (metros; origem = veículo)
  function buildExterior(gTex) {
    const R = new THREE.Group(); R.name = 'Showroom-exterior'; const K = kit(R, gTex), hw = FW / 2;
    const gg = new THREE.PlaneGeometry(2 * GX, GD); gg.rotateX(-Math.PI / 2);
    K.put(gg, K.std(null, 0.85, 0, groundTex(), 0.5), 0, 0, (FZ + GZ1) / 2, R, false);
    const grass = new THREE.PlaneGeometry(700, 700); grass.rotateX(-Math.PI / 2); K.put(grass, K.soft('#6fbf57'), 0, -0.03, -40, R, false);
    // prédio: fachada com o vão do portão, laterais, platibanda, marquise
    const fac = K.std(null, 0.55, 0.45, facadeTex(), 0.8); fac.alphaTest = 0.5; K.plane(FW, FH, fac, 0, FH / 2, FZ, 0);
    const clad = K.std('#3a3c41', 0.55, 0.45), dark = K.std('#1b1c1f', 0.6, 0.3), alu = K.std('#c9ccd2', 0.35, 0.8), led = K.lit('#fff4e2');
    const sideW = (x, ry) => { const m = K.plane(RD + 0.4, FH, clad, x, FH / 2, FZ - (RD + 0.4) / 2, ry); m.castShadow = false; };
    sideW(-hw, -Math.PI / 2); sideW(hw, Math.PI / 2);
    K.box(FW + 0.3, 0.14, 0.5, alu, 0, FH + 0.07, FZ - 0.12, R, false);
    [-1, 1].forEach(s => { K.box(0.16, DOOR_H, 0.34, dark, s * (DOOR_W / 2 + 0.08), DOOR_H / 2, FZ - 0.13, R, false); K.box(0.05, DOOR_H - 0.1, 0.05, led, s * (DOOR_W / 2 + 0.05), DOOR_H / 2, FZ + 0.05); K.glow(1.0, DOOR_H + 1, '#ffe6bd', 0.5, s * (DOOR_W / 2 + 0.05), DOOR_H / 2, FZ + 0.08); });
    K.box(DOOR_W + 0.32, 0.16, 0.34, dark, 0, DOOR_H + 0.08, FZ - 0.13, R, false);
    K.box(DOOR_W + 1.3, 0.1, 1.15, dark, 0, DOOR_H + 0.22, FZ + 0.55, R, false); K.box(DOOR_W + 1.0, 0.03, 0.06, led, 0, DOOR_H + 0.16, FZ + 1.0); K.glow(DOOR_W + 2.4, 0.9, '#ffe6bd', 0.45, 0, DOOR_H + 0.12, FZ + 1.04);
    // portão seccionado (enrola para cima: ver setDoor)
    const dTex = doorTex(), door = K.plane(DOOR_W, DOOR_H, K.std(null, 0.4, 0.55, dTex, 0.7), 0, DOOR_H / 2, FZ - 0.1, 0);
    const bar = K.box(DOOR_W, 0.08, 0.08, K.std('#17181a', 0.8, 0), 0, 0.04, FZ - 0.08, R, false);
    // letreiro, janela acesa e arandelas
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.4), K.tag(new THREE.MeshBasicMaterial({ map: signTex(), transparent: true, depthWrite: false }))); sign.position.set(0, DOOR_H + 0.86, FZ + 0.03); sign.renderOrder = 1; R.add(sign);
    K.plane(3.7, 1.5, K.tag(new THREE.MeshBasicMaterial({ map: windowTex() })), -5.5, 1.95, FZ + 0.02, 0); K.box(3.9, 0.08, 0.16, alu, -5.5, 1.16, FZ + 0.06, R, false); K.glow(5.4, 3.0, '#ffb25e', 0.3, -5.5, 1.95, FZ + 0.06);
    [-7.2, 3.5, 7.9].forEach(x => { K.box(0.14, 0.3, 0.12, dark, x, 2.9, FZ + 0.06, R, false); K.box(0.1, 0.04, 0.1, led, x, 2.73, FZ + 0.07); K.glow(0.9, 0.9, '#ffe6bd', 0.7, x, 2.7, FZ + 0.14); });
    // jardineiras, postes, barreira de pneus, cones
    const leaf = K.soft('#3fae4a'), leaf2 = K.soft('#2f9640'), conc = K.std('#9a9da3', 0.9, 0);
    const blob = (r, mat, x, y, z, p) => K.put(new THREE.IcosahedronGeometry(r, 1), mat, x, y, z, p);
    [-3.55, 3.55, -8.0].forEach(x => { const g = K.grp(x, FZ + 0.62); K.box(1.0, 0.55, 0.9, conc, 0, 0.275, 0, g); blob(0.48, leaf, -0.14, 0.86, 0, g); blob(0.4, leaf2, 0.26, 0.8, 0.08, g); blob(0.3, leaf, 0.05, 1.18, -0.05, g); });
    [-10.5, 10.5].forEach(x => { const g = K.grp(x, -2.5), s = Math.sign(x); K.cyl(0.06, 0.08, 4.4, dark, 0, 2.2, 0, g, 10); K.box(1.0, 0.07, 0.1, dark, -s * 0.45, 4.36, 0, g); K.box(0.5, 0.05, 0.2, led, -s * 0.8, 4.31, 0, g); K.glow(1.6, 1.6, '#ffe6bd', 0.6, -s * 0.8, 4.28, 0.02, 0, g); });
    for (let i = 0; i < 9; i++) { const g = K.grp(-13.2 + i * 0.66, 3.9), m = K.std(i % 2 ? '#f2f3f5' : '#d21f37', 0.8, 0); for (let k = 0; k < 3; k++) K.cyl(0.32, 0.32, 0.25, m, 0, 0.13 + k * 0.26, 0, g, 18); }
    [[4.3, 2.9], [5.1, -1.4], [-4.5, 3.6]].forEach(p => { const g = K.grp(p[0], p[1]), o = K.std('#ff6a1a', 0.6, 0); K.box(0.42, 0.04, 0.42, o, 0, 0.02, 0, g); K.put(new THREE.ConeGeometry(0.16, 0.56, 18), o, 0, 0.32, 0, g); K.cyl(0.075, 0.108, 0.12, K.std('#f2f3f5', 0.6, 0), 0, 0.3, 0, g, 18).castShadow = false; });
    // árvores e morros ao fundo
    const trunk = K.soft('#7a5236');
    [[-11.5, -9, 1.5], [-14.5, -5.5, 1.2], [-18, -12, 1.8], [-12, -17, 1.4], [-23, -4, 1.3], [-27, -14, 2], [12, -9, 1.4], [15.5, -13, 1.9], [19, -6, 1.2], [24, -11, 1.6], [11.5, -18, 1.3], [-33, -8, 1.7], [31, -17, 2.1]].forEach(t => {
      const g = K.grp(t[0], t[1]); g.scale.setScalar(t[2]); K.cyl(0.13, 0.18, 1.5, trunk, 0, 0.75, 0, g, 8); blob(1.05, leaf, 0, 2.0, 0, g); blob(0.8, leaf2, 0.6, 2.5, 0.2, g); blob(0.75, leaf, -0.55, 2.6, -0.1, g); blob(0.62, leaf2, 0.05, 3.15, 0, g); });
    const hill = (x, z, r, hex) => { const m = K.put(new THREE.SphereGeometry(1, 28, 14), K.soft(hex), x, -r * 0.06, z, R, false); m.scale.set(r, r * 0.3, r); m.receiveShadow = false; };
    hill(-48, -62, 34, '#7fca78'); hill(8, -84, 44, '#95d4a2'); hill(54, -58, 30, '#7fca78'); hill(-88, -50, 40, '#a4dbb4'); hill(92, -80, 46, '#a4dbb4'); hill(-20, -110, 50, '#b3e2c2');
    return { R, door, bar, dTex };
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

  const Showroom = {
    rig: 'menu', mode: 'ext', goal: 'ext', fade: 0, userYaw: 0, drag: null, idle: 9, rev: 9,
    build(renderer) {
      this.renderer = renderer; ENC = renderer.outputEncoding; SRGB = ENC === THREE.sRGBEncoding; ANISO = (window.TX && TX.aniso) || 4;
      const sc = this.scene = new THREE.Scene();
      const bg = document.createElement('canvas'); bg.width = 4; bg.height = 256; const g = bg.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#4a86ff'); gr.addColorStop(0.5, '#7fd0ff'); gr.addColorStop(1, '#e6fbff'); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
      sc.background = new THREE.CanvasTexture(bg); sc.background.encoding = ENC;
      this.hemi = new THREE.HemisphereLight(0xf2f8ff, 0x8fb37a, 0.75); sc.add(this.hemi);
      const key = this.key = new THREE.DirectionalLight(0xffffff, 0.85); key.castShadow = true; key.shadow.mapSize.set(GAR.SHADOW_MAP, GAR.SHADOW_MAP);
      Object.assign(key.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 }); key.shadow.camera.updateProjectionMatrix();
      key.shadow.bias = -0.0006; key.shadow.normalBias = 0.03; sc.add(key, key.target);
      this.rim = new THREE.DirectionalLight(0xffe0b0, 0.5); sc.add(this.rim, this.rim.target);
      this.cam = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 1, 400);
      // cenário
      const gTex = glowTex();
      const ext = buildExterior(gTex); this.ext = ext.R; ext.R.scale.setScalar(U); sc.add(ext.R);
      this.int = buildInterior(gTex); this.int.scale.setScalar(U); this.int.position.set(0, 0, ZI); sc.add(this.int);
      this.door = { mesh: ext.door, bar: ext.bar, tex: ext.dTex, k: 0, lin: 0, target: 0 }; this.setDoor(0);
      // nuvens
      const cloudM = new THREE.MeshLambertMaterial({ color: 0xffffff }); cloudM.__ink = true; this.clouds = [];
      [[-60, 34, -90, 2.2], [30, 40, -110, 2.8], [-10, 46, -130, 2], [70, 30, -80, 1.7], [-90, 28, -70, 1.6], [110, 44, -120, 2.4]].forEach(([x, y, z, s]) => {
        const c = new THREE.Group(); [[0, 0, 0, 3], [2.8, -0.6, 0.4, 2.2], [-2.8, -0.7, 0, 2.1], [1, 1.2, -0.5, 2]].forEach(([a, b, d, r]) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudM); m.position.set(a, b, d); c.add(m); });
        c.position.set(x, y, z); c.scale.setScalar(s); this.ext.parent.add(c); this.clouds.push(c); });
      // veículo
      this.turn = new THREE.Group(); sc.add(this.turn);
      this.spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); this.spark.scale.setScalar(12); sc.add(this.spark);
      this.t = 0; this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3(); this.snap = true;
      const first = () => this.setSpec(Custom.spec);
      if (window.Toon && Toon.during) Toon.during(first); else first();
      this.applyMode('ext', true); this.initUi(); this.bindDrag(); this.initFx();
      window.Garagem3D = { status: 'ok', C: GAR };
      console.info('[Vitrine] cenário por código montado' + (this.fx ? ' (profundidade de campo ligada)' : ''));
    },
    // tela preta do fade + CSS: a interface da Garagem só aparece quando a vista interna aparece
    initUi() {
      const st = document.createElement('style');
      st.textContent = '#garFade{position:fixed;inset:0;z-index:9;background:#000;opacity:0;pointer-events:none}#garage{transition:opacity .4s ease}body.garWait #garage{opacity:0!important}body.garWait #garage *{pointer-events:none!important}';
      document.head.appendChild(st);
      this.fadeEl = document.createElement('div'); this.fadeEl.id = 'garFade'; this.fadeEl.setAttribute('aria-hidden', 'true'); document.body.appendChild(this.fadeEl);
    },
    // ---------- portão: k = 0 fechado, 1 aberto (a cortina enrola para cima; a textura acompanha) ----------
    setDoor(k) {
      const D = this.door; D.k = k; const vis = Math.max(0.03, 1 - k * 0.97);
      D.mesh.scale.y = vis; D.mesh.position.y = DOOR_H - DOOR_H * vis / 2; D.tex.repeat.y = vis; D.bar.position.y = DOOR_H * (1 - vis) + 0.04;
    },
    // ---------- vista: 'ext' (pátio) ou 'int' (showroom) ----------
    applyMode(m, first) {
      this.mode = m; const int = m === 'int';
      if (this.swap) this.endSwap();
      this.ext.visible = !int; this.clouds.forEach(c => c.visible = !int);
      this.turn.position.set(0, int ? 0.122 * U : 0, int ? ZI : 0);
      const c = this.turn.position, K = this.key, R = this.rim, H = this.hemi;
      if (int) { H.intensity = 0.5; H.color.set(0xf4f1ea); H.groundColor.set(0x2a2622); K.intensity = 0.95; K.color.set(0xfff3e2); K.position.set(c.x - 9, 34, c.z + 20); R.intensity = 0.75; R.color.set(0xcfe2ff); R.position.set(c.x + 16, 12, c.z - 18); }
      else { H.intensity = 0.75; H.color.set(0xf2f8ff); H.groundColor.set(0x8fb37a); K.intensity = 0.85; K.color.set(0xffffff); K.position.set(20, 36, 24); R.intensity = 0.5; R.color.set(0xffe0b0); R.position.set(-12, 6, -10); }
      K.target.position.set(c.x, 0, c.z); R.target.position.set(c.x, 0, c.z); K.target.updateMatrixWorld(); R.target.updateMatrixWorld();
      this.pilotVis(); this.snap = true; this.userYaw = 0; this.spinV = 0;
      if (int) { this.rev = 0; const g = document.getElementById('garage'); if (g) { g.classList.remove('enter'); void g.offsetWidth; g.classList.add('enter'); } }
      else if (!first) this.setDoor(this.door.lin = 1);                                              // voltando para fora: o portão ainda está aberto e fecha à vista
    },
    // piloto: aparece no pátio, some dentro da Garagem (o foco é o veículo)
    pilotVis() {
      const K = this.kart; if (!K) return; const show = this.mode !== 'int' || !!GAR.PILOT_IN_GARAGE;
      const po = K.pilot, obj = po && (po.isObject3D ? po : (po.group || po.root || po.obj || po.model));
      if (obj && obj.isObject3D) { if (obj.visible !== show) obj.visible = show; return; }
      K.group.traverse(o => { if ((o.isSkinnedMesh || o.isBone) && o.visible !== show) o.visible = show; });
    },
    stepMode(dt) {
      const D = this.door, want = this.goal; let fadeT = 0;
      if (this.mode !== want) {
        if (want === 'int' && !this._opened) { D.target = 1; if (D.k > 0.6 || reduceMotion()) this._opened = true; }   // primeiro o portão abre...
        else fadeT = 1;                                                                                              // ...depois a tela escurece
        if (this.fade >= 0.999) this.applyMode(want);
      } else if (this.mode === 'ext') { D.target = 0; this._opened = false; }
      const v = dt / Math.max(0.05, GAR.FADE_TIME); this.fade = Math.max(0, Math.min(1, this.fade + Math.max(-v, Math.min(v, fadeT - this.fade))));
      const op = this.fade.toFixed(3); if (this.fadeEl && this._op !== op) { this._op = op; this.fadeEl.style.opacity = op; }
      if (D.lin !== D.target) { const s = dt / GAR.DOOR_TIME; D.lin = Math.max(0, Math.min(1, D.lin + (D.target > D.lin ? s : -s))); this.setDoor(ease(D.lin)); }
      const wait = want === 'int' && this.mode !== 'int'; if (wait !== this._wait) { this._wait = wait; document.body.classList.toggle('garWait', wait); }
    },
    // (re)monta o veículo. dir (+1 / -1): troca animada do carrossel (o próximo entra pela direita / esquerda)
    setSpec(spec, dir) {
      const old = this.kart; this.endSwap();
      this.kart = buildKartModel(Object.assign({}, spec), {}); this.turn.add(this.kart.group);
      if (GAR.VEHICLE_SCALE !== 1) this.kart.group.scale.multiplyScalar(GAR.VEHICLE_SCALE);
      this.kart.group.traverse(o => { if (!o.isMesh) return; o.receiveShadow = false;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        if (ms.every(m => m && !(m.transparent && (m.opacity < 0.9 || m.depthWrite === false)) && !(m.userData && m.userData.outline))) o.castShadow = true; });
      this.kart.s0 = this.kart.group.scale.x; this.pilotVis();
      if (old && dir && this.mode === 'int' && !reduceMotion()) {
        this.cam.updateMatrixWorld(); const side = new THREE.Vector3().setFromMatrixColumn(this.cam.matrixWorld, 0); side.y = 0; side.normalize();
        const local = side.clone().applyQuaternion(this.turn.getWorldQuaternion(new THREE.Quaternion()).invert());
        this.swap = { old, dir, t: 0, local, world: side, dist: GAR.SWAP_DIST, fov0: this.cam.fov };
        old.s0 = old.s0 || old.group.scale.x; this.poseSwap(0);
      } else { if (old) { this.turn.remove(old.group); old.dispose(); } this.pulse(spec.color); }
    },
    // troca do carrossel (u = 0..1): o veículo atual desliza, gira e encolhe; o próximo vem do lado da seta e cresce com um quique
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
    },
    pulse(hex) { if (hex) this.spark.material.color.set(hex); this.spark.material.opacity = this.mode === 'int' ? 0.5 : 0.85; this.hop = 0.35; },
    setRig(name) { this.rig = name; this.goal = name === 'garage' ? 'int' : 'ext'; },
    // arrastar gira a plataforma na Garagem; parada por 2,5 s ela volta sozinha para a visão 3/4
    bindDrag() {
      const el = this.renderer.domElement;
      el.addEventListener('pointerdown', e => { if (window.Game && Game.state === 'garage' && this.mode === 'int' && e.button === 0) { this.drag = { x: e.clientX }; this.spinV = 0; document.body.classList.add('dragging'); } });
      addEventListener('pointermove', e => { if (!this.drag) return; const dx = e.clientX - this.drag.x; this.drag.x = e.clientX; this.userYaw += dx * 0.01; this.spinV = dx * 0.01; });
      const up = () => { if (this.drag) { this.drag = null; this.idle = 0; document.body.classList.remove('dragging'); } };
      addEventListener('pointerup', up); addEventListener('pointercancel', up);
    },
    step(dt) {
      dt = Math.min(0.1, dt || 0); this.t += dt; const t = this.t;
      this.stepMode(dt);
      const int = this.mode === 'int', c = this.cam, aspect = innerWidth / innerHeight, wide = innerWidth > 860, T = this.turn.position;
      // veículo
      if (int) {
        this.rev += dt; const e = ease(this.rev / 1.9);
        if (!this.drag) { this.userYaw += (this.spinV || 0); this.spinV = (this.spinV || 0) * Math.max(0, 1 - 4 * dt); this.idle += dt;
          if (this.idle > 2.5) { this.userYaw = Math.atan2(Math.sin(this.userYaw), Math.cos(this.userYaw)); this.userYaw *= Math.exp(-2.5 * dt); } }
        this.turn.rotation.y = GAR.CAM_AZIMUTH * Math.PI / 180 + this.userYaw - (1 - e) * 0.8;      // chega terminando de girar
      } else this.turn.rotation.y = GAR.EXT_YAW * Math.PI / 180;
      if (this.kart) {
        this.hop = Math.max(0, (this.hop || 0) - dt);
        this.kart.body.position.y = Math.sin(this.hop / 0.35 * Math.PI) * (int ? 0.22 : 0.5);
        const st = int ? 0 : Math.sin(t * 0.9) * 0.5 + Math.sin(t * 2.3) * 0.15;                   // no pátio o piloto mexe no volante
        this.kart.animate(dt, { steer: st, speed: 0, boost: false, drift: 0 });
        if (int && !GAR.PILOT_IN_GARAGE) this.pilotVis();
      }
      this.spark.position.set(T.x, T.y + 2, T.z); this.spark.material.opacity *= Math.max(0, 1 - dt * 3);
      this.clouds.forEach((cl, i) => { cl.position.x += dt * (0.8 + i * 0.2); if (cl.position.x > 130) cl.position.x = -130; });
      // câmera
      const P = new THREE.Vector3(), L = new THREE.Vector3(); let fov = 36, k = Math.min(1, 3 * dt);
      if (int) {
        const d = GAR.CAM_DIST, e = ease(this.rev / 2.2);
        fov = Math.max(GAR.CAM_FOV, 2 * Math.atan(4.4 / (d * aspect)) * 180 / Math.PI);                // tela em pé: abre o necessário para o veículo caber
        P.set(T.x + Math.sin(t * 0.3) * 0.35, GAR.CAM_HEIGHT, T.z + d * (1.1 - 0.1 * e)); L.set(T.x, GAR.LOOK_Y - (wide ? 0 : 0.5), T.z); k = 1;
      } else if (this.goal === 'int') { P.set(-1.2, 3.6, 15); L.set(0, 2.6, -13); k = Math.min(1, 1.5 * dt); }   // portão abrindo: a câmera se aproxima
      else if (this.rig === 'setup') { if (wide) { P.set(0, 6.5, 24); L.set(0, 2.2, 0); } else { P.set(0, 8, 27); L.set(0, 4, 0); } }
      else if (wide) { P.set(-6.0, 4.6, 20); L.set(-5.6, 2.2, 0); } else { P.set(0, 7.5, 26); L.set(0, 4.6, 0); }
      if (this.snap || k >= 1) { this.camPos.copy(P); this.camLook.copy(L); this.snap = false; } else { this.camPos.lerp(P, k); this.camLook.lerp(L, k); }
      c.position.copy(this.camPos); c.lookAt(this.camLook);
      // troca do carrossel: a câmera acompanha (desliza um pouco para o lado da seta e "aperta" a lente)
      if (this.swap) {
        const S = this.swap; S.t += Math.min(0.05, dt); const u = Math.min(1, S.t / GAR.SWAP_TIME), w = Math.sin(Math.PI * u);
        this.poseSwap(u); c.position.addScaledVector(S.world, S.dir * 0.18 * w); c.lookAt(this.camLook.clone().addScaledVector(S.world, S.dir * 0.32 * w)); fov -= 2 * w;
        if (u >= 1) { this.endSwap(); this.pulse(null); }
      }
      if (c.aspect !== aspect || Math.abs(c.fov - fov) > 1e-3) { c.aspect = aspect; c.fov = fov; c.updateProjectionMatrix(); }
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
