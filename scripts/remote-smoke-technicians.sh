#!/usr/bin/env bash
set -euo pipefail
cd /home/caio/ticket-manager

echo '=== routing unit smoke ==='
node scripts/smoke-technician-routing.mjs

echo '=== /api/kpi (expect 403 without cookie) ==='
code=$(curl -sS -o /tmp/kpi.json -w '%{http_code}' http://127.0.0.1:9120/api/kpi || true)
echo "HTTP $code"
cat /tmp/kpi.json; echo

echo '=== exchange sync (union accounts) ==='
code=$(curl -sS -o /tmp/ex.json -w '%{http_code}' http://127.0.0.1:9120/api/integrations/exchange || true)
echo "HTTP $code"
node - <<'NODE'
const fs = require('fs');
const j = JSON.parse(fs.readFileSync('/tmp/ex.json', 'utf8'));
console.log(JSON.stringify({
  success: j.success,
  authOk: j.authOk,
  disabled: j.disabled,
  monitoredAccounts: j.monitoredAccounts,
  processedCount: j.processedCount,
  errCount: (j.errors || []).length,
  warnCount: (j.warnings || []).length,
}, null, 2));
NODE

echo '=== technician auth smoke ==='
SMOKE_BASE=http://127.0.0.1:9120 node scripts/smoke-technician-auth.mjs

echo '=== remote smoke ok ==='
