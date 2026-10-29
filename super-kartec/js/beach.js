// =====================================================================================
// beach.js — detalhes de praia ao longo da orla (chamado por Tracks.build dentro de buildBeach)
// Conjuntos a cada ~30 m da faixa de areia entre a pista e o mar: guarda-sol + cadeiras de praia + canga,
// às vezes isopor, bola e prancha de surfe; castelos de areia perto da água; redes de vôlei; passarelas de
// madeira atravessando a areia. Tudo instanciado (cada família = 1 chamada de desenho).
// =====================================================================================
(function () {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const COLORS = [0xe8302a, 0x2a5ce8, 0xffd21a, 0x2cb84a, 0xff7a1a, 0xff4fb0, 0x19c8e8, 0x8a3ae0];
  function colored(geo, hex, m4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); if (m4) g.applyMatrix4(m4); if (g.attributes.uv) g.deleteAttribute('uv');
    const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
  }
  function merge(parts) {
    let n = 0; parts.forEach(p => n += p.attributes.position.count);
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3); let o = 0;
    parts.forEach(p => { P.set(p.attributes.position.array, o * 3); N.set(p.attributes.normal.array, o * 3); C.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; p.dispose(); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.computeBoundingSphere(); return g;
  }
  const M4 = (x, y, z, sx, sy, sz, rx, ry, rz) => new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)), V3(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz));
  function instanced(geo, mat, list, color) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length), d = new THREE.Object3D(), c = new THREE.Color();
    list.forEach((o, i) => { d.position.set(o.x, o.y || 0, o.z); d.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0); d.scale.setScalar(o.s || 1); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, c.set(o.c !== undefined ? o.c : 0xffffff)); });
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.frustumCulled = false; im.castShadow = !!color; im.userData.noOutline = true; return im;
  }
  // ---------- geometrias ----------
  const G = {
    // guarda-sol: lona em gomos alternando branco e cor (a cor de cada um vem da instância e só pinta os gomos coloridos)
    canopyColor: () => { const g = new THREE.ConeGeometry(2.1, 0.75, 12, 1, true).toNonIndexed(), pos = g.attributes.position, keep = [];
      for (let t = 0; t < pos.count / 3; t++) { const a = Math.atan2(pos.getZ(t * 3) + pos.getZ(t * 3 + 1) + pos.getZ(t * 3 + 2), pos.getX(t * 3) + pos.getX(t * 3 + 1) + pos.getX(t * 3 + 2)); if (Math.floor((a + Math.PI) / (Math.PI / 6)) % 2 === 0) keep.push(t); }
      const out = new Float32Array(keep.length * 9); keep.forEach((t, i) => out.set(pos.array.slice(t * 9, t * 9 + 9), i * 9));
      const r = new THREE.BufferGeometry(); r.setAttribute('position', new THREE.BufferAttribute(out, 3)); r.computeVertexNormals(); r.translate(0, 2.75, 0); return r; },
    canopyWhite: () => { const g = new THREE.ConeGeometry(2.08, 0.74, 12, 1, true); g.translate(0, 2.745, 0); return g; },
    pole: () => merge([colored(new THREE.CylinderGeometry(0.05, 0.05, 3.1, 6), 0xf2f2f2, M4(0, 1.45, 0, 1)), colored(new THREE.SphereGeometry(0.1, 6, 4), 0xf2f2f2, M4(0, 3.15, 0, 1))]),
    // cadeira de praia: armação de alumínio (cinza) + lona (cor da instância)
    chairFrame: () => merge([[-0.3, 0.3].map(x => [colored(new THREE.BoxGeometry(0.04, 0.04, 0.8), 0xc8ccd4, M4(x, 0.32, 0.1, 1, 1, 1, 0.12)), colored(new THREE.BoxGeometry(0.04, 0.85, 0.04), 0xc8ccd4, M4(x, 0.55, -0.32, 1, 1, 1, -0.45)),
      colored(new THREE.BoxGeometry(0.04, 0.34, 0.04), 0xc8ccd4, M4(x, 0.17, 0.42, 1)), colored(new THREE.BoxGeometry(0.04, 0.04, 0.42), 0xc8ccd4, M4(x, 0.5, 0.05, 1))]).flat()].flat()),
    chairCloth: () => { const a = new THREE.BoxGeometry(0.6, 0.03, 0.62); a.applyMatrix4(M4(0, 0.3, 0.08, 1, 1, 1, 0.12)); const b = new THREE.BoxGeometry(0.6, 0.7, 0.03); b.applyMatrix4(M4(0, 0.62, -0.32, 1, 1, 1, -0.45));
      return merge([colored(a, 0xffffff), colored(b, 0xffffff)]); },
    towel: () => { const g = new THREE.BoxGeometry(1.0, 0.03, 1.9); g.translate(0, 0.02, 0); return g; },
    cooler: () => merge([colored(new THREE.BoxGeometry(0.7, 0.45, 0.45), 0xf4f4f0, M4(0, 0.23, 0, 1)), colored(new THREE.BoxGeometry(0.74, 0.1, 0.49), 0x2a6cd8, M4(0, 0.5, 0, 1)), colored(new THREE.BoxGeometry(0.4, 0.06, 0.08), 0x2a6cd8, M4(0, 0.58, 0, 1))]),
    ball: () => new THREE.SphereGeometry(0.28, 12, 8).translate(0, 0.28, 0),
    surf: () => { const g = new THREE.SphereGeometry(1, 16, 8); g.scale(0.28, 1.15, 0.06); g.translate(0, 0.95, 0); return g; },
    castle: () => merge([colored(new THREE.CylinderGeometry(0.75, 0.9, 0.5, 10), 0xe8c98a, M4(0, 0.25, 0, 1)), colored(new THREE.CylinderGeometry(0.35, 0.42, 0.55, 8), 0xe2c080, M4(0, 0.75, 0, 1)),
      colored(new THREE.ConeGeometry(0.3, 0.4, 8), 0xdcb878, M4(0, 1.2, 0, 1)), ...[0, 1, 2, 3].map(k => colored(new THREE.CylinderGeometry(0.16, 0.18, 0.4, 6), 0xe2c080, M4(Math.cos(k * 1.57) * 0.6, 0.65, Math.sin(k * 1.57) * 0.6, 1)))]),
    plank: () => new THREE.BoxGeometry(2.2, 0.12, 0.45),
    net: () => merge([colored(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), 0xf2f2f2, M4(-4.5, 1.3, 0, 1)), colored(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), 0xf2f2f2, M4(4.5, 1.3, 0, 1)),
      colored(new THREE.BoxGeometry(9, 0.08, 0.03), 0xffffff, M4(0, 2.45, 0, 1)), colored(new THREE.BoxGeometry(9, 0.8, 0.02), 0x2a2c34, M4(0, 2.0, 0, 1))])
  };

  const BeachKit = {
    // ctx: { ring (contorno da ilha = beira d'água), cx, cz (centro), okSpot(x,z,r), used (lista de ocupados), add, rnd, T, N }
    build(ctx) {
      const { ring, cx, cz, okSpot, used, add, rnd } = ctx;
      const lists = { pole: [], cc: [], cw: [], frame: [], cloth: [], towel: [], cooler: [], ball: [], surf: [], castle: [], plank: [], net: [] };
      const K = ring.length, inward = k => { const p = ring[k % K], dx = cx - p.x, dz = cz - p.z, l = Math.hypot(dx, dz) || 1; return { p, nx: dx / l, nz: dz / l }; };
      let last = -99, nets = 0;
      for (let k = 0; k < K; k++) {
        const { p, nx, nz } = inward(k);
        if (Math.hypot(p.x - ring[(last + K) % K].x, p.z - ring[(last + K) % K].z) < 26 + rnd() * 14) continue;
        // conjunto de praia a 7–24 m da água (lado da areia)
        const d = 7 + rnd() * 30, x = p.x + nx * d, z = p.z + nz * d;
        if (!okSpot(x, z, 4)) continue; last = k; used.push({ x, z, r: 4 });
        const face = Math.atan2(-nx, -nz) + (rnd() - 0.5) * 0.6, col = COLORS[(rnd() * COLORS.length) | 0], tilt = (rnd() - 0.5) * 0.18;
        lists.pole.push({ x, z, rx: tilt, ry: rnd() * 6.28 }); lists.cc.push({ x, z, rx: tilt, ry: rnd() * 6.28, c: col }); lists.cw.push({ x, z, rx: tilt, ry: rnd() * 6.28 });
        const chairs = 1 + ((rnd() * 2.2) | 0);
        for (let c = 0; c < chairs; c++) { const off = (c - (chairs - 1) / 2) * 0.95, ax = Math.cos(face) * off, az = -Math.sin(face) * off, cc = COLORS[(rnd() * COLORS.length) | 0];
          const px = x + ax + Math.sin(face) * 0.6, pz = z + az + Math.cos(face) * 0.6; lists.frame.push({ x: px, z: pz, ry: face }); lists.cloth.push({ x: px, z: pz, ry: face, c: cc }); }
        if (rnd() < 0.7) lists.towel.push({ x: x - Math.cos(face) * 1.9, z: z + Math.sin(face) * 1.9, ry: face + (rnd() - 0.5) * 0.4, c: COLORS[(rnd() * COLORS.length) | 0] });
        if (rnd() < 0.45) lists.cooler.push({ x: x + Math.cos(face) * 1.4, z: z - Math.sin(face) * 1.4, ry: rnd() * 6.28 });
        if (rnd() < 0.25) lists.ball.push({ x: x + (rnd() - 0.5) * 6, z: z + (rnd() - 0.5) * 6, c: COLORS[(rnd() * COLORS.length) | 0] });
        if (rnd() < 0.22) for (let s = 0; s < 1 + ((rnd() * 3) | 0); s++) lists.surf.push({ x: x + Math.cos(face) * (2.2 + s * 0.7), z: z - Math.sin(face) * (2.2 + s * 0.7), ry: face, rz: (rnd() - 0.5) * 0.2, c: COLORS[(rnd() * COLORS.length) | 0] });
        // castelo de areia bem perto da água
        if (rnd() < 0.3) { const d2 = 3 + rnd() * 3, sx = p.x + nx * d2, sz = p.z + nz * d2; if (okSpot(sx, sz, 1.5)) { lists.castle.push({ x: sx, z: sz, ry: rnd() * 6.28, s: 0.8 + rnd() * 0.6 }); used.push({ x: sx, z: sz, r: 1.5 }); } }
        // rede de vôlei de vez em quando (quadra paralela à água)
        if (nets < 6 && rnd() < 0.18) { const d3 = 16 + rnd() * 10, vx = p.x + nx * d3, vz = p.z + nz * d3; if (okSpot(vx, vz, 7)) { lists.net.push({ x: vx, z: vz, ry: Math.atan2(nz, -nx) }); used.push({ x: vx, z: vz, r: 7 }); nets++; } }
      }
      // passarelas de madeira: da pista até a água, de tempos em tempos
      for (let k = 0, made = 0; k < K && made < 10; k += Math.floor(K / 10)) {
        const { p, nx, nz } = inward(k + 3), ang = Math.atan2(nx, nz);
        for (let d = 1; d < 30; d += 0.55) { const x = p.x + nx * d, z = p.z + nz * d; if (!okSpot(x, z, 0.5)) break; lists.plank.push({ x, y: 0.06, z, ry: ang }); }
        made++;
      }
      const vc = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), tint = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      const white = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
      const wood = new THREE.MeshLambertMaterial({ map: TX.get('wood', 1, 1) });
      const group = new THREE.Group(); group.userData.dynamic = true; add(group);
      [instanced(G.pole(), vc, lists.pole), instanced(G.canopyColor(), tint, lists.cc, true), instanced(G.canopyWhite(), white, lists.cw), instanced(G.chairFrame(), vc, lists.frame),
        instanced(G.chairCloth(), new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), lists.cloth), instanced(G.towel(), new THREE.MeshLambertMaterial({ color: 0xffffff }), lists.towel),
        instanced(G.cooler(), vc, lists.cooler), instanced(G.ball(), new THREE.MeshLambertMaterial({ color: 0xffffff }), lists.ball), instanced(G.surf(), new THREE.MeshLambertMaterial({ color: 0xffffff }), lists.surf, true),
        instanced(G.castle(), vc, lists.castle), instanced(G.plank(), wood, lists.plank), instanced(G.net(), vc, lists.net, true)].forEach(m => m && group.add(m));
      this.spots = lists.pole.slice(0, 40).map(o => ({ x: o.x, z: o.z }));   // alguns pontos (usados pela câmera de testes)
      return Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length]));
    }
  };
  window.BeachKit = BeachKit;
})();
