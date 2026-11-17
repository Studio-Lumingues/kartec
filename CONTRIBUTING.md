# Como contribuir com o Super Kartec

Valeu por querer ajudar! 🏁 Este guia explica como rodar o jogo localmente e mandar suas mudanças.

## Rodando localmente

Requisito: **Node.js 18** ou mais novo.

```bash
npm install
npm start          # http://localhost:8080
```

O servidor (`server/server.js`) entrega os arquivos do jogo e o WebSocket do modo online no mesmo endereço. Para usar outra porta: `PORT=9000 npm start`.

Mais detalhes (deploy no Render e na Vercel, estrutura do código) estão no [guia técnico](docs/TECNICO.md).

## Fluxo de trabalho

1. Crie um branch a partir da `main`, com um nome curto que diga o que ele faz:
   - `feat/nova-pista`
   - `fix/colisao-kart`
   - `docs/manual-itens`
2. Faça commits pequenos e com mensagens claras, em português. Exemplo: `fix: corrige colisão na curva 3`.
3. Teste no navegador antes de abrir o PR, de preferência no single player e no modo online.
4. Abra um Pull Request para a `main` e preencha o modelo.

## Prefixos de commit

| Prefixo | Quando usar |
|---|---|
| `feat:` | nova funcionalidade (pista, item, kart...) |
| `fix:` | correção de bug |
| `perf:` | melhoria de desempenho |
| `docs:` | documentação e manual |
| `chore:` | configuração, ferramentas e manutenção |

## Encontrou um bug?

Abra uma [issue](../../issues/new/choose) usando o modelo de bug. Conte o navegador usado, o que aconteceu e, se der, mande um print.
