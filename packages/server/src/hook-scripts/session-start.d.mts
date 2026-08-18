// 這支腳本是以 text import 讀進來的純文字（見 scripts.ts 檔頭），不是模組。
// 宣告檔與 .mjs 同名並列，讓型別範圍只涵蓋這兩個檔，不用 `declare module "*.mjs"`
// 那種全域萬用宣告 —— 後者會把任何 .mjs import 都靜默當成 string。
declare const content: string;
export default content;
