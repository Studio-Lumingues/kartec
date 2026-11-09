// =====================================================================================
// models/materials.js — materiais dos karts
// * Tudo em MeshToonMaterial (via Toon.mat): sombra em 3 tons, brilho de plástico e luz de contorno.
//   Sem PBR nem mapa de ambiente: bem mais leve que a versão anterior.
// * Borracha fofa com gomos desenhados, plásticos brilhantes, "prata de brinquedo" e neon.
// =====================================================================================
(function () {
  let treadTex = null, knobTex = null, envTex = null;

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
    // Ambiente de estúdio (céu em degradê + painéis de luz) pré-filtrado em PMREM: dá aos veículos os mesmos reflexos do modelo
    // original (verniz da pintura, cromados, vidro). Só os materiais dos veículos usam (karts.js); o resto do jogo segue toon.
    initEnv(renderer) {
      if (envTex || !renderer || !THREE.PMREMGenerator) return envTex;
      try {
        const sc = new THREE.Scene(), g = new THREE.SphereGeometry(50, 32, 16), p = g.attributes.position, cols = [];
        const top = new THREE.Color(0xe8eef6), mid = new THREE.Color(0xaeb8c4), bot = new THREE.Color(0x2e323a), c = new THREE.Color();
        for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 50; if (y > 0) c.copy(mid).lerp(top, Math.pow(y, 0.7)); else c.copy(mid).lerp(bot, Math.min(1, -y * 1.6)); cols.push(c.r, c.g, c.b); }
        g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        sc.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
        const panel = (w, h, x, y, z, I) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(I, I, I), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); sc.add(m); };
        panel(34, 20, 0, 42, 0, 5); panel(10, 30, -36, 12, 10, 4); panel(10, 30, 36, 12, -10, 3); panel(26, 8, 0, 16, -42, 3); panel(22, 8, 0, 14, 42, 2);
        const pm = new THREE.PMREMGenerator(renderer); envTex = pm.fromScene(sc, 0.03).texture; pm.dispose();
      } catch (e) { console.warn('[env] ambiente de estúdio indisponível:', e); envTex = null; }
      return envTex;
    },
    get env() { return envTex; },
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
