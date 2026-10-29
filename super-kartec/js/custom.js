// =====================================================================================
// custom.js — estado da personalização (o "spec" do kart do jogador) + registro de atributos
//
// spec = { model, color, decal, decalColor, number, suit, helmet, skin, accessory }
// SLOTS descreve cada atributo editável na Garagem: em qual aba aparece, que tipo de controle usa
// e como é aplicado no modelo 3D. Para adicionar um atributo novo no futuro (rodas, motor, personagem):
//   1) Custom.register({ id:'wheels', tab:'kart', label:'Rodas', type:'cards', options: () => [...],
//                        apply: (model, value) => model.setWheels(value) })    // ou rebuild: true
//   2) acrescente o valor padrão em CFG.DEFAULT_SPEC
// A Garagem monta os controles sozinha a partir desta lista.
// =====================================================================================
(function () {
  const KEY = () => CFG.STORAGE + ':spec';
  const swatches = list => list.map(h => typeof h === 'string' ? { hex: h, name: h } : h);

  const TABS = [
    { id: 'kart', label: 'Kart' },
    { id: 'paint', label: 'Pintura' },
    { id: 'decals', label: 'Adesivos' },
    { id: 'pilot', label: 'Piloto' }
  ];

  const SLOTS = [
    { id: 'model', tab: 'kart', label: 'Modelo', type: 'cards', rebuild: true,
      options: () => KartModels.list().map(m => ({ value: m.id, name: m.name, desc: m.desc, thumb: true })) },
    { id: 'color', tab: 'paint', label: 'Cor da lataria', type: 'color', custom: true, options: () => swatches(CFG.KART_COLORS),
      apply: (m, v) => m.setColor(v) },
    { id: 'decal', tab: 'decals', label: 'Estampa', type: 'cards',
      options: () => Livery.patterns.map(p => ({ value: p.id, name: p.name, icon: p.icon })),
      apply: (m, v, s) => m.setDecal(v, s.number) },
    { id: 'decalColor', tab: 'decals', label: 'Cor do adesivo', type: 'color', custom: true, options: () => swatches(CFG.DECAL_COLORS),
      apply: (m, v) => m.setDecalColor(v) },
    { id: 'number', tab: 'decals', label: 'Número', type: 'number', min: 0, max: 99, hint: '0 = sem número',
      apply: (m, v, s) => m.setDecal(s.decal, v) },
    { id: 'suit', tab: 'pilot', label: 'Macacão', type: 'color', custom: true, options: () => swatches(CFG.SUIT_COLORS),
      apply: (m, v) => m.setPilot({ suit: v }) },
    { id: 'helmet', tab: 'pilot', label: 'Capacete', type: 'color', custom: true, options: () => swatches(CFG.SUIT_COLORS.concat(['#ffc928'])),
      apply: (m, v) => m.setPilot({ helmet: v }) },
    { id: 'skin', tab: 'pilot', label: 'Tom de pele', type: 'color', options: () => swatches(CFG.SKIN_TONES),
      apply: (m, v) => m.setPilot({ skin: v }) },
    { id: 'accessory', tab: 'pilot', label: 'Acessório', type: 'cards',
      options: () => Pilot.accessories.map(a => ({ value: a.id, name: a.name, icon: a.icon })),
      apply: (m, v) => m.setPilot({ accessory: v }) }
  ];

  const Custom = {
    tabs: TABS, slots: SLOTS, spec: null, listeners: [],
    load() {
      let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY()) || 'null'); } catch (e) { }
      this.spec = Object.assign({}, CFG.DEFAULT_SPEC, saved || {});
      if (!KartModels.list().some(m => m.id === this.spec.model)) this.spec.model = CFG.DEFAULT_SPEC.model;
      if (!Pilot.accessories.some(x => x.id === this.spec.accessory)) this.spec.accessory = 'none';   // ex.: a bandeira do capacete foi removida
      return this.spec;
    },
    save() { try { localStorage.setItem(KEY(), JSON.stringify(this.spec)); } catch (e) { } },
    register(slot) { SLOTS.push(slot); },
    slot(id) { return SLOTS.find(s => s.id === id); },
    // muda um atributo, salva e avisa quem estiver ouvindo (vitrine 3D, miniatura do menu...)
    set(id, value) {
      if (this.spec[id] === value) return;
      this.spec[id] = value; this.save();
      this.listeners.forEach(fn => fn(id, value, this.spec));
    },
    onChange(fn) { this.listeners.push(fn); },
    // aplica um atributo num modelo já montado; devolve false se o modelo precisa ser reconstruído
    applyTo(model, id) { const s = this.slot(id); if (!s || s.rebuild || !s.apply) return false; s.apply(model, this.spec[id], this.spec); return true; },
    // visual do rival: outro modelo, cor contrastante e piloto combinando
    rivalFor(spec, colorHex) {
      const models = KartModels.list().map(m => m.id).filter(id => id !== spec.model);
      const pats = Livery.patterns.map(p => p.id).filter(id => id !== 'none');
      const pick = a => a[Math.floor(Math.random() * a.length)];
      const decalColor = pick(CFG.DECAL_COLORS.filter(c => c.toLowerCase() !== colorHex.toLowerCase()));
      return { model: pick(models), color: colorHex, decal: pick(pats), decalColor, number: 1 + Math.floor(Math.random() * 98),
        suit: colorHex, helmet: decalColor, skin: pick(CFG.SKIN_TONES), accessory: 'none' };
    }
  };
  window.Custom = Custom;
})();
