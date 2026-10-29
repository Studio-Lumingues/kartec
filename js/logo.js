// =====================================================================================
// logo.js — logo "Super Kartec" da abertura, com animação lisa
//
// Por que travava: a logo era um SVG grande animado com filtro de desfoque, sombra (drop-shadow) e partes
// internas mexendo (placa, linhas, brilho). Cada quadro o navegador redesenhava o SVG inteiro em alta
// escala, e ainda por cima o 3D continuava renderizando atrás, com desfoque em tela cheia. A saída para o
// canto animava left/top/width (recalcula o layout a cada quadro).
//
// Agora: na carga do jogo o SVG é desenhado UMA vez em dois canvas (placa "SUPER" e texto "KARTEC"), em
// alta resolução e já com a fonte embutida. A animação mexe só em transform/opacity dessas camadas (a GPU
// compõe, sem redesenhar nada) usando a Web Animations API, que roda fora do laço do jogo. A saída para o
// canto do menu é um único transform (técnica FLIP). Durante a logo o 3D fica congelado no último quadro.
// =====================================================================================
(function () {
  const FONT = 'data:font/woff2;base64,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';
  const VB = [-40, -16, 760, 336];                         // área desenhada (inclui sombras e linhas de velocidade)
  const ease = { out: 'cubic-bezier(.16, 1, .3, 1)', spring: 'cubic-bezier(.22, 1.45, .36, 1)', inOut: 'cubic-bezier(.65, 0, .25, 1)' };

  const Logo = {
    ready: false, anims: [],
    async build() {
      const tpl = document.getElementById('logoTpl'), brand = document.getElementById('brand'); if (!tpl || !brand) return;
      try {
        const src = tpl.content.querySelector('svg'), dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = Math.round(Math.min(760, Math.max(420, innerWidth * 0.9)) * dpr), H = Math.round(W * VB[3] / VB[2]);
        const layer = async (keep) => {
          const s = src.cloneNode(true);
          s.setAttribute('viewBox', VB.join(' ')); s.setAttribute('width', W); s.setAttribute('height', H); s.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          const drop = sel => s.querySelectorAll(sel).forEach(n => n.remove());
          drop('[clip-path]');                               // o brilho agora é uma camada à parte
          if (keep === 'plate') drop('.lgLines, .lgMain'); else drop('.lgPlate');
          const st = document.createElementNS('http://www.w3.org/2000/svg', 'style');
          st.textContent = '@font-face{font-family:"Titan One";src:url(' + FONT + ') format("woff2");}.lgText{font-family:"Titan One",sans-serif;font-weight:400}';
          s.insertBefore(st, s.firstChild);
          const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(s)], { type: 'image/svg+xml' }));
          const img = new Image(); img.src = url; await img.decode(); URL.revokeObjectURL(url);
          const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(img, 0, 0, W, H); return c;
        };
        const main = await layer('main'), plate = await layer('plate');
        const stage = document.createElement('div'); stage.className = 'lgStage';
        main.className = 'lgCanvas lgMainC'; plate.className = 'lgCanvas lgPlateC';
        const shine = document.createElement('div'); shine.className = 'lgShine'; shine.innerHTML = '<i></i>';
        const m = 'url(' + main.toDataURL('image/png') + ')'; shine.style.webkitMaskImage = m; shine.style.maskImage = m;
        stage.append(main, plate, shine);
        brand.innerHTML = ''; brand.appendChild(stage); brand.classList.add('raster');
        // ponto de giro da placa: centro da placa no SVG (350, 72)
        plate.style.transformOrigin = ((350 - VB[0]) / VB[2] * 100).toFixed(2) + '% ' + ((72 - VB[1]) / VB[3] * 100).toFixed(2) + '%';
        this.el = { brand, stage, main, plate, shine: shine.firstChild }; this.ready = true;
      } catch (e) { console.warn('[logo] usando o SVG direto:', e && e.message); }
    },
    stop() { this.anims.forEach(a => { try { a.cancel(); } catch (e) { } }); this.anims = []; },
    // transform que leva a logo (que fica sempre no lugar dela no menu) para o centro da tela, grande
    centerT() {
      const b = this.el.brand, base = getComputedStyle(b).transform, r = b.getBoundingClientRect();
      const tw = Math.min(720, innerWidth * 0.86), s = tw / Math.max(1, r.width);
      const dx = innerWidth / 2 - (r.left + r.width / 2), dy = innerHeight * 0.44 - (r.top + r.height / 2);
      return { pre: 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) ', base: base === 'none' ? '' : base + ' ', s };
    },
    enter() {
      if (!this.ready) return false; this.stop();
      const { brand, stage, plate, shine } = this.el; brand.classList.add('show');
      const c = this.centerT(), T = (k, rot) => c.pre + c.base + 'scale(' + (c.s * k).toFixed(4) + ')' + (rot ? ' rotate(' + rot + 'deg)' : '');
      this.anims.push(brand.animate([
        { transform: T(2.3, -7), opacity: 0 },
        { transform: T(0.94, 1.5), opacity: 1, offset: 0.52 },
        { transform: T(1.035, -0.6), offset: 0.74 },
        { transform: T(1), opacity: 1 }
      ], { duration: 820, easing: ease.out, fill: 'forwards' }));
      this.anims.push(plate.animate([
        { transform: 'scale(0) rotate(-16deg)', opacity: 0 }, { transform: 'scale(1.16) rotate(3deg)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }
      ], { duration: 620, delay: 360, easing: ease.spring, fill: 'both' }));
      this.anims.push(shine.animate([{ transform: 'translateX(-60%) skewX(-20deg)' }, { transform: 'translateX(260%) skewX(-20deg)' }], { duration: 1000, delay: 760, easing: 'ease-in-out', fill: 'both' }));
      // "respiração" suave enquanto espera o jogador (só na camada interna, sem brigar com o transform da logo)
      this.anims.push(stage.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-1.2%) scale(1.012)' }, { transform: 'translateY(0) scale(1)' }],
        { duration: 2400, delay: 1300, iterations: Infinity, easing: 'ease-in-out' }));
      this.inLogo = true; return true;
    },
    // vai do centro até o lugar dela no menu num único movimento
    exit(done) {
      if (!this.ready || !this.inLogo) return false; this.inLogo = false; this.exiting = true;
      const { brand, stage } = this.el, cur = getComputedStyle(brand).transform;
      this.stop(); brand.classList.add('show');
      const c = this.centerT(), end = c.base.trim() || 'none';
      const a = brand.animate([{ transform: cur === 'none' ? c.pre + c.base + 'scale(' + c.s + ')' : cur }, { transform: end }], { duration: 900, easing: ease.inOut });
      const end2 = () => { if (!this.exiting) return; this.exiting = false; brand.classList.remove('show'); if (done) done(); };
      a.onfinish = end2; a.oncancel = end2; setTimeout(end2, 1400);   // garantia: o 3D volta mesmo se a aba ficar em segundo plano
      this.anims.push(a);
      this.anims.push(this.el.shine.animate([{ transform: 'translateX(-60%) skewX(-20deg)' }, { transform: 'translateX(260%) skewX(-20deg)' }], { duration: 1000, delay: 700, easing: 'ease-in-out', fill: 'both' }));
      stage.style.transform = ''; return true;
    },
    resize() { if (this.inLogo && this.ready) { const keep = this.inLogo; this.stop(); this.el.brand.style.transform = ''; const c = this.centerT(); this.el.brand.style.transform = c.pre + c.base + 'scale(' + c.s + ')'; this.inLogo = keep; } }
  };
  window.Logo = Logo;
})();
