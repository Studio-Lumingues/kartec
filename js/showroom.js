// =====================================================================================
// showroom.js — vitrine 3D usada pelo menu principal e pela Garagem
// Plataforma giratória com o kart + piloto do jogador. Cada tela tem um "rig" de câmera e a câmera
// desliza suavemente entre eles (menu: kart à direita girando; garagem: kart ao centro-esquerda,
// órbita automática que o jogador pode arrastar). Mudanças de cor/adesivo/piloto são aplicadas no
// modelo existente (instantâneo); trocar o modelo de kart reconstrói só o kart.
// Também gera as miniaturas dos modelos para os cartões da Garagem (render-to-texture).
// =====================================================================================
(function () {
  const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

  const Showroom = {
    rig: 'menu', yaw: 0.6, drag: null, autoSpin: true,
    build(renderer) { return Toon.during(() => this._build(renderer)); },
    _build(renderer) {
      this.renderer = renderer;
      const sc = this.scene = new THREE.Scene();
      const bg = TX.cvs(4, 256), g = bg.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#7a5cff'); gr.addColorStop(0.5, '#3db8ff'); gr.addColorStop(1, '#bff6ff'); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
      sc.background = new THREE.CanvasTexture(bg);
      sc.add(new THREE.HemisphereLight(0xf2f8ff, 0x7aa0e0, 0.75));
      const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(10, 18, 12); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
      Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 }); key.shadow.bias = -0.0008; sc.add(key);
      const rim = new THREE.DirectionalLight(0xffe0b0, 0.5); rim.position.set(-12, 6, -10); sc.add(rim);
      this.cam = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.5, 400);
      // plataforma: disco branco, anel vermelho e piso quadriculado
      this.turn = new THREE.Group(); sc.add(this.turn);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.9, 1, 64), new THREE.MeshLambertMaterial({ color: 0xffffff })); disc.position.y = -0.5; disc.receiveShadow = true; this.turn.add(disc);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6.65, 0.28, 12, 72), new THREE.MeshLambertMaterial({ color: 0xff4d9a })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; this.turn.add(ring);
      const top = new THREE.Mesh(new THREE.CircleGeometry(6.2, 64), new THREE.MeshLambertMaterial({ map: TX.get('checker', 3, 3), color: 0xf0f4ff })); top.rotation.x = -Math.PI / 2; top.position.y = 0.01; top.receiveShadow = true; this.turn.add(top);
      // nuvens fofas ao fundo
      const cloudM = new THREE.MeshLambertMaterial({ color: 0xffffff }); this.clouds = [];
      [[-26, 14, -40, 1.4], [22, 18, -46, 1.8], [-8, 22, -60, 1.2], [34, 9, -30, 1], [-36, 6, -24, 0.9]].forEach(([x, y, z, s]) => {
        const c = new THREE.Group(); [[0, 0, 0, 3], [2.8, -0.6, 0.4, 2.2], [-2.8, -0.7, 0, 2.1], [1, 1.2, -0.5, 2]].forEach(([a, b, d, r]) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudM); m.position.set(a, b, d); c.add(m); });
        c.position.set(x, y, z); c.scale.setScalar(s); sc.add(c); this.clouds.push(c); });
      this.spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); this.spark.scale.setScalar(12); this.spark.position.y = 2; sc.add(this.spark);
      this.t = 0; this.camPos = new THREE.Vector3(6.5, 7.5, 21); this.camLook = new THREE.Vector3(5.6, 0.6, 0);
      this.setSpec(Custom.spec);
      this.bindDrag();
    },
    // (re)monta o kart da vitrine
    setSpec(spec) {
      if (this.kart) { this.turn.remove(this.kart.group); this.kart.dispose(); }
      this.kart = buildKartModel(Object.assign({}, spec), {}); this.turn.add(this.kart.group);
      this.kart.group.traverse(o => { if (o.isMesh) o.receiveShadow = false; });
      this.pulse(spec.color);
    },
    apply(id, spec) { if (!this.kart) return; if (!Custom.applyTo(this.kart, id)) this.setSpec(spec); else this.pulse(id === 'color' ? spec.color : null); },
    pulse(hex) { if (hex) this.spark.material.color.set(hex); this.spark.material.opacity = 0.85; this.hop = 0.35; },
    setRig(name) { this.rig = name; if (name === 'garage') { this.autoSpin = true; } },
    // arrastar para girar o kart na garagem
    bindDrag() {
      const el = this.renderer.domElement;
      el.addEventListener('pointerdown', e => { if (window.Game && Game.state === 'garage' && e.button === 0) { this.drag = { x: e.clientX, v: 0 }; this.autoSpin = false; } });
      addEventListener('pointermove', e => { if (!this.drag) return; const dx = e.clientX - this.drag.x; this.drag.x = e.clientX; this.turn.rotation.y += dx * 0.01; this.drag.v = dx * 0.01; });
      addEventListener('pointerup', () => { if (this.drag) { this.spinV = this.drag.v; this.drag = null; clearTimeout(this._as); this._as = setTimeout(() => this.autoSpin = true, 2500); } });
    },
    step(dt) {
      this.t += dt; const t = this.t;
      if (!this.drag) { this.spinV = (this.spinV || 0) * Math.max(0, 1 - 3 * dt); this.turn.rotation.y += this.spinV + (this.autoSpin ? dt * (this.rig === 'garage' ? 0.3 : 0.5) : 0); }
      if (this.kart) {
        this.kart.rolls.forEach(w => w.g.rotation.x += dt * 3);
        this.hop = Math.max(0, (this.hop || 0) - dt);
        this.kart.body.position.y = Math.abs(Math.sin(t * 3)) * 0.04 + Math.sin(this.hop / 0.35 * Math.PI) * 0.5;
        // piloto "vivo": mexe no volante e olha em volta
        const st = Math.sin(t * 0.9) * 0.5 + Math.sin(t * 2.3) * 0.15;
        this.kart.animate(dt, { steer: st, speed: 0.2, boost: false, drift: 0 });
      }
      this.spark.material.opacity *= Math.max(0, 1 - dt * 3);
      this.clouds.forEach((c, i) => { c.position.x += dt * (0.6 + i * 0.15); if (c.position.x > 50) c.position.x = -50; });
      // rigs de câmera
      const c = this.cam, wide = innerWidth > 860; c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix();
      const P = new THREE.Vector3(), L = new THREE.Vector3();
      if (this.rig === 'garage') {
        const a = 0.5 + Math.sin(t * 0.2) * 0.08;
        if (wide) { P.set(4.8 + Math.sin(a) * 2, 6.4, 17.5); L.set(4.2, 1.4, 0); } else { P.set(0, 7.5, 19); L.set(0, 4.2, 0); }
      } else if (this.rig === 'setup') {
        if (wide) { P.set(0, 9, 24); L.set(0, 1.5, 0); } else { P.set(0, 10, 26); L.set(0, 4, 0); }
      } else {
        if (wide) { P.set(-6.0, 7.0, 20); L.set(-5.6, 1.0, 0); } else { P.set(0, 9.5, 25); L.set(0, 4.8, 0); }
      }
      const k = Math.min(1, 3 * dt); this.camPos.lerp(P, k); this.camLook.lerp(L, k);
      c.position.copy(this.camPos); c.lookAt(this.camLook);
    },
    // ---------- miniaturas dos modelos (desenhadas uma vez, em segundo plano) ----------
    thumbnails(cb) {
      if (this._thumbs) return cb(this._thumbs);
      const R = this.renderer, W = 240, H = 150, rt = new THREE.WebGLRenderTarget(W, H), buf = new Uint8Array(W * H * 4), out = {};
      const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xf2f8ff, 0x8aa8d8, 0.9)); const d = new THREE.DirectionalLight(0xffffff, 0.7); d.position.set(8, 14, 10); sc.add(d);
      const cam = new THREE.PerspectiveCamera(28, W / H, 0.5, 100); cam.position.set(8.5, 5.2, 9.5); cam.lookAt(0, 1.2, 0);
      const list = KartModels.list().slice(); let i = 0;
      const next = () => {
        if (i >= list.length) { rt.dispose(); this._thumbs = out; return cb(out); }
        const def = list[i++], m = buildKartModel(Object.assign({}, Custom.spec, { model: def.id }), { pilot: false }); sc.add(m.group);
        R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, cam); R.readRenderTargetPixels(rt, 0, 0, W, H, buf); R.setRenderTarget(null); R.setClearColor(0x000000, 1);
        sc.remove(m.group); m.dispose();
        const c = TX.cvs(W, H), g = c.getContext('2d'), img = g.createImageData(W, H);
        for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);   // a leitura vem de cabeça para baixo
        g.putImageData(img, 0, 0); out[def.id] = c.toDataURL();
        setTimeout(next, 0);
      };
      next();
    },
    resize() { if (this.cam) { this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix(); } }
  };
  window.Showroom = Showroom;
})();
