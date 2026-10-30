// =====================================================================================
// garagem3d.js — a garagem 3D (assets/garagem.glb) em volta do kart da vitrine (menu, garagem, lobby, abertura)
// * Mede o kart que já está na cena da vitrine (Showroom.scene) e coloca a garagem exatamente nesse lugar:
//   o centro do prato giratório da garagem fica no centro do kart, o piso na altura das rodas, e a escala vem
//   do comprimento do kart (o modelo foi feito para um kart de KART_LEN metros).
// * A garagem fica de frente para a câmera do menu, com a porta de enrolar aberta.
// * Kart sempre visível: a cada poucos quadros, o que estiver entre a câmera e o kart (telhado, pilar, verga...)
//   fica quase transparente; volta ao normal quando sai da frente.
// * Não mexe no showroom.js: envolve Showroom.build e Showroom.step. Ajustes finos em CFG.GARAGEM3D.
// =====================================================================================
(function () {
  const C = Object.assign({
    URL: 'assets/garagem.glb',
    KART_LEN: 1.8,           // comprimento do kart (m) para o qual o modelo foi desenhado
    SCALE: 0,                // 0 = automático pelo tamanho do kart; > 0 força a escala
    YAW: null,               // null = porta virada para a câmera do menu; número (graus) força a direção
    OFFSET: [0, 0, 0],       // ajuste fino da posição (unidades da cena)
    FADE: 0,                 // opacidade das partes que taparem o kart (0 = somem; ex.: 0.1 = ficam "fantasma")
    FADE_SPEED: 10,          // rapidez do esmaecimento
    CHECK_EVERY: 5,          // quadros entre as verificações de quem tapa o kart
    SHADOWS: true            // a garagem recebe a sombra do kart
  }, (window.CFG && window.CFG.GARAGEM3D) || {});

  const G = window.Garagem3D = { status: 'carregando', C };
  const SR = () => (typeof Showroom !== 'undefined' ? Showroom : window.Showroom);
  const log = (...a) => console.info('[Garagem 3D]', ...a);
  const warn = (...a) => console.warn('[Garagem 3D]', ...a);

  if (!window.THREE || !THREE.GLTFLoader) { G.status = 'erro'; warn('THREE/GLTFLoader não encontrados'); return; }
  const S0 = SR();
  if (!S0 || typeof S0.build !== 'function') { G.status = 'erro'; warn('Showroom não encontrado (carregue este script depois do showroom.js)'); return; }

  // ---------------------------------------------------------------- 1) carrega o modelo já no início (em paralelo ao resto)
  // o .glb é compactado com meshopt (o mesmo decodificador que o jogo já carrega em js/vendor/meshopt_decoder.js)
  let model = null, built = false, renderer = null;
  const addScript = src => new Promise(res => { const s = document.createElement('script'); s.src = src; s.onload = s.onerror = () => res(); document.head.appendChild(s); });
  (window.MeshoptDecoder ? Promise.resolve() : addScript('js/vendor/meshopt_decoder.js')).then(() => {
    const ld = new THREE.GLTFLoader();
    if (window.MeshoptDecoder && ld.setMeshoptDecoder) ld.setMeshoptDecoder(window.MeshoptDecoder);
    ld.load(C.URL, g => { model = g.scene; G.status = 'carregado'; tryAttach(); },
      undefined, e => { G.status = 'erro'; warn('não foi possível carregar ' + C.URL, e); });
  });

  // ---------------------------------------------------------------- 2) envolve a vitrine
  const build0 = S0.build;
  S0.build = function (r) { const out = build0.apply(this, arguments); renderer = r; built = true; tryAttach(); return out; };
  const step0 = S0.step;
  if (typeof step0 === 'function') S0.step = function (dt) { const out = step0.apply(this, arguments); try { update(dt); } catch (e) { warn(e); } return out; };

  // ---------------------------------------------------------------- 3) acha o kart e o disco da vitrine
  const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _box = new THREE.Box3();
  const worldBox = o => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };

  function findDisc(scene, skip) {           // maior peça chata e larga (o prato xadrez / a base branca)
    let best = null, bestA = 0;
    scene.traverse(o => {
      if (!o.isMesh || !o.visible || o === skip || (skip && isInside(o, skip))) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = _box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld), s = b.getSize(_v);
      const w = Math.min(s.x, s.z), a = s.x * s.z;
      if (s.y < w * 0.35 && w > 0 && a > bestA && s.x < 1e4) { bestA = a; best = { mesh: o, box: b.clone() }; }
    });
    return best;
  }
  const isInside = (o, root) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };

  // o kart = { frame: objeto cujo giro acompanha o kart, objs: peças do kart }
  function findKart(scene, disc) {
    const S = SR();
    for (const k of ['kart', 'model', 'car', 'kartObj', 'current']) if (S[k] && S[k].isObject3D && isInside(S[k], scene)) return { frame: S[k], objs: [S[k]] };
    let skinned = null;
    scene.traverse(o => { if (!skinned && o.isSkinnedMesh && o.visible) skinned = o; });    // o piloto
    if (!skinned) return null;
    let k = skinned;                                                                        // sobe até o kart inteiro, sem pegar o disco
    const holdsDisc = o => disc && isInside(disc.mesh, o);
    while (k.parent && k.parent !== scene && !holdsDisc(k.parent)) k = k.parent;
    // piloto e kart podem ser "irmãos" dentro do grupo do prato: junta as peças vizinhas
    const P = k.parent, kb = worldBox(k), grow = kb.getSize(new THREE.Vector3()).length() * 0.5, objs = [k];
    if (P) P.children.forEach(o => {
      if (o === k || holdsDisc(o) || o.isLight || o.isCamera || !o.visible) return;
      let has = false; o.traverse(q => { if (q.isMesh) has = true; }); if (!has) return;
      const ob = worldBox(o); if (ob.isEmpty() || ob.getSize(_v).length() > grow * 2.6) return;   // nada maior que o kart (disco, chão...)
      if (ob.intersectsBox(kb.clone().expandByScalar(grow))) objs.push(o);
    });
    return { frame: objs.length > 1 && P && P !== scene ? P : k, objs };
  }

  // caixa do kart no espaço do "frame" (não infla quando ele está virado)
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
  const PART = /^(floor|wall_(left|right|back)|front_(left|right|top)|roof|interior_(back|left|right)|props_ext)$/;          // grupos do modelo (nós com esses nomes)

  // ---------------------------------------------------------------- 4) monta a garagem no lugar do kart
  let root = null, kart = null, kBox = null, fadeList = [], yawLocked = false, settle = 0, lastCam = new THREE.Vector3(), frame = 0;
  function tryAttach() {
    if (!model || !built || root) return;
    const S = SR(), scene = S.scene, cam = S.cam;
    if (!scene || !cam) { warn('Showroom.scene/cam não encontrados'); return; }
    scene.updateMatrixWorld(true);
    const disc = findDisc(scene, null);
    kart = findKart(scene, disc);
    if (!kart && !disc) { setTimeout(tryAttach, 300); return; }      // a vitrine ainda está montando o kart

    // medidas
    let cx, cz, floorY, len;
    if (kart) {
      kBox = localBox(kart);
      const ws = kart.frame.getWorldScale(new THREE.Vector3()), sz = kBox.getSize(new THREE.Vector3());
      len = Math.max(sz.x * ws.x, sz.z * ws.z);
      const c = kBox.getCenter(new THREE.Vector3()).applyMatrix4(kart.frame.matrixWorld);
      cx = c.x; cz = c.z;
      floorY = Infinity;
      for (const x of [kBox.min.x, kBox.max.x]) for (const y of [kBox.min.y, kBox.max.y]) for (const z of [kBox.min.z, kBox.max.z])
        floorY = Math.min(floorY, _v.set(x, y, z).applyMatrix4(kart.frame.matrixWorld).y);
    }
    if (disc) {
      const dc = disc.box.getCenter(new THREE.Vector3()), dr = Math.min(disc.box.max.x - disc.box.min.x, disc.box.max.z - disc.box.min.z) / 2;
      G.discRadius = dr;
      if (!kart) { cx = dc.x; cz = dc.z; floorY = disc.box.max.y; len = dr / 1.65; }
      else if (Math.hypot(dc.x - cx, dc.z - cz) < len * 0.15) { cx = dc.x; cz = dc.z; }   // prato da garagem concêntrico com o disco
    }
    const s = C.SCALE > 0 ? C.SCALE : len / C.KART_LEN;

    root = new THREE.Group(); root.name = 'Garagem3D';
    root.add(model);
    root.position.set(cx + C.OFFSET[0], floorY + C.OFFSET[1], cz + C.OFFSET[2]);
    root.scale.setScalar(s);
    root.rotation.y = C.YAW != null ? C.YAW * Math.PI / 180 : yawTo(cam, cx, cz);
    yawLocked = C.YAW != null;

    // materiais: cada peça com o seu (para esmaecer só ela), cores no mesmo espaço do resto do jogo, sombras
    const aniso = (window.TX && TX.aniso) || (renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4);
    const enc = renderer ? renderer.outputEncoding : THREE.LinearEncoding;
    model.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material = o.material.clone();
      ['map', 'emissiveMap'].forEach(k => { if (m[k]) { m[k].encoding = enc; m[k].anisotropy = aniso; m[k].needsUpdate = true; } });
      ['normalMap', 'roughnessMap'].forEach(k => { if (m[k]) m[k].anisotropy = aniso; });
      o.receiveShadow = !!C.SHADOWS; o.castShadow = false;
      let part = ''; for (let p = o.parent; p && p !== model; p = p.parent) if (PART.test(p.name || '')) { part = p.name; break; }
      o.userData.fade = { part, cur: 0, target: 1, base: m.opacity, baseTransparent: m.transparent, baseDepth: m.depthWrite };
      m.transparent = true; m.opacity = 0; m.depthWrite = false;                          // entra suave (fade-in)
      if (part !== 'floor') fadeList.push(o);
    });
    model.traverse(o => { if (o.isMesh && o.userData.fade.part === 'floor') o.renderOrder = -1; });
    scene.add(root);
    root.updateMatrixWorld(true);
    fadeList.forEach(o => { o.userData.fade.box = new THREE.Box3().setFromObject(o); });
    if (renderer) { try { renderer.compile(scene, cam); } catch (e) { } }

    G.root = root; G.kart = kart; G.scale = s; G.status = 'ok';
    log('posicionada em', root.position.toArray().map(v => +v.toFixed(3)), 'escala', +s.toFixed(4),
      'giro', +(root.rotation.y * 180 / Math.PI).toFixed(1) + '°', kart ? '(kart encontrado)' : '(sem kart: usando o disco)');
    if (G.discRadius && 2.75 * s > G.discRadius * 1.02) warn('a garagem passa da borda do disco da vitrine; ajuste CFG.GARAGEM3D.SCALE se precisar');
    lastCam.copy(cam.position);
  }

  function yawTo(cam, cx, cz) {
    cam.updateMatrixWorld(true);
    const p = cam.getWorldPosition(new THREE.Vector3());
    return Math.atan2(p.x - cx, p.z - cz);
  }

  // ---------------------------------------------------------------- 5) quadro a quadro: direção final e esmaecimento
  const ray = new THREE.Raycaster(), camP = new THREE.Vector3(), dir = new THREE.Vector3(), pts = [];
  for (let i = 0; i < 27; i++) pts.push(new THREE.Vector3());
  let swap = 0, swapYaw = 0;

  function update(dt) {
    if (!root) return;
    const S = SR(), cam = S.cam;
    dt = Math.min(0.1, dt || 0.016);
    // o kart pode ter sido trocado (personalização): procura de novo
    if (kart && !kartAlive(kart, S.scene)) { kart = findKart(S.scene, findDisc(S.scene, root)); if (kart) kBox = localBox(kart); }

    // direção: confirma com a câmera do menu já parada (só uma vez); se mudou, troca com um esmaecimento rápido
    if (!yawLocked && document.body.dataset.screen === 'menu') {
      settle = cam.position.distanceToSquared(lastCam) < 1e-8 ? settle + dt : 0;
      if (settle > 0.4) {
        yawLocked = true;
        const y = yawTo(cam, root.position.x - C.OFFSET[0], root.position.z - C.OFFSET[2]);
        let d = Math.atan2(Math.sin(y - root.rotation.y), Math.cos(y - root.rotation.y));
        if (Math.abs(d) > 3 * Math.PI / 180) { swap = 1; swapYaw = y; }
      }
    }
    lastCam.copy(cam.position);
    let swapMul = 1;
    if (swap) {
      swap += dt * 3;
      if (swap >= 2 && swapYaw != null) { root.rotation.y = swapYaw; swapYaw = null; root.updateMatrixWorld(true); fadeList.forEach(o => o.userData.fade.box.setFromObject(o)); }
      swapMul = swap < 2 ? Math.max(0, 2 - swap) : Math.min(1, swap - 2);
      if (swap >= 3) swap = 0;
    }

    // quem está entre a câmera e o kart?
    if (++frame % C.CHECK_EVERY === 0 && kart && kBox) {
      fadeList.forEach(o => { o.userData.fade.hit = false; });
      cam.getWorldPosition(camP);
      const b = kBox, mw = kart.frame.matrixWorld;
      // grade 3 x 3 x 3 sobre a caixa do kart (cantos, meios das arestas, centros das faces e o centro)
      const lerp = (a, z, t) => a + (z - a) * t;
      let n = 0;
      for (const tx of [0.04, 0.5, 0.96]) for (const ty of [0.15, 0.55, 1]) for (const tz of [0.04, 0.5, 0.96])
        pts[n++].set(lerp(b.min.x, b.max.x, tx), lerp(b.min.y, b.max.y, ty), lerp(b.min.z, b.max.z, tz)).applyMatrix4(mw);
      for (let i = 0; i < n; i++) {
        dir.subVectors(pts[i], camP); const dist = dir.length(); dir.multiplyScalar(1 / dist);
        ray.set(camP, dir); ray.near = 0; ray.far = dist * 0.995;
        for (const o of fadeList) {
          const f = o.userData.fade;
          if (f.hit || !ray.ray.intersectsBox(f.box)) continue;
          if (ray.intersectObject(o, false).length) f.hit = true;
        }
      }
      // some a parte inteira (ex.: o telhado leva junto calhas e testeiras), para não sobrar peça solta na frente
      const hitParts = new Set(); fadeList.forEach(o => { if (o.userData.fade.hit) hitParts.add(o.userData.fade.part); });
      fadeList.forEach(o => { o.userData.fade.target = hitParts.has(o.userData.fade.part) ? C.FADE : 1; });
    }

    // aplica as opacidades (com entrada suave e a troca de direção)
    const k = 1 - Math.exp(-dt * C.FADE_SPEED);
    root.traverse(o => {
      const f = o.isMesh && o.userData.fade; if (!f) return;
      f.cur += (f.target - f.cur) * k;
      if (Math.abs(f.target - f.cur) < 0.002) f.cur = f.target;
      const op = f.cur * swapMul, m = o.material;
      const solid = op > 0.995;
      if (solid) { if (m.opacity !== f.base || m.transparent !== f.baseTransparent) { m.opacity = f.base; m.transparent = f.baseTransparent; m.depthWrite = f.baseDepth; m.needsUpdate = true; } }
      else { if (!m.transparent) { m.transparent = true; m.depthWrite = false; m.needsUpdate = true; } m.opacity = op * f.base; }
      o.visible = op > 0.004;
    });
  }
})();
