import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hookCommand } from "./index";

describe("hookCommand router", () => {
  let logs: string[];
  let errors: string[];
  let exitCodes: number[];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    logs = [];
    errors = [];
    exitCodes = [];
    originalLog = console.log;
    originalError = console.error;
    originalExit = process.exit;
    console.log = ((msg: unknown) => { logs.push(String(msg)); }) as typeof console.log;
    console.error = ((msg: unknown) => { errors.push(String(msg)); }) as typeof console.error;
    process.exit = ((code?: number) => {
      exitCodes.push(code ?? 0);
    }) as typeof process.exit;
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  });

  it("lists session-end and session-start in --help output", async () => {
    await hookCommand(["--help"]);
    const output = logs.join("\n");
    expect(output).toContain("session-end");
    expect(output).toContain("session-start");
  });

  it("lists subcommands when no arg given", async () => {
    await hookCommand([]);
    const output = logs.join("\n");
    expect(output).toContain("session-end");
    expect(output).toContain("session-start");
  });

  it("exits 1 for unknown subcommand and prints usage hint", async () => {
    await hookCommand(["bogus"]);
    expect(exitCodes).toContain(1);
    const errOutput = errors.join("\n");
    expect(errOutput).toContain("Unknown hook subcommand");
    expect(errOutput).toContain("tracker hook --help");
  });
});
