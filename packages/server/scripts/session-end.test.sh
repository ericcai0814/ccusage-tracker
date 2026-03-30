#!/usr/bin/env bash
# Basic smoke tests for session-end.sh hook
# Verifies: exits 0 when config missing, exits 0 when ccusage missing

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/session-end.sh"
PASS=0
FAIL=0

assert_exit_0() {
  local desc="$1"
  shift
  if "$@" < /dev/null > /dev/null 2>&1; then
    echo "PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc (exit code: $?)"
    FAIL=$((FAIL + 1))
  fi
}

# Test 1: Should exit 0 when config file doesn't exist
HOME_BACKUP="$HOME"
export HOME=$(mktemp -d)
assert_exit_0 "exits 0 when config missing" bash "$HOOK"
export HOME="$HOME_BACKUP"

# Test 2: Should exit 0 with empty stdin
export HOME=$(mktemp -d)
mkdir -p "$HOME/.config/ccusage-tracker"
echo '{"server_url":"http://localhost:9999","api_key":"sk-test","member_name":"test"}' > "$HOME/.config/ccusage-tracker/config.json"

# Only run if ccusage is NOT installed (testing graceful exit)
if ! command -v ccusage &> /dev/null; then
  assert_exit_0 "exits 0 when ccusage not installed" bash "$HOOK"
else
  echo "SKIP: ccusage is installed, skipping missing-ccusage test"
fi

export HOME="$HOME_BACKUP"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] && exit 0 || exit 1
