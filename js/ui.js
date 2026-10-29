// =====================================================================================
// ui.js — interface: gerenciador de telas (com cortina de transição), abertura e logo, menu,
// modais (preparar corrida / como jogar), HUD (volta, posição, tempo, velocímetro, minimapa,
// relógio), contagem regressiva com a fadinha Fatecxie segurando o semáforo, mensagens rápidas e
// áudio sintetizado (Web Audio API, sem arquivos). A Garagem fica em garage.js.
// =====================================================================================
(function () {
  const $ = id => document.getElementById(id);
  const fmt = t => { const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t % 1) * 100); return String(m).padStart(2, '0') + '’' + String(s).padStart(2, '0') + '”' + String(c).padStart(2, '0'); };

  // ================================ ÁUDIO ================================
  // som: gravações reais (audio.js)
  const Sfx = window.Sfx;

  // ================================ FATECXIE ================================
  // A fadinha que traz o semáforo na largada, presa à câmera como o "juiz" voador dos jogos de kart.
  // Modelo 3D: js/models/entidades/fatecxie.glb (fadinha + semáforo na mão, numa malha só, compactada com meshopt).
  // * Carrega em segundo plano logo depois que a página abre (o arquivo é grande).
  // * Ao carregar, as asas são separadas do corpo (pela forma e pela cor da textura) em duas malhas que giram num
  //   pivô no centro do corpo. Nada é copiado: corpo e asas usam os MESMOS atributos, só o índice muda.
  // * Asas: batida em altíssima frequência + "rastros" transparentes que cobrem o arco percorrido no quadro
  //   (como o obturador de uma câmera) = desfoque de movimento.
  // * Entrada com easing elástico e saída com antecipação (back-in). A cada luz, o sinaleiro leva um empurrão
  //   e balança como pêndulo com mola; a fada não pula. Sem partículas.
  // * As 3 luzes do semáforo do modelo são apagadas/acesas por shader (máscara esférica em volta de cada lâmpada).
  const Ease = {
    outElastic(k, p) { p = p || 0.42; if (k <= 0) return 0; if (k >= 1) return 1; return Math.pow(2, -10 * k) * Math.sin((k - p / 4) * (2 * Math.PI) / p) + 1; },
    inBack(k, s) { s = s == null ? 1.9 : s; return k * k * ((s + 1) * k - s); }
  };
  // valores-padrão (o config.js pode trocar qualquer um em CFG.FAIRY)
  const FAIRY_DEF = {
    MODEL: 'js/models/entidades/fatecxie.glb', SCALE: 3.4, POS: [1.2, 2.4, -7], ROT_Y: -Math.PI / 2 + 0.15, GLOW: 0.45,
    LAMPS: [[0.134, -0.166, 0.3339], [0.135, -0.2801, 0.339], [0.134, -0.4082, 0.3374]], LAMP_R: 0.041,
    BODY: { CENTER: [-0.047, 0.178, -0.012], RADIUS: 0.1385 },
    WINGS: { HZ: 12, YAW: 0.55, ROLL: 0.32, OPACITY: 0.9, BLUR: 3, SHUTTER: 0.85 },
    EYES: [[-0.008, 0.1865, -0.09], [-0.0715, 0.178, -0.16]], EYE_SIZE: [0.024, 0.046], BLINK: [2.0, 4.5],
    RIM: 1.1, HALO: 3.0, AURA: 6.0,
    SIGNAL: { PIVOT: [0.064, 0.1, 0.305], CUT_Y: 0.095, MIN_Z: 0.2, MIN_X: -0.06 },
    SWING: { FREQ: 1.1, DAMP: 0.13, INERTIA: 0.35, KICK: 1.6, STRETCH: 0, MAX: 0.85 }
  };
  let _fc = null;
  const fc = () => _fc || (_fc = (() => { const u = CFG.FAIRY || {};
    return Object.assign({}, FAIRY_DEF, u, { BODY: Object.assign({}, FAIRY_DEF.BODY, u.BODY), WINGS: Object.assign({}, FAIRY_DEF.WINGS, u.WINGS),
      SIGNAL: Object.assign({}, FAIRY_DEF.SIGNAL, u.SIGNAL), SWING: Object.assign({}, FAIRY_DEF.SWING, u.SWING) }); })());
  const lowEnd = () => /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4;

  const Fairy = {
    DIM: [0x4a1212, 0x4a3c10, 0x12401a], ON: [0xff2a2a, 0xffd21a, 0x3dff5a],
    // baixa e prepara o modelo uma vez só (a promessa é reaproveitada). Status em Fairy.status.
    // * Página aberta direto do disco (file://): o navegador bloqueia ler o .glb, então o modelo vem da cópia
    //   embutida em script (js/models/entidades/fatecxie.glb.js), que funciona sem servidor.
    // * Em servidor (npm start, Vercel, Render): lê o .glb (mais leve); se falhar, usa a cópia embutida.
    // * Carrega sozinho o decodificador meshopt se o index.html não tiver a tag.
    preload() {
      if (this._p) return this._p;
      this.status = 'carregando'; this.reason = '';
      const fail = (why, e) => { this.status = 'erro'; this.reason = why; console.error('[Fatecxie] ' + why, e || ''); return null; };
      if (!window.THREE || !THREE.GLTFLoader) return (this._p = Promise.resolve(fail('THREE.GLTFLoader não encontrado (js/vendor/GLTFLoader.js)')));
      const mkLoader = () => { const l = new THREE.GLTFLoader(); if (window.MeshoptDecoder && l.setMeshoptDecoder) l.setMeshoptDecoder(window.MeshoptDecoder); return l; };
      const tryUrls = (urls, i) => new Promise((res, rej) => {
        if (i >= urls.length) return rej(new Error('nenhum caminho respondeu'));
        mkLoader().load(urls[i], g => { this.url = urls[i]; res(g); }, undefined,
          e => { console.warn('[Fatecxie] não abriu ' + urls[i]); tryUrls(urls, i + 1).then(res, rej); });
      });
      const fromEmbedded = () => this.embedded().then(buf => new Promise((res, rej) => {
        if (!buf) return rej(new Error('cópia embutida js/models/entidades/fatecxie.glb.js não encontrada'));
        mkLoader().parse(buf, '', g => { this.url = 'fatecxie.glb.js (embutido)'; res(g); }, rej);
      }));
      const local = location.protocol === 'file:';
      this._p = this.ensureDecoder()
        .then(() => local ? fromEmbedded() : tryUrls(this.candidates(), 0).catch(() => fromEmbedded()))
        .then(g => { try { this.tpl = this.prepare(g.scene); } catch (e) { return fail('falha ao preparar o modelo', e); }
          this.status = 'ok'; console.info('[Fatecxie] modelo carregado de ' + this.url + (this.tpl.wings.length ? ' (asas separadas)' : ' (sem asas separadas)')); return this.tpl; })
        .catch(e => fail('não foi possível carregar o modelo: ' + (e && e.message ? e.message : e), e));
      return this._p;
    },
    // cópia do .glb dentro de um script (window.FATECXIE_GLB_B64, em base64): <script> funciona até em file://
    embedded() {
      const decode = () => { const b64 = window.FATECXIE_GLB_B64; if (!b64) return null;
        const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        window.FATECXIE_GLB_B64 = null; return u8.buffer; };                 // libera a string (é grande)
      if (window.FATECXIE_GLB_B64) return Promise.resolve(decode());
      const add = src => new Promise(res => { const sc = document.createElement('script'); sc.src = src; sc.onload = sc.onerror = () => res(!!window.FATECXIE_GLB_B64); document.head.appendChild(sc); });
      return add('js/models/entidades/fatecxie.glb.js').then(ok => ok || add('js/models/entidades/fatecxie/fatecxie.glb.js')).then(() => decode());
    },
    candidates() {
      const m = fc().MODEL, list = [m];
      if (!/\.glb$/i.test(m)) list.push(m + '.glb');
      ['js/models/entidades/fatecxie.glb', 'js/models/entidades/fatecxie', 'js/models/entidades/fatecxie/fatecxie.glb', 'js/models/entidades/fatecxie/scene.glb', 'js/models/entidades/fatecxie.gltf']
        .forEach(u => { if (list.indexOf(u) < 0) list.push(u); });
      return list;
    },
    // o .glb é compactado com meshopt: sem o decodificador o GLTFLoader recusa o arquivo
    ensureDecoder() {
      if (window.MeshoptDecoder) return Promise.resolve();
      const add = src => new Promise(res => { const sc = document.createElement('script'); sc.src = src; sc.onload = sc.onerror = () => res(!!window.MeshoptDecoder); document.head.appendChild(sc); });
      return add('js/vendor/meshopt_decoder.js')
        .then(ok => ok || add('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/meshopt_decoder.js'))
        .then(ok => { if (!ok) console.error('[Fatecxie] decodificador meshopt não carregou (js/vendor/meshopt_decoder.js)'); });
    },
    // separa asas do corpo, ajusta materiais e monta o grupo do modelo (coordenadas do .glb, em metros)
    prepare(root) {
      const C = fc(); let src = null; root.updateMatrixWorld(true);
      root.traverse(o => { if (o.isMesh && !src) src = o; });
      if (!src) throw new Error('nenhuma malha no .glb');
      const geo = src.geometry; if (!src.matrixWorld.equals(new THREE.Matrix4())) geo.applyMatrix4(src.matrixWorld);
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const pos = geo.attributes.position, uv = geo.attributes.uv, n = pos.count;
      const body = Array.isArray(src.material) ? src.material[0] : src.material;
      // cor da textura reduzida a 256 px: asa = amarelo-clarinho; corpo e mãos = amarelo forte; haste e olhos = escuros
      let pix = null; const PW = 256;
      try { const img = body.map && body.map.image; if (img && uv) { const cv = document.createElement('canvas'); cv.width = cv.height = PW; const g = cv.getContext('2d'); g.drawImage(img, 0, 0, PW, PW); pix = g.getImageData(0, 0, PW, PW).data; } } catch (e) { pix = null; }
      const B = C.BODY, cx = B.CENTER[0], cy = B.CENTER[1], cz = B.CENTER[2], R2 = B.RADIUS * B.RADIUS;
      // vértice de asa: fora da esfera do corpo, longe do meio, atrás do rosto, acima da haste e longe das mãos
      // vértice do sinaleiro (caixa + cabo, abaixo do ponto de giro): vai para uma malha própria que balança
      const SG = C.SIGNAL, side = new Int8Array(n), sem = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), dx = x - cx, dy = y - cy, dz = z - cz;
        if (z > SG.MIN_Z && y < SG.CUT_Y && x > SG.MIN_X) { sem[i] = 1; continue; }
        if (dx * dx + dy * dy + dz * dz < R2 || Math.abs(dz) < 0.05 || x > 0.04 || y < -0.02 || (y < 0.13 && x > -0.06)) continue;
        if (pix) { let u = uv.getX(i), v = uv.getY(i); u -= Math.floor(u); v -= Math.floor(v);
          const p = (Math.min(PW - 1, v * PW | 0) * PW + Math.min(PW - 1, u * PW | 0)) * 4;
          if (!(pix[p] > 178 && pix[p + 1] > 165 && pix[p + 2] > 107)) continue; }
        side[i] = dz < 0 ? -1 : 1;
      }
      const model = new THREE.Group();
      const share = ia => { const g = new THREE.BufferGeometry(); for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k]);
        g.setIndex(new THREE.BufferAttribute(ia, 1)); g.boundingSphere = geo.boundingSphere.clone(); return g; };
      // separa os triângulos em 4 grupos (0 corpo, 1 asa esq., 2 asa dir., 3 sinaleiro) só trocando o índice
      let bodyGeo = geo, idxL = null, idxR = null, idxS = null;
      if (geo.index) {
        const I = geo.index.array, T = I.length / 3, tag = new Uint8Array(T), cnt = [0, 0, 0, 0];
        for (let t = 0; t < T; t++) { const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2], s = side[a] + side[b] + side[c];
          const k = sem[a] + sem[b] + sem[c] >= 2 ? 3 : s <= -2 ? 1 : s >= 2 ? 2 : 0; tag[t] = k; cnt[k]++; }
        const okW = cnt[1] > 500 && cnt[2] > 500, okS = cnt[3] > 500;
        if (!okW) { cnt[0] += cnt[1] + cnt[2]; cnt[1] = cnt[2] = 0; console.warn('[Fatecxie] asas não encontradas (sem batida de asas)'); }
        if (!okS) { cnt[0] += cnt[3]; cnt[3] = 0; console.warn('[Fatecxie] sinaleiro não encontrado (sem balanço)'); }
        if (okW || okS) {
          const out = cnt.map(c => new Uint32Array(c * 3)), at = [0, 0, 0, 0];
          for (let t = 0; t < T; t++) { let k = tag[t]; if (!okW && (k === 1 || k === 2)) k = 0; if (!okS && k === 3) k = 0;
            const d = out[k], j = at[k]; at[k] += 3; d[j] = I[3 * t]; d[j + 1] = I[3 * t + 1]; d[j + 2] = I[3 * t + 2]; }
          bodyGeo = share(out[0]); if (okW) { idxL = out[1]; idxR = out[2]; } if (okS) idxS = out[3];
        }
      }
      // materiais: brilho próprio (a fada aparece até na pista do fim da tarde); asas translúcidas
      body.fog = false;
      if (body.emissive) { body.emissive.setHex(0xffffff); body.emissiveMap = body.map || null; body.emissiveIntensity = C.GLOW; }
      const wingM = body.clone(); wingM.transparent = true; wingM.opacity = C.WINGS.OPACITY; wingM.depthWrite = false; wingM.side = THREE.DoubleSide;
      if (wingM.emissive) wingM.emissiveIntensity = C.GLOW * 2.2;   // asas mais luminosas (parte do glow)
      // cor da pele (topo do corpo, na textura) para a pálpebra da piscada; sRGB -> linear
      let skin = new THREE.Vector3(1, 0.86, 0.12);
      if (pix) { let r = 0, g = 0, b = 0, m = 0;
        for (let i = 0; i < n && m < 4000; i += 7) { const y = pos.getY(i), x = pos.getX(i); if (y < cy + 0.1 || x < cx) continue;
          let u = uv.getX(i), v = uv.getY(i); u -= Math.floor(u); v -= Math.floor(v); const p = (Math.min(PW - 1, v * PW | 0) * PW + Math.min(PW - 1, u * PW | 0)) * 4;
          if (pix[p + 2] > 110) continue; r += pix[p]; g += pix[p + 1]; b += pix[p + 2]; m++; }
        if (m > 50) skin.set(Math.pow(r / m / 255, 2.2), Math.pow(g / m / 255, 2.2), Math.pow(b / m / 255, 2.2)); }
      // shader do corpo: luzes do semáforo (uOn: 1 = acesa), piscada (uBlink 0..1) e brilho de borda (fresnel) na fada
      const U = { uOn: { value: [0, 0, 0] }, uLampR: { value: C.LAMP_R },
        uLampC: { value: C.LAMPS.map(a => new THREE.Vector3().fromArray(a)) },
        uLampCol: { value: this.ON.map(h => { const c = new THREE.Color(h).convertSRGBToLinear(); return new THREE.Vector3(c.r, c.g, c.b); }) },   // linear: cor pura, sem ficar rosada
        uBlink: { value: 0 }, uSkin: { value: skin }, uEyeC: { value: C.EYES.map(a => new THREE.Vector3().fromArray(a)) }, uEyeS: { value: new THREE.Vector2().fromArray(C.EYE_SIZE) },
        uRim: { value: C.RIM }, uRimCol: { value: new THREE.Vector3(1.0, 0.82, 0.25) }, uBodyC: { value: new THREE.Vector3(cx, cy, cz) }, uBodyR: { value: B.RADIUS } };
      body.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = 'varying vec3 vFxP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvFxP = position;');
        sh.fragmentShader = ['varying vec3 vFxP;', 'uniform float uOn[3];', 'uniform float uLampR;', 'uniform vec3 uLampC[3];', 'uniform vec3 uLampCol[3];',
          'uniform float uBlink;', 'uniform vec3 uSkin;', 'uniform vec3 uEyeC[2];', 'uniform vec2 uEyeS;', 'uniform float uRim;', 'uniform vec3 uRimCol;', 'uniform vec3 uBodyC;', 'uniform float uBodyR;', ''].join('\n') +
          sh.fragmentShader.replace('#include <emissivemap_fragment>', [
            '#include <emissivemap_fragment>',
            // piscada: a pálpebra (cor da pele) desce de cima; na borda dela, uma linha escura = olho fechado
            'if (uBlink > 0.01 && vFxP.x > 0.03) {',
            '\tfor (int e = 0; e < 2; e++) {',
            '\t\tvec2 q = vec2(vFxP.z - uEyeC[e].x - uEyeC[e].z * (vFxP.y - uEyeC[e].y), vFxP.y - uEyeC[e].y) / uEyeS;',
            '\t\tif (dot(q, q) < 1.0) {',
            '\t\t\tfloat edge = mix(1.05, -0.45, uBlink);',
            '\t\t\tif (q.y > edge) { diffuseColor.rgb = uSkin; totalEmissiveRadiance = emissive * uSkin; }',
            '\t\t\tfloat ln = (1.0 - smoothstep(0.09, 0.17, abs(q.y - edge))) * smoothstep(0.0, 0.15, uBlink);',
            '\t\t\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.025, 0.02), ln); totalEmissiveRadiance *= 1.0 - ln;',
            '\t\t}',
            '\t}',
            '}',
            // brilho de borda só na fadinha (o semáforo fica de fora)
            '{ float bm = 1.0 - smoothstep(uBodyR * 1.15, uBodyR * 1.5, distance(vFxP, uBodyC));',
            '\tfloat fr = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.0);',
            '\ttotalEmissiveRadiance += uRimCol * fr * uRim * bm; }',
            'for (int i = 0; i < 3; i++) {',
            // lâmpada = só a cúpula de vidro (raio em volta do eixo da lâmpada, que aponta para +X); a viseira fica de fora
            '\tvec3 ld = vFxP - uLampC[i]; float lr = length(ld.yz);',
            '\tfloat dome = (1.0 - smoothstep(uLampR - 0.006, uLampR, lr)) * step(0.1, vFxP.x);',
            '\tfloat spill = smoothstep(uLampR, uLampR + 0.004, lr) * (1.0 - smoothstep(uLampR + 0.01, uLampR + 0.035, lr)) * step(0.105, vFxP.x) * (1.0 - smoothstep(0.155, 0.172, vFxP.x));',
            '\tif (uOn[i] > 0.5) {',
            '\t\tfloat core = clamp(1.0 - lr / uLampR, 0.0, 1.0);',
            // acesa: a cor vem da própria luz (emissiva), sem reflexo branco da iluminação por cima (fica saturada, não "lavada")
            '\t\tdiffuseColor.rgb = mix(diffuseColor.rgb, uLampCol[i] * 0.2, dome); roughnessFactor = mix(roughnessFactor, 1.0, dome); metalnessFactor = mix(metalnessFactor, 0.0, dome);',
            '\t\ttotalEmissiveRadiance = mix(totalEmissiveRadiance, uLampCol[i] * (0.95 + 0.6 * core), dome);',
            '\t\ttotalEmissiveRadiance += uLampCol[i] * 0.4 * spill;',
            // apagada: escurece a cúpula E o anel colorido pintado na parte de dentro da viseira (senão parece acesa)
            '\t} else { float off = (1.0 - smoothstep(uLampR + 0.01, uLampR + 0.018, lr)) * step(0.1, vFxP.x) * (1.0 - smoothstep(0.158, 0.17, vFxP.x));',
            '\t\tdiffuseColor.rgb *= 1.0 - 0.72 * off; totalEmissiveRadiance *= 1.0 - 0.95 * off; }',
            '}'].join('\n'));
      };
      body.customProgramCacheKey = () => 'fatecxie-body-v2';
      const bodyMesh = new THREE.Mesh(bodyGeo, body); bodyMesh.frustumCulled = false; model.add(bodyMesh);
      // asas: pivô no centro do corpo; camada 0 = asa "real", demais = rastros do desfoque
      const center = new THREE.Vector3(cx, cy, cz), G = Math.max(0, Math.round(lowEnd() ? Math.min(1, C.WINGS.BLUR) : C.WINGS.BLUR));
      const wings = !idxL ? [] : [[-1, idxL], [1, idxR]].map(([sgn, ia]) => {
        const g = share(ia), piv = new THREE.Group(); piv.position.copy(center); model.add(piv);
        const layers = [];
        for (let k = 0; k <= G; k++) {
          const m = k ? wingM.clone() : wingM; if (k) m.opacity = C.WINGS.OPACITY * 0.5 * (1 - k / (G + 1));
          const h = new THREE.Group(), mesh = new THREE.Mesh(g, m); mesh.position.copy(center).negate(); mesh.frustumCulled = false; mesh.renderOrder = 20 - k;
          h.add(mesh); piv.add(h); layers.push(h);
        }
        return { sgn, layers };
      });
      // brilho na frente de cada lâmpada (o modelo olha para +X)
      // sinaleiro: pivô no alto do cabo; "swing" recebe a rotação (pêndulo) e o estica-encolhe (mola)
      const PV = new THREE.Vector3().fromArray(SG.PIVOT), semPiv = new THREE.Group(), swing = new THREE.Group();
      semPiv.position.copy(PV); semPiv.add(swing); model.add(semPiv);
      if (idxS) { const sm = new THREE.Mesh(share(idxS), body); sm.position.copy(PV).negate(); sm.frustumCulled = false; swing.add(sm); }
      // brilho (bloom) da lâmpada acesa: pequeno, logo à frente da cúpula e sem teste de profundidade (não é cortado pela viseira)
      const glows = C.LAMPS.map((a, k) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: new THREE.Color(this.ON[k]).convertSRGBToLinear(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, fog: false, opacity: 0 }));
        s.position.set(a[0] + 0.03, a[1], a[2]); s.scale.setScalar(0.15); s.renderOrder = 30;
        if (idxS) { s.position.sub(PV); swing.add(s); } else model.add(s); return s; });
      // eixos da tela vistos de dentro do modelo (ele está girado em Y): balanço lateral = eixo Z da tela, frente/trás = eixo X
      const Yax = new THREE.Vector3(0, 1, 0), axZ = new THREE.Vector3(0, 0, 1).applyAxisAngle(Yax, -C.ROT_Y), axX = new THREE.Vector3(1, 0, 0).applyAxisAngle(Yax, -C.ROT_Y);
      // escala e giro (frente do modelo para a câmera) com o centro do corpo na origem: a mola e o balanço giram em volta da fada
      model.scale.setScalar(C.SCALE); model.rotation.y = C.ROT_Y;
      model.position.copy(center).multiplyScalar(C.SCALE).applyAxisAngle(new THREE.Vector3(0, 1, 0), C.ROT_Y).negate();
      return { model, U, wings, glows, G, semPiv, swing: idxS ? swing : null, axZ, axX };
    },
    build(camera) {
      if (this.rig) return;
      const rig = this.rig = new THREE.Group(); rig.visible = false; camera.add(rig);
      this.state = 'off'; this.t = 0; this.spark = 0; this.on = [0, 0, 0]; this.kick = null; this.ph = 0; this.blinkIn = 1.2; this.blink = null;
      this.preload().then(() => this.attach());
    },
    // o modelo chegou: entra na câmera (se a contagem já começou, entra com o efeito elástico)
    attach() {
      if (!this.rig || !this.tpl || this.fig) return;
      const fig = this.fig = new THREE.Group(); fig.position.fromArray(fc().POS); this.rig.add(fig); fig.add(this.tpl.model);
      // glow: halo forte colado ao corpo + aura grande e suave que pulsa devagar
      const spr = (c, s, o) => { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: o })); p.scale.setScalar(s); fig.add(p); return p; };
      this.aura = spr(0xffd84a, fc().AURA, 0.3); this.halo = spr(0xfff08a, fc().HALO, 0.8);
      this.applyLamp();
      if (this.state === 'in' || this.state === 'hold') { this.state = 'in'; this.t = 0; }
    },
    applyLamp() {
      if (!this.tpl) return;
      this.on.forEach((v, i) => { this.tpl.U.uOn.value[i] = v; this.tpl.glows[i].material.opacity = v ? 0.4 : 0; });
    },
    // k: -1 (tudo apagado), uma lâmpada (0 vermelho, 1 amarelo, 2 verde) ou uma lista delas ([0, 1])
    setLamp(k, track) {
      const list = k == null || k === -1 ? [] : Array.isArray(k) ? k : [k], prev = this.on || [0, 0, 0];
      this.on = [0, 1, 2].map(i => list.indexOf(i) >= 0 ? 1 : 0); this.applyLamp();
      if (track && track.archLamps) track.archLamps.forEach((pair, i) => pair.forEach(m => m.material.color.setHex(this.on[i] ? this.ON[i] : this.DIM[i])));
      if (list.length && this.state !== 'off' && this.fig) {
        const go = !!this.on[2]; this.kick = { t: 0 };                       // só o brilho pulsa (sem pulinho da fada)
        if (this.sw) { this.sw.dir = -(this.sw.dir || 1); const K = fc().SWING.KICK * (go ? 1.5 : 1);   // empurrão alternado + um pouco para a frente
          this.sw.va += K * this.sw.dir; this.sw.vb += K * 0.35; }
      }
    },
    // sinaleiro pendurado: pêndulo amortecido (mola) nos dois sentidos + cabo que estica e encolhe.
    // A aceleração do ponto de giro (vista da câmera) entra como inércia: quando a fada pula, quica ou sai voando,
    // o sinaleiro "fica para trás" e depois oscila até parar. O ângulo é do mundo; desconta-se a inclinação da fada.
    swingStep(dt, camera, f) {
      const T = this.tpl, S = fc().SWING, h = Math.min(Math.max(dt, 1 / 240), 1 / 20);
      const p = (this._pw || (this._pw = new THREE.Vector3())); T.semPiv.getWorldPosition(p); camera.worldToLocal(p);
      let s = this.sw;
      if (!s || !s.init) { s = this.sw = Object.assign(s || { a: 0, va: 0, b: 0, vb: 0, s: 0, vs: 0, dir: 1 }, { init: true, px: p.x, py: p.y, pz: p.z, vx: 0, vy: 0, vz: 0 }); }
      const vx = (p.x - s.px) / h, vy = (p.y - s.py) / h, vz = (p.z - s.pz) / h, cl = v => Math.max(-45, Math.min(45, v));
      const ax = cl((vx - s.vx) / h), ay = cl((vy - s.vy) / h), az = cl((vz - s.vz) / h);
      Object.assign(s, { px: p.x, py: p.y, pz: p.z, vx, vy, vz });
      const w = 2 * Math.PI * S.FREQ, c = 2 * S.DAMP * w, ws = w * 2.6, cs = 2 * 0.22 * ws;
      // semi-implícito (estável): velocidade primeiro, depois posição
      s.va += (-w * w * Math.sin(s.a) - c * s.va - S.INERTIA * ax * Math.cos(s.a)) * h; s.a += s.va * h;
      s.vb += (-w * w * Math.sin(s.b) - c * s.vb + S.INERTIA * 0.6 * az) * h;          s.b += s.vb * h;
      s.vs += (-ws * ws * s.s - cs * s.vs + 0.004 * ay) * h;                               s.s += s.vs * h;
      const M = S.MAX; if (Math.abs(s.a) > M) { s.a = Math.sign(s.a) * M; s.va *= -0.4; } if (Math.abs(s.b) > M * 0.6) { s.b = Math.sign(s.b) * M * 0.6; s.vb *= -0.4; }
      s.s = Math.max(-S.STRETCH, Math.min(S.STRETCH, s.s));
      const q = this._q || (this._q = new THREE.Quaternion()), q2 = this._q2 || (this._q2 = new THREE.Quaternion());
      q.setFromAxisAngle(T.axZ, s.a - f.rotation.z); q2.setFromAxisAngle(T.axX, s.b); T.swing.quaternion.copy(q).multiply(q2);
      T.swing.scale.set(1 - s.s * 0.5, 1 + s.s, 1 - s.s * 0.5);
    },
    show() { this.state = 'in'; this.t = 0; this.kick = null; this.sw = null; if (this.rig) this.rig.visible = true; this.setLamp(-1);
      if (this.status === 'erro' && !this._warned) { this._warned = true; setTimeout(() => UI.toast('Fatecxie não carregou: ' + this.reason, 6000), 2000); } },
    leave() { if (this.state !== 'off') { this.state = 'out'; this.t = 0; } },
    hide() { if (this.rig) { this.state = 'off'; this.rig.visible = false; this.kick = null; } },
    step(dt, camera) {
      if (!this.rig || this.state === 'off') return;
      this.t += dt; const t = performance.now() / 1000, C = fc();
      const halfW = Math.tan(camera.fov * Math.PI / 360) * 7 * camera.aspect, sx = Math.max(0.45, Math.min(1, (halfW - 0.3) / 2.5));   // telas estreitas: encolhe
      let ox = 0, oy = 0, sc = 1, spin = 0;
      if (this.state === 'in') {                                   // chega voando e "quica" no lugar (elástico)
        const k = Math.min(1, this.t / 1.25), e = Ease.outElastic(k, 0.45);
        ox = (1 - e) * 6; oy = (1 - e) * 4.5; spin = (1 - e) * 0.9; sc = 0.35 + 0.65 * Ease.outElastic(Math.min(1, k * 1.15), 0.35);
        if (k >= 1) this.state = 'hold';
      } else if (this.state === 'out') {                           // antecipação (abaixa um pouco) e dispara para cima
        const k = Math.min(1, this.t / 1.2), e = Ease.inBack(k);
        ox = e * 5.5; oy = e * 8.5; spin = -e * 0.5; sc = 1 + Math.max(0, e) * 0.15;
        if (k >= 1) { this.hide(); return; }
      }
      this.rig.scale.set(sx, sx, 1); this.rig.position.set(ox, oy + Math.sin(t * 2.3) * 0.14, 0);
      if (!this.fig) return;
      // mola (oscilação amortecida): começa achatada, estica, balança o semáforo e dá um pulinho
      // a cada luz só o brilho dá um pulso suave (a fada não pula nem achata)
      let pop = 0;
      if (this.kick) { const u = (this.kick.t += dt); pop = Math.exp(-5 * u); if (u > 1.2) this.kick = null; }
      const f = this.fig, P0 = C.POS;
      f.position.set(P0[0], P0[1], P0[2]); f.scale.setScalar(sc);
      f.rotation.set(0, Math.sin(t * 1.3) * 0.16 + spin, Math.sin(t * 3.1) * 0.06);
      // glow pulsando (mais forte no "soco" de cada luz)
      const T = this.tpl, pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
      this.halo.material.opacity = Math.min(1, 0.65 + 0.15 * Math.sin(t * 9) + 0.35 * Math.max(0, pop));
      this.halo.scale.setScalar(C.HALO * (1 + 0.08 * pulse + 0.15 * Math.max(0, pop)));
      this.aura.material.opacity = 0.14 + 0.1 * pulse + 0.16 * Math.max(0, pop); this.aura.scale.setScalar(C.AURA * (0.92 + 0.12 * pulse));
      T.U.uRim.value = C.RIM * (0.85 + 0.3 * pulse + 0.4 * Math.max(0, pop));
      this.on.forEach((v, i) => { if (v) { T.glows[i].scale.setScalar(0.15 * (1 + 0.3 * pop + 0.05 * Math.sin(t * 7))); T.glows[i].material.opacity = 0.38 + 0.2 * pop; } });
      if (T.swing) this.swingStep(dt, camera, f);
      // piscada: a cada 2 a 4,5 s (às vezes duas seguidas); fecha rápido e abre um pouco mais devagar
      this.blinkIn -= dt;
      if (!this.blink && this.blinkIn <= 0) { this.blink = { t: 0, again: Math.random() < 0.25 }; }
      let bl = 0;
      if (this.blink) { const k = (this.blink.t += dt) / 0.17;
        bl = k < 0.4 ? k / 0.4 : Math.max(0, 1 - (k - 0.4) / 0.6); bl = bl * bl * (3 - 2 * bl);
        if (k >= 1) { const again = this.blink.again; this.blink = null;
          this.blinkIn = again ? 0.12 : C.BLINK[0] + Math.random() * (C.BLINK[1] - C.BLINK[0]); } }
      T.U.uBlink.value = bl;
      // asas: batida rápida; os rastros cobrem o arco que a asa percorreu durante este quadro (desfoque de movimento)
      const W = C.WINGS, w = W.HZ * (this.state === 'out' ? 1.3 : 1) * Math.PI * 2, span = Math.min(Math.PI * 1.8, Math.max(dt, 1 / 120) * w * W.SHUTTER);
      this.ph = (this.ph + dt * w) % (Math.PI * 2);
      T.wings.forEach(wg => wg.layers.forEach((h, k) => { const s = Math.sin(this.ph - (T.G ? span * k / T.G : 0));
        h.rotation.set(-wg.sgn * W.ROLL * s, -wg.sgn * W.YAW * (0.3 + 0.7 * s), 0); }));
    }
  };
  // começa a baixar a fadinha logo depois que a página abre (fica pronta antes da primeira largada)
  window.addEventListener('load', () => setTimeout(() => Fairy.preload(), 400));

  // ================================ MINIMAPA ================================
  const Mini = {
    build(track, colors) {
      const c = $('mini'), MW = c.width, MH = c.height, BS = this.BS = Math.max(1, (CFG.MINIMAP && CFG.MINIMAP.ZOOM) || 2.4);   // BS: o mapa-base é desenhado BS vezes maior para o zoom ficar nítido
      this.c = c; this.g = c.getContext('2d'); this.colors = colors;
      const base = this.base = document.createElement('canvas'); base.width = Math.round(MW * BS); base.height = Math.round(MH * BS); const g = base.getContext('2d'); g.scale(BS, BS);   // o desenho continua nas coordenadas de 264 px
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; track.S.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, s = (MW - 64) / Math.max(x1 - x0, z1 - z0);
      const mm = this.mm = (x, z) => [MW / 2 - (x - cx) * s, MH / 2 - (z - cz) * s]; this.s = s;
      // Sem fundo, grama, água nem moldura: só o que importa fica no desenho (pista, ilhas, prédios, trilho, ponte, túnel).
      const INK = '#1f2026', ROAD = '#f6f8fc', EDGE = '#ffffff';
      const N = track.N, node = i => track.S[((i % N) + N) % N];
      // traçado suave: em vez de ligar os pontos por retas (que forma quinas nas curvas com o zoom), cada ponto vira o
      // controle de uma curva quadrática que passa pelos pontos médios; a pista fica contínua e arredondada
      const mp = i => { const q = node(i); return mm(q.x, q.z); };
      const pathPts = (from, to, step) => {
        const idx = []; for (let i = from; i < to; i += step) idx.push(i); idx.push(to);
        const P = idx.map(mp), n = P.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; g.beginPath();
        if (from === 0 && to === N) {                                  // volta fechada (sem ponta repetida)
          P.pop(); const m = P.length, st = mid(P[m - 1], P[0]); g.moveTo(st[0], st[1]);
          for (let k = 0; k < m; k++) { const nx = mid(P[k], P[(k + 1) % m]); g.quadraticCurveTo(P[k][0], P[k][1], nx[0], nx[1]); }
        } else {                                                       // trecho aberto (túnel)
          g.moveTo(P[0][0], P[0][1]);
          for (let k = 1; k < n - 1; k++) { const nx = mid(P[k], P[k + 1]); g.quadraticCurveTo(P[k][0], P[k][1], nx[0], nx[1]); }
          g.lineTo(P[n - 1][0], P[n - 1][1]);
        }
      };
      const ang = i => { const t = track.T[((i % N) + N) % N]; return Math.atan2(-t.z, -t.x); };   // sentido da pista na tela (o mapa é espelhado em x e z)
      // ilhas (praia): areia suave com borda clara
      track.minimap.forEach(e => {
        if (e.type !== 'island') return;
        g.beginPath(); e.poly.forEach((p, k) => { const [a, b] = mm(p[0], p[1]); k ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath();
        g.fillStyle = 'rgba(255, 226, 150, .78)'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = 'rgba(255, 255, 255, .85)'; g.stroke();
      });
      // trilho do trem (cidade): dormentes e trilhos
      track.minimap.forEach(e => {
        if (e.type !== 'rail') return;
        const [a, b] = mm(e.a[0], e.a[1]), [c2, d] = mm(e.b[0], e.b[1]); g.lineCap = 'butt';
        g.strokeStyle = 'rgba(40, 42, 54, .85)'; g.lineWidth = 6; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke();
        g.setLineDash([1.6, 2.6]); g.strokeStyle = '#e9ebf3'; g.lineWidth = 4.2; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke(); g.setLineDash([]);
        g.strokeStyle = '#e9ebf3'; g.lineWidth = .9; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke();
      });
      // prédios: bloco azulado com contorno fino
      track.minimap.forEach(e => {
        if (e.type !== 'building') return; const [a, b] = mm(e.x, e.z);
        g.save(); g.translate(a, b); g.rotate(e.rot); g.fillStyle = 'rgba(132, 142, 196, .62)'; g.fillRect(-e.w * s / 2, -e.d * s / 2, e.w * s, e.d * s);
        g.lineWidth = .9; g.strokeStyle = 'rgba(70, 78, 130, .75)'; g.strokeRect(-e.w * s / 2, -e.d * s / 2, e.w * s, e.d * s); g.restore();
      });
      g.lineJoin = g.lineCap = 'round';
      // sombra suave embaixo da pista
      g.save(); g.translate(.8, 1.4); pathPts(0, N, 2); g.closePath(); g.lineWidth = 13; g.strokeStyle = 'rgba(0, 0, 0, .28)'; g.stroke(); g.restore();
      // pista: meio-fio escuro, asfalto claro e faixa central tracejada
      pathPts(0, N, 2); g.closePath(); g.lineWidth = 12.5; g.strokeStyle = INK; g.stroke();
      pathPts(0, N, 2); g.closePath(); g.lineWidth = 10; g.strokeStyle = EDGE; g.stroke();
      pathPts(0, N, 2); g.closePath(); g.lineWidth = 8; g.strokeStyle = ROAD; g.stroke();
      // trecho coberto (túnel): faixa mais escura com listras
      track.minimap.filter(e => e.type === 'tunnel').forEach(e => {
        g.lineCap = 'butt'; pathPts(e.from, e.to, 2); g.lineWidth = 12.5; g.strokeStyle = INK; g.stroke();
        pathPts(e.from, e.to, 2); g.lineWidth = 8; g.strokeStyle = '#8a90b4'; g.stroke();
      });
      // turbos: bolinha rosa com anel branco
      track.pads.forEach(p => { const [a, b] = mm(p.x, p.z); g.beginPath(); g.arc(a, b, 2.8, 0, 6.2832); g.fillStyle = '#ff4ad8'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = '#fff'; g.stroke(); });
      // linha de largada quadriculada: ocupa a largura toda da pista (faixa branca de 10 px, de borda a borda)
      { const i = track.startIdx, q = node(i), [a, b] = mm(q.x, q.z); g.save(); g.translate(a, b); g.rotate(ang(i)); g.lineJoin = 'miter';
        const RW = 10, cw = RW / 4, rw = 2.5;   // 4 colunas através da pista, 2 fileiras ao longo dela
        for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) { g.fillStyle = (r + k) % 2 ? INK : '#fff'; g.fillRect(-rw + r * rw, -RW / 2 + k * cw, rw, cw); }
        g.lineWidth = .8; g.strokeStyle = INK; g.strokeRect(-rw, -RW / 2, rw * 2, RW);
        g.restore(); }
    },
    // minimapa aproximado: recorta o mapa-base em volta do kart (o kart fica sempre no centro) e aplica um degradê radial:
    // a pista é nítida perto do kart e some suavemente com a distância, então o trajeto "aparece" conforme você avança
    draw(player, bot) {
      if (!this.base) return; const g = this.g, W = this.c.width, H = this.c.height, BS = this.BS, cfg = CFG.MINIMAP || {};
      const [mx, my] = this.mm(player.pos.x, player.pos.z), sx = mx * BS - W / 2, sy = my * BS - H / 2;   // canto do recorte no mapa-base
      g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, W, H); g.drawImage(this.base, sx, sy, W, H, 0, 0, W, H);
      const R = Math.min(W, H) / 2, f0 = cfg.FADE_START == null ? 0.42 : cfg.FADE_START;
      if (!this.fade || this.fade.R !== R) { const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, R); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(f0, 'rgba(0,0,0,1)'); gr.addColorStop(0.72, 'rgba(0,0,0,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); this.fade = { R, gr }; }
      g.globalCompositeOperation = 'destination-in'; g.fillStyle = this.fade.gr; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over';
      // escala dos ícones (pontos dos rivais e seta do jogador); ajuste em config.js: MINIMAP.ICON (1 = tamanho original)
      const K = cfg.ICON || 0.9;
      const dot = (k, col, r) => {
        const [qx, qy] = this.mm(k.pos.x, k.pos.z), x = qx * BS - sx, y = qy * BS - sy, d = Math.hypot(x - W / 2, y - H / 2);
        if (d > R * 0.94) return;                                                   // fora do alcance do minimapa
        g.globalAlpha = Math.max(0, Math.min(1, (R * 0.94 - d) / (R * 0.22)));     // some suavemente na borda
        r *= K; g.strokeStyle = '#1d1d1d'; g.lineWidth = 3 * K; g.beginPath(); g.arc(x, y, r + 3 * K, 0, 6.2832); g.fillStyle = '#fff'; g.fill(); g.stroke(); g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); g.globalAlpha = 1;
      };
      // rivais: aceita um kart ou a lista dos 7 (cada um com a própria cor, k.mapColor)
      (Array.isArray(bot) ? bot : bot ? [bot] : []).forEach(k => dot(k, k.mapColor || this.colors.bot, 5));
      g.save(); g.translate(W / 2, H / 2); g.rotate(-player.ang); g.scale(K, K); g.beginPath(); g.moveTo(0, -13); g.lineTo(10, 10); g.lineTo(0, 5); g.lineTo(-10, 10); g.closePath();
      g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = '#1d1d1d'; g.stroke(); g.lineWidth = 3.5; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = this.colors.player; g.fill(); g.restore();
    }
  };

  // ================================ VELOCÍMETRO ================================
  // mostrador branco com arco colorido, ponteiro azul-marinho e número grande; anel interno = carga do mini-turbo
  function drawSpeedo(k) {
    const c = $('speedo'), g = c.getContext('2d'), Wc = c.width, Hc = c.height, cx = Wc / 2, cy = Hc - 24, R = 112, a0 = Math.PI * 0.95, a1 = Math.PI * 2.05, maxK = 180;
    const kmh = Math.abs(k.speed) * CFG.PHYS.KMH, frac = Math.min(1, kmh / maxK), boost = k.boostT > 0;
    g.clearRect(0, 0, Wc, Hc); g.lineCap = 'round';
    // placa
    g.beginPath(); g.arc(cx, cy, R + 26, Math.PI, 0); g.lineTo(cx + R + 26, cy + 14); g.lineTo(cx - R - 26, cy + 14); g.closePath();
    g.fillStyle = '#2a1d4a'; g.save(); g.translate(0, 6); g.fill(); g.restore(); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#2a1d4a'; g.stroke();
    // trilho e arco aceso
    g.beginPath(); g.arc(cx, cy, R, a0, a1); g.lineWidth = 18; g.strokeStyle = '#e3e8fb'; g.stroke();
    if (frac > 0.005) { const gr = g.createLinearGradient(cx - R, 0, cx + R, 0);
      if (boost) { gr.addColorStop(0, '#3dd6ff'); gr.addColorStop(1, '#8b5cf6'); } else { gr.addColorStop(0, '#2ee6a8'); gr.addColorStop(0.55, '#ffd23f'); gr.addColorStop(1, '#ff4d6d'); }
      g.beginPath(); g.arc(cx, cy, R, a0, a0 + (a1 - a0) * frac); g.lineWidth = 18; g.strokeStyle = gr; g.stroke(); }
    // marcações
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 12px ' + CFG.FONT_UI; g.fillStyle = '#5d4f86';
    for (let v = 0; v <= maxK; v += 20) { const a = a0 + (a1 - a0) * v / maxK, cs = Math.cos(a), sn = Math.sin(a);
      g.beginPath(); g.moveTo(cx + cs * (R - 16), cy + sn * (R - 16)); g.lineTo(cx + cs * (R - (v % 40 ? 21 : 25)), cy + sn * (R - (v % 40 ? 21 : 25))); g.lineWidth = 3; g.strokeStyle = '#2a1d4a'; g.stroke();
      if (v % 40 === 0) g.fillText(String(v), cx + cs * (R + 18), cy + sn * (R + 18)); }      // números fora do arco
    if (k.drifting) { const ch = Math.min(1, k.driftT / 2); g.beginPath(); g.arc(cx, cy, R - 31, a0, a0 + (a1 - a0) * ch); g.lineWidth = 6; g.strokeStyle = k.driftT > 2 ? '#ff8a00' : k.driftT > 1 ? '#1a74ff' : '#ffc928'; g.stroke(); }
    // ponteiro
    const an = a0 + (a1 - a0) * frac;
    g.save(); g.translate(cx, cy); g.rotate(an); g.beginPath(); g.moveTo(R - 62, -3.5); g.lineTo(R - 4, -1.5); g.lineTo(R - 4, 1.5); g.lineTo(R - 62, 3.5); g.closePath(); g.fillStyle = '#ff3d47'; g.fill();
    g.lineWidth = 2; g.strokeStyle = '#2a1d4a'; g.stroke(); g.restore();      // ponteiro curto na borda: não cobre o número
    // número
    g.font = '700 50px ' + CFG.FONT_DISPLAY; g.lineJoin = 'round';
    const txt = String(Math.round(kmh)); g.lineWidth = 8; g.strokeStyle = '#2a1d4a'; g.strokeText(txt, cx, cy - 34);
    g.fillStyle = boost ? '#3dd6ff' : '#ffffff'; g.fillText(txt, cx, cy - 34);
    g.font = '900 13px ' + CFG.FONT_UI; g.fillStyle = '#5d4f86'; g.fillText(boost ? 'BOOST!' : 'km/h', cx, cy - 4);
  }

  // ================================ MENU ================================
  function trackPreview(canvas, def) {
    const L = Tracks.layout(def), g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    const bg = { classic: ['#8fdc6a', '#4fae3a'], city: ['#b9c0dc', '#7c84ac'], beach: ['#58c8ff', '#ffe2a0'] }[def.id];
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, bg[0]); gr.addColorStop(1, def.id === 'beach' ? '#1a8ae8' : bg[1]); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const b = L.bbox, s = Math.min((w - 26) / (b.x1 - b.x0), (h - 26) / (b.z1 - b.z0)), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const P = p => [w / 2 - (p.x - cx) * s, h / 2 - (p.z - cz) * s];
    const path = () => { g.beginPath(); L.S.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
    g.lineJoin = 'round';
    if (def.id === 'beach') { path(); g.lineWidth = 30; g.strokeStyle = bg[1]; g.stroke(); g.fillStyle = bg[1]; g.fill(); }
    if (def.id === 'city') { g.fillStyle = 'rgba(255,255,255,.35)'; for (let k = 0; k < 46; k++) { const x = (k * 37) % w, y = (k * 53) % h; g.fillRect(x, y, 10, 8); } }
    path(); g.lineWidth = 11; g.strokeStyle = '#2a1d4a'; g.stroke(); path(); g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.stroke();
    const [sx, sy] = P(L.S[def.startIdx]); g.fillStyle = '#ff3d47'; g.beginPath(); g.arc(sx, sy, 6, 0, 6.2832); g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
  }

  // recordes por pista (salvos no navegador; se o navegador bloquear, só não guarda)
  const Records = {
    get(id) { try { const v = parseFloat(localStorage.getItem(CFG.STORAGE + ':best:' + id)); return isFinite(v) ? v : null; } catch (e) { return null; } },
    set(id, t) { try { const b = this.get(id); if (b === null || t < b) { localStorage.setItem(CFG.STORAGE + ':best:' + id, String(t)); return true; } } catch (e) { } return false; }
  };

  // telas que existem como <section>; o resto do estado (corrida, contagem...) usa a tela "race"
  const SCREENS = ['boot', 'intro', 'menu', 'garage', 'lobby', 'race', 'round', 'podium'];

  // ================================ LINHAS DE VELOCIDADE ================================
  // um canvas com raios brancos saindo do centro (meio transparente); a opacidade segue a velocidade
  // e o ângulo é sorteado a cada quadro para "tremer" como nos desenhos animados
  const SpeedLines = {
    init() {
      const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
      for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, w = 0.004 + Math.random() * 0.012, r0 = 150 + Math.random() * 60;
        g.fillStyle = 'rgba(255,255,255,' + (0.5 + Math.random() * 0.5) + ')'; g.beginPath(); g.moveTo(256 + Math.cos(a) * r0, 256 + Math.sin(a) * r0);
        g.lineTo(256 + Math.cos(a - w) * 380, 256 + Math.sin(a - w) * 380); g.lineTo(256 + Math.cos(a + w) * 380, 256 + Math.sin(a + w) * 380); g.fill(); }
      this.el = $('speedLines'); this.el.style.backgroundImage = 'url(' + c.toDataURL() + ')'; this.v = 0;
    },
    step(k) {
      if (!this.el) return; if (window.Settings && !Settings.g.speedFx) { this.el.style.opacity = 0; this.v = 0; return; }
      const sp = Math.abs(k.speed) / CFG.PHYS.MAX, t = k.boostT > 0 ? 0.85 : Math.min(0.42, Math.max(0, (sp - 0.72) * 1.6));
      this.v += (t - this.v) * 0.15; this.el.style.opacity = this.v.toFixed(2);
      if (this.v > 0.02) this.el.style.transform = 'rotate(' + (Math.random() * 360).toFixed(0) + 'deg) scale(' + (1 + Math.random() * 0.06).toFixed(3) + ')';
    }
  };

  // ================================ HUD 3D DINÂMICO ================================
  // Os elementos do HUD (menos o cronômetro, que fica 100% parado) ganham perspectiva 3D e molas, como o velocímetro 3D:
  // acelerar inclina o topo para trás, a inércia da curva balança para fora, o turbo e o aumento do FOV da câmera empurram
  // e ampliam, o ar faz flutuar. Lado direito (minimapa, junto do velocímetro) inclina para dentro; lado esquerdo
  // (volta, posição) recebe a inclinação ESPELHADA, formando uma moldura simétrica.
  const HudFx = {
    items: [], on: false, t0: 0, prevAng: null, prevFr: 0, acc: 0, lat: 0, boost: 0, wasBoost: false, wasAir: false,
    sp() { return { x: 0, v: 0 }; },
    init() {
      const mot = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1; this.mot = mot;
      // side: +1 = lado do velocímetro (direita), -1 = espelhado (esquerda); rx/ry/rz em graus; o: transform-origin
      const defs = [
        { id: 'mini', side: 1, vy: -1, rx: 7, ry: 15, rz: 3, o: '50% 50%', k: 1 },
        { id: 'pos', side: -1, vy: 1, rx: 7, ry: 17, rz: -4, o: '0% 100%', k: 1.15 },
        { id: 'lap', side: -1, vy: -1, rx: 5, ry: 13, rz: -1.5, o: '0% 50%', k: 0.8 },
        { id: 'cupInfo', side: -1, vy: -1, rx: 5, ry: 13, rz: -1.5, o: '0% 50%', k: 0.8 }
      ];
      this.items = defs.map(d => { const el = $(d.id); if (!el) return null; el.style.transformOrigin = d.o; el.style.willChange = 'transform'; return Object.assign(d, { el, ph: Math.random() * 6 }); }).filter(Boolean);
      const S = () => this.sp();
      this.S = { rx: S(), ry: S(), rz: S(), px: S(), py: S(), sc: S() };
      this.t = 0; this.on = true;
    },
    reset() { this.prevAng = null; this.prevFr = 0; this.acc = 0; this.lat = 0; this.boost = 0; this.t0 = 0; if (this.S) for (const k in this.S) { this.S[k].x = 0; this.S[k].v = 0; } },
    stepSpring(s, to, k, c, dt) { s.v += (k * (to - s.x) - c * s.v) * dt; s.x += s.v * dt; },
    step(p) {
      if (!this.on) return;
      const now = performance.now(); let dt = this.t0 ? (now - this.t0) / 1000 : 0; this.t0 = now;
      dt = Math.max(0, Math.min(dt, 0.05)); if (dt <= 0) return;
      const M = this.mot, S = this.S, clamp = (v, a, b) => v < a ? a : v > b ? b : v, damp = (c, to, r) => c + (to - c) * (1 - Math.exp(-r * dt));
      this.t += dt;
      // entradas: velocidade, aceleração, curva (variação do rumo do kart), turbo, FOV, ar
      const fr = clamp(Math.abs(p.speed) / CFG.PHYS.MAX, 0, 1.15);
      this.acc = damp(this.acc, clamp((fr - this.prevFr) / dt, -3, 3), 4); this.prevFr = fr;
      let steer = 0;
      if (this.prevAng != null) { let d = p.ang - this.prevAng; d = Math.atan2(Math.sin(d), Math.cos(d)); steer = clamp(-d / dt / 1.6, -1, 1); }
      this.prevAng = p.ang;
      this.lat = damp(this.lat, steer * Math.min(1, fr * 1.4), 3.5);
      const ci = window.Speedo3D && window.Speedo3D.camInfo, fovK = ci ? clamp((ci.fov - ci.fov0) / 28, 0, 1) : 0;
      const boost = Math.max(p.boostT > 0 ? 1 : 0, fovK), air = !!(p.airborne || p.air);
      if (boost > 0.5 && !this.wasBoost) { S.sc.v += 3 * M; S.py.v += 40 * M; S.rz.v += 25 * M * (Math.random() < .5 ? -1 : 1); }
      if (this.wasAir && !air) { S.py.v += 90 * M; S.rx.v += 60 * M; S.sc.v -= 1.5 * M; }
      this.wasBoost = boost > 0.5; this.wasAir = air;
      this.boost = damp(this.boost, boost, boost > this.boost ? 14 : 4);
      const a = clamp(this.acc, -1.2, 1.2) * M, l = this.lat * M, b = this.boost, t = this.t;
      const floatY = air ? -5 + Math.sin(t * 5.2) * 1.5 : Math.sin(t * 1.7) * 0.7 * M;
      const n = 2; for (let i = 0; i < n; i++) { const h = dt / n;
        this.stepSpring(S.rx, -a * 5 + (air ? Math.sin(t * 3.1) * 3 * M : 0), 120, 12, h);        // graus: frear/acelerar inclina
        this.stepSpring(S.ry, -l * 7, 110, 12, h);
        this.stepSpring(S.rz, -l * 5 + (air ? Math.sin(t * 2.3) * 2.5 * M : 0), 130, 11, h);
        this.stepSpring(S.px, l * 7, 100, 12, h);                                                  // pixels: inércia para fora da curva
        this.stepSpring(S.py, floatY + a * 4, 120, 11, h);
        this.stepSpring(S.sc, b * 0.06 + fovK * 0.16, 220, 14, h); }
      // vibração: velocidade alta e turbo
      const amp = (0.015 + fr * fr * 0.07 + b * 0.09) * M, nz = (Math.sin(t * 53.1) + Math.sin(t * 77.7 + 1.3)) * 0.5, ny = (Math.sin(t * 61.3 + 2) + Math.sin(t * 89.1)) * 0.5;
      for (const it of this.items) {
        const sd = it.side, k = it.k;
        // base espelhada: direita gira ry negativo (vira para dentro), esquerda ry positivo; o FOV aumenta a inclinação
        const ry = -sd * (it.ry + fovK * 16) + S.ry.x * k, rx = it.rx + S.rx.x * k + ny * amp * 0.6, rz = it.rz + S.rz.x * k + nz * amp;
        const tx = S.px.x * k + sd * (fovK * 60 + b * 8), ty = S.py.x * k + ny * amp * 0.8 + it.vy * fovK * 28, sc = 1 + S.sc.x * k;
        it.el.style.transform = 'perspective(650px) translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) rotateZ(' + rz.toFixed(2) + 'deg) scale(' + sc.toFixed(4) + ')';
      }
    }
  };

  const UI = {
    Sfx, Fairy, Mini, Records, fmt, SpeedLines, HudFx,
    trackIdx: 0, mode: 'cup', diff: 'normal', laps: CFG.LAPS,
    init(h) {
      this.h = h;
      SpeedLines.init();
      HudFx.init();
      // efeito gelatina em qualquer botão ou bolinha de cor
      document.addEventListener('pointerdown', e => { const b = e.target.closest && e.target.closest('button, .swatch, .trackCard'); if (!b) return; b.classList.remove('jelly'); void b.offsetWidth; b.classList.add('jelly'); });
      document.addEventListener('animationend', e => { if (e.animationName === 'jelly') e.target.classList.remove('jelly'); });
      // logo única (abertura -> canto do menu)
      const tpl = $('logoTpl'); if (tpl && tpl.content) $('brand').appendChild(tpl.content.cloneNode(true));
      // modo e dificuldade (controle segmentado)
      const seg = (id, key, cb) => $(id).querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        $(id).querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
        this[key] = b.dataset.v; cb && cb(b.dataset.v);
      }));
      seg('modeSeg', 'mode', () => this.refreshTracks());
      seg('diffSeg', 'diff');
      // voltas
      $('lapStep').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const o = CFG.LAPS_OPTIONS, i = Math.max(0, Math.min(o.length - 1, o.indexOf(this.laps) + (+b.dataset.d))); this.laps = o[i]; $('lapVal').textContent = this.laps; Sfx.tone(700, 0, 0.05, 'triangle', 0.06);
      }));
      $('lapVal').textContent = this.laps;
      // pistas
      const tl = $('trackList'); this.cards = [];
      CFG.TRACKS.forEach((t, i) => {
        const card = document.createElement('button'); card.type = 'button'; card.className = 'trackCard';
        const cv = document.createElement('canvas'); cv.width = 208; cv.height = 124; trackPreview(cv, t);
        const num = document.createElement('div'); num.className = 'num'; num.textContent = String(CFG.CUP.order.indexOf(i) + 1);
        const nm = document.createElement('strong'); nm.textContent = t.name; const ds = document.createElement('span'); ds.textContent = t.desc; const rec = document.createElement('em');
        card.append(cv, num, nm, ds, rec);
        card.addEventListener('click', () => { if (this.mode !== 'single') return; this.trackIdx = i; this.refreshTracks(); h.onTrack && h.onTrack(i); });
        tl.appendChild(card); this.cards.push({ card, rec, num });
      });
      this.refreshTracks();
      // modais: qualquer [data-close] fecha; clique fora da folha também
      document.querySelectorAll('.modal').forEach(m => {
        m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this.closeModal()));
        m.addEventListener('pointerdown', e => { if (e.target === m) this.closeModal(); });
      });
      // botões
      $('btnPlay').addEventListener('click', () => { Sfx.unlock(); this.openModal('setup'); });
      $('btnGarage').addEventListener('click', () => { Sfx.unlock(); h.onGarage(); });
      $('btnHow').addEventListener('click', () => this.openModal('howModal'));
      $('btnRace').addEventListener('click', () => { Sfx.unlock(); this.closeModal(true); h.onStart(); });
      $('btnGarageBack').addEventListener('click', () => h.onMenuSoft());
      $('btnGarageDone').addEventListener('click', () => h.onMenuSoft());
      $('btnSkip').addEventListener('click', () => { Sfx.unlock(); h.onSkip(); });
      $('intro').addEventListener('pointerdown', e => { if (e.target.closest('#btnSkip')) return; Sfx.unlock(); if (document.body.classList.contains('logoPhase')) h.onSkip(); });
      $('btnNext').addEventListener('click', () => { Sfx.unlock(); h.onNext(); });
      $('btnQuit').addEventListener('click', () => h.onMenu());
      $('btnAgain').addEventListener('click', () => { Sfx.unlock(); h.onPlayAgain(); });
      $('btnMenu').addEventListener('click', () => h.onMenu());
      $('menuBtn').addEventListener('click', () => h.onMenu());
      addEventListener('keydown', e => {
        if (e.repeat) return;
        const typing = e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
        if (e.code === 'Escape') { if (this.modal) this.closeModal(); else h.onEscape && h.onEscape(); return; }
        if (e.code === 'Enter' && !typing) { e.preventDefault(); Sfx.unlock(); if (this.modal === 'setup') { this.closeModal(true); h.onStart(); } else if (this.modal) this.closeModal(); else h.onEnter && h.onEnter(); return; }
        if (typing) return;
        if (e.code === 'KeyM') { Sfx.setOn(!Sfx.on); this.toast(Sfx.on ? 'Som ligado' : 'Som desligado'); }
        if (e.code === 'KeyR' && h.onRestart) h.onRestart();
        if (e.code === 'KeyN' && h.onNextHour) h.onNextHour();
      });
    },
    // ---------- modais (abrem com escala + fade; foco vai para o primeiro controle) ----------
    // opts.back: modal para onde voltar ao fechar este (ex.: Configurações aberta pela Pausa volta para a Pausa)
    openModal(id, opts) {
      if (this.modal) this.closeModal(true);
      const m = $(id); m.hidden = false; m.classList.remove('closing'); this.modal = id; this._lastFocus = document.activeElement;
      this._back = (opts && opts.back) || null;
      if (id === 'setup') { this.refreshTracks(); this.h.onSetupOpen && this.h.onSetupOpen(); }
      requestAnimationFrame(() => { const f = m.querySelector('.cta, button'); f && f.focus({ preventScroll: true }); });
      Sfx.tone(520, 780, 0.12, 'triangle', 0.06);
    },
    closeModal(instant) {
      const id = this.modal; if (!id) return; const m = $(id); this.modal = null;
      const back = instant ? null : this._back; this._back = null;
      if (id === 'setup') this.h.onSetupClose && this.h.onSetupClose();
      if (back) { m.hidden = true; this.openModal(back); return; }                // volta para o menu anterior (sem animação de saída)
      this.h.onModalClose && this.h.onModalClose(id);
      if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) { m.hidden = true; return; }
      m.classList.add('closing'); setTimeout(() => { if (this.modal !== id) m.hidden = true; m.classList.remove('closing'); }, 220);
      if (this._lastFocus && this._lastFocus.focus) this._lastFocus.focus({ preventScroll: true });
    },
    // ---------- carregamento e abertura ----------
    bootProgress(p, note) { $('bootBar').style.width = Math.round(p * 100) + '%'; if (note) $('bootNote').textContent = note; },
    // menu: os botões começam logo abaixo da logo e, se a tela for baixa, encolhem para caber (nunca ficam por baixo dela)
    layoutMenu() {
      const nav = document.querySelector('#menu .mainNav'), brand = $('brand'); if (!nav || !brand) return;
      const mobile = innerWidth <= 860, bw = brand.offsetWidth, top = brand.offsetTop + bw * (mobile ? 0.36 : 0.37) + 10;
      nav.style.transform = ''; nav.style.top = 'auto'; nav.style.bottom = '';
      const h = nav.offsetHeight, bottomGap = mobile ? 18 : 44, avail = innerHeight - top - bottomGap;
      if (h > avail) { const s = Math.max(0.62, avail / h); nav.style.top = top + 'px'; nav.style.bottom = 'auto'; nav.style.transformOrigin = mobile ? 'top center' : 'top left'; nav.style.transform = (mobile ? 'translateX(-50%) ' : '') + 'scale(' + s.toFixed(3) + ')'; }
    },
    introPhase(ph) {   // 'film' | 'logo'
      document.body.classList.toggle('logoPhase', ph === 'logo'); document.body.classList.toggle('film', ph === 'film');
      if (ph === 'logo') { const c = document.querySelector('body > canvas'); if (c) c.style.filter = 'blur(10px) brightness(1.12)'; if (window.Logo) Logo.enter(); }
      if (ph === 'film') this.introBlur(0);
    },
    introBlur(k) { const c = document.querySelector('body > canvas'); if (c) c.style.filter = k > 0.001 ? 'blur(' + (k * 14).toFixed(1) + 'px) brightness(' + (1 + k * 0.5).toFixed(2) + ')' : ''; $('introFlash').style.opacity = (k * 0.7).toFixed(2); },
    menuKart(spec) { const m = KartModels.get(spec.model); $('menuKart').textContent = m.name + ' · nº ' + (spec.number || '—'); },
    refreshTracks() {
      const cup = this.mode === 'cup';
      $('trackList').classList.toggle('cup', cup); $('trackTitle').textContent = cup ? 'Pistas da Copa' : 'Escolha a pista';
      this.cards.forEach(({ card, rec, num }, i) => {
        const on = !cup && i === this.trackIdx; card.classList.toggle('on', on); card.setAttribute('aria-pressed', on ? 'true' : 'false'); card.tabIndex = cup ? -1 : 0;
        num.hidden = !cup; const best = Records.get(CFG.TRACKS[i].id); rec.textContent = best ? 'Recorde: ' + fmt(best) : '';
      });
    },
    screen(name) {
      const prev = document.body.dataset.screen;
      document.body.dataset.screen = name;
      SCREENS.forEach(n => { const e = $(n === 'round' ? 'roundUI' : n === 'podium' ? 'podiumUI' : n); if (e && n !== 'race') e.hidden = n !== name; });
      if (name !== 'intro') { document.body.classList.remove('film', 'logoPhase'); if (prev === 'intro') { if (window.Logo && Logo.exit(() => this.introBlur(0))) { } else this.introBlur(0); } }
      if (name !== 'menu' && this.modal) this.closeModal(true);
      if (name === 'menu') { this.refreshTracks(); this.layoutMenu();
        // entrada animada dos botões só ao chegar no menu; a classe sai no fim -> nada reinicia depois
        if (prev !== 'menu') { const nav = document.querySelector('#menu .mainNav'); if (nav) { nav.classList.remove('enter'); void nav.offsetWidth; nav.classList.add('enter'); clearTimeout(this._navT); this._navT = setTimeout(() => nav.classList.remove('enter'), 1500); } } }
    },
    // cortina: escurece, troca a cena por baixo e revela (as trocas de cena 3D ficam invisíveis)
    transition(fn) {
      const c = $('curtain');
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { fn(); return; }
      c.classList.add('on');
      setTimeout(() => { try { fn(); } finally { requestAnimationFrame(() => requestAnimationFrame(() => c.classList.remove('on'))); } }, 260);
    },
    toast(txt, ms) {
      const el = $('toast'); el.textContent = txt; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
      clearTimeout(this._tt); this._tt = setTimeout(() => el.classList.remove('show'), ms || 1400);
    },
    // número grande em SVG: contorno de tinta ATRÁS do preenchimento (paint-order no SVG funciona em todos os
    // navegadores), degradê de verdade e sombra sólida — sem os defeitos do texto HTML com background-clip
    bigText(txt, kind, thin) {
      if (kind === 'dot') return this.posDot(thin);
      txt = String(txt); const F = 100, sw = thin ? 10 : kind === 'small' ? 12 : 16, sd = thin ? 5 : 8, w = Math.max(1, txt.length) * F * 0.74 + sw * 2, h = F * 1.18;
      const fill = { gold: 'url(#gNumGold)', silver: 'url(#gNumSilver)', bronze: 'url(#gNumBronze)', white: 'url(#gNumWhite)', go: 'url(#gNumGo)', small: '#fff' }[kind] || 'url(#gNumGold)';
      const esc = txt.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const t = (dy, f, st) => '<text x="' + (w / 2) + '" y="' + (F * 0.92 + dy) + '" text-anchor="middle" font-family="Titan One, Fredoka, sans-serif" font-size="' + F + '" stroke="#2a1d4a" stroke-width="' + st + '" stroke-linejoin="round" paint-order="stroke fill" fill="' + f + '">' + esc + '</text>';
      return '<svg class="bigNum" viewBox="0 0 ' + w.toFixed(0) + ' ' + (h + 8).toFixed(0) + '" aria-hidden="true">' + t(sd, '#2a1d4a', sw) + t(0, fill, sw) + (thin ? '' :
        '<text x="' + (w / 2) + '" y="' + (F * 0.92) + '" text-anchor="middle" font-family="Titan One, Fredoka, sans-serif" font-size="' + F + '" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2" transform="translate(-2 -3)">' + esc + '</text>') + '</svg>';
    },
    // bolinha do "º" da posição: desenhada (não é glifo), grande, com o mesmo contorno fino do número
    posDot(mk) {
      const f = { gold: 'url(#gNumGold)', silver: 'url(#gNumSilver)', bronze: 'url(#gNumBronze)' }[mk] || 'url(#gNumWhite)';   // mesma cor do número da posição
      return '<svg class="bigNum" viewBox="0 0 64 70" aria-hidden="true"><circle cx="32" cy="37" r="27" fill="#2a1d4a"/><circle cx="32" cy="32" r="27" fill="#2a1d4a"/><circle cx="32" cy="32" r="21" fill="' + f + '"/><circle cx="32" cy="32" r="8.5" fill="#2a1d4a"/></svg>';
    },
    countNum(txt, go) {
      const el = $('cdnum'); el.innerHTML = txt ? this.bigText(txt, go ? 'go' : 'gold') : ''; el.setAttribute('aria-label', txt || ''); el.className = go ? 'go' : ''; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; el.hidden = !txt;
    },
    cupInfo(txt) { $('cupInfo').textContent = txt || ''; },
    _f: 0, _pos: 0,
    hud(player, bot, race) {
      const pos = race.position(player);
      if (pos !== this._pos) {
        const el = $('pos'), prev = this._pos, up = prev && pos < prev;   // up: você ganhou posição
        const mk = pos === 1 ? 'gold' : pos === 2 ? 'silver' : pos === 3 ? 'bronze' : 'white';
        const nb = el.querySelector('b'), nd = el.querySelector('i');
        // o número antigo vira um "fantasma" que sai (para baixo se você subiu, para cima se caiu)
        el.querySelectorAll('.posGhost').forEach(x => x.remove());   // troca rápida: não acumula fantasmas
        if (prev && nb.firstChild) { const g = document.createElement('span'); g.className = 'posGhost ' + (up ? 'up' : 'down'); g.innerHTML = nb.innerHTML; el.appendChild(g); g.addEventListener('animationend', () => g.remove()); setTimeout(() => g.remove(), 400); }
        nb.innerHTML = this.bigText(pos, mk, true); nd.innerHTML = this.bigText('º', 'dot', mk);
        el.dataset.p = pos; el.setAttribute('aria-label', pos + 'º lugar');
        // o novo entra por cima da animação (sem mexer no transform do #pos, que é da inclinação 3D do HudFx)
        const cls = prev ? (up ? 'in up' : 'in down') : 'in first';
        [nb, nd].forEach(n => { n.className = ''; void n.offsetWidth; n.className = cls; });
        this._pos = pos; }
      const lapN = Math.min(CFG.LAPS, Math.max(1, player.lap)), lapTxt = lapN + '/' + CFG.LAPS;
      if (lapTxt !== this._lapTxt) { this._lapTxt = lapTxt; const el = $('lap'); el.innerHTML = '<span class="cur">' + lapN + '</span><span class="sl">/</span><span class="tot">' + CFG.LAPS + '</span>'; el.setAttribute('aria-label', 'Volta ' + lapN + ' de ' + CFG.LAPS); }   // só mexe no DOM quando muda
      const tTxt = fmt(race.time); if (tTxt !== this._timeTxt) { this._timeTxt = tTxt; $('time').textContent = tTxt; }
      const run = race.time > 0.05 && !player.finished; if (run !== this._timeRun) { this._timeRun = run; $('time').classList.toggle('run', run); }   // ponteiros do relógio só giram com a corrida valendo
      // os dois canvas do HUD são redesenhados a 30 quadros/s (metade do custo, diferença invisível)
      if ((this._f++ & 1) === 0) { drawSpeedo(player); Mini.draw(player, bot); }
      SpeedLines.step(player);
      HudFx.step(player);
    },
    clock(dayT, nightF) {
      const hh = Math.floor(dayT * 24), mn = Math.floor((dayT * 24 - hh) * 60);
      const night = nightF > 0.5, txt = String(hh).padStart(2, '0') + ':' + String(mn).padStart(2, '0');
      if (this._clkN !== night) { this._clkN = night; this._clkTxt = null; $('clock').innerHTML = Icon.svg(night ? 'moon' : 'sun') + '<span></span>'; }
      if (txt !== this._clkTxt) { this._clkTxt = txt; $('clock').lastChild.textContent = txt; }
    },
    // tabela: rows = [{name, color, player, a, b}] com colunas configuráveis
    table(el, head, rows) {
      el.innerHTML = ''; el.classList.toggle('many', rows.length > 4);   // 8 corredores: tabela compacta
      const mk = (cls, cells) => { const r = document.createElement('div'); r.className = 'row ' + cls; cells.forEach(c => r.appendChild(c)); el.appendChild(r); };
      const tx = (tag, t, cls) => { const e = document.createElement(tag); e.textContent = t; if (cls) e.className = cls; return e; };
      mk('head', [tx('span', ''), tx('span', ''), tx('span', ''), tx('em', head[0]), tx('em', head[1], 'total')]);
      rows.forEach((r, i) => { const dot = document.createElement('i'); dot.style.background = r.color;
        const name = tx('span', r.name); if (r.note) { name.appendChild(document.createElement('br')); name.appendChild(tx('small', r.note)); }
        mk((r.player ? 'me ' : '') + (i === 0 ? 'first' : ''), [tx('b', (i + 1) + 'º'), dot, name, tx('em', r.a), tx('em', r.b, 'total')]); });
    },
    // info.online: Copa online (a próxima pista larga sozinha; sem "Próxima pista"); info.head: cabeçalho das colunas
    round(info) {
      $('roundEyebrow').textContent = (info.online ? CFG.CUP.name + ' online' : CFG.CUP.name) + ' · corrida ' + info.round + ' de ' + info.total;
      $('roundTitle').textContent = info.trackName;
      this.table($('roundTable'), info.head || ['Nesta pista', 'Total'], info.rows);
      $('roundNote').textContent = info.note || '';
      $('btnNext').hidden = !!info.online;
      $('btnQuit').hidden = !!info.online;
      $('btnNext').firstChild.textContent = info.last ? 'Ver pódio ' : 'Próxima pista ';
    },
    // contagem visível até a próxima pista da Copa online
    roundCountdown(ms, prefix) {
      clearInterval(this._rcT); const end = performance.now() + ms, el = $('roundNote');
      const tick = () => { const s = Math.max(0, Math.ceil((end - performance.now()) / 1000)); el.textContent = (prefix ? prefix + ' ' : '') + (s > 0 ? 'Próxima pista em ' + s + ' s…' : 'Carregando a próxima pista…'); if (s <= 0) clearInterval(this._rcT); };
      tick(); this._rcT = setInterval(tick, 250);
    },
    stopRoundCountdown() { clearInterval(this._rcT); },
    podium(info) {
      this.table($('results'), info.head || [info.cup ? 'Corridas' : 'Pista', info.cup ? 'Tempo total' : 'Tempo'], info.rows);
      const win = info.rows[0];
      $('podiumTitle').textContent = win.player ? (info.cup ? 'Você venceu a Copa!' : 'Vitória!') : win.name + (info.cup ? ' venceu a Copa' : ' venceu desta vez');
      $('podiumSub').textContent = info.sub || (win.player
        ? (info.cup ? 'Menor tempo somado nas três pistas. O troféu de ouro é seu.' : 'Primeiro lugar. O troféu é seu.')
        : (info.cup ? 'Na Copa vale a soma dos tempos: tente recuperar segundos com o mini-turbo nas curvas longas.' : 'Tente de novo: o drift com mini-turbo ganha muito tempo nas curvas longas.'));
    }
  };
  window.UI = UI;
})();
