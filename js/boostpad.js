// =====================================================================================
// boostpad.js — textura "gamer" quadriculada do boost (painel de LEDs com setas), SEM moldura
//
//   BoostPad.texture()        -> THREE.CanvasTexture (compartilhada por todos os boosts)
//   BoostPad.material()       -> material pronto (brilha sozinho, não depende da luz da cena)
//   BoostPad.update(dt)       -> faz as setas "correrem" (chame uma vez por quadro)
//
// Ajustes em CFG.BOOSTPAD (opcional): COLOR, DIM, CELLS_X, CELLS_Y, SPEED, FLIP
// =====================================================================================
(function () {
  const C = Object.assign({
    COLOR: '#3cff4e',   // cor dos LEDs acesos (verde da referência)
    DIM: '#0b5a14',     // LEDs apagados
    BG: '#062b0a',      // fundo entre os quadradinhos
    CELLS_X: 14,        // quadradinhos na largura
    CELLS_Y: 28,        // quadradinhos no comprimento (uma "volta" da animação)
    SPEED: 1.2,         // voltas da textura por segundo
    FLIP: false         // true se as setas apontarem para trás na pista
  }, (window.CFG && window.CFG.BOOSTPAD) || {});

  const CELL = 16;      // pixels por quadradinho no canvas

  function draw() {
    const W = C.CELLS_X * CELL, H = C.CELLS_Y * CELL;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = C.BG; g.fillRect(0, 0, W, H);

    // duas setas (chevrons) por volta, espessura de 3 quadradinhos
    const period = C.CELLS_Y / 2, thick = 3, mid = (C.CELLS_X - 1) / 2;
    for (let j = 0; j < C.CELLS_Y; j++) for (let i = 0; i < C.CELLS_X; i++) {
      const dx = Math.abs(i - mid);
      const v = ((j - dx) % period + period) % period; // forma de "^" repetida
      const on = v < thick;
      const x = i * CELL + 2, y = j * CELL + 2, s = CELL - 4;
      g.fillStyle = on ? C.COLOR : C.DIM;
      g.fillRect(x, y, s, s);
      if (on) {                                        // miolo mais claro = LED aceso
        g.fillStyle = 'rgba(255,255,255,0.45)';
        g.fillRect(x + 3, y + 3, s - 6, s - 6);
      }
    }
    if (C.FLIP) { const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
      const g2 = c2.getContext('2d'); g2.translate(0, H); g2.scale(1, -1); g2.drawImage(cv, 0, 0); return c2; }
    return cv;
  }

  let tex = null, mat = null;
  const BoostPad = {
    texture() {
      if (tex) return tex;
      tex = new THREE.CanvasTexture(draw());
      tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.NearestFilter;              // quadradinhos nítidos, sem borrar
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      if (window.TX && TX.aniso) tex.anisotropy = TX.aniso;
      return tex;
    },
    material() {
      if (mat) return mat;
      mat = new THREE.MeshBasicMaterial({ map: this.texture(), transparent: false, toneMapped: false });
      mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;   // sem "piscar" sobre o asfalto
      return mat;
    },
    update(dt) { if (tex) tex.offset.y = (tex.offset.y - dt * C.SPEED * (C.FLIP ? -1 : 1)) % 1; },
    C
  };
  window.BoostPad = BoostPad;
})();
