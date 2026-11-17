// =====================================================================================
// sunflare.js — lens flare do sol no estilo Mario Kart (substitui o #flare antigo)
//  * núcleo branco-amarelado com estrela de raios girando devagar + raio horizontal (anamórfico)
//  * anel de arco-íris em volta do sol
//  * "fantasmas" coloridos (hexágonos e círculos em tons pastel) alinhados do sol até o lado oposto da tela,
//    passando pelo centro — mais fortes quanto mais o sol se aproxima do centro da tela
//  * some quando o sol sai da tela, se põe, ou é tapado pelo relevo / montanhas / árvores grandes (com fade)
// Desenhado em DOM (imagens geradas em canvas, uma vez) com mistura "screen": não custa nada para a placa de vídeo.
// Uso: tracks.js chama SunFlare.attach(track, scene) no fim do build.
// =====================================================================================
(function () {
  let root = null, els = null, built = false;
  const cvs = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; };
  const hsl = (h, s, l, a) => `hsla(${h},${s}%,${l}%,${a})`;

  function core() {   // núcleo + estrela de raios
    const S = 512, c = cvs(S), g = c.getContext('2d'), m = S / 2;
    let gr = g.createRadialGradient(m, m, 0, m, m, m);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.06, 'rgba(255,253,235,1)'); gr.addColorStop(0.16, 'rgba(255,236,170,0.55)');
    gr.addColorStop(0.4, 'rgba(255,200,120,0.14)'); gr.addColorStop(1, 'rgba(255,180,100,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'lighter';
    const ray = (a, len, w, al) => { g.save(); g.translate(m, m); g.rotate(a);
      const lg = g.createLinearGradient(0, 0, len, 0); lg.addColorStop(0, `rgba(255,250,225,${al})`); lg.addColorStop(1, 'rgba(255,230,170,0)');
      g.fillStyle = lg; g.beginPath(); g.moveTo(0, -w); g.lineTo(len, 0); g.lineTo(0, w); g.closePath(); g.fill(); g.restore(); };
    for (let k = 0; k < 6; k++) ray(k / 6 * Math.PI * 2, m * 0.98, 9, 0.75);          // 6 raios grandes (estrela)
    for (let k = 0; k < 12; k++) ray((k + 0.5) / 12 * Math.PI * 2, m * 0.6, 4, 0.45);  // raios menores entre eles
    return c.toDataURL();
  }
  function streak() {   // raio horizontal comprido
    const c = cvs(1024, 64), g = c.getContext('2d');
    const lg = g.createLinearGradient(0, 0, 1024, 0); lg.addColorStop(0, 'rgba(255,220,170,0)'); lg.addColorStop(0.5, 'rgba(255,248,230,0.9)'); lg.addColorStop(1, 'rgba(255,220,170,0)');
    const vg = g.createLinearGradient(0, 0, 0, 64); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.5, 'rgba(0,0,0,1)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = lg; g.fillRect(0, 0, 1024, 64); g.globalCompositeOperation = 'destination-in'; g.fillStyle = vg; g.fillRect(0, 0, 1024, 64);
    return c.toDataURL();
  }
  function rainbow() {   // anel de arco-íris
    const S = 512, c = cvs(S), g = c.getContext('2d'), m = S / 2;
    for (let k = 0; k < 40; k++) { const f = k / 39, r = m * (0.72 + 0.22 * f);
      g.strokeStyle = hsl(Math.round(f * 300), 100, 65, 0.16 * Math.sin(f * Math.PI)); g.lineWidth = m * 0.0075; g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.stroke(); }
    return c.toDataURL();
  }
  function ghost(sides, hue, sat, light, fill, edge) {   // hexágono (sides = 6) ou círculo (sides = 0)
    const S = 256, c = cvs(S), g = c.getContext('2d'), m = S / 2, R = m * 0.9;
    const path = () => { g.beginPath(); if (!sides) g.arc(m, m, R, 0, Math.PI * 2);
      else for (let k = 0; k <= sides; k++) { const a = k / sides * Math.PI * 2 + Math.PI / 6, x = m + Math.cos(a) * R, y = m + Math.sin(a) * R; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
    const gr = g.createRadialGradient(m, m, 0, m, m, R); gr.addColorStop(0, hsl(hue, sat, light, fill * 0.5)); gr.addColorStop(0.82, hsl(hue, sat, light, fill)); gr.addColorStop(1, hsl(hue, sat, light + 8, fill * 1.6));
    path(); g.fillStyle = gr; g.fill();
    g.lineWidth = 5; g.strokeStyle = hsl(hue, sat, light + 14, edge); path(); g.stroke();
    g.filter = 'blur(6px)'; g.lineWidth = 10; g.strokeStyle = hsl(hue, sat, light + 10, edge * 0.5); path(); g.stroke(); g.filter = 'none';
    return c.toDataURL();
  }

  function build() {
    if (built) return; built = true;
    root = document.createElement('div'); root.id = 'kFlare'; root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:2;mix-blend-mode:screen;opacity:0;transition:none';
    const img = (src, w, h) => { const i = new Image(); i.src = src; i.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h || w}px;will-change:transform,opacity;opacity:0`; i.draggable = false; root.appendChild(i); return i; };
    // fantasmas: f = posição ao longo da linha (1 = no sol, 0 = centro, negativo = lado oposto), s = tamanho (fração da altura da tela)
    const G = [
      { f: 0.62, s: 0.05, src: ghost(0, 50, 100, 70, 0.22, 0.5) },
      { f: 0.38, s: 0.09, src: ghost(6, 140, 80, 62, 0.13, 0.42) },
      { f: 0.2, s: 0.035, src: ghost(0, 30, 100, 66, 0.35, 0.6) },
      { f: -0.08, s: 0.13, src: ghost(6, 195, 85, 64, 0.1, 0.36) },
      { f: -0.28, s: 0.06, src: ghost(6, 310, 90, 70, 0.16, 0.5) },
      { f: -0.45, s: 0.2, src: ghost(0, 175, 80, 62, 0.06, 0.24) },
      { f: -0.68, s: 0.08, src: ghost(6, 45, 100, 62, 0.16, 0.45) },
      { f: -0.9, s: 0.15, src: ghost(6, 265, 75, 66, 0.09, 0.34) },
      { f: -1.25, s: 0.28, src: ghost(0, 100, 70, 60, 0.05, 0.2) }
    ];
    els = { rb: img(rainbow(), 512), streak: img(streak(), 1024, 64), core: img(core(), 512), ghosts: G.map(o => Object.assign(o, { el: img(o.src, 256) })) };
    document.body.appendChild(root);
  }

  let cur = null;
  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3();
  function attach(tr, scene) {
    if (!window.THREE) return;
    build(); const me = { vis: 0, sun: null, occ: 1, acc: 0 }; cur = me;
    const findSun = () => { if (me.sun && me.sun.parent) return me.sun; me.sun = null; scene.traverse(o => { if (!me.sun && o.isDirectionalLight) me.sun = o; }); return me.sun; };
    // o sol está tapado? (relevo da pista, montanhas/árvores grandes registradas em tr.blockers)
    const occluded = (o, d) => {
      if (tr.heightAt) for (let s = 6; s < 900; s *= 1.35) { const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s; if (tr.heightAt(x, z) > y) return true; }
      for (const b of tr.blockers || []) { const ox = b.x - o.x, oy = b.y - o.y, oz = b.z - o.z, t = ox * d.x + oy * d.y + oz * d.z; if (t < 0 || t > 2500) continue;
        const qx = ox - d.x * t, qy = oy - d.y * t, qz = oz - d.z * t; if (qx * qx + qy * qy + qz * qz < b.r * b.r * 0.85) return true; }
      return false; };
    tr.animated.push((t, dt) => {
      if (cur !== me) return; dt = Math.min(0.1, dt || 0.016);
      const cam = window.Fx && Fx.cam, sun = findSun(), race = document.body.dataset.screen === 'race';
      let target = 0, sx = 0, sy = 0;
      if (cam && sun && race) {
        _d.subVectors(sun.position, sun.target.position).normalize(); _c.setFromMatrixPosition(cam.matrixWorld);
        _v.copy(_c).addScaledVector(_d, 1000).project(cam);
        const W = innerWidth, H = innerHeight; sx = (_v.x * 0.5 + 0.5) * W; sy = (-_v.y * 0.5 + 0.5) * H;
        const onScr = _v.z < 1 && Math.abs(_v.x) < 1.15 && Math.abs(_v.y) < 1.15;
        if (onScr && _d.y > -0.03) {
          me.acc -= dt; if (me.acc <= 0) { me.acc = 0.08; me.occ = occluded(_c, _d) ? 0 : 1; }
          const edge = Math.max(0, 1 - Math.max(Math.abs(_v.x), Math.abs(_v.y)) / 1.15), day = Math.min(1, Math.max(0, (_d.y + 0.03) / 0.12)) * Math.min(1, sun.intensity / 0.6);
          target = me.occ * Math.min(1, edge * 2.2) * day * (1 - ((window.Env && Env.nightF) || 0));
        }
      }
      me.vis += (target - me.vis) * Math.min(1, dt * (target > me.vis ? 7 : 10));
      if (me.vis < 0.01) { root.style.opacity = 0; return; }
      root.style.opacity = 1;
      const W = innerWidth, H = innerHeight, cx = W / 2, cy = H / 2, dx = sx - cx, dy = sy - cy;
      const cen = 1 - Math.min(1, Math.hypot(dx / W, dy / H) * 1.6);                      // sol perto do centro = fantasmas mais fortes
      const put = (el, x, y, w, h, op, rot) => { el.style.transform = `translate(${x - w / 2}px,${y - h / 2}px) rotate(${rot || 0}rad)`; el.style.opacity = op; };
      const cs = H * 0.62 * (0.9 + 0.1 * Math.sin(t * 2.3));
      els.core.style.width = els.core.style.height = cs + 'px'; put(els.core, sx, sy, cs, cs, me.vis, t * 0.06);
      const rs = H * 0.5; els.rb.style.width = els.rb.style.height = rs + 'px'; put(els.rb, sx, sy, rs, rs, me.vis * 0.8);
      const sw = W * 1.1, shh = H * 0.05; els.streak.style.width = sw + 'px'; els.streak.style.height = shh + 'px'; put(els.streak, sx, sy, sw, shh, me.vis * 0.55);
      els.ghosts.forEach((o, k) => { const s = H * o.s; o.el.style.width = o.el.style.height = s + 'px';
        put(o.el, cx + dx * o.f, cy + dy * o.f, s, s, me.vis * (0.45 + 0.75 * cen), Math.atan2(dy, dx) + k * 0.4); });
    });
    tr.disposers.push(() => { if (cur === me) { cur = null; root.style.opacity = 0; } });
  }
  window.SunFlare = { attach };
})();
