export function generateSetupScript(serverUrl: string, teamKey: string): string {
  return `#!/usr/bin/env bash
# ccusage-tracker 一鍵安裝
# Usage: curl -fsSL ${serverUrl}/setup.sh | bash
set -euo pipefail

SERVER_URL="${serverUrl}"
TEAM_KEY="${teamKey}"
CONFIG_DIR="\$HOME/.config/ccusage-tracker"
CONFIG_FILE="\$CONFIG_DIR/config.json"
HOOK_SCRIPT="\$CONFIG_DIR/session-end.sh"
CLAUDE_SETTINGS="\$HOME/.claude/settings.json"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     ccusage-tracker 安裝程式         ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── 安裝 jq ──
if ! command -v jq &> /dev/null; then
  echo "[1/4] 安裝 jq..."
  if command -v brew &> /dev/null; then
    brew install jq
  elif command -v apt-get &> /dev/null; then
    sudo apt-get install -y jq
  elif command -v apk &> /dev/null; then
    sudo apk add jq
  else
    echo "❌ 無法自動安裝 jq，請手動安裝後重試"
    exit 1
  fi
  echo "✓ jq 已安裝"
else
  echo "[1/4] ✓ jq 已安裝"
fi

# ── 安裝 ccusage ──
if ! command -v ccusage &> /dev/null; then
  echo "[2/4] 安裝 ccusage..."
  if command -v npx &> /dev/null; then
    npm install -g ccusage@latest 2>/dev/null || npx ccusage@latest --version 2>/dev/null
  elif command -v bun &> /dev/null; then
    bun install -g ccusage@latest
  else
    echo "❌ 需要 npm 或 bun 來安裝 ccusage"
    echo "  安裝 Node.js: https://nodejs.org"
    echo "  或 Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
  echo "✓ ccusage 已安裝"
else
  echo "[2/4] ✓ ccusage 已安裝"
fi

# ── 設定 ──
echo ""
printf "你的名字: "
read -r MEMBER_NAME

if [ -z "\$MEMBER_NAME" ]; then
  echo "❌ 名字不能為空"
  exit 1
fi

echo ""
echo "[3/4] 寫入設定..."
mkdir -p "\$CONFIG_DIR"

cat > "\$CONFIG_FILE" << CONF
{
  "server_url": "\$SERVER_URL",
  "team_key": "\$TEAM_KEY",
  "member_name": "\$MEMBER_NAME"
}
CONF
echo "✓ Config 寫入 \$CONFIG_FILE"

# ── 下載 hook script ──
curl -fsSL "\$SERVER_URL/scripts/session-end.sh" -o "\$HOOK_SCRIPT"
chmod +x "\$HOOK_SCRIPT"
echo "✓ Hook script 下載完成"

# ── 安裝 SessionEnd hook ──
echo "[4/4] 安裝 Claude Code SessionEnd hook..."

HOOK_CMD="bash \$HOOK_SCRIPT"

if [ -f "\$CLAUDE_SETTINGS" ]; then
  cp "\$CLAUDE_SETTINGS" "\$CLAUDE_SETTINGS.backup"
  echo "  (已備份 settings.json)"
else
  mkdir -p "\$HOME/.claude"
  echo '{}' > "\$CLAUDE_SETTINGS"
fi

# 用 jq 安全地 deep merge hook
UPDATED=\$(jq --arg cmd "\$HOOK_CMD" '
  .hooks //= {} |
  .hooks.SessionEnd //= [] |
  if (.hooks.SessionEnd | map(.command) | index(\$cmd)) then .
  else .hooks.SessionEnd += [{"type": "command", "command": \$cmd}]
  end
' "\$CLAUDE_SETTINGS")

echo "\$UPDATED" > "\$CLAUDE_SETTINGS"
echo "✓ SessionEnd hook 已安裝"

# ── 驗證 ──
echo ""
if curl -sf "\$SERVER_URL/api/health" > /dev/null 2>&1; then
  echo "✓ Server 連線正常"
else
  echo "⚠ Server 無法連線 (\$SERVER_URL)，但設定已完成"
fi

echo ""
echo "  ════════════════════════════════════"
echo "  ✓ 安裝完成！"
echo "  成員: \$MEMBER_NAME"
echo "  之後 Claude Code 用量會自動上報"
echo "  ════════════════════════════════════"
echo ""
`;
}

export function generateSessionEndScript(): string {
  return `#!/usr/bin/env bash
# ccusage-tracker SessionEnd hook
# 自動在 Claude Code session 結束時上報 token 用量
set -euo pipefail

CONFIG_FILE="\$HOME/.config/ccusage-tracker/config.json"

# 靜默退出：config 不存在
[ ! -f "\$CONFIG_FILE" ] && exit 0

# 靜默退出：jq 未安裝
command -v jq &> /dev/null || exit 0

# 靜默退出：ccusage 未安裝
command -v ccusage &> /dev/null || exit 0

# 讀取 config
SERVER_URL=\$(jq -r '.server_url // empty' "\$CONFIG_FILE" 2>/dev/null || true)
TEAM_KEY=\$(jq -r '.team_key // empty' "\$CONFIG_FILE" 2>/dev/null || true)
MEMBER_NAME=\$(jq -r '.member_name // empty' "\$CONFIG_FILE" 2>/dev/null || true)

[ -z "\$SERVER_URL" ] || [ -z "\$TEAM_KEY" ] || [ -z "\$MEMBER_NAME" ] && exit 0

# 讀取 hook payload（可能為空）
SESSION_ID=""
if read -t 1 PAYLOAD 2>/dev/null; then
  SESSION_ID=\$(echo "\$PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null || true)
fi

# 呼叫 ccusage 取得 session 數據
CCUSAGE_OUTPUT=\$(ccusage session --json --since today 2>/dev/null || echo "")
[ -z "\$CCUSAGE_OUTPUT" ] && exit 0

# 安全擷取數據
DATE=\$(date +%Y-%m-%d)
INPUT_TOKENS=\$(echo "\$CCUSAGE_OUTPUT" | jq -r '.input_tokens // 0' 2>/dev/null || echo "0")
OUTPUT_TOKENS=\$(echo "\$CCUSAGE_OUTPUT" | jq -r '.output_tokens // 0' 2>/dev/null || echo "0")
CACHE_CREATION=\$(echo "\$CCUSAGE_OUTPUT" | jq -r '.cache_creation_tokens // 0' 2>/dev/null || echo "0")
CACHE_READ=\$(echo "\$CCUSAGE_OUTPUT" | jq -r '.cache_read_tokens // 0' 2>/dev/null || echo "0")
TOTAL_COST=\$(echo "\$CCUSAGE_OUTPUT" | jq -r '.total_cost_usd // 0' 2>/dev/null || echo "0")
MODELS=\$(echo "\$CCUSAGE_OUTPUT" | jq -c '.models // []' 2>/dev/null || echo "[]")

# 用 jq 安全建構 JSON payload
BODY=\$(jq -n \\
  --arg member_name "\$MEMBER_NAME" \\
  --arg date "\$DATE" \\
  --arg session_id "\$SESSION_ID" \\
  --argjson input_tokens "\$INPUT_TOKENS" \\
  --argjson output_tokens "\$OUTPUT_TOKENS" \\
  --argjson cache_creation_tokens "\$CACHE_CREATION" \\
  --argjson cache_read_tokens "\$CACHE_READ" \\
  --argjson total_cost_usd "\$TOTAL_COST" \\
  --argjson models "\$MODELS" \\
  '{
    member_name: \$member_name,
    date: \$date,
    session_id: \$session_id,
    input_tokens: \$input_tokens,
    output_tokens: \$output_tokens,
    cache_creation_tokens: \$cache_creation_tokens,
    cache_read_tokens: \$cache_read_tokens,
    total_cost_usd: \$total_cost_usd,
    models: \$models
  }')

# 背景 POST — 不阻塞 Claude Code
curl -s -X POST \\
  "\$SERVER_URL/api/ingest" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \$TEAM_KEY" \\
  -d "\$BODY" \\
  --connect-timeout 5 \\
  --max-time 10 \\
  > /dev/null 2>&1 &

exit 0
`;
}
