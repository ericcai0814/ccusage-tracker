// UI 比較用的示範資料：固定亂數種子，每次產出同樣的 6 人 × 近 35 天用量（Claude＋Codex）、
// session 指標與月預算，讓不同版本的畫面能在同一份資料上截圖比較。
// 用法：bun run scripts/seed-demo.ts <db 路徑>（檔案已存在會先刪掉）
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase } from "../src/db";
import { insertMember, hashApiKey, insertUsageRecord, insertSessionMetrics } from "../src/queries";
import { setSetting, MONTHLY_BUDGET_KEY } from "../src/settings";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: bun run scripts/seed-demo.ts <db-path>");
  process.exit(1);
}
if (existsSync(dbPath)) unlinkSync(dbPath);

let seed = 20261121;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

const MEMBERS = [
  { id: "m1", name: "Eric", claude: 9.5, codex: 2.2 },
  { id: "m2", name: "Johnson", claude: 6.1, codex: 0 },
  { id: "m3", name: "Wendy", claude: 4.3, codex: 1.6 },
  { id: "m4", name: "Kevin", claude: 2.8, codex: 3.4 },
  { id: "m5", name: "Amy", claude: 1.9, codex: 0 },
  { id: "m6", name: "Leo", claude: 0.7, codex: 0.4 },
];
const CLAUDE_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"];
const CODEX_MODELS = ["gpt-5.1-codex", "gpt-5.1-codex-mini"];
const PROJECTS = ["ccusage-tracker", "one-tsa", "bigtable-web", "ewill-web"];

const db = createDatabase(dbPath);
setSetting(db, MONTHLY_BUDGET_KEY, "450");

const today = new Date();
for (const m of MEMBERS) {
  insertMember(db, m.id, m.name, hashApiKey(`demo-${m.id}`));
  for (let back = 34; back >= 0; back--) {
    const day = new Date(today.getTime() - back * 86400000);
    const date = day.toISOString().split("T")[0];
    const weekday = day.getUTCDay();
    const workday = weekday !== 0 && weekday !== 6;
    // Leo 最近三天沒回報，用來看「回報過期」的樣子
    if (m.id === "m6" && back < 3) continue;
    if (!workday && rand() > 0.25) continue;

    const claudeCost = m.claude * (0.55 + rand() * 0.9);
    const tokens = Math.round(claudeCost * 260000);
    insertUsageRecord(db, m.id, {
      member_name: m.name,
      date,
      session_id: "daily",
      input_tokens: Math.round(tokens * 0.08),
      output_tokens: Math.round(tokens * 0.04),
      cache_creation_tokens: Math.round(tokens * 0.13),
      cache_read_tokens: Math.round(tokens * 0.75),
      total_cost_usd: Math.round(claudeCost * 100) / 100,
      models: CLAUDE_MODELS.slice(0, 1 + Math.floor(rand() * 3)),
    });

    if (m.codex > 0 && rand() > 0.3) {
      const codexCost = m.codex * (0.4 + rand() * 1.1);
      const codexTokens = Math.round(codexCost * 310000);
      insertUsageRecord(db, m.id, {
        member_name: m.name,
        date,
        session_id: "codex-daily",
        input_tokens: Math.round(codexTokens * 0.3),
        output_tokens: Math.round(codexTokens * 0.06),
        cache_creation_tokens: 0,
        cache_read_tokens: Math.round(codexTokens * 0.64),
        total_cost_usd: Math.round(codexCost * 100) / 100,
        models: CODEX_MODELS.slice(0, 1 + Math.floor(rand() * 2)),
      });
    }

    const sessions = 1 + Math.floor(rand() * 3);
    for (let s = 0; s < sessions; s++) {
      const start = new Date(`${date}T0${1 + s * 2}:${10 + Math.floor(rand() * 40)}:00Z`);
      const minutes = 15 + Math.floor(rand() * 110);
      const end = new Date(start.getTime() + minutes * 60000);
      const turns = 8 + Math.floor(rand() * 60);
      insertSessionMetrics(db, m.id, {
        member_name: m.name,
        session_id: `${m.id}-${date}-${s}`,
        session_name: `${PROJECTS[(s + back) % PROJECTS.length]} 調整`,
        project: PROJECTS[(s + back) % PROJECTS.length],
        branch: s % 2 === 0 ? "main" : "feat/ui",
        started_at: start.toISOString(),
        ended_at: end.toISOString(),
        duration_minutes: minutes,
        turns,
        user_messages: Math.round(turns / 2),
        assistant_messages: Math.round(turns / 2),
        user_avg_chars: 80 + Math.floor(rand() * 300),
        tool_calls: { Read: 4 + Math.floor(rand() * 20), Edit: Math.floor(rand() * 12), Bash: Math.floor(rand() * 15) },
        tool_call_total: 10 + Math.floor(rand() * 40),
        tool_errors: Math.floor(rand() * 3),
        skills_invoked: rand() > 0.6 ? ["code-review"] : [],
        hook_blocks: rand() > 0.85 ? 1 : 0,
        files_read: Math.floor(rand() * 30),
        files_written: Math.floor(rand() * 4),
        files_edited: Math.floor(rand() * 10),
        has_commit: rand() > 0.5,
      });
    }
  }
}
// insert 會把 last_seen_at 寫成「現在」，所以全部寫完才回填：每人最後一筆用量那天的 18:00 UTC，
// 但不晚於現在。Leo 最近三天沒資料，會落在 24 小時之外，用來看過期的灰點。
db.run(
  `UPDATE members SET last_seen_at = MIN(
     (SELECT MAX(date) FROM usage_records WHERE member_id = members.id) || ' 18:00:00',
     datetime('now')
   )`
);
db.close();
process.stdout.write(`seeded ${dbPath}\n`);
