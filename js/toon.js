// =====================================================================================
// toon.js — materiais do jogo (o efeito "desenho animado" foi REMOVIDO)
//
// O arquivo continua existindo e com a mesma interface (Toon.mat, Toon.outline, Toon.during...) porque o
// resto do jogo chama essas funções em vários lugares. O que mudou:
// * Toon.mat(params, opts): agora devolve um MeshPhongMaterial comum (luz e sombra suaves e realistas,
//   iluminação por pixel). Nada de rampa de 3 tons, brilho duro de plástico, luz de contorno (rim) ou
//   escurecimento das faces de baixo. opts.gloss vira o brilho (shininess/specular) do Phong; opts.hook
//   continua funcionando (adesivos, troca de cor do piloto e dos veículos).
// * Toon.outline(...): não faz mais nada (sem contorno preto em karts, pilotos e troféu).
// * Toon.during(fn): só executa fn; os materiais Lambert/Phong da pista e do cenário ficam como foram criados.
// * Toon.vivid(cor): mantido (só realça a saturação das cores; não é sombreamento).
// * Toon.INK: mantido (é a cor do traço desenhado em volta dos adesivos, dentro da própria textura).
// Custo: o Phong custa praticamente o mesmo que o toon antigo, e sem os contornos o jogo desenha menos.
// =====================================================================================
(function () {
  const INK = 0x2a1d4a;
  let grad = null;
  const Lambert = THREE.MeshLambertMaterial, Phong = THREE.MeshPhongMaterial;

  // mantido só por compatibilidade (main.js guarda esta textura ao limpar a cena); não é mais usado nos materiais
  function gradient() {
    if (grad) return grad;
    grad = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    grad.needsUpdate = true;
    return grad;
  }

  function vivid(c, k) {
    const col = c && c.isColor ? c : new THREE.Color(c === undefined ? 0xffffff : c), hsl = {}; col.getHSL(hsl);
    if (hsl.s > 0.08) col.setHSL(hsl.h, Math.min(1, hsl.s * (k || 1.25) + 0.06), Math.min(0.92, hsl.l * 1.02 + 0.02));
    return col;
  }

  // opts: { gloss (0..1) = brilho, sat (0 = cor exata), hook(shader) para shaders extras (adesivo, recolor), key }
  function mat(params, opts) {
    opts = opts || {}; params = Object.assign({}, params);
    ['gradientMap', 'roughness', 'metalness', 'envMap', 'envMapIntensity', 'normalMap', 'normalScale', 'flatShading'].forEach(k => delete params[k]);
    if (params.color !== undefined) params.color = opts.sat === 0 ? new THREE.Color(params.color) : vivid(params.color, opts.sat);
    if (params.emissive !== undefined) params.emissive = new THREE.Color(params.emissive);
    const gloss = opts.gloss || 0;
    const m = new Phong(Object.assign({ shininess: 8 + gloss * 50, specular: new THREE.Color(0.04 + gloss * 0.22, 0.04 + gloss * 0.22, 0.04 + gloss * 0.22) }, params));
    m.userData.toonU = { uGloss: { value: gloss }, uRim: { value: 0 } };            // compatibilidade
    if (opts.hook) {
      m.onBeforeCompile = sh => opts.hook(sh);
      m.customProgramCacheKey = () => 'phong-' + (opts.key || 'g');
    } else m.userData.mergeKey = 'phong:' + gloss + ':' + (opts.key || 'g');      // materiais iguais podem ser agrupados
    return m;
  }

  // sem contorno
  function outline() { return 0; }

  // sem conversão: os materiais da pista/cenário ficam como foram criados
  function during(fn) { return fn(); }

  window.Toon = { INK, gradient, vivid, mat, outline, during, Lambert };
})();
