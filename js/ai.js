// =====================================================================================
// ai.js — piloto automático (bot)
// O bot "enxerga" a pista como uma lista de waypoints (um por nó da pista) com um deslocamento
// lateral de linha de corrida: em cada curva ele mira o lado de dentro. A cada quadro ele escolhe
// um waypoint à frente (mais longe quanto mais rápido), calcula o ângulo até ele e gera o mesmo
// tipo de comando que o teclado gera para o jogador ({up, down, steer, drift}).
// Extras: drift nas curvas longas (com mini-turbo), desvio do outro kart e "elástico" leve.
// =====================================================================================
(function () {
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
  const B = CFG.BOT;

  // gera os waypoints da linha de corrida a partir da geometria da pista
  function buildWaypoints(track) {
    const N = track.N, S = track.S, T = track.T, W = track.W, raw = new Float32Array(N), curv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = T[(i - 4 + N) % N], b = T[(i + 4) % N], n = { x: T[i].z, z: -T[i].x };
      const dx = b.x - a.x, dz = b.z - a.z, side = Math.sign(dx * n.x + dz * n.z);          // lado de dentro da curva
      const da = wrapA(Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z));
      const len = S[(i - 4 + N) % N].distanceTo(S[(i + 4) % N]) || 1;
      curv[i] = da / len;                                                                // curvatura com o sinal do volante
      raw[i] = side * B.LINE * (W - 2.5) * Math.min(1, Math.abs(curv[i]) * 45);
    }
    // suaviza e antecipa um pouco (entra aberto, tangencia por dentro, sai aberto)
    const lat = new Float32Array(N);
    for (let i = 0; i < N; i++) { let s = 0, c = 0; for (let k = -10; k <= 10; k++) { const w = 11 - Math.abs(k); s += raw[(i + k + 3 + N) % N] * w; c += w; } lat[i] = s / c; }
    track.curv = curv;
    return Array.from(lat, (l, i) => ({ lat: l, curv: curv[i] }));
  }

  class Bot {
    constructor(kart, track) {
      this.kart = kart; this.track = track; this.avoid = 0; this.driftCool = 0;
      track.waypoints = track.waypoints || buildWaypoints(track);
    }
    think(dt, others, leaderProgress) {
      const k = this.kart, tr = this.track, N = tr.N, wp = tr.waypoints;
      // desvio: se tem kart logo à frente, abre para o lado com mais espaço
      let want = 0;
      others.forEach(o => {
        const dx = o.pos.x - k.pos.x, dz = o.pos.z - k.pos.z, fwd = dx * Math.sin(k.ang) + dz * Math.cos(k.ang), lat = dx * Math.cos(k.ang) - dz * Math.sin(k.ang);
        if (fwd > 0 && fwd < 14 && Math.abs(lat) < 4) want = lat > 0 ? -5 : 5;
      });
      this.avoid += (want - this.avoid) * Math.min(1, 2.5 * dt);
      // alvo à frente
      const look = Math.round(B.LOOKAHEAD + Math.abs(k.speed) / 8), ti = (k.idx + look) % N;
      const lat = Math.max(-(tr.W - 2), Math.min(tr.W - 2, wp[ti].lat + this.avoid)), tgt = tr.side(ti, lat, 0);
      const desired = Math.atan2(tgt.x - k.pos.x, tgt.z - k.pos.z), diff = wrapA(desired - k.ang);
      let steer = Math.max(-1, Math.min(1, diff * 2.8));
      // curvatura média adiante (para drift e para aliviar o acelerador)
      let cs = 0, cmax = 0; for (let j = 2; j < 22; j++) { const c = wp[(k.idx + j) % N].curv; cs += c; cmax = Math.max(cmax, Math.abs(c)); }
      const cAvg = cs / 20;
      const up = !(Math.abs(diff) > 0.75 && k.speed > 22);
      // drift nas curvas longas: entra se a curva continua por um bom trecho, sai quando ela acaba
      this.driftCool -= dt;
      let drift = false;
      if (k.drifting) drift = Math.abs(cAvg) > B.DRIFT_MIN_CURV * 0.55 && k.driftT < 2.7;
      else if (this.driftCool <= 0 && k.speed > 30 && Math.abs(cAvg) > B.DRIFT_MIN_CURV && !k.off) { drift = true; steer = Math.sign(cAvg) || 1; this.driftCool = 1.2; }
      // "elástico": um pouco mais rápido se ficou para trás, mais lento se abriu vantagem
      const gap = (leaderProgress - k.progress);
      // k.skill: "personalidade" de cada rival (CFG.RIVALS[].top) — dá variedade ao pelotão de 8 karts
      k.topScale = (k.skill || 1) * B.SKILL * Math.max(B.RUBBER_MIN, Math.min(B.RUBBER_MAX, 1 + gap * 0.0006));
      return { up, down: false, steer, drift };
    }
  }

  window.Bot = Bot;
  window.buildWaypoints = buildWaypoints;
})();
