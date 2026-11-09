// =====================================================================================
// models/glb.js — carregador dos modelos 3D novos (kart, motoca, menino, menina)
//
// Os .glb vêm comprimidos pelo gltfpack (EXT_meshopt_compression + KHR_mesh_quantization): o
// js/vendor/meshopt_decoder.js descompacta. Com servidor (http/https) o arquivo é baixado normalmente;
// abrindo o index.html direto do disco (file://), onde o fetch() é bloqueado, entra a cópia embutida
// assets/<nome>_glb.js, que preenche window.GLB_EMBED[nome] com o mesmo arquivo em base64.
// GLBAssets.get(nome) devolve o gltf já carregado (ou null) para o pilot.js e o karts.js.
// =====================================================================================
(function () {
  const VER = '202611091700';
  const FILES = { kart: 'assets/kart.glb', motoca: 'assets/motoca.glb', menino: 'assets/menino.glb', menina: 'assets/menina.glb' };
  const embedSrc = name => 'assets/' + name + '_glb.js?v=' + VER;
  const cache = {}, pending = {};

  function b64ToBuffer(b64) { const bin = atob(b64), n = bin.length, u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  function loader() {
    const L = new THREE.GLTFLoader(), D = window.MeshoptDecoder || THREE.MeshoptDecoder;
    if (D && L.setMeshoptDecoder) L.setMeshoptDecoder(D);
    return L;
  }
  function parse(buf) { return new Promise((res, rej) => { try { loader().parse(buf, '', res, rej); } catch (e) { rej(e); } }); }
  // cópia embutida (script assets/<nome>_glb.js -> window.GLB_EMBED[nome])
  function viaScript(name) {
    return new Promise((res, rej) => {
      const E = window.GLB_EMBED; if (E && E[name]) return res(E[name]);
      const s = document.createElement('script'); s.src = embedSrc(name); s.async = true;
      s.onload = () => (window.GLB_EMBED && window.GLB_EMBED[name]) ? res(window.GLB_EMBED[name]) : rej(new Error('base64 vazio: ' + name));
      s.onerror = () => rej(new Error(embedSrc(name) + ' não encontrado'));
      document.head.appendChild(s);
    }).then(b64 => { const buf = b64ToBuffer(b64); try { delete window.GLB_EMBED[name]; } catch (e) { } return parse(buf); });   // libera a string (≈1 MB)
  }
  function viaFetch(name, onP) {
    return new Promise((res, rej) => loader().load(FILES[name] + '?v=' + VER, res, x => { if (onP && x.total) onP(Math.min(0.95, x.loaded / x.total)); }, rej));
  }

  const GLBAssets = {
    files: FILES,
    get(name) { return cache[name] || null; },
    // carrega um modelo (uma vez só); onP(0..1) informa o progresso
    load(name, onP) {
      if (pending[name]) return pending[name];
      if (!FILES[name]) return Promise.reject(new Error('modelo desconhecido: ' + name));
      if (!window.THREE || !THREE.GLTFLoader) return Promise.reject(new Error('GLTFLoader não carregado'));
      const go = location.protocol === 'file:' ? viaScript(name)
        : viaFetch(name, onP).catch(e => { console.warn('[glb] ' + FILES[name] + ' não baixou, usando a cópia embutida:', e); return viaScript(name); });
      return pending[name] = go.then(g => { cache[name] = g; if (onP) onP(1); return g; });
    },
    // carrega vários em paralelo com progresso somado; nunca rejeita (quem falhar volta null)
    loadAll(names, onProgress) {
      const prog = {}, tick = () => { if (onProgress) onProgress(names.reduce((a, n) => a + (prog[n] || 0), 0) / names.length); };
      return Promise.all(names.map(n => this.load(n, p => { prog[n] = Math.max(prog[n] || 0, p); tick(); })
        .catch(e => { console.warn('[glb] ' + n + ' indisponível:', e); prog[n] = 1; tick(); return null; })));
    },
    // ---------- geometria: atributos quantizados -> Float32 já transformados ----------
    // devolve { P, N, U, I } (posições/normais/uvs em Float32, índices) com a matriz aplicada.
    // uvT = textura do material (o KHR_texture_transform vira offset/repeat: é embutido nas UVs)
    bake(mesh, matrix, uvT) {
      const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, n = pos.count;
      const den = a => { if (!a || !a.normalized) return 1; const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array;
        return arr instanceof Int8Array ? 127 : arr instanceof Uint8Array ? 255 : arr instanceof Int16Array ? 32767 : arr instanceof Uint16Array ? 65535 : 1; };
      const dp = den(pos), dn = den(nor), du = den(uv);
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
      const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(matrix);
      const ox = uvT ? uvT.offset.x : 0, oy = uvT ? uvT.offset.y : 0, rx = uvT ? uvT.repeat.x : 1, ry = uvT ? uvT.repeat.y : 1;
      for (let i = 0; i < n; i++) {
        v.set(pos.getX(i) / dp, pos.getY(i) / dp, pos.getZ(i) / dp).applyMatrix4(matrix); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
        if (nor) { v.set(Math.max(-1, nor.getX(i) / dn), Math.max(-1, nor.getY(i) / dn), Math.max(-1, nor.getZ(i) / dn)).applyMatrix3(nm).normalize(); N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z; }
        if (uv) { U[i * 2] = uv.getX(i) / du * rx + ox; U[i * 2 + 1] = uv.getY(i) / du * ry + oy; }
      }
      const I = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: n }, (_, i) => i);
      return { P, N, U, I };
    },
    // monta BufferGeometry com só os triângulos aceitos (tri(i) -> true) e a matriz aplicada; reindexa os vértices
    geometry(b, tri, matrix) {
      const map = new Int32Array(b.P.length / 3).fill(-1), idx = [], P = [], N = [], U = [];
      const v = new THREE.Vector3(), nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
      for (let t = 0; t < b.I.length; t += 3) {
        if (tri && !tri(t / 3)) continue;
        for (let k = 0; k < 3; k++) { const i = b.I[t + k];
          if (map[i] < 0) { map[i] = P.length / 3;
            v.set(b.P[i * 3], b.P[i * 3 + 1], b.P[i * 3 + 2]); if (matrix) v.applyMatrix4(matrix); P.push(v.x, v.y, v.z);
            v.set(b.N[i * 3], b.N[i * 3 + 1], b.N[i * 3 + 2]); if (nm) v.applyMatrix3(nm).normalize(); N.push(v.x, v.y, v.z);
            U.push(b.U[i * 2], b.U[i * 2 + 1]); }
          idx.push(map[i]); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      g.computeBoundingBox(); g.computeBoundingSphere();
      return g;
    },
    // a textura do modelo sem o KHR_texture_transform (já embutido nas UVs pelo bake)
    plainMap(map) {
      if (!map || map.__plain) return map;                                       // (Texture do r128 não tem userData)
      map.offset.set(0, 0); map.repeat.set(1, 1); map.center.set(0, 0); map.rotation = 0; map.updateMatrix();
      map.encoding = THREE.LinearEncoding; map.anisotropy = (window.TX && TX.aniso) || 1; map.needsUpdate = true; map.__plain = true;
      return map;
    }
  };
  window.GLBAssets = GLBAssets;
})();
