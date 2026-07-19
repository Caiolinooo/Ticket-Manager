#!/usr/bin/env bash
set -euo pipefail
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="${HOME}/.nvm/versions/node/v22.22.3/bin:${PATH}"

cd /home/caio/ticket-manager
echo "=== cwd ==="
pwd
ls -la package.json LICENSE README.md src/lib/ai.ts .env | head -20
echo "=== npm install ==="
npm install
echo "=== prisma generate ==="
npx prisma generate
echo "=== build ==="
npm run build
echo "=== pm2 restart ==="
pm2 restart ticket-manager
sleep 2
pm2 list
echo "=== smoke ==="
curl -sS -o /tmp/tm-smoke.out -w "HTTP %{http_code} time %{time_total}s size %{size_download}\n" http://127.0.0.1:9120/ || true
head -c 200 /tmp/tm-smoke.out; echo
curl -sS -o /dev/null -w "admin HTTP %{http_code}\n" http://127.0.0.1:9120/admin || true
pm2 logs ticket-manager --lines 40 --nostream
echo "=== deploy ok ==="
