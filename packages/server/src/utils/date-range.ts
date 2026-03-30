export const VALID_PERIODS = ["today", "week", "month"] as const;
export type Period = (typeof VALID_PERIODS)[number];

export function validatePeriod(raw: string | undefined): Period {
  const period = raw || "month";
  return VALID_PERIODS.includes(period as Period) ? (period as Period) : "month";
}

export function getDateRange(period: Period): { from: string; to: string } {
  const now = new Date();
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
