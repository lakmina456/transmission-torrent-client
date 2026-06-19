#!/bin/bash
# CloudSeed deploy — pull from git and sync web UI + services on the VPS.
# Usage:
#   deploy.sh          Full deploy (requires root for chown/systemctl)
#   deploy.sh check    JSON status: current vs remote commit (exit 0 always if readable)
set -euo pipefail

if [[ -f /etc/cloudseed/deploy.env ]]; then
  # shellcheck source=/dev/null
  source /etc/cloudseed/deploy.env
fi

REPO="${CLOUDSEED_REPO:-/opt/cloudseed/src}"
WEB="${CLOUDSEED_WEB:-/var/lib/transmission-daemon/info/web}"
ZIP="${CLOUDSEED_ZIP:-/opt/cloudseed/zipper.py}"
UPDATER="${CLOUDSEED_UPDATER:-/opt/cloudseed/updater.py}"
OPT_ROOT="${CLOUDSEED_OPT:-/opt/cloudseed}"
BRANCH="${CLOUDSEED_BRANCH:-main}"
REMOTE="${CLOUDSEED_REMOTE:-origin}"

die() {
  echo "deploy.sh: $*" >&2
  exit 1
}

[[ -d "$REPO/.git" ]] || die "git repo not found at $REPO"

repo_owner() {
  stat -c '%U' "$REPO" 2>/dev/null || echo root
}

run_git() {
  local owner
  owner="$(repo_owner)"
  if [[ "$(id -un)" == root && "$owner" != root ]]; then
    sudo -u "$owner" git -C "$REPO" "$@"
  else
    git -C "$REPO" "$@"
  fi
}

git_fetch() {
  run_git fetch "$REMOTE" --prune
}

current_commit() {
  run_git rev-parse HEAD
}

current_short() {
  run_git rev-parse --short HEAD
}

remote_commit() {
  run_git rev-parse "$REMOTE/$BRANCH" 2>/dev/null || echo ""
}

behind_count() {
  local cur rem
  cur="$(current_commit)"
  rem="$(remote_commit)"
  [[ -n "$rem" ]] || echo "0"
  run_git rev-list --count "${cur}..${rem}" 2>/dev/null || echo "0"
}

write_check_json() {
  git_fetch || true
  local cur short rem behind avail
  cur="$(current_commit)"
  short="$(current_short)"
  rem="$(remote_commit)"
  behind="$(behind_count)"
  avail=false
  [[ -n "$rem" && "$cur" != "$rem" && "$behind" != "0" ]] && avail=true
  printf '{"current":"%s","currentShort":"%s","remote":"%s","branch":"%s","behind":%s,"updateAvailable":%s}\n' \
    "$cur" "$short" "$rem" "$BRANCH" "$behind" "$avail"
}

if [[ "${1:-}" == "check" ]]; then
  write_check_json
  exit 0
fi

# ── Full deploy ─────────────────────────────────────────────────────────────
git_fetch
run_git checkout "$BRANCH"
run_git pull --ff-only "$REMOTE" "$BRANCH"

COMMIT="$(current_commit)"
SHORT="$(current_short)"

if [[ -f "$WEB/config.js" ]]; then
  cp "$WEB/config.js" /tmp/cloudseed-config.js.bak
fi

rsync -a --delete \
  --exclude 'config.js' \
  --exclude 'version.json' \
  "$REPO/web/public_html/" "$WEB/"

if [[ -f /tmp/cloudseed-config.js.bak ]]; then
  cp /tmp/cloudseed-config.js.bak "$WEB/config.js"
  rm -f /tmp/cloudseed-config.js.bak
fi

mkdir -p "$OPT_ROOT"
cp "$REPO/server/zipper.py" "$ZIP"
cp "$REPO/server/updater.py" "$UPDATER"
cp "$REPO/server/deploy.sh" "$OPT_ROOT/deploy.sh"
chmod +x "$OPT_ROOT/deploy.sh" "$ZIP" "$UPDATER"

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$WEB/version.json" <<EOF
{"commit":"$SHORT","commitFull":"$COMMIT","branch":"$BRANCH","updatedAt":"$NOW"}
EOF

chown -R debian-transmission:debian-transmission "$WEB"

systemctl restart cloudseed-zipper
systemctl try-restart cloudseed-updater 2>/dev/null || true

echo "Deployed $SHORT ($COMMIT) at $NOW"
