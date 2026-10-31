<!-- SPECTRA:START v1.0.2 -->

# Spectra Instructions

This project uses Spectra for Spec-Driven Development(SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`.

## Use `/spectra-*` skills when:

- A discussion needs structure before coding → `/spectra-discuss`
- User wants to plan, propose, or design a change → `/spectra-propose`
- Tasks are ready to implement → `/spectra-apply`
- There's an in-progress change to continue → `/spectra-ingest`
- User asks about specs or how something works → `/spectra-ask`
- Implementation is done → `/spectra-archive`
- Commit only files related to a specific change → `/spectra-commit`

## Workflow

discuss? → propose → apply ⇄ ingest → archive

- `discuss` is optional — skip if requirements are clear
- Requirements change mid-work? Plan mode → `ingest` → resume `apply`

## Parked Changes

Changes can be parked（暫存）— temporarily moved out of `openspec/changes/`. Parked changes won't appear in `spectra list` but can be found with `spectra list --parked`. To restore: `spectra unpark <name>`. The `/spectra-apply` and `/spectra-ingest` skills handle parked changes automatically.

<!-- SPECTRA:END -->

## Deployment

自架 VM，以 Docker Compose 執行，對外經 Cloudflare Tunnel（`cctracker.erictree.me`）。VM 不開任何對外 port。2026-11-01 由 Zeabur 遷入（Zeabur 2026-12 停止營運）。主機位置與連線方式記在維護者的私人筆記，不入庫。

VM 上 `/opt/apps/` 結構：

```
compose.yml          # cctracker（本 repo）、blog、cloudflared
ccusage-tracker/     # 本 repo 的 clone，compose 從這裡 build
secrets/cctracker.env
cloudflared/         # config.yml（ingress）＋ creds.json（tunnel 憑證）
data/cctracker/      # SQLite，掛進容器 /data
```

更新程式碼：

```bash
cd /opt/apps/ccusage-tracker && git pull && cd .. && docker compose up -d --build cctracker
```

環境變數（值不入庫）：`TEAM_KEY`（成員 hook 回報用，沿用舊值不可改）、`DB_PATH=/data/ccusage-tracker.db`、`DASHBOARD_PASSWORD`、`ADMIN_API_KEY`、`SERVER_URL`、`PORT=3000`。

Cloudflare DNS 指向 tunnel 時，`cloudflared tunnel route dns` 要加 `--config /dev/null` 並直接寫 tunnel UUID；否則本機 `~/.cloudflared/config.yml` 裡的 `tunnel:` 會蓋過參數，把網域接到別條 tunnel。
