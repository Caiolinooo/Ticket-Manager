#!/usr/bin/env bash
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
cd /home/caio/ticket-manager
pm2 restart ticket-manager
sleep 3
pm2 list
echo "===SMOKE==="
curl -sS -o /tmp/tm-smoke.out -w "HTTP %{http_code} time %{time_total}s\n" http://127.0.0.1:9120/
curl -sS -o /dev/null -w "admin HTTP %{http_code}\n" http://127.0.0.1:9120/admin
head -c 180 /tmp/tm-smoke.out; echo
pm2 logs ticket-manager --lines 25 --nostream
echo "===DONE==="
