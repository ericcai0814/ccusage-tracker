#!/usr/bin/env node
// ccusage-tracker SessionEnd hook（Node.js 跨平台版，對應 session-end.sh v4）
// 上報今日用量快照 + session 行為指標。永遠 exit 0，絕不阻擋 Claude Code。
// 與 bash 版差異：上報採 await（有 5~15s timeout 上限）而非背景 &，以確保送達。
import { readFileSync, existsSync, appendFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CONFIG_DIR = join(homedir(), '.config', 'ccusage-tracker');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const BUFFER_FILE = join(CONFIG_DIR, 'buffer.jsonl');
const SESSIONS_DIR = join(CONFIG_DIR, 'sessions');
const LAST_FLUSH_FILE = join(CONFIG_DIR, 'last-flush.txt');
const LAST_ERROR_FILE = join(CONFIG_DIR, 'last-error.txt');
const CONTEXT_LIMIT = 200000;
const THROTTLE_MS = 5 * 60 * 1000;

// 硬性總上界：時間到直接 process.exit(0)，正在 await 的 POST 會被當場切斷。
// 不是各段 timeout 的加總 —— 必須大於 ccusage 25s + 上報 10s = 35s，
// 否則放寬 ccusage 上限會被這裡提前砍掉，等於白做。
// 上緣對齊 settings.json 的 hook timeout 45s，留 5s 讓 exit 收尾。
const DEADLINE_MS = 40000;
const STARTED_AT = Date.now();
function msLeft() { return DEADLINE_MS - (Date.now() - STARTED_AT); }

// --mode=stop: Stop hook 每輪對話結束跑，5 分鐘 throttle
// --mode=session-end（預設）: SessionEnd hook，無 throttle，跑完清 model file
// 比較前 toLowerCase，避免 --mode=Stop / --mode=SESSION-END 等大小寫差異 silent fall-through
const MODE = ((process.argv.find((a) => a.toLowerCase().startsWith('--mode=')) || '').slice(7) || 'session-end').toLowerCase();

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

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

async function postCurrentUsage(cfg) {
  const now = new Date();
  const yyyymmdd = '' + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate());
  const dashDate = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());

  // shell: true → 在 Windows 能找到 npm 全域安裝的 ccusage.cmd
  // 指令與參數合成單一字串、不傳 args 陣列：Node 22+ 對「shell: true + args 陣列」
  // 發 DEP0190 警告，而這支 hook 每次結束 session 都跑，警告會直接噴在使用者眼前。
  // yyyymmdd 由上面的 Date 組出、固定 8 位數字，無外部輸入，無注入風險。
  // timeout: spawnSync 是 sync 阻塞 event loop，外層 __deadline 救不了，必須在這裡硬上限。
  // 25s 而非 8s：ccusage 每次執行都全量掃描歷史用量檔，耗時隨累積資料單調成長。
  // 8s 在資料量夠大的成員機器上會被穩定 SIGKILL，且因為下面這條路徑取不到 payload、
  // 連 buffer 都寫不了，故障會完全無聲 —— 用量就停在某一天，沒有任何錯誤訊息。
  const r = spawnSync('ccusage daily --json --since ' + yyyymmdd,
    { encoding: 'utf8', shell: true, timeout: 25000, killSignal: 'SIGKILL' });
  if (!r || r.status !== 0 || !r.stdout) {
    markError(r && r.signal ? 'ccusage 逾時被中止（>25s），當日用量未上報' : 'ccusage 執行失敗，當日用量未上報');
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
  if (!ok) {
    try {
      const buffered = JSON.stringify(Object.assign(JSON.parse(body), { _buffered_at: new Date().toISOString() }));
      appendFileSync(BUFFER_FILE, buffered + '\n');
    } catch { /* 靜默 */ }
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
    // 過 throttle 立刻 mark：若後續 __deadline 贏走 race（process.exit(0)），下次仍正確被 throttle
    // 失去「失敗則下次重試」的能力，但 Stop 是 best-effort、SessionEnd 兜底，這個 trade-off 合理
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

  // 當日快照優先於重送舊資料。反過來的話，buffer 積壓時 flushBuffer 會先吃掉 15s，
  // 當日快照再撞上慢的 ccusage，總和 1 + 15 + 35 = 51s 就會超過 DEADLINE_MS 被切斷。
  // 兩者無資料相依，但不能併發：flushBuffer 結尾會整檔回寫 buffer，
  // 而 postCurrentUsage 上報失敗時會 append 到同一個檔，併發會讓回寫吃掉剛存的快照。
  await Promise.all([
    postSessionMetrics(cfg, sessionModel, transcriptPath),
    postCurrentUsage(cfg),
  ]);
  // 排在後面還多一個好處：當日快照剛落 buffer 就會被立刻重送一次（/api/ingest 是
  // (member, date, session_id) 的 upsert，重複送安全）
  await flushBuffer(cfg.server_url, cfg.team_key);
  // 注意：last-flush.txt 在 throttle 通過時就已寫；session-end mode 不寫，避免重置 Stop 窗口
}

// 走到這裡代表有東西卡住超過預期（正常最壞路徑是 1 + 35 = 36s）。
// 和 ccusage 取數失敗同一種處境：POST 被切斷，沒有 payload 可進 buffer，
// 不留痕跡就是又一次靜默失效。
const __deadline = new Promise((resolve) => setTimeout(() => {
  markError(DEADLINE_MS / 1000 + 's 內未完成上報，程序被強制結束');
  resolve();
}, DEADLINE_MS));
Promise.race([main(), __deadline]).catch(() => {}).finally(() => process.exit(0));
