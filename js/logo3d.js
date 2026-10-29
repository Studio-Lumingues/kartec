// =====================================================================================
// logo3d.js — o "KARTEC" da logo em 3D (assets/karttec_logo.glb)
// A logo 2D (SVG) fica só como "caixa" invisível que marca o lugar: a placa SUPER, as linhas de velocidade e o
// KARTEC dela são escondidos. O modelo 3D é desenhado num canvas próprio que segue essa caixa na tela (posição,
// tamanho e transparência), inclusive quando ela entra na abertura e desliza para o canto do menu.
// No menu, o jogador pode arrastar a logo para os lados para girá-la (só na horizontal).
// * O modelo vem sem cores: elas são pintadas por shader pela altura de cada camada (letras douradas em
//   degradê, contorno branco, contorno roxo-escuro), igual às cores da logo 2D, com um brilho que passa.
// * Página aberta direto do disco (file://): usa a cópia embutida assets/karttec_logo.glb.js.
// * Se o 3D não carregar, o KARTEC do SVG volta a aparecer.
// =====================================================================================
(function () {
  const C = Object.assign({
    MODEL: ['assets/karttec_logo.min.glb', 'assets/karttec_logo.glb', 'assets/kartec_logo.glb'],
    EMBED: 'assets/karttec_logo.glb.js',
    BOX: { cx: 0.5, cy: 0.5, h: 0.8 },     // centro (x, y) e altura do 3D, em frações da caixa da logo (viewBox 680 x 300)
    LAYERS: [0.193, 0.165],                // alturas (z do modelo) que separam letras / contorno branco / contorno roxo
    SWAY: 0.16, SWEEP_EVERY: 4.5,
    MENU_TOP: 28, MENU_GAP: 22, SUPERSAMPLE: 2,   // menu: margem do topo e espaço até os botões (px); qualidade (2 = 2x os pixels)
    DRAG: 0.012, BACK_AFTER: 2.5         // giro por pixel arrastado; segundos parado até voltar sozinha de frente (0 = não volta)
  }, (window.CFG && window.CFG.LOGO3D) || {});

  const L3 = window.Logo3D = { status: 'carregando' };

  // 1) esconde a logo 2D (SUPER, linhas, KARTEC) já no modelo (template), antes de ela ser montada
  const tpl = document.getElementById('logoTpl');
  const parts2D = root => root ? [].slice.call(root.querySelectorAll('.lgMain, g[clip-path], .lgPlate, .lgLines')) : [];
  parts2D(tpl && tpl.content).forEach(el => el.setAttribute('display', 'none'));
  const restore2D = () => {
    parts2D(tpl && tpl.content).forEach(el => el.removeAttribute('display'));
    const brand = document.getElementById('brand');
    if (brand) { parts2D(brand).forEach(el => el.removeAttribute('display')); brand.classList.remove('raster'); }
    if (L3.cv) L3.cv.remove();
  };
  const fail = (why, e) => { L3.status = 'erro'; console.error('[Logo 3D] ' + why, e || ''); restore2D(); };

  if (!window.THREE || !THREE.GLTFLoader) { fail('THREE/GLTFLoader não encontrados'); return; }

  // 2) carregamento (decodificador meshopt, .glb por http ou cópia embutida em file://)
  const addScript = src => new Promise(res => { const s = document.createElement('script'); s.src = src; s.onload = s.onerror = () => res(); document.head.appendChild(s); });
  const ensureDecoder = () => window.MeshoptDecoder ? Promise.resolve() : addScript('js/vendor/meshopt_decoder.js')
    .then(() => window.MeshoptDecoder ? null : addScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/meshopt_decoder.js'));
  const mkLoader = () => { const l = new THREE.GLTFLoader(); if (window.MeshoptDecoder && l.setMeshoptDecoder) l.setMeshoptDecoder(window.MeshoptDecoder); return l; };
  const tryUrls = (urls, i) => new Promise((res, rej) => {
    if (i >= urls.length) return rej(new Error('nenhum arquivo encontrado em assets/'));
    mkLoader().load(urls[i], g => { L3.url = urls[i]; res(g); }, undefined, () => tryUrls(urls, i + 1).then(res, rej));
  });
  const fromEmbedded = () => (window.KARTEC_LOGO_GLB_B64 ? Promise.resolve() : addScript(C.EMBED)).then(() => new Promise((res, rej) => {
    const b64 = window.KARTEC_LOGO_GLB_B64; if (!b64) return rej(new Error('cópia embutida ' + C.EMBED + ' não encontrada'));
    const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    window.KARTEC_LOGO_GLB_B64 = null;
    mkLoader().parse(u8.buffer, '', g => { L3.url = C.EMBED + ' (embutido)'; res(g); }, rej);
  }));
  const local = location.protocol === 'file:';

  ensureDecoder()
    .then(() => local ? fromEmbedded() : tryUrls(C.MODEL, 0).catch(() => fromEmbedded()))
    .then(g => { try { setup(g.scene); L3.status = 'ok'; console.info('[Logo 3D] carregada de ' + L3.url); } catch (e) { fail('falha ao montar a logo 3D', e); } })
    .catch(e => fail('não foi possível carregar a logo 3D: ' + (e && e.message ? e.message : e), e));

  // 3) cena própria (canvas transparente por cima da logo)
  const lin = h => new THREE.Color(h).convertSRGBToLinear();
  function setup(root) {
    let mesh = null; root.updateMatrixWorld(true); root.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) throw new Error('nenhuma malha no .glb');
    const geo = mesh.geometry; if (!mesh.matrixWorld.equals(new THREE.Matrix4())) geo.applyMatrix4(mesh.matrixWorld);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.computeBoundingBox(); const bb = geo.boundingBox, size = bb.getSize(new THREE.Vector3()), mid = bb.getCenter(new THREE.Vector3());

    const U = {
      uZ: { value: new THREE.Vector2(C.LAYERS[0], C.LAYERS[1]) }, uY: { value: new THREE.Vector2(bb.max.y - 0.04, bb.min.y + 0.06) },
      uG0: { value: lin('#FFA79A') }, uG1: { value: lin('#FF4D5E') }, uG2: { value: lin('#E8213A') }, uG3: { value: lin('#C4102B') },   // vermelho (era dourado/laranja)
      uWhite: { value: lin('#FFFFFF') }, uInk: { value: lin('#2A1D4A') }, uSweep: { value: -9 }, uSelf: { value: 0.22 }
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.0 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'varying vec3 vLP;\nvarying vec3 vLN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLP = position; vLN = normal;');
      sh.fragmentShader = ['varying vec3 vLP;', 'varying vec3 vLN;', 'uniform vec2 uZ;', 'uniform vec2 uY;', 'uniform vec3 uG0;', 'uniform vec3 uG1;', 'uniform vec3 uG2;', 'uniform vec3 uG3;',
        'uniform vec3 uWhite;', 'uniform vec3 uInk;', 'uniform float uSweep;', 'uniform float uSelf;', ''].join('\n') +
        sh.fragmentShader.replace('#include <map_fragment>', [
          '#include <map_fragment>',
          'vec3 ln = normalize(vLN); vec3 col; float face = smoothstep(0.55, 0.8, abs(ln.z)); float az = abs(vLP.z);',   // frente e verso iguais
          // camadas pela altura, com transição suave (sem degrau serrilhado onde uma cor encontra a outra)
          'float t = clamp((uY.x - vLP.y) / (uY.x - uY.y), 0.0, 1.0);',
          'vec3 gold = t < 0.38 ? mix(uG0, uG1, t / 0.38) : t < 0.78 ? mix(uG1, uG2, (t - 0.38) / 0.4) : mix(uG2, uG3, (t - 0.78) / 0.22);',
          'gold = mix(uG3 * 0.8, gold, face);',                                     // lateral das letras: vermelho mais escuro
          'float sw = exp(-pow((vLP.x + vLP.y * 0.45 - uSweep) / 0.07, 2.0));',     // brilho que atravessa as letras
          'gold = mix(gold, uWhite, sw * 0.7 * face);',
          'vec3 white = mix(uWhite * 0.82, uWhite, face);',
          'col = mix(uInk, white, smoothstep(uZ.y - 0.004, uZ.y + 0.004, az));',
          'col = mix(col, gold, smoothstep(uZ.x - 0.004, uZ.x + 0.004, az));',
          'diffuseColor.rgb = col;'].join('\n'))
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uSelf;');
    };
    mat.customProgramCacheKey = () => 'kartec-logo3d';

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8f84d8, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(-2, 3, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd8ff, 0.35); rim.position.set(3, -1, 2); scene.add(rim);
    const pivot = new THREE.Group(); scene.add(pivot);
    const m = new THREE.Mesh(geo, mat); m.position.copy(mid).negate(); pivot.add(m);

    const MARGIN_W = 1.3, MARGIN_H = 1.5, FOV = 22;
    const cam = new THREE.PerspectiveCamera(FOV, (size.x * MARGIN_W) / (size.y * MARGIN_H), 0.1, 50);
    cam.position.set(0, 0, (size.y * MARGIN_H / 2) / Math.tan(FOV * Math.PI / 360) + size.z / 2);

    const cv = L3.cv = document.createElement('canvas'); cv.className = 'logo3d'; cv.setAttribute('aria-hidden', 'true');
    Object.assign(cv.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', zIndex: '13', pointerEvents: 'none', opacity: '0' });
    document.body.appendChild(cv);
    const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0); renderer.outputEncoding = THREE.sRGBEncoding;

    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const box = { x: 0, y: 0, w: 0, ok: false, still: 0 };
    let bufW = 0, bufH = 0, last = performance.now(), wasPhase = false, intro = -1, sweepT = 1.2, sweepX = -9;

    // elemento da logo 2D que está aparecendo (o SVG ou a versão rasterizada do logo.js)
    const target = brand => {
      const svg = brand.querySelector('svg.logo');
      if (svg && getComputedStyle(svg).display !== 'none') { const r = svg.getBoundingClientRect(); if (r.width > 1) return r; }
      let best = null; brand.querySelectorAll('canvas, img').forEach(el => { const r = el.getBoundingClientRect(); if (r.width > 1 && (!best || r.width * r.height > best.width * best.height)) best = r; });
      if (best) { const want = 300 / 680, h = best.width * want;       // mantém a proporção do viewBox (centralizada)
        if (Math.abs(best.height - h) > best.height * 0.03) return { left: best.left, top: best.top + (best.height - h) / 2, width: best.width, height: h }; return best; }
      const r = brand.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.width * 300 / 680 };
    };
    const opacityOf = el => { let o = 1; for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
    const easeOutBack = k => { const s = 1.7; k -= 1; return k * k * ((s + 1) * k + s) + 1; };

    // arrastar para girar (só no menu, só na horizontal). Escuta o documento: o canvas não bloqueia cliques.
    const drag = L3.drag = { on: false, id: null, x: 0, rot: 0, vel: 0, idle: 99, box: null };
    const inBox = (x, y) => { const b = drag.box; return b && x >= b.l && x <= b.r && y >= b.t && y <= b.b; };
    const menuOn = () => document.body.dataset.screen === 'menu' && !document.body.classList.contains('logoPhase');
    addEventListener('pointerdown', e => {
      if (!menuOn() || !inBox(e.clientX, e.clientY) || (e.button != null && e.button > 0)) return;
      drag.on = true; drag.id = e.pointerId; drag.x = e.clientX; drag.vel = 0; drag.idle = 0;
      e.stopPropagation(); e.preventDefault();                        // não gira o kart da vitrine nem clica no que está atrás
    }, true);
    addEventListener('pointermove', e => {
      if (drag.on && e.pointerId === drag.id) { const dx = e.clientX - drag.x; drag.x = e.clientX; drag.rot += dx * C.DRAG; drag.vel = dx * C.DRAG * 60; e.preventDefault(); }
      else if (!drag.on) { const over = menuOn() && inBox(e.clientX, e.clientY); if (over !== drag.over) { drag.over = over; document.documentElement.style.cursor = over ? 'grab' : ''; } }
    }, true);
    const end = e => { if (drag.on && (!e || e.pointerId === drag.id)) { drag.on = false; drag.idle = 0; } };
    addEventListener('pointerup', end, true); addEventListener('pointercancel', end, true); addEventListener('blur', () => end());

    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const brand = document.getElementById('brand'); if (!brand || document.hidden) return;
      const op = opacityOf(brand);
      if (op < 0.01) { if (cv.style.opacity !== '0') cv.style.opacity = '0'; return; }
      // onde a logo fica: no menu, com a MESMA largura dos botões e logo acima deles; nas outras telas, segue a logo 2D
      const aspect = size.x / size.y, nav = document.querySelector('#menu .mainNav'), nr = nav && document.body.dataset.screen === 'menu' ? nav.getBoundingClientRect() : null;
      let tx, ty, tw;
      if (nr && nr.width > 20 && nr.height > 20) {
        tw = nr.width; let bh = tw / aspect;
        const roomTop = C.MENU_TOP, gap = C.MENU_GAP, avail = nr.top - gap - roomTop;
        if (bh > avail) { bh = Math.max(40, avail); tw = bh * aspect; }        // tela baixa: encolhe para caber acima dos botões
        tx = nr.left + nr.width / 2; ty = nr.top - gap - bh / 2;
      } else {
        const r = target(brand); if (!r || r.width < 2) return;
        const bh = r.height * C.BOX.h; tw = bh * aspect; tx = r.left + r.width * C.BOX.cx; ty = r.top + r.height * C.BOX.cy;
      }
      // segue o alvo suavemente (sem pulo quando a logo passa da abertura para o menu)
      const f = box.ok ? 1 - Math.exp(-dt * 12) : 1; box.ok = true;
      box.x += (tx - box.x) * f; box.y += (ty - box.y) * f; box.w += (tw - box.w) * f;
      const bw = box.w, bh = bw / aspect, W = bw * MARGIN_W, H = bh * MARGIN_H, cx = box.x, cy = box.y;
      drag.box = { l: cx - bw / 2, r: cx + bw / 2, t: cy - bh / 2, b: cy + bh / 2 };   // área "pegável" = a própria logo
      Object.assign(cv.style, { left: (cx - W / 2) + 'px', top: (cy - H / 2) + 'px', width: W + 'px', height: H + 'px', opacity: String(op) });
      // qualidade: desenha com o DOBRO de pixels da tela e reduz (supersampling = bordas lisas, sem serrilhado).
      // O buffer acompanha o tamanho na tela (realoca na hora se mudar muito, ou quando a logo para de mexer).
      const dpr = window.devicePixelRatio || 1, ss = Math.min(3, dpr * C.SUPERSAMPLE), cap = Math.min(1, Math.sqrt(4.2e6 / Math.max(1, W * H * ss * ss)));
      const w = Math.max(2, Math.round(W * ss * cap)), h = Math.max(2, Math.round(H * ss * cap));
      const big = Math.abs(w - bufW) > bufW * 0.12 || Math.abs(h - bufH) > bufH * 0.12, small = Math.abs(w - bufW) > 1 || Math.abs(h - bufH) > 1;
      box.still = small && Math.abs(tw - box.w) < 0.5 ? box.still + dt : 0;
      if (!bufW || big || box.still > 0.15) { bufW = w; bufH = h; renderer.setSize(w, h, false); box.still = 0; }
      // abertura: gira e "chega" quando a logo entra (body.logoPhase)
      const phase = document.body.classList.contains('logoPhase');
      if (phase && !wasPhase) intro = 0; wasPhase = phase;
      const t = now / 1000; let ry = 0, rx = 0, s = 1;
      if (intro >= 0) { intro += dt; const k = Math.min(1, intro / 1.0), e = easeOutBack(k); ry = (1 - e) * -1.6; s = 0.6 + 0.4 * e; if (k >= 1) intro = -1; }
      // giro do jogador: inércia ao soltar e, depois de um tempo parada, volta sozinha para a frente mais próxima
      if (!drag.on) {
        drag.rot += drag.vel * dt; drag.vel *= Math.exp(-3.2 * dt); drag.idle += dt;
        if (C.BACK_AFTER > 0 && drag.idle > C.BACK_AFTER) { const front = Math.round(drag.rot / (Math.PI * 2)) * Math.PI * 2; drag.rot += (front - drag.rot) * Math.min(1, dt * 2.5); }
      }
      ry += drag.rot;
      const calm = drag.on ? 0 : Math.min(1, Math.max(0, drag.idle - 0.5));   // balanço automático só quando ninguém mexe
      if (!reduce) { ry += Math.sin(t * 0.7) * C.SWAY * calm; rx = Math.sin(t * 0.9 + 1) * C.SWAY * 0.35 * calm; }
      pivot.rotation.set(rx, ry, 0); pivot.scale.setScalar(s);
      // brilho que passa pelas letras de tempos em tempos
      sweepT -= dt; if (sweepT <= 0) { sweepT = C.SWEEP_EVERY; sweepX = bb.min.x - 0.5; }
      if (sweepX < bb.max.x + 0.6) sweepX += dt * 2.6; U.uSweep.value = sweepX;
      renderer.render(scene, cam);
    }
    requestAnimationFrame(frame);
  }
})();
