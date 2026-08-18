import { describe, expect, it } from "bun:test";
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
    expect(mjs).toContain("setTimeout(resolve, 40000)");
    const setup = generateSetupScript("https://example.com", "k");
    expect(setup).toContain('"timeout": 45');
    expect(setup).not.toContain('"timeout": 25');
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
