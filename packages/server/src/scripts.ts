export function generateSetupScript(serverUrl: string, _teamKey: string): string {
  return `#!/usr/bin/env bash
# ccusage-tracker 安裝
# Usage: curl -fsSL ${serverUrl}/setup.sh | bash
set -euo pipefail

SERVER_URL="${serverUrl}"
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
    echo "[ERR] 無法自動安裝 jq，請手動安裝後重試"
    exit 1
  fi
  echo "[OK] jq 已安裝"
else
  echo "[1/4] [OK] jq 已安裝"
fi

# ── 安裝 ccusage ──
if ! command -v ccusage &> /dev/null; then
  echo "[2/4] 安裝 ccusage..."
  if command -v npx &> /dev/null; then
    npm install -g ccusage@latest 2>/dev/null || npx ccusage@latest --version 2>/dev/null
  elif command -v bun &> /dev/null; then
    bun install -g ccusage@latest
  else
    echo "[ERR] 需要 npm 或 bun 來安裝 ccusage"
    echo "  安裝 Node.js: https://nodejs.org"
    echo "  或 Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
  echo "[OK] ccusage 已安裝"
else
  echo "[2/4] [OK] ccusage 已安裝"
fi

# ── 設定 ──
echo ""
printf "你的名字: "
read -r MEMBER_NAME < /dev/tty

if [ -z "\$MEMBER_NAME" ]; then
  echo "[ERR] 名字不能為空"
  exit 1
fi

printf "Team Key (向管理員索取): "
read -r TEAM_KEY < /dev/tty

if [ -z "\$TEAM_KEY" ]; then
  echo "[ERR] Team Key 不能為空"
  exit 1
fi

# 驗證 Team Key 是否正確
HTTP_CODE=\$(curl -s -o /dev/null -w "%{http_code}" \\
  -H "Authorization: Bearer \$TEAM_KEY" \\
  "\$SERVER_URL/api/report/summary?period=today" 2>/dev/null || echo "000")

if [ "\$HTTP_CODE" = "401" ]; then
  echo "[ERR] Team Key 無效，請確認後重試"
  exit 1
elif [ "\$HTTP_CODE" = "000" ]; then
  echo "[WARN] 無法連線 Server，Team Key 未驗證"
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
echo "[OK] Config 寫入 \$CONFIG_FILE"

# ── 下載 hook script ──
curl -fsSL "\$SERVER_URL/scripts/session-end.sh" -o "\$HOOK_SCRIPT"
chmod +x "\$HOOK_SCRIPT"
echo "[OK] Hook script 下載完成"

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
echo "[OK] SessionEnd hook 已安裝"

# ── 驗證 ──
echo ""
if curl -sf "\$SERVER_URL/api/health" > /dev/null 2>&1; then
  echo "[OK] Server 連線正常"
else
  echo "[WARN] Server 無法連線 (\$SERVER_URL)，但設定已完成"
fi

echo ""
echo "  ════════════════════════════════════"
echo "  [OK] 安裝完成！"
echo "  成員: \$MEMBER_NAME"
echo "  之後 Claude Code 用量會自動上報"
echo "  ════════════════════════════════════"
echo ""
`;
}

export function generateUninstallScript(serverUrl: string): string {
  return `#!/usr/bin/env bash
# ccusage-tracker 卸載
# Usage: curl -fsSL ${serverUrl}/uninstall.sh | bash
set -euo pipefail

CONFIG_DIR="\$HOME/.config/ccusage-tracker"
CLAUDE_SETTINGS="\$HOME/.claude/settings.json"

echo ""
echo "  ccusage-tracker 卸載程式"
echo "  ========================"
echo ""

# ── 移除 SessionEnd hook ──
if [ -f "\$CLAUDE_SETTINGS" ] && command -v jq &> /dev/null; then
  if jq -e '.hooks.SessionEnd' "\$CLAUDE_SETTINGS" > /dev/null 2>&1; then
    UPDATED=\$(jq '.hooks.SessionEnd |= map(select(.command | contains("ccusage-tracker") | not))' "\$CLAUDE_SETTINGS")
    echo "\$UPDATED" > "\$CLAUDE_SETTINGS"
    echo "[OK] SessionEnd hook 已移除"
  else
    echo "[--] 未發現 SessionEnd hook"
  fi
else
  echo "[--] 未發現 settings.json 或 jq"
fi

# ── 移除設定檔 ──
if [ -d "\$CONFIG_DIR" ]; then
  rm -rf "\$CONFIG_DIR"
  echo "[OK] 設定檔已移除 (\$CONFIG_DIR)"
else
  echo "[--] 未發現設定檔"
fi

echo ""
echo "  [OK] 卸載完成"
echo "  jq 和 ccusage 為獨立工具，已保留"
echo ""
`;
}

export function generateSessionEndScript(): string {
  return `#!/usr/bin/env bash
# ccusage-tracker SessionEnd hook
# 狀態同步器：每次 session 結束時，把本機今天的用量快照同步到 server
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

# 取得今天的用量快照（ccusage daily --jq 直接取 totals）
DATE_YYYYMMDD=\$(date +%Y%m%d)
DATE_DASH=\$(date +%Y-%m-%d)

TOTALS=\$(ccusage daily --json --since "\$DATE_YYYYMMDD" --jq '.totals' 2>/dev/null || echo "")
[ -z "\$TOTALS" ] && exit 0

# 從 totals 擷取數據（camelCase 欄位）
INPUT_TOKENS=\$(echo "\$TOTALS" | jq -r '.inputTokens // 0' 2>/dev/null || echo "0")
OUTPUT_TOKENS=\$(echo "\$TOTALS" | jq -r '.outputTokens // 0' 2>/dev/null || echo "0")
CACHE_CREATION=\$(echo "\$TOTALS" | jq -r '.cacheCreationTokens // 0' 2>/dev/null || echo "0")
CACHE_READ=\$(echo "\$TOTALS" | jq -r '.cacheReadTokens // 0' 2>/dev/null || echo "0")
TOTAL_COST=\$(echo "\$TOTALS" | jq -r '.totalCost // 0' 2>/dev/null || echo "0")

# 建構 JSON payload — session_id 固定為 "daily" 確保 UPSERT 冪等覆寫
BODY=\$(jq -n \\
  --arg member_name "\$MEMBER_NAME" \\
  --arg date "\$DATE_DASH" \\
  --arg session_id "daily" \\
  --argjson input_tokens "\$INPUT_TOKENS" \\
  --argjson output_tokens "\$OUTPUT_TOKENS" \\
  --argjson cache_creation_tokens "\$CACHE_CREATION" \\
  --argjson cache_read_tokens "\$CACHE_READ" \\
  --argjson total_cost_usd "\$TOTAL_COST" \\
  '{
    member_name: \$member_name,
    date: \$date,
    session_id: \$session_id,
    input_tokens: \$input_tokens,
    output_tokens: \$output_tokens,
    cache_creation_tokens: \$cache_creation_tokens,
    cache_read_tokens: \$cache_read_tokens,
    total_cost_usd: \$total_cost_usd,
    models: []
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
