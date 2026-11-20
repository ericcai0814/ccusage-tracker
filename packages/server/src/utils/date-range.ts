export const VALID_PERIODS = ["today", "week", "month"] as const;
export type Period = (typeof VALID_PERIODS)[number];

export function validatePeriod(raw: string | undefined): Period {
  const period = raw || "month";
  return VALID_PERIODS.includes(period as Period) ? (period as Period) : "month";
}

export function getDateRange(period: Period, now: Date = new Date()): { from: string; to: string } {
  const to = now.toISOString().split("T")[0];

  switch (period) {
    case "today":
      return { from: to, to };
    case "week": {
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - mondayOffset);
      return { from: monday.toISOString().split("T")[0], to };
    }
    case "month":
    default: {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: firstOfMonth.toISOString().split("T")[0], to };
    }
  }
}

// 日期字串的 UTC 平移；getDateRange 的 to 本來就是 UTC 日期，前一期的平移要用同一套
function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

// KPI「比上一期」用的窗口：與 getDateRange 用同一套算法往前推一期，連它的時區偏差一起沿用
// （month 起日用本地時間建 Date 再轉 UTC，在 UTC+8 會落到上月最後一天）。
// today → 昨天；week → 上週一到上週同一天；month → 上月 1 日到上月同一天，上月天數不足取到月底。
export function getPreviousDateRange(period: Period, now: Date = new Date()): { from: string; to: string } {
  const current = getDateRange(period, now);
  switch (period) {
    case "today": {
      const day = shiftDays(current.to, -1);
      return { from: day, to: day };
    }
    case "week":
      return { from: shiftDays(current.from, -7), to: shiftDays(current.to, -7) };
    case "month":
    default: {
      const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const from = firstOfPrevMonth.toISOString().split("T")[0];
      // UTC+8 每月 1 日 00:00–07:59 本地已換月，但 current.to 還在 UTC 上月最後一天（與 current.from 同日）
      if (current.from === current.to) return { from, to: from };
      const [year, month, day] = current.to.split("-").map(Number);
      // Date.UTC 的月份從 0 起算：month - 1 是本月，month - 2 是上月；第 0 日是上月最後一天
      const prevMonthDays = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
      const prevTo = new Date(Date.UTC(year, month - 2, Math.min(day, prevMonthDays)));
      return {
        from,
        to: prevTo.toISOString().split("T")[0],
      };
    }
  }
}
