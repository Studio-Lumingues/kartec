// =====================================================================================
// models/pilot.js — pilotos 3D: Menino e Menina (assets/menino.glb e assets/menina.glb)
//
// Os arquivos vêm em pose T e SEM esqueleto. Ao carregar, cada personagem ganha um esqueleto de 18 ossos
// (+ 2 nas marias-chiquinhas da menina) montado sobre as medidas da própria malha (ombro, cotovelo, punho,
// dedos, quadril, joelho, tornozelo, pescoço) e pesos suaves calculados por região do corpo. Os .glb não
// são alterados: tudo acontece aqui, uma vez por personagem.
//
// Pose sentada montada em tempo real com IK de dois ossos:
//   mãos -> pegadores do volante (giram junto com o volante) / manoplas da moto | pés -> pedais / pedaleiras.
// Pegada "certinha": a mão é orientada pela barra (polegar ao longo do aro ou da manopla, punho reto seguindo
// o antebraço), o ponto do punho é calculado para o centro da mão fechada cair EXATAMENTE na barra, a torção
// sobra para o antebraço (o punho não entorta) e os dedos fecham em volta da barra.
// Cada modelo de kart informa banco, pegadores, pés e a postura (COCKPIT); o piloto se ajusta.
// Cores: o shader troca o vermelho da roupa (corpo) e do capacete (cabeça) e o tom de pele mantendo o
// sombreado da textura. O cabelo da menina fica de fora.
// Cabelo da menina: cada maria-chiquinha tem base e ponta (dobra como chicote). O vento joga o cabelo para trás
// conforme a velocidade (e de lado no drift), ele tremula em alta velocidade e balança com curvas, freadas e saltos.
// Visual: material toon de 3 tons + contorno de tinta (Toon.outline acompanha o esqueleto).
// Se o arquivo não carregar, entra um piloto procedural simples com a mesma interface.
// =====================================================================================
(function () {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _mb = new THREE.Matrix4();
  const _L = { S: new THREE.Vector3(), G: new THREE.Vector3(), W: new THREE.Vector3(), E: new THREE.Vector3(), t: new THREE.Vector3(), d: new THREE.Vector3(), f: new THREE.Vector3(), bk: new THREE.Vector3(), x: new THREE.Vector3(), pole: new THREE.Vector3(),
    q: new THREE.Quaternion(), rq: new THREE.Quaternion(), rqi: new THREE.Quaternion(), pq: new THREE.Quaternion(), q1: new THREE.Quaternion(), q2: new THREE.Quaternion(), qh: new THREE.Quaternion(), qi: new THREE.Quaternion(), tw: new THREE.Quaternion(), qf: new THREE.Quaternion() };
  const _P = { p: new THREE.Vector3(), v: new THREE.Vector3(), a: new THREE.Vector3(), l: new THREE.Vector3(), g: new THREE.Vector3(), vl: new THREE.Vector3(), q: new THREE.Quaternion() };
  const AX = V3(1, 0, 0), AZ = V3(0, 0, 1), QI = new THREE.Quaternion();
  const ACCESSORIES = [{ id: 'none', name: 'Nenhum', icon: 'none' }];   // acessórios saíram do jogo (interface mantida)

  // ---------- medidas de cada personagem (espaço do .glb: frente +x, cima +y, direita do personagem +z) ----------
  // sh/el/wr/kn = ombro, cotovelo, punho, base dos dedos | grip = centro da mão fechada (onde passa a barra)
  // hip/knee/ank = quadril, joelho, tornozelo | head = pescoço (pivô da cabeça) | armR = raio do braço
  const CHARS = {
    menino: { name: 'Menino', node: 'Menino', lm: {
      hips: [0, -0.19, 0], spine: [0, -0.12, 0], chest: [0, -0.05, 0], head: [0, 0.04, 0],
      sh: [0, -0.03, 0.145], el: [0, -0.033, 0.228], wr: [0, -0.035, 0.31], kn: [0, -0.035, 0.395], grip: [0.005, -0.06, 0.385],
      hip: [0, -0.2, 0.065], knee: [0, -0.29, 0.075], ank: [0, -0.385, 0.085], armR: 0.05 } },
    menina: { name: 'Menina', node: 'Corpo', pigs: ['MariaChiquinha_L', 'MariaChiquinha_R'], lm: {
      hips: [0.03, -0.19, 0], spine: [0.03, -0.12, 0], chest: [0.03, -0.05, 0], head: [0.03, 0.04, 0],
      sh: [0.028, -0.02, 0.145], el: [0.028, -0.022, 0.225], wr: [0.028, -0.025, 0.3], kn: [0.03, -0.025, 0.383], grip: [0.035, -0.05, 0.375],
      hip: [0.012, -0.2, 0.07], knee: [0.012, -0.29, 0.08], ank: [0.015, -0.385, 0.09], armR: 0.05 } }
  };
  const CHAR_IDS = Object.keys(CHARS);
  // ossos: [nome, pai, marco, lado no .glb (-1 = esquerda do personagem = -z)]
  const BONES = [['hips', null, 'hips'], ['spine', 'hips', 'spine'], ['chest', 'spine', 'chest'], ['head', 'chest', 'head'],
    ['upperarm_L', 'chest', 'sh', -1], ['forearm_L', 'upperarm_L', 'el', -1], ['hand_L', 'forearm_L', 'wr', -1], ['fingers_L', 'hand_L', 'kn', -1],
    ['upperarm_R', 'chest', 'sh', 1], ['forearm_R', 'upperarm_R', 'el', 1], ['hand_R', 'forearm_R', 'wr', 1], ['fingers_R', 'hand_R', 'kn', 1],
    ['thigh_L', 'hips', 'hip', -1], ['shin_L', 'thigh_L', 'knee', -1], ['foot_L', 'shin_L', 'ank', -1],
    ['thigh_R', 'hips', 'hip', 1], ['shin_R', 'thigh_R', 'knee', 1], ['foot_R', 'shin_R', 'ank', 1]];
  const BI = {}; BONES.forEach((b, i) => BI[b[0]] = i);
  const CURL = 1.3, TWIST = 0.85;      // fechamento dos dedos (rad) e fração da torção da mão que vai para o antebraço
  // .glb (frente +x, direita +z) -> espaço do piloto/kart (frente +z, esquerda +x)
  const R_GLB = new THREE.Matrix4().set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  const toP = a => V3(-a[2], a[1], a[0]);
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // pesos de um vértice (coordenadas do .glb) -> lista [osso, peso]
  function vertexWeights(x, y, z, lm) {
    const sd = z < 0 ? '_L' : '_R', az = Math.abs(z), out = [];
    const put = (n, w) => { if (w > 1e-4) out.push([BI[n + (n === 'hips' || n === 'spine' || n === 'chest' || n === 'head' ? '' : sd)], w]); };
    // braço: começa no ombro e vai até a ponta dos dedos; perto do ombro só o "tubo" do braço (o capacete fica de fora)
    const shz = lm.sh[2], wz = lm.wr[2], tt = Math.max(0, Math.min(1, (az - shz) / (wz - shz)));
    const ax = lm.sh[0] + (lm.wr[0] - lm.sh[0]) * tt, ay = lm.sh[1] + (lm.wr[1] - lm.sh[1]) * tt, dxy = Math.hypot(x - ax, y - ay);
    let A = sstep(shz - 0.035, shz + 0.02, az) * (az > wz - 0.02 ? 1 : 1 - sstep(lm.armR + 0.005, lm.armR + 0.02, dxy)) * (1 - sstep(0.035, 0.055, y));
    if (y < -0.15) A = 0;
    // pernas: abaixo da virilha
    const Lg = 1 - sstep(lm.hip[1] - 0.035, lm.hip[1] + 0.025, y);
    // tronco e cabeça
    const wH = 1 - sstep(lm.spine[1] - 0.03, lm.spine[1] + 0.01, y), wC = sstep(lm.chest[1] - 0.03, lm.chest[1] + 0.01, y), wS = Math.max(0, 1 - wH - wC);
    const Hd = sstep(lm.head[1] - 0.005, lm.head[1] + 0.03, y), T = Math.max(0, 1 - A - Lg);
    put('hips', T * wH * (1 - Hd)); put('spine', T * wS * (1 - Hd)); put('chest', T * wC * (1 - Hd)); put('head', T * Hd);
    if (A > 0) { const e1 = sstep(lm.el[2] - 0.025, lm.el[2] + 0.025, az), e2 = sstep(wz - 0.012, wz + 0.018, az), e3 = sstep(lm.kn[2] - 0.01, lm.kn[2] + 0.012, az);
      put('upperarm', A * (1 - e1)); put('forearm', A * e1 * (1 - e2)); put('hand', A * e2 * (1 - e3)); put('fingers', A * e3); }
    if (Lg > 0) { const k1 = 1 - sstep(lm.knee[1] - 0.025, lm.knee[1] + 0.025, y), k2 = 1 - sstep(lm.ank[1] - 0.02, lm.ank[1] + 0.02, y);
      put('thigh', Lg * (1 - k1)); put('shin', Lg * k1 * (1 - k2)); put('foot', Lg * k2); }
    return out;
  }

  // A textura é a original do modelo (sombreada). Troca de cor por matiz: o vermelho vira a cor do macacão
  // (corpo) ou do capacete (acima do pescoço, medido na pose de origem) e o tom de pele vira a pele escolhida;
  // o brilho do texel é mantido, então dobras e sombras pintadas continuam lá. vKeep = 1 no cabelo.
  const HSV = 'vec3 kHsv(vec3 c) { vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1.0e-10)), d / (q.x + 1.0e-10), q.x); }';
  const RECOLOR_FS = ['uniform vec3 uSuit; uniform vec3 uHelmet; uniform vec3 uSkin; uniform float uHeadY; varying vec3 vBind; varying float vKeep;', HSV].join('\n');
  const RECOLOR_BODY = [
    'if (vKeep < 0.5) { vec3 hv = kHsv(texelColor.rgb); float dr = min(hv.x, 1.0 - hv.x);',
    '  float wR = (1.0 - smoothstep(0.028, 0.042, dr)) * smoothstep(0.42, 0.58, hv.y) * smoothstep(0.06, 0.15, hv.z);',
    '  float wK = (1.0 - smoothstep(0.022, 0.04, abs(hv.x - 0.07))) * smoothstep(0.15, 0.24, hv.y) * (1.0 - smoothstep(0.62, 0.72, hv.y)) * smoothstep(0.5, 0.62, hv.z);',
    '  float head = smoothstep(uHeadY - 0.005, uHeadY + 0.025, vBind.y), kr = hv.z / 0.9, kk = hv.z / 0.95;',
    '  vec3 red = mix(uSuit, uHelmet, head) * min(kr, 1.0) + vec3(max(kr - 1.0, 0.0) * 0.5);',
    '  diffuseColor.rgb = mix(diffuseColor.rgb, red, wR);',
    '  diffuseColor.rgb = mix(diffuseColor.rgb, uSkin * min(kk, 1.05), wK); }'
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
  // parte de q que gira em torno do eixo a (decomposição swing-twist)
  function twistOf(q, a, out) {
    const p = q.x * a.x + q.y * a.y + q.z * a.z; out.set(a.x * p, a.y * p, a.z * p, q.w);
    const l = Math.hypot(out.x, out.y, out.z, out.w); if (l < 1e-6) return out.set(0, 0, 0, 1);
    return out.set(out.x / l, out.y / l, out.z / l, out.w / l);
  }

  class PilotRig {
    constructor(tpl, spec) {
      this.tpl = tpl; this.id = tpl.id;
      this.root = THREE.SkeletonUtils.clone(tpl.scene);
      this.bones = {}; this.root.traverse(o => { if (o.isBone) this.bones[o.name] = o; if (o.isSkinnedMesh) this.mesh = o; });
      this.bind = tpl.bind; this.len = tpl.len; this.dir = tpl.dir;
      const u = this.u = { uSuit: { value: new THREE.Color() }, uHelmet: { value: new THREE.Color() }, uSkin: { value: new THREE.Color() }, uHeadY: { value: tpl.headY } };
      const mat = this.mat = Toon.mat({ map: tpl.map, skinning: true }, { gloss: 0.3, rim: 0.3, sat: 0, key: 'pilot-glb', hook: sh => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = 'attribute float aKeep;\nvarying vec3 vBind;\nvarying float vKeep;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position; vKeep = aKeep;');
        sh.fragmentShader = RECOLOR_FS + '\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + RECOLOR_BODY);
      } });
      this.mesh.material = mat; this.mesh.castShadow = true; this.mesh.frustumCulled = false;
      Toon.outline(this.root, tpl.outline);                                              // contorno de desenho (acompanha o esqueleto)
      this.setColors(spec);
      this.t = Math.random() * 10; this.lean = 0; this.look = 0; this.bob = 0;
      this.ua = { _L: this.bones.upperarm_L.position.clone(), _R: this.bones.upperarm_R.position.clone() };   // ombros na pose de origem (o "alcance" mexe neles)
    }
    setColors(spec) { this.u.uSuit.value.set(spec.suit); this.u.uHelmet.value.set(spec.helmet); this.u.uSkin.value.set(spec.skin); }
    setAccessory() { }
    // encaixa no cockpit: cp = { seat, scale, hands:[gripL, gripR] (Object3D, userData.t = sentido da barra), feet:[pés], lean, headTilt, ... }
    attach(parent, cp) {
      this.cp = cp; const s = cp.scale; this.root.scale.setScalar(s);
      this.root.position.copy(cp.seat).addScaledVector(this.bind.hips, -s);           // quadril exatamente no ponto do banco
      parent.add(this.root);
    }
    // anima: st = { steer (-1..1, + = esquerda), speed (0..1), boost, drift (-1/0/1), air }
    update(dt, st) {
      const B = this.bones, cp = this.cp; if (!cp) return; this.t += dt;
      const k = Math.min(1, 6 * dt), lk = cp.leanK === undefined ? 1 : cp.leanK;
      this.lean += (((st.steer || 0) * 0.2 + (st.drift || 0) * 0.12) * lk - this.lean) * k;
      this.look += ((st.steer || 0) * 0.35 + (st.drift || 0) * 0.15 - this.look) * k;
      const fwd = (cp.lean || 0) + (st.boost ? (cp.boostLean || 0) : 0);
      this.bob = st.air ? 0.006 : Math.sin(this.t * 17) * 0.003 * (st.speed || 0);
      // inclinação do tronco sobretudo no quadril (como na busca de pose): ombros vão à frente sem enrugar a barriga
      B.hips.rotation.set(fwd * 0.6, 0, 0); B.hips.position.y = this.bind.hips.y + this.bob;
      B.spine.rotation.set(fwd * 0.2, 0, -this.lean * 0.5);
      B.chest.rotation.set(fwd * 0.2, this.lean * 0.25, -this.lean * 0.4);
      B.head.rotation.set(-(cp.headTilt || 0), this.look, this.lean * 0.35);
      this.root.updateMatrixWorld(true);
      if (this.tpl.pigs) this.pigStep(dt);
      this.arm(1); this.arm(-1); this.leg(1); this.leg(-1);
    }
    // ---------- braço: mão fechada na barra ----------
    arm(side) {
      const cp = this.cp, grip = cp.hands && cp.hands[side > 0 ? 0 : 1]; if (!grip) return;
      const sf = side > 0 ? '_L' : '_R', B = this.bones, b1 = B['upperarm' + sf], b2 = B['forearm' + sf], bh = B['hand' + sf], bf = B['fingers' + sf];
      const rootInv = _m.copy(this.root.matrixWorld).invert(); this.root.getWorldQuaternion(_L.rq); _L.rqi.copy(_L.rq).invert();
      b1.quaternion.identity(); b2.quaternion.identity(); bh.quaternion.identity(); b1.position.copy(this.ua[sf]); b1.updateMatrixWorld(true);
      const S = b1.getWorldPosition(_L.S).applyMatrix4(rootInv), G = grip.getWorldPosition(_L.G).applyMatrix4(rootInv);
      // sentido da barra (polegar) e direção dos dedos = antebraço projetado no plano da barra (punho reto)
      const t = _L.t.copy(grip.userData.t || AX).applyQuaternion(grip.getWorldQuaternion(_L.q)).applyQuaternion(_L.rqi).normalize();
      const d = _L.d.subVectors(G, S).normalize(), f = _L.f.copy(d).addScaledVector(t, -d.dot(t));
      if (f.lengthSq() < 1e-6) f.set(0, -1, 0); f.normalize();
      const bk = side > 0 ? _L.bk.crossVectors(t, f) : _L.bk.crossVectors(f, t); bk.normalize();   // costas da mão
      _L.x.crossVectors(bk, t); const Qh = _L.qh.setFromRotationMatrix(_mb.makeBasis(_L.x, bk, t));
      // punho tal que o centro da mão fechada fique exatamente na barra
      const W = _L.W.copy(this.tpl.gripOff[sf]).applyQuaternion(Qh).negate().add(G);
      b1.parent.getWorldQuaternion(_L.pq); _L.pq.premultiply(_L.rqi);                    // peito, relativo à raiz do piloto
      // alcance: se o braço esticado não chega no punho (volante todo virado, salto), o ombro avança um pouco até a pegada
      const L12 = this.len['upperarm' + sf] + this.len['forearm' + sf], gap = S.distanceTo(W) - 0.985 * L12;
      if (gap > 0) { const dlt = _a.subVectors(W, S).setLength(Math.min(gap, 0.035)); S.add(dlt);
        b1.position.add(dlt.applyQuaternion(_L.q.copy(_L.pq).invert())); b1.updateMatrixWorld(true); }
      const E = solve2(S, W, this.len['upperarm' + sf], this.len['forearm' + sf], _L.pole.set(side * 0.6, -0.8, -0.05), _L.E);
      const q1 = _L.q1.setFromUnitVectors(this.dir['upperarm' + sf], _c.subVectors(E, S).normalize());
      b1.quaternion.copy(_L.pq).invert().multiply(q1);
      const q2 = _L.q2.setFromUnitVectors(this.dir['forearm' + sf], _c.subVectors(W, E).normalize());
      b2.quaternion.copy(q1).invert().multiply(q2);
      // mão: rotação local = q2^-1 * Qh; a torção em volta do antebraço vai (quase toda) para o antebraço
      const qh = _L.qi.copy(q2).invert().multiply(Qh), tw = twistOf(qh, this.dir['forearm' + sf], _L.tw).slerp(QI, 1 - TWIST);
      b2.quaternion.multiply(tw);
      bh.quaternion.copy(tw).invert().multiply(qh);
      bf.quaternion.setFromAxisAngle(AZ, -side * CURL);                                  // dedos fecham em volta da barra
      b1.updateMatrixWorld(true);
    }
    // ---------- perna: pé no pedal / na pedaleira ----------
    leg(side) {
      const cp = this.cp, tgt = cp.feet && cp.feet[side > 0 ? 0 : 1]; if (!tgt) return;
      const sf = side > 0 ? '_L' : '_R', B = this.bones, b1 = B['thigh' + sf], b2 = B['shin' + sf], bf = B['foot' + sf];
      const rootInv = _m.copy(this.root.matrixWorld).invert(); this.root.getWorldQuaternion(_L.rq); _L.rqi.copy(_L.rq).invert();
      b1.quaternion.identity(); b2.quaternion.identity(); bf.quaternion.identity(); b1.updateMatrixWorld(true);
      const S = b1.getWorldPosition(_L.S).applyMatrix4(rootInv), T = tgt.getWorldPosition(_L.G).applyMatrix4(rootInv);
      const kn = cp.knee || [0.15, 0.6, 0.7];
      const E = solve2(S, T, this.len['thigh' + sf], this.len['shin' + sf], _L.pole.set(side * kn[0], kn[1], kn[2]), _L.E);
      b1.parent.getWorldQuaternion(_L.pq); _L.pq.premultiply(_L.rqi);
      const q1 = _L.q1.setFromUnitVectors(this.dir['thigh' + sf], _c.subVectors(E, S).normalize());
      b1.quaternion.copy(_L.pq).invert().multiply(q1);
      const q2 = _L.q2.setFromUnitVectors(this.dir['shin' + sf], _c.subVectors(T, E).normalize());
      b2.quaternion.copy(q1).invert().multiply(q2);
      bf.quaternion.copy(q2).invert().multiply(_L.qf.setFromAxisAngle(AX, cp.footPitch || 0));   // sola acompanhando o pedal
      b1.updateMatrixWorld(true);
    }
    // ---------- marias-chiquinhas: cabelo com física (base + ponta, molas amortecidas) ----------
    // A mecha aponta para a soma gravidade + vento (contrário ao movimento): parada ela pende; andando, o vento a joga
    // para trás cada vez mais (quase na horizontal na velocidade máxima) e, no drift, também de lado. Tremula com a
    // velocidade, a ponta atrasa em relação à base (efeito chicote) e a inércia da cabeça entra nas freadas e curvas.
    pigStep(dt) {
      const B = this.bones, head = B.head, V2 = () => new THREE.Vector2();
      const S = this.pig || (this.pig = { th: [V2(), V2()], w: [V2(), V2()], th2: [V2(), V2()], w2: [V2(), V2()], prev: new THREE.Vector3(), vel: new THREE.Vector3(), acc: new THREE.Vector3(), vf: new THREE.Vector3(), ok: false });
      head.getWorldPosition(_P.p);
      if (!S.ok || dt <= 0 || dt > 0.25) { S.prev.copy(_P.p); S.vel.set(0, 0, 0); S.acc.set(0, 0, 0); S.vf.set(0, 0, 0); S.ok = dt > 0; }
      else {
        _P.v.subVectors(_P.p, S.prev).divideScalar(dt); _P.a.subVectors(_P.v, S.vel).divideScalar(dt);
        if (_P.a.lengthSq() > 140 * 140) _P.a.setLength(140);
        S.acc.lerp(_P.a, Math.min(1, dt * 18)); S.vel.copy(_P.v); S.prev.copy(_P.p);
        if (_P.v.lengthSq() > 120 * 120) _P.v.setLength(120); S.vf.lerp(_P.v, Math.min(1, dt * 10));
      }
      head.getWorldQuaternion(_P.q).invert();                                           // tudo no espaço da cabeça
      _P.l.copy(S.acc).applyQuaternion(_P.q); _P.vl.copy(S.vf).applyQuaternion(_P.q); _P.g.set(0, -1, 0).applyQuaternion(_P.q);
      const sp = _P.vl.length(), k = Math.min(6, Math.pow(sp / 22, 1.5)), iv = sp > 1e-3 ? k / sp : 0;
      const dx = _P.g.x - _P.vl.x * iv, dy = _P.g.y - _P.vl.y * iv, dz = _P.g.z - _P.vl.z * iv;   // para onde a mecha aponta
      const ax = Math.atan2(-dz, -dy), az = Math.atan2(dx, Math.hypot(dy, dz)), f = Math.min(1, sp / 35), t = this.t;
      const n = dt > 1 / 45 ? 3 : 1, h = dt / n;
      ['pig_L', 'pig_R'].forEach((nm, i) => {
        const b1 = B[nm], b2 = B[nm + '2']; if (!b1) return;
        const sd = i === 0 ? 1 : -1, ph = i * 2.1, th = S.th[i], w = S.w[i], th2 = S.th2[i], w2 = S.w2[i];
        // alvo da base (80% da direção) e da ponta (+30%, continua a curva), com tremulação e inércia
        const tx = ax * 0.8 + 0.004 * _P.l.z + 0.06 * f * Math.sin(t * 21 + ph);
        let tz = az * 0.8 - 0.004 * _P.l.x + 0.05 * f * Math.sin(t * 16.5 + ph * 1.3);
        const ux = ax * 0.3 + 0.12 * f * Math.sin(t * 27 + ph + 1.1);
        let uz = az * 0.3 + 0.09 * f * Math.sin(t * 19 + ph * 0.7);
        tz = sd > 0 ? Math.max(-0.25, tz) : Math.min(0.25, tz); uz = sd > 0 ? Math.max(-0.3, uz) : Math.min(0.3, uz);   // não entra no capacete
        for (let s = 0; s < n; s++) {
          w.x += (45 * (tx - th.x) - 6.5 * w.x) * h; w.y += (45 * (tz - th.y) - 6.5 * w.y) * h; th.x += w.x * h; th.y += w.y * h;
          w2.x += (35 * (ux - 0.08 * w.x - th2.x) - 5 * w2.x) * h; w2.y += (35 * (uz - 0.08 * w.y - th2.y) - 5 * w2.y) * h; th2.x += w2.x * h; th2.y += w2.y * h;
        }
        th.x = Math.max(-0.7, Math.min(1.45, th.x)); th.y = Math.max(sd > 0 ? -0.25 : -1.2, Math.min(sd > 0 ? 1.2 : 0.25, th.y));
        th2.x = Math.max(-0.6, Math.min(0.9, th2.x)); th2.y = Math.max(sd > 0 ? -0.3 : -0.8, Math.min(sd > 0 ? 0.8 : 0.3, th2.y));
        b1.rotation.set(th.x, 0, th.y); if (b2) b2.rotation.set(th2.x, 0, th2.y);
      });
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
    attach(parent, cp) { this.cp = cp; this.root.scale.setScalar(Math.min(cp.scale, 1.6) * 0.95); this.root.position.copy(cp.seat).y -= 0.15; parent.add(this.root); }
    update(dt, st) {
      this.head.rotation.y = (st.steer || 0) * 0.35; this.root.rotation.z = -(st.steer || 0) * 0.1;
      this.root.updateMatrixWorld(true);
      this.arms.forEach((a, i) => { const t = this.cp.hands[i]; if (!t) return; const w = t.getWorldPosition(new THREE.Vector3()); const p = a.getWorldPosition(new THREE.Vector3()); a.lookAt(w); a.scale.z = Math.max(0.2, p.distanceTo(w) / (this.root.scale.x * (this.root.parent ? this.root.parent.getWorldScale(new THREE.Vector3()).x : 1))); });
    }
    dispose() { if (this.root.parent) this.root.parent.remove(this.root); }
  }

  // ---------- montagem do personagem (uma vez): malha + esqueleto + pesos ----------
  function buildTemplate(id, gltf) {
    const C = CHARS[id], lm = C.lm, scene = gltf.scene; scene.updateMatrixWorld(true);
    let body = null; const pigMesh = {};
    scene.traverse(o => { if (!o.isMesh) return; const pn = o.parent && o.parent.name; if (pn === C.node) body = o; else if (C.pigs && C.pigs.includes(pn)) pigMesh[pn] = o; });
    if (!body) throw new Error('malha ' + C.node + ' não encontrada em ' + id + '.glb');
    const map = body.material.map;
    const parts = [{ b: GLBAssets.bake(body, new THREE.Matrix4().multiplyMatrices(R_GLB, body.matrixWorld), map), pig: null }];
    Object.keys(pigMesh).forEach(pn => { const o = pigMesh[pn], pv = V3().setFromMatrixPosition(o.parent.matrixWorld).applyMatrix4(R_GLB);
      parts.push({ b: GLBAssets.bake(o, new THREE.Matrix4().multiplyMatrices(R_GLB, o.matrixWorld), map), pig: pv.x > 0 ? 'pig_L' : 'pig_R', pivot: pv }); });
    GLBAssets.plainMap(map); map.generateMipmaps = true;
    // eixo de cada maria-chiquinha: do ponto de amarração até a ponta mais distante (base e ponta são 2 ossos)
    parts.forEach(p => { if (!p.pig) return; let far = 0; const Q = p.b.P;
      for (let i = 0; i < Q.length; i += 3) { const d = Math.hypot(Q[i] - p.pivot.x, Q[i + 1] - p.pivot.y, Q[i + 2] - p.pivot.z); if (d > far) { far = d; p.tip = V3(Q[i], Q[i + 1], Q[i + 2]); } }
      p.len = far || 0.1; p.axis = p.tip ? p.tip.clone().sub(p.pivot).normalize() : V3(0, -1, 0); });
    // junta tudo numa malha só, com índices de osso / pesos / "não recolorir"
    let nv = 0, ni = 0; parts.forEach(p => { nv += p.b.P.length / 3; ni += p.b.I.length; });
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = new Uint32Array(ni), SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4), KP = new Float32Array(nv);
    const boneCount = BONES.length + (parts.length > 1 ? 4 : 0);
    let ov = 0, oi = 0;
    parts.forEach(p => {
      const n = p.b.P.length / 3; P.set(p.b.P, ov * 3); N.set(p.b.N, ov * 3); U.set(p.b.U, ov * 2);
      for (let k = 0; k < p.b.I.length; k++) I[oi + k] = p.b.I[k] + ov;
      for (let i = 0; i < n; i++) { const j = ov + i;
        if (p.pig) {   // cabelo: base -> ponta ao longo do comprimento da mecha
          const sx = ((P[j * 3] - p.pivot.x) * p.axis.x + (P[j * 3 + 1] - p.pivot.y) * p.axis.y + (P[j * 3 + 2] - p.pivot.z) * p.axis.z) / p.len, w2 = sstep(0.3, 0.62, sx), bi = BONES.length + (p.pig === 'pig_L' ? 0 : 2);
          SI[j * 4] = bi; SW[j * 4] = 1 - w2; SI[j * 4 + 1] = bi + 1; SW[j * 4 + 1] = w2; KP[j] = 1; continue; }
        const x = P[j * 3 + 2], y = P[j * 3 + 1], z = -P[j * 3];                             // volta para o espaço do .glb
        const ws = vertexWeights(x, y, z, lm).sort((a, b) => b[1] - a[1]).slice(0, 4), tot = ws.reduce((s, w) => s + w[1], 0) || 1;
        if (!ws.length) { SI[j * 4] = BI.chest; SW[j * 4] = 1; continue; }
        ws.forEach((w, k) => { SI[j * 4 + k] = w[0]; SW[j * 4 + k] = w[1] / tot; }); }
      ov += n; oi += p.b.I.length;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4)); geo.setAttribute('aKeep', new THREE.BufferAttribute(KP, 1));
    geo.setIndex(new THREE.BufferAttribute(nv > 65535 ? I : Uint16Array.from(I), 1)); geo.computeBoundingBox(); geo.computeBoundingSphere();
    // esqueleto na pose de origem (rotações zeradas: as direções de repouso valem no espaço do piloto)
    const pos = {}, bones = [], byName = {};
    BONES.forEach(([name, parent, mk, sd]) => { const a = lm[mk]; pos[name] = toP([a[0], a[1], sd ? sd * Math.abs(a[2]) : a[2]]);
      const b = new THREE.Bone(); b.name = name; b.position.copy(pos[name]); if (parent) { b.position.sub(pos[parent]); byName[parent].add(b); } byName[name] = b; bones.push(b); });
    parts.filter(p => p.pig).sort((a, b) => (a.pig > b.pig ? 1 : -1)).forEach(p => { const b = new THREE.Bone(); b.name = p.pig; b.position.copy(p.pivot).sub(pos.head); byName.head.add(b); byName[p.pig] = b; pos[p.pig] = p.pivot.clone();
      const b2 = new THREE.Bone(); b2.name = p.pig + '2'; b2.position.copy(p.axis).multiplyScalar(p.len * 0.46); b.add(b2); byName[p.pig + '2'] = b2; });
    if (parts.length > 1) ['pig_L', 'pig_L2', 'pig_R', 'pig_R2'].forEach(nm => bones.push(byName[nm] || new THREE.Bone()));
    const root = new THREE.Group(); root.add(byName.hips);
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial({ skinning: true })); root.add(mesh);
    root.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones), mesh.matrixWorld);
    // direções e comprimentos de repouso dos ossos dos membros + deslocamento punho -> centro da mão fechada
    const dir = {}, len = {}, seg = (n, a, b) => { dir[n] = pos[b].clone().sub(pos[a]).normalize(); len[n] = pos[a].distanceTo(pos[b]); };
    ['_L', '_R'].forEach(s => { seg('upperarm' + s, 'upperarm' + s, 'forearm' + s); seg('forearm' + s, 'forearm' + s, 'hand' + s); seg('thigh' + s, 'thigh' + s, 'shin' + s); seg('shin' + s, 'shin' + s, 'foot' + s); });
    const gripOff = {}; ['_L', '_R'].forEach(s => { const sd = s === '_L' ? -1 : 1; gripOff[s] = toP([lm.grip[0], lm.grip[1], sd * lm.grip[2]]).sub(pos['hand' + s]); });
    return { id, scene: root, map, normalMap: null, bind: { hips: pos.hips.clone(), head: pos.head.clone() }, dir, len, gripOff, headY: lm.head[1], outline: 0.0075, pigs: parts.length > 1, boneCount };
  }

  const Pilot = {
    status: 'idle', progress: 0, tpl: null, tpls: {}, accessories: ACCESSORIES,
    characters: CHAR_IDS.map(id => ({ id, name: CHARS[id].name })),
    // carrega os pilotos E os veículos (kart e motoca) com uma barra de progresso só; responde true se há piloto 3D
    load(onProgress) {
      if (this._p) return this._p;
      this.status = 'loading';
      const names = CHAR_IDS.concat(['kart', 'motoca']);
      const all = window.GLBAssets ? GLBAssets.loadAll(names, p => { this.progress = p * 0.97; if (onProgress) onProgress(this.progress); }) : Promise.resolve([]);
      this._p = all.then(() => {
        CHAR_IDS.forEach(id => { const g = window.GLBAssets && GLBAssets.get(id); if (!g) return;
          try { this.tpls[id] = buildTemplate(id, g); } catch (e) { console.warn('[piloto] ' + id + ' indisponível:', e); } });
        try { if (window.KartModels && KartModels.prepare) { KartModels.prepare('gt'); KartModels.prepare('moto'); } } catch (e) { console.warn('[karts] preparo', e); }
        const first = this.tpls[CHAR_IDS[0]] || this.tpls[CHAR_IDS[1]];
        this.tpl = first || null;                                                        // (o main.js guarda a textura do piloto entre as corridas)
        this.status = first ? 'ready' : 'fallback'; this.progress = 1; if (onProgress) onProgress(1);
        if (!first) console.warn('[piloto] modelos 3D indisponíveis, usando o piloto procedural');
        return !!first;
      });
      return this._p;
    },
    create(spec) {
      const t = this.tpls[spec && spec.pilot] || this.tpls[CHAR_IDS[0]] || this.tpls[CHAR_IDS[1]];
      return t ? new PilotRig(t, spec) : new FallbackPilot(spec);
    }
  };
  window.Pilot = Pilot;
})();
