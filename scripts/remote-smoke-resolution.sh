#!/usr/bin/env bash
set -euo pipefail
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="${HOME}/.nvm/versions/node/v22.22.3/bin:${PATH}"

cd /home/caio/ticket-manager
echo "=== version ==="
node -p "require('./package.json').version"
echo "=== db column + select ==="
node scripts/smoke-resolution.mjs
echo "=== http ==="
curl -sS -o /tmp/tm-tickets.json -w "tickets_api HTTP %{http_code}\n" http://127.0.0.1:9120/api/tickets || true
head -c 240 /tmp/tm-tickets.json; echo
curl -sS -o /dev/null -w "admin HTTP %{http_code}\n" http://127.0.0.1:9120/admin || true
echo "=== pm2 ==="
pm2 describe ticket-manager | sed -n '1,25p'
echo "=== smoke ok ==="
