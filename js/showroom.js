// =====================================================================================
// showroom.js — vitrine 3D usada pelo menu principal e pela Garagem
// Plataforma giratória com o kart + piloto do jogador. Cada tela tem um "rig" de câmera e a câmera
// desliza suavemente entre eles (menu: kart à direita girando; garagem: kart ao centro-esquerda,
// órbita automática que o jogador pode arrastar). Mudanças de cor/adesivo/piloto são aplicadas no
// modelo existente (instantâneo); trocar o modelo de kart reconstrói só o kart.
// Também gera as miniaturas dos modelos para os cartões da Garagem (render-to-texture).
// =====================================================================================
(function () {
  const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

  // ---------- garagem 3D (assets/garagem.glb) montada em volta do kart, sobre a plataforma ----------
  // A garagem fica parada na cena; o prato xadrez (this.turn) e o kart continuam girando por dentro dela.
  // Peças que ficarem entre a câmera e o kart somem suavemente (o kart fica sempre inteiro à vista).
  const GAR = Object.assign({
    URL: 'assets/garagem-v5.glb', VER: '5',       // nome novo a cada versão: nunca carrega um modelo antigo
    EMBED: 'assets/garagem-v5.glb.js',             // cópia embutida, para o jogo aberto direto do disco (file://)
    KART_LEN: 1.8,      // comprimento do kart (m) para o qual o modelo foi desenhado
    SCALE: 2.05,        // tamanho da garagem na plataforma (fixo: igual para kart, moto...); 0 = pelo tamanho do veículo
    YAW: -40,           // direção da porta, em graus (0 = de frente; negativo = virada para a esquerda)
    VEHICLE_SCALE: 0.65, // tamanho do veículo na vitrine (0.65 = 35% menor)
    PARKED: true,       // veículo parado (sem girar, rodas paradas)
    PARK_YAW: 0,        // giro extra do veículo parado, em graus (0 = alinhado com a garagem, de frente para a porta)
    OFFSET: [0, 0, 0],  // ajuste fino da posição
    FADE: 0,            // opacidade das peças que taparem o kart (0 = somem; 0.1 = ficam "fantasma")
    FADE_SPEED: 10, CHECK_EVERY: 5,
    DOOR_TIME: 1.3,     // segundos para o portão abrir/fechar
    // câmera da Garagem (coordenadas do modelo: metros, origem no centro do piso, porta em +z)
    CAM_APPROACH: [0.25, 1.45, 4.6],   // na frente do portão, enquanto ele abre
    CAM_DOOR: [-0.5, 1.75, 2.0],       // passando pela porta
    CAM_INSIDE: [-1.38, 2.12, 1.36],   // dentro, no alto do canto da frente: o veículo em 3/4, visto de cima
    CAM_FOV: 58,                       // lente mais aberta lá dentro (a garagem é pequena)
    LOOK_SHIFT: 0.45,                   // tela larga: desloca o olhar para a direita (veículo à esquerda, painel à direita)
    ENTER_TIME: 2.6, EXIT_TIME: 1.5
  }, (window.CFG && window.CFG.GARAGEM3D) || {});
  const DOOR_TOP = 2.15, DOOR_TRAVEL = 2.055, DOOR_H = 2.07;   // vão do portão no modelo (m)
  const ease = x => { x = Math.max(0, Math.min(1, x)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const GAR_PART = /^(floor|door|wall_(left|right|back)|front_(left|right|top)|roof|interior_(back|left|right)|props_ext)$/;
  const addScript = src => new Promise(res => { const el = document.createElement('script'); src && (el.src = src); el.onload = el.onerror = () => res(); document.head.appendChild(el); });
  // caixa de um objeto no espaço dele mesmo (não infla quando ele gira)
  function localBox(root) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4(), b = new THREE.Box3(), tmp = new THREE.Box3();
    root.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      b.union(tmp.copy(o.geometry.boundingBox).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
    });
    return b;
  }

  const Showroom = {
    rig: 'menu', yaw: 0.6, drag: null, autoSpin: true,
    build(renderer) { return Toon.during(() => this._build(renderer)); },
    _build(renderer) {
      this.renderer = renderer;
      const sc = this.scene = new THREE.Scene();
      const bg = TX.cvs(4, 256), g = bg.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#7a5cff'); gr.addColorStop(0.5, '#3db8ff'); gr.addColorStop(1, '#bff6ff'); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
      sc.background = new THREE.CanvasTexture(bg);
      sc.add(new THREE.HemisphereLight(0xf2f8ff, 0x7aa0e0, 0.75));
      const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(10, 18, 12); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
      Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 }); key.shadow.bias = -0.0008; sc.add(key);
      const rim = new THREE.DirectionalLight(0xffe0b0, 0.5); rim.position.set(-12, 6, -10); sc.add(rim);
      this.cam = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.5, 400);
      // plataforma: disco branco, anel vermelho e piso quadriculado
      this.turn = new THREE.Group(); sc.add(this.turn);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.9, 1, 64), new THREE.MeshLambertMaterial({ color: 0xffffff })); disc.position.y = -0.5; disc.receiveShadow = true; this.turn.add(disc);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6.65, 0.28, 12, 72), new THREE.MeshLambertMaterial({ color: 0xff4d9a })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; this.turn.add(ring); this.ring = ring;
      const top = new THREE.Mesh(new THREE.CircleGeometry(6.2, 64), new THREE.MeshLambertMaterial({ map: TX.get('checker', 3, 3), color: 0xf0f4ff })); top.rotation.x = -Math.PI / 2; top.position.y = 0.01; top.receiveShadow = true; this.turn.add(top); this.checker = top;
      // nuvens fofas ao fundo
      const cloudM = new THREE.MeshLambertMaterial({ color: 0xffffff }); this.clouds = [];
      [[-26, 14, -40, 1.4], [22, 18, -46, 1.8], [-8, 22, -60, 1.2], [34, 9, -30, 1], [-36, 6, -24, 0.9]].forEach(([x, y, z, s]) => {
        const c = new THREE.Group(); [[0, 0, 0, 3], [2.8, -0.6, 0.4, 2.2], [-2.8, -0.7, 0, 2.1], [1, 1.2, -0.5, 2]].forEach(([a, b, d, r]) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudM); m.position.set(a, b, d); c.add(m); });
        c.position.set(x, y, z); c.scale.setScalar(s); sc.add(c); this.clouds.push(c); });
      this.spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); this.spark.scale.setScalar(12); this.spark.position.y = 2; sc.add(this.spark);
      this.t = 0; this.camPos = new THREE.Vector3(6.5, 7.5, 21); this.camLook = new THREE.Vector3(5.6, 0.6, 0);
      this.setSpec(Custom.spec);
      this.bindDrag();
      this.loadGarage();
    },
    // ---------- garagem 3D ----------
    loadGarage() {
      const mk = () => { const l = new THREE.GLTFLoader(); if (window.MeshoptDecoder && l.setMeshoptDecoder) l.setMeshoptDecoder(window.MeshoptDecoder); return l; };
      const fromUrl = () => new Promise((res, rej) => mk().load(GAR.URL + '?v=' + GAR.VER, res, undefined, rej));
      const fromEmbed = () => (window.GARAGEM_GLB_B64_V5 ? Promise.resolve() : addScript(GAR.EMBED)).then(() => new Promise((res, rej) => {
        const b64 = window.GARAGEM_GLB_B64_V5; if (!b64) return rej(new Error('cópia embutida ' + GAR.EMBED + ' não encontrada'));
        const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        window.GARAGEM_GLB_B64_V5 = null; mk().parse(u8.buffer, '', res, rej);
      }));
      if (!THREE.GLTFLoader) { console.warn('[Garagem 3D] GLTFLoader não encontrado'); return; }
      (window.MeshoptDecoder ? Promise.resolve() : addScript('js/vendor/meshopt_decoder.js'))
        .then(() => location.protocol === 'file:' ? fromEmbed() : fromUrl().catch(e => { console.warn('[Garagem 3D] ' + GAR.URL + ' não carregou, tentando a cópia embutida', e); return fromEmbed(); }))
        .then(g => { try { this.placeGarage(g.scene); } catch (e) { console.error('[Garagem 3D] falha ao montar', e); } })
        .catch(e => console.error('[Garagem 3D] não foi possível carregar a garagem', e));
    },
    placeGarage(model) {
      const named = []; model.traverse(o => { if (GAR_PART.test(o.name || '')) named.push(o.name); });
      if (!named.length || !model.getObjectByName('door_curtain')) { console.error('[Garagem 3D] ' + GAR.URL + ' é um modelo antigo (sem portão). Publique o ' + GAR.URL + ' novo.'); return; }
      // o kart está no centro da plataforma: a escala vem do comprimento dele, o piso fica na altura das rodas
      const kb = this.kart ? localBox(this.kart.group) : null, ks = kb ? kb.getSize(new THREE.Vector3()) : null;
      const len = ks && ks.x > 0 ? Math.max(ks.x, ks.z) : 3.2;
      const s = GAR.SCALE > 0 ? GAR.SCALE : len / GAR.KART_LEN;
      const root = new THREE.Group(); root.name = 'Garagem3D'; root.add(model);
      root.position.set(GAR.OFFSET[0], GAR.OFFSET[1], GAR.OFFSET[2]);                // piso da garagem = topo da plataforma
      root.scale.setScalar(s); root.rotation.y = GAR.YAW * Math.PI / 180;
      const aniso = (window.TX && TX.aniso) || 4, enc = this.renderer.outputEncoding, fade = [];
      model.traverse(o => {
        if (!o.isMesh) return;
        const m = o.material = o.material.clone();
        ['map', 'emissiveMap'].forEach(k => { if (m[k]) { m[k].encoding = enc; m[k].anisotropy = aniso; m[k].needsUpdate = true; } });
        ['normalMap', 'roughnessMap'].forEach(k => { if (m[k]) m[k].anisotropy = aniso; });
        o.receiveShadow = true; o.castShadow = false;
        let part = ''; for (let p = o.parent; p && p !== model; p = p.parent) if (GAR_PART.test(p.name || '')) { part = p.name; break; }
        o.userData.fade = { part, cur: 0, target: 1, base: m.opacity, baseT: m.transparent, baseD: m.depthWrite };
        m.transparent = true; m.opacity = 0; m.depthWrite = false;                       // entra suave
        if (part === 'floor') o.renderOrder = -1; else if (part !== 'door') fade.push(o);   // o portão nunca some
      });
      // piso no lugar do prato xadrez (furo do chão) e sem o aro rosa / xadrez da plataforma
      let floorMesh = null; model.traverse(o => { if (o.isMesh && o.userData.fade.part === 'floor' && o.material.name === 'floor') floorMesh = o; });
      if (floorMesh) {
        const g = new THREE.CircleGeometry(1.2, 96); g.rotateX(-Math.PI / 2);
        const P = g.attributes.position, uv = g.attributes.uv, col = [];
        for (let i = 0; i < P.count; i++) { uv.setXY(i, P.getX(i) / 3 + 0.5, -P.getZ(i) / 3 + 0.5); col.push(0.9, 0.9, 0.9); }
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        const plug = new THREE.Mesh(g, floorMesh.material); plug.position.y = 0.006 / s; plug.receiveShadow = true; plug.renderOrder = -1;
        plug.userData.fade = floorMesh.userData.fade; floorMesh.parent.add(plug);
      }
      if (this.ring) this.ring.visible = false;
      if (this.checker) this.checker.visible = false;
      this.scene.add(root); root.updateMatrixWorld(true);
      fade.forEach(o => { o.userData.fade.box = new THREE.Box3().setFromObject(o); });
      // portão: começa fechado (abre só na tela da Garagem)
      const cur = model.getObjectByName('door_curtain'), bar = model.getObjectByName('door_bar');
      const door = { cur, bar, k: 0, target: 0,
        cy: cur ? cur.position.y : 0, cs: cur ? cur.scale.y : 1, by: bar ? bar.position.y : 0 };
      if (!cur || !bar) console.warn('[Garagem 3D] o modelo não tem o portão (door_curtain/door_bar)');
      this.garage = { root, fade, door, kb: this.clampKart(kb, s), n: 0,
        ray: new THREE.Raycaster(), pts: Array.from({ length: 27 }, () => new THREE.Vector3()) };
      this.setDoor(0);
      if (this.rig === 'garage') this.garageEnter();
      try { this.renderer.compile(this.scene, this.cam); } catch (e) { }
      window.Garagem3D = { root, scale: s, status: 'ok' };
      console.info('[Garagem 3D] ' + GAR.URL + ' montada: escala ' + s.toFixed(2) + ', portão fechado (abre na tela da Garagem)');
    },
    // abre (k = 1) / fecha (k = 0) o portão: a cortina encolhe para dentro do rolo, a barra de baixo sobe junto
    setDoor(k) {
      const D = this.garage && this.garage.door; if (!D || !D.cur) return;
      D.k = k; const sc = Math.max(0.004, 1 - k * DOOR_TRAVEL / DOOR_H);
      D.cur.scale.y = D.cs * sc; D.cur.position.y = DOOR_TOP * (1 - sc) + sc * D.cy;      // escala a partir do alto do vão
      D.cur.visible = sc > 0.01;
      if (D.bar) D.bar.position.y = D.by + k * DOOR_TRAVEL;
    },
    setFov(f) { if (Math.abs(this.cam.fov - f) > 1e-3) { this.cam.fov = f; this.cam.updateProjectionMatrix(); } },
    // ponto do modelo -> mundo
    gw(a) { return this.garage.root.localToWorld(new THREE.Vector3(a[0], a[1], a[2])); },
    // entrar: o portão abre enquanto a câmera chega na frente; depois ela entra pela porta e enquadra o veículo
    garageEnter() {
      if (!this.garage) return;
      this.garage.door.target = 1;
      this.gcam = { mode: 'in', t: 0, p0: this.camPos.clone(), l0: this.camLook.clone() };
    },
    // sair: a câmera recua pela porta, o portão fecha e ela volta para a câmera da tela pedida
    garageExit() {
      if (!this.garage || !this.gcam) { if (this.garage) this.garage.door.target = 0; return; }
      this.gcam = { mode: 'out', t: 0, p0: this.camPos.clone(), l0: this.camLook.clone(), fov0: this.cam.fov };
    },
    garageCam(dt, c) {
      const G = this.garage, M = this.gcam, wide = innerWidth > 860;
      const kart = this.gw([0.05, 0.42, -0.1]), A = this.gw(GAR.CAM_APPROACH), Dp = this.gw(GAR.CAM_DOOR), F = this.gw(GAR.CAM_INSIDE);
      // olhar final: veículo um pouco à esquerda em tela larga; em tela estreita, um pouco acima (painel embaixo)
      const right = new THREE.Vector3().subVectors(kart, F).cross(c.up).normalize();
      const LF = kart.clone().addScaledVector(right, wide ? GAR.LOOK_SHIFT * G.root.scale.x : 0).add(new THREE.Vector3(0, wide ? 0 : -0.35 * G.root.scale.x, 0));
      const doorLook = this.gw([0, 1.0, 0]);
      M.t += dt;
      const P = new THREE.Vector3(), L = new THREE.Vector3();
      if (M.mode === 'in') {
        const t1 = G.door.target ? GAR.DOOR_TIME * 0.85 : 0, T = GAR.ENTER_TIME;
        if (M.t < t1) { const k = ease(M.t / t1); P.lerpVectors(M.p0, A, k); L.lerpVectors(M.l0, doorLook, k); }
        else {
          const u = ease((M.t - t1) / (T - t1));
          const curve = new THREE.CatmullRomCurve3([A, Dp, F], false, 'centripetal');
          P.copy(curve.getPoint(u)); L.lerpVectors(doorLook, LF, ease(Math.min(1, u * 1.3)));
          if (u >= 1) { const sw = Math.sin(this.t * 0.35) * 0.05 * G.root.scale.x; P.addScaledVector(right, sw); }   // leve respiração da câmera
          this.setFov(36 + (GAR.CAM_FOV - 36) * u);
        }
      } else {
        const T = GAR.EXIT_TIME, u = ease(M.t / T);
        const curve = new THREE.CatmullRomCurve3([M.p0, Dp, A], false, 'centripetal');
        P.copy(curve.getPoint(u)); L.lerpVectors(M.l0, doorLook, u);
        if (u > 0.55) G.door.target = 0;                      // fecha quando a câmera já saiu
        this.setFov(M.fov0 + (36 - M.fov0) * u);
        if (M.t >= T) { this.camPos.copy(P); this.camLook.copy(L); this.gcam = null; }   // daqui segue para a câmera da tela pedida
      }
      this.camPos.copy(P); this.camLook.copy(L);
      c.position.copy(P); c.lookAt(L);
    },
    // área do veículo usada para ver se algo o tapa: no máximo o prato giratório (peças grandes/invisíveis do modelo não contam)
    clampKart(kb, s) {
      const lim = new THREE.Box3(new THREE.Vector3(-1.05 * s, 0, -1.05 * s), new THREE.Vector3(1.05 * s, 1.5 * s, 1.05 * s));
      if (!kb || kb.isEmpty()) return new THREE.Box3(new THREE.Vector3(-0.7 * s, 0, -0.9 * s), new THREE.Vector3(0.7 * s, 1.1 * s, 0.9 * s));
      const b = kb.clone().intersect(lim); return b.isEmpty() ? lim : b;
    },
    stepGarage(dt) {
      const G = this.garage; if (!G) return;
      const cam = this.cam, D = G.door;
      if (D.k !== D.target) {
        const v = Math.min(0.1, dt) / GAR.DOOR_TIME;
        D.lin = Math.max(0, Math.min(1, (D.lin == null ? D.k : D.lin) + (D.target > D.k ? v : -v)));
        this.setDoor(D.target > D.k ? Math.min(D.target, ease(D.lin)) : Math.max(D.target, ease(D.lin)));
        if (Math.abs(D.k - D.target) < 1e-3) { this.setDoor(D.target); D.lin = D.target; }
      }
      if (this.kart && ++G.n % GAR.CHECK_EVERY === 0) {
        G.fade.forEach(o => { o.userData.fade.hit = false; });
        const b = G.kb, mw = this.kart.group.matrixWorld, camP = cam.position, dir = new THREE.Vector3(), lerp = (a, z, t) => a + (z - a) * t;
        let n = 0;
        for (const tx of [0.04, 0.5, 0.96]) for (const ty of [0.15, 0.55, 1]) for (const tz of [0.04, 0.5, 0.96])
          G.pts[n++].set(lerp(b.min.x, b.max.x, tx), lerp(b.min.y, b.max.y, ty), lerp(b.min.z, b.max.z, tz)).applyMatrix4(mw);
        for (let i = 0; i < n; i++) {
          dir.subVectors(G.pts[i], camP); const d = dir.length(); dir.multiplyScalar(1 / d);
          G.ray.set(camP, dir); G.ray.far = d * 0.995;
          for (const o of G.fade) { const f = o.userData.fade; if (f.hit || !G.ray.ray.intersectsBox(f.box)) continue; if (G.ray.intersectObject(o, false).length) f.hit = true; }
        }
        const hit = new Set(); G.fade.forEach(o => { if (o.userData.fade.hit) hit.add(o.userData.fade.part); });
        G.fade.forEach(o => { o.userData.fade.target = hit.has(o.userData.fade.part) ? GAR.FADE : 1; });   // some a parte inteira
      }
      const k = 1 - Math.exp(-Math.min(0.1, dt) * GAR.FADE_SPEED);
      G.root.traverse(o => {
        const f = o.isMesh && o.userData.fade; if (!f) return;
        f.cur += (f.target - f.cur) * k; if (Math.abs(f.target - f.cur) < 0.002) f.cur = f.target;
        const m = o.material;
        if (f.cur > 0.995) { if (m.transparent !== f.baseT || m.opacity !== f.base) { m.opacity = f.base; m.transparent = f.baseT; m.depthWrite = f.baseD; m.needsUpdate = true; } }
        else { if (!m.transparent) { m.transparent = true; m.depthWrite = false; m.needsUpdate = true; } m.opacity = f.cur * f.base; }
        o.visible = f.cur > 0.004;
      });
    },
    // (re)monta o kart da vitrine
    setSpec(spec) {
      if (this.kart) { this.turn.remove(this.kart.group); this.kart.dispose(); }
      this.kart = buildKartModel(Object.assign({}, spec), {}); this.turn.add(this.kart.group);
      this.kart.group.scale.multiplyScalar(GAR.VEHICLE_SCALE);                  // veículo menor dentro da garagem
      this.kart.group.traverse(o => { if (o.isMesh) o.receiveShadow = false; });
      if (this.garage) this.garage.kb = this.clampKart(localBox(this.kart.group), this.garage.root.scale.x);                 // outro modelo de kart: atualiza a área a manter visível
      this.pulse(spec.color);
    },
    apply(id, spec) { if (!this.kart) return; if (!Custom.applyTo(this.kart, id)) this.setSpec(spec); else this.pulse(id === 'color' ? spec.color : null); },
    pulse(hex) { if (hex) this.spark.material.color.set(hex); this.spark.material.opacity = 0.85; this.hop = 0.35; },
    setRig(name) {
      const prev = this.rig; this.rig = name; if (name === 'garage') { this.autoSpin = true; }
      if (this.garage && name !== prev) { if (name === 'garage') this.garageEnter(); else if (prev === 'garage') this.garageExit(); }
    },
    // arrastar para girar o kart na garagem
    bindDrag() {
      const el = this.renderer.domElement;
      el.addEventListener('pointerdown', e => { if (window.Game && Game.state === 'garage' && e.button === 0) { this.drag = { x: e.clientX, v: 0 }; this.autoSpin = false; } });
      addEventListener('pointermove', e => { if (!this.drag || GAR.PARKED) return; const dx = e.clientX - this.drag.x; this.drag.x = e.clientX; this.turn.rotation.y += dx * 0.01; this.drag.v = dx * 0.01; });
      addEventListener('pointerup', () => { if (this.drag) { this.spinV = this.drag.v; this.drag = null; clearTimeout(this._as); this._as = setTimeout(() => this.autoSpin = true, 2500); } });
    },
    step(dt) {
      this.t += dt; const t = this.t;
      if (GAR.PARKED) this.turn.rotation.y = (GAR.YAW + GAR.PARK_YAW) * Math.PI / 180;            // veículo parado dentro da garagem
      else if (!this.drag) { this.spinV = (this.spinV || 0) * Math.max(0, 1 - 3 * dt); this.turn.rotation.y += this.spinV + (this.autoSpin ? dt * (this.rig === 'garage' ? 0.3 : 0.5) : 0); }
      if (this.kart) {
        if (!GAR.PARKED) this.kart.rolls.forEach(w => w.g.rotation.x += dt * 3);
        this.hop = Math.max(0, (this.hop || 0) - dt);
        this.kart.body.position.y = (GAR.PARKED ? 0 : Math.abs(Math.sin(t * 3)) * 0.04) + Math.sin(this.hop / 0.35 * Math.PI) * 0.5;
        // piloto "vivo": mexe no volante e olha em volta
        const st = Math.sin(t * 0.9) * 0.5 + Math.sin(t * 2.3) * 0.15;
        this.kart.animate(dt, { steer: st, speed: GAR.PARKED ? 0 : 0.2, boost: false, drift: 0 });
      }
      this.spark.material.opacity *= Math.max(0, 1 - dt * 3);
      this.clouds.forEach((c, i) => { c.position.x += dt * (0.6 + i * 0.15); if (c.position.x > 50) c.position.x = -50; });
      // rigs de câmera
      const c = this.cam, wide = innerWidth > 860; c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix();
      const P = new THREE.Vector3(), L = new THREE.Vector3();
      if (this.rig === 'garage') {
        const a = 0.5 + Math.sin(t * 0.2) * 0.08;
        if (wide) { P.set(4.8 + Math.sin(a) * 2, 6.4, 17.5); L.set(4.2, 1.4, 0); } else { P.set(0, 7.5, 19); L.set(0, 4.2, 0); }
      } else if (this.rig === 'setup') {
        if (wide) { P.set(0, 9, 24); L.set(0, 1.5, 0); } else { P.set(0, 10, 26); L.set(0, 4, 0); }
      } else {
        if (wide) { P.set(-6.0, 7.0, 20); L.set(-5.6, 1.0, 0); } else { P.set(0, 9.5, 25); L.set(0, 4.8, 0); }
      }
      if (this.garage && this.gcam) this.garageCam(dt, c);                  // entrando/dentro/saindo da garagem
      else { const k = Math.min(1, 3 * dt); this.camPos.lerp(P, k); this.camLook.lerp(L, k); c.position.copy(this.camPos); c.lookAt(this.camLook); }
      this.stepGarage(dt);
    },
    // ---------- miniaturas dos modelos (desenhadas uma vez, em segundo plano) ----------
    thumbnails(cb) {
      if (this._thumbs) return cb(this._thumbs);
      const R = this.renderer, W = 240, H = 150, rt = new THREE.WebGLRenderTarget(W, H), buf = new Uint8Array(W * H * 4), out = {};
      const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xf2f8ff, 0x8aa8d8, 0.9)); const d = new THREE.DirectionalLight(0xffffff, 0.7); d.position.set(8, 14, 10); sc.add(d);
      const cam = new THREE.PerspectiveCamera(28, W / H, 0.5, 100); cam.position.set(8.5, 5.2, 9.5); cam.lookAt(0, 1.2, 0);
      const list = KartModels.list().slice(); let i = 0;
      const next = () => {
        if (i >= list.length) { rt.dispose(); this._thumbs = out; return cb(out); }
        const def = list[i++], m = buildKartModel(Object.assign({}, Custom.spec, { model: def.id }), { pilot: false }); sc.add(m.group);
        R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, cam); R.readRenderTargetPixels(rt, 0, 0, W, H, buf); R.setRenderTarget(null); R.setClearColor(0x000000, 1);
        sc.remove(m.group); m.dispose();
        const c = TX.cvs(W, H), g = c.getContext('2d'), img = g.createImageData(W, H);
        for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);   // a leitura vem de cabeça para baixo
        g.putImageData(img, 0, 0); out[def.id] = c.toDataURL();
        setTimeout(next, 0);
      };
      next();
    },
    resize() { if (this.cam) { this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix(); } }
  };
  window.Showroom = Showroom;
})();
