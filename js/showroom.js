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
    SWAY: 1.4,               // menu: a câmera passeia devagar de um lado para o outro (amplitude em unidades; 0 desliga)
    DAY_START: 0.3, DAY_SECONDS: 240,  // ciclo dia/noite do lobby (mesmo ritmo da corrida: 4 min por dia)
    CLOUD_H: 150,            // base das nuvens acima da câmera no lobby. Na corrida é 300, mas aqui a câmera olha quase na
                             // horizontal com lente fechada: a 300 m as nuvens só apareciam longe demais e sumiam na névoa
                             // do horizonte (ficava só o céu azul). Mais baixas, entram no quadro com o mesmo shader da pista.
    CAM_HEIGHT: 2.5,         // Garagem: altura da câmera
    LOOK_Y: 0.2,             // Garagem: altura do ponto olhado (menor = veículo mais alto na tela; a doca de cores fica embaixo)
    PILOT_IN_GARAGE: false,  // true mostra o piloto também dentro da Garagem
    SIDE_PANELS: false,      // true volta os painéis de luz (pareciam janelas) nas paredes laterais da garagem
    SCONCES: false,          // true volta as 4 arandelas da fachada da garagem
    KART_OUTSIDE: false,     // true mostra o kart no pátio da tela principal (a Garagem sempre mostra)
    PILOT_OUTSIDE: false,    // true mostra o piloto no kart da tela principal (pátio)
    WHEEL_STOPS: false,      // true volta os batentes amarelo e preto das vagas
    DOOR_TIME: 1.15,         // segundos para o portão abrir/fechar
    FADE_TIME: 0.38,         // segundos de cada fade (out e in)
    DOF: 1,                  // profundidade de campo (0 desliga; 1 = padrão; 2 = o dobro do desfoque)
    DOF_SS: 2,                    // a vitrine é desenhada com este fator de resolução e reduzida (bordas mais lisas)
    GLOW: 0.38,              // luz própria do cenário (ele nunca fica preto)
    SHADOW_MAP: 4096,        // sombra do sol no pátio (cai para o máximo da placa de vídeo)
    EXT_GLOW_K: 0.42,        // fora: quanto sobra da luz própria do cenário (menos = luz e sombra de verdade, mais volume)
    ENV: 0.4,                // força do reflexo do céu nos materiais do cenário (0 desliga); kart/piloto: 0,5; asfalto: 0,22
    AO: 0.85, AO_RADIUS: 1.3, AO_STRENGTH: 1.35,   // oclusão de ambiente (força final, raio em unidades, intensidade)
    BLOOM: 0.6,              // brilho das luzes (de dia fica em 55%)
    EXPOSURE: 1.03, SATURATION: 1.07, CONTRAST: 0.14,   // cor final
    SWAP_TIME: 0.75, SWAP_DIST: 2.7,   // troca de veículo no carrossel: duração (s) e deslize (unidades)
    BRAND: 'KARTEC', BRAND_TOP: 'SUPER', ACCENT: '#E8213A'
  }, (window.CFG && window.CFG.GARAGEM3D) || {});

  const U = 2;                                         // 1 metro do cenário = 2 unidades da cena (o kart tem ~4 unidades)
  const ZI = -38;                                      // centro da plataforma interna (z, em unidades); a fachada fica em z = -13
  const RW = 15, Z0 = -5.5, Z1 = 12.5, RD = Z1 - Z0, RH = 4;   // sala interna em metros (origem na plataforma)
  const DOOR_W = 5, DOOR_H = 2.9, FZ = -6.5, FW = 17, FH = 4.4;
  function GAR_SCONCES() { return GAR.SCONCES ? [-7.9, -3.5, 3.5, 7.9] : []; }
  const FLAGS = [];   // bandeiras (nobori) da loja: cada uma mexe o próprio tecido em step()
  const WINS = [{ x: -5.5, y: 1.95, w: 3.7, h: 1.5 }, { x: 5.5, y: 1.95, w: 3.7, h: 1.5 }];   // janelas da frente (a da direita fica onde era o "01")
  const SCONCES = GAR_SCONCES();   // arandelas da fachada: tiradas (antes [-7.9, -3.5, 3.5, 7.9]); a luz agora vem dos postes da calçada                                                     // 4 arandelas simétricas   // fachada em metros (origem no veículo do pátio)
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
    // laterais: carrinho de ferramentas / pneus. Os painéis de luz (softbox) das paredes laterais pareciam janelas num
    // lugar onde do lado de fora tem a loja grudada: desligados (GAR.SIDE_PANELS = true volta com eles)
    if (GAR.SIDE_PANELS) [[-RW / 2 + 0.03, Math.PI / 2], [RW / 2 - 0.03, -Math.PI / 2]].forEach(s => { [-1.6, 3.6, 8.8].forEach(z => { K.plane(3.6, 1.7, K.lit('#fff1dc'), s[0], 2.15, z, s[1]); K.plane(3.8, 1.9, dark, s[0] + Math.sign(s[0]) * 0.012, 2.15, z, s[1]).receiveShadow = false; K.glow(5.4, 3.4, '#ffe9c8', 0.4, s[0] - Math.sign(s[0]) * 0.05, 2.15, z, s[1]); }); });
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
    buildStore(K, nightUp, glass);   // loja de conveniência ao lado (mesmo kit: apaga/acende com o dia e a noite)
    buildFrontage(K);                // calçada, meio-fio, rebaixo do portão e batentes das vagas
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
    const mats = Object.values(K.mats).filter(m => m.isMeshStandardMaterial); mats.forEach(m => { m.emissiveIntensity *= GAR.EXT_GLOW_K; m.userData.envK = GAR.ENV; m.userData.e0 = m.emissiveIntensity; });
    return { R, door, bar, dTex, glass, nightUp, mats, sign: () => signLogo };
  }
  // feixe de luz da arandela na parede (cone suave, mais forte perto da lâmpada)
  const washTex = () => mkTex(128, 256, (g, W, H) => { g.clearRect(0, 0, W, H);
    for (let y = 0; y < H; y++) { const t = 1 - y / H, half = W * (0.08 + 0.42 * (1 - t)), a = Math.pow(t, 1.6) * 0.9;
      const gr = g.createLinearGradient(W / 2 - half, 0, W / 2 + half, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,' + a.toFixed(3) + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, H - 1 - y, W, 1); } });

  // ---------------------------------------------------------------- LOJA DE CONVENIÊNCIA (à esquerda da garagem)
  // Referência: konbini japonesa (fachada clara de painéis, vitrine de vidro com cartazes, porcelanato nos pilares), sem
  // letreiro. Metros; (x, z) = centro da fachada. Frente (x local): pilar | vitrine | porta automática | vitrine | pilar
  const STORE = { x: -13.9, z: FZ, w: 10, d: 9, h: 4.9, top: 2.7, sb: 2.95, canopy: 1.5,
    tileL: [-5, -4.2], glassL: [-4.2, 0.4], door: [0.4, 2.6], glassR: [2.6, 4.3], tileR: [4.3, 5] };
  // calçada com meio-fio na frente da loja e da garagem (rebaixada no portão) e vagas pintadas no asfalto (metros)
  const WALK = { d: 2.6, h: 0.15, x0: -19.4, x1: 16, cut: 3.1, ramp: 0.7 };
  const STALLS = { depth: 5, store: [-5, -2.5, 0, 2.5, 5], pcd: 2, right: [9.4, 11.9, 14.4] };   // pcd: vaga PcD (entre as linhas 2 e 3, na frente da porta)
  const RND = Math.random;
  // textura desenhada em metros (origem no canto de cima à esquerda); ppm = pixels por metro
  const mkM = (wm, hm, ppm, draw) => mkTex(Math.max(8, Math.min(2048, Math.round(wm * ppm))), Math.max(8, Math.min(2048, Math.round(hm * ppm))),
    (g, W, H) => { g.setTransform(W / wm, 0, 0, H / hm, 0, 0); draw(g, wm, hm); });
  const inPx = (g, fn) => { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); fn(g.canvas.width, g.canvas.height); g.restore(); };
  const rep = (t, x, y) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(x, y); c.needsUpdate = true; return c; };
  // texto simples (fonte do sistema), tamanho em metros
  const txt = (g, s, x, y, size, fill, o) => { o = o || {}; g.save(); g.translate(x, y); g.scale(size / 100, size / 100);
    g.font = (o.w || '700') + ' 100px ' + (o.f || '"Arial Black", Arial, Helvetica, sans-serif'); g.textAlign = o.a || 'center'; g.textBaseline = 'middle';
    if (o.stroke) { g.strokeStyle = o.stroke[0]; g.lineWidth = o.stroke[1]; g.lineJoin = 'round'; g.strokeText(s, 0, 0); }
    g.fillStyle = fill; g.fillText(s, 0, 0); g.restore(); };
  const rrect = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const pick = a => a[(RND() * a.length) | 0];
  // manchas suaves que repetem sem emenda (em pixels); cols: [r, g, b, alfa]
  const blotches = (g, W, H, n, r0, r1, cols) => { for (let i = 0; i < n; i++) { const x = RND() * W, y = RND() * H, r = r0 + RND() * (r1 - r0), c = pick(cols), s = c.slice(0, 3).join(',');
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { const px = x + ox * W, py = y + oy * H; if (px + r < 0 || px - r > W || py + r < 0 || py - r > H) continue;
      g.fillStyle = rad(g, px, py, r, [[0, 'rgba(' + s + ',' + c[3] + ')'], [1, 'rgba(' + s + ',0)']]); g.fillRect(px - r, py - r, 2 * r, 2 * r); } } };
  // porcelanato claro 60x120 cm (ladrilho de 1,2 m com 2 placas), veios bem leves
  // porcelanato polido 60x120 (marmorizado): base branca quente, veios cinza suaves que atravessam as placas,
  // junta de 3 mm com sombra embaixo e filete de luz em cima (dá relevo), leve variação de tom entre placas
  const porcelainTex = () => mkM(1.2, 1.2, 512 / 1.2, g => {
    g.fillStyle = '#a9aaa8'; g.fillRect(0, 0, 1.2, 1.2);
    [0, 0.6].forEach((x, i) => { const v = 236 + i * 4 - ((RND() * 4) | 0);
      g.fillStyle = lin(g, x, 0, x + 0.6, 1.2, `rgb(${v + 3},${v + 1},${v - 3})`, `rgb(${v - 6},${v - 7},${v - 9})`); g.fillRect(x + 0.003, 0.003, 0.594, 1.194); });
    inPx(g, (W, H) => {
      blotches(g, W, H, 50, 30, 120, [[255, 255, 252, 0.18], [190, 184, 172, 0.07]]);
      // veios: curvas longas, primeiro largas e quase transparentes (halo) e depois finas e mais marcadas
      for (let k = 0; k < 5; k++) { let x = RND() * W, y = -10; const pts = [[x, y]]; const dx = (RND() - 0.5) * W * 0.5;
        while (y < H + 10) { y += 18 + RND() * 22; x += dx / 12 + (RND() - 0.5) * 26; pts.push([x, y]); }
        [[7, 0.035], [3, 0.06], [1.1, 0.16]].forEach(([lw, a]) => { g.lineWidth = lw; g.strokeStyle = `rgba(118,114,108,${a})`; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
          for (let q = 1; q < pts.length; q++) { const [x0, y0] = pts[q - 1], [x1, y1] = pts[q]; g.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); } g.stroke(); });
        if (RND() < 0.6) { const [bx, by] = pts[(pts.length / 2) | 0]; g.lineWidth = 0.8; g.strokeStyle = 'rgba(118,114,108,.12)'; g.beginPath(); g.moveTo(bx, by);
          g.quadraticCurveTo(bx + (RND() - 0.5) * 80, by + 40, bx + (RND() - 0.5) * 120, by + 90 + RND() * 60); g.stroke(); } }
      speckle(g, W, H, 1800, 0.03);
      // junta com relevo: sombra embaixo/à direita da junta, luz em cima/à esquerda da placa
      const px = W / 1.2;
      [0, 0.6].forEach(x => { const X = x * px;
        g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(X + 2, 2, 1.5, H - 4); g.fillRect(X + 2, 2, 0.6 * px - 4, 1.5);
        g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(X + 0.6 * px - 3.5, 2, 1.5, H - 4); g.fillRect(X + 2, H - 3.5, 0.6 * px - 4, 1.5); });
      // brilho do polido: faixa diagonal suave
      g.fillStyle = lin(g, 0, 0, W, H, 'rgba(255,255,255,0)', 'rgba(255,255,255,0)'); const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0.35, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.09)'); gr.addColorStop(0.65, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }); });
  // painéis de alumínio composto (ACM) 125x62,5 cm: junta aberta de 12 mm (fundo escuro com sombra da borda de cima),
  // dobra da borda com luz, tom levemente diferente por painel (a película nunca sai igual) e escorridos de chuva bem leves
  const acmTex = () => mkM(2.5, 1.25, 204.8, g => {
    g.fillStyle = '#1d1f23'; g.fillRect(0, 0, 2.5, 1.25);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const x = i * 1.25 + 0.006, y = j * 0.625 + 0.006, w = 1.238, h = 0.613, v = 226 + ((RND() * 10) | 0);
      g.fillStyle = lin(g, x, y, x + w * 0.4, y + h, `rgb(${v + 10},${v + 9},${v + 12})`, `rgb(${v - 6},${v - 7},${v - 4})`); g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x - 0.006, y - 0.006, w + 0.012, 0.006);                                    // fundo da junta mais escuro logo acima
      g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(x, y, w, 0.005); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, y, 0.004, h);   // dobra iluminada
      g.fillStyle = lin(g, 0, y + h - 0.03, 0, y + h, 'rgba(0,0,0,0)', 'rgba(0,0,0,.14)'); g.fillRect(x, y + h - 0.03, w, 0.03);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + w - 0.004, y, 0.004, h);
      // escorridos: saem da junta de cima e descem desbotando
      for (let k = 0; k < 4; k++) { const sx = x + 0.05 + RND() * (w - 0.1), sl = 0.12 + RND() * 0.35, sw = 0.006 + RND() * 0.012;
        g.fillStyle = lin(g, 0, y, 0, y + sl, 'rgba(70,72,74,.13)', 'rgba(70,72,74,0)'); g.fillRect(sx, y + 0.004, sw, sl); } }
    inPx(g, (W, H) => speckle(g, W, H, 700, 0.025)); });
  // reboco texturizado (laterais), granito (rodapé e meio-fio), calçada de concreto com junta serrada a cada 1,5 m
  const stuccoTex = () => mkM(2, 2, 256, g => { g.fillStyle = '#c4c2bd'; g.fillRect(0, 0, 2, 2);
    inPx(g, (W, H) => { blotches(g, W, H, 70, 20, 110, [[255, 255, 252, 0.22], [150, 140, 125, 0.1]]); speckle(g, W, H, 22000, 0.07); }); });
  const graniteTex = (base, a) => mkM(1, 1, 256, g => { g.fillStyle = base; g.fillRect(0, 0, 1, 1);
    inPx(g, (W, H) => { blotches(g, W, H, 20, 10, 40, [[255, 255, 255, 0.06], [0, 0, 0, 0.08]]); for (let i = 0; i < 6000; i++) { const v = RND() < 0.5 ? 255 : 0, s = 0.6 + RND() * 1.8;
      g.fillStyle = `rgba(${v},${v},${v},${(RND() * a).toFixed(3)})`; g.fillRect(RND() * W, RND() * H, s, s); } }); });
  // floreira: fibrocimento grafite; terra com casca de pinus e pedriscos
  const fiberTex = () => mkM(1, 1, 256, g => { g.fillStyle = '#4b4e54'; g.fillRect(0, 0, 1, 1);
    inPx(g, (W, H) => { blotches(g, W, H, 40, 10, 60, [[255, 255, 255, 0.06], [0, 0, 0, 0.1]]); speckle(g, W, H, 9000, 0.09); }); });
  const soilTex = () => mkM(1, 1, 256, g => { g.fillStyle = '#33251a'; g.fillRect(0, 0, 1, 1);
    inPx(g, (W, H) => { for (let i = 0; i < 1600; i++) { const v = pick([[96, 64, 40], [64, 44, 28], [150, 142, 128], [118, 110, 98], [40, 30, 22]]), r = 1 + RND() * 3.5;
      g.fillStyle = `rgba(${v[0]},${v[1]},${v[2]},${(0.5 + RND() * 0.5).toFixed(2)})`; g.beginPath(); g.ellipse(RND() * W, RND() * H, r, r * (0.5 + RND() * 0.5), RND() * 3, 0, 6.2832); g.fill(); } }); });
  // batente de borracha das vagas (amarelo e preto)
  const wheelStopTex = () => mkM(1, 0.25, 256, (g, w, h) => { g.fillStyle = '#1c1c1e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8b21c'; for (let x = -0.3; x < w + 0.3; x += 0.25) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 0.125, h); g.lineTo(x + 0.2, 0); g.lineTo(x + 0.075, 0); g.closePath(); g.fill(); }
    inPx(g, (W, H) => speckle(g, W, H, 1500, 0.15)); });
  // ----- interior (visto pelo vidro) -----
  const BOTTLES = [['#e8212f', '#ffffff', '#c41a26'], ['#2a9d4b', '#f2c418', '#1f7a3a'], ['#1f6fd1', '#4fb3ff', '#ffffff'], ['#ff8a1c', '#ffd23f', '#e8212f'], ['#7b3fa0', '#ff6fa8', '#ffffff'], ['#d9e7ef', '#9fc6dc', '#ffffff']];
  const PROD = [['#e8212f', '#ffffff'], ['#f2c418', '#e8212f'], ['#2a9d4b', '#ffffff'], ['#1f6fd1', '#ffd23f'], ['#ff8a1c', '#5a2d0c'], ['#ffffff', '#e8212f'], ['#7b3fa0', '#ffd23f'], ['#13a3a0', '#ffffff'], ['#8a5a2b', '#f2e2c0'], ['#ffd6e0', '#e8212f']];
  const fridgeTex = (w, h) => mkM(w, h, 150, g => {
    g.fillStyle = '#f2f3f1'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a4fa6'; g.fillRect(0, 0.1, w, 0.28); txt(g, 'BEBIDAS GELADAS', w / 2, 0.24, 0.17, '#fff');
    const y0 = 0.5, y1 = h - 0.06, dw = 0.78;
    for (let x = 0.12; x + dw < w - 0.05; x += dw) {
      g.fillStyle = '#2c2f33'; g.fillRect(x, y0, dw, y1 - y0);
      g.fillStyle = lin(g, 0, y0, 0, y1, '#f4f9ff', '#d3e3f1'); g.fillRect(x + 0.035, y0 + 0.035, dw - 0.07, y1 - y0 - 0.07);
      const n = 5, sh = (y1 - y0 - 0.1) / n;
      for (let s = 0; s < n; s++) { const base = y0 + 0.05 + (s + 1) * sh - 0.02, pal = pick(BOTTLES);
        for (let bx = x + 0.06; bx < x + dw - 0.09; bx += 0.07) { const bh = sh * (0.55 + RND() * 0.22); g.fillStyle = pick(pal); g.fillRect(bx, base - bh, 0.052, bh);
          g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(bx + 0.008, base - bh + 0.02, 0.01, bh - 0.04); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(bx + 0.016, base - bh - 0.025, 0.02, 0.025); }
        g.fillStyle = 'rgba(120,130,140,.7)'; g.fillRect(x + 0.035, base, dw - 0.07, 0.02); }
      g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(x + dw * 0.6, y0 + 0.035, 0.05, y1 - y0 - 0.07);   // reflexo
      g.fillStyle = '#a9aeb5'; g.fillRect(x + dw - 0.08, y0 + 0.75, 0.022, 0.5); } });
  const shelfTex = (w, h, n) => mkM(w, h, 170, g => {
    g.fillStyle = '#d9dcdf'; g.fillRect(0, 0, w, h); const lh = (h - 0.1) / n;
    for (let s = 0; s < n; s++) { const y = 0.05 + s * lh, base = y + lh - 0.035;
      g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, y, w, lh - 0.035);
      let x = 0.03; while (x < w - 0.06) { const pw = 0.06 + RND() * 0.12, ph = lh * (0.45 + RND() * 0.45), c = pick(PROD), k = 1 + ((RND() * 4) | 0);
        for (let i = 0; i < k && x < w - 0.06; i++) { g.fillStyle = c[0]; g.fillRect(x, base - ph, pw - 0.008, ph); g.fillStyle = c[1]; g.fillRect(x, base - ph * 0.62, pw - 0.008, ph * 0.22);
          g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x, base - ph, pw * 0.2, ph); x += pw; }
        x += 0.015; }
      g.fillStyle = '#f5f6f7'; g.fillRect(0, base, w, 0.035); g.fillStyle = '#ffd400'; for (let px = 0.15; px < w; px += 0.42) g.fillRect(px, base + 0.005, 0.09, 0.025); } });
  const promoTex = (title, price, c1, c2) => mkM(0.6, 1.5, 300, (g, w, h) => {
    g.fillStyle = c1; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0.04, 0.04, w - 0.08, 0.34);
    txt(g, title, w / 2, 0.15, 0.1, c1); txt(g, price, w / 2, 0.29, 0.09, '#222');
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) { const x = 0.05 + c * 0.175, y = 0.46 + r * 0.17; g.fillStyle = c2; g.fillRect(x, y, 0.155, 0.15); g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(x + 0.02, y + 0.05, 0.115, 0.045); } });
  const floorInTex = (w, d) => mkM(w, d, 60, g => {
    g.fillStyle = '#c9c4ba'; g.fillRect(0, 0, w, d);
    for (let x = 0; x < w; x += 0.6) for (let z = 0; z < d; z += 0.6) { const v = 226 + ((RND() * 12) | 0); g.fillStyle = `rgb(${v},${v - 3},${v - 9})`; g.fillRect(x + 0.01, z + 0.01, 0.58, 0.58); }
    g.fillStyle = lin(g, 0, 0, 0, d, 'rgba(255,255,255,.25)', 'rgba(0,0,0,.05)'); g.fillRect(0, 0, w, d); });
  const ceilTex = (w, d) => mkM(w, d, 50, g => {
    g.fillStyle = '#d2d5d8'; g.fillRect(0, 0, w, d);
    for (let x = 0.8; x < w - 0.8; x += 2.2) for (let z = 0.8; z < d - 0.5; z += 1.6) { g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(x - 0.12, z - 0.08, 1.44, 0.46); g.fillStyle = '#fff'; g.fillRect(x, z, 1.2, 0.3); } });
  // cartazes colados no vidro (por dentro)
  const posterTex = k => mkM(0.6, 0.85, 320, (g, w, h) => {
    if (k === 0) { g.fillStyle = '#f6efe2'; g.fillRect(0, 0, w, h); g.fillStyle = '#6b3d1e'; g.fillRect(0.17, 0.3, 0.26, 0.26); g.beginPath(); g.ellipse(0.3, 0.56, 0.13, 0.03, 0, 0, 6.2832); g.fill();
      g.strokeStyle = '#6b3d1e'; g.lineWidth = 0.03; g.beginPath(); g.arc(0.45, 0.42, 0.06, -1.4, 1.4); g.stroke(); g.fillStyle = '#c99263'; g.fillRect(0.19, 0.3, 0.22, 0.03);
      txt(g, 'CAFÉ', w / 2, 0.14, 0.12, '#6b3d1e'); txt(g, 'R$ 4,90', w / 2, 0.7, 0.1, GAR.ACCENT); }
    else if (k === 1) { g.fillStyle = '#d8f0ff'; g.fillRect(0, 0, w, h); g.fillStyle = '#e8b06a'; g.beginPath(); g.moveTo(0.2, 0.42); g.lineTo(0.4, 0.42); g.lineTo(0.3, 0.66); g.closePath(); g.fill();
      g.fillStyle = '#ff7fae'; g.beginPath(); g.arc(0.3, 0.38, 0.11, 0, 6.2832); g.fill(); g.fillStyle = '#fff6c9'; g.beginPath(); g.arc(0.3, 0.27, 0.08, 0, 6.2832); g.fill();
      txt(g, 'SORVETE', w / 2, 0.12, 0.09, '#1a4fa6'); txt(g, '2 por R$ 10', w / 2, 0.75, 0.075, GAR.ACCENT); }
    else { g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h); g.fillStyle = '#e9a64a'; [[0.22, 0.4], [0.38, 0.42], [0.3, 0.52]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 0.085, 0, 6.2832); g.fill(); });
      g.fillStyle = 'rgba(255,255,255,.35)'; [[0.2, 0.37], [0.36, 0.39], [0.28, 0.49]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 0.03, 0, 6.2832); g.fill(); });
      txt(g, 'PÃO DE', w / 2, 0.11, 0.085, '#7a3b0c'); txt(g, 'QUEIJO', w / 2, 0.21, 0.1, '#7a3b0c'); txt(g, 'quentinho!', w / 2, 0.72, 0.07, GAR.ACCENT); }
    g.strokeStyle = 'rgba(0,0,0,.15)'; g.lineWidth = 0.01; g.strokeRect(0.005, 0.005, w - 0.01, h - 0.01); });
  // máquina de refrigerante, lixeira de recicláveis, bandeira (nobori) e cavalete de giz
  const vendTex = () => mkM(0.9, 1.75, 300, (g, w, h) => {
    g.fillStyle = '#d42330'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.fillRect(0.05, 0.06, w - 0.1, 0.22); txt(g, 'REFRI GELADO', w / 2, 0.17, 0.085, '#d42330');
    g.fillStyle = '#20232a'; g.fillRect(0.05, 0.34, 0.62, 0.86); g.fillStyle = lin(g, 0, 0.36, 0, 1.18, '#ffffff', '#e4edf5'); g.fillRect(0.07, 0.36, 0.58, 0.82);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) { const x = 0.1 + c * 0.091, y = 0.42 + r * 0.26, p = BOTTLES[(r * 2 + c) % BOTTLES.length];
      g.fillStyle = p[0]; g.fillRect(x, y + 0.04, 0.06, 0.16); g.fillStyle = p[1]; g.fillRect(x, y + 0.1, 0.06, 0.04); g.fillStyle = '#333'; g.fillRect(x + 0.02, y + 0.01, 0.02, 0.03);
      g.fillStyle = '#1b1e24'; g.fillRect(x + 0.005, y + 0.215, 0.05, 0.02); }
    g.fillStyle = '#20232a'; g.fillRect(0.71, 0.4, 0.14, 0.5); for (let i = 0; i < 5; i++) { g.fillStyle = '#9fe870'; g.fillRect(0.74, 0.45 + i * 0.08, 0.08, 0.04); }
    g.fillStyle = '#c9ccd2'; g.fillRect(0.74, 0.96, 0.08, 0.12); g.fillStyle = '#111'; g.fillRect(0.11, 1.32, 0.5, 0.2); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0.11, 1.32, 0.5, 0.03);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, h - 0.08, w, 0.08); });
  const binTex = () => mkM(0.7, 0.95, 300, (g, w, h) => {
    g.fillStyle = '#d5d8dc'; g.fillRect(0, 0, w, h);
    [[0.05, '#1f6fd1', 'LATAS'], [0.37, '#2a9d4b', 'GARRAFAS']].forEach(([x, c, s]) => { g.fillStyle = c; g.fillRect(x, 0.08, 0.28, 0.16); txt(g, s, x + 0.14, 0.16, s.length > 5 ? 0.043 : 0.06, '#fff');
      g.fillStyle = '#23262b'; rrect(g, x + 0.04, 0.3, 0.2, 0.1, 0.05); g.fill(); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x, 0.5, 0.28, 0.4); });
    g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0.345, 0.05, 0.01, h - 0.1); });
  const flagTex = (a, b, bg, fg) => mkM(0.55, 1.8, 260, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.fillRect(0, 0, w, 0.06); g.fillRect(0, h - 0.06, w, 0.06); g.fillRect(0, 0, 0.04, h);
    g.save(); g.translate(w / 2 + 0.03, h / 2); g.rotate(Math.PI / 2); txt(g, a, -0.12, -0.04, 0.27, fg); txt(g, b, 0.02, 0.17, 0.1, '#222'); g.restore(); });
  const chalkTex = () => mkM(0.5, 0.72, 400, (g, w, h) => {
    g.fillStyle = '#2a302c'; g.fillRect(0, 0, w, h); inPx(g, (W, H) => speckle(g, W, H, 3000, 0.08));
    const f = '"Comic Sans MS", "Segoe Print", cursive';
    txt(g, 'HOJE', w / 2, 0.1, 0.075, '#ffe07a', { f }); txt(g, 'café +', w / 2, 0.24, 0.06, '#f4f4f0', { f, w: '400' }); txt(g, 'pão de queijo', w / 2, 0.33, 0.05, '#f4f4f0', { f, w: '400' });
    txt(g, 'R$ 7,90', w / 2, 0.47, 0.08, '#ff9aa8', { f }); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 0.008; g.beginPath(); g.moveTo(0.1, 0.56); g.lineTo(0.4, 0.56); g.stroke();
    txt(g, 'aberto 24h :)', w / 2, 0.64, 0.045, '#9fe0ff', { f, w: '400' }); });

  function buildStore(K, nightUp, glass) {
    const S = STORE, R = K.grp(S.x, S.z), hw = S.w / 2, Y = WALK.h, b = (w, h, d, m, x, y, z, cast) => K.box(w, h, d, m, x, y, z, R, cast);
    const pT = porcelainTex(), porc = (w, h) => K.std(null, 0.25, 0.05, rep(pT, w / 1.2, h / 1.2), 0.16);
    const sT = stuccoTex(), aT = acmTex(), gT = graniteTex('#2b2c2f', 0.2);
    const alu = K.std('#c6cad0', 0.28, 0.85), frame = K.std('#43474e', 0.35, 0.7), basic = map => K.tag(new THREE.MeshBasicMaterial({ map }));
    // casca: laterais de reboco, telhado, fachada de painéis de alumínio composto acima da vitrine e rufo
    [[-hw, -Math.PI / 2], [hw, Math.PI / 2]].forEach(([x, ry]) => K.plane(S.d, S.h, K.std(null, 0.92, 0, rep(sT, S.d / 2, S.h / 2), 0.04), x, S.h / 2, -S.d / 2, ry, R));
    const roof = K.plane(S.w, S.d, K.std('#8f9296', 0.9, 0), 0, S.h, -S.d / 2, 0, R); roof.rotation.x = -Math.PI / 2;
    K.plane(S.w, S.h - S.top, K.std(null, 0.3, 0.3, rep(aT, S.w / 2.5, (S.h - S.top) / 1.25), 0.4), 0, (S.h + S.top) / 2, 0.02, 0, R);
    b(S.w + 0.14, 0.1, 0.4, alu, 0, S.h + 0.05, -0.12, false);
    b(S.w, 0.09, 0.12, frame, 0, S.top + 0.045, 0.05, false);
    // marquise: laje fina com testeira de alumínio, filete azul e spots embutidos (à noite: poça de luz na calçada)
    { const CW = S.w + 0.3, CD = S.canopy, cy = S.sb;
      b(CW, 0.12, CD, K.std('#eef0f2', 0.6, 0.05), 0, cy + 0.06, CD / 2);
      b(CW + 0.04, 0.24, 0.05, alu, 0, cy + 0.1, CD + 0.025, false); [-1, 1].forEach(s => b(0.05, 0.24, CD + 0.05, alu, s * (CW / 2 + 0.02), cy + 0.1, CD / 2, false));
      b(CW + 0.04, 0.035, 0.052, K.std('#1d5fc4', 0.4, 0.2), 0, cy + 0.12, CD + 0.03, false);
      for (let x = -4.2; x <= 4.3; x += 1.68) { K.cyl(0.07, 0.07, 0.015, K.lit('#fff6e6'), x, cy - 0.005, CD * 0.55, R, 16).castShadow = false;
        const pool = K.glow(2.4, 2.4, '#ffd9a8', 0, x, Y + 0.015, CD * 0.62, 0, R); pool.rotation.x = -Math.PI / 2; nightUp.push({ o: pool, day: 0, night: 0.3 });
        nightUp.push({ o: K.glow(0.7, 0.7, '#fff0d2', 0, x, cy - 0.07, CD * 0.55 + 0.03, 0, R), day: 0, night: 0.55 }); } }
    // pilares de porcelanato e rodapé de granito escuro sob as vitrines
    [S.tileL, S.tileR].forEach(([a, c]) => { const w = c - a; b(w, S.top, 0.26, porc(w, S.top), (a + c) / 2, S.top / 2, 0.01); });
    [S.glassL, S.glassR].forEach(([a, c]) => { const w = c - a; b(w, 0.4, 0.22, K.std(null, 0.35, 0.1, rep(gT, w, 0.4), 0.3), (a + c) / 2, 0.2, 0.02); });
    // vitrines: vidro 3D (reflete o céu e deixa ver a loja), caixilhos grafite
    const pane = (a, c, y0) => { const w = c - a, h = S.top - y0, gm = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMaterial(null));
      gm.position.set((a + c) / 2, y0 + h / 2, 0.04); gm.renderOrder = 3; R.add(gm); glass.push(gm);
      b(w, 0.06, 0.1, frame, (a + c) / 2, y0 + 0.03, 0.06, false); b(w, 0.06, 0.1, frame, (a + c) / 2, S.top - 0.03, 0.06, false); };
    pane(S.glassL[0], S.glassL[1], 0.4); pane(S.glassR[0], S.glassR[1], 0.4);
    [-4.2, -2.67, -1.13, 0.4, 2.6, 4.3].forEach(x => b(0.07, S.top - 0.4, 0.11, frame, x, (S.top + 0.4) / 2, 0.06, false));
    // porta automática de correr (duas folhas), sensor em cima e adesivo
    { const [a, c] = S.door, w = c - a, y0 = Y, h = S.top - y0, cx = (a + c) / 2;
      const gm = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMaterial(null)); gm.position.set(cx, y0 + h / 2, 0.035); gm.renderOrder = 3; R.add(gm); glass.push(gm);
      [-1, 1].forEach(sd => { const fx = cx + sd * w / 4;
        b(w / 2 - 0.02, 0.05, 0.06, alu, fx, y0 + 0.08, 0.05, false); b(w / 2 - 0.02, 0.05, 0.06, alu, fx, S.top - 0.1, 0.05, false);
        b(0.05, h - 0.12, 0.06, alu, cx + sd * (w / 2 - 0.03), y0 + h / 2 - 0.02, 0.05, false); b(0.04, h - 0.12, 0.07, alu, cx + sd * 0.03, y0 + h / 2 - 0.02, 0.06, false); });
      b(0.42, 0.1, 0.12, K.std('#2a2d33', 0.5, 0.3), cx, S.top - 0.04, 0.16, false);
      const st = mkM(0.9, 0.12, 300, (g, w2, h2) => { g.fillStyle = '#2a9d4b'; g.fillRect(0, 0, w2, h2); txt(g, 'ENTRADA ▸', w2 / 2, h2 / 2, 0.075, '#fff'); });
      K.plane(0.9, 0.12, basic(st), cx + w / 4, 1.25, 0.075, 0, R).receiveShadow = false;
      const mat = K.plane(1.8, 0.9, K.std('#3a3d42', 0.95, 0), cx, Y + 0.006, 0.55, 0, R); mat.rotation.x = -Math.PI / 2; mat.castShadow = false; }
    // cartazes no vidro (por dentro)
    [[-3.45, 0], [-1.9, 2], [3.45, 1]].forEach(([x, k]) => K.plane(0.6, 0.85, basic(posterTex(k)), x, 1.62, 0.0, 0, R).receiveShadow = false);
    // ----- interior iluminado (sempre aceso: material sem sombreamento) -----
    const ID = 6.2, IW = S.w - 0.3, IH = S.top + 0.15, F0 = Y, wallI = basic(mkM(2, 1, 64, (g, w, h) => { g.fillStyle = lin(g, 0, 0, 0, h, '#f1f2f0', '#dcdedb'); g.fillRect(0, 0, w, h); }));
    { const fl = K.plane(IW, ID, basic(floorInTex(IW, ID)), 0, F0, -ID / 2, 0, R); fl.rotation.x = -Math.PI / 2;
      const ce = K.plane(IW, ID, basic(ceilTex(IW, ID)), 0, IH, -ID / 2, 0, R); ce.rotation.x = Math.PI / 2;
      K.plane(IW, IH - F0, basic(fridgeTex(IW, IH - F0)), 0, F0 + (IH - F0) / 2, -ID, 0, R);
      K.plane(ID, IH, wallI, -IW / 2, IH / 2, -ID / 2, Math.PI / 2, R); K.plane(ID, IH, wallI, IW / 2, IH / 2, -ID / 2, -Math.PI / 2, R);
      // gôndolas (corredores no sentido da profundidade) com cabeceira de promoção virada para a vitrine
      const gw = 0.56, gh = 1.5, gl = 3.3, gm = basic(mkM(1, 1, 16, g => { g.fillStyle = '#c8ccd1'; g.fillRect(0, 0, 1, 1); }));
      [[-3.0, '#e8212f', '#f2c418', 'OFERTA', 'R$ 3,99'], [-0.8, '#1f6fd1', '#ffffff', 'NOVO', 'R$ 5,49'], [1.6, '#2a9d4b', '#ffd23f', 'COMBO', 'R$ 9,90']].forEach(([x, c1, c2, t1, t2]) => {
        const zc = -1.8 - gl / 2, sT2 = shelfTex(gl, gh, 5);
        b(gw, gh, gl, gm, x, F0 + gh / 2, zc, false);
        K.plane(gl, gh, basic(sT2), x - gw / 2 - 0.005, F0 + gh / 2, zc, -Math.PI / 2, R); K.plane(gl, gh, basic(sT2), x + gw / 2 + 0.005, F0 + gh / 2, zc, Math.PI / 2, R);
        K.plane(gw, gh, basic(promoTex(t1, t2, c1, c2)), x, F0 + gh / 2, -1.8 + 0.005, 0, R); });
      // prateleira baixa junto à vitrine da esquerda; balcão do caixa e estufa de salgados à direita
      K.plane(4.2, 1.0, basic(shelfTex(4.2, 1.0, 3)), -1.9, F0 + 0.5, -0.45, 0, R); b(4.2, 0.04, 0.4, gm, -1.9, F0 + 1.02, -0.65, false);
      b(1.5, 1.0, 0.6, K.lit('#f4f5f6'), 3.45, F0 + 0.5, -1.55, false); b(1.6, 0.05, 0.66, K.lit('#3b3f46'), 3.45, F0 + 1.02, -1.55, false);
      b(0.32, 0.26, 0.05, K.lit('#22252b'), 3.1, F0 + 1.22, -1.6, false); b(0.28, 0.2, 0.01, K.lit('#7fd3ff'), 3.1, F0 + 1.22, -1.57, false);
      b(0.8, 0.55, 0.5, K.lit('#ffb347'), 3.85, F0 + 1.32, -1.55, false); b(0.82, 0.04, 0.52, K.lit('#d0d3d8'), 3.85, F0 + 1.61, -1.55, false); }
    // ----- objetos da calçada -----
    { const g = K.grp(-4.55, 0.55, R); K.box(0.9, 1.78, 0.72, K.std('#c81f2c', 0.32, 0.3), 0, Y + 0.89, 0, g);
      K.plane(0.9, 1.75, K.std(null, 0.3, 0.1, vendTex(), 1.6), 0, Y + 0.89, 0.362, 0, g); }
    { const g = K.grp(4.62, 0.45, R); K.box(0.7, 0.95, 0.45, K.std('#c9ccd1', 0.45, 0.4), 0, Y + 0.475, 0, g); K.plane(0.7, 0.95, K.std(null, 0.5, 0.1, binTex(), 0.6), 0, Y + 0.475, 0.227, 0, g);
      K.box(0.74, 0.04, 0.49, K.std('#3b3f46', 0.5, 0.3), 0, Y + 0.97, 0, g); }
    [[-1.85, 1.7, 'CAFÉ', 'fresquinho', '#ffd23f', GAR.ACCENT, 0.5], [4.0, 1.7, 'SORVETE', 'geladinho', '#ffffff', '#1f6fd1', -0.35]].forEach(([x, z, a, c, bg, fg, ry]) => {
      const g = K.grp(x, z, R); g.rotation.y = ry; const pole = K.std('#d6d9de', 0.3, 0.75);
      K.cyl(0.18, 0.2, 0.12, K.std('#2a2d33', 0.8, 0), 0, Y + 0.06, 0, g, 18); K.cyl(0.02, 0.02, 2.6, pole, 0, Y + 1.3, 0, g, 8); K.cyl(0.012, 0.012, 0.6, pole, 0.3, Y + 2.52, 0, g, 6).rotation.z = Math.PI / 2;
      const fm = K.std(null, 0.85, 0, flagTex(a, c, bg, fg), 0.6); fm.side = THREE.DoubleSide;
      // tecido malhado: preso no mastro (esquerda) e na haste de cima; a ponta de baixo, longe do mastro, é a que mais balança
      const geo = new THREE.PlaneGeometry(0.55, 1.8, 14, 30), fl = K.put(geo, fm, 0.3, Y + 1.6, 0, g); fl.castShadow = true;
      const P = geo.attributes.position, X0 = Float32Array.from({ length: P.count }, (_, i) => P.getX(i)), Y0 = Float32Array.from({ length: P.count }, (_, i) => P.getY(i)), ph = x * 1.7;
      FLAGS.push(t => { for (let i = 0; i < P.count; i++) { const u = (X0[i] + 0.275) / 0.55, v = (0.9 - Y0[i]) / 1.8, free = Math.pow(u, 1.25) * (0.35 + 0.65 * v);
          const w = Math.sin(t * 3.1 + ph - u * 4.2 - v * 2.3) + 0.45 * Math.sin(t * 5.3 + ph * 1.3 - u * 7 - v * 3.1) + 0.3 * Math.sin(t * 1.3 + ph);
          P.setZ(i, free * 0.085 * w); P.setX(i, X0[i] - free * 0.012 * (1 + w * w * 0.5)); P.setY(i, Y0[i] + free * 0.012 * Math.sin(t * 2.2 + ph - u * 3)); }
        P.needsUpdate = true; geo.computeVertexNormals(); }); });
    { const g = K.grp(2.75, 0.85, R); g.rotation.y = -0.45; const wood = K.std('#8a5a2b', 0.8, 0), ch = K.std(null, 0.9, 0, chalkTex(), 0.5);
      [[-0.2, 0.11, 0], [0.2, -0.11, Math.PI]].forEach(([a, z, ry]) => { const p = new THREE.Group(); p.position.set(0, Y + 0.42, z); p.rotation.set(a, ry, 0); g.add(p);
        K.box(0.58, 0.84, 0.03, wood, 0, 0, 0, p); K.plane(0.5, 0.72, ch, 0, 0.01, 0.017, 0, p).receiveShadow = false; }); }
    return R;
  }
  // ---- calçada (padrão brasileiro): faixa livre de placas de concreto 50x50, linha de piso tátil direcional amarelo,
  // piso de alerta nas rampas do rebaixo, faixa de serviço de bloquete escuro junto ao meio-fio (poste e lixeira ficam
  // nela), meio-fio de granito com quina boleada e sarjeta de concreto. Cada piso tem textura de cor + de relevo (bump).
  // par de texturas (cor sRGB + relevo linear) desenhadas em metros com o mesmo traçado
  const mkPair = (wm, hm, ppm, draw) => { const col = mkM(wm, hm, ppm, (g, w, h) => draw(g, w, h, false)), hgt = mkM(wm, hm, ppm, (g, w, h) => draw(g, w, h, true));
    hgt.encoding = THREE.LinearEncoding; return [col, hgt]; };
  // placas de concreto 50x50 (ladrilho de 1 m) com junta, bisotê e agregado
  const plateTex = () => mkPair(1, 1, 512, (g, w, h, H) => {
    g.fillStyle = H ? '#202020' : '#3e3f42'; g.fillRect(0, 0, 1, 1);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const x = i * 0.5 + 0.006, y = j * 0.5 + 0.006, s = 0.488, v = 116 + ((RND() * 24) | 0);
      g.fillStyle = H ? '#b4b4b4' : `rgb(${v},${v - 1},${v - 5})`; g.fillRect(x, y, s, s);
      if (H) { g.fillStyle = '#c8c8c8'; g.fillRect(x + 0.008, y + 0.008, s - 0.016, s - 0.016); }
      else { g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x, y, s, 0.005); g.fillRect(x, y, 0.005, s); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, y + s - 0.005, s, 0.005); g.fillRect(x + s - 0.005, y, 0.005, s); } }
    inPx(g, (W, Hh) => { if (!H) blotches(g, W, Hh, 50, 10, 70, [[255, 255, 250, 0.1], [70, 66, 58, 0.1], [120, 104, 80, 0.06]]);
      for (let i = 0; i < 16000; i++) { const v = RND() < 0.5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${(RND() * (H ? 0.25 : 0.1)).toFixed(3)})`; const s = 0.7 + RND() * 1.6; g.fillRect(RND() * W, RND() * Hh, s, s); } });
    if (!H) for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(55,52,48,.28)'; g.beginPath(); g.arc(0.05 + RND() * 0.9, 0.05 + RND() * 0.9, 0.006 + RND() * 0.016, 0, 6.2832); g.fill(); } });
  // bloquete retangular 20x10 em "espinha" de cesto (ladrilho de 0,8 m), cinza-grafite
  const pavTex = () => mkPair(0.8, 0.8, 640, (g, w, h, H) => {
    g.fillStyle = H ? '#1a1a1a' : '#3b3c3e'; g.fillRect(0, 0, 0.8, 0.8);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const x0 = i * 0.2, y0 = j * 0.2, hor = (i + j) % 2 === 0;
      for (let k = 0; k < 2; k++) { const x = hor ? x0 : x0 + k * 0.1, y = hor ? y0 + k * 0.1 : y0, ww = hor ? 0.2 : 0.1, hh = hor ? 0.1 : 0.2, v = 92 + ((RND() * 26) | 0);
        g.fillStyle = H ? '#b0b0b0' : `rgb(${v},${v + 1},${v + 3})`; g.fillRect(x + 0.004, y + 0.004, ww - 0.008, hh - 0.008);
        if (H) { g.fillStyle = '#c4c4c4'; g.fillRect(x + 0.01, y + 0.01, ww - 0.02, hh - 0.02); } } }
    inPx(g, (W, Hh) => speckle(g, W, Hh, 9000, H ? 0.2 : 0.09)); });
  // piso tátil (placas 25x25): direcional = 4 barras em relevo ao longo do caminho; alerta = 6x6 botões
  const tactileTex = alert => mkPair(0.25, 0.25, 1024, (g, w, h, H) => {
    g.fillStyle = H ? '#1c1c1c' : '#7a6420'; g.fillRect(0, 0, 0.25, 0.25);
    g.fillStyle = H ? '#7a7a7a' : '#d8b42c'; g.fillRect(0.003, 0.003, 0.244, 0.244);
    const sh = (x, y, ww, hh, r) => { if (H) { g.fillStyle = rad(g, x + ww / 2, y + hh / 2, Math.max(ww, hh) * 0.6, [[0, '#f0f0f0'], [0.7, '#d0d0d0'], [1, '#7a7a7a']]); rrect(g, x, y, ww, hh, r); g.fill(); }
      else { g.fillStyle = 'rgba(0,0,0,.2)'; rrect(g, x + 0.004, y + 0.005, ww, hh, r); g.fill(); g.fillStyle = '#e6c33a'; rrect(g, x, y, ww, hh, r); g.fill(); g.fillStyle = 'rgba(255,255,255,.3)'; rrect(g, x + 0.003, y + 0.002, ww - 0.006, hh * 0.35, r * 0.6); g.fill(); } };
    if (alert) { for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) sh(0.017 + i * 0.038, 0.017 + j * 0.038, 0.026, 0.026, 0.013); }
    else for (let j = 0; j < 4; j++) sh(0.01, 0.025 + j * 0.058, 0.23, 0.026, 0.013);
    inPx(g, (W, Hh) => speckle(g, W, Hh, 4000, H ? 0.15 : 0.1)); });
  // concreto liso (sarjeta, piso do rebaixo): textura de 1,5 m com junta serrada
  const concTex = () => mkPair(1.5, 1.5, 512 / 1.5, (g, w, h, H) => {
    g.fillStyle = H ? '#a0a0a0' : '#84837e'; g.fillRect(0, 0, 1.5, 1.5);
    inPx(g, (W, Hh) => { if (!H) blotches(g, W, Hh, 40, 15, 80, [[255, 255, 250, 0.1], [60, 58, 52, 0.12]]); speckle(g, W, Hh, 20000, H ? 0.2 : 0.08); });
    g.fillStyle = H ? '#202020' : 'rgba(40,40,40,.5)'; g.fillRect(0, 0, 1.5, 0.008); });

  // concreto da rampa de garagem com ranhuras antiderrapantes em diagonal (ladrilho de 0,5 m)
  const grooveTex = () => mkPair(0.5, 0.5, 512, (g, w, h, H) => {
    g.fillStyle = H ? '#b0b0b0' : '#8d8c87'; g.fillRect(0, 0, 0.5, 0.5);
    inPx(g, (W2, H2) => { if (!H) blotches(g, W2, H2, 25, 15, 70, [[255, 255, 250, 0.08], [50, 48, 44, 0.12]]); speckle(g, W2, H2, 9000, H ? 0.2 : 0.08); });
    g.save(); g.beginPath(); g.rect(0, 0, 0.5, 0.5); g.clip(); g.lineWidth = 0.012;
    for (let t = -0.5; t <= 1.0; t += 0.0625) { g.strokeStyle = H ? '#303030' : 'rgba(45,44,40,.55)'; g.beginPath(); g.moveTo(t, 0); g.lineTo(t - 0.5, 0.5); g.stroke();
      if (!H) { g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 0.004; g.beginPath(); g.moveTo(t + 0.008, 0); g.lineTo(t - 0.492, 0.5); g.stroke(); g.lineWidth = 0.012; } }
    g.restore(); });
  function buildFrontage(K) {
    const W = WALK, R = K.grp(0, 0), Y = W.h, zb = FZ + W.d;   // zb: borda da calçada (encosto do meio-fio)
    const surf = (pair, rx, ry, rough, bump, tint) => { const m = K.std(null, rough, 0, rep(pair[0], rx, ry), 0.22); m.bumpMap = rep(pair[1], rx, ry); m.bumpScale = bump; if (tint) m.color.set(tint); return m; };
    const PL = plateTex(), PV = pavTex(), TD = tactileTex(false), CC = concTex(), GV = grooveTex(), GR = graniteTex('#77797c', 0.26);
    const SV = 0.75, TZ = 1.3, TW = 0.25;   // largura da faixa de serviço; posição e largura da linha tátil
    const flat = (w, d, mat, x, z, y) => { const p = K.plane(w, d, mat, x, y, z, 0, R); p.rotation.x = -Math.PI / 2; p.castShadow = false; return p; };
    // faixa livre (placas + linha tátil) contínua e nivelada na frente de tudo, inclusive do portão
    const FL = W.d - SV, xr0 = -W.cut - W.ramp, xr1 = W.cut + W.ramp;
    K.box(W.x1 - W.x0, Y, FL, surf(PL, W.x1 - W.x0, FL, 0.85, 0.012), (W.x0 + W.x1) / 2, Y / 2, FZ + FL / 2, R, false).castShadow = false;
    { const tl = W.x1 - W.x0 - 0.8; flat(tl, TW, surf(TD, tl / 0.25, 1, 0.75, 0.03), (W.x0 + W.x1) / 2, FZ + TZ, Y + 0.003); }
    // faixa de serviço (bloquete) dos dois lados do rebaixo
    [[W.x0, xr0], [xr1, W.x1]].forEach(([a, c]) => { const w = c - a, xm = (a + c) / 2;
      K.box(w, Y, SV, surf(PL, w, SV, 0.85, 0.012), xm, Y / 2, zb - SV / 2, R, false).castShadow = false;
      flat(w, SV, surf(PV, w / 0.8, SV / 0.8, 0.9, 0.018), xm, zb - SV / 2, Y + 0.002); });
    // rebaixo do portão (guia rebaixada): só a faixa de serviço desce até a rua; as laterais abrem em leque (abas) e se
    // fundem na calçada, sem degrau. Concreto com ranhuras antiderrapantes em diagonal.
    { const wx = xr1 - xr0, nx = 40, nz = 8, g = new THREE.PlaneGeometry(wx, SV, nx, nz); g.rotateX(-Math.PI / 2);
      const p = g.attributes.position, low = 0.035;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), s = (z + SV / 2) / SV, ax = Math.abs(x);   // s: 0 na faixa livre, 1 no meio-fio
        const k = ax <= W.cut ? 1 : Math.max(0, 1 - (ax - W.cut) / W.ramp), e = k * k * (3 - 2 * k), q = s * s * (3 - 2 * s) * 0.35 + s * 0.65;
        p.setY(i, Y - (Y - low) * e * q); }
      g.computeVertexNormals();
      const m = surf(GV, wx / 0.5, SV / 0.5, 0.85, 0.02); const me = K.put(g, m, 0, 0, zb - SV / 2, R, false); me.castShadow = false;
      // frente do rebaixo (atrás do meio-fio baixo) e sujeira de pneu nas ranhuras
      const tr = mkM(1, 1, 64, (gg, w, h) => { gg.fillStyle = lin(gg, 0, 0, 0, h, 'rgba(20,20,22,0)', 'rgba(20,20,22,.28)'); gg.fillRect(0, 0, w, h); });
      [-1.25, 1.25].forEach(x => { const t = K.plane(0.55, SV, K.tag(new THREE.MeshBasicMaterial({ map: tr, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })), x, 0, zb - SV / 2, 0, R);
        t.rotation.x = -Math.PI / 2 + Math.atan((Y - low) / SV); t.position.y = (Y + low) / 2 + 0.006; t.castShadow = false; t.receiveShadow = false; }); }
    // meio-fio de granito com quina boleada: alto nos trechos normais, baixo no rebaixo, com transição inclinada nas abas
    const cm = () => { const m = K.std(null, 0.45, 0.05, rep(GR, 1, 1), 0.25); return m; };
    const curbProfile = t => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0, t); sh.lineTo(-0.11, t); sh.quadraticCurveTo(-0.14, t, -0.142, Math.max(0, t - 0.03)); sh.lineTo(-0.15, 0); sh.closePath(); return sh; };
    const curbRun = (a, c, t) => { const cg = new THREE.ExtrudeGeometry(curbProfile(t), { depth: c - a, bevelEnabled: false, curveSegments: 4 }); cg.rotateY(Math.PI / 2); K.put(cg, cm(), a, 0, zb, R); };
    curbRun(W.x0, xr0, Y + 0.02); curbRun(xr1, W.x1, Y + 0.02); curbRun(-W.cut, W.cut, 0.06);
    [1, -1].forEach(s => { const sh = new THREE.Shape(), hi = Y + 0.02, lo = 0.06;   // transição: perfil lateral em x, extrudado na largura do meio-fio
      if (s > 0) { sh.moveTo(0, 0); sh.lineTo(W.ramp, 0); sh.lineTo(W.ramp, hi); sh.lineTo(0, lo); } else { sh.moveTo(0, 0); sh.lineTo(W.ramp, 0); sh.lineTo(W.ramp, lo); sh.lineTo(0, hi); }
      sh.closePath(); K.put(new THREE.ExtrudeGeometry(sh, { depth: 0.15, bevelEnabled: false }), cm(), s > 0 ? W.cut : -W.cut - W.ramp, 0, zb, R); });
    // sarjeta de concreto ao longo de todo o meio-fio (no nível do asfalto)
    { const w = W.x1 - W.x0; K.box(w, 0.025, 0.4, surf(CC, w / 1.5, 0.4 / 1.5, 0.8, 0.008, '#b4b3ae'), (W.x0 + W.x1) / 2, 0.0125, zb + 0.15 + 0.2, R, false).castShadow = false; }
    // sujeira junto ao pé das paredes (faixa escura que some para fora)
    { const gt = mkM(1, 0.5, 64, (g, w, h) => { g.fillStyle = lin(g, 0, 0, 0, h, 'rgba(30,26,20,.38)', 'rgba(30,26,20,0)'); g.fillRect(0, 0, w, h); });
      const gm2 = K.tag(new THREE.MeshBasicMaterial({ map: gt, transparent: true, depthWrite: false })); const p = flat(W.x1 - W.x0, 0.5, gm2, (W.x0 + W.x1) / 2, FZ + 0.25, Y + 0.004); p.receiveShadow = false; }
    // batentes das vagas
    const ws = K.std(null, 0.75, 0, wheelStopTex(), 0.35), zs = zb + 0.15 + 0.4 + 0.75, mid = (L, x0) => L.slice(0, -1).map((v, i) => x0 + (v + L[i + 1]) / 2);
    if (GAR.WHEEL_STOPS) mid(STALLS.store, STORE.x).concat(mid(STALLS.right, 0)).forEach(x => K.box(1.6, 0.11, 0.16, ws, x, 0.055, zs, R));
    return R;
  }


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
  // asfalto do pátio do lobby (mais realista que o estilizado da pista): uma textura grande sem repetição com desgaste,
  // remendos, trincas seladas, manchas de óleo, marcas de pneu e faixas pintadas (vagas da loja, zebrado do portão) +
  // um ladrilho de agregado (pedrinhas) multiplicado por cima no shader, em duas escalas. Unidades da cena (x, z).
  function lobbyAsphalt(X0, X1, Z0, Z1) {
    const AW = X1 - X0, AD = Z1 - Z0, ppu = Math.min(2048 / AW, 2048 / AD), S = STORE, sx = lx => (S.x + lx) * U, sz = lz => (S.z + lz) * U;
    const macro = mkTex(Math.round(AW * ppu), Math.round(AD * ppu), (g, W, H) => {
      g.setTransform(ppu, 0, 0, ppu, -X0 * ppu, -Z0 * ppu);
      g.fillStyle = '#5a5c60'; g.fillRect(X0, Z0, AW, AD);
      for (let i = 0; i < 170; i++) { const x = X0 + RND() * AW, z = Z0 + RND() * AD, r = 3 + RND() * 16, l = RND() < 0.45;
        g.fillStyle = rad(g, x, z, r, [[0, l ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.08)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(x - r, z - r, 2 * r, 2 * r); }
      // remendos (asfalto mais novo e escuro, com a junta selada em volta)
      [[-38, 8, 9, 6, 0.05], [14, 18, 7, 10, -0.04], [-6, 24, 12, 5, 0.02], [25, 1, 6, 6, 0.1]].forEach(([x, z, w, d, a]) => { g.save(); g.translate(x, z); g.rotate(a);
        g.fillStyle = 'rgba(28,29,32,.3)'; g.fillRect(-w / 2, -d / 2, w, d); g.strokeStyle = 'rgba(16,16,18,.55)'; g.lineWidth = 0.2; g.strokeRect(-w / 2, -d / 2, w, d); g.restore(); });
      // trincas seladas com piche (linhas tortas que se ramificam)
      const crack = (x, z, a, n, w) => { g.strokeStyle = 'rgba(24,24,26,.45)'; g.lineCap = g.lineJoin = 'round'; g.lineWidth = w; g.beginPath(); g.moveTo(x, z);
        for (let i = 0; i < n; i++) { a += (RND() - 0.5) * 0.7; x += Math.cos(a) * 0.9; z += Math.sin(a) * 0.9; g.lineTo(x, z);
          if (RND() < 0.07) { g.stroke(); crack(x, z, a + (RND() < 0.5 ? 1 : -1) * (0.6 + RND() * 0.6), 4 + ((RND() * 10) | 0), w * 0.7); g.lineWidth = w; g.strokeStyle = 'rgba(24,24,26,.45)'; g.beginPath(); g.moveTo(x, z); } }
        g.stroke(); };
      for (let i = 0; i < 9; i++) crack(X0 + RND() * AW, Z0 + RND() * AD, RND() * 6.28, 8 + ((RND() * 20) | 0), 0.08 + RND() * 0.06);
      // trilhas escuras dos pneus saindo do portão da garagem (somem aos poucos)
      for (let z = Z0; z < Z0 + 30; z += 1) { const k = 1 - (z - Z0) / 30; [-2.3, 2.3].forEach(x => { const gr = g.createLinearGradient(x - 1.3, 0, x + 1.3, 0);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,' + (0.14 * k).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 1.3, z, 2.6, 1.02); }); }
      // marcas de borracha (cavalos de pau de kart) e manchas de óleo
      const skid = (cx, cz, r, a0, a1) => [-0.8, 0.8].forEach(o => { g.strokeStyle = 'rgba(14,14,15,.38)'; g.lineWidth = 0.45; g.beginPath(); g.arc(cx, cz, r + o, a0, a1); g.stroke(); });
      skid(17, 15, 5, 0.3, 3.9); skid(1, 22, 7, 3.6, 5.6); skid(23, 25, 4, 1.5, 5.2); skid(-20, 18, 6, 4.4, 6.0);
      const oil = (x, z, r, a) => { g.fillStyle = rad(g, x, z, r, [[0, 'rgba(12,12,14,' + a + ')'], [0.7, 'rgba(12,12,14,' + (a * 0.55).toFixed(3) + ')'], [1, 'rgba(12,12,14,0)']]); g.fillRect(x - r, z - r, 2 * r, 2 * r); };
      const curb = (FZ + WALK.d + 0.6) * U, sd = STALLS.depth * U, mids = STALLS.store.slice(0, -1).map((v, i) => (v + STALLS.store[i + 1]) / 2);
      mids.forEach((lx, i) => { if (i !== STALLS.pcd) for (let k = 0; k < 4; k++) oil(sx(lx) + (RND() - 0.5) * 2.2, curb + sd * 0.55 + (RND() - 0.5) * 3.5, 0.6 + RND() * 1.4, 0.3); });
      for (let k = 0; k < 10; k++) oil(X0 + RND() * AW, Z0 + RND() * AD, 0.4 + RND() * 1.2, 0.22);
      // tampa de bueiro e grelha de drenagem junto ao meio-fio
      { const x = 24, z = 18, r = 1.3; g.fillStyle = '#34353a'; g.beginPath(); g.arc(x, z, r, 0, 6.2832); g.fill(); g.strokeStyle = 'rgba(170,170,175,.35)'; g.lineWidth = 0.12; g.stroke();
        g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 0.08; for (let k = -3; k <= 3; k++) { const yy = k * 0.32, hx = Math.sqrt(r * r - yy * yy) * 0.82; g.beginPath(); g.moveTo(x - hx, z + yy); g.lineTo(x + hx, z + yy); g.stroke(); } }
      { const x = sx(-6.2), z = curb + 0.45; g.fillStyle = '#26272b'; g.fillRect(x - 1.6, z - 0.35, 3.2, 0.7); g.fillStyle = 'rgba(120,120,125,.5)'; for (let k = 0; k < 14; k++) g.fillRect(x - 1.5 + k * 0.22, z - 0.3, 0.07, 0.6); }
      // faixas pintadas: vagas (loja e à direita da garagem), vaga PcD azul na frente da porta, zebrado do portão
      const paint = (x0, z0, x1, z1, c, w) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'butt'; g.beginPath(); g.moveTo(x0, z0); g.lineTo(x1, z1); g.stroke(); };
      const WHT = 'rgba(238,238,232,.88)', BLU = 'rgba(40,110,200,.9)';
      STALLS.store.forEach((lx, i) => paint(sx(lx), curb, sx(lx), curb + sd, i === STALLS.pcd || i === STALLS.pcd + 1 ? BLU : WHT, 0.26));
      STALLS.right.forEach(x => paint(x * U, curb, x * U, curb + sd, WHT, 0.26));
      { const cx = sx(mids[STALLS.pcd]), cz = curb + sd * 0.55, q = 1.25;   // símbolo internacional de acesso
        g.fillStyle = BLU; rrect(g, cx - q, cz - q, 2 * q, 2 * q, 0.2); g.fill(); g.fillStyle = WHT; g.strokeStyle = WHT; g.lineCap = 'round'; g.lineWidth = 0.22;
        g.beginPath(); g.arc(cx - 0.05, cz - 0.78, 0.17, 0, 6.2832); g.fill();
        g.beginPath(); g.moveTo(cx - 0.12, cz - 0.5); g.lineTo(cx - 0.18, cz + 0.12); g.lineTo(cx + 0.42, cz + 0.12); g.lineTo(cx + 0.62, cz + 0.62); g.stroke();
        g.beginPath(); g.moveTo(cx - 0.15, cz - 0.25); g.lineTo(cx + 0.3, cz - 0.25); g.stroke();
        g.lineWidth = 0.16; g.beginPath(); g.arc(cx - 0.1, cz + 0.3, 0.5, -0.9, 3.6); g.stroke(); }
      const hatch = (x0, z0, x1, z1, c) => { g.save(); g.beginPath(); g.rect(x0, z0, x1 - x0, z1 - z0); g.clip(); g.strokeStyle = c; g.lineWidth = 0.3;
        for (let t = -(z1 - z0); t < x1 - x0; t += 1.1) { g.beginPath(); g.moveTo(x0 + t, z1); g.lineTo(x0 + t + (z1 - z0), z0); g.stroke(); } g.restore(); g.strokeStyle = c; g.lineWidth = 0.24; g.strokeRect(x0, z0, x1 - x0, z1 - z0); };
      g.fillStyle = lin(g, 0, Z0, 0, Z0 + 2.2, 'rgba(0,0,0,.22)', 'rgba(0,0,0,0)'); g.fillRect(X0, Z0, AW, 2.2);   // sujeira junto às paredes
      // grão fino por cima de tudo (também gasta a tinta das faixas)
      inPx(g, (W2, H2) => { for (let i = 0; i < W2 * H2 * 0.05; i++) { const v = (RND() < 0.5 ? 60 : 115) + ((RND() * 30) | 0); g.fillStyle = `rgba(${v},${v},${v + 3},${(RND() * 0.55).toFixed(2)})`; g.fillRect(RND() * W2, RND() * H2, 1 + RND() * 1.6, 1 + RND() * 1.6); } });
    });
    // agregado: pedrinhas de vários tons sobre ligante escuro (repete a cada 3 unidades; média ~0,5 -> não muda o brilho)
    const det = mkTex(512, 512, (g, W, H) => { g.fillStyle = 'rgb(110,110,112)'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 24000; i++) { const v = 80 + ((RND() * 125) | 0), r = 0.7 + RND() * RND() * 3.6, x = RND() * W, y = RND() * H, e = 0.55 + RND() * 0.45, a = RND() * 3.14;
        g.fillStyle = `rgb(${v},${v},${v + 2})`; [[0, 0], [W, 0], [-W, 0], [0, H], [0, -H]].forEach(([ox, oy]) => { if (ox && Math.abs(x + ox - W / 2) > W / 2 + 6) return; if (oy && Math.abs(y + oy - H / 2) > H / 2 + 6) return;
          g.beginPath(); g.ellipse(x + ox, y + oy, r, r * e, a, 0, 6.2832); g.fill(); }); } });
    det.encoding = THREE.LinearEncoding; det.wrapS = det.wrapT = THREE.RepeatWrapping; macro.anisotropy = det.anisotropy = ANISO;
    const mat = new THREE.MeshStandardMaterial({ map: macro, roughness: 0.92, metalness: 0 }), u = { tDet: { value: det }, uRep: { value: new THREE.Vector2(AW / 3, AD / 3) } };
    mat.onBeforeCompile = sh => { sh.uniforms.tDet = u.tDet; sh.uniforms.uRep = u.uRep;
      sh.fragmentShader = 'uniform sampler2D tDet; uniform vec2 uRep;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 d1 = texture2D(tDet, vUv * uRep).rgb, d2 = texture2D(tDet, vUv * uRep * 0.41 + vec2(0.31, 0.67)).rgb;
          diffuseColor.rgb *= mix(d1, d2, 0.35) * 1.9; }`); };
    mat.customProgramCacheKey = () => 'lobby-asphalt-v1'; mat.__ink = true; mat.userData.envK = 0.22;
    return mat;
  }
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
    // pátio de asfalto (realista, só do lobby: lobbyAsphalt) com zebras nas bordas
    const AX0 = -50, AX1 = 32, AZ0 = FZ * U, AZ1 = 30, AW = AX1 - AX0, AD = AZ1 - AZ0;   // vai até a frente da loja de conveniência
    { const g = new THREE.PlaneGeometry(AW, AD); g.rotateX(-Math.PI / 2);
      const mat = lobbyAsphalt(AX0, AX1, AZ0, AZ1);
      mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;
      const m = new THREE.Mesh(g, mat); m.position.set((AX0 + AX1) / 2, 0.02, (AZ0 + AZ1) / 2); m.receiveShadow = true; Wg.add(m);
      const CB = 1.8, curb = (w, d, x, z, ry, len) => { const t = TX.get('curb', 1, len / 4); const cm = new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
        const pg = new THREE.PlaneGeometry(w, d); pg.rotateX(-Math.PI / 2); const cmm = new THREE.Mesh(pg, cm); cmm.rotation.y = ry; cmm.position.set(x, 0.04, z); cmm.receiveShadow = true; Wg.add(cmm); };
      curb(CB, AD, AX0 - CB / 2, (AZ0 + AZ1) / 2, 0, AD); curb(CB, AD, AX1 + CB / 2, (AZ0 + AZ1) / 2, Math.PI, AD); curb(CB, AW + 2 * CB, 0, AZ1 + CB / 2, Math.PI / 2, AW + 2 * CB); }
    // pinheiros da corrida (4 modelos, instanciados por modelo) onde ficavam as árvores de bolinhas (os do lado esquerdo
    // da garagem deram lugar à loja de conveniência)
    if (window.Pines) {
      const T = [[-12, -17, 1.4], [-28, -3, 1.3], [-27, -14, 2], [12, -9, 1.4], [15.5, -13, 1.9], [19, -6, 1.2], [24, -11, 1.6], [11.5, -18, 1.3], [-33, -8, 1.7], [31, -17, 2.1]];
      const mat = Pines.material(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), { amp: 0.02, h0: 3.0, freq: 0.9 }), d = new THREE.Object3D();
      [0, 1, 2, 3].forEach(v => { const L = T.filter(t => Pines.variantAt(t[0], t[1]) === v); if (!L.length) return;
        const im = new THREE.InstancedMesh(Pines.attach(Pines.single('hi', v), L.map(() => v)), mat, L.length);
        L.forEach((t, n) => { const [x, z] = V(t[0], t[1]); d.position.set(x, 0, z); d.rotation.set(0, t[0] * 1.7, 0); d.scale.setScalar(0.55 + t[2] * 0.3); d.updateMatrix(); im.setMatrixAt(n, d.matrix); });
        im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = Pines.depthMaterial(); im.frustumCulled = false; Wg.add(im); }); }
    // floreiras na calçada: cocho de fibrocimento grafite com cantos arredondados e bisotê, tampo de madeira (ripas) em
    // volta da boca, terra com casca e pedriscos e um rodapé escuro. A moita é medida e encaixada DENTRO da boca do vaso.
    const PL = [-8.0, -3.55, 3.55, 8.0], PZ = FZ + 0.6;
    { const pw = 1.4, pd = 0.74, ph = 0.6, r = 0.1, bev = 0.018, y0 = WALK.h + 0.03;
      const rs = (w, d, rr) => { const s = new THREE.Shape(), x = -w / 2, y = -d / 2; s.moveTo(x + rr, y); s.lineTo(x + w - rr, y); s.quadraticCurveTo(x + w, y, x + w, y + rr); s.lineTo(x + w, y + d - rr);
        s.quadraticCurveTo(x + w, y + d, x + w - rr, y + d); s.lineTo(x + rr, y + d); s.quadraticCurveTo(x, y + d, x, y + d - rr); s.lineTo(x, y + rr); s.quadraticCurveTo(x, y, x + rr, y); return s; };
      const ex = (w, d, h, rr, bv) => { const g = new THREE.ExtrudeGeometry(rs(w, d, rr), { depth: h, bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelSegments: 3, curveSegments: 8 }); g.rotateX(-Math.PI / 2); return g; };
      const fT = fiberTex(); fT.wrapS = fT.wrapT = THREE.RepeatWrapping; const sT = soilTex(); sT.wrapS = sT.wrapT = THREE.RepeatWrapping;
      const body = new THREE.MeshStandardMaterial({ map: fT, roughness: 0.82, metalness: 0.02 }), rim = new THREE.MeshStandardMaterial({ color: 0x5d6168, roughness: 0.6, metalness: 0.1 });
      const foot = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.9 }), soil = new THREE.MeshStandardMaterial({ map: sT, roughness: 1 });
      [body, rim, foot, soil].forEach(m => { m.__ink = true; m.userData.envK = 0.35; });
      // tampo: moldura de madeira (anel com furo) por cima da borda
      const ring = (() => { const o = rs(pw + 0.06, pd + 0.06, r + 0.03); o.holes.push(rs(pw - 0.14, pd - 0.14, r * 0.6)); const g = new THREE.ExtrudeGeometry(o, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 8 }); g.rotateX(-Math.PI / 2); return g; })();
      const woodT = mkM(1, 1, 256, g => { g.fillStyle = '#8a5a36'; g.fillRect(0, 0, 1, 1); for (let k = 0; k < 9; k++) { const y = k / 9, v = 120 + ((RND() * 40) | 0); g.fillStyle = `rgb(${v + 30},${v - 10},${v - 45})`; g.fillRect(0, y + 0.004, 1, 1 / 9 - 0.008); }
        inPx(g, (W2, H2) => { g.strokeStyle = 'rgba(60,30,10,.25)'; g.lineWidth = 1; for (let k = 0; k < 120; k++) { const y = RND() * H2; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(W2 * 0.3, y + (RND() - 0.5) * 6, W2 * 0.6, y + (RND() - 0.5) * 6, W2, y); g.stroke(); } }); });
      woodT.wrapS = woodT.wrapT = THREE.RepeatWrapping; const wood = new THREE.MeshStandardMaterial({ map: woodT, roughness: 0.55, metalness: 0 }); wood.__ink = true; wood.userData.envK = 0.4;
      const G = { foot: ex(pw - 0.04, pd - 0.04, 0.03, r * 0.9, 0), body: ex(pw, pd, ph - 2 * bev, r, bev), rim: ring, soil: new THREE.ShapeGeometry(rs(pw - 0.1, pd - 0.1, r * 0.7)).rotateX(-Math.PI / 2) };
      const top = y0 + ph;
      PL.forEach(x => { const P = new THREE.Group(); P.position.set(x * U, 0, PZ * U); P.scale.setScalar(U); Wg.add(P);
        const add = (g, m, y, cast) => { const o = new THREE.Mesh(g, m); o.position.y = y; o.castShadow = cast; o.receiveShadow = true; P.add(o); };
        add(G.foot, foot, WALK.h, false); add(G.body, body, y0 + bev, true); add(G.rim, wood, top - 0.01, true); add(G.soil, soil, top - 0.05, false); });
      if (window.Bush) { const im = new THREE.InstancedMesh(Bush.geometry('hi'), Bush.material(), PL.length), d = new THREE.Object3D();
        // mede a moita e escala para caber na boca do vaso (largura e profundidade), com a base enterrada na terra
        const bg = Bush.geometry('hi'); if (!bg.boundingBox) bg.computeBoundingBox(); const bb = bg.boundingBox, bw = bb.max.x - bb.min.x, bd = bb.max.z - bb.min.z, bh = bb.max.y - bb.min.y;
        const kx = (pw - 0.1) * U / bw, kz = (pd - 0.1) * U / bd, ky = Math.max(kx, kz) * 0.95, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
        PL.forEach((x, n) => { const a = n % 2 ? Math.PI : 0; d.rotation.set(0, a, 0); d.scale.set(kx, ky, kz);
          d.position.set(x * U - Math.cos(a) * cx * kx, (top - 0.05) * U - (bb.min.y + bh * 0.08) * ky, PZ * U - Math.cos(a) * cz * kz); d.updateMatrix(); im.setMatrixAt(n, d.matrix); });
        im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = Bush.depthMaterial(); im.frustumCulled = false; Wg.add(im); } }
    // postes de luz da corrida (lampião clássico) com SpotLight e brilho que acendem à noite
    if (window.LampPost) {
      const LM = LampPost.materials(), LG = LampPost.geometries(), B = LampPost.baker(), heads = [];
      // postes na beira da calçada (braço para a rua), longe do portão e da porta da loja
      [-16.8, -7.4, 7.4, 15.2].map(x => [x, FZ + WALK.d - 0.4, -Math.PI / 2]).forEach(([x, z, a]) => { const M = new THREE.Matrix4().compose(new THREE.Vector3(x * U, WALK.h * U, z * U), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(1, 1, 1));
        LampPost.place(LG, B.put, M); heads.push(new THREE.Vector3(LampPost.ARM, LampPost.LAMPY, 0).applyMatrix4(M)); });
      LampPost.merge(B.bake, LM).forEach(m => Wg.add(m)); Object.values(LG).forEach(g => g.dispose()); out.lampGlass = LM.glass;
      heads.forEach(H => { const L = new THREE.SpotLight(0xffc685, 0, 62, 1.0, 0.75, 1.4); L.position.copy(H); L.target.position.set(H.x, 0, H.z); Wg.add(L, L.target); out.lights.push(L);
        const mk = (c, s) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); sp.position.copy(H); sp.scale.setScalar(s); Wg.add(sp); return sp; };
        out.halos.push(mk(0xfff0d0, 2), mk(0xffb766, 7)); });
    }
    // pilhas de pneus da corrida (os cones do pátio foram tirados)
    if (window.Props && Props.tireAssets) {
      const T = Props.tireAssets(), TR = Props.TIRE, STEP = TR.H * 2 * 0.96;
      [[-25.2, 7.8, 3], [-23.2, 7.8, 4], [-21.2, 7.8, 3], [-22.2, 9.8, 2]].forEach(([x, z, n], k) => { for (let h = 0; h < n; h++) { const m = new THREE.Mesh(T.geo, T.mat);
        m.position.set(x + Math.sin(k * 7 + h) * 0.05, TR.H - 0.04 + h * STEP, z); m.rotation.y = k * 1.3 + h * 0.8; m.castShadow = m.receiveShadow = true; Wg.add(m); } });
    }
    return out;
  }

  // ---------------------------------------------------------------- PÓS-EFEITO DA VITRINE (só no lobby/garagem; a corrida tem o dela)
  // A cena é desenhada numa textura de ponto flutuante (o que passa de 1 vira brilho), com profundidade. Passos:
  //  1. oclusão de ambiente (SSAO, meia resolução): cantos, pé das paredes, embaixo do kart e das floreiras escurecem
  //  2. brilho (bloom) em 2 escalas a partir do que passa do branco: lâmpadas, spots, sol, reflexos
  //  3. final: profundidade de campo + oclusão + brilho + ombro suave nos claros + cor (saturação/contraste) + vinheta + dither
  // A textura guarda cor já "de tela" (sRGB), como antes: os shaders próprios do céu, nuvens e vidro continuam iguais.
  const POST_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const DEC = 'vec3 dec(vec3 c){ return pow(max(c, vec3(0.0)), vec3(2.2)); } vec3 enc(vec3 c){ return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }\n';
  const AO_FRAG = `
    uniform sampler2D tD; uniform vec2 uProj; uniform float uNear; uniform float uFar; uniform float uRad; uniform float uInt;
    varying vec2 vUv;
    float vz(vec2 uv) { float d = texture2D(tD, uv).x; return uNear * uFar / (uFar - d * (uFar - uNear)); }
    vec3 vpos(vec2 uv) { float z = vz(uv); return vec3((uv * 2.0 - 1.0) * z / uProj, -z); }
    void main() {
      vec3 P = vpos(vUv); if (-P.z > uFar * 0.9) { gl_FragColor = vec4(1.0); return; }
      vec3 N = normalize(cross(dFdx(P), dFdy(P))); if (dot(N, P) > 0.0) N = -N;
      float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec2 rr = min(vec2(uRad) * 0.5 * uProj / -P.z, vec2(0.1));
      float occ = 0.0, R2 = uRad * uRad;
      for (int i = 0; i < 12; i++) { float fi = (float(i) + n) / 12.0, a = float(i) * 2.39996323 + n * 6.2832;
        vec3 v = vpos(vUv + vec2(cos(a), sin(a)) * sqrt(fi) * rr) - P; float vv = dot(v, v);
        occ += max(0.0, dot(v, N) - 0.012 * -P.z) / (vv + 0.05) * (1.0 - smoothstep(R2 * 0.6, R2 * 2.2, vv)); }
      float ao = clamp(1.0 - uInt * occ / 12.0, 0.0, 1.0);
      gl_FragColor = vec4(vec3(ao * ao), 1.0);
    }`;
  const BRIGHT_FRAG = DEC + `
    uniform sampler2D tC; uniform vec2 uPx; uniform float uTh; varying vec2 vUv;
    void main() {
      vec3 c = (dec(texture2D(tC, vUv + uPx * vec2(-1.0, -1.0)).rgb) + dec(texture2D(tC, vUv + uPx * vec2(1.0, -1.0)).rgb) + dec(texture2D(tC, vUv + uPx * vec2(-1.0, 1.0)).rgb) + dec(texture2D(tC, vUv + uPx * vec2(1.0, 1.0)).rgb)) * 0.25;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722)), k = max(l - uTh, 0.0) / max(l, 1e-4);
      gl_FragColor = vec4(min(c * k, vec3(12.0)), 1.0);
    }`;
  const BLUR_FRAG = `
    uniform sampler2D tC; uniform vec2 uDir; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tC, vUv).rgb * 0.227027;
      c += (texture2D(tC, vUv + uDir * 1.3846).rgb + texture2D(tC, vUv - uDir * 1.3846).rgb) * 0.3162162;
      c += (texture2D(tC, vUv + uDir * 3.2308).rgb + texture2D(tC, vUv - uDir * 3.2308).rgb) * 0.0702703;
      gl_FragColor = vec4(c, 1.0);
    }`;
  const FINAL_FRAG = DEC + `
    uniform sampler2D tC; uniform sampler2D tD; uniform sampler2D tAO; uniform sampler2D tB0; uniform sampler2D tB1;
    uniform vec2 uPx; uniform vec2 uAOPx; uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uRange; uniform float uFall; uniform float uMax; uniform float uVig;
    uniform float uAO; uniform float uBloom; uniform float uExp; uniform float uSat; uniform float uCon; uniform vec3 uTint;
    varying vec2 vUv;
    float cocAt(vec2 uv) { float d = texture2D(tD, uv).x, z = uNear * uFar / (uFar - d * (uFar - uNear)), a = z - uFocus;
      return clamp((abs(a) - uRange) / uFall, 0.0, 1.0) * (a > 0.0 ? 1.0 : 0.55); }
    // antisserrilhado de borda (FXAA): acha a direção da borda pelo contraste dos 4 cantos do pixel e mistura ao longo dela.
    // Junto com a textura maior que a tela (supersample) e o filtro de 4 amostras, some com a "escadinha" dos caixilhos,
    // quinas do prédio e postes finos.
    float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec3 tap4(vec2 uv) { return (texture2D(tC, uv + uPx * vec2(0.375, 0.125)).rgb + texture2D(tC, uv + uPx * vec2(-0.125, 0.375)).rgb + texture2D(tC, uv + uPx * vec2(-0.375, -0.125)).rgb + texture2D(tC, uv + uPx * vec2(0.125, -0.375)).rgb) * 0.25; }
    vec3 fxaa(vec2 uv) {
      vec3 M = tap4(uv);
      float lNW = lum(texture2D(tC, uv + uPx * vec2(-1.0, -1.0)).rgb), lNE = lum(texture2D(tC, uv + uPx * vec2(1.0, -1.0)).rgb);
      float lSW = lum(texture2D(tC, uv + uPx * vec2(-1.0, 1.0)).rgb), lSE = lum(texture2D(tC, uv + uPx * vec2(1.0, 1.0)).rgb), lM = lum(M);
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      if (lMax - lMin < max(0.03, lMax * 0.09)) return M;                                   // sem borda: só o filtro normal
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
      float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0), rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
      dir = clamp(dir * rcp, vec2(-6.0), vec2(6.0)) * uPx;
      vec3 A = 0.5 * (texture2D(tC, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tC, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 B = A * 0.5 + 0.25 * (texture2D(tC, uv - dir * 0.5).rgb + texture2D(tC, uv + dir * 0.5).rgb);
      float lB = lum(B); return (lB < lMin || lB > lMax) ? A : B; }
    void main() {
      vec3 base = fxaa(vUv);
      float r = cocAt(vUv) * uMax; vec3 acc = base; float w = 1.0;
      if (r > 0.6) {
        for (int i = 0; i < 28; i++) { float fi = float(i) + 0.5, rr = sqrt(fi / 28.0) * r, an = fi * 2.39996323;
          vec2 uv = vUv + vec2(cos(an), sin(an)) * rr * uPx;
          float wi = clamp((cocAt(uv) * uMax - rr) / 1.5 + 1.0, 0.0, 1.0);        // o que está em foco não "vaza" para o fundo desfocado
          acc += texture2D(tC, uv).rgb * wi; w += wi; }
      }
      vec3 L = dec(acc / w);
      if (uAO > 0.0) { float a = texture2D(tAO, vUv).r * 0.36;
        a += (texture2D(tAO, vUv + uAOPx * vec2(1.2, 0.6)).r + texture2D(tAO, vUv + uAOPx * vec2(-0.6, 1.2)).r + texture2D(tAO, vUv + uAOPx * vec2(-1.2, -0.6)).r + texture2D(tAO, vUv + uAOPx * vec2(0.6, -1.2)).r) * 0.16;
        L *= mix(1.0, a, uAO); }
      if (uBloom > 0.0) L += (texture2D(tB0, vUv).rgb * 0.5 + texture2D(tB1, vUv).rgb * 0.8) * uBloom;
      vec3 c = enc(L * uExp * uTint);
      c = mix(c, 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2)), step(vec3(0.8), c));          // ombro suave: o que passa do branco não estoura
      float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, uSat);
      c = mix(c, c * c * (3.0 - 2.0 * c), uCon);
      vec2 q = vUv - 0.5; c *= 1.0 - uVig * smoothstep(0.25, 0.95, length(q) * 1.35);
      c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;   // dither: sem faixas no céu
      gl_FragColor = vec4(c, 1.0);
    }`;
  // céu simplificado para o reflexo de ambiente (PMREM) dos materiais PBR: degradê do céu + sol + chão
  const ENV_FRAG = DEC + `
    uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uGround; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uDec; varying vec3 vD;
    vec3 D(vec3 c){ return uDec > 0.5 ? dec(c) : c; }
    void main() { vec3 d = normalize(vD); float y = d.y;
      vec3 sky = y > 0.0 ? mix(mix(D(uHor), D(uMid), smoothstep(0.0, 0.3, y)), D(uTop), smoothstep(0.3, 0.95, y)) : mix(D(uHor), uGround, smoothstep(0.0, 0.1, -y));
      float s = max(dot(d, uSun), 0.0); sky += D(uSunCol) * (pow(s, 90.0) * 9.0 + pow(s, 6.0) * 0.35) * smoothstep(-0.05, 0.02, y);
      gl_FragColor = linearToOutputTexel(vec4(sky, 1.0)); }`;   // o PMREM grava em RGBE/float: precisa da codificação de saída

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
      const key = this.key = new THREE.DirectionalLight(0xffffff, 0.85); key.castShadow = true; const smap = Math.min(GAR.SHADOW_MAP, renderer.capabilities.maxTextureSize || 2048); key.shadow.mapSize.set(smap, smap); key.shadow.radius = 2.2;
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
      this.applyMode('ext', true); this.initUi(); this.bindDrag(); this.initFx(); this.initEnv(); this.stepSky(0);
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
      K.target.position.set(c.x, 0, c.z); R.target.position.set(c.x, 0, c.z);
      // fora: a sombra do sol cobre o pátio inteiro (garagem, loja, calçada); dentro: só a sala
      if (!int) K.target.position.set(-10, 0, -6); { const B = int ? 26 : 42; Object.assign(K.shadow.camera, { left: -B, right: B, top: B, bottom: -B, far: int ? 140 : 170 }); K.shadow.camera.updateProjectionMatrix(); }
      K.target.updateMatrixWorld(); R.target.updateMatrixWorld();
      this.pilotVis(); this.snap = true; this.userYaw = 0; this.spinV = 0;
      if (int) { this.rev = 0; this.dist = this.zoom[this.focus] * 1.08; const g = document.getElementById('garage'); if (g) { g.classList.remove('enter'); void g.offsetWidth; g.classList.add('enter'); } }
      else { if (!first) this.setDoor(this.door.lin = 1); this.setFocus('vehicle', true); }
    },
    pilotVis() {
      const K = this.kart; if (!K) return; const show = this.mode === 'int' ? !!GAR.PILOT_IN_GARAGE : !!GAR.PILOT_OUTSIDE;
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
        H.intensity = (0.32 + 0.48 * sm((e + 0.15) / 0.45)) * (this.pmrem ? 0.82 : 1); mix(D.hS, e, H.color); mix(D.hG, e, H.groundColor);
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
      this.updateEnv();
      if (this.mode !== 'int' && !reduceMotion()) FLAGS.forEach(f => f(this.t));
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
        const kv = int || !!GAR.KART_OUTSIDE; if (this.kart.group.visible !== kv) this.kart.group.visible = kv;   // pátio da tela principal sem kart
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
      // menu e preparar corrida: balanço suave de um lado para o outro (duas senoides lentas, sem repetir o mesmo vaivém;
      // o alvo anda menos que a câmera, então ela também gira um pouquinho). Desliga com "reduzir movimento" do sistema.
      if (!int && this.goal !== 'int' && GAR.SWAY > 0 && !reduceMotion()) { const A = GAR.SWAY, sx = Math.sin(t * 0.21) + 0.35 * Math.sin(t * 0.083 + 1.7);
        P.x += A * sx; P.y += A * 0.08 * Math.sin(t * 0.29 + 0.6); P.z += A * 0.18 * Math.sin(t * 0.13 + 2.1); L.x += A * 0.3 * sx; }
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

    // ---------- reflexo de ambiente (PMREM): os materiais PBR refletem o céu do momento (refeito a cada poucos segundos) ----------
    initEnv() {
      try {
        if (!(GAR.ENV > 0)) return; this.pmrem = new THREE.PMREMGenerator(this.renderer); const es = this.envScene = new THREE.Scene();
        const u = this.envU = { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
          uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uDec: { value: SRGB ? 1 : 0 } };
        es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ uniforms: u, side: THREE.BackSide, depthWrite: false,
          vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: ENV_FRAG })));
        // ambiente da sala (garagem por dentro): fixo, escuro e quente (trocar de textura não recompila os materiais)
        u.uTop.value.set(0x2a2622); u.uMid.value.set(0x4a4136); u.uHor.value.set(0x5a5044); u.uGround.value.setRGB(0.02, 0.018, 0.016); u.uSunCol.value.setRGB(0, 0, 0);
        this.envInt = this.pmrem.fromScene(es, 0.04, 0.1, 100); this._envT = -1;
      } catch (e) { console.warn('[Vitrine] reflexo de ambiente', e); this.pmrem = null; }
    },
    updateEnv() {
      if (!this.pmrem) return; if (this.mode === 'int') { if (this.scene.environment !== this.envInt.texture) this.scene.environment = this.envInt.texture; return; }
      const now = performance.now() / 1000; if (this._envT >= 0 && now - this._envT < 5) return; this._envT = now;
      const S = this.sky, u = this.envU; if (!S) return;
      u.uTop.value.copy(S.skyU.uTop.value); u.uMid.value.copy(S.skyU.uMid.value); u.uHor.value.copy(S.skyU.uHor.value); u.uSun.value.copy(this.SUNDIR); u.uSunCol.value.copy(S.skyU.uSunCol.value);
      u.uGround.value.setRGB(0.07, 0.072, 0.07).multiplyScalar(0.15 + 0.85 * (1 - this.nightF));                 // asfalto/calçada
      try { const rt = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 100); if (this.envRT) this.envRT.dispose(); this.envRT = rt; this.scene.environment = rt.texture;
        // força do reflexo por material (o que não foi marcado, como o kart trocado no carrossel, fica em 0,5)
        this.scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; ms.forEach(m => { if (m && m.isMeshStandardMaterial) m.envMapIntensity = m.userData.envK != null ? m.userData.envK : 0.5; }); }); }
      catch (e) { console.warn('[Vitrine] reflexo de ambiente', e); this.pmrem = null; }
    },
    // ---------- desenho: cena -> textura (cor + profundidade) -> oclusão / brilho -> passo final -> tela ----------
    initFx() {
      const r = this.renderer;
      try {
        if (!(GAR.DOF > 0) || !(r.capabilities.isWebGL2 || r.extensions.get('WEBGL_depth_texture'))) return;
        const hdr = r.capabilities.isWebGL2 && !!(r.extensions.get('EXT_color_buffer_float') || r.extensions.get('EXT_color_buffer_half_float'));
        const mk = (w, h, o) => { const t = new THREE.WebGLRenderTarget(w, h, Object.assign({ minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, stencilBuffer: false, depthBuffer: false }, o));
          t.texture.generateMipmaps = false; return t; };
        const rt = mk(4, 4, { depthBuffer: true, type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType }); rt.texture.encoding = r.outputEncoding;
        rt.depthTexture = new THREE.DepthTexture(4, 4); rt.depthTexture.type = THREE.UnsignedIntType;
        const bt = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, T = { ao: mk(4, 4), b0: mk(4, 4, { type: bt }), b1: mk(4, 4, { type: bt }), b2: mk(4, 4, { type: bt }), b3: mk(4, 4, { type: bt }) };
        const V2 = () => ({ value: new THREE.Vector2() }), M = (frag, u, ext) => new THREE.ShaderMaterial({ uniforms: u, depthTest: false, depthWrite: false, vertexShader: POST_VS, fragmentShader: frag, extensions: ext || {} });
        const u = { tC: { value: rt.texture }, tD: { value: rt.depthTexture }, tAO: { value: T.ao.texture }, tB0: { value: T.b0.texture }, tB1: { value: T.b3.texture },
          uPx: V2(), uAOPx: V2(), uNear: { value: 1 }, uFar: { value: 400 }, uFocus: { value: 15 }, uRange: { value: 3 }, uFall: { value: 14 }, uMax: { value: 8 }, uVig: { value: 0 },
          uAO: { value: 0 }, uBloom: { value: 0 }, uExp: { value: 1 }, uSat: { value: 1 }, uCon: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) } };
        const P = { final: M(FINAL_FRAG, u),
          ao: M(AO_FRAG, { tD: u.tD, uProj: V2(), uNear: u.uNear, uFar: u.uFar, uRad: { value: GAR.AO_RADIUS }, uInt: { value: GAR.AO_STRENGTH } }, { derivatives: true }),
          bright: M(BRIGHT_FRAG, { tC: u.tC, uPx: V2(), uTh: { value: hdr ? 1.0 : 0.9 } }), blur: M(BLUR_FRAG, { tC: { value: null }, uDir: V2() }) };
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), P.final); quad.frustumCulled = false; const scene = new THREE.Scene(); scene.add(quad);
        this.fx = { rt, T, P, u, quad, scene, hdr, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), size: new THREE.Vector2(), w: 0, h: 0 };
      } catch (e) { console.warn('[Vitrine] pós-efeito indisponível', e); this.fx = null; }
    },
    pass(mat, target) { const F = this.fx; F.quad.material = mat; this.renderer.setRenderTarget(target); this.renderer.render(F.scene, F.cam); },
    render(renderer) {
      const r = renderer || this.renderer, F = this.fx;
      if (!F) { r.render(this.scene, this.cam); return; }
      try {
        r.getDrawingBufferSize(F.size); const ss = Math.min(GAR.DOF_SS, 3400 / Math.max(1, F.size.x)), w = Math.max(2, Math.round(F.size.x * Math.max(1, ss))), h = Math.max(2, Math.round(F.size.y * Math.max(1, ss)));
        if (w !== F.w || h !== F.h) { F.w = w; F.h = h; F.rt.setSize(w, h);
          const hw = Math.max(2, F.size.x >> 1), hh = Math.max(2, F.size.y >> 1); F.T.ao.setSize(hw, hh); F.u.uAOPx.value.set(1 / hw, 1 / hh);
          F.T.b0.setSize(Math.max(2, w >> 2), Math.max(2, h >> 2)); F.T.b1.setSize(Math.max(2, w >> 2), Math.max(2, h >> 2)); F.T.b2.setSize(Math.max(2, w >> 3), Math.max(2, h >> 3)); F.T.b3.setSize(Math.max(2, w >> 3), Math.max(2, h >> 3)); }
        const c = this.cam, u = F.u, P = F.P, int = this.mode === 'int', T = this.turn.position, full = !window.Settings || !Settings.postfxMode || Settings.postfxMode() === 'full';
        c.updateMatrixWorld(); const e = c.matrixWorld.elements;
        u.uFocus.value = Math.max(2, -((T.x - e[12]) * e[8] + (T.y + 1 - e[13]) * e[9] + (T.z - e[14]) * e[10]));   // foco no veículo
        u.uNear.value = c.near; u.uFar.value = c.far; u.uPx.value.set(1 / F.size.x, 1 / F.size.y);
        u.uRange.value = int ? 3.4 : 7; u.uFall.value = int ? 11 : 45; u.uMax.value = (int ? 10 : 5) * GAR.DOF * F.size.y / 1080; u.uVig.value = int ? 0.42 : 0.2;
        u.uExp.value = GAR.EXPOSURE; u.uSat.value = GAR.SATURATION; u.uCon.value = GAR.CONTRAST;
        const nf = this.nightF || 0; u.uTint.value.setRGB(1 + 0.03 * (1 - nf), 1, 1 - 0.03 * (1 - nf) + 0.05 * nf);   // dia levemente quente, noite levemente fria
        r.setRenderTarget(F.rt); r.render(this.scene, c);
        const ao = full && GAR.AO > 0, bl = full && GAR.BLOOM > 0; u.uAO.value = ao ? GAR.AO : 0; u.uBloom.value = bl ? GAR.BLOOM * (0.55 + 0.45 * nf) : 0;
        if (ao) { P.ao.uniforms.uProj.value.set(c.projectionMatrix.elements[0], c.projectionMatrix.elements[5]); this.pass(P.ao, F.T.ao); }
        if (bl) { const B = F.T, bu = P.blur.uniforms;
          P.bright.uniforms.uPx.value.set(1 / w, 1 / h); this.pass(P.bright, B.b0);
          bu.tC.value = B.b0.texture; bu.uDir.value.set(1 / B.b0.width, 0); this.pass(P.blur, B.b1);
          bu.tC.value = B.b1.texture; bu.uDir.value.set(0, 1 / B.b1.height); this.pass(P.blur, B.b0);
          bu.tC.value = B.b0.texture; bu.uDir.value.set(2 / B.b0.width, 0); this.pass(P.blur, B.b2);
          bu.tC.value = B.b2.texture; bu.uDir.value.set(0, 1 / B.b2.height); this.pass(P.blur, B.b3); }
        this.pass(P.final, null);
      } catch (err) { console.warn('[Vitrine] pós-efeito desligado', err); this.fx = null; r.setRenderTarget(null); r.render(this.scene, this.cam); }
    }
  };
  window.Showroom = Showroom;
})();
