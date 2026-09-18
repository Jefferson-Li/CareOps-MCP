# Interview / demo walkthrough · 面試 Demo 腳本

Prerequisites / 前置：`npm install`、Python venv、seed、CareOS + OCR 運行中。

```bash
npm run careos:seed
npm run careos          # terminal 1 → :3847
source .venv/bin/activate && npm run ocr   # terminal 2 → :3850
```

## Browser Test Console · 瀏覽器測試台（建議給客戶）

Open / 開啟：http://127.0.0.1:3847/ （Docker 若改埠則用 `.env` 的 `CAREOS_HOST_PORT`，例如 http://127.0.0.1:13847/）

Click **Full walkthrough** to run health → clients/compliance → OCR → address apply → roster.

點 **Full walkthrough** 即可一次跑完驗收步驟。

## Cursor

1. 確認 MCP 設定（可從 [`cursor-mcp.config.example.json`](cursor-mcp.config.example.json) 複製到 `.cursor/mcp.json`）。
2. **Settings → MCP** 啟用 `careops`（必要時 Reload Window）。
3. 在 Agent 聊天問：

> 用 `check_compliance_gaps` 查 high severity，再對 `samples/gp-letter-aisha.png` 呼叫 `ocr_care_document`。

或無 UI 驗證（與 Cursor 相同 stdio）：

```bash
npm run demo:mcp
npm run demo:full
```

## Script / 腳本

1. **Onboarding** — 打開 `docs/system-map.md`，說明 CareOS 欄位（`cl_id`、`done_flg`）。
2. **Compliance** — *Find high-severity compliance gaps.* → `check_compliance_gaps`
3. **OCR** — *OCR the sample GP letter.* → `ocr_care_document`
4. **Address** — pending → confirm → CareOS 寫入
5. **Roster** — *Eastwood conflicts, dry-run.* → `optimize_weekly_roster`
6. **Security** — 展示 `data/audit.jsonl` + `docs/healthcare-privacy.md`
