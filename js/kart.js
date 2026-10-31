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

  // ---------- partículas — renderizador em LOTE (estilo Mario Kart 8 Deluxe) ----------
  // Antes: cada partícula era um THREE.Sprite (uma chamada de desenho POR partícula, ~700 no pior caso).
  // Agora: cada tipo de partícula é UMA malha instanciada (InstancedBufferGeometry) desenhada numa chamada só;
  // a GPU vira cada quadradinho para a câmera (billboard) ou o estica na direção do movimento (faíscas e rastros).
  // Com isso cabe muito mais partícula com menos custo. Todas recebem a névoa da pista (as aditivas somem no escuro).
  const PB_VS = `attribute vec3 iPos; attribute vec4 iCol; attribute vec3 iSize; attribute vec3 iVel; attribute float iFrame; attribute float iEx;
    uniform vec2 uAtlas; uniform float uStretch; varying vec2 vUv; varying vec4 vCol; varying float vEx;
    #include <fog_pars_vertex>
    void main(){
      vCol = iCol; vEx = iEx;
      if (iCol.a <= 0.002 || iSize.x <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      float cx = mod(iFrame, uAtlas.x), cy = uAtlas.y - 1.0 - floor(iFrame / uAtlas.x);
      vUv = (uv + vec2(cx, cy)) / uAtlas;
      vec4 mv = modelViewMatrix * vec4(iPos, 1.0); vec2 c = position.xy;
      if (uStretch > 0.5) {                                   // risco de luz: comprido na direção do movimento NA TELA
        vec4 mv2 = modelViewMatrix * vec4(iPos + iVel, 1.0);
        vec2 d = mv2.xy / max(-mv2.z, 0.05) - mv.xy / max(-mv.z, 0.05); float L = length(d);
        vec2 dir = L > 1e-5 ? d / L : vec2(0.0, 1.0), nrm = vec2(dir.y, -dir.x);   // (dir.y, -dir.x): mesma orientação do billboard (não fica "de costas")
        float len = iSize.y + min(L * max(-mv.z, 0.05), 10.0);
        mv.xy += nrm * c.x * iSize.x + dir * c.y * len;
      } else { float cr = cos(iSize.z), sr = sin(iSize.z); mv.xy += mat2(cr, sr, -sr, cr) * (c * iSize.xy); }
      vec4 mvPosition = mv; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  // erosão (fumaça e fogo): conforme a partícula envelhece (vEx 0 -> 1) as partes ralas da textura somem primeiro,
  // então a nuvem se desfaz em fiapos e buracos em vez de só ficar transparente por igual
  const PB_FS = (add, erode) => `uniform sampler2D map; varying vec2 vUv; varying vec4 vCol; varying float vEx;
    #include <fog_pars_fragment>
    void main(){ vec4 t = texture2D(map, vUv); float al = t.a;
      ${erode ? 'al = smoothstep(vEx * 0.85, vEx * 0.85 + 0.22, t.a) * mix(1.0, t.a, 0.35);' : ''}
      vec4 c = vec4(vCol.rgb * t.rgb, vCol.a * al); if (c.a < 0.004) discard; gl_FragColor = c;
      ${add ? `#ifdef USE_FOG
        gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, fogDepth);
      #endif` : '#include <fog_fragment>'}
    }`;
  class PBatch {
    // o: { max, map, add (soma luz), stretch (risco), erode (dissolve em fiapos), atlas: [colunas, linhas], order }
    constructor(scene, o) {
      const max = this.max = o.max, g = new THREE.InstancedBufferGeometry(), q = new THREE.PlaneGeometry(1, 1);
      g.index = q.index; g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
      const mk = n => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
      this.P = mk(3); this.C = mk(4); this.S = mk(3); this.V = mk(3); this.F = mk(1); this.E = mk(1);
      g.setAttribute('iPos', this.P); g.setAttribute('iCol', this.C); g.setAttribute('iSize', this.S); g.setAttribute('iVel', this.V); g.setAttribute('iFrame', this.F); g.setAttribute('iEx', this.E);
      g.instanceCount = 0; this.g = g;
      const at = o.atlas || [1, 1];
      this.mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uAtlas: { value: new THREE.Vector2(at[0], at[1]) }, uStretch: { value: o.stretch ? 1 : 0 } }]),
        vertexShader: PB_VS, fragmentShader: PB_FS(!!o.add, !!o.erode), transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending });
      this.mat.uniforms.map.value = o.map;
      this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = o.order || 0;
      this.mesh.userData.noOutline = true; this.mesh.userData.dynamic = true; scene.add(this.mesh); this.hw = 0;
    }
    put(i, x, y, z, sx, sy, rot, r, gg, b, a, vx, vy, vz, fr, ex) {
      const P = this.P.array, C = this.C.array, S = this.S.array, V = this.V.array, j = i * 3, k = i * 4;
      P[j] = x; P[j + 1] = y; P[j + 2] = z; S[j] = sx; S[j + 1] = sy; S[j + 2] = rot; V[j] = vx || 0; V[j + 1] = vy || 0; V[j + 2] = vz || 0;
      C[k] = r; C[k + 1] = gg; C[k + 2] = b; C[k + 3] = a; this.F.array[i] = fr || 0; this.E.array[i] = ex || 0; if (i >= this.hw) this.hw = i + 1;
    }
    hide(i) { this.C.array[i * 4 + 3] = 0; }
    commit() { this.g.instanceCount = this.hw; [this.P, this.C, this.S, this.V, this.F, this.E].forEach(a => { a.needsUpdate = true; }); }
    dispose() { if (this.mesh.parent) this.mesh.parent.remove(this.mesh); this.g.dispose(); this.mat.dispose(); }
  }
  window.PBatch = PBatch;

  // ---------- texturas das partículas (geradas em canvas) ----------
  let glowTexCache = null, softTexCache = null, puffTexCache = null, starTexCache = null;
  const cv = n => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };
  const Fx = {
    glowTex() { if (!glowTexCache) glowTexCache = new THREE.CanvasTexture(TX.canvas('glow')); return glowTexCache; },
    softTex() { if (!softTexCache) softTexCache = new THREE.CanvasTexture(TX.canvas('soft')); return softTexCache; },
    puffTex() { if (!puffTexCache) puffTexCache = new THREE.CanvasTexture(TX.canvas('puff')); return puffTexCache; },
    starTex() { if (!starTexCache) starTexCache = new THREE.CanvasTexture(TX.canvas('star')); return starTexCache; },
    // faísca do MK8: miolo branco bem fino e quente + halo colorido curto (a cor vem da partícula)
    sparkTex() { if (!this._sparkT) { const c = document.createElement('canvas'); c.width = 32; c.height = 128; const x = c.getContext('2d');
        const halo = x.createRadialGradient(16, 64, 0, 16, 64, 64); halo.addColorStop(0, 'rgba(255,255,255,.75)'); halo.addColorStop(0.35, 'rgba(255,255,255,.22)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
        x.save(); x.translate(16, 64); x.scale(0.25, 1); x.translate(-16, -64); x.fillStyle = halo; x.fillRect(-64, 0, 160, 128); x.restore();
        const core = x.createRadialGradient(16, 64, 0, 16, 64, 40); core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.5, 'rgba(255,255,255,.9)'); core.addColorStop(1, 'rgba(255,255,255,0)');
        x.save(); x.translate(16, 64); x.scale(0.09, 1); x.translate(-16, -64); x.fillStyle = core; x.fillRect(-160, 24, 360, 80); x.restore();
        this._sparkT = new THREE.CanvasTexture(c); }
      return this._sparkT; },
    // brilho: centro quente e queda rápida (a "chama" colada nas rodas do drift e os clarões)
    flareTex() { if (!this._flareT) { const c = cv(64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(255,255,255,.85)'); g.addColorStop(0.4, 'rgba(255,255,255,.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, 64, 64); this._flareT = new THREE.CanvasTexture(c); }
      return this._flareT; },
    // labareda ANIMADA (atlas 4x4 = 16 quadros em loop): os "caroços" de fogo sobem, encolhem e trocam de lugar,
    // então a chama tremula de verdade. O canal alfa tem ruído para a erosão desfazer a ponta da chama em línguas.
    fireAnimTex() { if (!this._fireA) { const F = 64, c = document.createElement('canvas'); c.width = c.height = F * 4; const x = c.getContext('2d');
        let sd = 9; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
        const B = []; for (let i = 0; i < 16; i++) B.push({ ph: rnd(), ox: (rnd() - 0.5) * 22, r: 9 + rnd() * 9, w: (rnd() - 0.5) * 6 });
        for (let f = 0; f < 16; f++) { const cx0 = (f % 4) * F, cy0 = Math.floor(f / 4) * F;
          x.save(); x.beginPath(); x.rect(cx0, cy0, F, F); x.clip(); x.globalCompositeOperation = 'lighter';
          B.forEach(b => { const u = (b.ph + f / 16) % 1, bx = cx0 + 32 + b.ox * (1 - u * 0.6) + Math.sin(u * 6.283 + b.w) * 3, by = cy0 + 50 - u * 40, r = b.r * (1 - u * 0.65);
            const g = x.createRadialGradient(bx, by, 0, bx, by, r); g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(0.5, 'rgba(255,255,255,.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            x.fillStyle = g; x.fillRect(cx0, cy0, F, F); });
          x.globalCompositeOperation = 'destination-in'; const e = x.createRadialGradient(cx0 + 32, cy0 + 36, 14, cx0 + 32, cy0 + 34, 31); e.addColorStop(0, 'rgba(0,0,0,1)'); e.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = e; x.fillRect(cx0, cy0, F, F);
          x.restore(); }
        this._fireA = new THREE.CanvasTexture(c); }
      return this._fireA; },
    // labareda: vários "caroços" macios sobrepostos (borda irregular, como chama de verdade)
    fireTex() { if (!this._fireT) { const N = 128, c = cv(N), x = c.getContext('2d');
        let sd = 5; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
        x.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 14; i++) { const a = rnd() * 6.28, d = rnd() * 22, bx = 64 + Math.cos(a) * d, by = 66 + Math.sin(a) * d * 1.2 - 4, r = 14 + rnd() * 22;
          const g = x.createRadialGradient(bx, by, 0, bx, by, r); g.addColorStop(0, 'rgba(255,255,255,.8)'); g.addColorStop(0.5, 'rgba(255,255,255,.32)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = g; x.fillRect(0, 0, N, N); }
        x.globalCompositeOperation = 'destination-in'; const e = x.createRadialGradient(64, 64, 30, 64, 64, 63); e.addColorStop(0, 'rgba(0,0,0,1)'); e.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = e; x.fillRect(0, 0, N, N);
        this._fireT = new THREE.CanvasTexture(c); }
      return this._fireT; },
    // detritos (atlas 4x1): 0 = pedrinha/torrão de terra, 1 = folha de grama, 2 = gota d'água, 3 = lasca clara (areia/poeira grossa)
    debrisTex() { if (!this._debT) { const S = 64, c = document.createElement('canvas'); c.width = S * 4; c.height = S; const x = c.getContext('2d');
        // pedrinha: forma irregular, sombreada embaixo, brilho em cima
        x.save(); x.translate(32, 34); x.beginPath(); for (let k = 0; k < 9; k++) { const a = k / 9 * 6.283, r = 17 + ((k * 37) % 7) - 3; x.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.85); } x.closePath();
        let g = x.createLinearGradient(0, -18, 0, 18); g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#c8c8c8'); g.addColorStop(1, '#6e6e6e'); x.fillStyle = g; x.fill(); x.restore();
        // folha de grama: lâmina curva, clara no meio
        x.save(); x.translate(S + 32, 32); x.rotate(0.5); x.beginPath(); x.moveTo(0, -26); x.quadraticCurveTo(9, 0, 2, 26); x.quadraticCurveTo(-5, 0, 0, -26); g = x.createLinearGradient(-6, 0, 8, 0); g.addColorStop(0, '#9a9a9a'); g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, '#a8a8a8'); x.fillStyle = g; x.fill(); x.restore();
        // gota: corpo translúcido, borda clara e reflexo
        x.save(); x.translate(S * 2 + 32, 32); g = x.createRadialGradient(-5, -6, 1, 0, 0, 20); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.75)'); g.addColorStop(0.85, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.beginPath(); x.arc(0, 0, 20, 0, 6.283); x.fill(); x.restore();
        // lasca clara
        x.save(); x.translate(S * 3 + 32, 32); x.rotate(0.7); g = x.createLinearGradient(0, -12, 0, 12); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#9c9c9c'); x.fillStyle = g; x.fillRect(-14, -9, 28, 18); x.restore();
        this._debT = new THREE.CanvasTexture(c); }
      return this._debT; },

    // raios do drift (atlas 3x1, células 64x128): 0 = feixe fino que afina até a ponta, 1 = núcleo de luz com 4 espinhos,
    // 2 = brilho em losango. As células são 2x mais altas que largas porque o quadradinho na tela é quadrado (o desenho é
    // feito "esticado" na vertical para sair redondo/proporcional).
    rayTex() { if (!this._rayT) { const W = 64, H = 128, c = document.createElement('canvas'); c.width = W * 3; c.height = H; const x = c.getContext('2d');
        // 0) feixe: base larga e quente embaixo (na roda), afinando até sumir na ponta (em cima)
        x.save(); x.beginPath(); x.rect(0, 0, W, H); x.clip();
        x.filter = 'blur(5px)'; let g = x.createLinearGradient(0, H, 0, 0); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(0.6, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.beginPath(); x.moveTo(32 - 16, H); x.lineTo(32, 2); x.lineTo(32 + 16, H); x.closePath(); x.fill();
        x.filter = 'none'; g = x.createLinearGradient(0, H, 0, 0); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.75, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.beginPath(); x.moveTo(32 - 5, H); x.lineTo(32, 6); x.lineTo(32 + 5, H); x.closePath(); x.fill(); x.restore();
        // 1) núcleo: bola de luz + 4 espinhos finos (estrela de lente)
        x.save(); x.translate(W + 32, 64); x.scale(1, 2);
        g = x.createRadialGradient(0, 0, 0, 0, 0, 31); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,.95)'); g.addColorStop(0.45, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(-32, -32, 64, 64);
        [0, Math.PI / 2].forEach(r => { x.save(); x.rotate(r); const sg = x.createLinearGradient(-31, 0, 31, 0); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,1)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = sg; x.beginPath(); x.moveTo(-31, 0); x.lineTo(0, -1.6); x.lineTo(31, 0); x.lineTo(0, 1.6); x.closePath(); x.fill(); x.restore(); });
        x.restore();
        // 2) brilho em losango
        x.save(); x.translate(W * 2 + 32, 64); x.scale(1, 2); x.filter = 'blur(2px)';
        g = x.createRadialGradient(0, 0, 0, 0, 0, 22); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,.2)');
        x.fillStyle = g; x.beginPath(); x.moveTo(0, -22); x.lineTo(13, 0); x.lineTo(0, 22); x.lineTo(-13, 0); x.closePath(); x.fill(); x.restore();
        this._rayT = new THREE.CanvasTexture(c); }
      return this._rayT; },

    // ---------- sistemas ----------
    init(scene) {
      if (this.B) Object.values(this.B).forEach(b => b.dispose());
      const sys = (max, o) => { const b = new PBatch(scene, Object.assign({ max }, o)), list = []; for (let i = 0; i < max; i++) list.push({ l: 0 }); return { b, list, i: 0 }; };
      this.S = {
        glow: sys(600, { map: this.flareTex(), add: true, order: 2 }),
        spark: sys(1000, { map: this.sparkTex(), add: true, stretch: true, order: 3 }),
        fire: sys(420, { map: this.fireTex(), order: 1 }),   // fogo em "bolinhas" macias (a versão animada em línguas ficou guardada em fireAnimTex)
        debris: sys(500, { map: this.debrisTex(), atlas: [4, 1], order: 0 }),
        ray: sys(600, { map: this.rayTex(), atlas: [3, 1], add: true, stretch: true, order: 4 })
      };
      this.B = {}; Object.keys(this.S).forEach(k => { this.B[k] = this.S[k].b; });
      if (window.Smoke) Smoke.init(scene);
      this._sp = new THREE.Vector3(); this._ra = new THREE.Vector3(); this._rd = new THREE.Vector3(); this._hot = new THREE.Color(1, 1, 1); this._fc = new THREE.Color(); this._c = new THREE.Color();
      // marcas de pneu: 700 traços reaproveitados em anel (os mais antigos somem primeiro)
      const SK = 700, sg = new THREE.PlaneGeometry(0.504, 1).rotateX(-Math.PI / 2);
      this.skids = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0x2a2a2e, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilRef: 1, stencilZPass: THREE.ReplaceStencilOp }), SK);   // stencil: cada pixel é pintado uma vez só -> o traço fica contínuo, sem faixas escuras nas emendas
      const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < SK; i++) this.skids.setMatrixAt(i, z);
      this.skids.frustumCulled = false; this.skids.renderOrder = -1;   // marcas desenhadas ANTES da fumaça (ordem 0): a fumaça passa por cima do borrachão
      scene.add(this.skids); this.skidI = 0; this._d = new THREE.Object3D();
    },
    rate: 1,   // partículas: 1 = normal, < 1 = menos (configurações)
    _next(k) { const s = this.S && this.S[k]; if (!s) return null; const p = s.list[s.i]; s.i = (s.i + 1) % s.list.length; return p; },
    // fumaça (js/smoke.js) ou brilho somado. Mesma assinatura de sempre.
    puff(kind, x, y, z, vx, vy, vz, col, s0, s1, life, op, up) {
      if (this.rate < 1 && Math.random() > this.rate) return;
      if (kind === 'smoke') { if (window.Smoke) Smoke.puff({ x, y, z, vx, vy, vz, tint: col, size: s0, grow: s1 / Math.max(0.05, s0), life, opacity: Math.min(1, op * 1.6), up: up || 0 }); return; }
      const p = this._next('glow'); if (!p) return;
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.c = col; p.s0 = s0; p.s1 = s1; p.l = p.ml = life; p.o = op; p.up = up || 0; p.rot = Math.random() * 6.28;
    },
    // faísca: nasce branco-quente, esfria para a cor, cai com gravidade e QUICA no chão (gy = altura do chão; padrão: 0,6 m abaixo)
    spark(x, y, z, vx, vy, vz, c, sz, l, gy) {
      if (this.rate < 1 && Math.random() > this.rate) return; const p = this._next('spark'); if (!p) return;
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.c = c; p.s = sz; p.l = p.ml = l * (0.8 + Math.random() * 0.5); p.gy = gy === undefined ? y - 0.6 : gy; p.g = 16; p.bn = 0; return p;
    },
    // rastro de vento/velocidade: risco branco sem gravidade (turbo)
    streak(x, y, z, vx, vy, vz, c, sz, l) {
      if (this.rate < 1 && Math.random() > this.rate) return; const p = this._next('spark'); if (!p) return;
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.c = c; p.s = sz; p.l = p.ml = l; p.gy = -1e9; p.g = 0; p.bn = 9;
    },
    // labareda do turbo: tint 0 = laranja (plataforma/cogumelo), 1 = azul (mini-turbo), 2 = laranja forte (super mini-turbo), 3 = roxo
    flame(x, y, z, vx, vy, vz, size, life, tint, quiet) {
      if (this.rate < 1 && Math.random() > this.rate) return; const p = this._next('fire'); if (!p) return;
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.s = size; p.l = p.ml = life * (0.8 + Math.random() * 0.4); p.tint = tint || 0;
      p.rot = Math.random() * 6.28; p.rv = (Math.random() - 0.5) * 6; p.smoked = !!quiet;
      if (!quiet && Math.random() < 0.5) this.puff('glow', x, y, z, vx * 0.6, vy * 0.5, vz * 0.6, Fx.FIRE_CORE[p.tint], size * 0.6, size * 0.25, 0.14, 0.6);   // núcleo quente
    },
    // detritos: kind 0 = terra, 1 = grama, 2 = gota, 3 = lasca. Caem, giram, quicam e somem.
    debris(kind, x, y, z, vx, vy, vz, size, life, col, gy) {
      if (this.rate < 1 && Math.random() > this.rate) return; const p = this._next('debris'); if (!p) return;
      p.k = kind; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.s = size * (0.7 + Math.random() * 0.6); p.l = p.ml = life * (0.8 + Math.random() * 0.4);
      p.c = col; p.gy = gy === undefined ? y - 0.3 : gy; p.rot = Math.random() * 6.28; p.rv = (Math.random() - 0.5) * 14; p.bn = 0;
    },
    // raio de luz preso a um kart: nasce no ponto (lx,ly,lz) do kart e aponta na direção (dx,dy,dz), ambos no espaço DO KART
    // (acompanham o kart a qualquer velocidade e giram junto com ele)
    ray(kart, lx, ly, lz, dx, dy, dz, len, w, col, life) {
      if (this.rate < 1 && Math.random() > this.rate) return; const p = this._next('ray'); if (!p) return;
      const n = Math.hypot(dx, dy, dz) || 1; p.k = kart; p.lx = lx; p.ly = ly; p.lz = lz; p.dx = dx / n; p.dy = dy / n; p.dz = dz / n; p.len = len; p.w = w; p.c = col; p.l = p.ml = life; p.fr = 0;
    },
    // núcleo de luz preso ao kart (estrela com 4 espinhos)
    rayCore(kart, lx, ly, lz, size, col, life) {
      const p = this._next('ray'); if (!p) return; p.k = kart; p.lx = lx; p.ly = ly; p.lz = lz; p.len = size; p.w = size; p.c = col; p.l = p.ml = life; p.fr = 1; p.rz = Math.random() * 0.8;
    },
    // brilho em losango solto no mundo (voa, cai devagar, pisca)
    glint(x, y, z, vx, vy, vz, col, size, life) {
      if (this.rate < 1 && Math.random() > this.rate) return; const p = this._next('ray'); if (!p) return;
      p.k = null; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.w = size; p.c = col; p.l = p.ml = life; p.fr = 2;
    },
    FIRE_CORE: [0xffc060, 0x9fe0ff, 0xffb040, 0xe0a0ff],
    // rampas de cor do fogo por tipo de turbo: [t, r, g, b]
    FIRE_RAMP: [
      [[0, 1, 0.95, 0.6], [0.12, 1, 0.74, 0.12], [0.32, 1, 0.4, 0.03], [0.58, 0.9, 0.14, 0.02], [0.82, 0.28, 0.1, 0.08], [1, 0.16, 0.14, 0.14]],
      [[0, 0.9, 1, 1], [0.12, 0.45, 0.85, 1], [0.32, 0.16, 0.5, 1], [0.58, 0.08, 0.22, 0.85], [0.82, 0.1, 0.1, 0.3], [1, 0.14, 0.14, 0.18]],
      [[0, 1, 1, 0.75], [0.12, 1, 0.82, 0.25], [0.32, 1, 0.5, 0.05], [0.58, 1, 0.22, 0.02], [0.82, 0.35, 0.1, 0.06], [1, 0.16, 0.14, 0.14]],
      [[0, 1, 0.9, 1], [0.12, 0.85, 0.5, 1], [0.32, 0.6, 0.2, 1], [0.58, 0.35, 0.06, 0.7], [0.82, 0.16, 0.06, 0.25], [1, 0.14, 0.12, 0.18]]
    ],
    // um traço de marca de pneu de (x0,z0) até (x1,z1), na altura y
    skid(x0, z0, x1, z1, y) {
      if (!this.skids) return; const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz); if (L < 0.05 || L > 4) return;
      const d = this._d; d.position.set((x0 + x1) / 2, y + 0.06, (z0 + z1) / 2); d.rotation.set(0, Math.atan2(dx, dz), 0); d.scale.set(1, 1, L + 0.3); d.updateMatrix();
      this.skids.setMatrixAt(this.skidI++ % this.skids.count, d.matrix); this.skids.instanceMatrix.needsUpdate = true;
    },
    step(dt) {
      if (window.Smoke) Smoke.update(dt);
      if (!this.S) return;
      const C = this._c, hot = this._hot, f = this._fc;
      // brilho: incha ou encolhe, sobe, some
      { const s = this.S.glow, b = s.b, dr = Math.max(0, 1 - 2.2 * dt);
        for (let i = 0; i < s.list.length; i++) { const p = s.list[i]; if (p.l <= 0) { if (i < b.hw) b.hide(i); continue; }
          p.l -= dt; if (p.l <= 0) { b.hide(i); continue; }
          const t = 1 - p.l / p.ml; p.vx *= dr; p.vy = p.vy * dr + p.up * dt; p.vz *= dr; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          const sz = Math.max(0.01, p.s0 + (p.s1 - p.s0) * t), a = p.o * (1 - t) * (t < 0.12 ? t / 0.12 : 1); C.set(p.c);
          b.put(i, p.x, p.y, p.z, sz, sz, p.rot, C.r, C.g, C.b, a); } b.commit(); }
      // faíscas: gravidade, atrito do ar, quique no asfalto (perdem força e "patinam"), branco-quente -> cor
      { const s = this.S.spark, b = s.b;
        for (let i = 0; i < s.list.length; i++) { const p = s.list[i]; if (p.l <= 0) { if (i < b.hw) b.hide(i); continue; }
          p.l -= dt; if (p.l <= 0) { b.hide(i); continue; }
          const dr = Math.max(0, 1 - 1.4 * dt); p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - p.g * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          if (p.y < p.gy && p.vy < 0) { p.y = p.gy; if (p.bn++ < 2) { p.vy = -p.vy * 0.38; p.vx *= 0.62; p.vz *= 0.62; } else { p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; } }
          const t = 1 - p.l / p.ml, w = p.s * (1 - t * 0.55);
          C.set(p.c); const k = Math.min(1, t * 2.4); C.r = hot.r + (C.r - hot.r) * k; C.g = hot.g + (C.g - hot.g) * k; C.b = hot.b + (C.b - hot.b) * k;
          const a = Math.pow(1 - t, 1.1) * (0.82 + Math.random() * 0.18);   // cintila
          b.put(i, p.x, p.y, p.z, w * 0.5, w * 1.6, 0, C.r, C.g, C.b, a, p.vx * 0.035, p.vy * 0.035, p.vz * 0.035); } b.commit(); }
      // fogo: rampa de cor por tipo de turbo, sobe tremulando e termina em fumaça escura
      { const s = this.S.fire, b = s.b;
        for (let i = 0; i < s.list.length; i++) { const p = s.list[i]; if (p.l <= 0) { if (i < b.hw) b.hide(i); continue; }
          p.l -= dt; if (p.l <= 0) { b.hide(i); continue; }
          const t = 1 - p.l / p.ml, ramp = this.FIRE_RAMP[p.tint] || this.FIRE_RAMP[0];
          let k = 1; while (k < ramp.length - 1 && t > ramp[k][0]) k++; const A = ramp[k - 1], B = ramp[k], u = Math.min(1, (t - A[0]) / (B[0] - A[0]));
          f.setRGB(A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u, A[3] + (B[3] - A[3]) * u);
          p.vx *= Math.max(0, 1 - 3 * dt); p.vy = p.vy * Math.max(0, 1 - 3 * dt) + 4.5 * dt; p.vz *= Math.max(0, 1 - 3 * dt);
          p.vx += (Math.random() - 0.5) * 6 * dt; p.vz += (Math.random() - 0.5) * 6 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.rv * dt;
          const sz = p.s * (0.4 + t * 0.9), a = Math.min(1, 1.5 * (t < 0.08 ? t / 0.08 : 1) * Math.pow(1 - t, 0.9) * (0.82 + Math.random() * 0.18));
          b.put(i, p.x, p.y, p.z, sz, sz, p.rot, f.r, f.g, f.b, a);
          if (!p.smoked && t > 0.6) { p.smoked = true; if (window.Smoke && Math.random() < 0.3) Smoke.puff({ x: p.x, y: p.y + 0.2, z: p.z, vx: p.vx * 0.5, vy: 1 + Math.random(), vz: p.vz * 0.5, size: p.s * 0.7, grow: 2.4, life: 0.7, tint: 0x8a8480, opacity: 0.28, up: 1.2 }); } } b.commit(); }   // fim da chama: fumacinha clara e rala
      // raios do drift: presos ao kart. O feixe "dispara" (cresce rápido até o comprimento cheio), pisca e some;
      // o núcleo pulsa; o losango voa solto e pisca. Tudo somando luz -> no meio fica branco e estoura no brilho (bloom).
      { const s = this.S.ray, b = s.b, A = this._ra, D = this._rd;
        for (let i = 0; i < s.list.length; i++) { const p = s.list[i]; if (p.l <= 0) { if (i < b.hw) b.hide(i); continue; }
          p.l -= dt; if (p.l <= 0 || (p.k && !p.k.m.group.parent)) { p.l = 0; b.hide(i); continue; }
          const t = 1 - p.l / p.ml; C.set(p.c);
          if (p.fr === 2) { p.vx *= 0.94; p.vz *= 0.94; p.vy -= 6 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            const a = (1 - t) * (Math.random() < 0.25 ? 0.35 : 1), sz = p.w * (1 - t * 0.5);
            b.put(i, p.x, p.y, p.z, sz, sz, 0, C.r, C.g, C.b, a, p.vx * 0.012, p.vy * 0.012, p.vz * 0.012, 2); continue; }
          const g = p.k.m.group; A.set(p.lx, p.ly, p.lz); g.localToWorld(A);
          if (p.fr === 1) { const sz = p.len * (0.85 + 0.3 * Math.random()) * (t < 0.2 ? 0.6 + 2 * t : 1);
            b.put(i, A.x, A.y, A.z, sz, sz, 0, C.r, C.g, C.b, (1 - t * t) * 0.95, 0, 0, 0, 1); continue; }
          D.set(p.dx, p.dy, p.dz).transformDirection(g.matrixWorld);
          const grow = Math.min(1, t / 0.25), L = p.len * (0.35 + 0.65 * grow * (2 - grow)), a = (1 - t) * (0.75 + 0.25 * Math.random());
          const wC = 0.65 + 0.35 * (1 - t);   // mistura de branco no começo (feixe quente) que vai para a cor
          b.put(i, A.x + D.x * L * 0.5, A.y + D.y * L * 0.5, A.z + D.z * L * 0.5, p.w * (1 - t * 0.4), 0.01, 0,
            C.r + (1 - C.r) * (1 - wC), C.g + (1 - C.g) * (1 - wC), C.b + (1 - C.b) * (1 - wC), a, D.x * L, D.y * L, D.z * L, 0); }
        b.commit(); }
      // detritos: gravidade forte, giro, quicam (terra e gota quicam pouco; gota vira respingo e some)
      { const s = this.S.debris, b = s.b;
        for (let i = 0; i < s.list.length; i++) { const p = s.list[i]; if (p.l <= 0) { if (i < b.hw) b.hide(i); continue; }
          p.l -= dt; if (p.l <= 0) { b.hide(i); continue; }
          const drag = p.k === 1 ? 2.6 : 0.6, dr = Math.max(0, 1 - drag * dt);   // grama "plana" no ar
          p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - (p.k === 1 ? 9 : 22) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.rv * dt;
          if (p.y < p.gy && p.vy < 0) { p.y = p.gy; if (p.k === 2) p.l = Math.min(p.l, 0.06); else if (p.bn++ < 1) { p.vy = -p.vy * 0.3; p.vx *= 0.5; p.vz *= 0.5; p.rv *= 0.5; } else { p.vy = 0; p.vx *= 0.3; p.vz *= 0.3; p.rv = 0; } }
          const t = 1 - p.l / p.ml, a = (p.k === 2 ? 0.85 : 1) * (t > 0.7 ? (1 - t) / 0.3 : 1); C.set(p.c);
          const sy = p.k === 2 ? p.s * (1 + Math.min(1.5, Math.abs(p.vy) * 0.06)) : p.s;   // gota estica caindo
          b.put(i, p.x, p.y, p.z, p.s, sy, p.k === 2 ? 0 : p.rot, C.r, C.g, C.b, a, 0, 0, 0, p.k); } b.commit(); }
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
      this.pos.set(p.x, track.roadBase + (track.hAt ? track.hAt(i) : 0), p.z);
      this.ang = this.mvAng = this.camAng = Math.atan2(track.T[i].x, track.T[i].z);
      this.speed = 0; this.idx = i; this.prevIdx = i; this.frac = 0; this.lap = 0; this.finished = false; this.finishTime = 0;
      this.boostT = 0; this.drifting = false; this.driftDir = 0; this.driftT = 0; this.driftSteer = 0; this.hopT = 0; this.slip = 0;
      this.steerVis = 0; this.onPadPrev = false; this.air = false; this.vy = 0; this.vyG = 0; this.squash = 0; this.bumpCool = 0;
      this.smokeCD = 0; this.trailCD = 0; this.off = false; this.wet = false; this.stuckT = 0; this.coins = 0; this.railSide = null;
      this.pushX = 0; this.pushZ = 0; this.yawV = 0; this.hitRoll = 0; this.hitRollV = 0; this.hitCool = 0; this.wheelT = 0;
      this.driftCharge = 0; this.driftRot = 0; this.driftCD = 0; this.mtCool = 0;   // reação às batidas (empurrão, giro e balanço)
      this.slipV = 0; this.dRoll = 0; this.dRollV = 0; this.pitch = 0; this.pitchV = 0; this.sparkAcc = 0; this.lvlPrev = 0; this.glowCD = 0; this.fxT = 0; this.driftBurst = false; this.mtFx = 0;
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
      const dirt = this.dirt = off && !!(tr.dirtAt && tr.dirtAt(this.pos));             // atalho de terra batida: quase sem perda
      // cortinas d'água (Vale da Cascata): atravessar freia um pouco
      if (tr.curtains && this.idx !== this.prevIdx) { const a = (this.idx - this.prevIdx + N) % N;
        if (a > 0 && a < 60) tr.curtains.forEach((c, k) => { const b = (c - this.prevIdx + N) % N; if (b > 0 && b <= a) { this.speed *= k === 0 ? 0.96 : 0.98; this.events('curtain', this); } }); }
      // aderência: piso molhado (túnel, poças, canal, spray) e pneus ainda molhados por 2 s depois de sair da água
      const grip0 = tr.gripAt ? tr.gripAt(this.pos, this.idx) : 1;
      if (grip0 < 1) this.wetT = 2; else this.wetT = Math.max(0, (this.wetT || 0) - dt);
      const grip = Math.min(grip0, this.wetT > 0 ? 1 - 0.1 * this.wetT / 2 : 1);
      // plataformas de boost
      const padNow = racing && !this.finished && !this.air && tr.onPad(this.pos);
      if (padNow && !this.onPadPrev) { this.boostT = 1.6; this.speed = Math.max(this.speed, P.MAX * 1.05); this.boostTint = 0; this.padFx = true; this.events('boost', this); }
      this.onPadPrev = padNow; if (padNow) this.boostT = Math.max(this.boostT, 1.0);
      if (this.boostT > 0) this.boostT -= dt;
      const boosting = this.boostT > 0 && (!off || dirt);
      // velocidade
      // GRAU (só moto): segurando Ctrl em linha reta a moto empina; empinada de vez dá +6% de velocidade máxima,
      // mas a direção fica bem mais fraca e não dá para derrapar. Frear, derrapar, sair da pista ou bater desfaz.
      const wantW = !!(this.m.moto && inp.wheelie && racing && !this.finished && !this.air && !this.drifting && !this.off && this.speed > 10 && !inp.down);
      this.wheelT = Math.max(0, Math.min(1, (this.wheelT || 0) + (wantW ? dt * 2.2 : -dt * 3.2)));
      // relevo: na subida a velocidade máxima cai (12% -> ~-26%) e na descida sobe um pouco; quem chega embalado
      // (turbo, mini-turbo) perde a sobra aos poucos -> as subidas íngremes pedem impulso
      const slopeK = tr.vert && !off ? Math.max(0.6, Math.min(1.12, 1 - (P.SLOPE_TOP || 0) * (this.slope || 0))) : 1;
      const MAXE = P.MAX * (1 + 0.012 * this.coins) * (this.topScale || 1) * (this.wheelT > 0.9 ? 1.06 : 1) * slopeK;
      const top = boosting ? MAXE * 1.5 : MAXE, maxF = off ? P.MAX * (dirt ? 0.9 : 0.38) : P.MAX;
      if (!this.air) {
        if (up) this.speed += (this.speed < 0 ? P.BRAKE * grip : P.ACC) * dt;
        else if (down) this.speed -= (this.speed > 0 ? P.BRAKE * grip : P.ACC * 0.7) * dt;   // molhado: freia menos (distância maior)
        else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), (off && !dirt ? 18 : 6) * dt);
        if (off && this.speed > maxF) this.speed -= (this.speed - maxF) * Math.min(1, 3 * dt);
        if (tr.vert && !off) this.speed -= (P.SLOPE_ACC || 0) * (this.slope || 0) * dt;   // gravidade na rampa
        if (grip0 <= 0.6) this.speed -= this.speed * 0.1 * dt;              // poça / canal: arrasto da água
      }
      if (boosting && !this.finished) this.speed += P.ACC * 2.2 * dt;
      else if (this.speed > MAXE && !off) this.speed -= (this.speed - MAXE) * Math.min(1, 1.6 * dt);
      this.speed = Math.max(-P.MAXREV, Math.min(top, this.speed));
      // drift (segura o botão numa curva; solta para o mini-turbo)
      const wet = this.wet = !this.air && tr.inWater(this.pos), wantD = racing && inp.drift && !this.finished && !((this.wheelT || 0) > 0.3);
      if (this.driftCD > 0) this.driftCD -= dt;
      // MANOBRA NO AR (estilo Mario Kart): apertar o drift logo depois de sair de uma rampa faz o kart girar no ar;
      // ao pousar ganha um turbo curto. Precisa ser um toque novo (segurar o botão desde o chão não conta).
      const dPress = racing && !!inp.drift && !this.prevDriftIn; this.prevDriftIn = !!inp.drift;
      if (this.air) this.airT = (this.airT || 0) + dt;
      if (this.air && dPress && !this.trick && this.airT < 0.5 && !this.finished) { this.trick = true; this.trickT = 0; this.trickDir = steer < -0.3 ? -1 : 1; this.squash = -0.12; this.events('trick', this);
        if (Fx.glint) for (let q = 0; q < 14; q++) { const an = q / 14 * 6.283, sp = 5 + Math.random() * 4; Fx.glint(this.pos.x, this.pos.y + 1, this.pos.z, Math.cos(an) * sp, 2 + Math.sin(an) * sp, Math.sin(an * 1.7) * sp, q % 2 ? 0xfff2a0 : 0x9ff0ff, 0.5 + Math.random() * 0.4, 0.45); } }
      if (this.mtCool > 0) this.mtCool -= dt;
      // DRIFT SÓ COM ESTERÇO ATIVO: precisa da tecla de drift (Espaço/Shift) E de A/D (ou setas) pressionados no
      // mesmo instante. Em reta, sem virar, a tecla de drift é ignorada por completo (sem pulinho, sem faísca, sem carga).
      const steering = Math.abs(steer) > 0.5;
      if (!this.drifting && !this.air && wantD && steering && this.speed > 14 && !wet && !(this.driftCD > 0)) { this.drifting = true; this.driftDir = Math.sign(steer); this.driftSteer = steer; this.driftT = 0; this.driftCharge = 0; this.driftRot = 0; this.hopT = 0.25; this.squash = -0.14; this.driftBurst = true; this.events('driftStart', this); }
      if (this.drifting && (!wantD || this.speed < 10 || wet)) {
        // ANTI-ABUSO: o mini-turbo só sai de curva de verdade. Precisa de CARGA (que só cresce rápido quando a
        // pista curva de fato) E de GIRO real do kart. Depois de um mini-turbo há 2 s em que a carga cresce bem
        // devagar, e um novo drift só começa 0,35 s depois de soltar -> "spammar" drift em reta não rende nitro.
        const lvl = this.driftLevel();
        if (lvl > 0) { this.boostT = Math.max(this.boostT, lvl === 2 ? 1.3 : 0.8); this.speed = Math.max(this.speed, Math.min(P.MAX * 1.02, this.speed + P.MAX * 0.09)); this.mtCool = 2.0; this.mtFx = lvl; this.boostTint = lvl; this.events('miniTurbo', this); }   // empurrão proporcional à velocidade do jogo (antes +7 m/s fixos)
        this.drifting = false; this.driftCD = 0.35;
      }
      let turn = steer * P.TURN * (1 - 0.3 * Math.min(1, Math.abs(this.speed) / P.MAX)) * (1 - 0.45 * (this.wheelT || 0));
      if (this.drifting) {
        // drift = arco de raio definido (dentro ~38 m, neutro ~62 m, fora ~120 m)
        this.driftSteer += (steer - this.driftSteer) * Math.min(1, 7 * dt);
        const rel = this.driftSteer * this.driftDir;
        const Rd = rel >= 0 ? P.DRIFT_R_MID - rel * (P.DRIFT_R_MID - P.DRIFT_R_IN) : P.DRIFT_R_MID - rel * (P.DRIFT_R_OUT - P.DRIFT_R_MID);
        // entrada suave: nos primeiros 0,2 s o giro passa do giro normal para o arco do drift (sem "tranco" no volante)
        const din = Math.min(1, this.driftT / 0.2), dinS = din * din * (3 - 2 * din);
        turn += (this.driftDir * Math.min(1.5, Math.abs(this.speed) / Rd) - turn) * dinS;
        const corner = tr.cornerAt ? tr.cornerAt(this.idx) : 1;
        const rate = (rel > 0.3 ? 1.3 : 1) * (0.1 + 0.9 * corner) * (this.mtCool > 0 ? 0.3 : 1) * (this.boostT > 0 ? 0.5 : 1) * (grip < 1 ? 1.1 : 1);   // molhado: carrega um pouco mais rápido
        this.driftT += dt; this.driftCharge = (this.driftCharge || 0) + dt * rate;
        this.driftRot = (this.driftRot || 0) + Math.abs(turn * dt * Math.max(-1, Math.min(1, this.speed / 10)));
        this.speed -= (rel > 0.3 ? 2.2 : 3) * dt;   // fechando o arco (para dentro) perde menos velocidade: drift bem feito é recompensado
      }
      if (this.air) turn *= 0.35;                                       // pouco controle no ar
      this.ang += turn * dt * Math.max(-1, Math.min(1, this.speed / 10));
      const dA = wrapA(this.ang - this.mvAng);
      // pouca aderência: o rumo do kart demora mais para seguir o bico (ele escorrega para fora da curva)
      if (this.drifting || grip < 0.99 || Math.abs(dA) > 0.08) this.mvAng += dA * Math.min(1, (this.drifting ? 7 : 9) * grip * grip * dt); else this.mvAng = this.ang;
      // na água: gotas (caem, esticam e somem ao bater) + névoa de respingo, abrindo em leque para os lados e para trás
      if (wet) { this.speed -= this.speed * 1.8 * dt; const sp = Math.abs(this.speed);
        if (sp > 4) { this.splashAcc = (this.splashAcc || 0) + dt * Math.min(90, 20 + sp * 0.8);
          const fx = Math.sin(this.mvAng), fz = Math.cos(this.mvAng), lx = Math.cos(this.ang), lz = -Math.sin(this.ang);
          while (this.splashAcc >= 1) { this.splashAcc -= 1; const sd = Math.random() < 0.5 ? -1 : 1, o = 2 + Math.random() * 4;
            Fx.debris(2, this.pos.x + lx * sd * 1.1 - fx, this.pos.y + 0.3, this.pos.z + lz * sd * 1.1 - fz, lx * sd * o - fx * sp * 0.15, 3 + Math.random() * 5, lz * sd * o - fz * sp * 0.15, 0.2, 0.8, 0xe4f6ff, this.pos.y + 0.05); }
          if (Math.random() < 0.35) Fx.puff('smoke', this.pos.x - fx * 1.5, this.pos.y + 0.4, this.pos.z - fz * 1.5, -fx * sp * 0.1, 1.5, -fz * sp * 0.1, 0xeaf6ff, 0.8, 3.2, 0.6, 0.4, 0.5); } }
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
        if (this.pos.y <= gr.h) { const impact = -this.vy; this.pos.y = gr.h; this.air = false; this.vy = 0; this.vyG = 0;   // zera a velocidade vertical do chão: sem isso o kart re-decolava sozinho logo depois de pousar (pulos em cadeia)
          if (impact > 5) { this.squash = Math.min(0.35, impact * 0.025); this.landFx = impact; this.events('land', this); }
          if (this.trick) { this.trick = false; this.trickT = 1; this.boostT = Math.max(this.boostT, 1.1); this.speed = Math.max(this.speed, P.MAX * 1.04); this.mtFx = 2; this.boostTint = 2; this.events('miniTurbo', this); } }
      } else if (tr.vert && Math.abs(this.speed) > 8 && gr.h < this.pos.y + this.vyG * dt - ((off ? 0.9 : 0.4) + 0.08 * Math.abs(this.speed) * dt)) {   // margem cresce com o passo do quadro (FPS baixo não vira pulo)
        // pista com relevo: decola só quando o chão "some" de verdade (borda de rampa). Nas cristas o kart fica colado
        // no asfalto: com as velocidades atuais elas faziam o kart dar pulinhos sozinho em lombadas suaves.
        this.air = true; this.airT = 0; this.trick = false; this.vy = Math.max(-12, Math.min(20, this.vyG)); this.drifting = false; this.pos.y += this.vy * dt;
      } else if (!tr.vert && gr.h < this.pos.y - 0.35 && this.speed > 8 && !gr.soft) {   // o chão "sumiu" (fim de rampa de salto): decola
        this.air = true; this.airT = 0; this.trick = false; this.vy = Math.max(0, this.vyG); this.drifting = false;
      } else {
        // física da ponte (como na versão original):
        //  * em cima da pista, o kart segue EXATAMENTE o perfil contínuo da ponte (sem atraso, sem degraus nos nós)
        //  * saindo pela lateral da ponte, desce suave até o chão (decai ~10/s) em vez de "decolar"
        //  * grama, zebra e água: transição suave de altura
        let ny;
        if (gr.exact) ny = gr.h;
        else if (gr.soft) ny = this.pos.y + (gr.h - this.pos.y) * Math.min(1, 10 * dt);
        else ny = Math.abs(gr.h - this.pos.y) > 0.3 ? gr.h : this.pos.y + (gr.h - this.pos.y) * Math.min(1, 18 * dt);
        // velocidade vertical do chão (vira o impulso da decolagem). Degrau/teleporte (sobe mais de 0,3 m num quadro e mais
        // íngreme que 50%: barranco, cabeceira de ponte, respawn) NÃO conta como velocidade: antes isso gerava vyG de 100+ m/s
        // e o kart passava a dar pulos "do nada" sem parar, principalmente com FPS baixo.
        const dyF = ny - this.pos.y, step = Math.abs(dyF) > 0.3 && Math.abs(dyF) > Math.abs(this.speed) * dt * 0.5;
        this.vyG = this.vyG * 0.5 + 0.5 * (step ? 0 : Math.max(-30, Math.min(30, dyF / Math.max(dt, 1e-3)))); this.pos.y = ny;
      }
      this.slope = !this.air && !off ? (gr.slope || 0) : 0;
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
      if (this.trick) { this.trickT = Math.min(1, (this.trickT || 0) + dt / 0.45); const e = this.trickT, k = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2; g.rotation.z = -this.trickDir * k * Math.PI * 2; }
      else g.rotation.z = 0;
      this.steerVis += (steer - this.steerVis) * Math.min(1, 10 * dt);
      const sd = Math.min(dt, 0.05); this.fxT = (this.fxT || 0) + dt;   // molas com passo limitado (estáveis mesmo num quadro lento)
      // ângulo da derrapada com MOLA: na entrada a traseira passa um pouco do ponto e "assenta"; fechando o arco ela abre mais,
      // abrindo o arco ela endireita; ao soltar volta macio, sem estalo
      const relD = this.drifting ? this.driftSteer * this.driftDir : 0;
      const slipT = this.drifting ? this.driftDir * (0.32 + 0.13 * Math.max(0, relD) - 0.08 * Math.max(0, -relD)) : 0;
      this.slipV = (this.slipV || 0) + ((slipT - this.slip) * 120 - (this.slipV || 0) * 13) * sd; this.slip += this.slipV * sd;
      this.m.pivot.rotation.y = this.slip;                       // gira carroceria E rodas juntas
      // contra-esterço: no drift as rodas da frente apontam para onde o kart está INDO (contra o giro da carroceria),
      // com um pouco do volante por cima. Fora do drift, esterço normal. Mistura suave conforme a derrapada some.
      // esterço visual limitado a ±0,42 rad: mais que isso o pneu encostaria no capô/laterais
      const dw = Math.min(1, Math.abs(this.slip) / 0.3), fwY = this.steerVis * 0.45 * (1 - dw) + (-this.slip * 0.8 + this.steerVis * 0.15) * dw;
      this.m.fw.forEach(w => w.rotation.y = Math.max(-0.42, Math.min(0.42, fwY)));
      this.m.rolls.forEach(w => w.g.rotation.x += this.speed * dt / w.r);
      // inclinação: kart rola para fora da curva; a motoca deita para dentro (gira rodas + carroceria juntas)
      // inclinação do drift com mola (deita, passa um pouco e assenta) + vibração fina do motor/pneus enquanto derrapa
      const dRollT = this.drifting ? this.driftDir * (this.m.moto ? 0.27 : -0.12) * (1 + 0.25 * Math.max(0, relD)) : 0;
      this.dRollV = (this.dRollV || 0) + ((dRollT - (this.dRoll || 0)) * 90 - (this.dRollV || 0) * 10) * sd; this.dRoll = (this.dRoll || 0) + this.dRollV * sd;
      const buzz = this.drifting && !this.air ? Math.sin(this.fxT * 57) * 0.012 + Math.sin(this.fxT * 31) * 0.008 : 0;
      const roll = this.m.lean * this.steerVis * Math.min(1, Math.abs(this.speed) / P.MAX) + this.dRoll + buzz;
      // arfagem: o bico mergulha ao cair do pulinho do drift e empina no mini-turbo (mola, volta sozinho)
      this.pitchV = (this.pitchV || 0) + (-(this.pitch || 0) * 80 - (this.pitchV || 0) * 9) * sd; this.pitch = (this.pitch || 0) + this.pitchV * sd;
      // balanço da batida: mola amortecida (o kart "chacoalha" para o lado do empurrão e volta)
      this.hitRollV += (-this.hitRoll * 90 - this.hitRollV * 9) * dt; this.hitRoll += this.hitRollV * dt;
      if (this.m.moto) { this.m.pivot.rotation.z += (-roll - this.m.pivot.rotation.z) * Math.min(1, 6 * dt); this.m.pivot.rotation.z += this.hitRoll * 0.6; b.rotation.z = 0;
        // grau: gira em torno do ponto de apoio da roda traseira (a traseira continua no chão)
        const w = this.wheelT || 0, th = -(0.42 * w * w * (3 - 2 * w)) + (w > 0.9 ? Math.sin(performance.now() / 140) * 0.025 : 0), rz = this.m.rear.z;
        this.m.pivot.rotation.x = th + this.pitch * 0.5; this.m.pivot.position.set(0, rz * Math.sin(th), rz - rz * Math.cos(th)); } else { b.rotation.z = roll + this.hitRoll; b.rotation.x = this.pitch; }
      // volante/guidão e piloto (inclina o corpo e olha para dentro da curva)
      this.m.animate(dt, { steer: this.steerVis, speed: Math.min(1, Math.abs(this.speed) / P.MAX), boost: boosting, drift: this.drifting ? this.driftDir : 0, air: this.air });
      // pulinho do drift: estica ao saltar, sobe rápido e cai, e "amassa" ao tocar o chão (com o bico mergulhando)
      if (this.hopT > 0) { this.hopT -= dt; if (this.hopT <= 0) { this.squash = Math.max(this.squash, 0.17); this.pitchV += 1.4; } }
      this.squash *= Math.max(0, 1 - 8 * dt);
      b.scale.set(1 + this.squash * 0.5, 1 - this.squash, 1 + this.squash * 0.3);
      const hp = this.hopT > 0 ? 1 - this.hopT / 0.25 : 0;
      b.position.y = (off && !wet ? Math.sin(performance.now() / 35) * 0.05 : 0) + (this.hopT > 0 ? Math.pow(Math.sin(hp * Math.PI), 0.8) * 0.42 : 0);
      this.m.blob.position.y = (gr.h - this.pos.y) / 0.8 + 0.03; this.m.blob.material.opacity = this.air ? 0.1 : 0.16;
      this.tireFx(dt);
      this.driftFx(dt);
    }

    // efeitos do drift: estouro de fumaça na entrada, faíscas contínuas (por segundo, não por quadro) que mudam de cor com
    // a carga, explosão de faíscas e brilho a cada nível novo, "chama" colada nas rodas com carga, e o estouro do mini-turbo.
    // Karts longe da câmera (> 90 m) pulam os efeitos.
    driftFx(dt) {
      const g = this.m.group, R = this.m.rear, wheels = this.m.moto ? [0] : [-1, 1];
      const near = this.isPlayer || !Fx.cam || Fx.cam.position.distanceToSquared(this.pos) < 8100;
      const fx = Math.sin(this.mvAng), fz = Math.cos(this.mvAng), lx = Math.cos(this.ang), lz = -Math.sin(this.ang);   // frente do movimento e "esquerda" do kart
      const COL = [0xfff2b0, 0x4aa8ff, 0xff8a1a];
      // estouro do mini-turbo (vale para o jogador e para os bots)
      if (this.mtFx) { const lv = this.mtFx, col = COL[lv]; this.mtFx = 0; this.pitchV -= 2.6 + lv * 0.6;
        if (near) wheels.forEach(s => { for (let k = 0; k < 14; k++) { const a = k / 14 * 6.2832;
            Fx.ray(this, s * R.x, 0.3, R.z, Math.cos(a), Math.sin(a) * 0.6 + 0.4, -0.5 + Math.random() * 0.4, 4.5 + Math.random() * 3, 0.45, lv === 2 ? 0xff9a3a : 0x5ab8ff, 0.24); }
          Fx.rayCore(this, s * R.x, 0.3, R.z, 6, 0xffffff, 0.24); });
        if (near) wheels.forEach(s => { const w = g.localToWorld(_w.set(s * R.x, 0.3, R.z)), x = w.x, y = w.y, z = w.z;
          Fx.puff('glow', x, y + 0.2, z, -fx * 3, 0.6, -fz * 3, col, 3.4, 0.8, 0.28, 0.95);
          for (let k = 0; k < 12; k++) { const a = k / 12 * 6.2832; Fx.spark(x, y, z, Math.cos(a) * 7 - fx * 6, 2 + Math.random() * 4, Math.sin(a) * 7 - fz * 6, k % 3 ? col : 0xffffff, 0.3, 0.45); } }); }
      if (!this.drifting) { this.lvlPrev = 0; this.sparkAcc = 0; this.driftBurst = false; return; }
      if (!near || this.air) return;
      const lv = this.driftLevel(), col = COL[lv], out = -this.driftDir;
      // entrada: nuvem de fumaça forte nas rodas de trás
      if (this.driftBurst) { this.driftBurst = false; const dark = 1 - 0.6 * (window.Env ? Env.nightF : 0), tint = new THREE.Color(0xeef0f4).multiplyScalar(dark).getHex();
        wheels.forEach(s => { const w = g.localToWorld(_w.set(s * R.x, 0.2, R.z)), x = w.x, y = w.y, z = w.z;
          for (let k = 0; k < 3; k++) Fx.puff('smoke', x + (Math.random() - 0.5) * 0.6, y + 0.2, z + (Math.random() - 0.5) * 0.6, lx * out * (2 + k) - fx * 2, 1 + Math.random(), lz * out * (2 + k) - fz * 2, tint, 0.9, 4.2, 0.95, 0.7, 0.9); }); }
      // subiu de nível: explosão de faíscas da cor nova + flash de brilho
      if (lv > this.lvlPrev) { wheels.forEach(s => { const w = g.localToWorld(_w.set(s * R.x, 0.25, R.z)), x = w.x, y = w.y, z = w.z;
          Fx.puff('glow', x, y + 0.2, z, 0, 0.5, 0, col, 2.8, 0.6, 0.22, 0.95);
          for (let k = 0; k < 10; k++) { const a = Math.random() * 6.2832, v = 4 + Math.random() * 4; Fx.spark(x, y, z, Math.cos(a) * v, 3 + Math.random() * 4, Math.sin(a) * v, k % 4 ? col : 0xffffff, 0.28, 0.4); } });
        { const RC = lv === 2 ? 0xff9a3a : 0x5ab8ff; wheels.forEach(s => { for (let k = 0; k < 12; k++) { const a = k / 12 * 6.2832 + Math.random() * 0.4;
            Fx.ray(this, s * R.x, 0.3, R.z, Math.cos(a) * 0.8 + out * 0.4, Math.sin(a) * 0.5 + 0.55, -0.3 + Math.sin(a * 1.7) * 0.6, 4 + Math.random() * 2.5, 0.42, RC, 0.2); }
            Fx.rayCore(this, s * R.x, 0.3, R.z, 5, 0xffffff, 0.18); }); }   // estrela de raios ao subir de nível
        this.events('driftLevel', this, lv); }
      this.lvlPrev = lv;
      // faíscas contínuas: jorram para trás e para fora da curva, mais fortes e mais longas com carga
      this.sparkAcc += dt * (lv === 2 ? 44 : lv === 1 ? 30 : 16);
      let n = 0; while (this.sparkAcc >= 1 && n++ < 6) { this.sparkAcc -= 1;
        wheels.forEach(s => { const w = g.localToWorld(_w.set(s * R.x, 0.18, R.z)), b = 3 + Math.random() * 5, o = 1.5 + Math.random() * 3;
          Fx.spark(w.x, w.y, w.z, -fx * b + lx * out * o, 2 + Math.random() * 3.5, -fz * b + lz * out * o, col, lv ? 0.26 : 0.2, 0.32 + lv * 0.07, this.pos.y + 0.04); }); }   // quicam e patinam no asfalto
      if (this.sparkAcc > 1) this.sparkAcc = 1;
      // RAIOS DE LUZ (MK8): com carga, feixes finos disparam das rodas em explosão (para cima, para fora e para trás),
      // com um núcleo de luz em estrela colado na roda e brilhos em losango voando. Nível 2: mais raios, mais longos.
      if (lv > 0) { const RC = lv === 2 ? 0xff9a3a : 0x5ab8ff, CC = lv === 2 ? 0xffb860 : 0x7cc8ff;
        this.rayAcc = (this.rayAcc || 0) + dt * (lv === 2 ? 62 : 42);
        while (this.rayAcc >= 1) { this.rayAcc -= 1; wheels.forEach(s => { const sx = s * R.x;
          Fx.ray(this, sx, 0.25, R.z, out * (0.2 + Math.random()) + (Math.random() - 0.5) * 0.9, -0.15 + Math.random() * 1.1, -0.2 - Math.random() * 0.9 + (Math.random() - 0.5) * 0.6,
            (lv === 2 ? 3.2 : 2.4) + Math.random() * (lv === 2 ? 3 : 2), lv === 2 ? 0.38 : 0.3, RC, 0.09 + Math.random() * 0.08); }); }
        this.coreCD = (this.coreCD || 0) - dt;
        if (this.coreCD <= 0) { this.coreCD = 0.04; wheels.forEach(s => Fx.rayCore(this, s * R.x, 0.25, R.z, lv === 2 ? 3.4 : 2.7, CC, 0.09)); }
        this.glintAcc = (this.glintAcc || 0) + dt * (lv === 2 ? 30 : 18);
        while (this.glintAcc >= 1) { this.glintAcc -= 1; const sw = wheels[Math.floor(Math.random() * wheels.length)], w = g.localToWorld(_w.set(sw * R.x, 0.3, R.z));
          Fx.glint(w.x, w.y, w.z, -fx * (2 + Math.random() * 4) + lx * out * (1 + Math.random() * 4), 1.5 + Math.random() * 3, -fz * (2 + Math.random() * 4) + lz * out * (1 + Math.random() * 4), CC, 0.16 + Math.random() * 0.1, 0.35); } }
      // com carga: brilho colado nas rodas, pulsando (a "chama" do drift)
      if (lv > 0) { this.glowCD -= dt; if (this.glowCD <= 0) { this.glowCD = 0.03; const pul = 1 + 0.18 * Math.sin(this.fxT * 40);
          wheels.forEach(s => { const w = g.localToWorld(_w.set(s * R.x, 0.22, R.z)); Fx.puff('glow', w.x, w.y, w.z, -fx * 2, 0.3, -fz * 2, col, (lv === 2 ? 1.5 : 1.1) * pul, 0.4, 0.12, 0.85); }); }
        // leque de chama colorida saindo das rodas para trás e para fora (a "língua" de fogo do drift carregado do MK8)
        this.fanAcc = (this.fanAcc || 0) + dt * (lv === 2 ? 34 : 24);
        while (this.fanAcc >= 1) { this.fanAcc -= 1; wheels.forEach(s => { const w = g.localToWorld(_w.set(s * R.x, 0.2, R.z)), b = 3 + Math.random() * 3, o = 1 + Math.random() * 2.5;
          Fx.flame(w.x, w.y, w.z, -fx * b + lx * out * o, 0.4 + Math.random() * 0.8, -fz * b + lz * out * o, lv === 2 ? 0.62 : 0.5, 0.2, lv === 2 ? 2 : 1, true); }); } }
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
      this.pos.set(p.x, tr.roadBase + (tr.hAt ? tr.hAt(i) : tr.bump(i)), p.z); this.ang = this.mvAng = Math.atan2(tr.T[i].x, tr.T[i].z); this.speed = 0; this.air = false; this.trick = false; this.vy = 0; this.vyG = 0; this.stuckT = 0; this.drifting = false; this.railSide = null;
    }

    // corredor invisível em volta da pista + limites do mapa
    collideWalls(dt) {
      const tr = this.track, p = this.pos; this.bumpCool -= dt;
      let bd = 1e9, bi = this.idx;
      for (let d = -30; d <= 30; d++) { const i = (this.idx + d + tr.N) % tr.N, dx = tr.S[i].x - p.x, dz = tr.S[i].z - p.z, q = dx * dx + dz * dz; if (q < bd) { bd = q; bi = i; } }
      const dist = Math.sqrt(bd); let hit = false, nx = 0, nz = 0;
      // parede invisível: distância fixa (WALL) ou por trecho (pontes, túnel, atalhos: tr.wallAt)
      const WL = tr.wallAt ? tr.wallAt(bi, (p.x - tr.S[bi].x) * tr.T[bi].z - (p.z - tr.S[bi].z) * tr.T[bi].x) : tr.WALL;
      if (dist > WL) { nx = (p.x - tr.S[bi].x) / dist; nz = (p.z - tr.S[bi].z) / dist; p.x = tr.S[bi].x + nx * WL; p.z = tr.S[bi].z + nz * WL; hit = true; }
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
          if (mode === 'dust') { Fx.puff('smoke', w.x + (Math.random() - 0.5), w.y + 0.2, w.z + (Math.random() - 0.5), Math.sin(this.mvAng) * back + (Math.random() - 0.5) * 3, 1.2 + Math.random(), Math.cos(this.mvAng) * back + (Math.random() - 0.5) * 3, shade(dustCol), 0.9, 3.6, 0.9, 0.55, 0.6);
            // terra e grama voando das rodas (estilo MK8): na grama, folhas verdes + torrões; na terra batida, pedrinhas
            for (let k = 0; k < 2; k++) { const grass = !this.dirt && k === 0;
              Fx.debris(grass ? 1 : 0, w.x + (Math.random() - 0.5) * 0.5, w.y + 0.15, w.z + (Math.random() - 0.5) * 0.5,
                Math.sin(this.mvAng) * back * 0.5 + (Math.random() - 0.5) * 4, 3 + Math.random() * 4, Math.cos(this.mvAng) * back * 0.5 + (Math.random() - 0.5) * 4,
                grass ? 0.32 : 0.16, grass ? 0.9 : 0.7, shade(grass ? 0x5c9a38 : (this.dirt ? dustCol : 0x6b4a2c)), this.pos.y + 0.03); } }
          else Fx.puff('smoke', w.x, w.y + 0.25, w.z, Math.sin(this.mvAng) * back * 0.4 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 0.8, Math.cos(this.mvAng) * back * 0.4 + (Math.random() - 0.5) * 2, shade(0xe6e8ee), mode === 'drift' ? 0.8 : 0.7, mode === 'drift' ? 3.4 + 0.4 * this.driftLevel() : 2.4, mode === 'drift' ? 0.9 : 0.55, mode === 'drift' ? 0.64 : 0.38, 0.8);   // drift: fumaça engrossa com a carga
        });
      }
      // aterrissagem: anel de poeira em volta do kart (cinza claro no asfalto, cor de terra fora) + pedrinhas fora da pista
      if (this.landFx) { const imp = this.landFx; this.landFx = 0; const k = Math.min(1, (imp - 5) / 12), col = shade(this.off ? (this.track.dustColor || 0xc9a878) : 0xdcd8d0);
        for (let i = 0; i < 10; i++) { const a = i / 10 * 6.2832 + Math.random() * 0.3, v = 3 + 4 * k;
          Fx.puff('smoke', this.pos.x + Math.cos(a) * 1.2, this.pos.y + 0.2, this.pos.z + Math.sin(a) * 1.2, Math.cos(a) * v, 0.4, Math.sin(a) * v, col, 0.8, 3 + 1.5 * k, 0.75, 0.5, 0.3);
          if (this.off) Fx.debris(0, this.pos.x, this.pos.y + 0.3, this.pos.z, Math.cos(a) * (2 + Math.random() * 3), 3 + Math.random() * 3, Math.sin(a) * (2 + Math.random() * 3), 0.15, 0.6, shade(0x6b4a2c), this.pos.y + 0.03); }
        // queda forte no asfalto: o assoalho raspa e solta faíscas para a frente e para os lados
        if (!this.off && imp > 9) { const fx = Math.sin(this.mvAng), fz = Math.cos(this.mvAng), n = Math.min(22, 8 + (imp - 9) * 1.5 | 0);
          for (let i = 0; i < n; i++) Fx.spark(this.pos.x + (Math.random() - 0.5) * 1.6, this.pos.y + 0.15, this.pos.z + (Math.random() - 0.5) * 1.6, fx * (sp * 0.4 + Math.random() * 6) + (Math.random() - 0.5) * 7, 1 + Math.random() * 3, fz * (sp * 0.4 + Math.random() * 6) + (Math.random() - 0.5) * 7, i % 2 ? 0xffd27a : 0xffffff, 0.22, 0.45, this.pos.y + 0.04); } }
      const nearCam = this.isPlayer || !Fx.cam || Fx.cam.position.distanceToSquared(this.pos) < 3600;
      // plataforma de turbo: explosão de chamas e faíscas ao passar
      if (this.padFx) { this.padFx = false; if (nearCam) { const fx = Math.sin(this.mvAng), fz = Math.cos(this.mvAng);
          for (let i = 0; i < 12; i++) { const a = Math.random() * 6.2832, v = 2 + Math.random() * 3; Fx.flame(this.pos.x - fx, this.pos.y + 0.5, this.pos.z - fz, Math.cos(a) * v - fx * 6, 1 + Math.random() * 2, Math.sin(a) * v - fz * 6, 1.1 + Math.random() * 0.5, 0.45, 0); }
          for (let i = 0; i < 16; i++) { const a = Math.random() * 6.2832, v = 5 + Math.random() * 5; Fx.spark(this.pos.x, this.pos.y + 0.4, this.pos.z, Math.cos(a) * v - fx * 8, 3 + Math.random() * 4, Math.sin(a) * v - fz * 8, i % 3 ? 0xffb040 : 0xffffff, 0.26, 0.5, this.pos.y + 0.04); } } }
      // fumacinha do escapamento: ao arrancar e acelerar em baixa velocidade (cinza, sobe e some)
      { const acc = (sp - (this.lastSp || 0)) / Math.max(dt, 1e-3); this.lastSp = sp; this.exCD = (this.exCD || 0) - dt;
        if (nearCam && !this.air && !this.wet && acc > 3 && sp < P.MAX * 0.45 && this.boostT <= 0 && this.exCD <= 0 && this.m.flames.length) { this.exCD = 0.07 + sp / P.MAX * 0.15;
          const fx = Math.sin(this.mvAng), fz = Math.cos(this.mvAng);
          (this.m.moto ? this.m.flames.slice(0, 1) : this.m.flames).forEach(f => { f.getWorldPosition(_w);
            Fx.puff('smoke', _w.x, _w.y, _w.z, -fx * (2 + sp * 0.2) + (Math.random() - 0.5), 0.6 + Math.random() * 0.6, -fz * (2 + sp * 0.2) + (Math.random() - 0.5), shade(0x8c8a88), 0.35, 4, 0.8, 0.3, 0.9); }); } }
      // turbo: rastros de vento passando pelo kart (só perto da câmera), na cor do turbo
      if (this.boostT > 0 && (this.isPlayer || !Fx.cam || Fx.cam.position.distanceToSquared(this.pos) < 3600)) {
        this.windAcc = (this.windAcc || 0) + dt * 40; const fx = Math.sin(this.mvAng), fz = Math.cos(this.mvAng), wc = [0xffffff, 0xbfe6ff, 0xffe2b0, 0xe8c8ff][this.boostTint || 0];
        const lx = Math.cos(this.ang), lz = -Math.sin(this.ang);   // "esquerda" do kart
        while (this.windAcc >= 1) { this.windAcc -= 1; const a = Math.random() * 6.2832, r = 1.4 + Math.random() * 1.6, cs = Math.cos(a) * r, sn = Math.sin(a) * r * 0.6;
          // anel em volta do kart (lados e em cima), andando quase junto com ele: na tela os riscos passam para trás
          Fx.streak(this.pos.x + lx * cs - fx * 2, this.pos.y + 0.9 + Math.abs(sn), this.pos.z + lz * cs - fz * 2, fx * sp * 0.82, 0, fz * sp * 0.82, wc, 0.05, 0.22); } }
      if (this.boostT > 0 && !this.off && this.trailCD <= 0) {
        this.trailCD = 0.016;
        (this.m.moto ? this.m.flames.slice(0, 1) : this.m.flames).forEach(f => { f.getWorldPosition(_w); if (this.m.moto && this.m.flames[1]) { this.m.flames[1].getWorldPosition(_w2); _w.add(_w2).multiplyScalar(0.5); }
          Fx.flame(_w.x + (Math.random() - 0.5) * 0.2, _w.y + (Math.random() - 0.5) * 0.15, _w.z + (Math.random() - 0.5) * 0.2, -Math.sin(this.mvAng) * (5 + Math.random() * 3), 0.6 + Math.random(), -Math.cos(this.mvAng) * (5 + Math.random() * 3), 0.95 + Math.random() * 0.4, 0.45, this.boostTint || 0);   // azul no mini-turbo, laranja no super/plataforma
          if (Math.random() < 0.5) Fx.puff('glow', _w.x, _w.y, _w.z, -Math.sin(this.mvAng) * 12, (Math.random() - 0.5) * 3, -Math.cos(this.mvAng) * 12, Fx.FIRE_CORE[this.boostTint || 0], 0.45, 0.1, 0.5, 1);
          // brasas: pontinhos quentes que sobem flutuando atrás do escapamento
          if (Math.random() < 0.35) { const e = Fx.spark(_w.x, _w.y, _w.z, -Math.sin(this.mvAng) * (4 + Math.random() * 4) + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, -Math.cos(this.mvAng) * (4 + Math.random() * 4) + (Math.random() - 0.5) * 3, Fx.FIRE_CORE[this.boostTint || 0], 0.12, 0.7); if (e) e.g = -1.5; }
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
