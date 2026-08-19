#!/usr/bin/env node
// ccusage-tracker SessionEnd hook（Node.js 跨平台版，對應 session-end.sh v4）
// 上報今日用量快照 + session 行為指標。永遠 exit 0，絕不阻擋 Claude Code。
//
// 兩段式：hook 程序（parent）只讀 stdin 然後把上報 detach 給 worker，立刻結束；
// worker 脫離 Claude Code 的 hook timeout，慢慢跑完 ccusage 與上報。
// 這麼做是因為 ccusage 每次都全量掃描歷史用量檔，耗時隨累積資料單調成長 ——
// 只要上報還綁在 hook 的時間預算裡，timeout 就是一條會被追上的線，不是安全邊界。
import { readFileSync, existsSync, appendFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

const CONFIG_DIR = join(homedir(), '.config', 'ccusage-tracker');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const BUFFER_FILE = join(CONFIG_DIR, 'buffer.jsonl');
const SESSIONS_DIR = join(CONFIG_DIR, 'sessions');
const LAST_FLUSH_FILE = join(CONFIG_DIR, 'last-flush.txt');
const LAST_ERROR_FILE = join(CONFIG_DIR, 'last-error.txt');
const LAST_UPLOAD_FILE = join(CONFIG_DIR, 'last-upload.txt');
const LOCK_FILE = join(CONFIG_DIR, 'worker.lock');
const CONTEXT_LIMIT = 200000;
const THROTTLE_MS = 5 * 60 * 1000;

// ccusage 上限。脫離 hook timeout 之後不必再壓到 25s —— 對照觀測值（一台 4s、
// 一台 11s）留一個量級的餘裕，真的撞到 120s 就該回頭處理架構而不是再放寬。
const CCUSAGE_TIMEOUT_MS = 120000;

// worker 的硬性總上界：時間到直接 process.exit(0)，正在 await 的 POST 會被切斷。
// 不是各段 timeout 的加總 —— 必須大於 ccusage 120s + 上報 10s = 130s。
const WORKER_DEADLINE_MS = 180000;
const STARTED_AT = Date.now();
function msLeft() { return WORKER_DEADLINE_MS - (Date.now() - STARTED_AT); }

// 鎖的時效要大於 worker 最長壽命，否則還在跑就被別人搶走
const LOCK_TTL_MS = WORKER_DEADLINE_MS + 30000;

// --mode=stop: Stop hook 每輪對話結束跑，5 分鐘 throttle
// --mode=session-end（預設）: SessionEnd hook，無 throttle，跑完清 model file
// --mode=worker: 由上面兩者 detach 出來的背景程序，實際做上報
// 比較前 toLowerCase，避免 --mode=Stop / --mode=SESSION-END 等大小寫差異 silent fall-through
const MODE = ((process.argv.find((a) => a.toLowerCase().startsWith('--mode=')) || '').slice(7) || 'session-end').toLowerCase();

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : '';
}

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

async function postJson(url, teamKey, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + teamKey },
      body,
      signal: ctrl.signal,
    });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function readConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const c = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    if (!c.server_url || !c.team_key || !c.member_name) return null;
    return c;
  } catch {
    return null;
  }
}

async function flushBuffer(serverUrl, teamKey) {
  if (!existsSync(BUFFER_FILE)) return;
  let lines;
  try {
    lines = readFileSync(BUFFER_FILE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  } catch { return; }
  if (lines.length === 0) return;

  // 重送舊資料是次要目的，不能吃掉當日快照的時間預算，也不能自己跨過 DEADLINE_MS ——
  // 被 process.exit(0) 從中切斷的話，下面那段清理與回寫都不會執行。
  // 預算不足就整批留著：buffer 本來就是為了下次重送而存在，晚一輪沒有損失。
  const budget = Math.min(15000, msLeft() - 3000);
  if (budget <= 0) return;

  const remaining = [];
  const start = Date.now();
  for (let i = 0; i < lines.length; i++) {
    // 逐筆再收斂一次：只看總預算的話，最後一筆仍可能帶著 5s timeout 跨過 deadline
    const perRequest = Math.min(5000, msLeft() - 2000);
    if (Date.now() - start >= budget || perRequest <= 0) { remaining.push(...lines.slice(i)); break; }
    const ok = await postJson(serverUrl + '/api/ingest', teamKey, lines[i], perRequest);
    if (!ok) remaining.push(lines[i]);
  }

  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  const cleaned = remaining.filter((l) => {
    try {
      const ba = JSON.parse(l)._buffered_at;
      if (!ba) return false;
      const t = Date.parse(ba);
      return !isNaN(t) && t >= cutoff;
    } catch { return false; }
  });

  try {
    if (cleaned.length === 0) {
      if (existsSync(BUFFER_FILE)) unlinkSync(BUFFER_FILE);
    } else {
      writeFileSync(BUFFER_FILE, cleaned.join('\n') + '\n');
    }
  } catch { /* 靜默 */ }
}

function extractMetrics(events) {
  const textLen = (content) => {
    if (typeof content === 'string') return content.length;
    if (Array.isArray(content)) return content.filter((b) => b && b.type === 'text').reduce((a, b) => a + ((b.text || '').length), 0);
    return 0;
  };

  const sessionId = (events.find((e) => e.sessionId != null) || {}).sessionId || '';
  const sessionName = (events.find((e) => e.slug != null) || {}).slug || '';
  const cwdEvent = events.find((e) => e.cwd != null);
  const project = cwdEvent ? (cwdEvent.cwd.split(/[/\\]/).pop() || '') : '';
  const branch = (events.find((e) => e.gitBranch != null) || {}).gitBranch || '';

  const externalUsers = events.filter((e) => e.type === 'user' && e.userType === 'external');
  const userMessages = events.filter((e) => e.type === 'user').length;
  const assistantMessages = events.filter((e) => e.type === 'assistant').length;
  const userAvgChars = externalUsers.length > 0
    ? Math.floor(externalUsers.reduce((a, e) => a + textLen(e.message && e.message.content), 0) / externalUsers.length)
    : 0;

  const toolUses = [];
  for (const e of events) {
    if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
      for (const b of e.message.content) if (b && b.type === 'tool_use') toolUses.push(b);
    }
  }
  const toolCalls = {};
  for (const t of toolUses) toolCalls[t.name] = (toolCalls[t.name] || 0) + 1;

  let toolErrors = 0;
  for (const e of events) {
    if (e.type === 'user' && e.message && Array.isArray(e.message.content)) {
      for (const b of e.message.content) if (b && b.type === 'tool_result' && b.is_error === true) toolErrors++;
    }
  }

  const timestamps = events.filter((e) => e.timestamp != null).map((e) => e.timestamp).sort();
  const startedAt = timestamps[0] || '';
  const endedAt = timestamps[timestamps.length - 1] || '';
  let durationMinutes = 0;
  if (startedAt && endedAt) {
    const s = Date.parse(startedAt.replace(/\.[0-9]+Z$/, 'Z'));
    const en = Date.parse(endedAt.replace(/\.[0-9]+Z$/, 'Z'));
    if (!isNaN(s) && !isNaN(en)) durationMinutes = Math.floor((en - s) / 60000);
  }

  const hasCommit = toolUses.some((t) => t.name === 'Bash' && /git commit/.test((t.input && t.input.command) || ''));
  const filesRead = toolUses.filter((t) => t.name === 'Read').length;
  const filesWritten = toolUses.filter((t) => t.name === 'Write').length;
  const filesEdited = toolUses.filter((t) => t.name === 'Edit').length;
  const skillsInvoked = [...new Set(toolUses.filter((t) => t.name === 'Skill').map((t) => t.input && t.input.skill).filter(Boolean))];

  let approx = 0;
  for (const e of events) {
    if (e.type !== 'user' && e.type !== 'assistant') continue;
    const c = e.message && e.message.content;
    if (typeof c === 'string') { approx += c.length; continue; }
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b) { approx += 50; continue; }
      if (b.type === 'text') approx += (b.text || '').length;
      else if (b.type === 'tool_use') approx += JSON.stringify(b.input || {}).length + 50;
      else if (b.type === 'tool_result') {
        let len = 0;
        if (typeof b.content === 'string') len = b.content.length;
        else if (Array.isArray(b.content)) len = b.content.reduce((a, x) => a + ((x && x.text ? x.text.length : 0)), 0);
        approx += len + 20;
      } else approx += 50;
    }
  }
  approx = Math.floor(approx / 4);

  return {
    session_id: sessionId,
    session_name: sessionName,
    project,
    branch,
    turns: externalUsers.length,
    user_messages: userMessages,
    assistant_messages: assistantMessages,
    user_avg_chars: userAvgChars,
    tool_calls: toolCalls,
    tool_call_total: toolUses.length,
    tool_errors: toolErrors,
    started_at: startedAt,
    ended_at: endedAt,
    duration_minutes: durationMinutes,
    has_commit: hasCommit,
    files_read: filesRead,
    files_written: filesWritten,
    files_edited: filesEdited,
    skills_invoked: skillsInvoked,
    hook_blocks: 0,
    approx_tokens: approx,
  };
}

async function postSessionMetrics(cfg, model, transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return;
  let events;
  try {
    events = readFileSync(transcriptPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return; }
  if (events.length === 0) return;

  const metrics = extractMetrics(events);
  const approxTokens = metrics.approx_tokens;
  delete metrics.approx_tokens;
  let ctxPct = Math.floor((approxTokens * 100) / CONTEXT_LIMIT);
  if (ctxPct > 100) ctxPct = 100;

  const body = JSON.stringify(Object.assign({}, metrics, {
    member_name: cfg.member_name,
    model,
    context_estimate_pct: ctxPct,
  }));
  await postJson(cfg.server_url + '/api/ingest/session', cfg.team_key, body, 10000);
}

// 取數失敗是整條上報鏈上唯一「連 buffer 都寫不了」的環節（沒有 payload 可暫存）。
// 留一行狀態到 last-error.txt，讓 tracker status 能把靜默失效變成看得見的東西。
function markError(reason) {
  try { writeFileSync(LAST_ERROR_FILE, new Date().toISOString() + ' ' + reason + '\n'); } catch { /* 靜默 */ }
}

function clearError() {
  try { if (existsSync(LAST_ERROR_FILE)) unlinkSync(LAST_ERROR_FILE); } catch { /* 靜默 */ }
}

// 上報改成非同步之後，「沒有錯誤痕跡」不再等於「有送出去」——
// worker 可能根本沒被啟動（spawn 被防毒攔下、系統立刻關機），那條路徑不會寫任何錯誤。
// 成功時留一個時間戳，tracker status 才分得出「一切正常」與「整條鏈默默停擺」。
function markSuccess() {
  try { writeFileSync(LAST_UPLOAD_FILE, String(Date.now())); } catch { /* 靜默 */ }
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

async function postCurrentUsage(cfg) {
  const now = new Date();
  const yyyymmdd = '' + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate());
  const dashDate = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());

  // shell: true → 在 Windows 能找到 npm 全域安裝的 ccusage.cmd
  // 指令與參數合成單一字串、不傳 args 陣列：Node 22+ 對「shell: true + args 陣列」
  // 發 DEP0190 警告，而這支腳本每次結束 session 都跑，警告會直接噴在使用者眼前。
  // yyyymmdd 由上面的 Date 組出、固定 8 位數字，無外部輸入，無注入風險。
  // timeout: spawnSync 是 sync 阻塞 event loop，外層 deadline 救不了，必須在這裡硬上限。
  // 這段只在 worker 裡跑，所以上限可以給到 120s 而不影響 session 結束的體感。
  const r = spawnSync('ccusage daily --json --since ' + yyyymmdd,
    { encoding: 'utf8', shell: true, timeout: CCUSAGE_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (!r || r.status !== 0 || !r.stdout) {
    markError(r && r.signal
      ? 'ccusage 逾時被中止（>' + CCUSAGE_TIMEOUT_MS / 1000 + 's），當日用量未上報'
      : 'ccusage 執行失敗，當日用量未上報');
    return;
  }
  let totals;
  try { totals = JSON.parse(r.stdout).totals; } catch { markError('ccusage 輸出無法解析為 JSON，當日用量未上報'); return; }
  if (!totals) { markError('ccusage 輸出缺少 totals 欄位，當日用量未上報'); return; }
  clearError();

  const body = JSON.stringify({
    member_name: cfg.member_name,
    date: dashDate,
    session_id: 'daily',
    input_tokens: totals.inputTokens || 0,
    output_tokens: totals.outputTokens || 0,
    cache_creation_tokens: totals.cacheCreationTokens || 0,
    cache_read_tokens: totals.cacheReadTokens || 0,
    total_cost_usd: totals.totalCost || 0,
    models: [],
  });

  const ok = await postJson(cfg.server_url + '/api/ingest', cfg.team_key, body, 10000);
  if (ok) {
    markSuccess();
    return;
  }
  try {
    const buffered = JSON.stringify(Object.assign(JSON.parse(body), { _buffered_at: new Date().toISOString() }));
    appendFileSync(BUFFER_FILE, buffered + '\n');
  } catch { /* 靜默 */ }
}

// ── 鎖：SessionEnd 與 Stop 可能前後腳觸發，兩個 worker 同時跑會各自全量掃一次
// ccusage（使用者感覺得到的 CPU），而且 flushBuffer 結尾的整檔回寫會互相覆蓋。
// 上報本身是 upsert，重複送不會錯，所以搶不到鎖就直接放棄，不排隊。
function acquireLock() {
  try {
    if (existsSync(LOCK_FILE)) {
      const parts = readFileSync(LOCK_FILE, 'utf8').trim().split(' ');
      const pid = parseInt(parts[0], 10);
      const at = parseInt(parts[1], 10);
      const fresh = !isNaN(at) && Date.now() - at < LOCK_TTL_MS;
      // 時效與存活缺一不可：只看時效會在 worker 被 kill 後空等，
      // 只看 PID 會因為 PID 被系統回收而誤判成「還在跑」。
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch { /* 不存在或無權限，當作已結束 */ }
      if (fresh && alive) return false;
    }
    writeFileSync(LOCK_FILE, process.pid + ' ' + Date.now());
    return true;
  } catch {
    return true; // 鎖檔讀寫不了就照跑：寧可偶爾重複，也不要整條上報鏈默默停掉
  }
}

function releaseLock() {
  try { if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE); } catch { /* 靜默 */ }
}

// worker：脫離 hook timeout，實際做上報
async function runWorker() {
  const cfg = readConfig();
  if (!cfg) return;
  if (!acquireLock()) return;
  try {
    // 當日快照優先於重送舊資料。反過來的話，buffer 積壓時 flushBuffer 會先吃掉 15s，
    // 兩者無資料相依，但不能併發：flushBuffer 結尾會整檔回寫 buffer，
    // 而 postCurrentUsage 上報失敗時會 append 到同一個檔，併發會讓回寫吃掉剛存的快照。
    await Promise.all([
      postSessionMetrics(cfg, argValue('--model'), argValue('--transcript')),
      postCurrentUsage(cfg),
    ]);
    // 排在後面還多一個好處：當日快照剛落 buffer 就會被立刻重送一次（/api/ingest 是
    // (member, date, session_id) 的 upsert，重複送安全）
    await flushBuffer(cfg.server_url, cfg.team_key);
  } finally {
    releaseLock();
  }
}

// hook：把上報丟給背景 worker，不等它。stdio 全部斷開、detached 自成 process group，
// 這樣 Claude Code 結束 session 時的收尾不會連帶把 worker 帶走。
function spawnWorker(model, transcriptPath) {
  try {
    const args = [fileURLToPath(import.meta.url), '--mode=worker'];
    if (model) args.push('--model=' + model);
    if (transcriptPath) args.push('--transcript=' + transcriptPath);
    // process.execPath 而非字面 'node'：使用者的 node 未必在 hook 的 PATH 上
    // （nvm / volta 尤其常見），而 parent 自己就是被 node 跑起來的。
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } catch (err) {
    markError('背景上報程序啟動失敗：' + ((err && err.message) || 'unknown'));
  }
}

async function main() {
  const cfg = readConfig();
  if (!cfg) return;

  // Stop hook：距上次上報 < 5 分鐘就跳過，避免每輪對話都打 server
  if (MODE === 'stop') {
    if (existsSync(LAST_FLUSH_FILE)) {
      try {
        const last = parseInt(readFileSync(LAST_FLUSH_FILE, 'utf8'), 10);
        if (!isNaN(last) && Date.now() - last < THROTTLE_MS) return;
      } catch { /* 讀不到當沒紀錄，繼續跑 */ }
    }
    try { writeFileSync(LAST_FLUSH_FILE, String(Date.now())); } catch { /* 靜默 */ }
  }

  const payload = await readStdin(1000);
  let transcriptPath = '';
  let hookSessionId = '';
  if (payload) {
    try {
      const p = JSON.parse(payload);
      transcriptPath = p.transcript_path || '';
      hookSessionId = p.session_id || '';
    } catch { /* 忽略 */ }
  }

  let sessionModel = '';
  if (hookSessionId) {
    const mf = join(SESSIONS_DIR, hookSessionId);
    if (existsSync(mf)) {
      try { sessionModel = readFileSync(mf, 'utf8').trim(); } catch { /* 忽略 */ }
      // Stop mode 反覆執行只讀不刪，保證後續 Stop 仍能讀到 model；SessionEnd 才刪
      if (MODE === 'session-end') {
        try { unlinkSync(mf); } catch { /* 忽略 */ }
      }
    }
  }

  // 這裡就結束 hook 的責任。ccusage 與上報全在 worker，session 結束不再等它們。
  spawnWorker(sessionModel, transcriptPath);
}

// worker 走到這裡代表有東西卡住超過預期（正常最壞路徑是 ccusage 120s + 上報 10s）。
// 和 ccusage 取數失敗同一種處境：POST 被切斷，沒有 payload 可進 buffer，
// 不留痕跡就是又一次靜默失效。
// parent 不套這個上界 —— 它只讀 stdin 加 spawn，撐死 1s，由 hook timeout 兜底就夠。
if (MODE === 'worker') {
  const __deadline = new Promise((resolve) => setTimeout(() => {
    markError(WORKER_DEADLINE_MS / 1000 + 's 內未完成上報，背景程序被強制結束');
    releaseLock();
    resolve();
  }, WORKER_DEADLINE_MS));
  Promise.race([runWorker(), __deadline]).catch(() => {}).finally(() => process.exit(0));
} else {
  main().catch(() => {}).finally(() => process.exit(0));
}
