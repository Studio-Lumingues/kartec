#!/usr/bin/env bash
# Atualiza o jogo na VM: rode dentro da pasta NOVA do projeto (git pull ou zip novo descompactado)
#     sudo bash deploy/update.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Rode com sudo"; exit 1; }
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; APP_DIR=/opt/super-kartec
if [ "$SRC_DIR" != "$APP_DIR" ]; then (cd "$SRC_DIR" && tar cf - --exclude=node_modules --exclude=.git .) | (cd "$APP_DIR" && tar xf -); fi
(cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund) && chown -R kartec:kartec "$APP_DIR"
systemctl restart super-kartec && sleep 1 && curl -fsS http://127.0.0.1:8080/health && echo && echo "Atualizado."
