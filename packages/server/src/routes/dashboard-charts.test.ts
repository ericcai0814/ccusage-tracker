import { describe, expect, it } from "bun:test";
import { TrendChart, smoothAreaPoints, smoothPath } from "./dashboard-charts";

// 鎖住 smoothPath 的逐字輸出：改寫內部實作時，SVG path 字串不能有任何差異
describe("smoothPath", () => {
  it("returns an empty string for no points", () => {
    expect(smoothPath([])).toBe("");
  });

  it("returns a single move command for one point", () => {
    expect(smoothPath([[4, 120]])).toBe("M4.0,120.0");
  });

  it("draws a straight cubic between two points", () => {
    expect(
      smoothPath([
        [4, 200],
        [644, 50],
      ])
    ).toBe("M4.0,200.0 C217.3,150.0 430.7,100.0 644.0,50.0");
  });

  it("flattens tangents at local extrema and flat segments", () => {
    expect(
      smoothPath([
        [4, 200],
        [164, 120],
        [324, 150],
        [484, 40],
        [644, 40],
      ])
    ).toBe(
      "M4.0,200.0 C57.3,173.3 110.7,120.0 164.0,120.0 C217.3,120.0 270.7,150.0 324.0,150.0 C377.3,150.0 430.7,40.0 484.0,40.0 C537.3,40.0 590.7,40.0 644.0,40.0"
    );
  });

  it("handles uneven spacing", () => {
    expect(
      smoothPath([
        [4, 100],
        [100, 100],
        [200, 30],
        [300, 220],
      ])
    ).toBe("M4.0,100.0 C36.0,100.0 68.0,100.0 100.0,100.0 C133.3,100.0 166.7,30.0 200.0,30.0 C233.3,30.0 266.7,156.7 300.0,220.0");
  });

  it("writes 0 for non-finite coordinates instead of NaN", () => {
    expect(
      smoothPath([
        [4, 50],
        [4, 80],
        [50, NaN],
      ])
    ).toBe("M4.0,50.0 C4.0,50.0 4.0,0 4.0,80.0 C19.3,0 34.7,0 50.0,0");
  });
});

describe("smoothAreaPoints", () => {
  it("returns nothing for fewer than two points", () => {
    expect(smoothAreaPoints([[4, 120]], 236)).toBe("");
  });

  it("follows the smoothPath curve and closes on the baseline", () => {
    const pts: Array<[number, number]> = [
      [4, 200],
      [164, 120],
      [324, 150],
    ];
    const coords = smoothAreaPoints(pts, 236, 4).split(" ");
    // 起點、每段 4 個取樣、收回 0 軸的兩個角
    expect(coords).toHaveLength(1 + 2 * 4 + 2);
    expect(coords[0]).toBe("4.0,200.0");
    expect(coords[4]).toBe("164.0,120.0");
    expect(coords[8]).toBe("324.0,150.0");
    expect(coords.slice(-2)).toEqual(["324.0,236.0", "4.0,236.0"]);
  });
});

describe("TrendChart end-label collision avoidance", () => {
  it("separates end labels vertically when two sources end at the same cost on the last day", () => {
    const html = String(
      TrendChart({
        rows: [
          { date: "2026-06-10", source: "claude", total_cost_usd: 20, total_tokens: 100 },
          { date: "2026-06-11", source: "claude", total_cost_usd: 20, total_tokens: 100 },
          { date: "2026-06-10", source: "codex", total_cost_usd: 5, total_tokens: 50 },
          { date: "2026-06-10", source: "antigravity", total_cost_usd: 3, total_tokens: 30 },
        ],
      })
    );
    const labelYs = [...html.matchAll(/class="trend-end-label" x="[\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(labelYs).toHaveLength(3);
    expect(new Set(labelYs).size).toBe(3);
  });
});
