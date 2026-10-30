// =====================================================================================
// models/karts.js — modelos de kart (registro expansível) + montagem completa
//
// buildKartModel(spec, opts) monta: carroceria do modelo escolhido + pintura (com adesivos) + rodas
// + volante/guidão animado + piloto sentado. spec = {
//   model: 'gt' (kart tradicional) | 'moto' (Motoca futurista)   <- únicos modelos disponíveis,
//   color (corBase), decal (estampa), decalColor (corDecalque),
//   suit, helmet, skin                     <- piloto (sem números na lataria e sem acessórios)
// }
// Cada modelo é um objeto { id, name, desc, build(k) } no registro KART_MODELS. O build recebe um
// "kit" (k) com materiais e peças prontas (rodas, volante, escapamento, farol...) e devolve:
//   cockpit: { seat, scale, recline, wheel|bar, feet }  -> onde o piloto senta e o que ele segura
//   decal:   { side, top, numSide, numTop }             -> caixas de projeção dos adesivos (m)
//   rear:    { x, z }                                    -> rodas traseiras (faíscas e fumaça)
//   shadow:  [largura, comprimento], lean (inclinação da carroceria nas curvas)
// Para criar um modelo novo basta registrar mais um objeto (KartModels.register).
// =====================================================================================
(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const { rbox, smoothSeams, mergeByMaterial } = GEO;

  // ---------------- pneus e rodas ----------------
  function tireGeo(r, w, rim) {
    const pts = [], ri = r * (rim || 0.6), c = Math.min(w * 0.5, r * 0.42);   // perfil bem arredondado: pneu "gordinho" de brinquedo
    pts.push(new THREE.Vector2(ri, w / 2));
    for (let k = 0; k <= 4; k++) { const a = Math.PI / 2 - k / 4 * Math.PI / 2; pts.push(new THREE.Vector2(r - c + Math.cos(a) * c, w / 2 - c + Math.sin(a) * c)); }
    for (let k = 0; k <= 4; k++) { const a = -k / 4 * Math.PI / 2; pts.push(new THREE.Vector2(r - c + Math.cos(a) * c, -w / 2 + c + Math.sin(a) * c)); }
    pts.push(new THREE.Vector2(ri, -w / 2));
    const g = new THREE.LatheGeometry(pts, 22); g.rotateZ(Math.PI / 2); return g;
  }

  // ---------------- kit de montagem ----------------
  function makeKit(spec, decal) {
    const col = new THREE.Color(spec.color);
    const M = {
      paint: KartMats.paint(spec.color, decal),
      paintL: KartMats.std(col.clone().lerp(new THREE.Color(0xffffff), 0.2), 0.32, 0.18, { sat: 0 }),
      paintD: KartMats.std(col.clone().multiplyScalar(0.72), 0.4, 0.15, { sat: 0 }),
      hub: KartMats.std(spec.color, 0.28, 0.35, { sat: 0 }),
      white: KartMats.std(0xf3f4f6, 0.38, 0.02), gray: KartMats.std(0xb9bdc4, 0.35, 0.55), black: KartMats.std(0x1d1e22, 0.55, 0.1),
      dark: KartMats.std(0x34373f, 0.45, 0.4), chrome: KartMats.chrome(), rubber: KartMats.rubber(false),
      seat: KartMats.std(0x202228, 0.7, 0), glass: KartMats.std(0x1a2a40, 0.06, 0.4, { envMapIntensity: 1.3 }),
      neon: KartMats.neon(spec.decalColor)
    };
    ['paintL', 'paintD', 'hub'].forEach(n => M[n].userData.unique = true);
    // peças de cor fixa (plástico branco/cinza/preto, banco, cromado, vidro) usam UM material com cor por
    // vértice: depois do agrupamento, a carroceria inteira sai em poucas chamadas de desenho
    M.solid = Toon.mat({ color: 0xffffff, vertexColors: true }, { gloss: 0.45, rim: 0.3, sat: 0, key: 'solid' });
    M.solidSet = new Map(['white', 'gray', 'black', 'dark', 'seat', 'glass', 'chrome'].map(n => [M[n], M[n].color.clone()]));
    const group = new THREE.Group(), pivot = new THREE.Group(), body = new THREE.Group(); group.add(pivot); pivot.add(body);
    const k = {
      M, group, pivot, body, spec, fw: [], rolls: [], flames: [], lensPos: [], neons: [],
      add(g, m, x, y, z, p) { const o = new THREE.Mesh(g, m); o.position.set(x || 0, y || 0, z || 0); (p || body).add(o); return o; },
      box(w, h, d, r, m, x, y, z, p) { return this.add(rbox(w, h, d, r, 2), m, x, y, z, p); },   // low/mid-poly: 2 segmentos por quina
      cone(a, b, rA, rB, m, p, seg) { const d = new THREE.Vector3().subVectors(b, a), l = d.length(); const o = new THREE.Mesh(new THREE.CylinderGeometry(rB, rA, l, seg || 12), m); o.position.copy(a).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); (p || body).add(o); return o; },
      rod(a, b, r, m, p) { this.cone(a, b, r, r, m, p, 8); [a, b].forEach(q => this.add(new THREE.SphereGeometry(r, 8, 6), m, q.x, q.y, q.z, p)); },
      tube(pts, r, m, closed, p) { return this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, !!closed), Math.max(16, pts.length * 7), r, 8, !!closed), m, 0, 0, 0, p); },
      // corpo com perfil lateral (forma 2D em z,y) extrudado na largura e boleado
      profile(pts, width, bevel, m, x) {
        const sh = new THREE.Shape(); pts.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1]));
        const g = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 });
        g.translate(0, 0, -(width - bevel * 2) / 2); g.rotateY(-Math.PI / 2); return this.add(g, m, x || 0, 0, 0);
      },
      // roda completa: pneu + aro + calota em domo + parafusos (estilo único: os estilos raiado, faixa branca,
      // cyber e cravos eram só dos karts removidos)
      wheel(x, y, z, r, w, o) {
        o = o || {}; const p = new THREE.Group(); p.position.set(x, y, z); pivot.add(p); const roll = new THREE.Group(); p.add(roll); const s = Math.sign(x) || 1, rimR = 0.6;
        roll.add(new THREE.Mesh(tireGeo(r, w, rimR), M.rubber));
        const face = s * w * 0.43;
        const wg = new THREE.CylinderGeometry(r * rimR, r * rimR, w * 0.86, 18); wg.rotateZ(Math.PI / 2);
        roll.add(new THREE.Mesh(wg, M.dark));
        const lip = new THREE.TorusGeometry(r * rimR * 0.93, r * 0.05, 6, 20); lip.rotateY(Math.PI / 2);
        const ring = new THREE.Mesh(lip, M.chrome); ring.position.x = face; roll.add(ring);
        const hub = new THREE.Mesh(new THREE.SphereGeometry(r * rimR * 0.8, 14, 8), M.hub); hub.scale.x = 0.45; hub.position.x = face; roll.add(hub);   // calota em domo (brinquedo)
        for (let i = 0; i < 5; i++) { const t = i / 5 * Math.PI * 2, q = r * 0.24; const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), M.chrome); b.position.set(face + s * r * 0.1, Math.sin(t) * q, Math.cos(t) * q); roll.add(b); }
        this.rolls.push({ g: roll, r: r * 0.8 }); if (o.steer) this.fw.push(p);
        return p;
      },
      // volante: pivô inclinado + aro que gira com a direção; devolve os dois pegadores para as mãos
      steering(pos, tilt, r, base) {
        const piv = new THREE.Group(); piv.position.copy(pos); piv.rotation.x = tilt; body.add(piv);
        const spin = new THREE.Group(); spin.userData.dynamic = true; piv.add(spin);
        spin.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.065, 6, 22), M.black));
        [0, 2.2, -2.2].forEach(a => { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.06, r, 0.05), M.gray); sp.position.set(Math.sin(a) * r / 2, -Math.cos(a) * r / 2, 0); sp.rotation.z = a; spin.add(sp); });
        spin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 10).rotateX(Math.PI / 2), M.paintD));
        const grips = [1, -1].map(s => { const g = new THREE.Object3D(); const a = s * 1.42; g.position.set(Math.sin(a) * r, Math.cos(a) * r, -0.06); spin.add(g); return g; });
        if (base) this.rod(base, V(pos.x, pos.y, pos.z).addScaledVector(V(0, -Math.sin(tilt), Math.cos(tilt)).negate(), -0.02), 0.05, M.dark);
        this.steer = { spin, axis: 'z', k: -1.1 }; return grips;
      },
      // guidão (motoca): gira em torno do eixo do garfo
      handlebar(group, y, half) {
        const spin = group; spin.userData.dynamic = true;
        this.rod(V(-half, y, 0), V(half, y, 0), 0.05, M.chrome, spin);
        [-1, 1].forEach(s => this.add(new THREE.CylinderGeometry(0.075, 0.075, 0.32, 12).rotateZ(Math.PI / 2), M.black, s * (half + 0.12), y, 0, spin));
        const grips = [1, -1].map(s => { const g = new THREE.Object3D(); g.position.set(s * (half + 0.1), y, 0.02); spin.add(g); return g; });
        this.steer = { spin, axis: 'y', k: 0.45 }; return grips;
      },
      pedals(pts) { return pts.map(p => { this.box(0.22, 0.06, 0.34, 0.02, M.gray, p.x, p.y - 0.06, p.z); const o = new THREE.Object3D(); o.position.copy(p); body.add(o); return o; }); },
      // escapamento com chama do turbo na ponta
      exhaust(a, b, rA, rB, m) {
        const d = new THREE.Vector3().subVectors(b, a).normalize();
        this.cone(a, b, rA, rB, m || M.chrome); this.add(new THREE.SphereGeometry(rA, 8, 6), m || M.chrome, a.x, a.y, a.z);
        const lip = this.add(new THREE.TorusGeometry(rB * 0.92, rB * 0.16, 6, 16), M.black, b.x, b.y, b.z); lip.quaternion.setFromUnitVectors(V(0, 0, 1), d);
        const f = new THREE.Mesh(new THREE.ConeGeometry(rB * 0.8, 1.8, 16), new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        f.position.copy(b).addScaledVector(d, 0.9); f.quaternion.setFromUnitVectors(V(0, 1, 0), d); f.visible = false; f.userData.dynamic = true; body.add(f); this.flames.push(f);
      },
      headlight(x, y, z, r, round) {
        const hs = this.add(new THREE.SphereGeometry(r * 1.25, 14, 10), M.chrome, x, y, z); hs.scale.set(1, 1, 0.8);
        const lensM = new THREE.MeshBasicMaterial({ color: 0xd8d2b0 }); lensM.userData.unique = true;
        const lens = this.add(new THREE.SphereGeometry(r, 14, 10), lensM, x, y, z + r * 0.55); lens.scale.z = 0.55; lens.userData.dynamic = true;
        this.lensPos.push({ lens, x, y, z: z + r * 1.1 });
      },
      // para-lama sólido: setor de anel (plano z,y) extrudado na largura -> espesso, sem face única "cortada"
      arch(rIn, rOut, a0, a1, depth) { const sh = new THREE.Shape(), n = 18;
        for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; i ? sh.lineTo(Math.cos(t) * rOut, Math.sin(t) * rOut) : sh.moveTo(Math.cos(t) * rOut, Math.sin(t) * rOut); }
        for (let i = n; i >= 0; i--) { const t = a0 + (a1 - a0) * i / n; sh.lineTo(Math.cos(t) * rIn, Math.sin(t) * rIn); }
        const g = new THREE.ExtrudeGeometry(sh, { depth: depth - 0.2, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.07, bevelSegments: 2, curveSegments: 4 });
        g.translate(0, 0, -(depth - 0.2) / 2); g.rotateY(-Math.PI / 2); return g; },
      neonBar(w, h, d, x, y, z) { const o = this.add(new THREE.BoxGeometry(w, h, d), M.neon, x, y, z); this.neons.push(o); return o; }
    };
    return k;
  }

  // =====================================================================================
  // MODELOS
  // =====================================================================================
  const MODELS = [];

  // ---------- 1. Kartec GT (o kart original, revisado) ----------
  MODELS.push({ id: 'gt', name: 'Kartec GT', desc: 'O original, revisado: equilibrado e fácil de pilotar.',
    build(k) {
      const { M } = k;
      k.box(1.3, 0.22, 6.3, 0.1, M.dark, 0, 0.5, -0.05);                                            // chassi
      // laterais (sidepods) na cor do kart com saia branca — encurtados para a roda dianteira esterçar sem tocar
      [-1, 1].forEach(s => { k.box(1.34, 0.62, 1.7, 0.28, M.paint, s * 1.28, 0.6, -0.02); k.box(1.38, 0.18, 1.74, 0.08, M.white, s * 1.28, 0.36, -0.02); });
      { const path = [V(-1.82, 0, 2.55), V(-1.76, 0, 3.3), V(-1.2, 0, 3.72), V(0, 0, 3.84), V(1.2, 0, 3.72), V(1.76, 0, 3.3), V(1.82, 0, 2.55)];
        const wt = k.tube(path, 0.24, M.white); wt.position.y = 0.55; wt.scale.y = 0.8;
        const rt = k.tube(path, 0.25, M.paint); rt.position.y = 0.53; rt.scale.y = 0.28;
        [-1, 1].forEach(s => { const e = k.add(new THREE.SphereGeometry(0.24, 10, 6), M.white, s * 1.82, 0.55, 2.55); e.scale.y = 0.8; }); }
      { // capô: caixa boleada deformada em trapézio
        const g = rbox(1.9, 1, 2, 0.22, 3), p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = (z + 1) / 2, top = 1.62 + (0.8 - 1.62) * t; p.setXYZ(i, x * (0.63 + 0.37 * t), 0.6 + (y + 0.5) * (top - 0.6), 1.12 + (z + 1)); }
        k.add(smoothSeams(g), M.paint); }
      [-1, 1].forEach(s => k.rod(V(s * 0.93, 0.82, 3.08), V(s * 0.62, 1.62, 1.14), 0.07, M.white));
      k.rod(V(-0.62, 1.62, 1.14), V(0.62, 1.62, 1.14), 0.07, M.white);
      // banco concha + almofada
      k.box(1.25, 1.25, 0.22, 0.1, M.seat, 0, 1.15, -1.15).rotation.x = -0.18;
      k.box(1.25, 0.2, 1.0, 0.08, M.seat, 0, 0.66, -0.6);
      [-1, 1].forEach(s => k.box(0.2, 0.7, 0.9, 0.08, M.seat, s * 0.62, 0.92, -0.75));
      k.box(1.0, 0.8, 1.1, 0.22, M.gray, 0, 1.0, -2.05); k.box(0.9, 0.16, 1.0, 0.07, M.white, 0, 1.47, -2.05);   // motor
      [-1, 1].forEach(s => k.exhaust(V(s * 0.4, 1.05, -2.45), V(s * 0.95, 1.55, -3.5), 0.14, 0.42, M.white));
      k.rod(V(-1.7, 0.9, -1.95), V(1.7, 0.9, -1.95), 0.08, M.dark); k.rod(V(-1.45, 0.72, 1.79), V(1.45, 0.72, 1.79), 0.08, M.dark);   // eixos
      [-1, 1].forEach(s => { k.rod(V(s * 1.22, 0.62, 3.34), V(s * 1.22, 0.86, 3.38), 0.05, M.gray); k.headlight(s * 1.22, 1.02, 3.42, 0.22); });
      [-1, 1].forEach(s => { k.wheel(s * 1.45, 0.72, 1.79, 0.72, 0.8, { steer: true }); k.wheel(s * 1.65, 0.9, -1.95, 0.9, 0.95); });
      const hands = k.steering(V(0, 1.26, 0.02), 0.95, 0.34, V(0, 0.75, 1.1));
      const feet = k.pedals([V(0.22, 0.72, 0.62), V(-0.22, 0.72, 0.62)]);
      return { cockpit: { seat: V(0, 0.9, -0.62), scale: 1.55, recline: -0.12, hands, feet },
        decal: { side: [-1.2, 3.9, 0.25, 1.75], top: [-0.95, 0.95, 1.1, 3.2], numSide: [-0.02, 0.62, 0.62], numTop: [0, 2.35, -0.7] },
        rear: { x: 1.65, z: -1.95 }, shadow: [1.9, 3.4], lean: -0.12 };
    } });

  // ---------- 2. Moto futurista: carenagem inteira e baixa (bico, miolo e rabeta separados das rodas),
  //            rodas normais, filetes neon na cor do adesivo, bolha de para-brisa,
  //            duas turbinas laterais e luz por baixo. O piloto vai deitado sobre o tanque ----------
  MODELS.push({ id: 'moto', name: 'Motoca', desc: 'Moto futurista: carenagem lisa e filetes neon.',
    build(k) {
      const { M } = k;
      // miolo (tanque + motor) entre as rodas
      k.profile([[1.05, 0.95], [1.12, 1.55], [0.7, 2.02], [-0.25, 1.86], [-0.95, 1.62], [-1.0, 0.82], [-0.2, 0.62], [0.6, 0.68]], 0.95, 0.24, M.paint);
      // bico: passa POR CIMA da roda dianteira (que vira livre embaixo dele)
      k.profile([[0.7, 1.55], [0.75, 2.22], [1.5, 2.5], [2.55, 2.2], [2.95, 1.98], [2.4, 1.98], [1.4, 2.02], [1.0, 1.7]], 0.86, 0.2, M.paint);
      { const g = new THREE.SphereGeometry(0.62, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2); const w = k.add(g, M.glass, 0, 2.3, 1.25); w.scale.set(0.6, 0.55, 1.1); w.rotation.x = -0.32; }
      // rabeta alta sobre a roda traseira
      k.profile([[-0.85, 1.62], [-0.95, 2.18], [-2.0, 2.42], [-3.15, 2.4], [-3.32, 2.18], [-2.2, 2.08], [-1.2, 1.7]], 0.9, 0.2, M.paint);
      { const tl = new THREE.MeshBasicMaterial({ color: 0xff3a5a }); tl.userData.unique = true; k.add(new THREE.BoxGeometry(0.6, 0.1, 0.05), tl, 0, 2.3, -3.37); }
      // filetes neon (cor do adesivo) nas laterais do bico, miolo e rabeta
      [-1, 1].forEach(s => { k.neonBar(0.04, 0.05, 1.5, s * 0.45, 2.07, 1.9); k.neonBar(0.04, 0.05, 1.3, s * 0.49, 1.15, 0.05); k.neonBar(0.04, 0.05, 1.7, s * 0.47, 2.15, -2.25); });
      k.headlight(0, 2.1, 2.92, 0.14);
      // braço oscilante traseiro + garfo dianteiro (cromados)
      [-1, 1].forEach(s => { k.rod(V(s * 0.38, 1.1, -0.85), V(s * 0.38, 1.0, -1.95), 0.08, M.dark); k.rod(V(s * 0.3, 2.05, 1.6), V(s * 0.3, 0.95, 2.0), 0.07, M.chrome); });
      // duas turbinas laterais (escape com chama do turbo)
      [-1, 1].forEach(s => { k.exhaust(V(s * 0.55, 1.25, -0.45), V(s * 0.62, 1.42, -2.75), 0.16, 0.2, M.dark); k.add(new THREE.TorusGeometry(0.19, 0.035, 6, 18), M.neon, s * 0.62, 1.42, -2.72); });
      // banco baixo sobre o miolo, pedaleiras
      k.box(0.7, 0.18, 1.0, 0.08, M.seat, 0, 1.94, -0.62);
      const feet = [1, -1].map(s => { k.rod(V(s * 0.45, 1.1, -0.35), V(s * 0.72, 1.1, -0.35), 0.06, M.chrome); const o = new THREE.Object3D(); o.position.set(s * 0.6, 1.14, -0.25); k.body.add(o); return o; });
      // garfo que esterça (para-lama curto) + guidão baixo
      const fork = new THREE.Group(); fork.position.set(0, 0, 2.0); k.pivot.add(fork);
      { const fe = k.add(new THREE.TorusGeometry(1.06, 0.1, 8, 22, Math.PI * 0.55), M.paintD, 0, 0.95, 0, fork); fe.rotation.set(0, Math.PI / 2, Math.PI * 0.28); fe.scale.set(1, 1, 2.4); }
      const steerG = new THREE.Group(); steerG.position.set(0, 0, 0.42); k.body.add(steerG);
      const hands = k.handlebar(steerG, 2.28, 0.32);
      // luz por baixo
      { const ug = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 5.4), new THREE.MeshBasicMaterial({ map: Fx.softTex(), color: k.spec.decalColor, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
        ug.rotation.x = -Math.PI / 2; ug.position.y = 0.06; ug.userData.dynamic = true; k.pivot.add(ug); k.neons.push(ug); }
      const fwP = k.wheel(0.001, 0.95, 2.0, 0.95, 0.72, { steer: true }); fwP.position.x = 0;
      const rwP = k.wheel(0.001, 1.0, -1.95, 1.0, 0.86); rwP.position.x = 0;
      k.steer.fork = fork;
      return { cockpit: { seat: V(0, 2.03, -0.62), scale: 1.55, recline: -0.02, hands, feet },
        decal: { side: [-3.35, 2.95, 0.62, 2.5], top: [-0.48, 0.48, -3.3, 2.95], numSide: [-2.45, 2.22, 0.36], numTop: [0, -2.2, 0.42] },
        rear: { x: 0.45, z: -1.95 }, shadow: [1.2, 3.6], lean: 0.42, moto: true };
    } });

  const byId = id => MODELS.find(m => m.id === id) || MODELS[0];

  // =====================================================================================
  // montagem completa
  // =====================================================================================
  function buildKartModel(spec, opts) {
    opts = opts || {};
    // number: 0 e accessory: 'none' são forçados: números na lataria e acessórios do piloto foram removidos
    // (vale também para specs antigos que chegam pela rede ou ficaram salvos no navegador)
    spec = Object.assign({}, CFG.DEFAULT_SPEC, typeof spec === 'string' ? { color: spec } : spec, { number: 0, accessory: 'none' });
    const def = byId(spec.model);
    // 1ª passada só para obter as caixas de adesivo do modelo (são constantes por modelo: guardadas em cache)
    if (!def._decalBox) { const tmp = makeKit(spec, Livery.build(spec, { side: [0, 1, 0, 1], top: [0, 1, 0, 1] })); def._decalBox = def.build(tmp).decal; disposeTree(tmp.group); }
    const decal = Livery.build(spec, def._decalBox);
    const k = makeKit(spec, decal), info = def.build(k), { group, pivot, body } = k;
    { const du = k.M.paint.userData.decalUniforms; if (du) { if (du.uNumSide) du.uNumSide.value.w = 0; if (du.uNumTop) du.uNumTop.value.w = 0; } }   // nunca desenha número
    // sombra-bolha, farol (só o jogador leva luz de verdade), brilhos dos faróis
    const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.16, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.scale.set(info.shadow[0], info.shadow[1], 1); blob.position.y = 0.03; group.add(blob);
    let headL = null;
    const front = k.lensPos.length ? k.lensPos[0].z + 0.3 : 3.7, lightY = k.lensPos.length ? k.lensPos[0].y : 1.0;
    if (opts.lights) { // alcance curto + decaimento forte: sem clarão nas paredes do túnel
      headL = new THREE.SpotLight(0xfff0c8, 0, 48, 0.5, 0.65, 2); headL.position.set(0, lightY + 0.1, front); group.add(headL);
      const t = new THREE.Object3D(); t.position.set(0, 0, 22); group.add(t); headL.target = t; }
    const headGlows = k.lensPos.map(l => { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: 0xfff2c0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); p.position.set(l.x, l.y, l.z + 0.2); p.scale.setScalar(1.6); group.add(p); return p; });
    group.scale.setScalar(0.8);
    group.traverse(o => { if (o.isMesh && !o.material.isMeshBasicMaterial) { o.castShadow = true; o.receiveShadow = false; } });
    // troca as peças de cor fixa pelo material único com cor por vértice
    group.traverse(o => {
      if (!o.isMesh || !k.M.solidSet.has(o.material)) return;
      const col = k.M.solidSet.get(o.material), n = o.geometry.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
      if (o.geometry.attributes.color) o.geometry = o.geometry.clone();
      o.geometry.setAttribute('color', new THREE.BufferAttribute(a, 3)); o.material = k.M.solid;
    });
    // agrupa as peças paradas (dezenas de malhas viram poucas chamadas de desenho)
    mergeByMaterial(body, { skip: o => o.material.isMeshBasicMaterial && o.material.transparent });
    k.rolls.forEach(r => mergeByMaterial(r.g));
    // contorno de desenho animado (casco invertido) na carroceria, rodas e volante
    // depois os contornos (todos com o mesmo material) são fundidos numa única malha por grupo: +1 chamada de desenho, não +15
    if (opts.outline !== false) {
      Toon.outline(body, 0.05); mergeByMaterial(body, { skip: o => !o.userData.outline });
      k.rolls.forEach(r => { Toon.outline(r.g, 0.04, null, 0x0c0c0e); mergeByMaterial(r.g, { skip: o => !o.userData.outline }); });
    group.traverse(o => { if (o.isMesh || o.isSprite) o.frustumCulled = false; });   // kart inteiro sempre desenhado (são poucos objetos; evita sumir na borda da tela)
    }
    // volante/guidão gira inteiro: agrupa as peças dele dentro do próprio grupo giratório
    if (k.steer) mergeByMaterial(k.steer.spin);
    // piloto
    let pilot = null;
    if (opts.pilot !== false && window.Pilot) { pilot = Pilot.create(spec); pilot.attach(body, info.cockpit); pilot.update(0, {}); }

    const m = {
      group, pivot, body, blob, headL, headGlows, spec, pilot, def,
      fw: k.fw, rolls: k.rolls, flames: k.flames, headLens: k.lensPos.map(l => l.lens), neons: k.neons,
      rear: info.rear, lean: info.lean, moto: !!info.moto, steerRig: k.steer, mats: k.M, paint: k.M.paint,
      // ---- personalização em tempo real (sem reconstruir a malha) ----
      setColor(hex) { const c = new THREE.Color(hex); k.M.paint.color.copy(c); k.M.hub.color.copy(c); k.M.paintL.color.copy(c.clone().lerp(new THREE.Color(0xffffff), 0.2)); k.M.paintD.color.copy(c.clone().multiplyScalar(0.72)); spec.color = hex; },
      setDecalColor(hex) { k.M.paint.userData.decalUniforms.uDecalColor.value.set(hex); k.M.neon.color.set(hex); k.neons.forEach(n => n.material.color && n.material.color.set(hex)); spec.decalColor = hex; },
      setDecal(id) { spec.decal = id; spec.number = 0; const d = Livery.build(spec, def._decalBox), u = k.M.paint.userData.decalUniforms;
        u.uDecal.value = d.texture; u.uDecalOn.value = d.on ? 1 : 0; u.uNumSide.value.w = 0; u.uNumTop.value.w = 0; },
      setPilot(s) { Object.assign(spec, s, { accessory: 'none' }); if (pilot) pilot.setColors(spec); },
      // anima volante, rodas dianteiras visuais e piloto. st = { steer, speed(0..1), boost, drift, air }
      animate(dt, st) {
        const sr = k.steer; if (sr) { const a = (st.steer || 0) * sr.k; if (sr.axis === 'z') sr.spin.rotation.z = a; else { sr.spin.rotation.y = a; if (sr.fork) sr.fork.rotation.y = a; } }
        if (pilot) pilot.update(dt, st);
      },
      setNight(nf) { KartMats.setEnvLevel(group, 1 - 0.75 * nf); },
      dispose() { if (pilot) pilot.dispose(); disposeTree(group); }
    };
    return m;
  }
  function disposeTree(root) { root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }

  window.KartModels = { list: () => MODELS, get: byId, register(m) { MODELS.push(m); } };
  window.buildKartModel = buildKartModel;
})();
