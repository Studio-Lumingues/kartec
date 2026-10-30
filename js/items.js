// =====================================================================================
// items.js — caixas de item, banana e dinossauro (tecla E)
//
//  * Caixas de item (placeholder: cubo colorido com "?") em FILEIRAS atravessando a pista, no estilo Mario Kart.
//    Passou por cima -> coleta um item aleatório; a caixa some e volta depois de BOX_RESPAWN segundos.
//  * Cada piloto (você e os bots) segura 1 item por vez. Você usa com a tecla E (ou tocando no ícone do HUD).
//  * BANANA: cai atrás do kart. Quem pisar dá um giro de 360°, para e demora um pouquinho para voltar a correr.
//  * DINOSSAURO: turbo. Quem usa ganha um empurrão de velocidade por alguns segundos.
//  * Modelos: js/models/entidades/banana.glb e dinossauro.glb (carregados uma vez, clonados a cada uso;
//    enquanto não carregam, uma forma simples faz o papel deles).
//  * Só no jogo offline por enquanto (no online o servidor precisaria sincronizar os itens).
//
// Tudo que é "número de ajuste" está em ITEMS_CFG logo abaixo.
// =====================================================================================
(function () {
  const ITEMS_CFG = {
    // fileiras: nó da pista de cada fileira (evitam largada, pontes e plataformas de turbo do Circuito Clássico)
    // fileiras: espalhadas por igual na volta, calculadas para cada pista (evitam largada, pontes, rampas e plataformas;
    // preferem trechos retos). ROW_COUNT = quantas fileiras por volta.
    ROW_COUNT: 5,
    PER_ROW: 4, SPACING: 7.2,          // caixas por fileira e distância máxima entre elas (m; diminui em pista estreita)
    BOX_SIZE: 3.4, BOX_FLOAT: 2.5,     // tamanho do cubo e altura do chão (m)
    BOX_RESPAWN: 4, PICK_RADIUS: 3.9,  // segundos para voltar; raio de coleta (m)
    ROLL_TIME: 1.1,                    // "roleta" antes de o item ficar disponível (s)
    WEIGHTS: { banana: 0.55, dino: 0.45 },
    BANANA: { SIZE: 2.56, RADIUS: 2.3, GRACE: 0.8, LIFE: 90, DROP_BACK: 3.8, MAX: 24, FLOAT: 0.35, BOB: 0.15, SPIN: 1.6 },   // FLOAT/BOB: altura e sobe-desce (m); SPIN: giro (rad/s)   // SIZE: altura da banana (m); RADIUS: raio do escorregão
    // pisou na banana (como no Mario Kart): o kart gira várias vezes enquanto desliza para a frente com o embalo,
    // perde quase toda a velocidade, termina virado para a frente e volta a acelerar do quase parado
    SPIN: { TURNS: 5, TIME: 1.2, STOP: 0.35, SLIDE: 3.2, KEEP: 0.85 },   // voltas; duração do giro (s); parado depois (s); quanto o deslize freia (maior = desliza menos); fração do embalo que vira deslize
    // animação do giro: pulinho (m), tempo no ar (s), quique (m), amassada, inclinação para fora, tremidinha, balanço no fim (rad)
    ANIM: { HOP: 0.55, HOP_T: 0.32, BOUNCE: 0.14, SQUASH: 0.2, LEAN: 0.2, WOBBLE: 0.28, SETTLE: 0.3 },
    BLUR: { GHOSTS: 7, OPACITY: 0.5, SHUTTER: 1.3 },   // motion blur do giro: cópias transparentes; opacidade da 1ª; comprimento do rastro (1 = um quadro de movimento)
    SMOKE: { RATE: 18, SIZE: 0.9, LIFE: 0.85, BURST: 8 },   // fumaça do giro (usa js/smoke.js): nuvens por segundo no giro mais rápido; tamanho (m); duração (s); nuvens do estouro inicial
    DINO: { SIZE: 2.6, BOOST: 2.2 },            // BOOST: duração do turbo do dinossauro (s)
    BOT_WAIT: [1.5, 5],                // bots esperam um tempo aleatório antes de usar o item (s)
    ICON_VIEW: { banana: 0.5, dino: -0.9 },   // giro (rad) de cada modelo na foto do ícone do HUD
    NAMES: { banana: 'Banana', dino: 'Dinossauro' },
    MODELS: { banana: 'js/models/entidades/banana.glb', dino: 'js/models/entidades/dinossauro.glb' }
  };
  const C = ITEMS_CFG;
  const rand = (a, b) => a + Math.random() * (b - a);
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

  // ---------- modelos (.glb) ----------
  const tpl = {}, loading = {};
  function prepModel(root, size) {
    // mantém a textura de cor e o relevo (normal map) do seu modelo; Phong é leve e aceita normal map
    root.traverse(o => { if (!o.isMesh) return; const ms = Array.isArray(o.material) ? o.material : [o.material];
      const nm = ms.map(m => new THREE.MeshPhongMaterial({ map: m.map || null, normalMap: m.normalMap || null, color: m.color ? m.color.clone() : 0xffffff, shininess: 12, specular: 0x222222, transparent: !!m.transparent, opacity: m.opacity === undefined ? 1 : m.opacity, alphaTest: m.alphaTest || 0, side: m.side }));
      o.material = Array.isArray(o.material) ? nm : nm[0]; o.castShadow = false; o.receiveShadow = false; o.frustumCulled = true; });
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), sz = new THREE.Vector3(), ct = new THREE.Vector3(); box.getSize(sz); box.getCenter(ct);
    const s = size / Math.max(sz.x, sz.y, sz.z, 1e-3), wrap = new THREE.Group();
    root.scale.multiplyScalar(s); root.position.set(-ct.x * s, -box.min.y * s, -ct.z * s); wrap.add(root); return wrap;
  }
  // ícone do HUD = foto do próprio modelo 3D (renderizada uma vez, fundo transparente)
  // + máscaras do adesivo holográfico: a silhueta do modelo "engordada" (recorte de adesivo, como na referência)
  const icons = {}, stickers = {};
  const ICON_PX = 124;   // tamanho do ícone na tela (px CSS) dentro do saquinho; as imagens são geradas exatamente nesse tamanho (x zoom da tela)
  function canvasOf(S) { const c = document.createElement('canvas'); c.width = c.height = S; return c; }
  function dilate(src, rad, S) {
    const c = canvasOf(S), x = c.getContext('2d');
    for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; x.drawImage(src, Math.cos(a) * rad, Math.sin(a) * rad); }
    x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
    // borda arredondada e lisa (sem serrilhado do recorte)
    const o = canvasOf(S), y = o.getContext('2d'); y.filter = 'blur(' + (S / 200).toFixed(1) + 'px)'; y.drawImage(c, 0, 0); return o;
  }
  // redução de alta qualidade (metade por vez): reduzir 4x de uma vez no CSS é o que deixava o ícone serrilhado/borrado
  function shrink(src, T) {
    let c = src;
    while (c.width / 2 >= T) { const h = canvasOf(c.width / 2), x = h.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, h.width, h.height); c = h; }
    if (c.width !== T) { const h = canvasOf(T), x = h.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, T, T); c = h; }
    return c;
  }
  // versão "achatada" do adesivo (borda + holograma + modelo numa imagem só): usada no carrossel da roleta
  function bakeSticker(rim, holo, art, T) {
    const c = canvasOf(T), x = c.getContext('2d');
    const tint = (mask, paint) => { const t = canvasOf(T), y = t.getContext('2d'); y.drawImage(mask, 0, 0); y.globalCompositeOperation = 'source-in'; paint(y); return t; };
    const G = glitter(), tile = (y, c) => { y.globalCompositeOperation = 'source-atop'; y.fillStyle = y.createPattern(c, 'repeat'); y.fillRect(0, 0, T, T); };
    x.drawImage(tint(rim, y => { const g = y.createLinearGradient(0, 0, T, T); g.addColorStop(0, '#fff'); g.addColorStop(1, '#dfe6f7'); y.fillStyle = g; y.fillRect(0, 0, T, T); }), 0, 0);
    x.drawImage(tint(holo, y => {
      const g = y.createLinearGradient(0, 0, T, T); ['#5fd2ff', '#a98bff', '#ff7fc8', '#ffd25f', '#6fe8b0', '#5fc4ff'].forEach((cl, i, a) => g.addColorStop(i / (a.length - 1), cl));
      y.fillStyle = g; y.fillRect(0, 0, T, T); y.globalCompositeOperation = 'source-atop';   // quadradinhos por cima (source-in apagaria o resto)
      const q = Math.max(4, Math.round(T / 34)); y.fillStyle = 'rgba(255,255,255,.38)';
      for (let i = 0; i * q < T; i++) for (let j = 0; j * q < T; j++) if ((i + j) % 2 === 0) y.fillRect(i * q, j * q, q, q);
    }), 0, 0);
    x.drawImage(art, 0, 0); return c.toDataURL('image/png');
  }
  // ---------- brilho tipo "optical flare": estrela de luz com raios finos e longos + halo quente (como na referência) ----------
  const GLITTER = {};
  function glitter() {
    if (GLITTER.ok) return GLITTER;
    // raios: 4 principais bem longos e finos, 4 diagonais médios e vários curtinhos; núcleo branco e halo laranja/dourado
    let rays = '';
    const ray = (deg, len, w, op) => { rays += `<polygon points='0,${-w} ${len},0 0,${w} ${-len * 0.04},0' fill='url(#r)' opacity='${op}' transform='rotate(${deg})'/>`; };
    [0, 90, 180, 270].forEach(a => ray(a, 98, 2.6, 1));
    [45, 135, 225, 315].forEach(a => ray(a, 52, 1.8, 0.85));
    [22, 67, 112, 158, 203, 248, 293, 338].forEach((a, i) => ray(a, 26 + (i % 3) * 8, 1.1, 0.6));
    [11, 34, 79, 101, 146, 169, 191, 214, 259, 281, 326, 349].forEach((a, i) => ray(a, 14 + (i % 4) * 5, 0.7, 0.45));
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='-100 -100 200 200'><defs>" +
      "<radialGradient id='h'><stop offset='0' stop-color='#fff' stop-opacity='1'/><stop offset='.12' stop-color='#fff4d6' stop-opacity='.95'/><stop offset='.3' stop-color='#ffb347' stop-opacity='.55'/><stop offset='.6' stop-color='#ff7a1a' stop-opacity='.18'/><stop offset='1' stop-color='#ff5a00' stop-opacity='0'/></radialGradient>" +
      "<linearGradient id='r' x1='0' x2='1' y1='0' y2='0'><stop offset='0' stop-color='#fff'/><stop offset='.35' stop-color='#fff1c9'/><stop offset='1' stop-color='#ffb04a' stop-opacity='0'/></linearGradient>" +
      "<filter id='b' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='1.2'/></filter></defs>" +
      "<circle r='46' fill='url(#h)'/><g filter='url(#b)'>" + rays + "</g>" + rays +
      "<circle r='7' fill='#fff'/><circle r='16' fill='none' stroke='#ffd9a0' stroke-opacity='.35' stroke-width='1.2'/></svg>";
    GLITTER.star = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    GLITTER.ok = true; return GLITTER;
  }
  // centraliza: desloca a imagem para o centro do contorno do adesivo ficar no meio
  function bboxAlpha(c) {
    const S = c.width, d = c.getContext('2d').getImageData(0, 0, S, S).data; let x0 = S, y0 = S, x1 = 0, y1 = 0;
    for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) if (d[(y * S + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 >= x0 ? { x0, y0, x1, y1 } : null;
  }
  function shifted(c, dx, dy) { const o = canvasOf(c.width); o.getContext('2d').drawImage(c, dx, dy); return o; }
  // pontos para as estrelinhas: na borda do adesivo, bem espalhados
  function sparklePoints(rim, n) {
    const S = rim.width, d = rim.getContext('2d').getImageData(0, 0, S, S).data, a = (x, y) => (x < 0 || y < 0 || x >= S || y >= S) ? 0 : d[(y * S + x) * 4 + 3];
    const edge = [], st = Math.max(2, S >> 7);
    for (let y = 0; y < S; y += st) for (let x = 0; x < S; x += st) if (a(x, y) > 128 && (a(x + st * 3, y) < 40 || a(x - st * 3, y) < 40 || a(x, y + st * 3) < 40 || a(x, y - st * 3) < 40)) edge.push([x, y]);
    const pts = []; let sd = 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let tries = 0; pts.length < n && tries < 400; tries++) { const p = edge[Math.floor(rnd() * edge.length)]; if (!p) break;
      if (pts.every(q => Math.hypot(q[0] - p[0], q[1] - p[1]) > S * 0.22)) pts.push(p); }
    return pts.map(p => [p[0] / S * 100, p[1] / S * 100]);
  }
  function makeIcon(k) {
    let r = null;
    try {
      // alta qualidade: renderiza em 1024 px (com antisserrilhado) e reduz em etapas até o tamanho exato da tela
      // usa os MATERIAIS ORIGINAIS do .glb (PBR com normal map), renderiza em 1536 px e reduz em etapas até o tamanho exato da tela
      const S = 768, SS = 1536, T = Math.min(S, Math.ceil(ICON_PX * Math.max(1, Math.min(3, window.devicePixelRatio || 1))));
      r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1); r.setSize(SS, SS, false); r.setClearColor(0x000000, 0); r.outputEncoding = THREE.sRGBEncoding;
      const src = (orig[k] || tpl[k]).clone(true), m = new THREE.Group(); m.add(src); m.rotation.y = C.ICON_VIEW[k] || 0;
      const sc = new THREE.Scene(); sc.add(m);
      m.traverse(o => { if (!o.isMesh) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach(mt => { const t = mt.map; if (t) { t.anisotropy = r.capabilities.getMaxAnisotropy(); t.needsUpdate = true; } }); });
      // luz de estúdio: céu suave + luz principal + preenchimento + contraluz (contorno brilhante que destaca o modelo)
      // luz moderada: cores fiéis às texturas do modelo (luz forte demais deixava tudo esbranquiçado)
      sc.add(new THREE.HemisphereLight(0xffffff, 0x8a93a8, 0.6));
      const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(2.5, 4, 5); sc.add(key);
      const fill = new THREE.DirectionalLight(0xdfe8ff, 0.3); fill.position.set(-4, 1, 3); sc.add(fill);
      const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(-1, 3, -5); sc.add(rim);
      m.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(m), ct = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      const R = Math.max(sz.x, sz.y, sz.z) * 0.66, cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);   // enquadramento justo: o modelo ocupa quase todo o ícone
      cam.position.set(ct.x, ct.y + R * 0.35, ct.z + R / Math.tan(15 * Math.PI / 180)); cam.lookAt(ct);
      r.render(sc, cam);
      let big = shrink(r.domElement, S), holo = dilate(big, 7 * S / 192, S), rimC = dilate(big, 10 * S / 192, S);
      const bb = bboxAlpha(rimC);   // centraliza o adesivo inteiro (borda incluída) no meio da imagem -> fica no meio do slot
      if (bb) { const dx = Math.round(S / 2 - (bb.x0 + bb.x1) / 2), dy = Math.round(S / 2 - (bb.y0 + bb.y1) / 2); if (dx || dy) { big = shifted(big, dx, dy); holo = shifted(holo, dx, dy); rimC = shifted(rimC, dx, dy); } }
      const art = shrink(big, T), holoT = shrink(holo, T), rimT = shrink(rimC, T);
      icons[k] = art.toDataURL('image/png');
      stickers[k] = { art: icons[k], holo: holoT.toDataURL('image/png'), rim: rimT.toDataURL('image/png'), flat: bakeSticker(rimT, holoT, art, T), sp: sparklePoints(rimC, 3) };
      ['art', 'holo', 'rim', 'flat'].map(n => stickers[k][n]).forEach(u => { const im = new Image(); im.src = u; if (im.decode) im.decode().catch(() => { }); (stickers[k]._warm = stickers[k]._warm || []).push(im); });   // pré-carrega: a 1ª roleta já aparece
    } catch (e) { console.warn('[itens] ícone ' + k, e); }
    if (r) { r.dispose(); try { r.forceContextLoss(); } catch (e) { } }
  }
  const orig = {};   // cópia com os materiais originais do .glb (para o ícone em alta qualidade)
  function ready(k, g, size) { orig[k] = g.scene.clone(true); tpl[k] = prepModel(g.scene, size); makeIcon(k); }

  // versão embutida (js/models/entidades/*.glb.js): funciona mesmo abrindo o jogo direto do arquivo (file://),
  // onde o navegador bloqueia a leitura do .glb
  const EMBED = { banana: 'js/models/entidades/banana.glb.js', dino: 'js/models/entidades/dinossauro.glb.js' };
  function b64ToBuf(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  function loadEmbedded(k, size) {
    const done = () => {
      const s = window.KARTEC_GLB && window.KARTEC_GLB[k];
      if (!s) { console.warn('[itens] modelo ' + k + ' não carregou; usando forma simples'); return; }
      try { new THREE.GLTFLoader().parse(b64ToBuf(s), '', g => { ready(k, g, size); delete window.KARTEC_GLB[k]; },
        e => console.warn('[itens] modelo ' + k + ' inválido', e)); } catch (e) { console.warn('[itens]', e); }
    };
    if (window.KARTEC_GLB && window.KARTEC_GLB[k]) return done();
    const sc = document.createElement('script'); sc.src = EMBED[k]; sc.async = true; sc.onload = done; sc.onerror = done; document.head.appendChild(sc);
  }
  function preload() {
    if (!THREE.GLTFLoader) return;
    [['banana', C.BANANA.SIZE], ['dino', C.DINO.SIZE]].forEach(([k, size]) => {
      if (tpl[k] || loading[k]) return; loading[k] = true;
      if (location.protocol === 'file:') return loadEmbedded(k, size);   // direto do arquivo: o .glb seria bloqueado
      try { new THREE.GLTFLoader().load(C.MODELS[k], g => ready(k, g, size), undefined, () => loadEmbedded(k, size)); }
      catch (e) { loadEmbedded(k, size); }
    });
  }
  // forma simples enquanto o .glb não chega
  function fallback(kind) {
    const g = new THREE.Group();
    if (kind === 'banana') { const m = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.18, 6, 10, Math.PI * 1.1), new THREE.MeshLambertMaterial({ color: 0xffd23f })); m.position.y = 0.7; m.rotation.x = Math.PI / 2; g.add(m); }
    else { const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 2.4), new THREE.MeshLambertMaterial({ color: 0x3ab86a })); m.position.y = 0.8; g.add(m); }
    return g;
  }
  const make = kind => tpl[kind] ? tpl[kind].clone(true) : fallback(kind);

  // ---------- caixa de item: vidro arco-íris + moldura branca + "?" flutuante ----------
  function canvasTex(N, draw) { const c = document.createElement('canvas'); c.width = c.height = N; draw(c.getContext('2d'), N); const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.encoding = THREE.sRGBEncoding; return t; }   // sRGB: cores vivas (sem ficar lavado)
  function boxTextures() {
    // vidro: arco-íris na diagonal (a textura corre devagar -> as cores passeiam pela caixa)
    const glass = canvasTex(256, (x, N) => {
      const g = x.createLinearGradient(0, 0, N, N); ['#ff5c8a', '#ffb13d', '#ffe14a', '#4cff8a', '#3dd6ff', '#7d7bff', '#ff6fd8', '#ff5c8a'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
      x.fillStyle = g; x.fillRect(0, 0, N, N);
      const v = x.createRadialGradient(N / 2, N / 2, N * 0.1, N / 2, N / 2, N * 0.75); v.addColorStop(0, 'rgba(255,255,255,.22)'); v.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = v; x.fillRect(0, 0, N, N);
    });
    glass.wrapS = glass.wrapT = THREE.RepeatWrapping;
    // moldura: borda branca arredondada + linha interna clara + reflexo no canto (o meio é transparente)
    const frame = canvasTex(256, (x, N) => {
      const rr = (p, r) => { x.beginPath(); x.moveTo(p + r, p); x.arcTo(N - p, p, N - p, N - p, r); x.arcTo(N - p, N - p, p, N - p, r); x.arcTo(p, N - p, p, p, r); x.arcTo(p, p, N - p, p, r); x.closePath(); };
      x.lineJoin = 'round';
      rr(12, 34); x.lineWidth = 12; x.strokeStyle = 'rgba(255,255,255,.85)'; x.stroke();
      rr(23, 26); x.lineWidth = 3; x.strokeStyle = 'rgba(210,240,255,.45)'; x.stroke();
      x.save(); rr(24, 24); x.clip();
      const h = x.createLinearGradient(0, 0, N * 0.6, N * 0.6); h.addColorStop(0, 'rgba(255,255,255,.55)'); h.addColorStop(0.45, 'rgba(255,255,255,.12)'); h.addColorStop(0.46, 'rgba(255,255,255,0)');
      x.fillStyle = h; x.fillRect(0, 0, N, N); x.restore();
    });
    // "?": branco grosso com contorno preto e brilho
    const q = canvasTex(256, (x, N) => {
      x.font = '900 200px "Titan One", "Arial Black", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineJoin = 'round'; x.shadowColor = 'rgba(255,255,255,.9)'; x.shadowBlur = 22;
      x.lineWidth = 22; x.strokeStyle = '#0c0c0e'; x.strokeText('?', N / 2, N / 2 + 10);
      x.shadowBlur = 0; const g = x.createLinearGradient(0, 40, 0, N - 40); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#dff3ff');
      x.fillStyle = g; x.fillText('?', N / 2, N / 2 + 10);
    });
    // vidro "branco" com degradê e reflexo: a cor é dada pelo hue que fica girando (material.color)
    const tint = canvasTex(256, (x, N) => {
      const g = x.createLinearGradient(0, 0, N, N); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#d9d9d9'); g.addColorStop(1, '#ffffff');
      x.fillStyle = g; x.fillRect(0, 0, N, N);
      const v = x.createRadialGradient(N * 0.35, N * 0.3, N * 0.05, N / 2, N / 2, N * 0.75); v.addColorStop(0, 'rgba(255,255,255,1)'); v.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = v; x.fillRect(0, 0, N, N);
    });
    // glow: brilho redondo e suave (luz somada)
    const glow = canvasTex(128, (x, N) => { const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(0.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, N, N); });
    // sombra redonda no chão
    const shadow = canvasTex(64, (x, N) => { const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2); g.addColorStop(0, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, N, N); });
    return { glass, frame, q, shadow, tint, glow };
  }
  // ---------- vidro da caixa: shader (fresnel + película iridescente + reflexo do ambiente + brilhos) ----------
  // back = true: faces de trás (desenhadas primeiro, mais fracas) -> dá profundidade de vidro de verdade
  function glassMaterial(back, shared) {
    const U = shared || { uHue: { value: 0 }, uTime: { value: 0 } };
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      transparent: true, depthWrite: false, fog: true, side: back ? THREE.BackSide : THREE.FrontSide,
      vertexShader: [
        'varying vec3 vN; varying vec3 vV; varying vec3 vP;',
        '#include <fog_pars_vertex>',
        'void main() {',
        '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
        '  vN = normalize(normalMatrix * normal); vV = -mvPosition.xyz; vP = position;',
        '  gl_Position = projectionMatrix * mvPosition;',
        '  #include <fog_vertex>',
        '}'].join('\n'),
      fragmentShader: [
        'uniform float uHue; uniform float uTime; uniform float uBack; uniform float uFade;',
        'varying vec3 vN; varying vec3 vV; varying vec3 vP;',
        '#include <fog_pars_fragment>',
        'vec3 hsv(float h, float s, float v) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }',
        'void main() {',
        '  vec3 N = normalize(vN); if (uBack > 0.5) N = -N;',
        '  vec3 V = normalize(vV); float ndv = clamp(dot(N, V), 0.0, 1.0);',
        '  float fres = pow(1.0 - ndv, 2.2);',                                                    // borda forte, centro transparente
        // película fina (bolha de sabão): a cor varia com o ângulo e com uma ondinha que passeia pela superfície
        '  float wave = sin(vP.x * 2.3 + vP.y * 1.7 + uTime * 0.9) * 0.5 + sin(vP.z * 2.9 - vP.y * 1.3 - uTime * 0.7) * 0.5;',
        '  vec3 film = hsv(fract(uHue + fres * 0.45 + wave * 0.08), 0.82, 1.0);',
        // reflexo do ambiente: céu claro em cima, chão mais escuro embaixo + dois brilhos (luz forte e luz suave)
        '  vec3 R = reflect(-V, N);',
        '  vec3 env = mix(vec3(0.42, 0.46, 0.56), vec3(1.0), smoothstep(-0.25, 0.75, R.y));',
        '  float s1 = pow(max(dot(R, normalize(vec3(-0.35, 0.75, 0.55))), 0.0), 36.0) * 1.3;',
        '  float s2 = pow(max(dot(R, normalize(vec3(0.6, 0.35, 0.7))), 0.0), 10.0) * 0.3;',
        '  float rim = pow(1.0 - ndv, 7.0);',
        '  float spec = s1 + s2;',
        '  vec3 col = film * (0.22 + 0.78 * fres) + env * fres * 0.45 + vec3(spec) + vec3(rim * 0.9);',
        '  float a = 0.05 + fres * 0.62 + spec * 0.8 + rim * 0.5;',
        '  if (uBack > 0.5) { a *= 0.45; col *= 0.85; }',
        '  gl_FragColor = vec4(col, clamp(a, 0.0, 0.92) * uFade);',
        '  #include <fog_fragment>',
        '}'].join('\n')
    });
    m.uniforms.uHue = U.uHue; m.uniforms.uTime = U.uTime; m.uniforms.uBack = { value: back ? 1 : 0 }; m.uniforms.uFade = { value: 1 };
    m.userData.U = U; return m;
  }
  // ---------- glow da caixa: plano virado para a câmera, COM teste de profundidade (chão/árvores tampam) e que some
  // suavemente perto do chão (sem corte reto onde o brilho encosta no solo). Luz somada (aditiva).
  function glowMaterial(ground) {
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 0.7 }, uGround: { value: ground } },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; varying float vY; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; uniform float uGround; varying vec2 vUv; varying float vY;' +
        'void main() { float d = length(vUv - 0.5) * 2.0; float a = exp(-d * d * 3.2) * (1.0 - smoothstep(0.75, 1.0, d));' +
        ' a *= smoothstep(uGround + 0.05, uGround + 1.6, vY);' +        // some perto do chão
        ' gl_FragColor = vec4(uColor * a * uOpacity, a * uOpacity); }'
    });
    return m;
  }
  const _camQ = new THREE.Quaternion();
  // nós da pista para as fileiras: espalhados por igual, longe de largada/pontes/rampas/plataformas, de preferência em reta
  function rowNodes(tr, def) {
    const N = tr.N, T = tr.T, busy = new Uint8Array(N), mark = (c, r) => { for (let d = -r; d <= r; d++) busy[((c + d) % N + N) % N] = 1; };
    const st = def.startIdx != null ? def.startIdx : (tr.startIdx || 0);
    mark(st, Math.round(N * 0.05)); (def.bridges || []).forEach(b => mark(b, 22)); (def.pads || []).forEach(p => mark(p[0], 8)); (def.ramps || []).forEach(p => mark(p[0], 14));
    const curv = i => { const a = T[(i - 4 + N) % N], b = T[(i + 4) % N]; return Math.abs(Math.atan2(Math.sin(Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z)), Math.cos(Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z)))) / 8; };
    const out = [], R = C.ROW_COUNT, win = Math.round(N / R * 0.3);
    for (let k = 0; k < R; k++) {
      const base = st + Math.round((k + 0.55) / R * N); let pick = -1, best = 1e9;
      for (let o = -win; o <= win; o++) { const i = ((base + o) % N + N) % N; if (busy[i]) continue; const sc = curv(i) * 400 + Math.abs(o) * 0.05; if (sc < best) { best = sc; pick = i; } }
      if (pick >= 0) out.push(pick);
    }
    return out;
  }

  // ---------- HUD do item: slot quadrado grande abaixo da placa da volta (o FPS fica embaixo dele) ----------
  // ---------- giro só do modelo (a câmera segue k.ang, que não muda) ----------
  // O giro entra no último passo antes de desenhar (updateMatrix do objeto do kart), DEPOIS de tudo que o kart.js faz
  // no quadro; assim nada desfaz o giro e nenhuma peça do modelo é mexida.
  const _wp = new THREE.Vector3(), _rm = new THREE.Matrix4();
  function count(o) { let n = 0; o.traverse(() => n++); return n; }
  function near(o, k, r) { o.getWorldPosition(_wp); return Math.hypot(_wp.x - k.pos.x, _wp.z - k.pos.z) <= r; }
  function kartRoot(k, scene) {
    if (k._spinRoot && k._spinRoot.parent) return k._spinRoot;
    if (k.m && k.m.group && k.m.group.isObject3D) return (k._spinRoot = k.m.group);   // modelo do kart (kart.js: this.m.group)
    const cand = [], seen = new Set(), add = v => { if (v && v.isObject3D && !v.isScene && !v.isCamera && !v.isLight && v.parent && !seen.has(v)) { seen.add(v); cand.push(v); } };
    // 1) propriedades do kart (e um nível dentro delas: k.view.mesh etc.)
    for (const key in k) { const v = k[key]; if (!v || typeof v !== 'object' || key === '_spinRoot') continue; add(v);
      if (!v.isObject3D && !Array.isArray(v)) for (const k2 in v) { const w = v[k2]; if (w && w.isObject3D) add(w); } }
    // 2) objetos da cena perto do kart
    if (scene) scene.children.forEach(o => { add(o); o.children.forEach(add); });
    let best = null, bestN = 0;
    cand.forEach(o => { if (o === Items.group || !o.children.length || !near(o, k, 2)) return; const n = count(o); if (n > bestN) { best = o; bestN = n; } });
    // sobe enquanto o pai ainda está no mesmo lugar e é só do kart (pega o objeto mais de fora do kart)
    while (best && best.parent && !best.parent.isScene && best.parent !== Items.group && near(best.parent, k, 2) && count(best.parent) < bestN * 3) { best = best.parent; bestN = count(best); }
    return (k._spinRoot = best);
  }
  function hookSpin(o) {
    if (o._spinHooked) return o; o._spinHooked = true; o._spinY = 0; o._spinM = null;
    const orig = o.updateMatrix;
    o.updateMatrix = function () { orig.call(this); if (this._spinM) { this.matrix.multiply(this._spinM); this.matrixWorldNeedsUpdate = true; } };
    return o;
  }
  // ---------- motion blur do giro: rastro de cópias transparentes do kart, presas ao próprio kart ----------
  function makeGhosts(root) {
    root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), list = [], mats = [];
    for (let g = 1; g <= C.BLUR.GHOSTS; g++) {
      const grp = new THREE.Group(); grp.name = 'spinGhost'; grp.userData.noOutline = true; grp.userData.ghostI = g;
      root.traverse(o => {
        if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || !o.visible || o.userData.isOutline || o.name === 'spinGhost') return;
        let hidden = false; for (let p = o.parent; p && p !== root; p = p.parent) if (!p.visible || p.name === 'spinGhost') hidden = true; if (hidden) return;
        const ms = (Array.isArray(o.material) ? o.material : [o.material]); if (ms.some(m => m.side === THREE.BackSide)) return;   // pula contornos do toon
        const nm = ms.map(m => { const c = m.clone(); c.transparent = true; c.depthWrite = false; c.opacity = 0; mats.push(c); return c; });
        const gm = new THREE.Mesh(o.geometry, Array.isArray(o.material) ? nm : nm[0]); gm.matrixAutoUpdate = false;
        gm.matrix.multiplyMatrices(inv, o.matrixWorld); gm.castShadow = gm.receiveShadow = false; gm.userData.noOutline = true; grp.add(gm);
      });
      root.add(grp); list.push(grp);
    }
    return { list, mats };
  }
  function updateGhosts(k, w) {   // w = velocidade do giro (rad/s)
    const G = k._ghosts; if (!G) return; const B = C.BLUR, spread = Math.min(Math.abs(w) / 60 * B.SHUTTER, 3.2), str = Math.min(1, Math.abs(w) / 25);
    G.list.forEach(grp => { const i = grp.userData.ghostI; grp.rotation.y = -k.spinDir * spread * i / B.GHOSTS; grp.visible = str > 0.04;
      const op = B.OPACITY * str * (1 - (i - 1) / B.GHOSTS); grp.children.forEach(m => (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => mm.opacity = op)); });
  }
  function clearGhosts(k) { const G = k._ghosts; if (!G) return; G.list.forEach(g => g.parent && g.parent.remove(g)); G.mats.forEach(m => m.dispose()); k._ghosts = null; }
  const spinning = new Set();

  // ---------- fumaça do giro (js/smoke.js) ----------
  function fxInit() { }   // a fumaça é iniciada pelo Fx.init (kart.js), junto com o resto das partículas
  function puff(x, y, z, vx, vy, vz, size, life) {
    if (window.Smoke) Smoke.puff({ x, y, z, vx, vy, vz, size, life: life || C.SMOKE.LIFE });
  }
  function fxUpdate() { }   // e atualizada pelo Fx.step (kart.js)
  function spinSmoke(k, w, dt) {   // w = velocidade do giro (rad/s): mais rápido = mais fumaça
    const n = C.SMOKE.RATE * Math.min(1, Math.abs(w) / 30) * dt; k._smokeAcc = (k._smokeAcc || 0) + n;
    const a0 = (k.ang || 0) + (k._spinObj ? k._spinObj._spinY : 0);
    while (k._smokeAcc >= 1) { k._smokeAcc -= 1;
      // sai das rodas de trás (que giram junto com o kart) e é jogada para fora pelo giro
      const side = Math.random() < 0.5 ? -1 : 1, fx = Math.sin(a0), fz = Math.cos(a0), rx = fz, rz = -fx;
      const px = k.pos.x - fx * 1.0 + rx * side * 0.8, pz = k.pos.z - fz * 1.0 + rz * side * 0.8;
      const ox = px - k.pos.x, oz = pz - k.pos.z, L = Math.hypot(ox, oz) || 1, tan = k.spinDir * Math.min(6, Math.abs(w) * 0.12);
      puff(px, k.pos.y + 0.3, pz, ox / L * 2.2 - oz / L * tan + (k.slideX || 0) * 0.5, 0.4 + Math.random() * 0.6, oz / L * 2.2 + ox / L * tan + (k.slideZ || 0) * 0.5,
        C.SMOKE.SIZE * (0.8 + Math.random() * 0.5)); }
  }
  // pose extra do modelo durante o giro: a = giro (rad), h = pulo (m), rx/rz = inclinação (rad), sq = amassado (+ achata, - estica)
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _sv = new THREE.Vector3();
  function setSpin(k, a, h, rx, rz, sq) {
    const o = k._spinObj; if (!o) return;
    if (!a && !h && !rx && !rz && !sq) o._spinM = null;
    else { const sy = 1 - (sq || 0), sxz = 1 / Math.sqrt(Math.max(0.3, sy));   // mantém o volume ao amassar
      // ordem: sobe -> inclina (no eixo do kart, que fica fixo) -> gira
      o._spinM = (o._spinM || new THREE.Matrix4()).compose(_v.set(0, h || 0, 0), _q.setFromEuler(_e.set(rx || 0, 0, rz || 0, 'XYZ')), _sv.set(1, 1, 1))
        .multiply(_rm.compose(_v.set(0, 0, 0), _q.setFromEuler(_e.set(0, a || 0, 0)), _sv.set(sxz, sy, sxz))); }
    o._spinY = a || 0; if (!o.matrixAutoUpdate) o.updateMatrix();
  }

  // ---------- HUD do item ----------
  let slotDrop = null, tearT1 = 0, tearT2 = 0, tearT3 = 0, slotName = null, slotCards = null, slot = null, slotSw = null, slotIcon = null, slotTilt = null, slotKey = null, slotK = '';
  function ensureHud() {
    if (slot || !document.body) return;
    const st = document.createElement('style');
    // SLOT = item embalado num saquinho plástico pendurado por um cartão de papel (como as embalagens de brinquedo de vinil):
    //  * cartão no topo com furo para pendurar, nome do item e uma linha técnica;
    //  * saco transparente com vincos, reflexos, textura de bolinhas, selagem serrilhada embaixo e um brilho que passa;
    //  * o adesivo holográfico fica DENTRO do saco (levemente torto, com os reflexos do plástico por cima);
    //  * etiqueta laranja num canto; o pacote balança pendurado quando o item chega.
    const RAIN = '#8fe3ff,#c6a9ff,#ff9fd8,#ffe28f,#9cf5c8,#7fd2ff,#d3b0ff,#ffb0e0,#8fe3ff', G = glitter();
    // vincos e reflexos do plástico (SVG esticado no tamanho do saco)
    const wr = (d, w, o, c) => `<path d='${d}' fill='none' stroke='${c || '#fff'}' stroke-width='${w}' stroke-opacity='${o}' stroke-linecap='round'/>`;
    const lines = wr('M6 22C34 34 58 8 94 26S128 18 136 36', 3, .5) + wr('M4 66C28 56 52 84 82 70S118 56 136 76', 3.4, .45) + wr('M10 108C40 96 66 122 98 106S124 98 134 116', 3, .4) +
      wr('M30 2C40 40 18 70 44 130', 2.2, .3) + wr('M104 2C96 46 122 80 100 130', 2.2, .28) + wr('M20 40L62 58', 1.6, .35) + wr('M84 88L126 96', 1.6, .3);
    const creases = wr('M31 3C41 41 19 71 45 131', 1, .22, '#0a1020') + wr('M7 67C29 57 53 85 83 71', 1, .18, '#0a1020') + wr('M105 3C97 47 123 81 101 131', 1, .18, '#0a1020');
    const WR = 'data:image/svg+xml;utf8,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 140 132' preserveAspectRatio='none'><defs><filter id='b'><feGaussianBlur stdDeviation='2.2'/></filter>" +
      "<linearGradient id='s' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#fff' stop-opacity='.28'/><stop offset='.5' stop-color='#fff' stop-opacity='0'/><stop offset='1' stop-color='#fff' stop-opacity='.16'/></linearGradient></defs>" +
      "<rect width='140' height='132' fill='url(#s)'/><polygon points='0,0 46,0 18,132 0,132' fill='#fff' fill-opacity='.07'/><polygon points='92,0 120,0 140,40 140,90' fill='#fff' fill-opacity='.06'/>" +
      "<g filter='url(#b)'>" + lines + "</g>" + lines.replace(/stroke-width='[\d.]+'/g, "stroke-width='.8'") + creases + "</svg>");
    // contorno do saco: lados levemente ondulados, cantos de baixo com selagem
    const JAG = [[90, 84], [82, 78.5], [73, 85], [64, 78], [55, 83.5], [46, 77], [37, 84], [28, 78.5], [19, 85], [10, 78]];
    const TOP = '1.5% 0,98.5% 0,99.5% 12%,98.6% 30%,99.8% 52%,98.8% 74%,', LEFT = ',1.2% 74%,0.2% 52%,1.4% 30%,0.4% 12%';
    // rasgo: linha serrilhada a ~80% da altura do saco. Saco inteiro e saco rasgado têm os MESMOS pontos (o fechamento anima)
    const HOLE = 'data:image/svg+xml;utf8,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 7' preserveAspectRatio='none'><rect width='24' height='7' rx='3.5' fill='#000'/></svg>");
    const BAG = 'polygon(' + TOP + '100% 92%,100% 100%,' + JAG.map(p => p[0] + '% 100%').join(',') + ',0 100%,0 92%' + LEFT + ')';
    const TORN = 'polygon(' + TOP + '99.2% 79%,98% 82%,' + JAG.map(p => p[0] + '% ' + p[1] + '%').join(',') + ',1% 81%,1.2% 76%' + LEFT + ')';
    const SY = y => ((y - 74) / 26 * 100).toFixed(1) + '%';   // a tira de baixo vai de 74% a 100% do saco
    const STRIP = 'polygon(0 ' + SY(81) + ',' + JAG.slice().reverse().map(p => p[0] + '% ' + SY(p[1])).join(',') + ',98% ' + SY(82) + ',100% ' + SY(79) + ',100% 100%,0 100%)';
    st.textContent =
      '#itemSlot{z-index:2;--k:1;--w:calc(140px * var(--k));--hh:calc(36px * var(--k));--bh:calc(132px * var(--k));--ic:calc(124px * var(--k));position:relative;width:var(--w);height:calc(var(--hh) + var(--bh) - 6px * var(--k));flex:none;pointer-events:auto;cursor:pointer;user-select:none;-webkit-user-select:none;display:none}' +
      '#itemSlot.on{display:block}' +
      '#itemSlot .sw{position:absolute;inset:0}' +   // recebe a mesma transformação da placa da volta
      '#itemSlot .pk{position:absolute;inset:0;transform-origin:50% calc(8px * var(--k))}' +   // o pacote (balança pelo furo)
      '#itemSlot.pop .pk{animation:bagSwing 1.1s cubic-bezier(.3,.6,.4,1)}' +
      '@keyframes bagSwing{0%{rotate:0deg;scale:.94}12%{rotate:7deg;scale:1.04}30%{rotate:-5deg;scale:1}50%{rotate:3deg}70%{rotate:-1.5deg}100%{rotate:0deg}}' +
      // brilho atrás do pacote (com item / na roleta)
      '#itemSlot .glow{position:absolute;left:-8%;right:-8%;top:calc(var(--hh) - 4px);bottom:-6%;border-radius:24px;opacity:0;transition:opacity .25s;background:radial-gradient(closest-side,rgba(170,220,255,.6),rgba(170,220,255,0));filter:blur(6px)}' +
      '#itemSlot.has .glow{opacity:.6;animation:slotGlow 1.8s ease-in-out infinite}#itemSlot.roll .glow{opacity:.85;background:radial-gradient(closest-side,hsla(var(--rh,0),95%,70%,.7),hsla(var(--rh,0),95%,70%,0))}' +
      // ---- saco plástico ----
      '#itemSlot .bag{position:absolute;left:0;right:0;top:calc(var(--hh) - 6px * var(--k));height:var(--bh);clip-path:' + BAG + ';transition:clip-path .38s cubic-bezier(.3,1.25,.5,1);overflow:hidden;' +
        'background:linear-gradient(180deg,rgba(225,235,250,.20),rgba(190,205,230,.10) 40%,rgba(160,175,205,.16)),rgba(18,22,34,.30);-webkit-backdrop-filter:blur(1.2px) saturate(1.15);backdrop-filter:blur(1.2px) saturate(1.15);' +
        'box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.35),inset 0 0 14px rgba(255,255,255,.12)}' +
      // textura de bolinhas do plástico (como o saquinho do chaveiro)
      '#itemSlot .dots{position:absolute;inset:0;opacity:.5;background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.22) 0 1.1px,rgba(255,255,255,0) 1.6px) var(--dx,0px) var(--dy,0px)/7px 7px,radial-gradient(circle at 50% 50%,rgba(255,255,255,.12) 0 1.1px,rgba(255,255,255,0) 1.6px) calc(3.5px + var(--dx,0px)) calc(3.5px + var(--dy,0px))/7px 7px;' +
        '-webkit-mask-image:radial-gradient(ellipse 70% 60% at 45% 45%,#000,rgba(0,0,0,.25));mask-image:radial-gradient(ellipse 70% 60% at 45% 45%,#000,rgba(0,0,0,.25))}' +
      // vincos/reflexos por CIMA do adesivo (é isso que faz o item parecer estar dentro do plástico)
      '#itemSlot .film{position:absolute;inset:-12%;background:url("' + WR + '") center/100% 100% no-repeat;mix-blend-mode:screen;opacity:.6;pointer-events:none;transform:translate(var(--fx,0px),var(--fy,0px)) scale(var(--fs,1))}' +
      // selagem serrilhada embaixo + costura nas laterais
      '#itemSlot .seal{position:absolute;left:0;right:0;bottom:0;height:calc(10px * var(--k));border-top:1px solid rgba(255,255,255,.35);background:repeating-linear-gradient(90deg,rgba(255,255,255,.42) 0 1.5px,rgba(255,255,255,.08) 1.5px 3.5px),rgba(255,255,255,.1)}' +
      '#itemSlot .seam{position:absolute;top:0;bottom:calc(10px * var(--k));width:calc(5px * var(--k));background:repeating-linear-gradient(180deg,rgba(255,255,255,.3) 0 1.5px,rgba(255,255,255,.06) 1.5px 3.5px)}#itemSlot .seam.l{left:0}#itemSlot .seam.r{right:0}' +
      // ---- cartão de papel ----
      '#itemSlot .hdrs{position:absolute;left:-2%;right:-2%;top:0;height:var(--hh);border-radius:3px 3px 2px 2px;box-shadow:0 2px 0 rgba(0,0,0,.18),0 4px 8px rgba(0,0,0,.25)}' +
      '#itemSlot .hdr{position:absolute;left:-2%;right:-2%;top:0;height:var(--hh);background:linear-gradient(180deg,#f2f5f3,#dfe6e3);border-radius:3px 3px 2px 2px;' +
        '-webkit-mask:url("' + HOLE + '") 50% calc(4px * var(--k))/calc(24px * var(--k)) calc(7px * var(--k)) no-repeat,linear-gradient(#000 0 0);-webkit-mask-composite:xor;' +
        'mask:url("' + HOLE + '") 50% calc(4px * var(--k))/calc(24px * var(--k)) calc(7px * var(--k)) no-repeat exclude,linear-gradient(#000 0 0);' +
        'box-shadow:inset 0 -1px 0 rgba(0,0,0,.12);color:#1b1f24;font-family:ui-monospace,"Cascadia Mono","Consolas","Courier New",monospace;overflow:hidden}' +
      '#itemSlot .hdr::after{content:"";position:absolute;inset:0;opacity:.35;background:repeating-linear-gradient(0deg,rgba(0,0,0,.025) 0 1px,rgba(0,0,0,0) 1px 3px)}' +   // textura de papel
      '#itemSlot .hole{position:absolute;left:50%;top:calc(4px * var(--k) - 1.5px);width:calc(24px * var(--k) + 3px);height:calc(7px * var(--k) + 3px);margin-left:calc(-12px * var(--k) - 1.5px);border-radius:9px;border:1.5px solid rgba(0,0,0,.2);box-sizing:border-box}' +   // borda do furo (o miolo é transparente de verdade)
      '#itemSlot .nm{position:absolute;left:calc(6px * var(--k));right:calc(6px * var(--k));top:calc(14px * var(--k));text-align:center;font-weight:800;font-size:calc(14px * var(--k));letter-spacing:.08em;line-height:1.1;white-space:nowrap;overflow:hidden}' +
      // ---- adesivo dentro do saco ----
      '#itemSlot .isIc{position:absolute;left:calc((var(--w) - var(--ic)) / 2);top:calc((var(--bh) - var(--ic)) / 2 - 3px * var(--k));width:var(--ic);height:var(--ic);opacity:0}#itemSlot .isIc.v{opacity:1}' +
      '#itemSlot .isIc.land{animation:icLand .38s cubic-bezier(.3,1.4,.5,1)}' +
      '@keyframes icLand{0%{transform:translateY(-34%) scaleY(1.12)}60%{transform:translateY(5%) scaleY(.94)}100%{transform:none}}' +
      // carrossel da roleta (dentro do saco)
      '#itemSlot .reel{position:absolute;inset:0;opacity:0;pointer-events:none}#itemSlot.roll .reel{opacity:1}' +
      '#itemSlot .isCard{position:absolute;left:50%;top:50%;width:calc(var(--ic) * .9);height:calc(var(--ic) * .9);margin:calc(var(--ic) * -.45) 0 0 calc(var(--ic) * -.45);background:center/100% 100% no-repeat;will-change:transform;filter:drop-shadow(0 4px 0 rgba(10,12,30,.4))}' +
      '#itemSlot .tl{position:relative;width:100%;height:100%;filter:drop-shadow(0 5px 0 rgba(10,12,30,.45)) drop-shadow(0 0 1.5px rgba(10,12,30,.6))}' +
      '#itemSlot .tl>i{position:absolute;inset:0;-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}' +
      // borda: purpurina prateada (como a borda do adesivo da referência)
      '#itemSlot .rim{-webkit-mask-image:var(--rim);mask-image:var(--rim);background:linear-gradient(160deg,#fff,#eef2ff 60%,#dfe6f7)}' +
      '#itemSlot .holo{-webkit-mask-image:var(--holo);mask-image:var(--holo);background:' +
        'radial-gradient(circle at var(--gx) var(--gy),rgba(255,255,255,.8),rgba(255,255,255,0) 38%),' +
        'conic-gradient(rgba(255,255,255,.55) 0 25%,rgba(40,70,190,.10) 0 50%,rgba(255,255,255,.55) 0 75%,rgba(40,70,190,.10) 0) var(--cx) var(--cy)/10px 10px,' +
        'repeating-linear-gradient(var(--pa),rgba(255,255,255,0) 0 6px,rgba(110,160,255,.3) 6px 9px,rgba(255,140,220,.25) 9px 12px),' +
        'linear-gradient(var(--ha),' + RAIN + ') var(--hx) var(--hy)/320% 320%}' +
      '#itemSlot .art{background:var(--art) center/100% 100% no-repeat}' +
      // estrelinhas de brilho que acendem e apagam pela borda
      // flares: estrela de luz que acende rápido, cresce com os raios girando um pouquinho e apaga (reflexo de luz no adesivo)
      '#itemSlot .spk{position:absolute;width:70%;height:70%;margin:-35% 0 0 -35%;background:url("' + G.star + '") center/contain no-repeat;mix-blend-mode:screen;opacity:0;transform:scale(.2);animation:spk 2.4s cubic-bezier(.2,.7,.3,1) infinite;pointer-events:none}' +
      '@keyframes spk{0%{opacity:0;transform:scale(.2) rotate(-8deg)}6%{opacity:1;transform:scale(1.05) rotate(0)}14%{opacity:.9;transform:scale(.85) rotate(4deg)}24%{opacity:0;transform:scale(.6) rotate(8deg)}100%{opacity:0;transform:scale(.2) rotate(8deg)}}' +
      '@media (prefers-reduced-motion:reduce){#itemSlot .spk{animation:none}}' +
      '#itemSlot .foil{-webkit-mask-image:var(--art);mask-image:var(--art);mix-blend-mode:soft-light;opacity:.14;background:' +
        'conic-gradient(rgba(255,255,255,.5) 0 25%,rgba(255,255,255,0) 0 50%,rgba(255,255,255,.5) 0 75%,rgba(255,255,255,0) 0) var(--cx) var(--cy)/10px 10px,' +
        'linear-gradient(var(--ha),' + RAIN + ') var(--hx) var(--hy)/320% 320%}' +
      '#itemSlot .gl{-webkit-mask-image:var(--holo);mask-image:var(--holo);background:linear-gradient(var(--sa),rgba(255,255,255,0) 35%,rgba(255,255,255,.75) 48%,rgba(255,255,255,0) 60%) var(--sx) 0/260% 100% no-repeat;mix-blend-mode:screen}' +
      '#itemSlot .key{position:absolute;right:calc(-7px * var(--k));bottom:calc(-7px * var(--k));min-width:calc(26px * var(--k));height:calc(26px * var(--k));line-height:calc(26px * var(--k));text-align:center;font:800 calc(14px * var(--k)) var(--ui,sans-serif);color:#16171b;background:linear-gradient(180deg,#fff,#d9dbe8);border-radius:8px;box-shadow:0 3px 0 rgba(0,0,0,.45);opacity:0;transform:scale(.6);transition:opacity .15s,transform .2s cubic-bezier(.3,1.6,.5,1)}' +
      '#itemSlot.has .key{opacity:1;transform:scale(1)}' +
      '@keyframes slotGlow{0%,100%{opacity:.4}50%{opacity:.75}}' +
      // ---- usar o item (tecla E): o saco RASGA por baixo, a tira cai, o item cai pelo rasgo; depois o saco fecha de novo ----
      '#itemSlot.tear .bag{clip-path:' + TORN + ';transition:none}' +
      '#itemSlot.tear .pk{animation:bagJolt .45s cubic-bezier(.3,.7,.4,1)}' +
      '@keyframes bagJolt{0%{rotate:0deg;translate:0 0}15%{rotate:-4deg;translate:0 calc(5px * var(--k))}40%{rotate:3deg;translate:0 calc(-2px * var(--k))}70%{rotate:-1deg}100%{rotate:0deg;translate:0 0}}' +
      // tira de baixo (com a selagem) que se solta e cai girando
      '#itemSlot .strip{position:absolute;left:0;right:0;top:calc(var(--hh) - 6px * var(--k) + var(--bh) * .74);height:calc(var(--bh) * .26);clip-path:' + STRIP + ';opacity:0;pointer-events:none;' +
        'background:linear-gradient(180deg,rgba(190,205,230,.22),rgba(160,175,205,.26)),rgba(18,22,34,.3);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.35)}' +
      '#itemSlot .strip::after{content:"";position:absolute;left:0;right:0;bottom:0;height:calc(10px * var(--k));border-top:1px solid rgba(255,255,255,.35);background:repeating-linear-gradient(90deg,rgba(255,255,255,.42) 0 1.5px,rgba(255,255,255,.08) 1.5px 3.5px),rgba(255,255,255,.1)}' +
      '#itemSlot.falling .strip{animation:stripFall .75s cubic-bezier(.5,0,.9,.6) forwards,fadeOut .75s linear forwards}' +
      '@keyframes stripFall{from{transform:none}to{transform:translate(calc(-14px * var(--k)),calc(95px * var(--k))) rotate(-28deg)}}' +
      '@keyframes fadeOut{from{opacity:1}to{opacity:0}}' +
      // o item cai pelo rasgo: um movimento só (gravidade) + fade contínuo
      '#itemSlot .drop{position:absolute;left:calc((var(--w) - var(--ic)) / 2);top:calc(var(--hh) - 6px * var(--k) + (var(--bh) - var(--ic)) / 2 - 3px * var(--k));width:var(--ic);height:var(--ic);background:center/100% 100% no-repeat;opacity:0;pointer-events:none;filter:drop-shadow(0 5px 0 rgba(10,12,30,.4))}' +
      '#itemSlot.falling .drop{animation:icDrop .9s cubic-bezier(.45,0,.9,.55) forwards,fadeOut .9s linear forwards}' +
      '@keyframes icDrop{from{transform:none}to{transform:translateY(calc(210px * var(--k))) rotate(20deg) scale(.92)}}' +
      // pedacinhos de plástico voando do rasgo
      '#itemSlot .bits{position:absolute;left:0;right:0;top:calc(var(--hh) - 6px * var(--k) + var(--bh) * .8);height:0;pointer-events:none}' +
      '#itemSlot .bits i{position:absolute;top:0;width:calc(6px * var(--k));height:calc(3px * var(--k));background:rgba(235,242,255,.85);border-radius:1px;opacity:0}' +
      '#itemSlot.falling .bits i{animation:bit .6s cubic-bezier(.3,.6,.6,1) forwards,fadeOut .6s linear forwards}' +
      '@keyframes bit{from{transform:none}to{transform:translate(var(--bx),var(--by)) rotate(var(--br))}}' +
      // fechando de novo: a selagem brilha passando como um zíper
      '#itemSlot .zip{position:absolute;left:0;right:0;bottom:0;height:calc(12px * var(--k));opacity:0;background:linear-gradient(90deg,rgba(255,255,255,0) 0,rgba(255,255,255,.95) 10%,rgba(190,235,255,.6) 16%,rgba(255,255,255,0) 22%) 0 0/250% 100% no-repeat;mix-blend-mode:screen}' +
      '#itemSlot.reseal .zip{animation:zip .5s ease-out forwards}' +
      '@keyframes zip{0%{opacity:1;background-position:120% 0}85%{opacity:1}100%{opacity:0;background-position:-40% 0}}' +
      '@media (max-width:760px),(max-height:520px){#itemSlot{--k:.76}}' +
      '@media (prefers-reduced-motion:reduce){#itemSlot .glow,#itemSlot.pop .pk,#itemSlot.tear .pk{animation:none}}';
    document.head.appendChild(st);
    slot = document.createElement('div'); slot.id = 'itemSlot'; slot.setAttribute('role', 'img'); slot.setAttribute('aria-label', 'Item atual (tecla E)');
    slot.innerHTML = '<div class="sw"><div class="pk"><div class="glow"></div>' +
      '<div class="bag"><div class="dots"></div>' +
        '<div class="reel"><div class="isCard"></div><div class="isCard"></div></div>' +
        '<div class="isIc"><div class="tl"><i class="rim"></i><i class="holo"></i><i class="art"></i><i class="foil"></i><i class="gl"></i><b class="spk"></b><b class="spk"></b><b class="spk"></b></div></div>' +
        '<div class="film"></div><div class="seam l"></div><div class="seam r"></div><div class="seal"></div><div class="zip"></div></div>' +
      '<div class="strip"></div><div class="drop"></div><div class="bits">' + [[-30, 40, 120], [-12, 55, -90], [6, 48, 200], [22, 60, -160], [38, 42, 80]].map((b, i) => '<i style="left:' + (20 + i * 15) + '%;--bx:' + b[0] + 'px;--by:' + b[1] + 'px;--br:' + b[2] + 'deg"></i>').join('') + '</div>' +
      '<div class="hdrs"></div><div class="hdr"><div class="hole"></div><div class="nm"></div></div>' +
      '<div class="key">E</div></div></div>';
    slotSw = slot.firstChild; slotIcon = slot.querySelector('.isIc'); slotCards = slot.querySelectorAll('.isCard'); slotTilt = slotIcon.firstChild; slotKey = slot.querySelector('.key'); slotName = slot.querySelector('.nm'); slotDrop = slot.querySelector('.drop');
    ['.strip', '.drop', '.bits'].forEach(q => { const e = slot.querySelector(q); if (e) slotSw.appendChild(e); });   // peças que caem ficam fora do pacote (o tranco não mexe nelas)
    slot.addEventListener('pointerdown', e => { Items.wantUse = true; e.preventDefault(); });
    mountSlot();
  }
  // usou o item: o saco rasga por baixo, a tira cai, o adesivo cai pelo rasgo; depois o saco fecha de novo
  // usou o item: o saco rasga por baixo, a tira cai, o adesivo cai pelo rasgo; depois o saco fecha de novo
  function tearBag(kind) {
    if (!slot || !slot.classList.contains('on')) return;
    const stk = stickers[kind]; if (slotDrop) slotDrop.style.backgroundImage = stk ? 'url(' + stk.flat + ')' : 'none';
    clearTimeout(tearT1); clearTimeout(tearT2); clearTimeout(tearT3);
    slot.classList.remove('tear', 'reseal', 'pop', 'falling'); void slot.offsetWidth; slot.classList.add('tear', 'falling');
    tearT3 = setTimeout(() => slot.classList.remove('falling'), 1000);   // a queda tem o próprio tempo (não é cortada quando o saco fecha)
    tearT1 = setTimeout(() => { slot.classList.remove('tear'); void slot.offsetWidth; slot.classList.add('reseal'); }, 720);   // fecha (o saco "cresce" de volta)
    tearT2 = setTimeout(() => slot.classList.remove('reseal'), 1300);
  }
  // coloca o slot logo depois da placa da volta, dentro da coluna dela (o FPS do settings.js fica depois do slot)
  function mountSlot() {
    const lap = document.getElementById('lap'), col = lap && lap.parentElement;
    if (col) { if (slot.previousElementSibling !== lap || slot.parentElement !== col) lap.after(slot); }
    else if (!slot.parentElement) document.body.appendChild(slot);
  }

  const Items = {
    on: false, wantUse: false, group: null, boxes: [], bananas: [], t: 0, scene: null, tr: null,
    CFG: ITEMS_CFG,
    preload,

    // chamado em Game.load (depois de a cena existir). enabled=false no online.
    build(scene, tr, def, opts) {
      this.dispose(); ensureHud(); this.on = !(opts && opts.enabled === false); if (!this.on) return;
      preload(); this.scene = scene; this.tr = tr; this.t = 0; this.wantUse = false;
      const N = tr.N, g = this.group = new THREE.Group(); scene.add(g); fxInit(g);
      const S = C.BOX_SIZE, TX = this.boxTex || (this.boxTex = boxTextures());
      this.boxGeo = window.GEO && GEO.rbox ? GEO.rbox(S, S, S, S * 0.16, 3) : new THREE.BoxGeometry(S, S, S);
      this.boxMats = []; this.glassMat = null;   // vidro: shader por caixa (glassMaterial)
      this.frameMat = new THREE.MeshBasicMaterial({ map: TX.frame, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      this.qMat = new THREE.SpriteMaterial({ map: TX.q, transparent: true, depthWrite: false });
      this.shGeo = new THREE.PlaneGeometry(S * 1.25, S * 1.25).rotateX(-Math.PI / 2); this.shMat = new THREE.MeshBasicMaterial({ map: TX.shadow, transparent: true, depthWrite: false });
      const sp = Math.max(C.BOX_SIZE * 1.25, Math.min(C.SPACING, ((tr.W || 9) - 1.8) / ((C.PER_ROW - 1) / 2)));   // cabe na largura da pista
      rowNodes(tr, def).forEach((i, r) => {
        const ang = Math.atan2(tr.T[i].x, tr.T[i].z);
        for (let c = 0; c < C.PER_ROW; c++) {
          const lat = (c - (C.PER_ROW - 1) / 2) * sp, p = tr.side(i, lat, 0), h = tr.groundAt ? tr.groundAt({ x: p.x, y: 0, z: p.z }, i, ang).h : tr.roadBase;
          const gm = glassMaterial(false), gb = glassMaterial(true, gm.userData.U), glw = glowMaterial(h);
          this.boxMats.push(gm, gb, glw);
          const m = new THREE.Group(), glass = new THREE.Mesh(this.boxGeo, gm), glassB = new THREE.Mesh(this.boxGeo, gb), frame = new THREE.Mesh(this.boxGeo, this.frameMat), q = new THREE.Sprite(this.qMat), glow = new THREE.Mesh(this.glowGeo || (this.glowGeo = new THREE.PlaneGeometry(1, 1)), glw);
          glow.onBeforeRender = (rr, sc, cam) => { cam.getWorldQuaternion(_camQ); glow.quaternion.copy(_camQ); glow.updateMatrixWorld(); };   // sempre de frente para a câmera
          glow.frustumCulled = false; glow.userData.noOutline = true;
          glow.scale.setScalar(S * 2.6); glow.renderOrder = 0; m.add(glow);
          glassB.renderOrder = 1; q.renderOrder = 2; glass.renderOrder = 3; frame.renderOrder = 4; frame.scale.setScalar(1.004); q.scale.setScalar(S * 0.8);   // trás -> "?" -> frente -> moldura
          const spin = new THREE.Group(); spin.add(glassB, glass, frame); m.add(spin, q); [glass, glassB, frame].forEach(o => { o.userData.noOutline = true; });
          const shd = new THREE.Mesh(this.shGeo, this.shMat); shd.position.set(p.x, h + 0.06, p.z); g.add(shd);
          m.position.set(p.x, h + C.BOX_FLOAT, p.z); m.userData = { y0: h + C.BOX_FLOAT, ph: r * 1.7 + c * 0.9, hue: (r * 0.21 + c * 0.25) % 1, respawn: 0, spin, q, shd, gm, glw, glow }; spin.rotation.y = c * 0.6; g.add(m); this.boxes.push(m);
        }
      });
    },
    // ---------- caixa estilhaçando: cacos de vidro voando, girando, quicando no chão e sumindo ----------
    shatter(b) {
      const u = b.userData, S = C.BOX_SIZE, hue = u.gm ? u.gm.userData.U.uHue.value : Math.random();
      if (!this.shardGeos) {   // alguns formatos de caco (triângulos irregulares, finos como vidro)
        // cacos 3D: polígono irregular (3 a 5 pontas, como vidro partido) com espessura e borda chanfrada
        this.shardGeos = [0, 1, 2, 3, 4, 5].map(k => {
          const sz = S * (0.16 + k * 0.035), pts = 3 + (k % 3), shp = new THREE.Shape();
          for (let j = 0; j < pts; j++) { const a = j / pts * Math.PI * 2 + (Math.random() - 0.5) * 0.9, rr = sz * (0.55 + Math.random() * 0.6); j ? shp.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 1.3) : shp.moveTo(Math.cos(a) * rr, Math.sin(a) * rr * 1.3); }
          const g = new THREE.ExtrudeGeometry(shp, { depth: sz * 0.16, bevelEnabled: true, bevelThickness: sz * 0.05, bevelSize: sz * 0.06, bevelSegments: 2, curveSegments: 1 });
          g.center(); g.computeVertexNormals(); return g; });
        this.shards = [];
      }
      const pos = b.position, ground = u.y0 - C.BOX_FLOAT, n = 22;
      for (let i = 0; i < n; i++) {
        let sh = this.shards.find(o => o.l <= 0);
        if (!sh) { if (this.shards.length >= 180) sh = this.shards[0]; else {
          const m = new THREE.Mesh(this.shardGeos[this.shards.length % this.shardGeos.length], glassMaterial(false));   // mesmo vidro da caixa (fresnel, reflexo, iridescência)
          m.userData.noOutline = true; m.renderOrder = 3; this.group.add(m); sh = { m, v: new THREE.Vector3(), av: new THREE.Vector3(), l: 0, ml: 1 }; this.shards.push(sh); } }
        // nasce num ponto da superfície da caixa e voa para fora dela (um pouco para cima)
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 - 0.15, Math.random() - 0.5).normalize();
        sh.m.position.copy(pos).addScaledVector(dir, S * 0.45);
        sh.v.copy(dir).multiplyScalar(7 + Math.random() * 7); sh.v.y += 4 + Math.random() * 3;
        sh.av.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
        sh.m.rotation.set(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3); sh.m.scale.setScalar(0.6 + Math.random() * 0.8);
        sh.l = sh.ml = 0.75 + Math.random() * 0.45; sh.ground = ground; sh.m.visible = true;
        const U = sh.m.material.userData.U; U.uHue.value = (hue + (Math.random() - 0.5) * 0.14 + 1) % 1; U.uTime.value = Math.random() * 10; sh.m.material.uniforms.uFade.value = 1;
      }
      // clarão de luz no centro + faíscas
      if (window.Fx && Fx.puff) { const c = new THREE.Color().setHSL(hue, 1, 0.7).getHex(); Fx.puff('glow', pos.x, pos.y, pos.z, 0, 0, 0, 0xffffff, S * 1.0, S * 2.6, 0.22, 0.9); Fx.puff('glow', pos.x, pos.y, pos.z, 0, 0, 0, c, S * 1.4, S * 3.4, 0.35, 0.7); }
      for (let k = 0; k < 12; k++) Fx.spark(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 14, 2 + Math.random() * 7, (Math.random() - 0.5) * 14, k % 3 ? 0xffffff : new THREE.Color().setHSL(hue, 1, 0.65).getHex(), 0.24, 0.5);
    },
    shardStep(dt) {
      if (!this.shards) return;
      this.shards.forEach(sh => { if (sh.l <= 0) return; sh.l -= dt; if (sh.l <= 0) { sh.m.visible = false; return; }
        sh.v.y -= 20 * dt; sh.v.multiplyScalar(Math.max(0, 1 - 0.8 * dt)); sh.m.position.addScaledVector(sh.v, dt);
        if (sh.m.position.y < sh.ground + 0.05) { sh.m.position.y = sh.ground + 0.05; sh.v.y *= -0.35; sh.v.x *= 0.6; sh.v.z *= 0.6; sh.av.multiplyScalar(0.6); }   // quica no chão
        sh.m.rotation.x += sh.av.x * dt; sh.m.rotation.y += sh.av.y * dt; sh.m.rotation.z += sh.av.z * dt;
        const t = sh.l / sh.ml; sh.m.material.uniforms.uFade.value = Math.min(1, t * 2.2); sh.m.material.userData.U.uTime.value += dt * 3;
        if (t < 0.3) sh.m.scale.multiplyScalar(Math.max(0, 1 - 2.5 * dt)); });
    },
    dispose() {
      if (this.group && this.group.parent) this.group.parent.remove(this.group);
      [this.boxGeo, this.glowGeo, this.glassMat, this.frameMat, this.qMat, this.shGeo, this.shMat].concat(this.boxMats || []).forEach(o => o && o.dispose()); this.boxMats = []; this.glowGeo = null; (this.shards || []).forEach(sh => sh.m.material.dispose()); this.shards = []; (this.shardGeos || []).forEach(g => g.dispose()); this.shardGeos = null;
      this.bananas.forEach(o => o.mesh.parent && o.mesh.parent.remove(o.mesh));
      spinning.forEach(k => { clearGhosts(k); setSpin(k, 0); k.spinT = 0; }); spinning.clear(); if (window.Smoke) Smoke.clear();
      this.group = null; this.boxes = []; this.bananas = []; this.on = false; this.scene = null;
      if (slot) slot.classList.remove('on', 'has');
    },

    // ---------- efeito de acerto ----------
    // banana: giro de 360° (o kart volta virado para onde estava) + um tempinho parado
    hit(k) {
      if (k.spinT > 0) return;
      k.spinT = C.SPIN.TIME + C.SPIN.STOP; k.spinDir = Math.random() < 0.5 ? -1 : 1;
      try { const r = kartRoot(k, this.scene); k._spinObj = r ? hookSpin(r) : null; } catch (e) { k._spinObj = null; console.warn('[itens]', e); }
      // estouro de fumaça na hora do escorregão
      for (let n = 0; n < C.SMOKE.BURST; n++) { const a = n / C.SMOKE.BURST * Math.PI * 2 + Math.random() * 0.4; puff(k.pos.x + Math.cos(a) * 1.1, k.pos.y + 0.35, k.pos.z + Math.sin(a) * 1.1, Math.cos(a) * 4.5, 0.8 + Math.random(), Math.sin(a) * 4.5, C.SMOKE.SIZE * 1.3, C.SMOKE.LIFE * 1.2); }
      clearGhosts(k); if (k._spinObj) { try { k._ghosts = makeGhosts(k._spinObj); spinning.add(k); } catch (e) { console.warn('[itens] blur', e); } }
      if (!k._spinObj) console.warn('[itens] não achei o modelo do kart para girar', Object.keys(k));
      // embalo: o kart continua deslizando na direção em que vinha
      const v = Math.max(0, k.speed || 0) * C.SPIN.KEEP; k.slideX = Math.sin(k.ang) * v; k.slideZ = Math.cos(k.ang) * v; k.speed = 0;
      k.yawV = 0; k.boostT = 0; k.drifting = false; k.driftCD = Math.max(k.driftCD || 0, C.SPIN.TIME + C.SPIN.STOP);
      k.dinoT = 0;
      for (let n = 0; n < 12; n++) Fx.spark(k.pos.x, k.pos.y + 0.8, k.pos.z, (Math.random() - 0.5) * 10, 3 + Math.random() * 5, (Math.random() - 0.5) * 10, n % 2 ? 0xffe08a : 0xffffff, 0.24, 0.45);
      if (k.isPlayer) { if (UI.Sfx && UI.Sfx.bump) try { UI.Sfx.bump(); } catch (e) { } }
    },

    // ---------- uso ----------
    use(k) {
      if (!k.item || k.itemRoll > 0) return;
      const kind = k.item; k.item = null; k.itemWait = 0;
      const tr = this.tr, fx = Math.sin(k.ang), fz = Math.cos(k.ang);
      if (kind === 'banana') {
        if (this.bananas.length >= C.BANANA.MAX) { const o = this.bananas.shift(); o.mesh.parent && o.mesh.parent.remove(o.mesh); }
        const x = k.pos.x - fx * C.BANANA.DROP_BACK, z = k.pos.z - fz * C.BANANA.DROP_BACK, h = tr.groundAt({ x, y: k.pos.y, z }, k.idx, k.ang).h;
        // a banana fica num "suporte" no chão (com a sombra); o modelo dentro dele flutua um pouquinho e gira
        const mesh = new THREE.Group(); mesh.position.set(x, h + 0.05, z); this.group.add(mesh);
        const model = make('banana'); model.rotation.y = Math.random() * 6.28; mesh.add(model);
        let sh = null; if (this.shGeo && this.shMat) { sh = new THREE.Mesh(this.shGeo, this.shMat); sh.position.y = 0.01; sh.scale.setScalar(C.BANANA.SIZE * 0.95 / C.BOX_SIZE); sh.renderOrder = -1; mesh.add(sh); }
        this.bananas.push({ mesh, model, sh, x, z, owner: k, age: 0, ph: Math.random() * 6.28 });
      } else {
        // dinossauro = turbo (o mesmo turbo das plataformas coloridas, por mais tempo)
        k.dinoT = C.DINO.BOOST; k.boostT = Math.max(k.boostT || 0, C.DINO.BOOST);
        for (let n = 0; n < 14; n++) Fx.spark(k.pos.x, k.pos.y + 0.6, k.pos.z, (Math.random() - 0.5) * 8, 2 + Math.random() * 4, (Math.random() - 0.5) * 8, n % 2 ? 0x2ee6a8 : 0xffd23f, 0.24, 0.45);
      }
      if (k.isPlayer) { try { tearBag(kind); } catch (e) { } }
      if (k.isPlayer && UI.Sfx && UI.Sfx.boost) try { UI.Sfx.boost(); } catch (e) { }
    },

    // ---------- quadro ----------
    update(dt, karts, racing) {
      if (!this.on || !this.group) { this.hud(null, dt); return; }
      this.t += dt; const tr = this.tr, N = tr.N, P = karts.find(k => k.isPlayer);
      // caixas: giram, flutuam, mudam de cor e voltam depois de coletadas
      if (this.boxTex) { this.boxTex.glass.offset.x = (this.t * 0.12) % 1; this.boxTex.glass.offset.y = (this.t * 0.05) % 1; }   // arco-íris passeando
      this.boxes.forEach(b => { const u = b.userData;
        if (u.respawn > 0) { u.respawn -= dt; if (u.respawn <= 0) { b.visible = true; u.shd.visible = true; b.scale.setScalar(0.01); } else return; }
        if (b.scale.x < 1) b.scale.setScalar(Math.min(1, b.scale.x + dt * 3.2));
        const bob = Math.sin(this.t * 2.2 + u.ph);
        u.spin.rotation.y += dt * 1.1; u.spin.rotation.x = 0.42 + Math.sin(this.t * 1.3 + u.ph) * 0.08; u.spin.rotation.z = 0.28;   // gira inclinada (mostra 3 faces)
        b.position.y = u.y0 + bob * 0.25;
        u.q.scale.setScalar(C.BOX_SIZE * (0.8 + Math.sin(this.t * 3.4 + u.ph) * 0.05));
        u.shd.scale.setScalar(1 - bob * 0.06);
        const hu = (u.hue + this.t * 0.18) % 1; u.gm.userData.U.uHue.value = hu; u.gm.userData.U.uTime.value = this.t + u.ph; u.glw.uniforms.uColor.value.setHSL(hu, 1, 0.62);   // vidro arco-íris tingido de leve pela cor que gira (continua vidro); o glow leva a cor forte
        const pl = 0.5 + 0.5 * Math.sin(this.t * 3 + u.ph); u.glw.uniforms.uOpacity.value = 0.5 + 0.3 * pl; u.glow.scale.setScalar(C.BOX_SIZE * (2.4 + 0.35 * pl)); });
      fxUpdate(dt, this.t); this.shardStep(dt);
      if (!racing) { this.hud(P, dt); return; }
      // coleta
      const R2 = C.PICK_RADIUS * C.PICK_RADIUS;
      karts.forEach(k => { if (k.remote || k.item || k.itemRoll > 0 || k.finished) return;
        for (const b of this.boxes) { if (!b.visible) continue; const dx = b.position.x - k.pos.x, dz = b.position.z - k.pos.z;
          if (dx * dx + dz * dz < R2 && Math.abs(b.position.y - k.pos.y) < 4) {
            b.visible = false; b.userData.shd.visible = false; b.userData.respawn = C.BOX_RESPAWN;
            this.shatter(b);   // a caixa estilhaça
            const w = C.WEIGHTS; k.itemNext = Math.random() < w.banana / (w.banana + w.dino) ? 'banana' : 'dino'; k.itemRoll = C.ROLL_TIME;
            if (k.isPlayer && UI.Sfx && UI.Sfx.boost) try { UI.Sfx.boost(); } catch (e) { }
            break; } } });
      karts.forEach(k => { if (k.itemRoll > 0) { k.itemRoll -= dt; if (k.itemRoll <= 0) { k.itemRoll = 0; k.item = k.itemNext; k.itemWait = rand(C.BOT_WAIT[0], C.BOT_WAIT[1]);
        } } });
      // jogador usa o item
      if (this.wantUse) { this.wantUse = false; if (P && P.item && !P.finished && !(window.Game && (Game.paused || UI.modal))) this.use(P); }
      // bots usam o item depois de um tempinho, quando faz sentido
      karts.forEach(k => { if (k.isPlayer || k.remote || !k.item || k.finished) return; k.itemWait -= dt; if (k.itemWait > 0) return;
        if (k.item === 'dino') { if (!(k.spinT > 0)) this.use(k); return; }   // turbo: usa assim que pode
        const fx = Math.sin(k.ang), fz = Math.cos(k.ang); let behind = false;
        karts.forEach(o => { if (o === k) return; const dx = o.pos.x - k.pos.x, dz = o.pos.z - k.pos.z; if (dx * fx + dz * fz < 0 && Math.hypot(dx, dz) < 28) behind = true; });
        if (behind || k.itemWait < -9) this.use(k); });
      // bananas
      for (let i = this.bananas.length - 1; i >= 0; i--) { const b = this.bananas[i]; b.age += dt; let dead = b.age > C.BANANA.LIFE;
        if (b.model) { const fl = Math.sin(b.age * 2.4 + b.ph); b.model.position.y = C.BANANA.FLOAT + fl * C.BANANA.BOB; b.model.rotation.y += C.BANANA.SPIN * dt;   // flutua e gira
          if (b.sh) { const k2 = 1 - (fl + 1) * 0.08; b.sh.scale.setScalar(C.BANANA.SIZE * 0.95 / C.BOX_SIZE * k2); } }
        if (!dead) for (const k of karts) { if (k.remote || (k === b.owner && b.age < C.BANANA.GRACE)) continue; if (Math.hypot(k.pos.x - b.x, k.pos.z - b.z) < C.BANANA.RADIUS && Math.abs(k.pos.y - b.mesh.position.y) < 2.5 && !k.air) { k.hitBy = 'banana'; this.hit(k); dead = true; break; } }
        if (dead) { b.mesh.parent && b.mesh.parent.remove(b.mesh); this.bananas.splice(i, 1); } }
      // giro da banana e turbo do dinossauro (aplicados todo quadro)
      karts.forEach(k => {
        if (k.spinT > 0) {
          k.spinT -= dt; const S = C.SPIN, e = Math.min(1, (S.TIME + S.STOP - k.spinT) / S.TIME), ease = 1 - Math.pow(1 - e, 2.2);
          const full = Math.PI * 2 * S.TURNS, A = C.ANIM, el = (S.TIME + S.STOP - k.spinT);   // el = tempo desde o escorregão
          const w = e < 1 ? full * 2.2 * Math.pow(1 - e, 1.2) / S.TIME : 0, wn = Math.min(1, w / (full * 2.2 / S.TIME));   // velocidade do giro (0..1)
          // giro: rápido no começo, freia, passa um pouquinho do ponto e volta (balanço de tontura)
          const after = Math.max(0, el - S.TIME), wob = after > 0 ? Math.sin(after * 18) * Math.exp(-after * 9) * A.SETTLE : 0;
          const yaw = k.spinDir * (full * ease + wob);
          // pulo: sobe ao escorregar, cai, quica baixinho
          const hp = el / A.HOP_T, hop = hp < 1 ? Math.sin(hp * Math.PI) * A.HOP : (hp < 1.6 ? Math.sin((hp - 1) / 0.6 * Math.PI) * A.BOUNCE : 0);
          // amassada: estica no ar, achata ao tocar o chão (e no quique)
          const land = t => { const d = el - t; return d >= 0 && d < 0.22 ? Math.sin(d / 0.22 * Math.PI) * Math.exp(-d * 6) : 0; };
          const sq = hp < 1 ? -0.07 * Math.sin(hp * Math.PI) : A.SQUASH * land(A.HOP_T) + A.SQUASH * 0.5 * land(A.HOP_T * 1.6);
          // inclinação para fora (força do giro) + tremidinha no fim
          const lean = A.LEAN * wn * k.spinDir, shake = A.WOBBLE * Math.sin(el * 23) * Math.exp(-Math.max(0, el - S.TIME * 0.6) * 5) * (1 - wn) * (e > 0.6 ? 1 : 0);
          setSpin(k, yaw, hop, 0.06 * Math.sin(el * 11) * wn, lean + shake * 0.5, sq);   // só o modelo se mexe; direção do kart e câmera ficam como estão
          updateGhosts(k, w);   // blur proporcional à velocidade do giro
          spinSmoke(k, w, dt);  // fumaça saindo das rodas
          k.speed = 0; k.yawV = 0; k.boostT = 0; k.drifting = false;      // sem acelerar nem derrapar enquanto gira
          // deslize com o embalo, freando até parar; não deixa sair da pista
          const f = Math.exp(-S.SLIDE * dt); k.slideX *= f; k.slideZ *= f;
          let nx = k.pos.x + k.slideX * dt, nz = k.pos.z + k.slideZ * dt;
          if (tr.side && k.idx !== undefined) { const i = ((k.idx % N) + N) % N, c = tr.side(i, 0, 0), q = tr.side(i, 1, 0), ux = q.x - c.x, uz = q.z - c.z, L = Math.hypot(ux, uz) || 1;
            const lat = ((nx - c.x) * ux + (nz - c.z) * uz) / L, lim = tr.W - 1.4;
            if (Math.abs(lat) > lim) { const d = (Math.abs(lat) - lim) * Math.sign(lat); nx -= ux / L * d; nz -= uz / L * d; k.slideX *= 0.4; k.slideZ *= 0.4; } }
          k.pos.x = nx; k.pos.z = nz;
          if (k.spinT <= 0) { k.spinT = 0; setSpin(k, 0); clearGhosts(k); spinning.delete(k); k.slideX = k.slideZ = 0; }
        } else if (k.dinoT > 0) { k.dinoT -= dt; k.boostT = Math.max(k.boostT || 0, k.dinoT); }
      });
      this.hud(P, dt);
    },

    // slot: segue o mesmo movimento da placa da volta (copia a transformação dela; parada = slot parado).
    // Roleta: carrossel de adesivos descendo de cima para baixo, desacelerando até parar no item sorteado.
    hud(P, dt) {
      if (!slot) return;
      const show = !!(this.on && P && window.Game && (Game.state === 'race' || Game.state === 'countdown' || Game.state === 'finish'));
      slot.classList.toggle('on', show); if (!show) { this._mT = 0; this._reel = null; return; }
      if ((this._mT = (this._mT || 0) - (dt || 0)) <= 0) { this._mT = 0.5; mountSlot(); }
      dt = Math.min(0.1, dt || 1 / 60); const t = this.t;
      // ----- mesmo movimento da placa da volta -----
      // copia a transformação da placa (inclusive translate/rotate/scale separados) usando o MESMO ponto de origem da placa,
      // convertido para o slot: assim placa e slot giram/inclinam juntos, como se fossem uma peça só no mesmo plano
      const lap = document.getElementById('lap');
      if (lap) {
        const cs = getComputedStyle(lap), tf = cs.transform && cs.transform !== 'none' ? cs.transform : '';
        const o = (cs.transformOrigin || '0px 0px').split(' ').map(parseFloat), dx = lap.offsetLeft - slot.offsetLeft, dy = lap.offsetTop - slot.offsetTop;
        const org = (o[0] + dx).toFixed(1) + 'px ' + (o[1] + dy).toFixed(1) + 'px' + (o[2] ? ' ' + o[2] + 'px' : '');
        const sw = slotSw.style;
        if (sw.transform !== tf) sw.transform = tf; if (sw.transformOrigin !== org) sw.transformOrigin = org;
        ['translate', 'rotate', 'scale'].forEach(pp => { const v = cs[pp] && cs[pp] !== 'none' ? cs[pp] : ''; if (sw[pp] !== v) sw[pp] = v; });
      }
      // ----- estado -----
      const roll = P.itemRoll > 0, has = !roll && !!P.item;
      if (roll && !this._reel) {   // começou a roleta: monta a fita do carrossel terminando no item sorteado
        const fin = P.itemNext || 'banana', oth = fin === 'banana' ? 'dino' : 'banana', N = 9;
        this._reel = { N, seq: Array.from({ length: N + 2 }, (_, i) => ((N - i) % 2 === 0 ? fin : oth)), last: -1 };
        slotIcon.classList.remove('v', 'land');
      }
      if (roll) {
        const T = C.ROLL_TIME, u = Math.min(1, Math.max(0, 1 - P.itemRoll / T)), pos = this._reel.N * (1 - Math.pow(1 - u, 2.6));   // rápido no começo, freia no fim
        const i = Math.floor(pos), fr = pos - i; this._rk = this._reel.seq[Math.min(this._reel.seq.length - 1, fr < 0.5 ? i : i + 1)]; const H = ((slotIcon.parentElement && slotIcon.parentElement.offsetHeight) || 128) * 0.98, sp = this._reel.N * 2.6 * Math.pow(1 - u, 1.6) / T;   // velocidade (itens/s)
        const st = Math.min(0.22, sp * 0.012);   // estica na vertical quando passa rápido (sensação de movimento)
        [0, 1].forEach(j => { const c = slotCards[j], k = this._reel.seq[Math.min(this._reel.seq.length - 1, i + j)], y = (fr - j) * H;
          if (c._k !== k && stickers[k]) { c._k = k; c.style.backgroundImage = 'url(' + stickers[k].flat + ')'; }
          c.style.transform = 'translateY(' + y.toFixed(1) + 'px) scaleY(' + (1 + st).toFixed(3) + ')'; });
        slot.style.setProperty('--ra', ((t * 720) % 360).toFixed(0) + 'deg');
      } else if (this._reel) { this._reel = null; if (has) { slotIcon.classList.remove('land'); void slotIcon.offsetWidth; slotIcon.classList.add('land'); } }
      const k = has ? P.item : '', stk = stickers[k];
      if (slotK !== (stk ? k : '')) { slotK = stk ? k : '';
        if (stk) { slotTilt.style.setProperty('--art', 'url(' + stk.art + ')'); slotTilt.style.setProperty('--holo', 'url(' + stk.holo + ')'); slotTilt.style.setProperty('--rim', 'url(' + stk.rim + ')');
          slotTilt.querySelectorAll('.spk').forEach((e, j) => { const p = stk.sp[j]; e.style.display = p ? '' : 'none'; if (p) { e.style.left = p[0] + '%'; e.style.top = p[1] + '%'; e.style.animationDelay = (j * 0.8).toFixed(2) + 's'; } }); }
        slot.setAttribute('aria-label', P.item ? C.NAMES[P.item] + ' (tecla E)' : 'Item atual (tecla E)'); }
      slotIcon.classList.toggle('v', !!stk && !roll);
      if (has && !slot.classList.contains('has')) { slot.classList.remove('pop'); void slot.offsetWidth; slot.classList.add('pop'); }   // pulo ao receber o item
      slot.classList.toggle('has', has); slot.classList.toggle('roll', roll);
      const nm = roll ? C.NAMES[this._rk || 'banana'].toUpperCase() : has ? C.NAMES[P.item].toUpperCase() : 'SEM ITEM';
      if (slotName.textContent !== nm) slotName.textContent = nm;
      if (roll) slot.style.setProperty('--rh', ((t * 600) % 360).toFixed(0));
      // ----- holograma: brilho e cores andando sozinhos (e um pouco com as curvas do kart) -----
      const dA = this._ha == null ? 0 : wrapA(P.ang - this._ha); this._ha = P.ang;
      this._st = (this._st || 0) + (Math.max(-1, Math.min(1, -dA / Math.max(dt, 1e-3) / 1.6)) - (this._st || 0)) * (1 - Math.exp(-6 * dt));
      const sv = this._st, boost = P.boostT > 0 ? 1 : 0, hs = slotTilt.style;
      const hx = (50 + sv * 40 + Math.sin(t * 0.7) * 22 + boost * Math.sin(t * 9) * 15).toFixed(1) + '%', ha = (125 + sv * 35 + Math.sin(t * 0.4) * 15).toFixed(1) + 'deg';
      hs.setProperty('--hx', hx); hs.setProperty('--ha', ha);
      hs.setProperty('--hy', (50 + Math.cos(t * 0.55) * 18).toFixed(1) + '%');
      hs.setProperty('--pa', (45 - sv * 20 + Math.sin(t * 0.5) * 10).toFixed(1) + 'deg');
      hs.setProperty('--cx', (Math.sin(t * 0.6) * 3).toFixed(2) + 'px'); hs.setProperty('--cy', (Math.cos(t * 0.5) * 3).toFixed(2) + 'px');
      hs.setProperty('--gx', (50 - sv * 30 + Math.sin(t * 0.8) * 22).toFixed(1) + '%'); hs.setProperty('--gy', (32 + Math.cos(t * 0.6) * 14).toFixed(1) + '%');
      hs.setProperty('--gx2', (Math.sin(t * 0.3) * 6).toFixed(1) + 'px'); hs.setProperty('--gy2', (Math.cos(t * 0.25) * 6).toFixed(1) + 'px');
      hs.setProperty('--sa', (110 + sv * 20).toFixed(1) + 'deg'); hs.setProperty('--sx', (50 - sv * 80 + Math.sin(t * 0.9) * 60).toFixed(1) + '%');
      const ss = slot.style; ss.setProperty('--hx', hx); ss.setProperty('--ha', ha);
      // ----- plástico reage ao kart: reflexos e vincos deslizam nas curvas, o brilho corre com a velocidade -----
      const spd = Math.min(1.5, Math.abs(P.speed || 0) / ((window.CFG && CFG.PHYS && CFG.PHYS.MAX) || 40));
      ss.setProperty('--fx', (-sv * 9 + Math.sin(t * 0.7) * 1.5).toFixed(2) + 'px');
      ss.setProperty('--fy', (spd * 3 + Math.cos(t * 0.5) * 1.2 - (P.air ? 4 : 0)).toFixed(2) + 'px');
      ss.setProperty('--fs', (1 + spd * 0.03).toFixed(3));
      ss.setProperty('--dx', (-sv * 5).toFixed(2) + 'px'); ss.setProperty('--dy', ((t * spd * 6) % 7).toFixed(2) + 'px');
    }
  };

  // tecla E: pede o uso do item (o uso em si acontece no próximo quadro, respeitando pausa e menus)
  addEventListener('keydown', e => {
    if (e.code !== 'KeyE' || e.repeat || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (Items.on) Items.wantUse = true;
  });
  window.Items = Items;
  // começa a carregar os modelos logo que a página abre (prontos antes da primeira corrida)
  setTimeout(preload, 1500);
})();
