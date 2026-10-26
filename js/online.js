// =====================================================================================
// online.js — telas do modo online (criar/entrar em sala com senha, sala de espera) e eventos da rede
// O jogo em si (karts de rede, envio de estado, colisões) fica no main.js; a conexão, no net.js.
// =====================================================================================
(function () {
  const $ = id => document.getElementById(id);
  const KEY = () => CFG.STORAGE + ':name';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const Online = {
    tab: 'join', selected: null, escAt: 0,
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
      [['onPass', () => this.join()], ['onCode', () => $('onPass').focus()], ['onRoomPass', () => this.create()], ['onRoomName', () => $('onRoomPass').focus()]].forEach(([id, fn]) =>
        $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fn(); } }));
      $('onName').addEventListener('change', () => { const n = this.name(); try { localStorage.setItem(KEY(), n); } catch (e) { } if (Net.connected) Net.send({ t: 'name', name: n }); });
      $('lobbyReady').addEventListener('click', () => { const me = this.me(); Net.send({ t: 'ready', v: !(me && me.ready) }); UI.Sfx.tone(660, 990, 0.08, 'square', 0.06); });
      $('lobbyStart').addEventListener('click', () => { Net.send({ t: 'start' }); });
      $('lobbyLeave').addEventListener('click', () => this.leave(true));
      $('lobbyTrack').addEventListener('change', e => Net.send({ t: 'settings', track: +e.target.value }));
      $('lobbyLaps').addEventListener('change', e => Net.send({ t: 'settings', laps: +e.target.value }));
      $('lobbyCode').addEventListener('click', () => { const c = Net.room && Net.room.id; if (!c) return; (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(() => UI.toast('Código ' + c + ' copiado'), () => UI.toast('Código da sala: ' + c, 2500)); });
      // visual do kart muda na garagem -> os outros veem na hora
      Custom.onChange(() => { if (Net.connected) Net.send({ t: 'spec', spec: Custom.spec }); });
      // eventos da rede
      Net.on('rooms', m => this.renderRooms(m.rooms));
      Net.on('joined', m => this.enterLobby(m.room));
      Net.on('room', m => this.renderLobby(m.room));
      Net.on('error', m => this.error(m.msg));
      Net.on('notice', m => UI.toast(m.msg, 1800));
      Net.on('prepare', m => { UI.closeModal(true); Game.onlinePrepare(m); });
      Net.on('go', m => Game.onlineGo(m));
      Net.on('finished', m => Game.onlineFinished(m));
      Net.on('left', m => { if (Game.online) Game.onlineLeft(m.id); });
      Net.on('results', m => Game.onlineResults(m.rows));
      Net.on('bump', m => Game.netBump(m));
      Net.on('kicked', () => { Net.room = null; UI.toast('Você foi removido da sala', 2500); Game.leaveOnline(true); });
      Net.on('drop', () => this.onDrop());
    },
    name() { return ($('onName').value || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Piloto'; },
    me() { return Net.room && Net.room.players.find(p => p.id === Net.id); },
    status(t, cls) { const e = $('onStatus'); e.textContent = t; e.className = 'netStatus ' + (cls || ''); },
    error(t) { if (UI.modal === 'onlineModal') { $('onError').textContent = t || ''; } else if (t) UI.toast(t, 2600); },
    setTab(t) { this.tab = t; $('onTabs').querySelectorAll('button').forEach(b => { const on = b.dataset.v === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      $('onJoin').hidden = t !== 'join'; $('onCreate').hidden = t !== 'create'; this.error(''); },
    async open() {
      UI.openModal('onlineModal'); this.error(''); if (!$('onName').value) $('onName').value = 'Piloto ' + (100 + Math.floor(Math.random() * 900));
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
    renderRooms(list) {
      const box = $('onRooms'); box.innerHTML = '';
      if (!list.length) { box.innerHTML = '<p class="empty">Nenhuma sala aberta. Crie a sua na aba ao lado!</p>'; return; }
      list.forEach(r => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'roomItem' + (this.selected === r.id ? ' on' : '') + (r.state !== 'lobby' ? ' busy' : '');
        b.innerHTML = '<span class="lock">🔒</span><span class="rn"><strong>' + esc(r.name) + '</strong><small>' + esc(CFG.TRACKS[r.track] ? CFG.TRACKS[r.track].name : '') + ' · ' + r.laps + (r.laps > 1 ? ' voltas' : ' volta') + (r.state !== 'lobby' ? ' · correndo' : '') + '</small></span><span class="rp">' + r.players + '/' + r.max + '</span><code>' + r.id + '</code>';
        b.addEventListener('click', () => { this.selected = r.id; $('onCode').value = r.id; $('onPass').value = ''; $('onPass').focus(); box.querySelectorAll('.roomItem').forEach(x => x.classList.toggle('on', x === b)); });
        box.appendChild(b);
      });
    },
    async join() {
      const id = ($('onCode').value || '').trim().toUpperCase(), pass = $('onPass').value || '';
      if (!id) return this.error('Escolha uma sala na lista ou digite o código.'); if (!pass) return this.error('Digite a senha da sala.');
      if (!(await this.ensure())) return; Net.send({ t: 'name', name: this.name() }); Net.send({ t: 'spec', spec: Custom.spec }); Net.send({ t: 'join', id, password: pass });
    },
    async create() {
      const name = ($('onRoomName').value || '').trim(), pass = $('onRoomPass').value || '';
      if (!name) return this.error('Dê um nome para a sala.'); if (pass.length < 3) return this.error('A senha precisa ter pelo menos 3 caracteres.');
      if (!(await this.ensure())) return; Net.send({ t: 'name', name: this.name() }); Net.send({ t: 'spec', spec: Custom.spec });
      Net.send({ t: 'create', name, password: pass, max: +$('onMax').value, track: +$('onTrack').value, laps: +$('onLaps').value });
    },
    // ---------- sala de espera ----------
    enterLobby(room) {
      UI.closeModal(true); try { localStorage.setItem(KEY(), this.name()); } catch (e) { }
      if (Game.state === 'menu' || Game.state === 'garage' || Game.state === 'lobby') { Game.state = 'lobby'; UI.screen('lobby'); Showroom.setRig('menu'); }
      this.renderLobby(room); UI.toast('Você entrou na sala ' + room.name, 1600);
    },
    toLobby() {
      UI.transition(() => { Podium.stop(); Game.online = null; Game.dispose(); Game.state = 'lobby'; UI.screen('lobby'); Showroom.setRig('menu'); this.renderLobby(Net.room); });
    },
    renderLobby(r) {
      if (!r) return; Net.room = r;
      $('lobbyName').textContent = r.name; $('lobbyCode').textContent = '#' + r.id;
      const host = r.host === Net.id, ul = $('lobbyPlayers'); ul.innerHTML = '';
      r.players.forEach(p => {
        const li = document.createElement('li'); li.className = (p.id === Net.id ? 'me ' : '') + (p.ready || p.id === r.host ? 'ready' : '');
        li.innerHTML = '<i style="background:' + esc(p.spec.color) + '"></i><span class="pn">' + esc(p.name) + (p.id === Net.id ? ' <small>(você)</small>' : '') + '</span>' +
          (p.id === r.host ? '<span class="tag host">👑 anfitrião</span>' : '<span class="tag ' + (p.ready ? 'ok' : '') + '">' + (p.ready ? '✔ pronto' : 'esperando') + '</span>') +
          '<span class="ping">' + (p.away ? 'reconectando…' : (p.ping ? p.ping + ' ms' : '')) + '</span>';
        if (host && p.id !== Net.id) { const k = document.createElement('button'); k.type = 'button'; k.className = 'kick'; k.textContent = '✕'; k.title = 'Remover ' + p.name; k.addEventListener('click', () => Net.send({ t: 'kick', id: p.id })); li.appendChild(k); }
        ul.appendChild(li);
      });
      const free = r.max - r.players.length; if (free > 0) { const li = document.createElement('li'); li.className = 'free'; li.innerHTML = '<i></i><span class="pn">' + free + (free > 1 ? ' vagas livres' : ' vaga livre') + '</span>'; ul.appendChild(li); }
      $('lobbyTrack').value = r.track; $('lobbyLaps').value = r.laps; $('lobbyTrack').disabled = $('lobbyLaps').disabled = !host;
      const others = r.players.filter(p => p.id !== r.host), allReady = others.every(p => p.ready);
      $('lobbyStart').hidden = !host; $('lobbyReady').hidden = host;
      $('lobbyStart').disabled = !allReady || r.state !== 'lobby';
      const me = this.me(); $('lobbyReady').textContent = me && me.ready ? 'Cancelar pronto' : 'Estou pronto'; $('lobbyReady').classList.toggle('on', !!(me && me.ready));
      $('lobbyHint').textContent = r.state !== 'lobby' ? 'Corrida em andamento…' : host ? (others.length ? (allReady ? 'Todos prontos: pode largar!' : 'Esperando todos marcarem "pronto".') : 'Passe o código e a senha para os amigos. Você também pode correr sozinho para testar.') : 'Marque "pronto" e espere o anfitrião largar.';
    },
    // ---------- sair / Esc ----------
    leave(force) {
      const racing = Game.online && ['waiting', 'countdown', 'race', 'finish'].includes(Game.state);
      if (racing && !force) { this.escape(); return; }
      Net.send({ t: 'leave' }); Net.room = null; Game.leaveOnline(true);
    },
    escape() {
      if (Game.state === 'lobby') { this.leave(true); return; }
      if (Game.state === 'podium') { this.toLobby(); return; }
      const t = performance.now();
      if (t - this.escAt < 2500) { this.leave(true); return; }
      this.escAt = t; UI.toast('Pressione Esc (ou Menu) de novo para sair da corrida online', 2400);
    },
    async onDrop() {
      if (!Net.room) return;
      UI.toast('Conexão perdida. Reconectando…', 3000);
      const w = await Net.reconnect();
      if (w && w.resumed) UI.toast('Reconectado!', 1500);
      else { UI.toast(w ? 'O servidor reiniciou e a sala foi encerrada. Crie ou entre numa sala de novo.' : 'Não foi possível reconectar ao servidor.', 3800); Net.room = null; Game.leaveOnline(true); }
    }
  };
  window.Online = Online;
})();
