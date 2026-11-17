// =====================================================================================
// smoke.js — fumaça "fofa realista" (estilo Party Animals), compartilhada pelo jogo inteiro
//
//  * Cada nuvem é um sprite (sempre de frente para a câmera) com textura gerada aqui mesmo:
//    vários "caroços" macios sobrepostos, claros em cima e sombreados embaixo (luz vindo de cima),
//    bordas suaves e um pouco de ruído -> parece volume, não um círculo chapado.
//  * A nuvem nasce pequena e densa, incha rápido, sobe devagar, gira um pouquinho e some aos poucos.
//  * Pool fixo (sem criar objetos durante a corrida). Tudo ajustável em SMOKE_CFG.
//  * Desenho em lote (uma chamada para todas as nuvens) e iluminada pela luz do ambiente.
//
//  Uso:  Smoke.init(cena)                         (uma vez por corrida; Fx.init no kart.js já chama)
//        Smoke.puff({ x, y, z, vx, vy, vz, size, grow, life, tint, opacity, up })
//        Smoke.update(dt)                         (todo quadro; Fx.step no kart.js já chama)
//  Toda a fumaça do jogo (escapamento, drift, curvas, poeira) passa por aqui via Fx.puff('smoke', ...).
// =====================================================================================
(function () {
  const SMOKE_CFG = {
    MAX: 420,                 // nuvens ao mesmo tempo (em lote: mais nuvens custam pouco)
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
    // 4) ruído: leve no brilho e FORTE na transparência (ruído de valor em 3 oitavas). É ele que deixa a erosão
    //    desfazer a nuvem em fiapos e buracos no fim da vida, como fumaça de verdade se dissipando
    const G = 9, gr = []; for (let i = 0; i < 3; i++) { const a = []; for (let k = 0; k < (G << i) * (G << i); k++) a.push(rnd()); gr.push(a); }
    const vn = (u, v, o) => { const n = G << o, X = u * n, Y = v * n, i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy = Y - j, A = gr[o], q = (a, b) => A[((b % n) + n) % n * n + ((a % n) + n) % n];
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return (q(i, j) * (1 - sx) + q(i + 1, j) * sx) * (1 - sy) + (q(i, j + 1) * (1 - sx) + q(i + 1, j + 1) * sx) * sy; };
    const im = x.getImageData(0, 0, N, N), d = im.data;
    for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; const n = (rnd() - 0.5) * 6; d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
      const px = (i / 4) % N / N, py = Math.floor(i / 4 / N) / N, f = vn(px, py, 0) * 0.55 + vn(px, py, 1) * 0.3 + vn(px, py, 2) * 0.15;
      d[i + 3] = d[i + 3] * Math.min(1, 0.35 + f * 0.95); }
    x.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding || t.encoding; return t;
  }

  // Renderização em LOTE: todas as nuvens são desenhadas numa chamada só (window.PBatch, definido no kart.js), com as
  // variações de textura num atlas 2x2. Antes cada nuvem era um THREE.Sprite separado (até 280 chamadas de desenho).
  // Iluminação: a nuvem recebe a cor da luz do ambiente (sol/céu) -> fica dourada no entardecer e azulada à noite.
  const pool = [], texs = [];
  let root = null, batch = null, atlas = null;
  const _c = new THREE.Color(), _l = new THREE.Color(1, 1, 1);
  function makeAtlas() {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    texs.slice(0, 4).forEach((t, i) => x.drawImage(t.image, (i % 2) * 128, Math.floor(i / 2) * 128));
    return new THREE.CanvasTexture(c);
  }
  const Smoke = {
    CFG: SMOKE_CFG,
    init(scene) {
      if (!window.THREE || !document) return;
      if (!texs.length) for (let i = 0; i < S.VARIANTS; i++) texs.push(puffTexture(i + 1));
      if (!atlas) atlas = makeAtlas();
      if (root && root.parent) root.parent.remove(root);
      if (batch) batch.dispose(); batch = null;
      root = new THREE.Group(); root.name = 'smoke'; root.userData.noOutline = true; root.userData.dynamic = true; scene.add(root);
      pool.length = 0; for (let i = 0; i < S.MAX; i++) pool.push({ on: false, i, t: 0, life: 1 });
      if (window.PBatch) batch = new PBatch(root, { max: S.MAX, map: atlas, atlas: [2, 2], erode: true, order: 0 });
    },
    // cor da luz que ilumina a fumaça (o main.js não precisa chamar: lê o Env se existir)
    light() { const E = window.Env; if (!E || !E.sun || !E.hemi) return _l.setRGB(1, 1, 1);
      _l.copy(E.hemi.color).multiplyScalar(E.hemi.intensity * 0.9).add(_c.copy(E.sun.color).multiplyScalar(E.sun.intensity * 0.45));
      // só o TOM da luz (o escurecimento da noite já vem na cor da partícula, pelo kart.js): metade luz, metade branco
      const m = Math.max(_l.r, _l.g, _l.b, 1e-3); _l.multiplyScalar(1 / m); _l.lerp(_c.setRGB(1, 1, 1), 0.5); return _l; },
    // o: { x, y, z, vx, vy, vz, size, grow, life, tint (cor), opacity }
    puff(o) {
      if (!root || !batch) return null;
      let p = null; for (const q of pool) if (!q.on) { p = q; break; }
      if (!p) p = pool.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));   // cheio: reaproveita a mais velha
      p.on = true; p.t = 0; p.life = (o.life || S.LIFE) * (0.8 + Math.random() * 0.4);
      p.size = (o.size || S.SIZE) * (0.85 + Math.random() * 0.3); p.grow = o.grow || S.GROW;
      p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0; p.op = o.opacity === undefined ? S.OPACITY : o.opacity; p.up = o.up === undefined ? S.RISE : o.up;
      p.rot = Math.random() * Math.PI * 2; p.rv = (Math.random() - 0.5) * 2 * S.SPIN; p.fr = Math.floor(Math.random() * Math.min(4, texs.length));
      p.col = (p.col || new THREE.Color()).set(o.tint === undefined ? 0xffffff : o.tint);
      p.x = o.x; p.y = o.y; p.z = o.z;
      return p;
    },
    update(dt) {
      if (!root || !batch) return; const dr = Math.exp(-S.DRAG * dt), L = this.light();
      for (const p of pool) { if (!p.on) { if (p.i < batch.hw) batch.hide(p.i); continue; }
        p.t += dt; const u = p.t / p.life;
        if (u >= 1) { p.on = false; batch.hide(p.i); continue; }
        p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr + p.up * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const sz = p.size * (1 + (p.grow - 1) * (1 - Math.pow(1 - u, 2.5)));   // incha rápido e depois devagar
        p.rot += p.rv * dt * (1 - u);
        const a = p.op * Math.min(1, u / 0.08) * Math.pow(1 - u, 0.9);        // aparece rápido; quem some no fim é a erosão
        const ex = Math.max(0, (u - 0.35) / 0.65);                              // a partir de 35% da vida, se desfaz em fiapos
        batch.put(p.i, p.x, p.y, p.z, sz, sz, p.rot, p.col.r * L.r, p.col.g * L.g, p.col.b * L.b, a, 0, 0, 0, p.fr, ex * ex * 0.9 + ex * 0.1);
      }
      batch.commit();
    },
    textures() { return texs.slice(); },
    clear() { pool.forEach(p => { p.on = false; if (batch) batch.hide(p.i); }); }
  };
  window.Smoke = Smoke;
})();
