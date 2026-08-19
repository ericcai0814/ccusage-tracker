import { describe, expect, it } from "bun:test";
import { uploadAgeLine, uploadFailureHint } from "./status";

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

// 上報改成背景 worker 之後，「沒有錯誤痕跡」不再等於「有送出去」——
// worker 可能根本沒被啟動（spawn 被擋、機器立刻關機），那條路徑不寫任何錯誤。
// 這行是唯一能分辨「一切正常」與「整條鏈默默停擺」的資訊。
describe("uploadAgeLine", () => {
  const now = Date.parse("2026-08-19T12:00:00.000Z");

  it("剛上報成功 → 顯示時間與經過分鐘", () => {
    const line = uploadAgeLine(now - 3 * 60_000, now);
    expect(line).toContain("3 分鐘前");
    expect(line).not.toContain("停擺");
  });

  it("超過 24 小時 → 明講可能已停擺", () => {
    const line = uploadAgeLine(now - 30 * 3600_000, now);
    expect(line).toContain("停擺");
  });

  it("從未成功 → 不報警，剛裝好本來就是這樣", () => {
    const line = uploadAgeLine(null, now);
    expect(line).toContain("尚無成功紀錄");
    expect(line).not.toContain("停擺");
  });
});
