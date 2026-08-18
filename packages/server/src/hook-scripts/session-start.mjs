#!/usr/bin/env node
// ccusage-tracker SessionStart hook（Node.js 跨平台版）
// 記錄本次 session 使用的 model，供 SessionEnd 估算 context 佔比。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SESSIONS_DIR = join(homedir(), '.config', 'ccusage-tracker', 'sessions');

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(data); } };
    const timer = setTimeout(finish, timeoutMs);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { data += c; });
      process.stdin.on('end', () => { clearTimeout(timer); finish(); });
      process.stdin.on('error', () => { clearTimeout(timer); finish(); });
    } catch { clearTimeout(timer); finish(); }
  });
}

async function main() {
  const payload = await readStdin(1000);
  if (!payload) return;
  let sessionId = '';
  let model = '';
  try {
    const p = JSON.parse(payload);
    sessionId = p.session_id || '';
    model = p.model || '';
  } catch { return; }
  if (!sessionId || !model) return;
  try {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    writeFileSync(join(SESSIONS_DIR, sessionId), model);
  } catch { /* 靜默 */ }
}

main().catch(() => {}).finally(() => process.exit(0));
