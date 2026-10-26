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
  const Sfx = {
    on: true, ctx: null, eng: null,
    unlock() {
      try { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); this.initEngine(); } catch (e) { }
    },
    initEngine() {
      const A = this.ctx; if (!A || this.eng) return;
      const o1 = A.createOscillator(), o2 = A.createOscillator(), lp = A.createBiquadFilter(), g = A.createGain(), lfo = A.createOscillator(), lfoG = A.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 5; g.gain.value = 0;
      lfo.frequency.value = 22; lfoG.gain.value = 4; lfo.connect(lfoG); lfoG.connect(o1.frequency);
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(A.destination); o1.start(); o2.start(); lfo.start();
      const nb = A.createBuffer(1, A.sampleRate, A.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const ns = A.createBufferSource(); ns.buffer = nb; ns.loop = true; const bp = A.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2300; bp.Q.value = 7;
      const ng = A.createGain(); ng.gain.value = 0; ns.connect(bp); bp.connect(ng); ng.connect(A.destination); ns.start();
      this.eng = { o1, o2, lp, g, ng, bp, nb, lfo };
    },
    // motor do jogador: giro sobe dentro de cada marcha e cai na troca
    step(k, active) {
      const e = this.eng, A = this.ctx; if (!e || !A || A.state === 'closed') return; const t = A.currentTime;
      const on = this.on && active && k;
      const sp = k ? Math.min(1.5, Math.abs(k.speed) / CFG.PHYS.MAX) : 0;
      const gp = Math.min(sp * 3, 4.49), gear = Math.floor(gp), fr = gp - gear;
      let f = 46 + gear * 16 + fr * 58 + (k && k.boostT > 0 ? 28 : 0) + (k && k.drifting ? 8 : 0); if (!isFinite(f)) f = 46;
      e.o1.frequency.setTargetAtTime(f, t, 0.06); e.o2.frequency.setTargetAtTime(f * 0.502, t, 0.06); e.lfo.frequency.setTargetAtTime(14 + f * 0.12, t, 0.1);
      e.lp.frequency.setTargetAtTime(380 + sp * 1500 + (k && k.boostT > 0 ? 900 : 0), t, 0.08);
      e.g.gain.setTargetAtTime(on ? 0.035 + 0.04 * Math.min(1, sp) : 0, t, 0.08);
      const skid = on && (k.drifting || (Math.abs(k.steerVis) > 0.6 && Math.abs(k.speed) > CFG.PHYS.MAX * 0.62 && !k.off && !k.air));
      e.ng.gain.setTargetAtTime(skid ? (k.drifting ? 0.05 : 0.03) : 0, t, 0.05);
      e.bp.frequency.setTargetAtTime(k && k.drifting ? (k.driftT > 2 ? 2900 : k.driftT > 1 ? 2600 : 2200) : 2000, t, 0.1);
    },
    tone(f0, f1, d, type, vol, delay) {
      const A = this.ctx; if (!A || !this.on) return;
      try { const o = A.createOscillator(), g = A.createGain(), t = A.currentTime + (delay || 0);
        o.type = type || 'square'; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + d);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g); g.connect(A.destination); o.start(t); o.stop(t + d + 0.03); } catch (e) { }
    },
    noise(d, f0, f1, vol) {
      const A = this.ctx; if (!A || !this.on || !this.eng) return;
      try { const t = A.currentTime, s = A.createBufferSource(), f = A.createBiquadFilter(), g = A.createGain();
        s.buffer = this.eng.nb; f.type = 'lowpass'; f.Q.value = 3; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + d * 0.7);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        s.connect(f); f.connect(g); g.connect(A.destination); s.start(t); s.stop(t + d + 0.05); } catch (e) { }
    },
    boost() { this.noise(0.7, 400, 4200, 0.22); this.tone(220, 660, 0.45, 'sawtooth', 0.07); },
    coin() { this.tone(988, 0, 0.08, 'square', 0.11); this.tone(1319, 0, 0.28, 'square', 0.11, 0.075); },
    bump() { this.tone(110, 70, 0.16, 'sawtooth', 0.14); },
    land() { this.noise(0.25, 900, 120, 0.25); this.tone(90, 50, 0.2, 'sine', 0.2); },
    drift() { this.tone(300, 0, 0.08, 'triangle', 0.12); },
    lap() { [784, 988, 1175].forEach((f, i) => this.tone(f, 0, 0.12, 'square', 0.1, i * 0.09)); },
    count(go) { this.tone(go ? 880 : 440, 0, go ? 0.8 : 0.28, 'square', 0.14); },
    fanfare() { [[523, 0], [659, 0.14], [784, 0.28], [1047, 0.42], [784, 0.62], [1047, 0.76]].forEach(([f, d]) => { this.tone(f, 0, 0.3, 'square', 0.1, d); this.tone(f / 2, 0, 0.3, 'triangle', 0.08, d); }); this.tone(1047, 0, 1.2, 'square', 0.1, 0.95); this.tone(1319, 0, 1.2, 'triangle', 0.08, 0.95); }
  };

  // ================================ FATECXIE ================================
  // a fadinha amarela que traz o semáforo na largada (presa à câmera, como o "juiz" voador dos jogos de kart)
  const Fairy = {
    build(camera) {
      if (this.rig) return;
      const fB = (c, o) => new THREE.MeshBasicMaterial(Object.assign({ color: c }, o || {}));
      const rig = this.rig = new THREE.Group(); rig.visible = false; camera.add(rig);
      const fairy = this.fairy = new THREE.Group(); rig.add(fairy);
      fairy.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 18), fB(0xfff27a)));
      fairy.add(new THREE.Mesh(new THREE.SphereGeometry(0.56, 28, 18), fB(0xffe94a, { transparent: true, opacity: 0.35, depthWrite: false })));
      this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: 0xffe94a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.95 })); this.halo.scale.setScalar(4.2); fairy.add(this.halo);
      [-1, 1].forEach(s => {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), fB(0x2a1a10)); e.position.set(s * 0.17, 0.08, 0.46); e.scale.set(1, 1.45, 0.6); fairy.add(e);
        const gl = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), fB(0xffffff)); gl.position.set(s * 0.17 + 0.025, 0.13, 0.5); fairy.add(gl);
        const ch = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), fB(0xffa08a)); ch.position.set(s * 0.3, -0.07, 0.4); ch.scale.set(1, 0.6, 0.4); fairy.add(ch);
      });
      { const sm = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 14, Math.PI), fB(0x7a3a1a)); sm.rotation.z = Math.PI; sm.position.set(0, -0.07, 0.47); fairy.add(sm); }
      { const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(0.06, 0.75, -0.04), new THREE.Vector3(0.24, 0.9, 0)]);
        fairy.add(new THREE.Mesh(new THREE.TubeGeometry(c, 16, 0.03, 8, false), fB(0xd9b81a)));
        const st = new THREE.Shape(); for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 0.07 : 0.17; k ? st.lineTo(Math.cos(a) * r, Math.sin(a) * r) : st.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
        const sg = new THREE.ExtrudeGeometry(st, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 }); sg.translate(0, 0, -0.025);
        this.star = new THREE.Mesh(sg, fB(0xffc81a)); this.star.position.set(0.27, 0.93, 0); fairy.add(this.star); }
      const wingShape = sc => { const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(0.2 * sc, 0.95 * sc, 1.25 * sc, 1.25 * sc, 1.45 * sc, 0.55 * sc); s.bezierCurveTo(1.6 * sc, 0, 0.9 * sc, -0.55 * sc, 0, 0); return s; };
      this.wings = [-1, 1].map(s => { const piv = new THREE.Group(); piv.position.set(s * 0.3, 0.12, -0.25); fairy.add(piv);
        const w = new THREE.Mesh(new THREE.ShapeGeometry(wingShape(1), 16), fB(0xfffbd0, { transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
        const w2 = new THREE.Mesh(new THREE.ShapeGeometry(wingShape(0.62), 16), fB(0xffffff, { transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })); w2.position.set(0.15, 0.08, 0.01);
        const g = new THREE.Group(); g.add(w, w2); g.scale.x = s; g.rotation.z = 0.25 * s; piv.add(g); return piv; });
      const AT = new THREE.Vector3(2.0, 3.0, -7), TIP = new THREE.Vector3(0, 3.65, -7);
      { const a = AT.clone().add(new THREE.Vector3(-0.42, -0.25, 0.1)), d = TIP.clone().sub(a), L = d.length();
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, L, 10), fB(0xb0782e)); rod.position.copy(a).addScaledVector(d, 0.5); rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); rig.add(rod);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), fB(0xfff27a)); tip.position.copy(TIP); rig.add(tip); }
      fairy.position.copy(AT);
      const piv = this.sigPivot = new THREE.Group(); piv.position.copy(TIP); rig.add(piv);
      { const str = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 6), fB(0xeeeeee)); str.position.y = -0.6; piv.add(str); }
      const box = new THREE.Group(); box.position.y = -1.75; piv.add(box);
      box.add(new THREE.Mesh(GEO.rbox(2.6, 0.95, 0.5, 0.22), new THREE.MeshBasicMaterial({ color: 0x22242e })));
      { const rim = new THREE.Mesh(GEO.rbox(2.75, 1.1, 0.4, 0.26), new THREE.MeshBasicMaterial({ color: 0xffd21a })); rim.position.z = -0.08; box.add(rim); }
      this.DIM = [0x4a1212, 0x4a3c10, 0x12401a]; this.ON = [0xff2a2a, 0xffd21a, 0x3dff5a];
      this.lamps = [-0.82, 0, 0.82].map((x, k) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), fB(this.DIM[k])); m.position.set(x, 0, 0.2); m.scale.z = 0.55; box.add(m);
        const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: this.ON[k], blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); gl.position.set(x, 0, 0.45); gl.scale.setScalar(2.2); box.add(gl); return { m, gl }; });
      this.state = 'off'; this.t = 0; this.spark = 0;
    },
    setLamp(k, track) {
      this.lamps.forEach((l, i) => { l.m.material.color.setHex(i === k ? this.ON[i] : this.DIM[i]); l.gl.material.opacity = i === k ? 0.95 : 0; });
      if (track && track.archLamps) track.archLamps.forEach((pair, i) => pair.forEach(m => m.material.color.setHex(i === k ? this.ON[i] : this.DIM[i])));
    },
    show() { this.state = 'in'; this.t = 0; this.rig.visible = true; this.setLamp(-1); },
    leave() { if (this.state !== 'off') { this.state = 'out'; this.t = 0; } },
    hide() { if (this.rig) { this.state = 'off'; this.rig.visible = false; } },
    step(dt, camera) {
      if (!this.rig || this.state === 'off') return;
      this.t += dt; const t = performance.now() / 1000;
      const fl = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 32)); this.wings[0].rotation.y = fl; this.wings[1].rotation.y = -fl;
      this.fairy.rotation.z = Math.sin(t * 3.1) * 0.1; this.fairy.rotation.y = Math.sin(t * 1.3) * 0.25; this.star.rotation.z += dt * 2;
      const halfW = Math.tan(camera.fov * Math.PI / 360) * 7 * camera.aspect, sx = Math.min(1, (halfW - 0.4) / 2.6);
      let ox = 0, oy = 0, sw = 0;
      if (this.state === 'in') { const k = Math.min(1, this.t / 0.85), e = 1 - Math.pow(1 - k, 3); ox = (1 - e) * 7; oy = (1 - e) * 5; sw = (1 - e) * 0.5; }
      else if (this.state === 'out') { const k = this.t / 1.5; ox = k * k * 5; oy = k * k * 9; sw = -k * 0.3; if (k >= 1) { this.hide(); return; } }
      this.rig.scale.set(sx, sx, 1); this.rig.position.set(ox, oy + Math.sin(t * 2.3) * 0.16, 0);
      this.sigPivot.rotation.z = Math.sin(t * 1.8) * 0.05 + sw; this.halo.material.opacity = 0.8 + 0.2 * Math.sin(t * 9);
      this.spark -= dt;
      if (this.spark <= 0) { this.spark = 0.05; const w = new THREE.Vector3(); this.fairy.getWorldPosition(w);
        Fx.spark(w.x + (Math.random() - 0.5) * 0.6, w.y - 0.3, w.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5, Math.random() < 0.5 ? 0xfff27a : 0xffffff, 0.08, 0.6); }
    }
  };

  // ================================ MINIMAPA ================================
  const Mini = {
    build(track, colors) {
      const c = $('mini'), MW = c.width, MH = c.height;
      this.c = c; this.g = c.getContext('2d'); this.colors = colors;
      const base = this.base = document.createElement('canvas'); base.width = MW; base.height = MH; const g = base.getContext('2d');
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; track.S.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, s = (MW - 64) / Math.max(x1 - x0, z1 - z0);
      const mm = this.mm = (x, z) => [MW / 2 - (x - cx) * s, MH / 2 - (z - cz) * s]; this.s = s;
      const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
      const bg = { classic: ['#bdeaa0', '#8fd47a'], city: ['#d8dcef', '#b8bed8'], beach: ['#7fd2ff', '#3aa8e8'] }[track.def.id];
      g.save(); rr(4, 4, MW - 8, MH - 8, 34); const gr = g.createLinearGradient(0, 0, 0, MH); gr.addColorStop(0, bg[0]); gr.addColorStop(1, bg[1]); g.fillStyle = gr; g.globalAlpha = 0.88; g.fill(); g.globalAlpha = 1; g.clip();
      track.minimap.forEach(e => {
        const poly = (pts, col) => { g.fillStyle = col; g.beginPath(); pts.forEach((p, k) => { const [a, b] = mm(p[0], p[1]); k ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); g.fill(); };
        if (e.type === 'island') poly(e.poly, '#ffe7a8');
        if (e.type === 'pond') poly(e.poly, '#3aa8ff');
        if (e.type === 'river') { g.lineJoin = g.lineCap = 'round'; g.strokeStyle = '#3aa8ff'; g.lineWidth = 14 * s; g.beginPath(); e.pts.forEach((p, k) => { const [a, b] = mm(p[0], p[1]); k ? g.lineTo(a, b) : g.moveTo(a, b); }); g.stroke(); }
        if (e.type === 'rail') { const [a, b] = mm(e.a[0], e.a[1]), [c2, d] = mm(e.b[0], e.b[1]); g.lineCap = 'butt'; g.strokeStyle = '#5a5c70'; g.lineWidth = 6; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke(); g.setLineDash([2, 4]); g.strokeStyle = '#e8e8f0'; g.lineWidth = 4; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke(); g.setLineDash([]); }
        if (e.type === 'building') { const [a, b] = mm(e.x, e.z); g.save(); g.translate(a, b); g.rotate(e.rot); g.fillStyle = 'rgba(120,128,170,.55)'; g.fillRect(-e.w * s / 2, -e.d * s / 2, e.w * s, e.d * s); g.restore(); }
      });
      g.restore();
      g.lineWidth = 6; g.strokeStyle = '#ffffff'; rr(4, 4, MW - 8, MH - 8, 34); g.stroke();
      const path = () => { g.beginPath(); for (let i = 0; i <= track.N; i += 2) { const q = track.S[i % track.N], [a, b] = mm(q.x, q.z); i ? g.lineTo(a, b) : g.moveTo(a, b); } g.closePath(); };
      g.lineJoin = g.lineCap = 'round'; path(); g.lineWidth = 20; g.strokeStyle = '#2a1d4a'; g.stroke(); path(); g.lineWidth = 13; g.strokeStyle = '#ffffff'; g.stroke();
      // trecho coberto (túnel): faixa escura por cima da pista
      track.minimap.filter(e => e.type === 'tunnel').forEach(e => { g.beginPath(); for (let i = e.from; i <= e.to; i++) { const q = track.S[i % track.N], [a, b] = mm(q.x, q.z); i === e.from ? g.moveTo(a, b) : g.lineTo(a, b); } g.lineCap = 'butt'; g.lineWidth = 20; g.strokeStyle = '#2a1d4a'; g.stroke(); g.lineWidth = 9; g.strokeStyle = '#7a80a8'; g.stroke(); });
      track.pads.forEach(p => { const [a, b] = mm(p.x, p.z); g.fillStyle = '#ff4ad8'; g.beginPath(); g.arc(a, b, 3.4, 0, 6.2832); g.fill(); });
      { const i = track.startIdx, q = track.S[i], t = track.T[i], W = track.W, [a, b] = mm(q.x - t.z * W, q.z + t.x * W), [c2, d] = mm(q.x + t.z * W, q.z - t.x * W);
        g.lineCap = 'butt'; g.lineWidth = 6; g.strokeStyle = '#2a1d4a'; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke(); g.setLineDash([3, 3]); g.lineWidth = 4; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke(); g.setLineDash([]); }
    },
    draw(player, bot) {
      if (!this.base) return; const g = this.g; g.clearRect(0, 0, this.c.width, this.c.height); g.drawImage(this.base, 0, 0);
      const dot = (k, col, r) => { const [x, y] = this.mm(k.pos.x, k.pos.z); g.fillStyle = col; g.strokeStyle = '#2a1d4a'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r + 3, 0, 6.2832); g.fillStyle = '#fff'; g.fill(); g.stroke(); g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); };
      // rivais: aceita um kart ou a lista dos 7 (cada um com a própria cor, k.mapColor)
      (Array.isArray(bot) ? bot : bot ? [bot] : []).forEach(k => dot(k, k.mapColor || this.colors.bot, 5));
      const [px, py] = this.mm(player.pos.x, player.pos.z);
      g.save(); g.translate(px, py); g.rotate(-player.ang); g.beginPath(); g.moveTo(0, -13); g.lineTo(10, 10); g.lineTo(0, 5); g.lineTo(-10, 10); g.closePath();
      g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = '#2a1d4a'; g.stroke(); g.lineWidth = 3.5; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = this.colors.player; g.fill(); g.restore();
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
      if (!this.el) return; const sp = Math.abs(k.speed) / CFG.PHYS.MAX, t = k.boostT > 0 ? 0.85 : Math.max(0, (sp - 0.82) * 2.5);
      this.v += (t - this.v) * 0.15; this.el.style.opacity = this.v.toFixed(2);
      if (this.v > 0.02) this.el.style.transform = 'rotate(' + (Math.random() * 360).toFixed(0) + 'deg) scale(' + (1 + Math.random() * 0.06).toFixed(3) + ')';
    }
  };

  const UI = {
    Sfx, Fairy, Mini, Records, fmt, SpeedLines,
    trackIdx: 0, mode: 'cup', diff: 'normal', laps: CFG.LAPS,
    init(h) {
      this.h = h;
      SpeedLines.init();
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
        if (e.code === 'KeyM') { Sfx.on = !Sfx.on; this.toast(Sfx.on ? 'Som ligado' : 'Som desligado'); }
        if (e.code === 'KeyR' && h.onRestart) h.onRestart();
        if (e.code === 'KeyN' && h.onNextHour) h.onNextHour();
      });
    },
    // ---------- modais (abrem com escala + fade; foco vai para o primeiro controle) ----------
    openModal(id) {
      if (this.modal) this.closeModal(true);
      const m = $(id); m.hidden = false; m.classList.remove('closing'); this.modal = id; this._lastFocus = document.activeElement;
      if (id === 'setup') { this.refreshTracks(); this.h.onSetupOpen && this.h.onSetupOpen(); }
      requestAnimationFrame(() => { const f = m.querySelector('.cta, button'); f && f.focus({ preventScroll: true }); });
      Sfx.tone(520, 780, 0.12, 'triangle', 0.06);
    },
    closeModal(instant) {
      const id = this.modal; if (!id) return; const m = $(id); this.modal = null;
      if (id === 'setup') this.h.onSetupClose && this.h.onSetupClose();
      if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) { m.hidden = true; return; }
      m.classList.add('closing'); setTimeout(() => { m.hidden = true; m.classList.remove('closing'); }, 220);
      if (this._lastFocus && this._lastFocus.focus) this._lastFocus.focus({ preventScroll: true });
    },
    // ---------- carregamento e abertura ----------
    bootProgress(p, note) { $('bootBar').style.width = Math.round(p * 100) + '%'; if (note) $('bootNote').textContent = note; },
    introPhase(ph) {   // 'film' | 'logo'
      document.body.classList.toggle('logoPhase', ph === 'logo'); document.body.classList.toggle('film', ph === 'film');
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
      if (name !== 'intro') { document.body.classList.remove('film', 'logoPhase'); if (prev === 'intro') this.introBlur(0); }
      if (name !== 'menu' && this.modal) this.closeModal(true);
      if (name === 'menu') this.refreshTracks();
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
    countNum(txt, go) {
      const el = $('cdnum'); el.textContent = txt; el.className = go ? 'go' : ''; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; el.hidden = !txt;
    },
    cupInfo(txt) { $('cupInfo').textContent = txt || ''; },
    _f: 0, _pos: 0,
    hud(player, bot, race) {
      const pos = race.position(player);
      if (pos !== this._pos) { const el = $('pos'); el.firstChild.textContent = pos; el.dataset.p = pos; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); this._pos = pos; }
      $('lap').textContent = 'Volta ' + Math.min(CFG.LAPS, Math.max(1, player.lap)) + '/' + CFG.LAPS;
      $('time').textContent = fmt(race.time);
      // os dois canvas do HUD são redesenhados a 30 quadros/s (metade do custo, diferença invisível)
      if ((this._f++ & 1) === 0) { drawSpeedo(player); Mini.draw(player, bot); }
      SpeedLines.step(player);
    },
    clock(dayT, nightF) {
      const hh = Math.floor(dayT * 24), mn = Math.floor((dayT * 24 - hh) * 60);
      $('clock').textContent = (nightF > 0.5 ? '🌙 ' : '☀️ ') + String(hh).padStart(2, '0') + ':' + String(mn).padStart(2, '0');
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
    round(info) {
      $('roundEyebrow').textContent = CFG.CUP.name + ' · corrida ' + info.round + ' de ' + info.total;
      $('roundTitle').textContent = info.trackName;
      this.table($('roundTable'), ['Nesta pista', 'Total'], info.rows);
      $('roundNote').textContent = info.note || '';
      $('btnNext').firstChild.textContent = info.last ? 'Ver pódio ' : 'Próxima pista ';
    },
    podium(info) {
      this.table($('results'), [info.cup ? 'Corridas' : 'Pista', info.cup ? 'Tempo total' : 'Tempo'], info.rows);
      const win = info.rows[0];
      $('podiumTitle').textContent = win.player ? (info.cup ? 'Você venceu a Copa!' : 'Vitória!') : win.name + ' venceu desta vez';
      $('podiumSub').textContent = win.player
        ? (info.cup ? 'Menor tempo somado nas três pistas. O troféu de ouro é seu.' : 'Primeiro lugar. O troféu é seu.')
        : (info.cup ? 'Na Copa vale a soma dos tempos: tente recuperar segundos com o mini-turbo nas curvas longas.' : 'Tente de novo: o drift com mini-turbo ganha muito tempo nas curvas longas.');
    }
  };
  window.UI = UI;
})();
