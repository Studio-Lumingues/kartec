// =====================================================================================
// finishcine.js — cutscene de chegada (estilo Forza Horizon)
//
//  Câmera 1  corte seco para uma câmera lateral rente ao chão, na linha de chegada, em plano fechado.
//            O kart entra no quadro "a milhão", com rastro de movimento (motion blur por mistura de quadros),
//            e o tempo desacelera (câmera lenta) no instante em que ele cruza a linha.
//  Transição fade rápido para o preto assim que o kart sai do enquadramento.
//  Câmera 2  fade in numa câmera de acompanhamento (atrás e acima do kart) que segue o kart suavemente
//            enquanto ele desacelera sozinho (piloto automático) depois da vitória.
//
//  Funciona por cima do PostFX: o render da corrida é "embrulhado" (PostFX.create), então a câmera da
//  cutscene é aplicada só na hora de desenhar e a câmera do main.js volta intacta no quadro seguinte.
//
//  Ligações no main.js (3 linhas):
//    1. no laço da corrida, antes da física:      dt = FinishCine.scale(dt);
//    2. no lugar onde mostra o resultado:          FinishCine.after(() => { ...mostra o resultado... });
//    3. controle do kart do jogador depois da linha (se o main.js ainda não passa o kart para a IA):
//         if (FinishCine.driving) input = FinishCine.input;     // { up, down, left, right, steer, brake }
//  Opcional: FinishCine.setContext({ kart, track })  (sem isso ele procura Game.karts / Game.track)
//            FinishCine.reset()                     (ao reiniciar a corrida ou sair dela; também é automático)
// =====================================================================================
(function () {
  const C = {
    LEAD: 0.85,            // s (velocidade real) antes da linha em que corta para a câmera 1
    MIN_SPEED: 6,          // m/s: mais devagar que isso não tem cutscene (o resultado aparece direto)
    SLOW: 0.2,             // escala de tempo na travessia (0,2 = 5x mais lento)
    SLOW_IN: 8,            // m antes da linha: começa a frear o tempo
    EXIT: 6,               // m depois da linha: o kart saiu do quadro -> fade para o preto
    CAM1: { dist: 4.4, h: 0.36, ahead: 0.8, fov: 32, follow: 0.22 },   // câmera rente ao chão
    CHASE: { back: 6.6, up: 2.4, look: 1.0, ahead: 3.0, fov: 55, rate: 3.2, backEnd: 9.5, sideEnd: 1.6 },
    FADE_OUT: 0.3, BLACK: 0.3, FADE_IN: 0.75, CHASE_T: 5.2,
    BLUR: 0.74             // força do rastro (0 = sem; 0,85 = muito)
  };
  const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const st = { phase: 'idle', t: 0, ts: 1, fade: 0, blur: 0, ctx: {}, queue: [], hint: undefined, prev: null, toLine: 0,
    vel: null, speed: 0, head: null, cam: null, cam1: null, chase: null, last: 0, armedLap: false };
  const V = () => new THREE.Vector3();
  let dom = null;

  // ---------------------------------------------------------------- interface/DOM
  function ui() {
    if (dom) return dom;
    const css = document.createElement('style');
    css.textContent = `
      #fcBars i { position: fixed; left: 0; right: 0; height: 11vh; background: #000; z-index: 55; pointer-events: none;
        transition: transform .38s cubic-bezier(.3,0,.2,1); }
      #fcBars i:first-child { top: 0; transform: translateY(-101%); } #fcBars i:last-child { bottom: 0; transform: translateY(101%); }
      body.fcine #fcBars i { transform: none; }
      #fcFade { position: fixed; inset: 0; background: #000; z-index: 56; pointer-events: none; opacity: 0; }
      #fcTrail { position: fixed; pointer-events: none; display: none; }
      body.fcine #hud, body.fcine #touch, body.fcine #speedLines, body.fcine #rivalTag, body.fcine #flare,
      body.fcine #signal, body.fcine #toast { opacity: 0 !important; pointer-events: none !important; transition: opacity .25s; }`;
    document.head.appendChild(css);
    const bars = document.createElement('div'); bars.id = 'fcBars'; bars.innerHTML = '<i></i><i></i>';
    const fade = document.createElement('div'); fade.id = 'fcFade';
    const trail = document.createElement('canvas'); trail.id = 'fcTrail';
    document.body.append(bars, fade);
    return (dom = { bars, fade, trail, tctx: trail.getContext('2d'), fresh: true });
  }

  // ---------------------------------------------------------------- contexto (kart do jogador e pista)
  function context() {
    const G = window.Game || {}, c = st.ctx;
    const kart = c.kart || G.player || (G.karts || []).find(k => k && (k.player || k.isPlayer));
    const track = c.track || G.track || G.tr;
    return kart && kart.pos && track && track.S && track.T ? { kart, track } : null;
  }
  const laps = () => (window.CFG && CFG.LAPS) || (window.Game && Game.laps) || 3;
  const lastLap = k => (typeof st.ctx.lastLap === 'function' ? st.ctx.lastLap(k) : (k.lap || 0) >= laps());

  // posição ao longo da pista: nó contínuo, desvio lateral (mesmo sinal de track.side) e metros até a linha
  function along(tr, p) {
    let i, f;
    if (tr.nearest) { const r = tr.nearest(p, st.hint); i = r.i; f = r.f || 0; }
    else { let b = 1e18; for (let k = 0; k < tr.N; k++) { const dx = p.x - tr.S[k].x, dz = p.z - tr.S[k].z, d = dx * dx + dz * dz; if (d < b) { b = d; i = k; } } f = 0; }
    st.hint = i;
    const N = tr.N, S = tr.S[i], T = tr.T[i], lat = (p.x - S.x) * T.z - (p.z - S.z) * T.x;
    let d = ((tr.startIdx - (i + f)) % N + N) % N; if (d > N / 2) d -= N;          // > 0 antes da linha, < 0 depois
    return { i, u: i + f, lat, toLine: d * (tr.length / N) };
  }
  const groundY = (tr, i, fb) => (tr.hAt ? tr.hAt(((Math.round(i) % tr.N) + tr.N) % tr.N) + (tr.roadBase || 0.1) : fb);

  // ---------------------------------------------------------------- câmeras
  function setupCam1(tr, kart, a) {
    const N = tr.N, mPer = tr.length / N, si = tr.startIdx, W = tr.W || 8, D = C.CAM1.dist, max = W + 1.6;
    let sd = a.lat >= 0 ? 1 : -1, lat = a.lat + sd * D;                            // do lado de fora mais próximo do kart
    if (Math.abs(lat) > max) { const o = a.lat - sd * D; if (Math.abs(o) <= max) lat = o; else lat = sd * max; }
    const ci = si + C.CAM1.ahead / mPer, gy = groundY(tr, si, kart.pos.y - 0.2);
    const pos = tr.side(Math.round(ci), lat, 0); pos.y = gy + C.CAM1.h;
    const look = tr.side(si, a.lat, 0); look.y = gy + 0.5;
    st.cam1 = { pos, look, lane: a.lat };
  }
  function chaseHeading(tr, a) {
    const T = tr.T[a.i], h = st.head || (st.head = new THREE.Vector3(T.x, 0, T.z));
    const want = st.speed > 2 && st.vel ? V().set(st.vel.x, 0, st.vel.z).normalize() : V().set(T.x, 0, T.z);
    return h.lerp(want, 0.12).normalize();
  }
  function chasePose(tr, kart, a, k, out) {
    const h = chaseHeading(tr, a), P = kart.pos, Q = C.CHASE, e = Math.min(1, st.t / C.CHASE_T), ease = e * e * (3 - 2 * e);
    const back = Q.back + (Q.backEnd - Q.back) * ease, sideOff = Q.sideEnd * ease, right = V().set(-h.z, 0, h.x);
    out.pos.set(P.x - h.x * back + right.x * sideOff, P.y + Q.up + 0.4 * ease, P.z - h.z * back + right.z * sideOff);
    out.pos.y = Math.max(out.pos.y, groundY(tr, a.i, P.y) + 0.9);
    out.look.set(P.x + h.x * Q.ahead, P.y + Q.look, P.z + h.z * Q.ahead);
    out.k = k;
  }

  // ---------------------------------------------------------------- piloto automático (sugestão de comandos)
  function pilot(tr, a) {
    const N = tr.N, mPer = tr.length / N, j = Math.round(a.u + Math.max(6, st.speed * 0.6) / mPer);
    const tgt = tr.side(((j % N) + N) % N, a.lat * 0.4, 0), P = st.ctx.kartRef.pos, h = st.head || V().set(tr.T[a.i].x, 0, tr.T[a.i].z);
    const dx = tgt.x - P.x, dz = tgt.z - P.z, L = Math.hypot(dx, dz) || 1, cross = h.x * dz / L - h.z * dx / L;
    const steer = Math.max(-1, Math.min(1, cross * 2.2));                            // > 0 = direita
    const brake = st.phase === 'chase' || st.phase === 'done' ? Math.min(1, Math.max(0, (st.speed - 4) / 18)) * 0.5 : 0;
    const I = FinishCine.input; I.up = false; I.down = brake > 0.25 && st.speed > 3; I.brake = brake;
    I.steer = steer; I.left = steer < -0.15; I.right = steer > 0.15; I.drift = false; I.wheelie = false; I.item = false;
  }

  // ---------------------------------------------------------------- máquina de estados (tempo real)
  function go(phase) { st.phase = phase; st.t = 0; }
  function start(c, a) {
    ui();
    setupCam1(c.track, c.kart, a); st.cam = { pos: st.cam1.pos.clone(), look: st.cam1.look.clone(), fov: C.CAM1.fov, focus: C.CAM1.dist };
    document.body.classList.add('fcine'); dom.fresh = true; go('approach');
  }
  function finishQueue() { const q = st.queue.splice(0); q.forEach(fn => { try { fn(); } catch (e) { console.warn('[finishcine]', e); } }); }

  function frame() {
    const now = performance.now(), rdt = Math.min(0.1, st.last ? (now - st.last) / 1000 : 0.016); st.last = now;
    const c = context(); if (!c) return;
    const { kart, track: tr } = c; st.ctx.kartRef = kart;
    const a = along(tr, kart.pos);
    // velocidade medida em tempo de jogo (o tempo pode estar desacelerado)
    if (st.prev) { const gdt = Math.max(1e-4, rdt * st.ts), v = st.vel || (st.vel = V());
      v.set((kart.pos.x - st.prev.x) / gdt, (kart.pos.y - st.prev.y) / gdt, (kart.pos.z - st.prev.z) / gdt);
      const sp = typeof kart.speed === 'number' ? Math.abs(kart.speed) : v.length(); st.speed += (sp - st.speed) * Math.min(1, rdt * 10); }
    (st.prev || (st.prev = V())).copy(kart.pos);
    const prevLine = st.toLine; st.toLine = a.toLine; st.t += rdt;

    // corrida nova / reinício: limpa tudo
    if (st.phase !== 'idle' && !kart.finished && !lastLap(kart)) { FinishCine.reset(); return; }

    let tsT = 1, blurT = 0;
    switch (st.phase) {
      case 'idle':
        if (lastLap(kart) && !kart.finished && !RM_SKIP() && a.toLine > 1 && a.toLine < 90 && st.speed > C.MIN_SPEED && a.toLine / st.speed < C.LEAD) start(c, a);
        else return;
        break;
      case 'approach': {
        blurT = RM ? 0 : C.BLUR;
        if (a.toLine < C.SLOW_IN) tsT = C.SLOW;
        if ((prevLine > 0 && a.toLine <= 0) || kart.finished) go('exit');
        else if (st.t > 3) go('fadeout');                                             // segurança (kart parou antes da linha)
        break; }
      case 'exit':
        tsT = C.SLOW; blurT = RM ? 0 : C.BLUR * 0.7;
        if (-a.toLine >= C.EXIT || st.t > 1.6) go('fadeout');
        break;
      case 'fadeout':
        tsT = 1; blurT = RM ? 0 : C.BLUR * 0.5; st.fade = Math.min(1, st.t / C.FADE_OUT);
        if (st.t >= C.FADE_OUT) go('black');
        break;
      case 'black':
        st.fade = 1; st.head = null; chaseHeading(tr, a);
        if (st.t >= C.BLACK) { st.cam.fov = C.CHASE.fov; chasePose(tr, kart, a, 1, st.cam); dom.fresh = true; go('chase'); }
        break;
      case 'chase':
        st.fade = 1 - Math.min(1, st.t / C.FADE_IN); st.fade *= st.fade;
        if (st.t >= C.CHASE_T) { go('done'); finishQueue(); }
        break;
      case 'done': st.fade = 0; break;
    }
    // escala de tempo e rastro com transição suave (tempo real)
    st.ts += (tsT - st.ts) * (1 - Math.exp(-(tsT < st.ts ? 9 : 6) * rdt)); if (Math.abs(st.ts - tsT) < 0.005) st.ts = tsT;
    st.blur += (blurT - st.blur) * (1 - Math.exp(-8 * rdt));
    if (st.phase === 'fadeout' || st.phase === 'black' || st.phase === 'chase' || st.phase === 'done') pilot(tr, a); else if (kart.finished) pilot(tr, a);

    // pose da câmera
    const cam = st.cam;
    if (st.phase === 'approach' || st.phase === 'exit' || st.phase === 'fadeout') {
      const c1 = st.cam1, near = Math.max(0, 1 - Math.abs(a.toLine) / 6), shake = (window.Settings && Settings.g && Settings.g.shake === false) || RM ? 0 : 0.025 * near;
      cam.pos.copy(c1.pos); cam.pos.x += (Math.random() - 0.5) * shake; cam.pos.y += (Math.random() - 0.5) * shake;
      cam.look.copy(c1.look).lerp(V().set(kart.pos.x, c1.look.y, kart.pos.z), C.CAM1.follow * (1 - near * 0.5));
      cam.fov = C.CAM1.fov - 2.5 * near;                                              // leve "zoom" no instante da passagem
      cam.focus = cam.pos.distanceTo(kart.pos);
    } else if (st.phase === 'chase' || st.phase === 'done') {
      const tgt = st._tg || (st._tg = { pos: V(), look: V() }); chasePose(tr, kart, a, 0, tgt);
      const k = 1 - Math.exp(-C.CHASE.rate * rdt); cam.pos.lerp(tgt.pos, k); cam.look.lerp(tgt.look, k * 1.6);
      cam.fov = C.CHASE.fov; cam.focus = cam.pos.distanceTo(kart.pos);
    }
    if (dom) dom.fade.style.opacity = st.fade.toFixed(3);
  }
  function RM_SKIP() { return !!st.ctx.disabled; }

  // ---------------------------------------------------------------- rastro de movimento (mistura de quadros)
  // Com a câmera parada, o cenário fica nítido (quadros iguais) e só o kart deixa rastro: o "borrão" da passagem.
  function trail(renderer) {
    const d = dom; if (!d) return; const src = renderer.domElement, on = st.blur > 0.03 && st.fade < 0.999;
    if (!on) { if (d.trail.style.display !== 'none') { d.trail.style.display = 'none'; d.fresh = true; } return; }
    if (!d.trail.parentNode) { if (src.parentNode) src.parentNode.insertBefore(d.trail, src.nextSibling); else document.body.appendChild(d.trail); }
    const r = src.getBoundingClientRect(), sc = Math.min(1, 1280 / Math.max(1, src.width)), w = Math.max(2, Math.round(src.width * sc)), h = Math.max(2, Math.round(src.height * sc));
    if (d.trail.width !== w || d.trail.height !== h) { d.trail.width = w; d.trail.height = h; d.fresh = true; }
    const s = d.trail.style; s.left = r.left + 'px'; s.top = r.top + 'px'; s.width = r.width + 'px'; s.height = r.height + 'px';
    const z = parseInt(getComputedStyle(src).zIndex, 10); s.zIndex = String(Math.max(1, isNaN(z) ? 1 : z)); s.display = 'block';
    d.tctx.globalAlpha = d.fresh ? 1 : 1 - st.blur; d.tctx.drawImage(src, 0, 0, w, h); d.fresh = false;   // logo depois do render: o buffer ainda é válido
  }

  // ---------------------------------------------------------------- render embrulhado
  function wrap(fx, renderer) {
    if (!fx || fx.__fc) return fx; const orig = fx.render; fx.__fc = true;
    const sv = { pos: V(), q: new THREE.Quaternion(), fov: 50, kids: [] };
    fx.render = function (scene, camera) {
      const game = window.Fx && Fx.cam;
      if (!camera || !camera.isPerspectiveCamera || (game && camera !== game)) return orig.call(this, scene, camera);
      try { frame(); } catch (e) { console.warn('[finishcine] desligado:', e); FinishCine.reset(true); st.ctx.disabled = true; }
      if (st.phase === 'idle' || !st.cam) return orig.call(this, scene, camera);
      sv.pos.copy(camera.position); sv.q.copy(camera.quaternion); sv.fov = camera.fov; const foc = fx.focus;
      sv.kids.length = 0; camera.children.forEach(o => { sv.kids.push(o.visible); o.visible = false; });   // velocímetro 3D etc. presos na câmera
      camera.position.copy(st.cam.pos); camera.up.set(0, 1, 0); camera.lookAt(st.cam.look); camera.fov = st.cam.fov;
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); if (typeof foc === 'number') fx.focus = st.cam.focus;
      try { orig.call(this, scene, camera); try { trail(renderer); } catch (e) { st.blur = 0; } }
      finally {
        camera.position.copy(sv.pos); camera.quaternion.copy(sv.q); camera.fov = sv.fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        camera.children.forEach((o, k) => { o.visible = sv.kids[k]; }); if (typeof foc === 'number') fx.focus = foc;
      }
    };
    return fx;
  }
  if (window.PostFX && PostFX.create && !PostFX.create.__fc) {
    const create = PostFX.create; PostFX.create = function (renderer, opts) { return wrap(create.call(this, renderer, opts), renderer); }; PostFX.create.__fc = true;
  } else if (!window.PostFX) console.warn('[finishcine] carregue depois do postfx.js e antes do main.js');

  // fora da corrida: limpa (menu, garagem, lobby...)
  new MutationObserver(() => { const s = document.body.dataset.screen; if (s && !['race', 'round', 'podium'].includes(s) && st.phase !== 'idle') FinishCine.reset(); })
    .observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });

  const FinishCine = {
    CFG: C,
    input: { up: false, down: false, left: false, right: false, steer: 0, brake: 0, drift: false, wheelie: false, item: false },
    get phase() { return st.phase; },
    get active() { return st.phase !== 'idle' && st.phase !== 'done'; },
    get driving() { return st.phase !== 'idle' && st.phase !== 'approach'; },   // depois da linha: o jogador não controla mais
    get timeScale() { return st.ts; },
    scale(dt) { return dt * st.ts; },
    setContext(o) { Object.assign(st.ctx, o || {}); },
    // roda fn quando a cutscene terminar (ou na hora, se não houver cutscene)
    after(fn) { if (FinishCine.active) st.queue.push(fn); else fn(); },
    // flush = true roda o que estava esperando (ex.: erro no meio da cutscene); false descarta (corrida nova, saiu da corrida)
    reset(flush) {
      const q = st.queue.splice(0); st.phase = 'idle'; st.t = 0; st.ts = 1; st.fade = 0; st.blur = 0; st.cam = null; st.prev = null; st.vel = null; st.head = null; st.hint = undefined;
      document.body.classList.remove('fcine'); if (dom) { dom.fade.style.opacity = 0; dom.trail.style.display = 'none'; dom.fresh = true; }
      if (flush) q.forEach(fn => { try { fn(); } catch (e) { } });
    }
  };
  window.FinishCine = FinishCine;
})();
