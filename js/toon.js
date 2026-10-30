// =====================================================================================
// toon.js — o "visual de desenho animado" do jogo inteiro, num lugar só
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

  // opts: { gloss (0..1), rim (0..1), hook(shader) para shaders extras (adesivo, recolor), key }
  function mat(params, opts) {
    opts = opts || {}; params = Object.assign({}, params);
    ['shininess', 'specular', 'flatShading', 'roughness', 'metalness', 'envMap', 'envMapIntensity', 'reflectivity', 'combine', 'normalMap', 'normalScale'].forEach(k => delete params[k]);
    if (params.color !== undefined) params.color = opts.sat === 0 ? new THREE.Color(params.color) : vivid(params.color, opts.sat);
    if (params.emissive !== undefined) params.emissive = new THREE.Color(params.emissive);
    const m = new THREE.MeshToonMaterial(Object.assign({ gradientMap: gradient() }, params));
    const gloss = opts.gloss || 0, rim = opts.rim === undefined ? 0.25 : opts.rim;
    if (gloss || rim || opts.hook) {
      const u = m.userData.toonU = { uGloss: { value: gloss }, uRim: { value: rim } };
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, u);
        sh.fragmentShader = 'uniform float uGloss; uniform float uRim;\n' + sh.fragmentShader.replace('#include <tonemapping_fragment>', GLOSS + '\n#include <tonemapping_fragment>');
        if (opts.hook) opts.hook(sh);
      };
      m.customProgramCacheKey = () => 'toon-' + (opts.key || 'g');
      // materiais toon iguais (sem shader extra) podem ser agrupados pelo mergeByMaterial
      if (!opts.hook) m.userData.mergeKey = 'toon:' + gloss + ':' + rim + ':' + (opts.key || 'g');
    }
    return m;
  }

  // ---------- contorno (casco invertido) ----------
  const outlineMats = {};
  function outlineMat(t, skinned, color) {
    const col = color === undefined ? INK : color, key = t + (skinned ? 's' : '') + ':' + col;
    if (outlineMats[key]) return outlineMats[key];
    const m = new THREE.MeshBasicMaterial({ color: col, side: THREE.BackSide, skinning: !!skinned });
    m.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * ' + t.toFixed(4) + ';'); };
    m.customProgramCacheKey = () => 'outline-' + key;
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
      let h;
      if (o.isSkinnedMesh) { h = new THREE.SkinnedMesh(o.geometry, outlineMat(t, true, color)); h.bind(o.skeleton, o.bindMatrix); h.frustumCulled = false; }
      else if (o.isInstancedMesh) { h = new THREE.InstancedMesh(o.geometry, outlineMat(t, false, color), o.count); h.instanceMatrix = o.instanceMatrix; h.frustumCulled = o.frustumCulled; }
      else h = new THREE.Mesh(o.geometry, outlineMat(t, false, color));
      h.position.copy(o.position); h.quaternion.copy(o.quaternion); h.scale.copy(o.scale);
      h.userData.outline = true; h.castShadow = false; h.receiveShadow = false; h.renderOrder = o.renderOrder;
      o.parent.add(h);
    });
    return list.length;
  }

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
  function during(fn) {
    THREE.MeshLambertMaterial = factory(Lambert); THREE.MeshPhongMaterial = factory(Phong);
    try { return fn(); } finally { THREE.MeshLambertMaterial = Lambert; THREE.MeshPhongMaterial = Phong; }
  }

  window.Toon = { INK, gradient, vivid, mat, outline, during, Lambert };
})();
