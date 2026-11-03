// =====================================================================================
// models/materials.js — materiais dos karts
// * Tudo em MeshToonMaterial (via Toon.mat): sombra em 3 tons, brilho de plástico e luz de contorno.
//   Sem PBR nem mapa de ambiente: bem mais leve que a versão anterior.
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
    setEnvLevel() {}
  };
  window.KartMats = KartMats;
})();
