// =====================================================================================
// postfx.js — acabamento de imagem da corrida, mantendo o visual cartoon
//  * sombra de contato (oclusão ambiente pela profundidade): pé das árvores, zebras, embaixo dos karts e pontes
//  * contorno bem leve nas silhuetas de perto (mantém o jeito cartoon sem parecer desenho)
//  * brilho mínimo, só no que é luz de verdade (sol, chamas do turbo, lâmpadas)
//  * cor: saturação e contraste leves, vinheta bem discreta
//  * FXAA no final (a cena é desenhada numa textura, então o antialias do navegador não vale aqui) + nitidez leve
//    (devolve o detalhe das texturas que o FXAA amacia) + pontilhado fino contra faixas no céu e na névoa
//  * luz do sol na névoa (dispersão): olhando para o sol, a distância fica dourada/clara; mesma conta do céu (main.js),
//    então o horizonte casa com o céu sem emenda
//  * raios de sol (god rays): o céu claro perto do sol é "arrastado" na direção dele; árvores e montanhas cortam os raios
// Uso: const fx = PostFX.create(renderer); fx.render(scene, camera)  (fx.ok = false -> desenha direto, sem efeitos)
// =====================================================================================
(function () {
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  // passa-alta: só o que está quase estourando (>= ~0,9 de luminância) vira brilho
  // (o céu fica de fora: lá a profundidade é 1 e ele é claro demais, viraria um clarão branco)
  const BRIGHT = `uniform sampler2D tSrc; uniform sampler2D tDep; uniform float uTh; uniform float uHasDep; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114));
      float k = smoothstep(uTh, uTh + 0.1, l);
      if (uHasDep > 0.5 && texture2D(tDep, vUv).x >= 0.99999) k = 0.0;
      gl_FragColor = vec4(c * k, 1.0); }`;

  // desfoque gaussiano separável (9 amostras)
  const BLUR = `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
    void main(){ vec3 s = texture2D(tSrc, vUv).rgb * 0.2270270;
      s += (texture2D(tSrc, vUv + uDir * 1.3846153).rgb + texture2D(tSrc, vUv - uDir * 1.3846153).rgb) * 0.3162162;
      s += (texture2D(tSrc, vUv + uDir * 3.2307692).rgb + texture2D(tSrc, vUv - uDir * 3.2307692).rgb) * 0.0702702;
      gl_FragColor = vec4(s, 1.0); }`;

  // raios de sol, passo 1 (1/4 da tela): só o céu (profundidade 1) claro e perto do sol vira fonte de luz
  const RMASK = `uniform sampler2D tSrc; uniform sampler2D tDep; uniform vec2 uSunUv; uniform float uAsp; varying vec2 vUv;
    void main(){ if (texture2D(tDep, vUv).x < 0.99999) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      vec3 c = texture2D(tSrc, vUv).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec2 d = vUv - uSunUv; d.x /= max(uAsp, 1e-3); float disk = 1.0 - smoothstep(0.0, 0.42, length(d));
      gl_FragColor = vec4(vec3(disk * disk * smoothstep(0.45, 1.0, l)), 1.0); }`;
  // passo 2: desfoque radial em direção ao sol (cada pixel soma o caminho até o sol, enfraquecendo)
  const RBLUR = `uniform sampler2D tSrc; uniform vec2 uSunUv; uniform float uLen; varying vec2 vUv;
    void main(){ vec2 st = (uSunUv - vUv) * uLen / 24.0; vec2 p = vUv; float w = 1.0, s = 0.0, tot = 0.0;
      float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); p += st * j;
      for (int i = 0; i < 24; i++) { s += texture2D(tSrc, clamp(p, 0.001, 0.999)).r * w; tot += w; w *= 0.93; p += st; }
      gl_FragColor = vec4(vec3(s / tot), 1.0); }`;

  // composição: sombra de contato (oclusão ambiente) + contorno leve + brilho só nas luzes fortes + cor + vinheta
  const COMP = `uniform sampler2D tCol; uniform sampler2D tDep; uniform sampler2D tB1; uniform sampler2D tB2;
    uniform vec2 uPx; uniform float uNear; uniform float uFar; uniform float uInk; uniform float uBloom; uniform float uSat; uniform float uCon; uniform float uVig; uniform float uHasDep;
    uniform float uAO; uniform float uFocal; uniform float uAsp;
    uniform mat4 uInvProj; uniform mat4 uCamW; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uFogN; uniform float uFogF; uniform float uScatter;
    uniform sampler2D tRay; uniform float uRays;
    varying vec2 vUv;
    // mesma dispersão do céu (main.js > skyFS): halo largo perto do horizonte + brilho concentrado em volta do sol
    vec3 scatter(vec3 dir){ float mu = max(dot(dir, uSun), 0.0), el = max(asin(clamp(dir.y, -1.0, 1.0)) / 1.5708, 0.0);
      return uSunCol * (pow(mu, 5.0) * 0.28 * (1.0 - smoothstep(0.0, 0.45, el)) + pow(mu, 48.0) * 0.25); }
    float wOf(vec2 p){ float d = texture2D(tDep, p).x; if (d >= 0.99999) return 0.0;            // 1/z (linear na tela para superfícies planas)
      float z = (uNear * uFar) / (uFar - d * (uFar - uNear)); return 1.0 / z; }
    // cantos côncavos (pé da árvore, encontro da zebra com o chão, embaixo do kart): a média de 1/z de dois pontos opostos
    // fica "na frente" do centro. Superfície plana dá zero, então o chão aberto não escurece.
    float aoPair(vec2 o, float w0, float z0){ float a = wOf(vUv + o), b = wOf(vUv - o); if (a <= 0.0 || b <= 0.0) return 0.0;
      float zm = 2.0 / (a + b), c = z0 - zm, far = max(abs(1.0 / a - z0), abs(1.0 / b - z0));
      return smoothstep(0.02, 0.35, c) * (1.0 - smoothstep(0.8, 2.2, far)); }
    void main(){
      vec3 c = texture2D(tCol, vUv).rgb;
      if (uHasDep > 0.5) {
        float w0 = wOf(vUv);
        if (w0 > 0.0) {
          float z0 = 1.0 / w0;
          if (uAO > 0.0 && z0 < 140.0) {
            float occ = 0.0, jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));   // ruído fixo por pixel (espalha as amostras)
            for (int s = 0; s < 2; s++) { float R = (s == 0 ? 0.45 : 1.1) * (0.8 + 0.4 * jit), r = R * uFocal / z0;
              for (int k = 0; k < 6; k++) { float an = (float(k) + jit) * 0.523599 + float(s) * 0.261799; vec2 o = vec2(cos(an) * uAsp, sin(an)) * r;
                occ += aoPair(o, w0, z0); } }
            occ /= 6.0;
            c *= 1.0 - uAO * clamp(occ, 0.0, 1.0) * (1.0 - smoothstep(70.0, 140.0, z0));
          }
          if (uScatter > 0.0) {                                                     // luz do sol na névoa (só onde a névoa já existe)
            vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vec3 vd = normalize(vp.xyz / vp.w);
            float dist = z0 / max(-vd.z, 0.05), fogF = smoothstep(uFogN, uFogF, dist);
            c += scatter(normalize(mat3(uCamW) * vd)) * fogF * uScatter;
          }
          if (uInk > 0.0) {
            float wl = wOf(vUv - vec2(uPx.x, 0.0)), wr = wOf(vUv + vec2(uPx.x, 0.0)), wd = wOf(vUv - vec2(0.0, uPx.y)), wu = wOf(vUv + vec2(0.0, uPx.y));
            float lap = (abs(wl + wr - 2.0 * w0) + abs(wu + wd - 2.0 * w0)) / w0;
            float e = smoothstep(0.1, 0.35, lap) * (1.0 - smoothstep(60.0, 200.0, z0)) * step(0.7, z0);
            c = mix(c, c * 0.45, e * uInk);
          }
        }
      }
      c += (texture2D(tB1, vUv).rgb * 0.7 + texture2D(tB2, vUv).rgb * 0.3) * uBloom;
      if (uRays > 0.0) c += texture2D(tRay, vUv).r * uSunCol * uRays;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, uSat);                                                   // saturação
      c = clamp(c, 0.0, 1.0); c = mix(c, c * c * (3.0 - 2.0 * c), uCon);            // contraste suave
      c += vec3(0.012, 0.005, -0.01) * smoothstep(0.5, 1.0, l) + vec3(-0.006, 0.0, 0.012) * (1.0 - smoothstep(0.0, 0.4, l));   // luz levemente quente, sombra levemente fria
      vec2 q = vUv - 0.5; float v = smoothstep(0.9, 0.35, length(q * vec2(1.15, 1.0)));
      c *= mix(1.0 - uVig, 1.0, v);
      gl_FragColor = vec4(c, 1.0);
    }`;

  // FXAA (versão clássica do exemplo do three.js)
  const FXAA = `uniform sampler2D tSrc; uniform vec2 uPx; uniform float uSharp; varying vec2 vUv;
    float dith(){ return (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0; }
    void main(){
      vec3 L = vec3(0.299, 0.587, 0.114);
      vec3 nw = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uPx).rgb, ne = texture2D(tSrc, vUv + vec2(1.0, -1.0) * uPx).rgb;
      vec3 sw = texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uPx).rgb, se = texture2D(tSrc, vUv + vec2(1.0, 1.0) * uPx).rgb, m = texture2D(tSrc, vUv).rgb;
      float lNW = dot(nw, L), lNE = dot(ne, L), lSW = dot(sw, L), lSE = dot(se, L), lM = dot(m, L);
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      if (lMax - lMin < max(0.06, lMax * 0.166)) {                                  // sem serrilhado aqui: nitidez leve (detalhe das texturas)
        vec3 sh = clamp(m + (m - (nw + ne + sw + se) * 0.25) * uSharp, 0.0, 1.0);
        gl_FragColor = vec4(sh + dith(), 1.0); return; }
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
      float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125), rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
      dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uPx;
      vec3 a = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
      float lB = dot(b, L);
      gl_FragColor = vec4(((lB < lMin || lB > lMax) ? a : b) + dith(), 1.0);
    }`;

  function create(renderer, opts) {
    const O = { ink: 0.25, bloom: 0.12, threshold: 0.97, sat: 1.04, con: 0.1, vig: 0.08, ao: 0.45, scatter: 1, rays: 0.25, sharpen: 0.3 }; Object.keys(opts || {}).forEach(k => { if (opts[k] != null) O[k] = opts[k]; });
    // fx.sky: definido pelo main.js a cada quadro (direção e cor do sol, início/fim da névoa)
    const fx = { ok: true, opts: O, sky: { dir: new THREE.Vector3(0.4, 0.7, 0.3).normalize(), col: new THREE.Color(0, 0, 0), fogN: 500, fogF: 1500 } };
    try {
      const gl2 = renderer.capabilities.isWebGL2, hasDep = gl2 || !!renderer.extensions.get('WEBGL_depth_texture');
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), scn = new THREE.Scene(), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; scn.add(quad);
      const mat = (fs, u) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false });
      const mBright = mat(BRIGHT, { tSrc: { value: null }, tDep: { value: null }, uTh: { value: O.threshold }, uHasDep: { value: hasDep ? 1 : 0 } });
      const mBlur = mat(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
      const mComp = mat(COMP, { tCol: { value: null }, tDep: { value: null }, tB1: { value: null }, tB2: { value: null }, uPx: { value: new THREE.Vector2() }, uNear: { value: 0.5 }, uFar: { value: 2300 },
        uInk: { value: O.ink }, uBloom: { value: O.bloom }, uSat: { value: O.sat }, uCon: { value: O.con }, uVig: { value: O.vig }, uHasDep: { value: hasDep ? 1 : 0 }, uAO: { value: O.ao }, uFocal: { value: 1 }, uAsp: { value: 1 },
        uInvProj: { value: new THREE.Matrix4() }, uCamW: { value: new THREE.Matrix4() }, uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
        uFogN: { value: 500 }, uFogF: { value: 1500 }, uScatter: { value: O.scatter }, tRay: { value: null }, uRays: { value: 0 } });
      const mFxaa = mat(FXAA, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() }, uSharp: { value: O.sharpen } });
      const mRMask = mat(RMASK, { tSrc: { value: null }, tDep: { value: null }, uSunUv: { value: new THREE.Vector2() }, uAsp: { value: 1 } });
      const mRBlur = mat(RBLUR, { tSrc: { value: null }, uSunUv: { value: new THREE.Vector2() }, uLen: { value: 1 } });
      const _sp = new THREE.Vector3();
      const P = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, stencilBuffer: false };
      let w = 0, h = 0, rtS, rtC, b1a, b1b, b2a, b2b, rRa, rRb;
      const size = new THREE.Vector2();
      const free = () => [rtS, rtC, b1a, b1b, b2a, b2b, rRa, rRb].forEach(t => t && t.dispose());
      const ensure = () => {
        renderer.getDrawingBufferSize(size); const W = Math.max(2, size.x | 0), H = Math.max(2, size.y | 0);
        if (W === w && H === h) return; w = W; h = H; free();
        rtS = new THREE.WebGLRenderTarget(w, h, Object.assign({ depthBuffer: true }, P));
        if (hasDep) { const d = new THREE.DepthTexture(w, h); d.type = gl2 ? THREE.UnsignedIntType : THREE.UnsignedShortType; d.minFilter = d.magFilter = THREE.NearestFilter; rtS.depthTexture = d; }
        rtC = new THREE.WebGLRenderTarget(w, h, Object.assign({ depthBuffer: false }, P));
        const q = (k) => new THREE.WebGLRenderTarget(Math.max(1, w >> k), Math.max(1, h >> k), Object.assign({ depthBuffer: false }, P));
        b1a = q(2); b1b = q(2); b2a = q(3); b2b = q(3); rRa = q(2); rRb = q(2);
      };
      const pass = (m, target) => { quad.material = m; renderer.setRenderTarget(target); renderer.render(scn, cam); };
      const blur = (src, tmp, k) => { const W = Math.max(1, w >> k), H = Math.max(1, h >> k);
        mBlur.uniforms.tSrc.value = src.texture; mBlur.uniforms.uDir.value.set(1 / W, 0); pass(mBlur, tmp);
        mBlur.uniforms.tSrc.value = tmp.texture; mBlur.uniforms.uDir.value.set(0, 1 / H); pass(mBlur, src); };
      fx.render = (scene, camera) => {
        if (!fx.ok) { renderer.render(scene, camera); return; }
        try {
          ensure();
          const prev = renderer.getRenderTarget();
          renderer.setRenderTarget(rtS); renderer.render(scene, camera);
          // brilho: passa-alta em 1/4 da tela, desfoca; depois 1/8 da tela, desfoca de novo (halo mais largo)
          mBright.uniforms.tSrc.value = rtS.texture; mBright.uniforms.tDep.value = rtS.depthTexture || null; pass(mBright, b1a); blur(b1a, b1b, 2);
          mBlur.uniforms.tSrc.value = b1a.texture; mBlur.uniforms.uDir.value.set(0, 0); pass(mBlur, b2a); blur(b2a, b2b, 3);
          // raios de sol: só quando o sol está na frente da câmera (e some suave quando ele sai da tela)
          const SK = fx.sky; let rayK = 0;
          if (hasDep && O.rays > 0 && SK.col.r + SK.col.g + SK.col.b > 0.02) {
            _sp.copy(camera.position).addScaledVector(SK.dir, 1000).project(camera);
            if (_sp.z < 1) { rayK = O.rays * (1 - Math.min(1, Math.max(0, (Math.max(Math.abs(_sp.x), Math.abs(_sp.y)) - 1) / 0.6)));
              if (rayK > 0.001) { const su = mRMask.uniforms.uSunUv.value.set(_sp.x * 0.5 + 0.5, _sp.y * 0.5 + 0.5);
                mRMask.uniforms.tSrc.value = rtS.texture; mRMask.uniforms.tDep.value = rtS.depthTexture; mRMask.uniforms.uAsp.value = h / w; pass(mRMask, rRa);
                const B = mRBlur.uniforms; B.uSunUv.value.copy(su);
                B.tSrc.value = rRa.texture; B.uLen.value = 0.55; pass(mRBlur, rRb);
                B.tSrc.value = rRb.texture; B.uLen.value = 0.18; pass(mRBlur, rRa); } } }
          const U = mComp.uniforms; U.tCol.value = rtS.texture; U.tDep.value = rtS.depthTexture || null; U.tB1.value = b1a.texture; U.tB2.value = b2a.texture;
          U.uPx.value.set(1 / w, 1 / h); U.uNear.value = camera.near; U.uFar.value = camera.far;
          U.uFocal.value = 0.5 / Math.tan(camera.fov * Math.PI / 360); U.uAsp.value = h / w; U.uAO.value = O.ao; U.uInk.value = O.ink; U.uBloom.value = O.bloom; U.uSat.value = O.sat; U.uCon.value = O.con; U.uVig.value = O.vig; mBright.uniforms.uTh.value = O.threshold;
          U.uInvProj.value.copy(camera.projectionMatrixInverse); U.uCamW.value.copy(camera.matrixWorld); U.uSun.value.copy(SK.dir); U.uSunCol.value.copy(SK.col);
          U.uFogN.value = SK.fogN; U.uFogF.value = SK.fogF; U.uScatter.value = O.scatter; U.tRay.value = rRa.texture; U.uRays.value = rayK; mFxaa.uniforms.uSharp.value = O.sharpen;
          pass(mComp, rtC);
          mFxaa.uniforms.tSrc.value = rtC.texture; mFxaa.uniforms.uPx.value.set(1 / w, 1 / h); pass(mFxaa, prev);
        } catch (e) { console.warn('[postfx] desligado:', e); fx.ok = false; renderer.setRenderTarget(null); renderer.render(scene, camera); }
      };
      fx.dispose = free;
    } catch (e) { console.warn('[postfx] indisponível:', e); fx.ok = false; fx.render = (s, c) => renderer.render(s, c); }
    return fx;
  }
  window.PostFX = { create };
})();
