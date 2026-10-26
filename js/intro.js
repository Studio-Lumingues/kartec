// =====================================================================================
// intro.js — abertura cinematográfica
// Linha do tempo (segundos):
//   0,0 – 2,9  plano A: disputa vista de lado (câmera acompanha em travelling lateral)
//   2,9 – 5,1  plano B: câmera baixa à frente, 3/4, orbitando devagar enquanto os karts trocam a ponta
//   5,1 – 6,7  plano C: grua alta pelo outro lado descendo até a pista
//   6,7 – 9,0  plano D: câmera para atrás deles; turbo, os karts disparam rumo ao horizonte
//   8,1 – 9,0  desfoque + clarão (CSS) enquanto somem
//   9,0 →      logo "Super Kartec" entra com impacto; Enter / toque / 2,6 s depois -> menu
// Entre um plano e outro a câmera não corta seco: as duas poses são misturadas por 0,7 s.
// Os karts são os mesmos do jogo (buildKartModel) com o visual do jogador e de um rival.
// =====================================================================================
(function () {
  const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const SHOTS = [0, 2.9, 5.1, 6.7], END = 9.0, BLEND = 0.7;

  const Intro = {
    build() { if (!this.scene) Toon.during(() => this._build()); },
    _build() {
      const sc = this.scene = new THREE.Scene();
      sc.background = new THREE.Color(0xbfe4ff); sc.fog = new THREE.Fog(0xbfe4ff, 60, 520);
      this.cam = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.3, 900);
      sc.add(new THREE.HemisphereLight(0xdff0ff, 0x6a9a4a, 0.85));
      const sun = this.sun = new THREE.DirectionalLight(0xfff0d0, 0.9); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 120 }); sc.add(sun, sun.target);
      // céu em degradê (domo)
      const c = TX.cvs(4, 256), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#2f6fe0'); gr.addColorStop(0.5, '#8cc4ff'); gr.addColorStop(1, '#e8f6ff'); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 12), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.BackSide, fog: false, depthWrite: false })); sc.add(this.sky);
      // reta longa: grama, asfalto, zebras e faixas
      const LEN = 3200, Z0 = -200;
      const grass = new THREE.Mesh(new THREE.PlaneGeometry(1600, LEN), new THREE.MeshLambertMaterial({ map: TX.get('grass', 120, 240) })); grass.rotation.x = -Math.PI / 2; grass.position.z = Z0 + LEN / 2; grass.receiveShadow = true; sc.add(grass);
      const road = new THREE.Mesh(new THREE.PlaneGeometry(18, LEN), new THREE.MeshLambertMaterial({ map: TX.get('asphalt', 2, LEN / 9) })); road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, Z0 + LEN / 2); road.receiveShadow = true; sc.add(road);
      const curbC = TX.cvs(16, 64), cg = curbC.getContext('2d'); cg.fillStyle = '#fff'; cg.fillRect(0, 0, 16, 64); cg.fillStyle = '#ff3d47'; cg.fillRect(0, 0, 16, 32);
      const curbT = new THREE.CanvasTexture(curbC); curbT.wrapS = curbT.wrapT = THREE.RepeatWrapping; curbT.repeat.set(1, LEN / 4);
      [-1, 1].forEach(s => { const cb = new THREE.Mesh(new THREE.PlaneGeometry(1.4, LEN), new THREE.MeshLambertMaterial({ map: curbT })); cb.rotation.x = -Math.PI / 2; cb.position.set(s * 9.7, 0.04, Z0 + LEN / 2); sc.add(cb); });
      const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.35, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), 400), d = new THREE.Object3D();
      for (let i = 0; i < 400; i++) { d.position.set(0, 0.05, Z0 + i * 8); d.rotation.x = -Math.PI / 2; d.updateMatrix(); dash.setMatrixAt(i, d.matrix); } sc.add(dash);
      // árvores e postes dos dois lados (instanciados)
      const N = 260, trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.45, 3, 7), new THREE.MeshLambertMaterial({ color: 0x7a5232 }), N);
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.4, 1), new THREE.MeshLambertMaterial({ color: 0x3f9a3a }), N);
      let s = 3; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < N; i++) { const side = i % 2 ? 1 : -1, z = Z0 + (i >> 1) * 22 + r() * 10, x = side * (17 + r() * 22), k = 0.8 + r() * 0.7;
        d.rotation.set(0, 0, 0); d.position.set(x, 1.5 * k, z); d.scale.setScalar(k); d.updateMatrix(); trunk.setMatrixAt(i, d.matrix);
        d.position.set(x, 4.2 * k, z); d.scale.set(k, k * 1.2, k); d.updateMatrix(); crown.setMatrixAt(i, d.matrix); crown.setColorAt(i, new THREE.Color().setHSL(0.27 + r() * 0.08, 0.5, 0.32 + r() * 0.12)); }
      trunk.castShadow = crown.castShadow = true; sc.add(trunk, crown);
      // placas "SUPER KARTEC" de tempos em tempos
      const signM = new THREE.MeshLambertMaterial({ map: TX.get('sign', 1, 1, { clamp: true }) }), postM = new THREE.MeshLambertMaterial({ color: 0xdddddd });
      for (let i = 0; i < 18; i++) { const z = 40 + i * 120, side = i % 2 ? 1 : -1; const b = new THREE.Mesh(new THREE.PlaneGeometry(16, 2), signM); b.position.set(side * 13, 3.4, z); b.rotation.y = -side * Math.PI / 2 * 0.85; sc.add(b);
        [-6, 6].forEach(o => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.4, 6), postM); p.position.set(side * 13 + Math.cos(b.rotation.y) * o, 1.4, z - Math.sin(b.rotation.y) * o); sc.add(p); }); }
      // colinas distantes
      const hillM = new THREE.MeshLambertMaterial({ color: 0x6fb06a, fog: true });
      for (let i = 0; i < 26; i++) { const h = new THREE.Mesh(new THREE.SphereGeometry(60 + r() * 60, 16, 8), hillM); const side = i % 2 ? 1 : -1; h.position.set(side * (140 + r() * 120), -30, Z0 + i * 130); h.scale.y = 0.5; sc.add(h); }
      Fx.init(sc);
    },
    // monta o elenco: jogador + rival
    cast(spec) {
      if (this.karts) this.karts.forEach(k => { this.scene.remove(k.m.group); k.m.dispose(); });
      const rivalColor = Game.botColorFor(spec.color), rival = Custom.rivalFor(spec, rivalColor);
      this.karts = [spec, rival].map((sp, i) => { const m = buildKartModel(Object.assign({}, sp), {}); this.scene.add(m.group); return { m, lane: i ? -3.2 : 3.2, z: 0, v: 30, steer: 0, ph: i * 1.7 }; });
    },
    start(spec) {
      this.build(); this.cast(spec); this.t = 0; this.phase = 'film'; this.done = false;
      this.karts.forEach(k => { k.z = 0; k.v = 30; });
      UI.introPhase('film');
    },
    // pula direto para a logo (ou, se já estiver nela, para o menu)
    skip() { if (this.phase === 'film') this.toLogo(); else if (this.phase === 'logo') this.finish(); },
    toLogo() { if (this.phase === 'logo') return; this.phase = 'logo'; this.logoT = 0; UI.introPhase('logo'); UI.Sfx.tone(90, 40, 0.5, 'sine', 0.25); UI.Sfx.noise(0.4, 3000, 200, 0.15); },
    finish() { if (this.done) return; this.done = true; this.phase = 'out'; Game.toMenu(true); },
    // pose da câmera de cada plano (mid = ponto médio entre os karts)
    shotPose(i, tl, mid, P, L) {
      if (i === 0) { P.set(12.5, 1.7, mid.z - 1.5 + tl * 1.2); L.set(0, 1.4, mid.z + 0.5); }
      else if (i === 1) { const a = -0.5 + tl * 0.18; P.set(Math.sin(a) * 11, 1.0 + tl * 0.15, mid.z + Math.cos(a) * 11); L.set(0, 1.5, mid.z); }
      else if (i === 2) { P.set(-13 + tl * 2.5, 9 - tl * 4.2, mid.z - 9 + tl * 2.5); L.set(0, 1.2, mid.z + 2); }
      else { const stop = this.stopZ !== undefined ? this.stopZ : mid.z - 13; P.set(1.2, 3.2 - Math.min(1, tl) * 0.9, stop); L.set(0, 1.6, stop + 30 + tl * 20); }
    },
    step(dt) {
      if (!this.scene) return;
      this.t += dt; const t = this.t, K = this.karts;
      if (this.phase === 'logo') { this.logoT += dt; if (this.logoT > 3.2) this.finish(); return; }
      if (this.phase !== 'film') return;
      // movimento: disputa lado a lado, alternando quem está na frente
      const sprint = t > 7.0;
      K.forEach((k, i) => {
        const target = sprint ? 120 : 31 + Math.sin(t * 1.3 + k.ph) * 2.2;
        k.v += (target - k.v) * Math.min(1, (sprint ? 0.9 : 2) * dt); k.z += k.v * dt;
        const latT = (i ? -1 : 1) * (sprint ? 2.6 : 2.2 + Math.sin(t * 1.7 + k.ph) * 1.0), dl = latT - k.lane; k.lane += dl * Math.min(1, 2 * dt);
        k.steer = Math.max(-1, Math.min(1, dl * 0.8));
        const g = k.m.group; g.position.set(k.lane, 0, k.z); g.rotation.y = -dl * 0.04;
        k.m.rolls.forEach(w => w.g.rotation.x += k.v * dt / w.r);
        k.m.fw.forEach(w => w.rotation.y = k.steer * 0.3);
        k.m.flames.forEach(f => { f.visible = sprint; f.scale.set(1, 0.8 + Math.random() * 0.7, 1); });
        if (k.m.moto) k.m.pivot.rotation.z = -k.steer * 0.2;
        k.m.animate(dt, { steer: k.steer, speed: Math.min(1, k.v / 46), boost: sprint, drift: 0 });
        if (sprint && Math.random() < 0.8) k.m.flames.forEach(f => { const w = f.getWorldPosition(new THREE.Vector3()); Fx.puff('glow', w.x, w.y, w.z, 0, (Math.random() - 0.5) * 2, -6, Math.random() < 0.7 ? 0xff7a1a : 0xffd23a, 1.4, 0.3, 0.4, 0.9); });
        if (Math.random() < 0.3) { const w = g.localToWorld(new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * k.m.rear.x, 0.2, k.m.rear.z)); Fx.puff('smoke', w.x, 0.3, w.z, 0, 0.6, -4, 0xe6e8ee, 0.5, 1.8, 0.5, 0.35, 0.6); }
      });
      Fx.step(dt);
      const mid = V(0, 0, (K[0].z + K[1].z) / 2);
      if (t >= SHOTS[3] && this.stopZ === undefined) this.stopZ = mid.z - 13;
      // câmera: plano atual misturado com o anterior durante BLEND segundos
      let i = 0; while (i < SHOTS.length - 1 && t >= SHOTS[i + 1]) i++;
      const tl = t - SHOTS[i], P = V(0, 0, 0), L = V(0, 0, 0); this.shotPose(i, tl, mid, P, L);
      if (i > 0 && tl < BLEND) { const P0 = V(0, 0, 0), L0 = V(0, 0, 0); this.shotPose(i - 1, t - SHOTS[i - 1], mid, P0, L0); const b = sm(tl / BLEND); P.lerpVectors(P0, P, b); L.lerpVectors(L0, L, b); }
      const c = this.cam; c.position.copy(P); c.lookAt(L); c.fov = 42 + (sprint ? Math.min(14, (t - 7) * 10) : 0); c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix();
      this.sky.position.copy(c.position);
      this.sun.position.set(mid.x + 30, 50, mid.z + 20); this.sun.target.position.copy(mid);
      if (t > 8.1) UI.introBlur(sm((t - 8.1) / 0.9));
      if (t >= END) this.toLogo();
    },
    resize() { if (this.cam) { this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix(); } },
    dispose() { if (this.karts) this.karts.forEach(k => { this.scene.remove(k.m.group); k.m.dispose(); }); this.karts = null; this.stopZ = undefined; }
  };
  window.Intro = Intro;
})();
