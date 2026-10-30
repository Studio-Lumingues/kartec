// =====================================================================================
// scenery.js — preenchimento do mundo ("world fill") em volta de qualquer pista
//
// Problema: pistas maiores deixavam grandes áreas vazias entre a pista e o horizonte.
// Solução: amostragem em grade com jitter de todo o terreno até o alcance da névoa, em 3 faixas:
//   * perto  (borda da pista + ~30 m até ~220 m): adereços detalhados e densos (árvores, arbustos, flores)
//   * meio   (~220 a ~600 m): os mesmos modelos, mais espaçados e maiores
//   * longe  (~600 m até a névoa): silhuetas baratas e grandes (bosques e morros)
//
// Desempenho:
//   * cada tipo de objeto é UMA geometria compartilhada desenhada com InstancedMesh;
//   * as instâncias são agrupadas em blocos de CFG.FILL.CHUNK metros. Cada bloco tem a própria esfera
//     envolvente, então o frustum culling do Three.js descarta blocos inteiros fora da câmera
//     (um InstancedMesh único teria uma esfera do tamanho do mapa e nunca seria descartado);
//   * a cada CFG.FILL.CULL_EVERY s os blocos além da névoa ficam invisíveis (culling por distância);
//   * só os blocos perto da pista projetam sombra; nada aqui recebe sombra (o mapa de sombra só cobre ~45 m);
//   * cores por instância (instanceColor) dão variedade sem materiais extras;
//   * os blocos compartilham os buffers de vértices na GPU (só a esfera envolvente é por bloco).
// =====================================================================================
(function () {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---------- geometrias "cartum" com cor por vértice (um único material por tipo) ----------
  function colored(geo, hex, mat4) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()); if (mat4) g.applyMatrix4(mat4);
    const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); return g;
  }
  function merge(parts) {
    let n = 0; parts.forEach(p => n += p.attributes.position.count);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
    parts.forEach(p => { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); col.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; p.dispose(); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere(); return g;
  }
  const M = (x, y, z, sx, sy, sz, ry) => new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry || 0, 0)), V3(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz));

  const GEOS = {
    tree: () => merge([colored(new THREE.CylinderGeometry(0.28, 0.42, 2.6, 6), 0x9a6538, M(0, 1.3, 0, 1)),
      colored(new THREE.IcosahedronGeometry(2.2, 0), 0x46bd34, M(0, 3.9, 0, 1, 1.05, 1)), colored(new THREE.IcosahedronGeometry(1.4, 0), 0x5fd641, M(0.9, 4.9, 0.3, 1))]),
    pine: () => merge([colored(new THREE.CylinderGeometry(0.25, 0.35, 1.6, 6), 0x9a6538, M(0, 0.8, 0, 1)),
      colored(new THREE.ConeGeometry(2.2, 3.2, 7), 0x2e9e5a, M(0, 2.9, 0, 1)), colored(new THREE.ConeGeometry(1.6, 2.6, 7), 0x3ab86a, M(0, 4.6, 0, 1))]),
    bush: () => merge([colored(new THREE.IcosahedronGeometry(1.1, 0), 0x46bd34, M(0, 0.7, 0, 1, 0.8, 1)), colored(new THREE.IcosahedronGeometry(0.8, 0), 0x86ea5c, M(0.8, 0.6, 0.2, 1, 0.8, 1))]),
    flowers: () => merge([colored(new THREE.IcosahedronGeometry(0.5, 0), 0xffffff, M(0, 0.4, 0, 1, 0.6, 1)), colored(new THREE.IcosahedronGeometry(0.4, 0), 0xffffff, M(0.6, 0.35, 0.3, 1, 0.6, 1)), colored(new THREE.IcosahedronGeometry(0.35, 0), 0xffffff, M(-0.5, 0.3, -0.3, 1, 0.6, 1))]),
    rock: () => merge([colored(new THREE.DodecahedronGeometry(1, 0), 0xa99cd6, M(0, 0.5, 0, 1.3, 0.8, 1))]),
    forest: () => merge([0, 1, 2, 3].map(k => colored(new THREE.ConeGeometry(3.4, 9, 6), k % 2 ? 0x2e9e5a : 0x3ab86a, M(Math.cos(k * 1.7) * 3.2, 4.5, Math.sin(k * 1.7) * 3.2, 1 + (k % 3) * 0.2)))),
    hill: () => merge([colored(new THREE.IcosahedronGeometry(1, 1), 0x6fcf5a, M(0, 0, 0, 1, 0.45, 1))])
  };

  // ---------- consulta rápida de distância até a pista (hash espacial dos nós) ----------
  function trackIndex(tr, C) {
    const cells = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
    tr.S.forEach(p => { const k = key(Math.floor(p.x / C), Math.floor(p.z / C)); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(p); });
    return (x, z, maxR) => {   // devolve a distância (limitada a maxR)
      const ci = Math.floor(x / C), cj = Math.floor(z / C), R = Math.ceil(maxR / C); let best = maxR * maxR;
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) { const l = cells.get(key(ci + i, cj + j)); if (!l) continue;
        for (const p of l) { const dx = p.x - x, dz = p.z - z, q = dx * dx + dz * dz; if (q < best) best = q; } }
      return Math.sqrt(best);
    };
  }
  function circleIndex(list, C) {
    const cells = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
    list.forEach(b => { const R = Math.ceil(b.r / C); const ci = Math.floor(b.x / C), cj = Math.floor(b.z / C);
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) { const k = key(ci + i, cj + j); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(b); } });
    return (x, z, pad) => { const l = cells.get(key(Math.floor(x / C), Math.floor(z / C))); if (!l) return false; for (const b of l) if (Math.hypot(b.x - x, b.z - z) < b.r + pad) return true; return false; };
  }
  const Scenery = {
    // tr: objeto da pista; def: definição (config); root: grupo da cena. Chame dentro de Toon.during.
    build(tr, def, root, opts) {
      opts = opts || {};
      const F = CFG.FILL, dens = opts.density || F.DENSITY, CH = F.CHUNK, W = tr.W, far = (def.fogFar || 820) - 40;
      // mesma semente de antes: o cenário do Circuito Clássico continua idêntico
      let seed = 1234 + def.id.length * 77; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const dist = trackIndex(tr, 60), blocked = circleIndex(tr.blockers.concat(tr.obstacles.map(o => ({ x: o.x, z: o.z, r: o.r + 2 }))), 80);
      const S0 = tr.S[tr.startIdx];
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; tr.S.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
      x0 -= far; x1 += far; z0 -= far; z1 += far;

      // ---- tipos de objeto (tema clássico, o único que restou): geometria, material, faixas, espaçamento, escala ----
      const vc = () => new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      const kinds = {};
      const kind = (id, geo, mat, o) => { kinds[id] = Object.assign({ id, geo, mat, list: [], sMin: 1, sMax: 1, tint: null, yaw: true, y: 0, shadow: true }, o); };
      const land = (x, z) => !(tr.inWater && tr.inWater({ x, y: 0, z }));
      let bands;
      {
        const m = vc();
        kind('tree', GEOS.tree(), m, { sMin: 0.9, sMax: 1.6, r: 3, tint: () => new THREE.Color().setHSL(0.2 + rnd() * 0.2, 0.45, 0.78 + rnd() * 0.17) });
        kind('pine', GEOS.pine(), m, { sMin: 1, sMax: 1.8, r: 2.4 });
        kind('bush', GEOS.bush(), m, { sMin: 0.8, sMax: 1.5, r: 1.6, shadow: false });
        kind('flowers', GEOS.flowers(), m, { sMin: 0.8, sMax: 1.3, r: 1, shadow: false, tint: () => new THREE.Color([0xff7ab8, 0xffe14a, 0xffffff, 0xff8a3d, 0xb08aff][Math.floor(rnd() * 5)]) });
        kind('rock', GEOS.rock(), m, { sMin: 0.8, sMax: 2.4, r: 1.5, shadow: false });
        kind('forest', GEOS.forest(), m, { sMin: 1.2, sMax: 2.6, r: 8, shadow: false });
        kind('hill', GEOS.hill(), m, { sMin: 45, sMax: 110, r: 60, shadow: false, yaw: false, y: -6, tint: () => new THREE.Color().setHSL(0.22 + rnd() * 0.12, 0.4, 0.8 + rnd() * 0.12) });
        bands = [
          { d0: W + 26, d1: 220, step: 16, p: 0.55, pick: () => { const r = rnd(); return r < 0.45 ? 'tree' : r < 0.62 ? 'pine' : r < 0.8 ? 'bush' : r < 0.93 ? 'flowers' : 'rock'; } },
          { d0: 220, d1: 620, step: 30, p: 0.55, pick: () => { const r = rnd(); return r < 0.5 ? 'tree' : r < 0.85 ? 'pine' : 'forest'; } },
          { d0: 620, d1: far, step: 70, p: 0.75, pick: () => rnd() < 0.8 ? 'forest' : 'hill' }
        ];
      }

      // ---- amostragem: grade com jitter por faixa ----
      bands.forEach(b => {
        const step = b.step / Math.sqrt(dens);
        for (let x = x0; x <= x1; x += step) for (let z = z0; z <= z1; z += step) {
          if (rnd() > b.p) continue;
          const px = x + (rnd() - 0.5) * step * 0.9, pz = z + (rnd() - 0.5) * step * 0.9, d = dist(px, pz, b.d1 + 1);
          if (d < b.d0 || d > b.d1) continue;
          if (Math.hypot(px - S0.x, pz - S0.z) < W + 50) continue;
          const id = b.pick(px, pz); if (!id) continue; const k = kinds[id];
          if (!land(px, pz) || blocked(px, pz, k.r + 3)) continue;
          k.list.push({ x: px, z: pz, d });
        }
      });
      // ---- monta os blocos (InstancedMesh por bloco e por tipo) ----
      const group = new THREE.Group(); group.userData.dynamic = true; root.add(group);
      const chunks = [], d = new THREE.Object3D(), tmp = new THREE.Color();
      const byChunk = new Map();
      const push = (k, inst) => { const key = Math.floor(inst.x / CH) + ',' + Math.floor(inst.z / CH) + ',' + k.id;
        if (!byChunk.has(key)) byChunk.set(key, { k, items: [] }); byChunk.get(key).items.push(inst); };
      Object.values(kinds).forEach(k => {
        k.list.forEach(it => {
          const yaw = k.yaw ? rnd() * Math.PI * 2 : 0;
          const s = k.sMin + rnd() * (k.sMax - k.sMin); push(k, { x: it.x, z: it.z, y: k.y, sx: s, sy: s, sz: s, ry: yaw, near: it.d < 160, c: k.tint ? k.tint() : null });
        });
      });
      let total = 0;
      byChunk.forEach(({ k, items }) => {
        let cx = 0, cz = 0; items.forEach(i => { cx += i.x; cz += i.z; }); cx /= items.length; cz /= items.length;
        if (!k.geo.boundingSphere) k.geo.computeBoundingSphere();
        const gr = k.geo.boundingSphere.radius; let R = 0;
        items.forEach(i => { R = Math.max(R, Math.hypot(i.x - cx, i.z - cz) + gr * Math.max(i.sx, i.sy, i.sz)); });
        // geometria "casca": mesmos atributos (mesmos buffers na GPU), esfera envolvente própria do bloco
        const g = new THREE.BufferGeometry(); for (const a in k.geo.attributes) g.setAttribute(a, k.geo.attributes[a]); if (k.geo.index) g.setIndex(k.geo.index);
        g.boundingSphere = new THREE.Sphere(V3(0, 0, 0), R);
        const im = new THREE.InstancedMesh(g, k.mat, items.length);
        items.forEach((i, n) => { d.position.set(i.x - cx, i.y, i.z - cz); d.rotation.set(0, i.ry, 0); d.scale.set(i.sx, i.sy, i.sz); d.updateMatrix(); im.setMatrixAt(n, d.matrix);
          im.setColorAt(n, i.c || tmp.set(0xffffff)); });   // sempre com instanceColor: o r128 não separa programas com/sem cor de instância
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.position.set(cx, 0, cz); im.castShadow = k.shadow && items.some(i => i.near); im.receiveShadow = false;
        im.userData.noOutline = true; im.matrixAutoUpdate = false; im.updateMatrix();
        group.add(im); chunks.push({ im, cx, cz, R }); total += items.length;
      });
      // os maiores objetos também bloqueiam o lens flare (teste barato por esfera)
      Object.values(kinds).forEach(k => { if (k.id === 'hill' || k.id === 'forest') k.list.forEach((it, n) => { if (n % 3 === 0) tr.blockers.push({ x: it.x, y: 10, z: it.z, r: k.r }); }); });

      let t = 0;
      return {
        stats: { instances: total, chunks: chunks.length },
        // culling por distância: blocos além da névoa ficam invisíveis (o frustum culling cuida do resto)
        update(dt, cam, fogFar) {
          t -= dt; if (t > 0) return; t = F.CULL_EVERY;
          const lim = fogFar + 30;
          for (const c of chunks) { const dx = c.cx - cam.x, dz = c.cz - cam.z; c.im.visible = Math.sqrt(dx * dx + dz * dz) - c.R < lim; }
        },
        dispose() { Object.values(kinds).forEach(k => k.geo.dispose()); }
      };
    }
  };
  window.Scenery = Scenery;
})();
