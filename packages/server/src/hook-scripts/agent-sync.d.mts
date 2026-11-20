// 這支腳本是以 text import 讀進來的純文字（見 scripts.ts 檔頭），不是模組。
// 宣告檔與 .mjs 同名並列，讓型別範圍只涵蓋這兩個檔，不用 `declare module "*.mjs"`。
//
// argv 契約（<source> 目前只有 antigravity）：
//   <source>           手動 sync，等待結果並回傳真實 exit code，不讀也不寫節流檔
//   --hook <source>    Antigravity Stop hook 進入點：讀完 stdin 即丟（2 秒或 64 KB 為限），
//                      stdout 恆為 {"decision":"stop"}，通過節流才 detach worker，一律 exit 0
//   --trigger          給 Claude 與 Codex worker 呼叫：每個偵測得到且通過節流的來源各啟動一個
//                      worker，不輸出、一律 exit 0
//   --worker <source>  內部使用：由上述觸發路徑 detach 出來，實際執行收集與上報
declare const content: string;
export default content;
