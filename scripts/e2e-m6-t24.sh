#!/usr/bin/env bash
# M6-T24: runs e2e/m6-t24-invite-target.spec.ts against a backend and a frontend started on free ports, on the TEST database.
#   DATABASE_URL=postgresql://.../ecommerce_cod_test_a scripts/e2e-m6-t24.sh
# It seeds one tenant, runs the spec, deletes the tenant, and stops the two servers it started. It never touches other ports.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${E2E_API_PORT:-3411}"
WEB_PORT="${E2E_WEB_PORT:-5411}"
case "${DATABASE_URL:-}" in
  *ecommerce_cod_test_*) ;;
  *) echo "DATABASE_URL must name a test database (ecommerce_cod_test_*)"; exit 2 ;;
esac
for p in "$API_PORT" "$WEB_PORT"; do
  if lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then echo "port $p is in use"; exit 2; fi
done
LOG="${E2E_LOG_DIR:-${TMPDIR:-/tmp}}"
PIDS=()
TENANT=""
cleanup() {
  [ -n "$TENANT" ] && (cd "$ROOT/backend" && npx ts-node --transpile-only src/__tests__/e2e/m6T24Seed.ts cleanup "$TENANT" >/dev/null 2>&1)
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && pkill -P "$pid" 2>/dev/null; [ -n "$pid" ] && kill "$pid" 2>/dev/null; done
}
trap cleanup EXIT

cd "$ROOT/backend"
SEED="$(npx ts-node --transpile-only src/__tests__/e2e/m6T24Seed.ts seed 2>/dev/null | grep '^{' | tail -1)"
[ -z "$SEED" ] && { echo "seed failed"; exit 1; }
TENANT="$(echo "$SEED" | sed -n 's/.*"tenantId":"\([^"]*\)".*/\1/p')"

# no email provider: the invite shows its link to copy (the worktree .env may hold a real Resend key)
PORT="$API_PORT" RESEND_API_KEY= FRONTEND_URL="http://localhost:$WEB_PORT" NODE_ENV=development LOG_LEVEL=error \
  npx ts-node --transpile-only src/server.ts >"$LOG/e2e-m6-t24-api.log" 2>&1 &
PIDS+=($!)
cd "$ROOT/frontend"
VITE_API_URL="http://localhost:$API_PORT" VITE_WS_URL="http://localhost:$API_PORT" npx vite --port "$WEB_PORT" --strictPort >"$LOG/e2e-m6-t24-web.log" 2>&1 &
PIDS+=($!)

for i in $(seq 1 90); do
  curl -sf "http://localhost:$API_PORT/health" >/dev/null 2>&1 && curl -sf "http://localhost:$WEB_PORT/" >/dev/null 2>&1 && break
  sleep 2
done

cd "$ROOT"
E2E_BASE_URL="http://localhost:$WEB_PORT" E2E_API_URL="http://localhost:$API_PORT" E2E_M6_OWNER="$SEED" \
  npx playwright test e2e/m6-t24-invite-target.spec.ts --reporter=list --retries=0
