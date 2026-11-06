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

  // ---------- CONE de trânsito ----------
  // Corpo torneado (laranja com duas faixas refletivas brancas pintadas por vértice, bordas nítidas), boca com
  // aro arredondado no topo e base quadrada de borracha escura com cantos arredondados.
  let coneCache = null;
  function coneAssets() {
    if (coneCache) return coneCache;
    // [raio, altura, tipo] (tipo: 0 = laranja, 1 = faixa branca); pontos repetidos na mesma altura = troca de cor nítida
    const PR = [[0.0, 0.12, 0], [0.44, 0.12, 0], [0.47, 0.15, 0], [0.45, 0.2, 0], [0.4, 0.42, 0],
      [0.355, 0.6, 0], [0.355, 0.6, 1], [0.315, 0.76, 1], [0.315, 0.76, 0], [0.27, 0.94, 0],
      [0.27, 0.94, 1], [0.235, 1.08, 1], [0.235, 1.08, 0], [0.16, 1.36, 0], [0.13, 1.44, 0], [0.105, 1.46, 0], [0.085, 1.43, 0], [0.08, 1.38, 0]];
    const SEG = 28, g = new THREE.LatheGeometry(PR.map(p => new THREE.Vector2(p[0], p[1])), SEG);
    const cnt = g.attributes.position.count, col = new Float32Array(cnt * 3), OR = [1.0, 0.36, 0.06], WH = [0.97, 0.97, 0.95];
    for (let i = 0; i < cnt; i++) { const k = i % PR.length, c = PR[k][2] ? WH : OR, sh = k < 3 ? 0.82 : 1; col.set([c[0] * sh, c[1] * sh, c[2] * sh], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    let body = Toon.mat({ color: 0xffffff }, { gloss: 0.85, rim: 0.3, sat: 0, key: 'cone-v2' });
    if (body.isShaderMaterial || !('vertexColors' in body)) { const Lam = Toon.Lambert || THREE.MeshLambertMaterial; body = new Lam({ color: 0xffffff }); body.userData.noToon = true; }
    body.vertexColors = true; body.needsUpdate = true;
    const base = (window.GEO && GEO.rbox) ? GEO.rbox(1.08, 0.14, 1.08, 0.12) : new THREE.BoxGeometry(1.08, 0.14, 1.08);
    base.translate(0, 0.07, 0);
    const baseM = Toon.mat({ color: 0x24262c }, { gloss: 0.3, rim: 0.15, sat: 0, key: 'cone-base' });
    return (coneCache = { body, base, baseM, geo: g });
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
        for (let k = -2; k <= 2; k++) { const j = (i + k * 2 + N) % N; [-0.5, 0.5].forEach(e => { const p = tr.side(j, out * off, 0); p.x += T[j].x * e * 2 * TIRE.R; p.z += T[j].z * e * 2 * TIRE.R; p.y = ground(p, j); tires.push({ p, j, ang: Math.atan2(T[j].x, T[j].z) }); }); }
        for (let k = 1; k <= 3; k++) { const j = (i - 6 - k * 3 + N) % N; if (busy[j]) continue; const p = tr.side(j, out * (W + (tr.CB || 1.8) + 1.1), 0); p.y = ground(p, j); p.j = j; cones.push(p); }
        cool = 26;
      }
      const posts = [];   // balizadores (postinhos brancos) removidos
      // (balões da largada removidos)

      const d = new THREE.Object3D(), group = new THREE.Group(); group.userData.dynamic = true; root.add(group);
      // Pilhas de pneus com física: a pilha é sólida (o pneu de baixo segura o kart, como o muro) e, numa batida forte,
      // os pneus de cima saem voando: giram no ar, quicam, deslizam e deitam na grama. Uns 7 s depois eles caem do céu
      // de volta na pilha. Só os pneus soltos são animados; o resto fica parado.
      if (tires.length) {
        const A = tireAssets(), hs = tires.map((t, ti) => 3 + ((ti * 7 + (ti >> 1) * 3) % 5 < 2 ? 1 : 0)), n = hs.reduce((a, b) => a + b, 0);
        const im = new THREE.InstancedMesh(A.geo, A.mat, n), col = new THREE.Color(); let c = 0, sd = 7; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
        const TS = [], piles = [], STEP = TIRE.H * 2 * 0.96;
        tires.forEach((t, ti) => { let y = t.p.y + TIRE.H - 0.06; const pile = { x: t.p.x, z: t.p.z, j: t.j, list: [], cool: 0 };   // o de baixo meio enterrado na grama
          for (let h = 0; h < hs[ti]; h++) {
            const q = { i: c, h, pile, x: t.p.x + (r() - 0.5) * 0.1, y, z: t.p.z + (r() - 0.5) * 0.1, qh: new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.05, r() * 6.283, (r() - 0.5) * 0.05)),
              st: 0, t: 0, P: new THREE.Vector3(), V: new THREE.Vector3(), Q: new THREE.Quaternion(), W: new THREE.Vector3(), bounces: 0 };
            TS.push(q); pile.list.push(q);
            const g = 0.82 + r() * 0.3; im.setColorAt(c, col.setRGB(g, g, g * (0.98 + r() * 0.04))); c++; y += STEP; }   // um apoia no outro (laterais abauladas encaixam)
          piles.push(pile); tr.obstacles.push({ x: t.p.x, z: t.p.z, r: TIRE.R * 0.92 }); });
        const _M = new THREE.Matrix4(), _S = new THREE.Vector3(1, 1, 1), _dq = new THREE.Quaternion(), _ax = new THREE.Vector3(), _P = new THREE.Vector3();
        const write = q => { if (q.st === 0) _M.compose(_P.set(q.x, q.y, q.z), q.qh, _S); else _M.compose(q.P, q.Q, _S); im.setMatrixAt(q.i, _M); };
        TS.forEach(write);
        im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.userData.noOutline = true; im.frustumCulled = false; group.add(im);
        // batida: mede a velocidade do kart (de um quadro para o outro) quando ele encosta na pilha
        const lastT = new WeakMap(), loose = new Set(), RH = TIRE.R * 0.92 + 1.4 + 0.35;
        const knockPile = (pile, p, vx, vz, sp) => {
          const free = pile.list.filter(q => q.h > 0 && q.st === 0); if (!free.length) return;
          const k = Math.min(free.length, sp > 45 ? 3 : sp > 28 ? 2 : 1), fly = free.slice(-k);   // mais rápido = mais pneus derrubados
          let nx = pile.x - p.x, nz = pile.z - p.z; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
          fly.forEach((q, m) => { q.st = 1; q.t = 0; q.bounces = 0; q.P.set(q.x, q.y, q.z); q.Q.copy(q.qh);
            const f = 0.45 + 0.12 * m + Math.random() * 0.15;
            q.V.set(vx * f + nx * (4 + sp * 0.12) + (Math.random() - 0.5) * 4, 4 + sp * 0.12 + q.h * 1.2 + Math.random() * 2.5, vz * f + nz * (4 + sp * 0.12) + (Math.random() - 0.5) * 4);
            q.W.set(q.V.z, 0, -q.V.x).normalize().multiplyScalar(5 + sp * 0.15).add(_ax.set(0, (Math.random() - 0.5) * 6, 0)); loose.add(q); });
          pile.cool = 0.6; };
        const prevT = tr.obstacleHit;
        tr.obstacleHit = (p) => {
          const now = performance.now(), L = lastT.get(p); lastT.set(p, { x: p.x, z: p.z, t: now });
          if (L && now - L.t > 1 && now - L.t < 200) { const dts = (now - L.t) / 1000, vx = (p.x - L.x) / dts, vz = (p.z - L.z) / dts;
            for (const pile of piles) { const dx = pile.x - p.x, dz = pile.z - p.z; if (pile.cool > 0 || dx * dx + dz * dz > RH * RH) continue;
              const dl = Math.hypot(dx, dz) || 1, toward = (vx * dx + vz * dz) / dl;                              // velocidade de batida (em direção à pilha)
              if (toward > 14) knockPile(pile, p, vx, vz, Math.hypot(vx, vz)); } }
          return prevT(p); };
        const GR = 30, slerpFlat = (q, k) => { const e = new THREE.Euler().setFromQuaternion(q.Q, 'YXZ'); _dq.setFromEuler(new THREE.Euler(0, e.y, 0)); q.Q.slerp(_dq, k); };
        tr.animated.push((t, dt) => { dt = Math.min(0.05, dt || 0.016); piles.forEach(p => { if (p.cool > 0) p.cool -= dt; }); if (!loose.size) return;
          loose.forEach(q => { q.t += dt;
            if (q.st === 1) {                                                        // voando / quicando / deslizando
              q.V.y -= GR * dt; q.P.addScaledVector(q.V, dt);
              const wl = q.W.length(); if (wl > 0.01) q.Q.premultiply(_dq.setFromAxisAngle(_ax.copy(q.W).divideScalar(wl), wl * dt));
              const gy = ground({ x: q.P.x, z: q.P.z }, q.pile.j) + TIRE.H * 0.55;
              if (q.P.y < gy) { q.P.y = gy;
                if (q.V.y < -2.5 && q.bounces < 3) { q.V.y *= -0.42; q.V.x *= 0.7; q.V.z *= 0.7; q.W.multiplyScalar(0.6); q.bounces++; }
                else { q.V.y = 0; const fr = Math.max(0, 1 - 3.2 * dt); q.V.x *= fr; q.V.z *= fr; q.W.multiplyScalar(Math.max(0, 1 - 5 * dt)); slerpFlat(q, Math.min(1, 6 * dt)); q.P.y = ground({ x: q.P.x, z: q.P.z }, q.pile.j) + TIRE.H - 0.04; } }
              if (q.t > 7.5) { q.st = 2; q.t = 0; q.P.set(q.x, q.y + 9 + Math.random() * 3, q.z); q.V.set(0, 0, 0); q.Q.copy(q.qh); } }
            else if (q.st === 2) {                                                   // volta caindo do céu em cima da pilha
              const below = q.pile.list.filter(o => o.h < q.h).every(o => o.st === 0);
              q.V.y -= GR * dt; q.P.y += q.V.y * dt;
              if (q.P.y <= q.y) { if (!below) q.P.y = q.y; else if (q.V.y < -4) { q.P.y = q.y; q.V.y *= -0.25; } else { q.st = 0; loose.delete(q); } } }
            write(q); });
          im.instanceMatrix.needsUpdate = true; });
      }
      // cones de trânsito: corpo com faixas + base de borracha (2 chamadas de desenho para todos).
      // Derrubáveis: o kart que encosta arremessa o cone (gira, quica e some); ele reaparece no lugar depois de uns segundos.
      // Só os cones voando são animados. Não bloqueiam o kart nem passam pela rede (é só visual em cada tela).
      if (cones.length) {
        const C = coneAssets(), body = new THREE.InstancedMesh(C.geo, C.body, cones.length), base = new THREE.InstancedMesh(C.base, C.baseM, cones.length);
        const SC = 1.15, CS = cones.map((p, i) => ({ x: p.x, y: p.y - 0.02, z: p.z, yaw: i * 0.7, j: p.j || 0, st: 0, t: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, ax: new THREE.Vector3(1, 0, 0), ang: 0, wz: 0, bounced: false }));
        const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _M = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
        const write = (i, c) => { let sc = SC;
          if (c.st === 0) { _p.set(c.x, c.y, c.z); _q.setFromAxisAngle(_up, c.yaw); }
          else if (c.st === 1) { _p.set(c.px, c.py, c.pz); _q.setFromAxisAngle(c.ax, c.ang).multiply(_q2.setFromAxisAngle(_up, c.yaw)); if (c.t > 1.6) sc = SC * Math.max(0, 1 - (c.t - 1.6) / 0.35); }
          else if (c.st === 2) { sc = 0; _p.set(c.x, c.y, c.z); _q.identity(); }
          else { const k = Math.min(1, c.t / 0.35); sc = SC * (k < 0.7 ? k / 0.7 * 1.15 : 1.15 - 0.15 * (k - 0.7) / 0.3); _p.set(c.x, c.y, c.z); _q.setFromAxisAngle(_up, c.yaw); }   // reaparece com um "pop"
          _M.compose(_p, _q, _s.set(sc, sc, sc)); body.setMatrixAt(i, _M); base.setMatrixAt(i, _M); };
        CS.forEach((c, i) => write(i, c));
        body.castShadow = true; body.receiveShadow = true; base.receiveShadow = true; body.frustumCulled = base.frustumCulled = false;
        body.userData.outlineInstanced = true; base.userData.noOutline = true;
        group.add(body, base);
        // batida: o tracks.js já chama tr.obstacleHit(posição) para cada kart a cada quadro; aproveita essa chamada
        const last = new WeakMap(), HIT = 1.55, H2 = HIT * HIT;
        const knock = (c, p) => { const now = performance.now(), L = last.get(p); let vx = 0, vz = 0;
          if (L && now - L.t > 1 && now - L.t < 200) { vx = (p.x - L.x) / ((now - L.t) / 1000); vz = (p.z - L.z) / ((now - L.t) / 1000); }
          let ax = c.x - p.x, az = c.z - p.z; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
          const sp = Math.min(70, Math.hypot(vx, vz)), out = 6 + sp * 0.35;
          c.st = 1; c.t = 0; c.bounced = false; c.px = c.x; c.py = c.y + 0.05; c.pz = c.z;
          c.vx = vx * 0.75 + ax * out; c.vz = vz * 0.75 + az * out; c.vy = 7 + sp * 0.18 + Math.random() * 3;
          c.ax.set(c.vz, 0, -c.vx).normalize(); if (c.ax.lengthSq() < 0.5) c.ax.set(1, 0, 0); c.ang = 0; c.wz = 9 + sp * 0.25 + Math.random() * 4;
          active.add(c); };
        const active = new Set(); const prevHit = tr.obstacleHit;
        tr.obstacleHit = (p) => {
          for (const c of CS) { if (c.st !== 0) continue; const dx = p.x - c.x, dz = p.z - c.z; if (dx * dx + dz * dz < H2 && (p.y === undefined || p.y < c.y + 2.5)) knock(c, p); }
          last.set(p, { x: p.x, z: p.z, t: performance.now() });
          return prevHit(p); };
        tr.animated.push((t, dt) => { if (!active.size) return; dt = Math.min(0.05, dt || 0.016); let dirty = false;
          active.forEach(c => { const i = CS.indexOf(c); c.t += dt; dirty = true;
            if (c.st === 1) { c.vy -= 30 * dt; c.px += c.vx * dt; c.py += c.vy * dt; c.pz += c.vz * dt; c.ang += c.wz * dt;
              const gyh = ground({ x: c.px, z: c.pz }, c.j) - 0.02;
              if (c.py < gyh) { c.py = gyh; if (!c.bounced && c.vy < -3) { c.vy *= -0.38; c.vx *= 0.55; c.vz *= 0.55; c.wz *= 0.5; c.bounced = true; } else { c.vy = 0; c.vx *= 0.85; c.vz *= 0.85; c.wz *= 0.85; } }
              if (c.t > 1.95) { c.st = 2; c.t = 0; } }
            else if (c.st === 2) { if (c.t > 6) { c.st = 3; c.t = 0; } }
            else if (c.st === 3) { if (c.t > 0.35) { c.st = 0; active.delete(c); } }
            write(i, c); });
          if (dirty) { body.instanceMatrix.needsUpdate = true; base.instanceMatrix.needsUpdate = true; } });
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
