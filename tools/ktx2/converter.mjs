// =====================================================================================
// converter.mjs — converte as texturas de TODOS os .glb do jogo para KTX2 (Basis Universal)
//
//   cd tools/ktx2
//   npm install            (só na primeira vez)
//   npm run converter      (converte só os .glb NOVOS ou ALTERADOS; os já convertidos são pulados)
//   npm run restaurar      (volta todos os .glb para o original)
//
// Modelo novo ou atualizado: é só exportar o .glb normal (com PNG/JPG) para a pasta do jogo e rodar
// npm run converter de novo. Ele percebe que o arquivo ainda não é KTX2, guarda essa versão como o novo
// original e converte. Os outros, já convertidos, ficam como estão.
//
// Opções:  --max 2048     maior lado das texturas (padrão 2048; use 1024 para economizar mais)
//          --refazer      reconverte TODOS a partir dos originais (ex.: para mudar o --max)
//          --pasta ../..  pasta do jogo (padrão: duas pastas acima desta)
//
// O que faz em cada .glb:
//   1. guarda o original em tools/ktx2/_originais/ (a versão mais recente que você colocou na pasta do jogo)
//   2. reduz as texturas maiores que --max (mantendo potência de 2)
//   3. normal maps -> UASTC (qualidade alta, compressão Zstandard); cor -> ETC1S sRGB; resto (ORM etc.) -> ETC1S linear
//   4. salva no mesmo lugar, mantendo a compressão de malha (meshopt) se o arquivo já usava
// No jogo, js/vendor/KTX2Loader.js + js/ktx2-setup.js fazem o GLTFLoader ler essas texturas.
// =====================================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ROOT = path.resolve(arg('--pasta', path.join(here, '..', '..')));
const MAX = Math.max(64, +arg('--max', 2048) || 2048);
const BACKUP = path.join(here, '_originais');
const RESTORE = process.argv.includes('--restaurar'), REDO = process.argv.includes('--refazer');
// arquivos que NÃO viram KTX2: o piloto troca as cores da roupa, do capacete e da pele procurando cores EXATAS na textura,
// e a compressão muda levemente as cores (testado: ~1% da roupa e ~2% da pele deixam de ser reconhecidos, sobram pontinhos
// da cor original nas bordas). A textura dele é pequena (1024, ~4 MB na GPU), então não vale o risco.
// Para pular outro arquivo: acrescente aqui ou use --pular nome.glb
const PULAR = [/(^|[\\/])pilot[^\\/]*\.glb$/i].concat(process.argv.includes('--pular') ? [new RegExp(arg('--pular', '$^').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')] : []);
const MB = b => (b / 1048576).toFixed(1) + ' MB';

// todos os .glb do jogo (fora node_modules, tools e .git)
function findGlb(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'tools', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findGlb(p, out); else if (/\.glb$/i.test(e.name)) out.push(p);
  }
  return out;
}

const imageDecoder = async buf => { const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height }; };

// reduz as texturas grandes antes de comprimir (lado maior <= MAX, potência de 2)
const pow2 = n => Math.pow(2, Math.round(Math.log2(Math.max(1, n))));
function resize(max) {
  return async doc => {
    for (const t of doc.getRoot().listTextures()) {
      const img = t.getImage(); if (!img || t.getMimeType() === 'image/ktx2') continue;
      const meta = await sharp(img).metadata(); if (!meta.width) continue;
      const k = Math.min(1, max / Math.max(meta.width, meta.height));
      const w = Math.min(max, pow2(meta.width * k)), h = Math.min(max, pow2(meta.height * k));
      if (w === meta.width && h === meta.height) continue;
      const png = await sharp(img).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
      t.setImage(new Uint8Array(png)); t.setMimeType('image/png');
    }
  };
}

async function main() {
  await MeshoptDecoder.ready; await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const files = findGlb(ROOT);
  if (!files.length) { console.log('Nenhum .glb encontrado em', ROOT); return; }
  console.log((RESTORE ? 'Restaurando ' : 'Convertendo ') + files.length + ' arquivo(s) em ' + ROOT + (RESTORE ? '' : ' (texturas até ' + MAX + ' px)') + '\n');
  let totA = 0, totB = 0, gpuA = 0, gpuB = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file), bak = path.join(BACKUP, rel);
    if (RESTORE) { if (fs.existsSync(bak)) { fs.copyFileSync(bak, file); console.log('  restaurado  ' + rel); } continue; }
    if (PULAR.some(re => re.test(rel))) {   // fica com a textura original; se já tinha sido convertido, volta ao original
      try { const c = await io.read(file); if (c.getRoot().listTextures().some(t => t.getMimeType() === 'image/ktx2') && fs.existsSync(bak)) { fs.copyFileSync(bak, file); console.log('  restaurado  ' + rel + '  (pulado: troca de cor precisa da textura original)'); }
        else console.log('  pulado      ' + rel + '  (troca de cor precisa da textura original)'); } catch (e) { console.log('  pulado      ' + rel); }
      continue;
    }
    try {
      // já convertido (tem textura KTX2) -> pula, a não ser com --refazer; senão é novo ou foi atualizado -> vira o original
      const cur = await io.read(file), isKtx = cur.getRoot().listTextures().some(t => t.getMimeType() === 'image/ktx2');
      if (isKtx && !(REDO && fs.existsSync(bak))) { if (isKtx) console.log('  já em KTX2  ' + rel + (fs.existsSync(bak) ? '' : '  (sem original guardado)')); continue; }
      if (!isKtx) { fs.mkdirSync(path.dirname(bak), { recursive: true }); fs.copyFileSync(file, bak); }
      const doc = isKtx ? await io.read(bak) : cur;
      const texs = doc.getRoot().listTextures();
      if (!texs.length) { console.log('  sem texturas ' + rel); continue; }
      // memória de GPU antes (RGBA 8 bits + mipmaps), para o relatório
      let before = 0;
      for (const t of texs) { const s = t.getSize(); if (s) before += s[0] * s[1] * 4 * 1.33; }
      await doc.transform(
        resize(MAX),
        ktx2({ slots: /^normalTexture$/, isUASTC: true, isNormalMap: true, isPerceptual: false, needSupercompression: true, uastcLDRQualityLevel: 2, generateMipmap: true, isKTX2File: true, imageDecoder }),
        ktx2({ slots: /^(baseColorTexture|emissiveTexture|diffuseTexture|specularColorTexture|sheenColorTexture)$/, isUASTC: false, qualityLevel: 192, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true, generateMipmap: true, isKTX2File: true, imageDecoder }),
        ktx2({ isUASTC: false, qualityLevel: 192, compressionLevel: 2, isPerceptual: false, generateMipmap: true, isKTX2File: true, imageDecoder })
      );
      let after = 0;
      for (const t of doc.getRoot().listTextures()) { const s = t.getSize(); if (!s) continue; after += s[0] * s[1] * (t.getMimeType() === 'image/ktx2' ? 1 : 4) * 1.33; }
      await io.write(file, doc);
      const a = fs.statSync(bak).size, b = fs.statSync(file).size; totA += a; totB += b; gpuA += before; gpuB += after;
      console.log('  ok  ' + rel.padEnd(48) + ' disco ' + MB(a) + ' -> ' + MB(b) + '   GPU ~' + MB(before) + ' -> ~' + MB(after));
    } catch (e) { if (fs.existsSync(bak)) fs.copyFileSync(bak, file); console.log('  ERRO ' + rel + ' (mantido o original): ' + e.message); }
  }
  if (!RESTORE) console.log('\nTotal  disco ' + MB(totA) + ' -> ' + MB(totB) + '   memória de vídeo das texturas ~' + MB(gpuA) + ' -> ~' + MB(gpuB) +
    '\nOriginais guardados em ' + path.relative(ROOT, BACKUP) + ' (npm run restaurar volta tudo).');
}
main().catch(e => { console.error(e); process.exit(1); });
