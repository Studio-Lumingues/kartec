// =====================================================================================
// kart.js — física (aceleração, drift controlável com mini-turbo, plataformas de boost, rampas/saltos,
// água, paredes), controles do jogador (teclado + toque), partículas (fumaça, poeira, rastro do boost,
// faíscas) e utilidades de geometria (GEO). Os MODELOS 3D ficam em js/models/ (karts, adesivos, piloto).
// O mesmo Kart serve para o jogador e para o bot: só muda quem fornece o "input".
// =====================================================================================
(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---------- geometrias auxiliares (usadas também pelas pistas e pelo pódio) ----------
  // caixa com todas as quinas arredondadas: vértices empurrados para a superfície de uma caixa-miolo inflada
  function rbox(w, h, d, r, s) {
    s = s || 4; r = Math.max(0.005, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
    const M = 2 * s + 2, g = new THREE.BoxGeometry(w, h, d, M, M, M), p = g.attributes.position, n = g.attributes.normal;
    const remap = (v, half) => { const j = Math.round((v / half + 1) * M / 2), inner = half - r;
      if (j <= s) return -half + r * j / s; if (j >= M - s) return half - r * (M - j) / s; return j === s + 1 ? 0 : (j < s + 1 ? -inner : inner); };
    const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r, v = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(remap(p.getX(i), w / 2), remap(p.getY(i), h / 2), remap(p.getZ(i), d / 2));
      c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
      v.sub(c); if (v.lengthSq() < 1e-12) v.set(0, 1, 0); v.normalize();
      n.setXYZ(i, v.x, v.y, v.z); p.setXYZ(i, c.x + v.x * r, c.y + v.y * r, c.z + v.z * r);
    }
    return g;
  }
  // junta normais de vértices na mesma posição (costuras) depois de deformar uma malha
  function smoothSeams(g) {
    g.computeVertexNormals(); const p = g.attributes.position, n = g.attributes.normal, map = new Map();
    for (let i = 0; i < p.count; i++) { const k = Math.round(p.getX(i) * 500) + ',' + Math.round(p.getY(i) * 500) + ',' + Math.round(p.getZ(i) * 500); if (!map.has(k)) map.set(k, []); map.get(k).push(i); }
    map.forEach(ix => { if (ix.length < 2) return; let x = 0, y = 0, z = 0; ix.forEach(i => { x += n.getX(i); y += n.getY(i); z += n.getZ(i); }); const l = Math.hypot(x, y, z) || 1; ix.forEach(i => n.setXYZ(i, x / l, y / l, z / l)); });
    return g;
  }

  // ---------- agrupamento de geometria estática por material (reduz MUITO as chamadas de desenho) ----------
  // Junta todas as malhas paradas dentro de "root" que usam o mesmo material numa malha só.
  // Objetos marcados com userData.dynamic (ou dentro de um grupo marcado) ficam de fora.
  // space 'local': o resultado fica no espaço do root (para peças do kart que se movem juntas).
  function mergeByMaterial(root, opts) {
    opts = opts || {}; root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), buckets = new Map(), victims = [];
    // materiais equivalentes (mesma cor/textura/flags) entram no mesmo grupo; os marcados como "unique"
    // (mudam de cor durante o jogo: semáforos, luzes do pórtico, cor do kart) ficam separados
    const texSig = t => t ? (t.image ? (t.image.__sid || (t.image.__sid = ++mergeByMaterial.sid)) : t.uuid) + ':' + t.repeat.x.toFixed(3) + ':' + t.repeat.y.toFixed(3) + ':' + t.wrapS + ':' + t.offset.x + ':' + t.offset.y : '-';
    const sig = m => (m.userData && m.userData.unique) || (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile && !(m.userData && m.userData.mergeKey)) ? m.uuid
      : [m.userData && m.userData.mergeKey, m.type, m.color && m.color.getHex(), m.emissive && m.emissive.getHex(), m.emissiveIntensity, texSig(m.map), texSig(m.emissiveMap), m.transparent, m.opacity, m.side, m.flatShading, m.vertexColors, m.alphaTest, m.polygonOffset, m.polygonOffsetUnits, m.depthWrite, m.blending, m.shininess, m.roughness, m.metalness, m.envMapIntensity, m.envMap && m.envMap.uuid, m.normalMap && m.normalMap.uuid].join('|');
    const canon = new Map();
    const isDyn = o => { for (let p = o; p && p !== root; p = p.parent) if (p.userData && p.userData.dynamic) return true; return false; };
    root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || !o.visible || isDyn(o) || (opts.skip && opts.skip(o))) return;
      const g = o.geometry; if (!g || !g.attributes.position || g.morphAttributes.position) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : g.attributes.position.count, materialIndex: 0 }];
      const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), NM = new THREE.Matrix3().getNormalMatrix(M);
      groups.forEach(gr => { let m = mats[gr.materialIndex] || mats[0]; if (!m) return;
        const ms = sig(m); if (!canon.has(ms)) canon.set(ms, m); m = canon.get(ms);
        const key = m.uuid + '|' + o.castShadow + '|' + o.receiveShadow + '|' + o.renderOrder;
        if (!buckets.has(key)) buckets.set(key, { m, cast: o.castShadow, recv: o.receiveShadow, ro: o.renderOrder, parts: [] });
        buckets.get(key).parts.push({ g, M, NM, start: gr.start, count: gr.count }); });
      victims.push(o);
    });
    victims.forEach(o => o.parent && o.parent.remove(o));
    const v = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), CELL = opts.cell || 0, meshes = [];
    // opts.cell (metros): em vez de UMA malha por material para o mapa inteiro, cria uma malha por material E por quadrado do mapa.
    // Cada bloco tem a própria esfera envolvente, então o Three.js descarta (frustum culling) o que está fora da câmera
    // e também fora da área de sombra. Sem opts.cell o comportamento é o antigo (karts e pilotos usam assim).
    buckets.forEach(b => {
      const cells = new Map();   // chave do quadrado -> lista de triângulos {p: parte, k: índice do 1º vértice}
      b.parts.forEach(p => {
        const idx = p.g.index, P = p.g.attributes.position, tri = p.count - (p.count % 3);
        for (let k = 0; k < tri; k += 3) {
          let key = 0;
          if (CELL) {
            const i0 = idx ? idx.getX(p.start + k) : p.start + k, i1 = idx ? idx.getX(p.start + k + 1) : p.start + k + 1, i2 = idx ? idx.getX(p.start + k + 2) : p.start + k + 2;
            v.fromBufferAttribute(P, i0).applyMatrix4(p.M); v2.fromBufferAttribute(P, i1).applyMatrix4(p.M); v3.fromBufferAttribute(P, i2).applyMatrix4(p.M);
            key = Math.floor((v.x + v2.x + v3.x) / 3 / CELL) * 100003 + Math.floor((v.z + v2.z + v3.z) / 3 / CELL);
          }
          let L = cells.get(key); if (!L) cells.set(key, L = []); L.push(p, k);
        }
      });
      cells.forEach(L => {
        const n = L.length / 2 * 3;
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), useCol = !!b.m.vertexColors, col = useCol ? new Float32Array(n * 3) : null;
        let w = 0;
        for (let t = 0; t < L.length; t += 2) {
          const p = L[t], k0 = L[t + 1], ga = p.g.attributes, idx = p.g.index, P = ga.position, Nn = ga.normal, U = ga.uv, C = ga.color;
          for (let k = k0; k < k0 + 3; k++) {
            const i = idx ? idx.getX(p.start + k) : p.start + k;
            v.fromBufferAttribute(P, i).applyMatrix4(p.M); pos[w * 3] = v.x; pos[w * 3 + 1] = v.y; pos[w * 3 + 2] = v.z;
            if (Nn) { v.fromBufferAttribute(Nn, i).applyMatrix3(p.NM).normalize(); nor[w * 3] = v.x; nor[w * 3 + 1] = v.y; nor[w * 3 + 2] = v.z; } else nor[w * 3 + 1] = 1;
            if (U) { uv[w * 2] = U.getX(i); uv[w * 2 + 1] = U.getY(i); }
            if (useCol) { if (C) { col[w * 3] = C.getX(i); col[w * 3 + 1] = C.getY(i); col[w * 3 + 2] = C.getZ(i); } else { col[w * 3] = col[w * 3 + 1] = col[w * 3 + 2] = 1; } }
            w++;
          }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        if (useCol) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, b.m); mesh.castShadow = b.cast; mesh.receiveShadow = b.recv; mesh.renderOrder = b.ro; mesh.userData.merged = true; root.add(mesh); meshes.push(mesh);
      });
    });
    return { before: victims.length, after: meshes.length, meshes };
  }
  mergeByMaterial.sid = 0;
  window.GEO = { rbox, smoothSeams, mergeByMaterial };

  // ---------- partículas (pool por cena) — estilo desenho animado ----------
  // fumaça = nuvens fofas realistas (js/smoke.js, estilo Party Animals; a mesma do giro da banana), faíscas = estrelinhas,
  // brilho do turbo = sprites aditivos, marcas de pneu = traços escuros instanciados no chão.
  let glowTexCache = null, softTexCache = null, puffTexCache = null, starTexCache = null;
  const Fx = {
    glowTex() { if (!glowTexCache) glowTexCache = new THREE.CanvasTexture(TX.canvas('glow')); return glowTexCache; },
    softTex() { if (!softTexCache) softTexCache = new THREE.CanvasTexture(TX.canvas('soft')); return softTexCache; },
    puffTex() { if (!puffTexCache) puffTexCache = new THREE.CanvasTexture(TX.canvas('puff')); return puffTexCache; },
    starTex() { if (!starTexCache) starTexCache = new THREE.CanvasTexture(TX.canvas('star')); return starTexCache; },
    // faísca: risco de luz alongado (núcleo branco fino + brilho em volta), esticado na direção do movimento
    sparkTex() { if (!this._sparkT) { const c = document.createElement('canvas'); c.width = 32; c.height = 128; const x = c.getContext('2d');
        const g = x.createRadialGradient(16, 64, 0, 16, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,.85)'); g.addColorStop(0.5, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.save(); x.translate(16, 64); x.scale(0.25, 1); x.translate(-16, -64); x.fillStyle = g; x.fillRect(-64, 0, 160, 128); x.restore();
        this._sparkT = new THREE.CanvasTexture(c); }
      return this._sparkT; },
    // labareda: vários "caroços" macios sobrepostos (borda irregular, como chama de verdade)
    fireTex() { if (!this._fireT) { const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
        let sd = 5; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
        x.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 14; i++) { const a = rnd() * 6.28, d = rnd() * 22, bx = 64 + Math.cos(a) * d, by = 66 + Math.sin(a) * d * 1.2 - 4, r = 14 + rnd() * 22;
          const g = x.createRadialGradient(bx, by, 0, bx, by, r); g.addColorStop(0, 'rgba(255,255,255,.8)'); g.addColorStop(0.5, 'rgba(255,255,255,.32)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = g; x.fillRect(0, 0, N, N); }
        x.globalCompositeOperation = 'destination-in'; const e = x.createRadialGradient(64, 64, 30, 64, 64, 63); e.addColorStop(0, 'rgba(0,0,0,1)'); e.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = e; x.fillRect(0, 0, N, N);
        this._fireT = new THREE.CanvasTexture(c); }
      return this._fireT; },
    init(scene) {
      const pool = (n, additive, tex) => { const a = []; for (let i = 0; i < n; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })); s.visible = false; scene.add(s); a.push({ s, v: new THREE.Vector3(), l: 0, ml: 1, s0: 1, s1: 2, o: 0.5, up: 0, rot: 0 }); } return { a, i: 0 }; };
      // a fumaça agora é a do js/smoke.js (realista); o pool antigo só existe se o smoke.js não estiver carregado
      this.smoke = pool(window.Smoke ? 0 : 160, false, this.puffTex()); this.glow = pool(140, true, this.softTex());
      if (window.Smoke) Smoke.init(scene);
      this.box = []; this.boxI = 0;
      for (let i = 0; i < 160; i++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sparkTex(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); m.visible = false; scene.add(m); this.box.push({ m, v: new THREE.Vector3(), l: 0, ml: 1, s: 0.2, c: new THREE.Color() }); }
      this.fire = []; this.fireI = 0;
      for (let i = 0; i < 140; i++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.fireTex(), color: 0xffffff, transparent: true, depthWrite: false })); /* mistura normal: a cor da chama aparece (somar luz deixava tudo branco) */ m.visible = false; scene.add(m); this.fire.push({ m, v: new THREE.Vector3(), l: 0, ml: 1, s: 1, rot: 0, smoked: false }); }
      this._sp = new THREE.Vector3(); this._sp2 = new THREE.Vector3(); this._hot = new THREE.Color(1, 1, 1); this._fc = new THREE.Color();
      // marcas de pneu: 700 traços reaproveitados em anel (os mais antigos somem primeiro)
      const SK = 700, sg = new THREE.PlaneGeometry(0.504, 1).rotateX(-Math.PI / 2);
      this.skids = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0x2a2a2e, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilRef: 1, stencilZPass: THREE.ReplaceStencilOp }), SK);   // stencil: cada pixel é pintado uma vez só -> o traço fica contínuo, sem faixas escuras nas emendas
      const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < SK; i++) this.skids.setMatrixAt(i, z);
      this.skids.frustumCulled = false; this.skids.renderOrder = -1;   // marcas desenhadas ANTES da fumaça (ordem 0): a fumaça passa por cima do borrachão
      scene.add(this.skids); this.skidI = 0; this._d = new THREE.Object3D();
    },
    rate: 1,   // partículas: 1 = normal, < 1 = menos (configurações)
    puff(kind, x, y, z, vx, vy, vz, col, s0, s1, life, op, up) {
      if (this.rate < 1 && Math.random() > this.rate) return;
      if (kind === 'smoke' && window.Smoke) {   // fumaça realista: mesmos parâmetros de antes (posição, velocidade, cor, tamanho inicial/final, duração, opacidade, subida)
        Smoke.puff({ x, y, z, vx, vy, vz, tint: col, size: s0, grow: s1 / Math.max(0.05, s0), life, opacity: Math.min(1, op * 1.6), up: up || 0 }); return;
      }
      const pool = this[kind], p = pool.a[pool.i++ % pool.a.length];
      p.s.position.set(x, y, z); p.v.set(vx, vy, vz); p.s.material.color.setHex(col); p.s0 = s0; p.s1 = s1; p.l = p.ml = life; p.o = kind === 'smoke' ? Math.min(1, op * 1.6) : op; p.up = up || 0; p.s.visible = true;
      p.s.material.rotation = Math.random() * 6.28; p.rot = (Math.random() - 0.5) * 2;
    },
    spark(x, y, z, vx, vy, vz, c, sz, l) { if (this.rate < 1 && Math.random() > this.rate) return; const p = this.box[this.boxI++ % this.box.length]; p.m.position.set(x, y, z); p.v.set(vx, vy, vz); p.c.set(c); p.s = sz; p.l = p.ml = l * (0.8 + Math.random() * 0.5); p.m.visible = true; },
    // labareda do turbo: nasce branco-amarelada, vira laranja -> vermelho, sobe tremulando e termina em fumaça escura
    flame(x, y, z, vx, vy, vz, size, life) {
      if (this.rate < 1 && Math.random() > this.rate) return; if (!this.fire) return;
      const p = this.fire[this.fireI++ % this.fire.length]; p.m.position.set(x, y, z); p.v.set(vx, vy, vz); p.s = size; p.l = p.ml = life * (0.8 + Math.random() * 0.4);
      p.rot = (Math.random() - 0.5) * 6; p.m.material.rotation = Math.random() * 6.28; p.smoked = false; p.m.visible = true;
      if (Math.random() < 0.5) this.puff('glow', x, y, z, vx * 0.6, vy * 0.5, vz * 0.6, 0xffc060, size * 0.55, size * 0.25, 0.14, 0.55);   // núcleo quente (luz somada, bem curtinho)
    },
    // um traço de marca de pneu de (x0,z0) até (x1,z1), na altura y
    skid(x0, z0, x1, z1, y) {
      if (!this.skids) return; const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz); if (L < 0.05 || L > 4) return;
      const d = this._d; d.position.set((x0 + x1) / 2, y + 0.06, (z0 + z1) / 2); d.rotation.set(0, Math.atan2(dx, dz), 0); d.scale.set(1, 1, L + 0.3); d.updateMatrix();
      this.skids.setMatrixAt(this.skidI++ % this.skids.count, d.matrix); this.skids.instanceMatrix.needsUpdate = true;
    },
    step(dt) {
      if (window.Smoke) Smoke.update(dt);
      ['smoke', 'glow'].forEach(k => this[k].a.forEach(p => {
        if (p.l <= 0) return; p.l -= dt; if (p.l <= 0) { p.s.visible = false; return; }
        const t = 1 - p.l / p.ml; p.v.multiplyScalar(Math.max(0, 1 - 2.2 * dt)); p.v.y += p.up * dt; p.s.position.addScaledVector(p.v, dt);
        // nuvem "estoura" para fora (cresce rápido no começo) e some encolhendo no final
        const g = k === 'smoke' ? (t < 0.25 ? p.s0 + (p.s1 - p.s0) * (t / 0.25) * 0.85 : p.s1 * (1 - Math.max(0, t - 0.7) / 0.3 * 0.7)) : p.s0 + (p.s1 - p.s0) * t;
        p.s.scale.setScalar(Math.max(0.01, g)); p.s.material.rotation += p.rot * dt;
        p.s.material.opacity = k === 'smoke' ? p.o * (t > 0.75 ? (1 - t) / 0.25 : 1) : p.o * (1 - t) * (t < 0.12 ? t / 0.12 : 1);
      }));
      const cam = this.cam;
      this.box.forEach(p => { if (p.l <= 0) return; p.l -= dt; if (p.l <= 0) { p.m.visible = false; return; }
        p.v.multiplyScalar(Math.max(0, 1 - 1.4 * dt)); p.v.y -= 16 * dt; p.m.position.addScaledVector(p.v, dt);
        const t = 1 - p.l / p.ml, w = p.s * 1.25 * (1 - t * 0.6);
        // cor: branco-quente no começo, esfria para a cor da faísca; brilho some no fim (com uma piscadinha)
        p.m.material.color.copy(this._hot).lerp(p.c, Math.min(1, t * 2.2)); p.m.material.opacity = Math.pow(1 - t, 1.2) * (0.85 + Math.random() * 0.15);
        // estica na direção do movimento na tela (risco de luz)
        let len = w * 2.2;
        if (cam) { const a = this._sp.copy(p.m.position).project(cam), b = this._sp2.copy(p.m.position).addScaledVector(p.v, 0.03).project(cam);
          const dx = (b.x - a.x) * cam.aspect, dy = b.y - a.y, sl = Math.hypot(dx, dy);
          p.m.material.rotation = Math.atan2(dy, dx) - Math.PI / 2; len = w * 2.2 + Math.min(4, sl * 60) * w * 2.5; }
        p.m.scale.set(w * 0.55, len, 1); });
      if (this.fire) this.fire.forEach(p => { if (p.l <= 0) return; p.l -= dt; if (p.l <= 0) { p.m.visible = false; return; }
        const t = 1 - p.l / p.ml, f = this._fc;
        // rampa de cor do fogo: branco-amarelo -> amarelo -> laranja -> vermelho escuro
        const ramp = [[0, 1, 0.95, 0.6], [0.12, 1, 0.74, 0.12], [0.32, 1, 0.4, 0.03], [0.58, 0.9, 0.14, 0.02], [0.82, 0.28, 0.1, 0.08], [1, 0.16, 0.14, 0.14]];
        let k = 1; while (k < ramp.length - 1 && t > ramp[k][0]) k++; const A = ramp[k - 1], B = ramp[k], u = Math.min(1, (t - A[0]) / (B[0] - A[0]));
        f.setRGB(A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u, A[3] + (B[3] - A[3]) * u);
        p.m.material.color.copy(f); p.m.material.opacity = Math.min(1, 1.5 * (t < 0.08 ? t / 0.08 : 1) * Math.pow(1 - t, 0.9) * (0.82 + Math.random() * 0.18));   // tremula
        p.v.multiplyScalar(Math.max(0, 1 - 3 * dt)); p.v.y += 4.5 * dt; p.v.x += (Math.random() - 0.5) * 6 * dt; p.v.z += (Math.random() - 0.5) * 6 * dt;   // sobe com turbulência
        p.m.position.addScaledVector(p.v, dt); p.m.material.rotation += p.rot * dt; p.m.scale.setScalar(p.s * (0.4 + t * 0.9));
        // a chama vira fumaça escura no fim
        if (!p.smoked && t > 0.6) { p.smoked = true; if (window.Smoke && Math.random() < 0.55) Smoke.puff({ x: p.m.position.x, y: p.m.position.y + 0.2, z: p.m.position.z, vx: p.v.x * 0.5, vy: 1 + Math.random(), vz: p.v.z * 0.5, size: p.s * 0.8, grow: 2.6, life: 0.9, tint: 0x4a4644, opacity: 0.55, up: 1.2 }); } });
    }
  };
  window.Fx = Fx;

  // ---------- entrada do jogador: teclado e botões de toque ----------
  const Input = {
    keys: {},
    map: { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'drift', ShiftLeft: 'drift', ShiftRight: 'drift',
      ControlLeft: 'wheelie', ControlRight: 'wheelie',   // Ctrl: dar grau com a moto (a tecla E agora usa o item: items.js)
      KeyC: 'look' },                                                     // C (segurando): olhar para trás
    init() {
      addEventListener('keydown', e => { const k = this.map[e.code]; if (k) { this.keys[k] = true; if (window.Game && Game.scene && !/INPUT|TEXTAREA/.test(e.target.tagName)) e.preventDefault(); } });
      addEventListener('keyup', e => { const k = this.map[e.code]; if (k) this.keys[k] = false; });
      addEventListener('blur', () => { this.keys = {}; });
      document.querySelectorAll('#touch button').forEach(b => {
        const k = b.dataset.k;
        b.addEventListener('pointerdown', e => { this.keys[k] = true; e.preventDefault(); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => { this.keys[k] = false; }));
      });
    },
    read() { const k = this.keys; return { up: !!k.up, down: !!k.down, steer: (k.left ? 1 : 0) - (k.right ? 1 : 0), drift: !!k.drift, wheelie: !!k.wheelie }; }
  };
  window.Input = Input;

  // ---------- física ----------
  const P = CFG.PHYS;
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
  const _w = new THREE.Vector3(), _w2 = new THREE.Vector3();

  class Kart {
    // spec = { model, color, decal, decalColor, number, suit, helmet, skin, accessory } (ver CFG.DEFAULT_SPEC)
    constructor(scene, spec, opts) {
      this.spec = spec; this.m = buildKartModel(spec, { lights: !!opts.player }); scene.add(this.m.group);
      this.name = opts.name; this.isPlayer = !!opts.player;
      this.events = opts.events || (() => {});
      this.pos = this.m.group.position;
    }
    // coloca o kart parado no grid: nó da pista e deslocamento lateral
    place(track, idx, lat) {
      this.track = track;
      const i = (idx + track.N) % track.N, p = track.side(i, lat, 0);
      this.pos.set(p.x, track.roadBase, p.z);
      this.ang = this.mvAng = this.camAng = Math.atan2(track.T[i].x, track.T[i].z);
      this.speed = 0; this.idx = i; this.prevIdx = i; this.frac = 0; this.lap = 0; this.finished = false; this.finishTime = 0;
      this.boostT = 0; this.drifting = false; this.driftDir = 0; this.driftT = 0; this.driftSteer = 0; this.hopT = 0; this.slip = 0;
      this.steerVis = 0; this.onPadPrev = false; this.air = false; this.vy = 0; this.vyG = 0; this.squash = 0; this.bumpCool = 0;
      this.smokeCD = 0; this.trailCD = 0; this.off = false; this.wet = false; this.stuckT = 0; this.coins = 0; this.railSide = null;
      this.pushX = 0; this.pushZ = 0; this.yawV = 0; this.hitRoll = 0; this.hitRollV = 0; this.hitCool = 0; this.wheelT = 0;
      this.driftCharge = 0; this.driftRot = 0; this.driftCD = 0; this.mtCool = 0;   // reação às batidas (empurrão, giro e balanço)
      this.m.group.rotation.set(0, this.ang, 0); this.m.body.rotation.set(0, 0, 0); this.m.body.position.y = 0;
      this.m.flames.forEach(f => f.visible = false);
    }
    get rel() { return (this.idx - this.track.startIdx + this.track.N) % this.track.N; }
    get progress() { return this.lap * this.track.N + this.rel + this.frac; }

    update(dt, inp, racing) {
      const tr = this.track, N = tr.N, W = tr.W;
      const up = racing && inp.up && !this.finished, down = racing && inp.down && !this.finished;
      const steer = racing && !this.finished ? inp.steer : (this.finished ? inp.steer * 0.5 : 0);
      // posição na pista
      const near = tr.nearest(this.pos, this.idx);
      this.prevIdx = this.idx; this.idx = near.i; this.frac = near.f;
      const off = this.off = near.dist > W + 1.6 && !this.air;
      // plataformas de boost
      const padNow = racing && !this.finished && !this.air && tr.onPad(this.pos);
      if (padNow && !this.onPadPrev) { this.boostT = 1.6; this.speed = Math.max(this.speed, P.MAX * 1.05); this.events('boost', this); }
      this.onPadPrev = padNow; if (padNow) this.boostT = Math.max(this.boostT, 1.0);
      if (this.boostT > 0) this.boostT -= dt;
      const boosting = this.boostT > 0 && !off;
      // velocidade
      // GRAU (só moto): segurando Ctrl em linha reta a moto empina; empinada de vez dá +6% de velocidade máxima,
      // mas a direção fica bem mais fraca e não dá para derrapar. Frear, derrapar, sair da pista ou bater desfaz.
      const wantW = !!(this.m.moto && inp.wheelie && racing && !this.finished && !this.air && !this.drifting && !this.off && this.speed > 10 && !inp.down);
      this.wheelT = Math.max(0, Math.min(1, (this.wheelT || 0) + (wantW ? dt * 2.2 : -dt * 3.2)));
      const MAXE = P.MAX * (1 + 0.012 * this.coins) * (this.topScale || 1) * (this.wheelT > 0.9 ? 1.06 : 1);
      const top = boosting ? MAXE * 1.5 : MAXE, maxF = off ? P.MAX * 0.38 : P.MAX;
      if (!this.air) {
        if (up) this.speed += (this.speed < 0 ? P.BRAKE : P.ACC) * dt;
        else if (down) this.speed -= (this.speed > 0 ? P.BRAKE : P.ACC * 0.7) * dt;
        else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), (off ? 18 : 6) * dt);
        if (off && this.speed > maxF) this.speed -= (this.speed - maxF) * Math.min(1, 3 * dt);
      }
      if (boosting && !this.finished) this.speed += P.ACC * 2.2 * dt;
      else if (this.speed > MAXE && !off) this.speed -= (this.speed - MAXE) * Math.min(1, 1.6 * dt);
      this.speed = Math.max(-P.MAXREV, Math.min(top, this.speed));
      // drift (segura o botão numa curva; solta para o mini-turbo)
      const wet = this.wet = !this.air && tr.inWater(this.pos), wantD = racing && inp.drift && !this.finished && !((this.wheelT || 0) > 0.3);
      if (this.driftCD > 0) this.driftCD -= dt;
      if (this.mtCool > 0) this.mtCool -= dt;
      // DRIFT SÓ COM ESTERÇO ATIVO: precisa da tecla de drift (Espaço/Shift) E de A/D (ou setas) pressionados no
      // mesmo instante. Em reta, sem virar, a tecla de drift é ignorada por completo (sem pulinho, sem faísca, sem carga).
      const steering = Math.abs(steer) > 0.5;
      if (!this.drifting && wantD && steering && this.speed > 14 && !wet && !(this.driftCD > 0)) { this.drifting = true; this.driftDir = Math.sign(steer); this.driftSteer = steer; this.driftT = 0; this.driftCharge = 0; this.driftRot = 0; this.hopT = 0.25; this.events('driftStart', this); }
      if (this.drifting && (!wantD || this.speed < 10 || wet)) {
        // ANTI-ABUSO: o mini-turbo só sai de curva de verdade. Precisa de CARGA (que só cresce rápido quando a
        // pista curva de fato) E de GIRO real do kart. Depois de um mini-turbo há 2 s em que a carga cresce bem
        // devagar, e um novo drift só começa 0,35 s depois de soltar -> "spammar" drift em reta não rende nitro.
        const lvl = this.driftLevel();
        if (lvl > 0) { this.boostT = Math.max(this.boostT, lvl === 2 ? 1.3 : 0.8); this.speed = Math.max(this.speed, Math.min(P.MAX * 1.02, this.speed + 7)); this.mtCool = 2.0; this.events('miniTurbo', this); }
        this.drifting = false; this.driftCD = 0.35;
      }
      let turn = steer * P.TURN * (1 - 0.3 * Math.min(1, Math.abs(this.speed) / P.MAX)) * (1 - 0.45 * (this.wheelT || 0));
      if (this.drifting) {
        // drift = arco de raio definido (dentro ~38 m, neutro ~62 m, fora ~120 m)
        this.driftSteer += (steer - this.driftSteer) * Math.min(1, 7 * dt);
        const rel = this.driftSteer * this.driftDir;
        const Rd = rel >= 0 ? P.DRIFT_R_MID - rel * (P.DRIFT_R_MID - P.DRIFT_R_IN) : P.DRIFT_R_MID - rel * (P.DRIFT_R_OUT - P.DRIFT_R_MID);
        turn = this.driftDir * Math.min(1.5, Math.abs(this.speed) / Rd);
        const corner = tr.cornerAt ? tr.cornerAt(this.idx) : 1;
        const rate = (rel > 0.3 ? 1.3 : 1) * (0.1 + 0.9 * corner) * (this.mtCool > 0 ? 0.3 : 1) * (this.boostT > 0 ? 0.5 : 1);
        this.driftT += dt; this.driftCharge = (this.driftCharge || 0) + dt * rate;
        this.driftRot = (this.driftRot || 0) + Math.abs(turn * dt * Math.max(-1, Math.min(1, this.speed / 10)));
        this.speed -= 3 * dt;
        if (Math.random() < 0.6) { const lv = this.driftLevel(), sc = lv === 2 ? 0xff8a1a : lv === 1 ? 0x4aa8ff : 0xfff2b0;   // faísca branca = sem carga
          for (let k = 0; k < 2; k++) { const R = this.m.rear, w = this.m.group.localToWorld(_w.set(k ? R.x : -R.x, 0.2, R.z)); Fx.spark(w.x, w.y, w.z, (Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5, sc, 0.22, 0.35); } }
      }
      if (this.air) turn *= 0.35;                                       // pouco controle no ar
      this.ang += turn * dt * Math.max(-1, Math.min(1, this.speed / 10));
      const dA = wrapA(this.ang - this.mvAng);
      if (this.drifting || Math.abs(dA) > 0.08) this.mvAng += dA * Math.min(1, (this.drifting ? 7 : 9) * dt); else this.mvAng = this.ang;
      if (wet) { this.speed -= this.speed * 1.8 * dt; if (Math.abs(this.speed) > 4) for (let k = 0; k < 2; k++) Fx.spark(this.pos.x + (Math.random() - 0.5) * 3, this.pos.y + 0.3, this.pos.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4, 3 + Math.random() * 4, (Math.random() - 0.5) * 4, 0xcfefff, 0.25, 0.7); }
      this.pos.x += Math.sin(this.mvAng) * this.speed * dt;
      this.pos.z += Math.cos(this.mvAng) * this.speed * dt;
      // batidas: empurrão (velocidade externa que perde força com o atrito) e giro, somados ao movimento do kart
      if (this.pushX || this.pushZ) { this.pos.x += this.pushX * dt; this.pos.z += this.pushZ * dt; const f = Math.max(0, 1 - (off ? 5.5 : 3.6) * dt); this.pushX *= f; this.pushZ *= f;
        if (Math.abs(this.pushX) + Math.abs(this.pushZ) < 0.05) this.pushX = this.pushZ = 0; }
      if (this.yawV) { this.ang += this.yawV * dt; this.mvAng += this.yawV * dt * 0.7; this.yawV *= Math.max(0, 1 - 4.2 * dt); if (Math.abs(this.yawV) < 0.01) this.yawV = 0; }
      if (this.hitCool > 0) this.hitCool -= dt;
      this.collideWalls(dt);
      // altura: pista (pontes), rampas, terreno; saltos com gravidade
      const gr = tr.groundAt(this.pos, this.idx, this.ang);        // a direção do kart define o sinal da inclinação
      if (this.air) {
        this.vy -= P.GRAV * dt; this.pos.y += this.vy * dt;
        if (this.pos.y <= gr.h) { const impact = -this.vy; this.pos.y = gr.h; this.air = false; this.vy = 0; if (impact > 5) { this.squash = Math.min(0.35, impact * 0.025); this.events('land', this); } }
      } else if (gr.h < this.pos.y - 0.35 && this.speed > 8 && !gr.soft) {   // o chão "sumiu" (fim de rampa de salto): decola
        this.air = true; this.vy = Math.max(0, this.vyG); this.drifting = false;
      } else {
        // física da ponte (como na versão original):
        //  * em cima da pista, o kart segue EXATAMENTE o perfil contínuo da ponte (sem atraso, sem degraus nos nós)
        //  * saindo pela lateral da ponte, desce suave até o chão (decai ~10/s) em vez de "decolar"
        //  * grama, zebra e água: transição suave de altura
        let ny;
        if (gr.exact) ny = gr.h;
        else if (gr.soft) ny = this.pos.y + (gr.h - this.pos.y) * Math.min(1, 10 * dt);
        else ny = Math.abs(gr.h - this.pos.y) > 0.3 ? gr.h : this.pos.y + (gr.h - this.pos.y) * Math.min(1, 18 * dt);
        this.vyG = this.vyG * 0.5 + 0.5 * (ny - this.pos.y) / Math.max(dt, 1e-3); this.pos.y = ny;
      }
      // voltas (cruzar a linha de chegada para frente/para trás)
      const r0 = (this.prevIdx - tr.startIdx + N) % N, r1 = (this.idx - tr.startIdx + N) % N;
      if (r0 > N * 0.85 && r1 < N * 0.15) { this.lap++; this.events('lap', this); }
      else if (r0 < N * 0.15 && r1 > N * 0.85) this.lap--;
      this.pose(dt, steer, boosting, off, wet, gr);
      // preso? volta para o centro da pista
      if (racing && !this.finished && Math.abs(this.speed) < 2 && (inp.up || inp.down)) this.stuckT += dt; else this.stuckT = 0;
      if (this.stuckT > 3) this.respawn();
    }

    // parte visual (poses, rodas, piloto, chamas, fumaça): usada pela física local E pelos karts de rede
    pose(dt, steer, boosting, off, wet, gr) {
      const g = this.m.group, b = this.m.body;
      this.m.flames.forEach(f => { f.visible = boosting; f.scale.set(1, 0.8 + Math.random() * 0.7, 1); });
      g.rotation.order = 'YXZ'; g.rotation.y = this.ang;
      const tp = this.air ? Math.max(-0.35, Math.min(0.3, -this.vy * 0.03)) : (off || wet ? 0 : -Math.atan(gr.slope || 0));
      g.rotation.x += (tp - g.rotation.x) * Math.min(1, 10 * dt);
      this.steerVis += (steer - this.steerVis) * Math.min(1, 10 * dt);
      this.slip += ((this.drifting ? this.driftDir * (0.3 + 0.12 * Math.max(0, this.driftSteer * this.driftDir)) : 0) - this.slip) * Math.min(1, 8 * dt);
      this.m.pivot.rotation.y = this.slip;                       // gira carroceria E rodas juntas
      // esterço visual limitado a ±0,42 rad: mais que isso o pneu encostaria no capô/laterais
      this.m.fw.forEach(w => w.rotation.y = Math.max(-0.42, Math.min(0.42, this.steerVis * 0.45 + (this.drifting ? -this.driftDir * 0.2 : 0))));
      this.m.rolls.forEach(w => w.g.rotation.x += this.speed * dt / w.r);
      // inclinação: kart rola para fora da curva; a motoca deita para dentro (gira rodas + carroceria juntas)
      const roll = this.m.lean * this.steerVis * Math.min(1, Math.abs(this.speed) / P.MAX) + (this.drifting ? this.driftDir * (this.m.moto ? 0.25 : -0.1) : 0);
      // balanço da batida: mola amortecida (o kart "chacoalha" para o lado do empurrão e volta)
      this.hitRollV += (-this.hitRoll * 90 - this.hitRollV * 9) * dt; this.hitRoll += this.hitRollV * dt;
      if (this.m.moto) { this.m.pivot.rotation.z += (-roll - this.m.pivot.rotation.z) * Math.min(1, 6 * dt); this.m.pivot.rotation.z += this.hitRoll * 0.6; b.rotation.z = 0;
        // grau: gira em torno do ponto de apoio da roda traseira (a traseira continua no chão)
        const w = this.wheelT || 0, th = -(0.42 * w * w * (3 - 2 * w)) + (w > 0.9 ? Math.sin(performance.now() / 140) * 0.025 : 0), rz = this.m.rear.z;
        this.m.pivot.rotation.x = th; this.m.pivot.position.set(0, rz * Math.sin(th), rz - rz * Math.cos(th)); } else b.rotation.z = roll + this.hitRoll;
      // volante/guidão e piloto (inclina o corpo e olha para dentro da curva)
      this.m.animate(dt, { steer: this.steerVis, speed: Math.min(1, Math.abs(this.speed) / P.MAX), boost: boosting, drift: this.drifting ? this.driftDir : 0, air: this.air });
      if (this.hopT > 0) this.hopT -= dt;
      this.squash *= Math.max(0, 1 - 8 * dt);
      b.scale.set(1 + this.squash * 0.5, 1 - this.squash, 1 + this.squash * 0.3);
      b.position.y = (off && !wet ? Math.sin(performance.now() / 35) * 0.05 : 0) + (this.hopT > 0 ? Math.sin(this.hopT / 0.25 * Math.PI) * 0.35 : 0);
      this.m.blob.position.y = (gr.h - this.pos.y) / 0.8 + 0.03; this.m.blob.material.opacity = this.air ? 0.1 : 0.16;
      this.tireFx(dt);
    }

    // kart de outro jogador (online): recebe o estado interpolado da rede e só anima
    applyNet(s, dt) {
      const tr = this.track, N = tr.N;
      this.pos.set(s.x, s.y, s.z); this.ang = s.ang; this.mvAng = s.mvAng; this.speed = s.speed;
      this.drifting = !!(s.flags & 1); this.driftDir = s.driftDir; this.air = !!(s.flags & 4); this.finished = !!(s.flags & 8);
      this.wheelT = Math.max(0, Math.min(1, (this.wheelT || 0) + ((s.flags & 16 ? 1 : 0) - (this.wheelT || 0)) * Math.min(1, dt * 6)));
      const lap = Math.floor(s.prog / N), rest = s.prog - lap * N, rel = Math.floor(rest);
      this.lap = lap; this.frac = rest - rel; this.prevIdx = this.idx; this.idx = (rel + tr.startIdx) % N;
      if (this.drifting) this.driftSteer = s.steer;
      const gr = tr.groundAt(this.pos, this.idx, this.ang), boosting = !!(s.flags & 2);
      this.pose(dt, s.steer, boosting, false, false, gr);
    }

    // nível do mini-turbo: carga (tempo ponderado pela curva da pista) + giro acumulado de verdade (radianos)
    driftLevel() { const c = this.driftCharge || 0, r = this.driftRot || 0; return c > 2.0 && r > 1.0 ? 2 : c > 0.95 && r > 0.5 ? 1 : 0; }

    respawn() {
      const tr = this.track, i = this.idx, p = tr.S[i];
      this.pos.set(p.x, tr.roadBase + tr.bump(i), p.z); this.ang = this.mvAng = Math.atan2(tr.T[i].x, tr.T[i].z); this.speed = 0; this.air = false; this.vy = 0; this.stuckT = 0; this.drifting = false; this.railSide = null;
    }

    // corredor invisível em volta da pista + limites do mapa
    collideWalls(dt) {
      const tr = this.track, p = this.pos; this.bumpCool -= dt;
      let bd = 1e9, bi = this.idx;
      for (let d = -30; d <= 30; d++) { const i = (this.idx + d + tr.N) % tr.N, dx = tr.S[i].x - p.x, dz = tr.S[i].z - p.z, q = dx * dx + dz * dz; if (q < bd) { bd = q; bi = i; } }
      const dist = Math.sqrt(bd); let hit = false, nx = 0, nz = 0;
      if (dist > tr.WALL) { nx = (p.x - tr.S[bi].x) / dist; nz = (p.z - tr.S[bi].z) / dist; p.x = tr.S[bi].x + nx * tr.WALL; p.z = tr.S[bi].z + nz * tr.WALL; hit = true; }
      if (Math.abs(p.x) > tr.BOUND) { const s = Math.sign(p.x); p.x = s * tr.BOUND; nx = s; nz = 0; hit = true; }
      if (Math.abs(p.z) > tr.BOUND) { const s = Math.sign(p.z); p.z = s * tr.BOUND; nx = 0; nz = s; hit = true; }
      const ob = tr.obstacleHit ? tr.obstacleHit(p) : null;          // obstáculos sólidos (prédios, postes...)
      if (ob) { p.x = ob.x; p.z = ob.z; nx = ob.nx; nz = ob.nz; hit = true; }
      // guarda-corpo das pontes: não deixa entrar nem sair do tabuleiro pela lateral
      if (tr.rail) { const r = tr.rail(p, this.idx, this.railSide); if (r) { if (r.hit) { p.x = r.hit.x; p.z = r.hit.z; nx = r.hit.nx; nz = r.hit.nz; hit = true; } this.railSide = r.side; } }
      if (!hit) return;
      const sg = this.speed < 0 ? -1 : 1, hx = Math.sin(this.mvAng) * sg, hz = Math.cos(this.mvAng) * sg, dot = hx * nx + hz * nz;
      if (dot <= 0) return;
      if (Math.abs(this.speed) * dot > 8 && this.bumpCool <= 0) {
        this.bumpCool = 0.3; this.events('bump', this);
        for (let k = 0; k < 8; k++) Fx.spark(p.x, p.y + 0.7, p.z, -nx * 5 + (Math.random() - 0.5) * 7, 2 + Math.random() * 4, -nz * 5 + (Math.random() - 0.5) * 7, 0xffe08a, 0.22, 0.45);
      }
      this.speed *= Math.max(0, 1 - Math.min(0.95, dot * 5 * dt));
      if (sg > 0) { let tx = -nz, tz = nx; if (tx * hx + tz * hz < 0) { tx = -tx; tz = -tz; } const tA = Math.atan2(tx, tz), k = Math.min(1, dot * 6 * dt); this.ang += wrapA(tA - this.ang) * k; this.mvAng += wrapA(tA - this.mvAng) * k; }
    }

    // fumaça nos pneus, poeira na grama/areia e rastro do boost
    tireFx(dt) {
      this.smokeCD -= dt; this.trailCD -= dt;
      const sp = Math.abs(this.speed), dark = 1 - 0.6 * (window.Env ? Env.nightF : 0), g = this.m.group;
      const shade = h => { const c = new THREE.Color(h); c.multiplyScalar(dark); return c.getHex(); };
      let mode = null;
      if (this.air) mode = null;
      else if (this.off && !this.wet && sp > 8) mode = 'dust';
      else if (this.drifting) mode = 'drift';
      else if (!this.off && !this.wet && Math.abs(this.steerVis) > 0.6 && sp > P.MAX * 0.62) mode = 'skid';
      // marcas de pneu (traço de desenho) enquanto derrapa no asfalto
      if ((mode === 'drift' || mode === 'skid') && !this.wet) {
        (this.m.moto ? [0] : [-1, 1]).forEach((s, i) => { const w = g.localToWorld(_w.set(s * this.m.rear.x, 0, this.m.rear.z)), last = this.skidLast || (this.skidLast = [null, null]);
          if (last[i]) Fx.skid(last[i].x, last[i].z, w.x, w.z, this.pos.y); last[i] = { x: w.x, z: w.z }; });
      } else this.skidLast = null;
      if (mode && this.smokeCD <= 0) {
        this.smokeCD = mode === 'drift' ? 0.035 : mode === 'dust' ? 0.06 : 0.07;   // mais fumaça (antes 0,07 / 0,11 / 0,14 s)
        const dustCol = this.track.dustColor || 0xc9a878;
        (this.m.moto ? [0] : [-1, 1]).forEach(s => {
          if (mode === 'drift' && s && s !== -this.driftDir && Math.random() < 0.5) return;
          const w = g.localToWorld(_w.set(s * this.m.rear.x, 0.15, this.m.rear.z)), back = -0.25 * this.speed;
          if (mode === 'dust') Fx.puff('smoke', w.x + (Math.random() - 0.5), w.y + 0.2, w.z + (Math.random() - 0.5), Math.sin(this.mvAng) * back + (Math.random() - 0.5) * 3, 1.2 + Math.random(), Math.cos(this.mvAng) * back + (Math.random() - 0.5) * 3, shade(dustCol), 0.9, 3.6, 0.9, 0.55, 0.6);
          else Fx.puff('smoke', w.x, w.y + 0.25, w.z, Math.sin(this.mvAng) * back * 0.4 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 0.8, Math.cos(this.mvAng) * back * 0.4 + (Math.random() - 0.5) * 2, shade(0xe6e8ee), 0.7, mode === 'drift' ? 3.4 : 2.4, mode === 'drift' ? 0.85 : 0.55, mode === 'drift' ? 0.6 : 0.38, 0.8);
        });
      }
      if (this.boostT > 0 && !this.off && this.trailCD <= 0) {
        this.trailCD = 0.016;
        (this.m.moto ? this.m.flames.slice(0, 1) : this.m.flames).forEach(f => { f.getWorldPosition(_w); if (this.m.moto && this.m.flames[1]) { this.m.flames[1].getWorldPosition(_w2); _w.add(_w2).multiplyScalar(0.5); }
          Fx.flame(_w.x + (Math.random() - 0.5) * 0.2, _w.y + (Math.random() - 0.5) * 0.15, _w.z + (Math.random() - 0.5) * 0.2, -Math.sin(this.mvAng) * (5 + Math.random() * 3), 0.6 + Math.random(), -Math.cos(this.mvAng) * (5 + Math.random() * 3), 0.95 + Math.random() * 0.4, 0.45);
          if (Math.random() < 0.5) Fx.puff('glow', _w.x, _w.y, _w.z, -Math.sin(this.mvAng) * 12, (Math.random() - 0.5) * 3, -Math.cos(this.mvAng) * 12, 0x7ad8ff, 0.45, 0.1, 0.5, 1);
        });
      }
    }

    // faróis acendem à noite
    setNight(nf) {
      if (Math.abs(nf - (this._nf === undefined ? -1 : this._nf)) < 0.01) return; this._nf = nf;
      this.m.setNight(nf);
      if (this.m.headL) this.m.headL.intensity = 1.1 * nf; this.m.headGlows.forEach(g => g.material.opacity = 0.95 * nf);
      this.m.headLens.forEach(l => l.material.color.setRGB(0.85 + 0.15 * nf, 0.82 + 0.18 * nf, 0.69 + 0.31 * nf));
    }

    dispose(scene) { scene.remove(this.m.group); this.m.dispose(); }
  }

  // ---------- colisão kart x kart ----------
  // Impulso entre dois círculos (raio CFG.PHYS.KART_RADIUS), com massa e coeficiente de restituição:
  //  * a parte do impulso na direção do kart vira ganho/perda de VELOCIDADE (batida de frente/traseira);
  //  * a parte lateral vira EMPURRÃO (pushX/pushZ, que perde força com o atrito) -> batendo de lado, o outro kart
  //    é jogado para o lado; quem bate também recua um pouco;
  //  * o ponto de contato ao longo do comprimento gera GIRO (yawV): pegar na traseira faz o outro rodar;
  //  * a carroceria balança (hitRoll) e saem faíscas no ponto da batida.
  // applyA/applyB: no online cada jogador só aplica a reação no PRÓPRIO kart (o outro recebe pela rede).
  const REST = 0.45, SIDE_GAIN = 1.45, MAX_PUSH = 24;
  function impulse(k, ix, iz, side, rx, rz) {
    const fx = Math.sin(k.mvAng), fz = Math.cos(k.mvAng), along = ix * fx + iz * fz;
    k.speed += along * (side ? 0.35 : 0.8); k.wheelT = (k.wheelT || 0) * 0.3;
    const lx = ix - fx * along, lz = iz - fz * along, g = side ? SIDE_GAIN : 1;
    k.pushX = (k.pushX || 0) + lx * g; k.pushZ = (k.pushZ || 0) + lz * g;
    const pm = Math.hypot(k.pushX, k.pushZ); if (pm > MAX_PUSH) { k.pushX *= MAX_PUSH / pm; k.pushZ *= MAX_PUSH / pm; }
    // giro: torque do impulso aplicado fora do centro (alavanca = posição do contato ao longo do kart)
    k.yawV = Math.max(-2.6, Math.min(2.6, (k.yawV || 0) + (rz * ix - rx * iz) * 0.16));
    // balanço lateral da carroceria (sinal = lado do empurrão em relação ao kart)
    const rgt = lx * Math.cos(k.mvAng) - lz * Math.sin(k.mvAng);
    k.hitRollV = (k.hitRollV || 0) + Math.max(-3, Math.min(3, rgt * 0.09));
  }
  Kart.resolve = function (a, b, applyA, applyB) {
    const R = CFG.PHYS.KART_RADIUS * 2, dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
    if (d >= R || d < 1e-4 || Math.abs(a.pos.y - b.pos.y) > 2) return null;
    const nx = dx / d, nz = dz / d, overlap = R - d, ia = 1 / (a.mass || 1), ib = 1 / (b.mass || 1), sum = ia + ib;
    if (applyA) { a.pos.x -= nx * overlap * ia / sum; a.pos.z -= nz * overlap * ia / sum; }
    if (applyB) { b.pos.x += nx * overlap * ib / sum; b.pos.z += nz * overlap * ib / sum; }
    const fax = Math.sin(a.mvAng), faz = Math.cos(a.mvAng), fbx = Math.sin(b.mvAng), fbz = Math.cos(b.mvAng);
    const vax = fax * a.speed + (a.pushX || 0), vaz = faz * a.speed + (a.pushZ || 0), vbx = fbx * b.speed + (b.pushX || 0), vbz = fbz * b.speed + (b.pushZ || 0);
    const vrel = (vax - vbx) * nx + (vaz - vbz) * nz;                        // > 0: aproximando
    // impulso da batida + um mínimo proporcional à sobreposição (encostar de lado e "espremer" também empurra)
    const j = Math.max(vrel > 0 ? (1 + REST) * vrel / sum : 0, overlap * 7 / sum);
    const sideA = Math.abs(nx * fax + nz * faz) < 0.6, sideB = Math.abs(nx * fbx + nz * fbz) < 0.6;
    // alavanca: contato projetado no eixo longitudinal de cada kart (até ±1,6 m)
    const la = Math.max(-1.6, Math.min(1.6, dx * fax + dz * faz)), lb = Math.max(-1.6, Math.min(1.6, -dx * fbx - dz * fbz));
    const res = { j, nx, nz, ib, la, lb, vrel, sideA, sideB };
    if (applyA) impulse(a, -nx * j * ia, -nz * j * ia, sideA, fax * la, faz * la);
    if (applyB) impulse(b, nx * j * ib, nz * j * ib, sideB, fbx * lb, fbz * lb);
    if (vrel > 3 && (a.hitCool || 0) <= 0) {
      a.hitCool = b.hitCool = 0.25;
      const cx = (a.pos.x + b.pos.x) / 2, cy = Math.max(a.pos.y, b.pos.y) + 0.7, cz = (a.pos.z + b.pos.z) / 2, n = Math.min(10, 3 + vrel | 0);
      for (let i = 0; i < n; i++) Fx.spark(cx, cy, cz, (Math.random() - 0.5) * 9, 2 + Math.random() * 5, (Math.random() - 0.5) * 9, i % 2 ? 0xffe08a : 0xffffff, 0.24, 0.35);
      if (applyA) a.events('bump', a, vrel); if (applyB) b.events('bump', b, vrel);
    }
    return res;
  };
  Kart.collidePair = function (a, b) { return !!Kart.resolve(a, b, true, true); };
  // aplica no PRÓPRIO kart um impulso calculado por outro jogador (online)
  Kart.applyRemoteImpulse = function (k, ix, iz, lever) {
    const fx = Math.sin(k.mvAng), fz = Math.cos(k.mvAng), side = Math.abs((ix * fx + iz * fz) / (Math.hypot(ix, iz) || 1)) < 0.6;
    impulse(k, ix, iz, side, fx * lever, fz * lever);
  };

  window.Kart = Kart;
})();
