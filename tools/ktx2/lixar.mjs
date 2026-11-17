// =====================================================================================
// lixar.mjs — "lixa" a superfície de um .glb: tira ondulações e manchas do brilho nas faces grandes.
//
//   npm run lixar -- public/assets/models/karttec_logo.min.glb [saída.glb] [iterações=30] [força=0.5]
//
// * Suavização de Taubin nas posições (passo que alisa + passo que "desencolhe"): o modelo não perde volume
//   e as quinas continuam no lugar (deslocamento máximo da logo: ~0,04 unidade).
// * Normais recalculadas a partir das faces já lisas; o sentido delas é o mesmo do original.
// * Posições guardadas com 14 bits de mantissa (erro < 0,01%) e compressão meshopt: o arquivo fica menor.
// * Sem saída, sobrescreve a entrada. O original continua no histórico do git.
// * Usado na logo 3D (karttec_logo.min.glb). Depois, regere a cópia embutida (*.glb.js) para o modo file://.
// =====================================================================================
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');   // caminhos a partir da raiz do repositório
const [IN0, OUT0, ITER = '30', LAM = '0.5'] = process.argv.slice(2), IN = IN0 && path.resolve(ROOT, IN0), OUT = OUT0 ? path.resolve(ROOT, OUT0) : IN;
if (!IN) { console.log('uso: npm run lixar -- <arquivo.glb> [saída.glb] [iterações] [força]'); process.exit(1); }
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(IN);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), idx = prim.getIndices().getArray();
const nv = P.getCount(), pos = new Float64Array(nv * 3), e = [];
for (let i = 0; i < nv; i++) { P.getElement(i, e); pos.set(e, i * 3); }
// solda por posição
const key = i => Math.round(pos[i*3]*1e5)+','+Math.round(pos[i*3+1]*1e5)+','+Math.round(pos[i*3+2]*1e5);
const id = new Int32Array(nv), uniq = new Map(); let nu = 0;
for (let i = 0; i < nv; i++) { const k = key(i); let u = uniq.get(k); if (u === undefined) { u = nu++; uniq.set(k, u); } id[i] = u; }
const up = new Float64Array(nu * 3); for (let i = 0; i < nv; i++) up.set(pos.subarray(i*3, i*3+3), id[i]*3);
const nb = Array.from({ length: nu }, () => new Set());
for (let t = 0; t < idx.length; t += 3) { const a = id[idx[t]], b = id[idx[t+1]], c = id[idx[t+2]]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
// borda aberta (aresta com 1 face) fica parada
const ecount = new Map(); const ek = (a, b) => a < b ? a * nu + b : b * nu + a;
for (let t = 0; t < idx.length; t += 3) { const v = [id[idx[t]], id[idx[t+1]], id[idx[t+2]]]; for (let k = 0; k < 3; k++) { const kk = ek(v[k], v[(k+1)%3]); ecount.set(kk, (ecount.get(kk) || 0) + 1); } }
const fixed = new Uint8Array(nu); for (const [kk, c] of ecount) if (c === 1) { fixed[Math.floor(kk / nu)] = 1; fixed[kk % nu] = 1; }
console.log('vértices', nv, 'únicos', nu, 'fixos (borda)', fixed.reduce((a, b) => a + b, 0));
const step = f => { const o = new Float64Array(up); for (let u = 0; u < nu; u++) { if (fixed[u] || !nb[u].size) continue; let x=0,y=0,z=0; for (const v of nb[u]) { x+=up[v*3]; y+=up[v*3+1]; z+=up[v*3+2]; } const n = nb[u].size; o[u*3] += f*(x/n-up[u*3]); o[u*3+1] += f*(y/n-up[u*3+1]); o[u*3+2] += f*(z/n-up[u*3+2]); } up.set(o); };
const lam = +LAM, mu = -lam / (1 - 0.1 * lam);
for (let k = 0; k < +ITER; k++) { step(lam); step(mu); }
let maxd = 0; for (let i = 0; i < nv; i++) { const d = Math.hypot(up[id[i]*3]-pos[i*3], up[id[i]*3+1]-pos[i*3+1], up[id[i]*3+2]-pos[i*3+2]); if (d > maxd) maxd = d; }
const np = new Float32Array(nv * 3); for (let i = 0; i < nv; i++) np.set(up.subarray(id[i]*3, id[i]*3+3), i*3);
// normais pelas faces (por índice: quinas com vértices separados continuam vivas)
const nn = new Float32Array(nv * 3);
for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t+1], c = idx[t+2];
  const ux = np[b*3]-np[a*3], uy = np[b*3+1]-np[a*3+1], uz = np[b*3+2]-np[a*3+2], vx = np[c*3]-np[a*3], vy = np[c*3+1]-np[a*3+1], vz = np[c*3+2]-np[a*3+2];
  const fx = uy*vz-uz*vy, fy = uz*vx-ux*vz, fz = ux*vy-uy*vx; for (const v of [a, b, c]) { nn[v*3]+=fx; nn[v*3+1]+=fy; nn[v*3+2]+=fz; } }
// mantém o sentido das normais originais
let flip = 0; for (let i = 0; i < nv; i++) { N.getElement(i, e); const l = Math.hypot(nn[i*3], nn[i*3+1], nn[i*3+2]) || 1; nn[i*3]/=l; nn[i*3+1]/=l; nn[i*3+2]/=l; if (nn[i*3]*e[0]+nn[i*3+1]*e[1]+nn[i*3+2]*e[2] < 0) flip++; }
console.log('deslocamento máx.', maxd.toFixed(5), '| normais invertidas vs original', flip);
// reduz a precisão das posições a 14 bits de mantissa (erro < 0,01% do valor): comprime bem melhor
{ const u = new Uint32Array(np.buffer); for (let i = 0; i < u.length; i++) u[i] = (u[i] + 0x100) & 0xFFFFFE00; }
P.setArray(np); N.setArray(nn).setNormalized(false);
await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize({ pattern: /^NORMAL$/, quantizeNormal: 16 }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(OUT, doc); console.log('ok', OUT);
