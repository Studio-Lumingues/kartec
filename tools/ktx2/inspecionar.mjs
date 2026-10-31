// inspecionar.mjs — lista todos os .glb do jogo: triângulos, vértices, texturas e quanto ocupam na memória
//   npm run inspecionar
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const here = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(here, '..', '..');
const MB = b => (b / 1048576).toFixed(1) + ' MB', K = n => n >= 1e6 ? (n / 1e6).toFixed(2) + ' mi' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' mil' : String(n);
function findGlb(dir, out = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (['node_modules', 'tools', '.git'].includes(e.name)) continue;
  const p = path.join(dir, e.name); if (e.isDirectory()) findGlb(p, out); else if (/\.glb$/i.test(e.name)) out.push(p); } return out; }
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const rows = [];
for (const f of findGlb(ROOT)) {
  try { const d = await io.read(f), r = d.getRoot(); let tris = 0, verts = 0, vb = 0, tex = 0; const tl = [];
    for (const m of r.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(), pos = p.getAttribute('POSITION'); if (!pos) continue;
      tris += (i ? i.getCount() : pos.getCount()) / 3; verts += pos.getCount(); for (const s of p.listSemantics()) { const a = p.getAttribute(s); vb += a.getCount() * a.getElementSize() * 4; } }
    for (const t of r.listTextures()) { const s = t.getSize() || [0, 0], k = t.getMimeType() === 'image/ktx2'; tex += s[0] * s[1] * (k ? 1 : 4) * 1.33; tl.push(s[0] + 'x' + s[1] + (k ? ' ktx2' : '')); }
    rows.push({ arq: path.relative(ROOT, f), disco: fs.statSync(f).size, tris, verts, vb, tex, tl }); }
  catch (e) { rows.push({ arq: path.relative(ROOT, f), erro: e.message }); }
}
rows.sort((a, b) => (b.tris || 0) - (a.tris || 0));
console.log('\narquivo'.padEnd(46) + 'triângulos'.padStart(12) + 'vértices'.padStart(12) + '  malha RAM+GPU'.padStart(16) + '  texturas GPU'.padStart(15) + '   texturas');
for (const r of rows) { if (r.erro) { console.log(r.arq.padEnd(45) + '  ERRO: ' + r.erro); continue; }
  console.log(r.arq.padEnd(45) + K(r.tris).padStart(12) + K(r.verts).padStart(12) + MB(r.vb * 2).padStart(16) + MB(r.tex).padStart(15) + '   ' + (r.tl.join(', ') || '-')); }
console.log('\n"malha RAM+GPU" conta duas cópias (JavaScript e placa de vídeo). Um personagem de jogo de kart costuma ter 5 a 30 mil triângulos.');
