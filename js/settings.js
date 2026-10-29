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
  const PRESETS = {
    auto:   { res: 'auto', shadows: 'medium', outlines: true,  scenery: 'high',   particles: 'normal', view: 'far' },
    low:    { res: '0.75', shadows: 'off',    outlines: false, scenery: 'low',    particles: 'low',    view: 'near' },
    medium: { res: '1',    shadows: 'low',    outlines: true,  scenery: 'medium', particles: 'normal', view: 'medium' },
    high:   { res: '1.5',  shadows: 'high',   outlines: true,  scenery: 'high',   particles: 'normal', view: 'far' }
  };
  const DEF = { vol: { master: 80, engine: 70, sfx: 80, ui: 60, amb: 50 },
    gfx: Object.assign({ preset: 'auto', speedFx: true, shake: true, fps: false }, PRESETS.auto) };
  const SHADOW = { off: 0, low: 512, medium: 1024, high: 2048 };
  const DENS = { low: 0.35, medium: 0.65, high: 1 };
  const VIEW = { near: 0.62, medium: 0.82, far: 1 };

  const Settings = {
    s: null,
    load() {
      let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY()) || 'null'); } catch (e) { }
      this.s = { vol: Object.assign({}, DEF.vol, saved && saved.vol), gfx: Object.assign({}, DEF.gfx, saved && saved.gfx) };
      return this.s;
    },
    save() { try { localStorage.setItem(KEY(), JSON.stringify(this.s)); } catch (e) { } },
    get g() { return this.s.gfx; },
    // ---------- consultas usadas pelo jogo ----------
    autoPerf() { return this.s.gfx.preset === 'auto'; },                       // resolução adaptativa e "modo leve" automático
    fixedDpr() { const r = this.s.gfx.res; return r === 'auto' ? 0 : Math.min(parseFloat(r), Math.max(1, devicePixelRatio)); },
    dprMax() { return this.s.gfx.res === 'auto' ? CFG.PERF.DPR_MAX : this.fixedDpr(); },
    sceneryDensity() { return DENS[this.s.gfx.scenery] || 1; },
    viewMul() { return VIEW[this.s.gfx.view] || 1; },
    // ---------- aplicação ----------
    apply() {
      const g = this.s.gfx;
      if (window.Sfx) Sfx.setVolumes(this.s.vol);
      // partículas
      if (window.Fx) Fx.rate = g.particles === 'low' ? 0.45 : 1;
      // sombras: tamanho do mapa e liga/desliga (muda os shaders -> materiais precisam recompilar)
      const sz = SHADOW[g.shadows], R = window.__kart && __kart.renderer;
      CFG.PERF.SHADOW_MAP = sz || 512;
      if (R) { const want = sz > 0;
        if (R.shadowMap.enabled !== want) { R.shadowMap.enabled = want; this.eachScene(sc => sc.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); })); }
        if (window.Env && Env.sun && sz) { if (Env.sun.shadow.mapSize.x !== sz) { Env.sun.shadow.mapSize.set(sz, sz); if (Env.sun.shadow.map) { Env.sun.shadow.map.dispose(); Env.sun.shadow.map = null; } } } }
      // contornos de tinta
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
      this.load(); this.apply();
      const vol = [['master', 'Volume geral'], ['engine', 'Motores'], ['sfx', 'Efeitos (batidas, derrapagem, turbo)'], ['ui', 'Interface e avisos'], ['amb', 'Ambiente e torcida']];
      $('setVol').innerHTML = vol.map(([k, t]) => '<label class="slider"><span>' + t + '</span><input type="range" min="0" max="100" step="1" data-vol="' + k + '"><output></output></label>').join('');
      const opt = (id, label, items, hint) => '<div class="setRow"><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span><div class="seg mini" data-g="' + id + '">' + items.map(([v, t]) => '<button type="button" data-v="' + v + '">' + t + '</button>').join('') + '</div></div>';
      const tog = (id, label, hint) => '<div class="setRow"><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span><div class="seg mini" data-g="' + id + '"><button type="button" data-v="1">Ligado</button><button type="button" data-v="0">Desligado</button></div></div>';
      $('setGfx').innerHTML =
        opt('preset', 'Qualidade', [['auto', 'Automática'], ['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['custom', 'Personalizada']], 'Automática ajusta a resolução sozinha para manter o jogo liso') +
        opt('res', 'Resolução', [['auto', 'Auto'], ['0.75', '75%'], ['1', '100%'], ['1.5', 'Máxima']]) +
        opt('shadows', 'Sombras', [['off', 'Sem'], ['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta']]) +
        tog('outlines', 'Contornos de desenho', 'Traço escuro em volta dos karts e objetos') +
        opt('scenery', 'Cenário', [['low', 'Leve'], ['medium', 'Médio'], ['high', 'Completo']], 'Vale a partir da próxima corrida') +
        opt('particles', 'Partículas', [['low', 'Poucas'], ['normal', 'Normais']]) +
        opt('view', 'Distância de visão', [['near', 'Curta'], ['medium', 'Média'], ['far', 'Longa']]) +
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
        if (id === 'preset') { if (v !== 'custom') Object.assign(g, PRESETS[v]); g.preset = v; }
        else { g[id] = (v === '1' ? true : v === '0' ? false : v); if (['res', 'shadows', 'outlines', 'scenery', 'particles', 'view'].includes(id)) g.preset = 'custom'; }
        this.save(); this.apply(); this.sync(); })));
      $('setReset').addEventListener('click', () => { this.s = JSON.parse(JSON.stringify(DEF)); this.save(); this.apply(); this.sync(); UI.toast('Configurações padrão restauradas', 1500); });
      $('btnSettings').addEventListener('click', () => this.open());
      $('setBtn').addEventListener('click', () => this.open());
      this.sync();
    },
    tab(t) { $('setTabs').querySelectorAll('button').forEach(b => { const on = b.dataset.v === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }); $('setVol').hidden = t !== 'vol'; $('setGfx').hidden = t !== 'gfx'; },
    open() { if (window.Sfx) Sfx.unlock(); this.sync(); UI.openModal('settingsModal'); },
    sync() {
      $('setVol').querySelectorAll('input').forEach(inp => { inp.value = this.s.vol[inp.dataset.vol]; inp.nextElementSibling.textContent = inp.value + '%'; inp.style.setProperty('--p', inp.value + '%'); });
      $('setGfx').querySelectorAll('.seg').forEach(seg => { const id = seg.dataset.g, cur = this.s.gfx[id], val = typeof cur === 'boolean' ? (cur ? '1' : '0') : String(cur);
        seg.querySelectorAll('button').forEach(b => { const on = b.dataset.v === val; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); });
    }
  };
  window.Settings = Settings;
})();
