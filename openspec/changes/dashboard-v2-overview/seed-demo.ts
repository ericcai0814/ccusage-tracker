// 灌示範資料到 DB_PATH 指向的 SQLite，本月每天、12 位成員、兩個來源。
import { createDatabase } from "../../../packages/server/src/db";
import { insertMember, insertUsageRecord, insertSessionMetrics, hashApiKey } from "../../../packages/server/src/queries";
import { setSetting, MONTHLY_BUDGET_KEY } from "../../../packages/server/src/settings";

const db = createDatabase(process.env.DB_PATH || "demo.db");

const names = ["Eric", "Amber", "Ben", "Cindy", "Derek", "Ella", "Frank", "Grace", "Hana", "Ivan", "Jade", "Kai"];
names.forEach((n, i) => insertMember(db, `m${i}`, n, hashApiKey(`key${i}`)));

const today = new Date();
const days: string[] = [];
for (let d = new Date(today.getFullYear(), today.getMonth(), 1); d <= today; d.setDate(d.getDate() + 1)) {
  days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
}

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

days.forEach((date) => {
  names.forEach((n, i) => {
    (["daily", "codex-daily"] as const).forEach((sid) => {
      if (sid === "codex-daily" && i % 3 === 1) return;
      if (rnd() < 0.15) return;
      const cost = Number(((sid === "daily" ? 6 : 2.5) * (1.4 - i * 0.08) * (0.5 + rnd())).toFixed(2));
      insertUsageRecord(db, `m${i}`, {
        member_name: n,
        date,
        session_id: sid,
        input_tokens: Math.round(cost * 12000),
        output_tokens: Math.round(cost * 3000),
        cache_creation_tokens: Math.round(cost * 8000),
        cache_read_tokens: Math.round(cost * 90000),
        total_cost_usd: cost,
        models: sid === "daily" ? (rnd() < 0.5 ? ["claude-opus-5"] : ["claude-opus-5", "claude-sonnet-5"]) : ["gpt-5.4"],
      });
      if (sid === "daily") {
        insertSessionMetrics(db, `m${i}`, {
          member_name: n,
          session_id: `${date}-${i}`,
          started_at: `${date}T09:00:00Z`,
          ended_at: `${date}T11:00:00Z`,
          turns: Math.round(cost * 3),
        });
      }
    });
  });
});

setSetting(db, MONTHLY_BUDGET_KEY, process.env.DEMO_BUDGET || "2000");
console.log(`seeded ${days.length} days x ${names.length} members into ${process.env.DB_PATH}`);
