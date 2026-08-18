import { describe, expect, it } from "bun:test";
import { uploadFailureHint } from "./status";

// last-error.txt 現在有兩種來源：ccusage 取數失敗，以及整體 deadline 被觸發。
// 兩者的下一步完全不同 —— 對 deadline 逾時叫人去量 ccusage 會把診斷帶偏，
// 那正是 #4 修掉的那種「診斷資訊本身在誤導」的問題。
describe("uploadFailureHint", () => {
  it("ccusage 取數失敗 → 指向量測 ccusage 耗時", () => {
    const hint = uploadFailureHint("ccusage 逾時被中止（>25s），當日用量未上報");
    expect(hint).toContain("time ccusage daily");
  });

  it("deadline 被觸發 → 不叫人去量 ccusage（多半不是它造成的）", () => {
    const hint = uploadFailureHint("40s 內未完成上報，程序被強制結束");
    expect(hint).not.toContain("time ccusage daily");
    // 指向 status 自己輸出的 Server 一行（大小寫需與該行標籤一致，使用者要照著找）
    expect(hint).toContain("Server");
  });
});
