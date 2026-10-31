// =====================================================================================
// config.js — configurações globais do Super Kartec
// Tudo que é "número de ajuste" fica aqui: física, IA, cores, pistas e horário de cada uma.
// Os scripts são clássicos (não módulos) para o projeto rodar até abrindo o index.html direto (file://).
// =====================================================================================
window.CFG = {
  GAME_NAME: 'Super Kartec',
  LAPS: 3,                       // valor atual (o modal de configuração muda antes de cada corrida)
  LAPS_OPTIONS: [1, 2, 3, 4, 5],
  STORAGE: 'super-kartec',       // prefixo das chaves salvas no navegador (recordes, garagem)
  // Copa: pistas em sequência; vence quem somar o MENOR tempo total.
  // CUP_ENABLED = false: Copa desativada ("Em breve") no menu e no online. Para reativar: true + mais pistas em order.
  CUP_ENABLED: false,
  CUP: { name: 'Copa Kartec', order: [0] },
  DIFFICULTY: {
    easy:   { label: 'Fácil',   skill: 0.90,  rubberMax: 1.03 },
    normal: { label: 'Normal',  skill: 0.965, rubberMax: 1.07 },
    hard:   { label: 'Difícil', skill: 0.995, rubberMax: 1.10 }
  },
  // tipografia arredondada usada no jogo todo (DOM e canvas); Google Fonts com alternativas locais
  FONT_DISPLAY: '"Titan One", "Fredoka", "Lilita One", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif',   // gordinha e cartunesca (embutida no style.css)
  FONT_UI: '"Nunito", "Trebuchet MS", Verdana, sans-serif',
  // desempenho: resolução adaptativa (baixa sozinha se o quadro passar de ~20 ms)
  PERF: { DPR_MAX: 1.5, DPR_MIN: 0.7, SHADOW_MAP: 2048, SHADOW_BOX: 95 },
  // acabamento da imagem na corrida (js/postfx.js), sempre no estilo cartoon. POSTFX: false desliga tudo.
  // AO = sombra de contato nos cantos; INK = contorno leve; BLOOM = brilho nas luzes; SAT = saturação (1 = original); CONTRAST; VIGNETTE = cantos da tela
  // SCATTER = luz do sol na névoa (0 desliga); RAYS = raios de sol (0 desliga); SHARPEN = nitidez depois do FXAA (0 desliga)
  GFX: { POSTFX: true, AO: 0.45, INK: 0.25, BLOOM: 0.12, SAT: 1.04, CONTRAST: 0.1, VIGNETTE: 0.08, SCATTER: 1, RAYS: 0.25, SHARPEN: 0.3 },
  // ONLINE: endereço do servidor quando o jogo e o servidor ficam em lugares diferentes
  // (ex.: jogo na Vercel e servidor no Render). Vazio = mesmo endereço da página.
  // Exemplo: 'wss://super-kartec.onrender.com/ws'  (https:// também é aceito; o /ws é acrescentado sozinho)
  ONLINE_SERVER: 'wss://kartec.onrender.com/ws',
  // minimapa: ZOOM = quantas vezes o mapa é aproximado em volta do kart (1 = mapa inteiro);
  // FADE_START = fração do raio onde a pista começa a sumir (o resto até a borda é o degradê de revelação)
  MINIMAP: { ZOOM: 2.4, FADE_START: 0.42, ICON: 0.9 },   // ICON = tamanho da seta e dos pontos (1 = original)
  // ---------- Fatecxie: a fadinha da contagem regressiva (ui.js > Fairy) ----------
  // MODEL: arquivo 3D (.glb com o semáforo na mão). Posição/escala em metros no espaço da câmera (a fada fica a 7 m).
  // LAMPS / BODY: pontos do próprio .glb (centro de cada lâmpada e esfera do corpo; servem para acender as luzes
  // e separar as asas). WINGS: HZ = batidas por segundo; YAW/ROLL = amplitude (rad); BLUR = rastros do desfoque
  // de movimento (celular usa no máximo 1); SHUTTER = fração do quadro "exposta" no desfoque.
  FAIRY: {
    MODEL: 'js/models/entidades/fatecxie.glb',
    SCALE: 3.4, POS: [1.2, 2.4, -7], ROT_Y: -Math.PI / 2 + 0.15, GLOW: 0.45,
    LAMPS: [[0.134, -0.166, 0.3339], [0.135, -0.2801, 0.339], [0.134, -0.4082, 0.3374]], LAMP_R: 0.041,
    BODY: { CENTER: [-0.047, 0.178, -0.012], RADIUS: 0.1385 },
    WINGS: { HZ: 12, YAW: 0.55, ROLL: 0.32, OPACITY: 0.9, BLUR: 3, SHUTTER: 0.85 },
    // piscada: EYES = [centro z, centro y, inclinação] de cada olho no .glb; BLINK = intervalo entre piscadas (s)
    EYES: [[-0.008, 0.1865, -0.09], [-0.0715, 0.178, -0.16]], EYE_SIZE: [0.024, 0.046], BLINK: [2.0, 4.5],
    // glow: RIM = brilho de borda no corpo; HALO = halo colado ao corpo; AURA = brilho grande e suave em volta
    RIM: 1.1, HALO: 3.0, AURA: 6.0,
    // sinaleiro com mola: SIGNAL = onde o cabo é "cortado" e gira no .glb (não mexer se o modelo for o mesmo);
    // SWING: FREQ = balanços por segundo, DAMP = amortecimento (menor = balança por mais tempo), INERTIA = quanto
    // ele atrasa quando a fada se mexe, KICK = empurrão a cada luz, STRETCH = quanto o cabo estica/encolhe, MAX = ângulo máx. (rad)
    SIGNAL: { PIVOT: [0.064, 0.1, 0.305], CUT_Y: 0.095, MIN_Z: 0.2, MIN_X: -0.06 },
    SWING: { FREQ: 1.1, DAMP: 0.13, INERTIA: 0.35, KICK: 1.6, STRETCH: 0, MAX: 0.85 }
  },
  COINS_ON: false,              // sistema de moedas mantido no código, desligado por enquanto
  // preenchimento de cenário (scenery.js): densidade relativa e alcance do horizonte
  FILL: { DENSITY: 1, LITE_DENSITY: 0.45, CHUNK: 300, CULL_EVERY: 0.25 },
  // névoa estilo Minecraft: um "muro" de névoa redondo em volta da câmera, na cor do horizonte. Ela começa em NEAR_K x fogFar
  // (fogFar fica em cada pista) e fecha em fogFar; o que está além não é desenhado (o mapa é dividido em blocos de 120 m).
  // Para enxergar mais longe: aumente o fogFar da pista (custa desempenho) ou use a distância de visão nas configurações.
  FOG: { NEAR_K: 0.55 },
  // câmera da corrida estilo "lente tele": mais longe do kart e com FOV fechado (pouca distorção nas bordas,
  // fundo "puxado" para perto, kart grande na tela). O FOV é fixo: não abre mais com a velocidade nem com o turbo.
  // FOV em graus (o antigo era 60, chegando a ~100 no turbo); DIST/HEIGHT em metros atrás/acima do kart (antigos: 12,5 / 5,6).
  CAMERA: { FOV: 53, DIST: 13.5, HEIGHT: 6.5, TILT: 3,   // TILT = graus a mais olhando para baixo
    // jogos de câmera (0 desliga cada um): ROLL = inclina para dentro da curva e mais ainda no drift (1 = ~2° na curva, ~5° no drift);
    // SWING = metros que a câmera abre para o lado de fora no drift (mostra a lateral do kart); LAND = afundada ao cair de um salto;
    // AIR = quanto a câmera "flutua" (atrasa na altura) com o kart no ar
    FX: { ROLL: 1, SWING: 1.4, LAND: 1, AIR: 1 } },
  CAMERA_FAR: 2300,             // plano de corte distante (a névoa de cada pista esconde o que vem antes dele)

  // ---------- grid de largada para 8 karts ----------
  // [metros atrás da linha, deslocamento lateral em metros]; o jogador larga na posição PLAYER_SLOT (0 = pole)
  RACERS: 8,
  GRID: [[10, -5.5], [17, 5.5], [24, -5.5], [31, 5.5], [38, -5.5], [45, 5.5], [52, -5.5], [59, 5.5]],
  PLAYER_SLOT: 5,
  // nomes e "personalidade" dos rivais (topScale: fração da velocidade máxima; dá variedade ao pelotão)
  RIVALS: [
    { name: 'Bot Turbo',  top: 1.00 }, { name: 'Lia Faísca', top: 0.995 }, { name: 'Zeca Drift', top: 0.985 },
    { name: 'Nina Nitro', top: 0.98 }, { name: 'Beto Bala',  top: 0.97 },  { name: 'Duda Vento', top: 0.96 },
    { name: 'Tito Pneu',  top: 0.95 }
  ],

  // ---------- velocidade dos veículos ----------
  // SPEED_MULT multiplica a velocidade REAL de todos os karts (jogador, bots e online): máxima, ré, aceleração,
  // freio e giro (o giro acompanha para as curvas continuarem com o mesmo traçado). O velocímetro NÃO muda:
  // o fator de km/h é dividido pelo mesmo número, então continua mostrando ~135 km/h na máxima e 203 no turbo.
  // Os valores abaixo em PHYS são os de base (1x); a conta é feita no fim deste arquivo.
  SPEED_MULT: 1.8,              // era 1.5; +20% para todos os veículos
  // TURN_MULT: quanto o giro do volante acompanha a velocidade. Com o giro subindo junto com a velocidade (1,8x) o kart
  // ficava "nervoso", indo demais para os lados; fica no valor de antes (1,5x) e a direção volta a ser firme.
  // Menor = direção mais pesada; igual ao SPEED_MULT = curvas com o mesmo raio de antes.
  TURN_MULT: 1.5,

  // ---------- física do kart (unidades: metros e segundos; valores de base, antes do SPEED_MULT) ----------
  PHYS: {
    MAX: 52,          // velocidade máxima normal (m/s) -> ~135 km/h no velocímetro (antes 46 / ~120 km/h)
    MAXREV: 14,       // ré
    ACC: 30,          // aceleração (acompanha a velocidade nova: chega no máximo no mesmo tempo de antes)
    BRAKE: 44,        // freio
    TURN: 2.0,        // taxa de giro máxima (rad/s) em baixa velocidade
    GRAV: 30,         // gravidade dos saltos
    KMH: 2.6,         // fator m/s -> "km/h" exibido
    DRIFT_R_IN: 40,   // raio do drift segurando para dentro da curva (m)
    DRIFT_R_MID: 66,  // raio do drift sem direcional
    DRIFT_R_OUT: 126, // raio do drift segurando para fora
    KART_RADIUS: 1.9, // raio de colisão entre karts
    // relevo (só nas pistas com elev): SLOPE_TOP = quanto a rampa muda a velocidade máxima (12% de subida -> -19%);
    // SLOPE_ACC = "gravidade" que freia na subida e empurra na descida (m/s² por 100% de inclinação)
    SLOPE_TOP: 1.6, SLOPE_ACC: 26
  },

  // ---------- inteligência artificial ----------
  BOT: {
    SKILL: 0.965,        // fração da velocidade máxima que o bot busca em reta
    LOOKAHEAD: 7,        // nós à frente para mirar (cresce com a velocidade)
    LINE: 0.55,          // quanto o bot "corta" para dentro das curvas (fração da meia-largura)
    RUBBER_MIN: 0.9,     // limite do "elástico" quando está muito na frente
    RUBBER_MAX: 1.07,    // limite do "elástico" quando está muito atrás
    DRIFT_MIN_CURV: 0.012, // curvatura média (1/m) a partir da qual o bot faz drift
    NAME: 'Bot Turbo'
  },

  // ---------- personalização: estado inicial (corBase, modeloKart, decalque, corDecalque, piloto) ----------
  // Números na lataria e acessórios do piloto foram removidos do jogo.
  DEFAULT_SPEC: { model: 'gt', color: '#e8302a', decal: 'flames', decalColor: '#ffc928',
                  suit: '#e8302a', helmet: '#e8302a', skin: '#f2b48a' },

  // ---------- cores disponíveis para o kart ----------
  KART_COLORS: [
    { name: 'Vermelho', hex: '#e8302a' },
    { name: 'Azul',     hex: '#2a5ce8' },
    { name: 'Verde',    hex: '#2cb84a' },
    { name: 'Amarelo',  hex: '#f2c418' },
    { name: 'Roxo',     hex: '#8a3ae0' },
    { name: 'Laranja',  hex: '#ff7a1a' },
    { name: 'Rosa',     hex: '#ff4fb0' },
    { name: 'Preto',    hex: '#2a2c34' },
    { name: 'Branco',   hex: '#eef0f4' },
    { name: 'Ciano',    hex: '#19c8e8' }
  ],
  DECAL_COLORS: ['#ffc928', '#ffffff', '#14183f', '#19e3ff', '#ff3d47', '#3ee05a', '#ff7ae0', '#ff8a00', '#8a3ae0', '#c0c4cc'],
  SUIT_COLORS: ['#e8302a', '#2a5ce8', '#2cb84a', '#f2c418', '#8a3ae0', '#ff7a1a', '#ff4fb0', '#2a2c34', '#eef0f4', '#19c8e8'],
  SKIN_TONES: ['#f6cfae', '#f2b48a', '#d99a6c', '#b87a4e', '#8a5634', '#5e3a22'],

  // ---------- pistas ----------
  // Cidade Brasileira e Praia foram removidas. Índice 0 = Circuito Clássico (igual ao das salas online).
  // segs: traçado em "tartaruga": ['S', comprimento] = reta, ['L'|'R', raio, graus] = curva (esq./dir.).
  // As listas já fecham o circuito (ponto final = inicial). O construtor amostra a cada 14 m e centraliza.
  // N: nós por volta (espaçamento de ~3,5 a 4,3 m, igual à versão anterior: física, IA e adereços continuam calibrados).
  // elev: [nó, altura] (opcional). startIdx: nó da linha de chegada. pads: [nó, deslocamento lateral].
  // ramps: [nó, deslocamento lateral, largura (0 = pista inteira), comprimento, altura]. No ar, apertar o drift = manobra (turbo ao pousar). time: hora inicial (0=meia-noite, .5=meio-dia).
  TRACKS: [
    {
      id: 'classic', name: 'Circuito Clássico',
      desc: 'Onze curvas para segurar o drift, subidas, descidas e cristas, rio com duas pontes e cachoeira.',
      W: 20, N: 870, startIdx: 45, time: 0.34,
      // rework 2026: sem chicanas em zigue-zague; 11 curvas (2 grampos, 1 dupla, varridas longas) ligadas por retas
      segs: [['S',308.1],['L',140,97],['S',197.6],['L',80,78],['S',195.2],['R',110,98],['S',195.5],['L',60,144],['S',48.3],['R',115,101],['S',130.4],['L',85,100],['S',54.0],['L',110,76],['S',119.5],['R',90,94],['S',117.5],['L',65,167],['S',188.1],['R',130,97],['S',201.5],['L',100,88],['S',94.0]],
      // relevo: [nó, altura em m]. Plano na reta dos boxes e nas duas pontes; cristas nos nós ~185, ~520, ~695 e ~790
      elev: [[0,0.0],[72,0.0],[100,4.5],[130,13.5],[165,22.5],[185,23.2],[200,21.0],[240,6.0],[265,3.0],[290,4.5],[330,9],[350,9],[366,5.5],[380,0.8],[386,0.0],[414,0.0],[428,2.2],[456,9.0],[490,18.0],[520,27.0],[540,25.5],[565,18.0],[600,7.5],[625,3.0],[650,6.0],[670,9.0],[695,13.5],[712,10.5],[740,6.0],[766,4.5],[790,10.5],[812,7.5],[832,0.8],[840,0.0]],
      bridges: [400, 864],
      pads: [[140,5],[220,-6],[310,0],[445,0],[552,6],[690,-6],[785,0]],
      // rampas de salto (largura 0 = pista inteira): em retas que sobem, o pouso cai ainda na reta
      ramps: [[132, 0, 0, 14, 1.7], [430, 0, 0, 14, 1.7], [768, 0, 0, 14, 1.7]],
      wall: [200, 240],
      // atalhos de terra batida: [nó de entrada, nó de saída, lado (-1/+1), quanto o caminho entra no miolo da curva (m)].
      // Na terra o kart anda a ~90% da velocidade: compensa (~1 s) sem quebrar a corrida. Os bots seguem pela pista.
      shortcuts: [[630, 700, -1, 78], [454, 530, -1, 86], [300, 370, -1, 86]],
      sky: { fog: 0xdbe9f8 }, fogFar: 1500   // distância de visão: a névoa fecha aqui e nada além dela é desenhado (CFG.FOG)
    }
  ]
};

// a fada da largada fica presa à câmera (CFG.FAIRY.POS, calibrada para FOV 60): com o FOV fechado da lente tele ela
// cairia fora da tela. Afastando só o z na mesma proporção, ela aparece no mesmo lugar e do mesmo tamanho de antes.
(function () {
  const C = window.CFG, F = C.FAIRY, fov = (C.CAMERA && C.CAMERA.FOV) || 60;
  if (!F || F.POS_BASE) return; F.POS_BASE = F.POS.slice();
  F.POS[2] = F.POS_BASE[2] * Math.tan(30 * Math.PI / 180) / Math.tan(fov * Math.PI / 360);
})();

// aplica o SPEED_MULT (uma vez só). PHYS.BASE guarda os valores originais.
(function () {
  const C = window.CFG, P = C.PHYS, m = Math.max(0.1, +C.SPEED_MULT || 1);
  if (P.BASE) return;
  P.BASE = { MAX: P.MAX, MAXREV: P.MAXREV, ACC: P.ACC, BRAKE: P.BRAKE, TURN: P.TURN, KMH: P.KMH, SLOPE_ACC: P.SLOPE_ACC };
  P.MAX *= m; P.MAXREV *= m; P.ACC *= m; P.BRAKE *= m; P.TURN *= Math.max(0.1, +C.TURN_MULT || m); P.SLOPE_ACC *= m;
  P.KMH /= m;          // velocímetro igual: (velocidade x m) x (KMH / m) = mesmo número na tela
})();
