#!/usr/bin/env bash
# Create and migrate one test database per Jest worker, for `npm run test:integration:parallel`.
#
# Usage: scripts/test-dbs.sh [N]      (N = number of workers, default 3)
#
# Base name comes from DATABASE_URL in backend/.env.test (or the environment). Worker k uses
# <base>_w<k>, which is the name src/__tests__/setup.ts picks when TEST_DB_PER_WORKER=1.
# Idempotent: `prisma migrate deploy` creates a missing database and applies only pending migrations.
set -euo pipefail

cd "$(dirname "$0")/.."
N="${1:-4}"

BASE_URL="${DATABASE_URL:-}"
if [ -z "$BASE_URL" ] && [ -f .env.test ]; then
  BASE_URL="$(grep -E '^DATABASE_URL=' .env.test | head -1 | cut -d= -f2- | tr -d '"')"
fi
if [ -z "$BASE_URL" ]; then
  echo "test-dbs: DATABASE_URL not set (backend/.env.test has none)" >&2
  exit 1
fi

# Same guard as src/__tests__/setup.ts: only ever touch test databases.
DB_NAME="$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "$BASE_URL")"
case "$DB_NAME" in
  *_test*) ;;
  *) echo "test-dbs: refusing '$DB_NAME' (name must contain _test)" >&2; exit 1 ;;
esac

pids=()
for i in $(seq 1 "$N"); do
  url="$(node -e 'const u=new URL(process.argv[1]); u.pathname+="_w"+process.argv[2]; console.log(u.toString())' "$BASE_URL" "$i")"
  ( DATABASE_URL="$url" npx prisma migrate deploy >/dev/null 2>"/tmp/test-dbs-w$i.log" \
      && echo "test-dbs: ${DB_NAME}_w$i ready" \
      || { echo "test-dbs: ${DB_NAME}_w$i FAILED, see /tmp/test-dbs-w$i.log" >&2; exit 1; } ) &
  pids+=($!)
done

status=0
for pid in "${pids[@]}"; do wait "$pid" || status=1; done
exit $status
