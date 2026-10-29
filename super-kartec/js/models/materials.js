// =====================================================================================
// models/materials.js — materiais dos karts
// * Tudo em MeshToonMaterial (via Toon.mat): sombra em 3 tons, brilho de plástico e luz de contorno.
//   Sem PBR nem mapa de ambiente: bem mais leve que a versão anterior.
// * Pintura com camada de adesivos (livery): o shader projeta a arte do Livery sobre a lataria
//   pelas coordenadas do próprio kart (lateral = projeção em X, capô/teto = projeção em Y).
//   Trocar a cor do adesivo é só mudar um uniform (instantâneo); trocar a estampa repinta um canvas.
// * Borracha fofa com gomos desenhados, plásticos brilhantes, "prata de brinquedo" e neon.
// =====================================================================================
(function () {
  let treadTex = null, knobTex = null;

  // banda de rodagem de desenho: gomos arredondados (borracha fofa), sem ruído
  function tread(knobby) {
    if (!knobby && treadTex) return treadTex; if (knobby && knobTex) return knobTex;
    const c = TX.cvs(128, 32), g = c.getContext('2d');
    g.fillStyle = '#202022'; g.fillRect(0, 0, 128, 32);          // borracha preta neutra
    g.fillStyle = '#141416';
    for (let i = 0; i < 8; i++) { const x = i * 16; if (knobby) { g.beginPath(); g.arc(x + 6, 11, 4, 0, 7); g.arc(x + 13, 22, 4, 0, 7); g.fill(); } else { g.beginPath(); g.ellipse(x + 8, 16, 3, 9, 0.5, 0, 7); g.fill(); } }
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); t.anisotropy = TX.aniso;
    if (knobby) knobTex = t; else treadTex = t; return t;
  }

  // ---------- shader do adesivo ----------
  // uDecal: atlas 1024² (metade de cima = lateral; quarto inferior esquerdo = capô; inferior direito = número)
  // canal R = cor do adesivo, G = branco (fundo do número), B = contorno de tinta (traço de desenho animado)
  const DECAL_VS_HEAD = 'varying vec3 vDecalP;\nvarying vec3 vDecalN;\n';
  const DECAL_FS_HEAD = [
    'uniform sampler2D uDecal; uniform vec3 uDecalColor; uniform vec3 uInk; uniform float uDecalOn;',
    'uniform vec4 uSide; uniform vec4 uTop; uniform vec4 uNumSide; uniform vec4 uNumTop;',
    'varying vec3 vDecalP; varying vec3 vDecalN;',
    'vec3 dMask(vec2 uv, vec2 o, vec2 s) { if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0); return texture2D(uDecal, o + uv * s).rgb; }'
  ].join('\n');
  const DECAL_FS_BODY = [
    'if (uDecalOn > 0.5) {',
    '  vec3 n = normalize(vDecalN); float wS = smoothstep(0.3, 0.62, abs(n.x)); float wT = smoothstep(0.35, 0.7, n.y) * (1.0 - wS);',
    '  vec2 uvS = vec2((vDecalP.z - uSide.x) / (uSide.y - uSide.x), (vDecalP.y - uSide.z) / (uSide.w - uSide.z));',
    '  vec2 uvT = vec2((uTop.y - vDecalP.x) / (uTop.y - uTop.x), (vDecalP.z - uTop.z) / (uTop.w - uTop.z));',
    '  vec3 m = dMask(uvS, vec2(0.0, 0.5), vec2(1.0, 0.5)) * wS + dMask(uvT, vec2(0.0, 0.0), vec2(0.5, 0.5)) * wT;',
    '  if (uNumSide.w > 0.5) { float sg = vDecalP.x > 0.0 ? -1.0 : 1.0; vec2 q = vec2(sg * (vDecalP.z - uNumSide.x) / uNumSide.z + 0.5, (vDecalP.y - uNumSide.y) / uNumSide.z + 0.5); m = max(m, dMask(q, vec2(0.5, 0.0), vec2(0.5, 0.5)) * wS); }',
    '  if (uNumTop.w > 0.5) { vec2 q = vec2(-(vDecalP.x - uNumTop.x) / uNumTop.z + 0.5, (vDecalP.z - uNumTop.y) / uNumTop.z + 0.5); m = max(m, dMask(q, vec2(0.5, 0.0), vec2(0.5, 0.5)) * wT); }',
    '  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(m.g, 0.0, 1.0));',
    '  diffuseColor.rgb = mix(diffuseColor.rgb, uDecalColor, clamp(m.r, 0.0, 1.0));',
    '  diffuseColor.rgb = mix(diffuseColor.rgb, uInk, clamp(m.b, 0.0, 1.0));',
    '}'
  ].join('\n');

  // Acabamentos (todos toon): gloss = mancha de brilho de plástico, rim = contorno claro
  const KartMats = {
    tread,
    initEnv() { return null; },          // o visual cartum não usa mapa de ambiente (economia de GPU e memória)
    get env() { return null; },
    // plástico liso (rough alto = fosco; rough baixo = brilhante)
    std(color, rough, metal, extra) {
      const gloss = rough === undefined ? 0.3 : Math.max(0, 0.75 - rough) * (metal > 0.5 ? 1.2 : 1);
      const p = Object.assign({ color }, extra || {}), sat = p.sat; delete p.envMapIntensity; delete p.sat;
      return Toon.mat(p, { gloss, rim: 0.3, sat, key: 'k' });
    },
    // borracha fosca: sem mancha de brilho, contorno claro bem fraco e sem o realce de saturação
    // O shader converte a cor final em tons de cinza: a luz do céu (azulada/roxa em vários horários e na
    // vitrine) não tinge mais a borracha -> pneu sempre PRETO. A névoa entra depois, como no resto da cena.
    rubber(knobby) { return Toon.mat({ color: 0xffffff, map: tread(knobby) }, { gloss: 0, rim: 0.06, sat: 0, key: 'rubber-mono', hook: sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = vec3(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)));\n#include <tonemapping_fragment>'); } }); },
    chrome() { return Toon.mat({ color: 0xb4bccb }, { gloss: 0.9, rim: 0.5, sat: 0, key: 'c' }); },   // "prata de brinquedo" (mais escura: não estoura em branco)
    neon(color) { const m = new THREE.MeshBasicMaterial({ color }); m.userData.unique = true; return m; },
    // tinta fresca: brilho forte + camada de adesivos
    paint(color, decal) {
      const u = {
        uDecal: { value: decal.texture }, uDecalColor: { value: new THREE.Color(decal.color) }, uInk: { value: new THREE.Color(Toon.INK) }, uDecalOn: { value: decal.on ? 1 : 0 },
        uSide: { value: new THREE.Vector4().fromArray(decal.side) }, uTop: { value: new THREE.Vector4().fromArray(decal.top) },
        uNumSide: { value: new THREE.Vector4().fromArray(decal.numSide) }, uNumTop: { value: new THREE.Vector4().fromArray(decal.numTop) }
      };
      const m = Toon.mat({ color }, { gloss: 0.85, rim: 0.35, sat: 0, key: 'paint', hook: sh => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = DECAL_VS_HEAD + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDecalP = position; vDecalN = normal;');
        sh.fragmentShader = DECAL_FS_HEAD + '\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + DECAL_FS_BODY);
      } });
      m.userData.unique = true; m.userData.decalUniforms = u;
      return m;
    },
    setEnvLevel() {}
  };
  window.KartMats = KartMats;
})();
