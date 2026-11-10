// =====================================================================================
// toon.js — (LEGADO) o cel shading foi removido: as funções continuam com o mesmo nome, mas devolvem materiais PBR/padrão
//
// * Toon.mat(params, opts): MeshToonMaterial com rampa de 3 tons (luz / meio-tom / sombra, sem
//   degradê realista) + brilho de plástico (mancha especular de borda dura) + luz de contorno (rim).
// * Toon.outline(obj, espessura): contorno preto-azulado por "casco invertido" (a malha é desenhada
//   de novo, de costas, empurrada pela normal). Funciona em malha com esqueleto (piloto).
// * Toon.vivid(cor): aumenta a saturação (paleta de festa).
// * Toon.during(fn): enquanto fn roda, todo `new THREE.MeshLambertMaterial/MeshPhongMaterial` vira
//   material toon (props, árvores, pontes...). Os pisos grandes (grama, asfalto, terra, areia do rio...)
//   continuam Lambert: são a maior área da tela e o Lambert é o sombreamento mais barato do Three.js.
//
// Desempenho: nada de PBR, mapas de ambiente (PMREM) ou normal maps. O toon custa como um Phong
// simples, e o contorno só é aplicado em karts, pilotos e troféu (poucas malhas agrupadas).
// =====================================================================================
(function () {
  const INK = 0x2a1d4a;
  let grad = null;
  const Lambert = THREE.MeshLambertMaterial, Phong = THREE.MeshPhongMaterial;

  function gradient() {
    if (grad) return grad;
    grad = new THREE.DataTexture(new Uint8Array([122, 122, 132, 255, 196, 196, 204, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);   // sombra mais funda (e levemente fria) = mais volume
    grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.generateMipmaps = false; grad.needsUpdate = true;
    return grad;
  }

  // rampa com transições curtas e suaves (mesmos 3 tons): em malhas orgânicas e irregulares (personagens gerados por IA)
  // a borda seca entre luz e sombra sai dentada; aqui ela vira uma curva limpa, sem perder a cara de desenho
  let gradSoft = null;
  function gradientSoft() {
    if (gradSoft) return gradSoft;
    const n = 64, d = new Uint8Array(n * 4), ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let i = 0; i < n; i++) { const x = (i + 0.5) / n, r = 122 + 74 * ss(0.3, 0.38, x) + 59 * ss(0.62, 0.7, x), b = 132 + 72 * ss(0.3, 0.38, x) + 51 * ss(0.62, 0.7, x);
      d[i * 4] = d[i * 4 + 1] = Math.round(r); d[i * 4 + 2] = Math.round(b); d[i * 4 + 3] = 255; }
    gradSoft = new THREE.DataTexture(d, n, 1, THREE.RGBAFormat);
    gradSoft.minFilter = gradSoft.magFilter = THREE.LinearFilter; gradSoft.generateMipmaps = false; gradSoft.needsUpdate = true;
    return gradSoft;
  }

  function vivid(c, k) {
    const col = c && c.isColor ? c : new THREE.Color(c === undefined ? 0xffffff : c), hsl = {}; col.getHSL(hsl);
    if (hsl.s > 0.08) col.setHSL(hsl.h, Math.min(1, hsl.s * (k || 1.25) + 0.06), Math.min(0.92, hsl.l * 1.02 + 0.02));
    return col;
  }

  // trecho do fragment shader: brilho duro (plástico) + contorno claro (rim)
  const GLOSS = [
    // oclusão aproximada pela orientação: faces voltadas para baixo/para os lados escurecem (barriga dos karts,
    // laterais dos pneus, base das copas, marquises, beirais) -> volume e profundidade sem custo de pós-processamento
    '{ vec3 Nw = normalize(normal); vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);',
    '  float upness = dot(Nw, upV); gl_FragColor.rgb *= mix(0.58, 1.0, smoothstep(-0.85, 0.45, upness)); }',
    '{ vec3 V = normalize(vViewPosition); vec3 N = normalize(normal);',
    '  float rim = smoothstep(0.60, 0.72, 1.0 - max(dot(N, V), 0.0));',
    '  vec3 H = normalize(normalize(vec3(-0.35, 0.8, 0.5)) + V);',
    '  float sp = smoothstep(0.962, 0.975, max(dot(N, H), 0.0));',
    '  gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 1.25 + 0.1, rim * uRim);',
    '  gl_FragColor.rgb += vec3(sp * uGloss); }'
  ].join('\n');

  // CEL SHADING REMOVIDO: Toon.mat agora devolve um material PBR padrão (MeshStandardMaterial), sem rampa de 3 tons,
  // sem mancha de brilho dura e sem luz de contorno. gloss vira aspereza (roughness) e os hooks de shader continuam valendo
  // (eles só mexem em <map_fragment> e <tonemapping_fragment>, que o Standard também tem).
  // opts: { gloss (0..1), rim (ignorado), hook(shader), key, metal }
  function mat(params, opts) {
    opts = opts || {}; params = Object.assign({}, params);
    ['shininess', 'specular', 'flatShading', 'gradientMap', 'combine', 'reflectivity'].forEach(k => delete params[k]);
    if (params.color !== undefined) params.color = new THREE.Color(params.color);
    if (params.emissive !== undefined) params.emissive = new THREE.Color(params.emissive);
    const gloss = Math.max(0, Math.min(1, opts.gloss || 0));
    const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.82 - 0.62 * gloss, metalness: opts.metal || (gloss > 0.85 ? 0.35 : 0) }, params));
    const env = window.KartMats && KartMats.env; if (env && !m.envMap) { m.envMap = env; m.envMapIntensity = 0.25 + 0.6 * gloss; }
    if (opts.hook) { m.onBeforeCompile = sh => opts.hook(sh); m.customProgramCacheKey = () => 'std-' + (opts.key || 'g'); }
    else m.userData.mergeKey = 'std:' + gloss + ':' + (opts.key || 'g');
    return m;
  }

  // ---------- contorno (casco invertido) ----------
  const outlineMats = {};
  // O casco é empurrado para trás (para longe da câmera) por OUT_PUSH vezes a própria espessura. Nas dobras para dentro
  // (olhos em relevo, borda da viseira, encaixes entre peças) ele deixava de aparecer POR CIMA da superfície: somem os
  // anéis e manchas de tinta dentro do desenho. Na silhueta (contra o fundo ou objetos mais distantes) nada muda.
  const OUT_PUSH = 1.35;
  const OUTLINE_PUSH = ['{ vec4 oW = vec4(oE, 0.0);', '#ifdef USE_INSTANCING', 'oW = instanceMatrix * oW;', '#endif',
    'mvPosition.xyz += normalize(mvPosition.xyz) * length((modelViewMatrix * oW).xyz) * OUT_PUSH;',
    'gl_Position = projectionMatrix * mvPosition; }'].join('\n');
  // push (opcional): quanto o casco recua para longe da câmera, em múltiplos da espessura. Personagens usam mais:
  // braços encostados no tronco e partes que se cruzam deixam de mostrar faixas de tinta POR DENTRO do desenho.
  function outlineMat(t, skinned, color, push) {
    const col = color === undefined ? INK : color, pu = push || OUT_PUSH, key = t + (skinned ? 's' : '') + ':' + col + ':' + pu;
    if (outlineMats[key]) return outlineMats[key];
    const m = new THREE.MeshBasicMaterial({ color: col, side: THREE.BackSide, skinning: !!skinned });
    // o casco é empurrado pela NORMAL SUAVIZADA (aOutN): nas costuras de UV a malha tem vértices duplicados com normais
    // diferentes; empurrando pela normal de cada um, o casco se rasgava em pedaços e atravessava a superfície (riscos).
    m.onBeforeCompile = sh => { sh.vertexShader = 'attribute vec3 aOutN;\n#define OUT_PUSH ' + pu.toFixed(2) + '\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvec3 oE = normalize(aOutN) * ' + t.toFixed(4) + ';\ntransformed += oE;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n' + OUTLINE_PUSH); };
    m.customProgramCacheKey = () => 'outline2-' + key;
    m.userData.outline = true;
    return outlineMats[key] = m;
  }
  // normal suavizada para o contorno: junta os vértices na mesma posição (costuras de UV) e soma as normais das faces
  // em volta, ponderadas pelo ângulo do canto (orientadas pela normal original, à prova de faces com o lado trocado).
  // Fica guardada na própria geometria (as compartilhadas entre karts calculam uma vez só).
  function hullGeometry(g) {
    const ud = g.userData || (g.userData = {});
    if (ud.outlineGeo) return ud.outlineGeo;
    const h = new THREE.BufferGeometry();
    for (const k in g.attributes) h.setAttribute(k, g.attributes[k]);
    if (g.index) h.setIndex(g.index);
    h.setAttribute('aOutN', smoothNormals(g));
    if (!g.boundingSphere) g.computeBoundingSphere(); h.boundingSphere = g.boundingSphere.clone(); if (g.boundingBox) h.boundingBox = g.boundingBox.clone();
    h.userData = { shared: !!ud.shared, outlineOf: true };
    return ud.outlineGeo = h;
  }
  // crease (graus, opcional): só junta faces cuja normal está a menos desse ângulo da normal original do vértice
  // (quinas de verdade, como a borda da viseira encontrando o rosto, continuam vivas). Sem crease: junta tudo (contorno).
  function smoothNormals(g, crease) {
    const P = g.attributes.position, N = g.attributes.normal, n = P.count, idx = g.index ? g.index.array : null, nt = idx ? idx.length / 3 : n / 3;
    if (!g.boundingBox) g.computeBoundingBox();
    const sz = g.boundingBox.getSize(new THREE.Vector3()), q = Math.max(sz.x, sz.y, sz.z, 1e-6) * 2e-5;
    const key = new Int32Array(n), map = new Map(); let k = 0;
    for (let i = 0; i < n; i++) { const h = Math.round(P.getX(i) / q) + ',' + Math.round(P.getY(i) / q) + ',' + Math.round(P.getZ(i) / q);
      let v = map.get(h); if (v === undefined) { v = k++; map.set(h, v); } key[i] = v; }
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3();
    const V = [a, b, c], FN = new Float32Array(nt * 3), cnt = new Int32Array(k + 1);
    const wv = new Float32Array(nt * 3);   // peso (ângulo do canto) de cada canto de triângulo
    for (let t = 0; t < nt; t++) {
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2, I = [i0, i1, i2];
      a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
      fn.subVectors(c, b).cross(e1.subVectors(a, b)); const len = fn.length(); if (len < 1e-20) continue; fn.divideScalar(len);
      vn.set(0, 0, 0); for (let j = 0; j < 3; j++) vn.x += N.getX(I[j]), vn.y += N.getY(I[j]), vn.z += N.getZ(I[j]);
      if (fn.dot(vn) < 0) fn.negate();
      FN[t * 3] = fn.x; FN[t * 3 + 1] = fn.y; FN[t * 3 + 2] = fn.z;
      for (let j = 0; j < 3; j++) { e1.subVectors(V[(j + 1) % 3], V[j]).normalize(); e2.subVectors(V[(j + 2) % 3], V[j]).normalize();
        wv[t * 3 + j] = Math.acos(Math.max(-1, Math.min(1, e1.dot(e2)))); cnt[key[I[j]] + 1]++; }
    }
    // lista de cantos por grupo soldado
    for (let i = 0; i < k; i++) cnt[i + 1] += cnt[i];
    const list = new Int32Array(cnt[k]), fill = cnt.slice(0, k);
    for (let t = 0; t < nt; t++) { if (FN[t * 3] === 0 && FN[t * 3 + 1] === 0 && FN[t * 3 + 2] === 0) continue;
      for (let j = 0; j < 3; j++) { const v = idx ? idx[t * 3 + j] : t * 3 + j; list[fill[key[v]]++] = t * 3 + j; } }
    const cosC = crease ? Math.cos(crease * Math.PI / 180) : -2, out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i), nl = Math.hypot(nx, ny, nz) || 1, g0 = key[i];
      let sx = 0, sy = 0, sz = 0;
      for (let p = cnt[g0]; p < fill[g0]; p++) { const tc = list[p], t = (tc / 3) | 0, fx = FN[t * 3], fy = FN[t * 3 + 1], fz = FN[t * 3 + 2];
        if ((fx * nx + fy * ny + fz * nz) / nl < cosC) continue; const w = wv[tc]; sx += fx * w; sy += fy * w; sz += fz * w; }
      vn.set(sx, sy, sz);
      if (vn.lengthSq() < 1e-20 || vn.x * nx + vn.y * ny + vn.z * nz < 0) vn.set(nx, ny, nz); vn.normalize();
      out[i * 3] = vn.x; out[i * 3 + 1] = vn.y; out[i * 3 + 2] = vn.z;
    }
    return new THREE.BufferAttribute(out, 3);
  }
  // color (opcional): cor do traço; os pneus usam preto neutro em vez da tinta roxa
  // contorno de tinta (cel shading) removido: nada é criado. A assinatura fica para quem ainda chama.
  function outline() { return 0; }

  // ---------- fábrica: Lambert/Phong -> toon (exceto pisos) ----------
  const GROUND = ['grass', 'asphalt', 'sand', 'dirt', 'curb', 'paint', 'concrete', 'pebble', 'startLine'];   // pisos de Cidade/Praia removidos
  let groundSet = null;
  function isGround(p) {
    if (!groundSet) groundSet = new Set(GROUND.map(n => TX.canvas(n)));
    return p && p.map && p.map.image && groundSet.has(p.map.image);
  }
  function factory(Base) {
    return function (params) {
      params = params || {};
      if (isGround(params)) { const p = Object.assign({}, params); delete p.shininess; delete p.specular; delete p.flatShading; if (p.color !== undefined) p.color = vivid(p.color, 1.15); return new Lambert(p); }
      const isWater = params.transparent && params.map && params.map.image === TX.canvas('ripple');
      return mat(params, { gloss: Base === Phong ? 0.35 : 0, rim: isWater ? 0.15 : 0.18, key: Base === Phong ? 'p' : 'l' });
    };
  }
  // antes: trocava todo Lambert/Phong criado dentro de fn por toon. Agora cada material fica com o sombreado padrão.
  function during(fn) {
    // só limpa parâmetros que o Lambert não aceita (flatShading vinha para o toon); o sombreado continua o padrão
    THREE.MeshLambertMaterial = function (p) { p = p ? Object.assign({}, p) : {}; delete p.flatShading; delete p.shininess; delete p.specular; return new Lambert(p); };
    THREE.MeshLambertMaterial.prototype = Lambert.prototype;
    try { return fn(); } finally { THREE.MeshLambertMaterial = Lambert; }
  }

  window.Toon = { INK, gradient, gradientSoft, vivid, mat, outline, smoothNormals, during, Lambert };
})();
