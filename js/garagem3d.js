// =====================================================================================
// garagem3d.js — BOX DE CORRIDA: o cenário de fundo da vitrine (menu, garagem, lobby)
//
// Substitui a garagem antiga (assets/garagem.glb). Agora o cenário é montado por código, sem arquivo 3D:
//  * um box de equipe fechado: piso de epóxi polido com faixas pintadas, parede do fundo com o painel KARTEC,
//    rodapé escuro com friso vermelho, portão de enrolar, bancada com painel de ferramentas, carrinho de
//    ferramentas, pilhas de pneus, tambores, cones, colunas, vigas e luminárias de LED;
//  * SOMBRAS de verdade: uma luz principal projeta a sombra do kart e de todos os objetos no piso e nas paredes
//    (mapa de sombra próprio), mais uma sombra de contato suave embaixo do kart e o escurecimento dos cantos
//    pintado nas texturas (dá profundidade mesmo em aparelho fraco);
//  * nada tapa o kart: as paredes só são desenhadas por dentro (a que fica entre a câmera e o kart some sozinha)
//    e qualquer objeto que entrar na linha câmera -> kart é escondido.
// Não mexe no showroom.js: envolve Showroom.build e Showroom.step. Se a garagem antiga ainda for carregada por
// outro arquivo, ela é escondida (REMOVE_OLD). Ajustes em CFG.GARAGEM3D (config.js), todos opcionais.
// =====================================================================================
(function () {
  const C = Object.assign({
    KART_LEN: 1.8,           // o cenário é desenhado em metros para um kart deste comprimento
    SCALE: 0,                // 0 = automático pelo tamanho do kart; > 0 força a escala
    YAW: null,               // null = parede do fundo atrás do kart, vista da câmera do menu; número (graus) força
    YAW_OFFSET: 0,           // graus a mais no giro automático (ex.: 12 mostra um pouco da parede lateral)
    OFFSET: [0, 0, 0],       // ajuste fino da posição (unidades da cena)
    SHADOWS: true,           // sombras projetadas (kart + objetos)
    SHADOW_MAP: 2048,        // resolução do mapa de sombra (1024 = mais leve, 4096 = mais nítido)
    KEY: 0.5,                // força da luz principal que projeta as sombras (0 = não cria a luz)
    GLOW: 0.3,               // luz própria do cenário (ele nunca fica preto, seja qual for a luz da vitrine)
    CONTACT: 0.4,            // sombra de contato embaixo do kart (0 desliga)
    BRAND: 'KARTEC', BRAND_TOP: 'SUPER', ACCENT: '#E8213A',
    REMOVE_OLD: true         // esconde a garagem antiga (garagem.glb) se outro arquivo ainda a carregar
  }, (window.CFG && window.CFG.GARAGEM3D) || {});

  const G = window.Garagem3D = { status: 'carregando', C };
  const SR = () => (typeof Showroom !== 'undefined' ? Showroom : window.Showroom);
  const log = (...a) => console.info('[Box 3D]', ...a), warn = (...a) => console.warn('[Box 3D]', ...a);
  if (!window.THREE) { G.status = 'erro'; warn('THREE não encontrado'); return; }
  const S0 = SR();
  if (!S0 || typeof S0.build !== 'function') { G.status = 'erro'; warn('Showroom não encontrado (carregue este script depois do showroom.js)'); return; }

  // ---------------------------------------------------------------- 0) garagem antiga: fora de cena
  const PART = /^(floor|wall_(left|right|back)|front_(left|right|top)|roof|interior_(back|left|right)|props_ext)$/;
  const oldScenes = [];
  if (C.REMOVE_OLD && THREE.GLTFLoader) {
    const load0 = THREE.GLTFLoader.prototype.load;
    THREE.GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) {
      if (/garagem[^\/]*\.glb/i.test(String(url))) { const cb = onLoad;
        onLoad = g => { try { g.scene.visible = false; g.scene.userData.garagemAntiga = true; oldScenes.push(g.scene); } catch (e) { } if (cb) cb(g); }; }
      return load0.call(this, url, onLoad, onProgress, onError);
    };
  }
  const isInside = (o, root) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  // reconhece a garagem antiga pelos nomes dos grupos do .glb (precisa de 3 nomes diferentes no mesmo pai)
  function sweepOld(scene) {
    const byParent = new Map();
    scene.traverse(o => {
      if (root && isInside(o, root)) return;
      if (o.name === 'Garagem3D' || o.userData.garagemAntiga) { o.visible = false; return; }
      if (o.parent && PART.test(o.name || '')) { if (!byParent.has(o.parent)) byParent.set(o.parent, []); byParent.get(o.parent).push(o); }
    });
    byParent.forEach((list, parent) => {
      if (new Set(list.map(o => o.name)).size < 3) return;
      const hasKart = kart && kart.objs.some(k => isInside(k, parent));
      if (parent !== scene && !hasKart) parent.visible = false; else list.forEach(o => { o.visible = false; });
    });
  }

  // ---------------------------------------------------------------- 1) envolve a vitrine
  let built = false, renderer = null;
  const build0 = S0.build;
  S0.build = function (r) { const out = build0.apply(this, arguments); renderer = r; built = true; try { tryAttach(); } catch (e) { G.status = 'erro'; warn(e); } return out; };
  const step0 = S0.step;
  if (typeof step0 === 'function') S0.step = function (dt) { const out = step0.apply(this, arguments); try { update(dt); } catch (e) { if (!G._err) { G._err = true; warn(e); } } return out; };

  // ---------------------------------------------------------------- 2) acha o kart e o prato da vitrine
  const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _box = new THREE.Box3();
  const worldBox = o => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
  function findDisc(scene) {                 // maior peça chata e larga (o prato giratório / a base)
    let best = null, bestA = 0;
    scene.traverse(o => {
      if (!o.isMesh || !shown(o) || (root && isInside(o, root))) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = _box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld), s = b.getSize(_v), w = Math.min(s.x, s.z), a = s.x * s.z;
      if (s.y < w * 0.35 && w > 0 && a > bestA && s.x < 1e4) { bestA = a; best = { mesh: o, box: b.clone() }; }
    });
    return best;
  }
  function findKart(scene, disc) {
    const S = SR();
    for (const k of ['kart', 'model', 'car', 'kartObj', 'current']) if (S[k] && S[k].isObject3D && isInside(S[k], scene)) return { frame: S[k], objs: [S[k]] };
    let skinned = null; scene.traverse(o => { if (!skinned && o.isSkinnedMesh && shown(o)) skinned = o; });   // o piloto
    if (!skinned) return null;
    let k = skinned; const holdsDisc = o => disc && isInside(disc.mesh, o);
    while (k.parent && k.parent !== scene && !holdsDisc(k.parent)) k = k.parent;
    const P = k.parent, kb = worldBox(k), grow = kb.getSize(new THREE.Vector3()).length() * 0.5, objs = [k];
    if (P) P.children.forEach(o => {
      if (o === k || holdsDisc(o) || o.isLight || o.isCamera || !o.visible || (root && isInside(o, root))) return;
      let has = false; o.traverse(q => { if (q.isMesh) has = true; }); if (!has) return;
      const ob = worldBox(o); if (ob.isEmpty() || ob.getSize(_v).length() > grow * 2.6) return;
      if (ob.intersectsBox(kb.clone().expandByScalar(grow))) objs.push(o);
    });
    return { frame: objs.length > 1 && P && P !== scene ? P : k, objs };
  }
  function localBox(K) {
    K.frame.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(K.frame.matrixWorld).invert(), box = new THREE.Box3();
    K.objs.forEach(r => r.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(_box.copy(o.geometry.boundingBox).applyMatrix4(_m.multiplyMatrices(inv, o.matrixWorld)));
    }));
    return box;
  }
  const kartAlive = (K, scene) => K && K.objs.every(o => isInside(o, scene));
  // o kart (e o piloto) projetam sombra; refeito quando o veículo é trocado na Garagem
  function castKart() {
    if (!kart || !C.SHADOWS) return;
    kart.objs.forEach(r => r.traverse(o => { if (!o.isMesh || o.castShadow) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      if (ms.every(m => m && !(m.transparent && (m.opacity < 0.9 || m.depthWrite === false)) && !(m.userData && m.userData.outline))) o.castShadow = true; }));
  }

  // ---------------------------------------------------------------- 3) texturas pintadas (canvas)
  const RW = 16, Z0 = -5.5, Z1 = 9, RD = Z1 - Z0, RH = 5.2;        // sala em metros: x ±8, z de -5,5 (fundo) a 9, pé-direito 5,2
  let enc = THREE.LinearEncoding, aniso = 4, srgbOut = false;
  const col = h => { const c = new THREE.Color(h); return srgbOut ? c.convertSRGBToLinear() : c; };
  const FONT = () => (window.CFG && CFG.FONT_DISPLAY) || '"Titan One", "Arial Rounded MT Bold", sans-serif';
  function mkTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = enc; t.anisotropy = aniso; return t;
  }
  const speckle = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = (Math.random() < 0.5 ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + (Math.random() * a).toFixed(3) + ')'; const s = 1 + Math.random() * 2.5; g.fillRect(Math.random() * w, Math.random() * h, s, s); } };
  const lin = (g, x0, y0, x1, y1, a, b) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
  const rad = (g, x, y, r, a, b) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
  // texto em metros (o canvas está em escala de metros; a fonte é desenhada a 100 px e reduzida)
  function label(g, txt, x, y, size, fill, opt) {
    opt = opt || {}; g.save(); g.translate(x, y); g.scale(size / 100 * (opt.sx || 1), size / 100 * (opt.flip ? -1 : 1));
    g.font = '400 100px ' + FONT(); g.textAlign = opt.align || 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
    (opt.strokes || []).forEach(s => { g.strokeStyle = s[0]; g.lineWidth = s[1]; g.strokeText(txt, 0, 0); });
    g.fillStyle = fill; g.fillText(txt, 0, 0); g.restore();
  }

  // piso: epóxi cinza polido, juntas a cada 2 m, anel pintado em volta do prato, faixas do box e desgaste
  function floorTex(ringR) {
    return mkTex(2048, 2048, (g, W, H) => {
      g.fillStyle = lin(g, 0, 0, 0, H, '#353941', '#3f444d'); g.fillRect(0, 0, W, H);
      for (let i = 0; i < 60; i++) { const x = Math.random() * W, y = Math.random() * H, r = 80 + Math.random() * 260; g.fillStyle = rad(g, x, y, r, Math.random() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.06)', 'rgba(0,0,0,0)'); g.fillRect(x - r, y - r, 2 * r, 2 * r); }
      speckle(g, W, H, 16000, 0.07);
      g.setTransform(W / RW, 0, 0, H / RD, W / 2, H * -Z0 / RD);                       // daqui em diante: metros (x, z), origem no kart
      for (let x = -8; x <= 8; x += 2) { g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 0.012, Z0, 0.024, RD); g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x + 0.012, Z0, 0.012, RD); }
      for (let z = -5.5; z <= 9; z += 2) { g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(-8, z - 0.012, RW, 0.024); g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(-8, z + 0.012, RW, 0.012); }
      // marcas de pneu
      g.lineCap = 'round';
      [[-1.1, 9, -0.75, 3.2], [1.1, 9, 0.75, 3.2], [-3.2, 8.5, -5.4, 2], [3.6, 7, 6.8, 3]].forEach(a => { g.strokeStyle = 'rgba(8,8,10,.2)'; g.lineWidth = 0.2; g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo((a[0] + a[2]) / 2 + 0.5, (a[1] + a[3]) / 2, a[2], a[3]); g.stroke(); });
      // faixas do box
      g.fillStyle = 'rgba(242,243,245,.85)'; g.fillRect(-4.9, -4.2, 0.1, 12); g.fillRect(4.8, -4.2, 0.1, 12); g.fillRect(-4.9, -4.2, 9.8, 0.1);
      [-1, 1].forEach(sd => { for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? 'rgba(242,243,245,.85)' : C.ACCENT; g.fillRect(sd * 4.85 - 0.3, 4.6 + k * 0.6, 0.6, 0.6); } });
      // faixa zebrada junto à parede do fundo
      g.save(); g.beginPath(); g.rect(-8, -5.5, 16, 0.42); g.clip(); g.fillStyle = '#f2c418'; g.fillRect(-8, -5.5, 16, 0.42);
      g.fillStyle = '#17181b'; for (let x = -9; x < 9; x += 0.6) { g.beginPath(); g.moveTo(x, -5.5); g.lineTo(x + 0.3, -5.5); g.lineTo(x + 0.72, -5.08); g.lineTo(x + 0.42, -5.08); g.fill(); } g.restore();
      // anel em volta do prato giratório
      g.strokeStyle = '#f2f3f5'; g.lineWidth = 0.13; g.beginPath(); g.arc(0, 0, ringR, 0, 6.2832); g.stroke();
      g.strokeStyle = C.ACCENT; g.lineWidth = 0.11; g.setLineDash([0.55, 0.32]); g.beginPath(); g.arc(0, 0, ringR + 0.3, 0, 6.2832); g.stroke(); g.setLineDash([]);
      label(g, C.BRAND + ' RACING', 0, ringR + 2.2, 0.62, 'rgba(242,243,245,.5)');
      label(g, 'BOX 01', -6.4, -3.2, 0.5, 'rgba(242,243,245,.42)');
      // luz e sombra pintadas: poça de luz no centro, cantos e rodapés escurecidos
      g.fillStyle = rad(g, 0, -0.5, 7.5, 'rgba(255,246,228,.2)', 'rgba(255,246,228,0)'); g.fillRect(-8, Z0, RW, RD);
      g.fillStyle = lin(g, 0, Z0, 0, Z0 + 2.2, 'rgba(0,0,0,.55)', 'rgba(0,0,0,0)'); g.fillRect(-8, Z0, RW, 2.2);
      g.fillStyle = lin(g, -8, 0, -6, 0, 'rgba(0,0,0,.5)', 'rgba(0,0,0,0)'); g.fillRect(-8, Z0, 2, RD);
      g.fillStyle = lin(g, 8, 0, 6, 0, 'rgba(0,0,0,.5)', 'rgba(0,0,0,0)'); g.fillRect(6, Z0, 2, RD);
      g.fillStyle = lin(g, 0, Z1, 0, Z1 - 4, 'rgba(0,0,0,.5)', 'rgba(0,0,0,0)'); g.fillRect(-8, Z1 - 4, RW, 4);
    });
  }
  // parede: painéis claros, rodapé escuro com friso vermelho; a do fundo leva o painel da marca
  function wallTex(wm, brand) {
    return mkTex(2048, 1024, (g, W, H) => {
      g.setTransform(W / wm, 0, 0, -H / RH, W / 2, H);                                   // metros, y para cima, x centrado
      const hw = wm / 2;
      g.fillStyle = lin(g, 0, RH, 0, 1.2, '#c4cad3', '#a4abb6'); g.fillRect(-hw, 0, wm, RH);
      for (let x = -hw; x <= hw; x += 2) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x - 0.012, 1.2, 0.024, RH); g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(x + 0.012, 1.2, 0.014, RH); }
      g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(-hw, 4.0, wm, 0.022); g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(-hw, 3.978, wm, 0.014);
      if (brand) {
        // painel escuro com a marca, xadrez na base e faixas de velocidade
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-4.86, 1.9, 9.8, 2.0);
        g.fillStyle = lin(g, 0, 3.86, 0, 1.96, '#1c1e24', '#101216'); g.fillRect(-4.8, 1.96, 9.6, 1.9);
        g.save(); g.beginPath(); g.rect(-4.8, 1.96, 9.6, 1.9); g.clip();
        g.fillStyle = C.ACCENT; [[2.6, 0.5], [3.3, 0.22], [3.72, 0.1]].forEach(s => { g.beginPath(); g.moveTo(s[0], 1.96); g.lineTo(s[0] + s[1], 1.96); g.lineTo(s[0] + s[1] + 1.0, 3.86); g.lineTo(s[0] + 1.0, 3.86); g.fill(); });
        [[-3.1, 0.5], [-3.52, 0.22], [-3.82, 0.1]].forEach(s => { g.beginPath(); g.moveTo(s[0], 1.96); g.lineTo(s[0] + s[1], 1.96); g.lineTo(s[0] + s[1] - 1.0, 3.86); g.lineTo(s[0] - 1.0, 3.86); g.fill(); });
        for (let i = 0; i < 48; i++) for (let r = 0; r < 2; r++) { g.fillStyle = (i + r) % 2 ? '#f2f3f5' : '#101216'; g.fillRect(-4.8 + i * 0.2, 1.96 + r * 0.11, 0.2, 0.11); }
        g.restore();
        const red = g.createLinearGradient(0, -78, 0, 0); red.addColorStop(0, '#FFA79A'); red.addColorStop(0.4, '#FF4D5E'); red.addColorStop(1, '#C4102B');
        label(g, C.BRAND, 0, 2.42, 1.02, red, { flip: true, strokes: [['#0c0c0e', 30], ['#ffffff', 13]] });
        g.fillStyle = C.ACCENT; g.fillRect(-0.95, 3.3, 1.9, 0.42); g.fillStyle = '#0c0c0e'; g.fillRect(-0.95, 3.27, 1.9, 0.03);
        label(g, C.BRAND_TOP, 0, 3.4, 0.3, '#ffffff', { flip: true });
      } else {
        g.fillStyle = C.ACCENT; g.fillRect(-hw, 2.72, wm, 0.3); g.fillStyle = '#f2f3f5'; g.fillRect(-hw, 2.62, wm, 0.05); g.fillRect(-hw, 3.07, wm, 0.05);
      }
      g.fillStyle = lin(g, 0, 1.1, 0, 0, '#2b2e36', '#1d1f25'); g.fillRect(-hw, 0, wm, 1.1);
      g.fillStyle = C.ACCENT; g.fillRect(-hw, 1.1, wm, 0.09); g.fillStyle = '#f2f3f5'; g.fillRect(-hw, 1.19, wm, 0.025);
      // luz e sombra pintadas
      g.fillStyle = lin(g, 0, RH, 0, 3.3, 'rgba(255,247,230,.34)', 'rgba(255,247,230,0)'); g.fillRect(-hw, 3.3, wm, RH - 3.3);
      g.fillStyle = lin(g, 0, 0, 0, 0.8, 'rgba(0,0,0,.55)', 'rgba(0,0,0,0)'); g.fillRect(-hw, 0, wm, 0.8);
      g.fillStyle = lin(g, -hw, 0, -hw + 1.6, 0, 'rgba(0,0,0,.42)', 'rgba(0,0,0,0)'); g.fillRect(-hw, 0, 1.6, RH);
      g.fillStyle = lin(g, hw, 0, hw - 1.6, 0, 'rgba(0,0,0,.42)', 'rgba(0,0,0,0)'); g.fillRect(hw - 1.6, 0, 1.6, RH);
      g.setTransform(1, 0, 0, 1, 0, 0); speckle(g, W, H, 5000, 0.035);
    });
  }
  const doorTex = () => mkTex(512, 512, (g, W, H) => {
    g.fillStyle = '#b9bfc8'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 32) { g.fillStyle = lin(g, 0, y, 0, y + 32, '#d3d8df', '#8f96a1'); g.fillRect(0, y, W, 30); g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, y + 30, W, 2); }
    g.fillStyle = lin(g, 0, 0, 0, H, 'rgba(0,0,0,.05)', 'rgba(0,0,0,.4)'); g.fillRect(0, 0, W, H);
    g.fillStyle = C.ACCENT; g.fillRect(0, H * 0.46, W, 26); g.fillStyle = '#f2f3f5'; g.fillRect(0, H * 0.46 + 30, W, 5);
  });
  const pegTex = () => mkTex(512, 256, (g, W, H) => {
    g.fillStyle = '#2a2d34'; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(0,0,0,.5)';
    for (let y = 10; y < H; y += 14) for (let x = 10; x < W; x += 14) { g.beginPath(); g.arc(x, y, 1.8, 0, 6.2832); g.fill(); }
    g.lineCap = 'round';
    const tool = (x, y0, y1, c, w) => { g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = w + 4; g.beginPath(); g.moveTo(x + 3, y0 + 4); g.lineTo(x + 3, y1 + 4); g.stroke(); g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); };
    for (let i = 0; i < 9; i++) tool(40 + i * 26, 36, 110 + i * 9, '#c9ced6', 9);
    for (let i = 0; i < 5; i++) { tool(310 + i * 38, 40, 96, '#c9ced6', 7); tool(310 + i * 38, 100, 170, i % 2 ? C.ACCENT : '#f2c418', 15); }
    g.strokeStyle = '#f2f3f5'; g.lineWidth = 4; g.strokeRect(6, 6, W - 12, H - 12);
  });
  const chestTex = () => mkTex(256, 256, (g, W, H) => {
    g.fillStyle = lin(g, 0, 0, 0, H, '#f0364b', '#b3122a'); g.fillRect(0, 0, W, H);
    for (let i = 0; i < 5; i++) { const y = 10 + i * 49; g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(8, y + 42, W - 16, 4); g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(8, y, W - 16, 3); g.fillStyle = '#d6dbe3'; g.fillRect(40, y + 16, W - 80, 9); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(40, y + 25, W - 80, 3); }
  });
  const glowTex = () => mkTex(128, 128, (g, W, H) => { g.fillStyle = rad(g, 64, 64, 64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'); g.fillRect(0, 0, W, H); });
  const blobTex = () => mkTex(256, 256, (g, W, H) => { const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.45, 'rgba(0,0,0,.62)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); });

  // ---------------------------------------------------------------- 4) monta o box (em metros, kart na origem, câmera em +z)
  let root = null, kart = null, kBox = null, walls = [], props = [], keyLight = null, ownLight = false, scale = 1;
  function buildRoom(ringR) {
    const R = new THREE.Group(); R.name = 'Box3D';
    const SH = !!C.SHADOWS, unit = new THREE.BoxGeometry(1, 1, 1), mats = {};
    const std = (hex, rough, metal, map) => {
      const key = map ? map.uuid : hex + '|' + rough + '|' + metal; if (mats[key]) return mats[key];
      const m = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : col(hex), roughness: rough, metalness: metal || 0, map: map || null });
      m.emissive = map ? new THREE.Color(0xffffff) : col(hex); m.emissiveMap = map || null; m.emissiveIntensity = C.GLOW; return (mats[key] = m);
    };
    const lit = hex => mats['L' + hex] || (mats['L' + hex] = new THREE.MeshBasicMaterial({ color: col(hex), fog: false }));
    const put = (geo, mat, x, y, z, parent, cast) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = SH && cast !== false && !mat.isMeshBasicMaterial; m.receiveShadow = SH && !mat.isMeshBasicMaterial; (parent || R).add(m); return m; };
    const box = (w, h, d, mat, x, y, z, parent, cast) => { const m = put(unit, mat, x, y, z, parent, cast); m.scale.set(w, h, d); return m; };
    const cyl = (r0, r1, h, mat, x, y, z, parent, seg) => put(new THREE.CylinderGeometry(r0, r1, h, seg || 20), mat, x, y, z, parent);
    const gTex = glowTex();
    const glow = (w, h, hex, op, x, y, z, parent, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: gTex, color: col(hex), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); m.position.set(x, y, z); m.rotation.y = ry || 0; m.renderOrder = 2; parent.add(m); return m; };
    const grp = (parent) => { const g = new THREE.Group(); (parent || R).add(g); return g; };
    const prop = (x, z, r) => { const g = grp(); g.position.set(x, 0, z); props.push({ g, x, z, r }); return g; };

    // ---- casca: piso, 4 paredes e teto (só a face de dentro é desenhada) ----
    const fg = new THREE.PlaneGeometry(RW, RD); fg.rotateX(-Math.PI / 2);
    const floorM = std(null, 0.34, 0.12, floorTex(ringR)); floorM.emissiveIntensity = C.GLOW * 0.75;
    put(fg, floorM, 0, 0, (Z0 + Z1) / 2, R, false);
    const zc = (Z0 + Z1) / 2, sideT = wallTex(RD, false);
    const wall = (w, tex, x, z, ry) => { const m = put(new THREE.PlaneGeometry(w, RH), std(null, 0.8, 0, tex), x, RH / 2, z, R, false); m.rotation.y = ry; return m; };
    wall(RW, wallTex(RW, true), 0, Z0, 0); wall(RD, sideT, -8, zc, Math.PI / 2); wall(RD, sideT, 8, zc, -Math.PI / 2); wall(RW, wallTex(RW, false), 0, Z1, Math.PI);
    const ceil = put(new THREE.PlaneGeometry(RW, RD), std('#1b1d22', 0.9, 0), 0, RH, zc, R, false); ceil.rotation.x = Math.PI / 2; ceil.receiveShadow = false;
    const steel = std('#2a2d34', 0.55, 0.6), dark = std('#1d1f24', 0.7, 0.2);
    [-2, 3.5].forEach(z => box(RW, 0.3, 0.3, steel, 0, RH - 0.15, z, R, false));
    box(0.3, 0.3, RD, steel, 0, RH - 0.45, zc, R, false);

    // ---- parede do fundo: colunas, barras de LED emoldurando o painel, luminárias ----
    const back = grp(); walls.push({ g: back, test: c => c.z > Z0 });
    [-7.8, 7.8].forEach(x => box(0.38, RH, 0.38, steel, x, RH / 2, Z0 + 0.2, back));
    [-5.45, 5.45].forEach(x => { box(0.16, 2.7, 0.07, dark, x, 2.9, Z0 + 0.04, back, false); box(0.07, 2.56, 0.05, lit('#fff3de'), x, 2.9, Z0 + 0.09, back); glow(1.5, 4.0, '#ffe2b0', 0.55, x, 2.9, Z0 + 0.12, back); });
    box(10.9, 0.07, 0.05, lit('#fff3de'), 0, 4.28, Z0 + 0.09, back); box(11.0, 0.16, 0.07, dark, 0, 4.28, Z0 + 0.04, back, false); glow(13, 1.5, '#ffe2b0', 0.4, 0, 4.28, Z0 + 0.12, back);
    box(RW, 0.04, 0.03, lit(C.ACCENT), 0, 0.06, Z0 + 0.03, back); glow(RW, 0.7, C.ACCENT, 0.3, 0, 0.12, Z0 + 0.06, back);
    [-4.2, 0, 4.2].forEach(x => { const y = 4.15, z = -2;                                // pendentes industriais
      cyl(0.015, 0.015, RH - y - 0.3, dark, x, (RH + y) / 2 - 0.05, z, R, 6).castShadow = false;
      const sh = put(new THREE.ConeGeometry(0.5, 0.36, 24, 1, true), std('#15171b', 0.5, 0.5), x, y, z, R, false); sh.material.side = THREE.DoubleSide;
      const d = put(new THREE.CircleGeometry(0.34, 24), lit('#fff6e6'), x, y - 0.12, z, R); d.rotation.x = Math.PI / 2;
      glow(2.2, 2.2, '#ffe9c4', 0.45, x, y - 0.1, z + 0.01, R); });

    // ---- parede esquerda: portão de enrolar ----
    const left = grp(); walls.push({ g: left, test: c => c.x > -8 });
    const door = put(new THREE.PlaneGeometry(4.4, 3.5), std(null, 0.45, 0.5, doorTex()), -7.96, 1.75, 2.2, left, false); door.rotation.y = Math.PI / 2;
    box(0.12, 3.7, 0.22, steel, -7.93, 1.85, -0.1, left); box(0.12, 3.7, 0.22, steel, -7.93, 1.85, 4.5, left); box(0.3, 0.42, 4.9, steel, -7.86, 3.72, 2.2, left);
    box(0.05, 0.05, 4.2, lit('#fff3de'), -7.7, 3.48, 2.2, left); const dg = glow(4.6, 1.3, '#ffe2b0', 0.35, -7.9, 3.3, 2.2, left, Math.PI / 2); dg.renderOrder = 2;

    // ---- parede direita: bancada + painel de ferramentas ----
    const right = grp(); walls.push({ g: right, test: c => c.x < 8 });
    const peg = put(new THREE.PlaneGeometry(3.2, 1.6), std(null, 0.8, 0, pegTex()), 7.95, 2.05, -2.4, right, false); peg.rotation.y = -Math.PI / 2;
    box(0.05, 0.05, 3.2, lit('#fff3de'), 7.86, 3.0, -2.4, right); glow(3.6, 1.2, '#ffe2b0', 0.35, 7.9, 2.9, -2.4, right, -Math.PI / 2);
    const bench = prop(7.45, -2.4, 1.7);
    box(0.95, 0.07, 3.3, std('#b98d5c', 0.6, 0), 0, 0.93, 0, bench); box(0.85, 0.86, 3.1, std('#2b2e35', 0.6, 0.3), 0.02, 0.45, 0, bench);
    const cT = chestTex();
    box(0.04, 0.7, 0.9, std(null, 0.4, 0.3, cT), -0.42, 0.47, -0.9, bench, false); box(0.04, 0.7, 0.9, std(null, 0.4, 0.3, cT), -0.42, 0.47, 0.9, bench, false);
    box(0.34, 0.24, 0.6, std('#d21f37', 0.4, 0.3), -0.05, 1.08, 0.9, bench); box(0.3, 0.03, 0.08, dark, -0.05, 1.22, 0.9, bench);
    cyl(0.07, 0.07, 0.26, std('#2a5ce8', 0.4, 0.2), -0.1, 1.09, -0.5, bench, 12); cyl(0.06, 0.06, 0.2, std('#f2c418', 0.4, 0.2), 0.1, 1.06, -0.2, bench, 12);

    // ---- objetos no chão (todos projetam e recebem sombra) ----
    const chest = prop(-4.9, Z0 + 0.55, 1.1);                                              // carrinho de ferramentas
    const cm = std(null, 0.38, 0.35, cT), red = std('#c9182f', 0.4, 0.35);
    box(1.5, 0.95, 0.62, red, 0, 0.6, 0, chest); box(1.44, 0.89, 0.02, cm, 0, 0.6, 0.315, chest, false);
    box(1.3, 0.5, 0.52, red, 0, 1.33, -0.03, chest); box(1.24, 0.44, 0.02, cm, 0, 1.33, 0.235, chest, false);
    box(1.56, 0.04, 0.66, dark, 0, 1.09, 0, chest);
    [[-0.62, 0.24], [0.62, 0.24], [-0.62, -0.24], [0.62, -0.24]].forEach(p => { const w = cyl(0.07, 0.07, 0.06, dark, p[0], 0.07, p[1], chest, 12); w.rotation.z = Math.PI / 2; });
    const rubber = std('#141518', 0.92, 0), rim = std('#aab0ba', 0.35, 0.8);
    const tires = (x, z, n, r) => { const g = prop(x, z, 0.6); for (let i = 0; i < n; i++) { const y = 0.14 + i * 0.275, a = (Math.random() - 0.5) * 0.07;
      cyl(0.44, 0.44, 0.26, rubber, a, y, a, g, 28); cyl(0.4, 0.4, 0.275, std('#1c1d21', 0.85, 0), a, y, a, g, 28).castShadow = false; cyl(0.23, 0.23, 0.268, rim, a, y, a, g, 18).castShadow = false; } };
    tires(3.9, Z0 + 0.62, 4); tires(4.95, Z0 + 0.6, 5); tires(6.0, Z0 + 0.66, 3); tires(4.45, Z0 + 1.5, 2);
    const leanT = prop(6.75, Z0 + 1.35, 0.6); const lt = cyl(0.44, 0.44, 0.26, rubber, 0, 0.44, 0, leanT, 28); lt.rotation.set(Math.PI / 2 - 0.22, 0.5, 0); const lr = cyl(0.23, 0.23, 0.268, rim, 0, 0.44, 0, leanT, 18); lr.rotation.copy(lt.rotation); lr.castShadow = false;
    const drum = (x, z, hex) => { const g = prop(x, z, 0.45), m = std(hex, 0.45, 0.4); cyl(0.3, 0.3, 0.9, m, 0, 0.45, 0, g); [0.28, 0.62].forEach(y => cyl(0.315, 0.315, 0.035, m, 0, y, 0, g).castShadow = false); cyl(0.305, 0.305, 0.2, std('#f2f3f5', 0.5, 0.1), 0, 0.45, 0, g).castShadow = false; cyl(0.27, 0.27, 0.02, std('#1d1f24', 0.5, 0.5), 0, 0.905, 0, g).castShadow = false; };
    drum(-6.9, Z0 + 0.6, '#2a5ce8'); drum(-6.2, Z0 + 0.75, '#c9182f'); drum(-7.1, Z0 + 1.4, '#2a2d34');
    const cone = (x, z) => { const g = prop(x, z, 0.3), o = std('#ff6a1a', 0.6, 0); box(0.42, 0.04, 0.42, o, 0, 0.02, 0, g); put(new THREE.ConeGeometry(0.16, 0.56, 18), o, 0, 0.32, 0, g); cyl(0.075, 0.108, 0.12, std('#f2f3f5', 0.6, 0), 0, 0.3, 0, g, 18).castShadow = false; };
    cone(-6.6, -0.6); cone(-6.9, 4.9); cone(-5.9, 5.5); cone(6.4, 1.6);
    const jack = prop(-3.1, Z0 + 1.0, 0.7);                                                // macaco hidráulico
    box(1.1, 0.14, 0.42, red, 0, 0.13, 0, jack); const arm = box(0.9, 0.06, 0.05, steel, 0.5, 0.48, 0, jack); arm.rotation.z = 0.75;
    cyl(0.1, 0.1, 0.05, rim, -0.45, 0.24, 0, jack, 16); [[-0.4, 0.2], [0.4, 0.2], [-0.4, -0.2], [0.4, -0.2]].forEach(p => { const w = cyl(0.06, 0.06, 0.05, dark, p[0], 0.06, p[1], jack, 10); w.rotation.x = Math.PI / 2; });
    return R;
  }

  // ---------------------------------------------------------------- 5) luz principal com sombra
  function setupLight(scene) {
    if (!C.SHADOWS) return;
    let L = null; scene.traverse(o => { if (!L && o.isDirectionalLight && o.castShadow) L = o; });
    const R = 12 * scale;
    if (!L) {
      if (!(C.KEY > 0)) return;
      L = new THREE.DirectionalLight(0xfff1dc, C.KEY); L.name = 'Box3D-luz'; L.castShadow = true; ownLight = true;
      L.shadow.mapSize.set(C.SHADOW_MAP, C.SHADOW_MAP); Object.assign(L.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 0.5 * scale, far: 34 * scale });
      L.shadow.bias = -0.0005; L.shadow.normalBias = 0.02 * scale; L.shadow.radius = 2;
      scene.add(L, L.target);
    } else {                                                                              // a vitrine já tem luz com sombra: só aumenta a área coberta
      const c = L.shadow.camera; c.left = Math.min(c.left, -R); c.right = Math.max(c.right, R); c.top = Math.max(c.top, R); c.bottom = Math.min(c.bottom, -R);
      c.far = Math.max(c.far, L.position.distanceTo(L.target.position) + 20 * scale);
      if (L.shadow.mapSize.x < C.SHADOW_MAP) { L.shadow.mapSize.set(C.SHADOW_MAP, C.SHADOW_MAP); if (L.shadow.map) { L.shadow.map.dispose(); L.shadow.map = null; } }
    }
    L.shadow.camera.updateProjectionMatrix(); keyLight = L; placeLight();
  }
  function placeLight() {
    if (!keyLight || !ownLight) return; root.updateMatrixWorld(true);
    keyLight.target.position.copy(root.localToWorld(_v.set(0, 0.4, 0.5))); keyLight.position.copy(root.localToWorld(_v.set(-5.5, 10.5, 6.5)));
    keyLight.target.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- 6) coloca o box no lugar do kart
  let yawLocked = false, settle = 0, frame = 0; const lastCam = new THREE.Vector3(), camL = new THREE.Vector3();
  const yawTo = (cam, cx, cz) => { cam.updateMatrixWorld(true); const p = cam.getWorldPosition(new THREE.Vector3()); return Math.atan2(p.x - cx, p.z - cz) + C.YAW_OFFSET * Math.PI / 180; };
  function tryAttach() {
    if (!built || root) return;
    const S = SR(), scene = S.scene, cam = S.cam;
    if (!scene || !cam) { warn('Showroom.scene/cam não encontrados'); return; }
    scene.updateMatrixWorld(true);
    if (C.REMOVE_OLD) sweepOld(scene);
    const disc = findDisc(scene); kart = findKart(scene, disc);
    if (!kart && !disc) { setTimeout(() => { try { tryAttach(); } catch (e) { warn(e); } }, 300); return; }   // a vitrine ainda está montando o kart

    let cx, cz, floorY, len;
    if (kart) {
      kBox = localBox(kart);
      const ws = kart.frame.getWorldScale(new THREE.Vector3()), sz = kBox.getSize(new THREE.Vector3());
      len = Math.max(sz.x * ws.x, sz.z * ws.z);
      const c = kBox.getCenter(new THREE.Vector3()).applyMatrix4(kart.frame.matrixWorld); cx = c.x; cz = c.z; floorY = Infinity;
      for (const x of [kBox.min.x, kBox.max.x]) for (const y of [kBox.min.y, kBox.max.y]) for (const z of [kBox.min.z, kBox.max.z]) floorY = Math.min(floorY, _v.set(x, y, z).applyMatrix4(kart.frame.matrixWorld).y);
    }
    let baseY, ringR = 2.5;
    if (disc) {
      const dc = disc.box.getCenter(new THREE.Vector3()), dr = Math.min(disc.box.max.x - disc.box.min.x, disc.box.max.z - disc.box.min.z) / 2;
      if (!kart) { cx = dc.x; cz = dc.z; floorY = disc.box.max.y; len = dr / 1.65; }
      else if (Math.hypot(dc.x - cx, dc.z - cz) < len * 0.15) { cx = dc.x; cz = dc.z; }
      scale = C.SCALE > 0 ? C.SCALE : len / C.KART_LEN;
      if (dr < len * 4) { baseY = Math.max(disc.box.min.y, floorY - len * 0.25); ringR = Math.min(6, Math.max(2.2, dr / scale + 0.35)); if (C.SHADOWS) disc.mesh.receiveShadow = true; }   // prato giratório apoiado no piso do box
      else baseY = disc.box.max.y + len * 0.003;                                         // chão grande da vitrine: o piso do box fica logo por cima
    } else { scale = C.SCALE > 0 ? C.SCALE : len / C.KART_LEN; baseY = floorY; }

    const aRend = renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4;
    aniso = (window.TX && TX.aniso) || Math.min(8, aRend); enc = renderer ? renderer.outputEncoding : THREE.LinearEncoding; srgbOut = enc === THREE.sRGBEncoding;
    root = buildRoom(ringR);
    root.position.set(cx + C.OFFSET[0], baseY + C.OFFSET[1], cz + C.OFFSET[2]); root.scale.setScalar(scale);
    root.rotation.y = C.YAW != null ? C.YAW * Math.PI / 180 : yawTo(cam, cx, cz); yawLocked = C.YAW != null;
    if (C.CONTACT > 0) {                                                                 // sombra de contato embaixo do kart
      const bg = new THREE.PlaneGeometry(1, 1); bg.rotateX(-Math.PI / 2);
      const b = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, opacity: C.CONTACT, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      b.scale.setScalar(C.KART_LEN * 1.75); b.position.y = (floorY - baseY) / scale + 0.012; b.renderOrder = 1; root.add(b);
    }
    scene.add(root); setupLight(scene); castKart();
    if (renderer && renderer.compile) { try { renderer.compile(scene, cam); } catch (e) { } }
    G.root = root; G.kart = kart; G.scale = scale; G.light = keyLight; G.status = 'ok'; lastCam.copy(cam.position);
    log('montado em', root.position.toArray().map(v => +v.toFixed(3)), 'escala', +scale.toFixed(4), 'giro', +(root.rotation.y * 180 / Math.PI).toFixed(1) + '°',
      keyLight ? (ownLight ? '(luz de sombra própria)' : '(usando a luz de sombra da vitrine)') : '(sem sombras projetadas)');
  }

  // ---------------------------------------------------------------- 7) quadro a quadro
  function update(dt) {
    for (let i = 0; i < oldScenes.length; i++) oldScenes[i].visible = false;
    if (!root) return;
    const S = SR(), cam = S.cam; dt = Math.min(0.1, dt || 0.016); frame++;
    if (frame % 30 === 0) {
      if (C.REMOVE_OLD && frame < 3600) sweepOld(S.scene);                                // a garagem antiga pode chegar depois (download)
      if (kart && !kartAlive(kart, S.scene)) { kart = findKart(S.scene, findDisc(S.scene)); if (kart) kBox = localBox(kart); G.kart = kart; }
      castKart();
    }
    // direção final: confirma com a câmera do menu parada (uma vez só)
    if (!yawLocked && document.body.dataset.screen === 'menu') {
      settle = cam.position.distanceToSquared(lastCam) < 1e-8 ? settle + dt : 0;
      if (settle > 0.4) { yawLocked = true; root.rotation.y = yawTo(cam, root.position.x - C.OFFSET[0], root.position.z - C.OFFSET[2]); placeLight(); }
    }
    lastCam.copy(cam.position);
    // nada entre a câmera e o kart: decoração da parede some quando a câmera está do lado de fora dela;
    // objeto do chão some se estiver na linha câmera -> kart
    root.updateMatrixWorld(); cam.getWorldPosition(camL); root.worldToLocal(camL);
    for (let i = 0; i < walls.length; i++) walls[i].g.visible = walls[i].test(camL);
    const L2 = camL.x * camL.x + camL.z * camL.z || 1;
    for (let i = 0; i < props.length; i++) { const p = props[i], t = (p.x * camL.x + p.z * camL.z) / L2;
      p.g.visible = !(t > 0.1 && t < 1.1 && Math.hypot(p.x - t * camL.x, p.z - t * camL.z) < p.r + 1.3); }
  }
})();
