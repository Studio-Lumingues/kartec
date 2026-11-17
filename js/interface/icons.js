// =====================================================================================
// icons.js — ícones próprios do Super Kartec (SVG desenhado à mão no estilo do jogo: contorno grosso cor de
// tinta, cores de bala e um brilho). Substituem todos os emojis, que mudavam de cara em cada aparelho.
//   Icon.svg('gear')            -> string <svg> (para montar HTML)
//   <span data-ic="gear"></span> -> preenchido sozinho ao carregar (Icon.hydrate)
// =====================================================================================
(function () {
  const K = '#2a1d4a';                                                     // tinta (contorno)
  const S = 'stroke="' + K + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';
  const shine = (d) => '<path d="' + d + '" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".85"/>';
  const P = {
    online: '<circle cx="12" cy="12" r="9" fill="#3dd6ff" ' + S + '/><path d="M7.5 7.5c2 .3 2.8 1.6 2.2 3.2-.6 1.5-2.6 1.6-3.2 3.4M15 5.6c-.4 1.6.6 2.6 2.1 2.8 1.4.2 2 .9 1.9 2.2M12.5 20.9c.2-1.8 1.4-2.6 2.9-2.9 1.3-.3 2.2-1.1 2.6-2.4" fill="none" stroke="#2ee6a8" stroke-width="2.2" stroke-linecap="round"/><path d="M3.2 12h17.6M12 3c-3 3-3 15 0 18M12 3c3 3 3 15 0 18" fill="none" stroke="' + K + '" stroke-width="1.3" opacity=".55"/>' + shine('M7 5.6a8 8 0 0 1 4-1.4'),
    wrench: '<path d="M14.6 3.5a5 5 0 0 0-4.8 6.6l-6.1 6.1a2.1 2.1 0 0 0 3 3l6.1-6.1a5 5 0 0 0 6.6-4.8l-3 3-2.7-.6-.6-2.7 3-3a5 5 0 0 0-1.5-.5z" fill="#d6dbe8" ' + S + '/><circle cx="5.2" cy="18.8" r=".9" fill="' + K + '"/>' + shine('M12.4 6.2a3 3 0 0 1 2-1.1'),
    gear: '<path d="M10.3 2.8h3.4l.5 2.4 1.7.7 2-1.4 2.4 2.4-1.4 2 .7 1.7 2.4.5v3.4l-2.4.5-.7 1.7 1.4 2-2.4 2.4-2-1.4-1.7.7-.5 2.4h-3.4l-.5-2.4-1.7-.7-2 1.4-2.4-2.4 1.4-2-.7-1.7-2.4-.5v-3.4l2.4-.5.7-1.7-1.4-2 2.4-2.4 2 1.4 1.7-.7z" fill="#ffd23f" ' + S + '/><circle cx="12" cy="12" r="3.4" fill="#fff" ' + S + '/>',
    gamepad: '<path d="M7.2 7.5h9.6c2.6 0 4.2 2.4 4.6 5.6l.5 3.6c.3 2.4-2.6 3.4-4 1.6l-1.6-2.1H7.7l-1.6 2.1c-1.4 1.8-4.3.8-4-1.6l.5-3.6c.4-3.2 2-5.6 4.6-5.6z" fill="#b08aff" ' + S + '/><path d="M7.6 10.4v4M5.6 12.4h4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="15.6" cy="11.4" r="1.3" fill="#ff4d9a" ' + S.replace('2"', '1.4"') + '/><circle cx="18" cy="13.6" r="1.3" fill="#ffd23f" ' + S.replace('2"', '1.4"') + '/>' + shine('M6.2 9.2c.6-.5 1.3-.7 2-.7'),
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="' + K + '" stroke-width="5.2" stroke-linecap="round"/><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
    sound: '<path d="M4 9.5h3.4L12 5.6v12.8l-4.6-3.9H4z" fill="#ffd23f" ' + S + '/><path d="M15.2 9a4.2 4.2 0 0 1 0 6M17.8 6.4a8 8 0 0 1 0 11.2" fill="none" stroke="' + K + '" stroke-width="2.2" stroke-linecap="round"/>',
    monitor: '<rect x="3" y="4" width="18" height="12.5" rx="2.6" fill="#3dd6ff" ' + S + '/><path d="M9 20.5h6M12 16.5v4" ' + S + '/><path d="M6 13.5l3.2-3.4 2.4 2.2 2.6-3.2 3.8 4.4" fill="none" stroke="#2ee6a8" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>' + shine('M5.6 7h3'),
    sun: '<g stroke="' + K + '" stroke-width="2.2" stroke-linecap="round"><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M5.4 18.6l1.5-1.5M17.1 6.9l1.5-1.5"/></g><circle cx="12" cy="12" r="4.6" fill="#ffd23f" ' + S + '/>' + shine('M10 9.6a2.6 2.6 0 0 1 2-.9'),
    moon: '<path d="M15.6 3.6a8.6 8.6 0 1 0 4.8 13.6A7 7 0 0 1 15.6 3.6z" fill="#ffe9a0" ' + S + '/><circle cx="9.4" cy="10" r="1.2" fill="#e8cf7a"/><circle cx="12" cy="15.4" r="1.6" fill="#e8cf7a"/><path d="M19 4.2l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" fill="#fff" stroke="' + K + '" stroke-width="1"/>',
    lock: '<path d="M7.6 10.6V8.2a4.4 4.4 0 0 1 8.8 0v2.4" fill="none" stroke="' + K + '" stroke-width="2.6" stroke-linecap="round"/><rect x="4.8" y="10.4" width="14.4" height="10.4" rx="2.6" fill="#ffd23f" ' + S + '/><circle cx="12" cy="14.6" r="1.6" fill="' + K + '"/><path d="M12 15.4v2.4" stroke="' + K + '" stroke-width="2" stroke-linecap="round"/>',
    check: '<path d="M4.6 12.6l4.6 4.6 10.2-10.4" fill="none" stroke="' + K + '" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.6 12.6l4.6 4.6 10.2-10.4" fill="none" stroke="#2ee6a8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    crown: '<path d="M3.6 8.4l4.2 3.6L12 5.2l4.2 6.8 4.2-3.6-1.6 10.4H5.2z" fill="#ffd23f" ' + S + '/><path d="M5.2 18.8h13.6" stroke="' + K + '" stroke-width="2"/><circle cx="12" cy="14.2" r="1.3" fill="#ff4d9a" stroke="' + K + '" stroke-width="1.2"/>' + shine('M7.2 15.4l.4-1.6'),
    left: '<path d="M15.5 4.8L6.6 12l8.9 7.2z" fill="#fff" ' + S.replace('2"', '2.4"') + '/>',
    right: '<path d="M8.5 4.8l8.9 7.2-8.9 7.2z" fill="#fff" ' + S.replace('2"', '2.4"') + '/>',
    up: '<path d="M4.8 15.5L12 6.6l7.2 8.9z" fill="#fff" ' + S.replace('2"', '2.4"') + '/>',
    down: '<path d="M4.8 8.5L12 17.4l7.2-8.9z" fill="#fff" ' + S.replace('2"', '2.4"') + '/>',
    notes: '<rect x="4.6" y="3.8" width="14.8" height="17.4" rx="2.6" fill="#fff" ' + S + '/><rect x="8.6" y="2.4" width="6.8" height="3.4" rx="1.4" fill="#b08aff" ' + S + '/><path d="M8 10h8M8 13.4h8M8 16.8h5" stroke="' + K + '" stroke-width="1.8" stroke-linecap="round"/><path d="M18.6 14.6l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z" fill="#ffd23f" stroke="' + K + '" stroke-width="1.2" stroke-linejoin="round"/>',
    dot: '<circle cx="12" cy="12" r="4" fill="#ff4d9a" ' + S + '/>',
    // estampas (adesivos)
    none: '<circle cx="12" cy="12" r="8" fill="#f1ecff" ' + S + '/><path d="M6.6 17.4L17.4 6.6" stroke="#ff4d6d" stroke-width="2.4" stroke-linecap="round"/>',
    tribal: '<path d="M2.8 15.2c4.6.4 7.6-2.6 9.4-9.2.8 4.2 3.4 6.6 8.6 6.4-3.8 1.6-7 1.6-9.4.4-1.4 4.2-4.6 6.6-8.6 2.4z" fill="#ff4d9a" ' + S + '/><path d="M12.4 15.6c2.6 1.2 5.4 1 7.8-.8" fill="none" stroke="' + K + '" stroke-width="2.4" stroke-linecap="round"/><path d="M8.6 12.6c1-.8 1.8-2 2.4-3.4" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".85"/>',
    flames: '<path d="M12 21.4c-4.4 0-7-3-6.6-6.8.3-3 2.4-4.4 2.8-7.4 1.6 1.2 2.4 2.8 2.4 4.4 1-2.4 1.2-5 .6-8 4.4 2.4 7.4 6.6 7.4 11 0 3.8-2.6 6.8-6.6 6.8z" fill="#ff7a1a" ' + S + '/><path d="M12 19.6c-1.9 0-3.1-1.3-2.9-3 .2-1.4 1.3-2.2 1.6-3.6 1.6 1 2.1 2.2 2 3.2.6-.6 1-1.4 1-2.4 1 1 1.6 2.2 1.4 3.4-.2 1.4-1.4 2.4-3.1 2.4z" fill="#ffd23f"/>',
    stripes: '<rect x="5" y="3.6" width="5" height="16.8" rx="2.4" fill="#ff4d9a" ' + S + '/><rect x="13" y="3.6" width="5" height="16.8" rx="2.4" fill="#fff" ' + S + '/>',
    stars: '<path d="M12 2.8l2.7 5.6 6.1.8-4.4 4.2 1.1 6.1L12 16.6l-5.5 2.9 1.1-6.1-4.4-4.2 6.1-.8z" fill="#ffd23f" ' + S + '/>' + shine('M10.6 8.4l.9-1.7'),
    skull: '<path d="M12 2.8c-4.8 0-8 3.2-8 7.4 0 2.4 1 4 2.6 5.1v2.4c0 1 .8 1.7 1.7 1.7h7.4c.9 0 1.7-.7 1.7-1.7v-2.4C19 14.2 20 12.6 20 10.2c0-4.2-3.2-7.4-8-7.4z" fill="#fff" ' + S + '/><ellipse cx="8.6" cy="10.6" rx="2.2" ry="2.5" fill="' + K + '"/><ellipse cx="15.4" cy="10.6" rx="2.2" ry="2.5" fill="' + K + '"/><path d="M12 13.4l-1.1 1.8h2.2z" fill="' + K + '"/><path d="M10 17.2v2.2M12 17.2v2.2M14 17.2v2.2" stroke="' + K + '" stroke-width="1.3"/>',
    bolt: '<path d="M13.6 2.6L5.6 13.4h5.2l-1.6 8 8.2-11h-5.4z" fill="#ffd23f" ' + S + '/>' + shine('M11.6 6.4l-2.2 3'),
    checker: '<path d="M5 21V3.4" stroke="' + K + '" stroke-width="2.2" stroke-linecap="round"/><rect x="5.8" y="4" width="14" height="9.6" rx="1.6" fill="#fff" ' + S + '/><path d="M5.8 4h3.5v3.2H5.8zM12.8 4h3.5v3.2h-3.5zM9.3 7.2h3.5v3.2H9.3zM16.3 7.2h3.5v3.2h-3.5zM5.8 10.4h3.5v3.2H5.8zM12.8 10.4h3.5v3.2h-3.5z" fill="' + K + '"/>',
    // acessórios do piloto
    goggles: '<path d="M2.8 11.6c3-1.4 15.4-1.4 18.4 0" fill="none" stroke="#8a5a3a" stroke-width="2.6" stroke-linecap="round"/><rect x="3.6" y="8.6" width="7.4" height="7" rx="3" fill="#3dd6ff" stroke="#c88f2a" stroke-width="2.2"/><rect x="13" y="8.6" width="7.4" height="7" rx="3" fill="#3dd6ff" stroke="#c88f2a" stroke-width="2.2"/><path d="M11 11.4h2" stroke="#c88f2a" stroke-width="2.2"/>' + shine('M5.4 10.6l1.6-.4') + shine('M14.8 10.6l1.6-.4'),
    antenna: '<path d="M12 21v-9.6" stroke="' + K + '" stroke-width="2.2" stroke-linecap="round"/><path d="M7.6 21h8.8" stroke="' + K + '" stroke-width="2.2" stroke-linecap="round"/><path d="M12 2.6l1.8 3.6 4 .5-2.9 2.8.7 4L12 11.6l-3.6 1.9.7-4-2.9-2.8 4-.5z" fill="#ffd23f" ' + S + '/>'
  };
  const Icon = {
    names: Object.keys(P),
    svg(name, cls) { const b = P[name] || P.dot; return '<svg class="icn' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + b + '</svg>'; },
    hydrate(root) { (root || document).querySelectorAll('[data-ic]').forEach(el => { if (!el.firstElementChild) el.innerHTML = Icon.svg(el.dataset.ic); }); }
  };
  window.Icon = Icon;
  if (document.readyState !== 'loading') Icon.hydrate(); else document.addEventListener('DOMContentLoaded', () => Icon.hydrate());
})();
