import { describe, it, expect, vi } from "vitest";
import { runCcusageDaily } from "./ccusage";

describe("runCcusageDaily", () => {
  it("invokes ccusage with shell:true (Windows .cmd resolution)", async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: '{"inputTokens":1,"outputTokens":2,"cacheCreationTokens":3,"cacheReadTokens":4,"totalCost":0.5}',
      stderr: "",
    });

    await runCcusageDaily("20260522", { exec });

    expect(exec).toHaveBeenCalledTimes(1);
    const [file, args, options] = exec.mock.calls[0];
    expect(file).toBe("ccusage");
    expect(args).toEqual(["daily", "--json", "--since", "20260522", "--jq", ".totals"]);
    expect(options).toMatchObject({ shell: true });
  });

  it("parses totals into typed object", async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: '{"inputTokens":100,"outputTokens":200,"cacheCreationTokens":50,"cacheReadTokens":25,"totalCost":0.05}',
      stderr: "",
    });

    const result = await runCcusageDaily("20260522", { exec });

    expect(result).toEqual({
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationTokens: 50,
      cacheReadTokens: 25,
      totalCost: 0.05,
    });
  });

  it("returns null when ccusage is not installed (ENOENT)", async () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const exec = vi.fn().mockRejectedValue(err);

    const result = await runCcusageDaily("20260522", { exec });

    expect(result).toBeNull();
  });

  it("returns null when ccusage exits non-zero", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("Command failed"));
    const result = await runCcusageDaily("20260522", { exec });
    expect(result).toBeNull();
  });

  it("returns null when ccusage stdout is not valid JSON", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "not json", stderr: "" });
    const result = await runCcusageDaily("20260522", { exec });
    expect(result).toBeNull();
  });

  it("defaults missing fields to 0 instead of NaN", async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: '{"inputTokens":10}',
      stderr: "",
    });
    const result = await runCcusageDaily("20260522", { exec });
    expect(result).toEqual({
      inputTokens: 10,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalCost: 0,
    });
  });
});
