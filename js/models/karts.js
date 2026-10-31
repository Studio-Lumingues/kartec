// =====================================================================================
// models/karts.js — veículos 3D (.glb) + montagem completa
//
// Os dois veículos vêm de arquivos 3D em js/models/entidades/:
//   'gt'   -> kart.glb    (Kartec GT)   nós: chassis, wheel_FL, wheel_FR, wheel_RL, wheel_RR
//   'moto' -> motoca.glb  (Motoca)      nós: chassis, wheel_front, wheel_rear
// KartModels.load() carrega os dois no início (main.js espera junto com o piloto). Depois disso,
// buildKartModel(spec, opts) é instantâneo: as geometrias e a textura são compartilhadas entre os karts.
//
// spec = { model: 'gt' | 'moto', color (corBase), decal (estampa), decalColor (corDecalque),
//          pilot: 'menino' | 'menina', suit, helmet, skin }
// A cor da lataria troca o VERMELHO da textura (materials.js > glbPaint); os adesivos ficam só na lataria.
//
// Cada veículo é descrito em VEHICLES (abaixo) com pontos medidos no próprio .glb (em metros do arquivo,
// ANTES da conversão): assento, pegadores, pedais, escapamentos. Para ajustar o encaixe do piloto, mexa aí.
// O resultado é convertido para o espaço do jogo: frente = +Z, chão = 0, comprimento = length.
// O objeto devolvido tem a mesma interface de antes (group, pivot, body, fw, rolls, flames, rear, lean,
// moto, animate, setColor, setDecal, setDecalColor, setPilot, setNight, dispose...).
// =====================================================================================
(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const VER = '202610310100';

  // ---------- descrição dos veículos (coordenadas do .glb) ----------
  const VEHICLES = [
    { id: 'gt', name: 'Kartec GT', desc: 'O clássico: equilibrado e fácil de pilotar.',
      url: 'js/models/entidades/kart.glb', embed: 'js/models/entidades/kart.glb.js',
      front: 'x',                      // a frente do modelo aponta para +X
      length: 7.6,                     // comprimento final (unidades do jogo, antes da escala 0,8 do grupo)
      chassis: 'chassis', wheelsFront: ['wheel_FL', 'wheel_FR'], wheelsRear: ['wheel_RL', 'wheel_RR'], steerWheels: true,
      // volante: triângulos dentro desta caixa viram uma peça que gira; eixo = direção da coluna; raio dos pegadores
      steering: { box: [[0.135, -0.006, -0.08], [0.226, 0.16, 0.08]], center: [0.187, 0.075, 0], axis: [0.878, -0.478, 0], grip: 0.066 },
      seat: [-0.005, -0.03, 0],         // ponto H (quadril do piloto)
      pedals: [[0.33, -0.065, -0.035], [0.33, -0.065, 0.035]],   // [esquerda, direita] (esquerda do piloto = -Z do arquivo)
      exhaust: [{ p: [-0.49, 0.066, 0.051], d: [-1, 0.12, 0] }, { p: [-0.49, 0.066, -0.051], d: [-1, 0.12, 0] }], flameR: 0.26,
      light: [0.47, 0.0, 0],
      pilot: { scale: 3.3, recline: -0.55, headTilt: 0.1 },
      shadow: [1.9, 3.4], lean: -0.12 },
    { id: 'moto', name: 'Motoca', desc: 'Moto futurista: carenagem lisa, piloto deitado no tanque.',
      url: 'js/models/entidades/motoca.glb', embed: 'js/models/entidades/motoca.glb.js',
      front: '-x',                     // a frente da motoca aponta para -X
      length: 6.6,
      chassis: 'chassis', wheelsFront: ['wheel_front'], wheelsRear: ['wheel_rear'], steerWheels: false,
      steering: null,
      grips: [[-0.11, 0.215, 0.2], [-0.11, 0.215, -0.2]],      // pontas do guidão [esquerda, direita] (esquerda do piloto = +Z do arquivo)
      seat: [0.115, 0.04, 0],
      pedals: [[0.02, -0.12, 0.17], [0.02, -0.12, -0.17]],
      exhaust: [{ p: [0.62, 0.17, -0.06], d: [1, 0.05, 0] }, { p: [0.62, 0.17, 0.06], d: [1, 0.05, 0] }], flameR: 0.2,
      light: [-0.8, 0.2, 0],
      pilot: { scale: 3.0, recline: -0.8, headTilt: 0.15 },
      shadow: [1.2, 3.6], lean: 0.42, moto: true }
  ];
  const byId = id => VEHICLES.find(m => m.id === id) || VEHICLES[0];

  // ---------- carregamento e preparação (uma vez por veículo) ----------
  // tpl = { chassis, steer: { geo, center, quat, grips }, wheels: [{ geo, pos, r, front }], map, decalBox, toGame(p) }
  function prepare(def, gltf) {
    const A = window.GLBAsset, scene = gltf.scene; scene.updateMatrixWorld(true);
    const node = name => { let n = null; scene.traverse(o => { if (!n && o.name === name) n = o; }); return n; };
    const geoOf = n => { const list = []; let map = null; n.traverse(o => { if (o.isMesh) { const g = A.toFloat(o.geometry); g.applyMatrix4(o.matrixWorld); list.push(g); if (!map && o.material && o.material.map) map = o.material.map; } }); return { geo: list.length > 1 ? A.merge(list) : list[0], map }; };
    const ch = node(def.chassis); if (!ch) throw new Error('nó ' + def.chassis + ' não encontrado');
    const C = geoOf(ch), wheelNames = def.wheelsFront.concat(def.wheelsRear);
    // medidas no espaço do arquivo
    const box = new THREE.Box3().setFromObject(scene), wheels = wheelNames.map(nm => {
      const n = node(nm); if (!n) throw new Error('nó ' + nm + ' não encontrado');
      const g = geoOf(n).geo; g.computeBoundingBox(); const c = g.boundingBox.getCenter(V(0, 0, 0)), sz = g.boundingBox.getSize(V(0, 0, 0));
      return { name: nm, geo: g, c, r: Math.max(sz.y, sz.x, sz.z) / 2, front: def.wheelsFront.includes(nm) };
    });
    const fwdAxis = def.front.endsWith('x') ? 'x' : 'z', fsign = def.front.startsWith('-') ? -1 : 1;
    const len = box.max[fwdAxis] - box.min[fwdAxis], s = def.length / len;
    const fa = wheels.filter(w => w.front), ra = wheels.filter(w => !w.front);
    const mid = (fa.reduce((t, w) => t + w.c[fwdAxis], 0) / fa.length + ra.reduce((t, w) => t + w.c[fwdAxis], 0) / ra.length) / 2;
    const groundY = Math.min(...wheels.map(w => w.c.y - w.r));
    // arquivo -> jogo: centraliza entre os eixos, chão em y = 0, frente para +Z, escala
    const yaw = fwdAxis === 'x' ? (fsign > 0 ? -Math.PI / 2 : Math.PI / 2) : (fsign > 0 ? 0 : Math.PI);
    const M = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeTranslation(fwdAxis === 'x' ? -mid : 0, -groundY, fwdAxis === 'z' ? -mid : 0));
    const R = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeRotationY(yaw));   // só giro + escala (para peças centradas)
    const toGame = p => V(p[0], p[1], p[2]).applyMatrix4(M), dirGame = d => V(d[0], d[1], d[2]).transformDirection(new THREE.Matrix4().makeRotationY(yaw));
    // volante separado (gira com a direção)
    let chassis = C.geo, steer = null;
    if (def.steering) {
      const S = def.steering, [lo, hi] = S.box, idx = chassis.index.array, P = chassis.attributes.position, keep = [], cut = [];
      for (let i = 0; i < idx.length; i += 3) {
        let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 3; k++) { cx += P.getX(idx[i + k]); cy += P.getY(idx[i + k]); cz += P.getZ(idx[i + k]); }
        cx /= 3; cy /= 3; cz /= 3;
        (cx > lo[0] && cx < hi[0] && cy > lo[1] && cy < hi[1] && cz > lo[2] && cz < hi[2] ? cut : keep).push(idx[i], idx[i + 1], idx[i + 2]);
      }
      const sub = list => { const g = new THREE.BufferGeometry(); Object.keys(chassis.attributes).forEach(k => g.setAttribute(k, chassis.attributes[k])); g.setIndex(new THREE.BufferAttribute(new Uint32Array(list), 1)); return g; };
      if (cut.length) {
        const sg = sub(cut); chassis = sub(keep);
        const center = toGame(S.center), axis = dirGame(S.axis).normalize(), quat = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), axis), qi = quat.clone().invert();
        // geometria do volante no espaço do pivô (origem no centro, eixo = +Z local)
        const g = sg.clone(); g.applyMatrix4(M); g.translate(-center.x, -center.y, -center.z); g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(qi));
        const side = V(1, 0, 0).applyQuaternion(qi).setZ(0).normalize(), gr = S.grip * s;
        steer = { geo: g, center, quat, grips: [side.clone().multiplyScalar(gr), side.clone().multiplyScalar(-gr)] };   // [esquerda (+X), direita]
      }
    }
    chassis = chassis.clone(); chassis.applyMatrix4(M); chassis.computeBoundingBox(); chassis.computeBoundingSphere();
    // rodas: geometria centrada no eixo (eixo de giro = X local)
    const W = wheels.map(w => { const g = w.geo.clone(); g.translate(-w.c.x, -w.c.y, -w.c.z); g.applyMatrix4(R); g.computeBoundingSphere();
      return { geo: g, pos: toGame([w.c.x, w.c.y, w.c.z]), r: w.r * s, front: w.front }; });
    // caixas de projeção dos adesivos (lateral: z,y | capô: x,z) = caixa da lataria
    const b = chassis.boundingBox;
    const decalBox = { side: [b.min.z, b.max.z, b.min.y, b.max.y], top: [b.min.x, b.max.x, b.min.z, b.max.z] };
    return { def, chassis, steer, wheels: W, map: A.prepMap(C.map), decalBox, toGame, dirGame, scale: s };
  }

  const TPL = {};
  const KartModels = {
    status: 'idle',
    list: () => VEHICLES, get: byId,
    register(m) { VEHICLES.push(m); },
    load(onProgress) {
      if (this._p) return this._p;
      this.status = 'loading';
      const prog = VEHICLES.map(() => 0), tick = () => onProgress && onProgress(prog.reduce((a, b) => a + b, 0) / VEHICLES.length);
      this._p = Promise.all(VEHICLES.map((d, i) => GLBAsset.load(d.url, d.embed, p => { prog[i] = p * 0.95; tick(); })
        .then(g => { TPL[d.id] = prepare(d, g); prog[i] = 1; tick(); return true; })
        .catch(e => { console.warn('[veículos] ' + d.name + ' indisponível:', e); prog[i] = 1; tick(); return false; })))
        .then(r => { this.status = r.every(Boolean) ? 'ready' : 'partial'; return r.every(Boolean); });
      return this._p;
    },
    // texturas compartilhadas (main.js não as descarta ao sair da corrida)
    textures() { return Object.values(TPL).map(t => t.map).filter(Boolean); }
  };

  // ---------- montagem completa ----------
  function buildKartModel(spec, opts) {
    opts = opts || {};
    // number: 0 e accessory: 'none' são forçados (números na lataria e acessórios foram removidos)
    spec = Object.assign({}, CFG.DEFAULT_SPEC, typeof spec === 'string' ? { color: spec } : spec, { number: 0, accessory: 'none' });
    let def = byId(spec.model);
    if (!TPL[def.id]) { const alt = VEHICLES.find(v => TPL[v.id]); if (alt) def = alt; }   // esse .glb não carregou: usa o outro
    const T = TPL[def.id];
    const group = new THREE.Group(), pivot = new THREE.Group(), body = new THREE.Group(); group.add(pivot); pivot.add(body);
    const fw = [], rolls = [], flames = []; let steerRig = null, hands = [null, null], feet = [], info;

    // materiais: lataria (cor + adesivos) e peças (cor, sem adesivos: rodas e volante)
    const box = T ? T.decalBox : { side: [-4, 4, 0, 2.5], top: [-2, 2, -4, 4] };
    const decal = Livery.build(spec, box);
    let paint, trim;
    if (T) {
      paint = KartMats.glbPaint(T.map, spec.color, decal, { gloss: 0.7 });
      trim = KartMats.glbPaint(T.map, spec.color, Object.assign({}, decal, { on: false }), { gloss: 0.4 });
      const cm = new THREE.Mesh(T.chassis, paint); body.add(cm);
      // volante
      if (T.steer) {
        const piv = new THREE.Group(); piv.position.copy(T.steer.center); piv.quaternion.copy(T.steer.quat); body.add(piv);
        const spin = new THREE.Group(); spin.userData.dynamic = true; piv.add(spin);
        spin.add(new THREE.Mesh(T.steer.geo, trim));
        hands = T.steer.grips.map(p => { const o = new THREE.Object3D(); o.position.copy(p); spin.add(o); return o; });
        steerRig = { spin, axis: 'z', k: -1.1 };
      } else if (def.grips) hands = def.grips.map(p => { const o = new THREE.Object3D(); o.position.copy(T.toGame(p)); body.add(o); return o; });
      // rodas
      T.wheels.forEach(w => {
        const p = new THREE.Group(); p.position.copy(w.pos); pivot.add(p);
        const roll = new THREE.Group(); p.add(roll); roll.add(new THREE.Mesh(w.geo, trim));
        rolls.push({ g: roll, r: w.r * 0.8 }); if (w.front && def.steerWheels) fw.push(p);
      });
      feet = def.pedals.map(q => { const o = new THREE.Object3D(); o.position.copy(T.toGame(q)); body.add(o); return o; });
      // chamas do turbo nas pontas dos escapamentos
      def.exhaust.forEach(e => {
        const tip = T.toGame(e.p), d = T.dirGame(e.d).normalize();
        const f = new THREE.Mesh(new THREE.ConeGeometry(def.flameR, 1.8, 16), new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        f.position.copy(tip).addScaledVector(d, 0.9); f.quaternion.setFromUnitVectors(V(0, 1, 0), d); f.visible = false; f.userData.dynamic = true; body.add(f); flames.push(f);
      });
      const rw = T.wheels.filter(w => !w.front);
      info = { cockpit: Object.assign({ seat: T.toGame(def.seat), hands, feet }, def.pilot),
        rear: { x: Math.max(...rw.map(w => Math.abs(w.pos.x))) || 0.45, z: rw[0].pos.z }, shadow: def.shadow, lean: def.lean, moto: !!def.moto,
        light: T.toGame(def.light) };
    } else {
      // reserva (arquivo 3D não carregou): caixa na cor do kart + 4 rodas
      paint = KartMats.paint(spec.color, decal); trim = KartMats.std(0x1d1e22, 0.6, 0);
      body.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 6.4), paint), { position: V(0, 1.0, 0) }));
      [[1.5, 1.8, true], [-1.5, 1.8, true], [1.5, -2, false], [-1.5, -2, false]].forEach(([x, z, f]) => {
        const p = new THREE.Group(); p.position.set(x, 0.75, z); pivot.add(p); const roll = new THREE.Group(); p.add(roll);
        roll.add(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.7, 16).rotateZ(Math.PI / 2), trim)); rolls.push({ g: roll, r: 0.6 }); if (f) fw.push(p); });
      hands = [V(0.5, 2.0, 1.2), V(-0.5, 2.0, 1.2)].map(p => { const o = new THREE.Object3D(); o.position.copy(p); body.add(o); return o; });
      feet = [V(0.3, 1.0, 2.2), V(-0.3, 1.0, 2.2)].map(p => { const o = new THREE.Object3D(); o.position.copy(p); body.add(o); return o; });
      info = { cockpit: { seat: V(0, 1.5, -0.6), scale: 3.3, recline: -0.4, hands, feet }, rear: { x: 1.5, z: -2 }, shadow: def.shadow, lean: def.lean, moto: !!def.moto, light: V(0, 1, 3.4) };
    }

    // sombra-bolha e farol (só o jogador leva luz de verdade)
    const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.16, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.scale.set(info.shadow[0], info.shadow[1], 1); blob.position.y = 0.03; group.add(blob);
    let headL = null;
    if (opts.lights) { // alcance curto + decaimento forte: sem clarão nas paredes do túnel
      headL = new THREE.SpotLight(0xfff0c8, 0, 48, 0.5, 0.65, 2); headL.position.set(0, info.light.y + 0.3, info.light.z); group.add(headL);
      const t = new THREE.Object3D(); t.position.set(0, 0, 22); group.add(t); headL.target = t; }
    group.scale.setScalar(0.8);
    group.traverse(o => { if (o.isMesh && !o.material.isMeshBasicMaterial) { o.castShadow = true; o.receiveShadow = false; } });
    // contorno de desenho animado (casco invertido) na carroceria, rodas e volante
    if (opts.outline !== false) {
      Toon.outline(body, 0.04);
      rolls.forEach(r => Toon.outline(r.g, 0.035, null, 0x0c0c0e));
    }
    group.traverse(o => { if (o.isMesh || o.isSprite) o.frustumCulled = false; });   // kart inteiro sempre desenhado
    // piloto
    let pilot = null;
    if (opts.pilot !== false && window.Pilot) { pilot = Pilot.create(spec); pilot.attach(body, info.cockpit); pilot.update(0, {}); }

    const du = paint.userData.decalUniforms;
    const m = {
      group, pivot, body, blob, headL, headGlows: [], spec, pilot, def,
      fw, rolls, flames, headLens: [], neons: [],
      rear: info.rear, lean: info.lean, moto: info.moto, steerRig, mats: { paint, trim }, paint,
      // ---- personalização em tempo real (sem reconstruir a malha) ----
      setColor(hex) { [paint, trim].forEach(mt => { const u = mt.userData.decalUniforms; if (u && u.uPaint) u.uPaint.value.set(hex); else if (mt.color && mt === paint) mt.color.set(hex); }); spec.color = hex; },
      setDecalColor(hex) { if (du) du.uDecalColor.value.set(hex); spec.decalColor = hex; },
      setDecal(id) { spec.decal = id; spec.number = 0; if (!du) return; const d = Livery.build(spec, box); du.uDecal.value = d.texture; du.uDecalOn.value = d.on ? 1 : 0; du.uNumSide.value.w = 0; du.uNumTop.value.w = 0; },
      // cores do piloto na hora; trocar menino/menina reconstrói só o piloto
      setPilot(s) {
        const was = spec.pilot; Object.assign(spec, s, { accessory: 'none' });
        if (pilot && spec.pilot !== was && window.Pilot) { pilot.dispose(); pilot = m.pilot = Pilot.create(spec); pilot.attach(body, info.cockpit); pilot.update(0, {}); if (opts.outline === false) pilot.root.traverse(o => { if (o.userData && o.userData.outline) o.visible = false; }); }
        else if (pilot) pilot.setColors(spec);
      },
      // anima volante e piloto. st = { steer, speed(0..1), boost, drift, air }
      animate(dt, st) {
        if (steerRig) steerRig.spin.rotation.z = (st.steer || 0) * steerRig.k;
        if (m.pilot) m.pilot.update(dt, st);
      },
      setNight(nf) { KartMats.setEnvLevel(group, 1 - 0.75 * nf); },
      // as geometrias do .glb são compartilhadas: só descarta as criadas aqui (bolha, chamas, contornos)
      dispose() { if (m.pilot) m.pilot.dispose(); group.traverse(o => { if (o.geometry && !shared(o.geometry)) o.geometry.dispose(); }); }
    };
    return m;
  }
  const shared = g => Object.values(TPL).some(t => t.chassis === g || (t.steer && t.steer.geo === g) || t.wheels.some(w => w.geo === g));

  window.KartModels = KartModels;
  window.buildKartModel = buildKartModel;
})();
