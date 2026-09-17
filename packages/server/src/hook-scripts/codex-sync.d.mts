// 這支腳本是以 text import 讀進來的純文字（見 scripts.ts 檔頭），不是模組。
// 宣告檔與 .mjs 同名並列，讓型別範圍只涵蓋這兩個檔，不用 `declare module "*.mjs"`。
//
// argv 契約：
//   （無參數）  手動 sync，等待結果並回傳真實 exit code，不受節流限制
//   --hook      Codex hooks 進入點：讀 stdin 事件 JSON，只取 hook_event_name，
//               Stop 與 SessionEnd 才 detach 背景 worker；任何異常一律 exit 0
//   --notify    已 deprecated 的 config.toml notify 相容路徑，改用 --hook
//   --worker    內部使用：由上述觸發路徑 detach 出來，實際執行收集與上報
declare const content: string;
export default content;
