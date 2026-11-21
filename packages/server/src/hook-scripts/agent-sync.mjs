#!/usr/bin/env node
// 其他 agent 工具的用量快照（目前只有 Google Antigravity）。只傳 token、成本估計及 model 名稱；
// 不傳對話內容、prompt 或 hook payload。單檔、不 import 其他 tracker 檔：成員本機只會有這一個下載檔。
// 鎖、buffer、POST 與節流的寫法從 codex-sync.mjs 複製而來，兩邊用同一組測試案例防止漂移。
import { existsSync, readFileSync, writeFileSync, writeSync, unlinkSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 接下一個工具：在這裡加一筆，並用合成 collector 補測試。
const SOURCES = {
  antigravity: {
    label: 'Antigravity',
    subcommand: 'antigravity',
    sessionId: 'antigravity-daily',
    statePrefix: 'antigravity',
    minCollector: '20.0.21',
    dataRoots: ['.gemini/antigravity', '.gemini/antigravity-cli', '.gemini/antigravity-ide',
      '.gemini/antigravity-backup', '.gemini/antigravity-acp', '.config/antigravity'],
    dataDirEnv: 'ANTIGRAVITY_DATA_DIR',
    // Antigravity 的 Stop 規定 decision 必填，"continue" 會阻止停止，其他值都允許停止。
    hookStdout: '{"decision":"stop"}',
  },
};
const COLLECTOR_INSTALL = 'ccusage@20.0.51';
const COLLECTOR_MAJOR = 20;

const DIR = join(homedir(), '.config', 'ccusage-tracker');
const DEADLINE_MS = 180000;
// 與 Claude、Codex 同一個長度：Stop 每輪都觸發，沒有節流就每講一句話重跑一次收集器。
const THROTTLE_MS = 5 * 60 * 1000;
const STDIN_TIMEOUT_MS = 2000;
const STDIN_LIMIT_BYTES = 64 * 1024;
const started = Date.now();
const mode = process.argv[2];
const worker = mode === '--worker';
let state = null;
let ownsLock = false;

function paths(source) {
  const p = source.statePrefix;
  return { buffer: join(DIR, p + '-buffer.jsonl'), lock: join(DIR, p + '-worker.lock'), error: join(DIR, p + '-last-error.txt'),
    upload: join(DIR, p + '-last-upload.txt'), flush: join(DIR, p + '-last-flush.txt') };
}

function fail(message) { throw new Error(message); }
function error(message) {
  if (state) { try { writeFileSync(state.error, new Date().toISOString() + ' ' + message + '\n'); } catch { /* stderr still reports failure */ } }
  if (!worker) console.error(message);
}
function clearError() { if (existsSync(state.error)) unlinkSync(state.error); }
function token(value) { return Number.isSafeInteger(value) && value >= 0; }
function model(value) { return typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,200}$/.test(value); }
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
// ccusage 遇到不認得的顯示名會原樣回傳（空白、括號都在）。只清洗不拒收，
// 否則工具每推一個新 model，該成員當天的上報就整個斷掉。
function sanitizeModel(name) {
  return name.replace(/[^A-Za-z0-9_.:/-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200);
}

function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? '').trim().replace(/^ccusage /, ''));
  return match ? match.slice(1).map(Number) : null;
}
function atLeast(version, minimum) {
  for (let i = 0; i < 3; i += 1) if (version[i] !== minimum[i]) return version[i] > minimum[i];
  return true;
}

function lock(source) {
  const recovery = state.lock + '.reclaim';
  const busy = source.label + ' sync is already running. Retry shortly.';
  const freshOwner = () => {
    if (!existsSync(state.lock)) return false;
    const [pidText, atText] = readFileSync(state.lock, 'utf8').trim().split(' ');
    const pid = Number(pidText);
    const at = Number(atText) || statSync(state.lock).mtimeMs;
    let alive = !Number.isSafeInteger(pid) || pid <= 0;
    if (!alive) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code !== 'ESRCH'; } }
    return alive && Date.now() - at < DEADLINE_MS + 30000;
  };
  if (freshOwner()) fail(busy);
  let recovering = false;
  try {
    // Every acquisition, including a brand-new lock, must hold this guard.
    // Otherwise a fresh writer can appear between the stale check and unlink.
    writeFileSync(recovery, process.pid + ' ' + Date.now(), { flag: 'wx' });
    recovering = true;
    if (freshOwner()) fail(busy);
    if (existsSync(state.lock)) unlinkSync(state.lock);
    writeFileSync(state.lock, process.pid + ' ' + Date.now(), { flag: 'wx' });
    ownsLock = true;
  } catch (e) {
    if (e.code === 'EEXIST') fail(recovering ? busy :
      source.label + ' lock recovery is busy. If persistent, stop workers and remove ' + source.statePrefix + '-worker.lock.reclaim.');
    throw e;
  } finally {
    if (recovering) { try { unlinkSync(recovery); } catch { /* visible recovery marker is retained */ } }
  }
}
function unlock() {
  if (!ownsLock) return;
  try {
    if (readFileSync(state.lock, 'utf8').startsWith(process.pid + ' ')) unlinkSync(state.lock);
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

function collect(source, today, timezone) {
  const options = { encoding: 'utf8', shell: true, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 };
  const version = spawnSync('ccusage --version', options);
  if (version.status !== 0) fail('ccusage is missing or failed. Install ' + COLLECTOR_INSTALL + '.');
  const parsed = parseVersion(version.stdout);
  if (!parsed || parsed[0] !== COLLECTOR_MAJOR || !atLeast(parsed, parseVersion(source.minCollector))) {
    fail('This ccusage version cannot read ' + source.label + ' usage. Install ' + COLLECTOR_INSTALL + '.');
  }
  if (!/^[a-zA-Z0-9_+./-]+$/.test(timezone)) fail('Cannot determine a supported local timezone.');
  const compact = today.replaceAll('-', '');
  // Always select this source explicitly; unified daily mixes in every other agent.
  const r = spawnSync('ccusage ' + source.subcommand + ' daily --json --since ' + compact + ' --until ' + compact + ' --timezone ' + timezone,
    { ...options, timeout: 120000 });
  const label = source.label;
  if (r.status !== 0 || !r.stdout) fail(r.signal ? label + ' collector timed out. No usage uploaded.' : label + ' collector failed. No usage uploaded.');
  let data;
  try { data = JSON.parse(r.stdout); } catch { fail(label + ' collector returned invalid JSON. No usage uploaded.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.daily) ||
      !data.totals || typeof data.totals !== 'object' || Array.isArray(data.totals) ||
      'type' in data || 'data' in data || 'summary' in data) {
    fail('Unsupported ' + label + ' collector schema. No usage uploaded.');
  }
  if (data.daily.length === 0) return null;
  const row = data.daily[0];
  const buckets = ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens'];
  const valid = data.daily.length === 1 && row && typeof row === 'object' && date(row.date) && row.date === today &&
    [...buckets, 'totalTokens'].every((key) => token(row[key])) &&
    Number.isFinite(row.totalCost) && row.totalCost >= 0 &&
    Array.isArray(row.modelsUsed) && row.modelsUsed.every((name) => typeof name === 'string');
  // ccusage 把 reasoning（thinking）token 放在 totalTokens 減四項合計的差額，可見 output 不含它。
  const reasoning = valid ? row.totalTokens - buckets.reduce((sum, key) => sum + row[key], 0) : -1;
  const output = valid ? row.outputTokens + reasoning : -1;
  if (!valid || reasoning < 0 || !token(output)) fail('Invalid ' + label + ' daily date, token counts, cost or models. No usage uploaded.');
  const models = [...new Set(row.modelsUsed.map(sanitizeModel).filter(Boolean))];
  const unpriced = Array.isArray(data.totals.unpricedModels)
    ? [...new Set(data.totals.unpricedModels.filter((name) => typeof name === 'string').map(sanitizeModel).filter(Boolean))]
    : [];
  return { snapshot: { date: today, session_id: source.sessionId, input_tokens: row.inputTokens, output_tokens: output,
    cache_creation_tokens: row.cacheCreationTokens, cache_read_tokens: row.cacheReadTokens,
    total_cost_usd: row.totalCost === 0 ? 0 : row.totalCost, models }, unpriced };
}

function readBuffer(source) {
  if (!existsSync(state.buffer)) return new Map();
  const latest = new Map();
  const invalid = 'Invalid ' + source.label + ' buffer. Preserve it and repair before retrying.';
  for (const line of readFileSync(state.buffer, 'utf8').split('\n').filter(Boolean)) {
    let row;
    try { row = JSON.parse(line); } catch { fail(invalid); }
    if (!row || typeof row.member_name !== 'string' || !date(row.date) || row.session_id !== source.sessionId ||
        !['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens'].every((key) => token(row[key])) ||
        !Number.isFinite(row.total_cost_usd) || row.total_cost_usd < 0 || !Array.isArray(row.models) || !row.models.every(model)) {
      fail(invalid);
    }
    // Never forward unknown fields from a hand-edited buffer.
    const clean = { member_name: row.member_name, date: row.date, session_id: source.sessionId, input_tokens: row.input_tokens,
      output_tokens: row.output_tokens, cache_creation_tokens: row.cache_creation_tokens, cache_read_tokens: row.cache_read_tokens,
      total_cost_usd: row.total_cost_usd, models: row.models };
    latest.set(JSON.stringify([row.member_name, row.date]), clean);
  }
  return latest;
}
function saveBuffer(rows) {
  if (!rows.size) { if (existsSync(state.buffer)) unlinkSync(state.buffer); return; }
  const temporary = state.buffer + '.' + process.pid + '.tmp';
  writeFileSync(temporary, [...rows.values()].map((row) => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
  renameSync(temporary, state.buffer);
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

async function sync(source) {
  const cfg = config();
  lock(source);
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const collected = collect(source, today, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const stored = readBuffer(source);
  const key = collected ? JSON.stringify([cfg.member_name, collected.snapshot.date]) : null;
  // Current-day snapshot gets the first request; every obsolete duplicate has already gone.
  let rows = collected
    ? new Map([[key, { member_name: cfg.member_name, ...collected.snapshot }], ...[...stored].filter(([k]) => k !== key)])
    : stored;
  saveBuffer(rows);
  for (const [rowKey, row] of [...rows]) {
    if (Date.now() - started > DEADLINE_MS - 11000) break;
    if (row.member_name !== cfg.member_name) continue;
    if (await post(cfg, row)) {
      rows = new Map([...rows].filter(([k]) => k !== rowKey));
      saveBuffer(rows);
      writeFileSync(state.upload, String(Date.now()));
    }
  }
  if (rows.size) fail(source.label + ' upload failed or pending data remains. Snapshot saved; retry sync ' + source.statePrefix + '.');
  clearError();
  if (worker) return;
  console.log(collected ? source.label + ' usage synced.' : 'No ' + source.label + ' usage for today.');
  if (collected && collected.unpriced.length) {
    console.log('Note: no pricing for ' + collected.unpriced.join(', ') + '; excluded from the cost estimate.');
  }
}

function sourceFor(id) {
  return Object.prototype.hasOwnProperty.call(SOURCES, id) ? SOURCES[id] : null;
}

// hook payload 含使用者最後一句 prompt：只讀到 EOF、2 秒或 64 KB 為止，讀完即丟，不解析。
// 只讀是為了讓寫 payload 的一方不會因為沒人接收而出錯。
function drainStdin() {
  return new Promise((resolve) => {
    let bytes = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // stdin 若不關閉，flowing 的 stdin 會把 event loop 撐著不放。
      try { process.stdin.pause(); process.stdin.removeAllListeners('data'); } catch { /* 已結束 */ }
      resolve();
    };
    const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
    try {
      process.stdin.on('data', (chunk) => { bytes += chunk.length; if (bytes > STDIN_LIMIT_BYTES) finish(); });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
    } catch { finish(); }
  });
}

// hook 與搭便車共用的節流。手動 sync 不走這裡。
function throttled(source) {
  try {
    const last = parseInt(readFileSync(paths(source).flush, 'utf8'), 10);
    // age 為負代表時間戳在未來（時鐘校回，或 ~/.config 在不同步的機器間同步），不算剛跑過。
    const age = Date.now() - last;
    if (Number.isFinite(last) && age >= 0 && age < THROTTLE_MS) return true;
  } catch { /* 沒有紀錄或讀不到，視為可以跑 */ }
  return false;
}

function startWorker(id, source) {
  if (throttled(source)) return;
  // 先寫時間戳再 spawn：worker 失敗時下一次觸發仍受節流保護。
  try { writeFileSync(paths(source).flush, String(Date.now())); } catch { /* 寫不進去頂多多跑一次 */ }
  try {
    // worker 只拿到來源 id：不傳 payload、prompt、transcript 路徑或呼叫端的任何參數。
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', id], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => { /* hook 與 trigger 都必須安靜結束 */ });
    child.unref();
  } catch { /* 同上 */ }
}

// 偵測得到才觸發：只有根目錄不算（例如殘留的 ~/.gemini/antigravity/bin）。
function detected(source) {
  if (process.env[source.dataDirEnv]) return true;
  return source.dataRoots.some((root) => {
    try { return statSync(join(homedir(), root, 'conversations')).isDirectory(); } catch { return false; }
  });
}

async function hook(id) {
  const source = sourceFor(id);
  await drainStdin();
  if (source) {
    // 先印出允許停止的那一行，之後的任何失敗都改變不了它。
    try { writeSync(1, source.hookStdout + '\n'); } catch { /* stdout 關了也照樣結束 */ }
    try { startWorker(id, source); } catch { /* hook 永遠不擋 Antigravity */ }
  }
  // 明確結束，不等 stdin 或 spawn 的事件。
  process.exit(0);
}

function trigger() {
  for (const [id, source] of Object.entries(SOURCES)) {
    try { if (detected(source)) startWorker(id, source); } catch { /* 一個來源失敗不影響其他來源 */ }
  }
  process.exit(0);
}

async function main() {
  if (mode === '--hook') return hook(process.argv[3]);
  if (mode === '--trigger') return trigger();
  const id = worker ? process.argv[3] : mode;
  const source = sourceFor(id);
  if (!source || process.argv.length !== (worker ? 4 : 3)) {
    fail('Usage: agent-sync.mjs <' + Object.keys(SOURCES).join('|') + '> | --hook <source> | --trigger');
  }
  state = paths(source);
  await sync(source);
}

main().catch((e) => {
  // Only our fixed diagnostics are printed; never print collector output, config, or hook payload.
  error(e instanceof Error && !e.code ? e.message : 'Agent sync failed. Check tracker directory permissions.');
  process.exitCode = 1;
}).finally(unlock);
