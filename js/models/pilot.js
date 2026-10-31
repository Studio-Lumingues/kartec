// =====================================================================================
// models/pilot.js — pilotos 3D: MENINO e MENINA (js/models/entidades/menino.glb e menina.glb)
//
// Os dois .glb são malhas paradas (sem esqueleto), em "pose T", olhando para +X. Ao carregar, este arquivo:
//   1) junta as peças do modelo numa malha só (a menina tem as maria-chiquinhas separadas) e vira o boneco
//      para olhar para +Z (a frente do kart);
//   2) monta um ESQUELETO de 14 ossos (quadril, coluna, peito, cabeça, braços e pernas) nas juntas medidas
//      do modelo (RIG, abaixo) e distribui os pesos de cada vértice com transições suaves nas juntas;
//   3) a pose sentada é feita em tempo real com IK de dois ossos:
//      mãos -> pegadores do volante/guidão | pés -> pedais/pedaleiras.
// Cada veículo informa onde ficam assento, volante e pedais (cockpit em karts.js); o piloto se ajusta.
// Cores: o shader troca o vermelho do macacão (corpo) e do capacete (cabeça) e o tom de pele.
// Visual: material toon de 3 tons + contorno de tinta (Toon.outline acompanha o esqueleto).
// Se os arquivos não carregarem, entra um piloto procedural simples com a mesma interface.
//
// spec.pilot = 'menino' | 'menina' escolhe o personagem (padrão em CFG.DEFAULT_SPEC.pilot).
// =====================================================================================
(function () {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4();
  const _L = { S: new THREE.Vector3(), T: new THREE.Vector3(), E: new THREE.Vector3(), pole: new THREE.Vector3(), pq: new THREE.Quaternion(), rq: new THREE.Quaternion(), q1: new THREE.Quaternion(), q2: new THREE.Quaternion() };
  const VER = '202610310100';   // muda junto com os .glb (evita cache antigo)

  // ---------- personagens ----------
  const CHARS = [
    { id: 'menino', name: 'Menino', url: 'js/models/entidades/menino.glb', embed: 'js/models/entidades/menino.glb.js' },
    { id: 'menina', name: 'Menina', url: 'js/models/entidades/menina.glb', embed: 'js/models/entidades/menina.glb.js' }
  ];

  // ---------- juntas do esqueleto (espaço do piloto: olhando para +Z, esquerda = +X, altura 0,98) ----------
  // Os dois modelos têm o mesmo corpo; medidas tiradas dos próprios .glb.
  const RIG = {
    hips: [0, -0.24, 0], spine: [0, -0.15, 0], chest: [0, -0.06, 0], head: [0, 0.035, 0],
    shoulder: [0.12, -0.02, 0], elbow: [0.25, -0.025, 0], hand: [0.39, -0.03, 0],        // lado esquerdo (+X); o direito é espelhado
    hip: [0.075, -0.26, 0], knee: [0.075, -0.35, 0.005], foot: [0.075, -0.465, 0.05],
    HEAD_Y: 0.04,      // acima disto é capacete (cor do capacete); abaixo, macacão
    ARM_Y: [-0.12, 0.045]   // faixa de altura dos braços na pose T
  };

  // ---------- carregador de .glb (compartilhado com karts.js) ----------
  // http(s): GLTFLoader direto (com o decodificador meshopt). file:// (index.html aberto do disco): o fetch é
  // bloqueado, então carrega a cópia em base64 (<arquivo>.glb.js, que preenche window.GLB_EMBED[nome]).
  function b64ToBuffer(b64) { const bin = atob(b64), n = bin.length, u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  const GLBAsset = {
    loader() { const l = new THREE.GLTFLoader(); if (window.MeshoptDecoder && l.setMeshoptDecoder) l.setMeshoptDecoder(window.MeshoptDecoder); return l; },
    load(url, embed, onProgress) {
      const key = url.split('/').pop().replace(/\.glb$/, '');
      return new Promise((resolve, reject) => {
        if (!THREE.GLTFLoader) return reject(new Error('GLTFLoader não carregado'));
        const parse = buf => { try { this.loader().parse(buf, '', resolve, reject); } catch (e) { reject(e); } };
        const viaScript = () => {
          const E = window.GLB_EMBED || {};
          if (E[key]) return parse(b64ToBuffer(E[key]));
          if (!embed) return reject(new Error(url + ' não carregou'));
          const s = document.createElement('script'); s.src = embed + '?v=' + VER; s.async = true;
          s.onload = () => (window.GLB_EMBED && window.GLB_EMBED[key]) ? parse(b64ToBuffer(window.GLB_EMBED[key])) : reject(new Error(embed + ' vazio'));
          s.onerror = () => reject(new Error(embed + ' não encontrado')); document.head.appendChild(s);
        };
        if (location.protocol === 'file:') viaScript();
        else this.loader().load(url + '?v=' + VER, resolve, x => { if (x.total && onProgress) onProgress(x.loaded / x.total); }, viaScript);
      });
    },
    // geometria com atributos em Float32 (os .glb vêm quantizados: Int16/Int8 normalizados) — necessário para
    // aplicar matrizes, juntar peças e criar a malha com esqueleto
    toFloat(geo) {
      const g = new THREE.BufferGeometry();
      Object.keys(geo.attributes).forEach(k => {
        const a = geo.attributes[k], n = a.count, s = a.itemSize, out = new Float32Array(n * s), arr = a.array;
        let div = 1;
        if (a.normalized) { if (arr instanceof Int8Array) div = 127; else if (arr instanceof Uint8Array) div = 255; else if (arr instanceof Int16Array) div = 32767; else if (arr instanceof Uint16Array) div = 65535; }
        if (a.isInterleavedBufferAttribute) {
          const d = a.data.array, st = a.data.stride, off = a.offset;
          for (let i = 0; i < n; i++) for (let c = 0; c < s; c++) out[i * s + c] = d[i * st + off + c];
        } else for (let i = 0; i < n * s; i++) out[i] = arr[i];
        if (div !== 1) for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, out[i] / div);
        g.setAttribute(k, new THREE.BufferAttribute(out, s));
      });
      if (geo.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(geo.index.array), 1));
      return g;
    },
    // junta várias geometrias (mesmos atributos) numa só
    merge(list) {
      const keys = Object.keys(list[0].attributes).filter(k => list.every(g => g.attributes[k]));
      const out = new THREE.BufferGeometry(); let vtx = 0, idx = [];
      keys.forEach(k => {
        const s = list[0].attributes[k].itemSize, tot = list.reduce((t, g) => t + g.attributes[k].count, 0), arr = new Float32Array(tot * s); let o = 0;
        list.forEach(g => { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; });
        out.setAttribute(k, new THREE.BufferAttribute(arr, s));
      });
      list.forEach(g => { const n = g.attributes.position.count; if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + vtx); else for (let i = 0; i < n; i++) idx.push(i + vtx); vtx += n; });
      out.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
      return out;
    },
    // textura do modelo: o jogo inteiro trabalha sem conversão sRGB; sem mipmaps (as ilhas do atlas não "sangram")
    prepMap(map) {
      if (!map) return null;
      map.encoding = THREE.LinearEncoding; map.generateMipmaps = false; map.minFilter = THREE.LinearFilter; map.anisotropy = (window.TX && TX.aniso) || 1; map.needsUpdate = true;
      return map;
    }
  };
  window.GLBAsset = GLBAsset;

  // ---------- recoloração ----------
  // A textura vem pintada: macacão e capacete VERMELHOS, pele bege, luvas brancas, botas pretas (menina: cabelo
  // castanho). A troca é feita em CADA texel antes da filtragem (bilinear manual) para as bordas não mancharem.
  // Vermelho = matiz vermelha bem saturada (mantém o sombreado da textura). Pele = proporção g/r e b/r da pele
  // da textura + clara (o cabelo castanho tem a mesma proporção, mas é bem mais escuro: não é afetado).
  const RECOLOR_FS = [
    'uniform vec3 uSuit; uniform vec3 uHelmet; uniform vec3 uSkin; uniform vec2 uTexSize; uniform float uHeadY; varying vec3 vBind;',
    'vec3 pilotRecolor(vec3 c, float head) {',
    '  float r = max(c.r, 1e-3), gr = c.g / r, br = c.b / r;',
    '  float wR = smoothstep(0.5, 0.7, 1.0 - max(gr, br)) * smoothstep(0.08, 0.2, c.r);',
    '  vec3 tint = mix(uSuit, uHelmet, head) * pow(clamp(c.r / 0.9, 0.0, 1.2), 0.8) + vec3(min(c.g, c.b)) * 0.3;',
    '  float wK = (1.0 - smoothstep(0.05, 0.11, abs(gr - 0.79))) * (1.0 - smoothstep(0.07, 0.13, abs(br - 0.64))) * smoothstep(0.58, 0.72, c.r);',
    '  vec3 o = mix(c, tint, wR);',
    '  return mix(o, uSkin * clamp(c.r / 0.94, 0.0, 1.15), wK);',
    '}'
  ].join('\n');
  const RECOLOR_BODY = [
    '{ float head = smoothstep(uHeadY - 0.02, uHeadY + 0.02, vBind.y);',
    '  vec2 e = 1.0 / uTexSize, p = vUv * uTexSize - 0.5, f = fract(p), b = (floor(p) + 0.5) * e;',
    '  vec3 c00 = pilotRecolor(texture2D(map, b).rgb, head), c10 = pilotRecolor(texture2D(map, b + vec2(e.x, 0.0)).rgb, head);',
    '  vec3 c01 = pilotRecolor(texture2D(map, b + vec2(0.0, e.y)).rgb, head), c11 = pilotRecolor(texture2D(map, b + e).rgb, head);',
    '  diffuseColor.rgb = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y) * diffuse; }'
  ].join('\n');

  // ---------- IK analítico de dois ossos (no espaço do piloto) ----------
  const _q2dir = new THREE.Vector3();
  function solve2(S, T, L1, L2, pole, outE) {
    const d0 = _a.subVectors(T, S), dist = d0.length(), dir = _q2dir.copy(d0).divideScalar(dist || 1);
    const d = Math.max(Math.abs(L1 - L2) + 1e-3, Math.min(L1 + L2 - 1e-3, dist));
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const p = _b.copy(pole).addScaledVector(dir, -pole.dot(dir)); if (p.lengthSq() < 1e-8) p.set(0, 1, 0); p.normalize();
    return outE.copy(S).addScaledVector(dir, a).addScaledVector(p, h);
  }

  // ---------- montagem do esqueleto + pesos (uma vez por personagem) ----------
  const lin = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  function buildRigged(gltf) {
    gltf.scene.updateMatrixWorld(true);
    const parts = []; let map = null;
    gltf.scene.traverse(o => { if (!o.isMesh) return; const g = GLBAsset.toFloat(o.geometry); g.applyMatrix4(o.matrixWorld); parts.push(g); if (!map && o.material && o.material.map) map = o.material.map; });
    if (!parts.length) throw new Error('o arquivo não tem malha');
    const geo = parts.length > 1 ? GLBAsset.merge(parts) : parts[0];
    geo.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));        // olhava para +X -> passa a olhar para +Z
    geo.computeBoundingBox();
    // ossos
    const R = RIG, mk = (name, p, parent) => { const b = new THREE.Bone(); b.name = name; const w = V3(...p); b.userData.w = w; if (parent) { b.position.copy(w).sub(parent.userData.w); parent.add(b); } else b.position.copy(w); return b; };
    const hips = mk('hips', R.hips), spine = mk('spine', R.spine, hips), chest = mk('chest', R.chest, spine), head = mk('head', R.head, chest);
    const mir = p => [-p[0], p[1], p[2]];
    const uaL = mk('upperarm_L', R.shoulder, chest), faL = mk('forearm_L', R.elbow, uaL), uaR = mk('upperarm_R', mir(R.shoulder), chest), faR = mk('forearm_R', mir(R.elbow), uaR);
    const thL = mk('thigh_L', R.hip, hips), shL = mk('shin_L', R.knee, thL), thR = mk('thigh_R', mir(R.hip), hips), shR = mk('shin_R', mir(R.knee), thR);
    const bones = [hips, spine, chest, head, uaL, faL, uaR, faR, thL, shL, thR, shR], BI = {}; bones.forEach((b, i) => BI[b.name] = i);
    // pesos: no máximo 2 ossos por vértice, com rampa linear nas juntas
    const P = geo.attributes.position, n = P.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const sh = R.shoulder[0], el = R.elbow[0], hy = R.hip[1], ky = R.knee[1];
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), ax = Math.abs(x), L = x >= 0;
      let A, B, t;
      if (y > R.ARM_Y[0] && y < R.ARM_Y[1] && ax > sh - 0.02) {                      // braço
        const ua = L ? 'upperarm_L' : 'upperarm_R', fa = L ? 'forearm_L' : 'forearm_R';
        if (ax < el - 0.025) { A = 'chest'; B = ua; t = lin(ax, sh - 0.02, sh + 0.03); }
        else { A = ua; B = fa; t = lin(ax, el - 0.025, el + 0.025); }
      } else if (y < hy + 0.03) {                                                     // perna
        const th = L ? 'thigh_L' : 'thigh_R', sn = L ? 'shin_L' : 'shin_R';
        if (y > ky + 0.02) { A = 'hips'; B = th; t = 1 - lin(y, hy - 0.02, hy + 0.03); }
        else { A = th; B = sn; t = 1 - lin(y, ky - 0.02, ky + 0.02); }
      } else if (y < R.spine[1] + 0.02) { A = 'hips'; B = 'spine'; t = lin(y, R.spine[1] - 0.03, R.spine[1] + 0.02); }
      else if (y < R.chest[1] + 0.02) { A = 'spine'; B = 'chest'; t = lin(y, R.chest[1] - 0.03, R.chest[1] + 0.02); }
      else { A = 'chest'; B = 'head'; t = lin(y, R.head[1] - 0.015, R.head[1] + 0.02); }
      si[i * 4] = BI[A]; si[i * 4 + 1] = BI[B]; sw[i * 4] = 1 - t; sw[i * 4 + 1] = t;
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const scene = new THREE.Group(), mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
    mesh.name = 'pilotMesh'; scene.add(hips); scene.add(mesh); scene.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    // direções de repouso e comprimentos dos membros (ombro->cotovelo->mão, quadril->joelho->pé)
    const W = nm => bones[BI[nm]].userData.w, dir = {}, len = {};
    const seg = (nm, a, b) => { dir[nm] = b.clone().sub(a).normalize(); len[nm] = a.distanceTo(b); };
    seg('upperarm_L', W('upperarm_L'), W('forearm_L')); seg('forearm_L', W('forearm_L'), V3(...R.hand));
    seg('upperarm_R', W('upperarm_R'), W('forearm_R')); seg('forearm_R', W('forearm_R'), V3(...mir(R.hand)));
    seg('thigh_L', W('thigh_L'), W('shin_L')); seg('shin_L', W('shin_L'), V3(...R.foot));
    seg('thigh_R', W('thigh_R'), W('shin_R')); seg('shin_R', W('shin_R'), V3(...mir(R.foot)));
    return { scene, map: GLBAsset.prepMap(map), bind: { hips: V3(...R.hips), head: V3(...R.head), dir }, len, height: geo.boundingBox.max.y - geo.boundingBox.min.y };
  }

  class PilotRig {
    constructor(tpl, spec) {
      this.root = THREE.SkeletonUtils.clone(tpl.scene);
      this.bones = {}; this.root.traverse(o => { if (o.isBone) this.bones[o.name] = o; if (o.isSkinnedMesh) this.mesh = o; });
      this.bind = tpl.bind; this.len = tpl.len; this.char = tpl.id;
      // toon (3 tons) + brilho suave + recoloração
      const img = tpl.map && tpl.map.image, tw = (img && img.width) || 1024, th = (img && img.height) || 1024;
      const u = this.u = { uSuit: { value: new THREE.Color() }, uHelmet: { value: new THREE.Color() }, uSkin: { value: new THREE.Color() }, uTexSize: { value: new THREE.Vector2(tw, th) }, uHeadY: { value: RIG.HEAD_Y } };
      const mat = this.mat = Toon.mat({ map: tpl.map, skinning: true }, { gloss: 0.35, rim: 0.3, sat: 1, key: 'pilot', hook: sh => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = 'varying vec3 vBind;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
        sh.fragmentShader = RECOLOR_FS + '\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + RECOLOR_BODY);
      } });
      this.mesh.material = mat; this.mesh.castShadow = true; this.mesh.frustumCulled = false;
      Toon.outline(this.root, 0.012);                                                   // contorno de desenho (acompanha o esqueleto)
      this.setColors(spec);
      this.t = Math.random() * 10; this.lean = 0; this.look = 0; this.bob = 0;
    }
    setColors(spec) { this.u.uSuit.value.set(spec.suit); this.u.uHelmet.value.set(spec.helmet); this.u.uSkin.value.set(spec.skin); }
    setAccessory() {}                                                                    // acessórios foram removidos do jogo
    // encaixa no cockpit: cp = { seat, scale, hands:[gripL, gripR] (Object3D), feet:[pedalL, pedalR] (Object3D), recline }
    attach(parent, cp) {
      this.cp = cp; const s = cp.scale; this.root.scale.setScalar(s);
      this.root.position.copy(cp.seat).addScaledVector(this.bind.hips, -s);           // quadril exatamente no ponto H do assento
      parent.add(this.root);
    }
    // anima: st = { steer (-1..1, + = esquerda), speed (0..1), boost, drift (-1/0/1), air }
    update(dt, st) {
      const B = this.bones, cp = this.cp; if (!cp) return; this.t += dt;
      const k = Math.min(1, 6 * dt), lean = (st.steer || 0) * 0.2 + (st.drift || 0) * 0.12;
      this.lean += (lean - this.lean) * k; this.look += ((st.steer || 0) * 0.35 + (st.drift || 0) * 0.15 - this.look) * k;
      const back = (cp.recline || 0) + (st.boost ? 0.1 : 0) + (st.speed || 0) * 0.05;
      this.bob = st.air ? 0.02 : Math.sin(this.t * 17) * 0.003 * (st.speed || 0);
      B.hips.rotation.set(0, 0, 0); B.hips.position.y = this.bind.hips.y + this.bob;
      B.spine.rotation.set(-back * 0.5, 0, -this.lean * 0.5);
      B.chest.rotation.set(-back * 0.5 + 0.05, this.lean * 0.3, -this.lean * 0.5);
      B.head.rotation.set((cp.headTilt || 0) + back * 0.8, this.look, this.lean * 0.4);   // a cabeça compensa a inclinação: olha para a frente
      this.root.updateMatrixWorld(true);
      // braços -> volante | pernas -> pedais
      this.limb('upperarm_L', 'forearm_L', cp.hands[0], 1, true); this.limb('upperarm_R', 'forearm_R', cp.hands[1], -1, true);
      this.limb('thigh_L', 'shin_L', cp.feet[0], 1, false); this.limb('thigh_R', 'shin_R', cp.feet[1], -1, false);
    }
    // IK de um membro: posiciona os dois ossos para a ponta (mão / pé) tocar o alvo
    limb(n1, n2, target, side, arm) {
      if (!target) return;
      const b1 = this.bones[n1], b2 = this.bones[n2], bd = this.bind, rootInv = _m.copy(this.root.matrixWorld).invert();
      b1.rotation.set(0, 0, 0); b2.rotation.set(0, 0, 0); b1.updateMatrixWorld(true);
      const S = b1.getWorldPosition(_L.S).applyMatrix4(rootInv);
      const T = target.getWorldPosition(_L.T).applyMatrix4(rootInv);
      const L1 = this.len[n1], L2 = this.len[n2];
      const pole = arm ? _L.pole.set(side * 0.8, -0.55, -0.35) : _L.pole.set(side * 0.35, 0.6, 0.7);
      const E = solve2(S, T, L1, L2, pole, _L.E);
      b1.parent.getWorldQuaternion(_L.pq); this.root.getWorldQuaternion(_L.rq);
      const pRel = _L.rq.invert().multiply(_L.pq);
      const q1 = _L.q1.setFromUnitVectors(bd.dir[n1], _c.subVectors(E, S).normalize());
      b1.quaternion.copy(pRel.invert().multiply(q1));
      const q2 = _L.q2.setFromUnitVectors(bd.dir[n2], _c.subVectors(T, E).normalize());
      b2.quaternion.copy(q1.invert().multiply(q2));
      b1.updateMatrixWorld(true);
    }
    dispose() { if (this.root.parent) this.root.parent.remove(this.root); this.mat.dispose(); }
  }

  // ---------- piloto procedural (reserva, se os arquivos 3D não carregarem) ----------
  class FallbackPilot {
    constructor(spec) {
      const root = this.root = new THREE.Group();
      this.suitM = KartMats.std(spec.suit, 0.6, 0); this.helmM = KartMats.std(spec.helmet, 0.25, 0.2); this.skinM = KartMats.std(spec.skin, 0.7, 0);
      const torso = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), this.suitM); torso.position.y = -0.12; torso.scale.set(1, 1.2, 0.85); root.add(torso);
      const head = this.head = new THREE.Group(); head.position.y = 0.22; root.add(head);
      head.add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 16), this.helmM));
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 14), this.skinM); face.position.set(0, -0.02, 0.09); face.scale.set(1, 0.85, 0.9); head.add(face);
      this.arms = [1, -1].map(s => { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 8), this.suitM); a.geometry.translate(0, 0.5, 0); a.geometry.rotateX(Math.PI / 2); a.position.set(s * 0.13, -0.03, 0); root.add(a); return a; });
      root.traverse(o => { if (o.isMesh) o.castShadow = true; }); Toon.outline(root, 0.015);
    }
    setColors(spec) { this.suitM.color.set(spec.suit); this.helmM.color.set(spec.helmet); this.skinM.color.set(spec.skin); }
    setAccessory() {}
    attach(parent, cp) { this.cp = cp; this.root.scale.setScalar(cp.scale); this.root.position.copy(cp.seat).y += 0.24 * cp.scale; parent.add(this.root); }
    update(dt, st) {
      this.head.rotation.y = (st.steer || 0) * 0.35; this.root.rotation.z = -(st.steer || 0) * 0.1;
      this.root.updateMatrixWorld(true);
      this.arms.forEach((a, i) => { const t = this.cp.hands[i]; if (!t) return; const w = t.getWorldPosition(new THREE.Vector3()); const p = a.getWorldPosition(new THREE.Vector3()); a.lookAt(w); a.scale.z = Math.max(0.2, p.distanceTo(w) / a.getWorldScale(new THREE.Vector3()).x); });
    }
    dispose() { if (this.root.parent) this.root.parent.remove(this.root); }
  }

  // ---------- carregamento ----------
  const Pilot = {
    status: 'idle', progress: 0, tpl: null, tpls: {}, chars: CHARS, accessories: [{ id: 'none', name: 'Nenhum', icon: 'none' }],
    load(onProgress) {
      if (this._p) return this._p;
      this.status = 'loading';
      const prog = CHARS.map(() => 0), tick = () => { this.progress = prog.reduce((a, b) => a + b, 0) / CHARS.length; onProgress && onProgress(this.progress); };
      this._p = Promise.all(CHARS.map((c, i) => GLBAsset.load(c.url, c.embed, p => { prog[i] = p * 0.95; tick(); })
        .then(gltf => { const t = buildRigged(gltf); t.id = c.id; this.tpls[c.id] = t; prog[i] = 1; tick(); return true; })
        .catch(e => { console.warn('[piloto] ' + c.name + ' indisponível:', e); prog[i] = 1; tick(); return false; })))
        .then(r => {
          this.tpl = this.tpls[CHARS[0].id] || this.tpls[CHARS[1].id] || null;
          this.status = this.tpl ? 'ready' : 'fallback'; this.progress = 1;
          if (!this.tpl) console.warn('[piloto] modelos 3D indisponíveis, usando o piloto procedural');
          return r.some(Boolean);
        });
      return this._p;
    },
    // texturas que nunca devem ser descartadas ao sair de uma corrida (main.js > dispose)
    textures() { return Object.values(this.tpls).map(t => t.map).filter(Boolean); },
    create(spec) {
      const t = this.tpls[spec && spec.pilot] || this.tpl;
      return t ? new PilotRig(t, spec) : new FallbackPilot(spec);
    }
  };
  window.Pilot = Pilot;
})();
