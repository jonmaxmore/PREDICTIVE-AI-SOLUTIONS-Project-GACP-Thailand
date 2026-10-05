# Flow-proof harness
Proves (or honestly fails to prove) เกษตรกรสมัคร → ยื่นคำขอ → ชำระค่าธรรมเนียมงวด 1 →
เจ้าหน้าที่ตรวจเอกสาร → นัดตรวจประเมิน → ผลตรวจผ่าน → ออกใบรับรอง → ผู้บริโภคสแกน QR
— real Playwright clicks, real API capture, real Postgres row diffs, real
design-token check, per step.

## Run (one command, from repo root)
```bash
bash scripts/flow-proof.sh
```
Auto-detects and prints which mode it ran:

| Mode | Requires | Result |
|---|---|---|
| `full` (ก) | Postgres + backend `:8000/api/health` 200 + frontend `:3000` 200 | full 8-step proof, all 4 layers |
| `ui-api` (ข) | backend + frontend reachable, DB not required | UI+API proven; DB layer BLOCKED |
| `dry-run` (ค) | none | structural self-check only |

Override: `FLOW_PROOF_MODE=full\|ui-api\|dry-run` — exits 1 loudly if that
mode's prerequisites aren't actually met (never a silent skip).

## Env vars
- `DATABASE_URL` — same Postgres the backend uses.
- `FLOW_PROOF_API_BASE` (default `:8000`), `FLOW_PROOF_BASE_URL` (default `:3000`).
- `FLOW_PROOF_REVIEWER_ID`/`_PW`, `_SCHEDULER_`, `_AUDITOR_`, `_ADMIN_` — provider logins. Unset = that step BLOCKED, not guessed.
- `FLOW_PROOF_ALLOW_PARTIAL=1` — acknowledge exit 0 for a non-`full` run.
- `WORK_ITEM` (default `flow-proof`) — evidence in `evidence/<WORK_ITEM>/<date>/`.

## On staging (operator, ≤3 commands)
```bash
cd apps/backend && npm run prisma:generate && cd ../..   # skip if already generated
DATABASE_URL=<staging-pg-url> FLOW_PROOF_API_BASE=https://staging.gacpth.com FLOW_PROOF_BASE_URL=https://staging.gacpth.com \
  FLOW_PROOF_REVIEWER_ID=... FLOW_PROOF_REVIEWER_PW=... FLOW_PROOF_SCHEDULER_ID=... FLOW_PROOF_SCHEDULER_PW=... FLOW_PROOF_AUDITOR_ID=... FLOW_PROOF_AUDITOR_PW=... FLOW_PROOF_ADMIN_ID=... FLOW_PROOF_ADMIN_PW=... \
  bash scripts/flow-proof.sh
open evidence/flow-proof/<date>/report.html
```
Chromium expected at `/opt/pw-browsers/chromium` (falls back if absent) — never runs `playwright install`.
