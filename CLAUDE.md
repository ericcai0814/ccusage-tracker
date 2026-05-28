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

## Zeabur Deployment

部署於 Linode Seattle dedicated server（`server-6a1796f42bd255f07b151f36`）。

- Project ID: `6a1799b43efa5e8474b88042`（專案名 `ccusage-tracker`）
- Service ID: `6a1799c842ba884e012a607c`
- Environment ID: `6a1799b4453d7bd5cef43956`

Redeploy（更新程式碼，務必帶 `--service-id` 否則會建出重複 service）:

```bash
npx zeabur@latest deploy --project-id 6a1799b43efa5e8474b88042 --service-id 6a1799c842ba884e012a607c --json
```

環境變數（值不入庫）：`TEAM_KEY`（成員 hook 回報用，沿用舊值不可改）、`DB_PATH=/data/ccusage-tracker.db`、`DASHBOARD_PASSWORD`、`ADMIN_API_KEY`。資料庫為 SQLite，存於 `/data` persistent volume。

> 舊部署：project `cctracker`（`68635832390ecceb60605ec8`，AWS Tokyo 共享區），2026-05 遷移至此後可停用。
