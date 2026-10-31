// =====================================================================================
// props.js — objetos de cenário "de brinquedo", espalhados por qualquer pista
//   * barreiras de pneus de verdade (borracha cinza com banda de rodagem e letras na lateral), em pilhas de 3 a 4,
//     duas a duas, do lado de fora das curvas fechadas
//   * cones infláveis gordinhos marcando a entrada das curvas
//   * balões de festa amarrados perto da largada
// Tudo instanciado (1 chamada de desenho por tipo) e com material toon; só os balões levam contorno.
// São decorativos: ficam fora do asfalto e não entram na física.
// =====================================================================================
(function () {
  const CANDY = [0xff4d6d, 0xffd23f, 0x3dd6ff, 0x8b5cf6, 0x2ee6a8, 0xff8a3d, 0xff7ae0];

  // ---------- PNEU de verdade ----------
  // Perfil da seção do pneu (raio, altura) girado em volta do eixo: laterais abauladas, ombro arredondado, banda de rodagem
  // reta e o furo do aro. A textura (canvas) segue o comprimento do perfil, então banda e laterais não esticam.
  const TIRE = { R: 0.98, H: 0.33 };   // raio externo e meia-altura (m): pneu grande, ~2 m de diâmetro x 0,66 m
  const TIRE_PROF = [[0.5, -0.25], [0.55, -0.31], [0.66, -0.33], [0.8, -0.32], [0.9, -0.29], [0.955, -0.22], [0.975, -0.1], [0.975, 0.1], [0.955, 0.22], [0.9, 0.29], [0.8, 0.32], [0.66, 0.33], [0.55, 0.31], [0.5, 0.25], [0.485, 0], [0.5, -0.25]];
  let tireCache = null;
  function tireAssets() {
    if (tireCache) return tireCache;
    const P = TIRE_PROF.map(([r, y]) => new THREE.Vector2(r * TIRE.R / 0.975, y * TIRE.H / 0.33));
    const arc = [0]; for (let j = 1; j < P.length; j++) arc.push(arc[j - 1] + P[j].distanceTo(P[j - 1])); const AL = arc[arc.length - 1], vf = arc.map(a => a / AL);
    const g = new THREE.LatheGeometry(P, 40), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, vf[i % P.length]);   // v = comprimento do perfil (não o índice do ponto)
    // faixas do perfil em v: lateral de baixo, banda de rodagem (pontos 5..8), lateral de cima, furo
    const vT0 = vf[5], vT1 = vf[8], vS0 = vf[1], vS1 = vf[12];
    // ---- textura: 1024 (volta do pneu) x 256 (perfil) ----
    const Wc = 1024, Hc = 256, c = document.createElement('canvas'); c.width = Wc; c.height = Hc; const x = c.getContext('2d');
    let sd = 99; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const Y = v => (1 - v) * Hc;   // CanvasTexture vira na vertical (flipY)
    // borracha base: cinza-escuro com granulado
    x.fillStyle = '#4a4b4e'; x.fillRect(0, 0, Wc, Hc);
    const im = x.getImageData(0, 0, Wc, Hc), dd = im.data;
    for (let k = 0; k < dd.length; k += 4) { const n = (r() - 0.5) * 16; dd[k] += n; dd[k + 1] += n; dd[k + 2] += n + 1; }
    x.putImageData(im, 0, 0);
    // laterais: anéis em relevo (linhas claras e escuras)
    const ring = (v, col, w) => { x.fillStyle = col; x.fillRect(0, Y(v) - w / 2, Wc, w); };
    [[vS0 + 0.02, '#5c5d61', 3], [vS0 + 0.05, '#36373a', 2], [vT0 - 0.03, '#5a5b5f', 2], [vT1 + 0.03, '#5a5b5f', 2], [vS1 - 0.05, '#36373a', 2], [vS1 - 0.02, '#5c5d61', 3]].forEach(a => ring(...a));
    // banda de rodagem: blocos com sulcos em "V" e sulco central
    const ty0 = Y(vT1), ty1 = Y(vT0), th = ty1 - ty0; x.fillStyle = '#3d3e41'; x.fillRect(0, ty0, Wc, th);
    x.strokeStyle = '#1e1f21'; x.lineWidth = 5; x.lineCap = 'round';
    for (let k = 0; k < 64; k++) { const u = k * Wc / 64; x.beginPath(); x.moveTo(u, ty0 + 2); x.lineTo(u + 10, ty0 + th * 0.5); x.lineTo(u, ty1 - 2); x.stroke(); }
    x.lineWidth = 4; [0.5].forEach(f => { x.beginPath(); x.moveTo(0, ty0 + th * f); x.lineTo(Wc, ty0 + th * f); x.stroke(); });
    x.fillStyle = 'rgba(120,122,126,0.18)'; for (let k = 0; k < 64; k++) x.fillRect(k * Wc / 64 + 4, ty0 + 3, Wc / 64 - 10, 3);   // quina dos blocos gasta (mais clara)
    // letras em relevo nas duas laterais (cinza mais claro), como marca/medida de pneu de verdade
    // (um pixel em v mede ~1,7x um pixel em u na lateral: as letras são achatadas em v para ficarem com a proporção certa)
    x.font = 'bold 30px Arial, sans-serif'; x.textBaseline = 'middle'; x.textAlign = 'center';
    const txt = ['KARTEC RACING', '205/60 R13', 'TUBELESS'];
    [vS0 + 0.11, vS1 - 0.11].forEach((v, side) => { for (let k = 0; k < 3; k++) { x.save(); x.translate((k + 0.5 + side * 0.3) * Wc / 3, Y(v)); x.scale(1, side === 0 ? -0.58 : 0.58);
      x.fillStyle = '#2c2d30'; x.fillText(txt[k], 1, 2); x.fillStyle = '#76787c'; x.fillText(txt[k], 0, 0); x.restore(); } });   // relevo: sombra embaixo + letra clara
    // desgaste: manchas de poeira/esfolado claras e borracha marcada
    for (let k = 0; k < 90; k++) { const u = r() * Wc, v = r(); x.fillStyle = `rgba(${150 + r() * 40 | 0},${140 + r() * 30 | 0},${120 + r() * 20 | 0},${0.05 + r() * 0.08})`; x.beginPath(); x.ellipse(u, Y(v), 6 + r() * 30, 2 + r() * 6, 0, 0, 6.283); x.fill(); }
    // furo (lado de dentro): mais escuro
    x.fillStyle = 'rgba(15,15,17,0.55)'; x.fillRect(0, 0, Wc, Y(vS1 + 0.02)); x.fillRect(0, Y(vS0 - 0.02), Wc, Hc - Y(vS0 - 0.02));
    const tex = new THREE.CanvasTexture(c); tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 4;
    // material "de verdade" (Lambert original, sem as faixas do toon), quase fosco
    const Lam = (window.Toon && Toon.Lambert) || THREE.MeshLambertMaterial;
    const mat = new Lam({ map: tex, color: 0xffffff }); mat.userData.noToon = true;
    return (tireCache = { geo: g, mat });
  }

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
      (tr.busy || []).forEach(([a, b]) => { for (let i = a; i <= b; i++) busy[((i % N) + N) % N] = 1; });   // pontes e túnel (Vale)
      // trecho com o muro azul e amarelo (lado esquerdo, -1): sem postinhos/pneus/cones enfiados dentro dele
      const inWall = (i, sd) => def.wall && sd < 0 && (() => { const a = def.wall[0] - 3, b = def.wall[1] + 3, j = ((i % N) + N) % N; return a <= b ? j >= a && j <= b : j >= a || j <= b; })();
      const off = W + 4.8, ground = (p, i) => (tr.groundAt ? tr.groundAt(p, i, 0).h : tr.roadBase);
      const tires = [], cones = [], balloons = [];
      let cool = 0;
      for (let i = 0; i < N; i++) {
        if (cool > 0) { cool--; continue; }
        if (busy[i] || curv[i] < 0.012) continue;
        const out = -inside[i]; if (inWall(i, out)) continue;
        // parede de pneus no ápice + 3 cones antes da curva
        // pilhas de pneus em duplas encostadas (ao longo da pista), a cada ~8,6 m em volta do ápice
        for (let k = -2; k <= 2; k++) { const j = (i + k * 2 + N) % N; [-0.5, 0.5].forEach(e => { const p = tr.side(j, out * off, 0); p.x += T[j].x * e * 2 * TIRE.R; p.z += T[j].z * e * 2 * TIRE.R; p.y = ground(p, j); tires.push({ p, ang: Math.atan2(T[j].x, T[j].z) }); }); }
        for (let k = 1; k <= 3; k++) { const j = (i - 6 - k * 3 + N) % N; if (busy[j]) continue; const p = tr.side(j, out * (W + 1.6), 0); p.y = ground(p, j); cones.push(p); }
        cool = 26;
      }
      // balizadores (postinhos brancos com faixa refletiva) a cada ~13 m: referência visual
      // perto da câmera que "passa voando" -> dá muito mais sensação de velocidade, a custo de 1 chamada de desenho
      const posts = [];
      for (let i = 0; i < N; i += Math.max(2, Math.round(13 / (tr.length / N)))) [-1, 1].forEach(sd => {
        if (busy[i] || curv[i] >= 0.012 || inWall(i, sd)) return; const p = tr.side(i, sd * (W + 6), 0); p.y = ground(p, i); posts.push(p); tr.obstacles.push({ x: p.x, z: p.z, r: 0.3 }); });   // só nas retas, além do acostamento
      // (balões da largada removidos)

      const d = new THREE.Object3D(), group = new THREE.Group(); group.userData.dynamic = true; root.add(group);
      // pilha = 3 ou 4 pneus de borracha, cada um levemente fora de prumo, girado e com um tom de cinza próprio (usados/novos)
      if (tires.length) {
        const A = tireAssets(), hs = tires.map((t, ti) => 3 + ((ti * 7 + (ti >> 1) * 3) % 5 < 2 ? 1 : 0)), n = hs.reduce((a, b) => a + b, 0);
        const im = new THREE.InstancedMesh(A.geo, A.mat, n), col = new THREE.Color(); let c = 0, sd = 7; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
        tires.forEach((t, ti) => { let y = t.p.y + TIRE.H - 0.06;   // o de baixo meio enterrado na grama
          for (let h = 0; h < hs[ti]; h++) {
            d.position.set(t.p.x + (r() - 0.5) * 0.1, y, t.p.z + (r() - 0.5) * 0.1); d.rotation.set((r() - 0.5) * 0.05, r() * 6.283, (r() - 0.5) * 0.05); d.scale.set(1, 1, 1); d.updateMatrix(); im.setMatrixAt(c, d.matrix);
            const g = 0.82 + r() * 0.3; im.setColorAt(c, col.setRGB(g, g, g * (0.98 + r() * 0.04))); c++; y += TIRE.H * 2 * 0.96; } });   // um apoia no outro (laterais abauladas encaixam)
        im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.userData.noOutline = true; group.add(im);
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
