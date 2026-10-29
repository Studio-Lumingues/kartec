#!/usr/bin/env bash
# =====================================================================================
# Super Kartec — instalação na Oracle Cloud (Ubuntu 22.04/24.04, x86 ou ARM)
#
# Rode DENTRO da pasta do projeto, na VM:
#     sudo bash deploy/oracle-setup.sh
#
# Variáveis opcionais (ou responda às perguntas):
#     DOMAIN=kartec.duckdns.org      -> HTTPS automático (Let's Encrypt via Caddy). Sem domínio: http://IP
#     DUCKDNS_TOKEN=xxxx             -> aponta o subdomínio do DuckDNS para o IP desta VM
#     ALLOWED_ORIGINS=https://meu-jogo.vercel.app   -> só esse site pode usar o online (vazio = qualquer)
#
# O que faz: instala Node.js (>= 18) e Caddy, copia o jogo para /opt/super-kartec, cria o serviço
# "super-kartec" (reinicia sozinho e sobe junto com a VM), libera as portas 80/443 no firewall da VM
# e configura o Caddy na frente do Node (HTTPS + WebSocket). Pode rodar de novo para atualizar.
# =====================================================================================
set -euo pipefail

APP_DIR=/opt/super-kartec
SVC=super-kartec
APP_USER=kartec
NODE_PORT=8080
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say()  { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[aviso] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[erro] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Rode com sudo:  sudo bash deploy/oracle-setup.sh"
[ -f "$SRC_DIR/index.html" ] && [ -f "$SRC_DIR/server/server.js" ] || die "Não achei o projeto em $SRC_DIR (rode de dentro da pasta super-kartec)."
command -v apt-get >/dev/null || die "Este script é para Ubuntu/Debian (apt-get)."

# ---------- perguntas (só se a variável não veio pronta e há terminal) ----------
ask() { local var="$1" msg="$2"; if [ -z "${!var:-}" ] && [ -t 0 ]; then read -r -p "$msg" "${var?}"; fi; }
ask DOMAIN "Domínio para HTTPS (ex.: kartec.duckdns.org) ou ENTER para usar só o IP: "
DOMAIN="$(echo "${DOMAIN:-}" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##')"
if [ -n "$DOMAIN" ] && [[ "$DOMAIN" == *.duckdns.org ]]; then ask DUCKDNS_TOKEN "Token do DuckDNS (ENTER se já apontou o IP no site): "; fi
ask ALLOWED_ORIGINS "Site do jogo na Vercel, se usar (ex.: https://meu-jogo.vercel.app) ou ENTER: "
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}"

PUBLIC_IP="$(curl -fsS --max-time 8 https://api.ipify.org || curl -fsS --max-time 8 https://ifconfig.me || echo '')"

# ---------- pacotes ----------
say "Instalando pacotes (Node.js, Caddy, firewall persistente)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg iptables-persistent netfilter-persistent
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; }
if ! node_ok; then apt-get install -y nodejs npm || true; fi
if ! node_ok; then
  say "Node.js do Ubuntu é antigo: instalando Node 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node_ok || die "Não consegui instalar Node.js 18+."
command -v npm >/dev/null || apt-get install -y npm
if ! command -v caddy >/dev/null; then
  apt-get install -y caddy || {
    say "Adicionando o repositório oficial do Caddy"
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy; }
fi
echo "Node $(node -v) | npm $(npm -v) | $(caddy version | head -1)"

# ---------- aplicação ----------
say "Copiando o jogo para $APP_DIR"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  (cd "$SRC_DIR" && tar cf - --exclude=node_modules --exclude=.git .) | (cd "$APP_DIR" && tar xf -)
fi
(cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund)
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------- serviço (systemd) ----------
say "Criando o serviço $SVC"
cat > "/etc/systemd/system/$SVC.service" <<UNIT
[Unit]
Description=Super Kartec (jogo + servidor online)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$NODE_PORT
Environment=HOST=127.0.0.1
Environment=ALLOWED_ORIGINS=$ALLOWED_ORIGINS
ExecStart=$(command -v node) server/server.js
Restart=always
RestartSec=2
LimitNOFILE=65536
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null
systemctl restart "$SVC"

# ---------- Caddy (HTTPS + WebSocket na frente do Node) ----------
say "Configurando o Caddy"
if [ -n "$DOMAIN" ]; then SITE="$DOMAIN"; else SITE=":80"; fi
cat > /etc/caddy/Caddyfile <<CADDY
# Super Kartec: o Caddy recebe 80/443 (HTTPS automático com domínio) e repassa para o Node (WebSocket incluso)
$SITE {
	reverse_proxy 127.0.0.1:$NODE_PORT
}
CADDY
systemctl enable caddy >/dev/null
systemctl restart caddy

# ---------- firewall da VM (as imagens Ubuntu da Oracle bloqueiam tudo menos SSH) ----------
say "Liberando as portas 80 e 443 no firewall da VM"
open_port() {
  local p="$1"
  iptables -C INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT 2>/dev/null && return 0
  local pos; pos="$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')"
  if [ -n "$pos" ]; then iptables -I INPUT "$pos" -p tcp -m state --state NEW --dport "$p" -j ACCEPT
  else iptables -A INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT; fi
}
open_port 80; open_port 443
netfilter-persistent save >/dev/null

# ---------- DuckDNS (opcional) ----------
if [ -n "$DOMAIN" ] && [[ "$DOMAIN" == *.duckdns.org ]] && [ -n "${DUCKDNS_TOKEN:-}" ] && [ -n "$PUBLIC_IP" ]; then
  say "Apontando $DOMAIN para $PUBLIC_IP"
  r="$(curl -fsS "https://www.duckdns.org/update?domains=${DOMAIN%.duckdns.org}&token=${DUCKDNS_TOKEN}&ip=${PUBLIC_IP}" || true)"
  [ "$r" = "OK" ] && echo "DuckDNS: OK" || warn "DuckDNS respondeu '$r' (confira o token e o subdomínio)."
fi

# ---------- conferência ----------
say "Conferindo"
ok=0
for _ in $(seq 1 20); do if curl -fsS "http://127.0.0.1:$NODE_PORT/health" >/dev/null 2>&1; then ok=1; break; fi; sleep 0.5; done
[ $ok -eq 1 ] && echo "Servidor do jogo: OK ($(curl -fsS "http://127.0.0.1:$NODE_PORT/health"))" || { warn "O servidor não respondeu. Veja: journalctl -u $SVC -n 50"; }

echo
echo "================================================================"
if [ -n "$DOMAIN" ]; then
  echo " Jogo:            https://$DOMAIN"
  echo " Online (Vercel): ONLINE_SERVER: 'wss://$DOMAIN/ws'"
  echo " (o certificado HTTPS sai sozinho em alguns segundos, se o domínio já aponta para ${PUBLIC_IP:-o IP da VM})"
else
  echo " Jogo:            http://${PUBLIC_IP:-IP-DA-VM}"
  echo " Para HTTPS (necessário se o jogo ficar na Vercel), rode de novo com DOMAIN=seu.dominio"
fi
echo " Lembrete: libere TCP 80 e 443 na Security List da sua VCN (painel da Oracle)."
echo " Logs: journalctl -u $SVC -f      Reiniciar: sudo systemctl restart $SVC"
echo "================================================================"
