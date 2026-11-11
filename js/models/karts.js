// =====================================================================================
// models/karts.js — modelos de kart (registro expansível) + montagem completa
//
// buildKartModel(spec, opts) monta: veículo 3D (assets/kart.glb ou assets/motoca.glb) + pintura
// + rodas + volante animado (kart) / guidão (moto) + piloto sentado. spec = {
//   model: 'gt' (kart) | 'moto' (Motoca)   <- únicos modelos disponíveis,
//   color (corBase),
//   pilot ('menino' | 'menina'), suit, helmet, skin      <- piloto (sem números na lataria e sem acessórios)
// }
// Os .glb (carregados pelo models/glb.js durante a tela de carregamento) são convertidos UMA vez por modelo para o
// espaço do jogo (frente em +z, esquerda do piloto em +x, chão em y = 0) com as medidas de cada um (VEH): escala,
// rodas (pivô no cubo), volante recortado do chassi (gira com a direção e leva as mãos junto), manoplas, banco,
// pedais/pedaleiras, escapamentos (chama do turbo) e faróis. Cada kart da pista só cria materiais e grupos:
// as geometrias são compartilhadas.
// Pintura: o shader troca o vermelho da textura pela cor escolhida mantendo o sombreado da textura.
// Adesivos/decalques não existem nos veículos: nenhum carregamento, textura, mapeamento ou projeção nas malhas
// (kart e motoca sempre começam neutros, só com a pintura). Cada modelo devolve cockpit, rear, shadow e lean.
// =====================================================================================
(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---------------- medidas tiradas dos .glb (unidades do arquivo) ----------------
  // face: +1 = frente do arquivo em +x (kart) | -1 = frente em -x (moto). ground = altura da base dos pneus;
  // midX = centro do entre-eixos. scale = arquivo -> unidades do modelo do jogo (o grupo ainda leva x0,8).
  // Piloto: p = tamanho do piloto em unidades do arquivo (kart 0,75 e moto 1,25 dão o MESMO piloto na tela);
  // hip = ponto do quadril, feet = tornozelos, lean = inclinação do tronco, headTilt = cabeça erguida.
  // A pose da moto foi calculada por busca com colisão contra a malha inteira: o capacete fica com folga do
  // guidão e do para-brisa (e as marias-chiquinhas da menina também).
  const VEH = {
    gt: { glb: 'kart', face: 1, scale: 6.4, ground: -0.1485, midX: 0.0412, refV: 0.92,
      wheels: [['wheel_FL', 1], ['wheel_FR', 1], ['wheel_RL', 0], ['wheel_RR', 0]],   // 1 = esterça (kart.js)
      steer: { c: [0.184, 0.0897, 0.0023], n: [0.9, -0.436, 0.004], rim: 0.058, cutH: 0.05, cutBack: -0.05, cutR: 0.092, colH: 0.135, colR: 0.07, col2H: 0.2, col2R: 0.05, grip: 1.36, k: 0.9 },   // col*: coluna antiga (também sai)
      pilot: { p: 0.75, hip: [0.05, -0.0127, 0], feet: [0.165, -0.03, 0.06], lean: 0.05, headTilt: 0.02, footPitch: -0.45, leanK: 1, boostLean: -0.08, knee: [0.25, 0.55, 0.8] },
      exhaust: [[[-0.482, 0.069, 0.056], [-0.956, 0.292, 0.035]], [[-0.484, 0.061, -0.051], [-0.963, 0.269, -0.004]]], exR: 0.03,
      lights: [[0.452, -0.014, 0.188], [0.452, -0.014, -0.188]], lightR: 0.022, lean: -0.12 },
    moto: { glb: 'motoca', face: -1, scale: 3.84, ground: -0.399, midX: -0.0004, refV: 0.95,
      wheels: [['wheel_front', 2], ['wheel_rear', 0]],                                   // 2 = esterça pelo garfo (aqui, com amplitude de moto)
      grips: { c: [-0.112, 0.218, 0.212], r: 0.025 }, forkK: 0.22,
      pilot: { p: 1.25, hip: [0.23, 0.149, 0], feet: [0.12, -0.035, 0.215], lean: 0.44, headTilt: 0.6, footPitch: 0.25, leanK: 0.5, boostLean: 0, knee: [0.6, 0.3, 0.75] },
      exhaust: [[[0.655, 0.21, 0.06], [1, 0.06, 0]], [[0.655, 0.21, -0.06], [1, 0.06, 0]]], exR: 0.035,
      lightAuto: true, lightR: 0.03, lean: 0.42, moto: true }
  };

  // ---------------- pintura: troca do vermelho da textura pela cor escolhida ----------------
  const HSV = 'vec3 kHsv(vec3 c) { vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1.0e-10)), d / (q.x + 1.0e-10), q.x); }';
  const PAINT_FS_HEAD = ['uniform vec3 uPaint; uniform float uRefV;', HSV].join('\n');
  // wP = quanto o texel é "lataria vermelha"; kv = luz embutida na textura (mantida na cor nova)
  const PAINT_FS_BODY = [
    '{ vec3 hv = kHsv(texelColor.rgb); float dr = min(hv.x, 1.0 - hv.x);',
    '  float wP = (1.0 - smoothstep(0.045, 0.075, dr)) * smoothstep(0.35, 0.5, hv.y) * smoothstep(0.05, 0.14, hv.z);',
    '  float kv = hv.z / uRefV; float sh = min(kv, 1.0); vec3 hi = vec3(max(kv - 1.0, 0.0) * 0.5);',
    '  diffuseColor.rgb = mix(diffuseColor.rgb, uPaint * sh + hi, wP); }'
  ].join('\n');
  function paintMat(map, u) {
    const m = Toon.mat({ color: 0xffffff, map }, { gloss: 0.45, rim: 0.3, sat: 0, key: 'veh-paint', hook: sh => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = PAINT_FS_HEAD + '\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + PAINT_FS_BODY);
    } });
    m.userData.unique = true; return m;
  }

  const ENV_I = 1.0;     // intensidade do reflexo de estúdio nos veículos (1 = como no visualizador do modelo)
  // Materiais dos veículos = os MESMOS do .glb (PBR: verniz, cromado, vidro, texturas), com o reflexo de estúdio. Duas adaptações:
  //  * a saída é convertida para sRGB aqui dentro (o renderer do jogo desenha sem conversão);
  //  * no atlas (e nas tintas chapadas) o vermelho vira a cor escolhida, mantendo o sombreado.
  const PBR_HEAD = 'uniform vec3 uPaint; uniform float uRefV;\n' + HSV;
  const PBR_BODY = [
    '{ vec3 sc = LinearTosRGB(vec4(texelColor.rgb, 1.0)).rgb; vec3 hv = kHsv(sc); float dr = min(hv.x, 1.0 - hv.x);',
    '  float wP = (1.0 - smoothstep(0.045, 0.075, dr)) * smoothstep(0.35, 0.5, hv.y) * smoothstep(0.05, 0.14, hv.z);',
    '  float kv = hv.z / uRefV; float sh = min(kv, 1.0); vec3 hi = vec3(max(kv - 1.0, 0.0) * 0.5);',
    '  diffuseColor.rgb = mix(diffuseColor.rgb, sRGBToLinear(vec4(uPaint * sh + hi, 1.0)).rgb, wP); }'
  ].join('\n');
  function pbrMat(pt, u, env) {
    let m;
    if (pt.k === 'glass' && pt.mat.transmission > 0) {         // vidro com transmissão (cúpula da moto): transparente de verdade, mantém reflexos
      m = new THREE.MeshPhysicalMaterial({ color: pt.mat.color.clone(), roughness: pt.mat.roughness, metalness: pt.mat.metalness || 0, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.3, depthWrite: false });
    } else m = pt.mat.clone();
    if (pt.k === 'glass') { m.transparent = true; m.depthWrite = false; }
    if (m.emissive && pt.em > 1) m.emissiveIntensity = pt.em;
    m.envMap = env; m.envMapIntensity = ENV_I;
    const atlas = pt.k === 'atlas';
    m.onBeforeCompile = sh => {
      if (atlas) { Object.assign(sh.uniforms, u); sh.fragmentShader = PBR_HEAD + '\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + PBR_BODY); }
      sh.fragmentShader = sh.fragmentShader.replace('#include <encodings_fragment>', 'gl_FragColor = LinearTosRGB(gl_FragColor);');
    };
    m.customProgramCacheKey = () => 'veh-pbr-' + (atlas ? 'atlas' : 'plain');
    m.userData.unique = true; m.needsUpdate = true; return m;
  }

  // ---------------- conversão do .glb para o espaço do jogo (uma vez por modelo) ----------------
  function prepVehicle(def) {
    const d = def.veh; if (!d) return null;
    if (d._tpl !== undefined) return d._tpl;
    const gltf = window.GLBAssets && GLBAssets.get(d.glb);
    if (!gltf) return null;                                         // ainda não carregou (ou falhou): não guarda, tenta de novo depois
    const scene = gltf.scene; scene.updateMatrixWorld(true);
    const S = d.scale, R = new THREE.Matrix4();
    if (d.face > 0) R.set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1); else R.set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);
    const M = new THREE.Matrix4().makeScale(S, S, S).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-d.midX, -d.ground, 0));
    const G = a => new THREE.Vector3().fromArray(a).applyMatrix4(M), D = a => new THREE.Vector3().fromArray(a).transformDirection(R);
    // Os .glb podem trazer VÁRIAS primitivas/materiais por peça (chassi, pneus, faróis, escapamento...). Em vez de exigir uma
    // malha só por nó, junta TODAS as malhas debaixo de 'chassis' e de cada 'wheel_*', classifica cada uma pelo material
    // (atlas pintável / cor chapada pintável / borracha / cor fixa / brilho) e funde as de mesma classe numa geometria só.
    const nodeNamed = nm => { let f = null; scene.traverse(o => { if (!f && o.name === nm) f = o; }); return f; };
    const meshesOf = n => { const a = []; if (n) n.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes.position) a.push(o); }); return a; };
    const chassisNode = nodeNamed('chassis'), cMeshes = meshesOf(chassisNode);
    if (!cMeshes.length) { console.warn('[karts] ' + d.glb + '.glb sem o nó chassis'); return d._tpl = null; }
    // atlas = textura base com a lataria vermelha (a troca de cor mira nela)
    let map = null;
    scene.traverse(o => { if (!map && o.isMesh && o.material && o.material.map && /^(kart|moto)_/.test(o.material.name || '')) map = o.material.map; });
    scene.traverse(o => { if (!map && o.isMesh && o.material && o.material.map) map = o.material.map; });
    const isAtlas = m => !!(m.map && map && m.map.image === map.image && !/tire|tread/i.test(m.name || ''));   // (as texturas ficam como no .glb: sRGB + KHR_texture_transform)
        // classe da malha = o material ORIGINAL do .glb: 'atlas' (textura base com a lataria vermelha), 'flatpaint' (tinta chapada: moto),
    // 'glass' (transparente: cúpula da moto, lente do farol) ou 'pbr' (todo o resto, igual ao modelo). Malhas do mesmo material se fundem.
    const jm = (gltf.parser && gltf.parser.json && gltf.parser.json.materials) || [];
    const emStr = m => { const j = jm.find(x => x.name === m.name), e = j && j.extensions && j.extensions.KHR_materials_emissive_strength; return e ? e.emissiveStrength : 1; };
    const classify = mesh => {
      const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material; if (!m) return null;
      let k = 'pbr';
      if ((m.transmission && m.transmission > 0) || (m.transparent && m.opacity < 0.5)) k = 'glass';
      else if (isAtlas(m)) k = 'atlas';
      else if (!m.map && /paint|deck/i.test(m.name || '')) k = 'flatpaint';
      return { k, key: m.uuid, mat: m, em: emStr(m) };
    };
    // funde geometrias (position/normal/uv/index) numa só
    const mergeGeos = list => {
      if (list.length === 1) return list[0];
      let nv = 0, ni = 0; list.forEach(g => { nv += g.attributes.position.count; ni += g.index.count; });
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = new Uint32Array(ni); let vo = 0, io = 0;
      list.forEach(g => { P.set(g.attributes.position.array, vo * 3); N.set(g.attributes.normal.array, vo * 3); U.set(g.attributes.uv.array, vo * 2);
        for (let i = 0; i < g.index.count; i++) I[io + i] = g.index.array[i] + vo; vo += g.attributes.position.count; io += g.index.count; g.dispose(); });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      g.setIndex(new THREE.BufferAttribute(I, 1)); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
    };
    // buckets: key -> { cls, geos[] }  ->  [{ geo, ...cls }]
    const addTo = (bk, cls, g) => { (bk[cls.key] || (bk[cls.key] = { cls, geos: [] })).geos.push(g); };
    const finish = bk => Object.keys(bk).map(k => { const g = mergeGeos(bk[k].geos); g.userData.shared = true; return Object.assign({ geo: g }, bk[k].cls); });
    const tpl = { map, refV: d.refV, lean: d.lean, moto: !!d.moto, wheels: [], flames: [], lights: [] };
    // ----- chassi (e, no kart, o volante recortado dele) -----
    const bodyB = {}, steerB = {}; let pm = null, pmi = null, sw = null, C = null, n = null;
    if (d.steer) {
      sw = d.steer; C = V(...sw.c); n = V(...sw.n).normalize();
      // referencial do volante no jogo: z local aponta para o piloto, y local = "12 horas" do aro
      const up = V(0, 1, 0).addScaledVector(n, -n.y).normalize(), Zl = D(n.toArray()).negate(), Yl = D(up.toArray()), Xl = V().crossVectors(Yl, Zl).normalize();
      pm = new THREE.Matrix4().makeBasis(Xl, Yl, Zl).setPosition(G(sw.c)); pmi = pm.clone().invert();
    }
    // cor da textura no centro do triângulo: a lataria vermelha que passa perto da coluna não sai (só a peça escura do suporte)
    const pix = new Map();
    const redAt = (mesh, cb, t) => { try {
      const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material, mp = m && m.map, im = mp && mp.image; if (!im || !im.width) return false;
      let d = pix.get(im); if (!d) { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); d = { w: c.width, h: c.height, a: g.getImageData(0, 0, c.width, c.height).data }; pix.set(im, d); }
      let u = 0, v = 0; for (let k = 0; k < 3; k++) { const i = cb.I[t * 3 + k]; u += cb.U[i * 2]; v += cb.U[i * 2 + 1]; } u = u / 3 * mp.repeat.x + mp.offset.x; v = v / 3 * mp.repeat.y + mp.offset.y;
      u -= Math.floor(u); v -= Math.floor(v); const x = Math.min(d.w - 1, (u * d.w) | 0), y = Math.min(d.h - 1, ((mp.flipY ? 1 - v : v) * d.h) | 0), o = (y * d.w + x) * 4;
      const r = d.a[o], gg = d.a[o + 1], b = d.a[o + 2]; return r > 70 && r > gg * 1.6 && r > b * 1.6;
    } catch (e) { return false; } };
    cMeshes.forEach(mesh => {
      const cls = classify(mesh); if (!cls) return;
      const cb = GLBAssets.bake(mesh, mesh.matrixWorld);
      if (sw) {
        const nt = cb.I.length / 3, inW = new Uint8Array(nt), c = V(0, 0, 0), dv = V(0, 0, 0); let any = 0;
        for (let t = 0; t < nt; t++) { c.set(0, 0, 0); for (let k = 0; k < 3; k++) { const i = cb.I[t * 3 + k]; c.x += cb.P[i * 3]; c.y += cb.P[i * 3 + 1]; c.z += cb.P[i * 3 + 2]; }
          c.multiplyScalar(1 / 3); dv.subVectors(c, C); const h = dv.dot(n), rr = dv.addScaledVector(n, -h).length();
          if (h < sw.cutH && h > sw.cutBack && rr < sw.cutR) { inW[t] = 1; any++; continue; }
          // coluna antiga: só sai o triângulo com os 3 vértices dentro do tubo (as placas grandes do bico, que passam por ali, ficam)
          if (sw.colH) { let all = true; for (let k = 0; k < 3 && all; k++) { const i = cb.I[t * 3 + k]; dv.set(cb.P[i * 3] - C.x, cb.P[i * 3 + 1] - C.y, cb.P[i * 3 + 2] - C.z);
              const hv = dv.dot(n), rv = dv.addScaledVector(n, -hv).length(); all = hv > sw.cutBack && ((hv < sw.colH && rv < sw.colR) || (hv < sw.col2H && rv < sw.col2R)); }
            if (all && !redAt(mesh, cb, t)) { inW[t] = 1; any++; } } }
        if (any < nt) addTo(bodyB, cls, GLBAssets.geometry(cb, t => !inW[t], M));
        if (any) addTo(steerB, cls, GLBAssets.geometry(cb, t => inW[t], pmi.clone().multiply(M)));
      } else addTo(bodyB, cls, GLBAssets.geometry(cb, null, M));
    });
    tpl.bodyParts = finish(bodyB);
    if (sw) {
      tpl.steerParts = finish(steerB);
      const r = sw.rim * S, a = sw.grip;
      tpl.steer = { pos: V().setFromMatrixPosition(pm), quat: new THREE.Quaternion().setFromRotationMatrix(pm), k: sw.k, colLen: Math.max(sw.colH || 0, sw.col2H || 0) * S * 0.92,
        // mão esquerda (+x do jogo = -x local) e direita; t = sentido do polegar (para as 12 horas, ao longo do aro)
        grips: [{ pos: V(-r * Math.sin(a), r * Math.cos(a), 0), t: V(Math.cos(a), Math.sin(a), 0) }, { pos: V(r * Math.sin(a), r * Math.cos(a), 0), t: V(-Math.cos(a), Math.sin(a), 0) }] };
    }
    // ----- rodas: geometria centrada no cubo (gira em x; as da frente esterçam em y) -----
    d.wheels.forEach(([name, steer]) => {
      const node = nodeNamed(name), ms = meshesOf(node); if (!ms.length) return;
      node.updateWorldMatrix(true, false);
      const hub = V().setFromMatrixPosition(node.matrixWorld).applyMatrix4(M), wB = {};
      const toHub = new THREE.Matrix4().makeTranslation(-hub.x, -hub.y, -hub.z).multiply(M);
      ms.forEach(mesh => { const cls = classify(mesh); if (!cls) return; addTo(wB, cls, GLBAssets.geometry(GLBAssets.bake(mesh, mesh.matrixWorld), null, toHub)); });
      const parts = finish(wB); let r = 0;
      parts.forEach(pt => { const p = pt.geo.attributes.position; for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getY(i), p.getZ(i))); });
      tpl.wheels.push({ parts, hub, r, steer });
    });
    // ----- piloto: quadril, tornozelos, manoplas (moto) -----
    const pp = d.pilot, pair = a => { const A = G([a[0], a[1], a[2]]), B = G([a[0], a[1], -a[2]]); return A.x > B.x ? [A, B] : [B, A]; };   // [esquerda (+x), direita]
    tpl.cockpit = { seat: G(pp.hip), scale: pp.p * S, feet: pair(pp.feet), lean: pp.lean, headTilt: pp.headTilt, footPitch: pp.footPitch, leanK: pp.leanK, boostLean: pp.boostLean, knee: pp.knee, moto: !!d.moto };
    if (d.grips) { const gp = pair(d.grips.c); tpl.grips = [{ pos: gp[0], t: V(-1, 0, 0) }, { pos: gp[1], t: V(1, 0, 0) }]; tpl.forkK = d.forkK; }   // polegares para dentro
    // ----- escapamentos (chama do turbo) e faróis -----
    (d.exhaust || []).forEach(([tip, dir]) => tpl.flames.push({ pos: G(tip), dir: D(dir), r: d.exR * S }));
    const fwd = V(0, 0, 1);
    if (d.lights) d.lights.forEach(l => tpl.lights.push({ pos: G(l).addScaledVector(fwd, 0.004 * S), r: d.lightR * S }));
    if (d.lightAuto) { let best = null;   // ponta do bico (moto): vértice mais à frente perto do eixo
      tpl.bodyParts.forEach(pt => { const p = pt.geo.attributes.position;
        for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (Math.abs(x) < 0.12 * S * 0.25 && y > 0.4 * S && y < 0.6 * S && (!best || z > best.z)) best = V(x, y, z); } });
      if (best) tpl.lights.push({ pos: best.addScaledVector(fwd, 0.006 * S), r: d.lightR * S }); }
    // ----- sombra e rodas de trás -----
    const bb = new THREE.Box3(); tpl.bodyParts.forEach(pt => bb.union(pt.geo.boundingBox)); const sz = bb.getSize(V());
    tpl.shadow = [Math.max(sz.x * 0.47, 0.9), sz.z * 0.46];
    const rears = tpl.wheels.filter(w => w.steer === 0);
    tpl.rear = rears.length > 1 ? { x: Math.abs(rears[0].hub.x), z: rears[0].hub.z } : { x: 0.45, z: rears.length ? rears[0].hub.z : -1.95 };
    return d._tpl = tpl;
  }

  // =====================================================================================
  // VOLANTE DE DRIFT (inspirado num volante esportivo de prato fundo): aro de couro preto com faixas amarelas no topo e
  // embaixo e a palavra DRIFTING na parte de cima à esquerda; três raios de titânio escovado vazados; prato fundo (o cubo
  // fica para trás); cubo com 6 parafusos e botão da buzina. Referencial do volante: z aponta para o piloto, y = 12 horas.
  // r = raio do aro (centro do tubo). Texturas feitas uma vez e compartilhadas.
  // =====================================================================================
  let DW = null;
  function driftWheelAssets() {
    if (DW) return DW;
    const cv = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t; };
    // aro: u = volta do aro (0 = 3 horas, sentido anti-horário visto pelo piloto), v = volta do tubo (0 = fora, .25 = frente, .5 = dentro)
    const rimT = cv(2048, 256, (g, W, H) => {
      g.fillStyle = '#161616'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 26000; i++) { const v = Math.random() < 0.5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${(Math.random() * 0.07).toFixed(3)})`; g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5); }   // grão do couro
      // costura do lado de dentro (v = .5 -> y = H/2 no canvas, que vem de cabeça para baixo)
      g.strokeStyle = 'rgba(120,120,120,.55)'; g.lineWidth = 2; g.setLineDash([10, 8]); [H * 0.47, H * 0.53].forEach(y => { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }); g.setLineDash([]);
      // faixas amarelas: duas em cima (12 h +- 17 graus) e duas embaixo (6 h +- 17 graus)
      [90 - 17, 90 + 17, 270 - 17, 270 + 17].forEach(a => { const x = a / 360 * W; g.fillStyle = '#f2c214'; g.fillRect(x - 13, 0, 26, H); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x - 13, 0, 4, H); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 9, 0, 4, H); });
      // DRIFTING: no alto à esquerda, lendo de baixo para cima, com o topo das letras para fora (no canvas: girado 180 graus)
      g.save(); g.translate(150 / 360 * W, H * 0.75); g.rotate(Math.PI); g.font = 'italic 900 30px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.scale(1.25, 1); g.lineWidth = 3; g.strokeStyle = '#f2c214'; g.strokeText('DRIFTING', 0, 0); g.fillStyle = '#161616'; g.fillText('DRIFTING', 0, 0); g.restore(); });
    const brushT = cv(256, 256, (g, W, H) => { g.fillStyle = '#9a9ea4'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 900; i++) { const y = Math.random() * H, v = 120 + Math.random() * 110; g.fillStyle = `rgba(${v},${v},${v + 4},.35)`; g.fillRect(0, y, W, 0.6 + Math.random()); } });   // titânio escovado
    brushT.wrapS = brushT.wrapT = THREE.RepeatWrapping;
    return (DW = { rimT, brushT });
  }
  function buildDriftWheel(r, env) {
    const A = driftWheelAssets(), G = new THREE.Group(), dish = 0.42 * r;
    const fix = m => { m.envMap = env; m.envMapIntensity = ENV_I; m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <encodings_fragment>', 'gl_FragColor = LinearTosRGB(gl_FragColor);'); }; return m; };
    const leather = fix(new THREE.MeshStandardMaterial({ map: A.rimT, roughness: 0.62, metalness: 0 }));
    const ti = fix(new THREE.MeshStandardMaterial({ map: A.brushT, color: 0xb9bdc4, roughness: 0.34, metalness: 0.85 }));
    const black = fix(new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.5, metalness: 0.3 }));
    const chrome = fix(new THREE.MeshStandardMaterial({ color: 0xe6e8ec, roughness: 0.12, metalness: 1 }));
    const yellow = fix(new THREE.MeshStandardMaterial({ color: 0xf2c214, roughness: 0.4, metalness: 0.1 }));
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x || 0, y || 0, z || 0); G.add(o); return o; };
    // aro
    add(new THREE.TorusGeometry(r, r * 0.125, 16, 96), leather);
    // raios: 9 h, 3 h e 6 h (como na foto); placa afinando do cubo ao aro, com rasgo; descem para o cubo (prato fundo)
    const x0 = r * 0.2, x1 = r * 0.93, tilt = Math.asin(dish / (x1 - x0)), th = r * 0.045;
    const spokeShape = () => { const s = new THREE.Shape(), w0 = r * 0.2, w1 = r * 0.13;
      s.moveTo(x0, -w0); s.lineTo(x1, -w1); s.quadraticCurveTo(x1 + r * 0.04, 0, x1, w1); s.lineTo(x0, w0); s.closePath();
      const hole = new THREE.Path(), hx0 = x0 + r * 0.3, hx1 = x1 - r * 0.2, hw = r * 0.035; hole.moveTo(hx0, -hw); hole.lineTo(hx1, -hw); hole.absarc(hx1, 0, hw, -Math.PI / 2, Math.PI / 2, false); hole.lineTo(hx0, hw); hole.absarc(hx0, 0, hw, Math.PI / 2, Math.PI * 1.5, false);
      s.holes.push(hole); return s; };
    const sg = new THREE.ExtrudeGeometry(spokeShape(), { depth: th, bevelEnabled: true, bevelThickness: th * 0.3, bevelSize: th * 0.3, bevelSegments: 2, curveSegments: 10 });
    sg.translate(0, 0, -th / 2);
    [Math.PI, 0, -Math.PI / 2].forEach(a => { const piv = new THREE.Group(); piv.rotation.z = a; G.add(piv);
      const sp = new THREE.Mesh(sg, ti); sp.rotation.y = -tilt; sp.position.z = -(x1 * Math.sin(tilt)); piv.add(sp);
      const boss = new THREE.Mesh(new THREE.SphereGeometry(r * 0.17, 16, 10), leather); boss.scale.set(1.1, 0.75, 0.75); boss.position.set(r * 0.97, 0, -r * 0.01); piv.add(boss); });   // couro grosso onde o raio encontra o aro
    // cubo: disco escovado, 6 parafusos, anel preto, botão cromado com aro amarelo
    const hz = -dish - th * 0.2;
    add(new THREE.CylinderGeometry(r * 0.27, r * 0.27, r * 0.05, 32), ti, 0, 0, hz).rotation.x = Math.PI / 2;
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; add(new THREE.CylinderGeometry(r * 0.028, r * 0.028, r * 0.04, 10), black, Math.cos(a) * r * 0.21, Math.sin(a) * r * 0.21, hz + r * 0.035).rotation.x = Math.PI / 2; }
    add(new THREE.CylinderGeometry(r * 0.15, r * 0.15, r * 0.06, 28), black, 0, 0, hz + r * 0.04).rotation.x = Math.PI / 2;
    add(new THREE.TorusGeometry(r * 0.105, r * 0.016, 8, 32), yellow, 0, 0, hz + r * 0.075);
    add(new THREE.CylinderGeometry(r * 0.1, r * 0.1, r * 0.05, 28), chrome, 0, 0, hz + r * 0.08).rotation.x = Math.PI / 2;
    G.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return { group: G, mats: [leather, ti, black, chrome, yellow] };
  }

  // =====================================================================================
  // MODELOS
  // =====================================================================================
  const MODELS = [
    { id: 'gt', name: 'Kartec GT', desc: 'Kart clássico de chassi tubular: equilibrado e fácil de pilotar.', veh: VEH.gt },
    { id: 'moto', name: 'Motoca', desc: 'Moto futurista de carenagem lisa: deita nas curvas e empina.', veh: VEH.moto }
  ];
  const byId = id => MODELS.find(m => m.id === id) || MODELS[0];

  // =====================================================================================
  // montagem completa
  // =====================================================================================
  function buildKartModel(spec, opts) {
    opts = opts || {};
    // number: 0 e accessory: 'none' são forçados e decal/decalColor são apagados: números na lataria, acessórios do piloto
    // e adesivos foram removidos (vale também para specs antigos da rede ou salvos no navegador): estado sempre neutro
    spec = Object.assign({}, CFG.DEFAULT_SPEC, typeof spec === 'string' ? { color: spec } : spec, { number: 0, accessory: 'none' });
    delete spec.decal; delete spec.decalColor;
    const def = byId(spec.model), tpl = prepVehicle(def);
    if (!tpl) return fallbackModel(spec, opts, def);
    const u = { uPaint: { value: new THREE.Color(spec.color) }, uRefV: { value: tpl.refV } };
    // um material por material do .glb (clonado por kart: a cor de pintura é individual)
    const env = window.KartMats ? KartMats.env : null, matCache = {}, flatPaints = []; let paint = null;
    const matFor = pt => matCache[pt.key] || (matCache[pt.key] = (() => {
      const m = pbrMat(pt, u, env);
      if (pt.k === 'flatpaint') { flatPaints.push(m); m.color.set(spec.color).convertSRGBToLinear(); }
      if (!paint && (pt.k === 'atlas' || pt.k === 'flatpaint')) paint = m;
      return m; })());
    const meshesFor = parts => parts.map(pt => { const me = new THREE.Mesh(pt.geo, matFor(pt)); if (pt.k === 'glass') { me.renderOrder = 3; me.userData.noOutline = true; me.userData.noShadow = true; } return me; });
    const group = new THREE.Group(), pivot = new THREE.Group(), body = new THREE.Group(); group.add(pivot); pivot.add(body);
    meshesFor(tpl.bodyParts).forEach(me => body.add(me));
    // rodas
    const fw = [], rolls = []; let fork = null;
    tpl.wheels.forEach(w => { const p = new THREE.Group(); p.position.copy(w.hub); pivot.add(p); const roll = new THREE.Group(); p.add(roll);
      meshesFor(w.parts).forEach(me => roll.add(me)); rolls.push({ g: roll, r: w.r * 0.8 });
      if (w.steer === 1) fw.push(p); else if (w.steer === 2) fork = p; });
    // volante (kart: gira com a direção e leva as mãos) / manoplas fixas (moto)
    let steerRig, hands;
    if (tpl.steer) {
      const piv = new THREE.Group(); piv.position.copy(tpl.steer.pos); piv.quaternion.copy(tpl.steer.quat); body.add(piv);
      const spin = new THREE.Group(); spin.userData.dynamic = true; piv.add(spin);
      // volante de drift no lugar do volante recortado do modelo (+ coluna de direção até o painel)
      const r0 = tpl.steer.grips[0].pos.length(), dw = buildDriftWheel(r0, env); spin.add(dw.group); dw.mats.forEach((m, i) => { matCache['driftwheel' + i] = m; });
      // coluna nova: tubo do cubo até a frente do chassi (onde ficava a antiga), mancal com abraçadeira no meio e flange no fim
      const L = (tpl.steer.colLen || r0 * 2.8), z0 = -r0 * 0.47, mk = (geo, m, z) => { const o = new THREE.Mesh(geo, m); o.rotation.x = Math.PI / 2; o.position.z = z; o.castShadow = true; piv.add(o); return o; };
      mk(new THREE.CylinderGeometry(r0 * 0.065, r0 * 0.065, L, 14), matCache.driftwheel1, z0 - L / 2);
      mk(new THREE.CylinderGeometry(r0 * 0.12, r0 * 0.12, r0 * 0.16, 16), matCache.driftwheel2, z0 - r0 * 0.06);            // cubo de engate rápido
      mk(new THREE.CylinderGeometry(r0 * 0.13, r0 * 0.13, r0 * 0.14, 16), matCache.driftwheel2, z0 - L * 0.55);             // mancal
      { const cl = new THREE.Mesh(new THREE.BoxGeometry(r0 * 0.34, r0 * 0.1, r0 * 0.12), matCache.driftwheel2); cl.position.set(0, -r0 * 0.13, z0 - L * 0.55); cl.castShadow = true; piv.add(cl); }
      mk(new THREE.CylinderGeometry(r0 * 0.15, r0 * 0.15, r0 * 0.05, 16), matCache.driftwheel1, z0 - L + r0 * 0.02);
      hands = tpl.steer.grips.map(g => { const o = new THREE.Object3D(); o.position.copy(g.pos); o.userData.t = g.t.clone(); spin.add(o); return o; });
      steerRig = { spin, axis: 'z', k: tpl.steer.k };
    } else {
      hands = (tpl.grips || []).map(g => { const o = new THREE.Object3D(); o.position.copy(g.pos); o.userData.t = g.t.clone(); body.add(o); return o; });
      steerRig = { spin: null, axis: 'y', fork, k: tpl.forkK || 0 };
    }
    const feet = tpl.cockpit.feet.map(p => { const o = new THREE.Object3D(); o.position.copy(p); body.add(o); return o; });
    const cockpit = Object.assign({}, tpl.cockpit, { hands, feet });
    // chama do turbo na ponta de cada escapamento
    const flames = tpl.flames.map(fl => {
      const f = new THREE.Mesh(new THREE.ConeGeometry(fl.r * 0.95, 1.8, 16), new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      f.position.copy(fl.pos).addScaledVector(fl.dir, 0.9); f.quaternion.setFromUnitVectors(V(0, 1, 0), fl.dir); f.visible = false; f.userData.dynamic = true; f.userData.noOutline = true; body.add(f); return f; });
    // lente dos faróis (acende à noite) sobre o farol do modelo
    const lensPos = tpl.lights.map(l => { const lensM = new THREE.MeshBasicMaterial({ color: 0xd8d2b0 }); lensM.userData.unique = true;
      const lens = new THREE.Mesh(new THREE.CircleGeometry(l.r, 20), lensM); lens.position.copy(l.pos); lens.userData.dynamic = true;   // sem body.add: o farol do próprio modelo aparece; o objeto só guarda o tom (kart.js)
      return { lens, x: l.pos.x, y: l.pos.y, z: l.pos.z + l.r * 0.5 }; });
    // sombra-bolha, farol (só o jogador leva luz de verdade), brilhos dos faróis
    const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.16, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.scale.set(tpl.shadow[0], tpl.shadow[1], 1); blob.position.y = 0.03; group.add(blob);
    let headL = null;
    const front = lensPos.length ? lensPos[0].z + 0.3 : 3.7, lightY = lensPos.length ? lensPos[0].y : 1.0;
    if (opts.lights) { // alcance curto + decaimento forte: sem clarão nas paredes do túnel
      headL = new THREE.SpotLight(0xfff0c8, 0, 48, 0.5, 0.65, 2); headL.position.set(0, lightY + 0.1, front); group.add(headL);
      const t = new THREE.Object3D(); t.position.set(0, 0, 22); group.add(t); headL.target = t; }
    const headGlows = lensPos.map(l => { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: 0xfff2c0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); p.position.set(l.x, l.y, l.z + 0.2); p.scale.setScalar(1.6); group.add(p); return p; });
    group.scale.setScalar(0.8);
    group.traverse(o => { if (o.isMesh && !o.material.isMeshBasicMaterial) { o.castShadow = !o.userData.noShadow; o.receiveShadow = false; } });
    // sem contorno de desenho animado: o veículo é desenhado como no modelo original (o piloto mantém o dele)
    if (opts.outline !== false) {
      group.traverse(o => { if (o.isMesh || o.isSprite) o.frustumCulled = false; });   // kart inteiro sempre desenhado (são poucos objetos; evita sumir na borda da tela)
    }
    // piloto
    let pilot = null;
    const mount = () => { pilot = Pilot.create(spec); pilot.attach(body, cockpit); pilot.update(0, {}); return pilot; };
    if (opts.pilot !== false && window.Pilot) mount();

    const m = {
      group, pivot, body, blob, headL, headGlows, spec, pilot, def,
      fw, rolls, flames, headLens: lensPos.map(l => l.lens), neons: [],
      rear: tpl.rear, lean: tpl.lean, moto: tpl.moto, steerRig, mats: { paint: paint || matFor(tpl.bodyParts[0]) }, paint: paint || matFor(tpl.bodyParts[0]),
      // ---- personalização em tempo real (sem reconstruir a malha) ----
      setColor(hex) { u.uPaint.value.set(hex); spec.color = hex; flatPaints.forEach(m => m.color.set(hex).convertSRGBToLinear()); },
      // troca de cores do piloto ou do personagem (menino/menina): o personagem novo é montado no mesmo lugar
      setPilot(s) { const before = spec.pilot; Object.assign(spec, s, { accessory: 'none' });
        if (!this.pilot) return;
        if (spec.pilot !== before) { this.pilot.dispose(); this.pilot = mount(); }
        else this.pilot.setColors(spec); },
      // anima volante, garfo da moto e piloto. st = { steer, speed(0..1), boost, drift, air }
      animate(dt, st) {
        const sr = this.steerRig, a = st.steer || 0; if (sr.spin) sr.spin.rotation.z = a * sr.k; if (sr.fork) sr.fork.rotation.y = a * sr.k;
        // LOD do piloto (m.lod, definido pelo main.js > kartCull): 0 = todo quadro, 1 = a cada 2, 2 = a cada 4, 3 = fora da tela (parado).
        // O IK de braços e pernas é o que mais pesa por kart; longe ninguém percebe a animação em passos.
        const pl = this.pilot;
        if (pl) { const L = this.lod || 0; this._pacc = Math.min(0.25, (this._pacc || 0) + dt);
          if (L >= 3) return;
          if (L > 0 && (this._pf = ((this._pf || 0) + 1) % (L === 1 ? 2 : 4)) !== 0) return;
          pl.update(this._pacc, st); this._pacc = 0; }
      },
      setNight(nf) { const e = ENV_I * (1 - 0.75 * nf); Object.keys(matCache).forEach(k => matCache[k].envMapIntensity = e); },
      dispose() { if (this.pilot) this.pilot.dispose(); disposeTree(group); }
    };
    return m;
  }
  // geometrias compartilhadas entre karts (modelo convertido) não são descartadas aqui
  function disposeTree(root) { root.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); }); }

  // ---------- reserva: se o .glb não carregou, um kart simples com a mesma interface (o jogo segue funcionando) ----------
  function fallbackModel(spec, opts, def) {
    const moto = def.id === 'moto', col = new THREE.Color(spec.color);
    const paint = KartMats.std(col, 0.4, 0.1, { sat: 0 }), dark = KartMats.std(0x24262c, 0.6, 0), rub = KartMats.rubber(false);
    paint.userData.unique = true;
    const group = new THREE.Group(), pivot = new THREE.Group(), body = new THREE.Group(); group.add(pivot); pivot.add(body);
    const add = (g, m, x, y, z, p) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); (p || body).add(o); return o; };
    add(GEO.rbox(moto ? 0.9 : 2.6, 0.7, moto ? 4.6 : 5.6, 0.25, 2), paint, 0, 1.2, 0);
    const fw = [], rolls = [];
    (moto ? [[0, 2.0, 0.9], [0, -2.0, 0.9]] : [[1.5, 1.8, 0.7], [-1.5, 1.8, 0.7], [1.6, -1.8, 0.8], [-1.6, -1.8, 0.8]]).forEach(([x, z, r], i) => {
      const p = new THREE.Group(); p.position.set(x, r, z); pivot.add(p); const roll = new THREE.Group(); p.add(roll);
      add(new THREE.CylinderGeometry(r, r, 0.6, 18).rotateZ(Math.PI / 2), rub, 0, 0, 0, roll); rolls.push({ g: roll, r: r * 0.8 }); if (z > 0) fw.push(p); });
    const hands = [1, -1].map(s => { const o = new THREE.Object3D(); o.position.set(s * 0.45, 2.1, 1.0); body.add(o); return o; });
    const feet = [1, -1].map(s => { const o = new THREE.Object3D(); o.position.set(s * 0.4, 1.0, 1.5); body.add(o); return o; });
    const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.16, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.scale.set(moto ? 1.2 : 1.9, 3.2, 1); blob.position.y = 0.03; group.add(blob);
    group.scale.setScalar(0.8);
    let pilot = null;
    if (opts.pilot !== false && window.Pilot) { pilot = Pilot.create(spec); pilot.attach(body, { seat: V(0, 1.9, -0.6), scale: 1.6, hands, feet }); pilot.update(0, {}); }
    return { group, pivot, body, blob, headL: null, headGlows: [], spec, pilot, def, fw, rolls, flames: [], headLens: [], neons: [],
      rear: { x: moto ? 0.45 : 1.6, z: -1.8 }, lean: moto ? 0.42 : -0.12, moto, steerRig: null, mats: { paint }, paint,
      setColor(hex) { paint.color.set(hex); spec.color = hex; },
      setPilot(s) { Object.assign(spec, s, { accessory: 'none' }); if (pilot) pilot.setColors(spec); },
      animate(dt, st) { if (pilot && (this.lod || 0) < 3) pilot.update(dt, st); },
      setNight() { }, dispose() { if (pilot) pilot.dispose(); disposeTree(group); } };
  }

  window.KartModels = { list: () => MODELS, get: byId, register(m) { MODELS.push(m); }, prepare: id => prepVehicle(byId(id)) };
  window.buildKartModel = buildKartModel;
})();
