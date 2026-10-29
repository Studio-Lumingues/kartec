// =====================================================================================
// api/deploy.mjs — função da Vercel: diz a hora EXATA em que a versão que está no ar subiu.
// Usada pela tela de Patch notes ("No ar desde …" e a entrada mais recente com at: 'auto').
//
// Ordem de precisão (usa a primeira que der certo):
//  1) Hora em que o deploy ficou pronto na Vercel   -> precisa da variável VERCEL_TOKEN (opcional)
//  2) Hora do commit que gerou este deploy (GitHub) -> funciona sozinho em repositório público;
//                                                      repositório privado: variável GITHUB_TOKEN
//  3) Só o commit (sha e mensagem), sem hora        -> o jogo usa a data escrita na entrada
//
// Requisito: Vercel › Settings › Environment Variables › "Automatically expose System Environment
// Variables" ligado (é o padrão). A resposta fica no cache da Vercel até o próximo deploy.
// =====================================================================================
export default async function handler(req, res) {
  const E = process.env, sha = E.VERCEL_GIT_COMMIT_SHA || null;
  const out = { deployedAt: null, source: null, sha: sha ? sha.slice(0, 7) : null, message: (E.VERCEL_GIT_COMMIT_MESSAGE || '').split('\n')[0].slice(0, 120) || null, branch: E.VERCEL_GIT_COMMIT_REF || null };
  const get = async (url, headers) => { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    try { const r = await fetch(url, { headers, signal: ctl.signal }); return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); } };

  // 1) deploy na Vercel (hora em que ficou "Ready")
  if (E.VERCEL_TOKEN && E.VERCEL_DEPLOYMENT_ID) {
    const team = E.VERCEL_TEAM_ID ? '?teamId=' + encodeURIComponent(E.VERCEL_TEAM_ID) : '';
    const d = await get('https://api.vercel.com/v13/deployments/' + encodeURIComponent(E.VERCEL_DEPLOYMENT_ID) + team, { Authorization: 'Bearer ' + E.VERCEL_TOKEN });
    const ms = d && (d.ready || d.buildingAt || d.createdAt);
    if (ms) { out.deployedAt = new Date(ms).toISOString(); out.source = 'vercel'; }
  }
  // 2) commit no GitHub
  if (!out.deployedAt && sha && E.VERCEL_GIT_REPO_OWNER && E.VERCEL_GIT_REPO_SLUG && (E.VERCEL_GIT_PROVIDER || 'github') === 'github') {
    const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'super-kartec' }; if (E.GITHUB_TOKEN) h.Authorization = 'Bearer ' + E.GITHUB_TOKEN;
    const c = await get('https://api.github.com/repos/' + E.VERCEL_GIT_REPO_OWNER + '/' + E.VERCEL_GIT_REPO_SLUG + '/commits/' + sha, h);
    const at = c && c.commit && ((c.commit.committer && c.commit.committer.date) || (c.commit.author && c.commit.author.date));
    if (at) { out.deployedAt = new Date(at).toISOString(); out.source = 'commit'; }
  }
  // o dado não muda até o próximo deploy (que limpa o cache): guarda por 1 dia na borda; falha guarda só 1 min
  res.setHeader('Cache-Control', out.deployedAt ? 'public, max-age=60, s-maxage=86400, stale-while-revalidate=600' : 'public, max-age=30, s-maxage=60');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).send(JSON.stringify(out));
}
