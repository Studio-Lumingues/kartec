// =====================================================================================
// models/pilot.js — piloto 3D (modelo "meshy-model" otimizado e com esqueleto)
//
// O arquivo original (430 mil triângulos, 3 texturas 2048², 17,8 MB, sem esqueleto) passou por um
// pipeline offline: decimação que preserva as UVs (18 mil triângulos), texturas reduzidas (1024/512)
// e um esqueleto de 14 ossos com pesos suavizados (quadril, coluna, peito, cabeça, braços e pernas).
// Resultado: assets/pilot.glb (~1 MB). Para rodar abrindo o index.html direto (file://), onde o
// fetch() é bloqueado, existe a cópia assets/pilot.glb.js (o mesmo arquivo em base64).
//
// Pose: o modelo é "em pé"; a pose sentada é montada em tempo real com IK de dois ossos:
//   mãos -> pegadores do volante/guidão (giram junto com o volante) | pés -> pedais/pedaleiras.
// Cada modelo de kart informa onde ficam assento, volante e pedais (COCKPIT); o piloto se ajusta.
// Cores: o shader troca o vermelho da roupa (corpo) e do capacete (cabeça) e o tom de pele.
// Visual: material toon de 3 tons + contorno de tinta (Toon.outline acompanha o esqueleto).
// Se o arquivo não carregar, entra um piloto procedural simples com a mesma interface.
// =====================================================================================
(function () {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
  // temporários do IK (reaproveitados em todo quadro)
  // física da antena: constantes (rigidez K, amortecimento C, ganho da inércia G...) e vetores reaproveitados
  // D = arrasto do vento (proporcional a v²): com o kart andando, a haste deita para trás; FLUT = tremidinha com a velocidade
  const ANT = { K: 70, C: 6.5, G: 0.55, D: 0.026, FLUT: 0.9, MAX: 0.9, WHIP: 0.03, MAXA: 140, FILTER: 18 };
  const _ant = { p: new THREE.Vector3(), v: new THREE.Vector3(), a: new THREE.Vector3(), l: new THREE.Vector3(), vl: new THREE.Vector3(), q: new THREE.Quaternion() };
  const _L = { S: new THREE.Vector3(), T: new THREE.Vector3(), E: new THREE.Vector3(), pole: new THREE.Vector3(), pq: new THREE.Quaternion(), rq: new THREE.Quaternion(), q1: new THREE.Quaternion(), q2: new THREE.Quaternion() };

  // ---------- acessórios (registro expansível: cada item monta sua malha presa ao osso da cabeça) ----------
  // coordenadas no espaço do modelo em pé (medidas no GLB): topo do capacete em (0; 0,95; 0,05),
  // testa do capacete em y ≈ 0,68 com a superfície em z ≈ 0,50 (centro aproximado da cúpula em (0; 0,4; 0))

  // mapa de ambiente minúsculo (cubo 32² desenhado em canvas: céu claro, faixa de horizonte e chão escuro),
  // compartilhado por todas as lentes espelhadas -> reflexo convincente sem PMREM nem render-to-cube
  let mirrorEnv = null;
  function getMirrorEnv() {
    if (mirrorEnv) return mirrorEnv;
    const face = kind => { const c = TX.cvs(32, 32), g = c.getContext('2d');
      if (kind === 'top') { g.fillStyle = '#eaf6ff'; g.fillRect(0, 0, 32, 32); }
      else if (kind === 'bottom') { g.fillStyle = '#1c2230'; g.fillRect(0, 0, 32, 32); }
      else { const gr = g.createLinearGradient(0, 0, 0, 32); gr.addColorStop(0, '#9fd4ff'); gr.addColorStop(0.45, '#ffffff'); gr.addColorStop(0.52, '#3a4660'); gr.addColorStop(1, '#141a26'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); }
      return c; };
    mirrorEnv = new THREE.CubeTexture([face('side'), face('side'), face('top'), face('bottom'), face('side'), face('side')]);
    mirrorEnv.needsUpdate = true; return mirrorEnv;
  }
  // superelipse (|x/a|^n + |y/b|^n = 1): quadrado de cantos bem arredondados, como os óculos de aviador
  function superPts(a, b, n, seg) { const out = []; for (let i = 0; i < seg; i++) { const t = i / seg * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    out.push(new THREE.Vector2(Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * a, Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * b)); } return out; }
  // lente curva: grade regular deformada para o contorno da superelipse e abaulada (domo)
  function lensGeo(a, b, n, bulge) {
    const g = new THREE.PlaneGeometry(2, 2, 14, 14), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i), v = p.getY(i), r = Math.max(Math.abs(u), Math.abs(v));
      if (r < 1e-6) { p.setXYZ(i, 0, 0, bulge); continue; }
      const t = Math.atan2(v, u), c = Math.cos(t), s = Math.sin(t), rs = Math.pow(Math.pow(Math.abs(c), n) + Math.pow(Math.abs(s), n), -1 / n);
      const x = c * r * rs * a, y = s * r * rs * b; p.setXYZ(i, x, y, bulge * (1 - Math.min(1, (x * x) / (a * a) + (y * y) / (b * b)) * 0.85)); }
    g.computeVertexNormals(); return g;
  }

  const ACCESSORIES = [
    { id: 'none', name: 'Nenhum', icon: '○' },
    // óculos de corrida estilo aviador: armação dourada em quadrado arredondado com entalhes, concha de
    // borracha atrás, lente curva espelhada (MeshPhysicalMaterial + envMap), ponte com rebites e tira de couro
    { id: 'goggles', name: 'Óculos de corrida', icon: '🥽', build() {
      const g = new THREE.Group();
      const gold = KartMats.std(0xd9a441, 0.2, 0.9, { sat: 0 }), rubber = KartMats.std(0x1c1a1e, 0.85, 0, { sat: 0 }), leather = KartMats.std(0x6b3f22, 0.8, 0, { sat: 0 });
      const lens = new THREE.MeshPhysicalMaterial({ color: 0x5fb8ff, metalness: 0.92, roughness: 0.06, envMap: getMirrorEnv(), envMapIntensity: 1.35, clearcoat: 1, clearcoatRoughness: 0.04 });
      lens.userData.unique = true;
      const A = 0.125, B = 0.105, N = 4.2;
      const frameShape = new THREE.Shape(superPts(A, B, N, 48)); frameShape.holes.push(new THREE.Path(superPts(A * 0.78, B * 0.76, N, 48).reverse()));
      const frameG = new THREE.ExtrudeGeometry(frameShape, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 4 });
      const cupG = new THREE.ExtrudeGeometry(new THREE.Shape(superPts(A * 1.06, B * 1.08, N, 40)), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2 });
      const lensG = lensGeo(A * 0.8, B * 0.78, N, 0.035), notchG = GEO.rbox(0.03, 0.022, 0.03, 0.006, 1);
      [-1, 1].forEach(sd => {
        const cup = new THREE.Group(); cup.position.set(sd * 0.168, 0.68, 0.515); cup.rotation.order = 'YXZ'; cup.rotation.set(-0.5, sd * 0.33, 0); g.add(cup);
        const back = new THREE.Mesh(cupG, rubber); back.position.z = -0.07; cup.add(back);                       // concha de borracha (encosta no capacete)
        const fr = new THREE.Mesh(frameG, gold); cup.add(fr);
        for (let k = 0; k < 8; k++) { const t = (k + 0.5) / 8 * Math.PI * 2, c = Math.cos(t), s2 = Math.sin(t);  // entalhes escuros na borda da armação
          const nt = new THREE.Mesh(notchG, rubber); nt.position.set(Math.sign(c) * Math.pow(Math.abs(c), 2 / N) * A * 0.98, Math.sign(s2) * Math.pow(Math.abs(s2), 2 / N) * B * 0.98, 0.03); nt.rotation.z = t; cup.add(nt); }
        const l = new THREE.Mesh(lensG, lens); l.position.z = 0.012; cup.add(l);
        // presilha lateral que liga a armação à tira
        const clip = new THREE.Mesh(GEO.rbox(0.05, 0.06, 0.05, 0.012, 1), gold); clip.position.set(sd * A * 1.05, 0, -0.02); cup.add(clip);
      });
      // ponte entre as lentes com dois rebites
      const br = new THREE.Mesh(GEO.rbox(0.09, 0.045, 0.04, 0.015, 1), gold); br.position.set(0, 0.69, 0.545); br.rotation.x = -0.5; g.add(br);
      [-1, 1].forEach(sd => { const r = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 4), rubber); r.position.set(sd * 0.025, 0.695, 0.566); g.add(r); });
      // tira de couro: anel achatado inclinado em volta do capacete (alta na testa, baixa na nuca)
      const strapG = new THREE.TorusGeometry(0.578, 0.018, 6, 64); strapG.rotateX(Math.PI / 2); strapG.scale(1, 2.6, 1);
      const strap = new THREE.Mesh(strapG, leather); strap.position.set(0, 0.5, 0.02); strap.rotation.x = -0.28; g.add(strap);
      return g; } },
    // antena com estrela no topo central do capacete. Dois segmentos articulados (base -> meio -> ponta):
    // o pai de cada segmento é a junta anterior, então o balanço da base arrasta o resto (efeito chicote).
    // A física fica em PilotRig.antennaStep(); a estrela NÃO gira mais: acompanha só a haste.
    { id: 'antenna', name: 'Antena com estrela', icon: '✦', build(color) {
      const g = new THREE.Group(), rodM = KartMats.std(0x30323a, 0.4, 0.5), tipM = KartMats.std(color, 0.3, 0.4, { emissive: new THREE.Color(color).multiplyScalar(0.25) });
      const base = new THREE.Group(); base.position.set(0, 0.935, 0.05); g.add(base);                      // pivô: topo central do capacete
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), rodM); base.add(socket);
      const L1 = 0.3, L2 = 0.26;
      const j1 = new THREE.Group(); base.add(j1);
      const r1 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, L1, 8).translate(0, L1 / 2, 0), rodM); j1.add(r1);
      const j2 = new THREE.Group(); j2.position.y = L1; j1.add(j2);
      const r2 = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.016, L2, 8).translate(0, L2 / 2, 0), rodM); j2.add(r2);
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), rodM); knot.position.y = L1; j1.add(knot);
      const st = new THREE.Shape(); for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 0.06 : 0.14; k ? st.lineTo(Math.cos(a) * r, Math.sin(a) * r) : st.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      const starG = new THREE.ExtrudeGeometry(st, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 }); starG.translate(0, 0, -0.02);
      const star = new THREE.Mesh(starG, tipM); star.position.y = L2 + 0.11; j2.add(star);                 // estrela fixa, de frente, na ponta da haste
      g.userData.antenna = { base, j1, j2 };
      return g; } }
  ];

  // A textura do piloto é de cores chapadas (vermelho = roupa/capacete, bege = pele, preto, branco).
  // A troca de cor é feita em CADA texel antes da filtragem: lemos os 4 texels vizinhos exatamente no
  // centro (valor puro, sem mistura), recolorimos cada um e só então interpolamos (bilinear manual).
  // Antes a recoloração era feita depois da filtragem e com máscaras de matiz + uma "caixa do rosto":
  // as bordas misturadas (pele+preto, pele+vermelho) e a testa (fora da caixa) ficavam com a pele
  // original, e o rosto saía manchado de laranja quando o tom de pele era trocado.
  const RECOLOR_FS = [
    'uniform vec3 uSuit; uniform vec3 uHelmet; uniform vec3 uSkin; uniform vec2 uTexSize; varying vec3 vBind;',
    'vec3 pilotRecolor(vec3 c, float head) {',
    '  float wR = 1.0 - smoothstep(0.12, 0.24, distance(c, vec3(0.925, 0.110, 0.141)));',   // vermelho da roupa/capacete
    '  float wK = 1.0 - smoothstep(0.10, 0.20, distance(c, vec3(0.957, 0.729, 0.557)));',   // pele
    '  vec3 o = mix(c, mix(uSuit, uHelmet, head), wR);',
    '  return mix(o, uSkin, wK);',
    '}'
  ].join('\n');
  const RECOLOR_BODY = [
    '{ float head = smoothstep(-0.15, -0.08, vBind.y);',
    '  vec2 e = 1.0 / uTexSize, p = vUv * uTexSize - 0.5, f = fract(p), b = (floor(p) + 0.5) * e;',
    '  vec3 c00 = pilotRecolor(texture2D(map, b).rgb, head), c10 = pilotRecolor(texture2D(map, b + vec2(e.x, 0.0)).rgb, head);',
    '  vec3 c01 = pilotRecolor(texture2D(map, b + vec2(0.0, e.y)).rgb, head), c11 = pilotRecolor(texture2D(map, b + e).rgb, head);',
    '  diffuseColor.rgb = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y) * diffuse; }'
  ].join('\n');

  // ---------- IK analítico de dois ossos (no espaço do piloto) ----------
  // S = ombro/quadril, T = alvo, L1/L2 = comprimentos, pole = direção preferida da dobra -> devolve o cotovelo/joelho
  const _q2dir = new THREE.Vector3();
  function solve2(S, T, L1, L2, pole, outE) {
    const d0 = _a.subVectors(T, S), dist = d0.length(), dir = _q2dir.copy(d0).divideScalar(dist || 1);
    const d = Math.max(Math.abs(L1 - L2) + 1e-3, Math.min(L1 + L2 - 1e-3, dist));
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const p = _b.copy(pole).addScaledVector(dir, -pole.dot(dir)); if (p.lengthSq() < 1e-8) p.set(0, 1, 0); p.normalize();
    return outE.copy(S).addScaledVector(dir, a).addScaledVector(p, h);
  }

  class PilotRig {
    constructor(tpl, spec) {
      this.root = THREE.SkeletonUtils.clone(tpl.scene);
      this.bones = {}; this.root.traverse(o => { if (o.isBone) this.bones[o.name] = o; if (o.isSkinnedMesh) this.mesh = o; });
      this.bind = tpl.bind; this.len = tpl.len;
      // toon (3 tons) + brilho suave + recoloração; sem normal map (mais leve e mais "desenho")
      const img = tpl.map && tpl.map.image, tw = (img && img.width) || 1024, th = (img && img.height) || 1024;
      const u = this.u = { uSuit: { value: new THREE.Color() }, uHelmet: { value: new THREE.Color() }, uSkin: { value: new THREE.Color() }, uTexSize: { value: new THREE.Vector2(tw, th) } };
      const mat = this.mat = Toon.mat({ map: tpl.map, skinning: true }, { gloss: 0.35, rim: 0.3, sat: 1, key: 'pilot', hook: sh => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = 'varying vec3 vBind;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
        sh.fragmentShader = RECOLOR_FS + '\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + RECOLOR_BODY);
      } });
      this.mesh.material = mat; this.mesh.castShadow = true; this.mesh.frustumCulled = false;
      Toon.outline(this.root, 0.022);                                                   // contorno de desenho (acompanha o esqueleto)
      this.setColors(spec); this.setAccessory(spec.accessory, spec.decalColor);
      this.t = Math.random() * 10; this.lean = 0; this.look = 0; this.bob = 0;
    }
    setColors(spec) { this.u.uSuit.value.set(spec.suit); this.u.uHelmet.value.set(spec.helmet); this.u.uSkin.value.set(spec.skin); }
    setAccessory(id, color) {
      if (this.acc) { this.bones.head.remove(this.acc); this.acc.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.acc = null; }
      this.antS = null;
      const a = ACCESSORIES.find(x => x.id === id); if (!a || !a.build) return;
      const g = a.build(color || '#ffc928'); g.position.sub(this.bind.head); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); Toon.outline(g, 0.018);   // acessório no espaço do osso da cabeça
      this.bones.head.add(g); this.acc = g;
    }
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
      this.bob = st.air ? 0.05 : Math.sin(this.t * 17) * 0.006 * (st.speed || 0);
      B.hips.rotation.set(0, 0, 0); B.hips.position.y = this.bind.hips.y + this.bob;
      B.spine.rotation.set(-back * 0.5, 0, -this.lean * 0.5);
      B.chest.rotation.set(-back * 0.5 + 0.08, this.lean * 0.3, -this.lean * 0.5);
      B.head.rotation.set(0.05 + back * 0.6, this.look, this.lean * 0.4);
      this.root.updateMatrixWorld(true);
      if (this.acc && this.acc.userData.antenna) this.antennaStep(dt);
      // braços -> volante | pernas -> pedais
      this.limb('upperarm_L', 'forearm_L', cp.hands[0], 1, true); this.limb('upperarm_R', 'forearm_R', cp.hands[1], -1, true);
      this.limb('thigh_L', 'shin_L', cp.feet[0], 1, false); this.limb('thigh_R', 'shin_R', cp.feet[1], -1, false);
    }
    // ---------- física da antena: mola amortecida de 2 graus de liberdade ----------
    // 1) mede a aceleração REAL da base da antena no mundo (posição -> velocidade -> aceleração, por diferenças
    //    finitas) - assim ela reage a qualquer coisa: acelerar, frear, curva, pulo, giro da vitrine, queda no pódio;
    // 2) leva essa aceleração para o espaço local do capacete (a antena "sente" frente/trás e esquerda/direita);
    // 3) integra um oscilador amortecido: theta'' = -K*theta - C*theta' - G*a_local (a inércia joga a ponta
    //    para o lado oposto da aceleração e a mola traz de volta, com 1 ou 2 balanços até parar);
    // 4) a segunda junta recebe uma fração do ângulo + um termo de velocidade (atraso): a haste "chicoteia".
    // Tudo usa vetores pré-alocados (módulo + estado do próprio piloto): nenhuma alocação por quadro.
    antennaStep(dt) {
      const A = this.acc.userData.antenna, S = this.antS || (this.antS = { th: new THREE.Vector2(), w: new THREE.Vector2(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), vf: new THREE.Vector3(), accel: new THREE.Vector3(), ok: false });
      A.base.getWorldPosition(_ant.p);
      if (!S.ok || dt <= 0 || dt > 0.25) { S.prev.copy(_ant.p); S.vel.set(0, 0, 0); S.vf.set(0, 0, 0); S.accel.set(0, 0, 0); S.ok = dt > 0; return; }
      _ant.v.subVectors(_ant.p, S.prev).divideScalar(dt);
      _ant.a.subVectors(_ant.v, S.vel).divideScalar(dt);
      if (_ant.a.lengthSq() > ANT.MAXA * ANT.MAXA) _ant.a.setLength(ANT.MAXA);                          // teleporte/respawn não "chicoteia" absurdo
      S.accel.lerp(_ant.a, Math.min(1, dt * ANT.FILTER));                                               // filtro passa-baixa (tira o ruído do quadro a quadro)
      S.vel.copy(_ant.v); S.prev.copy(_ant.p);
      if (_ant.v.lengthSq() > 120 * 120) _ant.v.setLength(120); S.vf.lerp(_ant.v, Math.min(1, dt * 10));                 // velocidade suavizada (vento)
      A.base.parent.getWorldQuaternion(_ant.q); _ant.q.invert();
      _ant.l.copy(S.accel).applyQuaternion(_ant.q); _ant.vl.copy(S.vf).applyQuaternion(_ant.q);                   // aceleração e vento no espaço do capacete
      const vz = _ant.vl.z, vx = _ant.vl.x, spd = Math.min(1, Math.abs(vz) / 40), flut = ANT.FLUT * spd * Math.sin(this.t * 31);
      const n = dt > 1 / 45 ? 3 : 1, h = dt / n, th = S.th, w = S.w;
      for (let i = 0; i < n; i++) {                                                                      // Euler semi-implícito (estável com subpassos)
        w.x += (-ANT.K * th.x - ANT.C * w.x - ANT.G * _ant.l.z - ANT.D * vz * Math.abs(vz) + flut) * h;   // frente/trás: inércia + vento (deita para trás andando)
        w.y += (-ANT.K * th.y - ANT.C * w.y + ANT.G * _ant.l.x + ANT.D * 0.5 * vx * Math.abs(vx)) * h;   // lateral: inércia da curva + vento cruzado (derrapagem)
        th.x += w.x * h; th.y += w.y * h;
      }
      th.x = Math.max(-ANT.MAX, Math.min(ANT.MAX, th.x)); th.y = Math.max(-ANT.MAX, Math.min(ANT.MAX, th.y));
      A.j1.rotation.set(th.x, 0, th.y);
      A.j2.rotation.set(th.x * 0.6 + w.x * ANT.WHIP, 0, th.y * 0.6 + w.y * ANT.WHIP);
    }
    // IK de um membro: posiciona os dois ossos para a ponta (mão / pé) tocar o alvo
    limb(n1, n2, target, side, arm) {
      if (!target) return;
      // sem alocações por quadro: 8 karts x 4 membros chamavam ~40 "new Vector3/Quaternion" a cada quadro
      const b1 = this.bones[n1], b2 = this.bones[n2], bd = this.bind, rootInv = _m.copy(this.root.matrixWorld).invert();
      b1.rotation.set(0, 0, 0); b2.rotation.set(0, 0, 0); b1.updateMatrixWorld(true);
      const S = b1.getWorldPosition(_L.S).applyMatrix4(rootInv);
      const T = target.getWorldPosition(_L.T).applyMatrix4(rootInv);
      const L1 = this.len[n1], L2 = this.len[n2];
      const pole = arm ? _L.pole.set(side * 0.8, -0.55, -0.35) : _L.pole.set(side * 0.15, 0.6, 0.7);
      const E = solve2(S, T, L1, L2, pole, _L.E);
      // rotação "de repouso -> pose" no espaço do piloto, convertida para o espaço do pai de cada osso
      b1.parent.getWorldQuaternion(_L.pq); this.root.getWorldQuaternion(_L.rq);
      const pRel = _L.rq.invert().multiply(_L.pq);                                      // pai, relativo à raiz do piloto
      const q1 = _L.q1.setFromUnitVectors(bd.dir[n1], _c.subVectors(E, S).normalize());
      b1.quaternion.copy(pRel.invert().multiply(q1));
      const q2 = _L.q2.setFromUnitVectors(bd.dir[n2], _c.subVectors(T, E).normalize());
      b2.quaternion.copy(q1.invert().multiply(q2));
      b1.updateMatrixWorld(true);
    }
    dispose() { if (this.root.parent) this.root.parent.remove(this.root); this.mat.dispose(); }
  }

  // ---------- piloto procedural (reserva, se o arquivo 3D não carregar) ----------
  class FallbackPilot {
    constructor(spec) {
      const root = this.root = new THREE.Group();
      this.suitM = KartMats.std(spec.suit, 0.6, 0); this.helmM = KartMats.std(spec.helmet, 0.25, 0.2); this.skinM = KartMats.std(spec.skin, 0.7, 0);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.3, 0.3, 6, 12) : new THREE.SphereGeometry(0.38, 16, 12), this.suitM); torso.position.y = 0.45; torso.scale.set(1, 1.1, 0.85); root.add(torso);
      const head = this.head = new THREE.Group(); head.position.y = 1.05; root.add(head);
      head.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), this.helmM));
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14), this.skinM); face.position.set(0, -0.05, 0.16); face.scale.set(1, 0.9, 0.9); head.add(face);
      [-1, 1].forEach(s => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), KartMats.std(0x111111, 0.3, 0)); e.position.set(s * 0.13, 0, 0.52); e.scale.y = 1.5; head.add(e); });
      this.arms = [-1, 1].map(s => { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 8), this.suitM); a.geometry.translate(0, 0.5, 0); a.geometry.rotateX(Math.PI / 2); a.position.set(s * 0.32, 0.65, 0); root.add(a); return a; });
      root.traverse(o => { if (o.isMesh) o.castShadow = true; }); Toon.outline(root, 0.03);
    }
    setColors(spec) { this.suitM.color.set(spec.suit); this.helmM.color.set(spec.helmet); this.skinM.color.set(spec.skin); }
    setAccessory() {}
    attach(parent, cp) { this.cp = cp; this.root.scale.setScalar(cp.scale * 0.95); this.root.position.copy(cp.seat).y -= 0.15; parent.add(this.root); }
    update(dt, st) {
      this.head.rotation.y = (st.steer || 0) * 0.35; this.root.rotation.z = -(st.steer || 0) * 0.1;
      this.root.updateMatrixWorld(true);
      this.arms.forEach((a, i) => { const t = this.cp.hands[i]; if (!t) return; const w = t.getWorldPosition(new THREE.Vector3()); const p = a.getWorldPosition(new THREE.Vector3()); a.lookAt(w); a.scale.z = Math.max(0.2, p.distanceTo(w) / (this.root.scale.x * (this.root.parent ? this.root.parent.getWorldScale(new THREE.Vector3()).x : 1))); });
    }
    dispose() { if (this.root.parent) this.root.parent.remove(this.root); }
  }

  // ---------- carregamento ----------
  function b64ToBuffer(b64) { const bin = atob(b64), n = bin.length, u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

  const Pilot = {
    status: 'idle', progress: 0, tpl: null, accessories: ACCESSORIES,
    load(onProgress) {
      if (this._p) return this._p;
      this.status = 'loading';
      this._p = new Promise(resolve => {
        const ok = gltf => { try { this.prepare(gltf); this.status = 'ready'; this.progress = 1; onProgress && onProgress(1); resolve(true); } catch (e) { fail(e); } };
        const fail = e => { console.warn('[piloto] modelo 3D indisponível, usando o piloto procedural:', e); this.status = 'fallback'; this.progress = 1; onProgress && onProgress(1); resolve(false); };
        if (!THREE.GLTFLoader || !THREE.SkeletonUtils) return fail('GLTFLoader/SkeletonUtils não carregados');
        const parse = buf => { try { new THREE.GLTFLoader().parse(buf, '', ok, fail); } catch (e) { fail(e); } };
        const viaScript = () => {
          if (window.PILOT_GLB_B64) return parse(b64ToBuffer(window.PILOT_GLB_B64));
          const s = document.createElement('script'); s.src = 'assets/pilot.glb.js'; s.async = true;
          s.onload = () => window.PILOT_GLB_B64 ? parse(b64ToBuffer(window.PILOT_GLB_B64)) : fail('base64 vazio');
          s.onerror = () => fail('assets/pilot.glb.js não encontrado'); document.head.appendChild(s);
          let fake = 0; const tick = setInterval(() => { if (this.status !== 'loading') return clearInterval(tick); fake = Math.min(0.9, fake + 0.08); this.progress = fake; onProgress && onProgress(fake); }, 120);
        };
        if (location.protocol === 'file:') viaScript();
        else new THREE.GLTFLoader().load('assets/pilot.glb', ok, x => { if (x.total) { this.progress = x.loaded / x.total * 0.95; onProgress && onProgress(this.progress); } }, viaScript);
      });
      return this._p;
    },
    // guarda o modelo-base e mede o esqueleto (posições de repouso, direções e comprimentos dos ossos)
    prepare(gltf) {
      const scene = gltf.scene; let mesh = null; scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
      if (!mesh) throw new Error('o arquivo não tem malha com esqueleto');
      const mat = mesh.material, map = mat.map, nm = mat.normalMap;
      [map, nm].forEach(t => { if (t) { t.encoding = THREE.LinearEncoding; t.anisotropy = TX.aniso; t.needsUpdate = true; } });
      if (map) { map.generateMipmaps = false; map.minFilter = THREE.LinearFilter; }            // sem mipmaps: as ilhas do atlas não "sangram" umas nas outras (o piloto é pequeno na tela; cores chapadas não cintilam)
      if (nm) nm.dispose();                                                              // o visual toon não usa o normal map   // o jogo inteiro trabalha sem conversão sRGB
      scene.updateMatrixWorld(true);
      const pos = {}; scene.traverse(o => { if (o.isBone) pos[o.name] = o.getWorldPosition(new THREE.Vector3()); });
      const tip = { 'upperarm_L': 'forearm_L', 'upperarm_R': 'forearm_R', 'thigh_L': 'shin_L', 'thigh_R': 'shin_R' };
      // pontas: centro da mão (um pouco além do punho) e sola do pé
      const handC = s => V3(s * 0.49, -0.56, 0.03), footC = s => V3(s * 0.25, -0.9, 0.05);
      const dir = {}, len = {};
      Object.keys(tip).forEach(n => { const a = pos[n], b = pos[tip[n]]; dir[n] = b.clone().sub(a).normalize(); len[n] = a.distanceTo(b); });
      [['forearm_L', handC(1)], ['forearm_R', handC(-1)], ['shin_L', footC(1)], ['shin_R', footC(-1)]].forEach(([n, end]) => { dir[n] = end.clone().sub(pos[n]).normalize(); len[n] = pos[n].distanceTo(end); });
      this.tpl = { scene, map, normalMap: null, bind: { hips: pos.hips.clone(), head: pos.head.clone(), dir }, len };
      mat.dispose();
    },
    create(spec) { return this.tpl ? new PilotRig(this.tpl, spec) : new FallbackPilot(spec); }
  };
  window.Pilot = Pilot;
})();
