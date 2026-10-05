# QA on Local PC — Bring-up Runbook

**Audience**: ops/dev running the GACP platform for QA testing on their local Windows PC, while a permanent cloud QA host is being chosen.

**Status as of 2026-05-02**: gacpth.com / 203.0.113.20 is being decommissioned. Until a new cloud host is provisioned, all QA testing happens on the developer's local PC. This runbook documents the exact steps for that.

---

## 1. Local PC inventory (verified 2026-05-02)

What's installed on this PC:

| Tool | Version | Purpose | State |
|---|---|---|---|
| Node.js | v22.14.0 | Runtime | ✓ Available |
| npm | 10.9.2 | Package manager | ✓ Available |
| pnpm | 8.15.0 | Workspace package manager (the project's primary) | ✓ Available |
| PostgreSQL 15 | service `postgresql-x64-15` | Database (data dir: `D:\GACP-Data\postgres-native\data`) | ✓ Running |
| Redis | — | Cache/queues | ✗ Not installed |
| Docker Desktop | — | Container runtime | ✗ Not installed |

Implications:
- **Redis is missing**: backend handles this gracefully (`services/redis-service.js:69` — "Redis unavailable, running without cache"). Caching disabled for local QA; no functional impact on the 8 PRs shipped this session.
- **Docker is missing**: cannot use `docker-compose.qa.yml`. We run apps directly via `pnpm`.
- **gacpth.com is being retired**: cannot deploy to it; not a target.

---

## 2. Prerequisites (already satisfied on this PC)

The existing `apps/backend/.env` is configured against the local PostgreSQL with:

```
DATABASE_URL=postgresql://gacp:<password>@localhost:5432/gacp_db?schema=public
NODE_ENV=development
PORT=8000
HOST=0.0.0.0
JWT_SECRET=<64 chars>          # legacy alias for HEALTH_JWT_SECRET
DTAM_JWT_SECRET=<64 chars>     # legacy alias for PROVIDER_JWT_SECRET
ENCRYPTION_KEY=<64 chars>
REDIS_URL=redis://redis:6379   # docker-only hostname; ignored in local mode
```

Latest migrations on disk include:
- `20260502060000_rls_quiet_observe_only` (PR #174 — RLS quiet)
- `20260502050000_add_application_draft_version` (PR #171 — optimistic lock)

PRs #176–#183 from this session add **no new migrations** — they're code-only changes. So if your local DB is already up-to-date, you only need to pull and restart.

---

## 3. Bring-up — exact PowerShell commands

Run from project root (`D:\GACP-Certification-Application`) in PowerShell.

### 3.1 Sync code

```powershell
git checkout deploy/production
git pull origin deploy/production
git log --oneline -1
# Expect: ed26d43e feat(pdpa): user-facing privacy page (PDPA Section 30 + 33 UI) (#183)
```

### 3.2 Install workspace deps (no-op if `pnpm-lock.yaml` is unchanged)

```powershell
pnpm install --frozen-lockfile
```

### 3.3 Apply pending migrations (likely no-op)

```powershell
pnpm --filter gacp-backend exec prisma migrate deploy
# Expect: "No pending migrations to apply" — all migrations through #174 already applied locally.
```

### 3.4 Build frontend (so QA exercises the production build path, not dev hot-reload)

```powershell
pnpm --filter web-app build
```

Why the build (and not `pnpm dev`): PR #177's MFA page and PR #183's PDPA page should be tested against the actual `next start` runtime, since that's what would land in production. `pnpm dev` differs in code-splitting, CSR/SSR boundary handling, and error overlays.

### 3.5 Start backend (terminal 1)

```powershell
$env:NODE_ENV = "development"   # keeps env-validator relaxed; same as before this session
$env:HEALTH_JWT_SECRET = (Get-Content apps\backend\.env | Select-String "^JWT_SECRET=").Line -replace "^JWT_SECRET=",""
$env:PROVIDER_JWT_SECRET = (Get-Content apps\backend\.env | Select-String "^DTAM_JWT_SECRET=").Line -replace "^DTAM_JWT_SECRET=",""
pnpm --filter gacp-backend dev
# Listens on http://localhost:8000
```

The two `$env:` lines mirror legacy `JWT_SECRET` / `DTAM_JWT_SECRET` to the canonical names (`HEALTH_JWT_SECRET` / `PROVIDER_JWT_SECRET`) that the env-validator prefers. Either set works thanks to the fallback chain in `config/env-validator.js`, but using the canonical names suppresses warnings.

### 3.6 Start frontend (terminal 2)

```powershell
pnpm --filter web-app start
# Listens on http://localhost:3000 (production-style server with the build from 3.4)
```

If you want hot-reload while iterating, use `pnpm --filter web-app dev` instead — accept that you're testing a slightly different artifact than what would deploy.

### 3.7 Smoke test — backend up

```powershell
Invoke-RestMethod http://localhost:8000/api/health
# Expect: { success: True, version: "3.0.0", database: "postgresql", dbStatus: ... }

Invoke-RestMethod http://localhost:8000/api/version
# Expect: { success: True, version: "3.0.0", features: [...] }
```

If `/api/health` returns `database: connected` you're ready to test the 8 PRs.

---

## 4. Smoke-test checklist — 8 PRs from this session

Each row is one observable behavior. Run in this order to chain test data sensibly.

### PR #176 — Applicant notifications (3 transition gaps)

| Step | Action | Expected |
|---|---|---|
| 1 | Log in as `1100000000008` (สมชาย ทดสอบ) at `/auth/health/login` | Lands on `/health/dashboard` |
| 2 | Create a new application draft → fill all 9 wizard steps → click "ส่งคำขอ" | 200 OK, redirect to payment |
| 3 | Click bell icon (top right) | **NEW** row "✅ ส่งคำขอสำเร็จ — กรุณาชำระค่าธรรมเนียมงวดที่ 1" |
| 4 | (As scheduler in another browser) `/provider/scheduler/applications/{id}/assign` → assign reviewer | Both reviewer AND applicant get rows. Applicant: "คำขอของคุณเข้าสู่ขั้นตอนตรวจเอกสาร" |
| 5 | (As auditor) reject from `AUDIT_CONFIRMED` state | Applicant gets "❌ คำขอไม่ผ่านการพิจารณา" with reason |

### PR #177 — Provider MFA setup

| Step | Action | Expected |
|---|---|---|
| 1 | Log in as a provider account at `/auth/provider/login` | Lands on provider dashboard |
| 2 | Click "Officer Profile" → in Quick Actions, click "Security & MFA" | Loads `/provider/profile/security`; status reads "ยังไม่เปิดใช้งาน" |
| 3 | Click "เปิดใช้งาน MFA" | QR code renders + secret string displayed |
| 4 | Scan QR with Google Authenticator → enter 6-digit code → "ยืนยันและเปิดใช้งาน" | 8 backup codes shown; "Copy all" works |
| 5 | Click "ฉันบันทึกแล้ว" | Status flips to "เปิดใช้งาน" |
| 6 | Reload page → click "ปิด MFA" → enter current 6-digit code → confirm | Status flips back to "ยังไม่เปิดใช้งาน" |

### PR #178 — Refresh token rotation

| Step | Action | Expected |
|---|---|---|
| 1 | Log in (any portal); open DevTools → Application → Cookies | Note `refresh_token` value (call it `RT-1`) |
| 2 | Wait ~14 minutes for access token to expire (or manually delete `auth_token` cookie) | Frontend triggers `/refresh` |
| 3 | Inspect `refresh_token` cookie again | Value is **DIFFERENT** (call it `RT-2`) — rotation worked |
| 4 | Backend logs (terminal 1) | Should show `Token refreshed (rotated) for user: <id>` and `TOKEN_REFRESHED` audit entry |

### PR #179 — Sentry mandatory in production

This one is hard to test without setting `NODE_ENV=production` locally, which would change other behaviors. Skip on local QA; verified via `env-validator-sentry.test.js` (6 unit tests, all passing).

### PR #180 — PDPA backend endpoints

| Step | Action | Expected |
|---|---|---|
| 1 | (After health login) curl with cookie: `curl -b "auth_token=<jwt>" http://localhost:8000/api/auth/health/me/export -o export.json` | 200 OK, file `export.json` saved with subject + applications + farms etc. |
| 2 | Open `export.json` | Contains `regulation: "Thai PDPA Section 30..."`, `subject: {...}`, `applications: [...]`, `notice: ...` |
| 3 | Verify `subject.password` does NOT exist in export | Field absent (sensitive credentials excluded) |
| 4 | curl wrong password: `curl -X DELETE -H "Content-Type: application/json" -d '{"password":"wrong"}' http://localhost:8000/api/auth/health/me/delete -b "auth_token=<jwt>"` | 401 INVALID_CREDENTIALS |

### PR #183 — PDPA frontend privacy page

| Step | Action | Expected |
|---|---|---|
| 1 | Log in as health user → `/health/profile` | "ความเป็นส่วนตัว (PDPA)" link visible in actions list |
| 2 | Click → `/health/profile/privacy` loads | Two cards: data export + account deletion |
| 3 | Click "ดาวน์โหลดเป็น JSON" | Browser download dialog → file `gacp-data-export-2026-05-02.json` |
| 4 | Click "เริ่มขั้นตอนลบบัญชี" | Form expands with password + reason + confirm-text fields |
| 5 | Try empty form → "ยืนยันลบบัญชี" | Button disabled (correct UX) |
| 6 | Type wrong confirm phrase → submit | Toast error "ข้อความยืนยันไม่ถูกต้อง" |
| 7 | Type wrong password + correct phrase → submit | 401 → toast "ลบบัญชีไม่สำเร็จ" with detail |
| 8 | Type correct password + phrase → submit | 200 → toast "ส่งคำขอลบบัญชีแล้ว" → 1.5s delay → redirect to `/auth/health/login?deleted=1` |

After step 8, the test user is now soft-deleted. To continue testing with that user, manually flip `isDeleted=false` in the DB:

```powershell
& "D:\PostgreSQL\15\bin\psql.exe" -U gacp -d gacp_db -c "UPDATE users SET ""isDeleted""=false, ""deletedAt""=NULL WHERE ""healthId""='1100000000008';"
```

### PR #181 + #182 — Deploy safety belts

These only fire during a real production deploy; not reachable from local QA. Verified by reading the code (`bash -n` syntax check passed at commit time).

---

## 5. Stop / restart

```powershell
# Stop both terminals: Ctrl+C in each

# Restart after code change (e.g., after pulling a new PR):
git pull origin deploy/production
pnpm install --frozen-lockfile
pnpm --filter gacp-backend exec prisma migrate deploy   # only if new migrations
pnpm --filter web-app build                             # rebuild frontend
# Then re-run 3.5 and 3.6
```

---

## 6. Known caveats on local QA

| Caveat | Impact | Mitigation |
|---|---|---|
| Redis missing | Cache disabled; some background jobs (SLA breach) won't fire | None of the 8 PRs depend on jobs; ignore for now |
| `EMAIL_ENABLED=false` (default) | Invitation emails (PR #173) and slip notifications go to mock-mode log | Verify via backend log entries; real SMTP test needs a sandbox account |
| `NODE_ENV=development` | Sentry strict check (PR #179) doesn't fire | Tested via unit tests instead |
| Cookie `Secure=false` | Cross-tab sync still works on http://localhost; would fail on https without TLS | Production has TLS — non-issue there |
| Single PG instance | No staging/prod separation locally | Use a separate DB name (e.g., `gacp_qa_db`) if needed; switch via `DATABASE_URL` env var |

---

## 7. Pre-deploy checklist (when a new cloud host is ready)

When a permanent QA / production host is provisioned, before flipping switches:

1. Provision Sentry project at https://sentry.io → copy DSN
2. Set `SENTRY_DSN` in the host's `.env.production`
3. Set the canonical JWT secret names: `HEALTH_JWT_SECRET`, `PROVIDER_JWT_SECRET`
4. Configure `secrets.PRODUCTION_SSH_KEY`, `secrets.PRODUCTION_HOST`, `secrets.PRODUCTION_USER` in the GitHub repo (currently empty — verified via `gh secret list`)
5. Flip `ENABLE_IMAGE_PUBLISH=true` and `ENABLE_PRODUCTION_DEPLOY=true` repo Variables
6. First deploy uses the workflow's Sentry pre-flight (PR #181) which aborts safely if `SENTRY_DSN` is missing on the new host

The `scripts/deploy/deploy-production.sh` (PR #182) gives the same safety belt for manual SSH deploys.

---

## 8. References

- `apps/backend/config/env-validator.js` — env requirements, including SENTRY_DSN gate
- `apps/backend/services/pdpa-service.js` — PDPA logic (export + soft-delete)
- `apps/backend/routes/api/identity/mfa.js` — MFA endpoints
- `.github/workflows/production.yml` — CI deploy (with Sentry pre-flight per PR #181)
- `scripts/deploy/deploy-production.sh` — manual deploy (with Sentry pre-flight per PR #182)
