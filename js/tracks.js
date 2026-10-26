// =====================================================================================
// tracks.js — construção 3D das pistas
//  * Tracks.layout(def): gera o traçado (spline fechada com N nós) a partir dos segmentos do config
//  * Tracks.build(def, scene): monta asfalto, zebras, acostamento, pórtico, plataformas, rampas e o
//    cenário do tema: 'classic' (grama, rio com pontes, cachoeira, lagos), 'city' (cidade brasileira)
//    e 'beach' (ilha com mar, coqueiros e rampas). Devolve o objeto "track" usado pela física e pela IA.
// =====================================================================================
(function () {
  let N = 500;                    // nós por volta: vem de def.N (config); definido em layout() e build()
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
  const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

  // ---------------- traçado ----------------
  const layoutCache = {};
  function layout(def) {
    N = def.N || 500;
    if (layoutCache[def.id]) return layoutCache[def.id];
    let x = 0, y = 0, h = 0; const pts = [[0, 0]], step = 14;
    for (const s of def.segs) {
      if (s[0] === 'S') { const n = Math.max(1, Math.round(s[1] / step)); for (let k = 0; k < n; k++) { x += Math.cos(h) * s[1] / n; y += Math.sin(h) * s[1] / n; pts.push([x, y]); } }
      else { const R = s[1], A = s[2] * Math.PI / 180, sg = s[0] === 'L' ? 1 : -1, n = Math.max(2, Math.round(R * A / step)); for (let k = 0; k < n; k++) { h += sg * A / n; x += Math.cos(h) * R * A / n; y += Math.sin(h) * R * A / n; pts.push([x, y]); } }
    }
    const P = pts.slice(0, -1); let cx = 0, cy = 0; P.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= P.length; cy /= P.length;
    const curve = new THREE.CatmullRomCurve3(P.map(p => V3(+(p[0] - cx).toFixed(1), 0, +(p[1] - cy).toFixed(1))), true, 'catmullrom', 0.5);
    const S = [], T = [];
    for (let i = 0; i < N; i++) { S.push(curve.getPointAt(i / N)); T.push(curve.getTangentAt(i / N)); }
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; S.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
    return (layoutCache[def.id] = { S, T, curve, length: curve.getLength(), bbox: { x0, x1, z0, z1 } });
  }

  // ---------------- utilidades de geometria ----------------
  function mergeParts(parts) {   // parts: [{g, grp}] -> uma geometria com grupos de material (0 = folhas, 1 = tronco)
    const out = new THREE.BufferGeometry(), pos = [], nor = [], uv = [];
    [0, 1, 2].forEach(gi => {
      const s = pos.length / 3;
      parts.filter(p => p.grp === gi).forEach(p => {
        const g = p.g.index ? p.g.toNonIndexed() : p.g; if (!g.attributes.normal) g.computeVertexNormals();
        pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
        uv.push(...(g.attributes.uv ? g.attributes.uv.array : new Float32Array(g.attributes.position.count * 2)));
      });
      const c = pos.length / 3 - s; if (c) out.addGroup(s, c, gi);
    });
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return out;
  }
  // árvores e plantas low-poly (procedurais)
  const PLANTS = {
    round(s) { const t = new THREE.CylinderGeometry(0.35, 0.5, 3.4, 7); t.translate(0, 1.7, 0); const parts = [{ g: t, grp: 1 }];
      [[0, 4.6, 0, 2.6], [1.3, 4.0, 0.4, 1.7], [-1.1, 4.2, -0.6, 1.8], [0.2, 5.8, -0.3, 1.7]].forEach(a => { const g = new THREE.IcosahedronGeometry(a[3] * s, 1); g.translate(a[0] * s, a[1] * s, a[2] * s); parts.push({ g, grp: 0 }); });
      return mergeParts(parts); },
    pine() { const t = new THREE.CylinderGeometry(0.3, 0.42, 2.6, 6); t.translate(0, 1.3, 0); const parts = [{ g: t, grp: 1 }];
      [[2.8, 3.4, 2.2], [2.2, 3.0, 4.2], [1.5, 2.6, 6.0]].forEach(a => { const g = new THREE.ConeGeometry(a[0], a[1], 8); g.translate(0, a[2], 0); parts.push({ g, grp: 0 }); });
      return mergeParts(parts); },
    bush() { const parts = []; [[0, 0.8, 0, 1.2], [0.9, 0.6, 0.3, 0.85], [-0.8, 0.65, -0.2, 0.9]].forEach(a => { const g = new THREE.IcosahedronGeometry(a[3], 1); g.translate(a[0], a[1], a[2]); parts.push({ g, grp: 0 }); }); return mergeParts(parts); },
    palm(lean) {
      const parts = []; let px = 0, py = 0; const segs = 7, H = 7.5;
      for (let j = 0; j < segs; j++) { const a = lean * j / segs, len = H / segs; const g = new THREE.CylinderGeometry(0.28 - j * 0.015, 0.34 - j * 0.015, len, 8); g.rotateZ(-a); g.translate(px + Math.sin(a) * len / 2, py + Math.cos(a) * len / 2, 0); parts.push({ g, grp: 1 }); px += Math.sin(a) * len; py += Math.cos(a) * len; }
      for (let k = 0; k < 3; k++) { const g = new THREE.SphereGeometry(0.28, 8, 6); g.translate(px + Math.cos(k * 2.1) * 0.35, py - 0.3, Math.sin(k * 2.1) * 0.35); parts.push({ g, grp: 1 }); }
      for (let k = 0; k < 8; k++) {                         // folhas (faixas curvas caindo)
        const a = k / 8 * Math.PI * 2 + 0.3, L = 4.2 + (k % 3) * 0.5, pos = [], uv = [], idx = [], n = 6;
        for (let q = 0; q <= n; q++) { const t = q / n, r = t * L, y = py + Math.sin(t * Math.PI * 0.55) * 1.1 - t * t * 2.6, w = 0.95 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 0.12;
          const cx = px + Math.cos(a) * r, cz = Math.sin(a) * r, ox = -Math.sin(a) * w, oz = Math.cos(a) * w;
          pos.push(cx - ox, y, cz - oz, cx + ox, y, cz + oz); uv.push(0, t, 1, t); }
        for (let q = 0; q < n; q++) { const b = q * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); parts.push({ g, grp: 0 });
      }
      return mergeParts(parts);
    }
  };

  // ===================================================================================
  function build(def, scene) {
    const L = layout(def), S = L.S, T = L.T, W = def.W, theme = def.id; N = def.N || 500;
    // chão e mar cobrem a pista + o alcance da névoa em qualquer direção (antes: placa fixa de 3 km, a borda aparecia nas pistas maiores)
    const EXT = Math.max(Math.abs(L.bbox.x0), Math.abs(L.bbox.x1), Math.abs(L.bbox.z0), Math.abs(L.bbox.z1));
    const GS = Math.ceil((EXT + (def.fogFar || 820) + 400) * 2 / 100) * 100, RAD = Math.max(L.bbox.x1 - L.bbox.x0, L.bbox.z1 - L.bbox.z0) / 2;
    let seed = 7 + def.id.length * 13; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const tr = { def, N, W, S, T, length: L.length, startIdx: def.startIdx, roadBase: 0.1, lamps: [], nightMats: [], animated: [], obstacles: [], ponds: [], minimap: [], blockers: [], dustColor: 0xc9a878 };
    const side = tr.side = (i, o, y) => { i = ((i % N) + N) % N; return V3(S[i].x + T[i].z * o, y, S[i].z - T[i].x * o); };
    // pontes: elevação suave da pista (aceita índice fracionário)
    const bridges = def.bridges || [];
    // ponte: 3,4 m de altura, tabuleiro plano em ±6 nós e rampas suaves até ±18 nós (~75 m de cada lado)
    const BR = tr.BR = { H: 3.4, FLAT: 6, END: 18, RAIL: W + 2.1 };
    const bump = tr.bump = u => { let h = 0; for (const b of bridges) { const d = Math.abs(((u - b) % N + N + N / 2) % N - N / 2); h = Math.max(h, d <= BR.FLAT ? BR.H : d >= BR.END ? 0 : BR.H * (0.5 + 0.5 * Math.cos(Math.PI * (d - BR.FLAT) / (BR.END - BR.FLAT)))); } return h; };
    const nearTrack = (p, m) => { for (let i = 0; i < N; i += 3) if (Math.hypot(S[i].x - p.x, S[i].z - p.z) < m) return true; return false; };
    const inside = (x, z) => { let c = false; for (let i = 0, j = N - 1; i < N; j = i++) { const a = S[i], b = S[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
    tr.nearTrack = nearTrack;
    const add = (o) => { scene.add(o); return o; };
    const LACC = [0]; for (let i = 1; i <= N; i++) LACC.push(LACC[i - 1] + S[i - 1].distanceTo(S[i % N]));

    // ---------- consulta de posição na pista ----------
    tr.nearest = (p, hint) => {
      let best = 1e18, bi = hint || 0; const base = bi;
      for (let d = -25; d <= 25; d++) { const i = (base + d + N) % N, dx = S[i].x - p.x, dz = S[i].z - p.z, q = dx * dx + dz * dz; if (q < best) { best = q; bi = i; } }
      // fração dentro do trecho [i, i+1]
      let i = bi, f = 0; const a = S[bi], tA = T[bi], da = (p.x - a.x) * tA.x + (p.z - a.z) * tA.z;
      if (da < 0) i = (bi - 1 + N) % N;
      const s0 = S[i], s1 = S[(i + 1) % N], sx = s1.x - s0.x, sz = s1.z - s0.z, sl = sx * sx + sz * sz || 1;
      f = Math.max(0, Math.min(1, ((p.x - s0.x) * sx + (p.z - s0.z) * sz) / sl));
      const qx = s0.x + sx * f, qz = s0.z + sz * f, dist = Math.hypot(p.x - qx, p.z - qz);
      const lat = (p.x - qx) * T[i].z - (p.z - qz) * T[i].x;
      return { i, f, dist, lat };
    };

    // ---------- faixas ao longo da pista (UV em metros, cor por vértice) ----------
    function strip(a, b, y, o) {
      const nx = o.nx || 1, pos = [], col = [], uv = [], idx = [], C = nx + 1, cc = new THREE.Color();
      for (let i = 0; i <= N; i++) { const k = i % N;
        for (let c = 0; c <= nx; c++) { const f = c / nx, off = a + (b - a) * f, p = side(k, off, y + (o.flat ? 0 : bump(k))); pos.push(p.x, p.y, p.z);
          uv.push((o.flipU ? 1 - f : f) * o.uSpan, LACC[i] / o.vLen);
          const v = o.col ? o.col(k, f) : 1; if (typeof v === 'number') cc.setRGB(v, v, v); else cc.setRGB(v[0], v[1], v[2]); col.push(cc.r, cc.g, cc.b); } }
      for (let i = 0; i < N; i++) { if (o.skip && o.skip(i)) continue; for (let c = 0; c < nx; c++) { const p0 = i * C + c, p1 = p0 + C; idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: o.map });
      if (o.alphaTest) m.alphaTest = o.alphaTest;
      if (o.po) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = o.po; }
      const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; return add(mesh);
    }
    // parede vertical ao longo da pista (meio-fio da cidade)
    function vstrip(o, y0, y1, color, skip) {
      const pos = [], idx = [];
      for (let i = 0; i <= N; i++) { const a = side(i % N, o, y0 + bump(i % N)), b = side(i % N, o, y1 + bump(i % N)); pos.push(a.x, a.y, a.z, b.x, b.y, b.z); }
      for (let i = 0; i < N; i++) { if (skip && skip(i)) continue; const p = i * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      return add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })));
    }
    // chão grande com variação de cor por vértice (esconde a repetição do ladrilho)
    function groundPlane(texName, tile, tint, y) {
      const t = TX.get(texName, GS / tile, GS / tile), g = new THREE.PlaneGeometry(GS, GS, 200, 200), p = g.attributes.position, c = [];
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = -p.getY(i);
        const m = 0.9 + 0.06 * Math.sin(x * 0.013 + 1.3) * Math.cos(z * 0.011) + 0.05 * Math.sin(x * 0.034 + z * 0.029) + 0.03 * Math.sin(x * 0.071 - z * 0.064 + 2);
        const h = Math.sin(x * 0.009 - z * 0.012 + 0.7) * 0.5 + 0.5; c.push(m * (1 + tint * h), m, m * (1 - tint * 1.4 * h)); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: t, vertexColors: true })); mesh.rotation.x = -Math.PI / 2; mesh.position.y = y || 0; mesh.receiveShadow = true; return add(mesh);
    }
    // instancia uma planta procedural em vários pontos
    function plants(kind, list, leafColor, barkTex, leafTex, opts) {
      if (!list.length) return null;
      const geo = kind === 'palm' ? PLANTS.palm(opts && opts.lean || 0.35) : PLANTS[kind](1);
      const leafM = new THREE.MeshLambertMaterial({ color: leafColor, map: TX.get(leafTex || 'leaf', 1, 1), flatShading: kind !== 'palm', side: THREE.DoubleSide, alphaTest: kind === 'palm' ? 0.5 : 0 });
      const barkM = new THREE.MeshLambertMaterial({ color: 0xffffff, map: TX.get(barkTex || 'bark', 1, 1), flatShading: true });
      const im = new THREE.InstancedMesh(geo, [leafM, barkM], list.length), d = new THREE.Object3D();
      const bh = kind === 'palm' ? [7.5, 3.2] : kind === 'bush' ? [1, 1.4] : kind === 'pine' ? [4.5, 3] : [4.6, 3.2];
      list.forEach((o, i) => { d.position.set(o.x, o.y || 0, o.z); d.rotation.set(0, o.r, 0); d.scale.setScalar(o.s); d.updateMatrix(); im.setMatrixAt(i, d.matrix); tr.blockers.push({ x: o.x, y: (o.y || 0) + bh[0] * o.s, z: o.z, r: bh[1] * o.s }); });
      im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; return add(im);
    }
    const glowSpr = (col, sc, op) => { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op })); p.scale.setScalar(sc); return add(p); };

    // ---------- pista: asfalto, faixas, zebras ----------
    const notBridge = i => bump(i) > 0.02 || bump((i + 1) % N) > 0.02;
    // túnel (só a cidade tem): 1 = dentro, 0 = fora, com transição suave de ~4 nós nas bocas
    const tunDef = def.tunnel;
    const inTun = (i, pad) => { if (!tunDef) return false; const d = ((i - tunDef[0] + N) % N); return d >= -pad && d <= tunDef[1] - tunDef[0] + pad || d >= N - pad; };
    const tunShade = u => { if (!tunDef) return 0; const L0 = tunDef[0], L1 = tunDef[1]; let d = ((u - L0) % N + N) % N; if (d > N / 2) d -= N;
      const inside = Math.min(d, L1 - L0 - d); return sm((inside + 1) / 4); };
    const asphaltTint = theme === 'beach' ? [1.04, 1.0, 0.94] : theme === 'city' ? [0.86, 0.86, 0.9] : [1, 1, 1.02];
    strip(-W, W, 0.05, { nx: 8, map: TX.get('asphalt'), uSpan: 2 * W / 7, vLen: 7, col: (i, f) => { const v = 1 - 0.1 * Math.exp(-Math.pow((f - 0.5) / 0.2, 2)) + 0.04 * Math.sin(i * 0.21) * Math.sin(i * 0.057) + 0.04 * Math.pow(Math.abs(f - 0.5) * 2, 6); return asphaltTint.map(k => v * k * (1 - 0.55 * tunShade(i))); } });
    [-1, 1].forEach(s => strip(s * (W - 0.85), s * (W - 0.4), 0.06, { map: TX.get('paint'), uSpan: 0.2, vLen: 3, po: -2 }));
    if (theme === 'city') {
      [-0.45, 0.25].forEach(o => strip(o, o + 0.2, 0.07, { map: TX.get('paintYellow'), uSpan: 0.1, vLen: 3, po: -2 }));           // faixa dupla amarela
      [-W / 2, W / 2].forEach(o => strip(o - 0.15, o + 0.15, 0.07, { map: TX.get('paint'), uSpan: 0.1, vLen: 3, po: -2, skip: i => !((Math.floor(i / 3) % 2)) }));
    } else strip(-0.22, 0.22, 0.09, { map: TX.get('paint'), uSpan: 0.1, vLen: 3, po: -2, skip: i => !((Math.floor(i / 5) % 2)) });
    if (theme === 'city') {                                    // meio-fio cinza/amarelo + calçadão de ondas
      const tsh = i => 1 - 0.5 * tunShade(i);
      strip(W, W + 1.8, 0.16, { map: TX.get('curbGray'), uSpan: 1, vLen: 4, col: tsh }); strip(-W - 1.8, -W, 0.16, { map: TX.get('curbGray'), uSpan: 1, vLen: 4, flipU: true, col: tsh });
      vstrip(W, 0.04, 0.16, 0x9a9aa2); vstrip(-W, 0.04, 0.16, 0x9a9aa2);
      strip(W + 1.8, W + 7.5, 0.16, { nx: 2, map: TX.get('calcadao'), uSpan: 5.7 / 4, vLen: 4, flat: true, col: tsh });
      strip(-W - 7.5, -W - 1.8, 0.16, { nx: 2, map: TX.get('calcadao'), uSpan: 5.7 / 4, vLen: 4, flat: true, col: tsh });
      vstrip(W + 7.5, 0, 0.16, 0x9a9aa2); vstrip(-W - 7.5, 0, 0.16, 0x9a9aa2);
    } else {
      strip(W, W + 1.8, 0.085, { map: TX.get('curb'), uSpan: 1, vLen: 4 }); strip(-W - 1.8, -W, 0.085, { map: TX.get('curb'), uSpan: 1, vLen: 4, flipU: true });
      const shoulder = theme === 'beach' ? 'sandEdge' : 'dirt';
      strip(W + 1.8, W + 5.2, 0.035, { map: TX.get(shoulder), uSpan: 1, vLen: 5, alphaTest: 0.5, skip: notBridge, flat: true });
      strip(-W - 5.2, -W - 1.8, 0.035, { map: TX.get(shoulder), uSpan: 1, vLen: 5, alphaTest: 0.5, skip: notBridge, flat: true, flipU: true });
    }

    // ---------- linha de largada + pórtico ----------
    const si = def.startIdx, sAng = Math.atan2(T[si].x, T[si].z);
    { const line = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 2.4), new THREE.MeshLambertMaterial({ map: TX.get('startLine'), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
      line.rotation.x = -Math.PI / 2; const g = new THREE.Group(); g.add(line); g.position.set(S[si].x, 0.1 + bump(si), S[si].z); g.rotation.y = sAng; line.receiveShadow = true; add(g); }
    // marcas do grid de largada
    const mPerNode = L.length / N; tr.gridNode = m => -Math.round(m / mPerNode);
    tr.grid = (CFG.GRID || [[10, -4], [17, 4]]).map(([m, lat]) => [tr.gridNode(m), lat]);
    { const gm = new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }), gg = new THREE.PlaneGeometry(3.6, 0.35);
      tr.grid.forEach(([di, lat]) => { const th = Math.atan2(T[(si + di + N) % N].x, T[(si + di + N) % N].z), p = side(si + di, lat, 0.075 + bump((si + di + N) % N));
        const m = new THREE.Mesh(gg, gm); m.rotation.x = -Math.PI / 2; const g = new THREE.Group(); g.position.copy(p); g.rotation.y = th; m.position.z = 2.2; g.add(m); add(g); }); }
    // Pórtico de largada 3D: duas torres treliçadas, viga treliçada no topo, painel pendurado com o nome do jogo
    // em LETRAS 3D (traços extrudados, sem imagem e sem arquivo de fonte), faixa quadriculada de cubos,
    // lâmpadas no contorno do painel (acendem à noite) e o semáforo de largada embaixo.
    const arch = new THREE.Group(); arch.position.set(S[si].x, bump(si), S[si].z); arch.rotation.y = sAng; add(arch);
    const AW = W + 3.2, archFlags = [];
    { const UP = V3(0, 1, 0), tmpQ = new THREE.Quaternion();
      const put = (o, x, y, z, cast) => { o.position.set(x, y, z); o.castShadow = cast !== false; arch.add(o); return o; };
      const gadd = (g, m, x, y, z) => put(new THREE.Mesh(g, m), x, y, z);
      // barra cilíndrica entre dois pontos (treliças)
      const bar = (ax, ay, az, bx, by, bz, r, m, parent) => { const d = V3(bx - ax, by - ay, bz - az), L = d.length(), o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 8), m);
        o.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); o.quaternion.copy(tmpQ.setFromUnitVectors(UP, d.normalize())); o.castShadow = true; (parent || arch).add(o); return o; };
      const red = new THREE.MeshLambertMaterial({ color: 0xff3d5a }), white = new THREE.MeshLambertMaterial({ color: 0xf4f4fa }), yellow = new THREE.MeshLambertMaterial({ color: 0xffd23f });
      const ink = new THREE.MeshLambertMaterial({ color: 0x2a1d4a }), concrete = new THREE.MeshLambertMaterial({ map: TX.get('rock', 2, 2), color: 0xd8d8e0 });
      const TOP = 14.6, P = 0.8;                                         // altura das torres e meia-largura da treliça
      // ---- torres ----
      [-1, 1].forEach(sd => { const x = sd * AW;
        gadd(GEO.rbox(3.4, 1.2, 3.4, 0.3), concrete, x, 0.6, 0);
        gadd(GEO.rbox(2.6, 0.35, 2.6, 0.1), yellow, x, 1.3, 0);
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([i, j]) => bar(x + i * P, 1.3, j * P, x + i * P, TOP, j * P, 0.16, red));
        for (let y = 1.3, k = 0; y < TOP - 0.5; y += 1.9, k++) {
          const y2 = Math.min(TOP, y + 1.9);
          [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]].forEach(([i0, j0, i1, j1]) => {
            bar(x + i0 * P, y2, j0 * P, x + i1 * P, y2, j1 * P, 0.08, white);                                   // travessa
            const f = k % 2 ? 1 : -1; bar(x + i0 * P, f > 0 ? y : y2, j0 * P, x + i1 * P, f > 0 ? y2 : y, j1 * P, 0.07, white); });   // diagonal em zigue-zague
        }
        gadd(GEO.rbox(2.4, 0.5, 2.4, 0.18), yellow, x, TOP + 0.2, 0);
        gadd(new THREE.SphereGeometry(0.55, 20, 14), new THREE.MeshLambertMaterial({ color: 0xff4a1c, emissive: 0x5a1000 }), x, TOP + 0.95, 0);
        bar(x, TOP + 0.4, 0, x, TOP + 4.4, 0, 0.07, white);
        const fg = new THREE.PlaneGeometry(3.2, 2.1, 16, 8); fg.translate(1.6, 0, 0);
        const fl = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: TX.get('checker'), side: THREE.DoubleSide })); fl.userData.dynamic = true; fl.position.set(x, TOP + 3.2, 0); fl.rotation.y = sd > 0 ? Math.PI * 0.5 : -Math.PI * 0.5; arch.add(fl);
        archFlags.push({ g: fg, base: fg.attributes.position.array.slice(), ph: sd }); });
      // ---- viga treliçada (seção triangular) entre as torres ----
      const BY = 13.0, BH = 1.5, BL = AW - P;
      [[-0.7, BY], [0.7, BY], [0, BY + BH]].forEach(([z, y]) => bar(-BL, y, z, BL, y, z, 0.14, red));
      for (let x = -BL, k = 0; x < BL - 0.1; x += 1.8, k++) { const x2 = Math.min(BL, x + 1.8), xa = k % 2 ? x : x2, xb = k % 2 ? x2 : x;
        bar(xa, BY, -0.7, xb, BY + BH, 0, 0.06, white); bar(xa, BY, 0.7, xb, BY + BH, 0, 0.06, white); bar(x2, BY, -0.7, x2, BY, 0.7, 0.06, white); }
      // ---- painel pendurado ----
      const PW = 2 * AW - 5, PH = 4.4, PY = 10.0, PD = 0.9;
      [-0.42, 0.42].forEach(f => bar(f * PW, PY + PH / 2 - 0.2, 0, f * PW, BY, 0, 0.09, white));            // tirantes
      gadd(GEO.rbox(PW + 0.6, PH + 0.6, PD, 0.35), ink, 0, PY, 0);                                            // moldura escura
      gadd(GEO.rbox(PW, PH, PD + 0.16, 0.25), red, 0, PY, 0);                                                 // face vermelha (8 cm para fora da moldura)
      // faixa quadriculada de cubos (3D) embaixo do painel, frente e verso
      { const n = Math.floor(PW / 0.55), cube = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const cw = new THREE.InstancedMesh(cube, white, n * 2), cb = new THREE.InstancedMesh(cube, ink, n * 2), d = new THREE.Object3D(); let iw = 0, ib = 0;
        for (let i = 0; i < n; i++) for (let r = 0; r < 2; r++) { d.position.set(-PW / 2 + 0.275 + i * 0.55, PY - PH / 2 - 0.55 - r * 0.5, 0); d.updateMatrix();
          if ((i + r) % 2) cw.setMatrixAt(iw++, d.matrix); else cb.setMatrixAt(ib++, d.matrix); }
        cw.count = iw; cb.count = ib; cw.castShadow = cb.castShadow = true; cw.userData.dynamic = cb.userData.dynamic = true; arch.add(cw, cb); }
      // lâmpadas no contorno do painel (instanciadas; acendem à noite via emissive)
      { const bulbM = new THREE.MeshLambertMaterial({ color: 0xfff2c0, emissive: 0xffd27a, emissiveIntensity: 0.15 }); bulbM.userData.unique = true; tr.nightMats.push({ m: bulbM, max: 1, min: 0.15 });
        const pts = []; for (let x = -PW / 2 + 0.4; x <= PW / 2 - 0.4; x += 0.9) [PY + PH / 2 + 0.05, PY - PH / 2 - 0.05].forEach(y => [-1, 1].forEach(sd => pts.push([x, y, sd * (PD / 2 + 0.1)])));
        const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 10, 8), bulbM, pts.length), d = new THREE.Object3D();
        pts.forEach((p, i) => { d.position.set(p[0], p[1], p[2]); d.updateMatrix(); bm.setMatrixAt(i, d.matrix); }); bm.userData.dynamic = true; arch.add(bm); }
      // ---- letreiro em letras 3D: cada letra é um conjunto de traços (retas e curvas) com espessura ----
      // caixa da letra: largura 0,7 x altura 1 (y para cima). Curvas = Catmull-Rom; retas = cilindros com juntas esféricas.
      const GLYPHS = {
        S: { c: [[[0.64, 0.84], [0.47, 0.99], [0.2, 0.97], [0.06, 0.78], [0.18, 0.57], [0.48, 0.46], [0.64, 0.26], [0.53, 0.04], [0.25, 0.0], [0.05, 0.17]]] },
        U: { c: [[[0.06, 1], [0.06, 0.34], [0.15, 0.07], [0.35, 0], [0.55, 0.07], [0.64, 0.34], [0.64, 1]]] },
        P: { l: [[[0.08, 0], [0.08, 1]]], c: [[[0.08, 1], [0.42, 1], [0.63, 0.88], [0.63, 0.64], [0.42, 0.5], [0.08, 0.5]]] },
        E: { l: [[[0.62, 1], [0.08, 1], [0.08, 0], [0.62, 0]], [[0.08, 0.5], [0.5, 0.5]]] },
        R: { l: [[[0.08, 0], [0.08, 1]], [[0.34, 0.5], [0.64, 0]]], c: [[[0.08, 1], [0.42, 1], [0.63, 0.88], [0.63, 0.64], [0.42, 0.5], [0.08, 0.5]]] },
        K: { l: [[[0.08, 0], [0.08, 1]], [[0.64, 1], [0.1, 0.42]], [[0.3, 0.62], [0.64, 0]]] },
        A: { l: [[[0.02, 0], [0.35, 1], [0.68, 0]], [[0.15, 0.36], [0.55, 0.36]]] },
        T: { l: [[[0.0, 1], [0.7, 1]], [[0.35, 1], [0.35, 0]]] },
        C: { c: [[[0.66, 0.82], [0.46, 0.99], [0.2, 0.94], [0.05, 0.66], [0.05, 0.34], [0.2, 0.06], [0.46, 0.0], [0.66, 0.18]]] }
      };
      const letterM = Toon.mat({ color: 0xffd23f, emissive: 0xff9a00, emissiveIntensity: 0 }, { gloss: 0.7, rim: 0.4, sat: 0, key: 'sign3d' });
      letterM.userData.unique = true; tr.nightMats.push({ m: letterM, max: 0.55, min: 0 });
      const text = CFG.GAME_NAME.toUpperCase(), LH = 3.0, R = 0.3, GAP = 0.3 * LH, SP = 0.7 * LH;
      const widthOf = ch => ch === ' ' ? SP : 0.7 * LH;
      const total = [...text].reduce((w, ch, i) => w + widthOf(ch) + (i ? GAP : 0), 0);
      const k3 = Math.min(1, (PW - 1.2) / total);                         // encolhe se o painel for menor que o texto
      const makeText = () => { const g = new THREE.Group(); let x = -total / 2;
        [...text].forEach((ch, i) => { if (i) x += GAP; const gl = GLYPHS[ch];
          if (gl) { const P2 = p => V3(x + p[0] * LH, (p[1] - 0.5) * LH, 0), joint = p => { const s = new THREE.Mesh(new THREE.SphereGeometry(R, 12, 8), letterM); s.position.copy(P2(p)); g.add(s); };
            (gl.l || []).forEach(pl => { pl.forEach(joint); for (let k = 1; k < pl.length; k++) { const a = P2(pl[k - 1]), b = P2(pl[k]); bar(a.x, a.y, a.z, b.x, b.y, b.z, R, letterM, g); } });
            (gl.c || []).forEach(cv => { const curve = new THREE.CatmullRomCurve3(cv.map(P2), false, 'centripetal'); g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, cv.length * 6, R, 10, false), letterM)); joint(cv[0]); joint(cv[cv.length - 1]); }); }
          x += widthOf(ch); });
        g.scale.setScalar(k3); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); Toon.outline(g, 0.05); return g; };
      [-1, 1].forEach(sd => { const t = makeText(); t.position.set(0, PY + 0.05, sd * (PD / 2 + 0.08 + R * 0.6)); if (sd < 0) t.rotation.y = Math.PI; arch.add(t); });
      // ---- semáforo de largada (as esferas continuam em tr.archLamps para o UI acender) ----
      const LY = PY - PH / 2 - 2.0;
      gadd(GEO.rbox(4.6, 1.5, 1.2, 0.35), new THREE.MeshLambertMaterial({ color: 0x1d1f28 }), 0, LY, 0);
      gadd(GEO.rbox(5.0, 0.25, 1.6, 0.1), yellow, 0, LY + 0.85, 0);
      [-1.6, 1.6].forEach(x => bar(x, LY + 0.9, 0, x, PY - PH / 2 - 1.2, 0, 0.07, white));
      tr.archLamps = [-1.4, 0, 1.4].map((x, k) => [-1, 1].map(sd => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 12), new THREE.MeshBasicMaterial({ color: [0x4a1212, 0x4a3c10, 0x12401a][k] })); m.material.userData.unique = true; m.position.set(x, LY, sd * 0.62); m.scale.z = 0.45; arch.add(m);
        const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 16, 1, true, 0, Math.PI), ink); visor.material.side = THREE.DoubleSide; visor.rotation.set(Math.PI / 2, sd > 0 ? 0 : Math.PI, 0); visor.position.set(x, LY + 0.05, sd * 0.75); arch.add(visor); return m; }));
      tr.obstacles.push(...[-1, 1].map(sd => { const p = side(si, sd * AW, 0); return { x: p.x, z: p.z, r: 1.9 }; }));
    }
    tr.animated.push(t => archFlags.forEach(f => { const p = f.g.attributes.position; for (let i = 0; i < p.count; i++) { const x = f.base[i * 3], y = f.base[i * 3 + 1]; p.setZ(i, Math.sin(x * 1.9 - t * 6 + f.ph) * 0.28 * (x / 3.2) + Math.sin(y * 2 + t * 3) * 0.05 * (x / 3.2)); } p.needsUpdate = true; f.g.computeVertexNormals(); }));

    // ---------- plataformas de turbo ----------
    // A seta da textura aponta para +V; o plano deitado (rotation.x = -90°) levava +V para TRÁS da pista.
    // Agora o plano também gira 180° em Z: +V aponta para a frente, e a rolagem segue o sentido da corrida.
    const rbT = TX.get('boostArrows', 1, 2), frT = TX.get('boostFrame', 1, 1, { clamp: true }), PAD_L = 11, PAD_W = 7, pads = tr.pads = [];
    const padGeo = new THREE.PlaneGeometry(PAD_W, PAD_L), arrGeo = new THREE.PlaneGeometry(PAD_W * 0.78, PAD_L * 0.86);
    const frM = new THREE.MeshBasicMaterial({ map: frT, transparent: true, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    const arM = new THREE.MeshBasicMaterial({ map: rbT, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -5 });
    frM.userData.unique = arM.userData.unique = true;
    def.pads.forEach(([i, o]) => { const c = side(i, o, 0.1 + bump(i)), th = Math.atan2(T[i].x, T[i].z);
      const gp = new THREE.Group(); gp.position.copy(c); gp.rotation.y = th; add(gp);
      const ar = new THREE.Mesh(arrGeo, arM); ar.rotation.set(-Math.PI / 2, 0, Math.PI); ar.renderOrder = 1; gp.add(ar);
      const fr = new THREE.Mesh(padGeo, frM); fr.rotation.set(-Math.PI / 2, 0, Math.PI); fr.position.y = 0.02; fr.renderOrder = 2; gp.add(fr);
      const gl = glowSpr(0xffd23f, 11, 0.35); gl.scale.set(10, 3.2, 1); gl.position.set(c.x, c.y + 1, c.z);
      pads.push({ x: c.x, z: c.z, fx: Math.sin(th), fz: Math.cos(th) }); });
    tr.animated.push((t, dt) => { rbT.offset.y = (rbT.offset.y - dt * 1.8) % 1; });
    tr.onPad = p => pads.some(q => { const dx = p.x - q.x, dz = p.z - q.z, al = dx * q.fx + dz * q.fz, la = dx * q.fz - dz * q.fx; return Math.abs(al) < PAD_L / 2 && Math.abs(la) < PAD_W / 2; });

    // ---------- rampas de salto ----------
    const ramps = tr.ramps = [];
    def.ramps.forEach(([i, o, w, len, h]) => {
      const c = side(i, o, 0), fx = T[i].x, fz = T[i].z, th = Math.atan2(fx, fz);
      const g = new THREE.BufferGeometry(), hw = w / 2;
      // cunha: topo inclinado, laterais triangulares e fundo vertical (sobe ao longo de +z local)
      const P = [[-hw, 0, 0], [hw, 0, 0], [hw, h, len], [-hw, h, len], [-hw, 0, len], [hw, 0, len]];
      const F = [[0, 2, 1], [0, 3, 2], [0, 4, 3], [1, 2, 5], [4, 5, 2], [4, 2, 3]], pos = [], uv = [];
      F.forEach((f, k) => f.forEach(j => { pos.push(...P[j]); uv.push(k < 2 ? (P[j][0] + hw) / 4 : P[j][2] / 4, k < 2 ? P[j][2] / 4 : P[j][1] / 2); }));
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
      const mats = new THREE.MeshLambertMaterial({ map: TX.get('stripes', 1, 1), side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, mats); mesh.position.set(c.x, 0.06, c.z); mesh.rotation.y = th; mesh.castShadow = true; mesh.receiveShadow = true; add(mesh);
      // setas de aviso no asfalto antes da rampa
      const ar = new THREE.Mesh(new THREE.PlaneGeometry(w, 3), new THREE.MeshLambertMaterial({ map: TX.get('stripes', w / 4, 1), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }));
      ar.rotation.x = -Math.PI / 2; const ga = new THREE.Group(); ga.position.copy(side(i - 3, o, 0.07)); ga.rotation.y = th; ga.add(ar); add(ga);
      ramps.push({ x: c.x, z: c.z, fx, fz, hw, len, h });
    });
    const rampAt = (p) => { let best = null; for (const r of ramps) { const dx = p.x - r.x, dz = p.z - r.z, a = dx * r.fx + dz * r.fz, l = dx * r.fz - dz * r.fx; if (a >= 0 && a <= r.len && Math.abs(l) <= r.hw) { const hh = 0.06 + r.h * a / r.len; if (!best || hh > best.h) best = { h: hh, slope: r.h / r.len, fx: r.fx, fz: r.fz }; } } return best; };

    // ---------- tema ----------
    let terrain = () => 0, waterTest = () => false;
    tr.WALL = W + 36;
    if (theme === 'classic') ({ terrain, waterTest } = buildClassic());
    else if (theme === 'city') ({ terrain } = buildCity());
    else ({ terrain } = buildBeach());
    const bb = L.bbox; tr.BOUND = Math.max(Math.abs(bb.x0), Math.abs(bb.x1), Math.abs(bb.z0), Math.abs(bb.z1)) + tr.WALL + 10;
    tr.inWater = waterTest;

    // ---------- altura do chão para a física ----------
    tr.groundAt = (p, hint, heading) => {
      const n = tr.nearest(p, hint); let h, exact = false, slope = 0, soft = false;
      if (n.dist <= W + 1.8) {
        const u = n.i + n.f, b = bump(u); h = tr.roadBase + b; exact = b > 0.001;
        const segL = S[n.i].distanceTo(S[(n.i + 1) % N]) || 1, grade = (bump(u + 0.25) - bump(u - 0.25)) / (0.5 * segL);
        const tA = Math.atan2(T[n.i].x, T[n.i].z); slope = grade * Math.cos(wrapA((heading || 0) - tA));
        if (theme === 'city' && n.dist > W) h = Math.max(h, 0.16);
      } else { h = terrain(p.x, p.z, n.dist); if (bump(n.i + n.f) > 0.01) soft = true; }   // fora da pista ao lado da ponte: descida suave
      const r = rampAt(p);
      if (r && r.h >= h - 0.05) { h = r.h; exact = true; soft = false; slope = r.slope * (Math.sin(heading || 0) * r.fx + Math.cos(heading || 0) * r.fz); }
      return { h, exact, slope, soft };
    };

    // ---------- obstáculos sólidos (postes, árvores na calçada...) ----------
    // guarda-corpo da ponte: quem está em cima não cai, quem está fora não "sobe" pela lateral.
    // side: 0 = dentro do tabuleiro, ±1 = fora; se o kart cruzar a linha do guarda-corpo, volta para o lado em que estava.
    tr.rail = (p, hint, prevSide) => {
      if (!bridges.length) return null;
      const n = tr.nearest(p, hint), b = bump(n.i + n.f), R = BR.RAIL, side = Math.abs(n.lat) <= R ? 0 : Math.sign(n.lat);
      if (b < 0.25 || prevSide === undefined || prevSide === null || side === prevSide) return { side, hit: null };
      const want = prevSide === 0 ? Math.sign(n.lat) * (R - 1.3) : prevSide * (R + 1.3), i = n.i, i1 = (i + 1) % N;
      const cx = S[i].x + (S[i1].x - S[i].x) * n.f, cz = S[i].z + (S[i1].z - S[i].z) * n.f, nx = T[i].z, nz = -T[i].x;
      const s = Math.sign(n.lat) || 1;
      return { side: prevSide, hit: { x: cx + nx * want, z: cz + nz * want, nx: nx * s * (prevSide === 0 ? 1 : -1), nz: nz * s * (prevSide === 0 ? 1 : -1) } };
    };
    tr.obstacleHit = (p) => {
      for (const o of tr.obstacles) { const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), R = o.r + 1.4;
        if (o.lowOnly !== undefined && p.y > o.lowOnly) continue;
        if (d < R && d > 1e-4) return { x: o.x + dx / d * R, z: o.z + dz / d * R, nx: -dx / d, nz: -dz / d }; }
      return null;
    };

    // ---------- moedas (sistema mantido, desligado em CFG.COINS_ON) ----------
    tr.coins = [];
    if (CFG.COINS_ON) {
      const cg = new THREE.CylinderGeometry(0.85, 0.85, 0.2, 28); cg.rotateX(Math.PI / 2);
      const cm = new THREE.MeshLambertMaterial({ color: 0xffc81a, emissive: 0x5a3c00 });
      [30, 120, 200, 290, 380, 460].forEach((i0, r) => { for (let k = 0; k < 5; k++) { const i = (i0 + k * 3) % N, q = side(i, (k % 2 ? -4 : 4), 1.35 + bump(i)); const m = new THREE.Mesh(cg, cm); m.userData.dynamic = true; m.position.copy(q); add(m); tr.coins.push({ m, x: q.x, z: q.z, y: q.y, t: 0 }); } });
      tr.animated.push((t, dt) => tr.coins.forEach((c, k) => { if (c.t > 0) { c.t -= dt; if (c.t <= 0) c.m.visible = true; return; } c.m.rotation.y += dt * 3.2; c.m.position.y = c.y + Math.sin(t * 2.5 + k) * 0.15; }));
      tr.collectCoins = (kart) => { tr.coins.forEach(c => { if (!c.m.visible) return; const dx = kart.pos.x - c.x, dz = kart.pos.z - c.z; if (dx * dx + dz * dz < 6.8) { c.m.visible = false; c.t = 9; kart.coins = Math.min(10, kart.coins + 1); kart.events('coin', kart); } }); };
    }

    // ---------- atualização por quadro ----------
    tr.update = (dt, t) => tr.animated.forEach(f => f(t, dt));
    return tr;

    // ===============================================================================
    // CIRCUITO CLÁSSICO: grama, rio com duas pontes, cachoeira, laguinhos, árvores, muro e postes
    // ===============================================================================
    function buildClassic() {
      groundPlane('grass', 7, 0.07);
      // ---- cordilheira em volta do mapa (profundidade): picos low-poly com grama na base, pedra e neve no topo ----
      { const mm = new THREE.MeshLambertMaterial({ map: TX.get('rock', 3, 3), vertexColors: true, flatShading: true });
        const peak = (x, z, rx, h, rz, k) => {
          const g = new THREE.ConeGeometry(1, 1, 18, 7); g.translate(0, 0.5, 0); const p = g.attributes.position, col = [];
          for (let i = 0; i < p.count; i++) { const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), a = Math.atan2(pz, px);
            const rr = py < 0.999 ? 1 + 0.2 * Math.sin(a * 3 + k) + 0.1 * Math.sin(a * 7 + k * 2) + 0.06 * Math.sin(py * 13 + a * 5) : 1;
            const yy = py < 0.999 && py > 0.001 ? py * (1 + 0.12 * Math.sin(a * 5 + k * 3)) : py;
            p.setXYZ(i, px * rr, yy, pz * rr);
            const snow = h > 150 && yy > 0.66, rock = yy > 0.22;
            if (snow) col.push(1.7, 1.75, 1.85); else if (rock) col.push(1, 0.98, 1.02); else col.push(0.62, 1.05, 0.5); }
          g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
          const m = new THREE.Mesh(g, mm); m.scale.set(rx, h, rz); m.position.set(x, -2, z); m.rotation.y = k * 1.7; add(m);
          tr.blockers.push({ x, y: h * 0.3, z, r: Math.min(rx, h) * 0.7 }); };
        const cx = (L.bbox.x0 + L.bbox.x1) / 2, cz = (L.bbox.z0 + L.bbox.z1) / 2;
        const bA0 = bridges[0], RE = { x: S[bA0].x + T[bA0].z * 240, z: S[bA0].z - T[bA0].x * 240 };   // lago no fim do rio
        const nearLake = (x, z, r) => Math.hypot(x - RE.x, z - RE.z) < r + 70;
        for (let k = 0; k < 22; k++) {
          const a = k / 22 * Math.PI * 2 + rnd() * 0.2, r = RAD + 290 + rnd() * 260, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.85;
          if (nearTrack({ x, z }, 330)) continue;
          const h = 110 + rnd() * 170, rx = 120 + rnd() * 110; if (nearLake(x, z, rx)) continue; peak(x, z, rx, h, rx * (0.8 + rnd() * 0.4), k);
          if (rnd() < 0.7) peak(x + Math.cos(a + 1.6) * rx * 0.9, z + Math.sin(a + 1.6) * rx * 0.9, rx * 0.7, h * (0.55 + rnd() * 0.3), rx * 0.6, k + 7);
        }
        // morros verdes mais perto, entre a pista e a cordilheira
        for (let k = 0; k < 16; k++) { const a = rnd() * Math.PI * 2, r = RAD + 120 + rnd() * 140, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.85;
          if (nearTrack({ x, z }, 230) || nearLake(x, z, 150)) continue; peak(x, z, 90 + rnd() * 60, 45 + rnd() * 45, 80 + rnd() * 50, k + 31); }
      }
      const waterM = new THREE.MeshPhongMaterial({ map: TX.get('ripple', 3, 3), vertexColors: true, color: 0xffffff, transparent: true, opacity: 0.74, shininess: 110, specular: 0xffffff, flatShading: true, side: THREE.DoubleSide });
      const bankM = new THREE.MeshLambertMaterial({ map: TX.get('sand'), side: THREE.DoubleSide }), bedM = new THREE.MeshLambertMaterial({ map: TX.get('pebble'), side: THREE.DoubleSide });
      const dcol = e => { const a = new THREE.Color(0.04, 0.28, 0.75), b = new THREE.Color(0.4, 0.9, 0.96), w = new THREE.Color(1, 1, 1); return e < 0.8 ? a.lerp(b, e / 0.8) : b.lerp(w, Math.min(1, (e - 0.8) / 0.2)); };
      // ondulação da água no shader, usando a posição no mundo (rio e lagos compartilham o mesmo material)
      const waterU = { value: 0 };
      waterM.customProgramCacheKey = () => 'water-river'; delete waterM.userData.mergeKey; waterM.userData.unique = true;
      waterM.onBeforeCompile = sh => { sh.uniforms.uT = waterU;
        sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 wpw = modelMatrix * vec4(transformed, 1.0);
          transformed.y += 0.1 * sin(wpw.x * 0.28 + uT * 1.7) + 0.07 * sin(wpw.z * 0.37 - uT * 1.3) + 0.05 * sin((wpw.x + wpw.z) * 0.2 + uT * 2.4);`); };
      const NV = i => V3(T[i].z, 0, -T[i].x), PV = (i, o) => S[i].clone().addScaledVector(NV(i), o);
      const bA = bridges[0], bB = bridges[1], RHW = 7, PROF = [[6, 0.03], [1.2, 0.85], [0, 0.85], [-0.4, 0.14]];
      // ---- rio ----
      const rp = [PV(bB, 74), PV(bB, 64), PV(bB, 45), PV(bB, 0), PV(bB, -45)];
      { const a3 = PV(bA, -45), b3 = rp[4].clone(), dir = a3.clone().sub(b3), len = dir.length(); dir.normalize(); const perp = V3(-dir.z, 0, dir.x);
        for (let k = 1; k <= 5; k++) { const t = k / 6; rp.push(b3.clone().addScaledVector(dir, len * t).addScaledVector(perp, 58 * Math.sin(t * Math.PI) * Math.sin(k * 2.2 + 0.4))); }
        const tA = T[bA]; rp.push(a3, PV(bA, 0), PV(bA, 45), PV(bA, 95), PV(bA, 140).addScaledVector(tA, 35), PV(bA, 190).addScaledVector(tA, -30), PV(bA, 240)); }
      const riverC = new THREE.CatmullRomCurve3(rp, false, 'centripetal'), RM = 260, RL = riverC.getLength(), rpts = [], rtan = [];
      for (let k = 0; k <= RM; k++) rpts.push(riverC.getPointAt(k / RM));
      { // suaviza quinas até o raio mínimo ser maior que a bacia (evita a água vazar da areia)
        const P0 = rpts.map(p => p.clone()), pin = k => k < 3 || k > RM - 2 || bridges.some(b => Math.hypot(P0[k].x - S[b].x, P0[k].z - S[b].z) < 16);
        const curvR = k => { const a = rpts[k - 1], b = rpts[k], c = rpts[k + 1], ar = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2; return ar > 1e-6 ? a.distanceTo(b) * b.distanceTo(c) * a.distanceTo(c) / (4 * ar) : 1e9; };
        const hw0 = k => (k / RM < 0.86 ? RHW : 22) + 6;
        for (let it = 0; it < 1500; it++) { let bad = false; const nx = rpts.map(p => p.clone());
          for (let k = 1; k < RM; k++) { if (pin(k)) continue; const need = curvR(k) < hw0(k) * 1.35 || (k > 1 && curvR(k - 1) < hw0(k - 1) * 1.35) || (k < RM - 1 && curvR(k + 1) < hw0(k + 1) * 1.35);
            if (!need && it > 40) continue; bad = bad || need;
            nx[k].x += 0.5 * ((rpts[k - 1].x + rpts[k + 1].x) / 2 - rpts[k].x); nx[k].z += 0.5 * ((rpts[k - 1].z + rpts[k + 1].z) / 2 - rpts[k].z); }
          rpts.splice(0, rpts.length, ...nx); if (!bad && it > 40) break; }
      }
      for (let k = 0; k <= RM; k++) { const a = rpts[Math.max(0, k - 1)], b = rpts[Math.min(RM, k + 1)]; rtan.push(V3(b.x - a.x, 0, b.z - a.z).normalize()); }
      const hwf = t => { if (t < 0.86) return RHW; const u = (t - 0.86) / 0.14; return u < 0.5 ? RHW + (22 - RHW) * Math.sin(u * Math.PI) : 22 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.5) / 0.5, 2))); };
      const rHW = rpts.map((_, k) => hwf(k / RM));
      const nearRiver = (x, z, m) => rpts.some((p, k) => Math.hypot(p.x - x, p.z - z) < m + rHW[k] - RHW);
      const riverDist = (x, z) => rpts.reduce((a, p, k) => Math.min(a, Math.hypot(p.x - x, p.z - z) - (rHW[k] - RHW)), 1e9);
      function ribbonGeo(hwA, cs, colored) {
        const pos = [], uv = [], col = [], idx = [];
        for (let k = 0; k <= RM; k++) { const p = rpts[k], t = rtan[k], hw = hwA(k / RM);
          for (let c = 0; c <= cs; c++) { const u = c / cs * 2 - 1; pos.push(p.x + t.z * hw * u, 0, p.z - t.x * hw * u); uv.push(c / cs, k / RM * RL / 20); if (colored) { const q = dcol(Math.abs(u)); col.push(q.r, q.g, q.b); } } }
        for (let k = 0; k < RM; k++) for (let c = 0; c < cs; c++) { const a = k * (cs + 1) + c, d = a + cs + 1; idx.push(a, d, a + 1, a + 1, d, d + 1); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        if (colored) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
      }
      { const o = new THREE.Mesh(ribbonGeo(t => Math.max(0, hwf(t) - 0.4), 2, false), bedM); o.position.y = 0.14; add(o); }
      [1, -1].forEach(sg => { const pos = [], uv = [], idx = [];
        for (let k = 0; k <= RM; k++) { const p = rpts[k], t = rtan[k], hw = rHW[k]; PROF.forEach(([d, h], c) => { pos.push(p.x + t.z * sg * (hw + d), h, p.z - t.x * sg * (hw + d)); uv.push(c * 0.6, k / RM * RL / 3); }); }
        for (let k = 0; k < RM; k++) for (let c = 0; c < 3; c++) { const a = k * 4 + c, d = a + 4; idx.push(a, d, a + 1, a + 1, d, d + 1); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
        const m = new THREE.Mesh(g, bankM); m.receiveShadow = true; add(m); });
      const riverGeo = ribbonGeo(t => Math.max(0, hwf(t) - 0.15), 8, true); riverGeo.translate(0, 0.45, 0); add(new THREE.Mesh(riverGeo, waterM));
      tr.minimap.push({ type: 'river', pts: rpts.map((p, k) => [p.x, p.z, rHW[k]]) });
      // ---- pontes: laterais, laje por baixo, pilares de pedra e guarda-corpo (sólido: ver tr.rail) ----
      const WHm = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }), REm = new THREE.MeshLambertMaterial({ color: 0xee3b3b });
      const conc = new THREE.MeshLambertMaterial({ map: TX.get('concrete', 1, 1), color: 0xb8b8c4, side: THREE.DoubleSide });
      const pierM = new THREE.MeshLambertMaterial({ map: TX.get('rock', 1, 3), flatShading: true });
      bridges.forEach(bi => {
        const dOf = i => Math.abs(i - bi);
        // laterais: nas rampas descem até o chão; sobre o rio viram uma viga de 1,1 m
        [W + 1.8, -W - 1.8].forEach(o => { const pos = [], uv = [];
          for (let i = bi - BR.END; i < bi + BR.END; i++) { const lo = j => dOf(j) <= BR.FLAT + 1 ? bump(j) - 1.1 : 0.02;
            const a = side(i, o, bump(i) + 0.05), b = side(i + 1, o, bump(i + 1) + 0.05), c = side(i, o, lo(i)), d = side(i + 1, o, lo(i + 1));
            [a, b, d, a, d, c].forEach(p => pos.push(p.x, p.y, p.z)); [[0, 1], [1, 1], [1, 0], [0, 1], [1, 0], [0, 0]].forEach(q => uv.push(q[0], q[1])); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
          const m = new THREE.Mesh(g, conc); m.castShadow = m.receiveShadow = true; add(m); });
        // laje por baixo do tabuleiro (vista de dentro do rio)
        { const pos = []; for (let i = bi - BR.FLAT - 1; i < bi + BR.FLAT + 1; i++) { const y0 = bump(i) - 1.1, y1 = bump(i + 1) - 1.1;
            const a = side(i, -W - 1.8, y0), b = side(i + 1, -W - 1.8, y1), c = side(i, W + 1.8, y0), d = side(i + 1, W + 1.8, y1); [a, b, d, a, d, c].forEach(p => pos.push(p.x, p.y, p.z)); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); add(new THREE.Mesh(g, conc)); }
        // pilares de pedra apoiando o vão
        [-3, 3].forEach(di => [-1, 1].forEach(sd => { const i = bi + di, p = side(i, sd * (W * 0.55), 0), h = bump(i) - 1.1;
          const pl = new THREE.Mesh(GEO.rbox(2.6, h + 0.6, 2.6, 0.5, 2), pierM); pl.position.set(p.x, (h + 0.6) / 2 - 0.6, p.z); pl.rotation.y = Math.atan2(T[i].x, T[i].z); pl.castShadow = true; add(pl);
          tr.obstacles.push({ x: p.x, z: p.z, r: 1.4, lowOnly: h }); }));
        // guarda-corpo vermelho e branco, mais alto (1,6 m)
        for (let i = bi - BR.END; i <= bi + BR.END; i += 2) [-1, 1].forEach(sd => { if (bump(i) < 0.25 && bump(i + 2) < 0.25) return;
          const p = side(i, sd * BR.RAIL, bump(i) + 0.8), q = side(i + 2, sd * BR.RAIL, bump(i + 2) + 0.8);
          const b = new THREE.Mesh(GEO.rbox(0.6, 1.6, p.distanceTo(q) + 0.05, 0.14, 2), (i / 2) % 2 ? REm : WHm); b.position.set((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2); b.rotation.y = Math.atan2(q.x - p.x, q.z - p.z); b.rotation.x = -Math.atan2(q.y - p.y, Math.hypot(q.x - p.x, q.z - p.z)); b.castShadow = true; add(b); });
      });
      // ---- cachoeira descendo de uma montanha de pedra ----
      // paredão de ~45 m na frente (de onde a água cai) + montanha em domo logo atrás + morros laterais
      const FD = NV(bB), TB = V3(FD.z, 0, -FD.x), F = PV(bB, 62);
      const mkFall = (rep) => { const c = TX.cvs(32, 128), g = c.getContext('2d'); g.fillStyle = '#6fc8ff'; g.fillRect(0, 0, 32, 128); for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.35 + rnd() * 0.5) + ')'; g.fillRect(rnd() * 30, rnd() * 128, 2 + rnd() * 3, 20 + rnd() * 50); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, rep); return t; };
      const fallT = mkFall(5), fallT2 = mkFall(4);
      // montanhas: [deslocamento ao longo da pista, distância para fora, raio lateral, raio em profundidade, altura]
      const MOUNTS = [[0, 136, 100, 55, 82], [-95, 150, 70, 50, 54], [92, 156, 66, 48, 48]].map(([a, o, rx, rz, h]) => ({ c: F.clone().addScaledVector(TB, a).addScaledVector(FD, o - 62), rx, rz, h }));
      const inMountain = (x, z, m) => MOUNTS.some(M => { const dx = x - M.c.x, dz = z - M.c.z, lx = dx * TB.x + dz * TB.z, lz = dx * FD.x + dz * FD.z; return (lx / (M.rx + m)) ** 2 + (lz / (M.rz + m)) ** 2 < 1; });
      { const wf = new THREE.Group(); wf.position.copy(F).addScaledVector(FD, 3); wf.rotation.y = Math.atan2(-FD.x, -FD.z); add(wf);
        const rockM = new THREE.MeshLambertMaterial({ map: TX.get('rock', 4, 4), flatShading: true }), rock2 = new THREE.MeshLambertMaterial({ map: TX.get('rock', 3, 3), color: 0xc8c4d0, flatShading: true }), mossM = new THREE.MeshLambertMaterial({ map: TX.get('grass', 6, 3) });
        const slab = (w, h, d, m, x, y, z, ry) => { const o = new THREE.Mesh(GEO.rbox(w, h, d, Math.min(2.5, w / 4, h / 4), 2), m); o.position.set(x, y, z); o.rotation.y = ry || 0; o.castShadow = o.receiveShadow = true; wf.add(o); };
        slab(34, 44, 22, rockM, 0, 22, -11);                                                     // paredão principal
        [[-24, 30, 20, -9, 0.15], [24, 36, 18, -10, -0.12], [-38, 20, 24, -14, 0.3], [38, 24, 22, -15, -0.25], [-14, 12, 10, -1.5, 0.1], [15, 9, 10, -1, -0.08], [-7, 5, 7, 1.5, 0.4], [8, 4, 6, 2, -0.3]]
          .forEach(([x, h, w, z, ry]) => slab(w, h, w * 0.9, rock2, x, h / 2, z, ry));             // contrafortes e pedras soltas
        slab(36, 1.6, 23, mossM, 0, 44.6, -11);                                                  // topo com musgo
        slab(11, 2.2, 6, rock2, 0, 44.2, -1.6);                                                  // lábio de onde a água cai
        const s1 = new THREE.Mesh(new THREE.PlaneGeometry(10, 45), new THREE.MeshBasicMaterial({ map: fallT, transparent: true, opacity: 0.9, side: THREE.DoubleSide })); s1.position.set(0, 22.5, 0.4); wf.add(s1);
        const s2 = new THREE.Mesh(new THREE.PlaneGeometry(6, 45), new THREE.MeshBasicMaterial({ map: fallT2, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })); s2.position.set(0.6, 22.5, 1.0); wf.add(s2); }
      // domos de pedra com relevo irregular; cor de vértice esverdeada nas partes mais altas/planas
      const mountM = new THREE.MeshLambertMaterial({ map: TX.get('rock', 10, 5), vertexColors: true, flatShading: true });
      MOUNTS.forEach((M, k) => {
        const g = new THREE.SphereGeometry(1, 30, 16, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position, col = [];
        for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
          const n = 1 + (y < 0.999 ? 0.07 * Math.sin(a * 5 + k) * Math.sin(y * 7) + 0.05 * Math.sin(a * 11 + y * 9 + k * 2) : 0);
          p.setXYZ(i, x * n, y * (1 + 0.06 * Math.sin(a * 3 + k)), z * n);
          const gr = Math.max(0, Math.min(1, (y - 0.55) * 3)); col.push(1 - 0.45 * gr, 1 - 0.05 * gr, 1 - 0.5 * gr); }
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
        const m = new THREE.Mesh(g, mountM); m.scale.set(M.rx, M.h, M.rz); m.position.set(M.c.x, -1.5, M.c.z); m.rotation.y = Math.atan2(FD.x, FD.z);
        m.castShadow = m.receiveShadow = true; add(m); tr.blockers.push({ x: M.c.x, y: M.h * 0.35, z: M.c.z, r: Math.min(M.rx, M.rz) * 0.9 }); });
      // pinheiros no topo do paredão e nas encostas
      { const pines = [];
        for (let k = 0; k < 9; k++) { const p = F.clone().addScaledVector(FD, 3 + 13 + (k % 3) * 4).addScaledVector(TB, (k - 4) * 3.6 + (rnd() - 0.5) * 2); pines.push({ x: p.x, y: 45.2, z: p.z, r: rnd() * 6.28, s: 0.8 + rnd() * 0.4 }); }
        // altura exata da encosta (mesmo relevo aplicado aos vértices do domo), para o pinheiro não flutuar
        const surfY = (M, k, a, e) => { const nf = y => 1 + 0.07 * Math.sin(a * 5 + k) * Math.sin(y * 7) + 0.05 * Math.sin(a * 11 + y * 9 + k * 2);
          let lo = 0, hi = Math.PI / 2; for (let it = 0; it < 30; it++) { const ph = (lo + hi) / 2; if (Math.cos(ph) * nf(Math.sin(ph)) > e) lo = ph; else hi = ph; }
          return M.h * Math.sin(lo) * (1 + 0.06 * Math.sin(a * 3 + k)) - 1.5; };
        MOUNTS.forEach((M, mk) => { for (let k = 0; k < 16; k++) { const a = rnd() * Math.PI * 2, e = 0.45 + rnd() * 0.45, lx = Math.cos(a) * M.rx * e, lz = Math.sin(a) * M.rz * e;
          if (lz < -M.rz * 0.4 && Math.abs(lx) < 30) continue;                                    // não cobre o paredão
          const p = M.c.clone().addScaledVector(TB, lx).addScaledVector(FD, lz); pines.push({ x: p.x, y: surfY(M, mk, a, e) - 1.2, z: p.z, r: rnd() * 6.28, s: 1 + rnd() * 0.5 }); } });
        plants('pine', pines, 0x2a7a3a); }
      const mist = [0, 1, 2, 3].map(k => { const m = glowSpr(0xffffff, 14, 0.35); m.position.copy(F).addScaledVector(FD, -2).add(V3((k - 1.5) * 3 * FD.z, 1.6 + (k % 2) * 1.2, -(k - 1.5) * 3 * FD.x)); return m; });
      // ---- laguinhos com contorno próprio ----
      const PNA = 96, ponds = tr.ponds;
      function pondShape(r) { const el = 0.55 + rnd() * 0.9, rot = rnd() * 6.2832, H = [[2, 0.05 + rnd() * 0.16], [3, 0.03 + rnd() * 0.12], [4, 0.01 + rnd() * 0.06], [6, 0.005 + rnd() * 0.03]].map(([k, a]) => [k, a, rnd() * 6.2832]);
        const tab = []; for (let k = 0; k < PNA; k++) { const a = k / PNA * 6.2832, c = Math.cos(a - rot), s = Math.sin(a - rot); let f = 1 / Math.sqrt(c * c / el + s * s * el); H.forEach(([n, am, ph]) => f *= 1 + am * Math.sin(n * a + ph)); tab.push(Math.max(0.45, f) * r); }
        for (let it = 0; it < 2; it++) for (let k = 0; k < PNA; k++) tab[k] = (tab[(k + PNA - 1) % PNA] + 2 * tab[k] + tab[(k + 1) % PNA]) / 4;
        const R = a => { const u = ((a / 6.2832) % 1 + 1) % 1 * PNA, i = Math.floor(u) % PNA, j = (i + 1) % PNA, f = u - Math.floor(u); return tab[i] * (1 - f) + tab[j] * f; };
        return { R, rmax: Math.max(...tab) }; }
      const pondEdge = (p, x, z) => Math.hypot(x - p.x, z - p.z) - p.R(Math.atan2(z - p.z, x - p.x));
      function tryPond(x, z, r) { const sh = pondShape(r);
        if (nearTrack({ x, z }, sh.rmax + W + 10) || nearRiver(x, z, sh.rmax + 22) || Math.hypot(x - F.x, z - F.z) < sh.rmax + 40 || inMountain(x, z, sh.rmax + 8)) return false;
        if (ponds.some(q => Math.hypot(q.x - x, q.z - z) < q.r + sh.rmax + 16)) return false;
        ponds.push({ x, z, r: sh.rmax, R: sh.R }); return true; }
      { const cand = []; for (let x = -320; x <= 320; x += 10) for (let z = -320; z <= 320; z += 10) { if (!inside(x, z)) continue; let md = 1e9; for (let i = 0; i < N; i += 2) md = Math.min(md, Math.hypot(S[i].x - x, S[i].z - z)); md = Math.min(md, riverDist(x, z) + W - 6); cand.push({ x, z, md }); }
        cand.sort((a, b) => b.md - a.md); let made = 0; for (const c of cand) { if (made >= 2) break; const r = Math.min(made ? 20 : 32, (c.md - W - 14) / 1.35); if (r > 9 && tryPond(c.x + (rnd() - 0.5) * 10, c.z + (rnd() - 0.5) * 10, r)) made++; } }
      [[110, 1], [205, -1], [360, 1], [455, -1], [30, 1], [300, 1], [160, 1], [420, 1]].forEach(([i, sd]) => { const r = 8 + rnd() * 16; for (const off of [W + 26, W + 42, W + 60, W + 80]) { const q = side(i, sd * (off + r), 0); if (tryPond(q.x, q.z, r)) break; } });
      const polyStrip = (rows, cols, pt) => { const pos = [], uv = [], idx = []; for (let k = 0; k <= rows; k++) for (let c = 0; c < cols; c++) { const q = pt(k % rows, c); pos.push(q[0], q[1], q[2]); uv.push(q[3] || 0, q[4] || 0); }
        for (let k = 0; k < rows; k++) for (let c = 0; c < cols - 1; c++) { const a = k * cols + c, d = a + cols; idx.push(a, d, a + 1, a + 1, d, d + 1); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g; };
      const WRING = [0, 0.16, 0.32, 0.48, 0.62, 0.74, 0.84, 0.92, 0.97, 1];
      ponds.forEach(p => { const ang = k => k / PNA * 6.2832;
        const bk = new THREE.Mesh(polyStrip(PNA, 4, (k, c) => { const a = ang(k), R = p.R(a), [d, h] = PROF[c]; return [p.x + Math.cos(a) * (R + d), h, p.z + Math.sin(a) * (R + d), c * 0.6, k / PNA * R * 6.2832 / 3]; }), bankM); bk.receiveShadow = true; add(bk);
        add(new THREE.Mesh(polyStrip(PNA, 2, (k, c) => { const a = ang(k), R = (p.R(a) - 0.4) * c; return [p.x + Math.cos(a) * R, 0.14, p.z + Math.sin(a) * R, Math.cos(a) * R / 6, Math.sin(a) * R / 6]; }), bedM));
        const pos = [], uv = [], col = [], idx = [], C = WRING.length;
        for (let k = 0; k <= PNA; k++) { const a = ang(k % PNA), R = p.R(a) - 0.15; WRING.forEach(f => { const x = Math.cos(a) * R * f, z = Math.sin(a) * R * f; pos.push(x, 0.45, z); uv.push(x / 9, z / 9); const q = dcol(f); col.push(q.r, q.g, q.b); }); }
        for (let k = 0; k < PNA; k++) for (let c = 0; c < C - 1; c++) { const a = k * C + c, d = a + C; idx.push(a, a + 1, d, a + 1, d + 1, d); }
        const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); gg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); gg.setIndex(idx); gg.computeVertexNormals();
        const d = new THREE.Mesh(gg, waterM); d.position.set(p.x, 0, p.z); add(d);
        tr.minimap.push({ type: 'pond', poly: Array.from({ length: 48 }, (_, k) => { const a = k / 48 * 6.2832, R = p.R(a); return [p.x + Math.cos(a) * R, p.z + Math.sin(a) * R]; }) }); });
      tr.animated.push((t, dt) => {
        waterM.color.setHSL(0.55 + 0.02 * Math.sin(t * 0.8), 0.35, 0.88 + 0.06 * Math.sin(t * 1.7)); waterM.opacity = 0.74 + 0.05 * Math.sin(t * 2.3);
        waterU.value = t;
        waterM.map.offset.x += dt * 0.03; waterM.map.offset.y -= dt * 0.1; fallT.offset.y -= dt * 2.6; fallT2.offset.y -= dt * 3.4;
        mist.forEach((m, i) => { m.material.opacity = 0.3 + 0.15 * Math.sin(t * 2 + i * 2); m.scale.setScalar(13 + 3 * Math.sin(t * 1.5 + i)); });
      });
      const okSpot = (x, z, m) => !ponds.some(p => pondEdge(p, x, z) < m) && bridges.every(b => Math.hypot(x - S[b].x, z - S[b].z) > 40) && !nearRiver(x, z, 14) && Math.hypot(x - F.x, z - F.z) > 45 && !inMountain(x, z, m + 4) && Math.hypot(x - S[si].x, z - S[si].z) > 22;
      // ---- postes de luz ----
      for (let i = 15; i < N; i += 50) { if (bridges.some(b => Math.abs(i - b) < 14)) continue;
        const q = side(i, ((i / 50 | 0) % 2 ? 1 : -1) * (W + 4), 0);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 6, 8), new THREE.MeshLambertMaterial({ color: 0x2a2c33 })); pole.position.set(q.x, 3, q.z); pole.castShadow = true; add(pole);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff2b0 })); bulb.position.set(q.x, 6.2, q.z); add(bulb);
        const h = glowSpr(0xffe08a, 9, 0.9); h.position.copy(bulb.position); tr.lamps.push(h); tr.obstacles.push({ x: q.x, z: q.z, r: 0.3 }); }
      // ---- muro azul e amarelo ----
      if (def.wall) for (let i = def.wall[0]; i < def.wall[1]; i += 2) { const a = side(i, -(W + 5), 0), b = side(i + 2, -(W + 5), 0), len = a.distanceTo(b);
        const w = new THREE.Mesh(GEO.rbox(0.8, 3, len + 0.1, 0.2, 2), new THREE.MeshLambertMaterial({ color: (i / 2) % 2 ? 0x3a5fe0 : 0xffd21a, map: TX.get('brick') })); w.position.set((a.x + b.x) / 2, 1.5, (a.z + b.z) / 2); w.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); w.castShadow = true; add(w); }
      // ---- árvores: fileiras na beira da pista, "muro" de árvores no limite e bosques ----
      const lists = { round: [], dark: [], pine: [], autumn: [], bush: [] }, kinds = ['round', 'dark', 'pine', 'autumn'];
      for (let i = 0; i < N; i += 5) [1, -1].forEach((sd, k) => { const q = side(i, sd * (W + 14 + (i % 10 ? 0 : 5)), 0); if (okSpot(q.x, q.z, 6)) lists[kinds[(Math.floor(i / 62) + k * 2) % 4]].push({ x: q.x, z: q.z, r: rnd() * 6.28, s: 0.9 + rnd() * 0.35 }); });
      for (let i = 0; i < N; i += 4) [1, -1].forEach(sd => { const q = side(i, sd * (tr.WALL + 6 + rnd() * 14), 0); if (!nearTrack(q, tr.WALL + 3) && okSpot(q.x, q.z, 6)) lists[kinds[(rnd() * 4) | 0]].push({ x: q.x, z: q.z, r: rnd() * 6.28, s: 1 + rnd() * 0.5 }); });
      for (let gc = 0, t = 0; gc < 16 && t < 1500; t++) { const c = { x: (rnd() - 0.5) * 840, z: (rnd() - 0.5) * 840 }; if (nearTrack(c, W + 45) || !nearTrack(c, 110) || !okSpot(c.x, c.z, 25)) continue;
        const kind = kinds[gc % 4]; for (let k = 0; k < 11; k++) { const r = 4 + Math.sqrt(k) * 5.5, a = k * 2.4; lists[kind].push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, r: rnd() * 6.28, s: 0.9 + rnd() * 0.5 }); } gc++; }
      for (let c = 0; c < 60; c++) { const i = Math.floor(rnd() * N), sd = rnd() > 0.5 ? 1 : -1; for (let k = 0; k < 3; k++) { const q = side(i + k * 3, sd * (W + 7 + rnd() * 6), 0); if (okSpot(q.x, q.z, 3)) lists.bush.push({ x: q.x, z: q.z, r: rnd() * 6.28, s: 0.8 + rnd() * 0.6 }); } }
      plants('round', lists.round, 0x4fae3a); plants('round', lists.dark, 0x2f8a35); plants('pine', lists.pine, 0x2a7a3a); plants('round', lists.autumn, 0xe8892f); plants('bush', lists.bush, 0x3f9e2c);
      // ---- tufos de grama ----
      { const tuftG = new THREE.ConeGeometry(0.3, 1.5, 4); tuftG.translate(0, 0.75, 0); const dm = new THREE.Object3D();
        [0x3f9e2c, 0x62c648].forEach(col => { const cnt = 1600, im = new THREE.InstancedMesh(tuftG, new THREE.MeshLambertMaterial({ color: col, flatShading: true }), cnt); let n = 0;
          for (let t = 0; n < cnt && t < cnt * 8; t++) { let x, z; if (rnd() < 0.6) { const q = side(Math.floor(rnd() * N), (rnd() > 0.5 ? 1 : -1) * (W + 5.5 + rnd() * 30), 0); x = q.x; z = q.z; } else { x = (rnd() - 0.5) * 800; z = (rnd() - 0.5) * 800; }
            if (nearTrack({ x, z }, W + 5) || !okSpot(x, z, 2)) continue;
            for (let k = 0; k < 3 && n < cnt; k++) { dm.position.set(x + (rnd() - 0.5) * 1.4, 0, z + (rnd() - 0.5) * 1.4); dm.rotation.set((rnd() - 0.5) * 0.3, rnd() * 6.28, (rnd() - 0.5) * 0.3); dm.scale.set(0.7 + rnd() * 0.8, 0.6 + rnd(), 0.7 + rnd() * 0.8); dm.updateMatrix(); im.setMatrixAt(n++, dm.matrix); } }
          im.count = n; im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; add(im); }); }
      // ---- terreno: bacia de areia dos lagos e do rio ----
      const bprof = (d, R) => d > R + 6 ? 0 : d > R + 1.2 ? 0.03 + 0.82 * (R + 6 - d) / 4.8 : d > R ? 0.85 : d > R - 0.4 ? 0.14 + 0.71 * (d - (R - 0.4)) / 0.4 : 0.14;
      const terrain = (x, z) => { let h = 0; for (const q of ponds) h = Math.max(h, bprof(Math.hypot(x - q.x, z - q.z), q.R(Math.atan2(z - q.z, x - q.x))));
        let md = 1e9, mk = 0; for (let k = 0; k < rpts.length; k++) { const d = Math.hypot(rpts[k].x - x, rpts[k].z - z); if (d < md) { md = d; mk = k; } } return Math.max(h, bprof(md, rHW[mk])); };
      const waterTest = p => { if (bridges.some(b => { const dx = p.x - S[b].x, dz = p.z - S[b].z; return Math.abs(dx * T[b].x + dz * T[b].z) < 30 && Math.abs(dx * T[b].z - dz * T[b].x) < W + 2.1; })) return false;
        return ponds.some(q => pondEdge(q, p.x, p.z) < 0) || nearRiver(p.x, p.z, RHW - 0.5); };
      tr.dustColor = 0xc9a878;
      return { terrain, waterTest };
    }

    // ===============================================================================
    // CIDADE BRASILEIRA: prédios coloridos com caixas-d'água, calçadão de ondas, postes, semáforos,
    // orelhões, bancas, ipês, bandeirinhas de festa junina e morros com casinhas ao fundo
    // ===============================================================================
    function buildCity() {
      groundPlane('concrete', 8, 0.02);
      tr.WALL = W + 8.6;
      // =========================================================================
      // TÚNEL + LINHA DE TREM ELEVADA: a avenida passa por baixo; o trem cruza por cima, no meio do túnel
      // =========================================================================
      const TUN = def.tunnel, TW = W + 9.8, TH = 9, RF = 1.6, RY = TH + RF + 0.7;   // largura interna, altura livre, laje, topo dos trilhos
      const tunC = Math.round((TUN[0] + TUN[1]) / 2), RDIR = V3(T[tunC].z, 0, -T[tunC].x), RC = side(tunC, 0, 0), RLEN = 900;
      // cada ponta da linha: segue até o horizonte, ou termina numa estação se ia passar por cima de outra avenida
      const railEnd = sg => { for (let t = TW + 30; t < RLEN; t += 4) if (nearTrack(RC.clone().addScaledVector(RDIR, sg * t), W + 26)) return { t: sg * (t - 40), station: true }; return { t: sg * RLEN, station: false }; };
      const ENDS = [railEnd(-1), railEnd(1)], tA = ENDS[0].t, tB = ENDS[1].t;
      const RA = RC.clone().addScaledVector(RDIR, tA), RB = RC.clone().addScaledVector(RDIR, tB);
      const nearRail = (x, z, m) => { const dx = x - RC.x, dz = z - RC.z, t = dx * RDIR.x + dz * RDIR.z; return t > tA - m - 12 && t < tB + m + 12 && Math.abs(dx * RDIR.z - dz * RDIR.x) < 9 + m; };
      // área ocupada pelo túnel (paredes + portais), para os prédios não nascerem em cima
      const nearTunnel = (x, z, r) => { for (let i = TUN[0] - 3; i <= TUN[1] + 3; i += 2) { const p = side(i, 0, 0); if (Math.hypot(p.x - x, p.z - z) < TW + 9 + r) return true; } return false; };
      {
        const tileM = new THREE.MeshLambertMaterial({ map: TX.get('tiles', 1, 1), side: THREE.DoubleSide });
        const concM = new THREE.MeshLambertMaterial({ map: TX.get('concrete', 1, 1), color: 0xc8c8d2, side: THREE.DoubleSide });
        const darkM = new THREE.MeshLambertMaterial({ color: 0x3a3c48, side: THREE.DoubleSide });
        // faixa vertical com UV em metros, só no trecho do túnel
        const wallStrip = (o, y0, y1, mat, uLen, vLen) => { const pos = [], uv = [], idx = [];
          for (let i = TUN[0]; i <= TUN[1]; i++) { const a = side(i, o, y0), b = side(i, o, y1), u = (LACC[i] - LACC[TUN[0]]) / uLen; pos.push(a.x, a.y, a.z, b.x, b.y, b.z); uv.push(u, 0, u, (y1 - y0) / vLen); }
          for (let k = 0; k < TUN[1] - TUN[0]; k++) { const p = k * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
          const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return add(m); };
        const flatStrip = (a, b, y, mat, uLen) => { const pos = [], uv = [], idx = [];
          for (let i = TUN[0]; i <= TUN[1]; i++) { const p = side(i, a, y), q = side(i, b, y), v = (LACC[i] - LACC[TUN[0]]) / uLen; pos.push(p.x, p.y, p.z, q.x, q.y, q.z); uv.push(0, v, (b - a) / uLen, v); }
          for (let k = 0; k < TUN[1] - TUN[0]; k++) { const p = k * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
          const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return add(m); };
        [-1, 1].forEach(s => { wallStrip(s * TW, 0, TH, tileM, 4, 8); wallStrip(s * (TW + 1.4), 0, TH + RF, concM, 6, 6); });  // paredes internas e externas
        flatStrip(-TW, TW, TH, darkM, 8);                                     // teto (escuro)
        flatStrip(-TW - 1.4, TW + 1.4, TH + RF, concM, 8);                    // laje de cima
        // luminárias no teto (duas fileiras) + halos que acendem mais à noite
        const lampM = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
        // luminárias instanciadas (1 chamada de desenho para o túnel inteiro, que agora tem ~600 m)
        { const lp = []; for (let i = TUN[0] + 1; i < TUN[1]; i += 2) [-0.45, 0.45].forEach(f => lp.push({ p: side(i, f * W, TH - 0.12), r: Math.atan2(T[i].x, T[i].z), i, f }));
          const lim = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.18, 2.2), lampM, lp.length), d0 = new THREE.Object3D();
          lp.forEach((o, k) => { d0.position.copy(o.p); d0.rotation.set(0, o.r, 0); d0.updateMatrix(); lim.setMatrixAt(k, d0.matrix);
            if ((o.i - TUN[0]) % 4 === 1) { const h = glowSpr(0xffd890, 2.5, 0.35); h.userData.lampScale = 0.22; h.userData.lampOpacity = 0.45; h.position.copy(o.p).add(V3(0, -0.5, 0)); tr.lamps.push(h); } });
          lim.instanceMatrix.needsUpdate = true; lim.frustumCulled = false; add(lim); }
        // portais nas duas bocas: pilares, viga com faixa zebrada e placa
        const signC = TX.cvs(512, 96), sg = signC.getContext('2d'); sg.fillStyle = '#1a6a3a'; sg.fillRect(0, 0, 512, 96); sg.strokeStyle = '#fff'; sg.lineWidth = 6; sg.strokeRect(6, 6, 500, 84);
        sg.font = '700 56px ' + CFG.FONT_DISPLAY; sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.fillStyle = '#fff'; sg.fillText('TÚNEL KARTEC', 256, 52);
        const signM = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(signC), emissive: 0xffffff, emissiveMap: new THREE.CanvasTexture(signC), emissiveIntensity: 0.25 });
        const zebra = new THREE.MeshLambertMaterial({ map: TX.get('stripes', 6, 0.5) });
        [[TUN[0], -1], [TUN[1], 1]].forEach(([i, dir]) => {
          const g = new THREE.Group(); g.position.copy(side(i, 0, 0)); g.rotation.y = Math.atan2(T[i].x, T[i].z); add(g);
          const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(GEO.rbox(w, h, d, 0.3, 2), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
          [-1, 1].forEach(s => box(4.4, TH + RF + 3.2, 3, concM, s * (TW + 2.2), (TH + RF + 3.2) / 2, 0));
          box(2 * TW + 8.8, RF + 3.2, 3, concM, 0, TH + (RF + 3.2) / 2, 0);
          box(2 * TW, 0.7, 3.1, zebra, 0, TH + 0.35, 0);
          const sp = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), signM); sp.position.set(0, TH + 2.6, dir * -1.56); if (dir < 0) sp.rotation.y = Math.PI; g.add(sp);
          tr.obstacles.push(...[-1, 1].map(s => { const p = side(i, s * (TW + 2.2), 0); return { x: p.x, z: p.z, r: 2.4 }; }));
        });
        // esferas que bloqueiam o sol dentro do túnel (lens flare apaga lá dentro)
        for (let i = TUN[0]; i <= TUN[1]; i += 3) { const p = side(i, 0, TH * 0.6); tr.blockers.push({ x: p.x, y: p.y, z: p.z, r: TW + 1 }); }
        tr.minimap.push({ type: 'tunnel', from: TUN[0], to: TUN[1] });
      }
      // ---- viaduto do trem (sobre a laje do túnel e sobre a cidade) ----
      {
        const concM = new THREE.MeshLambertMaterial({ map: TX.get('concrete', 2, 1), color: 0xd0d0d8 }), railM = new THREE.MeshLambertMaterial({ color: 0x8a8c96 }), poleM2 = new THREE.MeshLambertMaterial({ color: 0x5a5c66 });
        const SEG = 40;
        for (let t = tA; t < tB; t += SEG) {
          const c = RC.clone().addScaledVector(RDIR, t + SEG / 2), th = Math.atan2(RDIR.x, RDIR.z);
          const deck = new THREE.Mesh(GEO.rbox(8, 1.4, SEG + 0.2, 0.25, 2), concM); deck.position.set(c.x, RY - 0.9, c.z); deck.rotation.y = th; deck.castShadow = deck.receiveShadow = true; add(deck);
          [-3.6, 3.6].forEach(o => { const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, SEG + 0.2), concM); w.position.set(c.x + RDIR.z * o, RY + 0.3, c.z - RDIR.x * o); w.rotation.y = th; add(w); });
          [-0.75, 0.75].forEach(o => { const r = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, SEG + 0.2), railM); r.position.set(c.x + RDIR.z * o, RY + 0.1, c.z - RDIR.x * o); r.rotation.y = th; add(r); });
          // pilares só onde não há rua embaixo (sobre a avenida, o vão fica livre)
          const pc = RC.clone().addScaledVector(RDIR, t);
          if (!nearTrack(pc, W + 12) && Math.abs(t) > TW + 6) { const pl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, RY - 1.6, 12), concM); pl.position.set(pc.x, (RY - 1.6) / 2, pc.z); pl.castShadow = true; add(pl); }
          // postes da rede elétrica
          const pp = pc.clone().addScaledVector(V3(RDIR.z, 0, -RDIR.x), 3.4);
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 6.5, 6), poleM2); pole.position.set(pp.x, RY + 3.25, pp.z); add(pole);
          const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 4), poleM2); arm.position.set(pc.x + RDIR.z * 1.4, RY + 6.2, pc.z - RDIR.x * 1.4); arm.rotation.y = th + Math.PI / 2; add(arm);
        }
        // dormentes (instanciados) e fio da rede aérea
        const sl = Math.floor((tB - tA) / 1.2), sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.18, 0.4), new THREE.MeshLambertMaterial({ color: 0x6a5040 }), sl), d0 = new THREE.Object3D();
        for (let k = 0; k < sl; k++) { const p = RC.clone().addScaledVector(RDIR, tA + k * 1.2); d0.position.set(p.x, RY - 0.05, p.z); d0.rotation.set(0, Math.atan2(RDIR.x, RDIR.z), 0); d0.updateMatrix(); sleepers.setMatrixAt(k, d0.matrix); }
        sleepers.instanceMatrix.needsUpdate = true; sleepers.receiveShadow = true; add(sleepers);
        const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints([RA.clone().setY(RY + 6.1), RB.clone().setY(RY + 6.1)]), new THREE.LineBasicMaterial({ color: 0x2a2c34 })); add(wire);
        tr.minimap.push({ type: 'rail', a: [RA.x, RA.z], b: [RB.x, RB.z] });
        // estação: plataformas dos dois lados, cobertura sobre pilares e placa
        ENDS.forEach((E, k) => { if (!E.station) return;
          const sg = k ? 1 : -1, len = 80, mid = E.t - sg * len / 2, c = RC.clone().addScaledVector(RDIR, mid), th = Math.atan2(RDIR.x, RDIR.z), px = V3(RDIR.z, 0, -RDIR.x);
          const platM = new THREE.MeshLambertMaterial({ map: TX.get('calcadao', 2, 12) }), roofM2 = new THREE.MeshLambertMaterial({ color: 0x2a5ce8 }), colM = new THREE.MeshLambertMaterial({ color: 0xf0f0f4 });
          [-1, 1].forEach(sd => { const pc = c.clone().addScaledVector(px, sd * 5.6);
            const pl = new THREE.Mesh(GEO.rbox(4.2, 1.2, len, 0.2, 2), platM); pl.position.set(pc.x, RY - 0.3, pc.z); pl.rotation.y = th; pl.receiveShadow = true; add(pl);
            const edge = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, len), new THREE.MeshLambertMaterial({ color: 0xffd21a })); edge.position.set(c.x + px.x * sd * 3.65, RY + 0.32, c.z + px.z * sd * 3.65); edge.rotation.y = th; add(edge);
            for (let q = -len / 2 + 6; q <= len / 2 - 6; q += 12) { const cc = pc.clone().addScaledVector(RDIR, q); const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 5.5, 8), colM); col.position.set(cc.x, RY + 3, cc.z); add(col); } });
          const roof = new THREE.Mesh(GEO.rbox(17, 0.6, len + 4, 0.25, 2), roofM2); roof.position.set(c.x, RY + 5.9, c.z); roof.rotation.y = th; roof.castShadow = true; add(roof);
          const sc = TX.cvs(512, 96), g2 = sc.getContext('2d'); g2.fillStyle = '#2a5ce8'; g2.fillRect(0, 0, 512, 96); g2.strokeStyle = '#fff'; g2.lineWidth = 6; g2.strokeRect(6, 6, 500, 84);
          g2.font = '700 52px ' + CFG.FONT_DISPLAY; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillStyle = '#fff'; g2.fillText('ESTAÇÃO KARTEC', 256, 52);
          [-1, 1].forEach(sd => { const sp = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.25), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(sc), side: THREE.DoubleSide })); const q = c.clone().addScaledVector(px, sd * 8.6); sp.position.set(q.x, RY + 4.6, q.z); sp.rotation.y = th + Math.PI / 2; add(sp); });
          // para-choque no fim da linha
          const bp = RC.clone().addScaledVector(RDIR, E.t); const buf = new THREE.Mesh(GEO.rbox(3.4, 1.4, 1.2, 0.3, 2), new THREE.MeshLambertMaterial({ map: TX.get('stripes', 1, 0.5) })); buf.position.set(bp.x, RY + 0.7, bp.z); buf.rotation.y = th; add(buf);
          tr.blockers.push({ x: c.x, y: RY + 3, z: c.z, r: 12 }); });
      }
      // ---- o trem: locomotiva + 3 vagões, vai e volta pela linha e buzina ao cruzar o túnel ----
      {
        const sideTex = lit => { const c = TX.cvs(512, 128), g = c.getContext('2d');
          if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, 512, 128); }
          else { const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#f4f6fa'); gr.addColorStop(1, '#c4cad6'); g.fillStyle = gr; g.fillRect(0, 0, 512, 128);
            g.fillStyle = '#e8302a'; g.fillRect(0, 92, 512, 14); g.fillStyle = '#1a4ac8'; g.fillRect(0, 108, 512, 5); }
          for (let k = 0; k < 8; k++) { const x = 22 + k * 62; if (k === 2 || k === 5) { if (!lit) { g.fillStyle = '#5a6070'; g.fillRect(x, 26, 40, 82); g.fillStyle = '#28324a'; g.fillRect(x + 6, 32, 28, 34); } continue; }
            if (lit) { g.fillStyle = '#ffe2a0'; g.fillRect(x, 30, 44, 34); } else { const gw = g.createLinearGradient(0, 30, 0, 64); gw.addColorStop(0, '#5a7ab0'); gw.addColorStop(1, '#1e2c4a'); g.fillStyle = gw; g.fillRect(x, 30, 44, 34); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + 4, 33, 10, 28); } }
          return new THREE.CanvasTexture(c); };
        const carM = new THREE.MeshLambertMaterial({ map: sideTex(false), emissive: 0xffffff, emissiveMap: sideTex(true), emissiveIntensity: 0 }); carM.userData.unique = true; tr.nightMats.push({ m: carM, max: 1 });
        const roofM = new THREE.MeshLambertMaterial({ color: 0x9aa0ac }), bogM = new THREE.MeshLambertMaterial({ color: 0x24262e }), noseM = new THREE.MeshLambertMaterial({ color: 0xe8302a }), glassM = new THREE.MeshLambertMaterial({ color: 0x1e2c4a });
        const train = new THREE.Group(); train.userData.dynamic = true; add(train);
        const CL = 17, GAP = 1.2, NC = 4, TL = NC * CL + (NC - 1) * GAP;
        for (let c = 0; c < NC; c++) {
          const car = new THREE.Group(); car.position.z = -(c * (CL + GAP)) - CL / 2; train.add(car);
          const body = new THREE.Mesh(GEO.rbox(3.3, 3.6, CL, 0.5, 2), carM); body.position.y = 2.6; body.castShadow = true; car.add(body);
          const roof = new THREE.Mesh(GEO.rbox(3.0, 0.5, CL - 1, 0.25, 2), roofM); roof.position.y = 4.5; car.add(roof);
          [-1, 1].forEach(e => { const b = new THREE.Mesh(GEO.rbox(2.6, 0.8, 3.4, 0.2, 2), bogM); b.position.set(0, 0.6, e * (CL / 2 - 3)); car.add(b);
            [-1, 1].forEach(s => [-1, 1].forEach(w => { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.25, 12), bogM); wh.rotation.z = Math.PI / 2; wh.position.set(s * 1.1, 0.45, e * (CL / 2 - 3) + w * 1.1); car.add(wh); })); });
          if (c === 0 || c === NC - 1) { // cabines nas duas pontas (trem metropolitano): bico vermelho, para-brisa e faróis
            const cab = new THREE.Group(); if (c === NC - 1) cab.rotation.y = Math.PI; car.add(cab); const carAdd = car; const car_ = cab;
            const nose = new THREE.Mesh(GEO.rbox(3.3, 3.6, 2.6, 0.9, 3), noseM); nose.position.set(0, 2.6, CL / 2 + 0.9); nose.castShadow = true; car_.add(nose);
            const ws = new THREE.Mesh(GEO.rbox(2.6, 1.1, 0.3, 0.1, 2), glassM); ws.position.set(0, 3.4, CL / 2 + 2.15); ws.rotation.x = -0.25; car_.add(ws);
            [-0.9, 0.9].forEach(x => { const hl = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff6d0 })); hl.position.set(x, 1.6, CL / 2 + 2.2); car_.add(hl); });
            const pg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 2.2), bogM); pg.position.set(0, 5.3, 2); pg.rotation.x = 0.5; car_.add(pg); carAdd.updateMatrixWorld(true); }
          GEO.mergeByMaterial(car);
        }
        const headGlow = glowSpr(0xfff2c0, 9, 0); 
        // ida e volta: atravessa em ~40 s, espera alguns segundos e volta no sentido contrário
        // a "frente" (h) anda no sentido dir; na estação para e volta (a cabine de trás vira a da frente),
        // na ponta aberta some no horizonte e volta depois de uns segundos
        const SPD = 30; let dir = 1, h = tA + TL + 2, wait = 2, honked = false, vel = 0;
        if (!ENDS[0].station) h = tA - 10;
        tr.animated.push((t, dt) => {
          if (wait > 0) { wait -= dt; vel = 0; } else {   // parado (estação/horizonte) continua posicionado na linha
          const endT = dir > 0 ? tB : tA, E = ENDS[dir > 0 ? 1 : 0];
          const toStop = E.station ? (endT - h) * dir - 2 : Infinity;          // distância até parar na estação
          vel = Math.min(SPD, vel + 6 * dt, E.station ? Math.sqrt(Math.max(0, 2 * 4 * toStop)) : SPD);   // acelera, freia suave na estação
          h += dir * vel * dt;
          const rear = h - dir * TL;
          if ((E.station && toStop <= 0.05) || (!E.station && (rear - endT) * dir > 5)) { wait = E.station ? 7 : 4; h = rear; dir = -dir; honked = false; }
          }
          const s = h;                                                  // posição da frente ao longo da linha
          const head = RC.clone().addScaledVector(RDIR, s);
          train.position.set(head.x, RY, head.z); train.rotation.y = Math.atan2(RDIR.x * dir, RDIR.z * dir);
          headGlow.position.set(head.x + RDIR.x * dir * 3, RY + 1.6, head.z + RDIR.z * dir * 3); headGlow.material.opacity = 0.25 + 0.65 * (window.Env ? Env.nightF : 0);
          if (!honked && Math.abs(s) < 140) { honked = true;
            const P = window.Game && Game.player; if (P && P.pos && Math.hypot(P.pos.x - RC.x, P.pos.z - RC.z) < 320 && window.UI) { UI.Sfx.tone(311, 0, 0.55, 'sawtooth', 0.08); UI.Sfx.tone(370, 0, 0.55, 'sawtooth', 0.06); UI.Sfx.tone(311, 0, 0.9, 'sawtooth', 0.08, 0.7); UI.Sfx.tone(370, 0, 0.9, 'sawtooth', 0.06, 0.7); } }
        });
      }
      // ---- consultas do túnel para a câmera e para a iluminação ----
      tr.ceilingAt = (p, hint) => { const n = tr.nearest(p, hint); return inTun(n.i, 0) && Math.abs(n.lat) < TW + 1.2 ? TH - 0.9 : Infinity; };
      tr.shadeAt = (p, hint) => { const n = tr.nearest(p, hint); if (Math.abs(n.lat) > TW + 1.2) return 0; return tunShade(n.i + n.f); };
      const blocks = [];                                   // prédios já colocados (para não sobrepor)
      const free = (x, z, r) => !nearTrack({ x, z }, W + 9 + r) && !nearRail(x, z, r + 4) && !nearTunnel(x, z, r) && blocks.every(b => Math.hypot(b.x - x, b.z - z) > b.r + r + 3) && Math.hypot(x - S[si].x, z - S[si].z) > 26 + r;
      const roofM = new THREE.MeshLambertMaterial({ map: TX.get('concrete', 1, 1), color: 0x9a9aa4 }), tileRoofM = new THREE.MeshLambertMaterial({ map: TX.get('roofTile', 2, 2) });
      const facadeMats = Array.from({ length: TX.FACADE_COUNT }, (_, k) => { const m = new THREE.MeshLambertMaterial({ map: TX.facade(k), emissive: 0xffffff, emissiveMap: TX.facade(k, true), emissiveIntensity: 0 }); m.userData.unique = true; tr.nightMats.push({ m, max: 1.0 }); return m; });
      const tankM = new THREE.MeshLambertMaterial({ color: 0x2a64c8 }), antM = new THREE.MeshLambertMaterial({ color: 0x44464e });
      const adCanvas = (txt, bg, fg) => { const c = TX.cvs(256, 96), g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 256, 96); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 90); g.font = '700 36px ' + CFG.FONT_DISPLAY; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg; g.fillText(txt, 128, 50); return new THREE.CanvasTexture(c); };
      const ads = [['GUARANÁ KARTEC', '#1a8a3a', '#ffe14a'], ['PÃO DE QUEIJO', '#f2c418', '#7a2a0a'], ['AÇAÍ TURBO', '#5a1a7a', '#ffffff'], ['RÁDIO KART FM', '#e8302a', '#ffffff']].map(a => new THREE.MeshLambertMaterial({ map: adCanvas(...a), emissive: 0xffffff, emissiveMap: adCanvas(...a), emissiveIntensity: 0.2 }));
      ads.forEach(m => { m.userData.unique = true; tr.nightMats.push({ m, max: 0.9, min: 0.2 }); });
      function building(x, z, w, d, h, rot, k) {
        const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
        // escala o UV por face para a janela ter sempre o mesmo tamanho (4 janelas a cada 14 m, 8 andares a cada 28 m)
        const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
        for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * spans[f][0] / 14, uv.getY(i) * spans[f][1] / 28); }
        const fm = facadeMats[k % facadeMats.length], mats = [fm, fm, roofM, roofM, fm, fm];
        const b = new THREE.Mesh(g, mats); b.position.set(x, h / 2, z); b.rotation.y = rot; b.castShadow = true; b.receiveShadow = true; add(b);
        const top = new THREE.Group(); top.position.set(x, h, z); top.rotation.y = rot; add(top);
        top.add(Object.assign(new THREE.Mesh(GEO.rbox(w + 0.6, 0.6, d + 0.6, 0.15, 2), new THREE.MeshLambertMaterial({ color: 0xe8e8ee })), { castShadow: true }));
        if (rnd() < 0.8) { const tk = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 14), tankM); tk.position.set((rnd() - 0.5) * w * 0.5, 1.5, (rnd() - 0.5) * d * 0.5); tk.castShadow = true; top.add(tk);
          const lid = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.6, 14), tankM); lid.position.set(tk.position.x, 3, tk.position.z); top.add(lid); }
        if (rnd() < 0.5) { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), antM); a.position.set((rnd() - 0.5) * w * 0.6, 3, (rnd() - 0.5) * d * 0.6); top.add(a); }
        if (h < 30 && rnd() < 0.35) { const ad = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.75), ads[(rnd() * ads.length) | 0]); ad.position.set(0, 3.2, d / 2 - 0.5); top.add(ad);
          [-4, 4].forEach(px => { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6), antM); s.position.set(px, 1.3, d / 2 - 0.6); top.add(s); }); }
        if (h < 22 && rnd() < 0.4) { const r = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 4, 4), tileRoofM); r.rotation.y = Math.PI / 4; r.position.y = 2.6; r.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d)); top.add(r); }
        blocks.push({ x, z, r: Math.hypot(w, d) / 2 }); tr.blockers.push({ x, y: h * 0.5, z, r: Math.max(w, d, h) * 0.55 });
        tr.minimap.push({ type: 'building', x, z, w, d, rot, h });
      }
      // praça com fonte e morros com favela: o espaço é reservado antes dos prédios (CityKit, em city.js)
      const cityCtx = { tr, def, T, S, N, W, si, side, nearTrack, nearRail, nearTunnel, inTun, blocks, add, rnd, plants, glowSpr };
      const cityPlan = window.CityKit ? CityKit.reserve(cityCtx) : null;
      // prédios alinhados às ruas (fachada virada para a pista)
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < N; i += 6) [1, -1].forEach(sd => {
        const w = 12 + rnd() * 16, d = 12 + rnd() * 14, h = pass ? 10 + rnd() * 18 : 14 + rnd() * 52, off = W + 10 + d / 2 + pass * (d + 6) + rnd() * 3;
        const q = side(i, sd * off, 0); const r = Math.hypot(w, d) / 2 * 0.85;
        if (free(q.x, q.z, r)) building(q.x, q.z, w, d, h, Math.atan2(T[i].x, T[i].z), (rnd() * 6) | 0);
      });
      // miolo dos quarteirões e periferia
      for (let t = 0, n = 0; t < 2400 && n < 150; t++) { const x = L.bbox.x0 + rnd() * (L.bbox.x1 - L.bbox.x0), z = L.bbox.z0 + rnd() * (L.bbox.z1 - L.bbox.z0), w = 12 + rnd() * 14, d = 12 + rnd() * 14, h = 8 + rnd() * 30, r = Math.hypot(w, d) / 2;
        if (free(x, z, r)) { building(x, z, w, d, h, rnd() < 0.5 ? 0 : Math.PI / 2, (rnd() * 6) | 0); n++; } }   // alinhados à grade das ruas
      // ---- postes de luz (braço curvo) ----
      const poleM = new THREE.MeshLambertMaterial({ color: 0x3a3c44 });
      for (let i = 4; i < N; i += 18) [1, -1].forEach(sd => { if (Math.abs(((i - si + N) % N)) < 6 || inTun(i, 3)) return;
        const q = side(i, sd * (W + 6.4), 0.16), inward = V3(-T[i].z * sd, 0, T[i].x * sd);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 8, 8), poleM); pole.position.set(q.x, 4.16, q.z); pole.castShadow = true; add(pole);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 6), poleM); arm.position.set(q.x + inward.x * 1.4, 8.1, q.z + inward.z * 1.4); arm.rotation.set(0, 0, 0); arm.lookAt(q.x + inward.x * 3, 8.1, q.z + inward.z * 3); arm.rotateX(Math.PI / 2); add(arm);
        const lp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a0 })); lp.position.set(q.x + inward.x * 2.8, 7.9, q.z + inward.z * 2.8); lp.scale.y = 0.6; add(lp);
        const h = glowSpr(0xffc870, 10, 0.5); h.position.copy(lp.position); tr.lamps.push(h); tr.obstacles.push({ x: q.x, z: q.z, r: 0.35 });
        (tr.lampPoles = tr.lampPoles || []).push({ x: q.x, z: q.z, i, sd, nx: inward.x, nz: inward.z }); });
      // ---- semáforos nas esquinas ----
      const tl = [];
      for (let i = 0; i < N; i += 2) { const c = Math.abs(wrapA(Math.atan2(T[(i + 6) % N].x, T[(i + 6) % N].z) - Math.atan2(T[(i - 6 + N) % N].x, T[(i - 6 + N) % N].z))); if (c > 0.9 && (!tl.length || Math.abs(tl[tl.length - 1] - i) > 30)) tl.push(i); }
      const tlLights = [];
      tl.forEach(i => { if (inTun(i - 10, 3)) return; const q = side(i - 10, -(W + 5.8), 0.16);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5.2, 8), poleM); pole.position.set(q.x, 2.76, q.z); add(pole);
        const box = new THREE.Mesh(GEO.rbox(0.8, 2.2, 0.7, 0.15, 2), new THREE.MeshLambertMaterial({ color: 0x1d1f28 })); box.position.set(q.x, 6.2, q.z); box.rotation.y = Math.atan2(T[i].x, T[i].z) + Math.PI; add(box);
        const ls = [0xff2a2a, 0xffd21a, 0x3dff5a].map((c, k) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0x222222 })); m.material.userData.unique = true; m.position.set(0, 0.65 - k * 0.65, -0.38); box.add(m); return { m, c }; });
        tlLights.push(ls); tr.obstacles.push({ x: q.x, z: q.z, r: 0.3 }); });
      tr.animated.push(t => tlLights.forEach((ls, j) => { const ph = Math.floor((t * 0.25 + j * 0.37) % 3); ls.forEach((l, k) => l.m.material.color.setHex(k === [2, 1, 0][ph] ? l.c : 0x222222)); }));
      // ---- orelhões e bancas de jornal na calçada ----
      const orM = new THREE.MeshLambertMaterial({ color: 0xff8a1a }), phM = new THREE.MeshLambertMaterial({ color: 0x2a2c34 });
      for (let k = 0; k < 12; k++) { const i = (35 + k * 41) % N, sd = k % 2 ? 1 : -1, q = side(i, sd * (W + 5.2), 0.16); if (inTun(i, 3)) continue;
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6), phM); p.position.set(q.x, 1.36, q.z); add(p);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), orM); dome.scale.set(1, 1.25, 1); dome.position.set(q.x, 2.0, q.z); dome.rotation.x = -0.35; dome.rotation.y = Math.atan2(T[i].x, T[i].z) + (sd > 0 ? -Math.PI / 2 : Math.PI / 2); dome.castShadow = true; add(dome);
        tr.obstacles.push({ x: q.x, z: q.z, r: 0.6 }); }
      const bancaM = new THREE.MeshLambertMaterial({ color: 0x1a7a3a }), awnM = new THREE.MeshLambertMaterial({ color: 0xffd21a });
      for (let k = 0; k < 5; k++) { const i = (60 + k * 97) % N, sd = k % 2 ? -1 : 1, q = side(i, sd * (W + 4.8), 0.16), th = Math.atan2(T[i].x, T[i].z); if (inTun(i, 3)) continue;
        const b = new THREE.Mesh(GEO.rbox(2.2, 2.6, 4, 0.2, 2), bancaM); b.position.set(q.x, 1.46, q.z); b.rotation.y = th; b.castShadow = true; add(b);
        const a = new THREE.Mesh(GEO.rbox(2.8, 0.2, 4.6, 0.08, 2), awnM); a.position.set(q.x, 2.9, q.z); a.rotation.y = th; add(a); tr.obstacles.push({ x: q.x, z: q.z, r: 2.0 }); }
      // ---- ipês floridos (amarelo e rosa) em canteiros ----
      const ipeY = [], ipeP = [];
      for (let i = 9; i < N; i += 14) [1, -1].forEach((sd, j) => { const q = side(i, sd * (W + 4.2), 0.16); if (Math.abs(((i - si + N) % N)) < 10 || inTun(i, 3) || tr.obstacles.some(o => Math.hypot(o.x - q.x, o.z - q.z) < 4)) return;
        ((i + j) % 3 ? ipeY : ipeP).push({ x: q.x, y: 0.16, z: q.z, r: rnd() * 6.28, s: 0.75 + rnd() * 0.2 }); tr.obstacles.push({ x: q.x, z: q.z, r: 0.45 }); });
      plants('round', ipeY, 0xffd21a); plants('round', ipeP, 0xff7ab8);
      // ---- bandeirinhas de festa junina atravessando a rua ----
      const flagCols = [0xe8302a, 0xffd21a, 0x2a5ce8, 0x2cb84a, 0xff7a1a, 0xff4fb0, 0xffffff];
      const triG = new THREE.BufferGeometry(); triG.setAttribute('position', new THREE.Float32BufferAttribute([-0.35, 0, 0, 0.35, 0, 0, 0, -0.75, 0], 3)); triG.computeVertexNormals();
      const strings = [];
      [12, 70, 140, 175, 255, 300, 370, 430].map(i => Math.round(i * N / 500)).forEach(i => { if (Math.abs(i - si) < 4 || inTun(i, 4)) return;
        const a = side(i, -(W + 7), 9), b = side(i, W + 7, 9), n = 26, grp = new THREE.Group(); grp.userData.dynamic = true; add(grp);
        const im = new THREE.InstancedMesh(triG, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), n), d = new THREE.Object3D(), pts = [];
        for (let k = 0; k <= 20; k++) { const t = k / 20; pts.push(V3(a.x + (b.x - a.x) * t, 9 - Math.sin(t * Math.PI) * 1.4, a.z + (b.z - a.z) * t)); }
        grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x333333 })));
        for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; d.position.set(a.x + (b.x - a.x) * t, 9 - Math.sin(t * Math.PI) * 1.4, a.z + (b.z - a.z) * t); d.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2, 0); d.updateMatrix(); im.setMatrixAt(k, d.matrix); im.setColorAt(k, new THREE.Color(flagCols[k % flagCols.length])); }
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; grp.add(im); strings.push({ grp, ph: i });
        [a, b].forEach(p => { const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 9, 6), poleM); pl.position.set(p.x, 4.5, p.z); add(pl); tr.obstacles.push({ x: p.x, z: p.z, r: 0.3 }); }); });
      tr.animated.push(t => strings.forEach(s => { s.grp.position.y = Math.sin(t * 1.3 + s.ph) * 0.08; }));
      // ---- faixas de pedestre antes das esquinas ----
      tl.forEach(i => { if (inTun(i - 13, 2)) return; for (let k = -5; k <= 5; k++) { const c = side(i - 13, k * 2.1, 0.075); const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 3.4), new THREE.MeshLambertMaterial({ map: TX.get('paint'), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 })); m.rotation.x = -Math.PI / 2; const g = new THREE.Group(); g.position.copy(c); g.rotation.y = Math.atan2(T[i - 13 < 0 ? i - 13 + N : i - 13].x, T[i - 13 < 0 ? i - 13 + N : i - 13].z) + Math.PI / 2; g.add(m); m.rotation.z = Math.PI / 2; add(g); } });
      // ---- praça, morros com favela, térreos, grafites, mobiliário e fiação (city.js) ----
      if (cityPlan) tr.cityStats = CityKit.build(cityCtx, cityPlan);
      tr.dustColor = 0xb8b4ac;
      const terrain = (x, z, dist) => dist < W + 7.5 ? 0.16 : 0;
      return { terrain };
    }

    // ===============================================================================
    // PRAIA: ilha com areia, mar animado em volta, coqueiros, guarda-sóis, quiosques,
    // posto de salva-vidas, farol, barcos e rampas de salto
    // ===============================================================================
    function buildBeach() {
      tr.WALL = W + 30;
      const D = 64;                                   // distância da pista até a beira d'água
      // contorno da ilha: pista deslocada para fora, suavizado
      const ring = []; for (let i = 0; i < N; i += 2) { const t5 = side(i, 5, 0); ring.push(side(i, inside(t5.x, t5.z) ? -D : D, 0)); }
      for (let it = 0; it < 6; it++) { const c = ring.map(p => p.clone()); for (let k = 0; k < ring.length; k++) { const a = c[(k - 1 + c.length) % c.length], b = c[(k + 1) % c.length]; ring[k].x = (a.x + 2 * c[k].x + b.x) / 4; ring[k].z = (a.z + 2 * c[k].z + b.z) / 4; } }
      // centro aproximado para o declive da praia
      let cx = 0, cz = 0; ring.forEach(p => { cx += p.x; cz += p.z; }); cx /= ring.length; cz /= ring.length;
      const shape = new THREE.Shape(ring.map(p => new THREE.Vector2(p.x, -p.z)));
      const ig = new THREE.ShapeGeometry(shape, 1); ig.rotateX(-Math.PI / 2);
      { const uv = ig.attributes.uv, p = ig.attributes.position; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 6, p.getZ(i) / 6); }
      const island = new THREE.Mesh(ig, new THREE.MeshLambertMaterial({ map: TX.get('sand') })); island.position.y = 0.0; island.receiveShadow = true; add(island);
      // faixa da beira: areia molhada descendo até dentro d'água
      { const pos = [], uv = [], idx = [], K = ring.length;
        for (let k = 0; k <= K; k++) { const p = ring[k % K], dx = p.x - cx, dz = p.z - cz, l = Math.hypot(dx, dz) || 1, nx = dx / l, nz = dz / l;
          [[0, 0.0], [5, -0.4], [16, -2.2]].forEach(([d, h], c) => { pos.push(p.x + nx * d, h, p.z + nz * d); uv.push(c * 1.2, k * 0.8); }); }
        for (let k = 0; k < K; k++) for (let c = 0; c < 2; c++) { const a = k * 3 + c, d = a + 3; idx.push(a, d, a + 1, a + 1, d, d + 1); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
        add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: TX.get('wetSand'), side: THREE.DoubleSide })));
        // espuma das ondas (vai e volta)
        const fpos = [], fuv = [], fidx = [];
        for (let k = 0; k <= K; k++) { const p = ring[k % K], dx = p.x - cx, dz = p.z - cz, l = Math.hypot(dx, dz) || 1, nx = dx / l, nz = dz / l;
          [6, 13].forEach((d, c) => { fpos.push(p.x + nx * d, -0.75, p.z + nz * d); fuv.push(k * 0.5, c); }); }
        for (let k = 0; k < K; k++) { const a = k * 2; fidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2)); fg.setIndex(fidx); fg.computeVertexNormals();
        const foamT = TX.get('foam', 1, 1); foamT.wrapT = THREE.ClampToEdgeWrapping;
        const foam = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: foamT, transparent: true, depthWrite: false, opacity: 0.9 })); foam.userData.dynamic = true; add(foam);
        const fbase = fg.attributes.position.array.slice(), dirs = [];
        for (let k = 0; k <= K; k++) { const p = ring[k % K], dx = p.x - cx, dz = p.z - cz, l = Math.hypot(dx, dz) || 1; dirs.push(dx / l, dz / l); }
        tr.animated.push((t, dt) => { const a = fg.attributes.position, s = Math.sin(t * 0.9) * 2.6; for (let k = 0; k <= K; k++) for (let c = 0; c < 2; c++) { const i = k * 2 + c, w = s + Math.sin(t * 1.7 + k * 0.3) * 0.6; a.setX(i, fbase[i * 3] + dirs[k * 2] * w); a.setZ(i, fbase[i * 3 + 2] + dirs[k * 2 + 1] * w); } a.needsUpdate = true; foam.material.opacity = 0.65 + 0.3 * Math.sin(t * 0.9 + 1.5); }); }
      // mar com ondas
      { const g = new THREE.PlaneGeometry(GS, GS, 120, 120); g.rotateX(-Math.PI / 2);
        const wt = TX.get('water', 160, 160), m = new THREE.MeshPhongMaterial({ map: wt, color: 0xd8f0ff, transparent: true, opacity: 0.93, shininess: 90, specular: 0xffffff });
        // ondas calculadas na placa de vídeo (antes: 8 mil vértices + normais recalculados na CPU a cada quadro)
        const seaU = { value: 0 };
        m.customProgramCacheKey = () => 'water-sea'; delete m.userData.mergeKey; m.userData.unique = true;
        m.onBeforeCompile = sh => { sh.uniforms.uT = seaU;
          sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader
            .replace('#include <beginnormal_vertex>', `float sx = position.x, sz = position.z;
              float c1 = cos(sx * 0.02 + uT * 1.1), c2 = cos(sz * 0.027 - uT * 0.8), c3 = cos((sx + sz) * 0.05 + uT * 1.9);
              vec3 objectNormal = normalize(vec3(-(0.007 * c1 + 0.006 * c3), 1.0, -(0.00675 * c2 + 0.006 * c3)));`)
            .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
              transformed.y += 0.35 * sin(sx * 0.02 + uT * 1.1) + 0.25 * sin(sz * 0.027 - uT * 0.8) + 0.12 * sin((sx + sz) * 0.05 + uT * 1.9);`); };
        const sea = new THREE.Mesh(g, m); sea.position.y = -1.0; sea.receiveShadow = true; add(sea);   // pico das ondas (~0,7 m) fica abaixo da areia (y = 0)
        tr.animated.push((t, dt) => { seaU.value = t; wt.offset.x += dt * 0.004; wt.offset.y += dt * 0.006; }); }
      tr.minimap.push({ type: 'island', poly: ring.map(p => [p.x, p.z]) });
      // pontos livres
      const used = [];
      const okSpot = (x, z, m) => !nearTrack({ x, z }, W + 4 + m) && used.every(u => Math.hypot(u.x - x, u.z - z) > u.r + m) && Math.hypot(x - S[si].x, z - S[si].z) > 22;
      const onIsland = (x, z) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
      // coqueiros ao longo da orla e em bosques
      const palms = [[], [], []];
      for (let i = 0; i < N; i += 6) [1, -1].forEach(sd => { if (rnd() < 0.35) return; const q = side(i, sd * (W + 7 + rnd() * 18), 0); if (onIsland(q.x, q.z) && okSpot(q.x, q.z, 2)) { palms[(rnd() * 3) | 0].push({ x: q.x, z: q.z, r: rnd() * 6.28, s: 0.85 + rnd() * 0.45 }); used.push({ x: q.x, z: q.z, r: 2 }); if (Math.hypot(q.x - side(i, 0, 0).x, q.z - side(i, 0, 0).z) < tr.WALL) tr.obstacles.push({ x: q.x, z: q.z, r: 0.5 }); } });
      for (let gc = 0, t = 0; gc < 10 && t < 600; t++) { const x = (rnd() - 0.5) * 600, z = (rnd() - 0.5) * 500; if (!onIsland(x, z) || nearTrack({ x, z }, W + 30)) continue;
        for (let k = 0; k < 8; k++) { const r = 3 + Math.sqrt(k) * 5, a = k * 2.4, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (onIsland(px, pz)) palms[k % 3].push({ x: px, z: pz, r: rnd() * 6.28, s: 0.8 + rnd() * 0.5 }); } gc++; }
      [0.25, 0.4, 0.6].forEach((lean, k) => plants('palm', palms[k], 0x6ec23a, 'palmBark', 'palmLeaf', { lean }));
      const rest = []; for (let k = 0; k < 140; k++) { const x = (rnd() - 0.5) * 640, z = (rnd() - 0.5) * 520; if (onIsland(x, z) && okSpot(x, z, 3)) rest.push({ x, z, r: rnd() * 6.28, s: 0.5 + rnd() * 0.5 }); }
      plants('bush', rest, 0x5a9a3a);
      // guarda-sóis listrados + cangas, perto da água
      const umbCols = [[0xe8302a, 0xffffff], [0x2a5ce8, 0xffd21a], [0x2cb84a, 0xffffff], [0xff7a1a, 0x2a5ce8], [0xff4fb0, 0xffffff]];
      const umbTex = umbCols.map(([a, b]) => { const c = TX.cvs(64, 8), g = c.getContext('2d'); for (let k = 0; k < 8; k++) { g.fillStyle = '#' + new THREE.Color(k % 2 ? b : a).getHexString(); g.fillRect(k * 8, 0, 8, 8); } return new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }); });
      const poleW = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 });
      for (let k = 0, t = 0; k < 46 && t < 600; t++) { const ri = (rnd() * ring.length) | 0, p = ring[ri], dx = cx - p.x, dz = cz - p.z, l = Math.hypot(dx, dz) || 1, d = 4 + rnd() * 14, x = p.x + dx / l * d, z = p.z + dz / l * d;
        if (!okSpot(x, z, 3)) continue; used.push({ x, z, r: 3 });
        const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.set((rnd() - 0.5) * 0.2, rnd() * 6.28, (rnd() - 0.5) * 0.2); add(g);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 6), poleW); pole.position.y = 1.4; g.add(pole);
        const top = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.8, 8, 1, true), umbTex[k % umbTex.length]); top.position.y = 2.7; top.castShadow = true; g.add(top);
        const towel = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshLambertMaterial({ color: [0xffd21a, 0x2ab8e8, 0xe8302a, 0x9a3ae0][k % 4] })); towel.rotation.x = -Math.PI / 2; towel.position.set(1.4, 0.03, 0.4); g.add(towel); k++; }
      // quiosques de palha, posto de salva-vidas e farol
      const woodM = new THREE.MeshLambertMaterial({ map: TX.get('wood', 2, 2) }), thM = new THREE.MeshLambertMaterial({ map: TX.get('thatch', 3, 2), flatShading: true });
      for (let k = 0, t = 0; k < 7 && t < 300; t++) { const i = (rnd() * N) | 0, sd = rnd() < 0.5 ? 1 : -1, q = side(i, sd * (W + 12), 0); if (!onIsland(q.x, q.z) || !okSpot(q.x, q.z, 6)) continue; used.push({ x: q.x, z: q.z, r: 6 });
        const g = new THREE.Group(); g.position.copy(q); g.rotation.y = Math.atan2(T[i].x, T[i].z); add(g);
        const b = new THREE.Mesh(GEO.rbox(4, 2.4, 3, 0.2, 2), woodM); b.position.y = 1.2; b.castShadow = true; g.add(b);
        const r = new THREE.Mesh(new THREE.ConeGeometry(3.8, 2.2, 6), thM); r.position.y = 3.6; r.castShadow = true; g.add(r);
        [[-1.8, -1.3], [1.8, -1.3], [-1.8, 1.3], [1.8, 1.3]].forEach(([x, z]) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.6, 6), woodM); p.position.set(x, 1.3, z); g.add(p); }); k++; }
      for (let k = 0; k < 3; k++) { const p = ring[Math.floor((k + 0.3) * ring.length / 3)], dx = cx - p.x, dz = cz - p.z, l = Math.hypot(dx, dz) || 1, x = p.x + dx / l * 8, z = p.z + dz / l * 8;
        const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.atan2(-dx, -dz); add(g);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 6), woodM); s.position.set(a, 2, b); g.add(s); });
        const cab = new THREE.Mesh(GEO.rbox(3, 2.2, 3, 0.25, 2), new THREE.MeshLambertMaterial({ color: 0xe8302a })); cab.position.y = 5.1; cab.castShadow = true; g.add(cab);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.2, 4), new THREE.MeshLambertMaterial({ color: 0xffffff })); roof.position.y = 6.8; roof.rotation.y = Math.PI / 4; g.add(roof); used.push({ x, z, r: 4 }); }
      { const p = ring[Math.floor(ring.length * 0.62)], dx = p.x - cx, dz = p.z - cz, l = Math.hypot(dx, dz) || 1, x = p.x + dx / l * 4, z = p.z + dz / l * 4;
        const rocks = new THREE.Mesh(new THREE.DodecahedronGeometry(9, 0), new THREE.MeshLambertMaterial({ map: TX.get('rock', 2, 2), flatShading: true })); rocks.position.set(x, -2, z); rocks.scale.set(1.3, 0.5, 1.1); add(rocks);
        const lh = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.3, 22, 20), new THREE.MeshLambertMaterial({ map: TX.get('lighthouse', 2, 1) })); lh.position.set(x, 12, z); lh.castShadow = true; add(lh);
        const cabin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2, 14), new THREE.MeshBasicMaterial({ color: 0xfff6c0 })); cabin.position.set(x, 24, z); add(cabin);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(2, 2, 14), new THREE.MeshLambertMaterial({ color: 0xc8202a })); cap.position.set(x, 26, z); add(cap);
        const beam = glowSpr(0xfff2b0, 18, 0.6); beam.position.set(x, 24, z); tr.lamps.push(beam);
        const beamCone = new THREE.Mesh(new THREE.ConeGeometry(6, 60, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beamCone.geometry.translate(0, -30, 0); beamCone.geometry.rotateZ(Math.PI / 2); const bg = new THREE.Group(); bg.userData.dynamic = true; bg.position.set(x, 24, z); bg.add(beamCone); add(bg);
        tr.animated.push((t) => { bg.rotation.y = t * 0.8; beamCone.material.opacity = 0.18 * (window.Env ? Env.nightF : 0); }); }
      // barcos balançando e boias
      const boats = [];
      for (let k = 0; k < 7; k++) { const p = ring[(k * 37 + 11) % ring.length], dx = p.x - cx, dz = p.z - cz, l = Math.hypot(dx, dz) || 1, d = 40 + rnd() * 80, x = p.x + dx / l * d, z = p.z + dz / l * d;
        const g = new THREE.Group(); g.position.set(x, -0.9, z); g.rotation.y = rnd() * 6.28; add(g);
        const hull = new THREE.Mesh(GEO.rbox(2.6, 1.2, 7, 0.5, 3), new THREE.MeshLambertMaterial({ color: [0xffffff, 0x2a5ce8, 0xe8302a, 0xffd21a][k % 4] })); hull.position.y = 0.1; g.add(hull);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6, 6), woodM); mast.position.y = 3.5; g.add(mast);
        const sail = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([V3(0, 6.3, 0), V3(0, 1.2, 2.6), V3(0, 1.2, -0.2)]), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide })); sail.geometry.computeVertexNormals(); g.add(sail);
        g.userData.dynamic = true; boats.push({ g, ph: rnd() * 6 }); }
      tr.animated.push(t => boats.forEach(b => { b.g.position.y = -0.9 + 0.3 * Math.sin(t * 1.2 + b.ph); b.g.rotation.z = 0.08 * Math.sin(t * 0.9 + b.ph); b.g.rotation.x = 0.05 * Math.sin(t * 1.3 + b.ph); }));
      // dunas suaves no miolo
      for (let k = 0, t = 0; k < 9 && t < 200; t++) { const x = (rnd() - 0.5) * 400, z = (rnd() - 0.5) * 300; if (!onIsland(x, z) || nearTrack({ x, z }, W + 40)) continue;
        const du = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ map: TX.get('sand', 4, 4) })); du.scale.set(18 + rnd() * 20, 3 + rnd() * 4, 14 + rnd() * 16); du.position.set(x, -0.5, z); du.rotation.y = rnd() * 6.28; du.receiveShadow = true; add(du); k++; }
      tr.dustColor = 0xe8d0a0;
      return { terrain: () => 0 };
    }
  }

  window.Tracks = { layout, build, PLANTS, get N() { return N; } };
})();
