// =====================================================================================
// podium.js — cerimônia de premiação (estilo jogos de kart dos anos 90)
//
// Cena própria: pódio de três degraus num palco com tapete vermelho, pórtico com letreiro, arco de
// balões, refletores girando, arquibancadas com torcida instanciada, bandeiras, confete e fogos.
// Sequência: os karts do 8º ao 4º estacionam na praça, depois 3º, 2º e 1º caem do céu e quicam nos
// degraus; o troféu sobe girando acima do vencedor, os canhões de confete disparam e começam os fogos.
//
// Correções em relação à versão anterior:
//  * degraus sem faces coplanares (tampa, faixa e placa encaixadas com sobreposição de volume, nunca face
//    com face) -> fim do z-fighting; placa do número é uma caixa com material só na face da frente (UV 0..1);
//  * troféu com perfil de torno FECHADO (parede externa, borda, parede interna e fundo): antes só havia a
//    casca externa de face única e a taça parecia cortada; alças em meio-anel encaixadas na taça;
//  * pisos em alturas distintas + polygonOffset (grama, pista, praça, tapete);
//  * nada de alocação de objetos no laço (vetores e Object3D reaproveitados).
// =====================================================================================
(function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const easeOut = x => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

  // ---------- troféu ----------
  function makeTrophy() {
    const g = new THREE.Group();
    const gold = Toon.mat({ color: 0xffc21a, emissive: 0x3a2400 }, { gloss: 0.9, rim: 0.55, sat: 0, key: 'gold' });
    const dark = Toon.mat({ color: 0x3a2a4a }, { gloss: 0.3, rim: 0.2, sat: 0, key: 'plinth' });
    const plate = Toon.mat({ color: 0xffe9a0 }, { gloss: 0.6, rim: 0.2, sat: 0, key: 'plate' });
    // perfil fechado (raio, altura): base -> haste -> nó -> taça (fora) -> borda -> taça (dentro) -> fundo no eixo
    const prof = [[0, 0], [1.05, 0], [1.1, 0.08], [1.05, 0.22], [0.62, 0.38], [0.36, 0.62], [0.28, 0.95], [0.27, 1.25],
      [0.42, 1.38], [0.46, 1.5], [0.32, 1.62], [0.3, 1.78], [0.55, 1.92], [0.95, 2.2], [1.3, 2.7], [1.5, 3.3], [1.58, 3.78],
      [1.64, 3.9], [1.62, 3.98], [1.52, 3.98], [1.46, 3.8], [1.38, 3.3], [1.18, 2.8], [0.86, 2.4], [0.4, 2.18], [0, 2.14]]
      .map(p => new THREE.Vector2(p[0], p[1]));
    const cup = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), gold); cup.position.y = 1.2; g.add(cup);
    // alças: meio anel no plano XY, pontas encaixadas na parede da taça
    [-1, 1].forEach(s => { const h = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.12, 12, 28, Math.PI), gold);
      h.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2; h.position.set(s * 1.32, 1.2 + 3.05, 0); g.add(h); });
    // pedestal de dois andares com plaqueta dourada na frente
    const p1 = new THREE.Mesh(GEO.rbox(2.7, 0.7, 2.7, 0.18), dark); p1.position.y = 0.35; g.add(p1);
    const p2 = new THREE.Mesh(GEO.rbox(2.2, 0.62, 2.2, 0.16), dark); p2.position.y = 0.95; g.add(p2);
    const pl = new THREE.Mesh(GEO.rbox(1.5, 0.36, 0.12, 0.05), plate); pl.position.set(0, 0.35, 1.36); g.add(pl);
    // estrela na frente da taça
    const star = new THREE.Shape(); for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 0.2 : 0.46; k ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const st = new THREE.Mesh(new THREE.ExtrudeGeometry(star, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 }), Toon.mat({ color: 0xffffff }, { gloss: 0.8, rim: 0.3, sat: 0, key: 'star' }));
    st.position.set(0, 1.2 + 3.0, 1.42); st.rotation.x = -0.14; g.add(st);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    return g;
  }

  // ---------- texturas em canvas ----------
  function numberTex(n, col) {
    const c = TX.cvs(256, 256), g = c.getContext('2d');
    g.fillStyle = '#2a1d4a'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = col; g.beginPath(); g.arc(128, 128, 104, 0, 6.2832); g.fill();
    g.lineWidth = 12; g.strokeStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.arc(128, 128, 88, 0, 6.2832); g.stroke();
    g.font = '700 150px ' + CFG.FONT_DISPLAY; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 18; g.strokeStyle = '#2a1d4a'; g.strokeText(String(n), 128, 140); g.fillStyle = '#fff'; g.fillText(String(n), 128, 140);
    const t = new THREE.CanvasTexture(c); t.anisotropy = TX.aniso; return t;
  }
  function bannerTex(txt, from, to) {
    const c = TX.cvs(1024, 160), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 1024, 0);
    gr.addColorStop(0, from); gr.addColorStop(1, to); g.fillStyle = gr; g.fillRect(0, 0, 1024, 160);
    g.fillStyle = '#2a1d4a'; g.fillRect(0, 0, 1024, 14); g.fillRect(0, 146, 1024, 14);
    for (let x = 0; x < 1024; x += 28) { g.fillStyle = (x / 28) % 2 ? '#fff' : '#2a1d4a'; g.fillRect(x, 14, 28, 8); g.fillRect(x, 138, 28, 8); }
    g.font = '700 86px ' + CFG.FONT_DISPLAY; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 18; g.strokeStyle = '#2a1d4a'; g.strokeText(txt, 512, 84); g.fillStyle = '#fff'; g.fillText(txt, 512, 84);
    const t = new THREE.CanvasTexture(c); t.anisotropy = TX.aniso; return t;
  }

  // degraus: [x, altura, cor da tampa, cor da placa]
  const STEPS = [[0, 3.4, 0xffc21a, '#e8a010'], [-6.6, 2.3, 0xdfe3ef, '#8a90a8'], [6.6, 1.4, 0xe0915a, '#a8622e']];
  const BASE = 0.45;                                   // altura do palco
  // vagas dos karts que não subiram ao pódio (4º ao 8º): em leque na praça, de frente para a câmera
  const PARK = [[-12.5, 6.5, 0.45], [12.5, 6.5, -0.45], [-16.5, 9.5, 0.6], [16.5, 9.5, -0.6], [-20, 13, 0.75], [20, 13, -0.75], [0, 15, 0]];

  const Podium = {
    build() { if (!this.scene) Toon.during(() => this._build()); },
    _build() {
      const sc = this.scene = new THREE.Scene();
      sc.background = new THREE.Color(0x8fd8ff); sc.fog = new THREE.Fog(0xbfe8ff, 120, 330);
      this.camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 700);
      this._d = new THREE.Object3D(); this._c = new THREE.Color();
      // ---- luz: céu + sol principal (sombras nítidas só na área do palco) + contra-luz quente ----
      sc.add(new THREE.HemisphereLight(0xe8f4ff, 0x7aa05a, 0.62));
      const key = new THREE.DirectionalLight(0xfff2dc, 0.82); key.position.set(-18, 34, 30); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -24, right: 24, top: 22, bottom: -14, near: 5, far: 110 }); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.04;
      sc.add(key, key.target);
      // mesma composição de luzes da corrida (hemisférica + sol com sombra + 1 spot): os shaders dos karts já
      // compilados na corrida são reaproveitados -> a tela do pódio não trava ao entrar
      const spot = new THREE.SpotLight(0xffe2b0, 0, 60, 0.6, 0.5, 2); spot.position.set(0, 30, 20); sc.add(spot, spot.target);
      // ---- céu em degradê ----
      const skC = TX.cvs(4, 256), sg = skC.getContext('2d'), sgr = sg.createLinearGradient(0, 0, 0, 256);
      sgr.addColorStop(0, '#3a7dff'); sgr.addColorStop(0.45, '#8fd8ff'); sgr.addColorStop(0.6, '#d8f4ff'); sgr.addColorStop(1, '#d8f4ff'); sg.fillStyle = sgr; sg.fillRect(0, 0, 4, 256);
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 12), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(skC), side: THREE.BackSide, fog: false, depthWrite: false })); sc.add(this.sky);
      // ---- pisos em alturas diferentes (sem z-fighting) ----
      const flat = (geo, mat, y, po) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; if (po) { mat.polygonOffset = true; mat.polygonOffsetFactor = -po; mat.polygonOffsetUnits = -po * 2; } sc.add(m); return m; };
      flat(new THREE.CircleGeometry(320, 64), new THREE.MeshLambertMaterial({ map: TX.get('grass', 64, 64) }), 0);
      flat(new THREE.RingGeometry(34, 44, 96, 1), new THREE.MeshLambertMaterial({ map: TX.get('asphalt', 14, 1) }), 0.03, 1);
      flat(new THREE.RingGeometry(33.2, 34, 96, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), 0.035, 1);
      flat(new THREE.RingGeometry(44, 44.8, 96, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), 0.035, 1);
      flat(new THREE.CircleGeometry(33.2, 64), new THREE.MeshLambertMaterial({ map: TX.get('checker', 10, 10), color: 0xf2f2ff }), 0.06, 2);
      flat(new THREE.PlaneGeometry(7.6, 30), new THREE.MeshLambertMaterial({ color: 0xe0304a }), 0.1, 3).position.z = 18;   // tapete vermelho
      [-1, 1].forEach(s => flat(new THREE.PlaneGeometry(0.35, 30), new THREE.MeshLambertMaterial({ color: 0xffd23f }), 0.11, 4).position.set(s * 3.9, 0.11, 18));
      // ---- palco + degraus ----
      const stageM = new THREE.MeshLambertMaterial({ color: 0x5a4a9a }), bodyM = new THREE.MeshLambertMaterial({ color: 0xf4f2ff }), bandM = new THREE.MeshLambertMaterial({ color: 0x7a3cff });
      const stage = new THREE.Mesh(GEO.rbox(22, BASE + 0.2, 9, 0.2), stageM); stage.position.y = (BASE + 0.2) / 2 - 0.2; stage.castShadow = stage.receiveShadow = true; sc.add(stage);
      const stair = new THREE.Mesh(GEO.rbox(7.4, 0.25, 1.2, 0.08), stageM); stair.position.set(0, 0.12, 5.0); stair.receiveShadow = true; sc.add(stair);
      this.slots = STEPS.map(([x, h, capCol, plateCol], i) => {
        const W = 6.4, D = 6, top = BASE + h;
        const body = new THREE.Mesh(GEO.rbox(W, h + 0.1, D, 0.3), bodyM); body.position.set(x, BASE - 0.1 + (h + 0.1) / 2, 0); body.castShadow = body.receiveShadow = true; sc.add(body);
        // tampa colorida: começa 6 cm DENTRO do bloco (volume sobreposto, nenhuma face coincide)
        const cap = new THREE.Mesh(GEO.rbox(W + 0.3, 0.36, D + 0.3, 0.12), Toon.mat({ color: capCol }, { gloss: i === 0 ? 0.8 : 0.6, rim: 0.4, sat: 0, key: 'cap' + i }));
        cap.position.set(x, top - 0.06 + 0.18, 0); cap.castShadow = cap.receiveShadow = true; sc.add(cap);
        const band = new THREE.Mesh(GEO.rbox(W + 0.12, 0.34, D + 0.12, 0.08), bandM); band.position.set(x, BASE + Math.min(0.6, h * 0.3), 0); sc.add(band);
        // placa: caixa embutida 10 cm no bloco; textura só na face +z (UV 0..1, sem esticar)
        const side = new THREE.MeshLambertMaterial({ color: 0x2a1d4a }), face = new THREE.MeshLambertMaterial({ map: numberTex(i + 1, plateCol) });
        const ps = Math.min(2.6, h * 0.55 + 0.75), plate = new THREE.Mesh(new THREE.BoxGeometry(ps, ps, 0.3), [side, side, side, side, face, side]);
        plate.position.set(x, BASE + h * 0.5 + 0.12, D / 2 + 0.05); sc.add(plate);
        return { x, h, top: top + 0.3 };
      });
      // ---- pórtico do fundo: torres listradas + letreiro + refletores ----
      const towerM = new THREE.MeshLambertMaterial({ map: TX.get('tower', 2, 3) });
      [-15, 15].forEach(x => { const t = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.35, 17, 24), towerM); t.position.set(x, 8.5, -7); t.castShadow = true; sc.add(t);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 12), new THREE.MeshLambertMaterial({ color: 0xff4d6d })); cap.position.set(x, 17.4, -7); sc.add(cap); });
      const signSide = new THREE.MeshLambertMaterial({ color: 0x2a1d4a }), signFace = new THREE.MeshBasicMaterial({ map: bannerTex(CFG.GAME_NAME.toUpperCase(), '#ff4d9a', '#ffc93d') });
      const sign = new THREE.Mesh(new THREE.BoxGeometry(28, 4.4, 0.8), [signSide, signSide, signSide, signSide, signFace, signSide]); sign.position.set(0, 15.2, -7); sign.castShadow = true; sc.add(sign);
      // arco de balões atrás do pódio (instanciado)
      const BN = 46, balloons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.75, 12, 10), new THREE.MeshLambertMaterial({ color: 0xffffff }), BN), d = this._d;
      const bcol = [0xff4d6d, 0xffd23f, 0x3dd6ff, 0x8b5cf6, 0x2ee6a8, 0xffffff];
      for (let i = 0; i < BN; i++) { const a = Math.PI * i / (BN - 1), r = 12.2 + (i % 2) * 0.5; d.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.85, -4.2 - (i % 2) * 0.4); d.scale.set(1, 1.15, 1); d.updateMatrix(); balloons.setMatrixAt(i, d.matrix); balloons.setColorAt(i, this._c.set(bcol[i % bcol.length])); }
      balloons.instanceMatrix.needsUpdate = true; balloons.instanceColor.needsUpdate = true; sc.add(balloons);
      // feixes dos refletores (cones aditivos que varrem o céu)
      this.beams = [-1, 1].map(s => { const m = new THREE.Mesh(new THREE.ConeGeometry(2.6, 40, 20, 1, true).translate(0, -20, 0).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        m.position.set(s * 15, 18, -7); sc.add(m); return { m, s }; });
      // ---- arquibancadas em arco com torcida instanciada (corpo + cabeça) ----
      const standM = new THREE.MeshLambertMaterial({ color: 0x8a90c8 }), seatM = new THREE.MeshLambertMaterial({ color: 0xff7a3d });
      const crowdPos = [];
      for (let sct = 0; sct < 7; sct++) { const a = -Math.PI * 0.86 + sct * Math.PI * 0.287, cx = Math.sin(a) * 58, cz = -Math.cos(a) * 58 * 0.8 + 6;
        if (cz > 20) continue;
        const grp = new THREE.Group(); grp.position.set(cx, 0, cz); grp.rotation.y = -a; sc.add(grp);
        for (let r = 0; r < 4; r++) { const st = new THREE.Mesh(GEO.rbox(20, 1.4 + r * 1.4, 2.4, 0.15, 2), r % 2 ? seatM : standM); st.position.set(0, (1.4 + r * 1.4) / 2, -r * 2.4); st.receiveShadow = true; grp.add(st);
          for (let k = 0; k < 13; k++) crowdPos.push({ grp, x: -9 + k * 1.5 + (r % 2) * 0.7, y: 1.4 + r * 1.4, z: -r * 2.4 }); } }
      const CN = crowdPos.length;
      this.crowdBody = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.5, 1.1, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), CN);
      this.crowdHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), CN);
      const shirts = [0xff4a4a, 0xffd21a, 0x2a8ae8, 0x2cb84a, 0xffffff, 0xff7ab8, 0x8a3ae0, 0xff8a00], skins = CFG.SKIN_TONES, wp = V(0, 0, 0);
      this.crowd = crowdPos.map((c, i) => { c.grp.updateMatrixWorld(true); wp.set(c.x, c.y, c.z).applyMatrix4(c.grp.matrixWorld);
        this.crowdBody.setColorAt(i, this._c.set(shirts[i % shirts.length])); this.crowdHead.setColorAt(i, this._c.set(skins[(i * 7) % skins.length]));
        return { x: wp.x, y: wp.y, z: wp.z, ph: i * 1.7 }; });
      this.crowdBody.instanceColor.needsUpdate = this.crowdHead.instanceColor.needsUpdate = true;
      this.crowdBody.frustumCulled = this.crowdHead.frustumCulled = false; sc.add(this.crowdBody, this.crowdHead);
      // ---- bandeiras (MeshBasic: não precisam de normais recalculadas a cada quadro) ----
      this.flags = [];
      [[-22, 2], [-26, -4], [22, 2], [26, -4], [-9, -12], [9, -12]].forEach(([x, z], k) => {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 11, 8), new THREE.MeshLambertMaterial({ color: 0xe8e8f0 })); pole.position.set(x, 5.5, z); sc.add(pole);
        const fg = new THREE.PlaneGeometry(3.6, 2.3, 12, 6); fg.translate(1.8, 0, 0);
        const fl = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: k % 2 ? TX.get('checker') : null, color: k % 2 ? 0xffffff : [0xff4d6d, 0x3dd6ff, 0xffd23f][k % 3], side: THREE.DoubleSide }));
        fl.position.set(x, 9.6, z); fl.rotation.y = x > 0 ? Math.PI : 0; sc.add(fl); this.flags.push({ g: fg, base: fg.attributes.position.array.slice(), ph: k }); });
      // ---- árvores e morros em volta (instanciados) ----
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 6), new THREE.MeshLambertMaterial({ color: 0x9a6538 }), 90);
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), 90);
      let s = 9; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 90; i++) { const a = r() * Math.PI * 2, R = 78 + r() * 70, k = 0.9 + r() * 0.8, x = Math.cos(a) * R, z = Math.sin(a) * R;
        d.position.set(x, 1.5 * k, z); d.scale.setScalar(k); d.rotation.set(0, 0, 0); d.updateMatrix(); trunk.setMatrixAt(i, d.matrix);
        d.position.set(x, 4.4 * k, z); d.scale.set(k, k * 1.15, k); d.updateMatrix(); crown.setMatrixAt(i, d.matrix); crown.setColorAt(i, this._c.setHSL(0.26 + r() * 0.1, 0.6, 0.42 + r() * 0.14)); }
      trunk.instanceMatrix.needsUpdate = crown.instanceMatrix.needsUpdate = true; crown.instanceColor.needsUpdate = true; trunk.frustumCulled = crown.frustumCulled = false; sc.add(trunk, crown);
      const hills = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0x6fcf5a }), 14);
      for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, R = 230 + r() * 50; d.position.set(Math.cos(a) * R, -10, Math.sin(a) * R); d.scale.set(60 + r() * 40, 30 + r() * 25, 60 + r() * 40); d.updateMatrix(); hills.setMatrixAt(i, d.matrix); }
      hills.instanceMatrix.needsUpdate = true; hills.frustumCulled = false; sc.add(hills);
      // ---- confete (instanciado): chuva contínua + rajadas dos canhões ----
      const CFN = 420; this.conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.34, 0.22), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CFN); this.confData = [];
      const ccol = [0xff3a3a, 0xffd21a, 0x3aa8ff, 0x3ee05a, 0xff7ae0, 0xffffff];
      for (let i = 0; i < CFN; i++) { this.confData.push({ p: V(0, -10, 0), v: V(0, 0, 0), rx: r() * 6, ry: r() * 6, wr: 2 + r() * 4, on: false }); this.conf.setColorAt(i, this._c.set(ccol[i % ccol.length])); }
      this.conf.instanceColor.needsUpdate = true; this.conf.frustumCulled = false; sc.add(this.conf);
      // ---- fogos ----
      this.fw = []; for (let i = 0; i < 120; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false })); sp.scale.setScalar(1.5); sp.visible = false; sc.add(sp); this.fw.push({ s: sp, v: V(0, 0, 0), l: 0 }); }
      this.fwI = 0;
      // ---- troféu + brilho ----
      this.trophy = makeTrophy(); Toon.outline(this.trophy, 0.045); this.trophy.visible = false; sc.add(this.trophy);
      this.tGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: 0xffe08a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); this.tGlow.scale.setScalar(9); sc.add(this.tGlow);
    },

    // results: [{name, color, spec, player}] em ordem de classificação (até 8)
    start(results) {
      this.build(); this.stop();
      const n = results.length;
      this.karts = results.map((res, i) => {
        const m = res.model || buildKartModel(res.spec || res.color, {}); m.group.scale.setScalar(0.8);
        let x, z, y, ry;
        if (i < 3) { const s = this.slots[i]; x = s.x; z = 0.4; y = s.top; ry = i === 0 ? 0 : (i === 1 ? 0.22 : -0.22); }
        else { const p = PARK[(i - 3) % PARK.length]; x = p[0]; z = p[1]; y = 0.06; ry = p[2]; }
        m.group.position.set(x, y + 26 + i * 2, z); m.group.rotation.set(0, ry, 0); this.scene.add(m.group);
        // ordem de chegada: do último ao primeiro (o vencedor por último, para o clímax)
        return { m, x, z, floorY: y, ry, vy: 0, landed: false, landT: 0, delay: i < 3 ? 0.3 + (n - 3) * 0.22 + 0.6 + (2 - i) * 0.7 : 0.3 + (n - 1 - i) * 0.22, place: i };
      });
      this.t = 0; this.allT = null; this.trophy.visible = false; this.tGlow.material.opacity = 0;
      this.confData.forEach(c => { c.on = false; c.p.set(0, -10, 0); });
      this.fw.forEach(p => { p.l = 0; p.s.visible = false; });
      this.fwT = 0; this.rainT = 0;
    },
    stop() { if (this.karts) this.karts.forEach(k => { this.scene.remove(k.m.group); k.m.dispose(); }); this.karts = null; },

    // rajada de confete a partir de (x,y,z)
    burst(x, y, z, n, dir) {
      for (let k = 0, i = 0; i < this.confData.length && k < n; i++) { const c = this.confData[i]; if (c.on) continue;
        c.on = true; c.p.set(x, y, z); c.v.set(dir * (2 + Math.random() * 6), 10 + Math.random() * 9, (Math.random() - 0.3) * 6); k++; }
    },

    step(dt) {
      if (!this.karts) return; this.t += dt; const t = this.t, d = this._d;
      // ---- karts ----
      this.karts.forEach(k => {
        if (t < k.delay) return; const g = k.m.group;
        if (!k.landed) { k.vy -= 42 * dt; g.position.y += k.vy * dt;
          if (g.position.y <= k.floorY) { g.position.y = k.floorY; k.vy = -k.vy * 0.33; if (Math.abs(k.vy) < 2.2) { k.landed = true; k.vy = 0; k.landT = t; }
            if (k.place < 3) UI.Sfx.tone(170 - k.place * 20, 90, 0.12, 'sine', 0.12); } }
        else if (k.place === 0 && this.allT !== null) { const j = Math.max(0, Math.sin((t - this.allT) * 5)); g.position.y = k.floorY + j * 0.8; g.rotation.y = Math.sin(t * 2.4) * 0.35; }
        else { g.rotation.y += (k.ry - g.rotation.y) * Math.min(1, dt * 3); const sq = Math.max(0, 1 - (t - k.landT) * 4); k.m.body.scale.set(1 + sq * 0.15, 1 - sq * 0.2, 1 + sq * 0.1); }
        k.m.rolls.forEach(w => w.g.rotation.x += dt * 1.5);
        const cele = k.place === 0 && this.allT !== null;
        k.m.animate(dt, cele ? { steer: Math.sin(t * 6) * 0.8, speed: 0.6, boost: true } : { steer: Math.sin(t * 1.2 + k.place) * (k.place < 3 ? 0.25 : 0.12), speed: 0 });
      });
      // ---- todos no lugar: troféu sobe, canhões de confete, fanfarra ----
      if (this.allT === null && this.karts.every(k => k.landed)) { this.allT = t; this.trophy.visible = true; UI.Sfx.fanfare();
        this.burst(-11, 3, 3, 90, 1); this.burst(11, 3, 3, 90, -1); }
      if (this.allT !== null) { const e = easeOut((t - this.allT) / 1.8), top = this.slots[0].top;
        this.trophy.position.set(0, top + 2.4 + e * 0.9 + Math.sin(t * 2) * 0.18, -1.6); this.trophy.scale.setScalar(0.35 + 0.55 * e); this.trophy.rotation.y = t * 1.1;
        this.tGlow.position.set(0, this.trophy.position.y + 3.2, -1.8); this.tGlow.material.opacity = 0.5 * e + 0.12 * Math.sin(t * 6) * e; }
      // ---- confete: chuva leve contínua + física das rajadas ----
      if (this.allT !== null) { this.rainT -= dt; if (this.rainT <= 0) { this.rainT = 0.05;
        for (let i = 0; i < this.confData.length; i++) { const c = this.confData[i]; if (!c.on) { c.on = true; c.p.set((Math.random() - 0.5) * 34, 22 + Math.random() * 6, (Math.random() - 0.5) * 18); c.v.set(0, -2, 0); break; } } } }
      for (let i = 0; i < this.confData.length; i++) { const c = this.confData[i];
        if (c.on) { c.v.y = Math.max(-2.6, c.v.y - 14 * dt); c.v.x *= 1 - dt * 1.2; c.v.z *= 1 - dt * 1.2; c.p.addScaledVector(c.v, dt); c.p.x += Math.sin(t * c.wr + i) * dt * 0.8; c.rx += dt * c.wr; c.ry += dt * 2;
          if (c.p.y < 0.1) { c.on = false; c.p.y = -10; } }
        d.position.copy(c.p); d.rotation.set(c.rx, c.ry, 0); d.scale.setScalar(1); d.updateMatrix(); this.conf.setMatrixAt(i, d.matrix); }
      this.conf.instanceMatrix.needsUpdate = true;
      // ---- torcida pulando (mais forte depois do troféu) ----
      const hype = this.allT !== null ? 0.7 : 0.25;
      d.rotation.set(0, 0, 0); d.scale.setScalar(1);
      for (let i = 0; i < this.crowd.length; i++) { const c = this.crowd[i], j = Math.max(0, Math.sin(t * 7 + c.ph)) * hype;
        d.position.set(c.x, c.y + 0.55 + j, c.z); d.updateMatrix(); this.crowdBody.setMatrixAt(i, d.matrix);
        d.position.y += 0.95; d.updateMatrix(); this.crowdHead.setMatrixAt(i, d.matrix); }
      this.crowdBody.instanceMatrix.needsUpdate = this.crowdHead.instanceMatrix.needsUpdate = true;
      // ---- bandeiras e refletores ----
      this.flags.forEach(f => { const p = f.g.attributes.position; for (let i = 0; i < p.count; i++) { const x = f.base[i * 3], y = f.base[i * 3 + 1]; p.setZ(i, Math.sin(x * 1.8 - t * 5 + f.ph) * 0.3 * (x / 3.6) + Math.sin(y * 2 + t * 3) * 0.05 * (x / 3.6)); } p.needsUpdate = true; });
      this.beams.forEach(b => { b.m.rotation.set(Math.sin(t * 0.7 + b.s) * 0.45, 0, b.s * (0.35 + Math.sin(t * 0.5 + b.s * 2) * 0.3)); });
      // ---- fogos ----
      this.fwT -= dt;
      if (this.allT !== null && this.fwT <= 0) { this.fwT = 0.55 + Math.random() * 0.5; const c = this._c.setHSL(Math.random(), 1, 0.62), ox = (Math.random() - 0.5) * 60, oy = 26 + Math.random() * 14, oz = -25 - Math.random() * 25;
        for (let n = 0; n < 34; n++) { const p = this.fw[this.fwI = (this.fwI + 1) % this.fw.length]; p.s.position.set(ox, oy, oz); p.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(9 + Math.random() * 5); p.l = 1.4; p.s.visible = true; p.s.material.color.copy(c); }
        UI.Sfx.noise(0.5, 2000, 200, 0.06); }
      this.fw.forEach(p => { if (p.l <= 0) return; p.l -= dt; if (p.l <= 0) { p.s.visible = false; return; } p.v.y -= 6 * dt; p.v.multiplyScalar(1 - dt * 0.8); p.s.position.addScaledVector(p.v, dt); p.s.material.opacity = p.l / 1.4; });
      // ---- câmera ----
      // O cartão de resultados ocupa a lateral direita (telas largas) ou a parte de baixo (retrato). A cada 0,5 s
      // medimos a área LIVRE da tela; a distância da câmera é calculada para o pódio + troféu caberem nela e o
      // centro óptico é deslocado (setViewOffset) para o meio dessa área -> nada fica atrás do placar.
      const cam = this.camera, W = innerWidth, H = innerHeight;
      this._fT = (this._fT || 0) - dt;
      if (this._fT <= 0 || !this._free) { this._fT = 0.5; const card = document.querySelector('#podiumUI .card'), r = card && card.offsetParent ? card.getBoundingClientRect() : null;
        if (r && r.width > 0 && r.left > W * 0.4) this._free = [0, 0, Math.max(200, r.left - 12), H];
        else if (r && r.height > 0) this._free = [0, 0, W, Math.max(160, r.top - 8)];
        else this._free = [0, 0, W, H]; }
      const [fx, fy, fw, fh] = this._free, tv = Math.tan(cam.fov * Math.PI / 360);
      const top = this.slots[0].top + 7.4, hc = top / 2 + 0.6, wc = 16.5;
      const D = Math.max(hc * H / (fh * tv), wc * W / (fw * tv * cam.aspect)) * 1.04 + 4;
      cam.setViewOffset(W, H, W / 2 - (fx + fw / 2), H / 2 - (fy + fh / 2), W, H);
      // entrada: desce de uma grua alta girando até o plano final, depois oscila de leve
      const intro = sm(t / 3.2), a = (1 - intro) * 0.9 + 0.16 * Math.sin(t * 0.22), dist = D * (1 + 0.45 * (1 - intro)), hgt = hc + 2.5 + (1 - intro) * 16;
      cam.position.set(Math.sin(a) * dist, hgt, 6 + Math.cos(a) * dist); cam.lookAt(0, hc, 2);
      this.sky.position.copy(cam.position);
    },
    resize() { if (this.camera) { this.camera.aspect = innerWidth / innerHeight; this._free = null; this.camera.updateProjectionMatrix(); } },
    // pré-compila os shaders da cena (chamado no carregamento): a 1ª exibição não compila nada
    precompile(renderer) { if (this.scene) renderer.compile(this.scene, this.camera); }
  };
  window.Podium = Podium;
  window.makeTrophy = makeTrophy;
})();
