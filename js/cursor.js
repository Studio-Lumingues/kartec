// =====================================================================================
// cursor.js — comportamento do cursor (o pacote de cursores, estilo Windows 11, e as regras ficam no style.css)
//  * Garagem: ao arrastar o kart, o volante "gira" (classe body.dragging)
//  * corrida: o cursor some depois de 2 s parado e volta ao mexer o mouse
// =====================================================================================
(function () {
  const RACING = ['race', 'countdown', 'finish', 'waiting'];
  const body = document.body; let idleT = 0;
  addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') return;
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
