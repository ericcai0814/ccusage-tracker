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

# Exit silently if jq is not installed (required for safe JSON handling)
if ! command -v jq &> /dev/null; then
  exit 0
fi

# Exit silently if ccusage is not installed
if ! command -v ccusage &> /dev/null; then
  exit 0
fi

# Read config safely with jq
SERVER_URL=$(jq -r '.server_url // empty' "$CONFIG_FILE" 2>/dev/null || true)
API_KEY=$(jq -r '.api_key // empty' "$CONFIG_FILE" 2>/dev/null || true)

# Exit if config is incomplete
if [ -z "$SERVER_URL" ] || [ -z "$API_KEY" ]; then
  exit 0
fi

# Read hook payload from stdin (may be empty or malformed)
SESSION_ID=""
if read -t 1 PAYLOAD 2>/dev/null; then
  SESSION_ID=$(echo "$PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null || true)
fi

# Call ccusage to get session data
CCUSAGE_OUTPUT=$(ccusage session --json --since today 2>/dev/null || echo "")

# Exit if ccusage returned nothing useful
if [ -z "$CCUSAGE_OUTPUT" ]; then
  exit 0
fi

# Extract token data safely with jq, defaulting to 0
DATE=$(date +%Y-%m-%d)
INPUT_TOKENS=$(echo "$CCUSAGE_OUTPUT" | jq -r '.input_tokens // 0' 2>/dev/null || echo "0")
OUTPUT_TOKENS=$(echo "$CCUSAGE_OUTPUT" | jq -r '.output_tokens // 0' 2>/dev/null || echo "0")
CACHE_CREATION=$(echo "$CCUSAGE_OUTPUT" | jq -r '.cache_creation_tokens // 0' 2>/dev/null || echo "0")
CACHE_READ=$(echo "$CCUSAGE_OUTPUT" | jq -r '.cache_read_tokens // 0' 2>/dev/null || echo "0")
TOTAL_COST=$(echo "$CCUSAGE_OUTPUT" | jq -r '.total_cost_usd // 0' 2>/dev/null || echo "0")
MODELS=$(echo "$CCUSAGE_OUTPUT" | jq -c '.models // []' 2>/dev/null || echo "[]")

# Build JSON payload safely with jq — only token counts, no conversation content
BODY=$(jq -n \
  --arg date "$DATE" \
  --arg session_id "$SESSION_ID" \
  --argjson input_tokens "${INPUT_TOKENS}" \
  --argjson output_tokens "${OUTPUT_TOKENS}" \
  --argjson cache_creation_tokens "${CACHE_CREATION}" \
  --argjson cache_read_tokens "${CACHE_READ}" \
  --argjson total_cost_usd "${TOTAL_COST}" \
  --argjson models "${MODELS}" \
  '{
    date: $date,
    session_id: $session_id,
    input_tokens: $input_tokens,
    output_tokens: $output_tokens,
    cache_creation_tokens: $cache_creation_tokens,
    cache_read_tokens: $cache_read_tokens,
    total_cost_usd: $total_cost_usd,
    models: $models
  }')

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
