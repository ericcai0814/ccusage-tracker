import { describe, expect, it, afterEach } from "bun:test";
import { getDateRange, getPreviousDateRange } from "./date-range";

// 本地時間會影響 getDateRange 的 week／month 起日，測試各自釘住時區，結束一定還原。
// bun test 預設跑在 UTC；delete process.env.TZ 之後 bun 就不再理會後續的 TZ 設定，
// 所以還原時一律指定值，沒有原值就還原成 UTC。
const ORIGINAL_TZ = process.env.TZ ?? "UTC";

function withTz(tz: string): void {
  process.env.TZ = tz;
}

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("getPreviousDateRange", () => {
  it("today compares with yesterday", () => {
    withTz("UTC");
    const now = new Date("2026-11-21T10:00:00Z");
    expect(getPreviousDateRange("today", now)).toEqual({ from: "2026-11-20", to: "2026-11-20" });
  });

  it("today crosses a year boundary", () => {
    withTz("UTC");
    const now = new Date("2026-01-01T03:00:00Z");
    expect(getPreviousDateRange("today", now)).toEqual({ from: "2025-12-31", to: "2025-12-31" });
  });

  it("week compares last Monday through the same weekday last week", () => {
    withTz("UTC");
    // 2026-11-21 是週六，本週從 11-16（週一）起
    const now = new Date("2026-11-21T10:00:00Z");
    expect(getDateRange("week", now)).toEqual({ from: "2026-11-16", to: "2026-11-21" });
    expect(getPreviousDateRange("week", now)).toEqual({ from: "2026-11-09", to: "2026-11-14" });
  });

  it("month compares the 1st through the same day of last month", () => {
    withTz("UTC");
    const now = new Date("2026-11-21T10:00:00Z");
    expect(getPreviousDateRange("month", now)).toEqual({ from: "2026-10-01", to: "2026-10-21" });
  });

  it("month clamps to the last day of a shorter previous month", () => {
    withTz("UTC");
    expect(getPreviousDateRange("month", new Date("2026-03-31T10:00:00Z"))).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(getPreviousDateRange("month", new Date("2026-12-31T10:00:00Z"))).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
  });

  it("month in January compares with December of the previous year", () => {
    withTz("UTC");
    expect(getPreviousDateRange("month", new Date("2026-01-15T10:00:00Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-15",
    });
  });

  // 已知偏差：getDateRange 的 month 起日在 UTC+8 會落到上月最後一天，上一期沿用同一個偏差
  it("month keeps the same timezone offset as getDateRange in UTC+8", () => {
    withTz("Asia/Taipei");
    const now = new Date("2026-11-21T02:00:00Z");
    expect(getDateRange("month", now)).toEqual({ from: "2026-10-31", to: "2026-11-21" });
    expect(getPreviousDateRange("month", now)).toEqual({ from: "2026-09-30", to: "2026-10-21" });
  });

  // 同一個偏差的副作用：本期起日是上月最後一天，上月同一天夾到月底時也是那一天，
  // 所以月底那天會同時算進本期與上一期。這裡把行為釘住，修 getDateRange 時要一起改。
  it("month overlaps one day with the previous window at month end in UTC+8", () => {
    withTz("Asia/Taipei");
    const now = new Date("2026-12-31T02:00:00Z");
    expect(getDateRange("month", now)).toEqual({ from: "2026-11-30", to: "2026-12-31" });
    expect(getPreviousDateRange("month", now)).toEqual({ from: "2026-10-31", to: "2026-11-30" });
  });
});
