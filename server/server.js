// =====================================================================================
// Super Kartec — servidor online
//
// * Serve os arquivos do jogo (HTTP, com gzip e cache) e o WebSocket em /ws, na MESMA porta.
// * Salas com nome e SENHA obrigatória (hash scrypt + sal; comparação em tempo constante; limite de
//   tentativas erradas por IP). Até 8 jogadores por sala, anfitrião escolhe pista/voltas e inicia.
// * Corrida: o servidor manda "prepare" (todos carregam a pista), espera todos avisarem "loaded" e então
//   marca o instante da largada (startAt) no RELÓGIO DO SERVIDOR. Cada cliente sincroniza o próprio relógio
//   (ping/pong, menor RTT) e a contagem regressiva acaba no mesmo instante em todas as telas.
// * Movimento: cada cliente simula o PRÓPRIO kart (resposta imediata ao controle, zero atraso de input) e
//   manda o estado 30x por segundo em binário (40 bytes). O servidor valida e retransmite NA HORA para os
//   outros (sem esperar "tick"), prefixando o id do jogador. Os clientes desenham os outros karts com
//   interpolação (buffer adaptativo) + extrapolação curta: movimento liso mesmo com variação de rede.
// * Batidas entre jogadores: quem detecta manda o impulso do outro ("bump"); o servidor repassa.
// * Resultado: tempos de chegada conferidos com o relógio do servidor; quem não termina em 45 s após o
//   primeiro fica como "não terminou", ordenado pelo progresso.
//
// Uso (na raiz do projeto):  npm install && npm start      (variáveis: PORT=8080 HOST=0.0.0.0; o Render define PORT sozinho)
// =====================================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 8080, HOST = process.env.HOST || '0.0.0.0';
// ALLOWED_ORIGINS: sites que podem usar este servidor (separados por vírgula), ex.: https://meu-jogo.vercel.app
// Vazio = qualquer site. SERVE_STATIC=0 desliga a entrega dos arquivos do jogo (servidor só de online).
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '').toLowerCase()).filter(Boolean);
const SERVE_STATIC = process.env.SERVE_STATIC !== '0';
const ROOT = path.resolve(__dirname, '..');
const PROTOCOL = 1, MAX_PLAYERS = 8, MAX_ROOMS = 200, TRACK_COUNT = 3;
const FINISH_GRACE_MS = 45000, LOAD_TIMEOUT_MS = 20000, COUNTDOWN_MS = 3600, START_MARGIN_MS = 900;
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;      // ms com fração (monotônico)

// ---------------------------------------------------------------- HTTP (arquivos do jogo)
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const gzCache = new Map();
const server = http.createServer((req, res) => {
  try {
    let url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: clients.size })); return; }
    if (!SERVE_STATIC) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Servidor online do Super Kartec. Jogo: abra o site do jogo.'); return; }
    if (url.endsWith('/')) url += 'index.html';
    const file = path.normalize(path.join(ROOT, url));
    const rel = path.relative(ROOT, file).split(path.sep);
    if (!file.startsWith(ROOT + path.sep) || ['server', 'node_modules'].includes(rel[0]) || rel.some(x => x.startsWith('.')) || /^(package(-lock)?\.json|render\.yaml)$/.test(rel[0])) { res.writeHead(403); res.end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
      const ext = path.extname(file).toLowerCase(), type = MIME[ext] || 'application/octet-stream';
      const etag = '"' + st.size.toString(36) + '-' + st.mtimeMs.toString(36) + '"';
      const big = /assets\/(audio_|pilot)/.test(url);   // mídia pesada: cache longo (o nome leva ?v= da versão)
      const headers = { 'Content-Type': type, 'ETag': etag, 'Cache-Control': big ? 'public, max-age=86400' : 'no-cache', 'X-Content-Type-Options': 'nosniff' };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
      const gz = /gzip/.test(req.headers['accept-encoding'] || '') && /text|javascript|json|svg|gltf/.test(type);
      if (!gz) { res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size })); fs.createReadStream(file).pipe(res); return; }
      const hit = gzCache.get(file);
      const send = buf => { res.writeHead(200, Object.assign(headers, { 'Content-Encoding': 'gzip', 'Content-Length': buf.length, 'Vary': 'Accept-Encoding' })); res.end(buf); };
      if (hit && hit.etag === etag) { send(hit.buf); return; }
      fs.readFile(file, (e2, data) => { if (e2) { res.writeHead(500); res.end(); return; }
        zlib.gzip(data, { level: 7 }, (e3, buf) => { if (e3) { res.writeHead(500); res.end(); return; } gzCache.set(file, { etag, buf }); send(buf); }); });
    });
  } catch (e) { res.writeHead(400); res.end(); }
});

// ---------------------------------------------------------------- estado
const clients = new Map();        // ws -> Player
const players = new Map();        // id -> Player
const rooms = new Map();          // roomId -> Room
const tokens = new Map();         // token -> Player (reconexão)
const attempts = new Map();       // ip|roomId -> { n, t }
let nextId = 1;
const newRoomId = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s; do { s = ''; for (let i = 0; i < 5; i++) s += A[crypto.randomInt(A.length)]; } while (rooms.has(s)); return s; };

// ---------------------------------------------------------------- validação
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const HEX = /^#[0-9a-fA-F]{6}$/;
function cleanSpec(s) {
  s = s && typeof s === 'object' ? s : {};
  const str = (v, d) => (typeof v === 'string' && /^[a-z0-9_-]{1,16}$/i.test(v)) ? v : d;
  const col = (v, d) => (typeof v === 'string' && HEX.test(v)) ? v : d;
  return { model: str(s.model, 'gt'), color: col(s.color, '#e8302a'), decal: str(s.decal, 'none'), decalColor: col(s.decalColor, '#ffc928'),
    number: Math.max(0, Math.min(99, s.number | 0)), suit: col(s.suit, '#e8302a'), helmet: col(s.helmet, '#e8302a'), skin: col(s.skin, '#f2b48a'), accessory: str(s.accessory, 'none') };
}
function hashPass(pass, salt) { return crypto.scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1 }); }

// ---------------------------------------------------------------- envio
const send = (p, obj) => { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); };
const roomPlayers = r => r.order.map(id => players.get(id)).filter(Boolean);
const broadcast = (r, obj, except) => { const s = JSON.stringify(obj); roomPlayers(r).forEach(p => { if (p !== except && p.ws && p.ws.readyState === 1) p.ws.send(s); }); };
function roomView(r) {
  return { id: r.id, name: r.name, max: r.max, track: r.track, laps: r.laps, state: r.state, host: r.host,
    players: roomPlayers(r).map(p => ({ id: p.id, name: p.name, spec: p.spec, ready: p.ready, away: !p.ws, ping: Math.round(p.rtt || 0) })) };
}
const pushRoom = r => broadcast(r, { t: 'room', room: roomView(r) });
const listView = () => [...rooms.values()].map(r => ({ id: r.id, name: r.name, players: r.order.length, max: r.max, track: r.track, laps: r.laps, state: r.state, locked: true }));

// ---------------------------------------------------------------- salas
function leaveRoom(p, reason) {
  const r = p.room && rooms.get(p.room); p.room = null; p.ready = false; if (!r) return;
  r.order = r.order.filter(id => id !== p.id);
  if (r.race) { r.race.left.add(p.id); }
  if (!r.order.length) { if (r.race && r.race.timer) clearTimeout(r.race.timer); rooms.delete(r.id); return; }
  if (r.host === p.id) r.host = r.order[0];
  broadcast(r, { t: 'left', id: p.id, reason: reason || 'saiu' });
  pushRoom(r); if (r.race) checkRace(r);
}
function joinRoom(p, r) {
  if (p.room) leaveRoom(p);
  p.room = r.id; p.ready = false; r.order.push(p.id);
  send(p, { t: 'joined', room: roomView(r), you: p.id });
  broadcast(r, { t: 'notice', msg: p.name + ' entrou na sala' }, p); pushRoom(r);
}

// ---------------------------------------------------------------- corrida
function startRace(r) {
  r.state = 'loading'; r.raceN = (r.raceN || 0) + 1;
  const ids = r.order.slice();
  for (let i = ids.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }   // grid sorteado
  r.race = { id: r.raceN, ids, loaded: new Set(), finish: new Map(), prog: new Map(), left: new Set(), startAt: 0, firstFinish: 0, timer: null };
  broadcast(r, { t: 'prepare', raceId: r.raceN, track: r.track, laps: r.laps, grid: ids.map((id, slot) => ({ id, slot, name: players.get(id).name, spec: players.get(id).spec })) });
  r.race.timer = setTimeout(() => go(r), LOAD_TIMEOUT_MS);                 // quem não carregar a tempo larga atrasado
  pushRoom(r);
}
function go(r) {
  if (!r.race || r.state !== 'loading') return; clearTimeout(r.race.timer);
  r.state = 'racing'; r.race.startAt = now() + COUNTDOWN_MS + START_MARGIN_MS;     // "VAI!" exatamente aqui (relógio do servidor)
  broadcast(r, { t: 'go', raceId: r.race.id, startAt: r.race.startAt, serverTime: now() });
  pushRoom(r);
}
function checkRace(r) {
  const R = r.race; if (!R) return;
  if (r.state === 'loading' && R.ids.every(id => R.loaded.has(id) || R.left.has(id) || !players.get(id) || players.get(id).room !== r.id)) go(r);
  if (r.state === 'racing') { const active = R.ids.filter(id => !R.left.has(id) && players.get(id) && players.get(id).room === r.id);
    if (active.length && active.every(id => R.finish.has(id))) endRace(r); }
}
function endRace(r) {
  const R = r.race; if (!R || r.state === 'results') return; clearTimeout(R.timer);
  r.state = 'results';
  const rows = R.ids.map(id => { const p = players.get(id), f = R.finish.get(id);
    return { id, name: p ? p.name : 'Jogador', spec: p ? p.spec : cleanSpec({}), time: f !== undefined ? f : null, prog: R.prog.get(id) || 0, left: R.left.has(id) }; });
  rows.sort((a, b) => (a.time === null) - (b.time === null) || (a.time !== null ? a.time - b.time : b.prog - a.prog));
  broadcast(r, { t: 'results', raceId: R.id, rows: rows.map(({ prog, ...x }) => x) });
  r.race = null; roomPlayers(r).forEach(p => { p.ready = false; });
  setTimeout(() => { if (rooms.get(r.id) === r && r.state === 'results') { r.state = 'lobby'; pushRoom(r); } }, 1500);
}

// ---------------------------------------------------------------- mensagens
function onJson(p, m) {
  if (!m || typeof m.t !== 'string') return;
  const r = p.room && rooms.get(p.room);
  switch (m.t) {
    case 'ping': send(p, { t: 'pong', c: m.c, s: now() }); if (typeof m.rtt === 'number' && m.rtt >= 0 && m.rtt < 5000) p.rtt = m.rtt; return;
    case 'hello': {
      p.name = clean(m.name, 16) || ('Piloto ' + p.id); p.spec = cleanSpec(m.spec);
      send(p, { t: 'welcome', id: p.id, token: p.token, serverTime: now(), protocol: PROTOCOL }); return; }
    case 'spec': p.spec = cleanSpec(m.spec); if (r) pushRoom(r); return;
    case 'name': p.name = clean(m.name, 16) || p.name; if (r) pushRoom(r); return;
    case 'list': send(p, { t: 'rooms', rooms: listView() }); return;
    case 'create': {
      if (rooms.size >= MAX_ROOMS) return send(p, { t: 'error', code: 'full', msg: 'Servidor cheio: tente de novo em instantes.' });
      const name = clean(m.name, 24), pass = String(m.password || '');
      if (!name) return send(p, { t: 'error', code: 'name', msg: 'Dê um nome para a sala.' });
      if (pass.length < 3 || pass.length > 32) return send(p, { t: 'error', code: 'pass', msg: 'A senha precisa ter de 3 a 32 caracteres.' });
      const salt = crypto.randomBytes(16), r2 = { id: newRoomId(), name, salt, hash: hashPass(pass, salt), max: Math.max(2, Math.min(MAX_PLAYERS, m.max | 0 || MAX_PLAYERS)),
        track: Math.max(0, Math.min(TRACK_COUNT - 1, m.track | 0)), laps: Math.max(1, Math.min(5, m.laps | 0 || 3)), order: [], host: p.id, state: 'lobby', race: null };
      rooms.set(r2.id, r2); joinRoom(p, r2); return; }
    case 'join': {
      const r2 = rooms.get(String(m.id || '').toUpperCase().trim());
      if (!r2) return send(p, { t: 'error', code: 'noroom', msg: 'Sala não encontrada.' });
      const key = p.ip + '|' + r2.id, at = attempts.get(key) || { n: 0, t: now() };
      if (now() - at.t > 60000) { at.n = 0; at.t = now(); }
      if (at.n >= 6) return send(p, { t: 'error', code: 'slow', msg: 'Muitas tentativas. Aguarde um minuto.' });
      const ok = crypto.timingSafeEqual(hashPass(String(m.password || ''), r2.salt), r2.hash);
      if (!ok) { at.n++; attempts.set(key, at); return send(p, { t: 'error', code: 'pass', msg: 'Senha incorreta.' }); }
      if (r2.order.length >= r2.max) return send(p, { t: 'error', code: 'full', msg: 'Sala cheia.' });
      if (r2.state !== 'lobby' && r2.state !== 'results') return send(p, { t: 'error', code: 'busy', msg: 'Corrida em andamento: entre quando ela acabar.' });
      attempts.delete(key); joinRoom(p, r2); return; }
    case 'leave': leaveRoom(p); send(p, { t: 'rooms', rooms: listView() }); return;
    case 'ready': if (r && r.state === 'lobby') { p.ready = !!m.v; pushRoom(r); } return;
    case 'settings': if (r && r.host === p.id && r.state === 'lobby') { if (m.track !== undefined) r.track = Math.max(0, Math.min(TRACK_COUNT - 1, m.track | 0)); if (m.laps !== undefined) r.laps = Math.max(1, Math.min(5, m.laps | 0)); pushRoom(r); } return;
    case 'kick': if (r && r.host === p.id && m.id !== p.id) { const k = players.get(m.id); if (k && k.room === r.id) { leaveRoom(k, 'removido pelo anfitrião'); send(k, { t: 'kicked' }); } } return;
    case 'start': {
      if (!r || r.host !== p.id || r.state !== 'lobby') return;
      const others = roomPlayers(r).filter(x => x !== p);
      if (others.some(x => !x.ready)) return send(p, { t: 'error', code: 'ready', msg: 'Espere todos marcarem "Pronto".' });
      startRace(r); return; }
    case 'loaded': if (r && r.race && m.raceId === r.race.id) { r.race.loaded.add(p.id); checkRace(r); } return;
    case 'finish': {
      if (!r || !r.race || r.state !== 'racing' || m.raceId !== r.race.id || r.race.finish.has(p.id)) return;
      const srv = (now() - r.race.startAt) / 1000, t = Number(m.time);
      // o tempo do cliente vale se bater com o relógio do servidor (latência + folga); senão, usa o do servidor
      const time = isFinite(t) && t > 5 && Math.abs(t - srv) < 2 + (p.rtt || 0) / 1000 ? t : srv;
      r.race.finish.set(p.id, Math.round(time * 1000) / 1000);
      broadcast(r, { t: 'finished', id: p.id, time: r.race.finish.get(p.id) });
      if (!r.race.firstFinish) { r.race.firstFinish = now(); clearTimeout(r.race.timer); r.race.timer = setTimeout(() => endRace(r), FINISH_GRACE_MS); }
      checkRace(r); return; }
    case 'bump': {
      if (!r || r.state !== 'racing') return; const to = players.get(m.to); if (!to || to.room !== r.id) return;
      const f = v => Math.max(-40, Math.min(40, Number(v) || 0));
      send(to, { t: 'bump', from: p.id, ix: f(m.ix), iz: f(m.iz), lever: Math.max(-2, Math.min(2, Number(m.lever) || 0)), j: f(m.j) }); return; }
  }
}
// pacote binário de estado (cliente -> servidor): 40 bytes
//  u8 tipo(1) | u8 id (o servidor preenche) | u8 flags | i8 driftDir | f32 t | f32 x | f32 y | f32 z | f32 ang | f32 mvAng | f32 speed | f32 steer | f32 prog
function onBinary(p, buf) {
  const r = p.room && rooms.get(p.room); if (!r || r.state !== 'racing' || buf.length !== 40 || buf[0] !== 1) return;
  const t = now(); if (t - (p.lastState || 0) < 12) return;               // no máximo ~80 pacotes/s por jogador
  p.lastState = t;
  for (let o = 4; o < 40; o += 4) if (!isFinite(buf.readFloatLE(o))) return;
  const speed = buf.readFloatLE(28); if (Math.abs(speed) > 200) return;
  r.race.prog.set(p.id, buf.readFloatLE(36));
  // retransmite já: mesmo pacote com tipo 2 e o id de quem mandou
  const out = Buffer.allocUnsafe(40); buf.copy(out, 0, 0, 40); out[0] = 2; out[1] = p.id & 255;
  roomPlayers(r).forEach(o => { if (o !== p && o.ws && o.ws.readyState === 1 && o.ws.bufferedAmount < 64 * 1024) o.ws.send(out, { binary: true }); });
}

// ---------------------------------------------------------------- WebSocket
// o próprio site (jogo servido por este servidor) sempre pode; outros sites só se estiverem em ALLOWED_ORIGINS
const sameHost = (o, host) => { try { return !!o && new URL(o).host.toLowerCase() === String(host || '').toLowerCase(); } catch (e) { return false; } };
const originOk = (o, host) => !ALLOWED.length || sameHost(o, host) || ALLOWED.includes(String(o || '').replace(/\/$/, '').toLowerCase());
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false,
  verifyClient: (info, cb) => { const ok = originOk(info.origin, info.req.headers.host); if (!ok) console.warn('[ws] origem recusada:', info.origin); cb(ok, 403, 'Origem não autorizada'); } });
wss.on('connection', (ws, req) => {
  ws._socket && ws._socket.setNoDelay(true);
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  // reconexão: ?token=... devolve o mesmo jogador (mesma sala), se ainda existir
  const tok = new URL(req.url, 'http://x').searchParams.get('token');
  let p = tok && tokens.get(tok);
  if (p && !p.ws) { p.ws = ws; clearTimeout(p.dropTimer); }
  else { const id = nextId; nextId = nextId >= 250 ? 1 : nextId + 1;
    p = { id, ws, ip, token: crypto.randomBytes(18).toString('base64url'), name: 'Piloto ' + id, spec: cleanSpec({}), room: null, ready: false, rtt: 0 };
    players.set(id, p); tokens.set(p.token, p); }
  clients.set(ws, p); ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) { onBinary(p, Buffer.isBuffer(data) ? data : Buffer.from(data)); return; }
    let m; try { m = JSON.parse(data.toString()); } catch (e) { return; }
    try { onJson(p, m); } catch (e) { console.error('[msg]', e); }
  });
  ws.on('close', () => {
    clients.delete(ws); if (p.ws !== ws) return; p.ws = null;
    const r = p.room && rooms.get(p.room); if (r) pushRoom(r);
    // 20 s para voltar (queda de wi-fi/4G); depois sai da sala de vez
    p.dropTimer = setTimeout(() => { leaveRoom(p, 'desconectou'); players.delete(p.id); tokens.delete(p.token); }, 20000);
  });
  if (p.room && rooms.get(p.room)) { const r = rooms.get(p.room); send(p, { t: 'welcome', id: p.id, token: p.token, serverTime: now(), protocol: PROTOCOL, resumed: true }); send(p, { t: 'joined', room: roomView(r), you: p.id }); pushRoom(r); }
});
// batimento: derruba conexões mortas (sem resposta em 10 s)
setInterval(() => { wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch (e) { } }); }, 10000);
// atualiza o ping de todos na sala de tempos em tempos (para o painel do lobby)
setInterval(() => rooms.forEach(r => { if (r.state === 'lobby') pushRoom(r); }), 5000);

server.listen(PORT, HOST, () => {
  const nets = require('os').networkInterfaces(), ips = [];
  Object.values(nets).forEach(list => (list || []).forEach(n => { if (n.family === 'IPv4' && !n.internal) ips.push(n.address); }));
  if (ALLOWED.length) console.log('Sites autorizados:', ALLOWED.join(', '));
  console.log('Super Kartec online em http://localhost:' + PORT + (ips.length ? '  |  na rede: ' + ips.map(ip => 'http://' + ip + ':' + PORT).join('  ') : ''));
});
module.exports = { server, rooms, players };
