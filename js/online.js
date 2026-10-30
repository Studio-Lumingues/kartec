// =====================================================================================
// online.js — telas do modo online (criar/entrar em sala com senha, sala de espera) e eventos da rede
// O jogo em si (karts de rede, envio de estado, colisões) fica no main.js; a conexão, no net.js.
// =====================================================================================
(function () {
  const $ = id => document.getElementById(id);
  const KEY = () => CFG.STORAGE + ':name';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const Online = {
    tab: 'join', selected: null, rooms: [],
    active() { return Net.connected && !!Net.room; },
    init() {
      // opções de pista/voltas/jogadores
      const fill = (sel, items) => { sel.innerHTML = ''; items.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }); };
      const tracks = CFG.TRACKS.map((t, i) => [i, t.name]), laps = CFG.LAPS_OPTIONS.map(n => [n, n + (n > 1 ? ' voltas' : ' volta')]);
      fill($('onTrack'), tracks); fill($('lobbyTrack'), tracks); fill($('onLaps'), laps); fill($('lobbyLaps'), laps); fill($('onMax'), [2, 3, 4, 5, 6, 7, 8].map(n => [n, n + ' jogadores']));
      $('onLaps').value = 3; $('onMax').value = 8;
      try { $('onName').value = localStorage.getItem(KEY()) || ''; } catch (e) { }
      $('onServer').value = Net.defaultUrl(); if (/^https?:$/.test(location.protocol) || Net.configured()) $('onServer').closest('details').hidden = true;
      // servidor em outro endereço (ex.: Render grátis, que dorme): já começa a acordá-lo enquanto o jogo carrega
      if (Net.configured()) Net.wake();
      // botões
      $('btnOnline').addEventListener('click', () => { UI.Sfx.unlock(); this.open(); });
      $('onTabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => this.setTab(b.dataset.v)));
      $('onRefresh').addEventListener('click', () => this.refresh());
      $('onJoinBtn').addEventListener('click', () => this.join());
      $('onCreateBtn').addEventListener('click', () => this.create());
      // busca: filtra a lista pelo NOME da sala enquanto digita (sem diferença de acento/maiúscula)
      $('onSearch').addEventListener('input', () => this.renderRooms(this.rooms));
      $('onSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const first = this.filtered()[0]; if (first) this.pick(first); } });
      $('onMode').addEventListener('change', () => { $('onTrackField').hidden = $('onMode').value === 'cup'; });
      $('lobbyMode').addEventListener('change', e => Net.send({ t: 'settings', mode: e.target.value }));
      // lista se atualiza sozinha enquanto a aba "Entrar" está aberta
      setInterval(() => { if (UI.modal === 'onlineModal' && this.tab === 'join' && Net.connected && !Net.room) this.refresh(); }, 4000);
      [['onPass', () => this.join()], ['onRoomPass', () => this.create()], ['onRoomName', () => $('onRoomPass').focus()]].forEach(([id, fn]) =>
        $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fn(); } }));
      $('onName').addEventListener('change', () => { const n = this.name(); try { localStorage.setItem(KEY(), n); } catch (e) { } if (Net.connected) Net.send({ t: 'name', name: n }); });
      $('lobbyReady').addEventListener('click', () => { const me = this.me(); Net.send({ t: 'ready', v: !(me && me.ready) }); UI.Sfx.tone(660, 990, 0.08, 'square', 0.06); });
      $('lobbyStart').addEventListener('click', () => { Net.send({ t: 'start' }); });
      $('lobbyLeave').addEventListener('click', () => this.leave(true));
      $('lobbyTrack').addEventListener('change', e => Net.send({ t: 'settings', track: +e.target.value }));
      $('lobbyLaps').addEventListener('change', e => Net.send({ t: 'settings', laps: +e.target.value }));
      // visual do kart muda na garagem -> os outros veem na hora
      Custom.onChange(() => { if (Net.connected) Net.send({ t: 'spec', spec: Custom.spec }); });
      // eventos da rede
      Net.on('rooms', m => this.renderRooms(m.rooms));
      Net.on('joined', m => { if (this.resuming) { this.resuming.room = m.room; return; } this.enterLobby(m.room, m.resumed); });
      Net.on('resume', m => { if (this.resuming) { this.resuming.race = m; return; } this.handleResume(m); });
      Net.on('room', m => this.renderLobby(m.room));
      Net.on('error', m => { if (m.code === 'needpass' || m.code === 'pass') this.showPass(true); this.error(m.msg); });
      Net.on('notice', m => UI.toast(m.msg, 1800));
      Net.on('prepare', m => { UI.closeModal(true); Game.onlinePrepare(m); });
      Net.on('go', m => Game.onlineGo(m));
      Net.on('finished', m => Game.onlineFinished(m));
      Net.on('left', m => { if (Game.online) Game.onlineLeft(m.id); });
      Net.on('results', m => Game.onlineResults(m.rows, m.cup));
      Net.on('bump', m => Game.netBump(m));
      Net.on('kicked', () => { Net.room = null; Net.forget(); UI.toast('Você foi removido da sala', 2500); Game.leaveOnline(true); });
      Net.on('drop', () => this.onDrop());
      this.bootResume();
    },
    // ---------- voltar para a sala/corrida depois de F5 ou de reabrir a aba (prazo de 15 s) ----------
    // a conexão começa JÁ, enquanto o jogo ainda carrega, para garantir a vaga dentro do prazo;
    // a corrida só é remontada quando o carregamento termina (bootDone, chamado pelo main.js)
    bootResume() {
      const info = Net.pending(); if (!info) return;
      this.resuming = { ok: false, room: null, race: null };
      this.banner('Voltando para a sala…');
      Net.resume(info, { name: this.name(), spec: Custom.spec }, s => this.banner('Voltando para a corrida… ' + s + ' s')).then(w => {
        if (!this.resuming) return;
        if (!w) { this.resuming = null; this.banner(''); this._resumeFailed = true; if (this.booted) this.resumeFailed(); return; }
        this.resuming.ok = true; this.finishResume();
      });
    },
    // main.js: carregamento terminou. Devolve true se a retomada cuida da próxima tela (sem abertura)
    bootDone() {
      this.booted = true;
      if (this._resumeFailed) { this._resumeFailed = false; setTimeout(() => UI.toast('Não deu para voltar à corrida: passou de 15 s', 3200), 600); return false; }
      if (!this.resuming) return false;
      this.finishResume(); return true;
    },
    resumeFailed() { this.banner(''); Game.toIntro(); setTimeout(() => UI.toast('Não deu para voltar à corrida: passou de 15 s', 3200), 600); },
    finishResume() {
      const R = this.resuming; if (!R || !R.ok || !this.booted) return;
      this.resuming = null; this.banner('');
      if (!R.room) { this.resumeFailed(); return; }
      Game.toMenu(true); Net.room = R.room;
      if (R.race) this.handleResume(R.race); else this.enterLobby(R.room, true);
    },
    async handleResume(m) {
      // queda rápida no meio da própria corrida: a cena já existe, só segue (e larga, se o "VAI" chegou enquanto estava fora)
      if (Game.online && Game.online.raceId === m.raceId && Game.scene) {
        if (Game.state === 'waiting') { if (m.state === 'racing' && m.startAt) Game.onlineGo({ raceId: m.raceId, startAt: m.startAt }); else Net.send({ t: 'loaded', raceId: m.raceId }); }
        return;
      }
      UI.closeModal(true);
      if (m.state === 'loading') { Game.onlinePrepare(m); return; }
      // relógio sincronizado antes de decidir se ainda está na contagem ou já correndo (no máx. 2 s)
      const t0 = performance.now(); while (!Net.synced && performance.now() - t0 < 2000) await new Promise(r => setTimeout(r, 50));
      Game.onlineResume(m);
    },
    // faixa de aviso da reconexão (vazia = esconde)
    banner(t) {
      let el = $('netResume');
      if (!t) { if (el) el.hidden = true; return; }
      if (!el) { el = document.createElement('div'); el.id = 'netResume'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
      el.textContent = t; el.hidden = false;
    },
    name() { return ($('onName').value || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Piloto'; },
    me() { return Net.room && Net.room.players.find(p => p.id === Net.id); },
    status(t, cls) { const e = $('onStatus'); e.textContent = t; e.className = 'netStatus ' + (cls || ''); },
    error(t) { if (UI.modal === 'onlineModal') { $('onError').textContent = t || ''; } else if (t) UI.toast(t, 2600); },
    setTab(t) { this.tab = t; $('onTabs').querySelectorAll('button').forEach(b => { const on = b.dataset.v === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      $('onJoin').hidden = t !== 'join'; $('onCreate').hidden = t !== 'create'; this.error(''); if (t === 'join') this.refresh(); },
    async open() {
      UI.openModal('onlineModal'); this.error(''); this.selected = null; this.showPass(false); if (!$('onName').value) $('onName').value = 'Piloto ' + (100 + Math.floor(Math.random() * 900));
      if (await this.ensure()) this.refresh();
    },
    async ensure() {
      if (Net.connected) { this.status('Conectado · ping ' + Math.round(Net.rtt) + ' ms', 'ok'); return true; }
      const url = ($('onServer').value || '').trim() || Net.defaultUrl();
      try { localStorage.setItem(CFG.STORAGE + ':server', url); } catch (e) { }
      this.status('Conectando…');
      // hospedagem grátis pode estar dormindo: acorda e tenta de novo por até ~90 s, mostrando o progresso
      const t0 = performance.now(); let tries = 0;
      while (true) {
        try { await Net.connect(url, { name: this.name(), spec: Custom.spec }); this.status('Conectado', 'ok'); setTimeout(() => this.status('Conectado · ping ' + Math.round(Net.rtt) + ' ms', 'ok'), 900); return true; }
        catch (e) {
          const secs = Math.round((performance.now() - t0) / 1000);
          if (secs > 90 || UI.modal !== 'onlineModal') { this.status('Sem conexão com o servidor (' + url + '). Confira se ele está no ar e tente de novo.', 'bad'); return false; }
          if (tries++ === 0) Net.wake(url);
          this.status('Acordando o servidor… ' + secs + ' s (o plano grátis "dorme" quando ninguém joga; leva até 1 minuto)');
          await new Promise(r => setTimeout(r, 2500));
        }
      }
    },
    refresh() { if (Net.connected) Net.send({ t: 'list' }); },
    // ---------- lista de salas: busca pelo nome, sala pública entra com um clique ----------
    norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); },
    filtered() { const q = this.norm($('onSearch').value); return q ? this.rooms.filter(r => this.norm(r.name).includes(q)) : this.rooms; },
    renderRooms(list) {
      this.rooms = list || []; const box = $('onRooms'), shown = this.filtered(), q = ($('onSearch').value || '').trim(); box.innerHTML = '';
      if (this.selected && !this.rooms.some(r => r.id === this.selected)) { this.selected = null; this.showPass(false); }
      if (!this.rooms.length) { box.innerHTML = '<p class="empty">Nenhuma sala aberta. Crie a sua na aba ao lado!</p>'; return; }
      if (!shown.length) { box.innerHTML = '<p class="empty">Nenhuma sala com “' + esc(q) + '” no nome.</p>'; return; }
      shown.forEach(r => {
        const busy = r.state !== 'lobby', cup = r.mode === 'cup';
        const b = document.createElement('button'); b.type = 'button'; b.className = 'roomItem' + (this.selected === r.id ? ' on' : '') + (busy ? ' busy' : '') + (r.locked ? ' locked' : '');
        const where = cup ? CFG.CUP.name + ' · 3 pistas' : (CFG.TRACKS[r.track] ? CFG.TRACKS[r.track].name : '');
        b.innerHTML = '<span class="lock" title="' + (r.locked ? 'Com senha' : 'Pública') + '">' + Icon.svg(r.locked ? 'lock' : 'online') + '</span><span class="rn"><strong>' + esc(r.name) + '</strong><small>' + esc(where) + ' · ' + r.laps + (r.laps > 1 ? ' voltas' : ' volta') + (busy ? ' · correndo' : r.locked ? ' · com senha' : ' · pública') + '</small></span><span class="rp">' + r.players + '/' + r.max + '</span>';
        b.dataset.id = r.id; b.addEventListener('click', () => this.pick(r));
        box.appendChild(b);
      });
    },
    // escolher uma sala: pública entra na hora; com senha mostra o campo da senha
    pick(r) {
      this.error('');
      if (r.state !== 'lobby') return this.error(r.mode === 'cup' ? 'Copa em andamento: entre quando ela acabar.' : 'Corrida em andamento: entre quando ela acabar.');
      if (r.players >= r.max) return this.error('Sala cheia.');
      this.selected = r.id; $('onRooms').querySelectorAll('.roomItem').forEach(x => x.classList.toggle('on', x.dataset.id === r.id));
      if (r.locked) { $('onPass').value = ''; this.showPass(true, r.name); return; }
      this.showPass(false); this.send(r.id, '');
    },
    showPass(on, name) { $('onPassRow').hidden = !on; if (on) { if (name) $('onPassLabel').textContent = 'Senha de “' + name + '”'; $('onPass').focus(); } },
    async join() {
      const r = this.rooms.find(x => x.id === this.selected), pass = $('onPass').value || '';
      if (!r) return this.error('Escolha uma sala na lista.'); if (!pass) return this.error('Digite a senha da sala.');
      this.send(r.id, pass);
    },
    async send(id, pass) {
      if (!(await this.ensure())) return; Net.send({ t: 'name', name: this.name() }); Net.send({ t: 'spec', spec: Custom.spec }); Net.send({ t: 'join', id, password: pass });
    },
    async create() {
      const name = ($('onRoomName').value || '').trim(), pass = $('onRoomPass').value || '';
      if (!name) return this.error('Dê um nome para a sala.');
      if (pass && pass.length < 3) return this.error('A senha precisa ter pelo menos 3 caracteres (ou deixe em branco para sala pública).');
      if (!(await this.ensure())) return; Net.send({ t: 'name', name: this.name() }); Net.send({ t: 'spec', spec: Custom.spec });
      Net.send({ t: 'create', name, password: pass, mode: CFG.CUP_ENABLED === true ? $('onMode').value : 'single', max: +$('onMax').value, track: +$('onTrack').value, laps: +$('onLaps').value });
    },
    // ---------- sala de espera ----------
    enterLobby(room, resumed) {
      // de volta após uma queda no meio da corrida: continua onde está, só atualiza a sala
      if (resumed && Game.online && Game.scene) { this.renderLobby(room); return; }
      UI.closeModal(true); try { localStorage.setItem(KEY(), this.name()); } catch (e) { }
      if (Game.state === 'menu' || Game.state === 'garage' || Game.state === 'lobby') { Game.state = 'lobby'; UI.screen('lobby'); Showroom.setRig('menu'); }
      this.renderLobby(room); UI.toast(resumed ? 'De volta à sala ' + room.name : 'Você entrou na sala ' + room.name, 1600);
    },
    toLobby() {
      UI.transition(() => { Podium.stop(); Game.online = null; Game.dispose(); Game.state = 'lobby'; UI.screen('lobby'); Showroom.setRig('menu'); this.renderLobby(Net.room); });
    },
    renderLobby(r) {
      if (!r) return; Net.room = r;
      const cup = r.mode === 'cup';
      $('lobbyName').textContent = r.name; $('lobbyEyebrow').textContent = 'Sala online · ' + (r.locked ? 'com senha' : 'pública') + ' · ' + (cup ? CFG.CUP.name : 'Corrida única');
      const host = r.host === Net.id, ul = $('lobbyPlayers'); ul.innerHTML = '';
      r.players.forEach(p => {
        const li = document.createElement('li'); li.className = (p.id === Net.id ? 'me ' : '') + (p.ready || p.id === r.host ? 'ready' : '');
        li.innerHTML = '<i style="background:' + esc(p.spec.color) + '"></i><span class="pn">' + esc(p.name) + (p.id === Net.id ? ' <small>(você)</small>' : '') + '</span>' +
          (p.id === r.host ? '<span class="tag host">' + Icon.svg('crown') + ' anfitrião</span>' : '<span class="tag ' + (p.ready ? 'ok' : '') + '">' + (p.ready ? Icon.svg('check') + ' pronto' : 'esperando') + '</span>') +
          '<span class="ping">' + (p.away ? 'reconectando…' : (p.ping ? p.ping + ' ms' : '')) + '</span>';
        if (host && p.id !== Net.id) { const k = document.createElement('button'); k.type = 'button'; k.className = 'kick'; k.innerHTML = Icon.svg('close'); k.title = 'Remover ' + p.name; k.addEventListener('click', () => Net.send({ t: 'kick', id: p.id })); li.appendChild(k); }
        ul.appendChild(li);
      });
      const free = r.max - r.players.length; if (free > 0) { const li = document.createElement('li'); li.className = 'free'; li.innerHTML = '<i></i><span class="pn">' + free + (free > 1 ? ' vagas livres' : ' vaga livre') + '</span>'; ul.appendChild(li); }
      $('lobbyMode').value = cup ? 'cup' : 'single'; $('lobbyTrackField').hidden = cup;
      $('lobbyTrack').value = r.track; $('lobbyLaps').value = r.laps; $('lobbyTrack').disabled = $('lobbyLaps').disabled = $('lobbyMode').disabled = !host;
      $('lobbyStart').textContent = cup ? 'Iniciar Copa' : 'Iniciar corrida';
      const others = r.players.filter(p => p.id !== r.host), allReady = others.every(p => p.ready);
      $('lobbyStart').hidden = !host; $('lobbyReady').hidden = host;
      $('lobbyStart').disabled = !allReady || r.state !== 'lobby';
      const me = this.me(); $('lobbyReady').textContent = me && me.ready ? 'Cancelar pronto' : 'Estou pronto'; $('lobbyReady').classList.toggle('on', !!(me && me.ready));
      $('lobbyHint').textContent = r.state !== 'lobby' ? 'Corrida em andamento…' : host ? (others.length ? (allReady ? 'Todos prontos: pode largar!' : 'Esperando todos marcarem "pronto".') : (r.locked ? 'Passe o nome da sala e a senha para os amigos.' : 'Os amigos acham a sala buscando pelo nome.') + ' Você também pode correr sozinho para testar.') : 'Marque "pronto" e espere o anfitrião largar.';
    },
    // ---------- sair / Esc ----------
    leave(force) {
      const racing = Game.online && ['waiting', 'countdown', 'race', 'finish'].includes(Game.state);
      if (racing && !force) { if (window.Pause) Pause.open(); return; }          // nunca sai direto da corrida: abre a Pausa
      Net.send({ t: 'leave' }); Net.room = null; Net.forget(); Game.leaveOnline(true);
    },
    escape() {
      if (Game.state === 'lobby') { this.leave(true); return; }
      if (Game.state === 'podium') { this.toLobby(); return; }
      if (Game.state === 'round') { UI.toast('A próxima pista da Copa começa sozinha', 1800); return; }
      if (window.Pause && Pause.can()) Pause.open();
    },
    async onDrop() {
      if (!Net.room) return;
      const w = await Net.reconnect(s => this.banner('Conexão perdida · reconectando… ' + s + ' s'));
      this.banner('');
      if (w && w.resumed) UI.toast('Reconectado!', 1500);
      else { UI.toast('Não foi possível voltar em 15 s: você saiu da sala.', 3800); Net.room = null; Net.forget(); Game.leaveOnline(true); }
    }
  };
  window.Online = Online;
})();
