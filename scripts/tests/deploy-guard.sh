#!/bin/bash
# Deploy guard test (M0-T32).
# Runs each deploy script with a fake `docker-compose` (and `docker`) on PATH.
# The fake fails only for `prisma migrate deploy`; everything else succeeds.
# The test passes (exit 0) only if every script exits non-zero on that failure.

SCRIPTS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin" "$WORK/repo"
cat > "$WORK/bin/docker-compose" <<'FAKE'
#!/bin/bash
case "$*" in
  *"prisma migrate deploy"*) echo "fake docker-compose: migrate deploy failed" >&2; touch "$GUARD_MARKER"; exit 1 ;;
  *"ps -q"*|*"ps "*) echo "fakecontainer" ;;
esac
exit 0
FAKE
cat > "$WORK/bin/docker" <<'FAKE'
#!/bin/bash
case "$*" in
  *"inspect"*) echo "healthy" ;;
  *"prisma migrate deploy"*) touch "$GUARD_MARKER"; exit 1 ;;
esac
exit 0
FAKE
for c in curl sleep; do printf '#!/bin/bash\nexit 0\n' > "$WORK/bin/$c"; done
chmod +x "$WORK/bin/"*

fail=0
for s in deploy-staging.sh deploy-github-actions.sh deploy.sh; do
  # Each script runs inside an empty scratch repo dir so nothing real is touched.
  mkdir -p "$WORK/repo/scripts"
  cp "$SCRIPTS_DIR/$s" "$WORK/repo/scripts/"
  touch "$WORK/repo/.env.production" "$WORK/repo/docker-compose.yml" "$WORK/repo/docker-compose.prod.yml" "$WORK/repo/docker-compose.staging.yml"
  rm -f "$WORK/marker"
  (cd "$WORK/repo" && echo yes | PATH="$WORK/bin:$PATH" GUARD_MARKER="$WORK/marker" timeout 60 bash "scripts/$s" >"$WORK/$s.log" 2>&1)
  rc=$?
  # Pass only if the fake migrate failure really happened AND the script then exited non-zero.
  if [ -f "$WORK/marker" ] && [ $rc -ne 0 ]; then
    echo "PASS $s exited $rc after failing migrate deploy"
  else
    echo "FAIL $s exited $rc (marker: $([ -f "$WORK/marker" ] && echo hit || echo not-hit))"; tail -5 "$WORK/$s.log"; fail=1
  fi
done
exit $fail
