# Super Kartec

Jogo de kart 3D (Three.js) com modo online. O servidor (`server/server.js`) entrega os arquivos do jogo
e o WebSocket do online (`/ws`) no mesmo endereço.

## Rodar no seu computador

Requisito: Node.js 18 ou mais novo. Na pasta do projeto:

```bash
npm install
npm start          # http://localhost:8080  (outra porta: PORT=9000 npm start)
```

## Publicar no Render

1. Suba esta pasta para um repositório no GitHub (a raiz do repositório é esta pasta, onde ficam
   `index.html`, `package.json` e `render.yaml`).
2. No Render: **New + > Blueprint**, escolha o repositório e confirme. O `render.yaml` já configura tudo:
   serviço web Node, região Virginia, plano Free, `npm install` / `npm start` e verificação em `/health`.
   (Sem Blueprint: **New + > Web Service**, Runtime Node, Build `npm install`, Start `npm start`.)
3. Abra `https://SEU-SERVICO.onrender.com`. O jogo usa `wss://` sozinho na mesma página.

Avisos do plano Free do Render:
* Ele dorme depois de 15 minutos sem tráfego. Quem abrir o jogo depois disso espera cerca de 1 minuto
  até o servidor acordar. Durante as partidas ele fica acordado (os jogadores mandam dados o tempo todo).
* O Render pode reiniciar o serviço grátis a qualquer momento. As salas ficam na memória do servidor:
  num reinício elas acabam e os jogadores voltam ao menu com um aviso.
* Não há região do Render na América do Sul; Virginia (EUA) é a mais próxima do Brasil.
  Um plano pago tira a hibernação.

## Publicar na Oracle Cloud (servidor no Brasil, grátis)

1. **Conta**: crie em oracle.com/cloud/free e escolha **São Paulo** como região inicial (não muda depois).
2. **Máquina**: *Compute > Instances > Create instance*
   * Imagem **Canonical Ubuntu 24.04**; formato **VM.Standard.E2.1.Micro** (Always Free) ou, se houver
     vaga, **VM.Standard.A1.Flex** (1 OCPU / 6 GB já sobra).
   * Rede: crie uma VCN com **sub-rede pública** e marque **atribuir IPv4 público**.
   * Chave SSH: **Generate a key pair** e baixe a chave privada (`.key`).
3. **Portas no painel**: *Networking > Virtual cloud networks > sua VCN > Security Lists > Default Security
   List > Add Ingress Rules*: origem `0.0.0.0/0`, TCP, porta de destino `80`. Repita com `443`.
4. **Domínio grátis (para HTTPS)**: em duckdns.org, entre com Google/GitHub, crie um subdomínio
   (ex.: `kartec`) e coloque o **IP público da VM** no campo "current ip". Necessário se o jogo ficar na
   Vercel; sem domínio o jogo funciona em `http://IP-DA-VM`.
5. **Enviar e instalar** (no seu computador, PowerShell ou terminal):
   ```bash
   scp -i chave.key super-kartec-completo.zip ubuntu@IP-DA-VM:~
   ssh -i chave.key ubuntu@IP-DA-VM
   ```
   Já na VM:
   ```bash
   sudo apt-get install -y unzip && unzip -o super-kartec-completo.zip && cd super-kartec
   sudo bash deploy/oracle-setup.sh
   ```
   O script pergunta o domínio (ex.: `kartec.duckdns.org`), o token do DuckDNS (opcional) e o site da
   Vercel (opcional). Ele instala Node.js e Caddy, cria o serviço `super-kartec` (reinicia sozinho e sobe
   com a VM), libera 80/443 no firewall da VM e ativa o HTTPS automático.
6. **Jogar**: `https://kartec.duckdns.org` (ou `http://IP-DA-VM` sem domínio).
   Com o jogo na Vercel: em `js/config.js`, `ONLINE_SERVER: 'wss://kartec.duckdns.org/ws'`.

**Atualizar**: envie o zip novo, descompacte e rode `sudo bash deploy/update.sh` dentro da pasta.

**Se algo não abrir**: `curl localhost:8080/health` (servidor), `journalctl -u super-kartec -f` (logs do
jogo), `sudo systemctl status caddy` (HTTPS). Confira as portas 80/443 na Security List (passo 3).

**Para a Oracle não recuperar a VM parada**: contas só gratuitas podem ter VMs ociosas recuperadas;
convertendo a conta para *Pay As You Go* isso deixa de valer e continua sem custo dentro dos limites
Always Free. Crie um alerta de orçamento (*Billing > Budgets*, ex.: US$ 1) para ser avisado de qualquer cobrança.

## Jogo na Vercel + servidor no Render

O jogo é só arquivos estáticos, então pode ficar na Vercel (carrega rápido no Brasil) enquanto o online
roda no Render. O atraso das corridas continua dependendo de onde o servidor está.

1. **Servidor no Render** (passo anterior). Anote o endereço, ex.: `https://super-kartec.onrender.com`.
   Em *Environment*, defina `ALLOWED_ORIGINS` com o endereço do jogo na Vercel
   (ex.: `https://meu-jogo.vercel.app`) para só o seu site usar o servidor. Opcional: `SERVE_STATIC=0`
   faz o Render servir só o online.
2. **No jogo**, em `js/config.js`, preencha:
   `ONLINE_SERVER: 'wss://super-kartec.onrender.com/ws',`
3. **Vercel**: New Project > importe o repositório > Framework Preset **Other**, sem comando de build,
   diretório de saída `.` (o `vercel.json` já faz isso; o `.vercelignore` deixa o servidor de fora).

Quando o servidor grátis estiver dormindo, a tela "Online" mostra "Acordando o servidor…" e conecta
sozinha assim que ele acorda (até ~1 minuto). O jogo também começa a acordá-lo assim que a página abre.

## Como jogar online

1. Menu > **Online** > escolha seu nome.
2. **Criar sala**: nome, senha (3 a 32 caracteres), jogadores (2 a 8), pista e voltas.
3. Os amigos usam **Entrar numa sala**: escolhem a sala (ou digitam o código de 5 letras) e a senha.
4. Todos marcam **Estou pronto** e o anfitrião clica em **Iniciar corrida**.

Verificação: `/health` responde `{"ok":true,"rooms":N,"players":M}`.
