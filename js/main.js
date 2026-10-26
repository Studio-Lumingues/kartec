// =====================================================================================
// main.js — inicialização do Three.js, ambiente (céu, ciclo dia/noite, sombras, lens flare),
// câmeras, gerenciador de estados e laço principal.
// Fluxo: boot (carrega o piloto) -> intro (abertura + logo) -> menu <-> garagem
//        menu -> modal "Preparar corrida" -> largada -> corrida -> chegada -> (rodada da Copa) -> pódio
// =====================================================================================
(function () {
  const $ = id => document.getElementById(id);
  const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

  // ---------------- renderizador e câmera ----------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;   // PCF simples: bem mais leve que o Soft
  document.body.prepend(renderer.domElement);
  TX.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  KartMats.initEnv(renderer);                     // reflexo de estúdio para a pintura e os cromados
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 1.5, CFG.CAMERA_FAR || 2300);
  renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); console.warn('contexto WebGL perdido — aguardando restauração'); });
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

  // ================================ AMBIENTE ================================
  const dnC = h => new THREE.Color(h);
  // paleta de céu "de festa": dia azul-piscina, entardecer rosa/laranja, noite roxa (nunca preta)
  const DN = { // [noite, crepúsculo, dia]
    top: [dnC(0x1c1654), dnC(0x5a3aa8), dnC(0x3a8dff)], mid: [dnC(0x2c2670), dnC(0xff7eb6), dnC(0x7fd8ff)], hor: [dnC(0x45408a), dnC(0xffb36b), dnC(0xcdf3ff)],
    sun: [dnC(0xa8b4ff), dnC(0xff9a52), dnC(0xfff0c8)], hS: [dnC(0x5a5aa8), dnC(0xffc0a0), dnC(0xd8f0ff)], hG: [dnC(0x2a3048), dnC(0x8a6a4a), dnC(0x7ab85a)],
    tint: [dnC(0x5a5a9a), dnC(0xffc4b4), dnC(0xffffff)], cloud: [dnC(0x6a68b0), dnC(0xffc0c8), dnC(0xffffff)]
  };
  function dnMix(arr, e, out) { if (e <= -0.2) return out.copy(arr[0]); if (e < 0.05) return out.copy(arr[0]).lerp(arr[1], sm((e + 0.2) / 0.25)); return out.copy(arr[1]).lerp(arr[2], sm((e - 0.05) / 0.3)); }
  const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color(), _c4 = new THREE.Color(), TUN_LIGHT = new THREE.Color(0xffe6bf);

  const Env = {
    dayT: 0.35, nightF: 0, SUNDIR: new THREE.Vector3(0.4, 0.7, 0.3).normalize(),
    build(scene, def) {
      this.scene = scene; this.def = def; this.dayT = def.time;
      this.fogFar = def.fogFar || 820;
      scene.fog = new THREE.Fog(0xdbe9f8, 130, this.fogFar); scene.background = new THREE.Color(0xdbe9f8);
      this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a9a4a, 0.8); scene.add(this.hemi);
      const sun = this.sun = new THREE.DirectionalLight(0xffe2b0, 0.95); scene.add(sun, sun.target);
      const SB = CFG.PERF.SHADOW_BOX; sun.castShadow = true; sun.shadow.mapSize.set(CFG.PERF.SHADOW_MAP, CFG.PERF.SHADOW_MAP);
      Object.assign(sun.shadow.camera, { left: -SB, right: SB, top: SB, bottom: -SB, near: 10, far: 420 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
      // céu (gradiente repintado conforme a hora)
      const skyC = TX.cvs(4, 256); this.skyT = new THREE.CanvasTexture(skyC);
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 12), new THREE.MeshBasicMaterial({ map: this.skyT, side: THREE.BackSide, fog: false, depthWrite: false }));
      this.sky.renderOrder = -2; scene.add(this.sky);
      // estrelas, lua, sol
      const pos = []; for (let i = 0; i < 1100; i++) { const u = Math.random() * 6.2832, y = 0.04 + Math.random() * 0.96, r = Math.sqrt(1 - y * y); pos.push(Math.cos(u) * r * 1250, y * 1250, Math.sin(u) * r * 1250); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })); this.stars.frustumCulled = false; this.stars.renderOrder = -1; scene.add(this.stars);
      this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(TX.canvas('moon')), transparent: true, fog: false, depthWrite: false })); this.moon.scale.setScalar(70); scene.add(this.moon);
      const glow = (c, s, o) => { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: Fx.glowTex(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: o })); p.scale.setScalar(s); scene.add(p); return p; };
      this.sunGlow = glow(0xffe6a0, 380, 0.8); this.sunCore = glow(0xffffff, 110, 1); this.moonGlow = glow(0x9db4ff, 260, 0.35);
      // cordilheira distante (anel com silhueta pintada em canvas)
      const mc = TX.cvs(1024, 128), mg = mc.getContext('2d');
      const tone = def.id === 'beach' ? ['#7fa8c8', '#5f88a8'] : def.id === 'city' ? ['#8a90b8', '#6a6e98'] : ['#8fb4d8', '#5a86b4'];
      [[0, 0.55, tone[0], 9], [1, 0.75, tone[1], 13]].forEach(([k, base, col, n]) => { mg.fillStyle = col; mg.beginPath(); mg.moveTo(0, 128);
        for (let x = 0; x <= 1024; x += 8) { const t = x / 1024 * Math.PI * 2; const y = 128 * base - 34 * Math.abs(Math.sin(t * n / 2 + k)) - 14 * Math.sin(t * n * 1.7 + k * 3); mg.lineTo(x, y); } mg.lineTo(1024, 128); mg.closePath(); mg.fill(); });
      const mt = new THREE.CanvasTexture(mc); mt.wrapS = THREE.RepeatWrapping; mt.repeat.x = 2;
      this.mountains = new THREE.Mesh(new THREE.CylinderGeometry(1150, 1150, def.id === 'beach' ? 90 : 160, 48, 1, true), new THREE.MeshBasicMaterial({ map: mt, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }));
      this.mountains.renderOrder = -1; scene.add(this.mountains);
      // nuvens
      this.cloudM = new THREE.SpriteMaterial({ map: (() => { const c = TX.cvs(128, 64), g = c.getContext('2d'); [[40, 40, 26], [70, 30, 30], [96, 42, 22], [60, 46, 24]].forEach(([x, y, r]) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 64); }); return new THREE.CanvasTexture(c); })(), transparent: true, fog: false, depthWrite: false, opacity: 0.9 });
      this.clouds = []; for (let i = 0; i < 16; i++) { const s = new THREE.Sprite(this.cloudM); const a = Math.random() * 6.28, r = 500 + Math.random() * 500; s.position.set(Math.cos(a) * r, 140 + Math.random() * 120, Math.sin(a) * r); s.scale.set(160 + Math.random() * 120, 70, 1); scene.add(s); this.clouds.push(s); }
      this.paintT = 0; this.occ = []; this.flOcc = 1; this.flT = 0; this.flVis = 0;
    },
    paintSky() {
      const c = this.skyT.image, g = c.getContext('2d'), r = g.createLinearGradient(0, 0, 0, 256);
      r.addColorStop(0, '#' + _c1.getHexString()); r.addColorStop(0.3, '#' + _c1.clone().lerp(_c2, 0.5).getHexString()); r.addColorStop(0.44, '#' + _c2.getHexString());
      r.addColorStop(0.5, '#' + _c3.getHexString()); r.addColorStop(1, '#' + _c3.getHexString()); g.fillStyle = r; g.fillRect(0, 0, 4, 256); this.skyT.needsUpdate = true;
    },
    step(dt, focus, track, karts) {
      const a0 = this.dayT * 6.2832, e0 = -Math.cos(a0);
      this.dayT = (this.dayT + dt / 240 * (e0 < -0.15 ? 2 : 1)) % 1;            // 4 min por dia; a noite passa 2x mais rápido
      const a = this.dayT * 6.2832; this.SUNDIR.set(Math.sin(a) * 0.85, -Math.cos(a), 0.45).normalize();
      const e = this.SUNDIR.y; this.nightF = sm((0.08 - e) / 0.28);
      dnMix(DN.top, e, _c1); dnMix(DN.mid, e, _c2); dnMix(DN.hor, e, _c3);
      this.paintT -= dt; if (this.paintT <= 0) { this.paintSky(); this.paintT = 0.15; }
      this.scene.fog.color.copy(_c3); this.scene.background.copy(_c3);
      const sunI = 0.95 * sm((e + 0.02) / 0.32), moonI = 0.32 * sm((-e - 0.02) / 0.25), sun = this.sun;
      sun.target.position.copy(focus);
      if (sunI >= moonI) { sun.position.copy(focus).addScaledVector(this.SUNDIR, 200); sun.intensity = sunI; dnMix(DN.sun, e, sun.color); }
      else { sun.position.copy(focus).addScaledVector(this.SUNDIR, -200); sun.intensity = moonI; sun.color.set(0x9db4ff); }
      // dentro do túnel a luz do céu cai (suave nas bocas) e os faróis acendem
      const P0 = window.Game && Game.player, shade = track && track.shadeAt && P0 ? track.shadeAt(focus, P0.idx) : 0; this.shade = shade;
      sun.intensity *= 1 - 0.6 * shade;
      sun.castShadow = sun.intensity > 0.08;
      this.hemi.intensity = (0.32 + 0.48 * sm((e + 0.15) / 0.45)) * (1 - 0.45 * shade); dnMix(DN.hS, e, this.hemi.color); dnMix(DN.hG, e, this.hemi.groundColor);
      // dentro do túnel: as luminárias do teto viram uma luz ambiente quente e moderada (nem breu à noite, nem clarão de dia)
      if (shade > 0.01) { this.hemi.intensity = Math.max(this.hemi.intensity, 0.55 * shade); this.hemi.color.lerp(TUN_LIGHT, 0.7 * shade); }
      dnMix(DN.tint, e, _c4); this.mountains.material.color.copy(_c4); dnMix(DN.cloud, e, this.cloudM.color);
      const cp = camera.position;
      this.sky.position.copy(cp); this.stars.position.copy(cp); this.stars.material.opacity = this.nightF * 0.95; this.stars.rotation.y = this.dayT * 1.2;
      this.mountains.position.set(cp.x * 0.9, (this.def.id === 'beach' ? 25 : 60), cp.z * 0.9);
      const sv = sm((e + 0.12) / 0.2); this.sunGlow.material.opacity = 0.8 * sv; this.sunCore.material.opacity = sv; dnMix(DN.sun, e, this.sunGlow.material.color);
      this.sunGlow.position.copy(cp).addScaledVector(this.SUNDIR, 1300); this.sunCore.position.copy(this.sunGlow.position);
      this.moon.position.copy(cp).addScaledVector(this.SUNDIR, -1250); this.moonGlow.position.copy(this.moon.position);
      const mv = sm((-e + 0.12) / 0.2); this.moon.material.opacity = mv; this.moonGlow.material.opacity = 0.35 * mv;
      this.clouds.forEach((s, i) => { s.position.x += dt * (3 + i % 3); if (s.position.x - cp.x > 1000) s.position.x -= 2000; });
      // luzes da pista e janelas acendem à noite
      if (track) {
        track.lamps.forEach(h => { const k = h.userData.lampScale || 1, o = h.userData.lampOpacity || 1; h.material.opacity = (0.3 + 0.7 * this.nightF) * o; h.scale.setScalar(k * (9 + 10 * this.nightF)); });   // halos do túnel usam escala reduzida
        track.nightMats.forEach(n => n.m.emissiveIntensity = (n.min || 0) + (n.max - (n.min || 0)) * this.nightF);
      }
      (karts || []).forEach(k => k.setNight(Math.max(this.nightF, track && track.shadeAt ? track.shadeAt(k.pos, k.idx) : 0)));
      UI.clock(this.dayT, this.nightF);
      this.flare(dt);
    },
    // ---- lens flare: camadas HTML na linha sol -> centro da tela ----
    initFlare() {
      const FLD = this.FLD = [
        [0, 340, 'radial-gradient(circle,rgba(255,250,225,.75) 0%,rgba(255,226,160,.28) 25%,rgba(255,200,120,0) 62%)'],
        [0, 620, 'linear-gradient(90deg,rgba(255,220,160,0),rgba(255,236,190,.45) 50%,rgba(255,220,160,0))', 'streak'],
        [0.32, 46, 'radial-gradient(circle,rgba(160,255,200,.32),rgba(160,255,200,0) 70%)', 'hex'],
        [0.62, 96, 'radial-gradient(circle,rgba(255,170,110,.20),rgba(255,170,110,.08) 60%,rgba(255,170,110,0) 72%)'],
        [0.95, 24, 'radial-gradient(circle,rgba(255,255,255,.55),rgba(255,255,255,0) 70%)'],
        [1.25, 70, 'radial-gradient(circle,rgba(120,180,255,.24),rgba(120,180,255,0) 70%)', 'hex'],
        [1.5, 170, 'radial-gradient(circle,rgba(255,255,255,0) 58%,rgba(200,230,255,.22) 64%,rgba(255,255,255,0) 70%)'],
        [1.85, 60, 'radial-gradient(circle,rgba(255,120,240,.22),rgba(255,120,240,0) 70%)', 'hex']];
      const el = $('flare');
      this.flDivs = FLD.map(f => { const d = document.createElement('div'); d.style.width = f[1] + 'px'; d.style.height = (f[3] === 'streak' ? 7 : f[1]) + 'px'; d.style.background = f[2];
        if (f[3] === 'hex') { d.style.borderRadius = '0'; d.style.clipPath = 'polygon(25% 5%,75% 5%,100% 50%,75% 95%,25% 95%,0 50%)'; } if (f[3] === 'streak') d.style.borderRadius = '4px'; el.appendChild(d); return d; });
    },
    // o sol é bloqueado por esferas aproximadas (árvores, prédios, montanhas): teste barato, sem raycast em malhas
    setBlockers(list) { this.occ = list || []; },
    flare(dt) {
      if (!this.flDivs) return;
      const sp = camera.position.clone().addScaledVector(this.SUNDIR, 1000), ndc = sp.project(camera);
      const inView = ndc.z < 1 && Math.abs(ndc.x) < 1.25 && Math.abs(ndc.y) < 1.25;
      this.flT -= dt;
      if (inView && this.flT <= 0) { this.flT = 0.12; const o = camera.position, d = this.SUNDIR; let hit = 0;
        for (const b of this.occ) { const ox = b.x - o.x, oy = b.y - o.y, oz = b.z - o.z, t = ox * d.x + oy * d.y + oz * d.z; if (ox * ox + oy * oy + oz * oz < b.r * b.r) { hit = 1; break; } if (t < 0 || t > 900) continue; if (ox * ox + oy * oy + oz * oz - t * t < b.r * b.r) { hit = 1; break; } }
        this.flOcc = 1 - hit; }
      const edge = Math.max(0, 1 - Math.max(Math.abs(ndc.x), Math.abs(ndc.y)) * 0.8);
      const target = inView && (Game.state === 'race' || Game.state === 'countdown' || Game.state === 'finish') ? this.flOcc * edge * sm((this.SUNDIR.y - 0.03) / 0.12) * (1 - this.nightF) : 0;
      this.flVis += (target - this.flVis) * Math.min(1, 8 * dt);
      if (this.flVis < 0.01) { this.flDivs.forEach(d => d.style.opacity = 0); return; }
      const W_ = innerWidth, H_ = innerHeight, sx = (ndc.x * 0.5 + 0.5) * W_, sy = (-ndc.y * 0.5 + 0.5) * H_, cx = W_ / 2, cy = H_ / 2;
      this.FLD.forEach((f, k) => { const d = this.flDivs[k], x = sx + (cx - sx) * f[0], y = sy + (cy - sy) * f[0]; d.style.transform = 'translate(' + (x - f[1] / 2) + 'px,' + (y - (f[3] === 'streak' ? 3.5 : f[1] / 2)) + 'px)'; d.style.opacity = this.flVis; });
    },
    hideFlare() { if (this.flDivs) this.flDivs.forEach(d => d.style.opacity = 0); }
  };
  window.Env = Env;

  // ================================ JOGO ================================
  const Game = window.Game = {
    state: 'boot', scene: null, track: null, player: null, bot: null, ai: null, race: null,
    spec: null, trackIdx: 0, mode: 'cup', diff: 'normal', cup: null,
    cam: { ang: 0, zoom: 1, yaw: 0, pitch: 0, drag: false, shake: 0 },

    // monta o mundo da pista (descarta o anterior)
    load(trackIdx, opts) {
      this.dispose();
      const def = CFG.TRACKS[trackIdx], scene = this.scene = new THREE.Scene();
      Env.build(scene, def);
      const root = new THREE.Group(); scene.add(root);
      // visual cartum: dentro de Toon.during os materiais da pista viram toon (pisos ficam Lambert, mais leve)
      this.track = Toon.during(() => Tracks.build(def, root));
      this.propStats = Props.build(this.track, def, root);            // cones, pneus e balões de brinquedo
      // agrupa toda a geometria parada por material: de ~1.300 para algumas dezenas de chamadas de desenho
      const st = GEO.mergeByMaterial(root); this.mergeStats = st;
      // preenchimento do mundo até o horizonte (instanciado, em blocos com culling por câmera e por distância)
      this.fill = Toon.during(() => Scenery.build(this.track, def, root, { density: this.lite ? CFG.FILL.LITE_DENSITY : CFG.FILL.DENSITY }));
      Fx.init(scene);
      scene.add(camera); UI.Fairy.build(camera);
      if (opts && opts.online) {
        // ONLINE: os rivais são os outros jogadores (karts de rede: só animam o estado recebido; sem IA)
        const grid = opts.online, me = grid.find(g => g.id === Net.id) || grid[0], others = grid.filter(g => g !== me);
        this.player = new Kart(scene, Object.assign({}, this.spec), { name: 'Você', player: true, events: ev => this.onKartEvent(ev, true) });
        this.player.mapColor = this.spec.color; this.player.netId = Net.id;
        this.rivals = others.map(g => { const k = new Kart(scene, Object.assign({}, g.spec), { name: g.name, events: ev => this.onKartEvent(ev, false) }); k.netId = g.id; k.remote = true; k.mapColor = g.spec.color; k.m.group.add(nameTag(g.name, g.spec.color)); return k; });
        this.karts = [this.player].concat(this.rivals); this.ais = []; this.ai = null; this.bot = this.rivals[0] || null; this.botSpecs = this.rivals.map(k => k.spec);
        this.botColor = this.rivals[0] ? this.rivals[0].mapColor : '#2a5ce8';
        const si = def.startIdx, G = this.track.grid;
        [me].concat(others).forEach((g, i) => { const k = this.karts[i], gg = G[g.slot % G.length]; k.place(this.track, si + gg[0], gg[1]); k.draftS = { t: 0, cool: 0 }; });
        this.karts.forEach(k => k.startProg = k.progress); this.botStartProg = 0;
      } else {
      // dificuldade dos rivais
      const D = CFG.DIFFICULTY[this.diff]; CFG.BOT.SKILL = D.skill; CFG.BOT.RUBBER_MAX = D.rubberMax;
      // 7 rivais com cores diferentes da sua; o visual de cada um é mantido durante a Copa
      const nR = Math.max(1, (CFG.RACERS || 2) - 1), cols = this.rivalColors(this.spec.color, nR);
      this.botColor = cols[0];
      if (!this.botSpecs || this.botSpecs.length !== nR || this.botSpecs.some((b, i) => b.color !== cols[i])) this.botSpecs = cols.map(c => Custom.rivalFor(this.spec, c));
      this.player = new Kart(scene, Object.assign({}, this.spec), { name: 'Você', player: true, events: ev => this.onKartEvent(ev, true) });
      this.player.mapColor = this.spec.color;
      this.rivals = this.botSpecs.map((sp, i) => { const R = CFG.RIVALS[i] || { name: 'Rival ' + (i + 1), top: 0.96 };
        const k = new Kart(scene, Object.assign({}, sp), { name: R.name, events: ev => this.onKartEvent(ev, false) }); k.skill = R.top; k.mapColor = sp.color; return k; });
      this.karts = [this.player].concat(this.rivals);
      this.bot = this.rivals[0]; this.botSpec = this.botSpecs[0];                 // compatibilidade com código antigo
      this.ais = this.rivals.map(k => new Bot(k, this.track)); this.ai = this.ais[0];
      // grid de 8 vagas (config em metros): o jogador larga em CFG.PLAYER_SLOT
      const si = def.startIdx, G = this.track.grid, ps = Math.min(CFG.PLAYER_SLOT || 0, G.length - 1); let gi = 0;
      this.karts.forEach(k => { const slot = k === this.player ? ps : (gi === ps ? ++gi : gi); if (k !== this.player) gi++; const g = G[slot % G.length]; k.place(this.track, si + g[0], g[1]); k.draftS = { t: 0, cool: 0 }; });
      this.karts.forEach(k => k.startProg = k.progress);
      this.botStartProg = this.bot.progress;
      }
      UI.Mini.build(this.track, { player: this.spec.color, bot: this.botColor });
      Env.setBlockers(this.track.blockers);
      this.cam.ang = this.player.ang; this.cam.yaw = 0; this.cam.pitch = 0;
      this.wrongT = 0;
      if (this.lite) this.setLite(true);
    },
    dispose() {
      if (!this.scene) return;
      this.scene.remove(camera);
      (this.karts || []).forEach(k => k && !k._handedOff && k.m.pilot && k.m.pilot.dispose());
      if (this.fill) { this.fill.dispose(); this.fill = null; }
      const keep = new Set([Fx.glowTex(), Fx.softTex(), Fx.puffTex(), Fx.starTex(), Toon.gradient()]);
      if (this.player) this.player.m.group.traverse(o => { if (o.material && o.material.map) keep.add(o.material.map); if (o.material && o.material.userData.decalUniforms) keep.add(o.material.userData.decalUniforms.uDecal.value); });
      (this.rivals || []).forEach(b => b.m.group.traverse(o => { if (o.material && o.material.userData && o.material.userData.decalUniforms) keep.add(o.material.userData.decalUniforms.uDecal.value); }));
      [Pilot.tpl && Pilot.tpl.map, Pilot.tpl && Pilot.tpl.normalMap, KartMats.tread(false), KartMats.tread(true)].forEach(t => t && keep.add(t));
      this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        ms.forEach(m => { ['map', 'emissiveMap'].forEach(k => { if (m[k] && !keep.has(m[k])) m[k].dispose(); }); m.dispose(); }); });
      this.scene = null; this.track = null; this.player = this.bot = null; this.karts = []; this.rivals = []; this.ais = [];
    },
    // n cores bem diferentes da cor do jogador (as mais contrastantes primeiro)
    rivalColors(hex, n) {
      const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl);
      const score = h => { const o = {}; new THREE.Color(h).getHSL(o); const dh = Math.min(Math.abs(o.h - hsl.h), 1 - Math.abs(o.h - hsl.h)); return dh * 2 + Math.abs(o.l - hsl.l); };
      const list = CFG.KART_COLORS.map(k => k.hex).filter(h => h.toLowerCase() !== hex.toLowerCase()).sort((a, b) => score(b) - score(a));
      const first = this.botColorFor(hex), out = [first].concat(list.filter(h => h !== first));
      while (out.length < n) out.push(out[out.length % list.length]);
      return out.slice(0, n);
    },
    botColorFor(hex) {
      const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl);
      const opts = CFG.KART_COLORS.map(k => k.hex).filter(h => { const o = {}; new THREE.Color(h).getHSL(o); const dh = Math.min(Math.abs(o.h - hsl.h), 1 - Math.abs(o.h - hsl.h)); return dh > 0.18 || Math.abs(o.l - hsl.l) > 0.3; });
      return opts[0] || '#2a5ce8';
    },
    onKartEvent(ev, isPlayer) {
      if (ev === 'bump' && isPlayer) this.cam.shake = Math.min(0.6, this.cam.shake + 0.35);
      if (!isPlayer) return;
      const S = UI.Sfx;
      if (ev === 'boost' || ev === 'miniTurbo') S.boost();
      else if (ev === 'bump') S.bump(); else if (ev === 'land') S.land(); else if (ev === 'driftStart') S.drift(); else if (ev === 'coin') S.coin();
      else if (ev === 'lap' && this.state === 'race') {
        const l = this.player.lap;
        if (l === CFG.LAPS) { UI.toast('Última volta!', 1800); S.lap(); } else if (l > 1 && l <= CFG.LAPS) { UI.toast('Volta ' + l, 1200); S.lap(); }
      }
    },

    // ---------------- fluxo de telas ----------------
    // abertura (depois do carregamento)
    toIntro() {
      this.state = 'intro'; UI.screen('intro');
      Intro.start(Object.assign({}, Custom.spec));
    },
    // menu principal. fromIntro: a logo desliza da abertura para o canto; da corrida: cortina
    toMenu(fromIntro) {
      const go = () => {
        this.state = 'menu'; UI.screen('menu'); UI.Fairy.hide(); UI.countNum(''); Env.hideFlare(); Podium.stop(); this.dispose(); this.cup = null;
        $('signal').hidden = true; Showroom.setRig('menu'); UI.menuKart(Custom.spec); if (Intro.karts) Intro.dispose();
      };
      if (fromIntro === true || this.state === 'garage' || this.state === 'menu') go(); else UI.transition(go);
    },
    // garagem: mesma vitrine 3D, a câmera desliza para o rig da garagem
    toGarage() {
      this.state = 'garage'; UI.screen('garage'); Showroom.setRig('garage'); Garage.loadThumbs();
    },
    newGame() {
      this.mode = UI.mode; this.diff = UI.diff; this.trackIdx = UI.trackIdx; CFG.LAPS = UI.laps;
      this.spec = Object.assign({}, Custom.spec); this.botSpec = null;
      UI.transition(() => {
        if (this.mode === 'cup') { this.cup = { round: 0, results: [] }; this.startRace(CFG.CUP.order[0]); }
        else { this.cup = null; this.startRace(this.trackIdx); }
      });
    },
    startRace(trackIdx) {
      this.curTrack = trackIdx; this.load(trackIdx);
      UI.screen('race'); this.state = 'countdown'; this.cd = { t: 0, step: 0, early: false };
      this.race = { time: 0, endT: 0, position: k => this.racePos(k) };
      $('signal').hidden = false; UI.countNum(''); UI.Fairy.show();
      UI.cupInfo(this.cup ? CFG.CUP.name + ' · ' + (this.cup.round + 1) + '/3' : '');
      UI.toast(CFG.TRACKS[trackIdx].name, 1800);
      $('help').classList.remove('fade'); clearTimeout(this._hf); this._hf = setTimeout(() => $('help').classList.add('fade'), 9000);
    },
    racePos(k) {
      const ks = this.karts, score = x => x.finished ? 1e9 - x.finishTime : x.progress;
      return 1 + ks.filter(o => o !== k && score(o) > score(k)).length;
    },
    countdown(dt) {
      const c = this.cd; if (this.online && this.online.startAt) c.t = 3.6 + (Net.serverNow() - this.online.startAt) / 1000; else c.t += dt;
      const marks = [[0.9, '3', 0], [1.8, '2', 0], [2.7, '1', 1], [3.6, 'VAI!', 2]];
      while (c.step < marks.length && c.t >= marks[c.step][0]) {
        const [, txt, lamp] = marks[c.step]; UI.countNum(txt, lamp === 2); UI.Fairy.setLamp(lamp, this.track); UI.Sfx.count(lamp === 2);
        if (c.step === 1 && Input.keys.up) c.early = true;              // acelerou cedo demais: perde a largada turbo
        if (c.step === 3) {
          this.state = 'race';
          if (Input.keys.up && !c.early) { this.player.boostT = 1.0; this.player.speed = CFG.PHYS.MAX * 0.8; UI.Sfx.boost(); UI.toast('Largada turbo!', 1000); }
          if (!this.online) this.rivals.forEach((b, i) => { const good = Math.random() < 0.45; b.boostT = good ? 0.5 : 0; b.speed = CFG.PHYS.MAX * (good ? 0.45 : 0.18 + Math.random() * 0.14); });   // só parte do pelotão acerta a largada turbo
          setTimeout(() => UI.Fairy.leave(), 450); setTimeout(() => { if (this.state !== 'menu') UI.countNum(''); }, 1100);
        }
        c.step++;
      }
    },
    // tempo do bot quando a corrida acaba antes de ele cruzar a linha: estimado pela velocidade média dele
    estTime(B) {
      const tr = this.track; if (B.finished) return { t: B.finishTime, est: false };
      const done = Math.max(1, B.progress - B.startProg), left = Math.max(0, (CFG.LAPS + 1) * tr.N - B.progress);
      const avg = done / Math.max(1, this.race.time); return { t: this.race.time + left / Math.max(avg, 1), est: true };
    },
    botTime() { return this.estTime(this.bot); },
    endRace() {
      const P = this.player, def = CFG.TRACKS[this.curTrack];
      this.karts.forEach(k => { if (k.m) k.m.group.visible = true; });   // nenhum rival fica escondido na vista orbital / pódio
      const rec = UI.Records.set(def.id, P.finishTime);
      const all = this.karts.map((k, i) => { const e = k === P ? { t: P.finishTime, est: false } : this.estTime(k);
        return { i, name: k.name, color: k.mapColor, spec: k === P ? this.spec : this.botSpecs[i - 1], player: k === P, t: e.t, est: e.est }; });
      if (!this.cup) {
        const rows = all.slice().sort((a, b) => a.t - b.t).map(r => ({ name: r.name, color: r.color, spec: r.spec, player: r.player, kart: this.karts[r.i], a: def.name, b: fmt(r.t), note: r.est ? 'tempo estimado' : '' }));
        UI.transition(() => this.toPodium(rows, false, rec)); return;
      }
      this.cup.results.push({ track: this.curTrack, times: all.map(r => r.t), est: all.map(r => r.est) });
      const tot = all.map((r, i) => this.cup.results.reduce((s, x) => s + x.times[i], 0));
      const rows = all.map((r, i) => ({ name: r.name, color: r.color, spec: r.spec, player: r.player, a: fmt(r.t), b: fmt(tot[i]), tot: tot[i], note: r.est ? 'tempo estimado nesta pista' : '' })).sort((a, b) => a.tot - b.tot);
      const last = this.cup.round === CFG.CUP.order.length - 1, me = rows.findIndex(r => r.player);
      const lead = me === 0 ? 'Você lidera a Copa por ' + (rows[1].tot - rows[0].tot).toFixed(2) + ' s.' : rows[0].name + ' lidera a Copa; você está em ' + (me + 1) + 'º, a ' + (rows[me].tot - rows[0].tot).toFixed(2) + ' s.';
      this.state = 'round'; UI.screen('round'); UI.Fairy.hide(); Env.hideFlare(); $('signal').hidden = true;
      UI.round({ round: this.cup.round + 1, total: CFG.CUP.order.length, trackName: def.name, rows, last, note: (rec ? 'Novo recorde nesta pista! ' : '') + lead });
      this.cupTotals = tot; this.cupAll = all;
    },
    nextRound() {
      if (!this.cup) return;
      if (this.cup.round === CFG.CUP.order.length - 1) {
        const t = this.cupTotals, n = this.cup.results.length;
        const rows = this.cupAll.map((r, i) => ({ name: r.name, color: r.color, spec: r.spec, player: r.player, kart: this.karts && this.karts[i], a: n + ' pistas', b: fmt(t[i]), tot: t[i], note: this.cup.results.some(x => x.est[i]) ? 'inclui tempo estimado' : '' })).sort((a, b) => a.tot - b.tot);
        UI.transition(() => this.toPodium(rows, true, false)); return;
      }
      this.cup.round++; UI.transition(() => this.startRace(CFG.CUP.order[this.cup.round]));
    },
    // tira o modelo do kart da cena da corrida e zera as poses (o pódio passa a ser o dono dele)
    handOff(k) {
      if (!k || !k.m || k._handedOff) return null; const m = k.m; k._handedOff = true;
      if (m.group.parent) m.group.parent.remove(m.group); m.group.visible = true;
      m.group.position.set(0, 0, 0); m.group.rotation.set(0, 0, 0); m.pivot.position.set(0, 0, 0); m.pivot.rotation.set(0, 0, 0);
      m.body.position.set(0, 0, 0); m.body.rotation.set(0, 0, 0); m.body.scale.set(1, 1, 1);
      m.flames.forEach(f => f.visible = false); m.headGlows.forEach(g => g.material.opacity = 0); m.setNight(0);
      if (m.headL) { m.headL.intensity = 0; if (m.headL.parent) m.headL.parent.remove(m.headL); if (m.headL.target && m.headL.target.parent) m.headL.target.parent.remove(m.headL.target); m.headL = null; }
      if (k._outl) k._outl.forEach(o => o.visible = !this.lite);
      return m;
    },
    toPodium(rows, cup, rec) {
      this.state = 'podium'; UI.screen('podium'); UI.podium({ rows, cup }); UI.Fairy.hide(); Env.hideFlare(); $('signal').hidden = true;
      // os karts da corrida vão inteiros para o pódio (mesmos modelos e shaders já compilados: sem travada)
      Podium.start(rows.map(r => ({ name: r.name, color: r.color, spec: r.spec, player: r.player, model: r.kart ? this.handOff(r.kart) : null })));
      this.dispose();
    },

    // ---------------- quadro ----------------
    update(dt) {
      if (this.state === 'boot') return;
      if (this.state === 'intro') { if (Intro.phase === 'film') Intro.step(dt); else { Intro.step(dt); Showroom.step(dt); } UI.Sfx.step(null, false); return; }
      if (this.state === 'menu' || this.state === 'garage' || this.state === 'lobby') { Showroom.step(dt); if (this.state === 'lobby' && Net.connected) Net.tick(); UI.Sfx.step(null, false); return; }
      if (this.state === 'podium') { Podium.step(dt); UI.Sfx.step(null, false); return; }
      const P = this.player, tr = this.track;
      if (this.state === 'round') { this.cam.ang += dt * 0.4; tr.update(dt, performance.now() / 1000); Fx.step(dt); Env.step(dt, P.pos, tr, this.karts); this.orbitCam(); if (this.fill) this.fill.update(dt, camera.position, Env.fogFar); UI.Sfx.step(null, false); return; }
      const racing = this.state === 'race' || this.state === 'finish', ON = this.online;
      if (ON) Net.tick();
      if (this.state === 'countdown') this.countdown(dt);
      if (racing) this.race.time = ON ? Math.max(0, Net.raceTime()) : this.race.time + dt;
      const inP = this.state === 'finish' || this.state === 'waiting' || P.finished ? { up: false, down: false, steer: 0, drift: false } : Input.read();
      const K = this.karts;
      if (ON) {
        // online: o SEU kart roda em tempo real (subpassos de 1/60 s se o quadro demorar) -> mesma velocidade
        // de jogo em qualquer aparelho e tempos de volta comparáveis entre os jogadores
        const real = Math.min(0.1, this.rawDt || dt), n = Math.max(1, Math.ceil(real / (1 / 60) - 1e-6)), h = real / n;
        for (let i = 0; i < n; i++) P.update(h, inP, racing);
        this.netStep(dt, racing);
      } else {
        P.update(dt, inP, racing);
        this.rivals.forEach((k, i) => { const inp = this.ais[i].think(dt, this.karts.filter(o => o !== k), P.progress); if (k.finished) { inp.up = false; inp.drift = false; } k.update(dt, inp, racing); });
        for (let a = 0; a < K.length; a++) for (let b = a + 1; b < K.length; b++) Kart.collidePair(K[a], K[b]);
      }
      if (tr.collectCoins) K.forEach(k => tr.collectCoins(k));
      if (this.state === 'race') { (ON ? [P] : K).forEach(k => this.slipstream(dt, k)); this.wrongWay(dt, P); }
      (ON ? [P] : K).forEach(k => { if (racing && !k.finished && k.lap > CFG.LAPS) { k.finished = true; k.finishTime = this.race.time;
        if (k === P) { const first = this.racePos(P) === 1; UI.toast(first ? 'Vitória!' : 'Chegada! ' + this.racePos(P) + 'º lugar', 2200); UI.Sfx.fanfare(); this.state = 'finish'; this.race.endT = 0;
          if (ON) { Net.send({ t: 'finish', raceId: ON.raceId, time: this.race.time }); setTimeout(() => { if (this.state === 'finish' && this.online) UI.toast('Aguardando os outros pilotos…', 4000); }, 2400); } } } });
      if (this.state === 'finish' && !ON) { this.race.endT += dt; if ((this.rivals.every(b => b.finished) && this.race.endT > 2.5) || this.race.endT > 6) this.endRace(); }
      if (!this.scene || this.state === 'round' || this.state === 'podium') return;   // a corrida acabou neste quadro
      tr.update(dt, performance.now() / 1000);
      Fx.step(dt);
      Env.step(dt, P.pos, tr, this.karts);
      if (this.fill) this.fill.update(dt, camera.position, Env.fogFar);
      this.kartLod(dt);
      UI.Fairy.step(dt, camera);
      UI.hud(P, this.rivals, this.race);
      UI.Sfx.step(P, true);
      this.updateCamera(dt);
    },
    // vácuo: colado atrás do outro por ~1 s = empurrão
    // ---------------- online ----------------
    _ns: {},
    netStep(dt, racing) {
      const O = this.online, P = this.player, t = Net.raceTime(), now = performance.now();
      O.acc += this.rawDt || dt;
      if (now - (O.hudT || 0) > 1000) { O.hudT = now; UI.cupInfo('Online · ' + (Net.room ? Net.room.name : '') + ' · ' + Math.round(Net.rtt) + ' ms'); }
      if (racing && O.acc >= 1 / Net.SEND_HZ) { O.acc = Math.min(O.acc - 1 / Net.SEND_HZ, 1 / Net.SEND_HZ); Net.sendState(P, t); }
      this.rivals.forEach(k => {
        if (Net.sample(k.netId, t, this._ns)) k.applyNet(this._ns, dt);
        else k.pose(dt, 0, false, false, false, k.track.groundAt(k.pos, k.idx, k.ang));   // ainda no grid
        if (!racing || k.gone) return;
        // batida com outro jogador: o seu kart reage na hora; o impulso dele vai pela rede (no máx. ~8x/s por par)
        const res = Kart.resolve(P, k, true, false);
        if (res) { O.hitAt[k.netId] = now;
          if (now - (O.sentAt[k.netId] || 0) > 120 && res.j > 0.4) { O.sentAt[k.netId] = now; Net.send({ t: 'bump', to: k.netId, ix: res.nx * res.j * res.ib, iz: res.nz * res.j * res.ib, lever: res.lb, j: res.j }); } }
      });
    },
    // impulso calculado por outro jogador para o SEU kart (só vale se você não detectou a mesma batida agora)
    netBump(m) {
      const O = this.online, P = this.player; if (!O || !P || (this.state !== 'race' && this.state !== 'finish')) return;
      if (performance.now() - (O.hitAt[m.from] || 0) < 200) return;
      Kart.applyRemoteImpulse(P, m.ix, m.iz, m.lever);
      if (m.j > 3) { this.onKartEvent('bump', true); for (let i = 0; i < 6; i++) Fx.spark(P.pos.x, P.pos.y + 0.8, P.pos.z, (Math.random() - 0.5) * 8, 2 + Math.random() * 4, (Math.random() - 0.5) * 8, 0xffe08a, 0.22, 0.3); }
    },
    // ---- fluxo da corrida online (chamado pelo online.js) ----
    onlinePrepare(prep) {
      this.online = { raceId: prep.raceId, startAt: 0, acc: 0, hitAt: {}, sentAt: {} };
      this.mode = 'online'; this.cup = null; this.trackIdx = prep.track; CFG.LAPS = prep.laps; this.spec = Object.assign({}, Custom.spec);
      UI.transition(() => {
        Podium.stop(); this.curTrack = prep.track; this.load(prep.track, { online: prep.grid });
        UI.screen('race'); this.state = 'waiting'; this.cd = { t: 0, step: 0, early: false };
        this.race = { time: 0, endT: 0, position: k => this.racePos(k) };
        $('signal').hidden = false; UI.countNum(''); UI.Fairy.show(); UI.cupInfo('Online · ' + (Net.room ? Net.room.name : ''));
        UI.toast('Aguardando todos carregarem…', 2500);
        Net.send({ t: 'loaded', raceId: prep.raceId });
      });
    },
    onlineGo(m) {
      if (!this.online || m.raceId !== this.online.raceId) return;
      this.online.startAt = m.startAt; Net.resetRace(m.startAt, m.raceId);
      const go = () => { this.state = 'countdown'; this.cd = { t: 0, step: 0, early: false }; };
      if (this.state === 'waiting') go(); else setTimeout(() => { if (this.state === 'waiting') go(); }, 300);
    },
    onlineFinished(m) { const k = this.rivals && this.rivals.find(x => x.netId === m.id); if (k) { k.finished = true; k.finishTime = m.time; } },
    onlineLeft(id) {
      const k = this.rivals && this.rivals.find(x => x.netId === id); if (!k || !this.scene) return;
      k.gone = true; k.m.group.visible = false; this.scene.remove(k.m.group); Net.remote.delete(id);
      UI.toast(k.name + ' saiu da corrida', 1800);
    },
    onlineResults(rows) {
      if (!this.online) return; const P = this.player;
      const ui = rows.map(r => { const me = r.id === Net.id, k = me ? P : (this.rivals || []).find(x => x.netId === r.id && !x.gone);
        return { name: me ? r.name + ' (você)' : r.name, color: r.spec.color, spec: r.spec, player: me, kart: k, a: '', b: r.time != null ? fmt(r.time) : (r.left ? 'saiu' : 'não terminou') }; });
      UI.transition(() => this.toPodium(ui, false, false));
    },
    leaveOnline(toMenu) { this.online = null; this.mode = UI.mode; if (toMenu) this.toMenu(); },
    // LOD dos karts: o contorno de tinta (casco invertido = metade dos triângulos e das chamadas de desenho de cada
    // kart) só aparece perto da câmera; longe ele mal ocupa pixels. Reavaliado 4x por segundo.
    kartLod(dt) {
      this._lodT = (this._lodT || 0) - dt; if (this._lodT > 0) return; this._lodT = 0.1;
      const cp = camera.position, P = this.player;
      this.karts.forEach(k => {
        if (!k._outl) { k._outl = []; k.m.group.traverse(o => { if (o.material && o.material.userData && o.material.userData.outline) k._outl.push(o); }); }
        const d2 = k.pos.distanceToSquared(cp), near = !this.lite && (k === this.player || d2 < 55 * 55);
        if (k._near !== near) { k._near = near; k._outl.forEach(o => o.visible = near); }
        // rival ENTRE a câmera e o jogador (ex.: largando logo atrás): some por um instante em vez de tapar a visão
        if (k !== this.player) { const px = P.pos.x - cp.x, pz = P.pos.z - cp.z, L = Math.hypot(px, pz) || 1, kx = k.pos.x - cp.x, kz = k.pos.z - cp.z;
          const along = (kx * px + kz * pz) / L, lat = Math.abs(kx * pz - kz * px) / L;
          k.m.group.visible = !(along > -1 && along < L - 1.5 && lat < 3.4) && d2 > 4 * 4; }
      });
    },
    // vácuo: colado atrás de qualquer kart por ~1 s = empurrão (vale para todos os 8)
    slipstream(dt, a) {
      const s = a.draftS, isPlayer = a === this.player; s.cool -= dt;
      if (s.cool > 0 || a.speed < 25 || a.air) { s.t = Math.max(0, s.t - dt * 2); return; }
      const sa = Math.sin(a.ang), ca = Math.cos(a.ang); let behind = false;
      for (const b of this.karts) { if (b === a) continue; const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, fwd = dx * sa + dz * ca;
        if (fwd > 4 && fwd < 18 && Math.abs(dx * ca - dz * sa) < 2.6) { behind = true; break; } }
      if (!behind) { s.t = Math.max(0, s.t - dt * 2); return; }
      s.t += dt;
      if (isPlayer && Math.random() < 0.5) Fx.puff('glow', a.pos.x + (Math.random() - 0.5) * 3, a.pos.y + 1 + Math.random() * 2, a.pos.z + (Math.random() - 0.5) * 3, -sa * 18, 0, -ca * 18, 0xffffff, 0.35, 0.05, 0.25, 0.7);
      if (s.t > 1.1) { a.boostT = Math.max(a.boostT, 0.8); s.t = 0; s.cool = 3; if (isPlayer) { UI.toast('Vácuo!', 900); UI.Sfx.boost(); } }
    },
    wrongWay(dt, k) {
      const t = this.track.T[k.idx], dot = Math.sin(k.ang) * t.x + Math.cos(k.ang) * t.z;
      if (dot < -0.3 && Math.abs(k.speed) > 5) { this.wrongT += dt; if (this.wrongT > 1.2) { UI.toast('Contramão!', 1000); this.wrongT = -1.5; } } else this.wrongT = Math.min(0, this.wrongT + dt);
    },
    orbitCam() {
      const P = this.player, c = this.cam, d = 17;
      camera.position.set(P.pos.x - Math.sin(c.ang) * d, P.pos.y + 6.5, P.pos.z - Math.cos(c.ang) * d); camera.lookAt(P.pos.x, P.pos.y + 1.5, P.pos.z);
    },
    updateCamera(dt) {
      const P = this.player, c = this.cam;
      if (this.state === 'finish') { c.ang += dt * 0.6; this.orbitCam(); return; }
      c.ang += wrapA(P.mvAng - c.ang) * Math.min(1, 5 * dt);
      if (!c.drag) { c.yaw *= Math.max(0, 1 - 2 * dt); c.pitch *= Math.max(0, 1 - 2 * dt); }
      const a = c.ang + c.yaw, dist = (12.5 + Math.abs(P.speed) * 0.04) * c.zoom, h = (5.6 + c.pitch * 8) * c.zoom;
      const tx = P.pos.x - Math.sin(a) * dist, tz = P.pos.z - Math.cos(a) * dist; let ty = Math.max(P.pos.y + h, 1.5);
      const tr = this.track, ceil = tr.ceilingAt ? Math.min(tr.ceilingAt({ x: tx, z: tz }, P.idx), tr.ceilingAt(camera.position, P.idx)) : Infinity;   // túnel: câmera não passa do teto
      ty = Math.min(ty, ceil);
      const k = Math.min(1, 8 * dt); camera.position.x += (tx - camera.position.x) * k; camera.position.z += (tz - camera.position.z) * k; camera.position.y += (ty - camera.position.y) * k;
      if ((this.state === 'countdown' && this.cd.t < 0.05) || this.state === 'waiting') camera.position.set(tx, ty, tz);
      camera.position.y = Math.min(camera.position.y, ceil);
      camera.lookAt(P.pos.x + Math.sin(c.ang) * 4, P.pos.y + 2, P.pos.z + Math.cos(c.ang) * 4);
      if (c.shake > 0.01) { camera.position.x += (Math.random() - 0.5) * c.shake; camera.position.y += (Math.random() - 0.5) * c.shake; c.shake *= Math.max(0, 1 - 6 * dt); }
      const fov = 60 + (P.boostT > 0 ? 9 : 0) + Math.min(6, Math.abs(P.speed) * 0.08);
      camera.fov += (fov - camera.fov) * Math.min(1, 4 * dt); camera.updateProjectionMatrix();
      this.scene.fog.far = Env.fogFar - (P.boostT > 0 ? 80 : 0);
    },
    // modo leve: esconde os contornos (metade dos triângulos dos karts e pilotos) na cena atual e nas próximas
    lite: false,
    setLite(on) { this.lite = on;   // o preenchimento de cenário da PRÓXIMA pista também fica mais leve (CFG.FILL.LITE_DENSITY)
      const f = sc => sc && sc.traverse(o => { if (o.material && o.material.userData && o.material.userData.outline) o.visible = !on; }); f(this.scene); if (on) console.info('[desempenho] modo leve ativado: contornos desligados'); },
    render() {
      if (this.state === 'boot') return;
      if (this.state === 'intro' && Intro.phase === 'film') renderer.render(Intro.scene, Intro.cam);
      else if (this.state === 'intro' || this.state === 'menu' || this.state === 'garage' || this.state === 'lobby') renderer.render(Showroom.scene, Showroom.cam);
      else if (this.state === 'podium') renderer.render(Podium.scene, Podium.camera);
      else if (this.scene) renderer.render(this.scene, camera);
    }
  };
  const fmt = t => UI.fmt(t);
  // etiqueta de nome (online): sprite com o nome do jogador acima do kart dele
  function nameTag(name, color) {
    const c = TX.cvs(256, 64), g = c.getContext('2d');
    g.font = '800 30px ' + CFG.FONT_UI; const w = Math.min(244, g.measureText(name).width + 40);
    g.fillStyle = 'rgba(42,29,74,.82)'; g.beginPath(); g.moveTo(128 - w / 2 + 16, 8); g.arcTo(128 + w / 2, 8, 128 + w / 2, 56, 16); g.arcTo(128 + w / 2, 56, 128 - w / 2, 56, 16); g.arcTo(128 - w / 2, 56, 128 - w / 2, 8, 16); g.arcTo(128 - w / 2, 8, 128 + w / 2, 8, 16); g.closePath(); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(128 - w / 2 + 18, 32, 7, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 128 + 8, 33);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    s.scale.set(6, 1.5, 1); s.position.y = 5.6; s.renderOrder = 5; s.userData.noOutline = true; return s;
  }

  // ---------------- câmera: botão direito gira, roda do mouse aproxima ----------------
  addEventListener('pointerdown', e => { if (e.button === 2) { Game.cam.drag = true; Game.cam.lx = e.clientX; Game.cam.ly = e.clientY; } });
  addEventListener('pointermove', e => { const c = Game.cam; if (!c.drag) return; c.yaw -= (e.clientX - c.lx) * 0.006; c.pitch = Math.max(-0.4, Math.min(1, c.pitch + (e.clientY - c.ly) * 0.004)); c.lx = e.clientX; c.ly = e.clientY; });
  addEventListener('pointerup', e => { if (e.button === 2) Game.cam.drag = false; });
  addEventListener('wheel', e => { if (!Game.scene) return; Game.cam.zoom = Math.max(0.6, Math.min(1.8, Game.cam.zoom * (e.deltaY > 0 ? 1.08 : 0.93))); }, { passive: true });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); Podium.resize(); Showroom.resize(); Intro.resize(); });

  // ---------------- inicialização (espera as fontes para os textos em canvas saírem certos) ----------------
  let started = false;
  function boot() {
    if (started) return; started = true;
    Input.init();
    Custom.load(); Game.spec = Object.assign({}, Custom.spec);
    UI.init({
      onTrack: i => { Game.trackIdx = i; },
      onStart: () => { if (Game.state === 'menu') Game.newGame(); },
      onGarage: () => Game.toGarage(),
      onMenuSoft: () => Game.toMenu(),
      onSetupOpen: () => Showroom.setRig('setup'),
      onSetupClose: () => { if (Game.state === 'menu') Showroom.setRig('menu'); },
      onSkip: () => { if (Game.state === 'intro') Intro.skip(); },
      onNext: () => Game.nextRound(),
      onPlayAgain: () => { if (Online.active()) Online.toLobby(); else Game.newGame(); },
      onMenu: () => { if (Online.active()) Online.leave(); else Game.toMenu(); },
      onEscape: () => { if (Game.state === 'intro') Intro.skip(); else if (Game.online || Game.state === 'lobby') Online.escape(); else if (Game.state === 'garage') Game.toMenu(); else if (Game.state !== 'menu' && Game.state !== 'boot') Game.toMenu(); },
      onRestart: () => { if (Game.online) return; if (Game.state === 'race' || Game.state === 'countdown' || Game.state === 'finish') Game.startRace(Game.curTrack); },
      onNextHour: () => { if (Game.scene && !Game.online) Env.dayT = (Env.dayT + 0.125) % 1; },
      onEnter: () => {
        if (Game.state === 'intro') Intro.skip();
        else if (Game.state === 'menu') UI.openModal('setup');
        else if (Game.state === 'garage') Game.toMenu();
        else if (Game.state === 'podium') { if (Online.active()) Online.toLobby(); else Game.newGame(); }
        else if (Game.state === 'round') Game.nextRound();
      }
    });
    Online.init();
    Podium.build(); Podium.precompile(renderer); Env.initFlare();
    UI.screen('boot'); requestAnimationFrame(loop);
    // carrega o piloto 3D (com barra de progresso); só então monta a vitrine e começa a abertura
    Pilot.load(p => UI.bootProgress(p)).then(ok => {
      UI.bootProgress(1, ok ? 'Pronto!' : 'Piloto 3D indisponível — usando o reserva');
      Showroom.build(renderer); Garage.build(); UI.menuKart(Custom.spec);
      Custom.onChange((id, v, spec) => { Showroom.apply(id, spec); UI.menuKart(spec); });
      setTimeout(() => Game.toIntro(), ok ? 150 : 900);
    });
  }
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(boot); setTimeout(boot, 2500); } else boot();

  // ---------------- laço principal ----------------
  // resolução adaptativa: mede o tempo médio de quadro e ajusta o pixelRatio entre DPR_MIN e DPR_MAX
  let last = performance.now(), errs = 0, dpr = Math.min(devicePixelRatio, 1.25), acc = 0, cnt = 0;
  renderer.setPixelRatio(dpr);
  const safe = (name, fn) => { try { fn(); } catch (e) { if (errs++ < 20) console.error('[' + name + ']', e); } };
  function loop(now) {
    requestAnimationFrame(loop);
    const raw = Math.max(0, (now - last) / 1000) || 0, dt = Math.min(0.05, raw); last = now;
    if (Game.scene) { acc += raw; cnt++;
      if (acc > 2) { const avg = acc / cnt * 1000; acc = 0; cnt = 0;
        const target = avg > 21 ? Math.max(CFG.PERF.DPR_MIN, dpr - 0.15) : avg < 15 ? Math.min(CFG.PERF.DPR_MAX, devicePixelRatio, dpr + 0.1) : dpr;
        if (Math.abs(target - dpr) > 0.01) { dpr = target; renderer.setPixelRatio(dpr); }
        // aparelho muito fraco: já na resolução mínima e ainda lento -> modo leve (sem contornos de tinta)
        else if (avg > 26 && dpr <= CFG.PERF.DPR_MIN + 0.01 && !Game.lite) Game.setLite(true); } }
    Game.rawDt = raw; safe('jogo', () => Game.update(dt));
    if (Game.player && Game.scene && (!isFinite(Game.player.speed) || !isFinite(Game.player.pos.x))) Game.player.respawn();
    if (Game.bot && Game.scene && (!isFinite(Game.bot.speed) || !isFinite(Game.bot.pos.x))) Game.bot.respawn();
    safe('render', () => Game.render());
  }
  window.__kart = { Game, Env, Showroom, Intro, renderer, camera, boot };
})();
