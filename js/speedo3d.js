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
  const INK = 0x202022;

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
    const glow0 = glowMat.color.clone();
    const glow = new T.Mesh(new T.RingGeometry(0.96, 1.2, 64), glowMat);
    glow.position.z = -0.14; gauge.add(glow);

    // corpo: disco roxo-escuro com contorno de tinta
    const bodyOutline = extrude(ringShape(0, 1.035), 0.04, 0.006, inkMat, inkMat, -0.05);
    gauge.add(bodyOutline);
    const body = extrude(ringShape(0, 1.0), 0.045, 0.008, basic(0x303033), basic(0x1c1c1e), -0.045);
    gauge.add(body);

    // segmentos do arco
    const step = (A0 - A1) / SEGS, gap = 1.7 * DEG;
    const offCap = col(0x4a4a4e), offSide = col(0x2a2a2d);
    const ramp = [[0, 0x2ee6a8], [0.5, 0xffd23f], [0.78, 0xff8a3d], [1, 0xff4d6d]].map(([t, h]) => [t, col(h)]);
    const rampAt = t => { for (let i = 1; i < ramp.length; i++) if (t <= ramp[i][0]) { const [ta, ca] = ramp[i - 1], [tb, cb] = ramp[i]; return ca.clone().lerp(cb, (t - ta) / (tb - ta)); } return ramp[ramp.length - 1][1].clone(); };
    const segs = [];
    for (let i = 0; i < SEGS; i++) {
      const hi = A0 - i * step - gap / 2, lo = A0 - (i + 1) * step + gap / 2;
      const cap = basic(0), side = basic(0);
      const m = extrude(sectorShape(0.8, 0.945, lo, hi), 0.016, 0.005, cap, side, body.userData.front - 0.01, 8);
      const lit = rampAt(i / (SEGS - 1));
      segs.push({ m, cap, side, lit, litSide: lit.clone().multiplyScalar(0.55), level: 0 });
      gauge.add(m);
    }
    const segFront = segs[0].m.userData.front;

    // marcadores pequenos no começo, meio e fim do arco
    // (as bolinhas brancas do começo, meio e fim do arco foram removidas)

    // aro dourado + mostrador branco
    const rimOutline = extrude(ringShape(0.625, 0.76), 0.04, 0.006, inkMat, inkMat, body.userData.front - 0.02);
    gauge.add(rimOutline);
    const rimCap = basic(0xffd23f), rimSide = basic(0xd9861a), rimCap0 = rimCap.color.clone(), rimSide0 = rimSide.color.clone();
    const rim = extrude(ringShape(0.645, 0.74), 0.045, 0.008, rimCap, rimSide, body.userData.front - 0.01);
    gauge.add(rim);
    const shineMat = basic(0xfff6c8), shine0 = shineMat.color.clone();
    const shine = new T.Mesh(new T.ShapeGeometry(sectorShape(0.672, 0.715, 105 * DEG, 165 * DEG), 24), shineMat);
    shine.position.z = rim.userData.front + 0.002; gauge.add(shine);
    const face = extrude(ringShape(0, 0.65), 0.025, 0.006, basic(0xffffff), basic(0xd4d4d6), body.userData.front - 0.01);
    gauge.add(face);

    // número (textura de canvas, redesenhada só quando muda)
    const cvs = document.createElement('canvas'); cvs.width = cvs.height = 512;
    const ctx = cvs.getContext('2d');
    const tex = new T.CanvasTexture(cvs);
    tex.encoding = renderer.outputEncoding; tex.anisotropy = 4;
    const label = new T.Mesh(new T.PlaneGeometry(1.3, 1.3), new T.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
    label.position.z = face.userData.front + 0.004; gauge.add(label);
    let drawnKey = '';
    function drawLabel(n, hot, rev) {
      const key = n + '|' + hot + '|' + rev + '|' + unit;
      if (key === drawnKey) return; drawnKey = key;
      ctx.clearRect(0, 0, 512, 512);
      const txt = String(n), fs = txt.length >= 3 ? 196 : 232;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
      ctx.font = fs + 'px "Titan One", "Fredoka", "Arial Rounded MT Bold", sans-serif';
      ctx.fillStyle = 'rgba(40,40,40,.16)'; ctx.fillText(txt, 256, 318);
      if (hot) {
        const g = ctx.createLinearGradient(0, 160, 0, 310);
        g.addColorStop(0, '#fff6a8'); g.addColorStop(.45, '#ffd23f'); g.addColorStop(.8, '#ff8a3d'); g.addColorStop(1, '#ff4d6d');
        ctx.lineWidth = 16; ctx.strokeStyle = '#202022'; ctx.strokeText(txt, 256, 306);
        ctx.fillStyle = g;
      } else ctx.fillStyle = '#202022';
      ctx.fillText(txt, 256, 306);
      ctx.font = '900 62px "Nunito", "Trebuchet MS", sans-serif';
      ctx.fillStyle = rev ? '#ff4d6d' : '#5a5a5e';
      ctx.fillText(rev ? 'ré' : unit, 256, 392);
      tex.needsUpdate = true;
    }
    if (document.fonts && document.fonts.load) Promise.all([document.fonts.load('200px "Titan One"'), document.fonts.load('900 60px Nunito')]).then(() => { drawnKey = ''; }).catch(() => { });

    // bolinha que corre na ponta do arco (cor muda com a faísca do drift)
    const knobGroup = new T.Group(); gauge.add(knobGroup);
    const knobMat = basic(0xffffff);
    const knob = new T.Mesh(new T.SphereGeometry(0.055, 20, 14), knobMat);
    const knobLine = new T.Mesh(new T.SphereGeometry(0.075, 20, 14), basic(INK, { side: T.BackSide }));
    knobGroup.add(knobLine, knob); knobGroup.visible = false;   // bolinha do arco removida a pedido
    const white = col(0xffffff), pink = col(0xff7ae0);
    const sparkCol = [col(0xffffff), col(0xffffff), col(0x3dd6ff), col(0xff8a3d)];

    // ---------- física (molas) ----------
    const BASE = { rx: -0.2, ry: -0.42, rz: 0.06 };
    const spring = (x, k, c) => ({ x, v: 0, k, c });
    const S = { rx: spring(BASE.rx, 120, 12), ry: spring(BASE.ry, 110, 12), rz: spring(BASE.rz, 130, 11),
      px: spring(0, 100, 12), py: spring(0, 120, 11), pz: spring(0, 90, 10), sc: spring(1, 220, 14) };
    const step2 = (s, to, dt) => { s.v += (s.k * (to - s.x) - s.c * s.v) * dt; s.x += s.v * dt; };

    let t = 0, shown = 0, shownFr = 0, prevFr = 0, acc = 0, lat = 0, frac = 0, wasAir = false, wasBoost = false, wasDrift = 0, boostAmt = 0, driftLvl = 0, rb = 0;   // rb: 0…1, força do arco-íris quando a barra de drift chega em 3/3
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
      // fill: fração 0…1 do arco (opcional; sem ele, speed / max)
      const fr = s.fill != null ? clamp(+s.fill || 0, 0, 1.15) : clamp(abs / maxSpeed, 0, 1.15);
      if (dt > 0) { acc = damp(acc, clamp((fr - prevFr) / dt, -3, 3), 7, dt); prevFr = fr; }

      // curva: steer explícito ou rotação da câmera do jogo
      let steer = s.steer;
      if (steer == null && opts.camera) {
        opts.camera.getWorldDirection(camDir);
        const yaw = Math.atan2(camDir.x, camDir.z);
        if (camPrevYaw != null && dt > 0) { let d = yaw - camPrevYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); steer = clamp(-d / dt / 1.6, -1, 1); }
        camPrevYaw = yaw;
      }
      frac = fr;
      lat = damp(lat, clamp(steer || 0, -1, 1) * Math.min(1, frac * 1.4), 6, dt);

      // impulsos
      if (boost > 0.5 && !wasBoost) { S.pz.v += 3.5 * MOT; S.rz.v += (Math.random() < .5 ? -1 : 1) * 1.5 * MOT; S.sc.v += 3 * MOT; }
      if (wasAir && !air) { S.py.v -= 2.6 * MOT; S.rx.v += 3.2 * MOT; S.sc.v -= 2 * MOT; }
      if (driftLvl > wasDrift && driftLvl >= 2) { S.sc.v += 1.6 * MOT; }
      if (driftLvl >= 1 && wasDrift === 0) S.rz.v -= Math.sign(lat || 1) * 0.6 * MOT;
      wasAir = air; wasBoost = boost > 0.5; wasDrift = driftLvl;
      boostAmt = damp(boostAmt, boost, boost > boostAmt ? 14 : 4, dt);

      // alvos: inércia para fora da curva, para trás ao acelerar
      const a = clamp(acc, -1.2, 1.2) * MOT, l = lat * MOT;
      const floatY = air ? 0.1 + Math.sin(t * 5.2) * 0.025 : Math.sin(t * 1.7) * 0.012 * MOT;
      const n = 2;
      for (let i = 0; i < n; i++) {
        const h = dt / n;
        step2(S.rx, BASE.rx - a * 0.32 + (air ? Math.sin(t * 3.1) * 0.06 * MOT : 0), h);
        step2(S.ry, BASE.ry - l * 0.1, h);
        step2(S.rz, BASE.rz - l * 0.07 + (air ? Math.sin(t * 2.3) * 0.05 * MOT : 0), h);
        step2(S.px, l * 0.04, h);
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
      shown = damp(shown, abs, 14, dt); shownFr = damp(shownFr, fr, 14, dt);
      const f = clamp(shownFr, 0, 1), fill = f * SEGS;
      const flick = boostAmt > 0.05 ? 0.5 + 0.5 * Math.sin(t * 30) : 0;
      // barra de drift cheia (3/3): o hue do velocímetro gira muito rápido (~3 voltas por segundo)
      rb = damp(rb, s.full ? 1 : 0, s.full ? 16 : 8, dt);
      const hh = rb > 0.01 ? (t * 3) % 1 : 0;
      for (let i = 0; i < SEGS; i++) {
        const sg = segs[i], lv = clamp(fill - i, 0, 1);
        sg.cap.color.copy(offCap).lerp(sg.lit, lv);
        sg.side.color.copy(offSide).lerp(sg.litSide, lv);
        if (lv > 0 && boostAmt > 0.05) sg.cap.color.lerp(((i + Math.floor(t * 18)) & 1) ? white : pink, boostAmt * 0.55 * flick);
        if (hh > 0 && lv > 0) { sg.cap.color.offsetHSL(hh, 0, 0); sg.side.color.offsetHSL(hh, 0, 0); }
      }
      rimCap.color.copy(rimCap0); rimSide.color.copy(rimSide0); shineMat.color.copy(shine0);
      if (hh > 0) { rimCap.color.offsetHSL(hh, 0, 0); rimSide.color.offsetHSL(hh, 0, 0); shineMat.color.offsetHSL(hh, 0, 0); glowMat.color.setHSL(hh, 1, 0.65); } else glowMat.color.copy(glow0);
      const ang = A0 - f * (A0 - A1);
      knobGroup.position.set(Math.cos(ang) * 0.868, Math.sin(ang) * 0.868, segFront + 0.02);
      const sc = driftLvl >= 2 ? 1.15 + 0.12 * Math.sin(t * 24) : 1;
      knobGroup.scale.set(sc, sc, sc * 0.45);
      knobMat.color.copy(sparkCol[clamp(driftLvl, 0, 3)]);

      glowMat.opacity = boostAmt * (0.45 + 0.2 * Math.sin(t * 22));
      glow.scale.setScalar(1 + boostAmt * 0.04 + 0.02 * Math.sin(t * 17));

      drawLabel(Math.round(shown), boostAmt > 0.3, spd < -0.5);
    }

    // ---------- desenho por cima do jogo ----------
    let rect = null, frame = 0;
    const cr0 = new T.Vector4(), sc0 = new T.Vector4(), size = new T.Vector2();
    const measure = () => {
      let r = el && el.getBoundingClientRect();
      if (!r || r.width < 2 || r.height < 2) {
        // sem a caixa #speedo3d (ou escondida): no modo ligado à mão usa o canto inferior direito mesmo assim
        if (!opts.fallback) { rect = null; return; }
        const sz = clamp(Math.min(innerWidth, innerHeight) * 0.26, 150, 280);
        r = { left: innerWidth - sz - 14, bottom: innerHeight - 12, width: sz, height: sz };
      }
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
      if (!announced) { announced = true; console.info('[velocímetro 3D] ativo'); }
      renderer.setViewport(cr0); renderer.setScissor(sc0); renderer.setScissorTest(scis);
      renderer.autoClear = autoClear;
    }

    let hidden = false, announced = false;
    return {
      update, render, scene, camera: cam,
      setVisible(v) { hidden = !v; },
      setUnit(u) { unit = u; drawnKey = ''; },
      setMax(m) { maxSpeed = m; },
      setCamera(c) { if (c !== opts.camera) { opts.camera = c; camPrevYaw = null; } },
      dispose() {
        window.removeEventListener('resize', onResize);
        scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); });
        tex.dispose();
      }
    };
  }

  // =====================================================================================
  // BARRA DE TURBO 3D (centro inferior da tela)
  // Três cápsulas que enchem durante o drift; visível só enquanto o drift é segurado.
  // Perspectiva só na vertical: a barra "deita" para trás (gira só no eixo X).
  //   const bar = Speedo3D.createBoostBar(renderer, { el: '#boost3d' });
  //   bar.update(dt, { charge, show, dir, steer, speed, air, offroad, boost });
  //     charge 0…3 (seção enchendo) · show = drift seguro (aparece/some) · dir = lado do drift (-1 esq., 1 dir.)
  //     steer -1…1 (inércia da curva) · speed 0…1 (fração da velocidade) · air/offroad/boost = estado do kart
  //   bar.render();
  // =====================================================================================
  function rrectShape(x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    const s = new T.Shape();
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
    s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
  }

  function makeBoostRig(renderer, opts) {
    // Barra de turbo: lâmina de vidro escuro com aro branco e 3 células que enchem (amarelo → laranja → rosa).
    // Movimento: a barra tem mola própria e reage ao kart (aceleração, curva, pouso, terra, turbo) e ao LADO do drift:
    // drift para a direita = barra à direita da cabeça, enchendo da esquerda para a direita;
    // drift para a esquerda = barra espelhada, à esquerda da cabeça, enchendo da direita para a esquerda.
    opts = opts || {};
    const srgb = renderer.outputEncoding === T.sRGBEncoding;
    const col = hex => { const c = new T.Color(hex); return srgb ? c.convertSRGBToLinear() : c; };
    const mats = [];
    const mat = (hex, o, extra) => { const m = new T.MeshBasicMaterial(Object.assign({ color: col(hex), transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false }, extra || {})); m.userData.o = o; mats.push(m); return m; };
    const el = typeof opts.el === 'string' ? document.querySelector(opts.el) : (opts.el || document.getElementById('boost3d'));
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const MOT = reduce ? 0.35 : 1;

    const scene = new T.Scene();
    const cam = new T.PerspectiveCamera(30, 4, 0.1, 30);
    // tilt: molas (balanço, inércia, tranco) · flip: espelha conforme o lado do drift · bar: inclinação fixa + cisalhamento
    const tilt = new T.Group(), flip = new T.Group(), bar = new T.Group();
    tilt.add(flip); flip.add(bar); scene.add(tilt);

    // ---- geometria base (lâmina reta; o cisalhamento em `bar` deixa as pontas inclinadas) ----
    const W = 3.6, H = 0.30, TIP = 0.06, XL = -W / 2, XR = W / 2;
    const SHEAR = 0.46;
    bar.matrixAutoUpdate = false;
    bar.matrix.makeRotationZ(0.3).multiply(new T.Matrix4().set(1, SHEAR, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
    const P = [[XL, TIP], [XL, -TIP], [XR, -H / 2], [XR, H / 2]];          // topo-esq, base-esq, base-dir, topo-dir: fina na esquerda, cresce até a direita
    function offsetPoly(pts, d) {
      const n = pts.length, lines = [];
      for (let k = 0; k < n; k++) {
        const a = pts[k], b = pts[(k + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
        const nx = dy / len, ny = -dx / len;
        lines.push([a[0] + nx * d, a[1] + ny * d, dx, dy]);
      }
      return lines.map((l1, k) => {
        const l0 = lines[(k + n - 1) % n], det = l0[2] * l1[3] - l0[3] * l1[2];
        const t = ((l1[0] - l0[0]) * l1[3] - (l1[1] - l0[1]) * l1[2]) / det;
        return [l0[0] + l0[2] * t, l0[1] + l0[3] * t];
      });
    }
    const shapeOf = pts => { const sh = new T.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) sh.lineTo(pts[k][0], pts[k][1]); sh.closePath(); return sh; };
    const place = (geo, m, z) => { const o = new T.Mesh(geo, m); o.position.z = z; o.renderOrder = Math.round(z * 10000); bar.add(o); return o; };
    const flat = (pts, m, z) => place(new T.ShapeGeometry(shapeOf(pts), 8), m, z);
    const edgeY = (a, b, x) => a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]));

    const inner = offsetPoly(P, -0.035);
    const in0x = inner[0][0], in3x = inner[3][0];
    const topY = x => edgeY(inner[0], inner[3], x), botY = x => edgeY(inner[1], inner[2], x);
    const yMid = x => (topY(x) + botY(x)) / 2;

    // faixa de malha entre xa e xb, de f0 a f1 da altura local (para ter cor por vértice)
    function mkStrip(xa, xb, f0, f1, n, withColor) {
      const pos = new Float32Array((n + 1) * 6), idx = [];
      for (let j = 0; j <= n; j++) {
        const x = xa + (xb - xa) * j / n, yt = topY(x), yb = botY(x), h = yt - yb;
        pos.set([x, yb + h * f0, 0, x, yb + h * f1, 0], j * 6);
      }
      for (let j = 0; j < n; j++) { const a = 2 * j; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(idx);
      if (withColor) g.setAttribute('color', new T.BufferAttribute(new Float32Array((n + 1) * 6), 3));
      return g;
    }

    // ---- camadas (de trás para frente): aura · contorno de tinta · aro branco · trilho de vidro · células ----
    // glow suave (luz difusa, sem borda) atrás da barra: só acende quando ela está no hue de cores (3/3)
    const glowTex = (() => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.6)'); gr.addColorStop(0.65, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
        const tx = new T.CanvasTexture(c); if (srgb) tx.encoding = T.sRGBEncoding; return tx;
      } catch (e) { return null; }
    })();
    const glowM = mat(0xffffff, 0, { map: glowTex, blending: T.AdditiveBlending });
    if (glowTex) { const gm = place(new T.PlaneGeometry(W + 1.5, 1.5), glowM, 0.0005); gm.position.x = 0.15; }
    flat(offsetPoly(P, 0.085), mat(0x15151a, 1), 0.001);
    flat(offsetPoly(P, 0.042), mat(0xffffff, 0.96), 0.002);
    flat(offsetPoly(P, 0.008), mat(0x1d1e29, 0.96), 0.003);
    // marcas de escala no trilho vazio (dão ritmo à barra enquanto ela está vazia)
    const tickM = mat(0xffffff, 0.07);
    for (let k = 1; k < 18; k++) { if (k % 6 === 0) continue; const x = in0x + (in3x - in0x) * k / 18; if (topY(x) - botY(x) < 0.12) continue; flat([[x - 0.012, topY(x) - 0.03], [x + 0.012, topY(x) - 0.03], [x + 0.012, botY(x) + 0.03], [x - 0.012, botY(x) + 0.03]], tickM, 0.0035); }

    const COLS = [[0xfff07a, 0xffc22e], [0xffb347, 0xff6b3d], [0xff6fa8, 0xd23cff]];   // início → fim de cada célula
    const xs = [0, 1, 2, 3].map(i => in0x + (in3x - in0x) * i / 3);
    const secs = [];
    const NSEG = 14;
    for (let i = 0; i < 3; i++) {
      const xa = xs[i], xb = xs[i + 1];
      const wR = new T.Plane(), plR = new T.Plane(new T.Vector3(-1, 0, 0), -99);          // mantém x <= limite (parte enchida)
      const geo = mkStrip(xa, xb, 0, 1, NSEG, true);
      const fillM = mat(0xffffff, 1, { vertexColors: true, clippingPlanes: [wR] });
      place(geo, fillM, 0.004);
      const ga = Math.max(xa, in0x + 0.1), gb = Math.min(xb, in3x - 0.14);
      const glossM = mat(0xffffff, 0.3, { clippingPlanes: [wR] });
      place(mkStrip(ga, gb, 0.6, 0.9, 8, false), glossM, 0.005);
      const flashM = mat(0xffffff, 0);
      place(mkStrip(xa, xb, 0, 1, 2, false), flashM, 0.006);
      secs.push({ xa, xb, plR, wR, geo, flashM, ca: col(COLS[i][0]), cb: col(COLS[i][1]), lvl: 0, f: 0, limit: -99 });
    }
    // divisórias brancas entre as seções (ligam o aro de cima ao de baixo, como paredes das células)
    [xs[1], xs[2]].forEach(x => {
      const top = edgeY(P[0], P[3], x) + 0.02, bot = edgeY(P[1], P[2], x) - 0.02, dw = 0.055;
      flat([[x - dw / 2, top], [x + dw / 2, top], [x + dw / 2, bot], [x - dw / 2, bot]], mat(0xffffff, 1), 0.007);
    });
    // faísca na ponta do enchimento
    const sparkHalo = mat(0xffffff, 0), sparkCore = mat(0xffffff, 0);
    const haloMesh = place(new T.CircleGeometry(0.3, 24), sparkHalo, 0.0075), coreMesh = place(new T.CircleGeometry(0.1, 20), sparkCore, 0.008);

    const tA = new T.Color(), tB = new T.Color(), tC = new T.Color();
    function paint(sc, hs, t, shine) {                                    // cor por vértice: degradê + reflexo que corre pela barra
      const p = sc.geo.attributes.position, c = sc.geo.attributes.color;
      tA.copy(sc.ca); tB.copy(sc.cb);
      if (hs) { tA.offsetHSL(hs, 0, 0); tB.offsetHSL(hs, 0, 0); }
      const sx = in0x - 0.5 + ((t * 1.25) % 1.5) * (in3x - in0x + 1);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), top = i & 1;
        const u = clamp((x - sc.xa) / (sc.xb - sc.xa), 0, 1);
        tC.copy(tA).lerp(tB, u);
        const k = top ? 1.1 : 0.8, d = (x - sx) / 0.28, b = shine * 0.5 * Math.exp(-d * d);
        c.setXYZ(i, tC.r * k + b, tC.g * k + b, tC.b * k + b);
      }
      c.needsUpdate = true;
    }
    const setHue = (m, h) => { m.color.setHSL(h, 1, 0.55); if (srgb) m.color.convertSRGBToLinear(); };

    // ---- molas ----
    const sp = (k, c) => ({ x: 0, v: 0, k, c });
    const S = { px: sp(110, 12), py: sp(130, 11), rx: sp(120, 12), ry: sp(100, 11), rz: sp(130, 10), sc: sp(220, 14) };
    const stp = (s, to, h) => { s.v += (s.k * (to - s.x) - s.c * s.v) * h; s.x += s.v * h; };
    const fitW = W + 1.0;
    let t = 0, show = 0, last = 0, sd = 1, dirPrev = 1, lat = 0, acc = 0, prevFr = 0, wasAir = false, wasBoost = false, boostAmt = 0, rb = 0, sparkAmt = 0;
    const kick = { x: 0, v: 0 };

    function update(dt, s) {
      s = s || {}; dt = clamp(+dt || 0, 0, 0.1); t += dt;
      const charge = clamp(+s.charge || 0, 0, 3), on = !!s.show, air = !!s.air;
      const dir = (+s.dir) < 0 ? -1 : 1;
      const fr = clamp(+s.speed || 0, 0, 1.2);
      const boost = s.boost ? 1 : 0;

      const wasShow = show;
      show = damp(show, on ? 1 : 0, on ? 14 : (s.fast ? 28 : 10), dt);
      if (on && wasShow < 0.04) { sd = dir; dirPrev = dir; }          // ao aparecer já nasce do lado certo
      if (dir !== dirPrev) {                                          // trocou o lado do drift: a barra gira para o outro lado
        dirPrev = dir;
        if (on) { S.px.v += dir * 3.2 * MOT; S.rz.v += dir * 2.2 * MOT; S.ry.v += dir * 2.5 * MOT; S.sc.v += 1.6 * MOT; kick.v += 1.5 * MOT; }
      }
      sd = damp(sd, dir, 20, dt);
      flip.scale.x = Math.abs(sd) < 0.12 ? (sd < 0 ? -0.12 : 0.12) : sd;

      if (dt > 0) { acc = damp(acc, clamp((fr - prevFr) / dt, -3, 3), 7, dt); prevFr = fr; }
      lat = damp(lat, clamp(+s.steer || 0, -1, 1) * Math.min(1, fr * 1.4), 6, dt);
      boostAmt = damp(boostAmt, boost, boost > boostAmt ? 14 : 4, dt);
      if (boost && !wasBoost) { S.sc.v += 3 * MOT; S.px.v += dir * 2 * MOT; S.rz.v += -dir * 1.2 * MOT; }
      if (wasAir && !air) { S.py.v -= 2.8 * MOT; S.rx.v += 3 * MOT; S.sc.v -= 2 * MOT; }   // pouso: a barra "afunda" e volta
      wasAir = air; wasBoost = !!boost;

      const full = on && charge >= 2.999;
      rb = damp(rb, full ? 1 : 0, full ? 16 : 8, dt);
      const hs = rb > 0.01 ? (t * 2.4) % 1 : 0;
      const fl = Math.floor(charge + 1e-6);
      if (on && fl > last) for (let i = last; i < fl && i < 3; i++) { secs[i].f = 1; kick.v += 2.5 * MOT; S.sc.v += 1.3 * MOT; }
      last = on ? fl : 0;

      secs.forEach((sc, i) => {
        const target = on ? clamp(charge - i, 0, 1) : sc.lvl;
        sc.lvl = damp(sc.lvl, target, 16, dt);
        sc.limit = sc.lvl < 0.004 ? -99 : (sc.lvl > 0.996 ? 99 : sc.xa + (sc.xb - sc.xa) * sc.lvl);
        sc.plR.constant = sc.limit;
        sc.f = Math.max(0, sc.f - dt * 2.8);
        sc.flashM.userData.o = sc.f * 0.8;
        paint(sc, hs, t, on && charge > 0 ? 1 : 0);
      });

      // faísca na frente do enchimento
      const ai = Math.min(2, fl), asec = secs[ai];
      const sparkOn = on && charge < 2.999 && asec.lvl > 0.03 && asec.lvl < 0.97;
      sparkAmt = damp(sparkAmt, sparkOn ? 1 : 0, 22, dt);
      const sx = asec.xa + (asec.xb - asec.xa) * asec.lvl, pul = 1 + 0.22 * Math.sin(t * 22);
      coreMesh.position.set(sx, yMid(sx), 0.008); haloMesh.position.set(sx, yMid(sx), 0.0075);
      const fk = 0.45 + 0.55 * clamp((topY(sx) - botY(sx)) / (topY(in3x) - botY(in3x)), 0, 1);
      coreMesh.scale.setScalar(pul * fk); haloMesh.scale.setScalar(pul * fk * (0.9 + 0.2 * Math.sin(t * 15)));
      sparkCore.userData.o = sparkAmt; sparkHalo.userData.o = sparkAmt * 0.35;
      sparkHalo.color.copy(asec.cb);
      // aura quando a barra está cheia (3/3)
      glowM.userData.o = rb * (0.85 + 0.15 * Math.sin(t * 14));
      if (hs) setHue(glowM, hs); else glowM.color.set(0xffffff);

      // movimento: inércia para fora da curva, inclina para trás ao acelerar, vibra com velocidade/terra/turbo/carga
      const a = clamp(acc, -1.2, 1.2) * MOT, l = lat * MOT;
      const floatY = air ? 0.12 + Math.sin(t * 5.2) * 0.03 : Math.sin(t * 1.9) * 0.014 * MOT;
      for (let i = 0; i < 2; i++) {
        const h = dt / 2;
        stp(S.px, -l * 0.24, h);
        stp(S.py, floatY - a * 0.07, h);
        stp(S.rx, -a * 0.28 + (air ? Math.sin(t * 3.1) * 0.07 * MOT : 0), h);
        stp(S.ry, -l * 0.32, h);
        stp(S.rz, -l * 0.12 + (air ? Math.sin(t * 2.3) * 0.06 * MOT : 0), h);
        stp(S.sc, 1 + boostAmt * 0.05 + rb * 0.03, h);
      }
      kick.v += (200 * -kick.x - 15 * kick.v) * dt; kick.x += kick.v * dt;
      const cf = charge / 3;
      const amp = (0.003 + fr * fr * 0.012 + (s.offroad ? 0.03 * Math.min(1, fr * 2) : 0) + boostAmt * 0.01 + cf * cf * 0.008 + rb * 0.01) * MOT;
      const nz = (Math.sin(t * 53.1) + Math.sin(t * 77.7 + 1.3)) * 0.5, ny = (Math.sin(t * 61.3 + 2) + Math.sin(t * 89.1)) * 0.5;
      tilt.rotation.set(S.rx.x + ny * amp * 0.8, S.ry.x, S.rz.x + nz * amp * 1.2);
      tilt.position.set(S.px.x + nz * amp * 0.6, S.py.x + ny * amp + (1 - show) * -0.35 + kick.x * 0.03, 0);
      tilt.scale.setScalar((0.9 + show * 0.1) * S.sc.x + kick.x * 0.03);
      mats.forEach(m => m.opacity = m.userData.o * show);
    }

    let rect = null, frame = 0, frozen = false;
    const cr0 = new T.Vector4(), sc0 = new T.Vector4(), size = new T.Vector2();
    const PADX = 1.25, PADY = 2.8;
    function measure() {
      let r = el && el.getBoundingClientRect();
      if (!r || r.width < 2 || r.height < 2) {
        const w = clamp(innerWidth * 0.26, 220, 360), h = w * 0.16;
        r = { left: (innerWidth - w) / 2, bottom: innerHeight - 60, width: w, height: h };
      }
      const c = renderer.domElement.getBoundingClientRect(); renderer.getSize(size);
      const kx = size.x / (c.width || 1), ky = size.y / (c.height || 1);
      const w = r.width * kx * PADX, h = r.height * ky * PADY;
      rect = { x: (r.left - c.left) * kx - (w - r.width * kx) / 2, y: (c.bottom - r.bottom) * ky - (h - r.height * ky) / 2, w, h };
    }
    window.addEventListener('resize', () => { frame = 0; });
    function render() {
      if (!frozen && (frame++ % 20) === 0) measure();
      if (!rect || show < 0.01) return;
      cam.aspect = rect.w / rect.h;
      cam.position.set(0, 0, (fitW * PADX / 2) / (Math.tan(cam.fov * DEG / 2) * cam.aspect));
      cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
      scene.updateMatrixWorld(true);
      secs.forEach(sc => sc.wR.copy(sc.plR).applyMatrix4(bar.matrixWorld));
      const autoClear = renderer.autoClear, scis = renderer.getScissorTest(), lc = renderer.localClippingEnabled;
      renderer.getViewport(cr0); renderer.getScissor(sc0);
      renderer.autoClear = false; renderer.localClippingEnabled = true;
      renderer.setViewport(rect.x, rect.y, rect.w, rect.h); renderer.setScissor(rect.x, rect.y, rect.w, rect.h); renderer.setScissorTest(true);
      renderer.render(scene, cam);
      renderer.setViewport(cr0); renderer.setScissor(sc0); renderer.setScissorTest(scis);
      renderer.autoClear = autoClear; renderer.localClippingEnabled = lc;
    }
    function reset(dir) {                                              // volta ao zero, pronta para surgir do lado `dir`
      show = 0; last = 0; sd = dirPrev = dir; lat = 0; acc = 0; wasAir = false; wasBoost = false; boostAmt = 0; rb = 0; sparkAmt = 0;
      kick.x = kick.v = 0; for (const k in S) { S[k].x = 0; S[k].v = 0; }
      secs.forEach(sc => { sc.lvl = 0; sc.f = 0; sc.limit = -99; });
      frozen = false; rect = null; frame = 0;
    }
    return { update, render, scene, invalidate() { frame = 0; }, reset,
      state() { return { show, dir: dirPrev }; }, freeze() { frozen = true; } };   // freeze: a caixa na tela não muda mais (barra que está sumindo)
  }

  // Duas barras: quando um drift termina e outro começa do OUTRO lado, a antiga fica parada onde estava e some
  // rápido, enquanto uma nova (vazia) surge do lado certo. No mesmo lado, a mesma barra continua.
  function createBoostBar(renderer, opts) {
    const rigs = [makeBoostRig(renderer, opts), makeBoostRig(renderer, opts)];
    let cur = 0, ghost = -1, ghostDir = 1, prevOn = false, shownDir = 1;
    function update(dt, s) {
      s = s || {};
      const on = !!s.show, dir = (+s.dir) < 0 ? -1 : 1;
      if (on && !prevOn) {
        const st = rigs[cur].state();
        if (st.show > 0.02 && st.dir !== dir) {                       // drift novo, lado oposto, e a antiga ainda está visível
          rigs[cur].freeze(); ghost = cur; ghostDir = st.dir;
          cur = 1 - cur; rigs[cur].reset(dir);
        }
      }
      prevOn = on;
      if (on) shownDir = dir;                                         // solta o drift: a barra que some não vira para o lado novo
      rigs[cur].update(dt, Object.assign({}, s, { dir: on ? dir : shownDir }));
      if (ghost >= 0) {
        rigs[ghost].update(dt, Object.assign({}, s, { show: false, fast: true, dir: ghostDir }));
        if (rigs[ghost].state().show < 0.01) ghost = -1;
      }
    }
    function render() { if (ghost >= 0) rigs[ghost].render(); rigs[cur].render(); }
    return { update, render, invalidate() { rigs.forEach(r => r.invalidate()); }, rigs, get scene() { return rigs[cur].scene; } };
  }

  // =====================================================================================
  // LIGAÇÃO AUTOMÁTICA
  // Se ninguém chamar Speedo3D.create() à mão, o velocímetro se liga sozinho:
  //   * embrulha THREE.WebGLRenderer para desenhar logo depois de cada render da cena do jogo;
  //   * lê a velocidade que o código antigo escreve no canvas #speedo (fillText), que continua
  //     existindo escondido; se não achar número lá, estima pela velocidade da câmera;
  //   * curva pela rotação da câmera, turbo pelo aumento do FOV da câmera.
  // Chamando Speedo3D.create() no main.js, o modo automático se desliga e vale o que você mandar.
  // =====================================================================================
  let manual = false;
  const autoState = new WeakMap();

  // --- velocidade escrita no velocímetro 2D antigo
  const read = { cur: [], last: [], t: 0 };
  (function hookOldSpeedo() {
    const c = document.getElementById('speedo');
    if (!c || !c.getContext) return;
    const g = c.getContext('2d'); if (!g) return;
    const grab = (txt) => {
      const m = /^\s*(-?\d{1,3})(?!\d)/.exec(String(txt));
      if (!m) return;
      const fs = /(\d+(?:\.\d+)?)px/.exec(g.font || ''), size = fs ? +fs[1] : 10;
      read.cur.push({ n: +m[1], size }); read.t = performance.now();
    };
    const fill = g.fillText, stroke = g.strokeText, clear = g.clearRect;
    g.fillText = function (txt) { grab(txt); return fill.apply(this, arguments); };
    g.strokeText = function (txt) { grab(txt); return stroke.apply(this, arguments); };
    g.clearRect = function () { if (read.cur.length) { read.last = read.cur; read.cur = []; } return clear.apply(this, arguments); };
  })();
  function readOld() {
    if (performance.now() - read.t > 600) return null;
    const list = read.cur.length ? read.cur : read.last;
    if (!list.length) return null;
    let best = list[0];
    for (const e of list) if (e.size > best.size) best = e;
    let max = 0;
    for (const e of list) if (e !== best && e.size < best.size && e.n > max) max = e.n;
    return { speed: best.n, max: max >= 40 ? max : 0 };
  }

  function autoFrame(r, scene, camera) {
    if (manual || !camera || !camera.isPerspectiveCamera) return;
    if (r.getRenderTarget && r.getRenderTarget()) return;           // render em textura (minimapa etc.)
    const cvs = r.domElement;
    if (!cvs.isConnected || cvs.clientWidth < innerWidth * 0.5) return;
    let st = autoState.get(r);
    if (!st) {
      if (document.body.dataset.screen !== 'race') return;
      st = { inst: create(r, { el: '#speedo3d', unit: 'km/h', max: 160, camera }, true), t: performance.now(), pos: new T.Vector3(), has: false, vCam: 0, fov0: camera.fov, speed: 0 };
      autoState.set(r, st);
    }
    if (scene === st.inst.scene) return;
    const now = performance.now(), dt = (now - st.t) / 1000;
    if (dt > 0.004) {                                                // atualiza uma vez por quadro
      st.t = now;
      st.inst.setCamera(camera);
      const p = new T.Vector3(); camera.getWorldPosition(p);
      if (st.has && dt < 0.25) st.vCam = damp(st.vCam, p.distanceTo(st.pos) / dt * 3.6, 8, dt);
      st.pos.copy(p); st.has = true;
      if (document.body.dataset.screen !== 'race') st.fov0 = camera.fov;
      st.fov0 = Math.min(st.fov0, camera.fov);
      if (window.Speedo3D) window.Speedo3D.camInfo = { fov: camera.fov, fov0: st.fov0 };   // lido pelo HudFx (ui.js)
      const old = readOld();
      if (old && old.max) st.inst.setMax(old.max);
      const speed = old ? old.speed : (st.vCam < 400 ? st.vCam : st.speed);
      st.speed = speed;
      st.inst.update(dt, { speed, boost: camera.fov > st.fov0 + 2.5 });
    }
    st.inst.render();
  }

  if (typeof T.WebGLRenderer === 'function' && !T.WebGLRenderer.__speedo3d) {
    const Orig = T.WebGLRenderer;
    const Wrapped = function (params) {
      const r = new Orig(params);
      const base = r.render;
      let inside = false;
      r.render = function (scene, camera) {
        const out = base.apply(this, arguments);
        if (!inside) { inside = true; try { autoFrame(r, scene, camera); } catch (e) { console.warn('Speedo3D:', e); } inside = false; }
        return out;
      };
      return r;
    };
    Wrapped.prototype = Orig.prototype;
    Wrapped.__speedo3d = true;
    try { T.WebGLRenderer = Wrapped; } catch (e) { }
  }

  window.Speedo3D = {
    create(renderer, opts) { manual = true; return create(renderer, Object.assign({ fallback: true }, opts)); },
    createBoostBar,
    readOld   // número que o velocímetro 2D antigo escreveria ({ speed, max } ou null)
  };
})();
