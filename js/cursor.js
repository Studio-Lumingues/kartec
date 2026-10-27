// =====================================================================================
// cursor.js — detalhes do cursor personalizado (as imagens e as regras ficam no style.css)
//  * clique: anel + 6 faíscas coloridas no ponto clicado (animação em CSS, removida no fim)
//  * Garagem: ao arrastar o kart, o volante "gira" (classe body.dragging)
//  * corrida: o cursor some depois de 2 s parado e volta ao mexer o mouse
// =====================================================================================
(function () {
  const COLORS = ['#ff4d9a', '#ffd23f', '#3dd6ff', '#2ee6a8', '#ff7a1a', '#b08aff'];
  const RACING = ['race', 'countdown', 'finish', 'waiting'];
  const body = document.body; let idleT = 0, k = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function burst(x, y) {
    if (reduced.matches) return;
    const e = document.createElement('div'), c = COLORS[k++ % COLORS.length]; e.className = 'cBurst'; e.style.left = x + 'px'; e.style.top = y + 'px';
    e.innerHTML = '<i style="--c:' + c + '"></i>' + [0, 60, 120, 180, 240, 300].map((a, i) => '<b style="--a:' + (a + 15) + 'deg;--c:' + COLORS[(k + i) % COLORS.length] + '"></b>').join('');
    body.appendChild(e); setTimeout(() => e.remove(), 560);
  }
  addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') return;
    const racing = window.Game && RACING.includes(Game.state);
    if (!racing) burst(e.clientX, e.clientY);
    if (window.Game && Game.state === 'garage' && e.target && e.target.tagName === 'CANVAS' && e.button === 0) body.classList.add('dragging');
  }, true);
  addEventListener('pointerup', () => body.classList.remove('dragging'), true);
  addEventListener('pointercancel', () => body.classList.remove('dragging'), true);
  addEventListener('blur', () => body.classList.remove('dragging'));
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    if (body.classList.contains('cursorIdle')) body.classList.remove('cursorIdle');
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (window.Game && RACING.includes(Game.state) && !(window.UI && UI.modal)) body.classList.add('cursorIdle'); }, 2000);
  }, { passive: true });
  // saiu da corrida: cursor de volta na hora
  const mo = new MutationObserver(() => { if (!RACING.includes(body.dataset.screen === 'race' && window.Game ? Game.state : '')) body.classList.remove('cursorIdle'); });
  mo.observe(body, { attributes: true, attributeFilter: ['data-screen'] });
})();
