// =====================================================================================
// pines.js — 4 pinheiros procedurais detalhados (+ versão leve de cada), desenhados com instâncias
//
//   0 Abeto alto          fino e alto, muitas camadas, verde escuro
//   1 Espruce azul        largo e cheio, galhos bem caídos, verde-azulado
//   2 Pinheiro-de-natal   mais baixo e cheio, verde vivo, formato clássico
//   3 Abeto gigante       o mais alto e esguio, verde-oliva escuro, galhos bem caídos
//
// Os 4 modelos ficam numa geometria só (atributo aVar = número do modelo). Cada instância diz qual quer (atributo de
// instância iVar) e o vertex shader "fecha" (encolhe para um ponto) os vértices dos outros modelos. Resultado: 1 chamada
// de desenho por bloco, igual a antes, com 4 árvores diferentes. A sombra usa o mesmo truque (depthMaterial()).
//
//   Pines.geometry('hi' | 'lo')       geometria combinada (cor por vértice já com oclusão; normais suaves por peça)
//   Pines.material(base, wind)        aplica o seletor de modelo (+ vento) num material com vertexColors
//   Pines.depthMaterial()             material de sombra com o mesmo seletor
//   Pines.variantAt(x, z)             modelo "aleatório" estável pela posição (não muda a semente do cenário)
//   Pines.attach(geo, variants)       cria uma cópia leve da geometria com o atributo iVar das instâncias
//   Pines.HEIGHT[v]                   altura de cada modelo em escala 1 (m)
// =====================================================================================
(function () {
  const TAU = Math.PI * 2;
  const rngOf = seed => { let s = seed >>> 0 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const C = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

  // ---------- construtor de malha indexada (cada peça tem as próprias normais suaves) ----------
  class Mesh {
    constructor() { this.parts = []; }
    part() { const p = { pos: [], col: [], idx: [] }; this.parts.push(p); return p; }
    static v(p, x, y, z, c) { p.pos.push(x, y, z); p.col.push(c[0], c[1], c[2]); return p.pos.length / 3 - 1; }
    build(variant) {
      const geos = this.parts.filter(p => p.idx.length).map(p => { const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
        g.setIndex(p.idx); g.computeVertexNormals(); return g; });
      return merge(geos, variant);
    }
  }
  function merge(geos, variant) {
    let nv = 0, ni = 0; geos.forEach(g => { nv += g.attributes.position.count; ni += g.index.count; });
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), vr = new Float32Array(nv), idx = new Uint32Array(ni);
    let ov = 0, oi = 0;
    geos.forEach(g => { const n = g.attributes.position.count; pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3); col.set(g.attributes.color.array, ov * 3);
      const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[oi + i] = ia[i] + ov; ov += n; oi += ia.length; g.dispose(); });
    if (variant != null) vr.fill(variant);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aVar', new THREE.BufferAttribute(vr, 1));
    g.setIndex(new THREE.BufferAttribute(nv < 65535 ? new Uint16Array(idx) : idx, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
  function mergeVariants(list) {   // [geo0, geo1, ...] já com aVar -> uma geometria
    let nv = 0, ni = 0; list.forEach(g => { nv += g.attributes.position.count; ni += g.index.count; });
    const out = { position: new Float32Array(nv * 3), normal: new Float32Array(nv * 3), color: new Float32Array(nv * 3), aVar: new Float32Array(nv) }, idx = new Uint32Array(ni);
    let ov = 0, oi = 0;
    list.forEach(g => { const n = g.attributes.position.count; ['position', 'normal', 'color'].forEach(k => out[k].set(g.attributes[k].array, ov * 3)); out.aVar.set(g.attributes.aVar.array, ov);
      const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[oi + i] = ia[i] + ov; ov += n; oi += ia.length; });
    const g = new THREE.BufferGeometry(); Object.keys(out).forEach(k => g.setAttribute(k, new THREE.BufferAttribute(out[k], k === 'aVar' ? 1 : 3)));
    g.setIndex(new THREE.BufferAttribute(nv < 65535 ? new Uint16Array(idx) : idx, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }

  // ---------- peças ----------
  // tronco: anéis seguindo uma curva (path(t) -> [x, y, z]), raio r(t), com "raízes" alargando a base
  function trunk(M, R, path, rad, rings, seg, cTop, cBot, roots) {
    const p = M.part(), ring = [];
    for (let i = 0; i <= rings; i++) { const t = i / rings, [cx, cy, cz] = path(t), r = rad(t), row = [];
      for (let j = 0; j <= seg; j++) { const a = j / seg * TAU, root = roots && t < 0.12 ? (1 - t / 0.12) * roots * (0.5 + 0.5 * Math.cos(a * 5 + 1)) : 0;
        const rr = r * (1 + root + (R() - 0.5) * 0.08), c = mul(mix(cBot, cTop, Math.pow(t, 0.7)), 0.86 + 0.18 * (0.5 + 0.5 * Math.cos(a * 3 + t * 9)));
        row.push(Mesh.v(p, cx + Math.cos(a) * rr, cy, cz + Math.sin(a) * rr, c)); }
      ring.push(row); }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) { const a = ring[i][j], b = ring[i][j + 1], c = ring[i + 1][j], d = ring[i + 1][j + 1]; p.idx.push(a, c, b, b, c, d); }
  }
  // "saia" de galhos (uma camada de pinheiro): pontas que caem, entalhes entre os galhos, convexa por cima e com o lado
  // de baixo escuro (dá volume). pal = { top, mid, tip, notch, under }, shade = escurece as camadas de baixo
  function skirt(M, R, cx, cy, cz, Rr, H, lobes, droop, pal, shade, rot) {
    const p = M.part(), apex = Mesh.v(p, cx, cy + H, cz, mul(pal.top, shade * 1.06)), n = lobes * 2, mid = [], out = [];
    for (let k = 0; k < n; k++) { const tip = k % 2 === 0, a = rot + k / n * TAU + (R() - 0.5) * 0.18 / lobes;
      const ro = Rr * (tip ? 0.92 + R() * 0.2 : 0.62 + R() * 0.08), yo = cy - droop * (tip ? 0.85 + R() * 0.3 : 0.32);
      out.push(Mesh.v(p, cx + Math.cos(a) * ro, yo, cz + Math.sin(a) * ro, mul(tip ? pal.tip : pal.notch, shade * (0.92 + R() * 0.14))));
      const rm = ro * 0.56, ym = cy + H * 0.38 - droop * (tip ? 0.22 : 0.08);
      mid.push(Mesh.v(p, cx + Math.cos(a) * rm, ym, cz + Math.sin(a) * rm, mul(pal.mid, shade * (0.94 + R() * 0.12)))); }
    for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; p.idx.push(apex, mid[k2], mid[k]); p.idx.push(mid[k], mid[k2], out[k], mid[k2], out[k2], out[k]); }
    // lado de baixo: das pontas para um centro um pouco acima (sombra dentro da copa)
    const q = M.part(), uc = Mesh.v(q, cx, cy + H * 0.1, cz, mul(pal.under, shade * 0.8)), ou = [];
    for (let k = 0; k < n; k++) { const P = p.pos, i = out[k] * 3; ou.push(Mesh.v(q, P[i], P[i + 1] - 0.02, P[i + 2], mul(pal.under, shade * (k % 2 ? 0.9 : 1.05)))); }
    for (let k = 0; k < n; k++) q.idx.push(uc, ou[k], ou[(k + 1) % n]);
  }
  // ---------- os 4 modelos ----------
  const BARK = { dark: C(0x4a3424), mid: C(0x6e4c32) };
  const HEIGHT = [16.5, 13, 11, 19.5];
  function conifer(v, lo, o) {
    const M = new Mesh(), R = rngOf(101 + v * 977 + (lo ? 7 : 0));
    trunk(M, R, t => [0, t * o.trunkH, 0], t => o.trunkR * (1 - 0.65 * t), lo ? 1 : 3, lo ? 5 : 8, BARK.mid, BARK.dark, lo ? 0 : 0.35);
    const tiers = lo ? o.tiersLo : o.tiers;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1), y = o.base + (o.H - o.base - o.topH) * Math.pow(t, o.curve), Rr = o.R * Math.pow(1 - t, o.taper) * (0.92 + R() * 0.16) + o.Rmin;
      const shade = 0.72 + 0.36 * t, H = o.tierH * (0.75 + 0.5 * (1 - t)) * (lo ? Math.pow(o.tiers / o.tiersLo, 0.8) : 1), lobes = lo ? Math.max(5, o.lobes - 3) : o.lobes;
      skirt(M, R, (R() - 0.5) * 0.15, y, (R() - 0.5) * 0.15, Rr, H, lobes, o.droop * (0.6 + 0.6 * (1 - t)) * Rr / o.R * (lo ? 1.5 : 1), o.pal, shade, R() * TAU);
      if (!lo && o.double && t < 0.9) skirt(M, R, 0, y + H * 0.42, 0, Rr * 0.8, H * 0.8, lobes - 1, o.droop * 0.7 * Rr / o.R, o.pal, shade * 1.04, R() * TAU);
    }
    // ponta (broto)
    { const p = M.part(), top = Mesh.v(p, 0, o.H, 0, mul(o.pal.tip, 1.1)), n = lo ? 4 : 6, ring = [];
      for (let k = 0; k < n; k++) { const a = k / n * TAU; ring.push(Mesh.v(p, Math.cos(a) * 0.32, o.H - o.topH * 1.2, Math.sin(a) * 0.32, o.pal.top)); }
      for (let k = 0; k < n; k++) p.idx.push(top, ring[(k + 1) % n], ring[k]); }
    return M.build(v);
  }
  const cache = {};
  const Pines = {
    HEIGHT, COUNT: 4,
    geometry(q) {
      q = q === 'lo' ? 'lo' : 'hi'; if (cache[q]) return cache[q]; const lo = q === 'lo';
      const fir = conifer(0, lo, { H: HEIGHT[0], trunkH: 6, trunkR: 0.42, base: 2.4, topH: 0.6, R: 3.6, Rmin: 0.35, taper: 0.95, curve: 0.92, tiers: 12, tiersLo: 5, tierH: 1.9, lobes: 9, droop: 0.9, double: true,
        pal: { top: C(0x3f8a4c), mid: C(0x2c6e3c), tip: C(0x5aa25e), notch: C(0x1f5530), under: C(0x123320) } });
      const spruce = conifer(1, lo, { H: HEIGHT[1], trunkH: 4, trunkR: 0.48, base: 1.3, topH: 0.5, R: 4.9, Rmin: 0.4, taper: 0.85, curve: 0.98, tiers: 10, tiersLo: 4, tierH: 1.8, lobes: 11, droop: 1.45, double: true,
        pal: { top: C(0x6f9f97), mid: C(0x4a7e78), tip: C(0x86b4aa), notch: C(0x33605b), under: C(0x1c3b38) } });
      const xmas = conifer(2, lo, { H: HEIGHT[2], trunkH: 3, trunkR: 0.4, base: 1.0, topH: 0.5, R: 4.1, Rmin: 0.3, taper: 0.9, curve: 1.0, tiers: 10, tiersLo: 4, tierH: 1.6, lobes: 10, droop: 1.05, double: true,
        pal: { top: C(0x5fae55), mid: C(0x3f8c42), tip: C(0x7cc46a), notch: C(0x2c6a34), under: C(0x173a1f) } });
      const giant = conifer(3, lo, { H: HEIGHT[3], trunkH: 7.5, trunkR: 0.5, base: 3.2, topH: 0.7, R: 3.3, Rmin: 0.3, taper: 1.05, curve: 0.9, tiers: 14, tiersLo: 6, tierH: 1.9, lobes: 8, droop: 1.3, double: true,
        pal: { top: C(0x4d7340), mid: C(0x34592e), tip: C(0x627f4a), notch: C(0x24432a), under: C(0x13281a) } });
      cache[q + ':parts'] = [fir, spruce, xmas, giant];
      cache[q] = mergeVariants([fir, spruce, xmas, giant]);
      return cache[q];
    },
    // um modelo só (aVar = v): perto da câmera cada árvore processa só os vértices do próprio modelo (4x menos trabalho
    // que a malha com os 4 juntos). Use com attach(geo, [v, v, ...]).
    single(q, v) { q = q === 'lo' ? 'lo' : 'hi'; this.geometry(q); return cache[q + ':parts'][v]; },
    variantAt(x, z) { const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return Math.floor((h - Math.floor(h)) * 4) % 4; },
    // cópia leve (mesmos buffers) + atributo de instância com o modelo de cada árvore
    attach(geo, variants) {
      const g = new THREE.BufferGeometry(); for (const a in geo.attributes) g.setAttribute(a, geo.attributes[a]); g.setIndex(geo.index);
      g.boundingSphere = geo.boundingSphere && geo.boundingSphere.clone(); g.boundingBox = geo.boundingBox && geo.boundingBox.clone();
      g.setAttribute('iVar', new THREE.InstancedBufferAttribute(new Float32Array(variants), 1)); return g;
    },
    hook(sh) {
      sh.vertexShader = 'attribute float aVar;\nattribute float iVar;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n\tif (abs(aVar - iVar) > 0.5) transformed = vec3(0.0);   // vértice de outro modelo: fecha num ponto');
    },
    material(m, wind) {
      if (window.GfxFX && wind !== false) GfxFX.foliage(m, Object.assign({ amp: 0.022, h0: 3.0, freq: 0.9 }, wind || {}));
      if (window.GfxFX) return GfxFX.chain(m, 'pine-var', Pines.hook);
      const prev = m.onBeforeCompile; m.onBeforeCompile = (sh, r) => { if (prev) prev.call(m, sh, r); Pines.hook(sh); }; m.customProgramCacheKey = () => 'pine-var'; return m;
    },
    depthMaterial() {
      if (Pines._dm) return Pines._dm;
      const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); m.onBeforeCompile = Pines.hook; m.customProgramCacheKey = () => 'pine-var-depth';
      return (Pines._dm = m);
    }
  };
  window.Pines = Pines;
})();
