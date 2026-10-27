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
  // Copa: as 3 pistas em sequência; vence quem somar o MENOR tempo total
  CUP: { name: 'Copa Kartec', order: [0, 1, 2] },
  DIFFICULTY: {
    easy:   { label: 'Fácil',   skill: 0.90,  rubberMax: 1.03 },
    normal: { label: 'Normal',  skill: 0.965, rubberMax: 1.07 },
    hard:   { label: 'Difícil', skill: 0.995, rubberMax: 1.10 }
  },
  // tipografia arredondada usada no jogo todo (DOM e canvas); Google Fonts com alternativas locais
  FONT_DISPLAY: '"Fredoka", "Lilita One", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif',
  FONT_UI: '"Nunito", "Trebuchet MS", Verdana, sans-serif',
  // desempenho: resolução adaptativa (baixa sozinha se o quadro passar de ~20 ms)
  PERF: { DPR_MAX: 1.5, DPR_MIN: 0.7, SHADOW_MAP: 1024, SHADOW_BOX: 45 },
  // ONLINE: endereço do servidor quando o jogo e o servidor ficam em lugares diferentes
  // (ex.: jogo na Vercel e servidor no Render). Vazio = mesmo endereço da página.
  // Exemplo: 'wss://super-kartec.onrender.com/ws'  (https:// também é aceito; o /ws é acrescentado sozinho)
  ONLINE_SERVER: 'wss://kartec.onrender.com/ws',
  COINS_ON: false,              // sistema de moedas mantido no código, desligado por enquanto
  // preenchimento de cenário (scenery.js): densidade relativa e alcance do horizonte
  FILL: { DENSITY: 1, LITE_DENSITY: 0.45, CHUNK: 300, CULL_EVERY: 0.25 },
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

  // ---------- física do kart (unidades: metros e segundos) ----------
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
    KART_RADIUS: 1.9  // raio de colisão entre karts
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
  DEFAULT_SPEC: { model: 'gt', color: '#e8302a', decal: 'flames', decalColor: '#ffc928', number: 7,
                  suit: '#e8302a', helmet: '#e8302a', skin: '#f2b48a', accessory: 'none' },

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
  // Curvas extras (2026): chicanas em "S" nas retas longas; cada S é curva/contracurva/curva com o mesmo
  // rumo de entrada e saída, então o circuito continua fechando exatamente.
  // segs: traçado em "tartaruga": ['S', comprimento] = reta, ['L'|'R', raio, graus] = curva (esq./dir.).
  // As listas já fecham o circuito (ponto final = inicial). O construtor amostra a cada 14 m e centraliza.
  // N: nós por volta (espaçamento de ~3,5 a 4,3 m, igual à versão anterior: física, IA e adereços continuam calibrados).
  // startIdx: nó da linha de chegada. pads: [nó, deslocamento lateral].
  // ramps: [nó, deslocamento lateral, largura, comprimento, altura]. time: hora inicial (0=meia-noite, .5=meio-dia).
  TRACKS: [
    {
      id: 'classic', name: 'Circuito Clássico',
      desc: 'Curvas longas para segurar o drift, rio com duas pontes, cachoeira e laguinhos.',
      W: 20, N: 870, startIdx: 41, time: 0.34,
      segs: [['S',250],['R',70,48],['L',70,96],['R',70,48],['S',15.9],['L',170.0,90],['S',106.2],['L',138.0,75],['S',42.5],['R',148.8,75],['S',8],['L',55,30],['R',55,60],['L',55,30],['S',9.5],['L',191.2,120],['S',278],['R',46,30],['L',46,60],['R',46,30],['S',5.0],['R',138.0,60],['S',42.5],['L',159.5,150],['S',15],['R',60,45],['L',60,90],['R',60,45],['S',30.3],['L',60,45],['R',60,90],['L',60,45],['S',37.2],['L',212.5,60],['S',219.0]],
      bridges: [468, 836],
      pads: [[108,0],[310,7],[386,-7],[530,0],[605,7],[715,-6],[793,-7]],
      ramps: [],
      wall: [143, 262],
      sky: { fog: 0xdbe9f8 }, fogFar: 1500   // névoa mais longe: as montanhas do horizonte aparecem em camadas
    },
    {
      id: 'city', name: 'Cidade Brasileira',
      desc: 'Avenidas em quarteirões, túnel longo sob a linha do trem, calçadão de ondas, prédios coloridos e bandeirinhas. Começa no fim da tarde.',
      W: 19, N: 1000, startIdx: 50, time: 0.72,
      tunnel: [550, 723],     // túnel longo: a reta inteira (~520 m) e a curva seguinte; o trem passa por cima, no meio dele
      segs: [['S',250],['L',70,45],['R',70,90],['L',70,45],['S',7.0],['R',60,40],['L',60,80],['R',60,40],['S',26.7],['L',102.0,90],['S',15],['R',55,40],['L',55,80],['R',55,40],['S',13.6],['L',102.0,90],['S',20],['L',60,42],['R',60,84],['L',60,42],['S',10.6],['R',102.0,90],['S',10],['R',50,40],['L',50,80],['R',50,40],['S',10.2],['L',102.0,90],['S',515.8],['L',102.0,90],['S',20],['L',60,42],['R',60,84],['L',60,42],['S',10.6],['L',102.0,90],['S',70.7],['R',102.0,90],['S',8],['R',45,38],['L',45,76],['R',45,38],['S',8.7],['L',102.0,90]],
      bridges: [],
      pads: [[131,0],[329,6],[472,-6],[622,0],[786,5],[895,6]],
      ramps: [],
      wall: null,
      sky: { fog: 0xe8c9b0 }, fogFar: 1100
    },
    {
      id: 'beach', name: 'Praia',
      desc: 'Orla à beira-mar com coqueiros, quiosques, farol e mar em volta da ilha.',
      W: 19, N: 880, startIdx: 34, time: 0.47,
      segs: [['S',200],['L',75,45],['R',75,90],['L',75,45],['S',2.9],['R',50,35],['L',50,70],['R',50,35],['S',32.7],['L',191.2,100],['S',20],['L',55,38],['R',55,76],['L',55,38],['S',14.6],['R',148.8,60],['L',170.0,140],['S',20],['R',65,45],['L',65,90],['R',65,45],['S',26.1],['L',65,48],['R',65,96],['L',65,48],['S',76.9],['L',233.8,80],['S',25],['R',60,45],['L',60,90],['R',60,45],['S',58.6],['R',131.8,50],['L',159.5,150],['S',94.9]],
      bridges: [],
      pads: [[126,6],[360,0],[443,-6],[532,-6],[709,0],[820,6]],
      ramps: [],
      wall: null,
      sky: { fog: 0xd6ecf8 }, fogFar: 1350
    }
  ]
};
