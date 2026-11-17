// =====================================================================================
// settings.js — menu de configurações: volumes (geral, motores, efeitos, interface, ambiente) e gráficos
// (predefinição, resolução, sombras, contornos, cenário, partículas, distância de visão, efeitos de velocidade,
// tremor da câmera e contador de FPS). Tudo é salvo no navegador e aplicado na hora quando possível;
// densidade do cenário e distância de visão valem a partir da próxima pista carregada.
// =====================================================================================
(function () {
  const $ = id => document.getElementById(id);
  const KEY = () => CFG.STORAGE + ':settings';
  // predefinições de gráficos
  // MASSINHA: o mínimo possível para PC/celular fraco (meia resolução, sem sombra, sem pós-efeito, sem reflexo,
  // texturas viram cor lisa, pouca coisa no cenário, visão curta). ULTRA: o máximo (sombra 4096, cenário mais cheio).
  const PRESETS = {
    auto:     { res: 'auto', shadows: 'medium', outlines: true,  scenery: 'high',   particles: 'normal', view: 'far',      postfx: 'full',   water: 'high', detail: 'high',   textures: 'full', fpsCap: '0', texRes: '2048', dof: true },
    massinha: { res: '0.5',  shadows: 'off',    outlines: false, scenery: 'min',    particles: 'min',    view: 'veryNear', postfx: 'off',    water: 'off',  detail: 'low',    textures: 'flat', fpsCap: '60', texRes: '512', dof: false },
    low:      { res: '0.75', shadows: 'off',    outlines: false, scenery: 'low',    particles: 'low',    view: 'near',     postfx: 'simple', water: 'low',  detail: 'low',    textures: 'full', fpsCap: '60', texRes: '1024', dof: false },
    medium:   { res: '1',    shadows: 'low',    outlines: true,  scenery: 'medium', particles: 'normal', view: 'medium',   postfx: 'simple', water: 'low',  detail: 'medium', textures: 'full', fpsCap: '0', texRes: '1024', dof: false },
    high:     { res: '1.5',  shadows: 'high',   outlines: true,  scenery: 'high',   particles: 'normal', view: 'far',      postfx: 'full',   water: 'high', detail: 'high',   textures: 'full', fpsCap: '0', texRes: '2048', dof: true },
    ultra:    { res: '2',    shadows: 'ultra',  outlines: true,  scenery: 'ultra',  particles: 'normal', view: 'far',      postfx: 'full',   water: 'high', detail: 'high',   textures: 'full', fpsCap: '0', texRes: 'max', dof: true }
  };
  const DEF = { vol: { master: 80, engine: 70, sfx: 80, ui: 60, amb: 50 },
    gfx: Object.assign({ preset: 'auto', speedFx: true, shake: true, fps: false }, PRESETS.auto) };
  const SHADOW = { off: 0, low: 512, medium: 1024, high: 2048, ultra: 4096 };
  const DENS = { min: 0.15, low: 0.35, medium: 0.65, high: 1, ultra: 1.35 };
  const VIEW = { veryNear: 0.45, near: 0.62, medium: 0.82, far: 1 };
  const PARTS = { min: 0.15, low: 0.45, normal: 1 };
  // opções que fazem a predefinição virar "Personalizada" quando mexidas
  const GFX_KEYS = ['res', 'shadows', 'outlines', 'scenery', 'particles', 'view', 'postfx', 'water', 'detail', 'textures', 'fpsCap', 'texRes', 'dof'];

  // =====================================================================================
  // GRÁFICOS RECOMENDADOS: na 1ª vez que a pessoa abre o jogo, ele olha a máquina e escolhe a predefinição que deve
  // rodar liso nela. Quando o menu aparece, o jogo PERGUNTA se a pessoa quer usar essa qualidade (recAsk); nada muda
  // sem o "sim". A detecção e a resposta ficam salvas no localStorage (junto das configurações, em "rec") e a pergunta
  // não volta, a não ser pelo botão "Detectar de novo" nas configurações.
  //  1) placa de vídeo pelo nome (WEBGL_debug_renderer_info) -> nível conhecido (0 = Massinha ... 4 = Ultra)
  //  2) teste rápido da placa (~0,3 s): um shader pesado numa tela escondida, medindo quanto ele demora
  //  3) limites do aparelho: celular, poucos núcleos ou pouca memória seguram o nível
  // Na corrida, se a recomendação não der conta (FPS baixo por ~20 s), o jogo desce UM nível sozinho (perfTick).
  // =====================================================================================
  const TIERS = ['massinha', 'low', 'medium', 'high', 'ultra'];
  const TIER_NAME = { massinha: 'Massinha', low: 'Baixa', medium: 'Média', high: 'Alta', ultra: 'Ultra', auto: 'Automática', custom: 'Personalizada' };
  const REC_VERSION = 2;   // 2: pergunta antes de aplicar (a 1 aplicava sozinha); quem tinha a 1 é perguntado uma vez
  // nível pelo nome da placa (do mais forte para o mais fraco; a 1ª regra que bater vale)
  const GPU_RULES = [
    [/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i, 0],
    [/rtx\s*(30[6-9]0|40[5-9]0|50\d0)|rx\s*(6[7-9]\d0|7[7-9]\d0|9\d{3})|apple m\d\s*(pro|max|ultra)|radeon\s*pro\s*w/i, 4],
    [/rtx|gtx\s*(10[6-8]0|16[5-6]0|9[78]0|titan)|rx\s*(5[6-7]\d0|6[5-6]\d0|7[6]\d0|vega\s*(56|64))|apple m\d|arc\s*a[57]|radeon\s*(780m|890m)/i, 3],
    [/gtx|rx\s*[456]\d0|rx\s*5[35]00|radeon.*(vega|680m|660m)|iris\s*xe|arc|mx\s*\d{3}|apple gpu|adreno.*(7[3-9]\d|8\d\d)|mali-g7[1-9]|mali-g[6-9]\d\d|immortalis|xclipse/i, 2],
    [/intel|uhd|hd graphics|radeon\s*(r[2-7]|hd)|adreno|mali|powervr|apple a\d|tegra|videocore/i, 1]
  ];
  const HwDetect = {
    info() {
      const n = navigator, ua = n.userAgent || '';
      const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && n.maxTouchPoints > 1);
      return { mobile, cores: n.hardwareConcurrency || 0, mem: n.deviceMemory || 0,
        screen: Math.round((screen.width || 0) * (screen.height || 0) * Math.pow(devicePixelRatio || 1, 2) / 1e4) / 100 };   // megapixels de verdade
    },
    // abre um WebGL escondido: nome da placa + teste de desempenho. Sempre devolve algo (nunca derruba o jogo)
    gpu() {
      const out = { gpu: '', bench: 0, webgl: false };
      let cv, gl;
      try {
        cv = document.createElement('canvas'); cv.width = 768; cv.height = 432;
        gl = cv.getContext('webgl', { antialias: false, depth: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false });
        if (!gl) return out;
        out.webgl = true;
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        out.gpu = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
        // shader de teste: 40 voltas de trigonometria por pixel (parecido com o custo de luz/névoa/pós-efeito do jogo)
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
        const pr = gl.createProgram();
        gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
        gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision highp float;uniform float t;void main(){vec2 p=gl_FragCoord.xy*.013;float a=t;' +
          'for(int i=0;i<40;i++){p=vec2(p.x*cos(a)-p.y*sin(a),p.x*sin(a)+p.y*cos(a))+vec2(sin(p.y+t),cos(p.x));a+=sin(p.x*p.y)*.37;}' +
          'gl_FragColor=vec4(fract(a),fract(p),1.);}'));
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return out;
        gl.useProgram(pr);
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const ut = gl.getUniformLocation(pr, 't'), px = new Uint8Array(4);
        const draw = i => { gl.uniform1f(ut, i * 0.1); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
        draw(0); draw(1);                                           // aquecimento (compilação de verdade acontece aqui)
        const times = [], t0 = performance.now();
        for (let i = 2; i < 30; i++) {                              // até 28 quadros ou ~300 ms (placa fraca para cedo)
          const a = performance.now(); draw(i); times.push(performance.now() - a);
          if (performance.now() - t0 > 300) break;
        }
        times.sort((x, y) => x - y);
        const med = times[Math.floor(times.length / 2)] || 1e3;
        out.bench = Math.round(cv.width * cv.height * 40 / Math.max(0.05, med) / 1e3);   // "pontos" = milhares de voltas por ms
      } catch (e) { console.warn('[gráficos] teste da placa falhou:', e); }
      finally { try { const lc = gl && gl.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext(); } catch (e) { } }
      return out;
    },
    // nível do teste: quanto mais pontos, mais forte. Medido: SwiftShader (CPU de 12 núcleos) ~900; RTX 3060 ~44000.
    // Pela proporção de TFLOPS: Intel UHD 620 ~1500, Iris Xe ~7000, GTX 1650 ~10000, RTX 4090 ~250000.
    benchTier(p) { return p <= 0 ? -1 : p < 600 ? 0 : p < 2500 ? 1 : p < 8000 ? 2 : p < 25000 ? 3 : 4; },
    nameTier(gpu) { for (const [re, t] of GPU_RULES) if (re.test(gpu)) return t; return -1; },
    run() {
      const inf = this.info(), g = this.gpu(), why = [];
      let tier;
      const byName = this.nameTier(g.gpu), byBench = this.benchTier(g.bench);
      if (!g.webgl) { tier = 0; why.push('sem WebGL'); }
      else if (byName === 0) { tier = 0; why.push('placa de vídeo por software'); }
      else if (byName >= 0 && byBench >= 0) { tier = Math.min(byName, byBench + 1); why.push('placa + teste'); }   // o teste segura nomes "fortes" em modo economia
      else if (byName >= 0) { tier = byName; why.push('placa'); }
      else if (byBench >= 0) { tier = byBench; why.push('teste'); }
      else { tier = 2; why.push('padrão'); }
      // limites do aparelho
      if (inf.mobile) { tier = Math.min(tier, inf.mem && inf.mem <= 3 ? 1 : 2); why.push('celular/tablet'); }
      if (inf.cores && inf.cores <= 2) { tier = Math.min(tier, 1); why.push(inf.cores + ' núcleos'); }
      else if (inf.cores && inf.cores <= 4) tier = Math.min(tier, 3);
      if (inf.mem && inf.mem <= 2) { tier = Math.min(tier, 1); why.push(inf.mem + ' GB de memória'); }
      else if (inf.mem && inf.mem <= 4) tier = Math.min(tier, 2);
      if (inf.screen > 8 && tier === 4) tier = 3;                   // tela 4K: o Ultra (resolução máxima) pesa demais
      tier = Math.max(0, Math.min(4, tier));
      return { v: REC_VERSION, preset: TIERS[tier], tier, gpu: g.gpu, bench: g.bench, nameTier: byName, benchTier: byBench,
        mobile: inf.mobile, cores: inf.cores, mem: inf.mem, why: why.join(', '), at: new Date().toISOString(), answer: null, auto: false };
    }
  };
  window.HwDetect = HwDetect;
  // nome curto e legível da placa para mostrar ao jogador ("ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 ...)" -> "NVIDIA GeForce GTX 1650")
  const prettyGpu = s => { s = String(s || ''); const m = /ANGLE \([^,]*,\s*([^,(]+?)(?:\s+\(0x[0-9a-f]+\))?\s*(?:Direct3D|OpenGL|Vulkan|Metal|,|\))/i.exec(s);
    return (m ? m[1] : s).replace(/\s*\/PCIe\/SSE2|\s*\(TM\)|\s*\(R\)/gi, '').trim().slice(0, 60) || 'placa de vídeo desconhecida'; };

  const Settings = {
    s: null,
    load() {
      let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY()) || 'null'); } catch (e) { }
      this.s = { vol: Object.assign({}, DEF.vol, saved && saved.vol), gfx: Object.assign({}, DEF.gfx, saved && saved.gfx), rec: (saved && saved.rec) || null };
      // 1ª vez (ou recomendação de uma versão antiga): detecta a máquina, mas NÃO aplica: a pergunta aparece no menu.
      // Se a qualidade atual já é a recomendada, não há o que perguntar.
      if (!this.s.rec || this.s.rec.v !== REC_VERSION) {
        const rec = HwDetect.run();
        if (this.s.gfx.preset === rec.preset) { rec.answer = 'same'; rec.auto = true; }
        this.s.rec = rec; this.save();
        console.info('[gráficos] recomendado: ' + rec.preset + ' (' + rec.why + ') · placa: ' + (rec.gpu || '?') + ' · teste: ' + rec.bench);
      }
      return this.s;
    },
    rec() { return this.s && this.s.rec; },
    recName() { const r = this.rec(); return r ? TIER_NAME[r.preset] : ''; },
    gpuName() { const r = this.rec(); return r ? prettyGpu(r.gpu) : ''; },
    // "Detectar de novo" (configurações): roda o teste e aplica a recomendação
    redetect() {
      const rec = HwDetect.run(); rec.answer = 'yes'; rec.auto = true; this.s.rec = rec;
      Object.assign(this.s.gfx, PRESETS[rec.preset]); this.s.gfx.preset = rec.preset;
      this.save(); this.apply(); this.sync();
      if (window.UI && UI.toast) UI.toast('Recomendado para esta máquina: ' + TIER_NAME[rec.preset], 2600);
    },
    // a pessoa mexeu nos gráficos: a recomendação deixa de ser ajustada sozinha
    userTouched() { if (this.s.rec && this.s.rec.auto) { this.s.rec.auto = false; } },
    // ---------- rede de segurança na corrida ----------
    // Chamado a cada quadro pelo laço do jogo. Só age se a qualidade atual é a recomendada automaticamente (a pessoa
    // não mexeu). Janelas de 10 s de corrida: duas seguidas abaixo de ~42 FPS -> desce um nível, salva e avisa.
    perfTick(raw, racing) {
      const r = this.s && this.s.rec, g = this.s && this.s.gfx;
      if (!r || !r.auto || !racing || document.hidden || raw <= 0 || raw > 0.25 || g.preset !== r.preset) { if (!racing) this._pf = null; return; }
      const p = this._pf || (this._pf = { acc: 0, n: 0, bad: 0, skip: 1 });
      p.acc += raw; p.n++;
      if (p.acc < 10) return;
      const fps = p.n / p.acc; p.acc = 0; p.n = 0;
      if (p.skip > 0) { p.skip--; return; }                          // ignora os primeiros 10 s (compilação, largada)
      const cap = this.fpsCap(), want = cap ? Math.min(cap, 60) * 0.7 : 42;
      p.bad = fps < want ? p.bad + 1 : 0;
      if (p.bad < 2) return;
      const i = TIERS.indexOf(r.preset); if (i <= 0) { r.auto = false; this.save(); return; }
      const next = TIERS[i - 1]; r.preset = next; r.lowered = (r.lowered || 0) + 1; p.bad = 0; p.skip = 1;
      Object.assign(g, PRESETS[next]); g.preset = next; this.save(); this.apply(); this.sync && $('setGfx') && $('setGfx').innerHTML && this.sync();
      console.info('[gráficos] ' + fps.toFixed(0) + ' FPS: baixando para ' + next);
      if (window.UI && UI.toast) UI.toast('Gráficos ajustados para ' + TIER_NAME[next] + ' para rodar mais liso', 3200);
    },
    save() { try { localStorage.setItem(KEY(), JSON.stringify(this.s)); } catch (e) { } },
    get g() { return this.s.gfx; },
    // ---------- consultas usadas pelo jogo ----------
    autoPerf() { return this.s.gfx.preset === 'auto'; },                       // resolução adaptativa e "modo leve" automático
    fixedDpr() { const r = this.s.gfx.res; return r === 'auto' ? 0 : Math.min(parseFloat(r), Math.max(1, devicePixelRatio)); },
    dprMax() { return this.s.gfx.res === 'auto' ? CFG.PERF.DPR_MAX : this.fixedDpr(); },
    sceneryDensity() { return DENS[this.s.gfx.scenery] || 1; },
    viewMul() { return VIEW[this.s.gfx.view] || 1; },
    // usados pela pista (tracks.js): detalhe da geometria (ao carregar) e qualidade da água (na hora)
    q() { const g = this.s ? this.s.gfx : DEF.gfx; return { water: g.water || 'high', detail: g.detail || 'high' }; },
    fpsCap() { return +(this.s && this.s.gfx.fpsCap) || 0; },                   // 0 = sem limite (acompanha a tela)
    postfxMode() { return (this.s && this.s.gfx.postfx) || 'full'; },
    applyPreset(name) { if (!PRESETS[name]) return; Object.assign(this.s.gfx, PRESETS[name]); this.s.gfx.preset = name; this.apply(); this.sync && $('setGfx') && $('setGfx').innerHTML && this.sync(); },
    // ---------- aplicação ----------
    apply() {
      const g = this.s.gfx;
      if (window.Sfx) Sfx.setVolumes(this.s.vol);
      // partículas
      if (window.Fx) Fx.rate = PARTS[g.particles] || 1;
      // texturas lisas (Massinha): vale para o que for montado depois (próxima pista)
      if (window.TX) TX.flat = g.textures === 'flat';
      // pós-efeito: completo, simples (só cor + FXAA, sem sombra de contato, brilho e raios de sol) ou desligado
      const pf = window.__kart && __kart.postFX;
      if (pf && pf.opts) { if (!pf.base) pf.base = Object.assign({}, pf.opts);
        Object.assign(pf.opts, pf.base);
        if (g.postfx === 'simple') Object.assign(pf.opts, { ao: 0, bloom: 0, rays: 0, scatter: 0, dof: 0 });
        if (g.dof === false) pf.opts.dof = 0; }
      // sombras: tamanho do mapa e liga/desliga (muda os shaders -> materiais precisam recompilar)
      const sz = SHADOW[g.shadows], R = window.__kart && __kart.renderer;
      CFG.PERF.SHADOW_MAP = sz || 512;
      if (R) { const want = sz > 0;
        if (R.shadowMap.enabled !== want) { R.shadowMap.enabled = want; this.eachScene(sc => sc.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); })); }
        if (window.Env && Env.sun && sz) { if (Env.sun.shadow.mapSize.x !== sz) { Env.sun.shadow.mapSize.set(sz, sz); if (Env.sun.shadow.map) { Env.sun.shadow.map.dispose(); Env.sun.shadow.map = null; } } } }
      // modo leve (o antigo 'contornos' agora só liga/desliga o modo leve dos presets; o cel shading saiu do jogo)
      if (window.Game) { Game.lite = !g.outlines; this.eachScene(sc => sc.traverse(o => { if (o.material && o.material.userData && o.material.userData.outline) o.visible = g.outlines; }));
        (Game.karts || []).forEach(k => { k._near = undefined; }); }
      // resolução fixa: aplica já (a automática é ajustada pelo laço do jogo)
      if (R && this.fixedDpr()) R.setPixelRatio(this.fixedDpr());
      // distância de visão: névoa da pista atual (o cenário distante é cortado junto)
      if (window.Env && Env.baseFogFar && window.Game && Game.scene && Game.scene.fog) Env.fogFar = Env.baseFogFar * this.viewMul();
      // contador de FPS
      this.fpsOn(g.fps);
    },
    eachScene(fn) { [window.Game && Game.scene, window.Showroom && Showroom.scene, window.Podium && Podium.scene, window.Intro && Intro.scene].forEach(sc => sc && fn(sc)); },
    // contador de FPS: placa escura igual às da HUD. Na corrida fica centralizado sob a placa da volta
    // (dentro de #lapCol); nas outras telas fica no canto superior esquerdo, no mesmo lugar da volta.
    fpsOn(on) {
      let el = $('fpsPill');
      if (!on) { if (el) el.hidden = true; return; }
      if (!el) {
        el = document.createElement('div'); el.id = 'fpsPill'; el.className = 'hudPlate'; el.setAttribute('aria-hidden', 'true');
        el.innerHTML = '<b>--</b><small>FPS</small>'; document.body.appendChild(el);
        const num = el.firstChild;
        let n = 0, t0 = performance.now();
        const tick = now => {
          n++; this.fpsFollow();
          if (now - t0 >= 500) { num.textContent = Math.min(999, Math.round(n * 1000 / (now - t0))); n = 0; t0 = now; this.fpsPlace(); }
          if (!el.hidden) requestAnimationFrame(tick); else this._fpsRun = false;
        };
        this._fpsTick = tick;
      }
      el.hidden = false; this.fpsPlace();
      if (!this._fpsRun) { this._fpsRun = true; requestAnimationFrame(this._fpsTick); }
    },
    fpsPlace() {
      const el = $('fpsPill'), col = $('lapCol'); if (!el) return;
      const race = document.body.dataset.screen === 'race' && col;
      const parent = race ? col : document.body;
      if (el.parentNode !== parent) parent.appendChild(el);
      el.classList.toggle('inHud', !!race);
      if (!race) el.style.transform = el.style.translate = el.style.rotate = el.style.scale = el.style.opacity = '';
    },
    // acompanha a placa de voltas quadro a quadro: copia o movimento dela (transform, translate, rotate, scale e
    // opacidade, venha de estilo, classe CSS ou animação) e usa como pivô o MESMO ponto da placa de voltas.
    // Assim balanço, tremor, giro e "pulo" da troca de volta movem as duas placas juntas, como uma peça só.
    fpsFollow() {
      const el = $('fpsPill'), lap = $('lap');
      if (!el || !lap || !el.classList.contains('inHud')) return;
      const cs = getComputedStyle(lap);
      el.style.transform = cs.transform === 'none' ? '' : cs.transform;
      el.style.translate = cs.translate === 'none' ? '' : cs.translate;
      el.style.rotate = cs.rotate === 'none' ? '' : cs.rotate;
      el.style.scale = cs.scale === 'none' ? '' : cs.scale;
      el.style.opacity = cs.opacity;
      const o = cs.transformOrigin.split(' ').map(parseFloat);
      if (o.length >= 2 && o.every(isFinite)) el.style.transformOrigin = (lap.offsetLeft + o[0] - el.offsetLeft) + 'px ' + (lap.offsetTop + o[1] - el.offsetTop) + 'px';
    },
    // ---------- interface ----------
    init() {
      if (!this.s) this.load(); this.apply();
      const vol = [['master', 'Volume geral'], ['engine', 'Motores'], ['sfx', 'Efeitos (batidas, derrapagem, turbo)'], ['ui', 'Interface e avisos'], ['amb', 'Ambiente e torcida']];
      $('setVol').innerHTML = vol.map(([k, t]) => '<label class="slider"><span>' + t + '</span><input type="range" min="0" max="100" step="1" data-vol="' + k + '"><output></output></label>').join('');
      const opt = (id, label, items, hint) => '<div class="setRow"><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span><div class="seg mini" data-g="' + id + '">' + items.map(([v, t]) => '<button type="button" data-v="' + v + '">' + t + '</button>').join('') + '</div></div>';
      const tog = (id, label, hint) => '<div class="setRow"><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span><div class="seg mini" data-g="' + id + '"><button type="button" data-v="1">Ligado</button><button type="button" data-v="0">Desligado</button></div></div>';
      $('setGfx').innerHTML =
        '<div class="recRow"><div class="recTxt"><b>Recomendado para esta máquina: <em id="recName"></em></b><small id="recGpu"></small></div>' +
          '<button type="button" id="recAgain" class="ghost">Detectar de novo</button></div>' +
        opt('preset', 'Qualidade', [['auto', 'Automática'], ['massinha', 'Massinha'], ['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['ultra', 'Ultra'], ['custom', 'Personalizada']],
          'Massinha: o mais leve possível, para PC ou celular fraco. Automática ajusta a resolução sozinha') +
        opt('res', 'Resolução', [['auto', 'Auto'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.5', '150%'], ['2', 'Máxima']], 'O que mais pesa: menor = mais FPS e menos memória') +
        opt('fpsCap', 'Limite de FPS', [['30', '30'], ['60', '60'], ['0', 'Livre']], 'Limitar esquenta menos e gasta menos bateria') +
        opt('shadows', 'Sombras', [['off', 'Sem'], ['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['ultra', 'Ultra']]) +
        opt('postfx', 'Pós-efeito', [['off', 'Sem'], ['simple', 'Simples'], ['full', 'Completo']], 'Completo: sombra de contato, brilho e raios de sol. Simples: só cor e antisserrilhado') +
        opt('water', 'Água', [['off', 'Simples'], ['low', 'Média'], ['high', 'Reflexo total']], 'O reflexo redesenha a cena: desligar ganha muito FPS perto do rio') +
        tog('dof', 'Desfoque de distância', 'O que está longe do kart fica levemente desfocado. Só com o pós-efeito Completo') +
        opt('detail', 'Detalhe do mapa', [['low', 'Baixo'], ['medium', 'Médio'], ['high', 'Alto']], 'Montanhas, terreno, névoa da cachoeira e enfeites. Vale na próxima corrida') +
        opt('textures', 'Texturas', [['flat', 'Massinha (cor lisa)'], ['full', 'Detalhadas']], 'Vale na próxima corrida') +
        opt('texRes', 'Resolução das texturas 3D', [['512', '512'], ['1024', '1024'], ['2048', '2048'], ['max', 'Original']], 'Piloto, karts, garagem e fadinha. O que mais gasta memória de vídeo. Vale ao recarregar o jogo (F5)') +
        opt('scenery', 'Cenário', [['min', 'Mínimo'], ['low', 'Leve'], ['medium', 'Médio'], ['high', 'Completo'], ['ultra', 'Ultra']], 'Árvores e enfeites até o horizonte. Vale na próxima corrida') +
        opt('particles', 'Partículas', [['min', 'Mínimas'], ['low', 'Poucas'], ['normal', 'Normais']]) +
        opt('view', 'Distância de visão', [['veryNear', 'Muito curta'], ['near', 'Curta'], ['medium', 'Média'], ['far', 'Longa']]) +
        tog('speedFx', 'Linhas de velocidade') + tog('shake', 'Tremor da câmera') + tog('fps', 'Mostrar FPS');
      // abas
      $('setTabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => this.tab(b.dataset.v)));
      // volumes (arrastar = ouvir na hora)
      $('setVol').querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => { this.s.vol[inp.dataset.vol] = +inp.value; inp.nextElementSibling.textContent = inp.value + '%';
        inp.style.setProperty('--p', inp.value + '%'); Sfx.setVolumes(this.s.vol); this.save(); }));
      $('setVol').querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => { if (inp.dataset.vol === 'ui' || inp.dataset.vol === 'master') Sfx.ui('ui-click_002', 0.5); else if (inp.dataset.vol === 'sfx') Sfx.bump(4); }));
      // gráficos
      $('setGfx').querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const id = seg.dataset.g, v = b.dataset.v, g = this.s.gfx;
        const oldTex = g.texRes;
        if (id === 'preset') { if (v !== 'custom') Object.assign(g, PRESETS[v]); g.preset = v; this.userTouched(); }
        else { g[id] = (v === '1' ? true : v === '0' ? false : v); if (GFX_KEYS.includes(id)) { g.preset = 'custom'; this.userTouched(); } }
        this.save(); this.apply(); this.sync();
        if (g.texRes !== oldTex && window.UI && UI.toast) UI.toast('Resolução das texturas: vale ao recarregar o jogo (F5)', 2600); })));
      // restaurar padrão = volumes padrão + a qualidade recomendada para esta máquina (a detecção continua salva)
      $('setReset').addEventListener('click', () => { const rec = this.s.rec; this.s = JSON.parse(JSON.stringify(DEF)); this.s.rec = rec;
        if (rec) { Object.assign(this.s.gfx, PRESETS[rec.preset]); this.s.gfx.preset = rec.preset; rec.auto = true; }
        this.save(); this.apply(); this.sync(); UI.toast('Configurações padrão restauradas', 1500); });
      $('recAgain').addEventListener('click', () => this.redetect());
      this.recAsk();
      $('btnSettings').addEventListener('click', () => this.open());
      $('setBtn').addEventListener('click', () => this.open());

      this.sync();
    },
    tab(t) { $('setTabs').querySelectorAll('button').forEach(b => { const on = b.dataset.v === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }); $('setVol').hidden = t !== 'vol'; $('setGfx').hidden = t !== 'gfx'; },
    // opts.back: modal para voltar ao fechar (a Pausa)
    open(opts) { if (window.Sfx) Sfx.unlock(); this.sync(); UI.openModal('settingsModal', opts); },
    sync() {
      $('setVol').querySelectorAll('input').forEach(inp => { inp.value = this.s.vol[inp.dataset.vol]; inp.nextElementSibling.textContent = inp.value + '%'; inp.style.setProperty('--p', inp.value + '%'); });
      $('setGfx').querySelectorAll('.seg').forEach(seg => { const id = seg.dataset.g, cur = this.s.gfx[id], val = typeof cur === 'boolean' ? (cur ? '1' : '0') : String(cur);
        seg.querySelectorAll('button').forEach(b => { const on = b.dataset.v === val; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); });
      // recomendação: nome, placa e estrelinha no botão da qualidade recomendada
      const r = this.rec(), rn = $('recName'), rg = $('recGpu');
      if (rn) rn.textContent = r ? TIER_NAME[r.preset] : '—';
      if (rg) rg.textContent = r ? this.gpuName() + (r.lowered ? ' · ajustada durante a corrida' : '') : '';
      const ps = $('setGfx').querySelector('[data-g="preset"]');
      if (ps) ps.querySelectorAll('button').forEach(b => b.classList.toggle('rec', !!r && b.dataset.v === r.preset));
    },
    // pergunta da 1ª visita: quando o menu principal aparece, "Quer usar os gráficos recomendados?"
    //  Usar recomendado (ou Enter) -> aplica e salva | Agora não (ou Esc / clicar fora) -> mantém como está e salva
    // A pergunta só deixa de aparecer depois de uma resposta: se fechar a aba antes, ela volta na próxima vez.
    recAsk() {
      const r = this.rec(); if (!r || r.answer) return;
      const m = $('recModal'); if (!m) return;
      const ask = () => {
        if (r.answer) return;
        if (UI.modal || document.body.dataset.screen !== 'menu') { setTimeout(ask, 800); return; }   // outro menu aberto: espera
        $('recIc').textContent = ['🐢', '🚗', '🏎️', '🚀', '🔥'][r.tier] || '🏎️';
        $('recQName').textContent = TIER_NAME[r.preset];
        $('recQGpu').textContent = this.gpuName();
        $('recQNow').textContent = TIER_NAME[this.s.gfx.preset] || this.s.gfx.preset;
        $('recQRec').textContent = TIER_NAME[r.preset];
        let done = false;
        const answer = yes => {
          if (done) return; done = true; removeEventListener('keydown', onKey, true); hid.disconnect();
          const texBefore = this.s.gfx.texRes;
          r.answer = yes ? 'yes' : 'no'; r.auto = yes;
          if (yes) { Object.assign(this.s.gfx, PRESETS[r.preset]); this.s.gfx.preset = r.preset; }
          this.save();
          if (yes) { this.apply(); this.sync(); }
          if (UI.modal === 'recModal') UI.closeModal();
          if (UI.toast) UI.toast(yes ? 'Gráficos: qualidade ' + TIER_NAME[r.preset] + ' ✓' : 'Tudo bem! Dá para mudar em Configurações › Gráficos', 2600);
          if (yes && this.s.gfx.texRes !== texBefore && UI.toast) setTimeout(() => UI.toast('As texturas 3D mudam ao recarregar o jogo (F5)', 2600), 2700);
        };
        const onKey = e => { if (UI.modal !== 'recModal') return;
          if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); e.stopPropagation(); answer(true); }
          else if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); answer(false); } };
        addEventListener('keydown', onKey, true);
        // fechou de outro jeito (clique fora, botão B do controle): conta como "agora não"
        const hid = new MutationObserver(() => { if (m.hidden || m.classList.contains('closing')) answer(false); });
        $('recYes').onclick = () => answer(true);
        $('recNo').onclick = () => answer(false);
        UI.openModal('recModal');
        hid.observe(m, { attributes: true, attributeFilter: ['hidden', 'class'] });
      };
      const check = () => { if (document.body.dataset.screen === 'menu') { mo.disconnect(); setTimeout(ask, 500); } };
      const mo = new MutationObserver(check); mo.observe(document.body, { attributes: true, attributeFilter: ['data-screen'] }); check();
    }
  };
  window.Settings = Settings;

  // ---------- LIMITE DE RESOLUÇÃO DAS TEXTURAS DOS MODELOS 3D (.glb) ----------
  // Cada textura de 4096 px ocupa ~89 MB na GPU; de 1024, ~5,6 MB. Aqui, assim que um .glb termina de carregar e ANTES de
  // ir para a GPU, toda textura maior que o limite (configurações > Resolução das texturas 3D) é reduzida pela metade quantas
  // vezes for preciso, num canvas. Funciona com qualquer .glb sem converter arquivo. Vale para o que carregar depois de mudar.
  (function capGltfTextures() {
    if (!window.THREE || !THREE.GLTFLoader) return;
    const capNow = () => { if (!Settings.s && window.CFG) try { Settings.load(); } catch (e) { }   // 1ª visita: a recomendação já vale para as texturas
      let v = Settings.s && Settings.s.gfx.texRes;
      if (!v) { try { const sv = JSON.parse(localStorage.getItem(KEY()) || 'null'); v = sv && sv.gfx && (sv.gfx.texRes || (PRESETS[sv.gfx.preset] || {}).texRes); } catch (e) { } }
      v = v || PRESETS.auto.texRes; return v === 'max' ? Infinity : (+v || 2048); };
    const orig = THREE.GLTFLoader.prototype.parse;
    THREE.GLTFLoader.prototype.parse = function (data, path, onLoad, onError) {
      return orig.call(this, data, path, gltf => {
        try {
          const cap = capNow();
          if (isFinite(cap)) {
            const byImg = new Map(); let before = 0, after = 0;
            const visit = t => { if (!t || !t.isTexture || t.isCompressedTexture || t.isDataTexture) return; const im = t.image; if (!im || !im.width || !im.height) return;
              if (!byImg.has(im)) { const big = Math.max(im.width, im.height); let c = null;
                if (big > cap) { let k = 1; while (big / k > cap) k *= 2;
                  c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width / k)); c.height = Math.max(1, Math.round(im.height / k));
                  const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height);
                  before += im.width * im.height; after += c.width * c.height; }
                byImg.set(im, c); }
              const c = byImg.get(im); if (c) { t.image = c; t.needsUpdate = true; } };
            (gltf.scenes || [gltf.scene]).forEach(sc => sc && sc.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
              ms.forEach(m => { if (!m) return; for (const k in m) visit(m[k]); }); }));
            byImg.forEach((c, im) => { if (c && im.close) try { im.close(); } catch (e) { } });   // solta o bitmap original da memória
            if (before) console.info('[texturas] ' + (path || 'glb') + ': ' + (before * 5.32 / 1048576).toFixed(0) + ' MB -> ' + (after * 5.32 / 1048576).toFixed(0) + ' MB (limite ' + cap + ' px)');
          }
        } catch (e) { console.warn('[texturas] não reduzidas:', e); }
        onLoad(gltf);
      }, onError);
    };
  })();
})();
