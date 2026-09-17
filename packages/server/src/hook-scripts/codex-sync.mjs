#!/usr/bin/env node
// Codex 用量快照。只傳 token、成本估計及 model 名稱；不傳通知內容或 rollout 原文。
import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = join(homedir(), '.config', 'ccusage-tracker');
const BUFFER = join(DIR, 'codex-buffer.jsonl');
const LOCK = join(DIR, 'codex-worker.lock');
const ERROR = join(DIR, 'codex-last-error.txt');
const UPLOAD = join(DIR, 'codex-last-upload.txt');
const DEADLINE_MS = 180000;
const started = Date.now();
const worker = process.argv[2] === '--worker';
let ownsLock = false;

function fail(message) { throw new Error(message); }
function error(message) {
  try { writeFileSync(ERROR, new Date().toISOString() + ' ' + message + '\n'); } catch { /* stderr still reports failure */ }
  if (!worker) console.error(message);
}
function clearError() { if (existsSync(ERROR)) unlinkSync(ERROR); }
function token(value) { return Number.isSafeInteger(value) && value >= 0; }
function model(value) { return typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,200}$/.test(value); }
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function lock() {
  const recovery = LOCK + '.reclaim';
  const freshOwner = () => {
    if (!existsSync(LOCK)) return false;
    const [pidText, atText] = readFileSync(LOCK, 'utf8').trim().split(' ');
    const pid = Number(pidText);
    const at = Number(atText) || statSync(LOCK).mtimeMs;
    let alive = !Number.isSafeInteger(pid) || pid <= 0;
    if (!alive) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code !== 'ESRCH'; } }
    return alive && Date.now() - at < DEADLINE_MS + 30000;
  };
  if (freshOwner()) fail('Codex sync is already running. Retry shortly.');
  let recovering = false;
  try {
    // Every acquisition, including a brand-new lock, must hold this guard.
    // Otherwise a fresh writer can appear between the stale check and unlink.
    writeFileSync(recovery, process.pid + ' ' + Date.now(), { flag: 'wx' });
    recovering = true;
    if (freshOwner()) fail('Codex sync is already running. Retry shortly.');
    if (existsSync(LOCK)) unlinkSync(LOCK);
    writeFileSync(LOCK, process.pid + ' ' + Date.now(), { flag: 'wx' });
    ownsLock = true;
  } catch (e) {
    if (e.code === 'EEXIST') fail(recovering ? 'Codex sync is already running. Retry shortly.' :
      'Codex lock recovery is busy. If persistent, stop workers and remove codex-worker.lock.reclaim.');
    throw e;
  } finally {
    if (recovering) { try { unlinkSync(recovery); } catch { /* visible recovery marker is retained */ } }
  }
}
function unlock() {
  if (!ownsLock) return;
  try {
    if (readFileSync(LOCK, 'utf8').startsWith(process.pid + ' ')) unlinkSync(LOCK);
  } catch { /* no lock remains */ }
}

function config() {
  let cfg;
  try { cfg = JSON.parse(readFileSync(join(DIR, 'config.json'), 'utf8')); }
  catch { fail('Missing or invalid tracker config. Run ccusage-tracker setup.'); }
  if (!cfg || !['server_url', 'team_key', 'member_name'].every((key) => typeof cfg[key] === 'string' && cfg[key].trim())) {
    fail('Invalid tracker config. Run ccusage-tracker setup.');
  }
  let url;
  try { url = new URL(cfg.server_url); } catch { fail('Invalid tracker server URL. Run ccusage-tracker setup.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    fail('Invalid tracker server URL. Run ccusage-tracker setup.');
  }
  return { ...cfg, server_url: cfg.server_url.replace(/\/+$/, '') };
}

function collect(today, timezone) {
  const options = { encoding: 'utf8', shell: true, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 };
  const version = spawnSync('ccusage --version', options);
  if (version.status !== 0) fail('ccusage is missing or failed. Install ccusage@20.0.20.');
  if (!/^20\.\d+\.\d+$/.test(version.stdout?.trim().replace(/^ccusage /, '') ?? '')) {
    fail('Unsupported ccusage command family for Codex. Use the verified ccusage@20.0.20.');
  }
  if (!/^[a-zA-Z0-9_+./-]+$/.test(timezone)) fail('Cannot determine a supported local timezone.');
  const compact = today.replaceAll('-', '');
  // 20.0.20 verifies this command/schema, not an exact patch whitelist.
  // Always select Codex; default daily includes other agents. Validate every row below.
  const r = spawnSync('ccusage codex daily --json --since ' + compact + ' --until ' + compact + ' --timezone ' + timezone,
    { ...options, timeout: 120000 });
  if (r.status !== 0 || !r.stdout) fail(r.signal ? 'Codex collector timed out. No usage uploaded.' : 'Codex collector failed. No usage uploaded.');
  let data;
  try { data = JSON.parse(r.stdout); } catch { fail('Codex collector returned invalid JSON. No usage uploaded.'); }
  if (!data || !Array.isArray(data.daily) || !data.totals || 'type' in data || 'data' in data || 'summary' in data) {
    fail('Unsupported Codex collector schema. No usage uploaded.');
  }
  if (data.daily.length === 0) return null;
  const row = data.daily[0];
  if (data.daily.length !== 1 || !row || !date(row.date) || row.date !== today ||
      !['inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'].every((key) => token(row[key])) ||
      row.cacheCreationTokens !== 0 || 'cachedInputTokens' in row || row.reasoningOutputTokens > row.outputTokens ||
      row.totalTokens !== row.inputTokens + row.cacheReadTokens + row.outputTokens ||
      !Number.isFinite(row.costUSD) || row.costUSD < 0 ||
      !row.models || typeof row.models !== 'object' || Array.isArray(row.models) || !Object.keys(row.models).every(model)) {
    fail('Invalid Codex daily date, token counts, cost or models. No usage uploaded.');
  }
  // Verified 20.0.20 already subtracts cached input. Reasoning is part of output.
  return { date: today, session_id: 'codex-daily', input_tokens: row.inputTokens,
    output_tokens: row.outputTokens, cache_creation_tokens: 0, cache_read_tokens: row.cacheReadTokens,
    total_cost_usd: row.costUSD, models: Object.keys(row.models) };
}

function readBuffer() {
  if (!existsSync(BUFFER)) return new Map();
  const latest = new Map();
  for (const line of readFileSync(BUFFER, 'utf8').split('\n').filter(Boolean)) {
    let row;
    try { row = JSON.parse(line); } catch { fail('Invalid Codex buffer. Preserve it and repair before retrying.'); }
    if (!row || typeof row.member_name !== 'string' || !date(row.date) || row.session_id !== 'codex-daily' ||
        !['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens'].every((key) => token(row[key])) ||
        !Number.isFinite(row.total_cost_usd) || row.total_cost_usd < 0 || !Array.isArray(row.models) || !row.models.every(model)) {
      fail('Invalid Codex buffer. Preserve it and repair before retrying.');
    }
    // Never forward unknown fields from a hand-edited buffer.
    const clean = { member_name: row.member_name, date: row.date, session_id: 'codex-daily', input_tokens: row.input_tokens,
      output_tokens: row.output_tokens, cache_creation_tokens: row.cache_creation_tokens, cache_read_tokens: row.cache_read_tokens,
      total_cost_usd: row.total_cost_usd, models: row.models };
    latest.set(JSON.stringify([row.member_name, row.date]), clean);
  }
  return latest;
}
function saveBuffer(rows) {
  if (!rows.size) { if (existsSync(BUFFER)) unlinkSync(BUFFER); return; }
  const temporary = BUFFER + '.' + process.pid + '.tmp';
  writeFileSync(temporary, [...rows.values()].map((row) => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
  renameSync(temporary, BUFFER);
}
async function post(cfg, row) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(10000, DEADLINE_MS - (Date.now() - started)));
  try {
    const response = await fetch(cfg.server_url + '/api/ingest', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.team_key },
      body: JSON.stringify(row), signal: controller.signal });
    return response.status >= 200 && response.status < 300;
  } catch { return false; } finally { clearTimeout(timer); }
}

async function sync() {
  const cfg = config();
  lock();
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const snapshot = collect(today, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const rows = readBuffer();
  if (snapshot) {
    const key = JSON.stringify([cfg.member_name, snapshot.date]);
    rows.delete(key);
    // Current-day snapshot gets the first request; every obsolete duplicate has already gone.
    const current = new Map([[key, { member_name: cfg.member_name, ...snapshot }], ...rows]);
    rows.clear(); for (const [k, v] of current) rows.set(k, v);
  }
  saveBuffer(rows);
  for (const [key, row] of rows) {
    if (Date.now() - started > DEADLINE_MS - 11000) break;
    if (row.member_name !== cfg.member_name) continue;
    if (await post(cfg, row)) {
      rows.delete(key);
      saveBuffer(rows);
      writeFileSync(UPLOAD, String(Date.now()));
    }
  }
  if (rows.size) fail('Codex upload failed or pending data remains. Snapshot saved; retry sync codex.');
  clearError();
  if (!worker) console.log(snapshot ? 'Codex usage synced.' : 'No Codex usage for today.');
}

async function main() {
  if (process.argv[2] === '--notify') {
    let type;
    try { type = JSON.parse(process.argv[3] || '').type; } catch { fail('Invalid Codex notify JSON.'); }
    if (type !== 'agent-turn-complete') return;
    // Only event type is examined. Do not pass messages, thread id, cwd, or the raw argv to worker.
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => error('Could not start Codex sync worker.'));
    child.unref();
    return;
  }
  if (process.argv.length > 2 && !worker) fail('Usage: codex-sync.mjs [--notify <event JSON>]');
  await sync();
}

main().catch((e) => {
  // Only our fixed diagnostics are printed; never print collector output, config, or notify content.
  error(e instanceof Error && !e.code ? e.message : 'Codex sync failed. Check tracker directory permissions.');
  process.exitCode = 1;
}).finally(unlock);
