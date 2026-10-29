// =====================================================================================
// garage.js — tela da Garagem (personalização)
// Monta abas e controles a partir de Custom.tabs / Custom.slots (nada é escrito "na mão" aqui):
//   cards  -> grade de cartões (modelos com miniatura 3D, estampas, acessórios)
//   color  -> paleta de bolinhas + seletor livre (opcional)
//   number -> botões − / + com campo numérico
// Cada mudança vai para Custom.set(); a vitrine 3D escuta e atualiza o kart na hora.
// =====================================================================================
(function () {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };

  const Garage = {
    tab: 'kart', controls: {},
    build() {
      const tabs = $('garageTabs'), body = $('garageBody');
      Custom.tabs.forEach(t => {
        const b = el('button', 'tab', t.label); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.tab = t.id;
        b.addEventListener('click', () => this.show(t.id)); tabs.appendChild(b);
        const pane = el('div', 'pane'); pane.dataset.tab = t.id; pane.setAttribute('role', 'tabpanel'); body.appendChild(pane);
      });
      Custom.slots.forEach(s => this.addControl(s));
      this.show(this.tab);
      Custom.onChange((id) => { this.sync(id); this.summary(); });
      this.summary();
    },
    addControl(s) {
      const pane = document.querySelector('#garageBody .pane[data-tab="' + s.tab + '"]'); if (!pane) return;
      const box = el('section', 'gBlock'), h = el('h3', null, s.label); box.appendChild(h);
      if (s.hint) h.appendChild(el('small', null, s.hint));
      const ctl = { slot: s, items: [] };
      if (s.type === 'cards') {
        const grid = el('div', 'gCards' + (s.id === 'model' ? ' models' : ''));
        s.options().forEach(o => {
          const b = el('button', 'gCard'); b.type = 'button'; b.dataset.v = o.value; b.setAttribute('aria-pressed', 'false');
          if (o.thumb) { const im = el('img'); im.alt = ''; b.appendChild(im); ctl.thumbs = (ctl.thumbs || []).concat({ im, id: o.value }); }
          else { const ic = el('span', 'ico'); ic.innerHTML = Icon.svg(o.icon || 'dot'); b.appendChild(ic); }
          b.appendChild(el('strong', null, o.name)); if (o.desc) b.appendChild(el('span', 'desc', o.desc));
          b.addEventListener('click', () => { Custom.set(s.id, o.value); UI.Sfx.tone(660, 990, 0.08, 'square', 0.06); });
          grid.appendChild(b); ctl.items.push(b);
        });
        box.appendChild(grid);
      } else if (s.type === 'color') {
        const row = el('div', 'gSwatches');
        s.options().forEach(o => { const b = el('button', 'swatch'); b.type = 'button'; b.style.setProperty('--c', o.hex); b.dataset.v = o.hex; b.title = o.name; b.setAttribute('aria-label', s.label + ' ' + o.name);
          b.addEventListener('click', () => { Custom.set(s.id, o.hex); UI.Sfx.tone(880, 0, 0.05, 'triangle', 0.06); }); row.appendChild(b); ctl.items.push(b); });
        box.appendChild(row);
        if (s.custom) { const lab = el('label', 'custom'), inp = el('input'); inp.type = 'color'; inp.addEventListener('input', e => Custom.set(s.id, e.target.value)); lab.append(inp, document.createTextNode(' Outra cor')); box.appendChild(lab); ctl.input = inp; }
      } else if (s.type === 'number') {
        const row = el('div', 'gNumber'), minus = el('button', 'ghost', '−'), plus = el('button', 'ghost', '+'), inp = el('input');
        minus.type = plus.type = 'button'; minus.setAttribute('aria-label', 'Diminuir'); plus.setAttribute('aria-label', 'Aumentar');
        inp.type = 'number'; inp.min = s.min; inp.max = s.max; inp.inputMode = 'numeric'; inp.setAttribute('aria-label', s.label);
        const put = v => Custom.set(s.id, Math.max(s.min, Math.min(s.max, v | 0)));
        minus.addEventListener('click', () => put(Custom.spec[s.id] - 1)); plus.addEventListener('click', () => put(Custom.spec[s.id] + 1));
        inp.addEventListener('change', () => put(+inp.value));
        row.append(minus, inp, plus); box.appendChild(row); ctl.input = inp;
      }
      pane.appendChild(box); this.controls[s.id] = ctl; this.sync(s.id);
    },
    // reflete o valor atual no controle
    sync(id) {
      const c = this.controls[id]; if (!c) return; const v = Custom.spec[id];
      c.items.forEach(b => { const on = String(b.dataset.v).toLowerCase() === String(v).toLowerCase(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      if (c.input) c.input.value = c.slot.type === 'number' ? (v | 0) : v;
    },
    summary() {
      const s = Custom.spec, m = KartModels.get(s.model), d = Livery.patterns.find(p => p.id === s.decal);
      $('garageSummary').textContent = m.name + ' · ' + (d ? d.name : '') + (s.number ? ' · nº ' + s.number : '');
    },
    show(id) {
      this.tab = id;
      document.querySelectorAll('#garageTabs .tab').forEach(b => { const on = b.dataset.tab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      document.querySelectorAll('#garageBody .pane').forEach(p => p.hidden = p.dataset.tab !== id);
    },
    // carrega as miniaturas dos modelos na primeira visita
    loadThumbs() {
      const c = this.controls.model; if (!c || !c.thumbs || this._thumbs) return; this._thumbs = true;
      Showroom.thumbnails(map => c.thumbs.forEach(t => { if (map[t.id]) t.im.src = map[t.id]; }));
    }
  };
  window.Garage = Garage;
})();
