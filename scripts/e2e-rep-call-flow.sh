#!/usr/bin/env bash
# M7-T23: runs e2e/11-rep-call-flow.spec.ts against backend (PORT=3102) and frontend (port 5182) on the test database.
#   scripts/e2e-rep-call-flow.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${PORT:-3102}"
WEB_PORT="5182"

TEST_DB_URL="$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env.test" | sed 's/^DATABASE_URL=//;s/"//g')"
DATABASE_URL="${DATABASE_URL:-$TEST_DB_URL}"

case "$DATABASE_URL" in
  *ecommerce_cod_test_*) ;;
  *) echo "DATABASE_URL must name a test database (ecommerce_cod_test_*)"; exit 2 ;;
esac

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && pkill -P "$pid" 2>/dev/null
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
}
trap cleanup EXIT

if ! lsof -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Starting backend on port $API_PORT..."
  cd "$ROOT/backend"
  PORT="$API_PORT" DATABASE_URL="$DATABASE_URL" FRONTEND_URL="http://localhost:$WEB_PORT" NODE_ENV=development \
    ./node_modules/.bin/ts-node --transpile-only src/server.ts >/tmp/e2e-rep-api.log 2>&1 &
  PIDS+=($!)
fi

if ! lsof -iTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Starting frontend on port $WEB_PORT..."
  cd "$ROOT/frontend"
  VITE_API_URL="http://localhost:$API_PORT" VITE_WS_URL="http://localhost:$API_PORT" \
    VITE_PROXY_TARGET="http://localhost:$API_PORT" VITE_FEATURE_REP_APP=true \
    ./node_modules/.bin/vite --port "$WEB_PORT" --strictPort >/tmp/e2e-rep-web.log 2>&1 &
  PIDS+=($!)
fi

for i in $(seq 1 60); do
  curl -sf "http://localhost:$API_PORT/health" >/dev/null 2>&1 && curl -sf "http://localhost:$WEB_PORT/" >/dev/null 2>&1 && break
  sleep 1
done

cd "$ROOT"
E2E_BASE_URL="http://localhost:$WEB_PORT" E2E_API_URL="http://localhost:$API_PORT" \
  npx playwright test e2e/11-rep-call-flow.spec.ts --reporter=list
