// =====================================================================================
// speedo3d.js — velocímetro 3D do HUD (canto inferior direito)
//
// O medidor é um objeto 3D de verdade (geometria extrudada, estilo brinquedo de plástico com contorno
// de tinta), desenhado numa cena própria, com câmera própria, por cima do jogo e no mesmo <canvas> do
// Three.js. Ele fica preso à tela (segue a câmera do jogo) e "balança" com a física do kart:
//
//   * acelerar inclina o topo para trás e afasta o medidor; frear joga para a frente;
//   * curva: inércia empurra o medidor para fora da curva (gira, rola e desliza com mola);
//   * no ar ele flutua e, ao aterrissar, dá um tranco; turbo dá um soco para a frente + tremida;
//   * velocidade alta e terra/grama fazem o medidor vibrar.
//
// Uso (Three.js r128):
//   const speedo3d = Speedo3D.create(renderer, { el: '#speedo3d', unit: 'km/h', max: 160, camera });
//   // no loop, DEPOIS de renderer.render(scene, camera) (ou do composer):
//   speedo3d.update(dt, { speed, steer, boost, drift, airborne, offroad });
//   speedo3d.render();
//
// Campos do update (todos opcionais, menos speed):
//   speed     velocidade já na unidade mostrada (ex.: km/h). Negativa = ré.
//   max       velocidade que enche o arco (padrão: opts.max)
//   steer     -1 (esquerda) … 1 (direita). Sem ele, usa a rotação da câmera (opts.camera).
//   boost     true/false ou 0…1 (turbo ativo)
//   drift     0 nada · 1 carregando · 2 faísca azul · 3 faísca laranja
//   airborne  true quando o kart está no ar
//   offroad   true na grama/terra (vibra mais)
// =====================================================================================
(function () {
  'use strict';
  const T = window.THREE;
  if (!T) { console.warn('Speedo3D: THREE não encontrado'); return; }

  const DEG = Math.PI / 180;
  const A0 = 225 * DEG, A1 = -45 * DEG;            // arco de 270°, de baixo-esquerda a baixo-direita
  const SEGS = 24;
  const INK = 0x2a1d4a;

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const damp = (cur, to, rate, dt) => cur + (to - cur) * (1 - Math.exp(-rate * dt));

  // ---------- geometria ----------
  function sectorShape(r0, r1, a, b) {             // anel parcial, a < b (anti-horário)
    const s = new T.Shape();
    s.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
    s.absarc(0, 0, r1, a, b, false);
    s.lineTo(Math.cos(b) * r0, Math.sin(b) * r0);
    s.absarc(0, 0, r0, b, a, true);
    s.closePath();
    return s;
  }
  function ringShape(r0, r1) {
    const s = new T.Shape(); s.absarc(0, 0, r1, 0, Math.PI * 2, false);
    if (r0 > 0) { const h = new T.Path(); h.absarc(0, 0, r0, 0, Math.PI * 2, true); s.holes.push(h); }
    return s;
  }
  // extruda e devolve a malha com [tampa, lateral]; z0 = face de trás, a frente fica em z0 + depth + 2*bevel
  function extrude(shape, depth, bevel, capMat, sideMat, z0, curve) {
    const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: curve || 64 });
    g.translate(0, 0, z0 + bevel);
    const m = new T.Mesh(g, [capMat, sideMat]);
    m.userData.front = z0 + depth + bevel * 2;
    return m;
  }

  function create(renderer, opts) {
    opts = opts || {};
    const srgb = renderer.outputEncoding === T.sRGBEncoding;
    const col = hex => { const c = new T.Color(hex); return srgb ? c.convertSRGBToLinear() : c; };
    const basic = (hex, extra) => new T.MeshBasicMaterial(Object.assign({ color: col(hex), toneMapped: false }, extra || {}));

    const el = typeof opts.el === 'string' ? document.querySelector(opts.el) : (opts.el || document.getElementById('speedo3d'));
    let unit = opts.unit || 'km/h', maxSpeed = opts.max || 160;
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const MOT = reduce ? 0.35 : 1;

    const scene = new T.Scene();
    const cam = new T.PerspectiveCamera(50, 1, 0.1, 20);
    cam.position.set(0, 0, 3.8);
    const PAD = 1.6;                 // a área desenhada é 60% maior que a caixa do CSS: balançar nunca corta o medidor

    const rig = new T.Group();       // recebe a física (molas)
    const gauge = new T.Group();     // o medidor em si
    rig.add(gauge); scene.add(rig);

    const inkMat = basic(INK);

    // sombra "dura" do HUD (mesmo truque das pílulas: tinta deslocada para baixo)
    const shadow = new T.Mesh(new T.CircleGeometry(1.06, 64), basic(INK, { transparent: true, opacity: 0.35, depthWrite: false }));
    shadow.position.set(0.02, -0.09, -0.16); gauge.add(shadow);

    // brilho do turbo (atrás de tudo)
    const glowMat = basic(0xff7ae0, { transparent: true, opacity: 0, depthWrite: false });
    const glow = new T.Mesh(new T.RingGeometry(0.96, 1.2, 64), glowMat);
    glow.position.z = -0.14; gauge.add(glow);

    // corpo: disco roxo-escuro com contorno de tinta
    const bodyOutline = extrude(ringShape(0, 1.05), 0.12, 0.012, inkMat, inkMat, -0.13);
    gauge.add(bodyOutline);
    const body = extrude(ringShape(0, 1.0), 0.13, 0.02, basic(0x3b2a6e), basic(0x22173f), -0.12);
    gauge.add(body);

    // segmentos do arco
    const step = (A0 - A1) / SEGS, gap = 1.7 * DEG;
    const offCap = col(0x5a4a92), offSide = col(0x2e2257);
    const ramp = [[0, 0x2ee6a8], [0.5, 0xffd23f], [0.78, 0xff8a3d], [1, 0xff4d6d]].map(([t, h]) => [t, col(h)]);
    const rampAt = t => { for (let i = 1; i < ramp.length; i++) if (t <= ramp[i][0]) { const [ta, ca] = ramp[i - 1], [tb, cb] = ramp[i]; return ca.clone().lerp(cb, (t - ta) / (tb - ta)); } return ramp[ramp.length - 1][1].clone(); };
    const segs = [];
    for (let i = 0; i < SEGS; i++) {
      const hi = A0 - i * step - gap / 2, lo = A0 - (i + 1) * step + gap / 2;
      const cap = basic(0), side = basic(0);
      const m = extrude(sectorShape(0.785, 0.95, lo, hi), 0.045, 0.012, cap, side, body.userData.front - 0.03, 8);
      const lit = rampAt(i / (SEGS - 1));
      segs.push({ m, cap, side, lit, litSide: lit.clone().multiplyScalar(0.55), level: 0 });
      gauge.add(m);
    }
    const segFront = segs[0].m.userData.front;

    // marcadores pequenos no começo, meio e fim do arco
    [A0 + 1.5 * DEG, (A0 + A1) / 2, A1 - 1.5 * DEG].forEach(a => {
      const t = new T.Mesh(new T.CircleGeometry(0.028, 16), basic(0xffffff));
      t.position.set(Math.cos(a) * 0.985, Math.sin(a) * 0.985, body.userData.front + 0.002); gauge.add(t);
    });

    // aro dourado + mostrador branco
    const rimOutline = extrude(ringShape(0.6, 0.775), 0.12, 0.01, inkMat, inkMat, body.userData.front - 0.04);
    gauge.add(rimOutline);
    const rim = extrude(ringShape(0.625, 0.745), 0.13, 0.022, basic(0xffd23f), basic(0xd9861a), body.userData.front - 0.03);
    gauge.add(rim);
    const shine = new T.Mesh(new T.ShapeGeometry(sectorShape(0.66, 0.725, 105 * DEG, 165 * DEG), 24), basic(0xfff6c8));
    shine.position.z = rim.userData.front + 0.002; gauge.add(shine);
    const face = extrude(ringShape(0, 0.63), 0.08, 0.012, basic(0xffffff), basic(0xd9d0f5), body.userData.front - 0.03);
    gauge.add(face);

    // número (textura de canvas, redesenhada só quando muda)
    const cvs = document.createElement('canvas'); cvs.width = cvs.height = 512;
    const ctx = cvs.getContext('2d');
    const tex = new T.CanvasTexture(cvs);
    tex.encoding = renderer.outputEncoding; tex.anisotropy = 4;
    const label = new T.Mesh(new T.PlaneGeometry(1.26, 1.26), new T.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
    label.position.z = face.userData.front + 0.004; gauge.add(label);
    let drawnKey = '';
    function drawLabel(n, hot, rev) {
      const key = n + '|' + hot + '|' + rev + '|' + unit;
      if (key === drawnKey) return; drawnKey = key;
      ctx.clearRect(0, 0, 512, 512);
      const txt = String(n), fs = txt.length >= 3 ? 196 : 232;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
      ctx.font = fs + 'px "Titan One", "Fredoka", "Arial Rounded MT Bold", sans-serif';
      ctx.fillStyle = 'rgba(42,29,74,.16)'; ctx.fillText(txt, 256, 318);
      if (hot) {
        const g = ctx.createLinearGradient(0, 160, 0, 310);
        g.addColorStop(0, '#fff6a8'); g.addColorStop(.45, '#ffd23f'); g.addColorStop(.8, '#ff8a3d'); g.addColorStop(1, '#ff4d6d');
        ctx.lineWidth = 16; ctx.strokeStyle = '#2a1d4a'; ctx.strokeText(txt, 256, 306);
        ctx.fillStyle = g;
      } else ctx.fillStyle = '#2a1d4a';
      ctx.fillText(txt, 256, 306);
      ctx.font = '900 62px "Nunito", "Trebuchet MS", sans-serif';
      ctx.fillStyle = rev ? '#ff4d6d' : '#5d4f86';
      ctx.fillText(rev ? 'ré' : unit, 256, 392);
      tex.needsUpdate = true;
    }
    if (document.fonts && document.fonts.load) Promise.all([document.fonts.load('200px "Titan One"'), document.fonts.load('900 60px Nunito')]).then(() => { drawnKey = ''; }).catch(() => { });

    // bolinha que corre na ponta do arco (cor muda com a faísca do drift)
    const knobGroup = new T.Group(); gauge.add(knobGroup);
    const knobMat = basic(0xffffff);
    const knob = new T.Mesh(new T.SphereGeometry(0.068, 20, 14), knobMat);
    const knobLine = new T.Mesh(new T.SphereGeometry(0.094, 20, 14), basic(INK, { side: T.BackSide }));
    knobGroup.add(knobLine, knob);
    const white = col(0xffffff), pink = col(0xff7ae0);
    const sparkCol = [col(0xffffff), col(0xffffff), col(0x3dd6ff), col(0xff8a3d)];

    // ---------- física (molas) ----------
    const BASE = { rx: -0.2, ry: -0.42, rz: 0.06 };
    const spring = (x, k, c) => ({ x, v: 0, k, c });
    const S = { rx: spring(BASE.rx, 120, 12), ry: spring(BASE.ry, 110, 12), rz: spring(BASE.rz, 130, 11),
      px: spring(0, 100, 12), py: spring(0, 120, 11), pz: spring(0, 90, 10), sc: spring(1, 220, 14) };
    const step2 = (s, to, dt) => { s.v += (s.k * (to - s.x) - s.c * s.v) * dt; s.x += s.v * dt; };

    let t = 0, shown = 0, prevAbs = 0, acc = 0, lat = 0, frac = 0, wasAir = false, wasBoost = false, wasDrift = 0, boostAmt = 0, driftLvl = 0;
    let camPrevYaw = null;
    const camDir = new T.Vector3();

    function update(dt, s) {
      s = s || {};
      dt = clamp(+dt || 0, 0, 0.1);
      t += dt;
      if (s.max) maxSpeed = s.max;
      const spd = +s.speed || 0, abs = Math.abs(spd);
      const air = !!s.airborne, boost = typeof s.boost === 'number' ? s.boost : (s.boost ? 1 : 0);
      driftLvl = s.drift | 0;

      // aceleração (fração do máximo por segundo), suavizada
      if (dt > 0) { acc = damp(acc, clamp((abs - prevAbs) / dt / maxSpeed, -3, 3), 7, dt); prevAbs = abs; }

      // curva: steer explícito ou rotação da câmera do jogo
      let steer = s.steer;
      if (steer == null && opts.camera) {
        opts.camera.getWorldDirection(camDir);
        const yaw = Math.atan2(camDir.x, camDir.z);
        if (camPrevYaw != null && dt > 0) { let d = yaw - camPrevYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); steer = clamp(-d / dt / 1.6, -1, 1); }
        camPrevYaw = yaw;
      }
      frac = clamp(abs / maxSpeed, 0, 1.15);
      lat = damp(lat, clamp(steer || 0, -1, 1) * Math.min(1, frac * 1.4), 6, dt);

      // impulsos
      if (boost > 0.5 && !wasBoost) { S.pz.v += 3.5 * MOT; S.rz.v += (Math.random() < .5 ? -1 : 1) * 3.5 * MOT; S.sc.v += 3 * MOT; }
      if (wasAir && !air) { S.py.v -= 2.6 * MOT; S.rx.v += 3.2 * MOT; S.sc.v -= 2 * MOT; }
      if (driftLvl > wasDrift && driftLvl >= 2) { S.sc.v += 1.6 * MOT; }
      if (driftLvl >= 1 && wasDrift === 0) S.rz.v += Math.sign(lat || 1) * 1.8 * MOT;
      wasAir = air; wasBoost = boost > 0.5; wasDrift = driftLvl;
      boostAmt = damp(boostAmt, boost, boost > boostAmt ? 14 : 4, dt);

      // alvos: inércia para fora da curva, para trás ao acelerar
      const a = clamp(acc, -1.2, 1.2) * MOT, l = lat * MOT;
      const floatY = air ? 0.1 + Math.sin(t * 5.2) * 0.025 : Math.sin(t * 1.7) * 0.012 * MOT;
      const n = 2;
      for (let i = 0; i < n; i++) {
        const h = dt / n;
        step2(S.rx, BASE.rx - a * 0.32 + (air ? Math.sin(t * 3.1) * 0.06 * MOT : 0), h);
        step2(S.ry, BASE.ry + l * 0.3, h);
        step2(S.rz, BASE.rz + l * 0.22 + (air ? Math.sin(t * 2.3) * 0.05 * MOT : 0), h);
        step2(S.px, -l * 0.11, h);
        step2(S.py, floatY - a * 0.035, h);
        step2(S.pz, -a * 0.38 + boostAmt * 0.12 * MOT, h);
        step2(S.sc, 1 + boostAmt * 0.04, h);
      }

      // vibração: velocidade alta, fora da pista, turbo
      const amp = (0.0025 + frac * frac * 0.009 + (s.offroad ? 0.022 * Math.min(1, frac * 2) : 0) + boostAmt * 0.008) * MOT;
      const nz = (Math.sin(t * 53.1) + Math.sin(t * 77.7 + 1.3)) * 0.5, ny = (Math.sin(t * 61.3 + 2) + Math.sin(t * 89.1)) * 0.5;

      rig.rotation.set(S.rx.x + ny * amp * 0.6, S.ry.x, S.rz.x + nz * amp);
      rig.position.set(S.px.x, S.py.x + ny * amp * 0.8, S.pz.x);
      rig.scale.setScalar(S.sc.x);

      // arco, bolinha e número
      shown = damp(shown, abs, 14, dt);
      const f = clamp(shown / maxSpeed, 0, 1), fill = f * SEGS;
      const flick = boostAmt > 0.05 ? 0.5 + 0.5 * Math.sin(t * 30) : 0;
      for (let i = 0; i < SEGS; i++) {
        const sg = segs[i], lv = clamp(fill - i, 0, 1);
        sg.cap.color.copy(offCap).lerp(sg.lit, lv);
        sg.side.color.copy(offSide).lerp(sg.litSide, lv);
        if (lv > 0 && boostAmt > 0.05) sg.cap.color.lerp(((i + Math.floor(t * 18)) & 1) ? white : pink, boostAmt * 0.55 * flick);
      }
      const ang = A0 - f * (A0 - A1);
      knobGroup.position.set(Math.cos(ang) * 0.868, Math.sin(ang) * 0.868, segFront + 0.03);
      const sc = driftLvl >= 2 ? 1.15 + 0.12 * Math.sin(t * 24) : 1;
      knobGroup.scale.setScalar(sc);
      knobMat.color.copy(sparkCol[clamp(driftLvl, 0, 3)]);

      glowMat.opacity = boostAmt * (0.45 + 0.2 * Math.sin(t * 22));
      glow.scale.setScalar(1 + boostAmt * 0.04 + 0.02 * Math.sin(t * 17));

      drawLabel(Math.round(shown), boostAmt > 0.3, spd < -0.5);
    }

    // ---------- desenho por cima do jogo ----------
    let rect = null, frame = 0;
    const cr0 = new T.Vector4(), sc0 = new T.Vector4(), size = new T.Vector2();
    const measure = () => {
      if (!el) { rect = null; return; }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) { rect = null; return; }
      const c = renderer.domElement.getBoundingClientRect();
      renderer.getSize(size);
      const kx = size.x / (c.width || 1), ky = size.y / (c.height || 1);
      const w = r.width * kx * PAD, h = r.height * ky * PAD;
      rect = { x: (r.left - c.left) * kx - (w - r.width * kx) / 2, y: (c.bottom - r.bottom) * ky - (h - r.height * ky) / 2, w, h };
    };
    const onResize = () => { frame = 0; };
    window.addEventListener('resize', onResize);

    function render() {
      if ((frame++ % 20) === 0) measure();
      if (!rect || hidden) return;
      cam.aspect = rect.w / rect.h; cam.updateProjectionMatrix();
      const autoClear = renderer.autoClear, scis = renderer.getScissorTest();
      renderer.getViewport(cr0); renderer.getScissor(sc0);
      renderer.autoClear = false;
      renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
      renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
      renderer.setScissorTest(true);
      renderer.clearDepth();
      renderer.render(scene, cam);
      renderer.setViewport(cr0); renderer.setScissor(sc0); renderer.setScissorTest(scis);
      renderer.autoClear = autoClear;
    }

    let hidden = false;
    return {
      update, render, scene, camera: cam,
      setVisible(v) { hidden = !v; },
      setUnit(u) { unit = u; drawnKey = ''; },
      setMax(m) { maxSpeed = m; },
      dispose() {
        window.removeEventListener('resize', onResize);
        scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); });
        tex.dispose();
      }
    };
  }

  window.Speedo3D = { create };
})();
