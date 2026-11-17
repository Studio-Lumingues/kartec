// =====================================================================================
// podium.js — cerimônia de premiação ("noite de gala" ao entardecer)
//
// Cena própria: palco redondo escuro com anéis de neon, três COLUNAS metálicas (ouro, prata, bronze) que sobem
// de dentro do palco carregando os karts, telão com o nome do vencedor dentro de um arco de lâmpadas que piscam
// em sequência, torres com labaredas, holofotes varrendo o céu, torcida com bastões de luz, estrelas, confete,
// fogos e o troféu descendo do céu num feixe de luz.
//
// Sequência (segundos):
//   0,0  karts do 4º ao 8º caem nas vagas da frente do palco; câmera desce de uma grua pela passarela
//   R[2] a coluna do 3º sobe (holofote bronze acende), a câmera vai até ela
//   R[1] a coluna do 2º sobe (holofote prata)
//   R[0] suspense: palco escurece, rufar; a coluna do 1º sobe (holofote dourado), labaredas, canhões de confete,
//        troféu desce, fanfarra, fogos; o placar entra (classe .show no #podiumUI) e a câmera abre o plano final
//
// Luzes: a mesma composição da corrida (hemisférica + sol com sombra + 1 spot), assim os shaders dos karts já
// compilados na corrida são reaproveitados e a tela não trava ao entrar. Todo brilho extra (neon, lâmpadas,
// feixes, telão) é MeshBasic/aditivo, que não depende de luz.
// Nada é alocado no laço (vetores, cores e Object3D reaproveitados).
// =====================================================================================
(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const cl = x => Math.max(0, Math.min(1, x));
  const sm = x => { x = cl(x); return x * x * (3 - 2 * x); };
  const easeOut = x => 1 - Math.pow(1 - cl(x), 3);
  const easeBack = x => { x = cl(x); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const sfx = (fn, ...a) => { try { const S = window.UI && UI.Sfx; if (S && S[fn]) S[fn](...a); } catch (e) { } };

  // ---------- troféu ----------
  function makeTrophy() {
    const g = new THREE.Group();
    const gold = Toon.mat({ color: 0xffc21a, emissive: 0x3a2400 }, { gloss: 0.9, rim: 0.55, sat: 0, key: 'gold', metal: 0.85 });
    const dark = Toon.mat({ color: 0x2a1d4a }, { gloss: 0.5, rim: 0.2, sat: 0, key: 'plinth' });
    const plate = Toon.mat({ color: 0xffe9a0 }, { gloss: 0.6, rim: 0.2, sat: 0, key: 'plate' });
    // perfil fechado (raio, altura): base -> haste -> nó -> taça (fora) -> borda -> taça (dentro) -> fundo no eixo
    const prof = [[0, 0], [1.05, 0], [1.1, 0.08], [1.05, 0.22], [0.62, 0.38], [0.36, 0.62], [0.28, 0.95], [0.27, 1.25],
      [0.42, 1.38], [0.46, 1.5], [0.32, 1.62], [0.3, 1.78], [0.55, 1.92], [0.95, 2.2], [1.3, 2.7], [1.5, 3.3], [1.58, 3.78],
      [1.64, 3.9], [1.62, 3.98], [1.52, 3.98], [1.46, 3.8], [1.38, 3.3], [1.18, 2.8], [0.86, 2.4], [0.4, 2.18], [0, 2.14]]
      .map(p => new THREE.Vector2(p[0], p[1]));
    const cup = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), gold); cup.position.y = 1.2; g.add(cup);
    [-1, 1].forEach(s => { const h = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.12, 12, 28, Math.PI), gold);
      h.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2; h.position.set(s * 1.32, 1.2 + 3.05, 0); g.add(h); });
    const p1 = new THREE.Mesh(GEO.rbox(2.7, 0.7, 2.7, 0.18), dark); p1.position.y = 0.35; g.add(p1);
    const p2 = new THREE.Mesh(GEO.rbox(2.2, 0.62, 2.2, 0.16), dark); p2.position.y = 0.95; g.add(p2);
    const pl = new THREE.Mesh(GEO.rbox(1.5, 0.36, 0.12, 0.05), plate); pl.position.set(0, 0.35, 1.36); g.add(pl);
    const star = new THREE.Shape(); for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 0.2 : 0.46; k ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const st = new THREE.Mesh(new THREE.ExtrudeGeometry(star, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 }), Toon.mat({ color: 0xffffff }, { gloss: 0.8, rim: 0.3, sat: 0, key: 'star' }));
    st.position.set(0, 1.2 + 3.0, 1.42); st.rotation.x = -0.14; g.add(st);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    return g;
  }

  // ---------- texturas em canvas ----------
  const FONT = () => CFG.FONT_DISPLAY;
  function canvasTex(c) { const t = new THREE.CanvasTexture(c); t.anisotropy = TX.aniso; return t; }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  // placa da frente da coluna: medalha com o número
  function plateTex(n, c0, c1) {
    const c = TX.cvs(256, 256), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 20, 0, 236); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    g.fillStyle = '#1a1236'; g.beginPath(); g.arc(128, 128, 120, 0, 6.2832); g.fill();
    g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 104, 0, 6.2832); g.fill();
    g.lineWidth = 8; g.strokeStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(128, 128, 88, 3.6, 5.9); g.stroke();
    g.font = '700 150px ' + FONT(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 22; g.strokeStyle = '#1a1236'; g.strokeText(String(n), 128, 140); g.fillStyle = '#fff'; g.fillText(String(n), 128, 140);
    return canvasTex(c);
  }
  // número no chão, na frente das vagas do 4º ao 8º
  function spotTex(n) {
    const c = TX.cvs(128, 128), g = c.getContext('2d');
    g.font = '700 80px ' + FONT(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 12; g.strokeStyle = '#1a1236'; g.strokeText(n + 'º', 64, 70); g.fillStyle = '#c9b8ff'; g.fillText(n + 'º', 64, 70);
    return canvasTex(c);
  }
  // etiqueta com o nome acima dos três primeiros
  function labelTex(name, place, color) {
    const c = TX.cvs(512, 128), g = c.getContext('2d'), cols = ['#ffc21a', '#cfd6e6', '#e0915a'];
    g.font = '700 54px ' + FONT(); const w = Math.min(500, g.measureText(name).width + 150), x = (512 - w) / 2;
    g.fillStyle = 'rgba(16,10,40,.86)'; rrect(g, x, 18, w, 92, 46); g.fill();
    g.lineWidth = 6; g.strokeStyle = cols[place]; rrect(g, x + 3, 21, w - 6, 86, 43); g.stroke();
    g.fillStyle = cols[place]; g.beginPath(); g.arc(x + 52, 64, 32, 0, 6.2832); g.fill();
    g.fillStyle = '#1a1236'; g.font = '700 40px ' + FONT(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(place + 1), x + 52, 67);
    g.fillStyle = color || '#fff'; g.beginPath(); g.arc(x + 102, 64, 9, 0, 6.2832); g.fill();
    g.fillStyle = '#fff'; g.font = '700 50px ' + FONT(); g.textAlign = 'left'; g.fillText(name, x + 122, 67, w - 140);
    return canvasTex(c);
  }
  // telão: nome do jogo em cima, vencedor no meio
  function drawScreen(c, winner, color, hidden) {
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#2a1060'); bg.addColorStop(0.6, '#5a1a7a'); bg.addColorStop(1, '#ff4d8a'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // raios saindo do centro
    g.save(); g.translate(W / 2, H * 0.62); for (let i = 0; i < 24; i++) { g.rotate(Math.PI / 12); g.fillStyle = i % 2 ? 'rgba(255,255,255,.05)' : 'rgba(255,210,80,.08)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, -60); g.lineTo(W, 60); g.closePath(); g.fill(); } g.restore();
    // faixas quadriculadas em cima e embaixo
    for (let x = 0; x < W; x += 32) for (let r = 0; r < 2; r++) { g.fillStyle = ((x / 32) + r) % 2 ? '#fff' : '#1a1236'; g.fillRect(x, r * 16, 32, 16); g.fillRect(x, H - 32 + r * 16, 32, 16); }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.font = '700 54px ' + FONT(); g.lineWidth = 12; g.strokeStyle = '#1a1236'; g.strokeText(CFG.GAME_NAME.toUpperCase(), W / 2, 92); g.fillStyle = '#ffd23f'; g.fillText(CFG.GAME_NAME.toUpperCase(), W / 2, 92);
    g.font = '700 38px ' + FONT(); g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(hidden ? 'E O VENCEDOR É…' : 'VENCEDOR', W / 2, 172);
    if (hidden) { g.font = '700 130px ' + FONT(); g.lineWidth = 20; g.strokeStyle = '#1a1236'; g.strokeText('?  ?  ?', W / 2, 272); g.fillStyle = '#ffd23f'; g.fillText('?  ?  ?', W / 2, 272); return; }
    g.font = '700 108px ' + FONT(); g.lineWidth = 20; g.strokeText(winner.toUpperCase(), W / 2, 268, W - 80);
    const tg = g.createLinearGradient(0, 220, 0, 320); tg.addColorStop(0, '#fff6c8'); tg.addColorStop(1, '#ffb627'); g.fillStyle = tg; g.fillText(winner.toUpperCase(), W / 2, 268, W - 80);
    g.fillStyle = color || '#fff'; g.beginPath(); g.arc(W / 2, 356, 14, 0, 6.2832); g.fill(); g.lineWidth = 6; g.strokeStyle = '#fff'; g.stroke();
  }
  function scanTex() {   // listras horizontais para a varredura do telão (repete em y)
    const c = TX.cvs(4, 64), g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 64); const t = new THREE.CanvasTexture(c); t.wrapT = THREE.RepeatWrapping; return t;
  }

  // colunas: [x, altura, cor do metal, cor do neon, degradê da placa, momento em que sobe]
  const PILLARS = [
    { x: 0, h: 4.4, metal: 0xffc21a, neon: 0xffd86b, plate: ['#fff1a8', '#f0a010'], beam: 0xffe08a },
    { x: -7.4, h: 3.1, metal: 0xd8deea, neon: 0xbfe6ff, plate: ['#ffffff', '#9aa3b8'], beam: 0xcfe8ff },
    { x: 7.4, h: 2.1, metal: 0xd88a4e, neon: 0xffb07a, plate: ['#ffd2a8', '#b8642a'], beam: 0xffc49a }];
  const R = [4.6, 2.75, 1.25];          // início da subida de cada coluna (1º, 2º, 3º)
  const RISE = 0.95;                     // duração da subida
  const STAGE = 0.6;                     // altura do tampo do palco
  const PR = 2.9;                        // raio das colunas
  // vagas do 4º ao 8º: na frente do palco, em leque, de frente para a câmera
  const PARK = [[-12.6, 8, 0.5], [12.6, 8, -0.5], [-17.2, 2, 0.85], [17.2, 2, -0.85], [-17.4, -5.2, 1.15], [17.4, -5.2, -1.15], [-8, 15.5, 0.3]];

  const Podium = {
    build() { if (!this.scene) Toon.during(() => this._build()); },
    _build() {
      const sc = this.scene = new THREE.Scene();
      sc.background = new THREE.Color(0x2a1d5a); sc.fog = new THREE.Fog(0x4a2a6a, 110, 330);
      this.camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 700);
      this._d = new THREE.Object3D(); this._c = new THREE.Color(); this._v = V(0, 0, 0); this._look = V(0, 6, 0); this._lookT = V(0, 6, 0); this._pos = V(0, 30, 60); this._posT = V(0, 30, 60);
      const d = this._d;
      let seed = 9; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const basic = (o) => new THREE.MeshBasicMaterial(Object.assign({ fog: false }, o));
      const add = (o) => (sc.add(o), o);

      // ---- luz: céu roxo + sol baixo alaranjado (sombra só no palco) + spot (holofote do vencedor) ----
      this.hemi = add(new THREE.HemisphereLight(0xc9b8ff, 0x3a2050, 0.72));
      const key = new THREE.DirectionalLight(0xffc89a, 0.95); key.position.set(-22, 30, 30); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -26, right: 26, top: 22, bottom: -16, near: 5, far: 120 }); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.04;
      sc.add(key, key.target); this.key = key;
      this.spot = new THREE.SpotLight(0xfff0c8, 0, 70, 0.32, 0.6, 1.4); this.spot.position.set(0, 34, 10); this.spot.target.position.set(0, 4, 0); sc.add(this.spot, this.spot.target);

      // ---- céu do entardecer + estrelas ----
      const skC = TX.cvs(4, 256), sg = skC.getContext('2d'), sgr = sg.createLinearGradient(0, 0, 0, 256);
      sgr.addColorStop(0, '#120c38'); sgr.addColorStop(0.28, '#3a1f7a'); sgr.addColorStop(0.42, '#9a3a9a'); sgr.addColorStop(0.5, '#ff6a7a'); sgr.addColorStop(0.56, '#ffb86a'); sgr.addColorStop(0.6, '#5a2a6a'); sgr.addColorStop(1, '#2a1a4a');
      sg.fillStyle = sgr; sg.fillRect(0, 0, 4, 256);
      this.sky = add(new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), basic({ map: new THREE.CanvasTexture(skC), side: THREE.BackSide, depthWrite: false })));
      const SN = 420, sp = new Float32Array(SN * 3);
      for (let i = 0; i < SN; i++) { const a = r() * Math.PI * 2, e = 0.18 + r() * 1.2, R0 = 560; sp[i * 3] = Math.cos(a) * Math.cos(e) * R0; sp[i * 3 + 1] = Math.sin(e) * R0; sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * R0; }
      const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      this.stars = new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
      this.sky.add(this.stars);
      // morros e árvores em silhueta
      const hills = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0x3a2a6a }), 16);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, R0 = 220 + r() * 60; d.position.set(Math.cos(a) * R0, -12, Math.sin(a) * R0); d.scale.set(60 + r() * 50, 28 + r() * 30, 60 + r() * 40); d.rotation.set(0, 0, 0); d.updateMatrix(); hills.setMatrixAt(i, d.matrix); }
      hills.instanceMatrix.needsUpdate = true; hills.frustumCulled = false; sc.add(hills);
      const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(2.4, 7, 7), new THREE.MeshLambertMaterial({ color: 0x2a3a5a }), 80);
      for (let i = 0; i < 80; i++) { const a = r() * Math.PI * 2, R0 = 85 + r() * 70, k = 0.8 + r() * 0.9; d.position.set(Math.cos(a) * R0, 3.5 * k, Math.sin(a) * R0); d.scale.setScalar(k); d.updateMatrix(); trees.setMatrixAt(i, d.matrix); }
      trees.instanceMatrix.needsUpdate = true; trees.frustumCulled = false; sc.add(trees);

      // ---- chão + palco ----
      const flat = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; sc.add(m); return m; };
      flat(new THREE.CircleGeometry(320, 64), new THREE.MeshLambertMaterial({ color: 0x3a2f6a }), 0);
      const stageM = Toon.mat({ color: 0x241c4a }, { gloss: 0.75, rim: 0, sat: 0, key: 'pdStage' });
      const stage = add(new THREE.Mesh(new THREE.CylinderGeometry(21, 21.8, STAGE, 72), stageM)); stage.position.y = STAGE / 2; stage.receiveShadow = true;
      const stage2 = add(new THREE.Mesh(new THREE.CylinderGeometry(23.4, 24, 0.3, 72), Toon.mat({ color: 0x3a2f72 }, { gloss: 0.4, rim: 0, sat: 0, key: 'pdStage2' }))); stage2.position.y = 0.15; stage2.receiveShadow = true;
      // neon da borda do palco (muda de cor) e anéis no tampo que pulsam de dentro para fora
      this.edge = add(new THREE.Mesh(new THREE.TorusGeometry(21.15, 0.16, 8, 120), basic({ color: 0x3dd6ff })));
      this.edge.rotation.x = Math.PI / 2; this.edge.position.y = STAGE - 0.02;
      this.rings = [10.5, 14.5, 18.5].map((rad, i) => { const m = flat(new THREE.RingGeometry(rad - 0.12, rad + 0.12, 96), basic({ color: 0xb98cff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }), STAGE + 0.012 + i * 0.002); m.receiveShadow = false; return m; });
      // passarela quadriculada até o palco, com fileiras de lâmpadas
      const run = flat(new THREE.PlaneGeometry(8, 40), new THREE.MeshLambertMaterial({ map: TX.get('checker', 4, 20), color: 0xd8ccff }), 0.02); run.position.z = 41;
      const stair = add(new THREE.Mesh(GEO.rbox(8.4, 0.36, 1.6, 0.1), stageM)); stair.position.set(0, 0.18, 22.4); stair.receiveShadow = true;
      // ---- colunas do pódio ----
      this.cols = PILLARS.map((P, i) => {
        const grp = add(new THREE.Group()); grp.position.set(P.x, 0, 0);
        const metal = Toon.mat({ color: P.metal }, { gloss: 0.88, rim: 0, sat: 0, key: 'pdCol' + i, metal: 0.75 });
        const dark = Toon.mat({ color: 0x1a1236 }, { gloss: 0.6, rim: 0, sat: 0, key: 'pdColD' });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(PR, PR, P.h, 8), metal); body.rotation.y = Math.PI / 8; body.position.y = P.h / 2; body.castShadow = body.receiveShadow = true; grp.add(body);
        const capH = 0.4, cap = new THREE.Mesh(new THREE.CylinderGeometry(PR + 0.28, PR + 0.18, capH, 8), dark); cap.rotation.y = Math.PI / 8; cap.position.y = P.h + capH / 2 - 0.02; cap.castShadow = cap.receiveShadow = true; grp.add(cap);
        // faixas de neon (topo e base)
        const neonM = basic({ color: P.neon });
        [P.h + 0.02, 0.5].forEach(y => { const b = new THREE.Mesh(new THREE.CylinderGeometry(PR + 0.06, PR + 0.06, 0.16, 8, 1, true), neonM); b.rotation.y = Math.PI / 8; b.position.y = y; grp.add(b); });
        // placa com o número na face da frente (a face plana fica virada para +z)
        const ap = PR * Math.cos(Math.PI / 8), ps = Math.min(2.5, P.h * 0.52 + 0.4);
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(ps, ps), basic({ map: plateTex(i + 1, P.plate[0], P.plate[1]), transparent: true, alphaTest: 0.05 }));
        plate.position.set(0, P.h * 0.5 + 0.05, ap + 0.03); grp.add(plate);
        // anel no chão onde a coluna vai sair (acende antes) e feixe de holofote vindo de cima
        const hatch = flat(new THREE.RingGeometry(PR + 0.3, PR + 0.75, 48), basic({ color: P.neon, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), STAGE + 0.02); hatch.position.x = P.x; hatch.receiveShadow = false;
        const beam = add(new THREE.Mesh(new THREE.ConeGeometry(PR + 0.9, 34, 28, 1, true).translate(0, -17, 0),
          basic({ color: P.beam, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
        beam.position.set(P.x, STAGE + P.h + 34.2, 0);
        const pool = flat(new THREE.CircleGeometry(PR + 0.5, 40), basic({ map: Fx.glowTex(), color: P.beam, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), 0); pool.receiveShadow = false; grp.add(pool); pool.position.set(0, P.h + capH + 0.01, 0); pool.rotation.x = -Math.PI / 2;
        // etiqueta com o nome (preenchida em start)
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false })); label.visible = false; sc.add(label);
        return { grp, h: P.h, top: STAGE + P.h + capH, x: P.x, hatch, beam, pool, label, P };
      });

      // ---- arco de lâmpadas + telão ----
      const archM = Toon.mat({ color: 0x2a2250 }, { gloss: 0.7, rim: 0, sat: 0, key: 'pdArch', metal: 0.4 });
      const arch = add(new THREE.Mesh(new THREE.TorusGeometry(15.5, 0.75, 14, 80, Math.PI), archM)); arch.position.set(0, STAGE, -12); arch.castShadow = true;
      [-1, 1].forEach(s => { const f = add(new THREE.Mesh(GEO.rbox(2.6, 1.2, 2.6, 0.2), archM)); f.position.set(s * 15.5, STAGE + 0.6, -12); });
      const BN = 70; this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 10, 8), basic({ color: 0xffffff }), BN); this.bulbN = BN;
      for (let i = 0; i < BN; i++) { const a = Math.PI * (i + 0.5) / BN; d.position.set(Math.cos(a) * 15.5, STAGE + Math.sin(a) * 15.5, -12 + 0.72); d.scale.setScalar(1); d.rotation.set(0, 0, 0); d.updateMatrix(); this.bulbs.setMatrixAt(i, d.matrix); this.bulbs.setColorAt(i, this._c.set(0xffe08a)); }
      this.bulbs.instanceMatrix.needsUpdate = true; this.bulbs.frustumCulled = false; sc.add(this.bulbs);
      this.screenC = TX.cvs(1024, 400); drawScreen(this.screenC, '???', '#fff'); this.screenT = canvasTex(this.screenC);
      const frame = add(new THREE.Mesh(GEO.rbox(19.6, 8.4, 0.6, 0.3), archM)); frame.position.set(0, STAGE + 8.4, -12.4);
      this.screen = add(new THREE.Mesh(new THREE.PlaneGeometry(18.6, 7.4), basic({ map: this.screenT }))); this.screen.position.set(0, STAGE + 8.4, -12.05);
      this.scan = add(new THREE.Mesh(new THREE.PlaneGeometry(18.6, 7.4), basic({ map: scanTex(), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })));
      this.scan.position.set(0, STAGE + 8.4, -12.0); this.scan.material.map.repeat.set(1, 1.2);

      // ---- torres laterais com neon vertical e lançadores de labareda ----
      const towerM = Toon.mat({ color: 0x2a2250 }, { gloss: 0.6, rim: 0, sat: 0, key: 'pdTower', metal: 0.3 });
      this.towers = [-1, 1].map(s => {
        const x = s * 24, z = -6;
        const t = add(new THREE.Mesh(GEO.rbox(2.4, 15, 2.4, 0.25), towerM)); t.position.set(x, 7.5, z); t.castShadow = true;
        const top = add(new THREE.Mesh(GEO.rbox(3.4, 1.2, 3.4, 0.3), towerM)); top.position.set(x, 15.4, z);
        const strip = add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 13), basic({ color: 0xff4d9a }))); strip.position.set(x, 7.5, z + 1.22);
        const spk = add(new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), basic({ color: 0x120c28 }))); spk.position.set(x, 12.6, z + 1.23);
        return { x, y: 16.1, z, strip };
      });
      this.flames = []; const fT = Fx.glowTex();
      for (let i = 0; i < 70; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fT, color: 0xff8a2a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false })); s.visible = false; sc.add(s); this.flames.push({ s, v: V(0, 0, 0), l: 0, L: 1 }); }
      this.flI = 0;

      // ---- holofotes varrendo o céu ----
      this.search = [[-14, -24], [14, -24], [-32, -12], [32, -12]].map(([x, z], i) => {
        const m = add(new THREE.Mesh(new THREE.ConeGeometry(2.4, 70, 20, 1, true).translate(0, -35, 0).rotateX(Math.PI),
          basic({ color: i % 2 ? 0xc9b8ff : 0xfff0c8, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
        m.position.set(x, 0.5, z); return { m, ph: i * 1.7, s: x > 0 ? 1 : -1 };
      });

      // ---- arquibancadas com torcida e bastões de luz ----
      const standM = new THREE.MeshLambertMaterial({ color: 0x4a3a8a }), seatM = new THREE.MeshLambertMaterial({ color: 0x6a4ab8 });
      const crowdPos = [];
      for (let sct = 0; sct < 7; sct++) { const a = -Math.PI * 0.86 + sct * Math.PI * 0.287, cx = Math.sin(a) * 60, cz = -Math.cos(a) * 60 * 0.8 + 6;
        if (cz > 20) continue;
        const grp = new THREE.Group(); grp.position.set(cx, 0, cz); grp.rotation.y = -a; sc.add(grp);
        for (let rw = 0; rw < 4; rw++) { const st = new THREE.Mesh(GEO.rbox(20, 1.4 + rw * 1.4, 2.4, 0.15, 2), rw % 2 ? seatM : standM); st.position.set(0, (1.4 + rw * 1.4) / 2, -rw * 2.4); st.receiveShadow = true; grp.add(st);
          for (let k = 0; k < 13; k++) crowdPos.push({ grp, x: -9 + k * 1.5 + (rw % 2) * 0.7, y: 1.4 + rw * 1.4, z: -rw * 2.4 }); } }
      const CN = crowdPos.length;
      this.crowdBody = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.5, 1.1, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), CN);
      this.crowdHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), CN);
      this.sticks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.9, 0.14).translate(0, 0.45, 0), basic({ color: 0xffffff }), CN);
      const shirts = [0xff4a4a, 0xffd21a, 0x2a8ae8, 0x2cb84a, 0xffffff, 0xff7ab8, 0x8a3ae0, 0xff8a00], skins = CFG.SKIN_TONES, neons = [0x3dd6ff, 0xff4d9a, 0xffd23f, 0x2ee6a8, 0xb98cff], wp = V(0, 0, 0);
      this.crowd = crowdPos.map((c, i) => { c.grp.updateMatrixWorld(true); wp.set(c.x, c.y, c.z).applyMatrix4(c.grp.matrixWorld);
        this.crowdBody.setColorAt(i, this._c.set(shirts[i % shirts.length])); this.crowdHead.setColorAt(i, this._c.set(skins[(i * 7) % skins.length])); this.sticks.setColorAt(i, this._c.set(neons[(i * 3) % neons.length]));
        return { x: wp.x, y: wp.y, z: wp.z, ph: i * 1.7, stick: i % 3 !== 1 }; });
      [this.crowdBody, this.crowdHead, this.sticks].forEach(m => { m.instanceColor.needsUpdate = true; m.frustumCulled = false; sc.add(m); });

      // ---- vagas do 4º ao 8º (anel de luz + número no chão) ----
      this.pads = PARK.map(([x, z]) => {
        const ring = flat(new THREE.RingGeometry(2.3, 2.55, 40), basic({ color: 0xb98cff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }), STAGE + 0.018); ring.position.x = x; ring.position.z = z; ring.receiveShadow = false;
        const num = flat(new THREE.PlaneGeometry(1.5, 1.5), basic({ transparent: true, opacity: 0, depthWrite: false }), STAGE + 0.02); num.position.set(x, STAGE + 0.02, z + 2.95); num.receiveShadow = false;
        return { ring, num };
      });

      // ---- confete (instanciado): chuva contínua + rajadas dos canhões ----
      const CFN = 520; this.conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.34, 0.22), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CFN); this.confData = [];
      const ccol = [0xff3a3a, 0xffd21a, 0x3aa8ff, 0x3ee05a, 0xff7ae0, 0xffffff, 0xffc21a];
      for (let i = 0; i < CFN; i++) { this.confData.push({ p: V(0, -10, 0), v: V(0, 0, 0), rx: r() * 6, ry: r() * 6, wr: 2 + r() * 4, on: false }); this.conf.setColorAt(i, this._c.set(ccol[i % ccol.length])); }
      this.conf.instanceColor.needsUpdate = true; this.conf.frustumCulled = false; sc.add(this.conf);
      // ---- fogos ----
      this.fw = []; for (let i = 0; i < 160; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false })); s.scale.setScalar(1.6); s.visible = false; sc.add(s); this.fw.push({ s, v: V(0, 0, 0), l: 0 }); }
      this.fwI = 0;
      // ---- troféu, brilho, feixe dourado e faíscas em volta ----
      this.trophy = makeTrophy(); Toon.outline(this.trophy, 0.045); this.trophy.visible = false; sc.add(this.trophy);
      this.tGlow = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: 0xffe08a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false }))); this.tGlow.scale.setScalar(10);
      this.tBeam = add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 40, 24, 1, true).translate(0, 20, 0), basic({ color: 0xffe08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
      this.sparks = []; for (let i = 0; i < 14; i++) { const s = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: i % 2 ? 0xffffff : 0xffd86b, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false }))); this.sparks.push({ s, a: i / 14 * Math.PI * 2, r: 2.2 + (i % 3) * 0.6, y: (i % 5) * 0.8, sp: 0.8 + (i % 4) * 0.25 }); }
    },

    // results: [{name, color, spec, player}] em ordem de classificação (até 8)
    start(results) {
      this.build(); this.stop();
      const n = results.length;
      this.karts = results.map((res, i) => {
        const m = res.model || buildKartModel(res.spec || res.color, {}); m.group.scale.setScalar(0.8);
        let x, z, y, ry;
        if (i < 3) { const c = this.cols[i]; x = c.x; z = 0.3; y = c.top; ry = i === 0 ? 0 : (i === 1 ? 0.28 : -0.28); }
        else { const p = PARK[(i - 3) % PARK.length]; x = p[0]; z = p[1]; y = STAGE + 0.04; ry = p[2]; }
        m.group.position.set(x, i < 3 ? -20 : y + 7, z); m.group.rotation.set(0, ry, 0); m.group.visible = i >= 3; this.scene.add(m.group);
        return { m, x, z, floorY: y, ry, vy: 0, landed: i < 3, landT: 0, delay: i < 3 ? R[i] : 0.15 + (n - 1 - i) * 0.16, place: i, name: res.name, color: res.color };
      });
      // etiquetas, telão e placas das vagas
      this.cols.forEach((c, i) => { const k = this.karts[i]; c.label.visible = false;
        if (c.label.material.map) c.label.material.map.dispose();
        c.label.material.map = k ? labelTex(k.m && k.name ? k.name : '', i, k.color) : null; c.label.material.opacity = 0; c.label.material.needsUpdate = true;
        c.grp.position.y = -(c.h + 1.2); c.hatch.material.opacity = 0; c.beam.material.opacity = 0; c.pool.material.opacity = 0; c.used = !!k; });
      const win = results[0] || { name: '', color: '#fff' }; this.win = win; drawScreen(this.screenC, '', '', true); this.screenT.needsUpdate = true;
      this.pads.forEach((p, j) => { const used = j + 3 < n; p.ring.visible = p.num.visible = used; p.ring.material.opacity = 0; p.num.material.opacity = 0;
        if (used) { if (p.num.material.map) p.num.material.map.dispose(); p.num.material.map = spotTex(j + 4); p.num.material.needsUpdate = true; } });
      this.t = 0; this.allT = null; this.revealed = [false, false, false]; this.drumT = 0; this.vo = 0;
      this.trophy.visible = false; this.tGlow.material.opacity = 0; this.tBeam.material.opacity = 0; this.spot.intensity = 0;
      this.sparks.forEach(s => s.s.material.opacity = 0);
      this.confData.forEach(c => { c.on = false; c.p.set(0, -10, 0); });
      this.fw.forEach(p => { p.l = 0; p.s.visible = false; });
      this.flames.forEach(f => { f.l = 0; f.s.visible = false; });
      this.fwT = 0; this.rainT = 0; this.flameT = 0; this._free = null;
      // câmera começa alta, atrás da passarela
      this._pos.set(0, 34, 70); this._look.set(0, 4, 0); this.camera.position.copy(this._pos);
      const ui = document.getElementById('podiumUI'); if (ui) ui.classList.remove('show');
    },
    stop() { if (this.karts) this.karts.forEach(k => { this.scene.remove(k.m.group); k.m.dispose(); }); this.karts = null; const ui = document.getElementById('podiumUI'); if (ui) ui.classList.remove('show'); },

    // rajada de confete a partir de (x,y,z)
    burst(x, y, z, n, dx, dz) {
      for (let k = 0, i = 0; i < this.confData.length && k < n; i++) { const c = this.confData[i]; if (c.on) continue;
        c.on = true; c.p.set(x, y, z); c.v.set(dx * (3 + Math.random() * 7) + (Math.random() - 0.5) * 3, 11 + Math.random() * 10, (dz || 0.3) * (2 + Math.random() * 5)); k++; }
    },
    flameBurst(tw, n) {
      for (let k = 0; k < n; k++) { const f = this.flames[this.flI = (this.flI + 1) % this.flames.length];
        f.s.position.set(tw.x + (Math.random() - 0.5) * 0.6, tw.y, tw.z + (Math.random() - 0.5) * 0.6); f.v.set((Math.random() - 0.5) * 2, 16 + Math.random() * 9, (Math.random() - 0.5) * 2);
        f.L = f.l = 0.55 + Math.random() * 0.35; f.s.visible = true; }
    },

    step(dt) {
      if (!this.karts) return; this.t += dt; const t = this.t, d = this._d, c = this._c;
      // ---- colunas subindo (3º, 2º, 1º) ----
      this.cols.forEach((col, i) => {
        if (!col.used) { col.grp.position.y = -(col.h + 1.2); return; }
        const t0 = R[i], pre = cl((t - (t0 - 0.6)) / 0.6), e = easeBack((t - t0) / RISE);
        col.grp.position.y = -(col.h + 1.2) * (1 - e);
        col.hatch.material.opacity = (t < t0 + RISE ? pre : Math.max(0, 1 - (t - t0 - RISE) * 1.5)) * (0.65 + 0.35 * Math.sin(t * 18));
        const lit = cl((t - t0 - 0.15) / 0.5);
        col.beam.material.opacity = lit * (i === 0 ? 0.2 : 0.14) * (0.9 + 0.1 * Math.sin(t * 3 + i));
        col.pool.material.opacity = lit * 0.55;
        if (!this.revealed[i] && t >= t0) { this.revealed[i] = true; sfx('trickLand'); if (i === 0) sfx('finalLap'); }
        // etiqueta com o nome: aparece com um "pop" depois que a coluna para
        const lp = easeBack((t - t0 - RISE + 0.1) / 0.45), k = this.karts[i];
        if (k) { col.label.visible = lp > 0.01; col.label.material.opacity = cl(lp * 1.5); col.label.scale.set(6.4 * lp, 1.6 * lp, 1); col.label.position.set(col.x, col.top + col.grp.position.y + (i === 0 ? 7.6 : 3.9) + Math.sin(t * 2 + i) * 0.12, i === 0 ? -1.2 : 0.3); }
      });
      // rufar antes do 1º: o palco escurece um pouco
      if (t > R[0] - 1.4 && t < R[0]) { this.drumT -= dt; if (this.drumT <= 0) { this.drumT = 0.11; sfx('tone', 150, 120, 0.05, 'sine', 0.06); } }
      const dim = t > R[0] - 1.4 && t < R[0] + 0.3 ? 0.55 : 1;
      this.hemi.intensity += (0.72 * dim - this.hemi.intensity) * Math.min(1, dt * 4); this.key.intensity += (0.95 * dim - this.key.intensity) * Math.min(1, dt * 4);
      // ---- karts ----
      this.karts.forEach(k => {
        const g = k.m.group;
        if (k.place < 3) { const col = this.cols[k.place]; g.visible = t >= R[k.place] - 0.05; g.position.y = col.top + col.grp.position.y; }
        else if (t >= k.delay && !k.landed) { k.vy -= 42 * dt; g.position.y += k.vy * dt;
          if (g.position.y <= k.floorY) { g.position.y = k.floorY; k.vy = -k.vy * 0.3; if (Math.abs(k.vy) < 2.2) { k.landed = true; k.vy = 0; k.landT = t; } } }
        if (k.place === 0 && this.allT !== null) { const j = Math.max(0, Math.sin((t - this.allT) * 5)); g.position.y += j * 0.7; g.rotation.y = Math.sin(t * 2.4) * 0.4; }
        else { g.rotation.y += (k.ry - g.rotation.y) * Math.min(1, dt * 3); const sq = k.place >= 3 && k.landed ? Math.max(0, 1 - (t - k.landT) * 4) : 0; k.m.body.scale.set(1 + sq * 0.15, 1 - sq * 0.2, 1 + sq * 0.1); }
        const cele = k.place === 0 && this.allT !== null;
        k.m.animate(dt, cele ? { steer: Math.sin(t * 6) * 0.8, speed: 0.6, boost: true } : { steer: Math.sin(t * 1.2 + k.place) * (k.place < 3 ? 0.25 : 0.12), speed: 0 });
      });
      // vagas do 4º ao 8º: acendem quando o kart pousa
      this.pads.forEach((p, j) => { const k = this.karts[j + 3]; if (!k) return; const v = k.landed ? cl((t - k.landT) / 0.4) : 0;
        p.ring.material.opacity = v * (0.45 + 0.2 * Math.sin(t * 3 + j)); p.num.material.opacity = v; });
      // ---- clímax: 1º no lugar ----
      if (this.allT === null && t >= R[0] + RISE * 0.85 && this.karts.every(k => k.landed)) { this.allT = t; this.trophy.visible = true; sfx('fanfare');
        this.burst(-21, 3, 4, 110, 1, 0.4); this.burst(21, 3, 4, 110, -1, 0.4);
        this.towers.forEach(tw => this.flameBurst(tw, 24)); this.flameT = 0.45;
        drawScreen(this.screenC, this.win.player ? 'Você' : (this.win.name || ''), this.win.color); this.screenT.needsUpdate = true;
        const ui = document.getElementById('podiumUI'); if (ui) ui.classList.add('show'); }
      const at = this.allT !== null ? t - this.allT : -1;
      // troféu desce do céu num feixe dourado e fica girando acima do vencedor
      if (at >= 0) { const top = this.cols[0].top, e = easeOut(at / 1.7);
        this.trophy.position.set(0, top + 2.6 + (1 - e) * 16 + Math.sin(t * 2) * 0.18 * e, -1.4); this.trophy.scale.setScalar(0.62); this.trophy.rotation.y = t * 1.2;
        this.tGlow.position.set(0, this.trophy.position.y + 2.2, -1.6); this.tGlow.material.opacity = (0.5 + 0.12 * Math.sin(t * 6)) * e;
        this.tBeam.position.set(0, this.trophy.position.y, -1.4); this.tBeam.material.opacity = 0.22 * Math.max(0, 1 - at / 2.6);
        this.spot.intensity = 1.2 * e; this.spot.position.set(0, 34, 10); this.spot.target.position.set(0, top, 0);
        this.sparks.forEach((s, i) => { const a = s.a + t * s.sp; s.s.position.set(Math.cos(a) * s.r, this.trophy.position.y + 0.6 + s.y + Math.sin(t * 3 + i) * 0.3, -1.4 + Math.sin(a) * s.r);
          const tw = 0.5 + 0.5 * Math.sin(t * 7 + i * 2.3); s.s.material.opacity = e * tw; s.s.scale.setScalar(0.4 + tw * 0.5); });
        // labaredas periódicas
        this.flameT -= dt; if (this.flameT <= 0) { this.flameT = at < 1.5 ? 0.35 : 2.6 + Math.random() * 1.5; this.towers.forEach(tw => this.flameBurst(tw, at < 1.5 ? 16 : 22)); if (at > 1.5) sfx('noise', 0.4, 300, 120, 0.05); } }
      this.flames.forEach(f => { if (f.l <= 0) return; f.l -= dt; if (f.l <= 0) { f.s.visible = false; return; }
        const k = f.l / f.L; f.v.multiplyScalar(1 - dt * 2.2); f.s.position.addScaledVector(f.v, dt);
        f.s.material.color.setHSL(0.02 + 0.1 * k, 1, 0.45 + 0.25 * k); f.s.material.opacity = Math.min(1, k * 1.6); f.s.scale.setScalar(1.2 + (1 - k) * 2.6); });
      // ---- confete ----
      if (at >= 0) { this.rainT -= dt; if (this.rainT <= 0) { this.rainT = 0.04;
        for (let i = 0; i < this.confData.length; i++) { const cf = this.confData[i]; if (!cf.on) { cf.on = true; cf.p.set((Math.random() - 0.5) * 38, 24 + Math.random() * 6, (Math.random() - 0.5) * 20); cf.v.set(0, -2, 0); break; } } } }
      for (let i = 0; i < this.confData.length; i++) { const cf = this.confData[i];
        if (cf.on) { cf.v.y = Math.max(-2.6, cf.v.y - 14 * dt); cf.v.x *= 1 - dt * 1.2; cf.v.z *= 1 - dt * 1.2; cf.p.addScaledVector(cf.v, dt); cf.p.x += Math.sin(t * cf.wr + i) * dt * 0.8; cf.rx += dt * cf.wr; cf.ry += dt * 2;
          if (cf.p.y < 0.1) { cf.on = false; cf.p.y = -10; } }
        d.position.copy(cf.p); d.rotation.set(cf.rx, cf.ry, 0); d.scale.setScalar(1); d.updateMatrix(); this.conf.setMatrixAt(i, d.matrix); }
      this.conf.instanceMatrix.needsUpdate = true;
      // ---- torcida pulando e balançando os bastões ----
      const hype = at >= 0 ? 0.75 : 0.22 + (t > R[0] - 1.4 ? 0.2 : 0);
      d.scale.setScalar(1);
      for (let i = 0; i < this.crowd.length; i++) { const cw = this.crowd[i], j = Math.max(0, Math.sin(t * 7 + cw.ph)) * hype;
        d.rotation.set(0, 0, 0); d.position.set(cw.x, cw.y + 0.55 + j, cw.z); d.updateMatrix(); this.crowdBody.setMatrixAt(i, d.matrix);
        d.position.y += 0.95; d.updateMatrix(); this.crowdHead.setMatrixAt(i, d.matrix);
        if (cw.stick) { d.position.set(cw.x + 0.45, cw.y + 1.7 + j, cw.z); d.rotation.set(0, 0, Math.sin(t * 4 + cw.ph) * 0.7); } else d.position.set(0, -50, 0);
        d.updateMatrix(); this.sticks.setMatrixAt(i, d.matrix); }
      this.crowdBody.instanceMatrix.needsUpdate = this.crowdHead.instanceMatrix.needsUpdate = this.sticks.instanceMatrix.needsUpdate = true;
      // ---- neon, lâmpadas, telão, holofotes ----
      this.edge.material.color.setHSL((t * 0.08) % 1, 0.9, 0.6);
      this.rings.forEach((m, i) => { const w = (t * 0.7 - i * 0.33) % 1; m.material.opacity = 0.12 + 0.5 * Math.pow(1 - Math.abs(w - 0.5) * 2, 3) * (at >= 0 ? 1.4 : 1); });
      const chase = at >= 0 ? 14 : 6;
      for (let i = 0; i < this.bulbN; i++) { const on = ((i + Math.floor(t * chase)) % 4) === 0;
        if (at >= 0) c.setHSL(((i / this.bulbN) + t * 0.25) % 1, 0.9, on ? 0.75 : 0.42); else c.set(on ? 0xfff2c0 : 0x8a6a3a);
        this.bulbs.setColorAt(i, c); }
      this.bulbs.instanceColor.needsUpdate = true;
      this.scan.material.map.offset.y = -t * 0.35;
      this.screen.material.color.setScalar(at >= 0 ? 0.92 + 0.08 * Math.sin(t * 8) : (t < R[0] ? 0.55 : 1));
      this.towers.forEach((tw, i) => tw.strip.material.color.setHSL(((t * 0.15) + i * 0.5) % 1, 0.9, 0.6));
      this.search.forEach(b => b.m.rotation.set(Math.sin(t * 0.6 + b.ph) * 0.4 - 0.15, 0, b.s * (0.25 + Math.sin(t * 0.45 + b.ph) * 0.3)));
      this.stars.material.opacity = 0.7 + 0.15 * Math.sin(t * 1.3);
      // ---- fogos ----
      this.fwT -= dt;
      if (at >= 0 && this.fwT <= 0) { this.fwT = 0.45 + Math.random() * 0.5; const fc = c.setHSL(Math.random(), 1, 0.62), ox = (Math.random() - 0.5) * 70, oy = 28 + Math.random() * 16, oz = -28 - Math.random() * 28;
        for (let n = 0; n < 40; n++) { const p = this.fw[this.fwI = (this.fwI + 1) % this.fw.length]; p.s.position.set(ox, oy, oz); p.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(9 + Math.random() * 5); p.l = 1.5; p.s.visible = true; p.s.material.color.copy(fc); }
        sfx('noise', 0.5, 2000, 200, 0.06); }
      this.fw.forEach(p => { if (p.l <= 0) return; p.l -= dt; if (p.l <= 0) { p.s.visible = false; return; } p.v.y -= 6 * dt; p.v.multiplyScalar(1 - dt * 0.8); p.s.position.addScaledVector(p.v, dt); p.s.material.opacity = p.l / 1.5; });

      // ---- câmera de transmissão ----
      // Antes do clímax a câmera vai de coluna em coluna em tela cheia. Depois abre o plano final: o placar ocupa a
      // lateral direita (telas largas) ou a parte de baixo (retrato); medimos a área LIVRE da tela a cada 0,5 s,
      // calculamos a distância para o pódio + troféu caberem nela e deslocamos o centro óptico (setViewOffset).
      const cam = this.camera, W = innerWidth, H = innerHeight, tv = Math.tan(cam.fov * Math.PI / 360);
      const narrow = W / H < 1.1, back = narrow ? 1.5 : 1;   // em retrato a câmera fica mais longe nos planos fechados
      const shot = (i) => { const col = this.cols[i], y = col.top + col.grp.position.y; 
        this._posT.set(col.x * 0.35, y + 2, 12.5 * back); this._lookT.set(col.x, y + 1.1, 0); };
      let final = false;
      if (t < R[2] - 0.3) { const k = sm(t / (R[2] - 0.3)); this._posT.set(0, 30 - 22 * k, 70 - 46 * k); this._lookT.set(0, 4, 0); }
      else if (t < R[1] - 0.2) shot(2);
      else if (t < R[0] - 1.4) shot(1);
      else if (t < R[0] - 0.1) { this._posT.set(0, 11, 31 * back); this._lookT.set(0, 4, 0); }   // suspense: vista do palco inteiro
      else if (at < 0 || at < 1.9) { const col = this.cols[0], y = col.top + col.grp.position.y; this._posT.set(0, y - 1.2, 15 * back); this._lookT.set(0, y + 2.6, 0); }   // contra-plongée do vencedor
      else final = true;
      if (final) {
        this._fT = (this._fT || 0) - dt;
        if (this._fT <= 0 || !this._free) { this._fT = 0.5; const card = document.querySelector('#podiumUI .card'), rc = card && card.offsetParent ? card.getBoundingClientRect() : null;
          if (rc && rc.width > 0 && rc.left > W * 0.4) this._free = [0, 0, Math.max(200, rc.left - 12), H];
          else if (rc && rc.height > 0) this._free = [0, 0, W, Math.max(160, rc.top - 8)];
          else this._free = [0, 0, W, H]; }
        const [fx, fy, fw, fh] = this._free, top = this.cols[0].top + 8.6, hc = top / 2 + 0.4, wc = 18.5;
        const D = Math.max(hc * H / (fh * tv), wc * W / (fw * tv * cam.aspect)) * 0.98 + 1.5;
        const a = 0.16 * Math.sin((t - this.allT) * 0.2);
        this._posT.set(Math.sin(a) * D, hc + 4.2, 4 + Math.cos(a) * D); this._lookT.set(0, hc + 0.4, 1.5);
        this.vo += (1 - this.vo) * Math.min(1, dt * 2);
        cam.setViewOffset(W, H, (W / 2 - (fx + fw / 2)) * this.vo, (H / 2 - (fy + fh / 2)) * this.vo, W, H);
      } else { this.vo = 0; cam.setViewOffset(W, H, 0, 0, W, H); }
      const kp = 1 - Math.exp(-dt * (final ? 1.8 : 2.6));
      this._pos.lerp(this._posT, kp); this._look.lerp(this._lookT, 1 - Math.exp(-dt * 3.2));
      // tremidinha de câmera na mão nos planos fechados
      cam.position.set(this._pos.x + Math.sin(t * 1.3) * 0.08, this._pos.y + Math.sin(t * 1.7) * 0.06, this._pos.z); cam.lookAt(this._look);
      this.sky.position.copy(cam.position);
    },
    resize() { if (this.camera) { this.camera.aspect = innerWidth / innerHeight; this._free = null; this.camera.updateProjectionMatrix(); } },
    // pré-compila os shaders da cena (chamado no carregamento): a 1ª exibição não compila nada
    precompile(renderer) { if (this.scene) renderer.compile(this.scene, this.camera); }
  };
  window.Podium = Podium;
  window.makeTrophy = makeTrophy;
})();
