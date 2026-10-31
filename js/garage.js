// =====================================================================================
// garage.js — tela da Garagem
//
//  * CARROSSEL: setas grandes nas laterais (e ← → / A D no teclado) trocam o veículo (Kartec GT / Motoca).
//    A troca é animada na vitrine 3D (Showroom.setSpec com direção): o veículo atual sai girando para um
//    lado e o próximo entra pelo outro. A placa com o nome desliza junto, no mesmo sentido.
//  * DOCA: barra baixa no pé da tela com as abas (Custom.tabs) e UMA fileira de cores por vez.
//    Abas com mais de um atributo (Piloto: macacão, capacete, pele) ganham chips para escolher qual pintar.
//    Atributos do tipo 'char' (Piloto: Menino / Menina) viram uma fileira de botões no topo da aba.
//    Abas marcadas com soon: true (Adesivos) aparecem desativadas com o selo "Em breve".
// Nada é escrito "na mão": abas e cores vêm de Custom.tabs / Custom.slots. Cada mudança vai para
// Custom.set(); a vitrine 3D escuta e atualiza o veículo na hora.
// =====================================================================================
(function () {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const SWAP_LOCK = 450;   // ms: evita trocar de novo antes do veículo novo aparecer

  const Garage = {
    tab: 'paint', part: {}, built: false,

    build() {
      const tabs = $('garageTabs');
      Custom.tabs.forEach(t => {
        const b = el('button', 'gTab'); b.type = 'button'; b.dataset.tab = t.id; b.setAttribute('role', 'tab');
        b.appendChild(el('span', 'gTabLabel', t.label));
        if (t.soon) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); b.appendChild(el('em', 'soonBadge', 'Em breve')); b.title = t.label + ': em breve'; }
        else b.addEventListener('click', () => { this.show(t.id); this.blip(760); });
        tabs.appendChild(b);
        this.part[t.id] = (Custom.slots.find(s => s.tab === t.id && s.type === 'color') || {}).id;
      });
      // carrossel
      $('gPrev').addEventListener('click', () => this.go(-1));
      $('gNext').addEventListener('click', () => this.go(1));
      addEventListener('keydown', e => {
        if (!window.Game || window.Game.state !== 'garage' || (window.UI && UI.modal) || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); this.go(-1); this.press('gPrev'); }
        else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); this.go(1); this.press('gNext'); }
      });
      // pontinhos do carrossel (um por veículo; clicar leva direto até ele)
      const dots = $('gDots');
      KartModels.list().forEach((m, i) => {
        const d = el('button', 'gDot'); d.type = 'button'; d.setAttribute('aria-label', m.name);
        d.addEventListener('click', () => { const cur = this.index(); if (i !== cur) this.go(i > cur ? 1 : -1, i); });
        dots.appendChild(d);
      });
      Custom.onChange(id => { if (id === 'model') this.plate(); else this.syncSwatches(); });
      this.show(this.tab); this.plate(true); this.built = true;
    },

    // ---------- carrossel ----------
    index() { return Math.max(0, KartModels.list().findIndex(m => m.id === Custom.spec.model)); },
    // dir: +1 próximo (entra pela direita), -1 anterior. to: índice de destino (pontinhos)
    go(dir, to) {
      const now = performance.now(); if (now - (this._lock || 0) < SWAP_LOCK) return; this._lock = now;
      const L = KartModels.list(), n = L.length; if (n < 2) return;
      const i = to !== undefined ? to : (this.index() + dir + n) % n;
      this.slideDir = dir; Showroom.swapDir = dir;
      Custom.set('model', L[i].id);
      try { UI.Sfx.noise(0.22, 2600, 500, 0.07); UI.Sfx.tone(dir > 0 ? 520 : 620, dir > 0 ? 820 : 420, 0.12, 'triangle', 0.05); } catch (e) { }
    },
    press(id) { const b = $(id); if (!b) return; b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); },
    // placa com nome + descrição: sai para o lado contrário da seta e a nova entra pelo lado da seta
    plate(instant) {
      const m = KartModels.get(Custom.spec.model), box = $('gPlate'), name = $('gName'), desc = $('gDesc');
      [...$('gDots').children].forEach((d, i) => { const on = i === this.index(); d.classList.toggle('on', on); d.setAttribute('aria-current', on ? 'true' : 'false'); });
      $('garage').setAttribute('aria-label', 'Garagem: ' + m.name);
      if (instant || !this.slideDir) { name.textContent = m.name; desc.textContent = m.desc; return; }
      const dir = this.slideDir; this.slideDir = 0;
      box.style.setProperty('--dir', dir);
      box.classList.remove('in'); box.classList.add('out');
      clearTimeout(this._pt);
      this._pt = setTimeout(() => {
        name.textContent = m.name; desc.textContent = m.desc;
        box.classList.remove('out'); void box.offsetWidth; box.classList.add('in');
      }, 200);
    },

    // ---------- doca: abas, chips de parte e cores ----------
    show(id) {
      this.tab = id;
      document.querySelectorAll('#garageTabs .gTab').forEach(b => { const on = b.dataset.tab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      this.renderBody();
    },
    renderBody() {
      const body = $('garageBody'), slots = Custom.slots.filter(s => s.tab === this.tab && s.type === 'color');
      body.innerHTML = ''; body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
      // personagem (Menino / Menina)
      Custom.slots.filter(s => s.tab === this.tab && s.type === 'char').forEach(s => {
        const row = el('div', 'gParts gChars'); row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', s.label);
        s.options().forEach(o => {
          const c = el('button', 'gPart gChar', o.name); c.type = 'button'; c.setAttribute('role', 'radio'); c.dataset.char = o.value; c.dataset.slot2 = s.id;
          c.addEventListener('click', () => { Custom.set(s.id, o.value); this.blip(820); });
          row.appendChild(c);
        });
        body.appendChild(row);
      });
      if (!slots.length) { this.syncSwatches(); return; }
      // chips (só quando a aba tem mais de um atributo de cor)
      if (slots.length > 1) {
        const row = el('div', 'gParts'); row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', 'Parte para pintar');
        slots.forEach(s => {
          const c = el('button', 'gPart', s.label); c.type = 'button'; c.setAttribute('role', 'radio'); c.dataset.slot = s.id;
          c.addEventListener('click', () => { this.part[this.tab] = s.id; this.renderBody(); this.blip(700); });
          row.appendChild(c);
        });
        body.appendChild(row);
      }
      const s = slots.find(x => x.id === this.part[this.tab]) || slots[0]; this.part[this.tab] = s.id;
      const row = el('div', 'gSwatches'); row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', s.label);
      s.options().forEach(o => {
        const b = el('button', 'gSwatch'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.v = o.hex;
        b.style.setProperty('--c', o.hex); b.title = o.name; b.setAttribute('aria-label', s.label + ' ' + o.name);
        b.addEventListener('click', () => { Custom.set(s.id, o.hex); this.blip(880); });
        row.appendChild(b);
      });
      if (s.custom) {   // cor livre: bolinha com "+" que abre o seletor do sistema
        const lab = el('label', 'gSwatch gCustom'), inp = el('input'); inp.type = 'color'; lab.title = 'Outra cor'; lab.setAttribute('aria-label', s.label + ': outra cor');
        inp.addEventListener('input', e => Custom.set(s.id, e.target.value));
        lab.appendChild(inp); row.appendChild(lab); this._custom = { inp, lab };
      } else this._custom = null;
      body.appendChild(row);
      this.syncSwatches();
    },
    // marca a cor atual (e a parte escolhida)
    syncSwatches() {
      document.querySelectorAll('#garageBody .gChar').forEach(c => { const on = Custom.spec[c.dataset.slot2] === c.dataset.char; c.classList.toggle('on', on); c.setAttribute('aria-checked', on ? 'true' : 'false'); });
      const id = this.part[this.tab]; if (!id) return; const v = String(Custom.spec[id] || '').toLowerCase();
      let match = false;
      document.querySelectorAll('#garageBody .gSwatch[data-v]').forEach(b => { const on = b.dataset.v.toLowerCase() === v; match = match || on; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
      document.querySelectorAll('#garageBody .gPart:not(.gChar)').forEach(c => { const on = c.dataset.slot === id; c.classList.toggle('on', on); c.setAttribute('aria-checked', on ? 'true' : 'false'); });
      if (this._custom) { this._custom.inp.value = v || '#ffffff'; this._custom.lab.classList.toggle('on', !match && !!v); this._custom.lab.style.setProperty('--c', !match && v ? v : 'transparent'); }
    },
    blip(f) { try { UI.Sfx.tone(f, 0, 0.05, 'triangle', 0.05); } catch (e) { } },

    // chamado ao entrar na tela (main.js > toGarage): reinicia as animações de entrada e atualiza tudo
    enter() {
      if (!this.built) return;
      this.slideDir = 0; this.plate(true); this.syncSwatches();
      const g = $('garage'); g.classList.remove('enter'); void g.offsetWidth; g.classList.add('enter');
    }
  };
  window.Garage = Garage;
})();
