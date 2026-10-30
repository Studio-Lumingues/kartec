// =====================================================================================
// props.js — objetos de cenário "de brinquedo", espalhados por qualquer pista
//   * pilhas de pneus coloridos (cores de bala, 2 de altura) do lado de fora das curvas fechadas
//   * cones infláveis gordinhos marcando a entrada das curvas
//   * balões de festa amarrados perto da largada
// Tudo instanciado (1 chamada de desenho por tipo) e com material toon; só os balões levam contorno.
// São decorativos: ficam fora do asfalto e não entram na física.
// =====================================================================================
(function () {
  const CANDY = [0xff4d6d, 0xffd23f, 0x3dd6ff, 0x8b5cf6, 0x2ee6a8, 0xff8a3d, 0xff7ae0];

  function coneGeo() {
    const pr = [[0, 0], [0.62, 0], [0.66, 0.08], [0.6, 0.2], [0.42, 0.9], [0.24, 1.5], [0.14, 1.72], [0, 1.78]].map(p => new THREE.Vector2(p[0], p[1]));
    return new THREE.LatheGeometry(pr, 8);
  }

  const Props = {
    build(track, def, root) {
      const tr = track, N = tr.N, T = tr.T, W = tr.W;
      // curvatura por nó (mesma ideia do piloto automático): sinal = lado de dentro
      const curv = new Float32Array(N), inside = new Int8Array(N);
      for (let i = 0; i < N; i++) {
        const a = T[(i - 4 + N) % N], b = T[(i + 4) % N], n = { x: T[i].z, z: -T[i].x };
        inside[i] = Math.sign((b.x - a.x) * n.x + (b.z - a.z) * n.z) || 1;
        curv[i] = Math.abs(Math.atan2(Math.sin(Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z)), Math.cos(Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z)))) / 8;
      }
      // trechos proibidos: largada, pontes, rampas e plataformas
      const busy = new Uint8Array(N), mark = (c, r) => { for (let d = -r; d <= r; d++) busy[((c + d) % N + N) % N] = 1; };
      mark(def.startIdx, 30); (def.bridges || []).forEach(b => mark(b, 22));
      (def.pads || []).forEach(p => mark(p[0], 4)); (def.ramps || []).forEach(p => mark(p[0], 8));
      const off = W + 4.5, ground = (p, i) => (tr.groundAt ? tr.groundAt(p, i, 0).h : tr.roadBase);
      const tires = [], cones = [], balloons = [];
      let cool = 0;
      for (let i = 0; i < N; i++) {
        if (cool > 0) { cool--; continue; }
        if (busy[i] || curv[i] < 0.012) continue;
        const out = -inside[i];
        // parede de pneus no ápice + 3 cones antes da curva
        for (let k = -2; k <= 2; k++) { const j = (i + k * 2 + N) % N, p = tr.side(j, out * off, 0); p.y = ground(p, j); tires.push({ p, ang: Math.atan2(T[j].x, T[j].z) }); }
        for (let k = 1; k <= 3; k++) { const j = (i - 6 - k * 3 + N) % N; if (busy[j]) continue; const p = tr.side(j, out * (W + 1.6), 0); p.y = ground(p, j); cones.push(p); }
        cool = 26;
      }
      // balizadores (postinhos brancos com faixa refletiva) a cada ~13 m: referência visual
      // perto da câmera que "passa voando" -> dá muito mais sensação de velocidade, a custo de 1 chamada de desenho
      const posts = [];
      for (let i = 0; i < N; i += Math.max(2, Math.round(13 / (tr.length / N)))) [-1, 1].forEach(sd => {
        if (busy[i] || curv[i] >= 0.012) return; const p = tr.side(i, sd * (W + 6), 0); p.y = ground(p, i); posts.push(p); tr.obstacles.push({ x: p.x, z: p.z, r: 0.3 }); });   // só nas retas, além do acostamento
      for (let k = -3; k <= 3; k++) [-1, 1].forEach(sd => { const j = (def.startIdx + k * 4 + N) % N, p = tr.side(j, sd * (W + 3.2), 0); p.y = ground(p, j); balloons.push(p); });

      const d = new THREE.Object3D(), group = new THREE.Group(); group.userData.dynamic = true; root.add(group);
      // pilha = 3 pneus de cores diferentes
      if (tires.length) {
        const g = new THREE.TorusGeometry(0.85, 0.45, 5, 10).rotateX(Math.PI / 2), n = tires.length * 2;
        const im = new THREE.InstancedMesh(g, Toon.mat({ color: 0xffffff }, { gloss: 0.4, rim: 0.3, sat: 0, key: 'prop' }), n); let c = 0;
        tires.forEach((t, ti) => { for (let h = 0; h < 2; h++) { d.position.set(t.p.x, t.p.y + 0.45 + h * 0.82, t.p.z); d.rotation.set(0, t.ang, 0); d.scale.set(1, 0.92, 1); d.updateMatrix(); im.setMatrixAt(c, d.matrix); im.setColorAt(c, new THREE.Color(CANDY[(ti + h) % CANDY.length])); c++; } });
        im.castShadow = true; group.add(im);
      }
      // cone inflável: corpo laranja + faixa branca
      if (cones.length) {
        const body = new THREE.InstancedMesh(coneGeo(), Toon.mat({ color: 0xff7a2a }, { gloss: 0.6, rim: 0.35, sat: 0, key: 'prop' }), cones.length);
        body.userData.noOutline = true;
        const band = new THREE.InstancedMesh(new THREE.TorusGeometry(0.36, 0.1, 4, 8).rotateX(Math.PI / 2), Toon.mat({ color: 0xffffff }, { gloss: 0.6, rim: 0.2, sat: 0, key: 'prop' }), cones.length);
        cones.forEach((p, i) => { d.position.copy(p); d.rotation.set(0, i, 0); d.scale.setScalar(1.25); d.updateMatrix(); body.setMatrixAt(i, d.matrix); d.position.y += 1.0 * 1.25; d.updateMatrix(); band.setMatrixAt(i, d.matrix); });
        band.userData.noOutline = true;
        group.add(body, band);                                   // cones baixinhos: sem sombra projetada (economia)
      }
      // balões: esfera colorida + barbante
      if (balloons.length) {
        const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 10, 8), Toon.mat({ color: 0xffffff }, { gloss: 0.8, rim: 0.3, sat: 0, key: 'prop' }), balloons.length);
        const sm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 4, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), balloons.length);
        balloons.forEach((p, i) => { d.rotation.set(0, 0, 0); d.scale.set(1, 1.18, 1); d.position.set(p.x, p.y + 5.2 + (i % 3) * 0.5, p.z); d.updateMatrix(); bm.setMatrixAt(i, d.matrix); bm.setColorAt(i, new THREE.Color(CANDY[i % CANDY.length]));
          d.scale.set(1, 1, 1); d.position.set(p.x, p.y + 2.2 + (i % 3) * 0.5, p.z); d.updateMatrix(); sm.setMatrixAt(i, d.matrix); });
        bm.userData.outlineInstanced = true; group.add(bm, sm); this.balloons = bm;
      }
      if (posts.length) {
        const pg = new THREE.CylinderGeometry(0.12, 0.15, 1.15, 6).toNonIndexed(); pg.translate(0, 0.575, 0); pg.deleteAttribute('uv');
        const pc = new Float32Array(pg.attributes.position.count * 3); for (let k = 0; k < pg.attributes.position.count; k++) { const y = pg.attributes.position.getY(k), band = y > 0.78 && y < 1.02; pc.set(band ? [1, 0.45, 0.1] : [0.96, 0.96, 0.98], k * 3); }
        pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
        const pm = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), posts.length);
        posts.forEach((p, k) => { d.position.copy(p); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); pm.setMatrixAt(k, d.matrix); });
        pm.instanceMatrix.needsUpdate = true; pm.userData.noOutline = true; group.add(pm);
      }
      Toon.outline(group, 0.06);
      return { tires: tires.length, cones: cones.length, posts: posts.length };
    }
  };
  window.Props = Props;
})();
