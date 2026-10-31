// =====================================================================================
// ktx2-setup.js — faz TODO GLTFLoader do jogo ler texturas KTX2 (Basis Universal)
//
// Texturas KTX2 ficam comprimidas DENTRO da placa de vídeo (4 a 8x menos memória que PNG/JPG).
// Os .glb são convertidos uma vez com tools/ktx2 (npm run converter). Arquivos ainda não convertidos
// continuam funcionando igual: este arquivo só entra em ação quando o .glb tem textura KTX2.
//
// Precisa, antes dele no index.html: three.min.js, GLTFLoader.js e vendor/KTX2Loader.js.
// O decodificador (basis_transcoder.js + .wasm) fica em js/vendor/basis/ e roda num Web Worker.
// =====================================================================================
(function () {
  if (!window.THREE || !THREE.GLTFLoader) return;
  if (!THREE.KTX2Loader) { console.warn('[KTX2] js/vendor/KTX2Loader.js não carregou: texturas KTX2 não serão lidas'); return; }
  const PATH = 'js/vendor/basis/';
  let shared = null;

  // detecta os formatos comprimidos da placa (BC7/S3TC no PC, ASTC/ETC2 no celular). Usa o renderizador do jogo se ele já
  // existir; se o .glb carregar antes dele, pergunta direto a um contexto WebGL pequeno e o descarta em seguida.
  function detectTarget() {
    const R = window.__kart && __kart.renderer;
    if (R) return R;
    const cv = document.createElement('canvas'), gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const fake = { capabilities: { isWebGL2: !!(gl && window.WebGL2RenderingContext && gl instanceof WebGL2RenderingContext) },
      extensions: { has: n => !!(gl && gl.getExtension(n)) } };
    setTimeout(() => { const lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); }, 0);
    return fake;
  }
  function loader() {
    if (shared) return shared;
    shared = new THREE.KTX2Loader().setTranscoderPath(PATH);
    shared.setWorkerLimit && shared.setWorkerLimit(2);
    try { shared.detectSupport(detectTarget()); } catch (e) { console.warn('[KTX2] detecção de formato falhou, usando RGBA:', e); }
    return shared;
  }
  window.KTX2 = { loader };

  // liga o KTX2Loader em todo GLTFLoader na hora de interpretar o arquivo (load, loadAsync e parse passam por aqui)
  const parse = THREE.GLTFLoader.prototype.parse;
  THREE.GLTFLoader.prototype.parse = function (data, path, onLoad, onError) {
    if (!this.ktx2Loader) { try { this.setKTX2Loader(loader()); } catch (e) { console.warn('[KTX2]', e); } }
    return parse.call(this, data, path, onLoad, onError);
  };
})();
