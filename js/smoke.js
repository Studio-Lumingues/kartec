// =====================================================================================
// smoke.js — fumaça "fofa realista" (estilo Party Animals), compartilhada pelo jogo inteiro
//
//  * Cada nuvem é um sprite (sempre de frente para a câmera) com textura gerada aqui mesmo:
//    vários "caroços" macios sobrepostos, claros em cima e sombreados embaixo (luz vindo de cima),
//    bordas suaves e um pouco de ruído -> parece volume, não um círculo chapado.
//  * A nuvem nasce pequena e densa, incha rápido, sobe devagar, gira um pouquinho e some aos poucos.
//  * Pool fixo (sem criar objetos durante a corrida). Tudo ajustável em SMOKE_CFG.
//
//  Uso:  Smoke.init(cena)                         (uma vez por corrida; Fx.init no kart.js já chama)
//        Smoke.puff({ x, y, z, vx, vy, vz, size, grow, life, tint, opacity, up })
//        Smoke.update(dt)                         (todo quadro; Fx.step no kart.js já chama)
//  Toda a fumaça do jogo (escapamento, drift, curvas, poeira) passa por aqui via Fx.puff('smoke', ...).
// =====================================================================================
(function () {
  const SMOKE_CFG = {
    MAX: 280,                 // nuvens ao mesmo tempo
    VARIANTS: 4,              // texturas diferentes (sorteadas)
    SIZE: 1.1, GROW: 2.6,     // tamanho inicial (m) e quanto ela cresce até o fim
    LIFE: 0.9,                // duração média (s)
    RISE: 0.9, DRAG: 2.4,     // subida (m/s²) e freio do movimento
    OPACITY: 0.92,            // opacidade máxima
    SPIN: 0.8                 // giro máximo da nuvem (rad/s)
  };
  const S = SMOKE_CFG;

  // ---------- textura: nuvem fofa com volume ----------
  function puffTexture(seed) {
    let sd = seed * 9301 + 49297; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
    // 1) forma: caroços brancos com borda macia (todos dentro do quadro)
    const blobs = [[64, 66, 34]];
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + rnd() * 0.6, d = 16 + rnd() * 8; blobs.push([64 + Math.cos(a) * d, 66 + Math.sin(a) * d * 0.85, 17 + rnd() * 9]); }
    blobs.forEach(([bx, by, r]) => { const g = x.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill(); });
    // 2) volume: brilho em cima e sombra suave embaixo em cada caroço (só onde já tem fumaça)
    x.globalCompositeOperation = 'source-atop';
    blobs.forEach(([bx, by, r]) => { const g = x.createRadialGradient(bx - r * 0.2, by - r * 0.4, r * 0.1, bx, by + r * 0.1, r);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.6, 'rgba(214,218,228,0.3)'); g.addColorStop(0.85, 'rgba(200,204,216,0.2)'); g.addColorStop(1, 'rgba(200,204,216,0)');
      x.fillStyle = g; x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill(); });
    const sh = x.createLinearGradient(0, 30, 0, 110); sh.addColorStop(0, 'rgba(255,255,255,0.4)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(178,182,196,0.4)');
    x.fillStyle = sh; x.fillRect(0, 0, N, N);
    // 3) borda: garante transparência total perto da borda do quadro (nada de cantos cortados)
    x.globalCompositeOperation = 'destination-in';
    const edge = x.createRadialGradient(64, 64, 38, 64, 64, 63); edge.addColorStop(0, 'rgba(0,0,0,1)'); edge.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = edge; x.fillRect(0, 0, N, N);
    x.globalCompositeOperation = 'source-over';
    // 4) ruído bem leve (textura de fumaça, sem granulado)
    const im = x.getImageData(0, 0, N, N), d = im.data;
    for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; const n = (rnd() - 0.5) * 6; d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n)); }
    x.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding || t.encoding; return t;
  }

  const pool = [], texs = [];
  let root = null;
  const Smoke = {
    CFG: SMOKE_CFG,
    init(scene) {
      if (!window.THREE || !document) return;
      if (!texs.length) for (let i = 0; i < S.VARIANTS; i++) texs.push(puffTexture(i + 1));
      if (root && root.parent) root.parent.remove(root);
      root = new THREE.Group(); root.name = 'smoke'; root.userData.noOutline = true; root.userData.dynamic = true; scene.add(root);
      pool.forEach(p => p.sp.material.dispose()); pool.length = 0;
    },
    // o: { x, y, z, vx, vy, vz, size, grow, life, tint (cor), opacity }
    puff(o) {
      if (!root) return null;
      let p = null; for (const q of pool) if (!q.on) { p = q; break; }
      if (!p) {
        if (pool.length < S.MAX) { const m = new THREE.SpriteMaterial({ map: texs[pool.length % texs.length], transparent: true, depthWrite: false, opacity: 0 });
          p = { sp: new THREE.Sprite(m) }; p.sp.userData.noOutline = true; root.add(p.sp); pool.push(p); }
        else { p = pool.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b)); }   // cheio: reaproveita a mais velha
      }
      p.on = true; p.t = 0; p.life = (o.life || S.LIFE) * (0.8 + Math.random() * 0.4);
      p.size = (o.size || S.SIZE) * (0.85 + Math.random() * 0.3); p.grow = o.grow || S.GROW;
      p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0; p.op = o.opacity === undefined ? S.OPACITY : o.opacity; p.up = o.up === undefined ? S.RISE : o.up;
      p.rot = (Math.random() - 0.5) * 2 * S.SPIN;
      const m = p.sp.material; m.map = texs[Math.floor(Math.random() * texs.length)]; m.rotation = Math.random() * Math.PI * 2;
      m.color.set(o.tint === undefined ? 0xffffff : o.tint);
      p.sp.position.set(o.x, o.y, o.z); p.sp.scale.setScalar(0.01); p.sp.visible = true;
      return p;
    },
    update(dt) {
      if (!root) return; const dr = Math.exp(-S.DRAG * dt);
      for (const p of pool) { if (!p.on) continue; p.t += dt; const u = p.t / p.life;
        if (u >= 1) { p.on = false; p.sp.visible = false; continue; }
        p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr + p.up * dt;
        p.sp.position.x += p.vx * dt; p.sp.position.y += p.vy * dt; p.sp.position.z += p.vz * dt;
        const sz = p.size * (1 + (p.grow - 1) * (1 - Math.pow(1 - u, 2.5)));   // incha rápido e depois devagar
        p.sp.scale.setScalar(sz);
        const m = p.sp.material; m.rotation += p.rot * dt * (1 - u);
        m.opacity = p.op * Math.min(1, u / 0.08) * Math.pow(1 - u, 1.6);        // aparece rápido, some suave
      }
    },
    textures() { return texs.slice(); },
    clear() { pool.forEach(p => { p.on = false; p.sp.visible = false; }); }
  };
  window.Smoke = Smoke;
})();
