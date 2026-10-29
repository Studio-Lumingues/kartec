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
