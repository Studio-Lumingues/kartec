// =====================================================================================
// sky.js — céu do jogo (shader com dispersão do sol), estrelas, sol, lua e nuvens volumétricas
// Extraído do main.js para que o lobby/garagem (showroom.js) use EXATAMENTE os mesmos shaders e a mesma
// paleta do ciclo dia/noite da corrida.
//   SkyKit.DN / SkyKit.dnMix(arr, elevaçãoDoSol, out)   paleta [noite, crepúsculo, dia]
//   SkyKit.build(scene, SK)   cria tudo na cena (SK = escala do domo) e devolve os objetos (sky, skyU, stars, moon,
//                             sunGlow, sunCore, moonGlow, mountains, cloudM, cloudOff, cloudT, cloudU, cloudLayer)
// =====================================================================================
(function () {
  const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const dnC = h => new THREE.Color(h);
  const DN = { // [noite, crepúsculo, dia]
    top: [dnC(0x1c1654), dnC(0x5a3aa8), dnC(0x3a8dff)], mid: [dnC(0x2c2670), dnC(0xff7eb6), dnC(0x7fd8ff)], hor: [dnC(0x45408a), dnC(0xffb36b), dnC(0xcdf3ff)],
    sun: [dnC(0xa8b4ff), dnC(0xff9a52), dnC(0xfff0c8)], hS: [dnC(0x5a5aa8), dnC(0xffc0a0), dnC(0xd8f0ff)], hG: [dnC(0x2a3048), dnC(0x8a6a4a), dnC(0x7ab85a)],
    tint: [dnC(0x5a5a9a), dnC(0xffc4b4), dnC(0xffffff)], cloud: [dnC(0x6a68b0), dnC(0xffc0c8), dnC(0xffffff)]
  };
  function dnMix(arr, e, out) { if (e <= -0.2) return out.copy(arr[0]); if (e < 0.05) return out.copy(arr[0]).lerp(arr[1], sm((e + 0.2) / 0.25)); return out.copy(arr[1]).lerp(arr[2], sm((e - 0.05) / 0.3)); }
  function dnMix(arr, e, out) { if (e <= -0.2) return out.copy(arr[0]); if (e < 0.05) return out.copy(arr[0]).lerp(arr[1], sm((e + 0.2) / 0.25)); return out.copy(arr[1]).lerp(arr[2], sm((e - 0.05) / 0.3)); }
  function build(scene, SK) {
    const R = {};
      R.skyU = { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
        uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(0, 0, 0) } };
      R.sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), new THREE.ShaderMaterial({ uniforms: R.skyU, side: THREE.BackSide, fog: false, depthWrite: false,
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunCol; varying vec3 vDir;
          void main(){
            vec3 d = normalize(vDir); float el = asin(clamp(d.y, -1.0, 1.0)) / 1.5708, e = max(el, 0.0);
            vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.12, e));
            col = mix(col, mix(uMid, uTop, 0.5), smoothstep(0.12, 0.4, e));
            col = mix(col, uTop, smoothstep(0.4, 1.0, e));
            float mu = max(dot(d, uSun), 0.0);
            col += uSunCol * (pow(mu, 5.0) * 0.28 * (1.0 - smoothstep(0.0, 0.45, e)) + pow(mu, 48.0) * 0.25);
            col += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;   // sem faixas no degradê
            gl_FragColor = vec4(col, 1.0);
          }` }));
      R.sky.renderOrder = -2; R.sky.scale.setScalar(SK); scene.add(R.sky);
      // estrelas, lua, sol
      const pos = []; for (let i = 0; i < 1100; i++) { const u = Math.random() * 6.2832, y = 0.04 + Math.random() * 0.96, r = Math.sqrt(1 - y * y); pos.push(Math.cos(u) * r * 1250, y * 1250, Math.sin(u) * r * 1250); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      R.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })); R.stars.frustumCulled = false; R.stars.renderOrder = -1; R.stars.scale.setScalar(SK); scene.add(R.stars);
      R.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(TX.canvas('moon')), transparent: true, fog: false, depthWrite: false })); R.moon.scale.setScalar(70 * SK); scene.add(R.moon);
      const glow = (c, s, o) => { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: o })); p.scale.setScalar(s); scene.add(p); return p; };
      R.sunGlow = glow(0xffe6a0, 380 * SK, 0.8); R.sunCore = glow(0xffffff, 110 * SK, 1); R.moonGlow = glow(0x9db4ff, 260 * SK, 0.35);
      // cordilheira distante (anel com silhueta pintada em canvas)
      const mc = TX.cvs(1024, 128), mg = mc.getContext('2d');
      const tone = ['#8fb4d8', '#5a86b4'];
      [[0, 0.55, tone[0], 9], [1, 0.75, tone[1], 13]].forEach(([k, base, col, n]) => { mg.fillStyle = col; mg.beginPath(); mg.moveTo(0, 128);
        for (let x = 0; x <= 1024; x += 8) { const t = x / 1024 * Math.PI * 2; const y = 128 * base - 34 * Math.abs(Math.sin(t * n / 2 + k)) - 14 * Math.sin(t * n * 1.7 + k * 3); mg.lineTo(x, y); } mg.lineTo(1024, 128); mg.closePath(); mg.fill(); });
      const mt = new THREE.CanvasTexture(mc); mt.wrapS = THREE.RepeatWrapping; mt.repeat.x = 2;
      R.mountains = new THREE.Mesh(new THREE.CylinderGeometry(1150, 1150, 160, 48, 1, true), new THREE.MeshBasicMaterial({ map: mt, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }));
      R.mountains.renderOrder = -1; R.mountains.visible = false;   // cordilheira pintada (silhuetas azuis chapadas) desligada: as montanhas 3D da pista já fazem o fundo scene.add(R.mountains);
      // nuvens
      // nuvens volumétricas: cúmulos numa camada de ~240 m de espessura a partir de ~300 m acima da câmera. Cada pixel do céu
      // atravessa a camada em 6 passos (raymarch), soma a densidade e calcula quanta luz do sol chega (sombra própria):
      // topo branco, base cinza, borda prateada contra o sol. O vento leva a camada e o desenho das nuvens se transforma devagar.
      R.cloudM = { color: new THREE.Color(1, 1, 1) }; R.cloudOff = new THREE.Vector2(Math.random() * 5000, Math.random() * 5000); R.cloudT = Math.random() * 100;
      R.cloudU = { uCam: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uLit: { value: new THREE.Color() },
        uShade: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uOff: { value: R.cloudOff }, uT: { value: 0 }, uCover: { value: 0.53 }, uThick: { value: 240 }, uR: { value: 2200 } };
      const cg = new THREE.PlaneGeometry(5200, 5200, 1, 1); cg.rotateX(Math.PI / 2);
      R.cloudLayer = new THREE.Mesh(cg, new THREE.ShaderMaterial({ uniforms: R.cloudU, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
        vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `uniform vec3 uCam; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uFog; uniform vec2 uOff; uniform float uT; uniform float uCover; uniform float uThick; uniform float uR; varying vec3 vW;
          float hs(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
          float vn(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
            return mix(mix(hs(i), hs(i + vec2(1.0, 0.0)), u.x), mix(hs(i + vec2(0.0, 1.0)), hs(i + vec2(1.0, 1.0)), u.x), u.y); }
          const mat2 RM = mat2(1.6, 1.2, -1.2, 1.6);
          // cada oitava anda num ritmo diferente: as bordas "fervem" e o formato muda com o tempo
          float fbm(vec2 p, int n){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { if (i >= n) break; s += a * vn(p + uT * vec2(0.021, -0.013) * float(i + 1)); p = RM * p; a *= 0.5; } return s; }
          float big(vec2 xz){ return fbm((xz + uOff) * 0.0007 + 7.3, 3); }
          float dens(vec2 xz, float h, float B){ float d = B * 0.58 + fbm((xz + uOff) * 0.0028, 5) * 0.42;
            float th = uCover + 0.16 * h * h + 0.05 * (1.0 - smoothstep(0.0, 0.12, h));       // base reta, topo arredondado
            return clamp((d - th) * 9.0, 0.0, 1.0); }
          void main(){
            vec3 v = normalize(vW - uCam); float dist = length(vW.xz - uCam.xz);
            if (v.y < 0.03 || dist > uR) discard;
            float B0 = big(vW.xz); if (B0 * 0.6 + 0.4 < uCover - 0.02) discard;                 // céu limpo aqui: nem marcha
            float y0 = vW.y, t0 = (y0 - uCam.y) / v.y, L = min(uThick / v.y, 650.0), st = L / 7.0;
            float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            float T = 1.0; vec3 acc = vec3(0.0);
            for (int i = 0; i < 7; i++) {
              vec3 p = uCam + v * (t0 + (float(i) + jit) * st); float h = clamp((p.y - y0) / uThick, 0.0, 1.0);
              float B = big(p.xz), dn = dens(p.xz, h, B);
              if (dn > 0.002) {
                vec3 lp = p + uSun * 70.0; float hl = clamp((lp.y - y0) / uThick, 0.0, 1.0);
                float dl = clamp((big(lp.xz) * 0.6 + 0.25 - uCover - 0.16 * hl * hl) * 5.0, 0.0, 1.0);   // quanto de nuvem há na direção do sol
                float sunT = exp(-dl * 1.6), amb = mix(0.8, 1.0, h);
                vec3 c = mix(uShade, uLit, clamp(sunT * 0.7 + h * 0.45, 0.0, 1.0)) * amb + uSunCol * sunT * 0.1;
                float a = 1.0 - exp(-dn * st * 0.045);
                acc += T * a * c; T *= 1.0 - a; if (T < 0.03) break;
              }
            }
            float al = 1.0 - T; if (al < 0.004) discard;
            vec3 col = acc / al;
            col += uSunCol * pow(max(dot(v, uSun), 0.0), 6.0) * 0.45 * (1.0 - al * 0.5);     // borda prateada contra o sol
            col = mix(col, uFog, smoothstep(uR * 0.25, uR * 0.95, dist) * 0.85);
            gl_FragColor = vec4(col, al * (1.0 - smoothstep(uR * 0.6, uR, dist)));
          }` }));
      R.cloudLayer.renderOrder = -1.5; R.cloudLayer.frustumCulled = false; scene.add(R.cloudLayer);
    return R;
  }
  window.SkyKit = { DN, dnMix, build };
})();
