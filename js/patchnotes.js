// =====================================================================================
// patchnotes.js — tela "Patch notes" (menu principal): o que mudou em cada atualização, com data e hora.
//
// COMO ACRESCENTAR UMA ATUALIZAÇÃO: coloque uma entrada NOVA NO TOPO da lista NOTES com at: 'auto':
//   { at: 'auto', title: 'Título curto', items: ['O que mudou, em uma linha', '...'] }
// 'auto' = a hora vem sozinha do deploy que está no ar (api/deploy na Vercel; deploy.json no Render):
// a hora exata em que o deploy ficou pronto, ou a do commit que o gerou.
// IMPORTANTE: só a entrada do topo deve ficar com 'auto'. Ao criar a próxima, troque o 'auto' da anterior
// pela data que aparecia no jogo (o tooltip da data mostra o valor pronto para copiar, ex.: 2026-11-02T18:30:00Z).
// Datas fixas: com Z = UTC, ou com o fuso (ex.: '2026-11-02T15:30:00-03:00'). Cada jogador vê no próprio fuso.
// =====================================================================================
(function () {
  const NOTES = [
    { at: '2026-10-29T21:15:00-03:00', title: 'Tela principal nova e garagem 3D', items: [
      'A tela principal foi toda refeita',
      'Botões novos no menu, que reagem quando você passa o mouse',
      'Logo nova do Kartec',
      'Garagem 3D no menu: ao entrar na Garagem, o portão se abre e a câmera entra para mostrar o seu veículo'] },
    { at: '2026-10-29T20:30:00-03:00', title: 'Olhar para trás e fim da travada ao anoitecer', items: [
      'Segure C para olhar para trás e ver quem vem chegando',
      'Acabou o congelamento na virada do dia para a noite',
      'Os gráficos da pista são preparados no carregamento: sem engasgos no meio da corrida',
      'Reiniciar e sair agora ficam direto no menu de Pausa (Esc), com dois toques para confirmar',
      'Sem menu do botão direito em nenhuma tela'] },
    { at: '2026-10-29T21:00:00Z', title: 'Pausa, salas públicas e Copa online', items: [
      'Esc agora abre o menu de Pausa em vez de sair da corrida',
      'Sair da corrida fica em Configurações › Partida, com dois toques para confirmar',
      'Fora do online, a corrida congela de verdade na pausa (e pausa sozinha se você trocar de janela)',
      'Busque salas pelo nome; o código de sala saiu',
      'Senha agora é opcional: sala sem senha entra com um clique',
      'Copa Kartec online: 3 pistas seguidas com pontos (10, 8, 6, 5, 4, 3, 2, 1) e pódio final'] },
    { at: '2026-10-29T15:00:00Z', title: 'Reconexão no online e HUD mais limpa', items: [
      'Recarregou a página ou fechou a aba sem querer? Você volta para a mesma corrida em até 15 segundos',
      'Caiu a internet no meio da corrida: o jogo reconecta sozinho, também com 15 segundos de prazo',
      'Sem aquele aviso do navegador ao apertar F5',
      'Contador de FPS no estilo das placas da HUD, logo abaixo das voltas',
      'Sem barras de rolagem em nenhuma tela'] },
    { at: '2026-10-29T00:07:00Z', title: 'Patch notes no jogo', items: [
      'Nova tela de Patch notes no menu, com o resumo de cada atualização',
      'O selo "Novo" aparece no botão quando sai uma atualização que você ainda não viu'] },
    { at: '2026-10-29T00:01:00Z', title: 'Logo fluida, ícones e som de kart', items: [
      'A logo da abertura entra e sai sem travar',
      'Motor com som de kart de verdade, diferente para cada kart',
      'Som de largada acompanhando o 3, 2, 1, VAI',
      'Ícones próprios no lugar dos emojis',
      'Fonte nova, mais gordinha, nos títulos e números',
      'Caveira dos adesivos redesenhada'] },
    { at: '2026-10-28T20:00:00-03:00', title: 'Velocímetro 3D, turbo em 3 níveis e HUD viva', items: [
      'Velocímetro 3D novo no canto, marcando até 203 km/h; com a barra de drift cheia, as cores dele giram',
      'Barra de turbo 3D ao lado do piloto: enche em 3 seções durante o drift',
      'Turbo do drift em 3 níveis: cada seção cheia dá mais velocidade e dura mais (a 3ª chega a 203 km/h)',
      'A câmera se aproxima do kart a cada seção de turbo',
      'HUD com inclinação 3D: as placas balançam nas curvas, reagem ao turbo e flutuam nos saltos',
      'Mais leve: cenário agrupado em blocos e o que está fora da câmera não é desenhado',
      'Resolução se ajusta sozinha quando o jogo pesa e volta ao normal quando alivia'] },
    { at: '2026-10-27T00:07:00Z', title: 'Menu de configurações', items: [
      'Volume geral, dos motores, dos efeitos, da interface e do ambiente',
      'Gráficos: qualidade automática, baixa, média ou alta, e ajustes um a um',
      'Contador de FPS opcional'] },
    { at: '2026-10-26T23:46:00Z', title: 'Cursor personalizado', items: [
      'Cursores no visual do jogo, com volante na garagem',
      'Faíscas ao clicar',
      'O cursor some sozinho durante a corrida'] },
    { at: '2026-10-26T19:53:00Z', title: 'Rosto do piloto', items: [
      'Rosto do piloto liso e redondo, sem o buraco da boca'] },
    { at: '2026-10-26T19:38:00Z', title: 'Karts sempre visíveis', items: [
      'Os rivais não somem mais quando chegam perto',
      'As atualizações chegam sem precisar limpar o cache'] },
    { at: '2026-10-26T19:20:00Z', title: 'Drift justo e mais velocidade', items: [
      'Mini-turbo só em curva de verdade: acabou o spam de drift',
      'Karts cerca de 13% mais rápidos',
      'Balizadores e câmera nova para sentir a velocidade'] },
    { at: '2026-10-26T18:54:00Z', title: 'Sons reais, grau e pistas novas', items: [
      'Sons gravados no lugar dos sintetizados',
      'Grau na moto: segure Ctrl (ou E) numa reta',
      'Mais curvas nas três pistas',
      'Praia com guarda-sóis, cadeiras, pranchas e vôlei',
      'Mais profundidade nas cores do jogo'] },
    { at: '2026-10-25T22:44:00Z', title: 'Modo online', items: [
      'Salas com senha para até 8 jogadores',
      'Largada sincronizada para todos',
      'Batidas de lado empurram os outros karts'] }
  ];
  const $ = id => document.getElementById(id);
  const KEY = () => CFG.STORAGE + ':notesSeen';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = iso => { const d = new Date(iso); if (isNaN(d)) return ''; const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' às ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  const fixed = n => typeof n.at === 'string' && n.at !== 'auto' && !isNaN(Date.parse(n.at));
  const PatchNotes = {
    list: NOTES, deploy: null, _req: null,
    // hora de uma entrada: a escrita, ou (at: 'auto') a do deploy no ar; sem deploy ainda = fica no topo
    iso(n) { return fixed(n) ? n.at : (this.deploy && this.deploy.deployedAt) || null; },
    time(n) { const i = this.iso(n); return i ? Date.parse(i) : Number.MAX_SAFE_INTEGER; },
    sorted() { return NOTES.slice().sort((a, b) => this.time(b) - this.time(a)); },
    latest() { return this.sorted()[0]; },
    id(n) { return (fixed(n) ? n.at : 'auto') + '|' + n.title; },                  // identifica a entrada (o selo "Novo" usa)
    init() {
      $('btnNotes').addEventListener('click', () => this.open());
      this.badge();
    },
    seen() { try { return localStorage.getItem(KEY()) || ''; } catch (e) { return ''; } },
    badge() { const b = $('notesBadge'); if (b) b.hidden = this.seen() === this.id(this.latest()); },
    // hora real do deploy: Vercel (api/deploy) e, se não houver, o servidor do Render (deploy.json)
    fetchDeploy() {
      if (this._req) return this._req;
      if (!/^https?:$/.test(location.protocol)) return (this._req = Promise.resolve(null));
      const j = u => fetch(u, { cache: 'no-store' }).then(r => r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : null).catch(() => null);
      return (this._req = j('api/deploy').then(d => d && d.deployedAt ? d : j('deploy.json').then(d2 => (d2 && d2.deployedAt ? d2 : d))).then(d => { this.deploy = d || null; return this.deploy; }));
    },
    render() {
      const list = this.sorted(), last = this.seen(), legacy = !isNaN(Date.parse(last)) ? Date.parse(last) : null;
      const seenIdx = list.findIndex(n => this.id(n) === last);
      $('notesList').innerHTML = list.map((n, i) => {
        const iso = this.iso(n), fresh = !last || (seenIdx >= 0 ? i < seenIdx : legacy !== null ? this.time(n) > legacy : true);
        const tip = iso ? (fixed(n) ? '' : ' title="Hora do deploy: ' + esc(new Date(iso).toISOString().replace('.000', '')) + '"') : '';
        return '<article class="pnote' + (fresh ? ' fresh' : '') + '">' +
          '<header><time datetime="' + esc(iso || '') + '"' + tip + '>' + (iso ? when(iso) : 'agora há pouco') + '</time>' + (i === 0 ? '<span class="tagNew">Atual</span>' : '') + '</header>' +
          '<h3>' + esc(n.title) + '</h3><ul>' + n.items.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></article>';
      }).join('');
      const d = this.deploy, liveIso = (d && d.deployedAt) || this.iso(list[0]);
      $('notesLive').textContent = liveIso ? 'No ar desde ' + when(liveIso) + (d && d.sha ? ' · versão ' + d.sha : '') : '';
    },
    open() {
      this.render(); UI.openModal('notesModal');
      this.fetchDeploy().then(() => { if (UI.modal === 'notesModal') this.render(); });
      try { localStorage.setItem(KEY(), this.id(this.latest())); } catch (e) { } this.badge();
    }
  };
  window.PatchNotes = PatchNotes;
})();
