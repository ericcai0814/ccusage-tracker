#!/usr/bin/env bash
# SessionEnd hook for ccusage-tracker
# Reads Claude Code hook payload from stdin, calls ccusage to get token data,
# and POSTs it to the configured server. Always exits 0 to never block Claude Code.

set -euo pipefail

CONFIG_FILE="${HOME}/.config/ccusage-tracker/config.json"

# Exit silently if config doesn't exist
if [ ! -f "$CONFIG_FILE" ]; then
  exit 0
fi

# Exit silently if ccusage is not installed
if ! command -v ccusage &> /dev/null; then
  exit 0
fi

# Read config
SERVER_URL=$(cat "$CONFIG_FILE" | grep -o '"server_url"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"server_url"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/')
API_KEY=$(cat "$CONFIG_FILE" | grep -o '"api_key"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"api_key"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/')

# Exit if config is incomplete
if [ -z "$SERVER_URL" ] || [ -z "$API_KEY" ]; then
  exit 0
fi

# Read hook payload from stdin (may be empty or malformed)
SESSION_ID=""
if read -t 1 PAYLOAD 2>/dev/null; then
  SESSION_ID=$(echo "$PAYLOAD" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/' 2>/dev/null || true)
fi

# Call ccusage to get session data
CCUSAGE_OUTPUT=$(ccusage session --json --since today 2>/dev/null || echo "")

# Exit if ccusage returned nothing useful
if [ -z "$CCUSAGE_OUTPUT" ]; then
  exit 0
fi

# Extract token data from ccusage output (expects JSON)
DATE=$(date +%Y-%m-%d)
INPUT_TOKENS=$(echo "$CCUSAGE_OUTPUT" | grep -o '"input_tokens"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*$' || echo "0")
OUTPUT_TOKENS=$(echo "$CCUSAGE_OUTPUT" | grep -o '"output_tokens"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*$' || echo "0")
CACHE_CREATION=$(echo "$CCUSAGE_OUTPUT" | grep -o '"cache_creation_tokens"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*$' || echo "0")
CACHE_READ=$(echo "$CCUSAGE_OUTPUT" | grep -o '"cache_read_tokens"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*$' || echo "0")
TOTAL_COST=$(echo "$CCUSAGE_OUTPUT" | grep -o '"total_cost_usd"[[:space:]]*:[[:space:]]*[0-9.]*' | head -1 | grep -o '[0-9.]*$' || echo "0")
MODELS=$(echo "$CCUSAGE_OUTPUT" | grep -o '"models"[[:space:]]*:[[:space:]]*\[[^]]*\]' | head -1 | sed 's/"models"[[:space:]]*:[[:space:]]*//' || echo "[]")

# Build JSON payload — only token counts, no conversation content
BODY=$(cat <<EOF
{
  "date": "${DATE}",
  "session_id": "${SESSION_ID}",
  "input_tokens": ${INPUT_TOKENS:-0},
  "output_tokens": ${OUTPUT_TOKENS:-0},
  "cache_creation_tokens": ${CACHE_CREATION:-0},
  "cache_read_tokens": ${CACHE_READ:-0},
  "total_cost_usd": ${TOTAL_COST:-0},
  "models": ${MODELS:-[]}
}
EOF
)

# POST to server in background — non-blocking
curl -s -X POST \
  "${SERVER_URL}/api/ingest" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d "$BODY" \
  --connect-timeout 5 \
  --max-time 10 \
  > /dev/null 2>&1 &

# Always exit 0
exit 0
