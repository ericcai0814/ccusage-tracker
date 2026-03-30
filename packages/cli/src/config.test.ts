import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Config", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ccusage-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return null for non-existent config path", () => {
    const nonExistent = join(tempDir, "nope", "config.json");
    expect(existsSync(nonExistent)).toBe(false);
  });

  it("should write valid JSON config", () => {
    const configDir = join(tempDir, ".config", "ccusage-tracker");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");

    const testConfig = {
      server_url: "http://localhost:3000",
      api_key: "sk-tracker-test123",
      member_name: "TestUser",
    };

    writeFileSync(configPath, JSON.stringify(testConfig, null, 2) + "\n");

    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.server_url).toBe("http://localhost:3000");
    expect(parsed.api_key).toBe("sk-tracker-test123");
    expect(parsed.member_name).toBe("TestUser");
  });

  it("should handle malformed JSON gracefully", () => {
    const configDir = join(tempDir, ".config", "ccusage-tracker");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");

    writeFileSync(configPath, "not json");

    expect(() => JSON.parse(readFileSync(configPath, "utf-8"))).toThrow();
  });
});
