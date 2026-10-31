// =====================================================================================
// tracks.js — construção 3D das pistas
//  * Tracks.layout(def): gera o traçado (spline fechada com N nós) a partir dos segmentos do config
//  * Tracks.build(def, scene): monta asfalto, zebras, acostamento, pórtico, plataformas, rampas e o
//    cenário do tema 'classic' (grama, rio com pontes, cachoeira, lagos). As pistas Cidade e Praia foram
//    removidas. Devolve o objeto "track" usado pela física e pela IA.
// =====================================================================================
console.info('%c[tracks.js] versão otimizada (qualidade gráfica configurável)', 'color:#0bb;font-weight:bold');   // se esta linha não aparecer no console, o navegador está usando um tracks.js antigo
(function () {
  // ===================================================================================
  // GfxFX — melhorias gráficas compartilhadas (usadas aqui e no scenery.js)
  //  * aniso(tex): filtragem anisotrópica (asfalto e grama nítidos de longe, sem borrão no horizonte)
  //  * antiTile(mat, o): esconde a repetição do ladrilho (segunda amostra girada/ampliada + manchas grandes)
  //  * foliage(mat, o): vento nas árvores/arbustos/grama + sombreamento de oclusão (base escura, copa clara)
  // Todas as trocas de shader têm customProgramCacheKey próprio (senão o three.js reaproveita o programa errado).
  // ===================================================================================
  const GfxFX = window.GfxFX = {
    windU: { value: 0 },
    aniso(t, n) { if (t && t.isTexture && t.anisotropy < (n || 8)) { t.anisotropy = n || 8; t.needsUpdate = true; } return t; },
    NOISE: `float gfxH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gfxN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(gfxH(i), gfxH(i + vec2(1.0, 0.0)), f.x), mix(gfxH(i + vec2(0.0, 1.0)), gfxH(i + vec2(1.0, 1.0)), f.x), f.y); }\n`,
    // trecho que substitui o <map_fragment> do r128 (vUv já vem em "ladrilhos", com o repeat aplicado)
    mapCode(o) {
      o = Object.assign({ scale: 0.37, blend: 0.5, macro: 0.1, dry: 0 }, o);
      const f = v => (+v).toFixed(4);
      return `#ifdef USE_MAP
        vec4 texelColor = texture2D(map, vUv);
        vec4 gfxB = texture2D(map, mat2(0.788, -0.616, 0.616, 0.788) * vUv * ${f(o.scale)} + vec2(0.37, 0.71));
        float gfxM = gfxN(vUv * 0.11) * 0.65 + gfxN(vUv * 0.031 + 4.1) * 0.35;
        texelColor.rgb = mix(texelColor.rgb, gfxB.rgb, smoothstep(0.3, 0.7, gfxM) * ${f(o.blend)});
        texelColor = mapTexelToLinear(texelColor);
        diffuseColor *= texelColor;
        diffuseColor.rgb *= ${f(1 - o.macro)} + ${f(2 * o.macro)} * gfxN(vUv * 0.023 + 9.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.03, 0.7), smoothstep(0.6, 0.86, gfxN(vUv * 0.047 + 2.3)) * ${f(o.dry)});
      #endif`;
    },
    // soma um shader extra ao que o material já tiver (o Toon.during cria materiais toon com brilho de borda próprio)
    chain(m, key, fn) {
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
      m.userData.unique = true; delete m.userData.mergeKey;   // shader próprio: não pode ser juntado com outro material "igual"
      m.customProgramCacheKey = () => prevKey + '|' + key;
      m.onBeforeCompile = (sh, r) => { if (prev) prev.call(m, sh, r); fn(sh); };
      return m;
    },
    antiTile(m, o) {
      return GfxFX.chain(m, 'gfx-at:' + JSON.stringify(o || {}), sh => { sh.fragmentShader = GfxFX.NOISE + sh.fragmentShader.replace('#include <map_fragment>', GfxFX.mapCode(o)); });
    },
    // o: { amp (balanço por metro acima de h0), h0 (altura em que começa a balançar), freq, ao: [mín, y0, y1] }
    foliage(m, o) {
      o = Object.assign({ amp: 0.045, h0: 1.5, freq: 1.25, ao: null }, o);
      const f = v => (+v).toFixed(4);
      return GfxFX.chain(m, 'gfx-fol:' + JSON.stringify(o), sh => {
        sh.uniforms.uWindT = GfxFX.windU;
        sh.vertexShader = 'uniform float uWindT;\nvarying float vFolY;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 wp0 = modelMatrix[3].xyz;
            #ifdef USE_INSTANCING
              wp0 += instanceMatrix[3].xyz;
            #endif
            float ph = dot(wp0.xz, vec2(0.071, 0.053)), hh = max(transformed.y - ${f(o.h0)}, 0.0) * ${f(o.amp)};
            float gust = 0.55 + 0.45 * sin(uWindT * 0.37 + wp0.x * 0.004 + wp0.z * 0.003);
            transformed.x += hh * gust * (sin(uWindT * ${f(o.freq)} + ph) + 0.35 * sin(uWindT * ${f(o.freq * 2.3)} + ph * 1.7));
            transformed.z += hh * gust * 0.6 * cos(uWindT * ${f(o.freq * 0.83)} + ph * 1.3);
            vFolY = position.y;
          }`);
        sh.fragmentShader = 'varying float vFolY;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          ${o.ao ? `diffuseColor.rgb *= mix(${f(o.ao[0])}, 1.06, smoothstep(${f(o.ao[1])}, ${f(o.ao[2])}, vFolY));` : ''}`);
      });
    }
  };

  let N = 500;                    // nós por volta: vem de def.N (config); definido em layout() e build()
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

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
    bush() { const parts = []; [[0, 0.8, 0, 1.2], [0.9, 0.6, 0.3, 0.85], [-0.8, 0.65, -0.2, 0.9]].forEach(a => { const g = new THREE.IcosahedronGeometry(a[3], 1); g.translate(a[0], a[1], a[2]); parts.push({ g, grp: 0 }); }); return mergeParts(parts); }
  };

  // ===================================================================================
  function build(def, scene) {
    const L = layout(def), S = L.S, T = L.T, W = def.W; N = def.N || 500;
    // chão e mar cobrem a pista + o alcance da névoa em qualquer direção (antes: placa fixa de 3 km, a borda aparecia nas pistas maiores)
    const EXT = Math.max(Math.abs(L.bbox.x0), Math.abs(L.bbox.x1), Math.abs(L.bbox.z0), Math.abs(L.bbox.z1));
    const GS = Math.ceil((EXT + (def.fogFar || 820) + 400) * 2 / 100) * 100, RAD = Math.max(L.bbox.x1 - L.bbox.x0, L.bbox.z1 - L.bbox.z0) / 2;
    let seed = 7 + def.id.length * 13; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const tr = { def, N, W, S, T, length: L.length, startIdx: def.startIdx, roadBase: 0.1, lamps: [], nightMats: [], animated: [], obstacles: [], ponds: [], minimap: [], blockers: [], dustColor: 0xc9a878 };
    // ---------- qualidade gráfica (configurações) ----------
    // detail: geometria/enfeites desta pista (vale ao carregar); water: reflexo e refração da água (vale na hora)
    const QS = () => (window.Settings && Settings.q) ? Settings.q() : { water: 'high', detail: 'high' };
    const DET = QS().detail, LO = DET === 'low', MID = DET === 'medium', LIFEK = LO ? 0.4 : MID ? 0.7 : 1;
    tr.disposers = []; tr.dispose = () => { tr.disposers.forEach(f => { try { f(); } catch (e) { } }); tr.disposers = []; };   // chamado pelo main.js ao trocar de pista
    const side = tr.side = (i, o, y) => { i = ((i % N) + N) % N; return V3(S[i].x + T[i].z * o, y, S[i].z - T[i].x * o); };
    // pontes: elevação suave da pista (aceita índice fracionário)
    const bridges = def.bridges || [];
    // ponte: 3,4 m de altura, tabuleiro plano em ±6 nós e rampas suaves até ±18 nós (~75 m de cada lado)
    const BR = tr.BR = { H: 3.4, FLAT: 6, END: 18, RAIL: W + 1.5 };
    const bump = tr.bump = u => { let h = 0; for (const b of bridges) { const d = Math.abs(((u - b) % N + N + N / 2) % N - N / 2); h = Math.max(h, d <= BR.FLAT ? BR.H : d >= BR.END ? 0 : BR.H * (0.5 + 0.5 * Math.cos(Math.PI * (d - BR.FLAT) / (BR.END - BR.FLAT)))); } return h; };
    // ---------- relevo (def.elev): altura da pista em cada nó ----------
    // [nó, altura em metros] interpolados com PCHIP (suave, sem "passar do ponto" entre os pontos). Sem elev: pista plana.
    const H = tr.H = new Float32Array(N), ELEN = N;
    if (def.elev && def.elev.length > 1) {
      const K = def.elev.slice().sort((a, b) => a[0] - b[0]), X = [], Y = [];
      K.slice(-3).forEach(k => { X.push(k[0] - ELEN); Y.push(k[1]); }); K.forEach(k => { X.push(k[0]); Y.push(k[1]); }); K.slice(0, 3).forEach(k => { X.push(k[0] + ELEN); Y.push(k[1]); });
      const n = X.length, hs = [], dl = [], m = new Float64Array(n);
      for (let k = 0; k < n - 1; k++) { hs.push(X[k + 1] - X[k]); dl.push((Y[k + 1] - Y[k]) / hs[k]); }
      for (let k = 1; k < n - 1; k++) { if (dl[k - 1] * dl[k] <= 0) m[k] = 0; else { const w1 = 2 * hs[k] + hs[k - 1], w2 = hs[k] + 2 * hs[k - 1]; m[k] = (w1 + w2) / (w1 / dl[k - 1] + w2 / dl[k]); } }
      let k = 0;
      for (let i = 0; i < N; i++) { const sm = i; while (k < n - 2 && X[k + 1] < sm) k++;
        const t = (sm - X[k]) / hs[k], t2 = t * t, t3 = t2 * t;
        H[i] = (2 * t3 - 3 * t2 + 1) * Y[k] + (t3 - 2 * t2 + t) * hs[k] * m[k] + (-2 * t3 + 3 * t2) * Y[k + 1] + (t3 - t2) * hs[k] * m[k + 1]; }
    }
    const elevAt = tr.elevAt = u => { u = ((u % N) + N) % N; const i = Math.floor(u), f = u - i; return H[i] + (H[(i + 1) % N] - H[i]) * f; };
    const hAt = tr.hAt = u => elevAt(u) + bump(u);   // altura do asfalto (relevo + ponte)
    tr.vert = !!(def.elev && def.elev.length > 1);   // pista com relevo: o kart segue o perfil exato e decola nas cristas
    if (tr.vert) { const sg = L.length / N, C2 = new Float32Array(N);   // curvatura vertical (1/m): crista < 0, vale > 0
      for (let i = 0; i < N; i++) C2[i] = (H[(i + 3) % N] - 2 * H[i] + H[(i - 3 + N) % N]) / (9 * sg * sg);
      tr.curvAt = u => C2[((Math.round(u) % N) + N) % N]; }
    tr.busy = [];   // trechos sem adereços (props.js)
    const nearTrack = (p, m) => { for (let i = 0; i < N; i += 3) if (Math.hypot(S[i].x - p.x, S[i].z - p.z) < m) return true; return false; };
    const inside = (x, z) => { let c = false; for (let i = 0, j = N - 1; i < N; j = i++) { const a = S[i], b = S[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
    tr.nearTrack = nearTrack;
    const add = (o) => { scene.add(o); return o; };
    const LACC = [0]; for (let i = 1; i <= N; i++) LACC.push(LACC[i - 1] + S[i - 1].distanceTo(S[i % N]));

    // ---------- consulta de posição na pista ----------
    // "quanto a pista curva" em cada nó: ângulo entre as direções ~80 m antes e ~80 m depois (0 = reta, 1 = curva
    // de verdade). Usado pelo drift: o mini-turbo só carrega rápido em curva (fim do "spam" de drift em reta).
    { const C = new Float32Array(N), Kc = Math.max(6, Math.round(40 / (L.length / N)));
      for (let i = 0; i < N; i++) { const a = T[(i - Kc + N) % N], b = T[(i + Kc) % N], ang = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z))), t = Math.max(0, Math.min(1, (ang - 0.14) / 0.42)); C[i] = t * t * (3 - 2 * t); }
      tr.corner = C; tr.cornerAt = i => C[((i % N) + N) % N]; }
    // ---------- atalhos de terra (def.shortcuts) ----------
    // Cada atalho é uma curva suave que sai da beira da pista no nó i, entra no miolo da curva e volta no nó j.
    // shortcutDist: distância (m) até o eixo do atalho mais próximo, menos a meia-largura dele (negativo = em cima do atalho).
    tr.shortcuts = (def.shortcuts || []).map(([i0, j0, sg, o]) => {
      const k = Math.round((i0 + j0) / 2), hw = 7.5;
      const P = [side(i0 - 2, sg * (W - 6), 0), side(i0, sg * (W - 1), 0), side(i0 + 3, sg * (W + 14), 0), side(k, sg * o, 0), side(j0 - 3, sg * (W + 14), 0), side(j0, sg * (W - 1), 0), side(j0 + 2, sg * (W - 6), 0)];
      const c = new THREE.CatmullRomCurve3(P, false, 'centripetal'), n = Math.max(40, Math.round(c.getLength() / 2.5)), pts = c.getSpacedPoints(n);
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; pts.forEach(q => { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); });
      return { i: i0, j: j0, sg, hw, pts, box: [x0 - 20, x1 + 20, z0 - 20, z1 + 20] };
    });
    const shortcutDist = tr.shortcutDist = (x, z) => { let m = 1e9;
      for (const sc of tr.shortcuts) { const b = sc.box; if (x < b[0] || x > b[1] || z < b[2] || z > b[3]) continue;
        const P = sc.pts; for (let k = 0; k < P.length - 1; k++) { const ax = P[k].x, az = P[k].z, bx = P[k + 1].x - ax, bz = P[k + 1].z - az, L2 = bx * bx + bz * bz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / L2)), d = Math.hypot(x - ax - bx * t, z - az - bz * t) - sc.hw; if (d < m) m = d; } }
      return m; };
    // altura do caminho no ponto (perfil suavizado calculado em buildShortcuts); null se não houver perfil ainda
    tr.shortcutHeight = (x, z) => { let m = 1e9, h = null;
      for (const sc of tr.shortcuts) { const b = sc.box, H2 = sc.h; if (!H2 || x < b[0] || x > b[1] || z < b[2] || z > b[3]) continue;
        const P = sc.pts; for (let k = 0; k < P.length - 1; k++) { const ax = P[k].x, az = P[k].z, bx = P[k + 1].x - ax, bz = P[k + 1].z - az, L2 = bx * bx + bz * bz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / L2)), d = Math.hypot(x - ax - bx * t, z - az - bz * t); if (d < m) { m = d; h = H2[k] + (H2[k + 1] - H2[k]) * t; } } }
      return h; };
    tr.dirtAt = p => tr.shortcuts.length > 0 && shortcutDist(p.x, p.z) < 0.6;           // terra batida: o kart perde pouco (kart.js)
    tr.clearAt = (x, z) => tr.shortcuts.length > 0 && shortcutDist(x, z) < 7;           // cenário (scenery.js) não nasce em cima do atalho

    tr.nearest = (p, hint) => {
      let best = 1e18, bi = hint || 0; const base = bi;
      for (let d = -25; d <= 25; d++) { const i = (base + d + N) % N, dx = S[i].x - p.x, dz = S[i].z - p.z, q = dx * dx + dz * dz; if (q < best) { best = q; bi = i; } }
      // atalho (ou muito longe do trecho esperado): procura na pista inteira. Os atalhos pulam 70+ nós, mais que a busca local
      // (±25); sem isso o kart "se perdia" ao sair do atalho. Só no atalho ou além do muro, para não virar atalho pela grama.
      const WL = tr.WALL || W + 36;
      if (best > (W + 10) * (W + 10) && (best > (WL - 2) * (WL - 2) || (tr.shortcuts.length && shortcutDist(p.x, p.z) < 6)))
        for (let i = 0; i < N; i++) { const dx = S[i].x - p.x, dz = S[i].z - p.z, q = dx * dx + dz * dz; if (q < best) { best = q; bi = i; } }
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
        for (let c = 0; c <= nx; c++) { const f = c / nx, off = a + (b - a) * f, p = side(k, off, y + (o.flat ? H[k] : hAt(k))); pos.push(p.x, p.y, p.z);
          uv.push((o.flipU ? 1 - f : f) * o.uSpan, LACC[i] / o.vLen);
          const v = o.col ? o.col(k, f) : 1; if (typeof v === 'number') cc.setRGB(v, v, v); else cc.setRGB(v[0], v[1], v[2]); col.push(cc.r, cc.g, cc.b); } }
      for (let i = 0; i < N; i++) { if (o.skip && o.skip(i)) continue; for (let c = 0; c < nx; c++) { const p0 = i * C + c, p1 = p0 + C; idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      if (o.map) GfxFX.aniso(o.map, o.antiTile ? 16 : 8);
      const m = o.phong ? new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide, map: o.map, shininess: o.phong.shininess, specular: o.phong.specular })
        : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: o.map });
      if (o.antiTile) GfxFX.antiTile(m, o.antiTile);
      if (o.roadFx) roadFx(m);
      if (o.alphaTest) m.alphaTest = o.alphaTest;
      if (o.po) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = o.po; }
      const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; return add(mesh);
    }
    // ASFALTO REFINADO (em metros, a partir do uv da faixa: lateral = uv.x*7 - W, ao longo = uv.y*7):
    // agregado fino com pedrinhas claras, faixas de borracha escura onde os pneus passam (mais brilhantes),
    // remendos de asfalto novo, rachaduras finas e manchas de óleo. O detalhe fino some com a distância (sem chuvisco).
    function roadFx(m) {
      const Wf = (+W).toFixed(1);
      return GfxFX.chain(m, 'road-fx-v3:' + Wf, sh => {
        // distância da câmera calculada aqui (vRdZ): não depende de vViewPosition, que não existe em todo tipo de material
        // (no Lambert ela não existe; usando, o shader não compilava e a pista sumia)
        sh.vertexShader = 'varying vec2 vRd;\nvarying float vRdZ;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRd = vec2(uv.x * 7.0 - ' + Wf + ', uv.y * 7.0);\n vRdZ = length((modelViewMatrix * vec4(transformed, 1.0)).xyz);');
        sh.fragmentShader = 'varying vec2 vRd;\nvarying float vRdZ;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float rdF = 1.0 - smoothstep(25.0, 150.0, vRdZ);
          float rdL = vRd.x, rdA = vRd.y, rdN = rdL / ${Wf};
          // agregado: grão fino + pedrinhas claras soltas
          float rdG = gfxN(vRd * 3.1) * 0.6 + gfxN(vRd * 9.7 + 3.0) * 0.4;
          diffuseColor.rgb *= 1.0 + (rdG - 0.5) * 0.18 * rdF;
          float rdS = step(0.9, gfxH(floor(vRd * 16.0))) * rdF;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.45 + 0.025, rdS * 0.3);
          // borracha: duas faixas por onde passam os pneus, com a linha de corrida mudando devagar ao longo da pista
          float rdLn = sin(rdA * 0.0061 + 1.3) * 0.28 + sin(rdA * 0.017) * 0.08;
          float rdW1 = (rdN - rdLn - 0.11) / 0.085, rdW2 = (rdN - rdLn + 0.11) / 0.085;   // x*x (pow com base negativa dá NaN na placa de vídeo e a pista some)
          float rdW = exp(-rdW1 * rdW1) + exp(-rdW2 * rdW2);
          float rdWear = clamp(rdW, 0.0, 1.0) * (0.65 + 0.35 * gfxN(vec2(rdL * 0.6, rdA * 0.05)));
          diffuseColor.rgb *= 1.0 - 0.14 * rdWear;
          // remendos de asfalto novo (retângulos com borda macia, mais escuros)
          vec2 rdU = vec2((rdL + ${Wf}) / 5.0, rdA / 9.0), rdC = floor(rdU), rdQ = fract(rdU);
          float rdPe = smoothstep(0.0, 0.05, rdQ.x) * (1.0 - smoothstep(0.95, 1.0, rdQ.x)) * smoothstep(0.0, 0.04, rdQ.y) * (1.0 - smoothstep(0.96, 1.0, rdQ.y));
          float rdPatch = step(0.94, gfxH(rdC + 17.0)) * rdPe;
          diffuseColor.rgb *= mix(1.0, 0.8 + 0.1 * gfxH(rdC + 3.0), rdPatch);
          // rachaduras finas (só em alguns trechos, menos onde a borracha cobriu)
          float rdK = abs(gfxN(vRd * 0.45 + 11.0) - 0.5);
          float rdCr = (1.0 - smoothstep(0.004, 0.016, rdK)) * smoothstep(0.58, 0.78, gfxN(vRd * 0.06 + 5.0)) * rdF * (1.0 - rdWear * 0.7) * (1.0 - rdPatch);
          diffuseColor.rgb *= 1.0 - 0.32 * rdCr;
          // manchas de óleo no meio da faixa
          float rdOil = smoothstep(0.72, 0.9, gfxN(vec2(rdL * 0.6, rdA * 0.12) + 21.0)) * (1.0 - smoothstep(0.12, 0.4, abs(rdN)));
          diffuseColor.rgb *= 1.0 - 0.12 * rdOil;
          diffuseColor.rgb = clamp(diffuseColor.rgb, 0.0, 4.0);`)
          .replace('#include <specularmap_fragment>', `#include <specularmap_fragment>
          specularStrength *= 0.7 + 0.7 * rdWear + 0.6 * rdOil - 0.35 * rdPatch - 0.2 * rdCr;`);
      });
    }
    // grama mais natural: a textura original é um verde-limão muito vivo; aqui ela perde parte da saturação,
    // puxa um pouco para o oliva e escurece de leve (mesmo ajuste no chão grande e na malha do relevo, sem emenda)
    const GRASS_TONE = { sat: 0.6, mul: [0.88, 0.81, 0.72] };
    function grassTone(m) {
      m.userData.unique = true; m.customProgramCacheKey = () => 'grass-tone-v2'; GfxFX.aniso(m.map, 16);
      // + sem repetição visível do ladrilho, manchas grandes de cor e trechos de grama mais seca (mesma conta nos dois chãos: sem emenda)
      m.onBeforeCompile = sh => { sh.fragmentShader = GfxFX.NOISE + sh.fragmentShader.replace('#include <map_fragment>', GfxFX.mapCode({ scale: 0.29, blend: 0.55, macro: 0.13, dry: 0.55 }) + `
        { float gl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)); diffuseColor.rgb = mix(vec3(gl), diffuseColor.rgb, ${GRASS_TONE.sat.toFixed(3)}) * vec3(${GRASS_TONE.mul.map(v => v.toFixed(3)).join(', ')}); }`); };
      return m;
    }
    // montanhas: material procedural (sem textura esticada). Rocha com camadas e rachaduras em várias escalas,
    // grama nas partes baixas e pouco inclinadas, neve no topo dos picos altos (acumula mais nas faces planas),
    // relevo fino na iluminação (bump) e luz por pixel. Cor do vértice: r = altura relativa 0..1, g = tem neve, b = domo.
    // ruído 3D suave (valor) para deformar a geometria das montanhas
    const vh3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
    const vn3 = (x, y, z) => { const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z); let fx = x - i, fy = y - j, fz = z - k;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz); const L = (a, b, t) => a + (b - a) * t;
      return L(L(L(vh3(i, j, k), vh3(i + 1, j, k), fx), L(vh3(i, j + 1, k), vh3(i + 1, j + 1, k), fx), fy), L(L(vh3(i, j, k + 1), vh3(i + 1, j, k + 1), fx), L(vh3(i, j + 1, k + 1), vh3(i + 1, j + 1, k + 1), fx), fy), fz); };
    function mountainMat() {
      const m = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 6, specular: 0x161616 });
      m.userData.unique = true; m.customProgramCacheKey = () => 'mountain-proc' + (LO ? '-lite' : '');
      m.onBeforeCompile = sh => {
        sh.vertexShader = 'varying vec3 vMW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vMW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = `varying vec3 vMW;
          float mh3(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
          float mn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(mh3(i), mh3(i + vec3(1,0,0)), f.x), mix(mh3(i + vec3(0,1,0)), mh3(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(mh3(i + vec3(0,0,1)), mh3(i + vec3(1,0,1)), f.x), mix(mh3(i + vec3(0,1,1)), mh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
          float mfbm(vec3 p){ return mn3(p) * 0.5 + mn3(p * 2.03 + 1.7) * 0.25 + mn3(p * 4.11 + 3.1) * 0.15 + mn3(p * 8.3 + 5.3) * 0.1; }
          float mBump(vec3 p, float fd){ return mn3(p * 0.16 + 5.0) * 0.7 + mn3(p * 0.42) * 0.35; }
          ` + sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // ===== montanha procedural (alta qualidade) =====
            // relevo fino por gradiente de ruído em espaço de mundo (sem dFdx/dFdy -> acabou o "pixelado" em blocos de 2x2),
            // estratos ondulados, rachaduras, líquen, cascalho, grama com manchas secas e neve que assenta nas partes planas.
            // O detalhe fino some com a distância (sem chuvisco/serrilhado nas montanhas do fundo).
            vec3 P = vMW; float dist = length(cameraPosition - P);
            float fd = ${LO ? '0.0' : '1.0 - smoothstep(60.0, 420.0, dist)'}, fm = 1.0 - smoothstep(350.0, 1600.0, dist);
            vec3 wn0 = inverseTransformDirection(normal, viewMatrix);
            vec3 wn = wn0;
            if (fd > 0.001) {   // relevo fino só perto da câmera (de longe, nem calcula: economiza 4 ruídos por pixel)
              float e = 0.5;
              float b0 = mBump(P, fd), bx = mBump(P + vec3(e, 0.0, 0.0), fd), by = mBump(P + vec3(0.0, e, 0.0), fd), bz = mBump(P + vec3(0.0, 0.0, e), fd);
              vec3 gw = vec3(bx - b0, by - b0, bz - b0) / e; gw -= dot(gw, wn0) * wn0;
              wn = normalize(wn0 - gw * 0.35 * fd);
            }
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
            float up = wn.y, hr = vColor.r, tall = vColor.g, dome = vColor.b;
            float n1 = mfbm(P * 0.011), n2 = mfbm(P * 0.047 + 7.0), n3 = mix(0.5, mn3(P * 0.42), fd);
            // rocha: camadas inclinadas e onduladas + manchas quentes + rachaduras + líquen
            vec3 rock = mix(vec3(0.47, 0.45, 0.43), vec3(0.58, 0.555, 0.52), clamp(n2 * 0.8 + (n1 - 0.5) * 0.4, 0.0, 1.0));
            rock = mix(rock, vec3(0.56, 0.5, 0.43), smoothstep(0.58, 0.85, n1) * 0.25);                  // tons mais quentes em manchas
            rock *= 0.92 + 0.16 * n3;
            rock = mix(rock, vec3(0.44, 0.5, 0.31), smoothstep(0.63, 0.82, n2) * 0.35 * smoothstep(0.25, 0.7, up));   // líquen
            // grama: dois verdes + manchas secas; cascalho nas encostas médias
            vec3 grass = mix(vec3(0.25, 0.39, 0.15), vec3(0.40, 0.52, 0.22), n2);
            grass = mix(grass, vec3(0.53, 0.5, 0.28), smoothstep(0.62, 0.86, n1) * 0.45) * (0.9 + 0.18 * n3);
            vec3 scree = vec3(0.56, 0.51, 0.43) * (0.85 + 0.25 * n3);
            float jag = (n2 - 0.5) * 0.3 + (n3 - 0.5) * 0.12;
            float gU = smoothstep(0.62 - 0.2 * dome, 0.82 - 0.2 * dome, up + jag);
            float gH = 1.0 - smoothstep(0.3 + 0.5 * dome, 0.55 + 0.5 * dome, hr + jag * 0.6);
            float gr = max(gU * gH, 1.0 - smoothstep(0.04, 0.16, hr + jag * 0.3));
            float sc = smoothstep(0.42, 0.62, up + jag) * (1.0 - gr);
            vec3 col = mix(rock, scree, sc * 0.55);
            col = mix(col, grass, gr);
            // neve: no alto e onde é mais plano; sombra azulada nas partes íngremes
            float sn = tall * smoothstep(0.55, 0.63, hr + (n1 - 0.5) * 0.16 + (up - 0.55) * 0.32 + (n3 - 0.5) * 0.05);
            vec3 snow = vec3(0.93, 0.95, 1.0) * (0.93 + 0.07 * n3); snow = mix(snow * vec3(0.82, 0.88, 1.0), snow, smoothstep(0.25, 0.8, up));
            col = mix(col, snow, sn);
            diffuseColor.rgb = col;
          }`);

      };
      return m;
    }
    // chão grande com variação de cor por vértice (esconde a repetição do ladrilho)
    function groundPlane(texName, tile, tint, y) {
      const t = TX.get(texName, GS / tile, GS / tile), g = new THREE.PlaneGeometry(GS, GS, LO ? 48 : MID ? 100 : 200, LO ? 48 : MID ? 100 : 200), p = g.attributes.position, c = [];
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = -p.getY(i);
        const m = 0.9 + 0.06 * Math.sin(x * 0.013 + 1.3) * Math.cos(z * 0.011) + 0.05 * Math.sin(x * 0.034 + z * 0.029) + 0.03 * Math.sin(x * 0.071 - z * 0.064 + 2);
        const h = Math.sin(x * 0.009 - z * 0.012 + 0.7) * 0.5 + 0.5; c.push(m * (1 + tint * h), m, m * (1 - tint * 1.4 * h)); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      const mesh = new THREE.Mesh(g, grassTone(new THREE.MeshLambertMaterial({ map: t, vertexColors: true }))); mesh.rotation.x = -Math.PI / 2; mesh.position.y = y || 0; mesh.receiveShadow = true; return add(mesh);
    }
    // instancia uma planta procedural em vários pontos
    function plants(kind, list, leafColor, barkTex, leafTex, opts) {
      if (!list.length) return null;
      const geo = PLANTS[kind](1);
      const leafM = new THREE.MeshLambertMaterial({ color: leafColor, map: TX.get(leafTex || 'leaf', 1, 1), flatShading: true, side: THREE.DoubleSide, alphaTest: 0 });
      const barkM = new THREE.MeshLambertMaterial({ color: 0xffffff, map: TX.get(barkTex || 'bark', 1, 1), flatShading: true });
      // vento + oclusão (base escura, copa clara); folhas e tronco com a mesma conta, então não descolam
      const fo = kind === 'bush' ? { amp: 0.05, h0: 0.3, freq: 1.6, ao: [0.6, 0.0, 2.0] } : kind === 'pine' ? { amp: 0.04, h0: 1.4, freq: 1.1, ao: [0.5, 0.6, 7.2] } : { amp: 0.045, h0: 2.2, freq: 1.25, ao: [0.5, 1.0, 7.0] };
      GfxFX.foliage(leafM, fo); GfxFX.foliage(barkM, Object.assign({}, fo, { ao: [0.7, 0.0, 3.4] }));
      const im = new THREE.InstancedMesh(geo, [leafM, barkM], list.length), d = new THREE.Object3D();
      const bh = kind === 'bush' ? [1, 1.4] : kind === 'pine' ? [4.5, 3] : [4.6, 3.2];
      list.forEach((o, i) => { d.position.set(o.x, o.y || 0, o.z); d.rotation.set(0, o.r, 0); d.scale.setScalar(o.s); d.updateMatrix(); im.setMatrixAt(i, d.matrix); tr.blockers.push({ x: o.x, y: (o.y || 0) + bh[0] * o.s, z: o.z, r: bh[1] * o.s }); });
      im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; return add(im);
    }
    const glowSpr = (col, sc, op) => { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op })); p.scale.setScalar(sc); return add(p); };

    // ---------- pista: asfalto, faixas, zebras ----------
    const notBridge = i => bump(i) > 0.02 || bump((i + 1) % N) > 0.02;
    const asphaltTint = [1, 1, 1.02];
    strip(-W, W, 0.05, { nx: 16, map: TX.get('asphalt'), phong: { shininess: 30, specular: 0x26262a }, antiTile: LO ? null : { scale: 0.41, blend: 0.45, macro: 0.07 }, roadFx: !LO, uSpan: 2 * W / 7, vLen: 7, col: (i, f) => { const v = 1 - 0.1 * Math.exp(-Math.pow((f - 0.5) / 0.2, 2)) + 0.04 * Math.sin(i * 0.21) * Math.sin(i * 0.057) + 0.04 * Math.pow(Math.abs(f - 0.5) * 2, 6); return asphaltTint.map(k => v * k); } });
    [-1, 1].forEach(s => strip(s * (W - 0.85), s * (W - 0.4), 0.06, { map: TX.get('paint'), uSpan: 0.2, vLen: 3, po: -2 }));
    strip(-0.22, 0.22, 0.09, { map: TX.get('paint'), uSpan: 0.1, vLen: 3, po: -2, skip: i => !((Math.floor(i / 3) % 2)) });
    strip(W, W + 1.8, 0.085, { map: TX.get('curb'), uSpan: 1, vLen: 4 }); strip(-W - 1.8, -W, 0.085, { map: TX.get('curb'), uSpan: 1, vLen: 4, flipU: true });
    strip(W + 1.8, W + 5.2, 0.035, { map: TX.get('dirt'), uSpan: 1, vLen: 5, alphaTest: 0.5, skip: i => notBridge(i), flat: true });
    strip(-W - 5.2, -W - 1.8, 0.035, { map: TX.get('dirt'), uSpan: 1, vLen: 5, alphaTest: 0.5, skip: i => notBridge(i), flat: true, flipU: true });

    // ---------- linha de largada + pórtico ----------
    const si = def.startIdx, sAng = Math.atan2(T[si].x, T[si].z);
    { const line = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 2.4), new THREE.MeshLambertMaterial({ map: TX.get('startLine'), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
      line.rotation.x = -Math.PI / 2; const g = new THREE.Group(); g.add(line); g.position.set(S[si].x, 0.1 + hAt(si), S[si].z); g.rotation.y = sAng; line.receiveShadow = true; add(g); }
    // marcas do grid de largada
    const mPerNode = L.length / N; tr.gridNode = m => -Math.round(m / mPerNode);
    tr.grid = (CFG.GRID || [[10, -4], [17, 4]]).map(([m, lat]) => [tr.gridNode(m), lat]);
    { const gm = new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }), gg = new THREE.PlaneGeometry(3.6, 0.35);
      tr.grid.forEach(([di, lat]) => { const th = Math.atan2(T[(si + di + N) % N].x, T[(si + di + N) % N].z), p = side(si + di, lat, 0.075 + hAt((si + di + N) % N));
        const m = new THREE.Mesh(gg, gm); m.rotation.x = -Math.PI / 2; const g = new THREE.Group(); g.position.copy(p); g.rotation.y = th; m.position.z = 2.2; g.add(m); add(g); }); }
    // Pórtico de largada 3D: duas torres treliçadas, viga treliçada no topo, painel pendurado com o nome do jogo
    // em LETRAS 3D (traços extrudados, sem imagem e sem arquivo de fonte), faixa quadriculada de cubos,
    // lâmpadas no contorno do painel (acendem à noite) e o semáforo de largada embaixo.
    const arch = new THREE.Group(); arch.position.set(S[si].x, hAt(si), S[si].z); arch.rotation.y = sAng; add(arch);
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
      const PW = 2 * AW - 5, PH = 5.8, PY = 9.9, PD = 0.9;   // painel mais alto: cabe o SUPER em cima e a logo KARTEC embaixo
      [-0.42, 0.42].forEach(f => bar(f * PW, PY + PH / 2 - 0.2, 0, f * PW, BY, 0, 0.09, white));            // tirantes
      gadd(GEO.rbox(PW + 0.6, PH + 0.6, PD, 0.35), ink, 0, PY, 0);                                            // moldura escura
      gadd(GEO.rbox(PW, PH, PD + 0.16, 0.25), new THREE.MeshLambertMaterial({ color: 0x1b1e29 }), 0, PY, 0);   // face grafite (a logo vermelha/branca se destaca)
      [PY + PH / 2 - 0.22, PY - PH / 2 + 0.22].forEach(y => gadd(GEO.rbox(PW - 0.3, 0.3, PD + 0.3, 0.1), red, 0, y, 0));   // filetes vermelhos em cima e embaixo                                                 // face vermelha (8 cm para fora da moldura)
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
      // texto em letras 3D (traços com espessura): usado para o "SUPER" e, se a logo 3D não carregar, para o "KARTEC"
      const makeText = (text, LH, R, maxW) => { const GAP = 0.3 * LH, SP = 0.7 * LH, widthOf = ch => ch === ' ' ? SP : 0.7 * LH;
        const total = [...text].reduce((w, ch, i) => w + widthOf(ch) + (i ? GAP : 0), 0), k3 = Math.min(1, maxW / total);
        const g = new THREE.Group(); let x = -total / 2;
        [...text].forEach((ch, i) => { if (i) x += GAP; const gl = GLYPHS[ch];
          if (gl) { const P2 = p => V3(x + p[0] * LH, (p[1] - 0.5) * LH, 0), joint = p => { const s = new THREE.Mesh(new THREE.SphereGeometry(R, 12, 8), letterM); s.position.copy(P2(p)); g.add(s); };
            (gl.l || []).forEach(pl => { pl.forEach(joint); for (let k = 1; k < pl.length; k++) { const a = P2(pl[k - 1]), b = P2(pl[k]); bar(a.x, a.y, a.z, b.x, b.y, b.z, R, letterM, g); } });
            (gl.c || []).forEach(cv => { const curve = new THREE.CatmullRomCurve3(cv.map(P2), false, 'centripetal'); g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, cv.length * 6, R, 10, false), letterM)); joint(cv[0]); joint(cv[cv.length - 1]); }); }
          x += widthOf(ch); });
        g.scale.setScalar(k3); g.userData.w = total * k3; g.traverse(o => { if (o.isMesh) o.castShadow = true; }); Toon.outline(g, 0.04); return g; };
      const faceZ = PD / 2 + 0.08;
      // só a logo KARTEC, bem grande e centralizada no painel (os dois lados)
      const LOGO_H = PH - 0.7, LOGO_Y = PY;
      const layout = items => items.forEach(g => { g.position.x = 0; });
      // logo KARTEC 3D (o mesmo modelo do menu, assets/karttec_logo.glb, carregado pelo logo3d.js), dos dois lados do painel
      const putLogo = () => {
        const L3 = window.Logo3D, geo = L3.geo, bb = L3.bb, size = bb.getSize(V3(0, 0, 0)), mid = bb.getCenter(V3(0, 0, 0)), lay = L3.layers || [0.193, 0.165];
        const U = { uZ: { value: new THREE.Vector2(lay[0], lay[1]) }, uY: { value: new THREE.Vector2(bb.max.y - 0.04, bb.min.y + 0.06) },
          uG0: { value: new THREE.Color('#FFA79A') }, uG1: { value: new THREE.Color('#FF4D5E') }, uG2: { value: new THREE.Color('#E8213A') }, uG3: { value: new THREE.Color('#C4102B') },
          uWhite: { value: new THREE.Color('#FFFFFF') }, uInk: { value: new THREE.Color('#2B2B2E') }, uSelf: { value: 0.12 } };
        const lm = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80, specular: 0x666666 });
        lm.userData.unique = true; lm.customProgramCacheKey = () => 'kartec-logo-arch';
        lm.onBeforeCompile = sh => { Object.assign(sh.uniforms, U);
          sh.vertexShader = 'varying vec3 vLP;\nvarying vec3 vLN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLP = position; vLN = normal;');
          sh.fragmentShader = 'varying vec3 vLP;\nvarying vec3 vLN;\nuniform vec2 uZ;\nuniform vec2 uY;\nuniform vec3 uG0;\nuniform vec3 uG1;\nuniform vec3 uG2;\nuniform vec3 uG3;\nuniform vec3 uWhite;\nuniform vec3 uInk;\nuniform float uSelf;\n' +
            sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
              vec3 ln = normalize(vLN); float face = smoothstep(0.55, 0.8, abs(ln.z)); float az = abs(vLP.z);
              float t = clamp((uY.x - vLP.y) / (uY.x - uY.y), 0.0, 1.0);
              vec3 gold = t < 0.38 ? mix(uG0, uG1, t / 0.38) : t < 0.78 ? mix(uG1, uG2, (t - 0.38) / 0.4) : mix(uG2, uG3, (t - 0.78) / 0.22);
              gold = mix(uG3 * 0.8, gold, face);
              vec3 white = mix(uWhite * 0.8, uWhite * 0.97, face);
              vec3 ink = uInk * mix(0.75, 1.25, clamp((vLP.y - uY.y) / (uY.x - uY.y), 0.0, 1.0)); ink = mix(ink * 0.7, ink, face);
              float wW = smoothstep(uZ.y - 0.004, uZ.y + 0.004, az), wG = smoothstep(uZ.x - 0.004, uZ.x + 0.004, az);
              diffuseColor.rgb = mix(mix(ink, white, wW), gold, wG);`)
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uSelf;'); };
        const k = Math.min(LOGO_H / size.y, PW * 0.94 / size.x);
        layout([-1, 1].map(sd => { const g = new THREE.Group(), m = new THREE.Mesh(geo, lm); m.position.copy(mid).negate(); m.castShadow = true; g.add(m);
          g.scale.setScalar(k); g.position.set(0, LOGO_Y, sd * (faceZ + size.z * k / 2 + 0.02)); if (sd < 0) g.rotation.y = Math.PI;
          g.userData.dynamic = true; g.userData.sd = sd; arch.add(g); return g; }), size.x * k);   // dynamic: não entra na junção de malhas (o shader usa a posição do próprio modelo)
      };
      let logoDone = false;
      const glyphLogo = () => { if (logoDone) return; logoDone = true; const ts = [-1, 1].map(sd => { const t = makeText('KARTEC', LOGO_H * 0.85, 0.4, PW * 0.9); t.position.set(0, LOGO_Y, sd * (faceZ + 0.4)); if (sd < 0) t.rotation.y = Math.PI; t.userData.sd = sd; arch.add(t); return t; }); layout(ts, ts[0].userData.w); };
      const tryLogo = () => { if (logoDone) return true; const L3 = window.Logo3D; if (L3 && L3.geo) { logoDone = true; try { putLogo(); } catch (e) { console.warn('[pórtico] logo 3D:', e); logoDone = false; glyphLogo(); } return true; }
        if (!L3 || L3.status === 'erro') { glyphLogo(); return true; } return false; };
      if (!tryLogo()) { const on = () => { removeEventListener('kartec-logo', on); tryLogo(); }; addEventListener('kartec-logo', on); setTimeout(() => { if (!tryLogo() && window.Logo3D && Logo3D.status !== 'ok') glyphLogo(); }, 15000); }
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
    // Painel de LEDs "gamer": grade de quadradinhos (apagados) com setas em "^" acesas que andam para a frente
    // de quadradinho em quadradinho. Sem moldura. As cores ficam trocando (arco-íris que corre pelo painel) e ele
    // tem brilho próprio: os LEDs acesos "vazam" luz e há um halo suave no asfalto em volta.
    // Fica inclinado junto com a pista (subidas/descidas). Desenho todo no shader (sem textura).
    // Ajustes em CFG.BOOSTPAD (opcional): CYCLE (troca de cor), HUE_SPEED, ON/OFF/BG (cores fixas se CYCLE: false),
    // COLS, SPEED, GLOW.
    const PAD_L = 11, PAD_W = 8.2, PAD_H = 0.14, pads = tr.pads = [];
    const PB = Object.assign({ CYCLE: true, HUE_SPEED: 0.12, ON: '#3cff4e', OFF: '#0d6418', BG: '#052a09', COLS: 18, SPEED: 9, GLOW: 1 }, CFG.BOOSTPAD || {});
    const padU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 }, uAdd: { value: 0 }, uSize: { value: new THREE.Vector3(PAD_W, PAD_H, PAD_L) },
      uOn: { value: new THREE.Color(PB.ON) }, uOff: { value: new THREE.Color(PB.OFF) }, uBg: { value: new THREE.Color(PB.BG) },
      uCols: { value: PB.COLS }, uSpeed: { value: PB.SPEED }, uCycle: { value: PB.CYCLE ? 1 : 0 }, uHue: { value: PB.HUE_SPEED }, uGlow: { value: PB.GLOW } }]);
    const PAD_GLSL = `uniform float uT; uniform float uAdd; uniform vec3 uSize; uniform vec3 uOn; uniform vec3 uOff; uniform vec3 uBg;
        uniform float uCols; uniform float uSpeed; uniform float uCycle; uniform float uHue; uniform float uGlow;
        vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
        // cores do momento (w = posição ao longo do painel, 0..1): arco-íris que corre ou cores fixas
        void padCols(float w, out vec3 on, out vec3 off, out vec3 bg){
          if (uCycle > 0.5) { float h = fract(uT * uHue + w * 0.22); on = hsv(h, 0.75, 1.0); off = hsv(h, 0.85, 0.36); bg = hsv(h, 0.9, 0.13); }
          else { on = uOn; off = uOff; bg = uBg; } }`;
    const padM = new THREE.ShaderMaterial({ uniforms: padU, transparent: false, depthWrite: true, fog: true, extensions: { derivatives: true },
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
      vertexShader: `varying vec3 vP; varying vec3 vN;
        #include <fog_pars_vertex>
        void main(){ vP = position; vN = normal; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: PAD_GLSL + `
        varying vec3 vP; varying vec3 vN;
        #include <fog_pars_fragment>
        void main(){
          vec3 col, cOn, cOff, cBg;
          if (vN.y > 0.5) {
            // grade: uCols quadradinhos na largura e o número que couber no comprimento
            float csx = uSize.x / uCols, rows = floor(uSize.z / csx + 0.5), csz = uSize.z / rows;
            vec2 m = vec2(vP.x + uSize.x * 0.5, vP.z + uSize.z * 0.5);                    // metros a partir do canto
            vec2 cell = floor(m / vec2(csx, csz)), uv = fract(m / vec2(csx, csz));
            // seta "^" (ponta para a frente) calculada no centro do quadradinho: o LED acende inteiro
            float cx = abs((cell.x + 0.5) * csx - uSize.x * 0.5), cz = (cell.y + 0.5) * csz;
            padCols(cz / uSize.z, cOn, cOff, cBg);
            float sh = floor(uT * uSpeed) * csz;                                          // anda um quadradinho por vez
            float per = 3.3, d = abs(fract((cz + cx * 0.9 - sh) / per) - 0.5) * per;
            float on = 1.0 - step(0.62, d);
            float near = exp(-max(d - 0.62, 0.0) * 3.0);                                  // LEDs vizinhos da seta pegam um pouco da luz
            // quadradinho com vão escuro em volta e miolo mais claro quando aceso
            vec2 e = min(uv, 1.0 - uv); float ee = min(e.x, e.y), aa = max(fwidth(ee), 1e-3);
            float sq = smoothstep(0.1 - aa, 0.1 + aa, ee), core = smoothstep(0.24 - aa, 0.24 + aa, ee);
            vec3 led = mix(cOff, cOn, on) + on * core * 0.5 + cOn * near * (1.0 - on) * 0.18;
            col = mix(cBg + cOn * on * 0.35, led, sq);                                   // o vão em volta do LED aceso também brilha
            if (uAdd > 0.5) col = cOn * uGlow * (on * (0.55 * sq + 0.3) + near * 0.12);    // camada somada: brilho (glow)
          } else {
            padCols(vP.z / uSize.z + 0.5, cOn, cOff, cBg);
            col = uAdd > 0.5 ? cOn * 0.25 * uGlow : cBg * 1.6 + cOn * 0.15;              // laterais acesas de leve
          }
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }` });
    padM.userData.unique = true;
    const PAD_UNI = ['uT', 'uSize', 'uOn', 'uOff', 'uBg', 'uCols', 'uSpeed', 'uCycle', 'uHue', 'uGlow'];
    const padL = padM.clone(); padL.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAdd: { value: 1 } }]);
    PAD_UNI.forEach(k => { padL.uniforms[k] = padU[k]; });
    padL.transparent = true; padL.depthWrite = false; padL.blending = THREE.AdditiveBlending; padL.userData.unique = true;   // segunda passada: brilho somado
    // halo: luz suave no asfalto em volta do painel (some com a distância da borda)
    const HALO = 2.6, haloU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uHalo: { value: HALO } }]);
    PAD_UNI.forEach(k => { haloU[k] = padU[k]; });
    const haloM = new THREE.ShaderMaterial({ uniforms: haloU, transparent: true, depthWrite: false, fog: true, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3,
      vertexShader: `varying vec3 vP;
        #include <fog_pars_vertex>
        void main(){ vP = position; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: PAD_GLSL + `
        uniform float uHalo; varying vec3 vP;
        #include <fog_pars_fragment>
        void main(){
          vec3 cOn, cOff, cBg; padCols(vP.z / uSize.z + 0.5, cOn, cOff, cBg);
          vec2 q = max(abs(vP.xz) - uSize.xz * 0.5, 0.0); float dd = length(q);             // distância (m) até a borda do painel
          float g = exp(-dd * 2.2) * (1.0 - smoothstep(uHalo * 0.6, uHalo, dd));
          float pulse = 0.85 + 0.15 * sin(uT * 5.0);
          gl_FragColor = vec4(cOn * g * 0.55 * uGlow * pulse, 1.0);
          #include <fog_fragment>
        }` });
    haloM.userData.unique = true;
    const haloGeo = new THREE.PlaneGeometry(PAD_W + HALO * 2, PAD_L + HALO * 2).rotateX(-Math.PI / 2); haloGeo.translate(0, 0.03, 0);
    const padGeo = new THREE.BoxGeometry(PAD_W, PAD_H, PAD_L); padGeo.translate(0, PAD_H / 2, 0);
    const padGlows = [];
    // RAMPAS DE TURBO: as rampas (def.ramps) continuam lá, mas o topo é o painel de LEDs e passar por cima dá o
    // turbo (ver "rampas de salto" abaixo). As plataformas que ficavam logo depois de uma rampa (até o fim da cunha
    // + 60 m) saem, para não ficar dois boosts colados.
    const padList = (() => { const sgM = L.length / N, rs = (def.ramps || []).map(([i, o, w, len]) => ({ i, o, len: len || 0 }));
      const after = pi => rs.some(r => { const d = (((pi - r.i) % N) + N) % N; return d * sgM <= r.len + 60; });
      const kept = (def.pads || []).filter(([pi]) => !after(pi));
      if (rs.length) console.info('[boost] ' + rs.length + ' rampa(s) de turbo; ' + ((def.pads || []).length - kept.length) + ' boost(s) logo depois de rampa removido(s)');
      return kept; })();
    padList.forEach(([i, o]) => { const c = side(i, o, 0.04 + hAt(i)), th = Math.atan2(T[i].x, T[i].z), seg = L.length / N, kk = Math.max(1, Math.round(PAD_L / 2 / seg));
      const pitch = Math.atan2(hAt(i + kk) - hAt(i - kk), 2 * kk * seg);
      const gp = new THREE.Group(); gp.position.copy(c); gp.rotation.set(-pitch, th, 0, 'YXZ'); gp.userData.dynamic = true; add(gp);
      const hm = new THREE.Mesh(haloGeo, haloM); hm.renderOrder = 1; hm.userData.noOutline = true; hm.receiveShadow = false; gp.add(hm);
      const pm = new THREE.Mesh(padGeo, padM); pm.renderOrder = 2; pm.userData.noOutline = true; gp.add(pm);
      const pl = new THREE.Mesh(padGeo, padL); pl.renderOrder = 3; pl.userData.noOutline = true; gp.add(pl);
      const gl = glowSpr(new THREE.Color(PB.ON).getHex(), 13, 0.4); gl.scale.set(11, 3.2, 1); gl.position.set(c.x, c.y + 0.9, c.z); padGlows.push(gl);
      pads.push({ x: c.x, z: c.z, fx: Math.sin(th), fz: Math.cos(th) }); });
    { const hc = new THREE.Color(); tr.animated.push(t => { padU.uT.value = t;
      if (PB.CYCLE) { hc.setHSL((t * PB.HUE_SPEED + 0.11) % 1, 1, 0.55); padGlows.forEach(g => g.material.color.copy(hc)); } }); }
    tr.onPad = p => pads.some(q => { const dx = p.x - q.x, dz = p.z - q.z, al = dx * q.fx + dz * q.fz, la = dx * q.fz - dz * q.fx; return Math.abs(al) < (q.hl || PAD_L / 2) && Math.abs(la) < (q.hw || PAD_W / 2); });

    // ---------- rampas de salto ----------
    // def.ramps: [nó, deslocamento lateral, largura (0 = pista inteira), comprimento, altura].
    // A cunha acompanha a inclinação da pista (base = perfil do asfalto) e o kart decola na borda (kart.js: o chão "some").
    const ramps = tr.ramps = [];
    const rampTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#3a4766'); g.addColorStop(1, '#27304a'); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 3; for (let k = 0; k <= 256; k += 64) { x.beginPath(); x.moveTo(0, k); x.lineTo(256, k); x.stroke(); }   // chapas
      x.fillStyle = 'rgba(255,255,255,.12)'; for (let k = 8; k < 256; k += 32) for (let j = 8; j < 256; j += 32) { x.beginPath(); x.arc(j, k, 2.2, 0, 7); x.fill(); }   // rebites
      const chev = (y0, col) => { x.fillStyle = col; x.beginPath(); x.moveTo(20, y0 + 70); x.lineTo(128, y0); x.lineTo(236, y0 + 70); x.lineTo(236, y0 + 108); x.lineTo(128, y0 + 38); x.lineTo(20, y0 + 108); x.closePath(); x.fill(); };
      chev(118, '#ff9a1f'); chev(46, '#ffd23a');                                             // setas apontando para a borda (v = 1 em cima)
      for (let k = 0; k < 8; k++) { x.fillStyle = k % 2 ? '#ffffff' : '#e8302a'; x.fillRect(k * 32, 0, 32, 22); x.fillRect(k * 32, 238, 32, 18); }   // faixas na borda e no pé
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; })();
    const rampTopM = new THREE.MeshLambertMaterial({ map: rampTex, side: THREE.DoubleSide });
    const rampSideM = new THREE.MeshLambertMaterial({ color: 0x9aa3b8, map: TX.get('stripes', 1, 1), side: THREE.DoubleSide });
    const rampLipM = new THREE.MeshBasicMaterial({ color: 0xffe27a }); rampLipM.userData.unique = true;
    const segM = L.length / N;
    def.ramps.forEach(([i, o, w, len, h]) => {
      const c = side(i, o, 0), fx = T[i].x, fz = T[i].z, th = Math.atan2(fx, fz);
      w = w || 2 * W; const hw = w / 2, base = hAt(i), grade = (hAt(i + len / segM) - base) / len;
      const geo = (P, F, UV) => { const g = new THREE.BufferGeometry(), pos = [], uv = [];
        F.forEach(f => f.forEach(j => { const q = P[j]; pos.push(q[0], q[1] + grade * q[2], q[2]); uv.push(...UV(q)); }));
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g; };
      // cunha: topo inclinado, laterais triangulares e fundo vertical (sobe ao longo de +z local)
      const P = [[-hw, 0, 0], [hw, 0, 0], [hw, h, len], [-hw, h, len], [-hw, 0, len], [hw, 0, len]];
      const grp = new THREE.Group(); grp.position.set(c.x, 0.06 + base, c.z); grp.rotation.y = th;
      const top = new THREE.Mesh(geo(P, [[0, 2, 1], [0, 3, 2]], q => [(q[0] + hw) / 5, q[2] / len]), rampTopM);
      const sides = new THREE.Mesh(geo(P, [[0, 4, 3], [1, 2, 5], [4, 5, 2], [4, 2, 3]], q => [(q[2] + q[0]) / 4, q[1] / 2]), rampSideM);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.16, 0.4), rampLipM); lip.position.set(0, h + grade * len + 0.02, len - 0.2); lip.rotation.x = -Math.atan(h / len + grade);
      [top, sides].forEach(m => { m.castShadow = true; m.receiveShadow = true; grp.add(m); }); grp.add(lip); add(grp);
      // RAMPA DE TURBO: o topo vira o mesmo painel de LEDs das plataformas (material próprio só para o tamanho da grade)
      { top.visible = false;
        const rU = {}; Object.keys(padU).forEach(k => { rU[k] = padU[k]; });
        rU.uSize = { value: new THREE.Vector3(w, PAD_H, len) }; rU.uCols = { value: Math.max(8, Math.round(PB.COLS * w / PAD_W)) };
        const rM = padM.clone(); rM.uniforms = rU; rM.userData.unique = true;
        const rL = padL.clone(); rL.uniforms = Object.assign({}, rU, { uAdd: { value: 1 } });   // rU já traz os uniforms da névoa (padU)
        rL.userData.unique = true;
        // plano inclinado do topo, com z local de -len/2 a +len/2 (o shader desenha a grade a partir do centro)
        const tg = new THREE.PlaneGeometry(w, len, 1, 1).rotateX(-Math.PI / 2), tp = tg.attributes.position;
        for (let k = 0; k < tp.count; k++) { const z = tp.getZ(k), a = z + len / 2; tp.setY(k, h * a / len + grade * a + 0.02); }
        tg.computeVertexNormals();
        const ledTop = new THREE.Mesh(tg, rM); ledTop.position.z = len / 2; ledTop.renderOrder = 2; ledTop.userData.noOutline = true; ledTop.receiveShadow = true;
        const ledGlow = new THREE.Mesh(tg, rL); ledGlow.position.z = len / 2; ledGlow.renderOrder = 3; ledGlow.userData.noOutline = true;
        grp.userData.dynamic = true; grp.add(ledTop, ledGlow);
        const gl = glowSpr(new THREE.Color(PB.ON).getHex(), 13, 0.4); gl.scale.set(w * 0.9, 4, 1); gl.position.set(c.x + fx * len / 2, base + h + 0.8, c.z + fz * len / 2); padGlows.push(gl);
        pads.push({ x: c.x + fx * len / 2, z: c.z + fz * len / 2, fx: Math.sin(th), fz: Math.cos(th), hl: len / 2 + 0.5, hw }); }
      // setas de aviso no asfalto antes da rampa
      const ar = new THREE.Mesh(new THREE.PlaneGeometry(w, 3), new THREE.MeshLambertMaterial({ map: TX.get('stripes', w / 4, 1), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }));
      ar.rotation.x = -Math.PI / 2; const ga = new THREE.Group(); ga.position.copy(side(i - 3, o, 0.07 + hAt(i - 3))); ga.rotation.y = th; ga.add(ar); add(ga);
      ramps.push({ x: c.x, z: c.z, fx, fz, hw, len, h, base, grade });
    });
    const rampAt = (p) => { let best = null; for (const r of ramps) { const dx = p.x - r.x, dz = p.z - r.z, a = dx * r.fx + dz * r.fz, l = dx * r.fz - dz * r.fx;
      if (a >= 0 && a <= r.len && Math.abs(l) <= r.hw) { const hh = (r.base || 0) + 0.06 + (r.grade || 0) * a + r.h * a / r.len; if (!best || hh > best.h) best = { h: hh, slope: r.h / r.len + (r.grade || 0), fx: r.fx, fz: r.fz }; } } return best; };

    // ---------- tema ----------
    let terrain = () => 0, waterTest = () => false;
    tr.WALL = W + 36;
    // muro invisível: some em cima do atalho (o caminho entra mais fundo no miolo da curva do que o muro deixaria)
    // PAREDE SÓ DO LADO DE FORA: para cada nó, guarda qual lado (lateral + ou -) é o miolo do circuito. Desse lado a
    // parede some e dá para andar livre pelo meio do mapa; do lado de fora ela continua (não dá para fugir do mapa).
    // O limite quadrado do mapa (tr.BOUND) também continua valendo.
    { const inSide = new Int8Array(N);
      for (let i = 0; i < N; i++) { const pa = side(i, W + 12, 0), pb = side(i, -(W + 12), 0), ia = inside(pa.x, pa.z), ib = inside(pb.x, pb.z);
        inSide[i] = ia && !ib ? 1 : ib && !ia ? -1 : (inside(side(i, W + 4, 0).x, side(i, W + 4, 0).z) ? 1 : -1); }
      tr.insideSide = inSide;
      tr.wallAt = (bi, lat) => { if (Math.sign(lat) === inSide[((bi % N) + N) % N]) return 1e9;   // miolo: livre
        if (tr.shortcuts.length) { const x = S[bi].x + T[bi].z * lat, z = S[bi].z - T[bi].x * lat; if (shortcutDist(x, z) < 3) return 1e9; }
        return tr.WALL; }; }
    ({ terrain, waterTest } = buildClassic());
    const bb = L.bbox; tr.BOUND = Math.max(Math.abs(bb.x0), Math.abs(bb.x1), Math.abs(bb.z0), Math.abs(bb.z1)) + tr.WALL + 10;
    tr.inWater = waterTest;

    // ---------- altura do chão para a física ----------
    tr.groundAt = (p, hint, heading) => {
      const n = tr.nearest(p, hint); let h, exact = false, slope = 0, soft = false;
      if (n.dist <= W + 1.8) {
        const u = n.i + n.f, b = bump(u); h = tr.roadBase + hAt(u); exact = b > 0.001 || tr.vert;
        const segL = S[n.i].distanceTo(S[(n.i + 1) % N]) || 1, grade = (hAt(u + 0.25) - hAt(u - 0.25)) / (0.5 * segL);
        const tA = Math.atan2(T[n.i].x, T[n.i].z); slope = grade * Math.cos(wrapA((heading || 0) - tA));
      } else { const hs = tr.dirtAt && tr.dirtAt(p) ? tr.shortcutHeight(p.x, p.z) : null;
        h = hs !== null ? hs : terrain(p.x, p.z, n.dist, n.i + n.f); if (bump(n.i + n.f) > 0.01) soft = true; else if (tr.vert) exact = true; }   // fora da pista ao lado da ponte: descida suave
      // (no atalho a altura é o perfil suavizado do próprio caminho: o kart anda exatamente em cima da terra desenhada)
      const r = rampAt(p);
      if (r && r.h >= h - 0.05) { h = r.h; exact = true; soft = false; slope = r.slope * (Math.sin(heading || 0) * r.fx + Math.cos(heading || 0) * r.fz); }
      return { h, exact, slope, soft };
    };

    // ---------- obstáculos sólidos (postes, árvores na calçada...) ----------
    // guarda-corpo da ponte: quem está em cima não cai, quem está fora não "sobe" pela lateral.
    // side: 0 = dentro do tabuleiro, ±1 = fora; se o kart cruzar a linha do guarda-corpo, volta para o lado em que estava.
    tr.rail = tr.rail || ((p, hint, prevSide) => {
      if (!bridges.length) return null;
      const n = tr.nearest(p, hint), b = bump(n.i + n.f), R = BR.RAIL, side = Math.abs(n.lat) <= R ? 0 : Math.sign(n.lat);
      if (b < 0.25 || prevSide === undefined || prevSide === null || side === prevSide) return { side, hit: null };
      const want = prevSide === 0 ? Math.sign(n.lat) * (R - 1.3) : prevSide * (R + 1.3), i = n.i, i1 = (i + 1) % N;
      const cx = S[i].x + (S[i1].x - S[i].x) * n.f, cz = S[i].z + (S[i1].z - S[i].z) * n.f, nx = T[i].z, nz = -T[i].x;
      const s = Math.sign(n.lat) || 1;
      return { side: prevSide, hit: { x: cx + nx * want, z: cz + nz * want, nx: nx * s * (prevSide === 0 ? 1 : -1), nz: nz * s * (prevSide === 0 ? 1 : -1) } };
    });
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
      [30, 120, 200, 290, 380, 460].forEach((i0, r) => { for (let k = 0; k < 5; k++) { const i = (i0 + k * 3) % N, q = side(i, (k % 2 ? -4 : 4), 1.35 + hAt(i)); const m = new THREE.Mesh(cg, cm); m.userData.dynamic = true; m.position.copy(q); add(m); tr.coins.push({ m, x: q.x, z: q.z, y: q.y, t: 0 }); } });
      tr.animated.push((t, dt) => tr.coins.forEach((c, k) => { if (c.t > 0) { c.t -= dt; if (c.t <= 0) c.m.visible = true; return; } c.m.rotation.y += dt * 3.2; c.m.position.y = c.y + Math.sin(t * 2.5 + k) * 0.15; }));
      tr.collectCoins = (kart) => { tr.coins.forEach(c => { if (!c.m.visible) return; const dx = kart.pos.x - c.x, dz = kart.pos.z - c.z; if (dx * dx + dz * dz < 6.8) { c.m.visible = false; c.t = 9; kart.coins = Math.min(10, kart.coins + 1); kart.events('coin', kart); } }); };
    }

    // ---------- atualização por quadro ----------
    tr.update = (dt, t) => tr.animated.forEach(f => f(t, dt));
    return tr;

    // =========================================================================
    // CIRCUITO CLÁSSICO: grama, rio com duas pontes, cachoeira, laguinhos, árvores, muro e postes
    // =========================================================================
    function buildClassic() {
      groundPlane('grass', 7, 0.07, tr.vert ? -0.4 : 0);   // com relevo, a malha do terreno (mais abaixo) cobre o miolo do mapa
      // ---- relevo do terreno: acompanha a altura da pista perto dela e desce suave até a planície (altura 0) ----
      const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }, lerp = (a, b, t) => a + (b - a) * t;
      const CS = 60, cells = new Map(), key = (a, b) => a * 73856093 ^ b * 19349663;
      for (let i = 0; i < N; i += 2) { const s0 = { x: S[i].x, z: S[i].z, h: H[i], i }, k = key(Math.floor(s0.x / CS), Math.floor(s0.z / CS)); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(s0); }
      const roadInfo = (x, z) => { const ci = Math.floor(x / CS), cj = Math.floor(z / CS); let d2m = 1e18, sw = 0, sh = 0, near = null;
        for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) { const l = cells.get(key(ci + a, cj + b)); if (!l) continue;
          for (const q of l) { const d2 = (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z); if (d2 < d2m) { d2m = d2; near = q; } const w = 1 / ((d2 + 100) * (d2 + 100)); sw += w; sh += w * q.h; } }
        return near ? { d: Math.sqrt(d2m), h: sh / sw, i: near.i } : { d: 1e9, h: 0, i: -1 }; };
      const drop = d => 0.25 * sm(W + 2, W + 40, d);                                    // a beira desce só um pouquinho
      const natH = (x, z, r) => { if (!tr.vert) return 0; r = r || roadInfo(x, z); return r.d > 1e8 ? 0 : lerp(r.h - drop(r.d), 0, sm(W + 25, W + 130, r.d)); };
      let waterDist = () => 1e9;                                                         // distância até a beira d'água (rio e laguinhos, definida mais abaixo)
      const gH = (x, z, r) => { r = r || roadInfo(x, z); let h = natH(x, z, r); if (h > 0.01) { const wd = waterDist(x, z); if (wd < 45) h *= 1 - (1 - sm(8, 45, wd)) * sm(W + 6, W + 18, r.d); } return h; };
      // ---- cordilheira em volta do mapa (profundidade): picos low-poly com grama na base, pedra e neve no topo ----
      { const mm = mountainMat();
        const peak = (x, z, rx, h, rz, k) => {
          const g = new THREE.ConeGeometry(1, 1, LO ? 36 : MID ? 64 : 112, LO ? 14 : MID ? 26 : 48); g.translate(0, 0.5, 0); const p = g.attributes.position, col = [];
          for (let i = 0; i < p.count; i++) { const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), a = Math.atan2(pz, px);
            // contorno com cristas e grotas (vários "vincos" descendo do pico) + irregularidade na altura
            const rr = py < 0.999 ? 1 + 0.2 * Math.sin(a * 3 + k) + 0.1 * Math.sin(a * 7 + k * 2) + 0.06 * Math.sin(py * 13 + a * 5)
              - 0.09 * Math.abs(Math.sin(a * 6 + k * 1.3 + py * 2)) - 0.045 * Math.abs(Math.sin(a * 13 - py * 7 + k)) + 0.025 * Math.sin(a * 23 + py * 17 + k * 2) : 1;
            const yy = py < 0.999 && py > 0.001 ? py * (1 + 0.12 * Math.sin(a * 5 + k * 3) + 0.04 * Math.sin(a * 11 + k)) : py;
            const ero = py < 0.999 && py > 0.001 ? 1 + 0.05 * (vn3(px * 3 + k, py * 4, pz * 3) - 0.5) : 1;   // erosão (ruído 3D)
            p.setXYZ(i, px * rr * ero, yy, pz * rr * ero);
            col.push(yy, h > 150 ? 1 : 0, 0); }                                      // r = altura relativa, g = tem neve (lido no shader)
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
      // ---- água (rio e laguinhos): turquesa viva, ondulada e com reflexo de verdade ----
      // Reflexo planar: a cena é desenhada de novo por uma câmera espelhada no nível da água (y = WATER_Y), numa
      // textura de meia resolução, uma vez por quadro e só quando alguma água está na tela (onBeforeRender).
      // Ajustes em CFG.WATER (opcional): REFLECT (false desliga o reflexo), RES (resolução do reflexo), DEEP/SHALLOW (cores).
      const WC = Object.assign({ REFLECT: true, RES: 0.5, DEEP: '#0fc9c2', SHALLOW: '#52f8e8', REFL: 0.9, DEPTH: 1.4, ABSORB: [0.5, 0.085, 0.08], BED: '#e9d7aa', LILIES: true }, CFG.WATER || {});
      const WATER_Y = 0.45, waterU = { value: 0 }, waterMeshes = [];
      const reflRT = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
      reflRT.texture.generateMipmaps = false; tr.disposers.push(() => reflRT.dispose());
      const wUni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tRefl: { value: null }, uTexMat: { value: new THREE.Matrix4() }, uRefl: { value: 0 },
        uDeep: { value: new THREE.Color(WC.DEEP) }, uShallow: { value: new THREE.Color(WC.SHALLOW) }, uSunDir: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() } }]);
      wUni.uT = waterU; wUni.tRefl.value = reflRT.texture;
      wUni.uSRGB = { value: 0 }; wUni.uDepth = { value: WC.DEPTH }; wUni.uAbsorb = { value: new THREE.Vector3().fromArray(WC.ABSORB) }; wUni.uBed = { value: new THREE.Color(WC.BED) };
      const W_NOISE = `float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y); }`;
      wUni.uSunCol = { value: new THREE.Color(1, 0.96, 0.88) }; wUni.uHasRT = { value: 0 }; wUni.uRefl.value = WC.REFL;
      wUni.uSky = { value: new THREE.Color(0xbfe4ff) }; wUni.uLite = { value: 0 };   // uLite: água simples (sem cáustica nem ondinhas finas)   // sem textura ainda: reflete só a cor do céu (esta linha estava dentro do comentário acima e a água quebrava)
      const waterM = new THREE.ShaderMaterial({ uniforms: wUni, vertexColors: true, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
        extensions: { derivatives: true },
        vertexShader: `uniform float uT; attribute vec2 flow; varying vec3 vW; varying float vEdge; varying vec2 vFlow;
          #include <fog_pars_vertex>
          void main(){ vec4 w = modelMatrix * vec4(position, 1.0);
            float calm = 1.0 - 0.7 * smoothstep(0.7, 1.0, color.r);                       // ondas menores na beira (raso)
            w.y += calm * (0.018 * sin(w.x * 0.31 + uT * 1.5) + 0.014 * sin(w.z * 0.43 - uT * 1.2) + 0.01 * sin((w.x - w.z) * 0.6 + uT * 2.3));
            vW = w.xyz; vEdge = color.r; vFlow = flow; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: `uniform float uT; uniform sampler2D tRefl; uniform mat4 uTexMat; uniform float uRefl; uniform vec3 uDeep; uniform vec3 uShallow;
          uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSky; uniform float uHasRT; uniform float uLite; uniform float uDepth; uniform vec3 uAbsorb; uniform vec3 uBed; uniform float uSRGB;
          vec3 toLin(vec3 c){ return uSRGB > 0.5 ? pow(max(c, 0.0), vec3(2.2)) : c; }
          vec3 toOut(vec3 c){ return uSRGB > 0.5 ? pow(max(c, 0.0), vec3(1.0 / 2.2)) : c; }
          varying vec3 vW; varying float vEdge; varying vec2 vFlow;
          #include <fog_pars_fragment>
          ${W_NOISE}
          vec2 waves(vec2 p, float t){ vec2 g = vec2(0.0);
            vec2 d1 = normalize(vec2(1.0, 0.35)), d2 = normalize(vec2(-0.6, 1.0)), d3 = normalize(vec2(0.25, -1.0)), d4 = normalize(vec2(-1.0, -0.2)), d5 = normalize(vec2(0.8, 0.9)), d6 = normalize(vec2(-0.3, 0.7));
            g += d1 * 0.55 * 0.030 * cos(dot(d1, p) * 0.55 + t * 0.9);
            g += d2 * 0.90 * 0.022 * cos(dot(d2, p) * 0.90 + t * 1.2);
            g += d3 * 1.60 * 0.016 * cos(dot(d3, p) * 1.60 + t * 1.6);
            g += d4 * 2.70 * 0.011 * cos(dot(d4, p) * 2.70 + t * 2.2);
            g += d5 * 4.30 * 0.007 * cos(dot(d5, p) * 4.30 + t * 2.9);
            g += d6 * 7.10 * 0.004 * cos(dot(d6, p) * 7.10 + t * 3.7);
            return g; }
          vec2 ripple(vec2 p, float t){ float e = 0.08; vec2 q = p * 1.7 + vec2(t * 0.25, -t * 0.16);
            float h = wNoise(q) + 0.5 * wNoise(q * 2.3 - t * 0.4); float hx = wNoise(q + vec2(e, 0.0)) + 0.5 * wNoise((q + vec2(e, 0.0)) * 2.3 - t * 0.4);
            float hz = wNoise(q + vec2(0.0, e)) + 0.5 * wNoise((q + vec2(0.0, e)) * 2.3 - t * 0.4); return vec2(hx - h, hz - h) / e * 0.035; }
          // cáustica: a rede de luz que as ondas projetam no fundo (padrão clássico, repete a cada ~4,5 m)
          float caustic(vec2 xz, float t){ vec2 p = mod(xz * 0.22, 1.0) * 6.28318 - 250.0, i = p; float c = 1.0, inten = 0.005;
            for (int n = 0; n < 4; n++) { float tt = t * (1.0 - (3.5 / float(n + 1)));
              i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
              c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten))); }
            c /= 4.0; c = 1.17 - pow(c, 1.4); return pow(abs(c), 8.0); }
          // fundo da piscina: areia clara com variação e pedrinhas
          vec3 bed(vec2 q, float detail){ float n = wNoise(q * 0.5) * 0.5 + wNoise(q * 1.9) * 0.3 + wNoise(q * 5.5) * 0.2 * detail;
            vec3 bedL = toLin(uBed); vec3 c = bedL * (0.86 + 0.22 * n);
            float pb = smoothstep(0.66, 0.74, wNoise(q * 3.1 + 7.0)) * detail;
            c = mix(c, bedL * vec3(0.72, 0.72, 0.76) * (0.85 + 0.3 * wNoise(q * 9.0)), pb * 0.35);
            float dk = smoothstep(0.55, 0.8, wNoise(q * 0.18 + 3.0)); c *= 1.0 - 0.18 * dk;   // manchas mais escuras (limo)
            return c; }
          void main(){
            float t = uT, dist = length(cameraPosition - vW);
            float detail = 1.0 - smoothstep(30.0, 220.0, dist);
            vec2 p = vW.xz - vFlow * t * 0.9;
            vec2 rp = uLite > 0.5 ? vec2(0.0) : ripple(p, t);
            vec2 g = (waves(p, t) + rp * detail) * mix(0.5, 1.0, detail);
            vec3 N = normalize(vec3(-g.x * 1.4, 1.0, -g.y * 1.4));
            vec3 V = normalize(cameraPosition - vW);
            // REFRAÇÃO: o raio entra na água, entorta (índice 1,33) e acerta o fundo; profundidade maior no meio, rasa na beira
            float depth = mix(uDepth, 0.18, smoothstep(0.5, 0.98, vEdge));
            vec3 Rr = refract(-V, N, 1.0 / 1.33);
            float path = depth / max(-Rr.y, 0.12);
            vec2 bxz = vW.xz + Rr.xz * path;
            vec3 under = bed(bxz, detail);
            // cáustica no fundo (mexe com o tempo; perde força com a profundidade e com a distância)
            float ca = uLite > 0.5 ? 0.3 : caustic(bxz + g * 4.0, t * 0.55 + 23.0) * 0.8 + caustic(bxz * 1.37 + 3.1, t * 0.43 + 11.0) * 0.5;
            float sunUp = clamp(uSunDir.y * 1.3, 0.25, 1.0);
            under *= 0.82 + uSunCol * ca * 1.35 * sunUp * mix(0.35, 1.0, detail) * exp(-depth * 0.25);
            // absorção: o vermelho some primeiro -> turquesa; espalhamento soma a cor da água no fundo
            vec3 tr = exp(-uAbsorb * path * 1.4);
            under = (under * tr + toLin(uDeep) * (1.0 - exp(-path * 0.9)) * 0.5) * 1.1;
            // reflexo (Fresnel de verdade: quase nada olhando de cima, forte olhando rente)
            vec3 Ns = normalize(mix(vec3(0.0, 1.0, 0.0), N, 0.5)); float NV = max(dot(Ns, V), 0.0);
            float fres = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
            vec4 tc = uTexMat * vec4(vW, 1.0); vec2 ruv = tc.xy / tc.w + N.xz * (0.01 + 0.014 * detail);
            float inside = step(0.0, ruv.x) * step(ruv.x, 1.0) * step(0.0, ruv.y) * step(ruv.y, 1.0);
            vec4 rt = texture2D(tRefl, clamp(ruv, 0.002, 0.998)); vec3 skyL = toLin(uSky); vec3 refl = mix(skyL, toLin(rt.rgb), inside * uHasRT * rt.a);
            refl = max(refl, skyL * 0.35);
            vec3 col = mix(under, refl, clamp(fres * 1.05, 0.0, 0.9) * uRefl);
            vec3 H = normalize(uSunDir + V); float nh = max(dot(N, H), 0.0);
            col += uSunCol * (pow(nh, 1200.0) * 5.0 + pow(nh, 120.0) * 0.12) * (0.4 + 0.6 * detail);
            float a = 1.0 - smoothstep(0.975, 1.0, vEdge) * 0.85;                           // beira se funde com a areia
            gl_FragColor = vec4(toOut(col), a);
            #include <fog_fragment>
          }` });
      waterM.userData.unique = true;
      const refl = { cam: new THREE.PerspectiveCamera(), key: '', busy: false };
      const _rp = new THREE.Vector3(), _cp = new THREE.Vector3(), _rot = new THREE.Matrix4(), _look = new THREE.Vector3(), _tg = new THREE.Vector3(), _vw = new THREE.Vector3(),
        _up = new THREE.Vector3(0, 1, 0), _pl = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4(), _sz = new THREE.Vector2(), _cc = new THREE.Color();
      const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      function reflect(renderer, scene, camera) {
        if (!WC.REFLECT || refl.busy || !camera.isPerspectiveCamera || scene.overrideMaterial) return;   // passadas de profundidade/normal do pós-efeito: ignora
        const wq = QS().water;
        if (wq === 'off') { wUni.uHasRT.value = 0; refl.key = ''; return; }   // sem reflexo: não redesenha a cena (o maior custo da água)
        const m = camera.matrixWorld.elements, key = waterU.value + '|' + camera.uuid + '|' + m[8] + m[9] + m[10] + m[12] + m[13] + m[14];
        if (key === refl.key) return; refl.key = key;
        refl.n = (refl.n || 0) + 1; if (wq === 'low' && refl.n % 2) return;   // água baixa: reflexo atualiza a cada 2 quadros
        _cp.setFromMatrixPosition(camera.matrixWorld); if (_cp.y < WATER_Y + 0.05) return;
        _rp.set(_cp.x, WATER_Y, _cp.z);
        _vw.subVectors(_rp, _cp).reflect(_up).negate().add(_rp);                                  // câmera espelhada
        _rot.extractRotation(camera.matrixWorld); _look.set(0, 0, -1).applyMatrix4(_rot).add(_cp);
        _tg.subVectors(_rp, _look).reflect(_up).negate().add(_rp);
        const vc = refl.cam; vc.position.copy(_vw); vc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_up); vc.lookAt(_tg);
        vc.far = camera.far; vc.near = camera.near; vc.updateMatrixWorld(); vc.projectionMatrix.copy(camera.projectionMatrix); vc.matrixWorldInverse.copy(vc.matrixWorld).invert();
        wUni.uTexMat.value.copy(BIAS).multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
        // plano de corte oblíquo: nada abaixo da água entra no reflexo
        _pl.setFromNormalAndCoplanarPoint(_up, _rp).applyMatrix4(vc.matrixWorldInverse);
        _clip.set(_pl.normal.x, _pl.normal.y, _pl.normal.z, _pl.constant); const P = vc.projectionMatrix.elements;
        _q.set((Math.sign(_clip.x) + P[8]) / P[0], (Math.sign(_clip.y) + P[9]) / P[5], -1, (1 + P[10]) / P[14]);
        _clip.multiplyScalar(2 / _clip.dot(_q)); P[2] = _clip.x; P[6] = _clip.y; P[10] = _clip.z + 1; P[14] = _clip.w;
        renderer.getDrawingBufferSize(_sz); const rs = wq === 'low' ? Math.min(WC.RES, 0.25) : WC.RES, w = Math.max(16, Math.floor(_sz.x * rs)), h = Math.max(16, Math.floor(_sz.y * rs));
        if (reflRT.width !== w || reflRT.height !== h) reflRT.setSize(w, h);
        { const cur = renderer.getRenderTarget(); reflRT.texture.encoding = cur ? cur.texture.encoding : renderer.outputEncoding; }   // mesmo espaço de cor da passada principal
        const prevRT = renderer.getRenderTarget(), prevXr = renderer.xr.enabled, prevSh = renderer.shadowMap.autoUpdate;
        refl.busy = true; waterMeshes.forEach(o => { o.visible = false; });
        renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
        renderer.getClearColor(_cc); const prevA = renderer.getClearAlpha(); renderer.setClearColor(wUni.uSky.value, 0);
        renderer.setRenderTarget(reflRT); renderer.state.buffers.depth.setMask(true); renderer.clear();
        try { renderer.render(scene, vc); } catch (e) { console.warn('[água] reflexo', e); WC.REFLECT = false; }
        renderer.xr.enabled = prevXr; renderer.shadowMap.autoUpdate = prevSh; renderer.setRenderTarget(prevRT); renderer.setClearColor(_cc, prevA);
        if (camera.viewport !== undefined) renderer.state.viewport(camera.viewport);
        waterMeshes.forEach(o => { o.visible = true; }); refl.busy = false; wUni.uHasRT.value = WC.REFLECT ? 1 : 0;
      }
      let sunL = null, sunKey = -1;
      const syncSun = (scene) => { if (waterU.value === sunKey) return; sunKey = waterU.value;
        if (!sunL || !sunL.parent) { sunL = null; scene.traverse(o => { if (!sunL && o.isDirectionalLight) sunL = o; }); }
        if (sunL) { wUni.uSunDir.value.subVectors(sunL.position, sunL.target.position).normalize(); wUni.uSunCol.value.copy(sunL.color).multiplyScalar(Math.min(1.4, sunL.intensity * 1.1)); }
        if (scene.fog && scene.fog.color) wUni.uSky.value.copy(scene.fog.color); };
      const waterMesh = g => { const o = new THREE.Mesh(g, waterM); o.userData.noOutline = true;
        o.onBeforeRender = (r, sc, cam) => { if (!sc.overrideMaterial) syncSun(sc); wUni.uLite.value = QS().water === 'high' ? 0 : 1; const rtg = r.getRenderTarget();
          wUni.uSRGB.value = (rtg ? rtg.texture.encoding : r.outputEncoding) === THREE.sRGBEncoding ? 1 : 0; reflect(r, sc, cam); }; waterMeshes.push(o); return o; };
      const bankM = new THREE.MeshLambertMaterial({ map: GfxFX.aniso(TX.get('sand')), side: THREE.DoubleSide }), bedM = new THREE.MeshLambertMaterial({ map: GfxFX.aniso(TX.get('pebble')), side: THREE.DoubleSide });
      const dcol = e => new THREE.Color(e, e, e);                                         // cor de vértice da água = quanto perto da margem (o shader pinta)
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
      const HEAD = 26 / RL;                                                               // poço da cachoeira: o rio começa largo (24 m) e afina em 26 m
      const hwf = t => { if (t < HEAD) { const u = t / HEAD; return RHW + (12 - RHW) * (1 - u * u * (3 - 2 * u)); } if (t < 0.86) return RHW; const u = (t - 0.86) / 0.14; return u < 0.5 ? RHW + (22 - RHW) * Math.sin(u * Math.PI) : 22 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.5) / 0.5, 2))); };
      const rHW = rpts.map((_, k) => hwf(k / RM));
      const nearRiver = (x, z, m) => rpts.some((p, k) => Math.hypot(p.x - x, p.z - z) < m + rHW[k] - RHW);
      // atalho que cruzaria o rio é descartado (não dá para passar pela água)
      tr.shortcuts = tr.shortcuts.filter(sc => { const bad = sc.pts.some((q, k) => k > 3 && k < sc.pts.length - 4 && nearRiver(q.x, q.z, sc.hw + 3)); if (bad) console.warn('[atalho] ' + sc.i + '→' + sc.j + ' cruza o rio: desligado'); return !bad; });
      const riverDist = (x, z) => rpts.reduce((a, p, k) => Math.min(a, Math.hypot(p.x - x, p.z - z) - (rHW[k] - RHW)), 1e9);
      function ribbonGeo(hwA, cs, colored) {
        const pos = [], uv = [], col = [], idx = [];
        for (let k = 0; k <= RM; k++) { const p = rpts[k], t = rtan[k], hw = hwA(k / RM);
          for (let c = 0; c <= cs; c++) { const u = c / cs * 2 - 1; pos.push(p.x + t.z * hw * u, 0, p.z - t.x * hw * u); uv.push(c / cs, k / RM * RL / 20); if (colored) { const q = dcol(Math.abs(u)); col.push(q.r, q.g, q.b); } } }
        for (let k = 0; k < RM; k++) for (let c = 0; c < cs; c++) { const a = k * (cs + 1) + c, d = a + cs + 1; idx.push(a, d, a + 1, a + 1, d, d + 1); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        if (colored) { g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); const fl = []; for (let k = 0; k <= RM; k++) for (let c = 0; c <= cs; c++) fl.push(rtan[k].x, rtan[k].z); g.setAttribute('flow', new THREE.Float32BufferAttribute(fl, 2)); }
        g.setIndex(idx); g.computeVertexNormals(); return g;
      }
      { const o = new THREE.Mesh(ribbonGeo(t => Math.max(0, hwf(t) - 0.4), 2, false), bedM); o.position.y = 0.14; add(o); }
      [1, -1].forEach(sg => { const pos = [], uv = [], idx = [];
        for (let k = 0; k <= RM; k++) { const p = rpts[k], t = rtan[k], hw = rHW[k]; PROF.forEach(([d, h], c) => { pos.push(p.x + t.z * sg * (hw + d), h, p.z - t.x * sg * (hw + d)); uv.push(c * 0.6, k / RM * RL / 3); }); }
        for (let k = 0; k < RM; k++) for (let c = 0; c < 3; c++) { const a = k * 4 + c, d = a + 4; idx.push(a, d, a + 1, a + 1, d, d + 1); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
        const m = new THREE.Mesh(g, bankM); m.receiveShadow = true; add(m); });
      const riverGeo = ribbonGeo(t => Math.max(0, hwf(t) - 0.15), 8, true); riverGeo.translate(0, WATER_Y, 0); add(waterMesh(riverGeo));
      tr.minimap.push({ type: 'river', pts: rpts.map((p, k) => [p.x, p.z, rHW[k]]) });
      // ---- barreiras de corrida (guarda-corpo das pontes e muro azul/amarelo): mesmo desenho para as duas ----
      // Faixa contínua com topo arredondado, amostrada a cada 1/4 de bloco: acompanha o chão/rampa sem degraus e
      // a base fica enterrada (nunca flutua). Cores lisas alternadas por bloco (estilo cartoon), topo mais claro e
      // pé levemente escurecido (sombra de contato). Sem textura.
      // só a face da frente + sombra projetada pelas faces de trás: sem "acne" de sombra (pontilhado) na própria barreira
      const barrierM = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide, shadowSide: THREE.BackSide });
      const sampleAt = (u, o) => { const i0 = Math.floor(u), f = u - i0, a = ((i0 % N) + N) % N, b = (a + 1) % N;
        let tx = T[a].x + (T[b].x - T[a].x) * f, tz = T[a].z + (T[b].z - T[a].z) * f; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const nx = tz, nz = -tx; return { x: S[a].x + (S[b].x - S[a].x) * f + nx * o, z: S[a].z + (S[b].z - S[a].z) * f + nz * o, nx, nz }; };
      // o: { u0, u1, lat, base(u, p) -> altura do chão, colors: [hex, hex], h, t, sink, blk (nós por bloco), collide }
      const buildBarrier = (o) => {
        const blk = o.blk || 2, sub = 4, r = o.t / 2, sg = Math.sign(o.lat) || 1, PR = [];
        PR.push([-r, -o.sink, -1, 0], [-r, o.h - r, -1, 0]);
        for (let k = 1; k < 6; k++) { const a = Math.PI - k * Math.PI / 6; PR.push([r * Math.cos(a), o.h - r + r * Math.sin(a), Math.cos(a), Math.sin(a)]); }
        PR.push([r, o.h - r, 1, 0], [r, -o.sink, 1, 0]);
        const C = PR.length, pos = [], nor = [], col = [], idx = [], cA = new THREE.Color(), cc = new THREE.Color();
        const shade = (q) => q[1] > o.h - r * 0.6 ? 1.12 : q[1] < 0.25 ? 0.78 : 1;
        const ring = (u, colHex, capN) => { const p = sampleAt(u, o.lat), y0 = o.base(u, p), ox = p.nx * sg, oz = p.nz * sg, start = pos.length / 3;
          cA.set(colHex); PR.forEach(q => { pos.push(p.x + ox * q[0], y0 + q[1], p.z + oz * q[0]);
            if (capN) nor.push(capN.x, 0, capN.z); else nor.push(ox * q[2], q[3], oz * q[2]);
            cc.copy(cA).multiplyScalar(shade(q)); col.push(cc.r, cc.g, cc.b); }); return { start, p }; };
        let n = 0;
        for (let s = o.u0; s < o.u1 - 1e-3; s += blk, n++) { const e = Math.min(o.u1, s + blk), colHex = o.colors[n % o.colors.length], first = pos.length / 3;
          for (let k = 0; k <= sub; k++) ring(s + (e - s) * k / sub, colHex);
          for (let k = 0; k < sub; k++) for (let c = 0; c < C - 1; c++) { const a = first + k * C + c, b = a + 1, d = a + C, f = d + 1; idx.push(a, b, d, b, f, d); }
          if (o.collide) for (let k = 0; k < sub; k++) { const p = sampleAt(s + (e - s) * (k + 0.5) / sub, o.lat); tr.obstacles.push({ x: p.x, z: p.z, r: r }); } }
        // tampas nas duas pontas
        [[o.u0, -1], [o.u1, 1]].forEach(([u, d]) => { const t0 = sampleAt(u, 0), tx = -t0.nz, tz = t0.nx, st = ring(u, n && d > 0 ? o.colors[(n - 1) % o.colors.length] : o.colors[0], { x: tx * d, z: tz * d }).start;
          for (let c = 1; c < C - 1; c++) idx.push(st, st + c, st + c + 1); });
        // cada triângulo virado para o mesmo lado da normal (frente para fora), qualquer que seja o lado da pista
        for (let k = 0; k < idx.length; k += 3) { const [a, b, c] = [idx[k] * 3, idx[k + 1] * 3, idx[k + 2] * 3];
          const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
          const qx = uy * vz - uz * vy, qy = uz * vx - ux * vz, qz = ux * vy - uy * vx;
          if (qx * (nor[a] + nor[b] + nor[c]) + qy * (nor[a + 1] + nor[b + 1] + nor[c + 1]) + qz * (nor[a + 2] + nor[b + 2] + nor[c + 2]) < 0) { idx[k + 1] = c / 3; idx[k + 2] = b / 3; } }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeBoundingSphere();
        const m = new THREE.Mesh(g, barrierM); m.castShadow = true; m.receiveShadow = true; return add(m); };
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
        // guarda-corpo vermelho e branco: em cima da beira do tabuleiro, rente à lateral de concreto (não sobra para fora);
        // vai só onde a ponte está alta (bump >= 0,25 m), igual à colisão (tr.rail)
        { let a0 = bi - BR.END, a1 = bi + BR.END; while (a0 < bi && bump(a0) < 0.25) a0 += 0.5; while (a1 > bi && bump(a1) < 0.25) a1 -= 0.5;
          const n0 = Math.max(1, Math.round((a1 - a0) / 2)), blk = (a1 - a0) / n0;   // blocos de ~2 nós que fecham certinho
          [-1, 1].forEach(sd => buildBarrier({ u0: a0, u1: a1, lat: sd * BR.RAIL, base: u => tr.roadBase + hAt(u) - 0.05, colors: [0xee3b3b, 0xf4f4f4], h: 1.15, t: 0.6, sink: 0.6, blk })); }
      });
      // ---- cachoeira descendo de uma montanha de pedra ----
      // paredão de ~45 m na frente (de onde a água cai) + montanha em domo logo atrás + morros laterais
      const FD = NV(bB), TB = V3(FD.z, 0, -FD.x), F = PV(bB, 62);
      // montanhas: [deslocamento ao longo da pista, distância para fora, raio lateral, raio em profundidade, altura]
      const MOUNTS = [[0, 136, 100, 55, 82], [-95, 150, 70, 50, 54], [92, 156, 66, 48, 48]].map(([a, o, rx, rz, h]) => ({ c: F.clone().addScaledVector(TB, a).addScaledVector(FD, o - 62), rx, rz, h }));
      let cliffFoot = () => false; const cliffPines = [];                                  // definidos pela cachoeira (abaixo)
      const inMountain = (x, z, m) => MOUNTS.some(M => { const dx = x - M.c.x, dz = z - M.c.z, lx = dx * TB.x + dz * TB.z, lz = dx * FD.x + dz * FD.z; return (lx / (M.rx + m)) ** 2 + (lz / (M.rz + m)) ** 2 < 1; }) || cliffFoot(x, z, m || 0);
      { // ===== CACHOEIRA: sai de um morro natural no estilo das montanhas do mapa =====
        // O paredão agora é um MORRO natural (mesmo material procedural das montanhas: pedra nas partes íngremes,
        // grama nas planas): malha de relevo com uma face de penhasco côncava (anfiteatro) na frente, um sulco no
        // topo por onde o riacho chega até o lábio e uma rampa de pedras (tálus) nos pés, fora do poço do rio.
        const wf = new THREE.Group(); wf.position.copy(F).addScaledVector(FD, 3); wf.rotation.y = Math.atan2(-FD.x, -FD.z); add(wf); wf.updateMatrixWorld(true);
        const HM = 88, HCX = 0, HCZ = -42, HRX = 74, HRZ = 66;                              // morro: altura máx., centro e raios (local)
        const zf = x => 0.011 * x * x + 1.2 * Math.sin(x * 0.27 + 0.6) + 0.7 * Math.sin(x * 0.61 + 2.0);   // linha da face (côncava + irregular)
        const hn = (x, z) => Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 - 0.4) * 3 + Math.sin(x * 0.27 - z * 0.21) * 1.4 + Math.sin(x * 0.53 + z * 0.47 + 2) * 0.6;
        const dome = (x, z) => { const e = ((x - HCX) / HRX) ** 2 + ((z - HCZ) / HRZ) ** 2; return e >= 1 ? 0 : HM * Math.pow(1 - e, 0.62) + hn(x, z) * (1 - e); };
        const chan = (x, z) => 6 * (1 - THREE.MathUtils.smoothstep(Math.abs(x), 5, 9)) * THREE.MathUtils.smoothstep(z, -34, -6);   // sulco do riacho
        const hillH = (x, z) => { const f = zf(x), behind = Math.max(0, dome(x, Math.min(z, f)) - chan(x, Math.min(z, f)));
          if (z <= f) return behind;
          const d = z - f, cliff = behind * (1 - THREE.MathUtils.smoothstep(d, 0, 0.9));                   // face quase vertical
          const talus = Math.min(behind, 9) * (1 - THREE.MathUtils.smoothstep(d, 0, 11)) * THREE.MathUtils.smoothstep(Math.abs(x), 13, 20);   // pedras no pé (fora do poço)
          return Math.max(cliff, talus); };
        { const X0 = -82, X1 = 82, Z0 = -112, Z1 = 26, CS = LO ? 2.0 : MID ? 1.4 : 1.0, nx = Math.ceil((X1 - X0) / CS), nz = Math.ceil((Z1 - Z0) / CS), pos = [], col = [], idx = [];
          for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = X0 + i * CS, z = Z0 + j * CS + zf(x), h = hillH(x, z);   // linhas da malha seguem a curva da face: sem degraus/listras verticais no penhasco
            pos.push(x, h > 0.05 ? h - 1.2 : -2.5, z); col.push(Math.min(1, h / HM), 0, 1); }
          for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
          const hill = new THREE.Mesh(g, mountainMat()); hill.castShadow = hill.receiveShadow = true; hill.userData.noOutline = true; wf.add(hill); }
        const _hv = new THREE.Vector3();
        cliffFoot = (x, z, m) => { wf.worldToLocal(_hv.set(x, 0, z)); return (((_hv.x - HCX) / (HRX + m)) ** 2 + ((_hv.z - HCZ) / (HRZ + m)) ** 2 < 1) && _hv.z < zf(_hv.x) + 6 + m; };
        tr.blockers.push((() => { const p = wf.localToWorld(new THREE.Vector3(0, HM * 0.4, HCZ)); return { x: p.x, y: p.y, z: p.z, r: Math.min(HRX, HRZ) * 0.8 }; })());
        const LIP = hillH(0, zf(0) - 0.3) - 1.2;                                             // altura do lábio (fundo do sulco, na face)
        const HT = LIP, FW = 14;                                                            // altura da queda e largura no lábio
        // pedregulhos low-poly no pé e dentro do poço (cor de pedra das montanhas)
        { const bm = new THREE.MeshLambertMaterial({ color: 0x5c534d, flatShading: true }), bg = new THREE.DodecahedronGeometry(1, 0);
          [[-10.5, 3, 2.6], [11, 2.5, 2.2], [-7.5, 7.5, 1.6], [8, 9, 1.3], [-2.8, 11.5, 1.1], [3.4, 13, 0.9], [-15, 9, 3.2], [16, 7, 3.6], [-19, 13, 2.4], [20.5, 12, 2.0]]
            .forEach(([x, z, s], k) => { const o = new THREE.Mesh(bg, bm); o.position.set(x, WATER_Y - 0.25 + s * 0.35, zf(x) + z * 0.6); o.scale.set(s * 1.25, s * 0.75, s); o.rotation.set(k, k * 1.7, k * 0.5); o.castShadow = o.receiveShadow = true; wf.add(o); }); }
        // pinheiros no topo do morro (em cima da malha, longe da beirada)
        for (let k = 0, tries = 0; k < 16 && tries < 400; tries++) { const x = (rnd() - 0.5) * 120, z = -20 - rnd() * 80, h = hillH(x, z);
          if (h < 8 || z > zf(x) - 8 || Math.abs(x) < 10 && z > -40) continue; const p = wf.localToWorld(new THREE.Vector3(x, h - 2.4, z));
          cliffPines.push({ x: p.x, y: p.y, z: p.z, r: rnd() * 6.28, s: 1 + rnd() * 0.5 }); k++; }
        // ---- material das quedas ----
        // (1) "grab pass": antes da primeira lâmina ser desenhada, a tela (já com o morro, céu e cenário) é copiada para
        //     uma textura; a lâmina mostra esse fundo DISTORCIDO (refração), como vidro d'água em movimento.
        // (2) dois "normal maps" procedurais descendo na mesma direção, com escalas e velocidades diferentes:
        //     a soma cria turbulência e quebra o efeito de "imagem deslizando".
        // (3) deslocamento de vértice por ruído na direção da normal: a lâmina ondula para fora e para dentro.
        // (4) espuma/aeração que cresce na queda e fica densa no pé.
        const grab = { tex: null, w: 0, h: 0, key: '', ok: true, v: new THREE.Vector2(), o: new THREE.Vector2() };
        const grabU = { tGrab: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uHasGrab: { value: 0 } };
        tr.disposers.push(() => { if (grab.tex) grab.tex.dispose(); });
        const doGrab = (renderer, scene, camera) => {
          if (QS().water !== 'high') { grabU.uHasGrab.value = 0; return; }   // água média/baixa: sem cópia da tela (usa a pedra molhada)
          if (!grab.ok || scene.overrideMaterial || refl.busy) return;
          const key = waterU.value + '|' + camera.uuid; if (key === grab.key) return; grab.key = key;
          const rt = renderer.getRenderTarget();
          if (rt && (rt.isWebGLMultisampleRenderTarget || rt.texture.type !== THREE.UnsignedByteType)) { grab.ok = false; grabU.uHasGrab.value = 0;
            console.info('[cachoeira] refração por cópia da tela desligada (o pós-efeito usa', rt.isWebGLMultisampleRenderTarget ? 'MSAA' : 'textura tipo ' + rt.texture.type, '): usando o fundo de pedra molhada'); return; }   // formato que não dá para copiar: fica sem refração
          let w, h; if (rt) { w = rt.width; h = rt.height; } else { renderer.getDrawingBufferSize(grab.v); w = grab.v.x; h = grab.v.y; }
          if (!grab.tex || grab.w !== w || grab.h !== h) { if (grab.tex) grab.tex.dispose();
            grab.tex = new THREE.DataTexture(new Uint8Array(w * h * 3), w, h, THREE.RGBFormat); grab.tex.minFilter = grab.tex.magFilter = THREE.LinearFilter; grab.tex.generateMipmaps = false;
            grab.tex.needsUpdate = true; grab.w = w; grab.h = h; }
          try { renderer.copyFramebufferToTexture(grab.o, grab.tex); grabU.tGrab.value = grab.tex; grabU.uRes.value.set(w, h); if (!grabU.uHasGrab.value) console.info('[cachoeira] refração ligada', w + 'x' + h); grabU.uHasGrab.value = 1; }
          catch (e) { grab.ok = false; grabU.uHasGrab.value = 0; } };
        const fallMat = (speed, alpha, seed) => { const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSpd: { value: speed }, uA: { value: alpha }, uSeed: { value: seed },
            uDeep: { value: new THREE.Color(WC.DEEP) }, uShallow: { value: new THREE.Color(WC.SHALLOW) } }]);
          u.uT = waterU; Object.assign(u, grabU); u.uSunDir = wUni.uSunDir; u.uSunCol = wUni.uSunCol;
          const m = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
            vertexShader: `uniform float uT; uniform float uSpd; uniform float uSeed; varying vec2 vUv; varying vec3 vWN; varying vec3 vWT; varying vec3 vWP;
              #include <fog_pars_vertex>
              ${W_NOISE}
              void main(){ vUv = uv; float fall = pow(1.0 - uv.y, 0.75) * 9.0, t = uT * uSpd;
                float d = (wNoise(vec2(uv.x * 5.0 + uSeed, fall * 0.7 - t * 0.9)) - 0.5) + (wNoise(vec2(uv.x * 13.0 - uSeed, fall * 1.8 - t * 1.25)) - 0.5) * 0.5;
                vec3 p = position + normal * d * (0.35 + 0.9 * (1.0 - uv.y));               // ondula mais embaixo
                vec4 wp = modelMatrix * vec4(p, 1.0); vWP = wp.xyz; vWN = normalize(mat3(modelMatrix) * normal); vWT = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
                vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
              }`,
            fragmentShader: `uniform float uT; uniform float uSpd; uniform float uA; uniform float uSeed; uniform vec3 uDeep; uniform vec3 uShallow;
              uniform sampler2D tGrab; uniform vec2 uRes; uniform float uHasGrab; uniform vec3 uSunDir; uniform vec3 uSunCol;
              varying vec2 vUv; varying vec3 vWN; varying vec3 vWT; varying vec3 vWP;
              #include <fog_pars_fragment>
              ${W_NOISE}
              // "normal map" procedural que desce: gradiente de um ruído alongado na vertical
              vec2 flowN(vec2 q, float sp, float t){ float e = 0.03; vec2 a = vec2(q.x, q.y - t * sp);
                float h = wNoise(a), hx = wNoise(a + vec2(e, 0.0)), hy = wNoise(a + vec2(0.0, e)); return vec2(hx - h, hy - h) / e; }
              void main(){
                float x = vUv.x, y = vUv.y, t = uT * uSpd;
                float fall = pow(1.0 - y, 0.75) * 9.0;
                vec2 n1 = flowN(vec2(x * 18.0 + uSeed, fall * 0.9), 1.0, t);            // camada 1: grossa
                vec2 n2 = flowN(vec2(x * 41.0 - uSeed, fall * 2.3), 1.0, t * 1.37);     // camada 2: fina e mais rápida
                vec2 nn = n1 * 0.6 + n2 * 0.4;
                vec3 B = vec3(0.0, 1.0, 0.0), N = normalize(vWN + vWT * nn.x * 0.35 + B * nn.y * 0.2);
                float wx = x + (wNoise(vec2(fall * 0.35 - t * 0.5, uSeed)) - 0.5) * 0.07 + (wNoise(vec2(x * 4.0 + uSeed, fall * 0.9 - t)) - 0.5) * 0.05 + nn.x * 0.004;
                float sheet = wNoise(vec2(wx * 22.0 + uSeed, fall * 0.55 - t));
                float fine = wNoise(vec2(wx * 60.0 - uSeed, fall * 1.4 - t * 1.4));
                float clump = wNoise(vec2(wx * 9.0 + uSeed * 0.3, fall * 2.6 - t * 1.2)) * wNoise(vec2(wx * 5.0, fall * 1.1 - t * 0.8) + 3.0) * 1.6;   // pacotes de água
                float s = clamp(sheet * 0.4 + fine * 0.2 + clump * 0.4, 0.0, 1.0);
                float aer = 1.0 - y, cyl = sin(x * 3.14159);
                vec3 tint = mix(uDeep, uShallow, smoothstep(0.3, 0.75, s));
                // fundo refratado (o morro atrás aparece torto e em movimento) ou, sem grab, só a cor da água
                vec2 suv = gl_FragCoord.xy / uRes + nn * 0.012;
                vec2 rq = vec2(x * 7.0, y * 26.0) + nn * 0.35;
                vec3 rockBg = vec3(0.55, 0.5, 0.42) * (0.62 + 0.38 * wNoise(rq) + 0.15 * wNoise(rq * 3.1)) * 0.78;    // pedra molhada (escura) vista através da água
                vec3 bg = uHasGrab > 0.5 ? texture2D(tGrab, clamp(suv, 0.001, 0.999)).rgb : rockBg;
                vec3 col = mix(bg * mix(vec3(1.0), tint, 0.55) * 1.1, tint * 1.08, 0.45 + 0.25 * aer) * (0.85 + 0.25 * cyl);
                float white = smoothstep(0.66 - aer * 0.45, 0.93 - aer * 0.3, s + (nn.y * 0.04)) + smoothstep(0.9, 1.0, y) * 0.5 + smoothstep(0.12, 0.0, y) * 0.8;
                col = mix(col, vec3(0.95, 0.99, 1.0), clamp(white, 0.0, 1.0));
                vec3 V = normalize(cameraPosition - vWP), H = normalize(uSunDir + V);
                col += uSunCol * pow(max(dot(N, H), 0.0), 70.0) * 0.45 * (1.0 - clamp(white, 0.0, 1.0));   // brilhos do sol nas ondulações
                col += vec3(0.55, 1.0, 1.0) * smoothstep(0.94, 0.985, y) * (1.0 - smoothstep(0.985, 1.0, y)) * 0.4;
                float rag = (wNoise(vec2(fall * 2.0 - t * 0.8, uSeed)) - 0.5) * 0.12;
                float edge = smoothstep(0.02 + rag, 0.13 + rag, x) * smoothstep(0.98 - rag, 0.87 - rag, x);
                float drops = step(0.8, wNoise(vec2(x * 80.0, fall * 10.0 - t * 2.0))) * (1.0 - edge) * smoothstep(0.0, 0.25, min(x, 1.0 - x) + 0.2);
                float body = 0.9;
                float a = uA * max(edge * body, drops * 0.8);
                gl_FragColor = vec4(col, a);
                #include <fog_fragment>
              }` }); m.userData.unique = true; return m; };
        // lâmina curva: sai do lábio, faz a "barriga" para fora e cai; abre um pouco embaixo
        const fallGeo = (w, H, z0, bulge, spread) => { const g = new THREE.PlaneGeometry(w, H, 24, 96); g.translate(0, H / 2, 0); const p = g.attributes.position;
          for (let i = 0; i < p.count; i++) { const y = p.getY(i), d = 1 - y / H;
            p.setX(i, p.getX(i) * (1 + spread * d)); p.setZ(i, z0 + bulge * Math.sqrt(Math.max(0, d)) + (y > H - 2 ? (y - (H - 2)) * -1.1 : 0)); }
          g.computeVertexNormals(); return g; };
        const sheet = (geo, mat, ro, x, y) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = ro; m.userData.noOutline = true; m.onBeforeRender = doGrab; m.position.set(x || 0, y || 0, zf(0)); wf.add(m); return m; };
        sheet(fallGeo(FW + 2, HT + 1, 0.4, 2.4, 0.12), fallMat(2.0, 0.62, 41.7), 1);              // fundo, mais largo
        sheet(fallGeo(FW, HT + 1, 0.9, 3.0, 0.1), fallMat(2.6, 0.96, 0), 2);                       // principal
        sheet(fallGeo(FW - 5, HT + 1, 1.6, 3.4, 0.14), fallMat(3.3, 0.6, 17.3), 3);                // véu da frente
        [-1, 1].forEach(sd => { const xs = sd * (FW / 2 + 9), H2 = Math.min(HT * 0.55, hillH(xs, zf(xs) - 0.3) - 6);   // quedas laterais (fiozinhos saindo da face)
          const m = sheet(fallGeo(2.6, H2, 0, 1.0, 0.4), fallMat(2.9, 0.8, 7.7 * sd + 30), 2, xs, 0); m.position.z = zf(xs) + 0.3; m.rotation.y = -Math.atan(0.022 * xs); });
        // pedra molhada atrás da queda
        { const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]); u.uT = waterU;
          const wg = new THREE.PlaneGeometry(FW + 10, HT, 24, 1); { const p = wg.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, zf(p.getX(i)) + 0.15); }
          const wet = new THREE.Mesh(wg, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, fog: true,
            vertexShader: `varying vec2 vUv;
              #include <fog_pars_vertex>
              void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
              }`,
            fragmentShader: `uniform float uT; varying vec2 vUv;
              #include <fog_pars_fragment>
              ${W_NOISE}
              void main(){ float x = abs(vUv.x - 0.5) * 2.0, n = wNoise(vec2(vUv.x * 34.0, vUv.y * 2.0 - uT * 0.6));
                float a = (1.0 - smoothstep(0.5 + n * 0.3, 1.0, x)) * (0.4 + 0.25 * n) * smoothstep(0.0, 0.06, vUv.y);
                float sh = smoothstep(0.75, 0.95, wNoise(vec2(vUv.x * 55.0, vUv.y * 7.0 - uT * 2.0)));
                gl_FragColor = vec4(mix(vec3(0.07, 0.16, 0.2), vec3(0.6, 0.95, 1.0), sh * 0.6), a);
                #include <fog_fragment>
              }` }));
          wet.position.set(0, HT / 2, 0); wet.renderOrder = 0; wet.userData.noOutline = true; wf.add(wet); }
        // poço de espuma no pé (elipse que cabe no rio): anéis abrindo, bolhas e espuma mais densa no centro
        const splashU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]); splashU.uT = waterU;
        const splash = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: splashU, transparent: true, depthWrite: false, fog: true,
          vertexShader: `varying vec2 vP;
            #include <fog_pars_vertex>
            void main(){ vP = position.xz; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
              #include <fog_vertex>
            }`,
          fragmentShader: `uniform float uT; varying vec2 vP;
            #include <fog_pars_fragment>
            ${W_NOISE}
            void main(){ float r = length(vP);
              float rings = smoothstep(0.6, 1.0, sin(r * 22.0 - uT * 4.5) * 0.5 + 0.5) * (1.0 - r);
              float bub = smoothstep(0.55, 0.8, wNoise(vP * 14.0 + vec2(uT * 0.8, -uT * 0.6))) + smoothstep(0.6, 0.85, wNoise(vP * 30.0 - uT));
              float core = 1.0 - smoothstep(0.1, 0.65, r);
              float a = clamp(core * 0.8 + rings * 0.45 + bub * 0.4 * (1.0 - r), 0.0, 0.92) * (1.0 - smoothstep(0.7, 1.0, r));
              gl_FragColor = vec4(vec3(0.96, 1.0, 1.0), a);
              #include <fog_fragment>
            }` }));
        splash.scale.set(11, 1, 7); splash.position.set(0, WATER_Y + 0.07, zf(0) + 5.2); splash.renderOrder = 4; splash.userData.noOutline = true; wf.add(splash);
        // arco-íris na névoa (meio-anel aditivo, bem suave)
        { const rb = new THREE.Mesh(new THREE.RingGeometry(15, 18.5, 96, 1, 0, Math.PI), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            uniforms: { uT: waterU },
            vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `uniform float uT; varying vec2 vP;
              vec3 hsv(float h){ vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return k; }
              void main(){ float r = (length(vP) - 15.0) / 3.5, ang = atan(vP.y, vP.x) / 3.14159;
                vec3 c = hsv(0.8 - r * 0.8);
                float a = smoothstep(0.0, 0.15, r) * smoothstep(1.0, 0.85, r) * smoothstep(0.0, 0.25, ang) * smoothstep(1.0, 0.75, ang) * smoothstep(0.0, 6.0, vP.y);
                gl_FragColor = vec4(c * a * (0.2 + 0.05 * sin(uT * 0.7)), 1.0); }` }));
          rb.position.set(0, -2, zf(0) + 12); rb.renderOrder = 5; rb.userData.noOutline = true; wf.add(rb); }
        wf.updateMatrixWorld(true);
        // ---- partículas na GPU: névoa que sobe e se espalha + respingos (gotículas com gravidade) ----
        // Uma malha instanciada por sistema; cada partícula nasce no impacto, tem idade/velocidade calculadas no
        // shader (sem custo de CPU), cresce ao longo da vida e some. Névoa com mistura normal (engrossa sem estourar).
        const particles = (o) => { const base = new THREE.PlaneGeometry(2, 2), g = new THREE.InstancedBufferGeometry();
          g.index = base.index; g.setAttribute('position', base.attributes.position); g.instanceCount = o.n;
          const sd = new Float32Array(o.n * 4); for (let i = 0; i < sd.length; i++) sd[i] = rnd(); g.setAttribute('seed', new THREE.InstancedBufferAttribute(sd, 4));
          const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uLife: { value: o.life }, uOrigin: { value: new THREE.Vector3().fromArray(o.origin) }, uSpread: { value: new THREE.Vector3().fromArray(o.spread) },
            uVel: { value: new THREE.Vector3().fromArray(o.vel) }, uVelR: { value: new THREE.Vector3().fromArray(o.velR) }, uGrav: { value: o.grav || 0 }, uDrag: { value: o.drag || 0 },
            uSize: { value: new THREE.Vector2(o.size[0], o.size[1]) }, uAlpha: { value: o.alpha }, uTurb: { value: o.turb || 0 }, uColor: { value: new THREE.Color(o.color) },
            uWaterY: { value: WATER_Y }, uDrop: { value: o.drop ? 1 : 0 } }]); u.uT = waterU;
          const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, fog: true,
            vertexShader: `uniform float uT; uniform float uLife; uniform vec3 uOrigin; uniform vec3 uSpread; uniform vec3 uVel; uniform vec3 uVelR; uniform float uGrav; uniform float uDrag;
              uniform vec2 uSize; uniform float uAlpha; uniform float uTurb; uniform float uWaterY; uniform float uDrop;
              attribute vec4 seed; varying vec2 vQ; varying float vA; varying float vS;
              #include <fog_pars_vertex>
              void main(){
                float L = uLife * (0.7 + 0.6 * seed.w), age = fract(uT / L + seed.x), tau = age * L;
                vec3 r1 = fract(seed.yzw * vec3(43.17, 17.71, 29.33) + seed.x * 7.13), r2 = fract(seed.zwy * vec3(13.7, 51.3, 23.9) + seed.x * 3.7);
                vec3 p0 = uOrigin + (r1 - 0.5) * 2.0 * uSpread;
                vec3 v = uVel + (r2 - 0.5) * 2.0 * uVelR;
                float k = max(uDrag, 1e-3), tt = uDrag > 0.0 ? (1.0 - exp(-k * tau)) / k : tau;   // arrasto: desacelera
                vec3 p = p0 + v * tt + vec3(0.0, -0.5 * uGrav * tau * tau, 0.0);
                p.x += sin(tau * 1.3 + seed.y * 20.0) * uTurb * age; p.z += cos(tau * 1.1 + seed.z * 17.0) * uTurb * age; p.y += sin(tau * 0.9 + seed.w * 11.0) * uTurb * 0.3 * age;
                float size = mix(uSize.x, uSize.y, pow(age, 0.6)) * (0.7 + 0.6 * seed.w);
                float a = uAlpha * pow(sin(3.14159 * age), 0.8);
                if (uDrop > 0.5 && p.y < uWaterY) a = 0.0;                                 // gota que voltou para a água some
                vA = a; vS = seed.y; vQ = position.xy;
                float ang = seed.z * 6.28 + uT * (seed.w - 0.5) * 0.4, c = cos(ang), s = sin(ang);
                vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); mvPosition.xy += mat2(c, -s, s, c) * position.xy * size;
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
              }`,
            fragmentShader: `uniform float uT; uniform vec3 uColor; uniform float uDrop; varying vec2 vQ; varying float vA; varying float vS;
              #include <fog_pars_fragment>
              ${W_NOISE}
              void main(){ float r = length(vQ); if (r > 1.0 || vA < 0.002) discard;
                float a;
                if (uDrop > 0.5) a = vA * (1.0 - smoothstep(0.35, 1.0, r));                  // gotícula: ponto redondo
                else { float n = wNoise(vQ * 2.2 + vS * 40.0 + uT * 0.12) * 0.6 + wNoise(vQ * 5.0 - vS * 13.0) * 0.4;   // fumaça: borda macia e rasgada
                  a = vA * (1.0 - smoothstep(0.15, 1.0, r)) * smoothstep(0.15, 0.75, n + 0.25 * (1.0 - r)); }
                gl_FragColor = vec4(uColor, a);
                #include <fog_fragment>
              }` }));
          m.frustumCulled = false; m.renderOrder = o.order || 6; m.userData.noOutline = true; wf.add(m);
          m.onBeforeRender = () => { if (!particles.logged) { particles.logged = true; console.info('[cachoeira] partículas (névoa/respingos) sendo desenhadas'); } };
          return m; };
        // ---- NEBLINA (refeita com sprites, o caminho mais garantido do three.js) ----
        // Textura de fumaça gerada em canvas (vários "puffs" macios sobrepostos). Cada nuvem nasce no impacto,
        // sobe com arrasto, se espalha para a frente e para os lados com turbulência, cresce e some.
        // Mistura normal (não soma luz): engrossa bem sem virar clarão.
        const smokeTex = (() => { const S = 128, c = TX.cvs(S, S), g = c.getContext('2d');
          for (let k = 0; k < 22; k++) { const x = S / 2 + (rnd() - 0.5) * S * 0.42, y = S / 2 + (rnd() - 0.5) * S * 0.42, r = S * (0.12 + rnd() * 0.2);
            const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
          const im = g.getImageData(0, 0, S, S), d = im.data;                                         // borda redonda e macia
          for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const r = Math.hypot(i - S / 2, j - S / 2) / (S / 2), k = (j * S + i) * 4; d[k + 3] *= Math.max(0, 1 - Math.pow(r, 2.2)); }
          g.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t; })();
        const fogZ = zf(0) + 4.2, puffs = [];
        const mkPuff = (low) => { const m = new THREE.SpriteMaterial({ map: smokeTex, color: 0xf3f9fb, transparent: true, depthWrite: false, opacity: 0, fog: true });
          const sp = new THREE.Sprite(m); sp.renderOrder = 7; sp.userData.noOutline = true; add(sp);
          // de perto a nuvem some aos poucos (a câmera "entra" na neblina sem a tela ficar toda branca)
          sp.onBeforeRender = (r, sc, cam) => { const e = cam.matrixWorld.elements, dx = e[12] - sp.position.x, dy = e[13] - sp.position.y, dz = e[14] - sp.position.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - sp.scale.x * 0.35, f = Math.min(1, Math.max(0, (d - 2) / 16));
            m.opacity = sp.userData.op * f * f * (3 - 2 * f); };
          return { sp, low, life: low ? 8 + rnd() * 4 : 5 + rnd() * 3, ph: rnd(), x0: (rnd() - 0.5) * (low ? FW * 1.3 : FW * 0.95), z0: fogZ + (rnd() - 0.5) * 3,
            vx: (rnd() - 0.5) * (low ? 7 : 5), vy: low ? 0.4 + rnd() * 0.6 : 3 + rnd() * 3, vz: low ? 3 + rnd() * 3 : 1.5 + rnd() * 2.5, s0: low ? 6 : 3, s1: low ? 26 + rnd() * 8 : 15 + rnd() * 8,
            rot: (rnd() - 0.5) * 0.5, a: low ? 0.3 : 0.38, seed: rnd() * 100 }; };
        for (let k = 0; k < (LO ? 16 : MID ? 36 : 64); k++) puffs.push(mkPuff(false));                                      // névoa que sobe do impacto
        for (let k = 0; k < (LO ? 6 : MID ? 12 : 22); k++) puffs.push(mkPuff(true));                                       // névoa rasteira, colada na água
        const _pv = new THREE.Vector3();
        tr.animated.push(t => { for (const q of puffs) {
          const age = ((t / q.life + q.ph) % 1), tau = age * q.life, k = 0.45, dr = (1 - Math.exp(-k * tau)) / k;   // arrasto: desacelera
          const tx = Math.sin(tau * 1.1 + q.seed) * 1.6 * age, tz = Math.cos(tau * 0.9 + q.seed * 1.3) * 1.2 * age;
          _pv.set(q.x0 + q.vx * dr + tx, WATER_Y + 0.6 + q.vy * dr + Math.sin(tau * 0.8 + q.seed) * 0.4 * age, q.z0 + q.vz * dr + tz);
          wf.localToWorld(_pv); q.sp.position.copy(_pv);
          const s = q.s0 + (q.s1 - q.s0) * Math.pow(age, 0.6); q.sp.scale.set(s, s * (q.low ? 0.55 : 0.85), 1);
          q.sp.material.rotation = q.seed + tau * q.rot;
          q.sp.userData.op = q.a * Math.pow(Math.sin(Math.PI * age), 0.9); q.sp.material.opacity = q.sp.userData.op; } });
        // respingos: gotículas (pontos) que saltam do impacto em parábola e caem de volta
        { const ND = LO ? 60 : MID ? 130 : 220, pos = new Float32Array(ND * 3), D = Array.from({ length: ND }, () => ({ ph: rnd(), life: 0.9 + rnd() * 0.9, x: (rnd() - 0.5) * FW * 0.95, z: fogZ - 0.6 + (rnd() - 0.5) * 2.5,
            vx: (rnd() - 0.5) * 7, vy: 4 + rnd() * 7, vz: 0.5 + rnd() * 6 }));
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          const dc = TX.cvs(32, 32), dg = dc.getContext('2d'), gr = dg.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(240,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); dg.fillStyle = gr; dg.fillRect(0, 0, 32, 32);
          const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.3, map: new THREE.CanvasTexture(dc), transparent: true, depthWrite: false, color: 0xf6ffff, sizeAttenuation: true }));
          pts.frustumCulled = false; pts.renderOrder = 8; pts.userData.noOutline = true; wf.add(pts);
          tr.animated.push(t => { D.forEach((q, k) => { const tau = ((t / q.life + q.ph) % 1) * q.life; let y = WATER_Y + 0.2 + q.vy * tau - 4.9 * tau * tau;
              if (y < WATER_Y - 0.05) y = -50;                                                        // voltou para a água: some
              pos[k * 3] = q.x + q.vx * tau; pos[k * 3 + 1] = y; pos[k * 3 + 2] = q.z + q.vz * tau; }); g.attributes.position.needsUpdate = true; }); }
        console.info('[cachoeira] neblina em sprites criada:', puffs.length, 'nuvens + 220 respingos');
        // espuma nas pedras dentro do poço (anel branco animado onde a água bate)
        { const ringU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]); ringU.uT = waterU;
          const ringM = new THREE.ShaderMaterial({ uniforms: ringU, transparent: true, depthWrite: false, fog: true,
            vertexShader: `varying vec2 vP;
              #include <fog_pars_vertex>
              void main(){ vP = position.xz; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
              }`,
            fragmentShader: `uniform float uT; varying vec2 vP;
              #include <fog_pars_fragment>
              ${W_NOISE}
              void main(){ float r = length(vP), n = wNoise(vP * 5.0 + uT * 0.8) * 0.6 + wNoise(vP * 11.0 - uT) * 0.4;
                float a = (1.0 - smoothstep(0.55, 1.0, r)) * smoothstep(0.25, 0.6, n + (1.0 - r) * 0.35) * 0.85;
                gl_FragColor = vec4(vec3(0.96, 1.0, 1.0), a);
                #include <fog_fragment>
              }` });
          [[-7.5, 7.5, 1.6], [8, 9, 1.3], [-2.8, 11.5, 1.1], [3.4, 13, 0.9]].forEach(([x, z, s]) => { const f = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), ringM);
            f.scale.setScalar(s * 2.4); f.position.set(x, WATER_Y + 0.05, zf(x) + z * 0.6); f.renderOrder = 4; f.userData.noOutline = true; wf.add(f); }); }
      }
      // domos de pedra com relevo irregular; cor de vértice esverdeada nas partes mais altas/planas
      const mountM = mountainMat();
      MOUNTS.forEach((M, k) => {
        const g = new THREE.SphereGeometry(1, LO ? 28 : MID ? 44 : 64, LO ? 12 : MID ? 20 : 28, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position, col = [];
        for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
          const n = 1 + (y < 0.999 ? 0.07 * Math.sin(a * 5 + k) * Math.sin(y * 7) + 0.05 * Math.sin(a * 11 + y * 9 + k * 2) : 0);
          p.setXYZ(i, x * n, y * (1 + 0.06 * Math.sin(a * 3 + k)), z * n);
          col.push(y, 0, 1); }   // r = altura relativa, b = domo (mais grama nas partes planas)
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
        const m = new THREE.Mesh(g, mountM); m.scale.set(M.rx, M.h, M.rz); m.position.set(M.c.x, -1.5, M.c.z); m.rotation.y = Math.atan2(FD.x, FD.z);
        m.castShadow = m.receiveShadow = true; add(m); tr.blockers.push({ x: M.c.x, y: M.h * 0.35, z: M.c.z, r: Math.min(M.rx, M.rz) * 0.9 }); });
      // pinheiros no topo do paredão e nas encostas
      { const pines = [];
        pines.push(...cliffPines);
        // altura exata da encosta (mesmo relevo aplicado aos vértices do domo), para o pinheiro não flutuar
        const surfY = (M, k, a, e) => { const nf = y => 1 + 0.07 * Math.sin(a * 5 + k) * Math.sin(y * 7) + 0.05 * Math.sin(a * 11 + y * 9 + k * 2);
          let lo = 0, hi = Math.PI / 2; for (let it = 0; it < 30; it++) { const ph = (lo + hi) / 2; if (Math.cos(ph) * nf(Math.sin(ph)) > e) lo = ph; else hi = ph; }
          return M.h * Math.sin(lo) * (1 + 0.06 * Math.sin(a * 3 + k)) - 1.5; };
        MOUNTS.forEach((M, mk) => { for (let k = 0; k < 16; k++) { const a = rnd() * Math.PI * 2, e = 0.45 + rnd() * 0.45, lx = Math.cos(a) * M.rx * e, lz = Math.sin(a) * M.rz * e;
          if (lz < -M.rz * 0.4 && Math.abs(lx) < 30) continue;                                    // não cobre o paredão
          const p = M.c.clone().addScaledVector(TB, lx).addScaledVector(FD, lz); pines.push({ x: p.x, y: surfY(M, mk, a, e) - 1.2, z: p.z, r: rnd() * 6.28, s: 1 + rnd() * 0.5 }); } });
        plants('pine', pines, 0x2a7a3a); }
      const mist = [];                                                                   // névoa agora é o sistema de partículas da cachoeira
      // ---- laguinhos com contorno próprio ----
      const PNA = 96, ponds = tr.ponds;
      function pondShape(r) { const el = 0.55 + rnd() * 0.9, rot = rnd() * 6.2832, H = [[2, 0.05 + rnd() * 0.16], [3, 0.03 + rnd() * 0.12], [4, 0.01 + rnd() * 0.06], [6, 0.005 + rnd() * 0.03]].map(([k, a]) => [k, a, rnd() * 6.2832]);
        const tab = []; for (let k = 0; k < PNA; k++) { const a = k / PNA * 6.2832, c = Math.cos(a - rot), s = Math.sin(a - rot); let f = 1 / Math.sqrt(c * c / el + s * s * el); H.forEach(([n, am, ph]) => f *= 1 + am * Math.sin(n * a + ph)); tab.push(Math.max(0.45, f) * r); }
        for (let it = 0; it < 2; it++) for (let k = 0; k < PNA; k++) tab[k] = (tab[(k + PNA - 1) % PNA] + 2 * tab[k] + tab[(k + 1) % PNA]) / 4;
        const R = a => { const u = ((a / 6.2832) % 1 + 1) % 1 * PNA, i = Math.floor(u) % PNA, j = (i + 1) % PNA, f = u - Math.floor(u); return tab[i] * (1 - f) + tab[j] * f; };
        return { R, rmax: Math.max(...tab) }; }
      const pondEdge = (p, x, z) => Math.hypot(x - p.x, z - p.z) - p.R(Math.atan2(z - p.z, x - p.x));
      function tryPond(x, z, r) { const sh = pondShape(r);
        if (tr.shortcuts.length && shortcutDist(x, z) < sh.rmax + 14) return false;   // lago não nasce no atalho
        if (tr.vert) for (let k = 0; k <= 8; k++) { const a = k * 0.785, rr = k === 8 ? 0 : sh.rmax + 12; if (natH(x + Math.cos(a) * rr, z + Math.sin(a) * rr) > 0.5) return false; }   // laguinho só na parte plana
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
      // vitórias-régias: folhas redondas com o corte em "V", algumas com florzinha; ficam boiando e giram devagar
      const lilyG = new THREE.CircleGeometry(1, 22, 0.35, Math.PI * 2 - 0.7).rotateX(-Math.PI / 2), lilyM = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      const flowerG = new THREE.ConeGeometry(0.32, 0.3, 6), flowerM = new THREE.MeshLambertMaterial({ color: 0xff8fc8, emissive: 0x552233 });
      const lilyAll = [];
      function pondLilies(p) { const n = Math.round(4 + p.r * 0.45), list = [];
        for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) { const a = rnd() * 6.2832, rr = Math.sqrt(rnd()) * p.R(a) * 0.82, x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
          if (list.some(q => Math.hypot(q.x - x, q.z - z) < 2.2)) continue; list.push({ x, z, s: 0.7 + rnd() * 0.8, r: rnd() * 6.28, sp: (rnd() - 0.5) * 0.1, fl: rnd() < 0.3 }); k++; }
        lilyAll.push(...list); }
      tr.animated.push(t => { if (!lilyAll.length) return; if (!lilyAll.im) { const im = new THREE.InstancedMesh(lilyG, lilyM, lilyAll.length), fl = lilyAll.filter(q => q.fl);
          const c = new THREE.Color(); lilyAll.forEach((q, k) => im.setColorAt(k, c.setHSL(0.27 + rnd() * 0.06, 0.55, 0.32 + rnd() * 0.1)));
          im.frustumCulled = false; im.userData.noOutline = true; im.receiveShadow = true; add(im); lilyAll.im = im;
          if (fl.length) { const fm = new THREE.InstancedMesh(flowerG, flowerM, fl.length); fm.frustumCulled = false; add(fm); lilyAll.fm = fm; lilyAll.fl = fl; } }
        const d = new THREE.Object3D();
        lilyAll.forEach((q, k) => { d.position.set(q.x + Math.sin(t * 0.3 + k) * 0.05, WATER_Y + 0.06, q.z); d.rotation.set(0, q.r + t * q.sp, 0); d.scale.setScalar(q.s); d.updateMatrix(); lilyAll.im.setMatrixAt(k, d.matrix); });
        lilyAll.im.instanceMatrix.needsUpdate = true;
        if (lilyAll.fm) { lilyAll.fl.forEach((q, k) => { d.position.set(q.x + Math.sin(t * 0.3 + lilyAll.indexOf(q)) * 0.05, WATER_Y + 0.2, q.z); d.rotation.set(0, q.r, 0); d.scale.setScalar(q.s * 0.9); d.updateMatrix(); lilyAll.fm.setMatrixAt(k, d.matrix); }); lilyAll.fm.instanceMatrix.needsUpdate = true; } });
      ponds.forEach(p => { const ang = k => k / PNA * 6.2832;
        const bk = new THREE.Mesh(polyStrip(PNA, 4, (k, c) => { const a = ang(k), R = p.R(a), [d, h] = PROF[c]; return [p.x + Math.cos(a) * (R + d), h, p.z + Math.sin(a) * (R + d), c * 0.6, k / PNA * R * 6.2832 / 3]; }), bankM); bk.receiveShadow = true; add(bk);
        add(new THREE.Mesh(polyStrip(PNA, 2, (k, c) => { const a = ang(k), R = (p.R(a) - 0.4) * c; return [p.x + Math.cos(a) * R, 0.14, p.z + Math.sin(a) * R, Math.cos(a) * R / 6, Math.sin(a) * R / 6]; }), bedM));
        const pos = [], uv = [], col = [], idx = [], C = WRING.length;
        for (let k = 0; k <= PNA; k++) { const a = ang(k % PNA), R = p.R(a) - 0.15; WRING.forEach(f => { const x = Math.cos(a) * R * f, z = Math.sin(a) * R * f; pos.push(x, 0.45, z); uv.push(x / 9, z / 9); const q = dcol(f); col.push(q.r, q.g, q.b); }); }
        for (let k = 0; k < PNA; k++) for (let c = 0; c < C - 1; c++) { const a = k * C + c, d = a + C; idx.push(a, a + 1, d, a + 1, d + 1, d); }
        const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); gg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); gg.setAttribute('flow', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2)); gg.setIndex(idx); gg.computeVertexNormals();
        const d = waterMesh(gg); d.position.set(p.x, 0, p.z); add(d);
        if (WC.LILIES) pondLilies(p);
        tr.minimap.push({ type: 'pond', poly: Array.from({ length: 48 }, (_, k) => { const a = k / 48 * 6.2832, R = p.R(a); return [p.x + Math.cos(a) * R, p.z + Math.sin(a) * R]; }) }); });
      tr.animated.push((t, dt) => {
        waterU.value = t; GfxFX.windU.value = t;
        mist.forEach((m, i) => { m.material.opacity = 0.1 + 0.05 * Math.sin(t * 2 + i * 2); m.scale.setScalar(12 + 3 * Math.sin(t * 1.5 + i)); });
      });
      const okSpot = (x, z, m) => !ponds.some(p => pondEdge(p, x, z) < m) && bridges.every(b => Math.hypot(x - S[b].x, z - S[b].z) > 40) && !nearRiver(x, z, 14) && Math.hypot(x - F.x, z - F.z) > 45 && !inMountain(x, z, m + 4) && Math.hypot(x - S[si].x, z - S[si].z) > 22 && !(tr.shortcuts.length && shortcutDist(x, z) < m + 3);
      // ---- malha do terreno com relevo (só quando a pista tem elev) ----
      waterDist = (x, z) => { let d = riverDist(x, z) - RHW; for (const q of ponds) d = Math.min(d, pondEdge(q, x, z)); return d; };
      // ---- terreno: bacia de areia dos lagos e do rio ----
      const bprof = (d, R) => d > R + 6 ? 0 : d > R + 1.2 ? 0.03 + 0.82 * (R + 6 - d) / 4.8 : d > R ? 0.85 : d > R - 0.4 ? 0.14 + 0.71 * (d - (R - 0.4)) / 0.4 : 0.14;
      const bank = (x, z) => { let h = 0; for (const q of ponds) h = Math.max(h, bprof(Math.hypot(x - q.x, z - q.z), q.R(Math.atan2(z - q.z, x - q.x))));
        let md = 1e9, mk = 0; for (let k = 0; k < rpts.length; k++) { const d = Math.hypot(rpts[k].x - x, rpts[k].z - z); if (d < md) { md = d; mk = k; } } return Math.max(h, bprof(md, rHW[mk])); };
      // altura do chão fora do asfalto: relevo + bacia de areia; perto da pista (dist/u) segue exatamente a beira do asfalto
      const terrain = (x, z, dist, u) => { let g = gH(x, z); if (tr.vert && dist !== undefined && u !== undefined) { const w = sm(W + 5, W + 40, dist); if (w < 1) g = lerp(elevAt(u) - drop(dist), g, w); } return Math.max(g, bank(x, z)); };
      if (tr.vert) tr.heightAt = (x, z) => terrain(x, z);
      const gcol = (x, z) => { const m = 0.9 + 0.06 * Math.sin(x * 0.013 + 1.3) * Math.cos(z * 0.011) + 0.05 * Math.sin(x * 0.034 + z * 0.029) + 0.03 * Math.sin(x * 0.071 - z * 0.064 + 2), h = Math.sin(x * 0.009 - z * 0.012 + 0.7) * 0.5 + 0.5; return [m * (1 + 0.07 * h), m, m * (1 - 0.07 * 1.4 * h)]; };
      const grassUV = (x, z) => [(x + GS / 2) / 7, (-z + GS / 2) / 7];                // mesmo mapeamento do chão grande (sem emenda)
      const nearBridge = i => bridges.some(b => { const d = Math.abs(((i - b) % N + N + N / 2) % N - N / 2); return d <= BR.END + 2; });
      if (tr.vert) {
        const terrM = grassTone(new THREE.MeshLambertMaterial({ map: TX.get('grass', 1, 1), vertexColors: true }));
        { const pad = 420, x0 = L.bbox.x0 - pad, x1 = L.bbox.x1 + pad, z0 = L.bbox.z0 - pad, z1 = L.bbox.z1 + pad, CELL = LO ? 20 : MID ? 15 : 12;
          const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL), pos = new Float32Array((nx + 1) * (nz + 1) * 3), uv = new Float32Array((nx + 1) * (nz + 1) * 2), col = new Float32Array(pos.length), idx = [];
          for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * CELL, z = z0 + j * CELL, k = j * (nx + 1) + i, r = roadInfo(x, z);
            let h = gH(x, z, r);
            if (r.d < W + 40) { h = Math.min(h, H[r.i] - drop(r.d) - (r.d < W + 2 ? 0.3 : 0));                    // nunca acima da beira do asfalto
              if (!nearBridge(r.i)) h -= (0.6 + 2.4 * sm(0.4, 2, r.h)) * (1 - sm(W + 28, W + 40, r.d)); }   // fica embaixo da faixa da beira
            if (i === 0 || j === 0 || i === nx || j === nz) h = -0.6;                     // borda escondida embaixo do chão grande
            pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z; const t = grassUV(x, z); uv[k * 2] = t[0]; uv[k * 2 + 1] = t[1]; const c = gcol(x, z); col.set(c, k * 3); }
          for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
          // em pedaços (chunks) de 16x16 células (~190 m): o que fica além da névoa não é desenhado (normais calculadas antes, sem emenda)
          const nor = g.attributes.normal.array, TS = 16;
          for (let tj = 0; tj < nz; tj += TS) for (let ti = 0; ti < nx; ti += TS) {
            const cx = Math.min(TS, nx - ti), cz = Math.min(TS, nz - tj), P2 = [], N2 = [], U2 = [], C2 = [], I2 = [];
            for (let j = 0; j <= cz; j++) for (let i = 0; i <= cx; i++) { const k = (tj + j) * (nx + 1) + ti + i; P2.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]); N2.push(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]); U2.push(uv[k * 2], uv[k * 2 + 1]); C2.push(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]); }
            for (let j = 0; j < cz; j++) for (let i = 0; i < cx; i++) { const a = j * (cx + 1) + i, b = a + 1, c = a + cx + 1, d = c + 1; I2.push(a, c, b, b, c, d); }
            const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3)); tg.setAttribute('normal', new THREE.Float32BufferAttribute(N2, 3));
            tg.setAttribute('uv', new THREE.Float32BufferAttribute(U2, 2)); tg.setAttribute('color', new THREE.Float32BufferAttribute(C2, 3)); tg.setIndex(I2);
            const m = new THREE.Mesh(tg, terrM); m.receiveShadow = true; m.userData.noOutline = true; add(m); } }
        // faixa da beira da pista (do fim da zebra até 40 m para fora): mesma altura que a física usa
        const Rloc = i => { const a = T[(i - 3 + N) % N], b = T[(i + 3) % N], cr = a.x * b.z - a.z * b.x, ang = Math.asin(Math.max(-1, Math.min(1, cr))), len = 6 * L.length / N; return { R: Math.abs(ang) > 1e-4 ? len / Math.abs(ang) : 1e9, sg: Math.sign(cr) }; };
        [1, -1].forEach(sg => {
          const FR = [0, 0.09, 0.19, 0.32, 0.5, 0.74, 1], C = FR.length + 1, pos = [], uv = [], col = [], idx = [], STEP = 2, rows = [];
          for (let i = 0; i <= N; i += STEP) rows.push(i % N);
          rows.forEach(i => { const rl = Rloc(i), inner = rl.sg !== 0 && Math.sign(-rl.sg) === sg, oMax = inner ? Math.max(W + 8, Math.min(W + 40, 0.8 * rl.R)) : W + 40;
            FR.concat([1.15]).forEach((f, c) => { const o = c < FR.length ? W + 1.8 + (oMax - W - 1.8) * f : oMax + 6, p = side(i, sg * o, 0), h = c < FR.length ? terrain(p.x, p.z, o, i) : terrain(p.x, p.z, oMax, i) - 3;
              pos.push(p.x, c === 0 ? h - 0.02 : h, p.z); const t = grassUV(p.x, p.z); uv.push(t[0], t[1]); col.push(...gcol(p.x, p.z)); }); });
          for (let r = 0; r < rows.length - 1; r++) { if (nearBridge(rows[r]) || nearBridge(rows[r + 1])) continue; for (let c = 0; c < C - 1; c++) { const a = r * C + c, d = a + C; if (sg > 0) idx.push(a, d, a + 1, a + 1, d, d + 1); else idx.push(a, a + 1, d, a + 1, d + 1, d); } }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
          const m = new THREE.Mesh(g, terrM); m.receiveShadow = true; m.userData.noOutline = true; add(m); });
      }
      // altura do chão para enfeites: perto da pista usa a mesma conta da faixa da beira (terrain com dist/u),
      // senão os enfeites ficavam flutuando (ou enterrados) nas subidas e descidas
      const gy = (x, z) => { const r = roadInfo(x, z); if (r.i < 0 || r.d > W + 45) return terrain(x, z);
        const n = tr.nearest({ x, z }, r.i); return terrain(x, z, n.dist, n.i + n.f); };
      // ---- postes de luz (estilo praça: base de pedra, poste afinando com anéis, braço curvo sobre a pista e luminária) ----
      // Geometrias e materiais compartilhados por todos os postes. A lente acende à noite (tr.nightMats) e um círculo de
      // luz quente aparece no asfalto embaixo da luminária (some de dia).
      const NIGHT = () => (window.Env && Env.nightF) || 0;
      { const LM = {
          base: new THREE.MeshLambertMaterial({ map: TX.get('rock', 1, 1), color: 0xb9b4ad }),
          iron: new THREE.MeshLambertMaterial({ color: 0x2b3038 }),
          trim: new THREE.MeshLambertMaterial({ color: 0xc9a24a }),
          glass: new THREE.MeshLambertMaterial({ color: 0xfff4d6, emissive: 0xffd58a, emissiveIntensity: 0.1 })
        };
        LM.glass.userData.unique = true; tr.nightMats.push({ m: LM.glass, max: 1.4, min: 0.1 });
        const ARM = 2.6, TOPY = 7.2;
        const LG = {
          base: GEO.rbox(0.95, 0.55, 0.95, 0.14), plinth: GEO.rbox(0.6, 0.35, 0.6, 0.1),
          pole: new THREE.CylinderGeometry(0.085, 0.15, TOPY - 0.9, 12),
          ring: new THREE.CylinderGeometry(0.19, 0.19, 0.12, 14), ringS: new THREE.CylinderGeometry(0.13, 0.13, 0.09, 12),
          cap: new THREE.SphereGeometry(0.17, 12, 8),
          arm: new THREE.TubeGeometry(new THREE.CubicBezierCurve3(V3(0, TOPY - 0.15, 0), V3(0, TOPY + 0.9, 0), V3(ARM * 0.55, TOPY + 0.95, 0), V3(ARM, TOPY + 0.35, 0)), 20, 0.055, 8, false),
          scroll: new THREE.TorusGeometry(0.32, 0.035, 6, 18, Math.PI * 1.5),
          hood: new THREE.ConeGeometry(0.5, 0.36, 12, 1, true), hoodTop: new THREE.CylinderGeometry(0.1, 0.16, 0.18, 10),
          lens: new THREE.CylinderGeometry(0.3, 0.38, 0.22, 12)
        };
        LG.hood.rotateY(Math.PI / 12);
        const poolM = new THREE.MeshBasicMaterial({ map: Fx.glowTex(), color: 0xffc977, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
        poolM.userData.unique = true;
        const poolG = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        const mk = (g, m, x, y, z, parent) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
        for (let i = 15; i < N; i += 36) { if (bridges.some(b => Math.abs(i - b) < 14)) continue;
          const sd = ((i / 36 | 0) % 2 ? 1 : -1), q = side(i, sd * (W + 4), 0); if (tr.shortcuts.length && shortcutDist(q.x, q.z) < 4) continue;
          const y0 = gy(q.x, q.z), grp = new THREE.Group();
          mk(LG.base, LM.base, 0, 0.12, 0, grp); mk(LG.plinth, LM.iron, 0, 0.55, 0, grp);
          mk(LG.pole, LM.iron, 0, 0.7 + (TOPY - 0.9) / 2, 0, grp);
          [1.0, 3.2, TOPY - 0.3].forEach((yy, k) => mk(k === 1 ? LG.ringS : LG.ring, LM.trim, 0, yy, 0, grp));
          mk(LG.cap, LM.trim, 0, TOPY + 0.05, 0, grp);
          mk(LG.arm, LM.iron, 0, 0, 0, grp);
          const sc1 = mk(LG.scroll, LM.iron, 0.42, TOPY + 0.42, 0, grp); sc1.rotation.z = -0.4;   // voluta decorativa embaixo do braço
          mk(LG.hoodTop, LM.iron, ARM, TOPY + 0.42, 0, grp);
          mk(LG.hood, LM.iron, ARM, TOPY + 0.2, 0, grp);
          const lens = mk(LG.lens, LM.glass, ARM, TOPY - 0.02, 0, grp); lens.castShadow = false;
          // +x local do poste aponta para a pista (o braço fica por cima do asfalto)
          const dx = -sd * T[i].z, dz = sd * T[i].x; grp.rotation.y = Math.atan2(-dz, dx); grp.position.set(q.x, y0, q.z); add(grp);
          const lx = q.x + dx * ARM, lz = q.z + dz * ARM;
          const h = glowSpr(0xffd9a0, 7, 0.9); h.position.set(lx, y0 + TOPY - 0.2, lz); tr.lamps.push(h);
          const pool = new THREE.Mesh(poolG, poolM), ni = tr.nearest({ x: lx, z: lz }, i);
          pool.scale.set(15, 1, 15); pool.position.set(lx, (ni.dist < W + 2 ? tr.roadBase + hAt(ni.i + ni.f) : gy(lx, lz)) + 0.1, lz); pool.renderOrder = 1; pool.userData.noOutline = true; add(pool);
          tr.obstacles.push({ x: q.x, z: q.z, r: 0.45 }); }
        tr.animated.push(() => { poolM.opacity = 0.42 * NIGHT(); });
      }
      // ---- muro azul e amarelo: mesma barreira das pontes, mais alta, seguindo o chão (com colisão) ----
      if (def.wall) buildBarrier({ u0: def.wall[0], u1: def.wall[1], lat: -(W + 5), base: (u, p) => terrain(p.x, p.z, W + 5, u), colors: [0xffd21a, 0x3a5fe0], h: 1.5, t: 0.8, sink: 1.2, blk: 2, collide: true });
      // ---- árvores: fileiras na beira da pista, "muro" de árvores no limite e bosques ----
      const lists = { round: [], dark: [], pine: [], autumn: [], bush: [] }, kinds = ['round', 'dark', 'pine', 'autumn'];
      for (let i = 0; i < N; i += 5) [1, -1].forEach((sd, k) => { const q = side(i, sd * (W + 14 + (i % 10 ? 0 : 5)), 0); if (okSpot(q.x, q.z, 6)) lists[kinds[(Math.floor(i / 62) + k * 2) % 4]].push({ x: q.x, z: q.z, r: rnd() * 6.28, s: 0.9 + rnd() * 0.35 }); });
      for (let i = 0; i < N; i += 4) [1, -1].forEach(sd => { const q = side(i, sd * (tr.WALL + 6 + rnd() * 14), 0); if (!nearTrack(q, tr.WALL + 3) && okSpot(q.x, q.z, 6)) lists[kinds[(rnd() * 4) | 0]].push({ x: q.x, z: q.z, r: rnd() * 6.28, s: 1 + rnd() * 0.5 }); });
      for (let gc = 0, t = 0; gc < 16 && t < 1500; t++) { const c = { x: (rnd() - 0.5) * 840, z: (rnd() - 0.5) * 840 }; if (nearTrack(c, W + 45) || !nearTrack(c, 110) || !okSpot(c.x, c.z, 25)) continue;
        const kind = kinds[gc % 4]; for (let k = 0; k < 11; k++) { const r = 4 + Math.sqrt(k) * 5.5, a = k * 2.4; lists[kind].push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, r: rnd() * 6.28, s: 0.9 + rnd() * 0.5 }); } gc++; }
      for (let c = 0; c < 60; c++) { const i = Math.floor(rnd() * N), sd = rnd() > 0.5 ? 1 : -1; for (let k = 0; k < 3; k++) { const q = side(i + k * 3, sd * (W + 7 + rnd() * 6), 0); if (okSpot(q.x, q.z, 3)) lists.bush.push({ x: q.x, z: q.z, r: rnd() * 6.28, s: 0.8 + rnd() * 0.6 }); } }
      Object.values(lists).forEach(l => l.forEach(o => { o.y = gy(o.x, o.z) - 0.15; }));
      plants('round', lists.round, 0x4fae3a); plants('round', lists.dark, 0x2f8a35); plants('pine', lists.pine, 0x2a7a3a); plants('round', lists.autumn, 0xe8892f); plants('bush', lists.bush, 0x3f9e2c);
      // ---- tufos de grama ----
      { const tuftG = new THREE.ConeGeometry(0.3, 1.5, 4); tuftG.translate(0, 0.75, 0); const dm = new THREE.Object3D();
        [0x45782c, 0x5f8e3c].forEach(col => /* tufos no mesmo tom da grama */ { const cnt = LO ? 400 : MID ? 900 : 1600, im = new THREE.InstancedMesh(tuftG, GfxFX.foliage(new THREE.MeshLambertMaterial({ color: col, flatShading: true }), { amp: 0.14, h0: 0.0, freq: 1.9, ao: [0.55, 0.0, 1.4] }), cnt); let n = 0;
          for (let t = 0; n < cnt && t < cnt * 8; t++) { let x, z; if (rnd() < 0.6) { const q = side(Math.floor(rnd() * N), (rnd() > 0.5 ? 1 : -1) * (W + 5.5 + rnd() * 30), 0); x = q.x; z = q.z; } else { x = (rnd() - 0.5) * 800; z = (rnd() - 0.5) * 800; }
            if (nearTrack({ x, z }, W + 5) || !okSpot(x, z, 2)) continue;
            for (let k = 0; k < 3 && n < cnt; k++) { { const tx = x + (rnd() - 0.5) * 1.4, tz = z + (rnd() - 0.5) * 1.4; dm.position.set(tx, gy(tx, tz) - 0.05, tz); }; dm.rotation.set((rnd() - 0.5) * 0.3, rnd() * 6.28, (rnd() - 0.5) * 0.3); dm.scale.set(0.7 + rnd() * 0.8, 0.6 + rnd(), 0.7 + rnd() * 0.8); dm.updateMatrix(); im.setMatrixAt(n++, dm.matrix); } }
          im.count = n; im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; add(im); }); }
      // ---- terreno: bacia de areia dos lagos e do rio ----
      // ---- atalhos: caminho de terra (com borda que se mistura na grama), marcas de pneu, toras na beira,
      //      postes listrados e placa com seta na entrada, e um morrinho de terra em cada ponta ----
      function buildShortcuts() {
        if (!tr.shortcuts.length) return;
        const dirtM = new THREE.MeshLambertMaterial({ map: GfxFX.aniso(TX.get('dirt', 1, 1)), vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
        const rutM = new THREE.MeshBasicMaterial({ color: 0x5a3c22, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
        const postM = new THREE.MeshLambertMaterial({ map: TX.get('stripes', 1, 2) }), logM = new THREE.MeshLambertMaterial({ map: TX.get('bark', 1, 1), color: 0xc8a070 });
        let hint = 0; const yH = (x, z) => { const n = tr.nearest({ x, z }, hint); return n.dist < W + 1.8 ? tr.roadBase + hAt(n.i + n.f) + 0.03 : terrain(x, z, n.dist, n.i + n.f); };
        // superfície VISÍVEL mais alta no ponto: relevo suave, faixa da beira de cada perna da curva (entrada e saída) e asfalto
        const legH = (x, z, c) => { let bd = 1e18, bi = c; for (let d = -45; d <= 45; d++) { const i = (c + d + N) % N, dx = S[i].x - x, dz = S[i].z - z, q = dx * dx + dz * dz; if (q < bd) { bd = q; bi = i; } }
          const dist = Math.sqrt(bd); if (dist > W + 42) return -1e9; return dist < W + 1.8 ? tr.roadBase + hAt(bi) : terrain(x, z, dist, bi); };
        const visH = (x, z, sc) => Math.max(terrain(x, z), legH(x, z, sc.i), legH(x, z, sc.j));
        // perfil do caminho: máximo das superfícies na largura do caminho, depois envelope (máximo móvel) e média móvel -> sem degraus
        tr.shortcuts.forEach(sc => { const P = sc.pts, n = P.length, raw = [];
          for (let k = 0; k < n; k++) { const a = P[Math.max(0, k - 1)], b = P[Math.min(n - 1, k + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
            let m = -1e9; for (const o of [-sc.hw, 0, sc.hw]) m = Math.max(m, visH(P[k].x + tz * o, P[k].z - tx * o, sc)); raw.push(m); }
          const env = raw.map((_, k) => { let m = -1e9; for (let d = -3; d <= 3; d++) m = Math.max(m, raw[Math.max(0, Math.min(n - 1, k + d))]); return m; });
          sc.h = env.map((_, k) => { let s2 = 0; for (let d = -3; d <= 3; d++) s2 += env[Math.max(0, Math.min(n - 1, k + d))]; return s2 / 7 + 0.06; });
          // pontas: enquanto o caminho está em cima do asfalto ele fica na altura exata da pista; depois sobe/desce em rampa
          // suave (6 amostras, ~15 m) até o perfil do terreno -> sem degrau na hora de sair da pista
          const road = P.map(q => { const nn = tr.nearest({ x: q.x, z: q.z }, sc.i); return nn.dist < W + 1.8 ? tr.roadBase + hAt(nn.i + nn.f) + 0.03 : null; });
          [[0, 1], [n - 1, -1]].forEach(([k0, dir]) => { let kE = -1; for (let k = k0; k >= 0 && k < n && road[k] !== null; k += dir) kE = k; if (kE < 0) return;
            const base = road[kE], R = 6; for (let k = k0; k !== kE + dir; k += dir) sc.h[k] = road[k];
            for (let m = 1; m <= R; m++) { const k = kE + dir * m; if (k < 0 || k >= n) break; const w = m / R, e = w * w * (3 - 2 * w); sc.h[k] = base + (sc.h[k] - base) * e; } }); });
        const skirtM = new THREE.MeshLambertMaterial({ color: 0x7a5634, side: THREE.DoubleSide });
        // recursos compartilhados da "vida" dos atalhos (pedras, flores, cogumelos, lampiões, vaga-lumes, borboletas)
        const LIFE = { flick: [] };
        LIFE.rockG = new THREE.DodecahedronGeometry(1, 0); LIFE.rockM = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
        LIFE.tuftG = new THREE.ConeGeometry(0.22, 1.1, 4); LIFE.tuftG.translate(0, 0.55, 0);
        LIFE.tuftM = GfxFX.foliage(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), { amp: 0.16, h0: 0.0, freq: 2.0, ao: [0.55, 0.0, 1.1] });
        LIFE.stemG = new THREE.CylinderGeometry(0.018, 0.022, 0.5, 4); LIFE.stemG.translate(0, 0.25, 0); LIFE.stemM = new THREE.MeshLambertMaterial({ color: 0x3f7a2a });
        { const pg = [], NP = 5; for (let k = 0; k < NP; k++) { const g = new THREE.SphereGeometry(0.075, 6, 4); g.scale(1, 0.35, 0.6); const a = k / NP * Math.PI * 2; g.translate(Math.cos(a) * 0.075, 0, Math.sin(a) * 0.075); pg.push(g); }
          LIFE.petalG = mergeParts(pg.map(g => ({ g, grp: 0 }))); LIFE.petalG.clearGroups(); }
        LIFE.petalM = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
        LIFE.coreG = new THREE.SphereGeometry(0.045, 6, 4); LIFE.coreM = new THREE.MeshLambertMaterial({ color: 0xffc21a, emissive: 0x3a2400 });
        LIFE.shStemG = new THREE.CylinderGeometry(0.05, 0.065, 0.26, 7); LIFE.shStemM = new THREE.MeshLambertMaterial({ color: 0xf3ead6 });
        { const c = TX.cvs(64, 32), x = c.getContext('2d'); x.fillStyle = '#e8302a'; x.fillRect(0, 0, 64, 32); x.fillStyle = '#fff';
          [[8, 6], [26, 10], [44, 5], [56, 14], [16, 18], [36, 22], [52, 26], [6, 26]].forEach(([a, b]) => { x.beginPath(); x.arc(a, b, 3.2, 0, 7); x.fill(); });
          LIFE.shCapG = new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); LIFE.shCapG.scale(1, 0.75, 1);
          LIFE.shCapM = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }); }
        LIFE.woodM = new THREE.MeshLambertMaterial({ map: TX.get('bark', 1, 1), color: 0xb08860 });
        LIFE.ironM = new THREE.MeshLambertMaterial({ color: 0x2a2620 });
        LIFE.postG = new THREE.CylinderGeometry(0.09, 0.12, 2.7, 7); LIFE.armG = new THREE.BoxGeometry(0.85, 0.11, 0.11);
        LIFE.hookG = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4);
        { const parts = [{ g: new THREE.CylinderGeometry(0.17, 0.2, 0.08, 6).translate(0, -0.2, 0), grp: 0 }, { g: new THREE.ConeGeometry(0.22, 0.16, 6).translate(0, 0.2, 0), grp: 0 }];
          [0, 1, 2, 3, 4, 5].forEach(k => { const a = k / 6 * Math.PI * 2 + Math.PI / 6; parts.push({ g: new THREE.CylinderGeometry(0.014, 0.014, 0.34, 3).translate(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17), grp: 0 }); });
          LIFE.lanternG = mergeParts(parts); LIFE.lanternG.clearGroups(); }
        LIFE.flameG = new THREE.SphereGeometry(0.1, 8, 6); LIFE.flameG.scale(1, 1.5, 1);
        LIFE.flameM = new THREE.MeshLambertMaterial({ color: 0xffe2a8, emissive: 0xff9a2a, emissiveIntensity: 0.2 }); LIFE.flameM.userData.unique = true; tr.nightMats.push({ m: LIFE.flameM, max: 1.6, min: 0.2 });
        LIFE.ffM = new THREE.PointsMaterial({ map: Fx.glowTex(), color: 0xd6ff6a, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
        { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.05, 0.3, 0, 0.2, 0.34, 0, -0.04, 0, 0, 0.05, 0.34, 0, -0.04, 0.17, 0, -0.2, 0, 0, 0.05, 0.17, 0, -0.2, 0, 0, -0.08], 3)); g.computeVertexNormals(); LIFE.wingG = g; }
        LIFE.wingM = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
        // lampiões tremulam de leve e brilham mais à noite (controlados aqui, fora de tr.lamps)
        tr.animated.push(t => { const nf = NIGHT(); LIFE.flick.forEach((g, k) => { const f = 0.88 + 0.08 * Math.sin(t * 13 + k * 1.7) + 0.04 * Math.sin(t * 29 + k); g.scale.setScalar(3.2 * f); g.material.opacity = (0.15 + 0.8 * nf) * f; }); });
        const logG = new THREE.CylinderGeometry(0.22, 0.26, 1.1, 8); logG.rotateZ(Math.PI / 2);
        // nada do caminho é desenhado em cima do asfalto/zebra: o ponto que cairia na pista é empurrado para logo depois da zebra
        const EDGE = W + 2.1, snap = (x, z) => { const nn = tr.nearest({ x, z }, hint); if (nn.dist >= EDGE) return [x, z];
          const i = nn.i, i1 = (i + 1) % N, qx = S[i].x + (S[i1].x - S[i].x) * nn.f, qz = S[i].z + (S[i1].z - S[i].z) * nn.f, sg = Math.sign(nn.lat) || 1;
          return [qx + T[i].z * sg * EDGE, qz - T[i].x * sg * EDGE]; };
        tr.shortcuts.forEach(sc => {
          hint = sc.i;
          const P = sc.pts, n = P.length, hw = sc.hw, EW = hw * 1.45, pos = [], uv = [], idx = [], col = [], NX = 12;
          // faixa: centro de terra, bordas na transição terra->grama da textura (u 0,7..0,86) e transparente depois
          let acc = 0;
          for (let k = 0; k < n; k++) { const a = P[Math.max(0, k - 1)], b = P[Math.min(n - 1, k + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
            if (k) acc += Math.hypot(P[k].x - P[k - 1].x, P[k].z - P[k - 1].z);
            for (let c = 0; c <= NX; c++) { const f = c / NX * 2 - 1, o = f * EW, [x, z] = snap(P[k].x + tz * o, P[k].z - tx * o); pos.push(x, sc.h[k] + 0.04, z); uv.push(Math.abs(f) * 0.98, acc / 6);
              // manchas: trechos mais claros (terra seca) e mais escuros (úmida); trilha do meio mais batida e as bordas puxando para o verde
              const nz = 0.5 + 0.25 * Math.sin(acc * 0.09 + f * 2.1) + 0.15 * Math.sin(acc * 0.23 - f * 4.3 + 1.7) + 0.1 * Math.sin(acc * 0.61 + f * 9);
              const worn = Math.exp(-Math.pow(f * EW / 3.2, 2)), v = 0.82 + 0.3 * nz - 0.08 * worn, ed = Math.max(0, Math.abs(f) - 0.62) / 0.38;
              col.push(v * (1 - 0.12 * ed), v * (1 + 0.06 * ed), v * (0.92 - 0.1 * ed)); } }
          for (let k = 0; k < n - 1; k++) for (let c = 0; c < NX; c++) { const a = k * (NX + 1) + c, d = a + NX + 1; idx.push(a, d, a + 1, a + 1, d, d + 1); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
          const m = new THREE.Mesh(g, dirtM); m.receiveShadow = true; m.userData.noOutline = true; add(m);
          // barranco: laterais de terra descendo 3,5 m a partir da borda opaca do caminho (onde o terreno visual afunda perto
          // da pista, o caminho vira um aterro em vez de uma folha flutuando)
          [-1, 1].forEach(sd => { const sp = [], si = [];
            for (let k = 0; k < n; k++) { const a = P[Math.max(0, k - 1)], b = P[Math.min(n - 1, k + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
              const o = sd * EW * 0.86, [x, z] = snap(P[k].x + tz * o, P[k].z - tx * o), y = sc.h[k] + 0.02; sp.push(x, y, z, x + tz * sd * 1.2, y - 3.5, z - tx * sd * 1.2); }
            for (let k = 0; k < n - 1; k++) { const a = k * 2; si.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
            const sg2 = new THREE.BufferGeometry(); sg2.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg2.setIndex(si); sg2.computeVertexNormals();
            const sk = new THREE.Mesh(sg2, skirtM); sk.receiveShadow = true; sk.userData.noOutline = true; add(sk); });
          // duas marcas de pneu escuras (quem passou antes)
          [-1.8, 1.8].forEach(off => { const rp = [], ri = [];
            for (let k = 0; k < n; k++) { const a = P[Math.max(0, k - 1)], b = P[Math.min(n - 1, k + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
              [-0.35, 0.35].forEach(w => { const o = off + w + Math.sin(k * 0.37) * 0.15, [x, z] = snap(P[k].x + tz * o, P[k].z - tx * o); rp.push(x, sc.h[k] + 0.07, z); }); }
            for (let k = 0; k < n - 1; k++) { const a = k * 2; ri.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
            const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setIndex(ri);
            const rm = new THREE.Mesh(rg, rutM); rm.renderOrder = 1; rm.userData.noOutline = true; add(rm); });
          // toras deitadas na beira, uma a cada ~7 m (só enfeite: não bloqueiam)
          const logs = []; for (let k = 3; k < n - 3; k += 3) [-1, 1].forEach(sd => { const a = P[k - 1], b = P[k + 1]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
            const o = sd * (hw + 1.6), x = P[k].x + tz * o, z = P[k].z - tx * o; if (Math.hypot(x - P[0].x, z - P[0].z) < 10 || Math.hypot(x - P[n - 1].x, z - P[n - 1].z) < 10) return;
            if (tr.nearest({ x, z }, 0).dist < W + 3) return; logs.push({ x, z, y: Math.max(sc.h[k] - 0.1, yH(x, z)) + 0.2, r: Math.atan2(tx, tz) + (Math.random() - 0.5) * 0.3 }); });
          if (logs.length) { const im = new THREE.InstancedMesh(logG, logM, logs.length), d = new THREE.Object3D();
            logs.forEach((q, i) => { d.position.set(q.x, q.y, q.z); d.rotation.set(0, q.r, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }); im.castShadow = true; add(im); }
          // ===== VIDA NO ATALHO =====
          // pontos da beira do caminho: frame (tangente/lateral) em cada amostra, longe das pontas e do asfalto
          const frameAt = k => { const a = P[Math.max(0, k - 1)], b = P[Math.min(n - 1, k + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; return [tx / l, tz / l]; };
          const edgePt = (k, o) => { const [tx, tz] = frameAt(k), x = P[k].x + tz * o, z = P[k].z - tx * o;
            if (Math.hypot(x - P[0].x, z - P[0].z) < 9 || Math.hypot(x - P[n - 1].x, z - P[n - 1].z) < 9) return null;
            if (tr.nearest({ x, z }, sc.i).dist < W + 3) return null; return { x, z, y: Math.max(sc.h[k] - 0.12, yH(x, z)), tx, tz }; };
          const inst = (geo, mat, list, setup, shadow) => { if (!list.length) return null; const im = new THREE.InstancedMesh(geo, mat, list.length), d = new THREE.Object3D(), c = new THREE.Color();
            list.forEach((q, i) => { setup(d, q); d.updateMatrix(); im.setMatrixAt(i, d.matrix); if (q.c !== undefined) im.setColorAt(i, c.set(q.c)); });
            im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = !!shadow; im.receiveShadow = true; im.userData.noOutline = true; add(im); return im; };
          // pedras: grupinhos irregulares na beira, algumas meio enterradas
          const rocks = [], flowers = [], tufts = [], shrooms = [];
          for (let k = 2; k < n - 2; k++) [-1, 1].forEach(sd => {
            if (rnd() < 0.22 * LIFEK) { const q = edgePt(k, sd * (hw + 0.6 + rnd() * 2.6)); if (q) { const nR = 1 + (rnd() * 3 | 0);
              for (let j = 0; j < nR; j++) rocks.push({ x: q.x + (rnd() - 0.5) * 1.2, z: q.z + (rnd() - 0.5) * 1.2, y: q.y, s: 0.18 + rnd() * 0.45, r: rnd() * 6.28, c: [0x8d8781, 0x7a736c, 0xa39b90, 0x6c6863][rnd() * 4 | 0] }); } }
            if (rnd() < 0.55 * LIFEK) { const q = edgePt(k, sd * (EW * 0.86 + rnd() * 3.5)); if (q) {
              for (let j = 0; j < 4; j++) tufts.push({ x: q.x + (rnd() - 0.5) * 1.6, z: q.z + (rnd() - 0.5) * 1.6, y: q.y, s: 0.6 + rnd() * 0.7, r: rnd() * 6.28, c: rnd() < 0.5 ? 0x4f8a30 : 0x6a9a3a });
              if (rnd() < 0.7) { const pal = [0xff5a8a, 0xffd23f, 0xffffff, 0xb56cff, 0xff8a3d, 0x6ac8ff][rnd() * 6 | 0];
                for (let j = 0; j < 3 + (rnd() * 4 | 0); j++) flowers.push({ x: q.x + (rnd() - 0.5) * 1.8, z: q.z + (rnd() - 0.5) * 1.8, y: q.y, s: 0.8 + rnd() * 0.6, h: 0.35 + rnd() * 0.35, c: pal }); } } }
            if (rnd() < 0.04) { const q = edgePt(k, sd * (hw + 1.0 + rnd() * 1.5)); if (q) for (let j = 0; j < 2 + (rnd() * 3 | 0); j++) shrooms.push({ x: q.x + (rnd() - 0.5) * 0.9, z: q.z + (rnd() - 0.5) * 0.9, y: q.y, s: 0.6 + rnd() * 0.8 }); } });
          inst(LIFE.rockG, LIFE.rockM, rocks, (d, q) => { d.position.set(q.x, q.y + q.s * 0.25, q.z); d.rotation.set(q.r, q.r * 1.7, q.r * 0.6); d.scale.set(q.s * 1.3, q.s * 0.7, q.s); }, true);
          inst(LIFE.tuftG, LIFE.tuftM, tufts, (d, q) => { d.position.set(q.x, q.y - 0.05, q.z); d.rotation.set((q.r % 0.3) - 0.15, q.r, 0); d.scale.set(q.s, q.s * 1.1, q.s); });
          inst(LIFE.stemG, LIFE.stemM, flowers.map(q => ({ x: q.x, y: q.y, z: q.z, h: q.h })), (d, q) => { d.position.set(q.x, q.y, q.z); d.rotation.set(0, 0, 0); d.scale.set(1, q.h / 0.5, 1); });
          inst(LIFE.petalG, LIFE.petalM, flowers, (d, q) => { d.position.set(q.x, q.y + q.h, q.z); d.rotation.set(0, q.x * 3.1, 0); d.scale.setScalar(q.s); });
          inst(LIFE.coreG, LIFE.coreM, flowers.map(q => ({ x: q.x, y: q.y, z: q.z, h: q.h, s: q.s })), (d, q) => { d.position.set(q.x, q.y + q.h + 0.04, q.z); d.rotation.set(0, 0, 0); d.scale.setScalar(q.s); });
          inst(LIFE.shStemG, LIFE.shStemM, shrooms, (d, q) => { d.position.set(q.x, q.y + 0.13 * q.s, q.z); d.rotation.set(0, 0, 0); d.scale.setScalar(q.s); });
          inst(LIFE.shCapG, LIFE.shCapM, shrooms, (d, q) => { d.position.set(q.x, q.y + 0.26 * q.s, q.z); d.rotation.set((q.x % 0.4) - 0.2, 0, (q.z % 0.4) - 0.2); d.scale.setScalar(q.s); }, true);
          // lampiões de madeira ao longo do caminho (a cada ~22 m, alternando os lados): acendem à noite
          { const posts = []; let side0 = 1;
            for (let k = 5; k < n - 5; k += 9) { side0 = -side0; const q = edgePt(k, side0 * (hw + 2.0)); if (!q) continue; posts.push(Object.assign(q, { sd: side0 })); }
            posts.forEach(q => { const grp = new THREE.Group(), toPath = -q.sd;
              const post = new THREE.Mesh(LIFE.postG, LIFE.woodM); post.position.y = 1.35; post.castShadow = true; grp.add(post);
              const arm = new THREE.Mesh(LIFE.armG, LIFE.woodM); arm.position.set(0.38, 2.55, 0); arm.castShadow = true; grp.add(arm);
              const hook = new THREE.Mesh(LIFE.hookG, LIFE.ironM); hook.position.set(0.68, 2.42, 0); grp.add(hook);
              const lt = new THREE.Mesh(LIFE.lanternG, LIFE.ironM); lt.position.set(0.68, 2.08, 0); lt.castShadow = true; grp.add(lt);
              const fl = new THREE.Mesh(LIFE.flameG, LIFE.flameM); fl.position.set(0.68, 2.06, 0); grp.add(fl);
              // +x local aponta para o caminho
              const dx = q.tz * toPath, dz = -q.tx * toPath; grp.rotation.y = Math.atan2(-dz, dx); grp.position.set(q.x, q.y, q.z); add(grp);
              const gl = glowSpr(0xffb35a, 3.2, 0.9); gl.position.set(q.x + dx * 0.68, q.y + 2.06, q.z + dz * 0.68); LIFE.flick.push(gl);
              tr.obstacles.push({ x: q.x, z: q.z, r: 0.22 }); }); }
          // vaga-lumes (à noite) e borboletas (de dia) voando sobre o atalho (fora no detalhe baixo)
          if (!LO) { const NFF = 46, ffBase = [], fpos = new Float32Array(NFF * 3);
            for (let j = 0; j < NFF; j++) { const k = 2 + (rnd() * (n - 4) | 0), [tx, tz] = frameAt(k), o = (rnd() - 0.5) * (EW * 2 + 6);
              ffBase.push({ x: P[k].x + tz * o, z: P[k].z - tx * o, y: sc.h[k] + 0.5 + rnd() * 2.2, ph: rnd() * 6.28, sp: 0.4 + rnd() * 0.7 }); }
            const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
            const ff = new THREE.Points(fg, LIFE.ffM); ff.frustumCulled = false; ff.renderOrder = 6; ff.userData.noOutline = true; ff.userData.dynamic = true; add(ff);
            const NB = 12, bf = [];
            for (let j = 0; j < NB; j++) { const k = 4 + (rnd() * (n - 8) | 0);
              bf.push({ k, cx: P[k].x, cz: P[k].z, cy: sc.h[k] + 0.7, r: 2 + rnd() * 5, ph: rnd() * 6.28, sp: 0.3 + rnd() * 0.4, fl: rnd() * 6.28, c: [0xffa22a, 0xfff07a, 0xffffff, 0x5ab8ff, 0xff6ab0][rnd() * 5 | 0] }); }
            const bim = new THREE.InstancedMesh(LIFE.wingG, LIFE.wingM, NB * 2), bc = new THREE.Color();
            bf.forEach((b, j) => { bim.setColorAt(j * 2, bc.set(b.c)); bim.setColorAt(j * 2 + 1, bc.set(b.c)); });
            bim.frustumCulled = false; bim.userData.noOutline = true; bim.userData.dynamic = true; add(bim);
            const d = new THREE.Object3D(); d.rotation.order = 'YZX';
            tr.animated.push(t => { const nf = NIGHT();
              // vaga-lumes: pairam, piscam (cor fixa, opacidade geral pela noite)
              LIFE.ffM.opacity = 0.95 * nf; ff.visible = nf > 0.03;
              if (ff.visible) { for (let j = 0; j < NFF; j++) { const q = ffBase[j], tt = t * q.sp + q.ph;
                  fpos[j * 3] = q.x + Math.sin(tt) * 1.6 + Math.sin(tt * 2.3) * 0.4; fpos[j * 3 + 1] = q.y + Math.sin(tt * 1.7) * 0.5 + (Math.sin(t * 3 + q.ph * 5) > 0.6 ? 0 : -60);
                  fpos[j * 3 + 2] = q.z + Math.cos(tt * 0.9) * 1.6; } fg.attributes.position.needsUpdate = true; }
              // borboletas: zanzam em volta de um ponto da beira, batendo as asas
              bim.visible = nf < 0.6;
              if (bim.visible) { bf.forEach((b, j) => { const tt = t * b.sp + b.ph, x = b.cx + Math.cos(tt) * b.r + Math.sin(tt * 2.7) * 0.6, z = b.cz + Math.sin(tt * 1.3) * b.r, y = b.cy + Math.sin(tt * 3.1) * 0.35 + 0.2;
                  const vx = -Math.sin(tt) * b.r + Math.cos(tt * 2.7) * 1.6, vz = Math.cos(tt * 1.3) * b.r * 1.3, yaw = Math.atan2(vx, vz) - Math.PI / 2, fla = 0.25 + Math.sin(t * 16 + b.fl) * 0.85;
                  d.position.set(x, y, z); d.scale.set(1, 1, 1); d.rotation.set(0, yaw, fla); d.updateMatrix(); bim.setMatrixAt(j * 2, d.matrix);
                  d.scale.set(-1, 1, 1); d.rotation.set(0, yaw, -fla); d.updateMatrix(); bim.setMatrixAt(j * 2 + 1, d.matrix); });
                bim.instanceMatrix.needsUpdate = true; } }); }
          // entrada (nas duas pontas): dois postes listrados e uma placa com seta apontando para dentro do atalho
          [[0, 1], [n - 1, -1]].forEach(([k0, dir]) => { const k1 = Math.max(0, Math.min(n - 1, k0 + dir * 6)), A = P[k1], B = P[Math.max(0, Math.min(n - 1, k1 + dir))];
            let tx = (B.x - A.x) * dir, tz = (B.z - A.z) * dir; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
            [-1, 1].forEach(sd => { const o = sd * (hw + 1.2), x = A.x + tz * o * dir, z = A.z - tx * o * dir, y = Math.max(sc.h[k1] - 0.2, yH(x, z));
              const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.6, 10), postM); pole.position.set(x, y + 1.3, z); pole.castShadow = true; add(pole);
              tr.obstacles.push({ x, z, r: 0.25 }); });
          });
          // placa na beira da pista, ~25 m antes da entrada, DE FRENTE para quem vem, com a seta apontando para o lado do atalho
          { const ni = ((sc.i - 6) % N + N) % N, Tn = T[ni], q = side(ni, sc.sg * (W + 4.5), 0); hint = ni; const y = yH(q.x, q.z);
            const c = TX.cvs(256, 128), g2 = c.getContext('2d'); g2.fillStyle = '#ffd23f'; g2.fillRect(0, 0, 256, 128); g2.fillStyle = '#1c1c22'; g2.fillRect(0, 0, 256, 12); g2.fillRect(0, 116, 256, 12);
            if (sc.sg > 0) { g2.translate(256, 0); g2.scale(-1, 1); }   // seta para o lado certo (a face olha para trás na pista; +x da placa = lado -1)
            g2.beginPath(); g2.moveTo(40, 52); g2.lineTo(150, 52); g2.lineTo(150, 30); g2.lineTo(215, 64); g2.lineTo(150, 98); g2.lineTo(150, 76); g2.lineTo(40, 76); g2.closePath(); g2.fill();
            const dark = new THREE.MeshLambertMaterial({ color: 0x2a2a30 }), board = new THREE.Group();
            const panel = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.4, 0.12), [dark, dark, dark, dark, new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }), dark]);
            panel.position.y = 2.2; panel.castShadow = true; board.add(panel);
            [-1, 1].forEach(sd => { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6), dark); leg.position.set(sd * 1.1, 1.1, -0.05); board.add(leg); });
            board.position.set(q.x, y, q.z); board.rotation.y = Math.atan2(-Tn.x, -Tn.z); add(board);
            tr.obstacles.push({ x: q.x, z: q.z, r: 1.2 }); }
        });
        console.info('[atalho] ' + tr.shortcuts.length + ' atalho(s): ' + tr.shortcuts.map(sc => sc.i + '→' + sc.j).join(', '));
      }
      const waterTest = p => { if (bridges.some(b => { const dx = p.x - S[b].x, dz = p.z - S[b].z; return Math.abs(dx * T[b].x + dz * T[b].z) < 30 && Math.abs(dx * T[b].z - dz * T[b].x) < W + 2.1; })) return false;
        return ponds.some(q => pondEdge(q, p.x, p.z) < 0) || nearRiver(p.x, p.z, RHW - 0.5); };
      buildShortcuts();
      tr.dustColor = 0xc9a878;
      return { terrain, waterTest };
    }
  }

  window.Tracks = { layout, build, PLANTS, get N() { return N; } };
})();
