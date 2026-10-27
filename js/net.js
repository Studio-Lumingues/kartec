// =====================================================================================
// net.js — cliente de rede do modo online
//
// Por que o online fica liso:
//  1) O SEU kart nunca espera a rede: a física roda localmente (o controle responde no mesmo quadro).
//  2) Relógio comum: ping/pong contínuo; a amostra com MENOR ida-e-volta dá o desvio do relógio do servidor
//     (as outras têm fila no caminho). Mudanças pequenas são aplicadas aos poucos (sem "pulos" no tempo).
//  3) Os outros karts chegam 30x por segundo (40 bytes cada) e são desenhados um pouco "no passado"
//     (atraso de interpolação ADAPTATIVO = latência média + 2x a variação + meio intervalo de envio), sempre
//     entre dois estados reais conhecidos -> movimento contínuo mesmo com variação de ping.
//  4) Se um pacote atrasa além do buffer, o kart continua andando pela velocidade e direção que tinha
//     (extrapolação de até 0,25 s) e volta suavemente ao trilho quando o pacote chega.
// =====================================================================================
(function () {
  const T_STATE = 1, T_RELAY = 2, SEND_HZ = 30;
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

  const Net = {
    ws: null, id: 0, token: null, connected: false, room: null, handlers: {}, url: null,
    offset: 0, offsetT: 0, synced: false, rtt: 0, samples: [], pingTimer: null, raceStart: 0, raceId: 0,
    remote: new Map(), SEND_HZ,
    // endereço do servidor: o mesmo host da página (http/https) ou o salvo pelo jogador (página aberta via file://)
    // endereço do servidor configurado (jogo e servidor separados), normalizado para ws(s)://.../ws
    configured() {
      let u = (CFG.ONLINE_SERVER || '').trim(); if (!u) return '';
      u = u.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:'); if (!/^wss?:\/\//.test(u)) u = 'wss://' + u;
      return /\/ws\/?$/.test(u) ? u.replace(/\/$/, '') : u.replace(/\/$/, '') + '/ws';
    },
    // endereço HTTP do servidor (para "acordar" hospedagens grátis que dormem, como o Render)
    httpBase(url) { return (url || this.defaultUrl()).replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/ws\/?(\?.*)?$/, ''); },
    wake(url) { try { fetch(this.httpBase(url) + '/health?t=' + Date.now(), { mode: 'no-cors', cache: 'no-store' }).catch(() => { }); } catch (e) { } },
    defaultUrl() {
      if (this.configured()) return this.configured();
      if (/^https?:$/.test(location.protocol)) return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      try { return localStorage.getItem(CFG.STORAGE + ':server') || 'ws://localhost:8080/ws'; } catch (e) { return 'ws://localhost:8080/ws'; }
    },
    on(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    emit(type, m) { (this.handlers[type] || []).forEach(fn => { try { fn(m); } catch (e) { console.error('[net]', type, e); } }); },
    send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },

    connect(url, hello) {
      this.url = url || this.defaultUrl(); this.hello = hello; this._closing = false;
      return new Promise((resolve, reject) => {
        let ws; try { ws = new WebSocket(this.url + (this.token ? (this.url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(this.token) : '')); } catch (e) { reject(e); return; }
        ws.binaryType = 'arraybuffer'; this.ws = ws; let done = false;
        const fail = e => { if (!done) { done = true; reject(e || new Error('Sem conexão com o servidor')); } };
        const to = setTimeout(() => { fail(new Error('O servidor não respondeu')); try { ws.close(); } catch (e) { } }, 6000);
        ws.onopen = () => { this.send({ t: 'hello', name: hello.name, spec: hello.spec }); };
        ws.onerror = () => fail();
        ws.onclose = () => { clearTimeout(to); const was = this.connected; this.connected = false; clearInterval(this.pingTimer); fail(); if (was && !this._closing) this.emit('drop'); };
        ws.onmessage = ev => {
          if (typeof ev.data !== 'string') { this.onBinary(ev.data); return; }
          let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.t === 'welcome') { this.id = m.id; this.token = m.token; this.connected = true; clearTimeout(to); this.startPing(); if (!done) { done = true; resolve(m); } }
          if (m.t === 'pong') { this.onPong(m); return; }
          if (m.t === 'joined' || m.t === 'room') this.room = m.room;
          this.emit(m.t, m);
        };
      });
    },
    // reconexão automática (mesmo token = mesma vaga na sala)
    async reconnect() {
      for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 700 + i * 1200)); try { return await this.connect(this.url, this.hello); } catch (e) { } }
      return null;
    },
    close() { this._closing = true; clearInterval(this.pingTimer); if (this.ws) try { this.ws.close(); } catch (e) { } this.ws = null; this.connected = false; this.room = null; this.token = null; this.remote.clear(); },

    // ---------------- relógio sincronizado ----------------
    startPing() {
      clearInterval(this.pingTimer); this.samples = []; this.synced = false;
      let n = 0; const burst = setInterval(() => { this.ping(); if (++n >= 6) clearInterval(burst); }, 120);   // 6 amostras rápidas na entrada
      this.pingTimer = setInterval(() => this.ping(), 1000);
    },
    ping() { this.send({ t: 'ping', c: performance.now(), rtt: Math.round(this.rtt) }); },
    onPong(m) {
      const t = performance.now(), rtt = t - m.c; if (!(rtt >= 0 && rtt < 5000)) return;
      this.samples.push({ rtt, off: m.s + rtt / 2 - t }); if (this.samples.length > 12) this.samples.shift();
      const best = this.samples.reduce((a, b) => b.rtt < a.rtt ? b : a);
      this.rtt = this.samples.reduce((s, x) => s + x.rtt, 0) / this.samples.length;
      this.offsetT = best.off; if (!this.synced) { this.offset = best.off; this.synced = true; }
    },
    // chamado todo quadro: aproxima o desvio aos poucos (no máx. 1,5 ms por quadro); diferenças grandes, de uma vez
    tick() { const d = this.offsetT - this.offset; this.offset += Math.abs(d) > 250 ? d : Math.max(-1.5, Math.min(1.5, d)); },
    serverNow() { return performance.now() + this.offset; },
    raceTime() { return (this.serverNow() - this.raceStart) / 1000; },

    // ---------------- estado do kart (binário, 40 bytes) ----------------
    // u8 tipo | u8 id (servidor) | u8 flags | i8 driftDir | f32 t | x | y | z | ang | mvAng | speed | steer | prog
    _out: new DataView(new ArrayBuffer(40)),
    sendState(k, t) {
      if (!this.ws || this.ws.readyState !== 1 || this.ws.bufferedAmount > 32 * 1024) return;
      const v = this._out, f = (k.drifting ? 1 : 0) | (k.boostT > 0 ? 2 : 0) | (k.air ? 4 : 0) | (k.finished ? 8 : 0) | (k.wheelT > 0.5 ? 16 : 0);
      v.setUint8(0, T_STATE); v.setUint8(1, 0); v.setUint8(2, f); v.setInt8(3, k.driftDir || 0);
      [t, k.pos.x, k.pos.y, k.pos.z, k.ang, k.mvAng, k.speed, k.steerVis || 0, k.progress].forEach((x, i) => v.setFloat32(4 + i * 4, x, true));
      this.ws.send(v.buffer);
    },
    onBinary(ab) {
      if (!(ab instanceof ArrayBuffer) || ab.byteLength !== 40) return;
      const v = new DataView(ab); if (v.getUint8(0) !== T_RELAY) return;
      const id = v.getUint8(1), g = i => v.getFloat32(4 + i * 4, true);
      const s = { t: g(0), x: g(1), y: g(2), z: g(3), ang: g(4), mvAng: g(5), speed: g(6), steer: g(7), prog: g(8), flags: v.getUint8(2), driftDir: v.getInt8(3) };
      let R = this.remote.get(id); if (!R) { R = { buf: [], late: 0.08, dev: 0.02, delay: 0.12, n: 0 }; this.remote.set(id, R); }
      // atraso real deste pacote (relógio comum): média e variação móveis -> atraso de interpolação adaptativo
      const late = this.raceTime() - s.t; if (isFinite(late) && late > -1 && late < 3) { R.n++; const a = R.n < 10 ? 0.3 : 0.06; const d = late - R.late; R.late += d * a; R.dev += (Math.abs(d) - R.dev) * a; }
      const buf = R.buf; if (buf.length && s.t <= buf[buf.length - 1].t) { if (s.t < buf[buf.length - 1].t - 0.5) buf.length = 0; else return; }   // fora de ordem / reinício
      buf.push(s); if (buf.length > 48) buf.splice(0, buf.length - 48);
    },
    // estado de um jogador remoto no tempo de corrida "agora - atraso" (interpolado; extrapola até 0,25 s)
    sample(id, now, out) {
      const R = this.remote.get(id); if (!R || !R.buf.length) return false;
      const want = Math.max(0.05, Math.min(0.35, R.late + 2 * R.dev + 0.5 / SEND_HZ)); R.delay += (want - R.delay) * 0.02;
      const rt = now - R.delay, b = R.buf;
      while (b.length > 2 && b[1].t <= rt - 0.5) b.shift();                 // descarta o que já passou
      let i = b.length - 1; while (i > 0 && b[i - 1].t > rt) i--;
      const B = b[i], A = i > 0 ? b[i - 1] : null;
      if (A && A.t <= rt && B.t >= rt) {                                    // interpolação entre dois estados reais
        const f = (rt - A.t) / Math.max(1e-4, B.t - A.t), L = (p, q) => p + (q - p) * f, LA = (p, q) => p + wrapA(q - p) * f;
        out.x = L(A.x, B.x); out.y = L(A.y, B.y); out.z = L(A.z, B.z); out.ang = LA(A.ang, B.ang); out.mvAng = LA(A.mvAng, B.mvAng);
        out.speed = L(A.speed, B.speed); out.steer = L(A.steer, B.steer); out.prog = L(A.prog, B.prog); out.flags = B.flags; out.driftDir = B.driftDir;
      } else {                                                              // à frente do último pacote: extrapola pela velocidade
        const last = b[b.length - 1], dt = Math.max(0, Math.min(0.25, rt - last.t));
        out.x = last.x + Math.sin(last.mvAng) * last.speed * dt; out.z = last.z + Math.cos(last.mvAng) * last.speed * dt; out.y = last.y;
        out.ang = last.ang; out.mvAng = last.mvAng; out.speed = last.speed; out.steer = last.steer; out.prog = last.prog; out.flags = last.flags; out.driftDir = last.driftDir;
      }
      out.delay = R.delay; return true;
    },
    resetRace(startAt, raceId) { this.raceStart = startAt; this.raceId = raceId; this.remote.clear(); }
  };
  window.Net = Net;
})();
