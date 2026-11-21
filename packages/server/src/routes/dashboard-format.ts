import type { UsageSource } from "../queries";
import { SOURCES, sourceInfo } from "../sources";

// total_cost_usd 是 SQLite 的 REAL，兩筆極大值相加就會溢位成 Infinity；資料庫也可能被
// 直接改寫繞過 admin API 的範圍檢查。算不出可信的數字時寧可顯示破折號，不要印 NaN。
export const NOT_AVAILABLE = "—";

// 「可表示」的夾值，不是「可繪製」的夾值：真實金額不可能超過 Number.MAX_VALUE，
// 壓到它不會扭曲任何一筆真的資料。夾值只用來擋 NaN 與溢位的 Infinity。
export function finiteCost(n: number): number {
  // NaN 先擋掉（NaN <= 0 是 false，會漏過去）；+Infinity 交給 Math.min 壓到可表示上限
  if (Number.isNaN(n) || n <= 0) return 0;
  return Math.min(n, Number.MAX_VALUE);
}

// 相對於某個上限的比例。先算比值再夾到 [0,1]，不先截斷金額 ——
// 截斷金額會把比例一起洗掉（3e12 與 1e12 都夾成 1e12 就變成 50%／50%）。
export function ratioPct(value: number, max: number): number {
  const limit = finiteCost(max);
  if (!(limit > 0)) return 0;
  const ratio = finiteCost(value) / limit;
  return Math.min(1, Math.max(0, ratio)) * 100;
}

// 一組值各自的佔比。總和可能溢位，所以先全部除以最大值再相加：分子分母同時縮放，
// 比例不變，而正規化後的總和最多等於項目數，不會溢位。
export function sharePercents(values: number[]): number[] {
  const clean = values.map(finiteCost);
  const max = Math.max(...clean, 0);
  if (!(max > 0)) return clean.map(() => 0);
  const scaled = clean.map((v) => v / max);
  const total = scaled.reduce((sum, v) => sum + v, 0);
  if (!(total > 0)) return clean.map(() => 0);
  return scaled.map((v) => Math.min(1, Math.max(0, v / total)) * 100);
}

// 各自四捨五入會讓整數百分比加總變成 99% 或 101%（三個等份就是 33+33+33）。
// 最大餘數法：先取整數部分，再把剩下的名額按小數部分由大到小補回去，加總保證是 100。
export function roundSharesTo100(shares: number[]): number[] {
  const floors = shares.map((v) => Math.floor(v));
  const used = floors.reduce((sum, v) => sum + v, 0);
  const remainder = Math.round(shares.reduce((sum, v) => sum + v, 0)) - used;
  if (remainder <= 0) return floors;

  const bump = new Set(
    shares
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i)
      .slice(0, remainder)
      .map((o) => o.i)
  );
  return floors.map((v, i) => (bump.has(i) ? v + 1 : v));
}

export function formatNumber(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : NOT_AVAILABLE;
}

// 有限不等於可讀：1e308 印出來是三百多位數，塞爆版面又講不出任何事情。
// 超過這個量級的金額一律當作壞資料顯示破折號。
export const MAX_DISPLAY_USD = 1e15;

export function isDisplayableCost(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) < MAX_DISPLAY_USD;
}

export function formatCost(n: number): string {
  if (!isDisplayableCost(n)) return NOT_AVAILABLE;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 預算相關的金額都是整數量級，兩位小數只會讓卡片變吵
export function formatUsdRounded(n: number): string {
  return isDisplayableCost(n) ? `$${Math.round(n).toLocaleString("en-US")}` : NOT_AVAILABLE;
}

// 名稱與資料色都來自 sources.ts 的來源表；接新來源不用改這裡。
export const SOURCE_COLOR = (source: UsageSource): string => sourceInfo(source).color;
export const SOURCE_LABEL = (source: UsageSource): string => sourceInfo(source).label;

// 頁首與頁尾列出的工具名稱，順序同來源表。
export const SOURCE_NAMES: readonly string[] = SOURCES.map((s) => s.label);
