// =====================================================================================
// toon.js — o "visual de desenho animado" do jogo inteiro, num lugar só (versão 2: mais limpa e mais leve)
//
// * Toon.mat(params, opts): MeshToonMaterial com rampa de tons + brilho de plástico + luz de contorno (rim).
//   opts.textured = true (modelos 3D com textura pintada: karts .glb, pilotos): rampa SUAVE e quase sem
//   escurecimento extra, porque a textura já tem luz e sombra desenhadas. Antes a rampa dura (sombra a 48%)
//   + a oclusão por orientação eram aplicadas por cima da textura e "sujavam" tudo.
// * Toon.outline(obj, espessura): contorno por "casco invertido". Duas correções em relação à versão antiga:
//   1) o casco usa NORMAIS MÉDIAS por posição (geometria "soldada", calculada uma vez por geometria e
//      reaproveitada): nas costuras da textura o casco não abre mais (eram os riscos no capacete e na lataria);
//   2) o casco é empurrado um pouco para TRÁS na profundidade (proporcional à espessura e à escala do objeto):
//      nas dobras e vincos do modelo ele não fura mais a superfície; o traço aparece só na silhueta.
//   Funciona em malha com esqueleto (piloto) e em InstancedMesh.
// * Toon.vivid(cor): aumenta a saturação (paleta de festa).
// * Toon.during(fn): enquanto fn roda, todo `new THREE.MeshLambertMaterial/MeshPhongMaterial` vira material
//   toon (props, árvores, pontes...). Os pisos grandes (grama, asfalto...) continuam Lambert (mais barato).
//
// Desempenho: shader enxuto (sem PBR, sem mapa de ambiente, sem normal map); materiais de contorno e
// geometrias soldadas em cache; programas compartilhados por chave (customProgramCacheKey).
// =====================================================================================
(function () {
  const INK = 0x2a1d4a;
  const Lambert = THREE.MeshLambertMaterial, Phong = THREE.MeshPhongMaterial;

  // rampas (NearestFilter = faixas nítidas). Padrão: 3 tons para objetos de cor lisa (cenário, troféu).
  // Suave: 4 tons próximos, para modelos com textura pintada.
  const grads = {};
  function makeGrad(key, vals) {
    if (grads[key]) return grads[key];
    const d = new Uint8Array(vals.length * 4); vals.forEach((v, i) => { d[i * 4] = v[0]; d[i * 4 + 1] = v[1]; d[i * 4 + 2] = v[2]; d[i * 4 + 3] = 255; });
    const t = new THREE.DataTexture(d, vals.length, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return grads[key] = t;
  }
  const gradient = () => makeGrad('std', [[138, 138, 150], [204, 204, 212], [255, 255, 255]]);
  const gradientSoft = () => makeGrad('soft', [[190, 190, 202], [218, 218, 226], [240, 240, 244], [255, 255, 255]]);

  function vivid(c, k) {
    const col = c && c.isColor ? c : new THREE.Color(c === undefined ? 0xffffff : c), hsl = {}; col.getHSL(hsl);
    if (hsl.s > 0.08) col.setHSL(hsl.h, Math.min(1, hsl.s * (k || 1.25) + 0.06), Math.min(0.92, hsl.l * 1.02 + 0.02));
    return col;
  }

  // trecho do fragment shader: oclusão por orientação + rim + brilho (borda levemente suavizada: sem
  // serrilhado nem "manchas" duras). uAO = força do escurecimento das faces voltadas para baixo.
  const GLOSS = [
    '{ vec3 N = normalize(normal); vec3 V = normalize(vViewPosition);',
    '  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);',
    '  gl_FragColor.rgb *= mix(1.0 - uAO, 1.0, smoothstep(-0.85, 0.45, dot(N, upV)));',
    '  float rim = smoothstep(0.62, 0.78, 1.0 - max(dot(N, V), 0.0));',
    '  gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 1.2 + 0.08, rim * uRim);',
    '  if (uGloss > 0.0) { vec3 H = normalize(normalize(vec3(-0.35, 0.8, 0.5)) + V);',
    '    gl_FragColor.rgb += vec3(smoothstep(0.955, 0.972, max(dot(N, H), 0.0)) * uGloss); } }'
  ].join('\n');

  // opts: { gloss (0..1), rim (0..1), ao (0..1), sat (0 = cor exata), textured, hook(shader), key }
  function mat(params, opts) {
    opts = opts || {}; params = Object.assign({}, params);
    ['shininess', 'specular', 'flatShading', 'roughness', 'metalness', 'envMap', 'envMapIntensity', 'reflectivity', 'combine', 'normalMap', 'normalScale'].forEach(k => delete params[k]);
    if (params.color !== undefined) params.color = opts.sat === 0 ? new THREE.Color(params.color) : vivid(params.color, opts.sat);
    if (params.emissive !== undefined) params.emissive = new THREE.Color(params.emissive);
    const tex = !!opts.textured;
    const m = new THREE.MeshToonMaterial(Object.assign({ gradientMap: tex ? gradientSoft() : gradient() }, params));
    const gloss = opts.gloss || 0, rim = opts.rim === undefined ? (tex ? 0.15 : 0.25) : opts.rim, ao = opts.ao !== undefined ? opts.ao : (tex ? 0.12 : 0.36);
    const u = m.userData.toonU = { uGloss: { value: gloss }, uRim: { value: rim }, uAO: { value: ao } };
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = 'uniform float uGloss; uniform float uRim; uniform float uAO;\n' + sh.fragmentShader.replace('#include <tonemapping_fragment>', GLOSS + '\n#include <tonemapping_fragment>');
      if (opts.hook) opts.hook(sh);
    };
    m.customProgramCacheKey = () => 'toon2-' + (opts.key || 'g') + (tex ? '-t' : '');
    // materiais toon iguais (sem shader extra) podem ser agrupados pelo mergeByMaterial
    if (!opts.hook) m.userData.mergeKey = 'toon:' + gloss + ':' + rim + ':' + ao + ':' + (opts.key || 'g');
    return m;
  }

  // ---------- contorno (casco invertido) ----------
  // geometria "soldada": mesmas posições/índices/pesos, mas com a normal MÉDIA de todos os vértices que ocupam
  // o mesmo lugar (as cópias das costuras). Cache por geometria: 8 karts iguais = 1 cálculo.
  const welded = new WeakMap();
  function weld(geo) {
    if (welded.has(geo)) return welded.get(geo);
    const P = geo.attributes.position, src = geo.attributes.normal, n = P.count;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const inv = 1 / (geo.boundingBox.getSize(new THREE.Vector3()).length() * 1.5e-3 || 1e-3);
    const key = new Map(), acc = [], id = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const k = Math.round(P.getX(i) * inv) + ',' + Math.round(P.getY(i) * inv) + ',' + Math.round(P.getZ(i) * inv);
      let j = key.get(k); if (j === undefined) { j = acc.length / 3; key.set(k, j); acc.push(0, 0, 0); }
      id[i] = j; acc[j * 3] += src.getX(i); acc[j * 3 + 1] += src.getY(i); acc[j * 3 + 2] += src.getZ(i);
    }
    if (acc.length / 3 === n) { welded.set(geo, geo); return geo; }          // nada para soldar: usa a própria
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const j = id[i] * 3, x = acc[j], y = acc[j + 1], z = acc[j + 2], l = Math.hypot(x, y, z) || 1; out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l; }
    const g = new THREE.BufferGeometry();
    Object.keys(geo.attributes).forEach(k => { if (k !== 'normal' && k !== 'uv' && k !== 'color') g.setAttribute(k, geo.attributes[k]); });
    g.setAttribute('normal', new THREE.BufferAttribute(out, 3)); if (geo.index) g.setIndex(geo.index);
    g.groups = geo.groups; g.boundingBox = geo.boundingBox; g.boundingSphere = geo.boundingSphere;
    g.userData.weldOf = geo;
    welded.set(geo, g); return g;
  }

  const outlineMats = {};
  function outlineMat(t, skinned, color) {
    const col = color === undefined ? INK : color, key = t + (skinned ? 's' : '') + ':' + col;
    if (outlineMats[key]) return outlineMats[key];
    const m = new THREE.MeshBasicMaterial({ color: col, side: THREE.BackSide, skinning: !!skinned });
    // empurra pela normal (espessura) e depois para trás na profundidade (2,5x a espessura, na escala do objeto)
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * ' + t.toFixed(4) + ';')
        .replace('#include <project_vertex>', '#include <project_vertex>\nmvPosition.z -= ' + (t * 2.5).toFixed(4) + ' * length(modelMatrix[0].xyz);\ngl_Position = projectionMatrix * mvPosition;');
    };
    m.customProgramCacheKey = () => 'outline2-' + key;
    m.userData.outline = true;
    return outlineMats[key] = m;
  }
  // color (opcional): cor do traço; os pneus usam preto neutro em vez da tinta roxa
  function outline(root, t, filter, color) {
    const list = [];
    root.traverse(o => {
      if (!o.isMesh || o.userData.outline || o.userData.noOutline || !o.geometry.attributes.normal) return;
      if (o.isInstancedMesh && o.instanceColor && !o.userData.outlineInstanced) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || m.transparent || m.isMeshBasicMaterial || m.isSpriteMaterial || (filter && !filter(o))) return;
      list.push(o);
    });
    list.forEach(o => {
      let h; const g = weld(o.geometry);
      if (o.isSkinnedMesh) { h = new THREE.SkinnedMesh(g, outlineMat(t, true, color)); h.bind(o.skeleton, o.bindMatrix); h.frustumCulled = false; }
      else if (o.isInstancedMesh) { h = new THREE.InstancedMesh(g, outlineMat(t, false, color), o.count); h.instanceMatrix = o.instanceMatrix; h.frustumCulled = o.frustumCulled; }
      else h = new THREE.Mesh(g, outlineMat(t, false, color));
      h.position.copy(o.position); h.quaternion.copy(o.quaternion); h.scale.copy(o.scale);
      h.userData.outline = true; h.castShadow = false; h.receiveShadow = false; h.renderOrder = o.renderOrder;
      o.parent.add(h);
    });
    return list.length;
  }

  // ---------- fábrica: Lambert/Phong -> toon (exceto pisos) ----------
  const GROUND = ['grass', 'asphalt', 'sand', 'dirt', 'curb', 'paint', 'concrete', 'pebble', 'startLine'];
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
      return mat(params, { gloss: Base === Phong ? 0.3 : 0, rim: isWater ? 0.12 : 0.16, key: Base === Phong ? 'p' : 'l' });
    };
  }
  function during(fn) {
    THREE.MeshLambertMaterial = factory(Lambert); THREE.MeshPhongMaterial = factory(Phong);
    try { return fn(); } finally { THREE.MeshLambertMaterial = Lambert; THREE.MeshPhongMaterial = Phong; }
  }

  window.Toon = { INK, gradient, gradientSoft, vivid, mat, outline, weld, during, Lambert };
})();
