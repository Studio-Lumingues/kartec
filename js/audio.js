// =====================================================================================
// audio.js — som do jogo feito SÓ com gravações reais (créditos em assets/audio/CREDITOS.txt)
//
// * Motor: cada modelo tem o próprio som (tabela ENGINES): kart gira alto e sem marchas (embreagem centrífuga),
//   muscle e moto trocam de marcha. Gravações reais + camada uma oitava abaixo, saturação e equalização por modelo.
// * Rivais: até 3 motores (cada um com o som do próprio modelo) com volume pela distância, panorâmica (esquerda/direita) pela posição relativa e
//   um leve efeito Doppler (mais agudo chegando, mais grave indo embora).
// * Derrapagem (laço), batidas, aterrissagem, moedas, turbo, contagem, voltas, torcida e aplausos no fim,
//   ambiente de fundo e cliques da interface.
// * Os arquivos vêm num .js em base64 (OGG ou MP3 conforme o navegador), carregado depois do menu:
//   funciona em http(s) e também abrindo o index.html direto do disco.
// * API compatível com a anterior (Sfx.tone/noise/boost/...): chamadas antigas tocam a amostra mais próxima.
// =====================================================================================
(function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // ---------- motor de cada kart: perfil próprio (gravação, faixa de giro, equalização, "sujeira") ----------
  // Karts de verdade não têm marchas: a embreagem centrífuga deixa o giro subir junto com a velocidade e o motor
  // gira alto (zumbido de 2 tempos). A moto troca de marcha. Cada modelo tem o SEU som:
  //   src: gravação base | r0/r1: velocidade de reprodução em marcha lenta / giro máximo | gears: 0 = sem marchas
  //   hp/lp: corta graves/agudos | pf/pg: realce (Hz/dB) | sub: camada uma oitava abaixo (corpo) | drive: saturação
  const ENGINES = {
    gt:      { name: 'Kartec GT (kart de corrida, giro alto)',  src: 'kart-engine', r0: 0.72, r1: 1.42, gears: 0, hp: 120, lp: 12000, pf: 2600, pg: 3,  sub: 0.12, drive: 1.0, vol: 1.0 },
    classic: { name: 'Clássico (kart antigo, mais rouco)',      src: 'kart-engine', r0: 0.62, r1: 1.22, gears: 0, hp: 90,  lp: 6200,  pf: 1300, pg: 4,  sub: 0.22, drive: 1.9, vol: 1.0 },
    muscle:  { name: 'Muscle (kart envenenado, encorpado)',     src: 'kart-engine', r0: 0.55, r1: 1.12, gears: 3, hp: 55,  lp: 7500,  pf: 300,  pg: 5,  sub: 0.4,  drive: 1.6, vol: 1.05, layer: { src: 'engine-car', k: 1.7, g: 0.22 } },
    cyber:   { name: 'Cyber (kart esportivo, agudo)',           src: 'kart-engine', r0: 0.85, r1: 1.62, gears: 0, hp: 200, lp: 14000, pf: 3600, pg: 4,  sub: 0.08, drive: 0.8, vol: 0.92 },
    offroad: { name: 'Off-Road (kart 4x4, grave)',              src: 'kart-engine', r0: 0.52, r1: 1.05, gears: 0, hp: 50,  lp: 5600,  pf: 480,  pg: 6,  sub: 0.45, drive: 1.7, vol: 1.05 },
    moto:    { name: 'Motoca (moto de verdade, com marchas)',   src: 'engine-moto', r0: 0.8,  r1: 2.05, gears: 5, hp: 90,  lp: 10000, pf: 2500, pg: 3,  sub: 0.15, drive: 1.2, vol: 1.0 }
  };
  // contagem: início de cada trecho (s) no som da largada -> 3, 2, 1 e VAI tocam junto com as luzes
  const COUNT_CUTS = [0.43, 1.43, 2.345, 3.36];
  const VOL = { master: 80, engine: 70, sfx: 80, ui: 60, amb: 50 };
  const curveCache = {};
  const driveCurve = k => curveCache[k] || (curveCache[k] = (() => { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } return c; })());

  const Sfx = {
    on: true, ctx: null, master: null, bus: null, buf: {}, ready: false, loading: false, voices: null, lastUi: 0, ENGINES,
    unlock() {
      try {
        if (!this.ctx) { this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
          this.master = this.ctx.createGain(); const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
          this.master.connect(comp); comp.connect(this.ctx.destination);
          this.bus = {}; ['engine', 'sfx', 'ui', 'amb'].forEach(b => { const g = this.ctx.createGain(); g.connect(this.master); this.bus[b] = g; });
          this.applyVolumes(); }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.load();
      } catch (e) { }
    },
    // volumes 0..100 (menu de configurações)
    setVolumes(v) { Object.assign(VOL, v || {}); this.applyVolumes(); },
    getVolumes() { return Object.assign({}, VOL); },
    applyVolumes() {
      if (!this.ctx) return; const t = this.ctx.currentTime, q = x => Math.pow(clamp(x, 0, 100) / 100, 1.6);   // curva perceptiva
      this.master.gain.setTargetAtTime(this.on ? q(VOL.master) * 1.1 : 0, t, 0.03);
      Object.keys(this.bus).forEach(b => this.bus[b].gain.setTargetAtTime(q(VOL[b]) * 1.25, t, 0.03));
    },
    setOn(v) { this.on = v; this.applyVolumes(); },
    load() {
      if (this.loading) return; this.loading = true;
      const a = document.createElement('audio'), ogg = a.canPlayType && a.canPlayType('audio/ogg; codecs="vorbis"');
      const fmt = ogg ? 'ogg' : 'mp3'; this.fmt = fmt;
      const go = () => this.decodeAll();
      if (window.KARTEC_AUDIO) { go(); return; }
      const s = document.createElement('script'); s.src = 'assets/audio_' + fmt + '.js?v=202610290007'; s.async = true; s.onload = go;
      s.onerror = () => { console.warn('[som] não foi possível carregar assets/audio_' + fmt + '.js'); }; document.head.appendChild(s);
    },
    async decodeAll() {
      const A = this.ctx, src = window.KARTEC_AUDIO || {};
      await Promise.all(Object.keys(src).map(async n => {
        try { const bin = atob(src[n]), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          this.buf[n] = await new Promise((res, rej) => A.decodeAudioData(u8.buffer, res, rej)); } catch (e) { console.warn('[som] falhou:', n); }
      }));
      window.KARTEC_AUDIO = null; this.ready = true; this.initVoices();
    },
    // ---------- laços ----------
    loopSrc(name, rate) {
      const A = this.ctx, b = this.buf[name]; if (!b) return null; const s = A.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = rate || 1;
      if (this.fmt === 'mp3') { s.loopStart = 0.06; s.loopEnd = Math.max(0.2, b.duration - 0.06); }
      s.start(0, Math.random() * Math.max(0.05, b.duration - 0.3)); return s;
    },
    loop(name, gain, busName) {
      const A = this.ctx, s = this.loopSrc(name); if (!s) return null;
      const g = A.createGain(), p = A.createStereoPanner ? A.createStereoPanner() : null; g.gain.value = gain || 0; s.connect(g);
      const out = this.bus[busName || 'sfx']; if (p) { g.connect(p); p.connect(out); } else g.connect(out); return { s, g, p };
    },
    // voz de motor de um modelo: gravação (+ camada uma oitava abaixo) -> saturação -> filtros -> volume -> panorâmica
    makeEngine(model) {
      const A = this.ctx, P = ENGINES[model] || ENGINES.gt; if (!this.buf[P.src]) return null;
      const main = this.loopSrc(P.src, P.r0), sub = this.loopSrc(P.src, P.r0 * 0.5), lay = P.layer ? this.loopSrc(P.layer.src, P.r0 * P.layer.k) : null;
      const mix = A.createGain(), subG = A.createGain(), layG = A.createGain(); subG.gain.value = P.sub; layG.gain.value = P.layer ? P.layer.g : 0;
      main.connect(mix); sub.connect(subG); subG.connect(mix); if (lay) { lay.connect(layG); layG.connect(mix); }
      const sh = A.createWaveShaper(); sh.curve = driveCurve(P.drive); sh.oversample = '2x';
      const hp = A.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = P.hp; hp.Q.value = 0.7;
      const pk = A.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = P.pf; pk.gain.value = P.pg; pk.Q.value = 1.1;
      const lp = A.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = P.lp; lp.Q.value = 0.6;
      const g = A.createGain(); g.gain.value = 0; const pan = A.createStereoPanner ? A.createStereoPanner() : null;
      mix.gain.value = 0.55; mix.connect(sh); sh.connect(hp); hp.connect(pk); pk.connect(lp); lp.connect(g);
      if (pan) { g.connect(pan); pan.connect(this.bus.engine); } else g.connect(this.bus.engine);
      return { model, P, main, sub, lay, g, pan, rpm: 0,
        stop() { try { [main, sub, lay].forEach(x => x && x.stop()); } catch (e) { } setTimeout(() => { try { g.disconnect(); } catch (e) { } }, 300); } };
    },
    initVoices() {
      if (this.voices || !this.ready) return;
      this.voices = { me: null, skid: this.loop('skid', 0, 'sfx'), amb: this.loop('ambience', 0, 'amb'), rivals: [null, null, null] };
    },
    // giro normalizado 0..1: kart = embreagem centrífuga (sobe contínuo); com marchas = sobe e cai a cada troca
    rpmOf(k, P) {
      const sp = clamp(Math.abs(k.speed) / CFG.PHYS.MAX, 0, 1.4);
      let r;
      if (!P.gears) r = 0.08 + 0.92 * Math.pow(Math.min(1.15, sp), 0.8);
      else { const gp = Math.min(sp * P.gears * 0.98, P.gears - 0.02), gear = Math.floor(gp); r = 0.12 + 0.75 * (gp - gear) + gear * 0.04; }
      return clamp(r + (k.boostT > 0 ? 0.12 : 0) + (k.drifting ? 0.05 : 0) + (k.air ? 0.15 : 0) + (k.wheelT || 0) * 0.08, 0, 1.25);
    },
    driveVoice(v, k, vol, pan, dop) {
      const A = this.ctx, t = A.currentTime, P = v.P, target = this.rpmOf(k, P);
      v.rpm += (target - v.rpm) * (target > v.rpm ? 0.25 : 0.12);                 // sobe mais rápido do que cai (inércia do motor)
      const rate = (P.r0 + (P.r1 - P.r0) * v.rpm) * (dop || 1);
      v.main.playbackRate.setTargetAtTime(rate, t, 0.04); v.sub.playbackRate.setTargetAtTime(rate * 0.5, t, 0.04); if (v.lay) v.lay.playbackRate.setTargetAtTime(rate * P.layer.k, t, 0.04);
      v.g.gain.setTargetAtTime(vol * P.vol, t, 0.07); if (v.pan) v.pan.pan.setTargetAtTime(pan, t, 0.08);
    },
    // ---------- um disparo ----------
    play(name, o) {
      const A = this.ctx, b = this.buf[name]; if (!A || !b || !this.on) return;
      o = o || {};
      try { const s = A.createBufferSource(), g = A.createGain(), t = A.currentTime + (o.delay || 0);
        s.buffer = b; s.playbackRate.value = o.rate || 1; g.gain.value = o.vol === undefined ? 0.5 : o.vol;
        let out = g; if (o.pan && A.createStereoPanner) { const p = A.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); g.connect(p); out = p; }
        s.connect(g); out.connect(this.bus[o.bus || (name.startsWith('ui-') ? 'ui' : 'sfx')]); s.start(t); } catch (e) { }
    },
    ui(name, vol) { const t = performance.now(); if (t - this.lastUi < 35) return; this.lastUi = t; this.play(name, { vol: vol || 0.35, bus: 'ui' }); },
    // ---------- motores (chamado todo quadro) ----------
    step(k, active, others) {
      const v = this.voices, A = this.ctx; if (!v || !A) return;
      const t = A.currentTime, on = active && k && k.m;
      // seu kart: voz do SEU modelo (refeita se trocar de kart)
      const model = on ? (k.spec && k.spec.model) || (k.m.moto ? 'moto' : 'gt') : null;
      if (v.me && (!on || v.me.model !== model)) { v.me.g.gain.setTargetAtTime(0, t, 0.05); v.me.stop(); v.me = null; }
      if (on && !v.me) v.me = this.makeEngine(model);
      if (v.me) this.driveVoice(v.me, k, 0.42 + 0.18 * clamp(Math.abs(k.speed) / CFG.PHYS.MAX, 0, 1), 0, 1);
      // derrapagem
      const sp = on ? clamp(Math.abs(k.speed) / CFG.PHYS.MAX, 0, 1) : 0;
      const skid = on && (k.drifting || (Math.abs(k.steerVis || 0) > 0.6 && Math.abs(k.speed) > CFG.PHYS.MAX * 0.62 && !k.off && !k.air));
      if (v.skid) { v.skid.g.gain.setTargetAtTime(skid ? (k.drifting ? 0.32 : 0.18) : 0, t, 0.05); v.skid.s.playbackRate.setTargetAtTime(0.85 + sp * 0.3, t, 0.1); }
      if (v.amb) v.amb.g.gain.setTargetAtTime(active ? 0.14 : 0, t, 0.5);
      // rivais: os 3 mais próximos, cada um com o som do PRÓPRIO modelo
      const list = active && k && others ? others.filter(o => o && o.m && !o.gone) : [];
      list.sort((a, b) => a.pos.distanceToSquared(k.pos) - b.pos.distanceToSquared(k.pos));
      for (let i = 0; i < 3; i++) {
        const o = list[i], slot = v.rivals[i], om = o ? (o.spec && o.spec.model) || (o.m.moto ? 'moto' : 'gt') : null;
        if (slot && (!o || slot.model !== om || slot.kart !== o)) { if (!o || slot.model !== om) { slot.g.gain.setTargetAtTime(0, t, 0.05); slot.stop(); v.rivals[i] = null; } else slot.kart = o; }
        if (!o) continue;
        if (!v.rivals[i]) { v.rivals[i] = this.makeEngine(om); if (!v.rivals[i]) continue; v.rivals[i].kart = o; v.rivals[i].rpm = this.rpmOf(o, v.rivals[i].P); }
        const dx = o.pos.x - k.pos.x, dz = o.pos.z - k.pos.z, d = Math.hypot(dx, dz) || 1, vol = 0.34 * clamp(1 - d / 80, 0, 1) ** 1.6;
        const right = (dx * Math.cos(k.ang) - dz * Math.sin(k.ang)) / d;
        const rv = ((Math.sin(o.mvAng) * o.speed - Math.sin(k.mvAng) * k.speed) * dx + (Math.cos(o.mvAng) * o.speed - Math.cos(k.mvAng) * k.speed) * dz) / d;
        this.driveVoice(v.rivals[i], o, vol, clamp(-right * 0.8, -0.85, 0.85), clamp(1 - rv * 0.004, 0.85, 1.15));
      }
    },
    // ---------- eventos ----------
    boost() { this.play('ui-maximize_006', { vol: 0.5, rate: 0.9 }); },
    coin() { this.play('coin', { vol: 0.45 }); },
    bump(strength) { this.play('impact', { vol: clamp(0.35 + (strength || 4) * 0.03, 0.3, 0.8), rate: 0.85 + Math.random() * 0.3 }); },
    land() { this.play('land', { vol: 0.6 }); this.play('impact', { vol: 0.25, rate: 0.6 }); },
    drift() { this.play('ui-pluck_002', { vol: 0.35, rate: 1.1 }); },
    spark(level) { this.play('ui-glass_002', { vol: 0.3, rate: level > 1 ? 1.3 : 1.0 }); },
    lap() { this.play('ui-confirmation_001', { vol: 0.55 }); },
    finalLap() { this.play('ui-confirmation_004', { vol: 0.6 }); this.play('cheer', { vol: 0.25 }); },
    // um trecho do som de largada por luz (o online fica sincronizado porque cada luz dispara o seu trecho)
    count(go, step) {
      const b = this.buf['race-start'];
      if (b && this.ctx && this.on) { const i = go ? 3 : Math.max(0, Math.min(2, step | 0)), from = COUNT_CUTS[i], to = go ? b.duration : COUNT_CUTS[i + 1] - 0.03;
        try { const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = b; g.gain.value = 0.75; s.connect(g); g.connect(this.bus.sfx); s.start(this.ctx.currentTime, from, Math.max(0.05, to - from)); } catch (e) { }
        if (go) this.play('applause', { vol: 0.15, delay: 0.3 }); return; }
      if (go) { this.play('ui-confirmation_004', { vol: 0.65 }); this.play('applause', { vol: 0.18 }); } else this.play('ui-bong_001', { vol: 0.6 });
    },
    wrong() { this.play('ui-error_004', { vol: 0.45 }); },
    fanfare() { this.play('cheer', { vol: 0.55 }); this.play('applause', { vol: 0.45, delay: 0.4 }); },
    tone(f0, f1, d, type, vol) {
      if (!this.on) return; const v = clamp((vol || 0.1) * 4, 0.15, 0.6);
      if (f0 >= 600) this.ui(f1 > f0 ? 'ui-select_001' : 'ui-click_002', v);
      else if (f0 >= 250) this.ui('ui-switch_002', v * 0.8);
      else this.play('ui-drop_003', { vol: v, rate: clamp(f0 / 160, 0.5, 1.4) });
    },
    noise(d, f0, f1, vol) { this.play('impact', { vol: clamp((vol || 0.1) * 2, 0.1, 0.5), rate: f1 > f0 ? 1.2 : 0.55 }); }
  };
  window.Sfx = Sfx;
  // o navegador só libera o som depois de um gesto do jogador: o primeiro clique/tecla em qualquer lugar já destrava
  ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => Sfx.unlock(), { capture: true, passive: true }));
  // cliques da interface: qualquer botão do jogo
  addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b && !b.disabled) Sfx.ui(b.classList.contains('cta') ? 'ui-confirmation_001' : 'ui-click_002', 0.4); }, true);
  addEventListener('pointerover', e => { const b = e.target.closest && e.target.closest('.navBtn, .cta, .gCard, .roomItem'); if (b && e.pointerType === 'mouse' && !(e.relatedTarget && b.contains(e.relatedTarget))) Sfx.ui('ui-tick_002', 0.18); }, true);
})();
