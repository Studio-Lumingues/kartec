// =====================================================================================
// models/karts.js — modelos de kart (registro expansível) + montagem completa
//
// buildKartModel(spec, opts) monta: veículo 3D (assets/kart.glb ou assets/motoca.glb) + pintura
// + rodas + volante animado (kart) / guidão (moto) + piloto sentado. spec = {
//   model: 'gt' (kart) | 'moto' (Motoca)   <- únicos modelos disponíveis,
//   color (corBase),
//   pilot ('menino' | 'menina'), suit, helmet, skin      <- piloto (sem números na lataria e sem acessórios)
// }
// Os .glb (carregados pelo models/glb.js durante a tela de carregamento) são convertidos UMA vez por modelo para o
// espaço do jogo (frente em +z, esquerda do piloto em +x, chão em y = 0) com as medidas de cada um (VEH): escala,
// rodas (pivô no cubo), volante recortado do chassi (gira com a direção e leva as mãos junto), manoplas, banco,
// pedais/pedaleiras, escapamentos (chama do turbo) e faróis. Cada kart da pista só cria materiais e grupos:
// as geometrias são compartilhadas.
// Pintura: o shader troca o vermelho da textura pela cor escolhida mantendo o sombreado da textura.
// Adesivos/decalques não existem nos veículos: nenhum carregamento, textura, mapeamento ou projeção nas malhas
// (kart e motoca sempre começam neutros, só com a pintura). Cada modelo devolve cockpit, rear, shadow e lean.
// =====================================================================================
(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---------------- medidas tiradas dos .glb (unidades do arquivo) ----------------
  // face: +1 = frente do arquivo em +x (kart) | -1 = frente em -x (moto). ground = altura da base dos pneus;
  // midX = centro do entre-eixos. scale = arquivo -> unidades do modelo do jogo (o grupo ainda leva x0,8).
  // Piloto: p = tamanho do piloto em unidades do arquivo (kart 0,75 e moto 1,25 dão o MESMO piloto na tela);
  // hip = ponto do quadril, feet = tornozelos, lean = inclinação do tronco, headTilt = cabeça erguida.
  // A pose da moto foi calculada por busca com colisão contra a malha inteira: o capacete fica com folga do
  // guidão e do para-brisa (e as marias-chiquinhas da menina também).
  const VEH = {
    gt: { glb: 'kart', face: 1, scale: 6.4, ground: -0.1485, midX: 0.0412, refV: 0.92,
      wheels: [['wheel_FL', 1], ['wheel_FR', 1], ['wheel_RL', 0], ['wheel_RR', 0]],   // 1 = esterça (kart.js)
      steer: { c: [0.184, 0.0897, 0.0023], n: [0.9, -0.436, 0.004], rim: 0.058, cutH: 0.02, cutBack: -0.05, cutR: 0.08, grip: 1.36, k: 0.9 },
      pilot: { p: 0.75, hip: [0.05, -0.0127, 0], feet: [0.165, -0.03, 0.06], lean: 0.05, headTilt: 0.02, footPitch: -0.45, leanK: 1, boostLean: -0.08, knee: [0.25, 0.55, 0.8] },
      exhaust: [[[-0.482, 0.069, 0.056], [-0.956, 0.292, 0.035]], [[-0.484, 0.061, -0.051], [-0.963, 0.269, -0.004]]], exR: 0.03,
      lights: [[0.452, -0.014, 0.188], [0.452, -0.014, -0.188]], lightR: 0.022, lean: -0.12 },
    moto: { glb: 'motoca', face: -1, scale: 3.84, ground: -0.399, midX: -0.0004, refV: 0.95,
      wheels: [['wheel_front', 2], ['wheel_rear', 0]],                                   // 2 = esterça pelo garfo (aqui, com amplitude de moto)
      grips: { c: [-0.112, 0.218, 0.212], r: 0.025 }, forkK: 0.22,
      pilot: { p: 1.25, hip: [0.23, 0.149, 0], feet: [0.12, -0.035, 0.215], lean: 0.44, headTilt: 0.6, footPitch: 0.25, leanK: 0.5, boostLean: 0, knee: [0.6, 0.3, 0.75] },
      exhaust: [[[0.655, 0.21, 0.06], [1, 0.06, 0]], [[0.655, 0.21, -0.06], [1, 0.06, 0]]], exR: 0.035,
      lightAuto: true, lightR: 0.03, lean: 0.42, moto: true }
  };

  // ---------------- pintura: troca do vermelho da textura pela cor escolhida ----------------
  const HSV = 'vec3 kHsv(vec3 c) { vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1.0e-10)), d / (q.x + 1.0e-10), q.x); }';
  const PAINT_FS_HEAD = ['uniform vec3 uPaint; uniform float uRefV;', HSV].join('\n');
  // wP = quanto o texel é "lataria vermelha"; kv = luz embutida na textura (mantida na cor nova)
  const PAINT_FS_BODY = [
    '{ vec3 hv = kHsv(texelColor.rgb); float dr = min(hv.x, 1.0 - hv.x);',
    '  float wP = (1.0 - smoothstep(0.045, 0.075, dr)) * smoothstep(0.35, 0.5, hv.y) * smoothstep(0.05, 0.14, hv.z);',
    '  float kv = hv.z / uRefV; float sh = min(kv, 1.0); vec3 hi = vec3(max(kv - 1.0, 0.0) * 0.5);',
    '  diffuseColor.rgb = mix(diffuseColor.rgb, uPaint * sh + hi, wP); }'
  ].join('\n');
  function paintMat(map, u) {
    const m = Toon.mat({ color: 0xffffff, map }, { gloss: 0.45, rim: 0.3, sat: 0, key: 'veh-paint', hook: sh => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = PAINT_FS_HEAD + '\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + PAINT_FS_BODY);
    } });
    m.userData.unique = true; return m;
  }

  // ---------------- conversão do .glb para o espaço do jogo (uma vez por modelo) ----------------
  function prepVehicle(def) {
    const d = def.veh; if (!d) return null;
    if (d._tpl !== undefined) return d._tpl;
    const gltf = window.GLBAssets && GLBAssets.get(d.glb);
    if (!gltf) return null;                                         // ainda não carregou (ou falhou): não guarda, tenta de novo depois
    const scene = gltf.scene; scene.updateMatrixWorld(true);
    const S = d.scale, R = new THREE.Matrix4();
    if (d.face > 0) R.set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1); else R.set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);
    const M = new THREE.Matrix4().makeScale(S, S, S).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-d.midX, -d.ground, 0));
    const G = a => new THREE.Vector3().fromArray(a).applyMatrix4(M), D = a => new THREE.Vector3().fromArray(a).transformDirection(R);
    let chassis = null, map = null; const wmesh = {};
    scene.traverse(o => { if (!o.isMesh) return; const pn = o.parent && o.parent.name;
      if (pn === 'chassis') chassis = o; else if (d.wheels.some(w => w[0] === pn)) wmesh[pn] = o;
      if (!map && o.material && o.material.map) map = o.material.map; });
    if (!chassis) { console.warn('[karts] ' + d.glb + '.glb sem o nó chassis'); return d._tpl = null; }
    const tex = map, side = chassis.material && chassis.material.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide;                                               // offset/repeat do KHR_texture_transform: lidos pelo bake e depois zerados
    const tpl = { map, side, refV: d.refV, lean: d.lean, moto: !!d.moto, wheels: [], flames: [], lights: [] };
    // ----- chassi (e, no kart, o volante recortado dele) -----
    const cb = GLBAssets.bake(chassis, chassis.matrixWorld, tex);
    if (d.steer) {
      const sw = d.steer, C = V(...sw.c), n = V(...sw.n).normalize(), nt = cb.I.length / 3, inW = new Uint8Array(nt), c = V(0, 0, 0), dv = V(0, 0, 0);
      for (let t = 0; t < nt; t++) { c.set(0, 0, 0); for (let k = 0; k < 3; k++) { const i = cb.I[t * 3 + k]; c.x += cb.P[i * 3]; c.y += cb.P[i * 3 + 1]; c.z += cb.P[i * 3 + 2]; }
        c.multiplyScalar(1 / 3); dv.subVectors(c, C); const h = dv.dot(n), rr = dv.addScaledVector(n, -h).length();
        inW[t] = h < sw.cutH && h > sw.cutBack && rr < sw.cutR ? 1 : 0; }
      // referencial do volante no jogo: z local aponta para o piloto, y local = "12 horas" do aro
      const up = V(0, 1, 0).addScaledVector(n, -n.y).normalize(), Zl = D(n.toArray()).negate(), Yl = D(up.toArray()), Xl = V().crossVectors(Yl, Zl).normalize();
      const pm = new THREE.Matrix4().makeBasis(Xl, Yl, Zl).setPosition(G(sw.c)), pmi = pm.clone().invert();
      tpl.bodyGeo = GLBAssets.geometry(cb, t => !inW[t], M);
      tpl.steerGeo = GLBAssets.geometry(cb, t => inW[t], pmi.clone().multiply(M));
      const r = sw.rim * S, a = sw.grip;
      tpl.steer = { pos: V().setFromMatrixPosition(pm), quat: new THREE.Quaternion().setFromRotationMatrix(pm), k: sw.k,
        // mão esquerda (+x do jogo = -x local) e direita; t = sentido do polegar (para as 12 horas, ao longo do aro)
        grips: [{ pos: V(-r * Math.sin(a), r * Math.cos(a), 0), t: V(Math.cos(a), Math.sin(a), 0) }, { pos: V(r * Math.sin(a), r * Math.cos(a), 0), t: V(-Math.cos(a), Math.sin(a), 0) }] };
    } else tpl.bodyGeo = GLBAssets.geometry(cb, null, M);
    tpl.bodyGeo.userData.shared = true; if (tpl.steerGeo) tpl.steerGeo.userData.shared = true;
    // ----- rodas: geometria centrada no cubo (gira em x; as da frente esterçam em y) -----
    d.wheels.forEach(([name, steer]) => {
      const mesh = wmesh[name]; if (!mesh) return;
      const hub = V().setFromMatrixPosition(mesh.parent.matrixWorld).applyMatrix4(M);
      const geo = GLBAssets.geometry(GLBAssets.bake(mesh, mesh.matrixWorld, tex), null, new THREE.Matrix4().makeTranslation(-hub.x, -hub.y, -hub.z).multiply(M));
      const p = geo.attributes.position; let r = 0; for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getY(i), p.getZ(i)));
      geo.userData.shared = true; tpl.wheels.push({ geo, hub, r, steer });
    });
    GLBAssets.plainMap(map);
    // ----- piloto: quadril, tornozelos, manoplas (moto) -----
    const pp = d.pilot, pair = a => { const A = G([a[0], a[1], a[2]]), B = G([a[0], a[1], -a[2]]); return A.x > B.x ? [A, B] : [B, A]; };   // [esquerda (+x), direita]
    tpl.cockpit = { seat: G(pp.hip), scale: pp.p * S, feet: pair(pp.feet), lean: pp.lean, headTilt: pp.headTilt, footPitch: pp.footPitch, leanK: pp.leanK, boostLean: pp.boostLean, knee: pp.knee, moto: !!d.moto };
    if (d.grips) { const gp = pair(d.grips.c); tpl.grips = [{ pos: gp[0], t: V(-1, 0, 0) }, { pos: gp[1], t: V(1, 0, 0) }]; tpl.forkK = d.forkK; }   // polegares para dentro
    // ----- escapamentos (chama do turbo) e faróis -----
    (d.exhaust || []).forEach(([tip, dir]) => tpl.flames.push({ pos: G(tip), dir: D(dir), r: d.exR * S }));
    const fwd = V(0, 0, 1);
    if (d.lights) d.lights.forEach(l => tpl.lights.push({ pos: G(l).addScaledVector(fwd, 0.004 * S), r: d.lightR * S }));
    if (d.lightAuto) { const p = tpl.bodyGeo.attributes.position; let best = null;   // ponta do bico (moto): vértice mais à frente perto do eixo
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (Math.abs(x) < 0.12 * S * 0.25 && y > 0.4 * S && y < 0.6 * S && (!best || z > best.z)) best = V(x, y, z); }
      if (best) tpl.lights.push({ pos: best.addScaledVector(fwd, 0.006 * S), r: d.lightR * S }); }
    // ----- sombra e rodas de trás -----
    const bb = tpl.bodyGeo.boundingBox, sz = bb.getSize(V());
    tpl.shadow = [Math.max(sz.x * 0.47, 0.9), sz.z * 0.46];
    const rears = tpl.wheels.filter(w => w.steer === 0);
    tpl.rear = rears.length > 1 ? { x: Math.abs(rears[0].hub.x), z: rears[0].hub.z } : { x: 0.45, z: rears.length ? rears[0].hub.z : -1.95 };
    return d._tpl = tpl;
  }

  // =====================================================================================
  // MODELOS
  // =====================================================================================
  const MODELS = [
    { id: 'gt', name: 'Kartec GT', desc: 'Kart clássico de chassi tubular: equilibrado e fácil de pilotar.', veh: VEH.gt },
    { id: 'moto', name: 'Motoca', desc: 'Moto futurista de carenagem lisa: deita nas curvas e empina.', veh: VEH.moto }
  ];
  const byId = id => MODELS.find(m => m.id === id) || MODELS[0];

  // =====================================================================================
  // montagem completa
  // =====================================================================================
  function buildKartModel(spec, opts) {
    opts = opts || {};
    // number: 0 e accessory: 'none' são forçados e decal/decalColor são apagados: números na lataria, acessórios do piloto
    // e adesivos foram removidos (vale também para specs antigos da rede ou salvos no navegador): estado sempre neutro
    spec = Object.assign({}, CFG.DEFAULT_SPEC, typeof spec === 'string' ? { color: spec } : spec, { number: 0, accessory: 'none' });
    delete spec.decal; delete spec.decalColor;
    const def = byId(spec.model), tpl = prepVehicle(def);
    if (!tpl) return fallbackModel(spec, opts, def);
    const u = { uPaint: { value: new THREE.Color(spec.color) }, uRefV: { value: tpl.refV } };
    const paint = paintMat(tpl.map, u), parts = paint;                               // carroceria, rodas e volante: um material só
    paint.side = tpl.side;                                                           // a moto vem com faces dos dois lados no .glb
    const group = new THREE.Group(), pivot = new THREE.Group(), body = new THREE.Group(); group.add(pivot); pivot.add(body);
    body.add(new THREE.Mesh(tpl.bodyGeo, paint));
    // rodas
    const fw = [], rolls = []; let fork = null;
    tpl.wheels.forEach(w => { const p = new THREE.Group(); p.position.copy(w.hub); pivot.add(p); const roll = new THREE.Group(); p.add(roll);
      roll.add(new THREE.Mesh(w.geo, parts)); rolls.push({ g: roll, r: w.r * 0.8 });
      if (w.steer === 1) fw.push(p); else if (w.steer === 2) fork = p; });
    // volante (kart: gira com a direção e leva as mãos) / manoplas fixas (moto)
    let steerRig, hands;
    if (tpl.steer) {
      const piv = new THREE.Group(); piv.position.copy(tpl.steer.pos); piv.quaternion.copy(tpl.steer.quat); body.add(piv);
      const spin = new THREE.Group(); spin.userData.dynamic = true; piv.add(spin); spin.add(new THREE.Mesh(tpl.steerGeo, parts));
      hands = tpl.steer.grips.map(g => { const o = new THREE.Object3D(); o.position.copy(g.pos); o.userData.t = g.t.clone(); spin.add(o); return o; });
      steerRig = { spin, axis: 'z', k: tpl.steer.k };
    } else {
      hands = (tpl.grips || []).map(g => { const o = new THREE.Object3D(); o.position.copy(g.pos); o.userData.t = g.t.clone(); body.add(o); return o; });
      steerRig = { spin: null, axis: 'y', fork, k: tpl.forkK || 0 };
    }
    const feet = tpl.cockpit.feet.map(p => { const o = new THREE.Object3D(); o.position.copy(p); body.add(o); return o; });
    const cockpit = Object.assign({}, tpl.cockpit, { hands, feet });
    // chama do turbo na ponta de cada escapamento
    const flames = tpl.flames.map(fl => {
      const f = new THREE.Mesh(new THREE.ConeGeometry(fl.r * 0.95, 1.8, 16), new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      f.position.copy(fl.pos).addScaledVector(fl.dir, 0.9); f.quaternion.setFromUnitVectors(V(0, 1, 0), fl.dir); f.visible = false; f.userData.dynamic = true; body.add(f); return f; });
    // lente dos faróis (acende à noite) sobre o farol do modelo
    const lensPos = tpl.lights.map(l => { const lensM = new THREE.MeshBasicMaterial({ color: 0xd8d2b0 }); lensM.userData.unique = true;
      const lens = new THREE.Mesh(new THREE.CircleGeometry(l.r, 20), lensM); lens.position.copy(l.pos); lens.userData.dynamic = true; body.add(lens);
      return { lens, x: l.pos.x, y: l.pos.y, z: l.pos.z + l.r * 0.5 }; });
    // sombra-bolha, farol (só o jogador leva luz de verdade), brilhos dos faróis
    const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.16, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.scale.set(tpl.shadow[0], tpl.shadow[1], 1); blob.position.y = 0.03; group.add(blob);
    let headL = null;
    const front = lensPos.length ? lensPos[0].z + 0.3 : 3.7, lightY = lensPos.length ? lensPos[0].y : 1.0;
    if (opts.lights) { // alcance curto + decaimento forte: sem clarão nas paredes do túnel
      headL = new THREE.SpotLight(0xfff0c8, 0, 48, 0.5, 0.65, 2); headL.position.set(0, lightY + 0.1, front); group.add(headL);
      const t = new THREE.Object3D(); t.position.set(0, 0, 22); group.add(t); headL.target = t; }
    const headGlows = lensPos.map(l => { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: 0xfff2c0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); p.position.set(l.x, l.y, l.z + 0.2); p.scale.setScalar(1.6); group.add(p); return p; });
    group.scale.setScalar(0.8);
    group.traverse(o => { if (o.isMesh && !o.material.isMeshBasicMaterial) { o.castShadow = true; o.receiveShadow = false; } });
    // contorno de desenho animado (casco invertido) na carroceria, volante e rodas
    if (opts.outline !== false) {
      Toon.outline(body, 0.05);
      rolls.forEach(r => Toon.outline(r.g, 0.04, null, 0x0c0c0e));
      group.traverse(o => { if (o.isMesh || o.isSprite) o.frustumCulled = false; });   // kart inteiro sempre desenhado (são poucos objetos; evita sumir na borda da tela)
    }
    // piloto
    let pilot = null;
    const mount = () => { pilot = Pilot.create(spec); pilot.attach(body, cockpit); pilot.update(0, {}); return pilot; };
    if (opts.pilot !== false && window.Pilot) mount();

    const m = {
      group, pivot, body, blob, headL, headGlows, spec, pilot, def,
      fw, rolls, flames, headLens: lensPos.map(l => l.lens), neons: [],
      rear: tpl.rear, lean: tpl.lean, moto: tpl.moto, steerRig, mats: { paint }, paint,
      // ---- personalização em tempo real (sem reconstruir a malha) ----
      setColor(hex) { u.uPaint.value.set(hex); spec.color = hex; },
      // troca de cores do piloto ou do personagem (menino/menina): o personagem novo é montado no mesmo lugar
      setPilot(s) { const before = spec.pilot; Object.assign(spec, s, { accessory: 'none' });
        if (!this.pilot) return;
        if (spec.pilot !== before) { this.pilot.dispose(); this.pilot = mount(); }
        else this.pilot.setColors(spec); },
      // anima volante, garfo da moto e piloto. st = { steer, speed(0..1), boost, drift, air }
      animate(dt, st) {
        const sr = this.steerRig, a = st.steer || 0; if (sr.spin) sr.spin.rotation.z = a * sr.k; if (sr.fork) sr.fork.rotation.y = a * sr.k;
        // LOD do piloto (m.lod, definido pelo main.js > kartCull): 0 = todo quadro, 1 = a cada 2, 2 = a cada 4, 3 = fora da tela (parado).
        // O IK de braços e pernas é o que mais pesa por kart; longe ninguém percebe a animação em passos.
        const pl = this.pilot;
        if (pl) { const L = this.lod || 0; this._pacc = Math.min(0.25, (this._pacc || 0) + dt);
          if (L >= 3) return;
          if (L > 0 && (this._pf = ((this._pf || 0) + 1) % (L === 1 ? 2 : 4)) !== 0) return;
          pl.update(this._pacc, st); this._pacc = 0; }
      },
      setNight(nf) { KartMats.setEnvLevel(group, 1 - 0.75 * nf); },
      dispose() { if (this.pilot) this.pilot.dispose(); disposeTree(group); }
    };
    return m;
  }
  // geometrias compartilhadas entre karts (modelo convertido) não são descartadas aqui
  function disposeTree(root) { root.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); }); }

  // ---------- reserva: se o .glb não carregou, um kart simples com a mesma interface (o jogo segue funcionando) ----------
  function fallbackModel(spec, opts, def) {
    const moto = def.id === 'moto', col = new THREE.Color(spec.color);
    const paint = KartMats.std(col, 0.4, 0.1, { sat: 0 }), dark = KartMats.std(0x24262c, 0.6, 0), rub = KartMats.rubber(false);
    paint.userData.unique = true;
    const group = new THREE.Group(), pivot = new THREE.Group(), body = new THREE.Group(); group.add(pivot); pivot.add(body);
    const add = (g, m, x, y, z, p) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); (p || body).add(o); return o; };
    add(GEO.rbox(moto ? 0.9 : 2.6, 0.7, moto ? 4.6 : 5.6, 0.25, 2), paint, 0, 1.2, 0);
    const fw = [], rolls = [];
    (moto ? [[0, 2.0, 0.9], [0, -2.0, 0.9]] : [[1.5, 1.8, 0.7], [-1.5, 1.8, 0.7], [1.6, -1.8, 0.8], [-1.6, -1.8, 0.8]]).forEach(([x, z, r], i) => {
      const p = new THREE.Group(); p.position.set(x, r, z); pivot.add(p); const roll = new THREE.Group(); p.add(roll);
      add(new THREE.CylinderGeometry(r, r, 0.6, 18).rotateZ(Math.PI / 2), rub, 0, 0, 0, roll); rolls.push({ g: roll, r: r * 0.8 }); if (z > 0) fw.push(p); });
    const hands = [1, -1].map(s => { const o = new THREE.Object3D(); o.position.set(s * 0.45, 2.1, 1.0); body.add(o); return o; });
    const feet = [1, -1].map(s => { const o = new THREE.Object3D(); o.position.set(s * 0.4, 1.0, 1.5); body.add(o); return o; });
    const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.16, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.scale.set(moto ? 1.2 : 1.9, 3.2, 1); blob.position.y = 0.03; group.add(blob);
    group.scale.setScalar(0.8);
    let pilot = null;
    if (opts.pilot !== false && window.Pilot) { pilot = Pilot.create(spec); pilot.attach(body, { seat: V(0, 1.9, -0.6), scale: 1.6, hands, feet }); pilot.update(0, {}); }
    return { group, pivot, body, blob, headL: null, headGlows: [], spec, pilot, def, fw, rolls, flames: [], headLens: [], neons: [],
      rear: { x: moto ? 0.45 : 1.6, z: -1.8 }, lean: moto ? 0.42 : -0.12, moto, steerRig: null, mats: { paint }, paint,
      setColor(hex) { paint.color.set(hex); spec.color = hex; },
      setPilot(s) { Object.assign(spec, s, { accessory: 'none' }); if (pilot) pilot.setColors(spec); },
      animate(dt, st) { if (pilot && (this.lod || 0) < 3) pilot.update(dt, st); },
      setNight() { }, dispose() { if (pilot) pilot.dispose(); disposeTree(group); } };
  }

  window.KartModels = { list: () => MODELS, get: byId, register(m) { MODELS.push(m); }, prepare: id => prepVehicle(byId(id)) };
  window.buildKartModel = buildKartModel;
})();
