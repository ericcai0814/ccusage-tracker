export function generateSetupScript(serverUrl: string, _teamKey: string): string {
  return `#!/usr/bin/env bash
# ccusage-tracker 安裝
# Usage: curl -fsSL ${serverUrl}/setup.sh | bash
set -euo pipefail

SERVER_URL="${serverUrl}"
CONFIG_DIR="\$HOME/.config/ccusage-tracker"
CONFIG_FILE="\$CONFIG_DIR/config.json"
HOOK_SCRIPT="\$CONFIG_DIR/session-end.sh"
HOOK_START_SCRIPT="\$CONFIG_DIR/session-start.sh"
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

# ── 下載 hook scripts ──
curl -fsSL "\$SERVER_URL/scripts/session-end.sh" -o "\$HOOK_SCRIPT"
chmod +x "\$HOOK_SCRIPT"
curl -fsSL "\$SERVER_URL/scripts/session-start.sh" -o "\$HOOK_START_SCRIPT"
chmod +x "\$HOOK_START_SCRIPT"
echo "[OK] Hook scripts 下載完成"

# ── 安裝 SessionStart + SessionEnd hooks ──
echo "[4/4] 安裝 Claude Code hooks..."

HOOK_START_CMD="bash \$HOOK_START_SCRIPT"
HOOK_CMD="bash \$HOOK_SCRIPT"

if [ -f "\$CLAUDE_SETTINGS" ]; then
  cp "\$CLAUDE_SETTINGS" "\$CLAUDE_SETTINGS.backup"
  echo "  (已備份 settings.json)"
else
  mkdir -p "\$HOME/.claude"
  echo '{}' > "\$CLAUDE_SETTINGS"
fi

# 用 jq 安全地 deep merge hooks
UPDATED=\$(jq --arg startcmd "\$HOOK_START_CMD" --arg endcmd "\$HOOK_CMD" '
  .hooks //= {} |
  .hooks.SessionStart //= [] |
  .hooks.SessionEnd //= [] |
  if [.hooks.SessionStart[]?.hooks[]?.command] | index(\$startcmd) then .
  else .hooks.SessionStart += [{"matcher": "", "hooks": [{"type": "command", "command": \$startcmd}]}]
  end |
  if [.hooks.SessionEnd[]?.hooks[]?.command] | index(\$endcmd) then .
  else .hooks.SessionEnd += [{"matcher": "", "hooks": [{"type": "command", "command": \$endcmd}]}]
  end
' "\$CLAUDE_SETTINGS")

echo "\$UPDATED" > "\$CLAUDE_SETTINGS"
echo "[OK] SessionStart + SessionEnd hooks 已安裝"

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
    UPDATED=\$(jq '.hooks.SessionEnd |= map(select(.hooks // [] | any(.command | contains("ccusage-tracker")) | not))' "\$CLAUDE_SETTINGS")
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

export function generateSessionStartScript(): string {
  return `#!/usr/bin/env bash
# ccusage-tracker SessionStart hook
# 記錄 session 使用的 model，供 SessionEnd 計算 context 佔比
set -euo pipefail

SESSIONS_DIR="\$HOME/.config/ccusage-tracker/sessions"

read -t 1 PAYLOAD 2>/dev/null || exit 0
SESSION_ID=\$(echo "\$PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null || true)
MODEL=\$(echo "\$PAYLOAD" | jq -r '.model // empty' 2>/dev/null || true)

[ -z "\$SESSION_ID" ] && exit 0
[ -z "\$MODEL" ] && exit 0

mkdir -p "\$SESSIONS_DIR"
echo "\$MODEL" > "\$SESSIONS_DIR/\$SESSION_ID"

exit 0
`;
}

export function generateSessionEndScript(): string {
  return `#!/usr/bin/env bash
# ccusage-tracker SessionEnd hook v4
# 狀態同步器：每次 session 結束時，把本機今天的用量快照 + session 行為指標同步到 server
# v4: 新增 model 感知的 context window 佔比估算
set -euo pipefail

CONFIG_FILE="\$HOME/.config/ccusage-tracker/config.json"
BUFFER_FILE="\$HOME/.config/ccusage-tracker/buffer.jsonl"

# 靜默退出：config 不存在
[ ! -f "\$CONFIG_FILE" ] && exit 0

# 靜默退出：jq 未安裝
command -v jq &> /dev/null || exit 0

# 讀取 config
SERVER_URL=\$(jq -r '.server_url // empty' "\$CONFIG_FILE" 2>/dev/null || true)
TEAM_KEY=\$(jq -r '.team_key // empty' "\$CONFIG_FILE" 2>/dev/null || true)
MEMBER_NAME=\$(jq -r '.member_name // empty' "\$CONFIG_FILE" 2>/dev/null || true)

[ -z "\$SERVER_URL" ] || [ -z "\$TEAM_KEY" ] || [ -z "\$MEMBER_NAME" ] && exit 0

# 讀取 hook payload（stdin 只能讀一次，必須在所有邏輯之前）
HOOK_PAYLOAD=""
read -t 1 HOOK_PAYLOAD 2>/dev/null || true
TRANSCRIPT_PATH=\$(echo "\$HOOK_PAYLOAD" | jq -r '.transcript_path // empty' 2>/dev/null || true)
HOOK_SESSION_ID=\$(echo "\$HOOK_PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null || true)

# 讀取 SessionStart 記錄的 model
SESSIONS_DIR="\$HOME/.config/ccusage-tracker/sessions"
SESSION_MODEL=""
if [ -n "\$HOOK_SESSION_ID" ] && [ -f "\$SESSIONS_DIR/\$HOOK_SESSION_ID" ]; then
  SESSION_MODEL=\$(cat "\$SESSIONS_DIR/\$HOOK_SESSION_ID" 2>/dev/null || true)
  rm -f "\$SESSIONS_DIR/\$HOOK_SESSION_ID" 2>/dev/null
fi

# Model → context window 上限（tokens）
case "\$SESSION_MODEL" in
  *opus*) CONTEXT_LIMIT=200000 ;;
  *sonnet*) CONTEXT_LIMIT=200000 ;;
  *haiku*) CONTEXT_LIMIT=200000 ;;
  *) CONTEXT_LIMIT=200000 ;;
esac

# ── 重送暫存 (set +e，個別失敗不中斷) ──
set +e
if [ -f "\$BUFFER_FILE" ] && [ -s "\$BUFFER_FILE" ]; then
  TEMP_FILE="\${BUFFER_FILE}.tmp"
  : > "\$TEMP_FILE" 2>/dev/null
  RETRY_START=\$(date +%s)

  while IFS= read -r LINE; do
    # 15 秒總時限
    NOW=\$(date +%s)
    if [ \$((NOW - RETRY_START)) -ge 15 ]; then
      # 超時：剩餘行全部保留
      echo "\$LINE" >> "\$TEMP_FILE" 2>/dev/null
      continue
    fi

    HTTP_CODE=\$(curl -s -o /dev/null -w '%{http_code}' -X POST \\
      "\$SERVER_URL/api/ingest" \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer \$TEAM_KEY" \\
      -d "\$LINE" \\
      --connect-timeout 3 \\
      --max-time 5 2>/dev/null || echo "000")

    if [ "\$HTTP_CODE" -ge 200 ] && [ "\$HTTP_CODE" -lt 300 ] 2>/dev/null; then
      : # 成功，不寫入 temp
    else
      echo "\$LINE" >> "\$TEMP_FILE" 2>/dev/null
    fi
  done < "\$BUFFER_FILE"

  # 過期清理：移除 _buffered_at 超過 7 天或無法解析的條目
  if [ -s "\$TEMP_FILE" ]; then
    EXPIRE_CUTOFF=\$(date -u -v-7d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S 2>/dev/null || echo "")
    if [ -n "\$EXPIRE_CUTOFF" ]; then
      CLEAN_FILE="\${BUFFER_FILE}.clean"
      : > "\$CLEAN_FILE" 2>/dev/null
      while IFS= read -r LINE; do
        BA=\$(echo "\$LINE" | jq -r '._buffered_at // empty' 2>/dev/null || echo "")
        if [ -z "\$BA" ] || [ "\$BA" \\< "\$EXPIRE_CUTOFF" ]; then
          : # 過期或無法解析，丟棄
        else
          echo "\$LINE" >> "\$CLEAN_FILE" 2>/dev/null
        fi
      done < "\$TEMP_FILE"
      mv "\$CLEAN_FILE" "\$BUFFER_FILE" 2>/dev/null || true
    else
      mv "\$TEMP_FILE" "\$BUFFER_FILE" 2>/dev/null || true
    fi
    rm -f "\$TEMP_FILE" 2>/dev/null
  else
    mv "\$TEMP_FILE" "\$BUFFER_FILE" 2>/dev/null || true
  fi
  # 清除空的 buffer 檔
  [ -f "\$BUFFER_FILE" ] && [ ! -s "\$BUFFER_FILE" ] && rm -f "\$BUFFER_FILE" 2>/dev/null
fi
set -e

# ── Session Metrics 萃取 + POST（背景執行） ──
_post_session_metrics() {
  [ -z "\$TRANSCRIPT_PATH" ] && return 0
  [ ! -f "\$TRANSCRIPT_PATH" ] && return 0

  METRICS=\$(jq -s '
  {
    session_id: (map(select(.sessionId != null) | .sessionId) | first // ""),
    session_name: (map(select(.slug != null) | .slug) | first // ""),
    project: (map(select(.cwd != null) | .cwd) | first // "" | split("/") | last),
    branch: (map(select(.gitBranch != null) | .gitBranch) | first // ""),
    turns: [.[] | select(.type == "user" and .userType == "external")] | length,
    user_messages: [.[] | select(.type == "user")] | length,
    assistant_messages: [.[] | select(.type == "assistant")] | length,
    user_avg_chars: ([.[] | select(.type == "user" and .userType == "external") | .message.content |
      if type == "string" then length
      elif type == "array" then [.[] | select(.type == "text") | .text | length] | add // 0
      else 0 end] | if length > 0 then (add / length | floor) else 0 end),
    tool_calls: ([.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | .name] | group_by(.) | map({(.[0]): length}) | add // {}),
    tool_call_total: [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")] | length,
    tool_errors: [.[] | select(.type == "user") | .message.content[]? | select(.type == "tool_result" and .is_error == true)] | length,
    started_at: ([.[] | select(.timestamp != null) | .timestamp] | sort | first // ""),
    ended_at: ([.[] | select(.timestamp != null) | .timestamp] | sort | last // ""),
    duration_minutes: (([.[] | select(.timestamp != null) | .timestamp] | sort | {s: first, e: last}) |
      if .s and .e then (((.e | sub("\\\\.[0-9]+Z$"; "Z") | fromdateiso8601) - (.s | sub("\\\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 60 | floor)
      else 0 end),
    has_commit: ([.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "Bash") | .input.command // "" | test("git commit")] | any),
    files_read: [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "Read")] | length,
    files_written: [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "Write")] | length,
    files_edited: [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "Edit")] | length,
    skills_invoked: ([.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "Skill") | .input.skill // empty] | unique),
    hook_blocks: 0,
    approx_tokens: ([.[] | select(.type == "user" or .type == "assistant") | .message.content |
      if type == "string" then length
      elif type == "array" then [.[] |
        if .type == "text" then (.text | length)
        elif .type == "tool_use" then ((.input | tostring | length) + 50)
        elif .type == "tool_result" then ((.content // "" | if type == "string" then length elif type == "array" then [.[] | .text // "" | length] | add else 0 end) + 20)
        else 50 end
      ] | add
      else 0 end
    ] | add // 0 | . / 4 | floor)
  }' "\$TRANSCRIPT_PATH" 2>/dev/null || echo "")

  [ -z "\$METRICS" ] && return 0

  # 計算 context 佔比
  APPROX_TOKENS=\$(echo "\$METRICS" | jq -r '.approx_tokens // 0' 2>/dev/null || echo "0")
  CONTEXT_PCT=\$(( APPROX_TOKENS * 100 / CONTEXT_LIMIT ))
  [ "\$CONTEXT_PCT" -gt 100 ] && CONTEXT_PCT=100

  BODY=\$(echo "\$METRICS" | jq -c --arg mn "\$MEMBER_NAME" --arg model "\$SESSION_MODEL" --argjson cpct "\$CONTEXT_PCT" 'del(.approx_tokens) + {member_name: \$mn, model: \$model, context_estimate_pct: \$cpct}' 2>/dev/null || echo "")
  [ -z "\$BODY" ] && return 0

  curl -s -o /dev/null -X POST \\
    "\$SERVER_URL/api/ingest/session" \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer \$TEAM_KEY" \\
    -d "\$BODY" \\
    --connect-timeout 5 \\
    --max-time 10 2>/dev/null || true
}
_post_session_metrics &

# ── 收集當次用量並 POST（背景執行） ──
_post_current() {
  command -v ccusage &> /dev/null || return 0

  DATE_YYYYMMDD=\$(date +%Y%m%d)
  DATE_DASH=\$(date +%Y-%m-%d)

  TOTALS=\$(ccusage daily --json --since "\$DATE_YYYYMMDD" --jq '.totals' 2>/dev/null || echo "")
  [ -z "\$TOTALS" ] && return 0

  INPUT_TOKENS=\$(echo "\$TOTALS" | jq -r '.inputTokens // 0' 2>/dev/null || echo "0")
  OUTPUT_TOKENS=\$(echo "\$TOTALS" | jq -r '.outputTokens // 0' 2>/dev/null || echo "0")
  CACHE_CREATION=\$(echo "\$TOTALS" | jq -r '.cacheCreationTokens // 0' 2>/dev/null || echo "0")
  CACHE_READ=\$(echo "\$TOTALS" | jq -r '.cacheReadTokens // 0' 2>/dev/null || echo "0")
  TOTAL_COST=\$(echo "\$TOTALS" | jq -r '.totalCost // 0' 2>/dev/null || echo "0")

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

  HTTP_CODE=\$(curl -s -o /dev/null -w '%{http_code}' -X POST \\
    "\$SERVER_URL/api/ingest" \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer \$TEAM_KEY" \\
    -d "\$BODY" \\
    --connect-timeout 5 \\
    --max-time 10 2>/dev/null || echo "000")

  if ! ( [ "\$HTTP_CODE" -ge 200 ] && [ "\$HTTP_CODE" -lt 300 ] ) 2>/dev/null; then
    BUFFERED=\$(echo "\$BODY" | jq -c --arg ts "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" '. + {_buffered_at: \$ts}' 2>/dev/null || echo "")
    [ -n "\$BUFFERED" ] && echo "\$BUFFERED" >> "\$BUFFER_FILE" 2>/dev/null || true
  fi
}
_post_current &

exit 0
`;
}
