import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface Totals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCost: number;
}

type ExecFn = (
  file: string,
  args: string[],
  options: { shell?: boolean; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface CcusageDeps {
  exec: ExecFn;
}

const defaultExec = promisify(execFile) as unknown as ExecFn;

const defaultDeps: CcusageDeps = {
  exec: defaultExec,
};

function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function runCcusageDaily(
  date: string,
  overrides?: Partial<CcusageDeps>,
): Promise<Totals | null> {
  const deps = { ...defaultDeps, ...overrides };
  try {
    const { stdout } = await deps.exec(
      "ccusage",
      ["daily", "--json", "--since", date, "--jq", ".totals"],
      { shell: true, timeout: 10_000 },
    );
    const totals = JSON.parse(stdout) as Record<string, unknown>;
    return {
      inputTokens: toFiniteNumber(totals.inputTokens),
      outputTokens: toFiniteNumber(totals.outputTokens),
      cacheCreationTokens: toFiniteNumber(totals.cacheCreationTokens),
      cacheReadTokens: toFiniteNumber(totals.cacheReadTokens),
      totalCost: toFiniteNumber(totals.totalCost),
    };
  } catch {
    return null;
  }
}
