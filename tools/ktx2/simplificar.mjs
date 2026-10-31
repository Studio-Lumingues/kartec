// =====================================================================================
// simplificar.mjs — reduz a quantidade de triângulos (e o tamanho das texturas) de um .glb
//
//   npm run simplificar -- js/models/entidades/banana.glb --tris 15000 --tex 1024
//
//   --tris N   alvo de triângulos (padrão 30000). O resultado fica perto disso.
//   --tex N    maior lado das texturas (padrão 2048)
//   --erro E   desvio máximo permitido da forma, em fração do tamanho do modelo (padrão 0.01 = 1%)
//
// * Guarda a versão de antes em tools/ktx2/_originais_alta/ (só na primeira vez), e sempre parte dela:
//   dá para rodar de novo com outro --tris sem perder qualidade.
// * Mantém UV, normais, texturas e materiais. Usa o simplificador do meshoptimizer (o mesmo do gltfpack) no modo
//   que leva em conta as normais e a UV de cada vértice, não só a posição: sem isso, os triângulos grandes que
//   sobram interpolam normais muito diferentes e aparecem "riscos" de sombreamento (testado: olhos do dinossauro).
// * A saída fica com texturas PNG/JPG normais: depois rode "npm run converter" para passar para KTX2.
// * fatecxie.glb: grava em cada vértice a parte do modelo (atributo _PART: 0 corpo, 1 asa esq., 2 asa dir.,
//   3 sinaleiro) e a cor da pele, calculadas com a textura original. O ui.js usa isso para separar as asas
//   mesmo quando a textura está em KTX2 (textura comprimida não pode ser lida pelo navegador).
// =====================================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, dedup, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(here, '..', '..');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const fileArg = argv.find(a => /\.glb$/i.test(a));
if (!fileArg) { console.log('uso: npm run simplificar -- caminho/do/modelo.glb --tris 30000 --tex 2048'); process.exit(1); }
const FILE = path.resolve(ROOT, fileArg), REL = path.relative(ROOT, FILE), HIGH = path.join(here, '_originais_alta', REL);
if (!fs.existsSync(FILE)) {
  const list = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', 'tools', '.git'].includes(e.name)) continue;
    const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.glb$/i.test(e.name)) list.push(path.relative(ROOT, p).replace(/\\/g, '/')); } };
  walk(ROOT);
  console.log('Arquivo não encontrado: ' + REL.replace(/\\/g, '/') + '\nUse o caminho de um .glb do jogo (a partir da pasta principal). Disponíveis:\n  ' + list.join('\n  '));
  process.exit(1);
}
const TRIS = +arg('--tris', 30000), TEX = +arg('--tex', 2048), ERR = +arg('--erro', 0.01);
const MB = b => (b / 1048576).toFixed(1) + ' MB';

await MeshoptDecoder.ready; await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// a versão de alta guardada é sempre a fonte; na primeira vez, é o próprio arquivo (desde que não seja KTX2)
if (!fs.existsSync(HIGH)) {
  const cur = await io.read(FILE);
  if (cur.getRoot().listTextures().some(t => t.getMimeType() === 'image/ktx2')) {
    const conv = path.join(here, '_originais', REL);
    if (!fs.existsSync(conv)) { console.log('O arquivo já está em KTX2 e não há original guardado. Coloque a versão original (PNG/JPG) no lugar e rode de novo.'); process.exit(1); }
    fs.mkdirSync(path.dirname(HIGH), { recursive: true }); fs.copyFileSync(conv, HIGH);
  } else { fs.mkdirSync(path.dirname(HIGH), { recursive: true }); fs.copyFileSync(FILE, HIGH); }
}
const doc = await io.read(HIGH), root = doc.getRoot();
const count = () => { let t = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; } return t; };
const before = count();

// 1) geometria: junta vértices repetidos e simplifica até o alvo (sem passar do erro máximo)
const ratio = Math.min(1, TRIS / before);
await doc.transform(weld(), simplifyAttr(ratio, ERR), dedup(), prune());
const after = count();

// 2) texturas: reduz o maior lado para --tex (mantém o formato; potência de 2)
let texBefore = 0, texAfter = 0;
for (const t of root.listTextures()) {
  const img = t.getImage(); if (!img || t.getMimeType() === 'image/ktx2') continue;
  const m = await sharp(img).metadata(); texBefore += m.width * m.height * 4 * 1.33;
  const k = Math.min(1, TEX / Math.max(m.width, m.height)), w = Math.round(m.width * k), h = Math.round(m.height * k);
  if (k < 1) { const s = sharp(img).resize(w, h, { kernel: 'lanczos3' }); const out = t.getMimeType() === 'image/jpeg' ? await s.jpeg({ quality: 92 }).toBuffer() : await s.png().toBuffer(); t.setImage(new Uint8Array(out)); }
  texAfter += w * h * 4 * 1.33;
}

// 3) fatecxie: parte de cada vértice (mesmas regras do ui.js > Fairy.prepare, com a cor da textura) + cor da pele
if (/fatecxie\.glb$/i.test(FILE)) await tagFairy(doc);

await io.write(FILE, doc);
console.log(REL + '\n  triângulos ' + before.toLocaleString('pt-BR') + ' -> ' + after.toLocaleString('pt-BR') +
  '\n  texturas na GPU (sem KTX2) ~' + MB(texBefore) + ' -> ~' + MB(texAfter) + '\n  disco ' + MB(fs.statSync(HIGH).size) + ' -> ' + MB(fs.statSync(FILE).size) +
  '\n  versão de alta guardada em ' + path.relative(ROOT, HIGH) + '\n  próximo passo: npm run converter (texturas para KTX2)');

// simplificação com atributos: posição + normal (peso 0,5) + UV (peso 1). As costuras da UV (mesma posição, UV diferente)
// são tratadas pelo próprio meshoptimizer: só colapsam ao longo da costura, sem misturar as ilhas da textura.
function simplifyAttr(ratio, err) {
  return doc => {
    MeshoptSimplifier.useExperimentalFeatures = true;
    const buf = doc.getRoot().listBuffers()[0];
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4 || ratio >= 1) continue;
      const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices();
      const n = pos.getCount(), P = new Float32Array(n * 3), e3 = [0, 0, 0], e2 = [0, 0];
      for (let i = 0; i < n; i++) { pos.getElement(i, e3); P.set(e3, i * 3); }
      const stride = (nor ? 3 : 0) + (uv ? 2 : 0), A = new Float32Array(Math.max(1, n * stride)), W = [];
      if (nor) W.push(0.5, 0.5, 0.5); if (uv) W.push(1, 1);
      for (let i = 0; i < n; i++) { let o = i * stride;
        if (nor) { nor.getElement(i, e3); A[o++] = e3[0]; A[o++] = e3[1]; A[o++] = e3[2]; }
        if (uv) { uv.getElement(i, e2); A[o++] = e2[0]; A[o++] = e2[1]; } }
      const I = idx ? Uint32Array.from(idx.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
      const target = Math.max(3, Math.floor(I.length * ratio / 3) * 3);
      const [out] = stride ? MeshoptSimplifier.simplifyWithAttributes(I, P, 3, A, stride, W, null, target, err, [])
                           : MeshoptSimplifier.simplify(I, P, 3, target, err, []);
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(n < 65535 ? new Uint16Array(out) : new Uint32Array(out)).setBuffer(buf));
      compactPrimitive(prim);   // remove os vértices que ficaram sem uso
    }
  };
}

async function tagFairy(doc) {
  // valores do ui.js (FAIRY_DEF) / config.js (CFG.FAIRY): centro e raio do corpo, corte do sinaleiro
  const B = { C: [-0.047, 0.178, -0.012], R: 0.1385 }, SG = { CUT_Y: 0.095, MIN_Z: 0.2, MIN_X: -0.06 };
  const prims = []; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) prims.push(p);
  const prim = prims[0], mesh = doc.getRoot().listMeshes()[0], mat = prim.getMaterial(), tex = mat && mat.getBaseColorTexture();
  const PW = 256; let pix = null;
  if (tex && tex.getMimeType() !== 'image/ktx2') pix = await sharp(tex.getImage()).resize(PW, PW, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), n = pos.getCount(), part = new Float32Array(n);
  const P = [0, 0, 0], U = [0, 0], R2 = B.R * B.R; let wings = 0, sem = 0;
  const px = (u, v) => { u -= Math.floor(u); v -= Math.floor(v); return (Math.min(PW - 1, v * PW | 0) * PW + Math.min(PW - 1, u * PW | 0)) * 4; };
  for (let i = 0; i < n; i++) {
    pos.getElement(i, P); const [x, y, z] = P, dx = x - B.C[0], dy = y - B.C[1], dz = z - B.C[2];
    if (z > SG.MIN_Z && y < SG.CUT_Y && x > SG.MIN_X) { part[i] = 3; sem++; continue; }
    if (dx * dx + dy * dy + dz * dz < R2 || Math.abs(dz) < 0.05 || x > 0.04 || y < -0.02 || (y < 0.13 && x > -0.06)) continue;
    if (pix && uv) { uv.getElement(i, U); const p = px(U[0], U[1]); if (!(pix[p] > 178 && pix[p + 1] > 165 && pix[p + 2] > 107)) continue; }
    part[i] = dz < 0 ? 1 : 2; wings++;
  }
  prim.setAttribute('_PART', doc.createAccessor().setType('SCALAR').setArray(part).setBuffer(doc.getRoot().listBuffers()[0]));
  // cor da pele: média dos texels do topo do corpo (mesma regra do ui.js), em linear
  let skin = null;
  if (pix && uv) { let r = 0, g = 0, b = 0, m = 0;
    for (let i = 0; i < n && m < 4000; i++) { pos.getElement(i, P); if (P[1] < B.C[1] + 0.1 || P[0] < B.C[0]) continue; uv.getElement(i, U); const p = px(U[0], U[1]);
      if (pix[p + 2] > 110) continue; r += pix[p]; g += pix[p + 1]; b += pix[p + 2]; m++; }
    if (m > 50) skin = [r, g, b].map(c => +Math.pow(c / m / 255, 2.2).toFixed(4)); }
  mesh.setExtras(Object.assign({}, mesh.getExtras(), { fatecxie: { parts: 1, skin } }));
  console.log('  fatecxie: ' + wings + ' vértices de asa, ' + sem + ' do sinaleiro' + (skin ? ', pele ' + skin.join(' ') : ''));
}
