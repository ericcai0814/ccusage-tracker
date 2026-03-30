import { readConfig } from "../config";

interface MemberSummary {
  member_name: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_cost_usd: number;
}

interface SummaryResponse {
  period: string;
  from: string;
  to: string;
  total_cost_usd: number;
  total_tokens: number;
  active_members: number;
  members: MemberSummary[];
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : " ".repeat(len - str.length) + str;
}

function formatTable(data: SummaryResponse): string {
  const lines: string[] = [];

  lines.push(`Period: ${data.period} (${data.from} ~ ${data.to})`);
  lines.push(`Total Cost: $${data.total_cost_usd.toFixed(2)}  |  Total Tokens: ${data.total_tokens.toLocaleString()}  |  Active Members: ${data.active_members}`);
  lines.push("");

  if (data.members.length === 0) {
    lines.push("No usage data for this period.");
    return lines.join("\n");
  }

  const header = [
    padRight("Member", 15),
    padLeft("Input", 12),
    padLeft("Output", 12),
    padLeft("Cache Create", 14),
    padLeft("Cache Read", 12),
    padLeft("Cost", 10),
  ].join("  ");

  const separator = "-".repeat(header.length);

  lines.push(header);
  lines.push(separator);

  for (const m of data.members) {
    lines.push(
      [
        padRight(m.member_name, 15),
        padLeft(m.input_tokens.toLocaleString(), 12),
        padLeft(m.output_tokens.toLocaleString(), 12),
        padLeft(m.cache_creation_tokens.toLocaleString(), 14),
        padLeft(m.cache_read_tokens.toLocaleString(), 12),
        padLeft(`$${m.total_cost_usd.toFixed(2)}`, 10),
      ].join("  ")
    );
  }

  return lines.join("\n");
}

export async function reportCommand(args: string[]): Promise<void> {
  const config = readConfig();
  if (!config) {
    console.error("Not configured. Run `tracker setup` first.");
    process.exit(1);
  }

  let period = "month";
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--period" && args[i + 1]) {
      period = args[i + 1];
      i++;
    }
    if (args[i] === "--json") {
      jsonOutput = true;
    }
  }

  try {
    const res = await fetch(`${config.server_url}/api/report/summary?period=${period}`, {
      headers: { Authorization: `Bearer ${config.api_key}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error(`Server error: ${res.status}`, body);
      process.exit(1);
    }

    const data = (await res.json()) as SummaryResponse;

    if (jsonOutput) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(formatTable(data));
    }
  } catch (err) {
    console.error("Failed to fetch report:", (err as Error).message);
    process.exit(1);
  }
}
