// =====================================================================================
// models/karts.js — modelos de kart (registro expansível) + montagem completa
//
// buildKartModel(spec, opts) monta: carroceria do modelo escolhido + pintura (com adesivos) + rodas
// + volante/guidão animado + piloto sentado. spec = {
//   model: 'gt' | 'classic' | 'muscle' (dragster) | 'cyber' | 'offroad' (4x4 de brinquedo) | 'moto' (futurista),
//   color (corBase), decal (estampa), decalColor (corDecalque), number,
//   suit, helmet, skin, accessory          <- piloto
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
      dark: KartMats.std(0x34373f, 0.45, 0.4), chrome: KartMats.chrome(), rubber: KartMats.rubber(false), knob: KartMats.rubber(true),
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
      // roda completa: pneu + aro + calota + parafusos. style: std | spoke | whitewall | deep | cyber | knobby
      wheel(x, y, z, r, w, o) {
        o = o || {}; const p = new THREE.Group(); p.position.set(x, y, z); pivot.add(p); const roll = new THREE.Group(); p.add(roll); const s = Math.sign(x) || 1, st = o.style || 'std';
        const rimR = st === 'cyber' ? 0.78 : st === 'whitewall' ? 0.55 : st === 'deep' ? 0.68 : 0.6;
        roll.add(new THREE.Mesh(tireGeo(r, w, rimR), st === 'knobby' ? M.knob : M.rubber));
        const face = s * w * 0.43;
        if (st === 'whitewall') { const ww = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.07, 5, 20), M.white); ww.geometry.rotateY(Math.PI / 2); ww.position.x = s * w * 0.47; roll.add(ww); }
        if (st === 'knobby') { const lugG = rbox(w * 0.42, r * 0.17, r * 0.22, 0.07, 1); for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; [-1, 1].forEach(q => { const l = new THREE.Mesh(lugG, M.knob); const rr = r * 0.97; l.position.set(q * w * 0.22 * (i % 2 ? 1 : 0.6), Math.cos(a + q * 0.08) * rr, Math.sin(a + q * 0.08) * rr); l.rotation.x = -a; roll.add(l); }); } }
        const wg = new THREE.CylinderGeometry(r * rimR, r * rimR, w * 0.86, 18); wg.rotateZ(Math.PI / 2);
        roll.add(new THREE.Mesh(wg, st === 'cyber' ? M.black : st === 'spoke' ? M.chrome : M.dark));
        const lip = new THREE.TorusGeometry(r * rimR * 0.93, r * 0.05, 6, 20); lip.rotateY(Math.PI / 2);
        const ring = new THREE.Mesh(lip, st === 'cyber' ? M.neon : M.chrome); ring.position.x = face; roll.add(ring);
        if (st === 'cyber') { this.neons.push(ring); const in2 = new THREE.Mesh(new THREE.TorusGeometry(r * 0.35, r * 0.04, 5, 16), M.neon); in2.geometry.rotateY(Math.PI / 2); in2.position.x = face; roll.add(in2); }
        else if (st === 'mag') {   // liga leve clássica: fundo escuro, 5 raios largos prateados, aro e miolo cromados, faixa vermelha no flanco
          const R = r * rimR, dk = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.95, R * 0.95, 0.05, 24).rotateZ(Math.PI / 2), M.dark); dk.position.x = face; roll.add(dk);
          for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2, sp = new THREE.Mesh(GEO.rbox(0.09, R * 0.82, R * 0.3, 0.04, 1), M.gray); sp.geometry.translate(0, R * 0.41, 0); sp.rotation.x = a; sp.position.x = face + s * 0.03; roll.add(sp); }
          const cap = new THREE.Mesh(new THREE.SphereGeometry(R * 0.26, 14, 8), M.chrome); cap.scale.x = 0.5; cap.position.x = face + s * 0.05; roll.add(cap);
          const red = new THREE.MeshBasicMaterial({ color: 0xd8262a }); red.userData.unique = true;
          const rl = new THREE.Mesh(new THREE.TorusGeometry(r * 0.8, r * 0.025, 5, 32).rotateY(Math.PI / 2), red); rl.position.x = s * w * 0.5; roll.add(rl); }
        else if (st === 'spoke') { for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, sp = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, r * rimR * 1.8, 5), M.chrome); sp.rotation.x = a; sp.position.x = face * 0.6; roll.add(sp); } const hb = new THREE.Mesh(new THREE.SphereGeometry(r * 0.16, 14, 10), M.chrome); hb.scale.x = 0.7; hb.position.x = face; roll.add(hb); }
        else {
          const hub = new THREE.Mesh(new THREE.SphereGeometry(r * rimR * (st === 'deep' ? 0.62 : 0.8), 14, 8), M.hub); hub.scale.x = 0.45; hub.position.x = face; roll.add(hub);   // calota em domo (brinquedo)
          for (let i = 0; i < 5; i++) { const t = i / 5 * Math.PI * 2, q = r * 0.24; const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), M.chrome); b.position.set(face + s * r * 0.1, Math.sin(t) * q, Math.cos(t) * q); roll.add(b); }
        }
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

  // ---------- 2. Classic / Retro: tubos aparentes, carenagem de nariz, rodas raiadas com faixa branca ----------
  MODELS.push({ id: 'classic', name: 'Clássico', desc: 'Retrô dos anos 60: tubos cromados aparentes e rodas raiadas.',
    build(k) {
      const { M } = k;
      // quadro tubular (perímetro + travessas)
      const fr = [V(-0.75, 0.5, -2.6), V(-0.95, 0.5, -1.2), V(-0.8, 0.5, 1.4), V(-0.45, 0.5, 2.9), V(0.45, 0.5, 2.9), V(0.8, 0.5, 1.4), V(0.95, 0.5, -1.2), V(0.75, 0.5, -2.6)];
      k.tube(fr, 0.09, M.chrome, true);
      [-1.9, -0.2, 1.4].forEach(z => k.rod(V(-0.85, 0.5, z), V(0.85, 0.5, z), 0.07, M.chrome));
      k.box(1.5, 0.08, 3.6, 0.04, M.dark, 0, 0.47, 0.2);                                          // assoalho
      // para-choques tubulares laterais e traseiro
      [-1, 1].forEach(s => { k.tube([V(s * 0.9, 0.55, -1.0), V(s * 1.75, 0.62, -0.7), V(s * 1.85, 0.62, 0.4), V(s * 1.6, 0.6, 1.0), V(s * 0.85, 0.55, 1.2)], 0.075, M.chrome); });
      k.tube([V(-1.5, 0.75, -2.85), V(-0.8, 0.8, -3.35), V(0.8, 0.8, -3.35), V(1.5, 0.75, -2.85)], 0.08, M.chrome);
      // carenagem de nariz arredondada (torneada) + farol único
      { const pr = [[0, 0], [0.55, 0.05], [0.72, 0.4], [0.7, 0.9], [0.6, 1.3], [0.4, 1.62], [0.15, 1.8], [0, 1.82]].map(p => new THREE.Vector2(p[0], p[1]));
        const g = new THREE.LatheGeometry(pr, 22); g.rotateX(Math.PI / 2); g.scale(1.35, 0.72, 1); const n = k.add(g, M.paint, 0, 0.95, 1.6); n.userData.nose = true;
        k.headlight(0, 0.98, 3.4, 0.24); }
      k.box(1.7, 0.1, 0.5, 0.05, M.chrome, 0, 0.62, 3.0);
      // banco concha de fibra com encosto alto e carenagem traseira em "rabo de pato"
      k.box(1.15, 1.3, 0.2, 0.1, M.paintL, 0, 1.2, -1.2).rotation.x = -0.2;
      k.box(1.15, 0.22, 1.0, 0.08, M.seat, 0, 0.66, -0.65);
      { const g = rbox(1.5, 0.75, 1.7, 0.35, 3), p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { const z = p.getZ(i), t = (z + 0.85) / 1.7; p.setY(i, p.getY(i) * (0.55 + 0.45 * t)); p.setX(i, p.getX(i) * (0.8 + 0.2 * t)); }
        k.add(smoothSeams(g), M.paint, 0, 1.15, -2.25); }
      // motor aparente ao lado + escapamento vertical cromado
      k.box(0.7, 0.7, 0.8, 0.15, M.gray, -0.75, 0.95, -1.75);
      for (let i = 0; i < 5; i++) k.box(0.78, 0.04, 0.82, 0.02, M.chrome, -0.75, 0.75 + i * 0.1, -1.75);
      k.exhaust(V(-0.75, 1.3, -1.8), V(-0.85, 2.1, -2.6), 0.1, 0.22);
      k.rod(V(-1.65, 0.9, -1.95), V(1.65, 0.9, -1.95), 0.07, M.chrome); k.rod(V(-1.4, 0.7, 1.95), V(1.4, 0.7, 1.95), 0.07, M.chrome);
      [-1, 1].forEach(s => { k.wheel(s * 1.42, 0.7, 1.95, 0.7, 0.55, { steer: true, style: 'whitewall' }); k.wheel(s * 1.6, 0.9, -1.95, 0.9, 0.7, { style: 'whitewall' }); });
      const hands = k.steering(V(0, 1.27, -0.02), 1.0, 0.36, V(0, 0.6, 1.0));
      const feet = k.pedals([V(0.22, 0.6, 0.62), V(-0.22, 0.6, 0.62)]);
      return { cockpit: { seat: V(0, 0.9, -0.66), scale: 1.55, recline: -0.12, hands, feet },
        decal: { side: [-3.2, 3.5, 0.3, 1.8], top: [-1.0, 1.0, 0.0, 3.5], numSide: [2.15, 0.98, 0.62], numTop: [0, 1.75, -0.75] },
        rear: { x: 1.6, z: -1.95 }, shadow: [1.9, 3.5], lean: -0.14 };
    } });

  // ---------- 3. Muscle: carroceria em blocos arredondados com "rake" (nariz mais baixo, a carroceria gira em
  //            torno do eixo traseiro), cabine aberta com para-brisa escuro, grade cromada com 4 faróis redondos,
  //            compressor sobre o capô (polias + correia), escapamentos laterais curvos com chama, rodas de liga
  //            leve com faixa vermelha (dianteiras pequenas, traseiras de arrancada) e para-lamas traseiros sólidos ----------
  MODELS.push({ id: 'muscle', name: 'Muscle', desc: 'Muscle de arrancada: compressor no capô, escapes laterais e traseira larga.',
    build(k) {
      const { M } = k, RAKE = 0.05, RZ = -2.15;
      // grupo inclinado: gira em torno do eixo traseiro (as rodas continuam retas no chão)
      const R = new THREE.Group(); R.position.set(0, 0, RZ); R.rotation.x = RAKE; k.body.add(R); R.updateMatrixWorld(true);
      const at = (x, y, z) => R.localToWorld(V(x, y, z - RZ));                                       // ponto da carroceria -> espaço do kart
      const bx = (w, h, d, r, m, x, y, z) => k.box(w, h, d, r, m, x, y, z - RZ, R);
      const ad = (g, m, x, y, z) => k.add(g, m, x, y, z - RZ, R);
      // chassi e saias
      bx(2.7, 0.8, 7.1, 0.3, M.paint, 0, 1.02, 0.35);
      bx(2.5, 0.24, 6.2, 0.1, M.dark, 0, 0.6, 0.3);
      // capô (levemente mais alto no meio) e para-lamas dianteiros arredondados
      bx(1.5, 0.16, 2.6, 0.08, M.paint, 0, 1.46, 2.45);
      [-1, 1].forEach(s => { bx(0.62, 0.36, 2.4, 0.18, M.paint, s * 1.05, 1.42, 2.55); });
      // cabine aberta: laterais, painel, tampa traseira alta e para-brisa escuro inclinado
      [-1, 1].forEach(s => bx(0.3, 0.55, 2.5, 0.14, M.paint, s * 1.18, 1.62, -0.75));
      bx(2.6, 0.38, 0.6, 0.15, M.paint, 0, 1.62, 0.65);
      bx(2.6, 0.56, 1.7, 0.2, M.paint, 0, 1.66, -2.5);
      { const ws = bx(2.3, 0.72, 0.06, 0.04, M.glass, 0, 2.08, 0.7); ws.rotation.x = -0.62;
        const fr = bx(2.4, 0.09, 0.12, 0.04, M.chrome, 0, 2.38, 0.5); fr.rotation.x = -0.62;
        [-1, 1].forEach(s => { const p = bx(0.08, 0.8, 0.1, 0.03, M.chrome, s * 1.17, 2.06, 0.7); p.rotation.x = -0.62; }); }
      bx(2.3, 0.12, 0.45, 0.05, M.paintD, 0, 2.0, -3.2);                                              // aerofólio baixo na tampa
      [-1, 1].forEach(s => bx(0.1, 0.16, 0.4, 0.04, M.paintD, s * 1.0, 1.92, -3.2));
      // frente: base preta da grade, 4 frisos cromados, 4 faróis redondos e para-choque cromado
      bx(2.3, 0.56, 0.2, 0.1, M.black, 0, 0.98, 3.9);
      for (let i = 0; i < 4; i++) bx(2.2, 0.05, 0.08, 0.02, M.chrome, 0, 0.8 + i * 0.12, 4.0);
      [-1, 1].forEach(s => [0.72, 1.02].forEach(x => { const p = at(s * x, 1.04, 3.98); k.headlight(p.x, p.y, p.z, 0.12); }));
      { const pts = [V(-1.32, 0.62, 3.75), V(-1.12, 0.6, 4.16), V(1.12, 0.6, 4.16), V(1.32, 0.62, 3.75)].map(p => at(p.x, p.y, p.z)); k.tube(pts, 0.1, M.chrome); }
      // compressor: bloco do motor, caixa cromada, "chapéu" com uma boca larga, polias e correia na frente
      bx(1.1, 0.5, 1.3, 0.1, M.black, 0, 1.62, 2.2);
      bx(1.2, 0.5, 1.4, 0.12, M.gray, 0, 2.06, 2.2);
      for (let i = 0; i < 4; i++) bx(1.26, 0.035, 0.06, 0.015, M.dark, 0, 1.9 + i * 0.1, 2.92);
      { const hat = ad(new THREE.CylinderGeometry(0.62, 0.62, 1.3, 26, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), M.dark, 0, 2.3, 2.15); hat.scale.set(1, 0.85, 0.75);
        bx(1.12, 0.32, 0.12, 0.05, M.black, 0, 2.52, 2.62); }                                         // boca de admissão (preta) na frente do chapéu
      [[2.0, 3.0], [1.62, 3.0]].forEach(([y, z]) => ad(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 18).rotateX(Math.PI / 2), M.chrome, 0, y, z));
      bx(0.34, 0.6, 0.08, 0.05, M.black, 0, 1.81, 3.05);
      // escapamentos laterais: coletor saindo do capô, curva para baixo e tubo reto até a ponta (com chama do turbo)
      [-1, 1].forEach(s => { const c = [V(s * 1.2, 1.25, 2.1), V(s * 1.52, 0.9, 1.75), V(s * 1.6, 0.62, 1.2), V(s * 1.6, 0.6, 0.6)].map(p => at(p.x, p.y, p.z));
        k.tube(c, 0.11, M.chrome); const a = at(s * 1.6, 0.6, 0.6), b2 = at(s * 1.72, 0.6, -0.6); k.exhaust(a, b2, 0.11, 0.15); });
      // para-lamas traseiros sólidos sobre as rodas largas
      [-1, 1].forEach(s => k.add(k.arch(1.38, 1.62, Math.PI * 0.1, Math.PI * 0.9, 1.5), M.paint, s * 1.95, 1.28, -2.15));
      // traseira: lanternas em barra, para-choque cromado
      [-1, 1].forEach(s => { const tl = new THREE.MeshBasicMaterial({ color: 0xff3a3a }); tl.userData.unique = true; const p = at(s * 0.7, 1.55, -3.37); const m = k.add(new THREE.BoxGeometry(0.8, 0.14, 0.06), tl, p.x, p.y, p.z); m.rotation.x = RAKE; });
      { const pts = [V(-1.3, 0.72, -3.0), V(-1.1, 0.72, -3.42), V(1.1, 0.72, -3.42), V(1.3, 0.72, -3.0)].map(p => at(p.x, p.y, p.z)); k.tube(pts, 0.09, M.chrome); }
      // banco e cockpit (posições levadas pelo rake)
      { const sb = bx(1.4, 1.2, 0.26, 0.13, M.seat, 0, 1.75, -1.6); sb.rotation.x = -0.18; bx(1.4, 0.24, 1.0, 0.1, M.seat, 0, 1.28, -1.05); }
      // eixos e rodas: dianteiras pequenas, traseiras de arrancada (liga leve com faixa vermelha)
      k.rod(V(-1.9, 1.28, -2.15), V(1.9, 1.28, -2.15), 0.12, M.dark); k.rod(V(-1.45, 0.66, 2.6), V(1.45, 0.66, 2.6), 0.08, M.dark);
      [-1, 1].forEach(s => { k.wheel(s * 1.55, 0.66, 2.6, 0.66, 0.62, { steer: true, style: 'mag' }); k.wheel(s * 1.95, 1.28, -2.15, 1.28, 1.35, { style: 'mag' }); });
      const sw = at(0, 1.92, 0.0), sb = at(0, 1.45, 0.5);
      const hands = k.steering(sw, 0.95 + RAKE, 0.34, sb);
      const feet = k.pedals([at(0.22, 1.3, 0.45), at(-0.22, 1.3, 0.45)]);
      return { cockpit: { seat: at(0, 1.5, -0.95), scale: 1.55, recline: -0.12, hands, feet },
        decal: { side: [-3.3, 4.0, 0.55, 1.95], top: [-1.35, 1.35, -3.3, 4.0], numSide: [-0.75, 1.32, 0.56], numTop: [0, 3.42, -0.66] },
        rear: { x: 1.95, z: -2.15 }, shadow: [2.6, 4.0], lean: -0.08 };
    } });

  // ---------- 4. Futuristic / Cyber: linhas fluidas, LEDs neon no chassi, rodas de aro luminoso ----------
  MODELS.push({ id: 'cyber', name: 'Cyber', desc: 'Aerodinâmico, com LEDs neon na cor do adesivo.',
    build(k) {
      const { M } = k;
      // casco central torneado (gota alongada)
      { const pr = [[0, -3.5], [0.35, -3.3], [0.75, -2.6], [0.95, -1.4], [1.0, 0.0], [0.88, 1.4], [0.6, 2.7], [0.25, 3.7], [0, 3.95]].map(p => new THREE.Vector2(p[0], p[1]));
        const g = new THREE.LatheGeometry(pr, 26); g.rotateX(Math.PI / 2); g.rotateX(Math.PI); g.scale(1.25, 0.55, 1);
        const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0) p.setY(i, y * 0.35); }
        g.computeVertexNormals(); k.add(g, M.paint, 0, 0.82, 0); }
      // asas laterais (pontões) que envolvem as rodas
      [-1, 1].forEach(s => { k.profile([[1.4, 0.5], [1.1, 0.95], [-0.9, 1.0], [-1.4, 0.55], [-0.8, 0.4], [0.9, 0.4]], 0.7, 0.12, M.paint, s * 1.45);
        k.neonBar(0.06, 0.06, 2.2, s * 1.82, 0.62, 0.05); k.neonBar(0.06, 0.05, 1.6, s * 1.1, 1.0, 1.9); });
      // nariz com lâmina e faróis em fenda
      k.box(2.0, 0.08, 0.6, 0.04, M.dark, 0, 0.56, 3.2);
      [-1, 1].forEach(s => { k.headlight(s * 0.42, 0.88, 3.25, 0.1); k.neonBar(0.5, 0.04, 0.05, s * 0.42, 0.98, 3.25); });
      // banco esportivo, cúpula de vidro escuro atrás do piloto e aerofólio flutuante
      k.box(1.1, 1.25, 0.2, 0.1, M.seat, 0, 1.3, -1.2).rotation.x = -0.25;
      k.box(1.1, 0.2, 1.0, 0.08, M.seat, 0, 0.82, -0.6);
      { const c = k.add(new THREE.SphereGeometry(0.75, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, 0, 1.0, -2.1); c.scale.set(1, 0.9, 1.5); }
      [-1, 1].forEach(s => k.box(0.08, 0.9, 0.35, 0.04, M.dark, s * 0.75, 1.55, -3.0).rotation.x = 0.35);
      k.box(2.7, 0.08, 0.75, 0.04, M.paintD, 0, 2.05, -3.2); k.neonBar(2.7, 0.04, 0.05, 0, 2.05, -2.82);
      // propulsores traseiros
      [-1, 1].forEach(s => k.exhaust(V(s * 0.55, 0.95, -3.0), V(s * 0.6, 0.95, -3.55), 0.22, 0.26, M.dark));
      // luz por baixo (under-glow)
      { const ug = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 6.2), new THREE.MeshBasicMaterial({ map: Fx.softTex(), color: k.spec.decalColor, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
        ug.rotation.x = -Math.PI / 2; ug.position.y = 0.06; ug.userData.dynamic = true; k.pivot.add(ug); k.neons.push(ug); }
      k.rod(V(-1.5, 0.82, -1.95), V(1.5, 0.82, -1.95), 0.06, M.dark); k.rod(V(-1.35, 0.68, 1.85), V(1.35, 0.68, 1.85), 0.06, M.dark);
      [-1, 1].forEach(s => { k.wheel(s * 1.5, 0.68, 1.85, 0.68, 0.6, { steer: true, style: 'cyber' }); k.wheel(s * 1.62, 0.82, -1.95, 0.82, 0.75, { style: 'cyber' }); });
      const hands = k.steering(V(0, 1.38, 0.08), 1.05, 0.32, V(0, 1.05, 0.9));
      const feet = k.pedals([V(0.22, 0.82, 0.68), V(-0.22, 0.82, 0.68)]);
      return { cockpit: { seat: V(0, 1.05, -0.6), scale: 1.55, recline: -0.08, hands, feet },
        decal: { side: [-3.5, 3.95, 0.3, 1.4], top: [-1.25, 1.25, -1.5, 3.9], numSide: [0.0, 0.72, 0.5], numTop: [0, 2.3, -0.72] },
        rear: { x: 1.62, z: -1.95 }, shadow: [1.9, 3.6], lean: -0.1 };
    } });

  // ---------- 5. Off-road / 4x4 de brinquedo: carroceria curtinha e "inflada", capô redondo com
  //            para-lamas em calombo, rodonas balão de cravos bem para fora, quebra-mato tubular,
  //            amortecedores aparentes, santantônio e estepe atrás ----------
  MODELS.push({ id: 'offroad', name: 'Off-Road', desc: '4x4 de brinquedo: baixinho, gordinho e com rodonas balão.',
    build(k) {
      const { M } = k, WX = 2.12, WZ = 1.95, WR = 1.22;
      k.box(1.8, 0.34, 4.6, 0.15, M.dark, 0, 1.3, 0);                                                // chassi
      // banheira bem boleada (cantos grandes = aspecto de brinquedo)
      k.profile([[2.65, 1.38], [2.78, 2.05], [2.45, 2.42], [0.95, 2.48], [0.62, 2.22], [-1.55, 2.22], [-2.3, 2.42], [-2.6, 2.1], [-2.5, 1.38]], 2.5, 0.42, M.paint);
      // capô abaulado e calombos dos para-lamas dianteiros
      { const g = new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2); k.add(g, M.paint, 0, 2.3, 1.75).scale.set(0.95, 0.3, 0.95);
        [-1, 1].forEach(s => { k.add(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.paint, s * 1.12, 2.28, 1.8).scale.set(0.5, 0.36, 0.9); }); }
      // para-lamas largos sobre as rodonas (plástico escuro, cantos redondos)
      // para-lamas grossos (arco sólido de 28 cm de espessura) abraçando cada roda
      [-1, 1].forEach(s => [WZ, -WZ].forEach(z => k.add(k.arch(WR + 0.14, WR + 0.42, Math.PI * 0.12, Math.PI * 0.88, 1.75), M.dark, s * 2.02, WR, z)));
      [-1, 1].forEach(s => k.box(0.5, 0.22, 1.5, 0.1, M.dark, s * 1.5, 1.55, 0));                     // estribo entre as rodas
      // frente: grade escura com frisos, dois faróis redondos grandes, quebra-mato tubular e guincho
      k.box(1.5, 0.62, 0.16, 0.12, M.black, 0, 1.98, 2.82);
      for (let i = 0; i < 5; i++) k.box(0.07, 0.48, 0.06, 0.03, M.gray, -0.4 + i * 0.2, 1.98, 2.9);
      [-1, 1].forEach(s => k.headlight(s * 0.95, 2.05, 2.72, 0.24));
      k.tube([V(-1.15, 1.5, 3.0), V(-1.05, 2.15, 3.35), V(-0.45, 2.3, 3.45), V(0.45, 2.3, 3.45), V(1.05, 2.15, 3.35), V(1.15, 1.5, 3.0)], 0.13, M.dark);
      k.rod(V(-1.3, 1.5, 3.15), V(1.3, 1.5, 3.15), 0.15, M.dark);
      k.box(0.8, 0.3, 0.3, 0.1, M.gray, 0, 1.5, 3.36);
      // amortecedores aparentes (molas grossas na cor clara do kart) em cada roda + braços
      const coil = (a, b) => { const pts = [], n = 40, d = new THREE.Vector3().subVectors(b, a), L = d.length(), q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
        for (let i = 0; i <= n; i++) { const t = i / n, ang = t * Math.PI * 2 * 4.5; pts.push(V(Math.cos(ang) * 0.17, t * L, Math.sin(ang) * 0.17).applyQuaternion(q).add(a)); } k.tube(pts, 0.065, M.paintL); k.cone(a, b, 0.07, 0.07, M.chrome); };
      [WZ, -WZ].forEach(wz => [-1, 1].forEach(s => { k.rod(V(s * 0.85, 1.3, wz), V(s * (WX - 0.55), WR, wz), 0.11, M.gray); coil(V(s * (WX - 0.62), WR + 0.1, wz + 0.42), V(s * 0.95, 2.2, wz + 0.42)); }));
      // para-brisa baixo com moldura, santantônio e banco
      { const fr = k.tube([V(-1.05, 2.22, 0.75), V(-1.0, 3.0, 0.55), V(1.0, 3.0, 0.55), V(1.05, 2.22, 0.75)], 0.08, M.dark); const gl = k.box(1.9, 0.68, 0.05, 0.04, M.glass, 0, 2.62, 0.66); gl.rotation.x = -0.25; }
      k.tube([V(-0.95, 2.22, -1.55), V(-0.88, 3.25, -1.45), V(0.88, 3.25, -1.45), V(0.95, 2.22, -1.55)], 0.12, M.paintD);
      k.rod(V(-0.88, 3.25, -1.45), V(-0.95, 2.4, -2.35), 0.09, M.paintD); k.rod(V(0.88, 3.25, -1.45), V(0.95, 2.4, -2.35), 0.09, M.paintD);
      k.box(1.25, 1.2, 0.26, 0.13, M.seat, 0, 2.62, -1.15).rotation.x = -0.2;
      k.box(1.25, 0.24, 0.95, 0.1, M.seat, 0, 2.22, -0.65);
      // estepe na traseira e escapamento curto
      { const sp = new THREE.Group(); sp.position.set(0, 2.0, -2.85); k.body.add(sp); const t = new THREE.Mesh(tireGeo(0.68, 0.5, 0.5), M.rubber); t.rotation.y = Math.PI / 2; sp.add(t); const h = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 10), M.hub); h.scale.z = 0.5; h.position.z = -0.12; sp.add(h); }
      k.exhaust(V(0.75, 1.45, -2.2), V(0.85, 1.5, -2.95), 0.1, 0.18);
      // eixos aparentes + rodonas balão de cravos
      k.rod(V(-WX + 0.4, WR, WZ), V(WX - 0.4, WR, WZ), 0.13, M.dark); k.rod(V(-WX + 0.4, WR, -WZ), V(WX - 0.4, WR, -WZ), 0.13, M.dark);
      [-1, 1].forEach(s => { k.wheel(s * WX, WR, WZ, WR, 1.3, { steer: true }); k.wheel(s * WX, WR, -WZ, WR, 1.3); });
      const hands = k.steering(V(0, 2.82, 0.05), 0.95, 0.34, V(0, 2.3, 0.55));
      const feet = k.pedals([V(0.22, 2.24, 0.55), V(-0.22, 2.24, 0.55)]);
      return { cockpit: { seat: V(0, 2.44, -0.62), scale: 1.55, recline: -0.1, hands, feet },
        decal: { side: [-2.6, 2.8, 1.4, 2.45], top: [-1.25, 1.25, 0.6, 2.8], numSide: [-0.5, 1.85, 0.6], numTop: [0, 1.7, -0.7] },
        rear: { x: WX, z: -WZ }, shadow: [2.9, 3.4], lean: -0.13 };
    } });

  // ---------- 6. Moto futurista: carenagem inteira e baixa (bico, miolo e rabeta separados das rodas),
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
    spec = Object.assign({}, CFG.DEFAULT_SPEC, typeof spec === 'string' ? { color: spec } : spec);
    const def = byId(spec.model);
    // 1ª passada só para obter as caixas de adesivo do modelo (são constantes por modelo: guardadas em cache)
    if (!def._decalBox) { const tmp = makeKit(spec, Livery.build(spec, { side: [0, 1, 0, 1], top: [0, 1, 0, 1] })); def._decalBox = def.build(tmp).decal; disposeTree(tmp.group); }
    const decal = Livery.build(spec, def._decalBox);
    const k = makeKit(spec, decal), info = def.build(k), { group, pivot, body } = k;
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
      setDecalColor(hex) { k.M.paint.userData.decalUniforms.uDecalColor.value.set(hex); k.M.neon.color.set(hex); k.neons.forEach(n => n.material.color && n.material.color.set(hex)); spec.decalColor = hex; if (pilot && spec.accessory !== 'none') pilot.setAccessory(spec.accessory, hex); },
      setDecal(id, number) { spec.decal = id; spec.number = number | 0; const d = Livery.build(spec, def._decalBox), u = k.M.paint.userData.decalUniforms;
        u.uDecal.value = d.texture; u.uDecalOn.value = d.on ? 1 : 0; u.uNumSide.value.w = spec.number > 0 ? 1 : 0; u.uNumTop.value.w = spec.number > 0 ? 1 : 0; },
      setPilot(s) { Object.assign(spec, s); if (pilot) { pilot.setColors(spec); if ('accessory' in s) pilot.setAccessory(spec.accessory, spec.decalColor); } },
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
