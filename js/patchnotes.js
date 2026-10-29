// =====================================================================================
// patchnotes.js — tela "Patch notes" (menu principal): o que mudou em cada atualização, com data e hora.
//
// COMO ACRESCENTAR UMA ATUALIZAÇÃO: coloque uma entrada NOVA NO TOPO da lista NOTES:
//   { at: '2026-11-02T18:30:00Z', title: 'Título curto', items: ['O que mudou, em uma linha', '...'] }
// `at` é a hora em que o update subiu (com Z = UTC; ou com o fuso, ex.: '2026-11-02T15:30:00-03:00').
// Cada jogador vê a data no próprio fuso. Itens: frases curtas, em linguagem de jogador.
// Quando o jogo roda pelo servidor do projeto, "No ar desde" vem de /deploy.json (hora real em que os
// arquivos subiram); hospedado sem ele (Vercel, disco), vale a data da entrada mais recente.
// =====================================================================================
(function () {
  const NOTES = [
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
  const PatchNotes = {
    list: NOTES,
    latest() { return NOTES.reduce((a, b) => (new Date(b.at) > new Date(a.at) ? b : a), NOTES[0]); },
    init() {
      $('btnNotes').addEventListener('click', () => this.open());
      this.badge();
    },
    seen() { try { return localStorage.getItem(KEY()) || ''; } catch (e) { return ''; } },
    badge() { const b = $('notesBadge'); if (b) b.hidden = this.seen() === this.latest().at; },
    open() {
      const list = NOTES.slice().sort((a, b) => new Date(b.at) - new Date(a.at)), last = this.seen();
      $('notesList').innerHTML = list.map((n, i) => '<article class="pnote' + (!last || new Date(n.at) > new Date(last) ? ' fresh' : '') + '">' +
        '<header><time datetime="' + esc(n.at) + '">' + when(n.at) + '</time>' + (i === 0 ? '<span class="tagNew">Atual</span>' : '') + '</header>' +
        '<h3>' + esc(n.title) + '</h3><ul>' + n.items.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></article>').join('');
      $('notesLive').textContent = 'No ar desde ' + when(list[0].at);
      // hora real em que os arquivos subiram (só quando o jogo vem do servidor do projeto)
      if (/^https?:$/.test(location.protocol)) fetch('deploy.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => {
        if (d && d.deployedAt) $('notesLive').textContent = 'No ar desde ' + when(d.deployedAt);
      }).catch(() => { });
      UI.openModal('notesModal');
      try { localStorage.setItem(KEY(), this.latest().at); } catch (e) { } this.badge();
    }
  };
  window.PatchNotes = PatchNotes;
})();
