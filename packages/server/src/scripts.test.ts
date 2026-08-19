import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createApp } from "./app";
import { createDatabase } from "./db";
import {
  generateSessionEndMjsScript,
  generateSessionStartMjsScript,
  generateSetupPs1Script,
  generateSessionEndScript,
  generateSetupScript,
  generateUninstallScript,
} from "./scripts";

describe("Node.js 上報腳本 (.mjs, 路線 C)", () => {
  const mjs = generateSessionEndMjsScript();

  it("不依賴 jq 或 bash", () => {
    expect(mjs).not.toContain("jq ");
    expect(mjs).not.toContain("#!/bin/bash");
  });

  it("使用 node shebang 與內建 fetch", () => {
    expect(mjs).toContain("#!/usr/bin/env node");
    expect(mjs).toContain("fetch(");
  });

  it("上報到正確 endpoint 並帶 Bearer team_key", () => {
    expect(mjs).toContain("/api/ingest");
    expect(mjs).toContain("/api/ingest/session");
    expect(mjs).toContain("Bearer ");
    expect(mjs).toContain("team_key");
  });

  it("永遠 exit 0（不阻擋 Claude Code）", () => {
    expect(mjs).toContain("process.exit(0)");
  });

  it("支援 --mode argv（Stop hook 用 --mode=stop，SessionEnd 用 --mode=session-end）", () => {
    expect(mjs).toContain("--mode=");
    expect(mjs).toContain("'session-end'"); // 預設值
    expect(mjs).toContain("MODE === 'stop'");
    expect(mjs).toContain("MODE === 'session-end'");
  });

  it("Stop hook 走 5 分鐘 throttle（last-flush.txt）", () => {
    expect(mjs).toContain("last-flush.txt");
    expect(mjs).toContain("THROTTLE_MS");
    expect(mjs).toContain("5 * 60 * 1000");
  });

  it("spawnSync(ccusage) 有 timeout 避免 sync 阻塞 event loop", () => {
    expect(mjs).toContain("timeout: 25000");
    expect(mjs).toContain("killSignal: 'SIGKILL'");
  });

  // 迴歸防護：ccusage 耗時隨歷史資料成長，8s 上限曾使成員用量靜默漏報 9 天。
  // 三層上限必須維持 ccusage < __deadline < hook timeout，否則放寬最內層無效。
  it("三層 timeout 維持 ccusage 25s < __deadline 40s < hook 45s 的包含關係", () => {
    expect(mjs).toContain("timeout: 25000");
    expect(mjs).toContain("const DEADLINE_MS = 40000");
    const setup = generateSetupScript("https://example.com", "k");
    expect(setup).toContain('"timeout": 45');
    expect(setup).not.toContain('"timeout": 25');
  });

  // 關鍵路徑（當日快照）必須排在重送舊資料之前。反過來的話，buffer 積壓時
  // flushBuffer 會先吃掉 15s，當日快照再撞 ccusage 慢，總和就會超過 DEADLINE_MS
  // 而被 process.exit(0) 從中切斷 —— 又是一次沒有痕跡的靜默失敗。
  it("當日快照排在 flushBuffer 之前（關鍵路徑優先拿時間預算）", () => {
    const postIdx = mjs.indexOf("postCurrentUsage(cfg),");
    const flushIdx = mjs.indexOf("await flushBuffer(cfg.server_url");
    expect(postIdx).toBeGreaterThan(-1);
    expect(flushIdx).toBeGreaterThan(-1);
    expect(flushIdx).toBeGreaterThan(postIdx);
  });

  it("flushBuffer 依剩餘時間動態編預算，不再硬寫 15s", () => {
    expect(mjs).toContain("function msLeft()");
    expect(mjs).toContain("Math.min(15000, msLeft()");
    // 單次重送的 timeout 也要收斂，否則最後一筆可能跨過 deadline
    expect(mjs).toContain("Math.min(5000, msLeft()");
  });

  it("deadline 觸發時留下痕跡（此路徑同樣沒有 payload 可進 buffer）", () => {
    expect(mjs).toContain("markError(DEADLINE_MS");
  });

  it("ccusage 取數失敗會寫 last-error.txt（此路徑無 payload 可進 buffer）", () => {
    expect(mjs).toContain("last-error.txt");
    expect(mjs).toContain("function markError(");
    expect(mjs).toContain("function clearError(");
    // 逾時（SIGKILL → r.signal）與一般執行失敗要能分辨，訊息才有診斷價值。
    // 註：Bun 轉譯樣板字串時會把非 ASCII 轉成 \uXXXX，故此處不比對中文字面。
    expect(mjs).toContain("markError(r && r.signal ?");
    // 取數成功後必須清掉，否則舊錯誤會一直誤報
    expect(mjs).toContain("clearError();");
  });

  // 迴歸防護：Node 22+ 在「shell: true 且傳非空 args 陣列」時發出 DEP0190。
  // hook 掛在 SessionEnd / Stop，這行警告會出現在使用者每次結束 session 時。
  // shell: true 本身不能拿掉 —— Windows 上 npm 全域裝的是 ccusage.cmd，不透過 shell 找不到。
  it("spawnSync 不同時使用 shell: true 與 args 陣列（否則每次執行噴 DEP0190）", () => {
    for (const script of [mjs, generateSessionStartMjsScript()]) {
      expect(script).not.toMatch(/spawnSync\([^)]*,\s*\[/);
    }
  });

  // 迴歸防護：腳本若寫在 TS 的 String.raw 樣板裡，Bun 轉譯會把中文轉成 \uXXXX
  // 一路帶進發出去的檔案。字串字面量內的還原得回來（node 會解碼），註解內的就是死的亂碼 ——
  // 而 ~/.config/ccusage-tracker/session-end.mjs 正是出問題時第一個被打開來看的檔案。
  it("發出的腳本保留原始中文，不含 \\uXXXX 逸出", () => {
    for (const script of [mjs, generateSessionStartMjsScript()]) {
      expect(script).not.toMatch(/\\u[0-9A-Fa-f]{4}/);
    }
  });

  // 抽成獨立檔案後才做得到的事。這 357 行過去埋在 TS 樣板字串裡，
  // 語法錯誤只能靠人工 node --check 事後抓，或等使用者裝上去才炸。
  it("hook 腳本本身通過 node 語法檢查", () => {
    for (const name of ["session-end.mjs", "session-start.mjs"]) {
      const r = spawnSync("node", ["--check", join(import.meta.dir, "hook-scripts", name)], { encoding: "utf8" });
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
    }
  });

  it("session-start.mjs 合法且不依賴 jq", () => {
    const ss = generateSessionStartMjsScript();
    expect(ss).toContain("#!/usr/bin/env node");
    expect(ss).not.toContain("jq ");
  });
});

describe("Windows 安裝腳本 (setup.ps1)", () => {
  const ps1 = generateSetupPs1Script("https://tracker.example.com");

  it("注入 serverUrl", () => {
    expect(ps1).toContain("https://tracker.example.com");
  });

  it("詢問並寫入 Team Key（欄位名與 server 一致）", () => {
    expect(ps1).toContain("Team Key");
    expect(ps1).toContain("team_key");
  });

  it("hook 命令使用 node + .mjs", () => {
    expect(ps1).toContain("node ");
    expect(ps1).toContain("session-end.mjs");
  });

  it("注入三條 hook（SessionStart + SessionEnd + Stop），都帶 --mode 或 SessionStart", () => {
    expect(ps1).toContain("'Stop'");
    expect(ps1).toContain("--mode=session-end");
    expect(ps1).toContain("--mode=stop");
  });

  it("Migration：先移除舊 ccusage-tracker hook 再插入新版", () => {
    expect(ps1).toContain("Remove-OurHooks");
    expect(ps1).toContain("ccusage-tracker");
  });

  it("不依賴 jq（PowerShell 原生 JSON）", () => {
    expect(ps1).not.toContain("jq ");
  });
});

describe("舊 bash 腳本向後相容 (regression)", () => {
  it("session-end.sh 仍使用 jq（未被破壞，舊成員可繼續用）", () => {
    expect(generateSessionEndScript()).toContain("jq ");
  });

  it("setup.sh 改用 node 執行 .mjs hook（mixed quoting 保證路徑含空白也安全）", () => {
    const sh = generateSetupScript("https://x.app", "tk");
    // mixed quoting: 'node "'"$VAR"'"' → HOOK_VAR 內含 literal " 字元
    expect(sh).toContain(`'node "'"$HOOK_SCRIPT"'"`);
    expect(sh).toContain(`'node "'"$HOOK_START_SCRIPT"'"'`);
    expect(sh).toContain("session-end.mjs");
  });

  it("setup.sh 注入 Stop hook 與 --mode 命令", () => {
    const sh = generateSetupScript("https://x.app", "tk");
    expect(sh).toContain("HOOK_STOP_CMD");
    expect(sh).toContain("--mode=stop");
    expect(sh).toContain("--mode=session-end");
    expect(sh).toContain(".hooks.Stop");
  });

  it("setup.sh 用 migration jq pattern（path-alternation 移除所有 ccusage-tracker entry 再插入新版）", () => {
    const sh = generateSetupScript("https://x.app", "tk");
    expect(sh).toContain('contains("ccusage-tracker")');
    expect(sh).toContain("(.hooks.SessionStart, .hooks.SessionEnd, .hooks.Stop) |= map(select");
  });

  it("setup.sh 寫 settings.json 前檢查 UPDATED 非空（避免 jq 失敗時清空檔案）", () => {
    const sh = generateSetupScript("https://x.app", "tk");
    expect(sh).toContain('[ -n "$UPDATED" ]');
  });

  it("uninstall.sh 同時清理 SessionStart / SessionEnd / Stop", () => {
    const sh = generateUninstallScript("https://x.app");
    expect(sh).toContain(".SessionStart");
    expect(sh).toContain(".SessionEnd");
    expect(sh).toContain(".Stop");
  });
});

describe("腳本路由", () => {
  it("新舊腳本路由都回 200", async () => {
    const app = createApp(createDatabase(":memory:"));
    const paths = [
      "/setup.ps1",
      "/scripts/session-end.mjs",
      "/scripts/session-start.mjs",
      "/scripts/session-end.sh",
      "/scripts/session-start.sh",
      "/setup.sh",
      "/uninstall.sh",
    ];
    for (const p of paths) {
      const res = await app.request(p, { headers: { Host: "x.app", "X-Forwarded-Proto": "https" } });
      expect(res.status).toBe(200);
    }
  });
});
