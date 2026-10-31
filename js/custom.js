// =====================================================================================
// custom.js — estado da personalização (o "spec" do kart do jogador) + registro de atributos
//
// spec = { model, color, decal, decalColor, pilot, suit, helmet, skin }
// SLOTS descreve cada atributo editável na Garagem: em qual aba aparece, que tipo de controle usa
// e como é aplicado no modelo 3D. O modelo (kart/moto) é escolhido pelo carrossel da Garagem, sem aba.
// Para adicionar um atributo novo de cor no futuro:
//   1) Custom.register({ id:'rims', tab:'paint', label:'Rodas', type:'color', options: () => [...],
//                        apply: (model, value) => model.setRims(value) })
//   2) acrescente o valor padrão em CFG.DEFAULT_SPEC
// A Garagem monta as abas e as fileiras de cores sozinha a partir desta lista.
// =====================================================================================
(function () {
  const KEY = () => CFG.STORAGE + ':spec';
  const swatches = list => list.map(h => typeof h === 'string' ? { hex: h, name: h } : h);

  // soon: aba visível, mas desativada com o selo "Em breve"
  const TABS = [
    { id: 'paint', label: 'Pintura' },
    { id: 'pilot', label: 'Piloto' },
    { id: 'decals', label: 'Adesivos', soon: true }
  ];

  const SLOTS = [
    { id: 'model', tab: null, label: 'Modelo', type: 'model', rebuild: true,          // escolhido pelo carrossel (setas)
      options: () => KartModels.list().map(m => ({ value: m.id, name: m.name, desc: m.desc })) },
    { id: 'color', tab: 'paint', label: 'Lataria', type: 'color', custom: true, options: () => swatches(CFG.KART_COLORS),
      apply: (m, v) => m.setColor(v) },
    { id: 'decal', tab: 'decals', label: 'Estampa', type: 'cards',
      options: () => Livery.patterns.map(p => ({ value: p.id, name: p.name, icon: p.icon })),
      apply: (m, v) => m.setDecal(v) },
    { id: 'decalColor', tab: 'decals', label: 'Cor do adesivo', type: 'color', custom: true, options: () => swatches(CFG.DECAL_COLORS),
      apply: (m, v) => m.setDecalColor(v) },
    // personagem (Menino / Menina): botões no topo da aba Piloto; trocar reconstrói só o piloto
    { id: 'pilot', tab: 'pilot', label: 'Personagem', type: 'char',
      options: () => Pilot.chars.map(c => ({ value: c.id, name: c.name })),
      apply: (m, v) => m.setPilot({ pilot: v }) },
    { id: 'suit', tab: 'pilot', label: 'Macacão', type: 'color', custom: true, options: () => swatches(CFG.SUIT_COLORS),
      apply: (m, v) => m.setPilot({ suit: v }) },
    { id: 'helmet', tab: 'pilot', label: 'Capacete', type: 'color', custom: true, options: () => swatches(CFG.SUIT_COLORS.concat(['#ffc928'])),
      apply: (m, v) => m.setPilot({ helmet: v }) },
    { id: 'skin', tab: 'pilot', label: 'Pele', type: 'color', options: () => swatches(CFG.SKIN_TONES),
      apply: (m, v) => m.setPilot({ skin: v }) }
  ];

  const Custom = {
    tabs: TABS, slots: SLOTS, spec: null, listeners: [],
    load() {
      let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY()) || 'null'); } catch (e) { }
      this.spec = Object.assign({}, CFG.DEFAULT_SPEC, saved || {});
      // kart salvo que não existe mais (Clássico, Muscle, Cyber, Off-Road foram removidos): volta para o padrão
      // ou, se nem o padrão existir, para o primeiro modelo da lista (Kartec GT). Já grava a correção.
      const valid = id => KartModels.list().some(m => m.id === id);
      if (!valid(this.spec.model)) { this.spec.model = valid(CFG.DEFAULT_SPEC.model) ? CFG.DEFAULT_SPEC.model : KartModels.list()[0].id; this.save(); }
      // número e acessório saíram do jogo: some com o que estiver salvo de versões antigas
      if ('number' in this.spec || 'accessory' in this.spec) { delete this.spec.number; delete this.spec.accessory; this.save(); }
      // personagem salvo que não existe (ou spec de antes dos personagens): volta para o padrão
      if (!Pilot.chars.some(c => c.id === this.spec.pilot)) { this.spec.pilot = CFG.DEFAULT_SPEC.pilot; this.save(); }
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
    // visual do rival: modelo sorteado entre os disponíveis (kart ou moto), cor contrastante e piloto combinando.
    // Com só 2 modelos, excluir o do jogador deixaria TODOS os rivais iguais; então o sorteio usa a lista toda.
    rivalFor(spec, colorHex) {
      const models = KartModels.list().map(m => m.id);
      const pats = Livery.patterns.map(p => p.id).filter(id => id !== 'none');
      const pick = a => a[Math.floor(Math.random() * a.length)];
      const decalColor = pick(CFG.DECAL_COLORS.filter(c => c.toLowerCase() !== colorHex.toLowerCase()));
      return { model: pick(models), color: colorHex, decal: pick(pats), decalColor, pilot: pick(Pilot.chars.map(c => c.id)),
        suit: colorHex, helmet: decalColor, skin: pick(CFG.SKIN_TONES) };
    }
  };
  window.Custom = Custom;
})();
