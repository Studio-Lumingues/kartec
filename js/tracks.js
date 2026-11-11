// =====================================================================================
// tracks.js — construção 3D das pistas
//  * Tracks.layout(def): gera o traçado (spline fechada com N nós) a partir dos segmentos do config
//  * Tracks.build(def, scene): monta asfalto, zebras, acostamento, pórtico, plataformas, rampas e o
//    cenário do tema 'classic' (grama, rio com pontes, cachoeira, lagos). As pistas Cidade e Praia foram
//    removidas. Devolve o objeto "track" usado pela física e pela IA.
// =====================================================================================
console.info('%c[tracks.js] versão mar-5 (atalhos sem os pauzinhos)', 'color:#0bb;font-weight:bold');   // se esta linha não aparecer no console, o navegador está usando um tracks.js antigo
(function () {
  // ===================================================================================
  // GfxFX — melhorias gráficas compartilhadas (usadas aqui e no scenery.js)
  //  * aniso(tex): filtragem anisotrópica (asfalto e grama nítidos de longe, sem borrão no horizonte)
  //  * antiTile(mat, o): esconde a repetição do ladrilho (segunda amostra girada/ampliada + manchas grandes)
  //  * foliage(mat, o): vento nas árvores/arbustos/grama + sombreamento de oclusão (base escura, copa clara)
  // Todas as trocas de shader têm customProgramCacheKey próprio (senão o three.js reaproveita o programa errado).
  // ===================================================================================
  // construtor original do Phong, guardado ANTES de qualquer Toon.during (que troca os materiais da pista por toon de 3 tons).
  // As montanhas usam este: com o toon, cada ondulação da rocha virava uma faixa escura de borda dura ("cortadinho").
  const PHONG_ORIG = THREE.MeshPhongMaterial;
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

  const GRASS_TONE = { sat: 0.6, mul: [0.88, 0.81, 0.72] };
  GfxFX.grassTone = function grassTone(m) {
      m.userData.unique = true; m.customProgramCacheKey = () => 'grass-tone-v2'; GfxFX.aniso(m.map, 16);
      // + sem repetição visível do ladrilho, manchas grandes de cor e trechos de grama mais seca (mesma conta nos dois chãos: sem emenda)
      m.onBeforeCompile = sh => { sh.fragmentShader = GfxFX.NOISE + sh.fragmentShader.replace('#include <map_fragment>', GfxFX.mapCode({ scale: 0.29, blend: 0.55, macro: 0.13, dry: 0.55 }) + `
        { float gl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)); diffuseColor.rgb = mix(vec3(gl), diffuseColor.rgb, ${GRASS_TONE.sat.toFixed(3)}) * vec3(${GRASS_TONE.mul.map(v => v.toFixed(3)).join(', ')}); }`); };
      return m;
    };
  // asfalto do jogo (mesma textura, Phong e anti-repetição da pista) para outros cenários (lobby)
  GfxFX.asphaltMaterial = function (rx, ry) {
    const t = GfxFX.aniso(TX.get('asphalt', rx || 1, ry || 1), 16);
    return GfxFX.antiTile(new THREE.MeshPhongMaterial({ map: t, color: 0xffffff, shininess: 30, specular: 0x26262a }), { scale: 0.41, blend: 0.45, macro: 0.07 });
  };

  // ===================================================================================
  // POSTE DE LUZ (lampião clássico grande) — o MESMO modelo nas pistas e no lobby/garagem (showroom.js)
  //   LampPost.materials()  pedra, ferro, dourado e vidro     LampPost.geometries()  peças (descarte depois)
  //   LampPost.place(LG, put, M)  coloca as peças de UM poste (matriz M) na lista "bake" (put(key, geo, M, x, y, z, rx, ry, rz))
  //   LampPost.merge(bake, LM)  junta tudo em 4 malhas.  Cabeça (lanterna) em (ARM, LAMPY, 0) no espaço do poste.
  // ===================================================================================
  const LampPost = window.LampPost = (() => {
    const ARM = 3.9, TOPY = 10.6, LAMPY = TOPY - 0.55;
    function materials() { return {
      base: new THREE.MeshLambertMaterial({ map: TX.get('rock', 1, 1), color: 0xc9c3ba }),
      iron: new THREE.MeshPhongMaterial({ color: 0x23272f, shininess: 40, specular: 0x3a3f48 }),
      trim: new THREE.MeshPhongMaterial({ color: 0xd8ad4c, shininess: 70, specular: 0x806020 }),
      glass: new THREE.MeshLambertMaterial({ color: 0xfff1cf, emissive: 0xffc777, emissiveIntensity: 0.12 }) }; }
    function geometries() {
      const colP = [[0.36, 0], [0.34, 0.18], [0.24, 0.42], [0.27, 0.52], [0.2, 0.7], [0.17, 1.4], [0.15, 3.2], [0.19, 3.32], [0.15, 3.44], [0.13, TOPY - 1.05],
        [0.18, TOPY - 0.92], [0.13, TOPY - 0.78], [0.12, TOPY - 0.2], [0.15, TOPY - 0.1], [0.0, TOPY]].map(p => new THREE.Vector2(p[0], p[1]));
      const swan = new THREE.CubicBezierCurve3(V3(0, TOPY - 0.6, 0), V3(0, TOPY + 1.5, 0), V3(ARM * 0.55, TOPY + 1.6, 0), V3(ARM, TOPY + 0.55, 0));
      const brace = new THREE.CubicBezierCurve3(V3(0, TOPY - 1.9, 0), V3(0.9, TOPY - 1.7, 0), V3(1.6, TOPY - 0.4, 0), V3(2.2, TOPY + 1.05, 0));
      const LG = {
        step1: new THREE.CylinderGeometry(0.95, 1.05, 0.45, 8), step2: new THREE.CylinderGeometry(0.7, 0.8, 0.5, 8), step3: new THREE.CylinderGeometry(0.5, 0.55, 0.2, 8),
        col: new THREE.LatheGeometry(colP, 18),
        ring: new THREE.TorusGeometry(0.2, 0.045, 6, 18).rotateX(Math.PI / 2), ringB: new THREE.TorusGeometry(0.3, 0.05, 6, 18).rotateX(Math.PI / 2),
        arm: new THREE.TubeGeometry(swan, 28, 0.075, 8, false), brace: new THREE.TubeGeometry(brace, 20, 0.04, 6, false),
        scroll: new THREE.TorusGeometry(0.34, 0.04, 6, 20, Math.PI * 1.6), scroll2: new THREE.TorusGeometry(0.22, 0.035, 6, 16, Math.PI * 1.6),
        hook: new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6),
        hood: new THREE.ConeGeometry(0.62, 0.48, 8), hoodRim: new THREE.CylinderGeometry(0.64, 0.64, 0.06, 8),
        finial: new THREE.SphereGeometry(0.11, 10, 8), spike: new THREE.ConeGeometry(0.05, 0.3, 6),
        glass: new THREE.CylinderGeometry(0.42, 0.3, 0.72, 8, 1, true), glassIn: new THREE.CylinderGeometry(0.16, 0.16, 0.36, 10),
        bar: new THREE.CylinderGeometry(0.022, 0.022, 0.76, 4), bottom: new THREE.ConeGeometry(0.31, 0.3, 8), drop: new THREE.SphereGeometry(0.06, 8, 6)
      };
      LG.glass.rotateY(Math.PI / 8); LG.hood.rotateY(Math.PI / 8); LG.hoodRim.rotateY(Math.PI / 8); LG.bottom.rotateX(Math.PI).rotateY(Math.PI / 8);
      return LG;
    }
    function place(LG, put, M) {
      put('base', LG.step1, M, 0, 0.22, 0); put('base', LG.step2, M, 0, 0.67, 0); put('base', LG.step3, M, 0, 1.0, 0);
      put('iron', LG.col, M, 0, 1.05, 0);
      [[LG.ringB, 1.12], [LG.ring, 1.9], [LG.ring, 4.38], [LG.ring, TOPY + 1.05 - 0.92], [LG.ringB, TOPY + 1.05 - 1.5]].forEach(([g, yy]) => put('trim', g, M, 0, yy, 0));
      put('iron', LG.arm, M, 0, 0, 0); put('iron', LG.brace, M, 0, 0, 0);
      put('iron', LG.scroll, M, 0.55, TOPY - 0.25, 0, 0, 0, -0.6); put('iron', LG.scroll2, M, 1.35, TOPY + 0.45, 0, 0, 0, 2.4);
      put('trim', LG.finial, M, 0, TOPY + 1.12, 0); put('trim', LG.spike, M, 0, TOPY + 1.34, 0);
      // lanterna pendurada na ponta do braço
      const lx = ARM, ly = LAMPY;
      put('iron', LG.hook, M, lx, ly + 0.9, 0); put('iron', LG.hoodRim, M, lx, ly + 0.4, 0); put('iron', LG.hood, M, lx, ly + 0.66, 0);
      put('trim', LG.finial, M, lx, ly + 0.95, 0);
      put('glass', LG.glass, M, lx, ly, 0); put('glass', LG.glassIn, M, lx, ly - 0.02, 0);
      for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * Math.PI * 2; put('iron', LG.bar, M, lx + Math.cos(a) * 0.37, ly, Math.sin(a) * 0.37, Math.sin(a) * 0.17, 0, -Math.cos(a) * 0.17); }
      put('iron', LG.bottom, M, lx, ly - 0.5, 0); put('trim', LG.drop, M, lx, ly - 0.7, 0);
    }
    // put padrão (para quem não tem um): devolve a função e a lista "bake"
    function baker() { const bake = { base: [], iron: [], trim: [], glass: [] }, _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
      const put = (key, geo, M, x, y, z, rx, ry, rz) => { _l.compose(V3(x, y, z), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0)), V3(1, 1, 1)); const g = (geo.index ? geo.toNonIndexed() : geo.clone()); g.applyMatrix4(_m.copy(M).multiply(_l)); bake[key].push(g); };
      return { bake, put }; }
    function merge(bake, LM) { const out = [];
        Object.keys(bake).forEach(key => { const L2 = bake[key]; if (!L2.length) return; let n = 0; L2.forEach(g => { n += g.attributes.position.count; });
          const P = new Float32Array(n * 3), Nn = new Float32Array(n * 3), U = new Float32Array(n * 2); let o = 0;
          L2.forEach(g => { const c = g.attributes.position.count; if (!g.attributes.normal) g.computeVertexNormals(); P.set(g.attributes.position.array, o * 3); Nn.set(g.attributes.normal.array, o * 3);
            if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2); o += c; g.dispose(); });
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.computeBoundingSphere();
          const m = new THREE.Mesh(g, LM[key]); m.castShadow = key !== 'glass'; m.receiveShadow = true; if (key === 'glass') m.userData.noOutline = true; out.push(m); });
      return out; }
    return { ARM, TOPY, LAMPY, materials, geometries, place, baker, merge };
  })();

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
  // ARBUSTO (Bush): moita de folhagem com aparência natural, usada na beira da pista (plants) e no cenário (scenery.js)
  //  * miolo: 9 "tufos" de folhagem irregulares (ruído 3D deforma cada esfera), escuros por dentro e na base;
  //  * casca de folhas: ~110 cartões com cachos de folhas recortados (alphaTest) espalhados pela superfície, cada um
  //    virado para fora com inclinação e giro aleatórios -> silhueta rendada, folhas soltas, sem cara de bola de massinha;
  //  * normais apontando para fora do centro da moita: luz macia e volumosa (cartões não "piscam" com a luz);
  //  * cor por vértice: verde mais escuro e frio embaixo/dentro, pontas mais claras e amareladas no topo;
  //  * uma textura só (atlas 512x256: cacho recortado + folhagem densa) e UM material -> 1 chamada de desenho por lote.
  // ===================================================================================
  const Bush = (() => {
    let tex = null, geo = {}, srand = 1;
    const rr = () => { srand = (srand * 16807) % 2147483647; return srand / 2147483647; };
    // ruído 3D suave (valor) para deformar os tufos
    const hh = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
    const vn = (x, y, z) => { const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z); let a = x - i, b = y - j, c = z - k; a = a * a * (3 - 2 * a); b = b * b * (3 - 2 * b); c = c * c * (3 - 2 * c);
      const L = (p, q, t) => p + (q - p) * t;
      return L(L(L(hh(i, j, k), hh(i + 1, j, k), a), L(hh(i, j + 1, k), hh(i + 1, j + 1, k), a), b), L(L(hh(i, j, k + 1), hh(i + 1, j, k + 1), a), L(hh(i, j + 1, k + 1), hh(i + 1, j + 1, k + 1), a), b), c); };
    function texture() {
      if (tex) return tex; srand = 77;
      const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
      // folha: elipse pontuda com nervura; tons claros (a cor verde vem do vértice/instância, a textura dá forma e luz)
      const leaf = (x, y, len, wid, ang, lum) => { g.save(); g.translate(x, y); g.rotate(ang);
        const gr = g.createLinearGradient(0, -wid, 0, wid); const l1 = Math.round(lum * 255), l0 = Math.round(lum * 0.72 * 255);
        gr.addColorStop(0, `rgb(${l0},${l1},${l0})`); gr.addColorStop(0.5, `rgb(${l1},${l1},${Math.round(l1 * 0.9)})`); gr.addColorStop(1, `rgb(${Math.round(l0 * 0.85)},${l0},${Math.round(l0 * 0.8)})`);
        g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(len * 0.3, -wid, len * 0.75, -wid * 0.8, len, 0); g.bezierCurveTo(len * 0.75, wid * 0.8, len * 0.3, wid, 0, 0); g.fill();
        g.strokeStyle = `rgba(40,60,20,0.35)`; g.lineWidth = Math.max(1, wid * 0.12); g.beginPath(); g.moveTo(len * 0.05, 0); g.lineTo(len * 0.9, 0); g.stroke(); g.restore(); };
      // esquerda: cacho recortado (fundo transparente); galhinhos + folhas irradiando do centro
      g.clearRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(70,52,30,0.9)'; g.lineCap = 'round';
      for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283 + rr() * 0.5; g.lineWidth = 3; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70); g.stroke(); }
      for (let k = 0; k < 64; k++) { const a = rr() * 6.283, d = 18 + Math.sqrt(rr()) * 82, x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
        leaf(x, y, 30 + rr() * 26, 9 + rr() * 6, a + (rr() - 0.5) * 1.2, 0.62 + rr() * 0.38); }
      // direita: folhagem densa e opaca (miolo da moita), sem buracos
      g.fillStyle = 'rgb(105,120,90)'; g.fillRect(256, 0, 256, 256);
      for (let k = 0; k < 420; k++) leaf(256 + rr() * 256, rr() * 256, 18 + rr() * 22, 6 + rr() * 5, rr() * 6.283, 0.45 + rr() * 0.5);
      tex = new THREE.CanvasTexture(c); tex.anisotropy = 4; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
      return tex;
    }
    // q: 'hi' (beira da pista) ou 'lo' (cenário: menos folhas)
    function geometry(q) {
      q = q || 'hi'; if (geo[q]) return geo[q]; srand = 4242;
      const P = [], Nn = [], U = [], C = [], col = new THREE.Color(), ctr = new THREE.Vector3(0, 0.55, 0);
      const base = new THREE.Color(0x3f7f2c), dark = new THREE.Color(0x1f4a1c), tip = new THREE.Color(0x8fbf45);
      const shade = (p, k, out) => { const t = Math.max(0, Math.min(1, p.y / 1.55)), ao = 0.42 + 0.62 * t * t * (3 - 2 * t);
        out.copy(dark).lerp(base, Math.min(1, 0.25 + 0.95 * t)).lerp(tip, k * t * t).multiplyScalar(ao); return out; };
      const softN = (p, n) => { const r = p.clone().sub(ctr).normalize(); r.y = r.y * 0.8 + 0.25; return r.normalize().lerp(n, 0.35).normalize(); };
      // ---- miolo: tufos deformados ----
      const clumps = [[0, 0.72, 0, 0.82], [0, 1.18, 0.05, 0.55]];
      for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283 + rr() * 0.6, d = 0.62 + rr() * 0.22; clumps.push([Math.cos(a) * d, 0.48 + rr() * 0.2, Math.sin(a) * d, 0.5 + rr() * 0.18]); }
      clumps.push([0.35, 1.0, -0.4, 0.45]);
      clumps.forEach(([cx, cy, cz, r], ci) => {
        const g0 = new THREE.IcosahedronGeometry(r, q === 'hi' ? 2 : 1), p = g0.attributes.position, v = new THREE.Vector3(), nrm = new THREE.Vector3(), cc0 = new THREE.Vector3(cx, cy, cz);   // icosaedro já vem sem índice
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n1 = vn(v.x * 3.1 + ci * 7, v.y * 3.1, v.z * 3.1), n2 = vn(v.x * 7.3, v.y * 7.3 + ci, v.z * 7.3);
          v.multiplyScalar(1 + (n1 - 0.5) * 0.42 + (n2 - 0.5) * 0.16); v.y *= 0.82; v.x += cx; v.y += cy; v.z += cz; if (v.y < 0.02) v.y = 0.02 + (v.y - 0.02) * 0.2; p.setXYZ(i, v.x, v.y, v.z); }
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); nrm.copy(v).sub(cc0).normalize(); const n = softN(v, nrm);   // normal lisa (sem facetas)
          P.push(v.x, v.y, v.z); Nn.push(n.x, n.y, n.z);
          shade(v, 0.2, col).multiplyScalar(0.9); C.push(col.r, col.g, col.b); }   // miolo um pouco mais escuro: profundidade entre as folhas
        // UV do miolo por triângulo (projeção no eixo dominante, deslocada para caber na metade opaca do atlas): sem esticar
        for (let t = 0; t < p.count; t += 3) { const q3 = [0, 1, 2].map(j => [p.getX(t + j), p.getY(t + j), p.getZ(t + j)]);
          const e1 = q3[1].map((x, j) => x - q3[0][j]), e2 = q3[2].map((x, j) => x - q3[0][j]), fn = [Math.abs(e1[1] * e2[2] - e1[2] * e2[1]), Math.abs(e1[2] * e2[0] - e1[0] * e2[2]), Math.abs(e1[0] * e2[1] - e1[1] * e2[0])];
          const dom = fn[0] > fn[1] && fn[0] > fn[2] ? 0 : fn[1] > fn[2] ? 1 : 2, A = dom === 0 ? [2, 1] : dom === 1 ? [0, 2] : [0, 1], SC = 0.9;
          const uv = q3.map(v3 => [v3[A[0]] * SC, v3[A[1]] * SC]), mu = Math.floor(Math.min(...uv.map(a => a[0]))), mv = Math.floor(Math.min(...uv.map(a => a[1])));
          uv.forEach(a => U.push(0.505 + 0.49 * Math.min(1, (a[0] - mu) * 0.5), 0.01 + 0.98 * Math.min(1, (a[1] - mv) * 0.5))); }
        g0.dispose(); });
      // ---- casca de folhas: cartões com o cacho recortado ----
      const NL = q === 'hi' ? 170 : 90, up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), pt = new THREE.Vector3(), cn = [];
      for (let k = 0; k < NL; k++) {
        const cl = clumps[(rr() * clumps.length) | 0]; d.set(rr() * 2 - 1, rr() * 1.3 - 0.25, rr() * 2 - 1); if (d.lengthSq() < 0.05) d.set(0, 1, 0); d.normalize();
        pt.set(cl[0], cl[1], cl[2]).addScaledVector(d, cl[3] * (0.95 + rr() * 0.22)); pt.y *= 0.95; if (pt.y < 0.12) { k--; continue; }
        const out = pt.clone().sub(ctr).normalize().lerp(d, 0.5).normalize();
        // plano do cartão: normal ~ para fora, com inclinação e giro aleatórios
        const nrm = out.clone().add(new THREE.Vector3(rr() - 0.5, rr() - 0.5, rr() - 0.5).multiplyScalar(0.9)).normalize();
        t1.crossVectors(nrm, Math.abs(nrm.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize(); t2.crossVectors(nrm, t1).normalize();
        const rot = rr() * 6.283, cs = Math.cos(rot), sn = Math.sin(rot), a = t1.clone().multiplyScalar(cs).addScaledVector(t2, sn), b = t1.clone().multiplyScalar(-sn).addScaledVector(t2, cs);
        const sz = (0.4 + rr() * 0.22) * (q === 'hi' ? 1 : 1.2), c0 = pt.clone().addScaledVector(out, 0.06);
        const corners = [[-1, -1, 0, 0], [1, -1, 0.5, 0], [1, 1, 0.5, 1], [-1, 1, 0, 1]].map(([sx, sy, u, vv]) => ({ p: c0.clone().addScaledVector(a, sx * sz).addScaledVector(b, sy * sz), u: u * 0.98 + 0.005, v: vv }));
        const kTip = 0.5 + rr() * 0.6, vary = 0.88 + rr() * 0.24;
        [0, 1, 2, 0, 2, 3].forEach(i => { const cc = corners[i], n = softN(cc.p, out); P.push(cc.p.x, cc.p.y, cc.p.z); Nn.push(n.x, n.y, n.z); U.push(cc.u, cc.v);
          shade(cc.p, kTip, col).multiplyScalar(vary); C.push(col.r, col.g, col.b); });
      }
      // ---- galhinhos na base (aparecem entre as folhas de baixo) ----
      for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283 + rr(), g0 = new THREE.CylinderGeometry(0.025, 0.045, 0.55, 5).toNonIndexed(); g0.rotateZ(0.5 + rr() * 0.3); g0.rotateY(a); g0.translate(Math.cos(a) * 0.18, 0.22, -Math.sin(a) * 0.18);
        const p = g0.attributes.position, nn = g0.attributes.normal; for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); Nn.push(nn.getX(i), nn.getY(i), nn.getZ(i)); U.push(0.75, 0.5); C.push(0.3, 0.22, 0.14); } g0.dispose(); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.computeBoundingSphere();
      return (geo[q] = g);
    }
    // material da moita (Lambert vira toon quando criado dentro do Toon.during; o recorte das folhas vem do alphaTest)
    function material(wind) {
      // Lambert ORIGINAL (fora do toon): luz contínua nas folhas, sem as 3 faixas duras do desenho animado -> mais realista
      const Lam = (window.Toon && Toon.Lambert) || THREE.MeshLambertMaterial;
      const m = new Lam({ color: 0xffffff, vertexColors: true, map: texture(), alphaTest: 0.5, side: THREE.DoubleSide }); m.userData.noToon = true;
      if (wind !== false && window.GfxFX) GfxFX.foliage(m, { amp: 0.06, h0: 0.25, freq: 1.7 });
      return m;
    }
    // sombra com o recorte das folhas (sem quadrados no chão)
    let depthM = null;
    const depthMaterial = () => depthM || (depthM = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: texture(), alphaTest: 0.5, side: THREE.DoubleSide }));
    // ---- FOLHAS CAÍDAS (litter): as mesmas folhas da moita, soltas e deitadas na grama ----
    //  * atlas 4x2 com uma folha por célula, desenhada com o MESMO traço da moita (forma pontuda + nervura, tons claros:
    //    a cor vem do vértice, igual à moita -> mesmo verde);
    //  * tufo de ~2,8 m: folhas mais juntas no meio, cada uma dobrada na nervura (não fica papel chapado), quase deitadas;
    //  * ~1/4 das folhas um pouco amareladas/secas (folha que caiu há mais tempo).
    let ltex = null, lgeo = null, lmat = null;
    function litterTexture() {
      if (ltex) return ltex; srand = 991;
      const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d'); g.clearRect(0, 0, 256, 128);
      for (let k = 0; k < 8; k++) { const cx = (k % 4) * 64, cy = Math.floor(k / 4) * 64, len = 50 + rr() * 8, wid = 11 + rr() * 6, lum = 0.78 + rr() * 0.2, l1 = Math.round(lum * 255), l0 = Math.round(lum * 0.72 * 255);
        g.save(); g.translate(cx + 32 - len / 2, cy + 32); g.rotate((rr() - 0.5) * 0.12);
        const gr = g.createLinearGradient(0, -wid, 0, wid); gr.addColorStop(0, `rgb(${l0},${l1},${l0})`); gr.addColorStop(0.5, `rgb(${l1},${l1},${Math.round(l1 * 0.9)})`); gr.addColorStop(1, `rgb(${Math.round(l0 * 0.85)},${l0},${Math.round(l0 * 0.8)})`);
        g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(len * 0.3, -wid, len * 0.75, -wid * 0.8, len, 0); g.bezierCurveTo(len * 0.75, wid * 0.8, len * 0.3, wid, 0, 0); g.fill();
        g.strokeStyle = 'rgba(40,60,20,0.4)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(len * 0.02, 0); g.lineTo(len * 0.92, 0); g.stroke();
        for (let s = 1; s <= 4; s++) { const x = len * (0.15 + s * 0.16); g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + len * 0.09, -wid * 0.55); g.moveTo(x, 0); g.lineTo(x + len * 0.09, wid * 0.55); g.stroke(); }
        g.strokeStyle = 'rgba(70,52,30,0.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(-5, 0); g.stroke();   // talinho
        g.restore(); }
      // fundo transparente do canvas é PRETO: de longe (mipmaps) o preto vazava para a folha e ela virava um pontinho escuro.
      // Copia os pixels e pinta o fundo (alfa 0) com o tom médio da folha -> a borda nunca escurece.
      const id = g.getImageData(0, 0, 256, 128), px = id.data, out = new Uint8Array(px.length);
      for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) { const i = (y * 256 + x) * 4, o = ((127 - y) * 256 + x) * 4;   // vira na vertical (DataTexture não usa flipY)
        if (px[i + 3] < 128) { out[o] = 196; out[o + 1] = 214; out[o + 2] = 178; out[o + 3] = px[i + 3]; } else { out[o] = px[i]; out[o + 1] = px[i + 1]; out[o + 2] = px[i + 2]; out[o + 3] = px[i + 3]; } }
      ltex = new THREE.DataTexture(out, 256, 128, THREE.RGBAFormat); ltex.anisotropy = 4; ltex.generateMipmaps = true;
      ltex.minFilter = THREE.LinearMipmapLinearFilter; ltex.magFilter = THREE.LinearFilter; ltex.needsUpdate = true;
      return ltex;
    }
    function litterGeometry() {
      if (lgeo) return lgeo; srand = 5151;
      const P = [], Nn = [], U = [], C = [], col = new THREE.Color();
      const greens = [0x2a5e20, 0x336c25, 0x3f7f2c, 0x3f7f2c, 0x4a8a30, 0x5a9636, 0x8fbf45], dry = [0x9a9a3c, 0xa8903e, 0x8a7a34];   // tons da moita (sombra -> ponta)
      const NL = 48, R = 2.5;
      for (let k = 0; k < NL; k++) {
        const a = rr() * 6.283, d = R * Math.pow(rr(), 0.8), cx = Math.cos(a) * d, cz = Math.sin(a) * d;
        const L = 0.19 + rr() * 0.1, Wd = L * 0.36, yaw = rr() * 6.283, cy = Math.cos(yaw), sy = Math.sin(yaw);
        const tx = (rr() - 0.5) * 0.35, tz = (rr() - 0.5) * 0.35, fold = 0.012 + rr() * 0.02, y0 = 0.035 + k * 0.0015;   // inclinação, dobra na nervura, camadas
        const cell = (rr() * 8) | 0, u0 = (cell % 4) * 0.25, v0 = 1 - (Math.floor(cell / 4) + 1) * 0.5;
        const isDry = rr() < 0.18; col.set(isDry ? dry[(rr() * dry.length) | 0] : greens[(rr() * greens.length) | 0]).multiplyScalar(0.88 + rr() * 0.24);
        // local: x ao longo da folha (-L..L), z na largura (-Wd..Wd); nervura (z=0) levantada pela dobra
        const V = (lx, lz) => { const ly = y0 + fold * 0.5 + lx * tx + lz * tz; return [cx + lx * cy - lz * sy, ly, cz + lx * sy + lz * cy]; };
        const UVo = (lx, lz) => [u0 + (lx / L * 0.5 + 0.5) * 0.25, v0 + (lz / (Wd * 2.6) * 0.5 + 0.5) * 0.5];   // a folha ocupa ~80% x 40% da célula
        const wd = Wd * 1.3, q = [[-L, -wd], [L, -wd], [L, wd], [-L, wd]];   // 2 triângulos por folha (leve: tem MUITA folha no mapa)
        [0, 2, 1, 0, 3, 2].forEach(i => { const [lx, lz] = q[i]; P.push(...V(lx, lz)); U.push(...UVo(lx, lz)); Nn.push(0, 1, 0); C.push(col.r, col.g, col.b); });
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.computeBoundingSphere();
      return (lgeo = g);
    }
    function litterMaterial() {
      if (lmat) return lmat;
      const Lam = (window.Toon && Toon.Lambert) || THREE.MeshLambertMaterial;
      lmat = new Lam({ color: 0xffffff, vertexColors: true, map: litterTexture(), alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      // NÃO grava profundidade: para os pós-efeitos (contorno, sombra de contato, desfoque) a folha é parte do chão.
      // Antes cada folha (5 cm acima da grama) ganhava contorno escuro e de longe a grama ficava cheia de pontos pretos.
      // Quem usa este material desenha DEPOIS do chão (renderOrder, no scenery.js), senão a grama cobriria as folhas.
      lmat.depthWrite = false;
      lmat.userData.noToon = true; lmat.extensions = { derivatives: true };
      // de longe as versões menores da textura (mipmaps) "lavam" o recorte e a folha sumia no alphaTest:
      // compensa o alfa pelo nível de mip (quanto mais longe, mais opaca) -> folha continua visível de longe
      GfxFX.chain(lmat, 'litter-mipalpha', sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `#ifdef USE_MAP
          { vec2 tc = vUv * vec2(256.0, 128.0); float lod = max(0.0, 0.5 * log2(max(dot(dFdx(tc), dFdx(tc)), dot(dFdy(tc), dFdy(tc)))));
            diffuseColor.a *= 1.0 + lod * 0.3; }
          #endif
          #include <alphatest_fragment>`); });
      return lmat;
    }
    return { texture, geometry, material, depthMaterial, litterGeometry, litterMaterial };
  })();
  window.Bush = Bush;

  // ===================================================================================
  function build(def, scene) {
    const L = layout(def), S = L.S, T = L.T, W = def.W; N = def.N || 500;
    const CB = 3.6;   // largura da zebra (era 1,8: dobrou)
    // chão e mar cobrem a pista + o alcance da névoa em qualquer direção (antes: placa fixa de 3 km, a borda aparecia nas pistas maiores)
    const EXT = Math.max(Math.abs(L.bbox.x0), Math.abs(L.bbox.x1), Math.abs(L.bbox.z0), Math.abs(L.bbox.z1));
    const GS = Math.ceil((EXT + (def.fogFar || 820) + 400) * 2 / 100) * 100, RAD = Math.max(L.bbox.x1 - L.bbox.x0, L.bbox.z1 - L.bbox.z0) / 2;
    let seed = 7 + def.id.length * 13; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const tr = { def, N, W, CB, S, T, length: L.length, startIdx: def.startIdx, roadBase: 0.1, lamps: [], nightMats: [], animated: [], obstacles: [], ponds: [], minimap: [], blockers: [], dustColor: 0xc9a878 };
    // ---------- qualidade gráfica (configurações) ----------
    // detail: geometria/enfeites desta pista (vale ao carregar); water: reflexo e refração da água (vale na hora)
    const QS = () => (window.Settings && Settings.q) ? Settings.q() : { water: 'high', detail: 'high' };
    const DET = QS().detail, LO = DET === 'low', MID = DET === 'medium', LIFEK = LO ? 0.4 : MID ? 0.7 : 1;
    tr.disposers = []; tr.dispose = () => { tr.disposers.forEach(f => { try { f(); } catch (e) { } }); tr.disposers = []; };   // chamado pelo main.js ao trocar de pista
    const side = tr.side = (i, o, y) => { i = ((i % N) + N) % N; return V3(S[i].x + T[i].z * o, y, S[i].z - T[i].x * o); };
    // pontes: elevação suave da pista (aceita índice fracionário)
    const bridges = def.bridges || [];
    // ponte: 3,4 m de altura, tabuleiro plano em ±6 nós e rampas suaves até ±18 nós (~75 m de cada lado)
    const BR = tr.BR = { H: 3.4, FLAT: 6, END: 18, RAIL: W + CB - 0.3 };   // guarda-corpo na beira do tabuleiro, depois da zebra
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
    // altura do chão do atalho (terra + barranco de grama), a mesma grade que é desenhada; null fora dela
    tr.shortcutGround = (x, z) => { let h = null;
      for (const sc of tr.shortcuts) { const G = sc.grid; if (!G) continue; const fx = (x - G.x0) / G.cs, fz = (z - G.z0) / G.cs, i = Math.floor(fx), j = Math.floor(fz);
        if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) continue; const a = j * (G.nx + 1) + i, Y = G.Y, y00 = Y[a], y10 = Y[a + 1], y01 = Y[a + G.nx + 1], y11 = Y[a + G.nx + 2];
        if (y00 !== y00 || y10 !== y10 || y01 !== y01 || y11 !== y11) continue; const u = fx - i, v = fz - j, y = (y00 * (1 - u) + y10 * u) * (1 - v) + (y01 * (1 - u) + y11 * u) * v;
        if (h === null || y > h) h = y; }
      return h; };
    tr.dirtAt = p => tr.shortcuts.length > 0 && shortcutDist(p.x, p.z) < 0.6;           // terra batida: o kart perde pouco (kart.js)
    tr.clearAt = (x, z) => tr.shortcuts.length > 0 && (shortcutDist(x, z) < 7 || (tr.shortcutGround(x, z) !== null && tr.shortcutGround(x, z) > (tr.heightAt ? tr.heightAt(x, z) : 0) + 0.35));   // nem enterrado no barranco           // cenário (scenery.js) não nasce em cima do atalho

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
        for (let c = 0; c <= nx; c++) { const f = c / nx, off = a + (b - a) * f, p = side(k, off, y + (o.prof ? o.prof(o.flipU ? 1 - f : f) : 0) + (o.flat ? H[k] : hAt(k))); pos.push(p.x, p.y, p.z);
          uv.push((o.flipU ? 1 - f : f) * o.uSpan, LACC[i] / o.vLen);
          const v = o.col ? o.col(k, f) : 1; if (typeof v === 'number') cc.setRGB(v, v, v); else cc.setRGB(v[0], v[1], v[2]); col.push(cc.r, cc.g, cc.b); } }
      for (let i = 0; i < N; i++) { if (o.skip && o.skip(i)) continue; for (let c = 0; c < nx; c++) { const p0 = i * C + c, p1 = p0 + C; idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      if (o.map) GfxFX.aniso(o.map, o.antiTile ? 16 : 8);
      const m = o.bump ? (() => { const bm = TX.get(o.bump); bm.encoding = THREE.LinearEncoding; const mm = new PHONG_ORIG({ vertexColors: true, side: THREE.DoubleSide, map: o.map, bumpMap: bm, bumpScale: o.bumpScale || 0.05, shininess: 14, specular: 0x1a1a1a }); mm.userData.noToon = true; mm.userData.unique = true; return mm; })()
        : o.phong ? new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide, map: o.map, shininess: o.phong.shininess, specular: o.phong.specular })
        : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: o.map });
      if (o.antiTile) GfxFX.antiTile(m, o.antiTile);
      if (o.roadFx) roadFx(m);
      if (o.alphaTest) m.alphaTest = o.alphaTest;
      if (o.opacity != null) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
      // opacidade variada ao longo da pista: trechos de ~5 m com opacidade sorteada entre opVar[0] e opVar[1] (o máximo é
      // m.opacity), com transição suave entre um trecho e o outro. O recorte do desgaste (alphaTest) continua igual.
      if (o.opVar) { const lo = (o.opVar[0] / o.opVar[1]).toFixed(3), seg = (o.vLen / 5).toFixed(2), sd = (o.seed || 0).toFixed(2);
        m.customProgramCacheKey = () => 'roadline-opvar-' + lo + '-' + seg + '-' + sd;
        m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          { float y = vUv.y * ${seg} + ${sd}, i = floor(y), f = smoothstep(0.75, 1.0, fract(y));
            float a0 = fract(sin(i * 91.7 + 3.1) * 43758.55), a1 = fract(sin((i + 1.0) * 91.7 + 3.1) * 43758.55);
            diffuseColor.a *= mix(${lo}, 1.0, mix(a0, a1, f)); }`); }; }
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
    const grassTone = m => GfxFX.grassTone(m);   // mesma grama no jogo e no lobby (GfxFX.grassTone)
    // montanhas: material procedural (sem textura esticada). Rocha com camadas e rachaduras em várias escalas,
    // grama nas partes baixas e pouco inclinadas, neve no topo dos picos altos (acumula mais nas faces planas),
    // relevo fino na iluminação (bump) e luz por pixel. Cor do vértice: r = altura relativa 0..1, g = tem neve, b = domo.
    // ruído 3D suave (valor) para deformar a geometria das montanhas
    const vh3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
    const vn3 = (x, y, z) => { const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z); let fx = x - i, fy = y - j, fz = z - k;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz); const L = (a, b, t) => a + (b - a) * t;
      return L(L(L(vh3(i, j, k), vh3(i + 1, j, k), fx), L(vh3(i, j + 1, k), vh3(i + 1, j + 1, k), fx), fy), L(L(vh3(i, j, k + 1), vh3(i + 1, j, k + 1), fx), L(vh3(i, j + 1, k + 1), vh3(i + 1, j + 1, k + 1), fx), fy), fz); };
    function mountainMat() {
      // iluminação suave (Phong de verdade, fora do toon): a rocha tem relevo contínuo, e os 3 degraus do toon recortavam
      // cada ondulação em faixas duras quando a câmera chegava perto
      const m = new PHONG_ORIG({ vertexColors: true, shininess: 4, specular: 0x060606 });   // quase sem brilho: rocha é fosca (o brilho dava cara de massinha)
      m.userData.unique = true; m.userData.noToon = true; m.customProgramCacheKey = () => 'mountain-proc-v5' + (LO ? '-lite' : '');
      if (!mountainMat.logged) { mountainMat.logged = true; console.info(m.isMeshToonMaterial ? '[montanhas] ainda em toon (o Toon.during converteu depois): mande o js/toon.js' : '[montanhas] iluminação suave (fora do toon)'); }
      m.onBeforeCompile = sh => {
        sh.vertexShader = 'varying vec3 vMW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vMW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = `varying vec3 vMW;
          float mh3(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
          vec3 mh33(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
          float mn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(mh3(i), mh3(i + vec3(1,0,0)), f.x), mix(mh3(i + vec3(0,1,0)), mh3(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(mh3(i + vec3(0,0,1)), mh3(i + vec3(1,0,1)), f.x), mix(mh3(i + vec3(0,1,1)), mh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
          float mfbm(vec3 p){ return mn3(p) * 0.5 + mn3(p * 2.03 + 1.7) * 0.25 + mn3(p * 4.11 + 3.1) * 0.15 + mn3(p * 8.3 + 5.3) * 0.1; }
          // células (Voronoi 3D): cada célula é uma "placa" de rocha com a face levemente virada para um lado.
          // devolve F1, F2 e a célula vencedora -> placas facetadas com fendas entre elas (rocha de verdade, sem riscos)
          void mCell(vec3 p, out float f1, out float f2, out vec3 id){ vec3 i = floor(p), f = fract(p); f1 = 8.0; f2 = 8.0; id = i;
            for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec3 o = vec3(float(x), float(y), float(z)), c = i + o;
              vec3 d = o + 0.15 + 0.7 * mh33(c) - f; float q = dot(d, d);
              if (q < f1) { f2 = f1; f1 = q; id = c; } else if (q < f2) f2 = q; }
            f1 = sqrt(f1); f2 = sqrt(f2); }
          ` + sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // ===== montanha procedural: placas de rocha facetadas =====
            vec3 P = vMW; float dist = length(cameraPosition - P);
            float fm = 1.0 - smoothstep(900.0, 2200.0, dist), fd = ${LO ? '0.0' : '1.0 - smoothstep(80.0, 450.0, dist)'};
            vec3 wn0 = inverseTransformDirection(normal, viewMatrix);
            float up = wn0.y, hr = vColor.r, tall = vColor.g, dome = vColor.b;
            float n1 = mfbm(P * 0.011), n2 = mfbm(P * 0.047 + 7.0), n3 = mix(0.5, mn3(P * 0.42), fd);
            // máscaras (com a normal lisa: sem tremer com as facetas)
            float jag = (n2 - 0.5) * 0.3 + (n3 - 0.5) * 0.12;
            float gU = smoothstep(0.62 - 0.2 * dome, 0.82 - 0.2 * dome, up + jag);
            float gH = 1.0 - smoothstep(0.3 + 0.5 * dome, 0.55 + 0.5 * dome, hr + jag * 0.6);
            float gr = max(gU * gH, 1.0 - smoothstep(0.04, 0.16, hr + jag * 0.3));
            float sn = tall * smoothstep(0.55, 0.63, hr + (n1 - 0.5) * 0.16 + (up - 0.55) * 0.32 + (n3 - 0.5) * 0.05);
            float rk = (1.0 - gr) * (1.0 - 0.75 * sn);          // quanto de "rocha exposta" tem no ponto
            vec3 wn = wn0; float crev = 0.0, tone = 0.5, rim = 0.0, fine = 0.0;
            ${LO ? '' : `{
              // placas grandes (~22 m), achatadas na vertical (camadas), e placas pequenas (~7 m) só de perto
              // posição "torcida" por ruído: as placas perdem o formato de ladrilho e viram lascas irregulares;
              // achatadas na vertical (bem mais largas que altas) -> parecem camadas/saliências de penhasco
              vec3 wq = vec3(mn3(P * 0.021), mn3(P * 0.021 + 4.3), mn3(P * 0.021 + 8.7)) - 0.5;
              float a1, a2; vec3 id; mCell(P * vec3(0.03, 0.085, 0.03) + wq * 1.8, a1, a2, id);
              vec3 r = mh33(id + 17.0) * 2.0 - 1.0; tone = mh3(id + 3.0);
              wn = normalize(wn0 + (r - dot(r, wn0) * wn0) * 0.42 * rk * fm);
              // fendas finas e só em parte das bordas (rocha real não tem contorno em toda placa)
              crev = (1.0 - smoothstep(0.0, mix(0.07, 0.035, fm), a2 - a1)) * smoothstep(0.35, 0.65, mn3(P * 0.035 + 2.0));
              if (fd > 0.001) { float b1, b2; vec3 id2; mCell(P * vec3(0.11, 0.24, 0.11) + wq * 2.5 + 5.0, b1, b2, id2);
                vec3 r2 = mh33(id2 + 41.0) * 2.0 - 1.0; wn = normalize(wn + (r2 - dot(r2, wn) * wn) * 0.2 * rk * fd);
                crev = max(crev, (1.0 - smoothstep(0.0, 0.05, b2 - b1)) * 0.45 * fd * smoothstep(0.4, 0.7, mn3(P * 0.09 + 6.0))); tone = mix(tone, mh3(id2), 0.25 * fd);
                // borda lascada: logo ao lado da fenda a quina da placa pega luz (relevo de verdade)
                rim = smoothstep(0.03, 0.09, b2 - b1) * (1.0 - smoothstep(0.09, 0.2, b2 - b1)) * fd;
                // terceiro nível: lascas pequenas (~2,5 m) bem de perto
                float fc = 1.0 - smoothstep(40.0, 140.0, dist);
                if (fc > 0.001) { float c1, c2; vec3 id3; mCell(P * vec3(0.32, 0.6, 0.32) + wq * 3.0 + 11.0, c1, c2, id3);
                  vec3 r3 = mh33(id3 + 63.0) * 2.0 - 1.0; wn = normalize(wn + (r3 - dot(r3, wn) * wn) * 0.24 * rk * fc);
                  crev = max(crev, (1.0 - smoothstep(0.0, 0.045, c2 - c1)) * 0.6 * fc); tone = mix(tone, mh3(id3 + 9.0), 0.35 * fc);
                  rim = max(rim, smoothstep(0.02, 0.06, c2 - c1) * (1.0 - smoothstep(0.06, 0.13, c2 - c1)) * 0.9 * fc); }
                // grão da pedra (micro-relevo) muito de perto
                fine = (mn3(P * 3.1) - 0.5) * 0.7 + (mn3(P * 9.0 + 2.0) - 0.5) * 0.3;
                wn = normalize(wn + vec3(mn3(P * 2.3) - 0.5, 0.0, mn3(P * 2.3 + 5.0) - 0.5) * 0.18 * rk * fc); }
            }`}
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
            // rocha: cinza-pedra com variação por placa, camadas suaves, líquen nas partes mais planas
            vec3 rock = mix(vec3(0.45, 0.43, 0.41), vec3(0.6, 0.575, 0.54), clamp(n2 * 0.7 + (n1 - 0.5) * 0.4 + (tone - 0.5) * 0.22, 0.0, 1.0));
            rock = mix(rock, vec3(0.58, 0.51, 0.43), smoothstep(0.58, 0.85, n1) * 0.22);
            rock *= 0.92 + 0.16 * n3;
            float st = sin(P.y * 0.35 + n1 * 7.0);
            rock *= 1.0 + 0.05 * st;
            rock = mix(rock, vec3(0.44, 0.5, 0.31), smoothstep(0.65, 0.84, n2) * 0.3 * smoothstep(0.3, 0.75, up));
            // camadas sedimentares finas (linhas horizontais irregulares) e veios claros
            float strata = smoothstep(0.82, 0.97, sin(P.y * 1.6 + n1 * 11.0 + mn3(P * 0.2) * 3.0) * 0.5 + 0.5);
            rock = mix(rock, rock * vec3(0.86, 0.84, 0.8), strata * 0.5);
            rock = mix(rock, vec3(0.72, 0.7, 0.66), smoothstep(0.93, 0.99, mn3(P * vec3(0.4, 0.06, 0.4) + 3.0)) * 0.4);
            // escorridos de umidade/minério descendo das fendas (riscos verticais escuros e ferrugem)
            float drip = smoothstep(0.62, 0.9, mn3(vec3(P.x * 0.9, P.y * 0.05, P.z * 0.9))) * smoothstep(0.2, 0.7, 1.0 - up);
            rock = mix(rock, rock * vec3(0.66, 0.62, 0.58), drip * 0.55);
            rock = mix(rock, vec3(0.52, 0.36, 0.24), drip * smoothstep(0.6, 0.8, n2) * 0.25);
            // líquen em manchinhas (amarelo-esverdeado e cinza-claro) nas faces viradas para cima
            float lich = smoothstep(0.68, 0.78, mn3(P * 0.9 + 4.0)) * smoothstep(0.2, 0.6, up);
            rock = mix(rock, mix(vec3(0.62, 0.64, 0.38), vec3(0.74, 0.74, 0.68), step(0.5, mn3(P * 0.31))), lich * 0.45);
            rock *= 1.0 + fine * 0.26;                                       // grão
            rock *= 0.9 + 0.2 * tone;                                        // cada lasca com um tom próprio
            ${LO ? '' : `{ // de perto: poros, pintas de mineral e manchas dentro de cada lasca (a placa não fica lisa)
              float fcc = 1.0 - smoothstep(30.0, 120.0, dist);
              float pit = smoothstep(0.7, 0.92, mn3(P * 6.5)) * fcc, spk = smoothstep(0.74, 0.95, mn3(P * 11.0 + 7.0)) * fcc;   // bordas macias (não parecem adesivos)
              float mot = (mn3(P * 1.3 + 9.0) - 0.5) * fcc;
              rock *= 1.0 - 0.22 * pit; rock = mix(rock, vec3(0.78, 0.76, 0.72), spk * 0.2); rock *= 1.0 + mot * 0.3;
              rock = mix(rock, vec3(dot(rock, vec3(0.333))), 0.12 * fcc); }`}
            rock = mix(rock, rock * 1.25 + 0.04, rim * 0.5);                 // quina lascada pega luz
            rock *= 1.0 - 0.55 * crev;                                       // fendas entre as placas (mais fundas)
            rock = mix(rock, rock * 0.55, crev * crev * 0.5);
            vec3 grass = mix(vec3(0.25, 0.39, 0.15), vec3(0.40, 0.52, 0.22), n2);
            grass = mix(grass, vec3(0.53, 0.5, 0.28), smoothstep(0.62, 0.86, n1) * 0.45) * (0.9 + 0.18 * n3);
            vec3 scree = vec3(0.56, 0.51, 0.43) * (0.85 + 0.25 * n3);
            float sc = smoothstep(0.42, 0.62, up + jag) * (1.0 - gr);
            vec3 col = mix(rock, scree, sc * 0.5);
            col = mix(col, grass, gr);
            vec3 snow = vec3(0.93, 0.95, 1.0) * (0.93 + 0.07 * n3); snow = mix(snow * vec3(0.82, 0.88, 1.0), snow, smoothstep(0.25, 0.8, up));
            snow *= 1.0 - 0.18 * crev;
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
      if (kind === 'bush') {   // moita nova (Bush): folhagem recortada, 1 material, sombra com o recorte das folhas
        const im = new THREE.InstancedMesh(Bush.geometry('hi'), Bush.material(), list.length), d = new THREE.Object3D(), c = new THREE.Color();
        list.forEach((o, i) => { d.position.set(o.x, (o.y || 0) + 0.1, o.z); d.rotation.set(0, o.r, 0); d.scale.set(o.s * (0.95 + rnd() * 0.2), o.s * (0.85 + rnd() * 0.25), o.s * (0.95 + rnd() * 0.2)); d.updateMatrix(); im.setMatrixAt(i, d.matrix);
          im.setColorAt(i, c.setHSL(0.24 + rnd() * 0.07, 0.3 + rnd() * 0.2, 0.86 + rnd() * 0.12)); tr.blockers.push({ x: o.x, y: (o.y || 0) + 0.8 * o.s, z: o.z, r: 1.3 * o.s });
          (tr.leafSpots = tr.leafSpots || []).push({ x: o.x, z: o.z, s: o.s }); });   // scenery.js espalha folhas caídas em volta
        im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = Bush.depthMaterial(); im.userData.noOutline = true; im.frustumCulled = false; return add(im);
      }
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
    // pinheiros detalhados (js/pines.js): 4 modelos numa malha só, cada árvore escolhe o seu pela posição.
    // 1 chamada de desenho para todos (+ a sombra, que respeita o modelo de cada árvore). k = escala extra.
    // pinheiros detalhados (js/pines.js) da beira da pista, bosques e morro:
    //  * menos árvores e maiores: fica ~45% da lista (sorteio estável pela posição);
    //  * blocos de 800 m com esfera própria: o que está fora da câmera não é desenhado (nem na sombra);
    //  * bloco perto da câmera (< 250 m): um InstancedMesh por modelo (só os vértices do próprio modelo);
    //    bloco longe: versão leve com os 4 modelos juntos (1 chamada) e sem sombra. Troca a cada 0,3 s.
    function pineForest(list, k) {
      if (!list.length) return null;
      if (!window.Pines) return plants('pine', list, 0x2a7a3a);
      k = k || 1;
      const keep = list.filter(o => { const h = Math.sin(o.x * 7.31 + o.z * 3.17) * 9137.1; return h - Math.floor(h) < 0.45; });
      const CELL = 800, cells = new Map();
      keep.forEach(o => { const key = Math.floor(o.x / CELL) + ',' + Math.floor(o.z / CELL); if (!cells.has(key)) cells.set(key, []); cells.get(key).push(o); });
      const mat = Pines.material(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true })), dm = Pines.depthMaterial(), d = new THREE.Object3D(), groups = [];
      cells.forEach(L => {
        let cx = 0, cz = 0; L.forEach(o => { cx += o.x; cz += o.z; }); cx /= L.length; cz /= L.length;
        const vars = L.map(o => Pines.variantAt(o.x, o.z)), sc = L.map(o => o.s * k);
        let R = 0; L.forEach((o, i) => { R = Math.max(R, Math.hypot(o.x - cx, o.z - cz) + Pines.HEIGHT[vars[i]] * sc[i]); });
        const mk = (geo, idx, shadow) => { const im = new THREE.InstancedMesh(geo, mat, idx.length);
          idx.forEach((i, n) => { const o = L[i]; d.position.set(o.x - cx, o.y || 0, o.z - cz); d.rotation.set(0, o.r, 0); d.scale.setScalar(sc[i]); d.updateMatrix(); im.setMatrixAt(n, d.matrix); });
          im.instanceMatrix.needsUpdate = true; geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 8, 0), R + 10);
          im.position.set(cx, 0, cz); im.castShadow = shadow; im.receiveShadow = true; im.customDepthMaterial = dm; im.userData.noOutline = true; return add(im); };
        const hi = [0, 1, 2, 3].map(v => { const idx = []; vars.forEach((x, i) => { if (x === v) idx.push(i); }); return idx.length ? mk(Pines.attach(Pines.single('hi', v), idx.map(() => v)), idx, true) : null; }).filter(Boolean);
        const lo = mk(Pines.attach(Pines.geometry('lo'), vars), vars.map((_, i) => i), false); lo.visible = false;
        groups.push({ cx, cz, R, hi, lo });
        L.forEach((o, i) => { const hh = Pines.HEIGHT[vars[i]] * sc[i]; tr.blockers.push({ x: o.x, y: (o.y || 0) + hh * 0.55, z: o.z, r: hh * 0.3 }); });
      });
      let acc = 0;
      tr.animated.push((t, dt) => { acc -= dt || 0.016; if (acc > 0) return; acc = 0.3;
        const cam = window.Fx && Fx.cam; if (!cam) return; const e = cam.matrixWorld.elements;
        for (const G of groups) { const near = Math.hypot(G.cx - e[12], G.cz - e[14]) - G.R < 250; G.hi.forEach(m => { m.visible = near; }); G.lo.visible = !near; } });
      return groups;
    }
    // ---------- SPRITES EM LOTE ----------
    // Antes cada brilho (poste, lampião, plataforma, rampa) e cada nuvem da cachoeira era um THREE.Sprite = 1 chamada de
    // desenho cada (~100 por quadro). Agora cada lote desenha TODOS numa chamada só (geometria instanciada). Quem usa
    // recebe um objeto com a mesma "cara" de um sprite: position, scale, material.color / opacity / rotation, userData,
    // visible. Os valores são enviados à placa de vídeo uma vez por quadro (tr.animated).
    // nearFade: some aos poucos quando a câmera chega perto (névoa da cachoeira: entrar nela sem a tela ficar branca).
    // Mistura normal só serve se todos tiverem a mesma cor (o resultado não depende da ordem); senão use additive.
    // névoa para efeitos que SOMAM luz (brilhos, cones, poças): a névoa só apaga a luz. O fog_fragment padrão mistura a cor
    // da névoa, e somado isso vira um borrão azulado no horizonte.
    const FOG_ADD = '#ifdef USE_FOG\n#ifdef FOG_EXP2\n  float fogFactor = 1.0 - exp(- fogDensity * fogDensity * fogDepth * fogDepth);\n#else\n  float fogFactor = smoothstep(fogNear, fogFar, fogDepth);\n#endif\n  gl_FragColor.rgb *= 1.0 - fogFactor;\n#endif';
    const makeSpriteBatch = (o) => {
      const list = [];
      const spr = (col, sc, op) => { const q = { isBatchSprite: true, position: new THREE.Vector3(), scale: new THREE.Vector3(sc, sc, 1),
        material: { color: new THREE.Color(col), opacity: op === undefined ? 1 : op, rotation: 0 }, userData: {}, visible: true }; list.push(q); return q; };
      spr.list = list;
      spr.finish = () => {
        if (!list.length || spr.mesh) return; const n = list.length, base = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
        g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv); g.instanceCount = n;
        const aP = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), aS = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2),
          aC = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), aR = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
        [aP, aS, aC, aR].forEach(a => a.setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('iPos', aP); g.setAttribute('iScale', aS); g.setAttribute('iCol', aC); g.setAttribute('iRot', aR);
        const m = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: o.map }, uNearFade: { value: o.nearFade ? 1 : 0 } }]),
          vertexShader: ['attribute vec3 iPos; attribute vec2 iScale; attribute vec4 iCol; attribute float iRot;', 'uniform float uNearFade;', 'varying vec2 vUv; varying vec4 vCol;', '#include <fog_pars_vertex>',
            'void main() {', '  vUv = uv; vCol = iCol;', '  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);',
            '  vec2 q = position.xy * iScale; float c = cos(iRot), s = sin(iRot); mvPosition.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);',
            '  if (uNearFade > 0.5) { float d = length(mvPosition.xyz) - iScale.x * 0.35, f = clamp((d - 2.0) / 14.0, 0.0, 1.0); vCol.a *= f * f * (3.0 - 2.0 * f); }',
            '  gl_Position = projectionMatrix * mvPosition;', '  #include <fog_vertex>', '}'].join('\n'),
          fragmentShader: ['uniform sampler2D map;', 'varying vec2 vUv; varying vec4 vCol;', '#include <fog_pars_fragment>',
            'void main() {', '  vec4 t = texture2D(map, vUv); gl_FragColor = vec4(vCol.rgb * t.rgb, t.a * vCol.a);', '  if (gl_FragColor.a < 0.002) discard;', o.additive ? FOG_ADD : '  #include <fog_fragment>', '}'].join('\n'),
          transparent: true, depthWrite: false, fog: true, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
        m.userData.unique = true;
        const mesh = spr.mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = o.order || 0;
        mesh.userData.dynamic = true; mesh.userData.noOutline = true; mesh.castShadow = mesh.receiveShadow = false; add(mesh);
        const up = () => { const P = aP.array, S = aS.array, C = aC.array, R = aR.array;
          for (let i = 0; i < n; i++) { const q = list[i], on = q.visible !== false;
            P[i * 3] = q.position.x; P[i * 3 + 1] = q.position.y; P[i * 3 + 2] = q.position.z;
            S[i * 2] = on ? q.scale.x : 0; S[i * 2 + 1] = on ? q.scale.y : 0;
            const cc = q.material.color; C[i * 4] = cc.r; C[i * 4 + 1] = cc.g; C[i * 4 + 2] = cc.b; C[i * 4 + 3] = on ? q.material.opacity : 0; R[i] = q.material.rotation || 0; }
          aP.needsUpdate = aS.needsUpdate = aC.needsUpdate = aR.needsUpdate = true; };
        up(); mesh.onBeforeRender = up;   // envia o estado mais recente (depois de todas as atualizações do quadro)
      };
      return spr;
    };
    const glowSpr = makeSpriteBatch({ map: Fx.glowTex(), additive: true, order: 0 });

    // ---------- pista: asfalto, faixas, zebras ----------
    const notBridge = i => bump(i) > 0.02 || bump((i + 1) % N) > 0.02;
    const asphaltTint = [1, 1, 1.02];
    strip(-W, W, 0.05, { nx: 16, map: TX.get('asphalt'), phong: { shininess: 30, specular: 0x26262a }, antiTile: LO ? null : { scale: 0.41, blend: 0.45, macro: 0.07 }, roadFx: !LO, uSpan: 2 * W / 7, vLen: 7, col: (i, f) => { const v = 1 - 0.1 * Math.exp(-Math.pow((f - 0.5) / 0.2, 2)) + 0.04 * Math.sin(i * 0.21) * Math.sin(i * 0.057) + 0.04 * Math.pow(Math.abs(f - 0.5) * 2, 6); return asphaltTint.map(k => v * k); } });
    // faixas pintadas mais grossas (bordas 0,9 m, tracejado 0,8 m), tinta com desgaste variado (TX 'roadLine' + alphaTest)
    [-1, 1].forEach(s => strip(s * (W - 1.35), s * (W - 0.45), 0.06, { map: TX.get('roadLine'), uSpan: 1, vLen: 24, po: -2, alphaTest: 0.35, opacity: 0.85, opVar: [0.62, 0.85], seed: s < 0 ? 7.3 : 0, flipU: s < 0 }));
    strip(-0.4, 0.4, 0.09, { map: TX.get('roadLine'), uSpan: 1, vLen: 24, po: -2, alphaTest: 0.35, opacity: 0.85, opVar: [0.62, 0.85], seed: 13.7, skip: i => !((Math.floor(i / 3) % 2)) });
    // zebra com relevo: sobe da beira do asfalto (rampinha), fica alta nos blocos e desce na borda de fora
    const curbProf = u => u < 0.03 ? 0 : u < 0.12 ? 0.1 * (u - 0.03) / 0.09 : u < 0.88 ? 0.1 + 0.015 * Math.sin((u - 0.12) / 0.76 * Math.PI) : 0.1 - 0.09 * (u - 0.88) / 0.12;   // mais alta e levemente abaulada
    strip(W, W + CB, 0.085, { nx: 14, map: TX.get('curb'), bump: 'curbBump', bumpScale: 0.09, uSpan: 1, vLen: 4, prof: curbProf }); strip(-W - CB, -W, 0.085, { nx: 14, map: TX.get('curb'), bump: 'curbBump', bumpScale: 0.09, uSpan: 1, vLen: 4, flipU: true, prof: curbProf });
    strip(W + CB, W + CB + 3.4, 0.035, { map: GfxFX.aniso(TX.get('trailSide'), 16), uSpan: 1, vLen: 5, alphaTest: 0.5, skip: i => notBridge(i), flat: true });
    strip(-W - CB - 3.4, -W - CB, 0.035, { map: GfxFX.aniso(TX.get('trailSide'), 16), uSpan: 1, vLen: 5, alphaTest: 0.5, skip: i => notBridge(i), flat: true, flipU: true });

    // ---------- linha de largada + pórtico ----------
    const si = def.startIdx, sAng = Math.atan2(T[si].x, T[si].z);
    // LINHA DE CHEGADA: faixa de tinta grossa com relevo (placa fina de 3,5 cm com quina), 3 fileiras de quadriculado
    // preto/branco entre dois filetes brancos, tinta inteira (sem desgaste). Cor + mapa de relevo (Phong fora do toon):
    // cada quadrado pega luz na borda.
    { const LW = W * 2, LD = 2.8, CW = 2048, CH = Math.max(64, Math.round(CW * LD / LW)), rows = 3, edge = 0.16, sq = (LD - 2 * edge) / rows, cols = Math.max(8, Math.round(LW / sq));
      const R = (() => { let z = 4242; return () => (z = (z * 16807) % 2147483647) / 2147483647; })();
      const mk = (f, lin) => { const c = document.createElement('canvas'); c.width = CW; c.height = CH; f(c.getContext('2d'), CW, CH); const t = new THREE.CanvasTexture(c); t.anisotropy = 8; if (!lin) t.encoding = THREE.sRGBEncoding; return t; };
      const pxm = CW / LW;
      const draw = bump => (g, w, h) => {
        g.fillStyle = bump ? '#202020' : '#5b5574'; g.fillRect(0, 0, w, h);                                                    // asfalto em volta (onde a tinta falta)
        const ep = edge * pxm, sp = sq * pxm, cp = w / cols;
        g.fillStyle = bump ? '#c8c8c8' : '#f3f1ea'; g.fillRect(0, 0, w, ep * 0.8); g.fillRect(0, h - ep * 0.8, w, ep * 0.8);       // filetes brancos
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = c * cp, y = ep + r * sp, white = (r + c) % 2 === 0;
          if (bump) { g.fillStyle = '#b4b4b4'; g.fillRect(x + 2, y + 2, cp - 4, sp - 4); g.fillStyle = '#d2d2d2'; g.fillRect(x + 6, y + 6, cp - 12, sp - 12); }   // quadrado com quina
          else { g.fillStyle = white ? '#f4f3ee' : '#141418'; g.fillRect(x, y, cp + 1, sp + 1); } }
      };
      const col = mk(draw(false)), bmp = mk(draw(true), true);
      const m = new PHONG_ORIG({ map: col, bumpMap: bmp, bumpScale: 0.06, shininess: 18, specular: 0x222222, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }); m.userData.noToon = true;
      const geo = new THREE.BoxGeometry(LW, 0.035, LD, 1, 1, 1);
      const line = new THREE.Mesh(geo, m); line.receiveShadow = true;
      const g = new THREE.Group(); g.add(line); g.position.set(S[si].x, 0.085 + 0.0175 + hAt(si), S[si].z); g.rotation.y = sAng; add(g); }
    // marcas do grid de largada
    const mPerNode = L.length / N; tr.gridNode = m => -Math.round(m / mPerNode);
    tr.grid = (CFG.GRID || [[10, -4], [17, 4]]).map(([m, lat]) => [tr.gridNode(m), lat]);
    { const gm = new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }), gg = new THREE.PlaneGeometry(3.6, 0.35);
      tr.grid.forEach(([di, lat]) => { const th = Math.atan2(T[(si + di + N) % N].x, T[(si + di + N) % N].z), p = side(si + di, lat, 0.075 + hAt((si + di + N) % N));
        const m = new THREE.Mesh(gg, gm); m.rotation.x = -Math.PI / 2; const g = new THREE.Group(); g.position.copy(p); g.rotation.y = th; m.position.z = 2.2; g.add(m); add(g); }); }
    // ---------- PÓRTICO DE LARGADA: dois postes de madeira + faixa de pano com a logo, com física de tecido ----------
    // Toras de madeira de verdade (casca com sulcos, nós, topo serrado com anéis) fincadas no chão, e lá no
    // alto uma corda esticada com a faixa amarrada por ilhoses. Tecido simulado (Verlet): a corda cede no meio e o pano
    // fica preso só nos ilhoses (entre eles ele "embarriga"), com vento em rajadas. Logo KARTEC em 2D (fonte Titan One).
    const arch = new THREE.Group(); arch.position.set(S[si].x, hAt(si), S[si].z); arch.rotation.y = sAng; add(arch);
    const AW = W + CB + 1.6;   // postes depois da zebra
    { const PH = 20, PR = 0.55,   // postes de 20 m: a faixa fica bem lá no alto
      rnd2 = (() => { let z = 99; return () => (z = (z * 16807) % 2147483647) / 2147483647; })();
      const canv = (w, h, f, lin) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 8; if (!lin) t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
      // casca: sulcos verticais escuros, placas claras, líquen e musgo perto do chão (cor + relevo)
      const barkDraw = bump => (g, w, h) => { g.fillStyle = bump ? '#808080' : '#8a6440'; g.fillRect(0, 0, w, h);
        for (let k = 0; k < 140; k++) { let x = rnd2() * w; const wd = 2 + rnd2() * 6; g.strokeStyle = bump ? '#202020' : 'rgba(52,32,16,.8)'; g.lineWidth = wd; g.beginPath(); g.moveTo(x, -20);
          for (let y = -20; y < h + 20; y += 24) { x += (rnd2() - 0.5) * 9; g.lineTo(x, y); } g.stroke(); }
        for (let k = 0; k < 260; k++) { const x = rnd2() * w, y = rnd2() * h, pw = 6 + rnd2() * 18, ph = 30 + rnd2() * 90, v = 90 + rnd2() * 60;
          g.fillStyle = bump ? `rgba(220,220,220,${0.25 + rnd2() * 0.3})` : `rgba(${v + 40},${v + 12},${v - 20},${0.18 + rnd2() * 0.25})`; g.beginPath(); g.ellipse(x, y, pw, ph, 0, 0, 7); g.fill(); }
        if (!bump) { for (let k = 0; k < 90; k++) { g.fillStyle = rnd2() < 0.5 ? 'rgba(150,160,120,.35)' : 'rgba(80,110,50,.3)'; g.beginPath(); g.arc(rnd2() * w, h * (0.75 + rnd2() * 0.25), 3 + rnd2() * 9, 0, 7); g.fill(); } } };
      const barkC = canv(256, 1024, barkDraw(false)), barkB = canv(256, 1024, barkDraw(true), true);
      const ringT = canv(256, 256, (g, w) => { g.fillStyle = '#c99c66'; g.fillRect(0, 0, w, w); for (let r = 4; r < w / 2; r += 5 + rnd2() * 4) { g.strokeStyle = `rgba(110,70,35,${0.35 + rnd2() * 0.3})`; g.lineWidth = 1.5 + rnd2() * 1.5; g.beginPath(); g.ellipse(w / 2 + rnd2() * 3, w / 2, r, r * 0.96, 0, 0, 7); g.stroke(); }
        g.strokeStyle = 'rgba(70,40,20,.6)'; g.lineWidth = 3; for (let k = 0; k < 4; k++) { const a = rnd2() * 7; g.beginPath(); g.moveTo(w / 2, w / 2); g.lineTo(w / 2 + Math.cos(a) * w * 0.4, w / 2 + Math.sin(a) * w * 0.4); g.stroke(); } });
      barkC.repeat.set(2, 4); barkB.repeat.set(2, 4);
      const woodM = new PHONG_ORIG({ map: barkC, bumpMap: barkB, bumpScale: 0.12, shininess: 4, specular: 0x0a0806, color: 0xffffff, emissive: 0x24180e }); woodM.userData.noToon = true;
      const endM = new THREE.MeshLambertMaterial({ map: ringT });
      const ropeM = new THREE.MeshLambertMaterial({ color: 0xcdb487 });
      // ---- postes ----
      [-1, 1].forEach(sd => { const x = sd * AW, post = new THREE.Group(); post.position.set(x, 0, 0); post.rotation.z = -sd * 0.025; arch.add(post);
        const g = new THREE.CylinderGeometry(PR * 0.82, PR * 1.08, PH, 22, 40), pp = g.attributes.position;
        for (let i = 0; i < pp.count; i++) { const y = pp.getY(i), yy = y + PH / 2, a = Math.atan2(pp.getZ(i), pp.getX(i));
          let k = 1 + 0.04 * Math.sin(a * 9 + yy * 0.4) + 0.03 * Math.sin(a * 2 + yy * 0.9 + sd) - 0.05 * Math.pow(Math.max(0, Math.cos(a * 11 + yy * 0.15)), 8);   // sulcos da casca
          k += 0.18 * Math.exp(-((yy - PH * 0.42) ** 2) * 4 - ((a - 1.3) ** 2) * 6) + 0.12 * Math.exp(-((yy - PH * 0.7) ** 2) * 5 - ((a + 2.0) ** 2) * 6);          // nós
          if (Math.abs(y) < PH / 2 - 0.01) { pp.setX(i, pp.getX(i) * k + Math.sin(yy * 0.22 + sd) * 0.12); pp.setZ(i, pp.getZ(i) * k + Math.cos(yy * 0.18) * 0.08); } }   // leve curvatura da tora
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, [woodM, endM, endM]); m.position.y = PH / 2 - 0.4; m.castShadow = m.receiveShadow = true; post.add(m);
        // topo: serrado em bisel (cone baixo com anéis)
        const cap = new THREE.Mesh(new THREE.ConeGeometry(PR * 0.86, 0.35, 22), endM); cap.position.y = PH - 0.4 + 0.17; cap.castShadow = true; post.add(cap);
        // amarrações de corda (várias voltas) onde a corda da faixa prende e uma no meio
        [[PH - 1.4, 4], [PH * 0.35, 3]].forEach(([y0, n]) => { for (let k = 0; k < n; k++) { const r = new THREE.Mesh(new THREE.TorusGeometry(PR * 0.92, 0.075, 8, 24), ropeM); r.rotation.x = Math.PI / 2 + (k - n / 2) * 0.06; r.position.y = y0 + k * 0.15; r.castShadow = true; post.add(r); } });
      });
      // ---- textura da faixa: lona escura com quadriculado em cima e embaixo, logo grande no meio ----
      const BW = 2 * AW - 2 * PR - 0.5, BH = 6.4, CW = 4096, CH = Math.round(CW * BH / BW);
      const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH; const bTex = new THREE.CanvasTexture(cv); bTex.anisotropy = 8; bTex.encoding = THREE.sRGBEncoding;
      const bumpC = document.createElement('canvas'); bumpC.width = 512; bumpC.height = 512; { const g = bumpC.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, 512, 512);
        for (let y = 0; y < 512; y += 4) for (let x = 0; x < 512; x += 4) { const v = ((x / 4 + y / 4) % 2 ? 150 : 100) + rnd2() * 20; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 4, 4); } }   // trama da lona
      const bBump = new THREE.CanvasTexture(bumpC); bBump.wrapS = bBump.wrapT = THREE.RepeatWrapping; bBump.repeat.set(BW * 3, BH * 3);
      const drawBanner = () => { const g = cv.getContext('2d'), W2 = CW, H2 = CH;
        const cl = g.createLinearGradient(0, 0, 0, H2); cl.addColorStop(0, '#fff7ea'); cl.addColorStop(0.5, '#fbeedb'); cl.addColorStop(1, '#f3e2c8'); g.fillStyle = cl; g.fillRect(0, 0, W2, H2);
        // quadriculado em cima e embaixo (2 fileiras), com bainha costurada
        const cq = H2 * 0.055, hem = H2 * 0.045;
        [hem, H2 - hem - 2 * cq].forEach(y0 => { for (let r = 0; r < 2; r++) for (let x = 0, k = 0; x < W2; x += cq, k++) { g.fillStyle = (k + r) % 2 ? '#111216' : '#f2f2f2'; g.fillRect(x, y0 + r * cq, cq + 1, cq + 1); } });
        g.fillStyle = '#c9182c'; g.fillRect(0, 0, W2, hem); g.fillRect(0, H2 - hem, W2, hem);                                                     // bainha vermelha
        g.setLineDash([22, 14]); g.strokeStyle = 'rgba(255,230,230,.8)'; g.lineWidth = 4; [hem * 0.5, H2 - hem * 0.5].forEach(y => { g.beginPath(); g.moveTo(0, y); g.lineTo(W2, y); g.stroke(); }); g.setLineDash([]);
        // ---- LOGO KARTEC (direto no pano): bandeiras quadriculadas cruzadas atrás,
        // letras KARTEC em itálico com extrusão 3D (camadas vinho), contorno branco + contorno escuro, degradê
        // vermelho-coral, brilho de vidro em cima, faixa de velocidade amarela/vermelha embaixo e estrelinhas.
        { const cx = W2 / 2, cy = H2 * 0.5, eh = H2 * 0.66, ew = eh * 3.6, r = eh / 2;
          const pill = (w, h) => { g.beginPath(); g.moveTo(-w / 2 + h / 2, -h / 2); g.lineTo(w / 2 - h / 2, -h / 2); g.arc(w / 2 - h / 2, 0, h / 2, -Math.PI / 2, Math.PI / 2); g.lineTo(-w / 2 + h / 2, h / 2); g.arc(-w / 2 + h / 2, 0, h / 2, Math.PI / 2, Math.PI * 1.5); g.closePath(); };
          g.save(); g.translate(cx, cy);
          // bandeiras quadriculadas cruzadas atrás da placa
          [-1, 1].forEach(sd => { g.save(); g.translate(sd * ew * 0.47, -eh * 0.08); g.rotate(sd * 0.42);
            g.fillStyle = '#5a3a20'; g.fillRect(-eh * 0.03, -eh * 0.62, eh * 0.06, eh * 1.25);                                   // haste
            const fw = eh * 0.62, fh = eh * 0.44, n = 6, m = 4; g.save(); g.translate(sd * eh * 0.03, -eh * 0.6); g.scale(sd, 1);
            for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const wv = Math.sin(i * 0.9) * eh * 0.03; g.fillStyle = (i + j) % 2 ? '#15161c' : '#ffffff'; g.fillRect(i * fw / n, j * fh / m + wv, fw / n + 1, fh / m + 1); }
            g.strokeStyle = '#15161c'; g.lineWidth = eh * 0.02; g.strokeRect(0, 0, fw, fh + eh * 0.03); g.restore(); g.restore(); });
          // (sem placa atrás das letras: o KARTEC fica direto no pano)
          g.save();
          // faixa de velocidade (swoosh) embaixo
          g.lineCap = 'round'; [['#ffd23f', eh * 0.11, 0.3], ['#e8213a', eh * 0.07, 0.36]].forEach(([c, lw, yy]) => { g.strokeStyle = c; g.lineWidth = lw; g.beginPath(); g.moveTo(-ew * 0.44, eh * yy); g.quadraticCurveTo(0, eh * (yy - 0.12), ew * 0.46, eh * (yy - 0.02)); g.stroke(); });
          g.restore();
          // letras KARTEC
          const fs = eh * 0.62; g.save(); g.translate(0, -eh * 0.04); g.transform(1, 0, -0.18, 1, 0, 0);
          g.font = fs + 'px "Titan One", "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
          const txt = 'KARTEC', k = Math.min(1, ew * 0.84 / g.measureText(txt).width); g.scale(k, k);
          for (let d = 10; d >= 1; d--) { g.fillStyle = d > 7 ? '#3a0710' : '#7a0c1e'; g.fillText(txt, d * fs * 0.012, d * fs * 0.014); }                 // extrusão
          g.strokeStyle = '#0c0c14'; g.lineWidth = fs * 0.2; g.strokeText(txt, 0, 0);
          g.strokeStyle = '#ffffff'; g.lineWidth = fs * 0.11; g.strokeText(txt, 0, 0);
          const red = g.createLinearGradient(0, -fs * 0.4, 0, fs * 0.4); red.addColorStop(0, '#ffc2a8'); red.addColorStop(0.32, '#ff5a5e'); red.addColorStop(0.7, '#e8213a'); red.addColorStop(1, '#a80c22');
          g.fillStyle = red; g.fillText(txt, 0, 0);
          g.save(); g.beginPath(); g.rect(-ew, -fs, ew * 2, fs * 0.42); g.clip(); g.fillStyle = 'rgba(255,255,255,.45)'; g.fillText(txt, 0, 0); g.restore();   // brilho de vidro
          g.restore();
          // estrelinhas de brilho
          const star = (x, y, s) => { g.fillStyle = '#ffffff'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? s * 0.22 : s; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); };
          star(-ew * 0.33, -eh * 0.3, eh * 0.09); star(ew * 0.36, -eh * 0.18, eh * 0.07); star(ew * 0.12, -eh * 0.38, eh * 0.05);
          g.restore(); }
        // ilhoses metálicos na bainha de cima (onde a corda amarra)
        for (let i = 0; i <= GROM; i++) { const x = 30 + i * (W2 - 60) / GROM, y = hem * 0.55; g.fillStyle = '#d9dade'; g.beginPath(); g.arc(x, y, hem * 0.42, 0, 7); g.fill(); g.fillStyle = '#2a2a2e'; g.beginPath(); g.arc(x, y, hem * 0.24, 0, 7); g.fill(); }
        bTex.needsUpdate = true; };
      // ---- simulação: corda (linha de cima) + pano preso só nos ilhoses ----
      const NX = 40, NY = 10, GROM = 8, TOPY = PH - 1.25, X0 = -BW / 2, DX = BW / NX, DY = BH / NY, ROPE_Y = TOPY + 0.35;
      drawBanner(); if (document.fonts && document.fonts.load) document.fonts.load('100px "Titan One"').then(drawBanner).catch(() => {});
      const nCl = (NX + 1) * (NY + 1), nR = NX + 1, nP = nCl + nR + 2;   // pano + corda + 2 pontos fixos nos postes
      const P = new Float32Array(nP * 3), O = new Float32Array(nP * 3), pin = new Uint8Array(nP), idx = (i, j) => j * (NX + 1) + i, rI = i => nCl + i, A0 = nCl + nR, A1 = A0 + 1;
      const setP = (k, x, y, z) => { P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z; };
      for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { const u = i / NX; setP(idx(i, j), X0 + i * DX, TOPY - 0.3 * Math.sin(u * Math.PI) - j * DY, 0); }
      for (let i = 0; i <= NX; i++) { const u = i / NX; setP(rI(i), X0 + i * DX, ROPE_Y - 0.3 * Math.sin(u * Math.PI), 0); }
      setP(A0, -AW + PR * 0.9, PH - 1.2, 0); setP(A1, AW - PR * 0.9, PH - 1.2, 0); pin[A0] = pin[A1] = 1; for (let j = 0; j <= NY; j++) { pin[idx(0, j)] = pin[idx(NX, j)] = 1; }   // laterais amarradas nos postes: a faixa não torce
      O.set(P);
      const C = [], link = (a, b, s) => { C.push(a, b, Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]) * (s || 1)); };
      for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { const k = idx(i, j);
        if (i < NX) link(k, idx(i + 1, j)); if (j < NY) link(k, idx(i, j + 1)); if (i < NX && j < NY) { link(k, idx(i + 1, j + 1)); link(idx(i + 1, j), idx(i, j + 1)); }
        if (i < NX - 1) link(k, idx(i + 2, j)); if (j < NY - 1) link(k, idx(i, j + 2)); }                            // dobra (pano não amassa em zigue-zague)
      for (let i = 0; i < NX; i++) link(rI(i), rI(i + 1), 1.0);
      link(A0, rI(0), 1); link(A1, rI(NX), 1);                                                                        // corda até os postes
      for (let g2 = 0; g2 <= GROM; g2++) { const i = Math.round(g2 * NX / GROM); link(rI(i), idx(i, 0), 1); }          // amarração em cada ilhós
      const CA = Float32Array.from(C), nC = C.length / 3;
      const bg = new THREE.PlaneGeometry(BW, BH, NX, NY), pos = bg.attributes.position; pos.setUsage(THREE.DynamicDrawUsage);
      const sync = () => { for (let k = 0; k < nCl; k++) pos.setXYZ(k, P[k * 3], P[k * 3 + 1], P[k * 3 + 2]); pos.needsUpdate = true; bg.computeVertexNormals(); };
      sync();
      const clothM = side => { const m = new PHONG_ORIG({ map: bTex, bumpMap: bBump, bumpScale: 0.02, shininess: 8, specular: 0x181818, side, emissive: 0xffffff, emissiveMap: bTex, emissiveIntensity: 0.38 }); m.userData.noToon = true; return m; };   // luz que atravessa o tecido
      const front = new THREE.Mesh(bg, clothM(THREE.FrontSide));
      const bg2 = new THREE.BufferGeometry(); bg2.setAttribute('position', pos); bg2.setAttribute('normal', bg.attributes.normal); bg2.setIndex(bg.index);
      const uv2 = bg.attributes.uv.array.slice(); for (let k = 0; k < uv2.length; k += 2) uv2[k] = 1 - uv2[k]; bg2.setAttribute('uv', new THREE.BufferAttribute(uv2, 2));
      const back = new THREE.Mesh(bg2, clothM(THREE.BackSide));
      [front, back].forEach(m => { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.userData.dynamic = true; m.userData.noOutline = true; arch.add(m); });
      // corda e amarras: cilindros instanciados atualizados a cada passo
      const nSeg = NX + 2 + GROM + 1, ropeI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.055, 0.055, 1, 6), ropeM, nSeg), _a = V3(0, 0, 0), _b = V3(0, 0, 0), _d = new THREE.Object3D(), UP = V3(0, 1, 0);
      ropeI.castShadow = true; ropeI.userData.dynamic = true; ropeI.frustumCulled = false; arch.add(ropeI);
      const seg = (n, a, b, r) => { _a.set(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]); _b.set(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]); const L = _a.distanceTo(_b) || 1e-3;
        _d.position.copy(_a).add(_b).multiplyScalar(0.5); _d.quaternion.setFromUnitVectors(UP, _b.sub(_a).normalize()); _d.scale.set(r || 1, L, r || 1); _d.updateMatrix(); ropeI.setMatrixAt(n, _d.matrix); };
      const ropes = () => { let n = 0; for (let i = 0; i < NX; i++) seg(n++, rI(i), rI(i + 1)); seg(n++, A0, rI(0)); seg(n++, A1, rI(NX));
        for (let g2 = 0; g2 <= GROM; g2++) { const i = Math.round(g2 * NX / GROM); seg(n++, rI(i), idx(i, 0), 0.7); } ropeI.instanceMatrix.needsUpdate = true; };
      ropes();
      let tPrev = null, acc = 0; const H = 1 / 60;
      const stepCloth = (t) => {
        for (let k = 0; k < nP; k++) { if (pin[k]) continue; const i3 = k * 3, x = P[i3], y = P[i3 + 1], z = P[i3 + 2], cl = k < nCl, j = cl ? Math.floor(k / (NX + 1)) : 0, u = ((cl ? k : k - nCl) % (NX + 1)) / NX;
          const gust = 0.55 + 0.45 * Math.sin(t * 0.6) * Math.sin(t * 0.23 + 1.1), wz = cl ? (0.8 * gust + 0.9 * Math.sin(t * 2.1 + u * 7.0 + j * 0.5) + 0.6 * Math.sin(t * 3.7 - u * 11.0)) * (0.3 + j / NY) : 0.3 * gust;
          const vx = (x - O[i3]) * 0.985, vy = (y - O[i3 + 1]) * 0.985, vz = (z - O[i3 + 2]) * 0.985;
          O[i3] = x; O[i3 + 1] = y; O[i3 + 2] = z; P[i3] = x + vx; P[i3 + 1] = y + vy - 9.8 * H * H; P[i3 + 2] = z + vz + wz * H * H; }
        for (let it = 0; it < 8; it++) for (let c = 0; c < nC; c++) { const a = CA[c * 3] * 3, b = CA[c * 3 + 1] * 3, r = CA[c * 3 + 2];
          const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6, f = (d - r) / d;
          const wa = pin[a / 3] ? 0 : 1, wb = pin[b / 3] ? 0 : 1, s = wa + wb; if (!s) continue; const fa = f * wa / s, fb = f * wb / s;
          P[a] += dx * fa; P[a + 1] += dy * fa; P[a + 2] += dz * fa; P[b] -= dx * fb; P[b + 1] -= dy * fb; P[b + 2] -= dz * fb; }
      };
      for (let k = 0; k < 240; k++) stepCloth(k * H);   // já nasce assentado (sem cair na largada)
      sync(); ropes();
      tr.animated.push(t => { if (tPrev === null) tPrev = t; acc = Math.min(acc + (t - tPrev), 0.1); tPrev = t; let n = 0; while (acc >= H && n < 4) { stepCloth(t); acc -= H; n++; }
        if (n) { sync(); ropes(); } });
      tr.obstacles.push(...[-1, 1].map(sd => { const p = side(si, sd * AW, 0); return { x: p.x, z: p.z, r: 1.2 }; }));
    }

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
      const n = tr.nearest(p, hint); let h, exact = false, slope = 0, soft = false, roll = 0;
      if (n.dist <= W + CB) {
        const u = n.i + n.f, b = bump(u); h = tr.roadBase + hAt(u); exact = b > 0.001 || tr.vert;
        const segL = S[n.i].distanceTo(S[(n.i + 1) % N]) || 1, grade = (hAt(u + 0.25) - hAt(u - 0.25)) / (0.5 * segL);
        const tA = Math.atan2(T[n.i].x, T[n.i].z); slope = grade * Math.cos(wrapA((heading || 0) - tA));
      } else { const hs = tr.dirtAt && tr.dirtAt(p) ? tr.shortcutHeight(p.x, p.z) : null;
        h = hs !== null ? hs : terrain(p.x, p.z, n.dist, n.i + n.f); if (bump(n.i + n.f) > 0.01) soft = true; else if (tr.vert) exact = true;
        if (tr.shortcuts.length) { const sg = tr.shortcutGround(p.x, p.z); if (sg !== null && (hs !== null || sg > h)) h = sg; }
        // inclinação do chão fora do asfalto (atalhos, barrancos, grama): mede a altura 0,9 m à frente/atrás e 0,7 m de cada lado
        // -> o kart empina/abaixa o bico e inclina de lado acompanhando o relevo, como no asfalto (antes andava sempre reto)
        if (heading !== undefined) { const onDirt = hs !== null, hf = (x, z) => { const q = tr.nearest({ x, z }, n.i);
            if (q.dist <= W + CB) return tr.roadBase + hAt(q.i + q.f); const t = terrain(x, z, q.dist, q.i + q.f), sg = tr.shortcuts.length ? tr.shortcutGround(x, z) : null;
            return sg === null ? t : onDirt ? sg : Math.max(t, sg); };
          const fx = Math.sin(heading), fz = Math.cos(heading), F = 0.9, R = 0.7;
          slope = Math.max(-0.6, Math.min(0.6, (hf(p.x + fx * F, p.z + fz * F) - hf(p.x - fx * F, p.z - fz * F)) / (2 * F)));
          roll = Math.max(-0.45, Math.min(0.45, Math.atan((hf(p.x + fz * R, p.z - fx * R) - hf(p.x - fz * R, p.z + fx * R)) / (2 * R)))); } }   // na terra: exatamente o chão desenhado   // em cima do barranco/terra do atalho: mesma altura do desenho   // fora da pista ao lado da ponte: descida suave
      // (no atalho a altura é o perfil suavizado do próprio caminho: o kart anda exatamente em cima da terra desenhada)
      const r = rampAt(p);
      if (r && r.h >= h - 0.05) { h = r.h; exact = true; soft = false; slope = r.slope * (Math.sin(heading || 0) * r.fx + Math.cos(heading || 0) * r.fz); }
      if (r && r.h >= h - 0.05) roll = 0;
      return { h, exact, slope, soft, roll };
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
    glowSpr.finish();   // brilhos da pista: uma chamada de desenho para todos
    if (window.SunFlare) { try { SunFlare.attach(tr, scene); } catch (e) { console.warn('[lens flare]', e); } }
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
          for (const q of l) { const d2 = (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z); if (d2 < d2m) { d2m = d2; near = q; }
            if (d2 >= 178 * 178) continue; const w = (1 - sm(150, 178, Math.sqrt(d2))) / ((d2 + 100) * (d2 + 100)); sw += w; sh += w * q.h; } }
        // peso com janela suave (some até 178 m; a vizinhança de 7x7 blocos sempre cobre 180 m): antes um nó entrava/saía da
        // conta de repente ao cruzar a divisa de um bloco de 60 m e o relevo ganhava degraus em linhas retas (eixos x/z)
        return near ? { d: Math.sqrt(d2m), h: sw > 1e-30 ? sh / sw : near.h, i: near.i } : { d: 1e9, h: 0, i: -1 }; };
      const drop = d => 0.25 * sm(W + 2, W + 40, d);                                    // a beira desce só um pouquinho
      const natRaw = (x, z) => { const r = roadInfo(x, z); return r.d > 1e8 ? 0 : lerp(r.h - drop(r.d), 0, sm(W + 25, W + 130, r.d)); };
      // O relevo "cru" depende da distância até o ponto MAIS PRÓXIMO da pista: onde dois trechos da pista ficam à mesma distância
      // (miolo das curvas, entre duas retas) a superfície fazia uma quina (crista/vale em linha reta) que aparecia como risco
      // escuro na grama. Ele é amostrado uma vez numa grade de 6 m, borrado (3 passadas de média = gaussiana de ~15 m) e lido
      // com interpolação bicúbica: colinas arredondadas e contínuas, e a física (tr.heightAt) usa exatamente a mesma superfície.
      let NG = null;
      const natGrid = () => { if (NG) return NG;
        const R = LO ? 10 : 6, rb = LO ? 1 : 2, pad = 330, gx0 = L.bbox.x0 - pad, gz0 = L.bbox.z0 - pad;
        const nx = Math.ceil((L.bbox.x1 + pad - gx0) / R) + 1, nz = Math.ceil((L.bbox.z1 + pad - gz0) / R) + 1;
        let A = new Float32Array(nx * nz), B = new Float32Array(nx * nz);
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) A[j * nx + i] = natRaw(gx0 + i * R, gz0 + j * R);
        const span = 2 * rb + 1;
        for (let pass = 0; pass < 3; pass++) {
          for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let s = 0; for (let d = -rb; d <= rb; d++) s += A[j * nx + Math.min(nx - 1, Math.max(0, i + d))]; B[j * nx + i] = s / span; }
          for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let s = 0; for (let d = -rb; d <= rb; d++) s += B[Math.min(nz - 1, Math.max(0, j + d)) * nx + i]; A[j * nx + i] = s / span; } }
        return (NG = { x0: gx0, z0: gz0, R, nx, nz, A }); };
      const cr4 = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));   // Catmull-Rom (C1)
      const natH = (x, z) => { if (!tr.vert) return 0; const G = natGrid(), fx = (x - G.x0) / G.R, fz = (z - G.z0) / G.R, i = Math.floor(fx), j = Math.floor(fz);
        if (i < 1 || j < 1 || i > G.nx - 3 || j > G.nz - 3) return 0;                 // fora da grade: planície (longe da pista)
        const tx = fx - i, tz = fz - j, A = G.A, row = jj => { const o = jj * G.nx; return cr4(A[o + i - 1], A[o + i], A[o + i + 1], A[o + i + 2], tx); };
        return Math.max(0, cr4(row(j - 1), row(j), row(j + 1), row(j + 2), tz)); };
      let waterDist = () => 1e9;                                                         // distância até a beira d'água (rio e laguinhos, definida mais abaixo)
      // ===== MAR no fim do rio =====
      // Costa reta e ondulada, perpendicular ao rio na primeira ponte, do lado de FORA do circuito. Fica sempre a pelo menos
      // W + praia + 80 m do asfalto (a parte da pista que mais avança para o mar decide onde a costa fica). Perto da foz a costa
      // entra um pouco (enseada). info(x, z).e = distância da linha da água para dentro da terra (negativo = no mar);
      // bw = largura da praia de areia naquele ponto (borda recortada).
      const SEA = (() => { const b0 = bridges[0]; if (b0 === undefined) return null;
        const D = V3(T[b0].z, 0, -T[b0].x).normalize(), P = V3(D.z, 0, -D.x);
        const ex = S[b0].x + T[b0].z * 240, ez = S[b0].z - T[b0].x * 240, latR = ex * P.x + ez * P.z;
        const wob = l => 14 * Math.sin(l * 0.0093 + 0.7) + 6 * Math.sin(l * 0.027 + 2.1) + 2.5 * Math.sin(l * 0.071) - 22 * Math.exp(-Math.pow((l - latR) / 80, 2));
        const BW = 110, jag = l => 3 * Math.sin(l * 0.21 + 0.4) + 2 * Math.sin(l * 0.53 + 1.1) + 1.2 * Math.sin(l * 1.37);
        let c0 = -1e9; for (let i = 0; i < N; i++) { const d = S[i].x * D.x + S[i].z * D.z, l = S[i].x * P.x + S[i].z * P.z; c0 = Math.max(c0, d - wob(l)); }
        c0 += W + BW + 80;
        const info = (x, z) => { const l = x * P.x + z * P.z; return { e: c0 + wob(l) - (x * D.x + z * D.z), l, bw: BW + jag(l) }; };
        // ponto (x, z) a uma distância e da água (para dentro da terra) na posição lateral l
        const at = (l, e) => { const d = c0 + wob(l) - e; return [D.x * d + P.x * l, D.z * d + P.z * l]; };
        console.info('[mar] costa a', c0.toFixed(0), 'm do centro, na direção', D.x.toFixed(2), D.z.toFixed(2));
        return { D, P, latR, c0, wob, BW, info, at, bwAt: l => BW + jag(l), e: (x, z) => info(x, z).e };
      })();
      tr.sea = SEA; tr.seaDist = SEA ? SEA.e : null;                                     // scenery.js não planta nada no mar nem na praia
      // grama perto do mar: desce até ~0,55 m (altura da praia) e, embaixo da areia, afunda abaixo da água
      // (só abaixa: onde o chão já é mais baixo, como no canal do rio, ele não sobe)
      const seaGround = (h, x, z) => { if (!SEA) return h; const q = SEA.info(x, z); if (q.e > q.bw + 110) return h;
        if (q.e >= q.bw) return Math.min(h, lerp(0.55, h, sm(q.bw, q.bw + 110, q.e)));
        return Math.min(h, lerp(-0.8, 0.55, sm(q.bw - 25, q.bw - 6, q.e))); };
      const gH = (x, z, r) => { r = r || roadInfo(x, z); let h = natH(x, z, r); if (h > 0.01) { const wd = waterDist(x, z); if (wd < 45) h *= 1 - (1 - sm(8, 45, wd)) * sm(W + 6, W + 18, r.d); } return seaGround(h, x, z); };
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
        // lado do mar: sem cordilheira nem morros (a vista do mar vai limpa até o horizonte)
        const nearLake = (x, z, r) => !!SEA && SEA.e(x, z) < r + 220;
        for (let k = 0; k < 22; k++) {
          const a = k / 22 * Math.PI * 2 + rnd() * 0.2, r = RAD + 290 + rnd() * 260, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.85;
          if (nearTrack({ x, z }, 330)) continue;
          const h = 110 + rnd() * 170, rx = 120 + rnd() * 110; if (nearLake(x, z, rx)) continue; peak(x, z, rx, h, rx * (0.8 + rnd() * 0.4), k);
          if (rnd() < 0.7) { const x2 = x + Math.cos(a + 1.6) * rx * 0.9, z2 = z + Math.sin(a + 1.6) * rx * 0.9, hh = h * (0.55 + rnd() * 0.3); if (!nearLake(x2, z2, rx * 0.7)) peak(x2, z2, rx * 0.7, hh, rx * 0.6, k + 7); }
        }
        // morros verdes mais perto, entre a pista e a cordilheira
        for (let k = 0; k < 16; k++) { const a = rnd() * Math.PI * 2, r = RAD + 120 + rnd() * 140, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.85;
          if (nearTrack({ x, z }, 230) || nearLake(x, z, 150)) continue; peak(x, z, 90 + rnd() * 60, 45 + rnd() * 45, 80 + rnd() * 50, k + 31); }
      }
      // ---- água (rio e laguinhos): turquesa viva, ondulada e com reflexo de verdade ----
      // Reflexo planar: a cena é desenhada de novo por uma câmera espelhada no nível da água (y = WATER_Y), numa
      // textura de meia resolução, uma vez por quadro e só quando alguma água está na tela (onBeforeRender).
      // Ajustes em CFG.WATER (opcional): REFLECT (false desliga o reflexo), RES (resolução do reflexo), DEEP/SHALLOW (cores).
      // cores de rio/lago natural (antes era turquesa de piscina, clara demais): fundo de cascalho e sedimento, verde-azulado que
      // escurece com a profundidade, beira rasa ainda transparente
      // (água: shader e cores da versão anterior, a pedido: turquesa com refração e cáustica)
      const WC = Object.assign({ REFLECT: true, RES: 0.5, DEEP: '#0a8a90', SHALLOW: '#38c4bb', REFL: 0.9, DEPTH: 1.6, ABSORB: [0.6, 0.17, 0.15], BED: '#b8a679', LILIES: true }, CFG.WATER || {});
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
      wUni.uSeaDeep = { value: new THREE.Color(WC.SEA_DEEP || '#0a4f86') };   // azul do mar aberto (cor de vértice do mar: g - r = profundidade, b - r > 1,5 = é mar)
      wUni.uSky = { value: new THREE.Color(0xbfe4ff) }; wUni.uLite = { value: 0 };   // uLite: água simples (sem cáustica nem ondinhas finas)   // sem textura ainda: reflete só a cor do céu (esta linha estava dentro do comentário acima e a água quebrava)
      const waterM = new THREE.ShaderMaterial({ uniforms: wUni, vertexColors: true, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
        extensions: { derivatives: true },
        vertexShader: `uniform float uT; attribute vec2 flow; varying vec3 vW; varying float vEdge; varying vec2 vFlow; varying float vSea; varying float vIsSea;
          #include <fog_pars_vertex>
          void main(){ vec4 w = modelMatrix * vec4(position, 1.0);
            vSea = clamp(color.g - color.r, 0.0, 1.0); vIsSea = step(1.5, color.b - color.r);   // só o mar tem g/b diferentes de r
            float calm = 1.0 - 0.7 * smoothstep(0.7, 1.0, color.r);                       // ondas menores na beira (raso)
            w.y += calm * (0.018 * sin(w.x * 0.31 + uT * 1.5) + 0.014 * sin(w.z * 0.43 - uT * 1.2) + 0.01 * sin((w.x - w.z) * 0.6 + uT * 2.3)) * (1.0 + 3.0 * vSea);
            w.y += vSea * (0.16 * sin(dot(w.xz, vec2(0.011, 0.043)) + uT * 0.8) + 0.07 * sin(dot(w.xz, vec2(-0.031, 0.022)) + uT * 1.1));   // marola do mar aberto
            vW = w.xyz; vEdge = color.r; vFlow = flow; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: `uniform float uT; uniform sampler2D tRefl; uniform mat4 uTexMat; uniform float uRefl; uniform vec3 uDeep; uniform vec3 uShallow;
          uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSky; uniform float uHasRT; uniform float uLite; uniform float uDepth; uniform vec3 uAbsorb; uniform vec3 uBed; uniform float uSRGB;
          vec3 toLin(vec3 c){ return uSRGB > 0.5 ? pow(max(c, 0.0), vec3(2.2)) : c; }
          vec3 toOut(vec3 c){ return uSRGB > 0.5 ? pow(max(c, 0.0), vec3(1.0 / 2.2)) : c; }
          varying vec3 vW; varying float vEdge; varying vec2 vFlow; varying float vSea; varying float vIsSea; uniform vec3 uSeaDeep;
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
            vec2 g = (waves(p, t) * (1.0 + 0.7 * vSea) + rp * detail) * mix(0.5, 1.0, detail);
            vec3 N = normalize(vec3(-g.x * 1.4, 1.0, -g.y * 1.4));
            vec3 V = normalize(cameraPosition - vW);
            // REFRAÇÃO: o raio entra na água, entorta (índice 1,33) e acerta o fundo; profundidade maior no meio, rasa na beira
            float depth = mix(uDepth, 0.18, smoothstep(0.5, 0.98, vEdge)) * (1.0 + 5.0 * vSea);   // mar: bem mais fundo longe da costa
            vec3 deepC = mix(uDeep, uSeaDeep, vSea);
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
            under = (under * tr + toLin(deepC) * (1.0 - exp(-path * 0.9)) * 0.55) * 0.85;
            // luz do ambiente: o fundo só aparece claro quando há luz (antes a água tinha brilho próprio e ficava fluorescente à noite)
            float dayK = clamp(max(dot(uSunCol, vec3(0.3, 0.59, 0.11)) * 0.9, dot(toLin(uSky), vec3(0.3, 0.59, 0.11)) * 1.4), 0.0, 1.0);
            under *= mix(0.1, 1.0, dayK);
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
            // espuma do mar: ondinhas brancas chegando na praia + faixa de espuma rente à areia
            if (vIsSea > 0.5) { float nz = wNoise(vW.xz * 0.05);
              float fw = smoothstep(0.62, 1.0, sin(vEdge * 34.0 - t * 1.4 + nz * 5.0) * 0.5 + 0.5) * smoothstep(0.72, 0.97, vEdge);
              float foam = fw * (0.45 + 0.55 * wNoise(vW.xz * 0.7 + t * 0.35)) + smoothstep(0.95, 1.0, vEdge) * 0.8;
              col = mix(col, toLin(vec3(0.93, 0.97, 1.0)) * mix(0.12, 1.0, dayK), clamp(foam, 0.0, 0.85) * mix(0.4, 1.0, detail)); }
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
      // EMBAIXO D'ÁGUA: a água agora é translúcida e mostra o fundo DE VERDADE (malha funda, pedras e plantas). Estes materiais
      // escurecem e esverdeiam com a profundidade (a luz que a água absorve) e recebem a rede de luz da cáustica, que se mexe.
      const uwFX = (m, key) => GfxFX.chain(m, 'uw-' + key, sh => {
        sh.uniforms.uWT = waterU;
        sh.vertexShader = 'varying vec3 vUW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
          { vec4 uwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            uwp = instanceMatrix * uwp;
          #endif
            vUW = (modelMatrix * uwp).xyz; }`);
        sh.fragmentShader = 'uniform float uWT;\nvarying vec3 vUW;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
          { float dep = ${WATER_Y.toFixed(3)} - vUW.y;
            if (dep > 0.0) { vec2 q = vUW.xz * 0.55;
              float c1 = sin(q.x * 2.3 + sin(q.y * 1.9 + uWT * 0.9) * 1.4 + uWT * 0.6), c2 = sin(q.y * 2.1 + sin(q.x * 1.7 - uWT * 0.8) * 1.4 - uWT * 0.5);
              float ca = pow(1.0 - abs(c1 * c2), 7.0) * (1.0 - smoothstep(0.2, 2.2, dep));   // cáustica: some com a profundidade
              gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.42, 0.66, 0.7), smoothstep(0.0, 2.0, dep)) + vec3(0.75, 0.95, 0.9) * ca * 0.28; } }`); });
      const bankM = new THREE.MeshLambertMaterial({ map: GfxFX.aniso(TX.get('sand')), side: THREE.DoubleSide }), bedM = uwFX(new THREE.MeshLambertMaterial({ map: GfxFX.aniso(TX.get('pebble')), side: THREE.DoubleSide }), 'bed');
      // profundidade do fundo pela distância até a beira (e: 0 = meio, 1 = beira): 31 cm na beira, ~1,9 m no meio
      const bedDepth = e => Math.min(WATER_Y - 0.07, 0.31 + (WC.DEPTH - 0.31) * (1 - (u => u * u * (3 - 2 * u))(Math.max(0, Math.min(1, (e - 0.3) / 0.7)))));  // fundo nunca abaixo do chão (y>=0.07), senão a grama o cobre
      const afterGrid = [];                                                               // margens de areia: montadas depois da grade da grama (seguem a altura dela)
      const dcol = e => new THREE.Color(e, e, e);                                         // cor de vértice da água = quanto perto da margem (o shader pinta)
      const NV = i => V3(T[i].z, 0, -T[i].x), PV = (i, o) => S[i].clone().addScaledVector(NV(i), o);
      const bA = bridges[0], bB = bridges[1], RHW = 9, RHW_END = 18; let RDELTA = 34;   // RDELTA (meia-largura da foz = o MAR) é calculado abaixo conforme o espaço livre
      // perfil da margem de areia (e = distância além da beira d'água): sobe do chão com inclinação ZERO (curva suave, sem
      // quina) até o topo, fica plano e desce para a água. Antes era uma rampa reta que começava numa quina a 6 m: o
      // pós-efeito (sombra de contato/contorno) marcava essa quina como um degrau escuro em volta dos lagos e do rio.
      const BANKP = e => e >= 10 ? 0 : e >= 1.2 ? (u => 0.85 * u * u * (3 - 2 * u))((10 - e) / 8.8) : e >= 0 ? 0.85 : e >= -0.4 ? 0.14 + 0.71 * (e + 0.4) / 0.4 : 0.14;
      let bankBase = () => 0;                                                            // chão sem areia: a grade da grama (definido quando ela fica pronta)
      const PROF = [[10.4, -0.08]].concat([9.2, 8.2, 7.2, 6.2, 5.3, 4.4, 3.5, 2.6, 1.9, 1.2, 0, -0.4].map(e => [e, BANKP(e)])), PC = PROF.length;   // a borda de fora da areia fica ENTERRADA (antes ficava rente à grama e as duas "brigavam": risco claro tracejado)
      // ---- praia do mar (mesma conta para o desenho e para a física) ----
      // perfil: plana a ~0,6 m, desce suave até a água (0,47 m na linha d'água) e continua descendo embaixo do mar.
      // Onde o rio cruza a praia, um canal (seaCarve) desce até o leito do rio.
      const seaCarve = eR => eR <= -2 ? 0.14 : eR < 0 ? 0.14 + 0.33 * (eR + 2) / 2 : 0.47 + 0.15 * sm(0, 15, eR);
      const beachProf = q => q.e >= 2 ? 0.55 + 0.07 * sm(2, q.bw, q.e) : q.e >= 0 ? 0.47 + 0.04 * q.e : Math.max(0.15, 0.47 + 0.05 * q.e);
      // q = SEA.info(x, z); eR = distância até a beira do rio (negativo = dentro do rio). -1e9 = fora da praia
      const beachH = (x, z, q, eR) => { if (!q || q.e > q.bw + 1.2) return -1e9; const g0 = bankBase(x, z);
        if (q.e >= q.bw) return g0 + 0.02 - 0.14 * (q.e - q.bw) / 1.2;                // borda de fora enterrada na grama
        const ge = bankBase(...SEA.at(q.l, q.bw)) + 0.03;                                  // chão onde a areia começa: sobe dele até o perfil em 12 m (sem degrau)
        let h = lerp(ge, beachProf(q), sm(q.bw, q.bw - 12, q.e)); if (eR !== undefined && eR < 15) h = Math.min(h, seaCarve(eR)); return Math.max(h, g0 + 0.03); };
      // margem de areia do rio chegando na praia: vai virando a praia nos últimos 25 m (sem degrau)
      const seaBlendBank = (h, x, z, eR) => { if (!SEA || h < -1e8) return h; const q = SEA.info(x, z); if (q.e > q.bw + 25) return h;
        const b = Math.max(Math.min(0.62, seaCarve(eR)), bankBase(x, z) + 0.03); return lerp(b, h, sm(q.bw, q.bw + 25, q.e)); };
      // ---- rio ----
      const rp = [PV(bB, 74), PV(bB, 64), PV(bB, 45), PV(bB, 0), PV(bB, -45)];
      { const a3 = PV(bA, -45), b3 = rp[4].clone(), dir = a3.clone().sub(b3), len = dir.length(); dir.normalize(); const perp = V3(-dir.z, 0, dir.x);
        for (let k = 1; k <= 5; k++) { const t = k / 6; rp.push(b3.clone().addScaledVector(dir, len * t).addScaledVector(perp, 58 * Math.sin(t * Math.PI) * Math.sin(k * 2.2 + 0.4))); }
        const tA = T[bA]; rp.push(a3, PV(bA, 0), PV(bA, 45), PV(bA, 95), PV(bA, 140).addScaledVector(tA, 35), PV(bA, 190).addScaledVector(tA, -30), PV(bA, 240));
        // MAR: o rio continua reto até entrar ~90 m no mar (a ponta dentro do mar fica escondida embaixo da água do mar)
        if (SEA) { const L0 = rp[rp.length - 1], ext = SEA.e(L0.x, L0.z) + 90; if (ext > 10) rp.push(L0.clone().addScaledVector(SEA.D, ext * 0.5), L0.clone().addScaledVector(SEA.D, ext)); } }
      const riverC = new THREE.CatmullRomCurve3(rp, false, 'centripetal'), RM = SEA ? 320 : 260, RL = riverC.getLength(), rpts = [], rtan = [];
      for (let k = 0; k <= RM; k++) rpts.push(riverC.getPointAt(k / RM));
      // largura (meia-largura em m) ao longo do rio: poço da cachoeira (14 m) -> RHW (9 m) -> vai alargando rio abaixo até
      // RHW_END (18 m: leito de ~36 m) -> foz larga (RDELTA) e fecha
      const HEAD = 26 / RL, MOUTH = 0.84;
      // com mar: a foz começa a abrir ~80 m antes da praia (TF0) e chega à largura total na linha da água (TC)
      let TF0 = MOUTH, TC = 1;
      if (SEA) { let kF = -1, kC = -1; for (let k = 0; k <= RM; k++) { const e = SEA.e(rpts[k].x, rpts[k].z); if (kF < 0 && e < SEA.BW + 80) kF = k; if (kC < 0 && e < 0) { kC = k; break; } }
        if (kF > 0 && kC > kF) { TF0 = kF / RM; TC = kC / RM; } }
      // a foz abre na largura que cabe no espaço livre: distância da pista (menos largura, areia e folga)
      { let md = 1e9; for (let k = Math.round(RM * TF0); k <= Math.round(RM * TC); k++) for (let i = 0; i < N; i += 2) md = Math.min(md, Math.hypot(S[i].x - rpts[k].x, S[i].z - rpts[k].z));
        RDELTA = Math.max(34, Math.min(SEA ? 70 : 130, md - W - 26)); console.info('[mar] meia-largura da foz:', RDELTA.toFixed(0), 'm (pista mais próxima a', md.toFixed(0), 'm)'); }
      const hwf = t => { if (t < HEAD) { const u = t / HEAD; return RHW + (14 - RHW) * (1 - u * u * (3 - 2 * u)); }
        if (t < TF0) { const u = (t - HEAD) / (TF0 - HEAD); return RHW + (RHW_END - RHW) * (1 - (1 - u) * (1 - u)); }   // alarga rápido no começo e depois estabiliza
        if (SEA) { const u = Math.min(1, (t - TF0) / (TC - TF0)); return RHW_END + (RDELTA - RHW_END) * u * u * (3 - 2 * u); }   // foz abrindo para o mar
        const u = (t - MOUTH) / (1 - MOUTH); return u < 0.5 ? RHW_END + (RDELTA - RHW_END) * Math.sin(u * Math.PI) : RDELTA * Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.5) / 0.5, 2))); };
      { // suaviza quinas até o raio mínimo ser maior que a bacia (evita a água vazar da areia)
        const P0 = rpts.map(p => p.clone()), pin = k => k < 3 || k > RM - 2 || bridges.some(b => Math.hypot(P0[k].x - S[b].x, P0[k].z - S[b].z) < 6);
        const curvR = k => { const a = rpts[k - 1], b = rpts[k], c = rpts[k + 1], ar = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2; return ar > 1e-6 ? a.distanceTo(b) * b.distanceTo(c) * a.distanceTo(c) / (4 * ar) : 1e9; };
        const hw0 = k => hwf(k / RM) + 6;                                                  // largura real + margem de areia (raio x 1,35 já cobre a margem de 10 m)
        for (let it = 0; it < 1500; it++) { let bad = false; const nx = rpts.map(p => p.clone());
          for (let k = 1; k < RM; k++) { if (pin(k)) continue; const need = curvR(k) < hw0(k) * 1.35 || (k > 1 && curvR(k - 1) < hw0(k - 1) * 1.35) || (k < RM - 1 && curvR(k + 1) < hw0(k + 1) * 1.35);
            if (!need && it > 40) continue; bad = bad || need;
            nx[k].x += 0.5 * ((rpts[k - 1].x + rpts[k + 1].x) / 2 - rpts[k].x); nx[k].z += 0.5 * ((rpts[k - 1].z + rpts[k + 1].z) / 2 - rpts[k].z); }
          rpts.splice(0, rpts.length, ...nx); if (!bad && it > 40) break; }
      }
      for (let k = 0; k <= RM; k++) { const a = rpts[Math.max(0, k - 1)], b = rpts[Math.min(RM, k + 1)]; rtan.push(V3(b.x - a.x, 0, b.z - a.z).normalize()); }
      const rHW = rpts.map((_, k) => hwf(k / RM));
      const nearRiver = (x, z, m) => rpts.some((p, k) => Math.hypot(p.x - x, p.z - z) < m + rHW[k] - RHW);
      // atalho que cruzaria o rio é descartado (não dá para passar pela água)
      tr.shortcuts = tr.shortcuts.filter(sc => { const bad = sc.pts.some((q, k) => k > 3 && k < sc.pts.length - 4 && nearRiver(q.x, q.z, sc.hw + 3)); if (bad) console.warn('[atalho] ' + sc.i + '→' + sc.j + ' cruza o rio: desligado'); return !bad; });
      const riverDist = (x, z) => rpts.reduce((a, p, k) => Math.min(a, Math.hypot(p.x - x, p.z - z) - (rHW[k] - RHW)), 1e9);
      // trecho do rio já dentro do mar (> 30 m da linha da água): não é desenhado (a água do mar cobre)
      const riverInSea = k => !!SEA && SEA.e(rpts[k].x, rpts[k].z) < -30;
      function ribbonGeo(hwA, cs, colored) {
        const pos = [], uv = [], col = [], idx = [];
        for (let k = 0; k <= RM; k++) { const p = rpts[k], t = rtan[k], hw = hwA(k / RM);
          for (let c = 0; c <= cs; c++) { const u = c / cs * 2 - 1; pos.push(p.x + t.z * hw * u, 0, p.z - t.x * hw * u); uv.push(c / cs, k / RM * RL / 20); if (colored) { const q = dcol(Math.abs(u)); col.push(q.r, q.g, q.b); } } }
        for (let k = 0; k < RM; k++) { if (riverInSea(k) && riverInSea(k + 1)) continue; for (let c = 0; c < cs; c++) { const a = k * (cs + 1) + c, d = a + cs + 1; idx.push(a, d, a + 1, a + 1, d, d + 1); } }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        if (colored) { g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); const fl = []; for (let k = 0; k <= RM; k++) for (let c = 0; c <= cs; c++) fl.push(rtan[k].x, rtan[k].z); g.setAttribute('flow', new THREE.Float32BufferAttribute(fl, 2)); }
        g.setIndex(idx); g.computeVertexNormals(); return g;
      }
      { const BC = 12, g = ribbonGeo(t => Math.max(0, hwf(t) - 0.15), BC, false), P = g.attributes.position;   // leito em "U": raso na beira, fundo no meio
        for (let k = 0; k <= RM; k++) for (let c = 0; c <= BC; c++) P.setY(k * (BC + 1) + c, WATER_Y - bedDepth(Math.abs(c / BC * 2 - 1)));
        g.computeVertexNormals(); const o = new THREE.Mesh(g, bedM); o.receiveShadow = true; o.userData.noOutline = true; add(o); }
      [1, -1].forEach(sg => afterGrid.push(() => { const pos = [], uv = [], idx = [];
        const inBeach = [];   // vértice já na praia do mar: a margem do rio some ali (a praia continua)
        for (let k = 0; k <= RM; k++) { const p = rpts[k], t = rtan[k], hw = rHW[k]; PROF.forEach(([d], c) => { const x = p.x + t.z * sg * (hw + d), z = p.z - t.x * sg * (hw + d);
          pos.push(x, seaBlendBank(bankH(d, bankBase(x, z)), x, z, d), z); uv.push(x / 3.5, z / 3.5); inBeach.push(!!SEA && SEA.info(x, z).e < SEA.info(x, z).bw - 2); }); }   // altura relativa ao chão de verdade; UV no mundo
        for (let k = 0; k < RM; k++) for (let c = 0; c < PC - 1; c++) { const a = k * PC + c, d = a + PC; if (inBeach[a] || inBeach[a + 1] || inBeach[d] || inBeach[d + 1]) continue; idx.push(a, d, a + 1, a + 1, d, d + 1); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
        const m = new THREE.Mesh(g, bankM); m.receiveShadow = true; add(m); }));
      const riverGeo = ribbonGeo(t => Math.max(0, hwf(t) - 0.15), 8, true); riverGeo.translate(0, WATER_Y, 0); add(waterMesh(riverGeo));
      tr.minimap.push({ type: 'river', pts: rpts.map((p, k) => [p.x, p.z, rHW[k]]) });
      // ===== MAR: água até o horizonte + praia de areia (depois da grade da grama: a areia segue a altura dela) =====
      if (SEA) afterGrid.push(() => {
        const D = SEA.D;
        // onde o rio chega na costa (posição lateral) e a meia-largura dele ali
        let kC = RM; for (let k = 0; k <= RM; k++) if (SEA.e(rpts[k].x, rpts[k].z) < 0) { kC = k; break; }
        const latRiv = rpts[kC].x * SEA.P.x + rpts[kC].z * SEA.P.z, hwC = rHW[kC], k0 = Math.max(0, kC - 60), k1 = Math.min(RM, kC + 40);
        const nearMouth = l => Math.abs(l - latRiv) < hwC + 70;
        const riverFrac = (x, z) => { let b = 1e9; for (let k = k0; k <= k1; k++) b = Math.min(b, Math.hypot(rpts[k].x - x, rpts[k].z - z) / Math.max(1, rHW[k])); return b; };   // 0 = meio do rio, 1 = margem
        const riverEdge = (x, z) => { let b = 1e9; for (let k = k0; k <= k1; k++) b = Math.min(b, Math.hypot(rpts[k].x - x, rpts[k].z - z) - rHW[k]); return b; };          // m além da margem
        // colunas ao longo da costa: mais juntas na foz (o canal do rio corta a praia)
        const HL = GS / 2 + 400, lats = []; for (let l = -HL; l <= HL;) { lats.push(l); l += nearMouth(l) ? 2.5 : 8; }
        const NC = lats.length;
        const grid = (rows, vert, mat) => { const pos = [], idx = [], extra = {};
          rows.forEach((r, j) => lats.forEach(l => vert(r, l, pos, extra)));
          for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < NC - 1; i++) { const a = j * NC + i, b = a + 1, c = a + NC, d = c + 1; idx.push(a, c, b, b, c, d); }
          for (let q = 0; q < idx.length; q += 3) { const A = idx[q] * 3, B = idx[q + 1] * 3, C = idx[q + 2] * 3;   // todo triângulo virado para cima
            if ((pos[B + 2] - pos[A + 2]) * (pos[C] - pos[A]) - (pos[B] - pos[A]) * (pos[C + 2] - pos[A + 2]) < 0) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; } }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          for (const k in extra) g.setAttribute(k, new THREE.Float32BufferAttribute(extra[k].a, extra[k].n));
          g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere(); return g; };
        // ---- praia ----
        // fileiras: borda de fora enterrada na grama (b+1,2) ... praia larga e plana ... linha d'água ... embaixo do mar
        const BROWS = [b => b + 1.2, b => b, b => b - 2, b => b - 5, b => b - 9, b => b - 13, b => b - 18, b => b - 24, b => b - 32, b => b - 45, b => b - 60,
          () => 40, () => 28, () => 20, () => 14, () => 10, () => 7, () => 4.5, () => 2.5, () => 1, () => 0, () => -1.5, () => -4, () => -8];
        const beachG = grid(BROWS, (r, l, pos, ex) => { const bw = SEA.bwAt(l), e = r(bw), [x, z] = SEA.at(l, e);
          const h = beachH(x, z, { e, l, bw }, nearMouth(l) ? riverEdge(x, z) : undefined);
          pos.push(x, h, z); (ex.uv = ex.uv || { a: [], n: 2 }).a.push(x / 3.5, z / 3.5); });
        const beachM = bankM.clone(); beachM.polygonOffset = true; beachM.polygonOffsetFactor = -1; beachM.polygonOffsetUnits = -2;
        SEA.beachH = beachH; SEA.nearMouth = nearMouth; SEA.riverEdge = riverEdge; SEA.lats = lats;   // a faixa de grama da transição (mais abaixo) segue a areia
        const beach = new THREE.Mesh(beachG, beachM); beach.receiveShadow = true; beach.userData.noOutline = true; add(beach);
        // ---- água do mar (mesmo material do rio: reflexo, ondas, cor) ----
        // cor do vértice: r = beira (1 na areia; no canal da foz segue a largura do rio, para emendar com a água do rio),
        // g - r = quão fundo/aberto é o mar, b - r = 2 (marca "é mar": marola e espuma)
        const SROWS = [-3, 0, 0.6, 1.5, 3, 5, 8, 12, 18, 26, 36, 50, 70, 100, 140, 200, 280, 400, 560, 800, 1100, 1500, 2000, 2700];
        const seaG = grid(SROWS, (d, l, pos, ex) => { const [x, z] = SEA.at(l, -d), shore = d <= 0 ? 1 : 1 - sm(0, 60, d), rf = nearMouth(l) ? riverFrac(x, z) : 9;
          const edge = Math.min(shore, rf < 1 ? rf : 1), deep = sm(20, 450, d);
          pos.push(x, WATER_Y, z); (ex.color = ex.color || { a: [], n: 3 }).a.push(edge, edge + deep, edge + 2); (ex.flow = ex.flow || { a: [], n: 2 }).a.push(-D.x * 0.25, -D.z * 0.25); });
        const sea = waterMesh(seaG); sea.renderOrder = 1; sea.frustumCulled = false; add(sea);
        console.info('[mar] praia e mar criados:', NC, 'colunas; foz com', (hwC * 2).toFixed(0), 'm de largura');
      });
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
        [W + CB, -W - CB].forEach(o => { const pos = [], uv = [];
          for (let i = bi - BR.END; i < bi + BR.END; i++) { const lo = j => dOf(j) <= BR.FLAT + 1 ? bump(j) - 1.1 : 0.02;
            const a = side(i, o, bump(i) + 0.05), b = side(i + 1, o, bump(i + 1) + 0.05), c = side(i, o, lo(i)), d = side(i + 1, o, lo(i + 1));
            [a, b, d, a, d, c].forEach(p => pos.push(p.x, p.y, p.z)); [[0, 1], [1, 1], [1, 0], [0, 1], [1, 0], [0, 0]].forEach(q => uv.push(q[0], q[1])); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
          const m = new THREE.Mesh(g, conc); m.castShadow = m.receiveShadow = true; add(m); });
        // laje por baixo do tabuleiro (vista de dentro do rio)
        { const pos = []; for (let i = bi - BR.FLAT - 1; i < bi + BR.FLAT + 1; i++) { const y0 = bump(i) - 1.1, y1 = bump(i + 1) - 1.1;
            const a = side(i, -W - CB, y0), b = side(i + 1, -W - CB, y1), c = side(i, W + CB, y0), d = side(i + 1, W + CB, y1); [a, b, d, a, d, c].forEach(p => pos.push(p.x, p.y, p.z)); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); add(new THREE.Mesh(g, conc)); }
        // pilares de pedra apoiando o vão
        const rk = rpts.reduce((b, p, k) => p.distanceTo(S[bi]) < rpts[b].distanceTo(S[bi]) ? k : b, 0), nodeL = S[bi].distanceTo(S[(bi + 1) % N]);
        const PD = Math.min(BR.FLAT, Math.max(3, Math.ceil((rHW[rk] + 2.5) / nodeL)));        // pilares na margem, não dentro do rio
        [-PD, PD].forEach(di => [-1, 1].forEach(sd => { const i = bi + di, p = side(i, sd * (W * 0.55), 0), h = bump(i) - 1.1;
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
        // pé do morro suave: antes o perfil pow(1-e, 0.62) subia de 0 a ~13 m na primeira célula da malha (inclinação infinita
        // na borda); cada coluna da grade pegava uma altura diferente e a encosta virava uma "cortina" de dentes verdes/escuros.
        // O smoothstep faz a encosta nascer do chão com inclinação zero e subir ao longo de várias células.
        const dome = (x, z) => { const e = ((x - HCX) / HRX) ** 2 + ((z - HCZ) / HRZ) ** 2; if (e >= 1) return 0; const s = 1 - e;
          return (HM * Math.pow(s, 0.62) + hn(x, z) * s) * THREE.MathUtils.smoothstep(s, 0, 0.45); };
        const chan = (x, z) => 6 * (1 - THREE.MathUtils.smoothstep(Math.abs(x), 5, 9)) * THREE.MathUtils.smoothstep(z, -34, -6);   // sulco do riacho
        const hillH = (x, z) => { const f = zf(x), behind = Math.max(0, dome(x, Math.min(z, f)) - chan(x, Math.min(z, f)));
          if (z <= f) return behind;
          const d = z - f, cliff = behind * (1 - THREE.MathUtils.smoothstep(d, 0, 0.9));                   // face quase vertical
          const talus = Math.min(behind, 9) * (1 - THREE.MathUtils.smoothstep(d, 0, 11)) * THREE.MathUtils.smoothstep(Math.abs(x), 13, 20);   // pedras no pé (fora do poço)
          return Math.max(cliff, talus); };
        { const X0 = -82, X1 = 82, Z0 = -112, Z1 = 26, CS = LO ? 2.0 : MID ? 1.4 : 1.0, nx = Math.ceil((X1 - X0) / CS), pos = [], col = [], idx = [];
          // fileiras da malha (deslocamento a partir da linha da face). A face quase vertical (~45 m) acontece entre 0 e 0,9 m
          // à frente da linha: com fileiras a cada 1 m ela virava UMA faixa de triângulos de 45 m de altura -> cor e luz
          // esticadas ("línguas" verdes e listras verticais). Fileiras extras dentro da face: faixas de ~5 m.
          const rows = []; for (let o = Z0; o <= Z1 + 1e-6; o += CS) rows.push(+o.toFixed(4));
          [0.02, 0.06, 0.11, 0.17, 0.24, 0.32, 0.41, 0.51, 0.62, 0.75, 0.9, 1.4, 2.2].forEach(o => { if (!rows.some(r => Math.abs(r - o) < 0.01)) rows.push(o); });
          rows.sort((a, b) => a - b); const nz = rows.length - 1;
          for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = X0 + i * CS, z = rows[j] + zf(x), h = hillH(x, z);   // linhas da malha seguem a curva da face: sem degraus/listras verticais no penhasco
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
            .forEach(([x, z, s], k) => { if (Math.abs(x) <= 11.5) return; const o = new THREE.Mesh(bg, bm); o.position.set(x, WATER_Y - 0.25 + s * 0.35, zf(x) + z * 0.6); o.scale.set(s * 1.25, s * 0.75, s); o.rotation.set(k, k * 1.7, k * 0.5); o.castShadow = o.receiveShadow = true; wf.add(o); }); }   // pedras dentro da neblina (|x| <= 11.5) não são criadas: o contorno escuro do pós-efeito atravessava a fumaça
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
        const fallMat = (speed, alpha, seed) => { const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSpd: { value: speed * 1.3 /* água caindo 30% mais rápido */ }, uA: { value: alpha }, uSeed: { value: seed },
            uDeep: { value: new THREE.Color('#0fc9c2') }, uShallow: { value: new THREE.Color('#52f8e8') } }]);   // queda: água aerada, mais clara que o rio
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
        // pedra molhada atrás da queda
        { const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]); u.uT = waterU;
          const wg = new THREE.PlaneGeometry(FW - 1, HT, 24, 1); { const p = wg.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, zf(p.getX(i)) + 0.15); }
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
                float a = (1.0 - smoothstep(0.55, 0.9, x)) * (0.4 + 0.25 * n) * smoothstep(0.0, 0.06, vUv.y);   // borda lisa (sem dentes)
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
                  a = min(1.0, vA * 1.6) * (1.0 - smoothstep(0.55, 1.0, r)) * smoothstep(0.0, 0.3, n + 0.7 * (1.0 - r)); }
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
        // textura da névoa: nuvem com ruído fractal (fiapos e falhas, não um disco liso), borda bem macia; o miolo levemente
        // mais escuro dá volume (a cor final vem da nuvem: branca em cima, azul-acinzentada rente à água)
        const smokeTex = (() => { const S = 128, c = TX.cvs(S, S), g = c.getContext('2d'), im = g.createImageData(S, S), d = im.data;
          const hsh = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7 + 17.3) * 43758.5453; return v - Math.floor(v); };
          const vno = (x, y) => { const i = Math.floor(x), j = Math.floor(y); let u = x - i, v = y - j; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
            return (hsh(i, j) * (1 - u) + hsh(i + 1, j) * u) * (1 - v) + (hsh(i, j + 1) * (1 - u) + hsh(i + 1, j + 1) * u) * v; };
          for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const x = i / S * 5, y = j / S * 5, k = (j * S + i) * 4;
            const f = vno(x, y) * 0.5 + vno(x * 2.1 + 3.1, y * 2.1 + 1.7) * 0.27 + vno(x * 4.3 + 7.7, y * 4.3 + 2.9) * 0.15 + vno(x * 8.9, y * 8.9 + 5.5) * 0.08;
            const r = Math.hypot(i - S / 2, j - S / 2) / (S / 2), fall = Math.max(0, 1 - r * r) ** 1.6;
            const a = Math.max(0, Math.min(1, (f * 1.4 - 0.1 + fall * 0.8) * fall));
            const sh = 0.74 + 0.26 * f; d[k] = 255 * sh; d[k + 1] = 255 * sh; d[k + 2] = 255 * Math.min(1, sh + 0.03); d[k + 3] = 255 * a * a * (3 - 2 * a); }
          g.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t; })();
        const fogZ = zf(0) + 4.2, puffs = [];
        // todas as nuvens num lote só (1 chamada de desenho); de perto cada nuvem some aos poucos (nearFade, no shader):
        // a câmera "entra" na neblina sem a tela ficar toda branca
        const mistSpr = makeSpriteBatch({ map: smokeTex, nearFade: true, order: 7 });
        // 3 camadas: 0 = borrifo que sobe colado na queda; 1 = nuvem que rola para a frente; 2 = névoa rasteira que desce o rio
        const LAY = [
          { col: 0xffffff, life: [3.5, 2.5], x: FW * 0.9, z: 1.8, vx: 4, vy: [4.5, 5], vz: [0.6, 1.8], s: [4, 11, 7], flat: 0.9, a: 0.4 },     // borrifo alto colado na queda
          { col: 0xf2f8fa, life: [6, 3], x: FW * 1.1, z: 3, vx: 6, vy: [0.8, 1.6], vz: [3, 3.8], s: [7, 18, 10], flat: 0.75, a: 0.32 },          // nuvem que rola para a frente
          { col: 0xdbe7ec, life: [10, 5], x: FW * 1.4, z: 3.5, vx: 7, vy: [0.15, 0.4], vz: [5, 5.5], s: [10, 26, 12], flat: 0.45, a: 0.28 },      // névoa rasteira que desce o rio
          { col: 0xffffff, life: [5, 3], x: FW * 0.7, z: 1.2, vx: 2.5, vy: [7, 6], vz: [0.2, 0.9], s: [6, 16, 8], flat: 1.15, a: 0.3 },         // coluna alta de vapor
          { col: 0xe9f3f6, life: [7, 4], x: FW * 1.2, z: 4.5, vx: 8, vy: [0.3, 0.7], vz: [1.5, 3], s: [8, 20, 10], flat: 0.55, a: 0.3 },
          { col: 0xf4f9fb, life: [8, 4], x: FW * 1.5, z: 5, vx: 5, vy: [0.5, 1.2], vz: [0.5, 2], s: [10, 24, 8], flat: 0.8, a: 0.25 } ];     // cortina densa sobre as pedras do poço     // base densa no poço
        const mkPuff = (L) => { const o = LAY[L], sp = mistSpr(o.col, 1, 0);
          return { sp, L, low: L === 2, life: o.life[0] + rnd() * o.life[1], ph: rnd(), x0: (rnd() - 0.5) * o.x, z0: fogZ + (rnd() - 0.5) * o.z,
            vx: (rnd() - 0.5) * o.vx, vy: o.vy[0] + rnd() * o.vy[1], vz: o.vz[0] + rnd() * o.vz[1], s0: o.s[0], s1: o.s[1] + rnd() * o.s[2], flat: o.flat,
            rot: (rnd() - 0.5) * 0.35, a: Math.min(1, o.a * (0.9 + rnd() * 0.3)), seed: rnd() * 100 }; };
        [[44, 26, 12], [38, 22, 10], [28, 16, 8], [24, 14, 6], [28, 16, 8], [30, 18, 8]].forEach((cnt, L) => { for (let k = 0; k < (LO ? cnt[2] : MID ? cnt[1] : cnt[0]); k++) puffs.push(mkPuff(L)); });
        mistSpr.finish();
        const _pv = new THREE.Vector3();
        tr.animated.push(t => { const gust = Math.sin(t * 0.23) * 0.6 + Math.sin(t * 0.61 + 1.3) * 0.3;   // brisa: a névoa toda balança devagar para os lados
          for (const q of puffs) {
          const age = ((t / q.life + q.ph) % 1), tau = age * q.life, k = 0.45, dr = (1 - Math.exp(-k * tau)) / k;   // arrasto: desacelera
          const tx = Math.sin(tau * 1.1 + q.seed) * 1.6 * age + gust * tau * 0.35, tz = Math.cos(tau * 0.9 + q.seed * 1.3) * 1.2 * age;
          _pv.set(q.x0 + q.vx * dr + tx, WATER_Y + 0.5 + q.vy * dr + Math.sin(tau * 0.8 + q.seed) * 0.4 * age, q.z0 + q.vz * dr + tz);
          wf.localToWorld(_pv); q.sp.position.copy(_pv);
          const s = q.s0 + (q.s1 - q.s0) * Math.sqrt(age); q.sp.scale.set(s, s * q.flat, 1);
          q.sp.material.rotation = q.seed + tau * q.rot;
          // aparece rápido e some devagar (nuvem se desfazendo), nunca uma parede branca: opacidade baixa e muitas camadas
          q.sp.userData.op = q.a * Math.min(1, age / 0.12) * Math.pow(1 - age, 1.2); q.sp.material.opacity = q.sp.userData.op; } });
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
          [].forEach(([x, z, s]) => {   // anéis de espuma desligados (eram as "pedrinhas" no poço) const f = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), ringM);
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
        pineForest(pines, 0.9); }
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
        if (SEA && SEA.e(x, z) < sh.rmax + SEA.BW + 80) return false;                  // laguinho não nasce perto do mar
        if (tr.shortcuts.length && shortcutDist(x, z) < sh.rmax + 14) return false;   // lago não nasce no atalho
        if (tr.vert) for (let k = 0; k <= 8; k++) { const a = k * 0.785, rr = k === 8 ? 0 : sh.rmax + 12; if (natH(x + Math.cos(a) * rr, z + Math.sin(a) * rr) > 0.5) return false; }   // laguinho só na parte plana
        if (nearTrack({ x, z }, sh.rmax + W + 10) || nearRiver(x, z, sh.rmax + 32) || Math.hypot(x - F.x, z - F.z) < sh.rmax + 40 || inMountain(x, z, sh.rmax + 8)) return false;
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
        afterGrid.push(() => { const bk = new THREE.Mesh(polyStrip(PNA, PC, (k, c) => { const a = ang(k), R = p.R(a), [d] = PROF[c], x = p.x + Math.cos(a) * (R + d), z = p.z + Math.sin(a) * (R + d); return [x, bankH(d, bankBase(x, z)), z, x / 3.5, z / 3.5]; }), bankM); bk.receiveShadow = true; add(bk); });
        { const bed = new THREE.Mesh(polyStrip(PNA, 9, (k, c) => { const a = ang(k), f = c / 8, R = (p.R(a) - 0.15) * f; return [p.x + Math.cos(a) * R, WATER_Y - bedDepth(f), p.z + Math.sin(a) * R, Math.cos(a) * R / 6, Math.sin(a) * R / 6]; }), bedM);   // bacia funda no meio
          bed.receiveShadow = true; bed.userData.noOutline = true; add(bed); }
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
      const okSpot = (x, z, m) => !ponds.some(p => pondEdge(p, x, z) < m) && bridges.every(b => Math.hypot(x - S[b].x, z - S[b].z) > 40) && !nearRiver(x, z, 14) && Math.hypot(x - F.x, z - F.z) > 45 && !inMountain(x, z, m + 4) && Math.hypot(x - S[si].x, z - S[si].z) > 22 && !(tr.shortcuts.length && shortcutDist(x, z) < m + 3)
        && !(SEA && SEA.e(x, z) < SEA.BW + 100 + m);   // praia + campo aberto até o mar: sem árvores nem enfeites (vista livre)
      // ---- malha do terreno com relevo (só quando a pista tem elev) ----
      waterDist = (x, z) => { let d = riverDist(x, z) - RHW; for (const q of ponds) d = Math.min(d, pondEdge(q, x, z)); return d; };
      // ---- terreno: bacia de areia dos lagos e do rio ----
      // margem RELATIVA ao chão de verdade (bankBase = grade da grama desenhada): sobe do chão local até o topo (0,85) com curva
      // suave. Antes a curva partia da altura 0 fixa; onde o chão era mais baixo (perto das pontes, ~25 cm) a borda da areia e a
      // faixa de grama ficavam acima dele -> linha de areia e degrau.
      const bankH = (e, g0) => e >= 10.4 ? -1e9 : e >= 10 ? g0 - 0.2 * (e - 10) : e >= 1.2 ? g0 + (0.85 - g0) * (u => u * u * (3 - 2 * u))((10 - e) / 8.8) : BANKP(e);
      const bank = (x, z) => { const g0 = bankBase(x, z); let h = -1e9; for (const q of ponds) h = Math.max(h, bankH(Math.hypot(x - q.x, z - q.z) - q.R(Math.atan2(z - q.z, x - q.x)), g0));
        let md = 1e9, mk = 0; for (let k = 0; k < rpts.length; k++) { const d = Math.hypot(rpts[k].x - x, rpts[k].z - z); if (d < md) { md = d; mk = k; } }
        const eR = md - rHW[mk]; let rb = bankH(eR, g0);
        if (SEA) { const q = SEA.info(x, z); if (q.e < q.bw + 25) { rb = q.e < q.bw - 2 ? -1e9 : seaBlendBank(rb, x, z, eR); h = Math.max(h, beachH(x, z, q, eR)); } }   // praia do mar
        return Math.max(h, rb); };
      // altura do chão fora do asfalto: relevo + bacia de areia; perto da pista (dist/u) segue exatamente a beira do asfalto
      const terrain = (x, z, dist, u) => { let g = gH(x, z); if (tr.vert && dist !== undefined && u !== undefined) { const w = sm(W + 5, W + 40, dist); if (w < 1) g = lerp(elevAt(u) - drop(dist), g, w); } return Math.max(g, bank(x, z)); };
      if (tr.vert) tr.heightAt = (x, z) => terrain(x, z);
      // superfície da grama exatamente como a faixa da beira da pista calcula (mistura com a altura do asfalto até W+40).
      // A grade do terreno usa a MESMA conta: antes, no lado de dentro das curvas fechadas, a faixa acabava antes de W+40 e a
      // grade ao lado tinha outra altura (degrau + vala) -> linha dura na grama.
      const surfAt = (x, z, withBank) => { const r = roadInfo(x, z); let g = gH(x, z, r);
        if (r.i >= 0 && r.d < W + 45) { const n = tr.nearest({ x, z }, r.i), w = sm(W + 5, W + 40, n.dist); if (w < 1) g = lerp(elevAt(n.i + n.f) - drop(n.dist), g, w); }
        return withBank ? Math.max(g, bank(x, z)) : g; };
      // normal da superfície por diferença central (2,5 m): grade e faixa ganham a mesma normal no mesmo ponto -> sem emenda
      // de luz. Antes cada malha calculava a própria normal (computeVertexNormals) e a borda da faixa "via" a saia que desce
      // 3 m para baixo da grama: a última fileira escurecia e virava um risco escuro paralelo à pista.
      const _sn = new THREE.Vector3();
      const surfNormal = (x, z, withBank) => { const e = 2.5, hx = surfAt(x + e, z, withBank) - surfAt(x - e, z, withBank), hz = surfAt(x, z + e, withBank) - surfAt(x, z - e, withBank);
        return _sn.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize(); };
      const gcol = (x, z) => { const m = 0.9 + 0.06 * Math.sin(x * 0.013 + 1.3) * Math.cos(z * 0.011) + 0.05 * Math.sin(x * 0.034 + z * 0.029) + 0.03 * Math.sin(x * 0.071 - z * 0.064 + 2), h = Math.sin(x * 0.009 - z * 0.012 + 0.7) * 0.5 + 0.5; return [m * (1 + 0.07 * h), m, m * (1 - 0.07 * 1.4 * h)]; };
      const grassUV = (x, z) => [(x + GS / 2) / 7, (-z + GS / 2) / 7];
      // ---- transição grama -> areia (margens do rio e dos laguinhos) ----
      // Uma faixa da MESMA grama do chão (mesma textura, mapeamento, tom e cor) cobre a parte de fora da rampa de areia e
      // termina numa borda recortada por ruído: a grama vai ficando rala, mais seca/amarelada e com falhas, e a areia aparece
      // em manchas. Antes a areia começava numa linha reta e dura.
      afterGrid.push(() => { const ovM = GfxFX.chain(grassTone(new THREE.MeshLambertMaterial({ map: TX.get('grass', 1, 1), vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })), 'bank-blend-v1', sh => {
          sh.vertexShader = 'attribute float aB;\nvarying float vB;\nvarying vec2 vBW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vB = aB; vBW = position.xz;');
          sh.fragmentShader = 'varying float vB;\nvarying vec2 vBW;\n' + sh.fragmentShader
            .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
              float bN = gfxN(vBW * 0.35) * 0.55 + gfxN(vBW * 1.3 + 5.0) * 0.3 + gfxN(vBW * 4.1 + 9.0) * 0.15;
              float bE = vB + (bN - 0.5) * 0.75 * smoothstep(0.08, 0.4, vB);                // perto da borda de fora a grama é inteira (sem furos)
              if (bE > 0.66) discard;                                                       // borda recortada
              if (bE > 0.36 && gfxN(vBW * 2.7 + 3.0) * 0.7 + gfxN(vBW * 9.0) * 0.3 < (bE - 0.36) * 3.0) discard;   // grama rala, com falhas`)
            .replace('#include <color_fragment>', `#include <color_fragment>
              diffuseColor.rgb *= mix(vec3(1.0), vec3(1.1, 1.03, 0.78), smoothstep(0.15, 0.62, bE)) * mix(1.0, 0.86, smoothstep(0.3, 0.66, bE));   // mais seca e com sombra de terra perto da areia`); });
        const COLS = 10, D0 = 10, D1 = 1.0;   // cobre a parte de fora da margem (que começa no chão a 10 m da água)
        const band = (rows, at) => { const pos = [], uv = [], col = [], nor = [], ab = [], idx = [], zone = [];
          for (let k = 0; k <= rows; k++) for (let c = 0; c <= COLS; c++) { const f = c / COLS, dd = D0 + (D1 - D0) * f, [x, z, nx, nz] = at(k, dd), g0 = bankBase(x, z), h = bankH(dd, g0) + 0.01 + 0.02 * f;   // segue a areia, que parte do chão de verdade: na borda de fora fica rente à grama
            pos.push(x, h, z); const t = grassUV(x, z); uv.push(t[0], t[1]); col.push(...gcol(x, z)); ab.push(f); zone.push(!!SEA && (q => q.e < q.bw + 25)(SEA.info(x, z)));
            const d2 = Math.min(dd + 0.1, 10), sl = (bankH(dd - 0.1, g0) - bankH(d2, g0)) / (d2 - dd + 0.1), l = Math.hypot(sl, 1); nor.push(nx * sl / l, 1 / l, nz * sl / l); }   // normal da curva da margem (na borda de fora: reta, igual à grama do chão)
          for (let k = 0; k < rows; k++) for (let c = 0; c < COLS; c++) { const a = k * (COLS + 1) + c, d = a + COLS + 1; if (zone[a] || zone[a + 1] || zone[d] || zone[d + 1]) continue; idx.push(a, d, a + 1, a + 1, d, d + 1); }
          // todo triângulo virado para CIMA: num lado do rio a ordem dos vértices sai espelhada e a face de trás aparecia
          // (o Lambert ilumina a face de trás com a normal invertida -> faixa verde-escura)
          for (let q = 0; q < idx.length; q += 3) { const A = idx[q] * 3, B = idx[q + 1] * 3, Cc = idx[q + 2] * 3;
            const ux = pos[B] - pos[A], uz = pos[B + 2] - pos[A + 2], vx = pos[Cc] - pos[A], vz = pos[Cc + 2] - pos[A + 2];
            if (uz * vx - ux * vz < 0) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; } }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aB', new THREE.Float32BufferAttribute(ab, 1)); g.setIndex(idx);
          const m = new THREE.Mesh(g, ovM); m.receiveShadow = true; m.userData.noOutline = true; m.userData.dynamic = true; add(m); };
        // rio (os dois lados): (x, z) na distância dd além da beira d'água e a direção para fora (a rampa sobe em direção à água)
        [1, -1].forEach(sg => band(RM, (k, dd) => { const p = rpts[k], t = rtan[k], hw = rHW[k]; return [p.x + t.z * sg * (hw + dd), p.z - t.x * sg * (hw + dd), t.z * sg, -t.x * sg]; }));
        ponds.forEach(q => band(PNA, (k, dd) => { const a = (k % PNA) / PNA * 6.2832, R = q.R(a); return [q.x + Math.cos(a) * (R + dd), q.z + Math.sin(a) * (R + dd), Math.cos(a), Math.sin(a)]; }));
        // ---- praia do mar: mesma faixa de grama, mais larga (34 m), por cima da parte de fora da areia ----
        // aB = 0 na borda de fora (grama inteira, emenda com o chão) -> 1 lá dentro: a grama vai ficando rala, seca e em
        // manchas, a areia aparece aos poucos (antes: linha reta grama/areia)
        if (SEA && SEA.lats) { const LS = SEA.lats, NCs = LS.length, ER = [3, 1.2, 0, -2, -5, -9, -13, -18, -24, -32, -38], SC = ER.length - 1, SW = 34, pos = [], uv = [], col = [], nor = [], ab = [], idx = [], skip = [];
          LS.forEach(l => { const bw = SEA.bwAt(l), mouth = SEA.nearMouth(l);
            // fileiras nas MESMAS distâncias da areia (b, b-2, b-5...): as duas malhas dobram nos mesmos pontos e a areia
            // nunca fura a grama; fora da praia (b+3, b+1,2) a faixa fica rente ao chão, cobrindo a borda enterrada da areia
            for (let c = 0; c <= SC; c++) { const e = bw + ER[c], f = Math.max(0, Math.min(1.15, -ER[c] / SW)), [x, z] = SEA.at(l, e), eR = mouth ? SEA.riverEdge(x, z) : 99;
              const h = e > bw ? bankBase(x, z) + 0.03 : SEA.beachH(x, z, { e, l, bw }, eR < 15 ? eR : undefined) + 0.01 + 0.02 * Math.min(1, f);
              pos.push(x, h, z); const t = grassUV(x, z); uv.push(t[0], t[1]); col.push(...gcol(x, z)); ab.push(f); nor.push(0, 1, 0); skip.push(eR < 14); } });
          for (let i = 0; i < NCs - 1; i++) for (let c = 0; c < SC; c++) { const a = i * (SC + 1) + c, b = a + SC + 1;
            if (skip[a] || skip[a + 1] || skip[b] || skip[b + 1]) continue; idx.push(a, b, a + 1, a + 1, b, b + 1); }   // nada de grama no canal do rio
          for (let q = 0; q < idx.length; q += 3) { const A = idx[q] * 3, B = idx[q + 1] * 3, Cc = idx[q + 2] * 3;
            const ux = pos[B] - pos[A], uz = pos[B + 2] - pos[A + 2], vx = pos[Cc] - pos[A], vz = pos[Cc + 2] - pos[A + 2];
            if (uz * vx - ux * vz < 0) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; } }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aB', new THREE.Float32BufferAttribute(ab, 1)); g.setIndex(idx);
          g.computeBoundingSphere(); const m = new THREE.Mesh(g, ovM); m.receiveShadow = true; m.userData.noOutline = true; m.userData.dynamic = true; m.frustumCulled = false; add(m); }
      });                // mesmo mapeamento do chão grande (sem emenda)
      const nearBridge = i => bridges.some(b => { const d = Math.abs(((i - b) % N + N + N / 2) % N - N / 2); return d <= BR.END + 2; });
      // alturas EXATAS das malhas de grama desenhadas (grade + faixas da beira), para a física, os enfeites e os atalhos
      // pousarem no chão que aparece na tela (a malha é plana entre vértices; a conta analítica fica até ~17 cm fora dela)
      const RG = tr.vert ? { grid: null, strip: {} } : null;
      // interpolação nos triângulos da grade (diagonal de (i+1,j) a (i,j+1), igual ao índice da malha)
      const triAt = (G, Yv, x, z) => { const fx = (x - G.x0) / G.cs, fz = (z - G.z0) / G.cs, i = Math.floor(fx), j = Math.floor(fz);
        if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) return -0.6; const u = fx - i, v = fz - j, a = j * (G.nx + 1) + i, b = a + 1, c = a + G.nx + 1, d = c + 1;
        return u + v <= 1 ? Yv[a] + u * (Yv[b] - Yv[a]) + v * (Yv[c] - Yv[a]) : Yv[d] + (1 - u) * (Yv[c] - Yv[d]) + (1 - v) * (Yv[b] - Yv[d]); };
      let gridRawAt = () => 0;
      if (tr.vert) {
        // largura da faixa da beira em cada nó e lado (no lado de dentro das curvas fechadas ela é mais curta)
        const Rloc = i => { const a = T[(i - 3 + N) % N], b = T[(i + 3) % N], cr = a.x * b.z - a.z * b.x, ang = Math.asin(Math.max(-1, Math.min(1, cr))), len = 6 * L.length / N; return { R: Math.abs(ang) > 1e-4 ? len / Math.abs(ang) : 1e9, sg: Math.sign(cr) }; };
        // ===== GRAMA = grade (relevo) + faixa estreita na beira da pista =====
        // A grade só afunda os vértices que ficam EMBAIXO do asfalto/zebra. Um triângulo de grade "puxado" por um vértice afundado
        // vai até ~1 diagonal de célula para fora; a faixa da beira cobre exatamente essa zona (oS) e termina EM CIMA da grade
        // (mesma altura dos triângulos da grade, +3 cm). Antes a grade afundava até 40 m da pista e, onde a faixa acabava
        // (lado de dentro das curvas), sobravam valas, buracos e pedaços da "saia" da faixa furando os atalhos.
        // DINF = até onde (a partir da zebra) um triângulo da grade pode estar puxado para baixo; a faixa fica ACIMA da grade até
        // DINF+0,5 e depois mergulha embaixo dela (as duas têm a mesma textura, cor e normal: a troca não aparece)
        const CELL = LO ? 13 : MID ? 13 : 10, DINF = CELL * 1.42 + 0.4, oS = W + CB + DINF + 3.5;   // oS cabe até na curva mais fechada (0,8 x raio)
        const oMaxAt = (i, sg) => { const rl = Rloc(i), inner = rl.sg !== 0 && Math.sign(-rl.sg) === sg; return inner ? Math.max(W + 8, Math.min(oS, 0.8 * rl.R)) : oS; };
        const terrM = grassTone(new THREE.MeshLambertMaterial({ map: TX.get('grass', 1, 1), vertexColors: true }));
        const stripM = grassTone(new THREE.MeshLambertMaterial({ map: TX.get('grass', 1, 1), vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));   // faixa ganha da grade onde as duas se encostam
        { const pad = 420, x0 = L.bbox.x0 - pad, x1 = L.bbox.x1 + pad, z0 = L.bbox.z0 - pad, z1 = L.bbox.z1 + pad;
          const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL), pos = new Float32Array((nx + 1) * (nz + 1) * 3), uv = new Float32Array((nx + 1) * (nz + 1) * 2), col = new Float32Array(pos.length), idx = [], rawY = new Float32Array((nx + 1) * (nz + 1));
          for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * CELL, z = z0 + j * CELL, k = j * (nx + 1) + i, r = roadInfo(x, z);
            let h = surfAt(x, z, false); rawY[k] = h;
            if (r.d < W + 40) {
              if (nearBridge(r.i)) { if (r.d < W + 6) h = Math.min(h, H[r.i] - drop(r.d) - (r.d < W + CB + 0.2 ? 0.3 : 0)); }   // nunca acima da beira do asfalto (só rente à pista: mais longe a grade afundava ~25 cm e a borda da areia aparecia como uma linha)
              else if (r.d < W + 12) { const n = tr.nearest({ x, z }, r.i); if (n.dist < W + CB + 0.4) h = Math.min(h, elevAt(n.i + n.f) - 1.2); } }   // só embaixo do asfalto/zebra
            if (i === 0 || j === 0 || i === nx || j === nz) h = rawY[k] = -0.6;           // borda escondida embaixo do chão grande
            pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z; const t = grassUV(x, z); uv[k * 2] = t[0]; uv[k * 2 + 1] = t[1]; const c = gcol(x, z); col.set(c, k * 3); }
          for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
          RG.grid = { x0, z0, cs: CELL, nx, nz, pos, rawY };
          gridRawAt = (x, z) => triAt(RG.grid, RG.grid.rawY, x, z); bankBase = gridRawAt;
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
          { const nr = g.attributes.normal.array;                                         // normais da superfície (lisas e iguais às da faixa da beira)
            for (let j = 1; j < nz; j++) for (let i = 1; i < nx; i++) { const k = j * (nx + 1) + i, x = pos[k * 3], z = pos[k * 3 + 2];
              if (roadInfo(x, z).d > W + 175) { nr[k * 3] = 0; nr[k * 3 + 1] = 1; nr[k * 3 + 2] = 0; continue; }   // planície
              const n = surfNormal(x, z, false); nr[k * 3] = n.x; nr[k * 3 + 1] = n.y; nr[k * 3 + 2] = n.z; } }
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
        [1, -1].forEach(sg => {
          const OFF = [0, 1.5, 3.3, 5.5, 8.6, 12, DINF + 0.5, DINF + 3.5], FR = OFF.map(v => v / OFF[OFF.length - 1]), C = FR.length + 1, LIFT = 0.18, pos = [], uv = [], col = [], idx = [], STEP = 2, rows = [];
          for (let i = 0; i <= N; i += STEP) rows.push(i % N);
          const oMR = [], skipR = rows.map(i => nearBridge(i));
          rows.forEach(i => { const oMax = oMaxAt(i, sg); oMR.push(oMax);
            FR.concat([1.15]).forEach((f, c) => { const o = c < FR.length ? W + CB + (oMax - W - CB) * f : oMax + 3, p = side(i, sg * o, 0); let h;
              if (c === 0) h = terrain(p.x, p.z, o, i) - 0.02;                                // rente à zebra: altura exata da beira do asfalto
              else if (c < FR.length - 2) { h = Math.max(terrain(p.x, p.z, o, i), gridRawAt(p.x, p.z)) + (c === 1 ? 0.06 : c === 2 ? 0.12 : 0.15); const bk = bank(p.x, p.z); if (bk > gridRawAt(p.x, p.z) + 0.015) h = Math.min(h, bk - 0.04); }   // margem de lago perto da pista: a faixa passa por baixo da areia   // acima da grade (ela dobra até ~15 cm entre vértices), subindo aos poucos a partir da zebra
              else if (c === FR.length - 2) { h = gridRawAt(p.x, p.z) + 0.02; const bk = bank(p.x, p.z); if (bk > gridRawAt(p.x, p.z) + 0.015) h = Math.min(h, bk - 0.04); }                // já fora da zona afundada: desce suave até a grade (sem degrau -> o pós-efeito não desenha linha/sombra)
              else if (c === FR.length - 1) h = gridRawAt(p.x, p.z) - 0.3;                 // borda: já embaixo da grade inteira (sem vala, sem degrau)
              else h = gridRawAt(p.x, p.z) - 0.8;                                          // saia escondida
              pos.push(p.x, h, p.z); const t = grassUV(p.x, p.z); uv.push(t[0], t[1]); col.push(...gcol(p.x, p.z)); }); });
          for (let r = 0; r < rows.length - 1; r++) { if (nearBridge(rows[r]) || nearBridge(rows[r + 1])) continue; for (let c = 0; c < C - 1; c++) { const a = r * C + c, d = a + C; if (sg > 0) idx.push(a, d, a + 1, a + 1, d, d + 1); else idx.push(a, a + 1, d, a + 1, d + 1, d); } }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
          { const nr = g.attributes.normal.array, pp = g.attributes.position.array;     // fileiras visíveis: normal da superfície (a saia, escondida, fica com a da malha)
            for (let r = 0; r < rows.length; r++) for (let c = 1; c < FR.length; c++) { const k = r * C + c, n = surfNormal(pp[k * 3], pp[k * 3 + 2], true); nr[k * 3] = n.x; nr[k * 3 + 1] = n.y; nr[k * 3 + 2] = n.z; } }
          RG.strip[sg] = { FR, C, step: STEP, oMR, skipR, Y: pos.filter((_, q) => q % 3 === 1) };
          const m = new THREE.Mesh(g, stripM); m.receiveShadow = true; m.userData.noOutline = true; add(m); });
      }
      // ---- vida embaixo d'água (rio e laguinhos): pedras no leito e tufos de plantas aquáticas balançando ----
      // aparecem através da água translúcida, mais escuras/esverdeadas quanto mais fundo (uwFX) e com a cáustica passando
      { const rockG = new THREE.DodecahedronGeometry(1, 1), rp = rockG.attributes.position;
        for (let i = 0; i < rp.count; i++) { const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i), h = Math.sin(Math.round(x * 97) * 12.9898 + Math.round(y * 97) * 78.233 + Math.round(z * 97) * 37.719) * 43758.5453, k = 0.82 + 0.3 * (h - Math.floor(h)); rp.setXYZ(i, x * k, y * k * 0.62, z * k); }
        rockG.computeVertexNormals();
        const Lam = (window.Toon && Toon.Lambert) || THREE.MeshLambertMaterial;
        const rockM = uwFX(new Lam({ color: 0xffffff, flatShading: true }), 'rock'); rockM.userData.noToon = true;
        // folha de planta aquática: 4 lâminas finas, curvadas, saindo do mesmo ponto
        const weedG = (() => { const P = [], NN = []; for (let b = 0; b < 4; b++) { const a = b / 4 * 6.283 + 0.4, ca = Math.cos(a), sa = Math.sin(a), lean = 0.18 + b * 0.05, SEG = 4;
            for (let j = 0; j < SEG; j++) { const y0 = j / SEG, y1 = (j + 1) / SEG, w0 = 0.07 * (1 - y0), w1 = 0.07 * (1 - y1), o0 = lean * y0 * y0, o1 = lean * y1 * y1;
              const A = [ca * o0 - sa * w0, y0, sa * o0 + ca * w0], B = [ca * o0 + sa * w0, y0, sa * o0 - ca * w0], C = [ca * o1 - sa * w1, y1, sa * o1 + ca * w1], D = [ca * o1 + sa * w1, y1, sa * o1 - ca * w1];
              [A, B, C, B, D, C].forEach(v => { P.push(...v); NN.push(ca * 0.5, 0.8, sa * 0.5); }); } }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(NN, 3)); return g; })();
        const weedM = uwFX(GfxFX.foliage(new Lam({ color: 0xffffff, side: THREE.DoubleSide }), { amp: 0.22, h0: 0.0, freq: 0.9 }), 'weed'); weedM.userData.noToon = true;
        const rocks = [], weeds = [];
        const addSpot = (x, z, depth, e) => { const by = WATER_Y - depth;
          if (rnd() < 0.55) { const n = 1 + (rnd() * 3 | 0); for (let j = 0; j < n; j++) { const s = Math.min(0.25 + rnd() * 0.9, Math.max(0.15, (depth - 0.18) / 0.62));   // topo sempre embaixo d'água
              rocks.push({ x: x + (rnd() - 0.5) * 1.6, z: z + (rnd() - 0.5) * 1.6, y: by + s * 0.12, s, r: rnd() * 6.28, c: [0x7d776e, 0x6a655c, 0x8a8478, 0x5f6b55, 0x726a5a][rnd() * 5 | 0] }); } }
          if (e > 0.3 && e < 0.9 && rnd() < 0.7) { const n = 3 + (rnd() * 4 | 0); for (let j = 0; j < n; j++) { const h = Math.min(0.5 + rnd() * 0.8, depth - 0.12);
              if (h > 0.15) weeds.push({ x: x + (rnd() - 0.5) * 1.4, z: z + (rnd() - 0.5) * 1.4, y: by - 0.05, h, s: 0.8 + rnd() * 0.6, r: rnd() * 6.28, c: [0x3f6b2a, 0x4f7d2f, 0x355f2c, 0x5d8a3a][rnd() * 4 | 0] }); } } };
        for (let k = 3; k < RM - 2; k++) for (let m = 0; m < 2; m++) { const u = (rnd() * 2 - 1) * 0.86, e = Math.abs(u), hw = Math.max(0, rHW[k] - 0.15), p = rpts[k], t = rtan[k];
          if (hw < 2) continue; addSpot(p.x + t.z * hw * u, p.z - t.x * hw * u, bedDepth(e), e); }
        ponds.forEach(q => { for (let k = 0; k < Math.round(q.r * 2.2); k++) { const a = rnd() * 6.283, f = Math.sqrt(rnd()) * 0.86, R = (q.R(a) - 0.15) * f; addSpot(q.x + Math.cos(a) * R, q.z + Math.sin(a) * R, bedDepth(f), f); } });
        const d = new THREE.Object3D(), c = new THREE.Color();
        rocks.length = 0; weeds.length = 0;   // desligado: com a água opaca não aparecem direito (viravam "pedrinhas" estranhas) e só custavam
        if (rocks.length) { const im = new THREE.InstancedMesh(rockG, rockM, rocks.length);
          rocks.forEach((o, i) => { d.position.set(o.x, o.y, o.z); d.rotation.set(0, o.r, 0); d.scale.set(o.s * (0.9 + rnd() * 0.4), o.s, o.s * (0.8 + rnd() * 0.4)); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, c.set(o.c)); });
          im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.receiveShadow = true; im.userData.noOutline = true; add(im); }
        if (weeds.length) { const im = new THREE.InstancedMesh(weedG, weedM, weeds.length);
          weeds.forEach((o, i) => { d.position.set(o.x, o.y, o.z); d.rotation.set(0, o.r, 0); d.scale.set(o.s, o.h, o.s); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, c.set(o.c)); });
          im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.userData.noOutline = true; add(im); }
        console.info('[água] fundo visível:', rocks.length, 'pedras e', weeds.length, 'plantas embaixo d\'água'); }
      afterGrid.forEach(f => f());                                                         // areia das margens + faixa de grama (seguem a grade)
      // altura da grade desenhada (mesma divisão dos triângulos: diagonal de (i+1,j) a (i,j+1))
      const gridAt = (x, z) => { const G = RG.grid, fx = (x - G.x0) / G.cs, fz = (z - G.z0) / G.cs, i = Math.floor(fx), j = Math.floor(fz);
        if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) return -0.6; const u = fx - i, v = fz - j, Y = k => G.pos[k * 3 + 1], a = j * (G.nx + 1) + i, b = a + 1, c = a + G.nx + 1, d = c + 1;
        return u + v <= 1 ? Y(a) + u * (Y(b) - Y(a)) + v * (Y(c) - Y(a)) : Y(d) + (1 - u) * (Y(c) - Y(d)) + (1 - v) * (Y(b) - Y(d)); };
      // altura da faixa da beira desenhada (fileiras a cada STEP nós, colunas em FR); null fora dela
      const stripAt = n => { const sg = Math.sign(n.lat) || 1, Sd = RG.strip[sg]; if (!Sd) return null; const o = Math.abs(n.lat), ru = (n.i + n.f) / Sd.step, r0 = Math.floor(ru), r1 = r0 + 1, t = ru - r0;
        if (r1 >= Sd.oMR.length || Sd.skipR[r0] || Sd.skipR[r1]) return null;
        const col = r => { const f = (o - W - CB) / (Sd.oMR[r] - W - CB); if (f < 0 || f > 1) return null; let c = 0; while (c < Sd.FR.length - 2 && Sd.FR[c + 1] < f) c++;
          const w = (f - Sd.FR[c]) / (Sd.FR[c + 1] - Sd.FR[c]), y0 = Sd.Y[r * Sd.C + c], y1 = Sd.Y[r * Sd.C + c + 1]; return y0 + (y1 - y0) * w; };
        const a = col(r0), b = col(r1); if (a === null || b === null) return null; return a + (b - a) * t; };
      // chão VISÍVEL no ponto: o mais alto entre grade e faixa da beira (embaixo da faixa a grade fica afundada) e a areia das margens
      const visGround = (x, z, hint) => { if (!RG || !RG.grid) return terrain(x, z);
        const r = roadInfo(x, z); if (r.d > W + 50) return Math.max(gridAt(x, z), bank(x, z));   // longe da pista: só a grade (sem busca do nó)
        if (hint === undefined || hint < 0) hint = r.i; const n = tr.nearest({ x, z }, Math.max(0, hint | 0)), st = n.dist < W + 45 ? stripAt(n) : null;
        return Math.max(gridAt(x, z), st === null ? -1e9 : st, bank(x, z)); };
      if (tr.vert) tr.heightAt = (x, z) => { const sg = tr.shortcuts.length ? tr.shortcutGround(x, z) : null; const vg = visGround(x, z); return sg !== null ? Math.max(sg, vg) : vg; };   // a beira do atalho mergulha embaixo da grama: vale o mais alto
      // altura do chão para enfeites: perto da pista usa a mesma conta da faixa da beira (terrain com dist/u),
      // senão os enfeites ficavam flutuando (ou enterrados) nas subidas e descidas
      const gy = (x, z) => { const r = roadInfo(x, z); if (tr.vert) return visGround(x, z, r.i);
        if (r.i < 0 || r.d > W + 45) return terrain(x, z);
        const n = tr.nearest({ x, z }, r.i); return terrain(x, z, n.dist, n.i + n.f); };
      // ---- postes de luz: lampião clássico grande (base de pedra em degraus, coluna de ferro torneada com anéis dourados,
      //      braço em "pescoço de cisne" com voluta e lanterna com vidro, capelo e pináculo) ----
      // Todos os postes são assados em 4 malhas (pedra, ferro, dourado e vidro): poucas chamadas de desenho.
      // À noite eles ILUMINAM de verdade: um conjunto fixo de SpotLights (quente, com penumbra) é levado para os postes
      // mais perto da câmera, trocando com fade (o número de luzes nunca muda: sem recompilar shader). Além disso:
      // poça de luz no chão (queda física cos³/d²), feixe volumétrico sutil, halo na lanterna e brilho grande em volta.
      const NIGHT = () => (window.Env && Env.nightF) || 0;
      { const LM = LampPost.materials();
        LM.glass.userData.unique = true; tr.nightMats.push({ m: LM.glass, max: 1.9, min: 0.12 });
        const ARM = LampPost.ARM, LAMPY = LampPost.LAMPY, SPACING = LO ? 36 : 28, LG = LampPost.geometries();
        const bake = { base: [], iron: [], trim: [], glass: [] }, _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
        const put = (key, geo, M, x, y, z, rx, ry, rz) => { _l.compose(V3(x, y, z), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0)), V3(1, 1, 1)); const g = (geo.index ? geo.toNonIndexed() : geo.clone()); g.applyMatrix4(_m.copy(M).multiply(_l)); bake[key].push(g); };
        const heads = [], halos = [], auras = [];
        for (let i = 15; i < N; i += SPACING) { if (bridges.some(b => Math.abs(i - b) < 14)) continue;
          const sd = ((i / SPACING | 0) % 2 ? 1 : -1), q = side(i, sd * (W + CB + 2.6), 0); if (tr.shortcuts.length && shortcutDist(q.x, q.z) < 4) continue;
          if (def.wall && sd < 0 && i >= def.wall[0] - 3 && i <= def.wall[1] + 3) continue;
          const y0 = gy(q.x, q.z) - 0.1, dx = -sd * T[i].z, dz = sd * T[i].x, ang = Math.atan2(-dz, dx);   // +x local aponta para a pista
          const M = new THREE.Matrix4().compose(V3(q.x, y0, q.z), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), ang), V3(1, 1, 1));
          LampPost.place(LG, put, M); const ly = LAMPY;
          const wx = q.x + dx * ARM, wz = q.z + dz * ARM;
          const h = glowSpr(0xfff0d0, 1.6, 0); h.position.set(wx, y0 + ly, wz); halos.push(h);
          const au = glowSpr(0xffb766, 6, 0); au.position.set(wx, y0 + ly - 0.1, wz); auras.push(au);
          const ni = tr.nearest({ x: wx, z: wz }, i);
          heads.push({ x: wx, y: y0 + ly - 0.4, z: wz, g: (ni.dist < W + CB ? tr.roadBase + hAt(ni.i + ni.f) : gy(wx, wz)) });
          tr.obstacles.push({ x: q.x, z: q.z, r: 0.75 }); }
        // malhas assadas (posições, normais e uv somadas)
        LampPost.merge(bake, LM).forEach(m => { m.userData.dynamic = true; add(m); });
        Object.values(LG).forEach(g => g.dispose());
        // ---- LUZ DE VERDADE: SpotLights levados para os postes mais próximos da câmera ----
        if (heads.length) {
          const NL = Math.min(heads.length, LO ? 3 : MID ? 4 : 6), pool = [];
          for (let k = 0; k < NL; k++) { const L = new THREE.SpotLight(0xffc685, 0, 62, 1.0, 0.75, 1.4); L.castShadow = false; L.userData.dynamic = true;
            L.target.userData.dynamic = true; add(L); add(L.target); pool.push({ L, cur: -1, k: 0 }); }
          let physical = false, acc = 0;
          const hook = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()); hook.frustumCulled = false; hook.userData.dynamic = true; hook.userData.noOutline = true;
          hook.onBeforeRender = r => { physical = !!r.physicallyCorrectLights; }; add(hook);
          const place = (p, hi) => { const H = heads[hi]; p.cur = hi; p.L.position.set(H.x, H.y, H.z); p.L.target.position.set(H.x, H.g, H.z); p.L.target.updateMatrixWorld(); };
          tr.animated.push((t, dt) => { dt = dt || 0.016; const nf = NIGHT(), cam = window.Fx && Fx.cam;
            acc -= dt; if (acc <= 0 && cam) { acc = 0.2; const e = cam.matrixWorld.elements, cx = e[12], cz = e[14];
              const want = heads.map((H, hi) => [hi, (H.x - cx) ** 2 + (H.z - cz) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, NL).map(a => a[0]);
              pool.forEach(p => { p.want = want.includes(p.cur); });
              const free = want.filter(hi => !pool.some(p => p.cur === hi));
              pool.forEach(p => { if (!p.want && p.k < 0.02 && free.length) { place(p, free.shift()); p.want = true; } }); }
            const base = physical ? 420 : 2.6;
            pool.forEach(p => { p.k = Math.max(0, Math.min(1, p.k + (p.want && p.cur >= 0 ? 3 : -3) * dt)); p.L.intensity = base * nf * p.k * (0.97 + 0.03 * Math.sin(t * 9 + p.cur)); p.L.decay = physical ? 2 : 1.4; });
          });
        }
        // ---- poça de luz no chão e feixe volumétrico (2 chamadas para todos os postes) ----
        if (heads.length) {
          const LU = { uNight: { value: 0 }, uCol: { value: new THREE.Color(0xffd29a) } };
          const fogU = () => THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
          const mkMat = (vs, fs, extra) => { const m = new THREE.ShaderMaterial(Object.assign({ uniforms: Object.assign(fogU(), LU), vertexShader: vs, fragmentShader: fs,
            transparent: true, depthWrite: false, fog: true, blending: THREE.AdditiveBlending }, extra || {})); m.userData.unique = true; return m; };
          { const R = 20, pos = [], q = [], hh = [], idx = [];
            heads.forEach((L, k) => { const y = L.g + 0.07, H = Math.max(3, L.y - L.g);
              [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => { pos.push(L.x + a * R, y, L.z + b * R); q.push(a * R, b * R); hh.push(H); });
              const o = k * 4; idx.push(o, o + 2, o + 1, o, o + 3, o + 2); });
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aQ', new THREE.Float32BufferAttribute(q, 2));
            g.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1)); g.setIndex(idx); g.computeBoundingSphere();
            const m = mkMat(['attribute vec2 aQ; attribute float aH; varying vec2 vQ; varying float vH;', '#include <fog_pars_vertex>',
              'void main() { vQ = aQ; vH = aH; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;', '#include <fog_vertex>', '}'].join('\n'),
              ['uniform float uNight; uniform vec3 uCol; varying vec2 vQ; varying float vH;', '#include <fog_pars_fragment>',
               'void main() { float d = length(vQ), e = pow(1.0 + (d * d) / (vH * vH), -1.5) * (1.0 - smoothstep(0.35 * ' + R.toFixed(1) + ', ' + R.toFixed(1) + ', d));',
               '  e += 0.25 * exp(-d * d / (vH * vH * 0.08));',                                  // ponto quente bem embaixo da lanterna
               '  gl_FragColor = vec4(uCol * e * 0.55 * uNight, 1.0); if (e * uNight < 0.002) discard;', FOG_ADD, '}'].join('\n'),
              { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
            const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 1; mesh.userData.dynamic = true; mesh.userData.noOutline = true; add(mesh); }
          { const SEG = 24, RT = 0.34, pos = [], nor = [], tt = [], idx = [];
            heads.forEach(L => { const H = Math.max(3, L.y - L.g - 0.05), RB = Math.min(8, 0.72 * H), b0 = pos.length / 3, sl = (RB - RT) / H;
              for (let r = 0; r < 2; r++) for (let j = 0; j <= SEG; j++) { const a = j / SEG * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a), rad = r ? RB : RT;
                pos.push(L.x + c * rad, r ? L.y - H : L.y, L.z + s2 * rad); const n = new THREE.Vector3(c, sl, s2).normalize(); nor.push(n.x, n.y, n.z); tt.push(r); }
              for (let j = 0; j < SEG; j++) { const a = b0 + j, b = a + 1, c = a + SEG + 1, d = c + 1; idx.push(a, c, b, b, c, d); } });
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
            g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1)); g.setIndex(idx); g.computeBoundingSphere();
            const m = mkMat(['attribute float aT; varying float vT; varying vec3 vN; varying vec3 vV;', '#include <fog_pars_vertex>',
              'void main() { vT = aT; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz);',
              '  gl_Position = projectionMatrix * mvPosition;', '#include <fog_vertex>', '}'].join('\n'),
              ['uniform float uNight; uniform vec3 uCol; varying float vT; varying vec3 vN; varying vec3 vV;', '#include <fog_pars_fragment>',
               'void main() { float face = abs(dot(normalize(vN), normalize(vV)));',
               '  float fall = pow(1.0 - vT, 1.6) * smoothstep(0.0, 0.05, vT) + 0.1 * (1.0 - vT);',
               '  float a = fall * face * face * 0.11 * uNight;', '  if (a < 0.0015) discard;', '  gl_FragColor = vec4(uCol * a, 1.0);', FOG_ADD, '}'].join('\n'),
              { side: THREE.DoubleSide });
            const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 8; mesh.userData.dynamic = true; mesh.userData.noOutline = true; mesh.frustumCulled = false; add(mesh); }
          tr.animated.push(t => { const nf = NIGHT(); LU.uNight.value = nf;
            halos.forEach((h, k) => { h.material.opacity = 0.95 * nf; h.scale.setScalar(1.3 + 0.6 * nf); });
            auras.forEach((a, k) => { a.material.opacity = 0.32 * nf * (0.96 + 0.04 * Math.sin(t * 7 + k)); a.scale.setScalar(5 + 2.5 * nf); }); });
        }
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
      // só pinheiros: as árvores antigas de bolas (verde, verde-escura e de outono) viraram pinheiros nos mesmos lugares
      if (window.Pines) pineForest(lists.round.concat(lists.dark, lists.pine, lists.autumn), 1.0);
      else { plants('round', lists.round, 0x4fae3a); plants('round', lists.dark, 0x2f8a35); plants('pine', lists.pine, 0x2a7a3a); plants('round', lists.autumn, 0xe8892f); }
      plants('bush', lists.bush, 0x3f9e2c);
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
        // terra do atalho: textura própria (sem direção) em coordenada do mundo; a borda é recortada no shader pela distância
        // à beira do caminho (atributo aS) + ruído -> contorno irregular e natural, que puxa para o verde/seco perto da grama
        const dirtM = GfxFX.chain(new THREE.MeshLambertMaterial({ map: GfxFX.aniso(TX.get('trail', 1, 1), 16), vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), 'trail-edge-v1', sh => {
          sh.vertexShader = 'attribute float aS;\nvarying float vTS;\nvarying vec2 vTW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vTS = aS; vTW = position.xz;');
          sh.fragmentShader = GfxFX.NOISE + 'varying float vTS;\nvarying vec2 vTW;\n' + sh.fragmentShader
            .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
              float tE = vTS + (gfxN(vTW * 0.45) - 0.5) * 1.1 + (gfxN(vTW * 1.7 + 7.0) - 0.5) * 0.5 + (gfxN(vTW * 5.3 + 3.0) - 0.5) * 0.18;
              if (tE > 0.0) discard;`)
            .replace('#include <map_fragment>', `#include <map_fragment>
              diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 0.96, 0.7), smoothstep(-1.1, 0.0, tE) * 0.6);`); });
        // grama do chão do atalho: mesma grama (textura, tom e mapeamento) do chão, para emendar sem diferença
        const bermM = grassTone(new THREE.MeshLambertMaterial({ map: TX.get('grass', 1, 1), vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
        const rutM = new THREE.MeshBasicMaterial({ color: 0x5a3c22, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
        const postM = new THREE.MeshLambertMaterial({ map: TX.get('stripes', 1, 2) }), logM = new THREE.MeshLambertMaterial({ map: TX.get('bark', 1, 1), color: 0xc8a070 });
        let hint = 0; const yH = (x, z) => { const n = tr.nearest({ x, z }, hint); return n.dist < W + CB ? tr.roadBase + hAt(n.i + n.f) + 0.03 : terrain(x, z, n.dist, n.i + n.f); };
        // superfície VISÍVEL mais alta no ponto: relevo suave, faixa da beira de cada perna da curva (entrada e saída) e asfalto
        const legH = (x, z, c) => { let bd = 1e18, bi = c; for (let d = -45; d <= 45; d++) { const i = (c + d + N) % N, dx = S[i].x - x, dz = S[i].z - z, q = dx * dx + dz * dz; if (q < bd) { bd = q; bi = i; } }
          const dist = Math.sqrt(bd); if (dist > W + 42) return -1e9; return dist < W + CB ? tr.roadBase + hAt(bi) : terrain(x, z, dist, bi); };
        // nó mais próximo procurado na pista INTEIRA (a busca local do tr.nearest parte de um nó "chute" e, na ponta de saída
        // do atalho, achava um trecho errado)
        const nearAll = (x, z) => { let bd = 1e18, bi = 0; for (let i = 0; i < N; i++) { const dx = S[i].x - x, dz = S[i].z - z, q = dx * dx + dz * dz; if (q < bd) { bd = q; bi = i; } } return tr.nearest({ x, z }, bi); };
        // chão que REALMENTE aparece no ponto: perto da pista é a faixa da beira (segue a altura do asfalto), longe é o relevo.
        // (antes era o máximo entre relevo e faixas: perto da pista o relevo "cru" fica escondido por baixo, mais alto que a faixa,
        //  e o atalho virava um dique elevado, "voando")
        const visH = (x, z) => { const nn = nearAll(x, z); return nn.dist < W + CB ? tr.roadBase + hAt(nn.i + nn.f) : visGround(x, z, nn.i); };
        // teto perto da pista: o chão do atalho sobe no máximo 1:2,5 a partir da zebra (antes, onde o atalho passava rente à
        // pista, ficava um "paredão" de terra de ~1 m colado na zebra)
        const capNN = nn => nn.dist < W + 40 ? tr.roadBase + hAt(nn.i + nn.f) + 0.06 + Math.max(0, nn.dist - (W + CB + 0.3)) * 0.4 : 1e9;
        // perfil do caminho: máximo das superfícies na largura do caminho, depois envelope (máximo móvel) e média móvel -> sem degraus
        tr.shortcuts.forEach(sc => { const P = sc.pts, n = P.length, raw = [];
          for (let k = 0; k < n; k++) { const a = P[Math.max(0, k - 1)], b = P[Math.min(n - 1, k + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
            let m = -1e9; for (const o of [-sc.hw * 0.8, 0, sc.hw * 0.8]) m = Math.max(m, visH(P[k].x + tz * o, P[k].z - tx * o)); raw.push(m); }
          // trilha de verdade: acompanha o relevo (agora liso) colada no chão. Antes o perfil era o MAIOR chão na largura do
          // caminho + média móvel: em encosta e nos vales o caminho ficava acima do chão, com barranco -> dique "voando"
          raw.length = 0; for (let k = 0; k < n; k++) raw.push(visH(P[k].x, P[k].z));
          sc.h = raw.map((r, k) => Math.min(r + 0.06, capNN(nearAll(P[k].x, P[k].z))));
          // pontas: enquanto o caminho está em cima do asfalto ele fica na altura exata da pista; depois sobe/desce em rampa
          // suave (6 amostras, ~15 m) até o perfil do terreno -> sem degrau na hora de sair da pista
          const road = P.map(q => { const nn = nearAll(q.x, q.z); return nn.dist < W + CB ? tr.roadBase + hAt(nn.i + nn.f) + 0.03 : null; });
          [[0, 1], [n - 1, -1]].forEach(([k0, dir]) => { let kE = -1; for (let k = k0; k >= 0 && k < n && road[k] !== null; k += dir) kE = k; if (kE < 0) return;
            const base = road[kE], R = 6; for (let k = k0; k !== kE + dir; k += dir) sc.h[k] = road[k];
            for (let m = 1; m <= R; m++) { const k = kE + dir * m; if (k < 0 || k >= n) break; const w = m / R, e = w * w * (3 - 2 * w); sc.h[k] = base + (sc.h[k] - base) * e; } }); });
        // recursos compartilhados da "vida" dos atalhos (pedras, flores, cogumelos, lampiões, vaga-lumes, borboletas)
        // enfeites EM CIMA/na beira da terra (toras, pedras, tufos, flores, cogumelos, lampiões, postes da entrada): desligados,
        // a trilha fica limpa, só terra e grama (o pedido foi um caminho com cara de real). true traz tudo de volta.
        const CLUTTER = false;
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
        tr.animated.push(t => { const nf = NIGHT(); LIFE.flick.forEach((g, k) => { const f = 0.88 + 0.08 * Math.sin(t * 13 + k * 1.7) + 0.04 * Math.sin(t * 29 + k); g.scale.setScalar(1.0 * f); g.material.opacity = 0.9 * nf * f; }); });
        const logG = new THREE.CylinderGeometry(0.22, 0.26, 1.1, 8); logG.rotateZ(Math.PI / 2);
        // nada do caminho é desenhado em cima do asfalto/zebra: o ponto que cairia na pista é empurrado para logo depois da zebra
        const EDGE = W + CB + 0.3, snap = (x, z) => { const nn = nearAll(x, z); if (nn.dist >= EDGE) return [x, z];
          const i = nn.i, i1 = (i + 1) % N, qx = S[i].x + (S[i1].x - S[i].x) * nn.f, qz = S[i].z + (S[i1].z - S[i].z) * nn.f, sg = Math.sign(nn.lat) || 1;
          return [qx + T[i].z * sg * EDGE, qz - T[i].x * sg * EDGE]; };
        tr.shortcuts.forEach(sc => {
          hint = sc.i;
          const P = sc.pts, n = P.length, hw = sc.hw, EW = hw * 1.45;
          // largura da terra variando um pouco ao longo do caminho (borda natural, não de régua); a física usa sc.hw, que não muda
          let acc0 = 0; const ewk = P.map((q, k) => { if (k) acc0 += Math.hypot(q.x - P[k - 1].x, q.z - P[k - 1].z); return EW * (1 + 0.07 * Math.sin(acc0 * 0.21 + sc.i) + 0.04 * Math.sin(acc0 * 0.57 + 1.3)); });
          // ===== CHÃO DO ATALHO: UMA superfície contínua (grade), em vez de faixas soltas =====
          // Altura em cada ponto = max(chão visível + folga, "envelope" do caminho). O envelope é a altura do caminho caindo numa
          // curva suave (ombro arredondado, depois ~1:2,6) com a distância à borda da terra. Assim o barranco nunca fica solto no ar,
          // nunca dobra nas curvas e nunca passa por cima de outro trecho do caminho; perto da pista ele mergulha sob a zebra.
          const SL = 1 / 2.6, SA = 1.6, LIFT = 0.06;   // camada bem rente ao chão: borda sem degrau (o contorno/AO do pós-efeito marcava uma linha)
          const segs = []; for (let k = 0; k < n - 1; k++) { const ax = P[k].x, az = P[k].z, bx = P[k + 1].x - ax, bz = P[k + 1].z - az; segs.push({ ax, az, bx, bz, L2: bx * bx + bz * bz || 1, h0: sc.h[k], h1: sc.h[k + 1], e0: ewk[k], e1: ewk[k + 1] }); }
          const pathQ = (x, z) => { let s = 1e9, env = -1e9;
            for (const q of segs) { const t = Math.max(0, Math.min(1, ((x - q.ax) * q.bx + (z - q.az) * q.bz) / q.L2)), d = Math.hypot(x - q.ax - q.bx * t, z - q.az - q.bz * t);
              const e = d - (q.e0 + (q.e1 - q.e0) * t); if (e < s) s = e; const dr = e <= 0 ? 0 : e < SA ? SL * e * e / (2 * SA) : SL * (e - SA / 2); const v = q.h0 + (q.h1 - q.h0) * t - dr; if (v > env) env = v; }
            return { s, env }; };
          const RB = 6;                                                      // faixa de grama além da borda da terra (a camada acompanha o chão: não há barranco)
          // chão do atalho = chão DESENHADO (grade/faixa, exatamente os mesmos triângulos) + 12 cm; na beira de fora mergulha
          // embaixo da grama. Como segue os mesmos triângulos, nunca fica solto no ar nem é engolido pelo chão.
          const surf = (x, z, nn) => { nn = nn || nearAll(x, z); const q = pathQ(x, z), g = nn.dist < W + CB ? tr.roadBase + hAt(nn.i + nn.f) : visGround(x, z, nn.i), lift = q.s < RB - 2.5 ? LIFT : LIFT - (LIFT + 0.45) * Math.min(1, (q.s - (RB - 2.5)) / 2.5);
            return { y: Math.min(g + lift, capNN(nn)), s: q.s }; };
          const CS = LO ? 2.0 : MID ? 1.5 : 1.2;
          let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; P.forEach(q => { bx0 = Math.min(bx0, q.x); bx1 = Math.max(bx1, q.x); bz0 = Math.min(bz0, q.z); bz1 = Math.max(bz1, q.z); });
          const MG = EW * 1.2 + RB + 1, gx0 = bx0 - MG, gz0 = bz0 - MG, gnx = Math.ceil((bx1 - bx0 + 2 * MG) / CS), gnz = Math.ceil((bz1 - bz0 + 2 * MG) / CS), NV = (gnx + 1) * (gnz + 1);
          const GY = new Float32Array(NV), GS2 = new Float32Array(NV), GR = new Uint8Array(NV), PY = new Float32Array(NV).fill(NaN), GX = new Float32Array(NV).fill(NaN), GZ = new Float32Array(NV);
          for (let j = 0; j <= gnz; j++) for (let i = 0; i <= gnx; i++) { const v = j * (gnx + 1) + i, x = gx0 + i * CS, z = gz0 + j * CS, q = pathQ(x, z); GS2[v] = q.s;
            if (q.s > RB + 0.5) { GY[v] = -1e9; continue; }
            const nn = nearAll(x, z);
            if (nn.dist < EDGE) {
              // dentro da pista: longe da beira some; perto, o vértice é puxado para a beira de fora da zebra (contorno liso que
              // acompanha a curva, sem os "dentes" de antes), na altura do chão dali
              if (nn.dist < W - 3) { GY[v] = -1e9; continue; }
              const i0 = nn.i, i1 = (i0 + 1) % N, qx = S[i0].x + (S[i1].x - S[i0].x) * nn.f, qz = S[i0].z + (S[i1].z - S[i0].z) * nn.f, sg = Math.sign(nn.lat) || 1;
              const ex = qx + T[i0].z * sg * EDGE, ez = qz - T[i0].x * sg * EDGE; GX[v] = ex; GZ[v] = ez; GS2[v] = pathQ(ex, ez).s; GY[v] = tr.roadBase + hAt(nn.i + nn.f) + 0.05; GR[v] = 1; continue; }   // rente à zebra
            const sf = surf(x, z, nn); GY[v] = sf.y; PY[v] = sf.y; }
          sc.grid = { x0: gx0, z0: gz0, cs: CS, nx: gnx, nz: gnz, Y: PY };
          sc.surf = (x, z) => surf(x, z).y;
          const gP = [], gU = [], gC = [], gI = [], tP = [], tU = [], tC = [], tS = [], tI = [], gMap = new Int32Array(NV).fill(-1), tMap = new Int32Array(NV).fill(-1);
          const vx = v => GX[v] === GX[v] ? GX[v] : gx0 + (v % (gnx + 1)) * CS, vz = v => GX[v] === GX[v] ? GZ[v] : gz0 + ((v / (gnx + 1)) | 0) * CS;
          const gv = v => { if (gMap[v] < 0) { const x = vx(v), z = vz(v); gMap[v] = gP.length / 3; gP.push(x, GY[v], z); const t = grassUV(x, z); gU.push(t[0], t[1]); gC.push(...gcol(x, z)); } return gMap[v]; };
          const tv = v => { if (tMap[v] < 0) { const x = vx(v), z = vz(v), s = GS2[v]; tMap[v] = tP.length / 3; tP.push(x, GY[v] + 0.04, z); tU.push(x / 5.5, z / 5.5); tS.push(s);
              // trilha do meio mais batida (escura), bordas mais secas; manchas grandes de tom
              const ew = EW, f = Math.max(0, Math.min(1, -s / ew)), nz = 0.5 + 0.25 * Math.sin(x * 0.09 + z * 0.05) + 0.15 * Math.sin(x * 0.23 - z * 0.31 + 1.7) + 0.1 * Math.sin(x * 0.61 + z * 0.47);
              const mid = Math.exp(-Math.pow(Math.max(0, ew + s) / 3.0, 2)), v2 = 0.9 + 0.2 * nz - 0.1 * mid;
              tC.push(v2, v2 * 0.98, v2 * 0.95); } return tMap[v]; };
          for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) { const a = j * (gnx + 1) + i, b = a + 1, c = a + gnx + 1, d = c + 1;
            [[a, c, b], [b, c, d]].forEach(T3 => { if (T3.some(v => GY[v] < -1e8)) return; if (T3.every(v => GR[v])) return;
              gI.push(gv(T3[0]), gv(T3[1]), gv(T3[2]));
              if (Math.min(GS2[T3[0]], GS2[T3[1]], GS2[T3[2]]) < 0.7) tI.push(tv(T3[0]), tv(T3[1]), tv(T3[2])); }); }
          const mk = (Pp, U, C, I, mat, extra) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(Pp, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
            g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); if (extra) g.setAttribute('aS', new THREE.Float32BufferAttribute(extra, 1)); g.setIndex(I); g.computeVertexNormals();
            if (tr.vert) { const nr = g.attributes.normal.array;                        // mesma normal da grama embaixo: a emenda some (antes a borda que mergulha escurecia e virava um risco)
              for (let k = 0; k < Pp.length / 3; k++) { const x = Pp[k * 3], z = Pp[k * 3 + 2]; if (roadInfo(x, z).d < W + CB + 0.6) continue; const q = surfNormal(x, z, true); nr[k * 3] = q.x; nr[k * 3 + 1] = q.y; nr[k * 3 + 2] = q.z; } }
            const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.userData.noOutline = true; add(m); return m; };
          if (gI.length) mk(gP, gU, gC, gI, bermM);
          if (tI.length) mk(tP, tU, tC, tI, dirtM, tS).userData.dynamic = true;   // fora da junção de malhas: ela descarta o atributo aS (a terra ficava cheia de buracos verdes)
          // duas marcas de pneu escuras (quem passou antes)
          [-1.8, 1.8].forEach(off => { const rp = [], ri = [];
            for (let k = 0; k < n; k++) { const a = P[Math.max(0, k - 1)], b = P[Math.min(n - 1, k + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
              [-0.35, 0.35].forEach(w => { const o = off + w + Math.sin(k * 0.37) * 0.15, [x, z] = snap(P[k].x + tz * o, P[k].z - tx * o); rp.push(x, sc.surf(x, z) + 0.09, z); }); }
            for (let k = 0; k < n - 1; k++) { const a = k * 2; ri.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
            const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setIndex(ri);
            const rm = new THREE.Mesh(rg, rutM); rm.renderOrder = 1; rm.userData.noOutline = true; add(rm); });
          // toras deitadas na beira, uma a cada ~7 m (só enfeite: não bloqueiam)
          const logs = []; for (let k = 3; k < n - 3; k += 3) [-1, 1].forEach(sd => { const a = P[k - 1], b = P[k + 1]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
            const o = sd * (hw + 1.6), x = P[k].x + tz * o, z = P[k].z - tx * o; if (Math.hypot(x - P[0].x, z - P[0].z) < 10 || Math.hypot(x - P[n - 1].x, z - P[n - 1].z) < 10) return;
            if (tr.nearest({ x, z }, 0).dist < W + CB + 0.6) return; logs.push({ x, z, y: sc.surf(x, z) + 0.2, r: Math.atan2(tx, tz) + (Math.random() - 0.5) * 0.3 }); });
          if (CLUTTER && logs.length) { const im = new THREE.InstancedMesh(logG, logM, logs.length), d = new THREE.Object3D();
            logs.forEach((q, i) => { d.position.set(q.x, q.y, q.z); d.rotation.set(0, q.r, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }); im.castShadow = true; add(im); }
          // ===== VIDA NO ATALHO =====
          // pontos da beira do caminho: frame (tangente/lateral) em cada amostra, longe das pontas e do asfalto
          const frameAt = k => { const a = P[Math.max(0, k - 1)], b = P[Math.min(n - 1, k + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; return [tx / l, tz / l]; };
          const edgePt = (k, o) => { const [tx, tz] = frameAt(k), x = P[k].x + tz * o, z = P[k].z - tx * o;
            if (Math.hypot(x - P[0].x, z - P[0].z) < 9 || Math.hypot(x - P[n - 1].x, z - P[n - 1].z) < 9) return null;
            if (tr.nearest({ x, z }, sc.i).dist < W + CB + 0.6) return null; return { x, z, y: sc.surf(x, z) - 0.02, tx, tz }; };
          const inst = (geo, mat, list, setup, shadow) => { if (!CLUTTER || !list.length) return null; const im = new THREE.InstancedMesh(geo, mat, list.length), d = new THREE.Object3D(), c = new THREE.Color();
            list.forEach((q, i) => { setup(d, q); d.updateMatrix(); im.setMatrixAt(i, d.matrix); if (q.c !== undefined) im.setColorAt(i, c.set(q.c)); });
            im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = !!shadow; im.receiveShadow = true; im.userData.noOutline = true; add(im); return im; };
          // pedras: grupinhos irregulares na beira, algumas meio enterradas
          const rocks = [], flowers = [], tufts = [], shrooms = [];
          for (let k = 2; k < n - 2; k++) [-1, 1].forEach(sd => {
            if (rnd() < 0.22 * LIFEK) { const q = edgePt(k, sd * (hw + 0.6 + rnd() * 2.6)); if (q) { const nR = 1 + (rnd() * 3 | 0);
              for (let j = 0; j < nR; j++) rocks.push({ x: q.x + (rnd() - 0.5) * 1.2, z: q.z + (rnd() - 0.5) * 1.2, y: q.y, s: 0.18 + rnd() * 0.45, r: rnd() * 6.28, c: [0x8d8781, 0x7a736c, 0xa39b90, 0x6c6863][rnd() * 4 | 0] }); } }
            if (rnd() < 0.55 * LIFEK) { const q = edgePt(k, sd * (EW * 0.86 + rnd() * 3.5)); if (q) {
              for (let j = 0; j < 4; j++) tufts.push({ x: q.x + (rnd() - 0.5) * 1.6, z: q.z + (rnd() - 0.5) * 1.6, y: q.y, s: 0.6 + rnd() * 0.7, r: rnd() * 6.28, c: rnd() < 0.5 ? 0x4f8a30 : 0x6a9a3a });
              // flores (haste + pétalas) removidas: de longe as hastes viravam "pauzinhos" brancos espetados na terra.
              // O sorteio continua igual (mesmos números consumidos), então pedras, tufos e cogumelos ficam nos mesmos lugares.
              if (rnd() < 0.7) { rnd(); for (let j = 0; j < 3 + (rnd() * 4 | 0); j++) { rnd(); rnd(); rnd(); rnd(); } } } }
            if (rnd() < 0.04) { const q = edgePt(k, sd * (hw + 1.0 + rnd() * 1.5)); if (q) for (let j = 0; j < 2 + (rnd() * 3 | 0); j++) shrooms.push({ x: q.x + (rnd() - 0.5) * 0.9, z: q.z + (rnd() - 0.5) * 0.9, y: q.y, s: 0.6 + rnd() * 0.8 }); } });
          inst(LIFE.rockG, LIFE.rockM, rocks, (d, q) => { d.position.set(q.x, q.y + q.s * 0.25, q.z); d.rotation.set(q.r, q.r * 1.7, q.r * 0.6); d.scale.set(q.s * 1.3, q.s * 0.7, q.s); }, true);
          inst(LIFE.tuftG, LIFE.tuftM, tufts, (d, q) => { d.position.set(q.x, q.y - 0.05, q.z); d.rotation.set((q.r % 0.3) - 0.15, q.r, 0); d.scale.set(q.s, q.s * 1.1, q.s); });
          inst(LIFE.stemG, LIFE.stemM, flowers.map(q => ({ x: q.x, y: q.y, z: q.z, h: q.h })), (d, q) => { d.position.set(q.x, q.y, q.z); d.rotation.set(0, 0, 0); d.scale.set(1, q.h / 0.5, 1); });
          inst(LIFE.petalG, LIFE.petalM, flowers, (d, q) => { d.position.set(q.x, q.y + q.h, q.z); d.rotation.set(0, q.x * 3.1, 0); d.scale.setScalar(q.s); });
          inst(LIFE.coreG, LIFE.coreM, flowers.map(q => ({ x: q.x, y: q.y, z: q.z, h: q.h, s: q.s })), (d, q) => { d.position.set(q.x, q.y + q.h + 0.04, q.z); d.rotation.set(0, 0, 0); d.scale.setScalar(q.s); });
          inst(LIFE.shStemG, LIFE.shStemM, shrooms, (d, q) => { d.position.set(q.x, q.y + 0.13 * q.s, q.z); d.rotation.set(0, 0, 0); d.scale.setScalar(q.s); });
          inst(LIFE.shCapG, LIFE.shCapM, shrooms, (d, q) => { d.position.set(q.x, q.y + 0.26 * q.s, q.z); d.rotation.set((q.x % 0.4) - 0.2, 0, (q.z % 0.4) - 0.2); d.scale.setScalar(q.s); }, true);
          // lampiões de madeira ao longo do caminho (a cada ~22 m, alternando os lados): acendem à noite
          if (CLUTTER) { const posts = []; let side0 = 1;
            for (let k = 5; k < n - 5; k += 9) { side0 = -side0; const q = edgePt(k, side0 * (hw + 2.0)); if (!q) continue; posts.push(Object.assign(q, { sd: side0 })); }
            posts.forEach(q => { const grp = new THREE.Group(), toPath = -q.sd;
              const post = new THREE.Mesh(LIFE.postG, LIFE.woodM); post.position.y = 1.35; post.castShadow = true; grp.add(post);
              const arm = new THREE.Mesh(LIFE.armG, LIFE.woodM); arm.position.set(0.38, 2.55, 0); arm.castShadow = true; grp.add(arm);
              const hook = new THREE.Mesh(LIFE.hookG, LIFE.ironM); hook.position.set(0.68, 2.42, 0); grp.add(hook);
              const lt = new THREE.Mesh(LIFE.lanternG, LIFE.ironM); lt.position.set(0.68, 2.08, 0); lt.castShadow = true; grp.add(lt);
              const fl = new THREE.Mesh(LIFE.flameG, LIFE.flameM); fl.position.set(0.68, 2.06, 0); grp.add(fl);
              // +x local aponta para o caminho
              const dx = q.tz * toPath, dz = -q.tx * toPath; grp.rotation.y = Math.atan2(-dz, dx); grp.position.set(q.x, q.y, q.z); add(grp);
              const gl = glowSpr(0xffb35a, 1.0, 0); gl.position.set(q.x + dx * 0.68, q.y + 2.06, q.z + dz * 0.68); LIFE.flick.push(gl);
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
            if (CLUTTER) [-1, 1].forEach(sd => { const o = sd * (hw + 1.2), x = A.x + tz * o * dir, z = A.z - tx * o * dir, y = Math.max(sc.h[k1] - 0.2, yH(x, z));
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
      const waterTest = p => { if (bridges.some(b => { const dx = p.x - S[b].x, dz = p.z - S[b].z; return Math.abs(dx * T[b].x + dz * T[b].z) < 30 && Math.abs(dx * T[b].z - dz * T[b].x) < W + CB + 0.3; })) return false;
        return ponds.some(q => pondEdge(q, p.x, p.z) < 0) || nearRiver(p.x, p.z, RHW - 0.5) || (!!SEA && SEA.e(p.x, p.z) < 0); };
      buildShortcuts();
      tr.dustColor = 0xc9a878;
      return { terrain: tr.vert ? (x, z, dist, u) => visGround(x, z, u === undefined ? undefined : Math.floor(u)) : terrain, waterTest };   // física = chão desenhado
    }
  }

  window.Tracks = { layout, build, PLANTS, get N() { return N; } };
})();
