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

  it("不依賴 jq（PowerShell 原生 JSON）", () => {
    expect(ps1).not.toContain("jq ");
  });
});

describe("舊 bash 腳本向後相容 (regression)", () => {
  it("session-end.sh 仍使用 jq（未被破壞，舊成員可繼續用）", () => {
    expect(generateSessionEndScript()).toContain("jq ");
  });

  it("setup.sh 改用 node 執行 .mjs hook", () => {
    const sh = generateSetupScript("https://x.app", "tk");
    expect(sh).toContain("node $HOOK_SCRIPT");
    expect(sh).toContain("session-end.mjs");
  });

  it("uninstall.sh 同時清理 SessionStart 與 SessionEnd", () => {
    const sh = generateUninstallScript("https://x.app");
    expect(sh).toContain(".SessionStart");
    expect(sh).toContain(".SessionEnd");
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
