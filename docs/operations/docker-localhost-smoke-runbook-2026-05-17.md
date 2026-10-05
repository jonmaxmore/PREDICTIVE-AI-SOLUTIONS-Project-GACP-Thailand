# Docker Localhost Smoke Runbook — 2026-05-17 (Loop W exit gate)

> **Audience:** orchestrator + ops lead running the post-Loop-W-commit smoke verification BEFORE the production cutover sign-off.
> **Companion docs:**
> - `docs/operations/cutover-checklist-2026-05-17.md` — the broader pre-T-7 gate set; this runbook satisfies §3 T-3 pre-cutover smoke + §8 Go/No-Go row "W5 Docker localhost smoke runbook passed"
> - `docs/operations/loop-w-2026-05-17-sign-off.md` — Loop W code-complete sign-off; this runbook is the verification artefact for §6 "Exit criteria — Docker smoke"
> - `docs/operations/sentry-installation-guide-2026-05-17.md` — consumer-facing Sentry provisioning (pre-req for step 7 alert-rule fire verification)
> - `docs/operations/sentry-alert-rules-2026-05-17.md` (W5-A) — the 5 alert rules whose firing is verified by step 7
> - `docs/operations/deploy-checklist-2026-05-16.md` — production deploy harness gates (NOT what this runbook runs — this is local-prod smoke, not production deploy)
> - `docs/operations/rollback-runbook-2026-05-16.md` — escalation path if Docker smoke surfaces a regression
> - `.husky/pre-commit` — single source of truth for the pre-commit gates that fire BEFORE this runbook runs (per I-013)

**This runbook is the orchestrator's verification step after Loop W (W5) commits land on `main`.** The agent that wrote this runbook (W5-D) does NOT itself run Docker — the orchestrator (or a follow-up agent) executes the 10 steps below post-commit, captures each step's output, and attaches it to the Loop W sign-off doc. If ANY step fails, escalate per the per-step failure-mode rows below.

Per **I-013** every command in this runbook quotes an existing path/binary in tree — verified by `Glob`/`Read` before write. Per **I-015** orchestrator captures `${PIPESTATUS[0]}` rather than `$?` after pipes when chaining through `tee`.

---

## Pre-flight (before step 1)

Verify the following environment state. If any row fails, do NOT proceed.

| # | Check | How to verify | Pass condition |
|---|-------|--------------|----------------|
| P1 | Docker Desktop running | `docker info` | Exit 0; lists `Server Version` |
| P2 | Compose plugin v2 available | `docker compose version` | Exit 0; prints `Docker Compose version v2.x.x` |
| P3 | Node 24 LTS available | `node --version` | Exit 0; major version 24.x (repo pin since `chore/node-24`, 2026-09-26) |
| P4 | pnpm available | `pnpm --version` | Exit 0 |
| P5 | Required env vars exported | `env | grep -E '^(DB_PASSWORD|JWT_SECRET|SESSION_SECRET|MASTER_ENCRYPTION_KEY|AUDIT_INTEGRITY_KEY|REDIS_URL|SENTRY_DSN)='` | At minimum DB_PASSWORD + JWT_SECRET + MASTER_ENCRYPTION_KEY set (Sentry DSN stub OK for smoke per W5-A `https://stub@stub/0` pattern) |
| P6 | No conflicting containers | `docker ps --filter "name=gacp-" --format '{{.Names}}'` | Empty list (no leftover containers from a previous smoke) |
| P7 | Disk free ≥ 5 GB | `df -h .` (Linux/Mac) or `Get-PSDrive C` (Windows) | At least 5 GB on the drive hosting Docker volumes |
| P8 | Pre-commit gates green on the smoke SHA | git log -1 + verify CI green | The W5 commit SHA's `.github/workflows/ci.yml` run shows all jobs PASS |

**Compose file selection:** Use `docker-compose.local-prod.yml` for the closest-to-prod surface (nginx + SSL + production builds + postgres + redis + backend + frontend + cert-gen). DO NOT use `docker-compose.yml` (dev mode) for this smoke — the cutover surface is production-shaped.

---

## Step 1 — Pre-flight verification

**Verbatim commands:**
```bash
docker info > /dev/null && echo "OK Docker daemon"
docker compose version
node --version
pnpm --version
test -f docker-compose.local-prod.yml && echo "OK compose file present"
test -f scripts/test/run-chaos-journey-check.js && echo "OK chaos script present"
test -f apps/web-app/playwright/farmer-full-journey.spec.ts && echo "OK W1-A spec present"
test -f apps/web-app/playwright/dtam-staff-full-journey.spec.ts && echo "OK W1-B spec present"
test -f apps/web-app/playwright/account-split-journey.spec.ts && echo "OK W1-C spec present"
test -f apps/web-app/playwright/accessibility-scan.spec.ts && echo "OK W3-B axe spec present"
```

**Expected output (1-2 lines per command):**
```
OK Docker daemon
Docker Compose version v2.x.x
v24.x.x
9.x.x or 10.x.x
OK compose file present
OK chaos script present
OK W1-A spec present
OK W1-B spec present
OK W1-C spec present
OK W3-B axe spec present
```

**Failure mode + escalation:**
- Docker daemon down → start Docker Desktop, retry. If repeated daemon crash → P2 follow-up, file ops ticket.
- Compose file missing → abort smoke; the W5 commit is malformed (compose file was deleted in error). Roll back commit.
- Playwright spec missing → W1-A/B/C output corrupted; revert and re-run Loop W from the failing iter.

---

## Step 2 — Bring stack up

**Verbatim command:**
```bash
docker compose -f docker-compose.local-prod.yml up --detach
```

**Expected output (1-2 lines):**
```
[+] Running 7/7
  ✔ Container gacp-postgres-local   Started
  ✔ Container gacp-redis-local      Started
  ✔ Container gacp-backend-local    Started
  ✔ Container gacp-frontend-local   Started
  ✔ Container gacp-nginx-local      Started
  ✔ Container gacp-cert-gen         Started
```

(The 7th may be a network create line; exact wording depends on Compose plugin version.)

**Expected services up (verify via `docker compose -f docker-compose.local-prod.yml ps`):**
- `gacp-nginx-local` — listens on 80/443/8080 (nginx gateway, self-signed SSL)
- `gacp-backend-local` — listens on internal Docker network (NOT exposed; nginx proxies)
- `gacp-frontend-local` — Next.js production build
- `gacp-postgres-local` — Postgres 15+
- `gacp-redis-local` — Redis 7+
- `gacp-cert-gen` — one-shot cert-gen container (exits 0)

**Failure mode + escalation:**
- Backend boot crashes with `MODULE_NOT_FOUND: @sentry/node` → **W5-A regression**; package was not installed. Abort. Re-run `pnpm install` at the W5 SHA + re-commit.
- Postgres / Redis containers in CrashLoopBackOff → check `docker logs gacp-postgres-local` for env-var typo (DB_PASSWORD usually). Fix `.env` + retry step 2.
- nginx SSL cert missing → `nginx/ssl/local/` not present; run `bash scripts/gen-local-ssl.sh` then retry.
- Port 80/443 already in use on host → kill the conflicting process (`lsof -i :443`) or set `NGINX_HTTPS_PORT=8443` and retry. Capture the override in the smoke log.

---

## Step 3 — Wait-for-ready

**Verbatim commands:**
```bash
# Poll backend /api/health until 200 OR 60s elapsed
until curl -sf -o /dev/null -w '%{http_code}' http://localhost:8080/health | grep -q 200; do
  sleep 2
  echo "waiting for backend..."
done
echo "OK backend health 200"

# Repeat for the frontend SSR (port 443 via nginx; self-signed → -k)
until curl -sfk -o /dev/null -w '%{http_code}' https://localhost/health | grep -q 200; do
  sleep 2
  echo "waiting for nginx → frontend..."
done
echo "OK nginx + frontend ready"
```

**Expected output (final 2 lines):**
```
OK backend health 200
OK nginx + frontend ready
```

**Failure mode + escalation:**
- Backend `/api/health` returns 500 → `docker logs gacp-backend-local` to inspect the boot trace. The most likely cause post-W5 is the **Sentry orphan-require** crash (caught by W5-A) re-introduced via a botched merge. If reproducible, abort smoke + revert.
- Backend `/api/health` returns 200 with `{ status: 'degraded' }` payload → Redis or Postgres dependency down; fix step 2 first.
- Wait loops > 5 min → backend is hanging on a migration or a Sentry init that's blocking on network; check `docker logs gacp-backend-local | tail -50`.

Per **I-015**: do NOT chain through `tee`; the `${PIPESTATUS[0]}` discipline matters here because the polling loop's exit code on success is the `grep -q 200` exit (0), which is what we want.

---

## Step 4 — Playwright mock-mode pass (W1 baseline)

**Verbatim command:**
```bash
cd apps/web-app && npx playwright test playwright/ --project=chromium
```

**Expected output (final 2-3 lines):**
```
  XX passed (Y.Zs)
```
where XX matches the W1-shipped spec count (≥ farmer + DTAM + account-split + accessibility-scan + auditor-flow + farmer-payment-flow + renewal-flow + vat-filing-flow = 8 specs minimum). Zero failures.

**Failure mode + escalation:**
- Any test fails → CRITICAL regression. Capture the Playwright HTML report (`apps/web-app/playwright-report/`) + the failing test's trace zip + escalate to Loop W reviewer. Most-likely cause: a W5-C jsx-a11y rewire accidentally changed a selector that an existing Playwright test relies on. Revert the offending file + re-run.
- All tests pass but Playwright reports `MODULE_NOT_FOUND: @hookform/resolvers/zod` during dev-server boot → W1 deferred bug NOT fixed; file P1 + see step 8 verification.
- Per **I-018**: if a mock-mode spec uses `page.request.*` for a URL that has a `page.route()` mock, the mock will silently bypass; verify by `grep -n 'page.request' apps/web-app/playwright/*.spec.ts` — should be EMPTY for mock-mode specs.

---

## Step 5 — Playwright live-mode pass

**Verbatim command:**
```bash
cd apps/web-app && E2E_LIVE_BACKEND=1 npx playwright test \
  playwright/farmer-full-journey.spec.ts \
  playwright/dtam-staff-full-journey.spec.ts \
  playwright/account-split-journey.spec.ts \
  --project=chromium
```

**Expected output (final 1-2 lines):**
```
  3 passed (XX.Ys)
```

(The `E2E_LIVE_BACKEND=1` env disables `page.route()` mocks; the specs hit the real Docker stack from step 2.)

**Failure mode + escalation:**
- A live-mode spec fails with a 5xx response → check backend logs; could be a missing seed (the local-prod stack does NOT auto-seed; if the smoke needs a HEALTH user + a DTAM user, seed them via `pnpm --filter @gacp/backend run seed:smoke` BEFORE this step).
- A live-mode spec fails with a 4xx but mock-mode (step 4) passed → contract drift between mock and real backend. Likely cause: W4-D OpenAPI annotation drift; cross-check `docs/api/openapi.json` against the failing route.
- A live-mode spec fails with 200-but-wrong-body → real backend produced different shape than mock. Likely cause: real backend changed but Playwright mock did not — escalate to W4-B error-code-catalog + W4-D openapi-spec test owners.

---

## Step 6 — axe-core baseline scan

**Verbatim command:**
```bash
cd apps/web-app && npx playwright test playwright/accessibility-scan.spec.ts --project=chromium
```

After the test runs, the per-page violation JSON files appear in `apps/web-app/playwright/.axe-results/`. Capture the baseline:

```bash
# From repo root
mkdir -p docs/handoffs/iter-W5
cp -r apps/web-app/playwright/.axe-results/ docs/handoffs/iter-W5/axe-baseline/
# Or, if a single combined JSON is preferred:
node -e "const fs=require('fs');const p=require('path');const dir='apps/web-app/playwright/.axe-results';const out={};for(const f of fs.readdirSync(dir)){out[f.replace('.json','')]=JSON.parse(fs.readFileSync(p.join(dir,f),'utf8'));}fs.writeFileSync('docs/handoffs/iter-W5/axe-baseline.json',JSON.stringify(out,null,2));"
echo "OK axe-baseline.json written"
```

**Expected output (final 2-3 lines):**
```
  5 passed (X.Ys)
OK axe-baseline.json written
```

The W3-B accessibility-scan spec asserts on the High-severity (critical + serious) WCAG 2.1 AA subset; Moderate + Minor findings are persisted to the JSON for the ratchet window without failing the test. Per W5-C the residual jsx-a11y warning count is ≤ 28; that's the LINT residual, not the axe-runtime residual — the two can differ.

**Failure mode + escalation:**
- W3-B spec reports > 5 high-severity violations on any of the 5 scanned surfaces (`/`, `/auth/health/login`, `/health/dashboard`, `/provider/dashboard`, `/admin/users`) → escalate to W5-C +1 deferred backlog. The W3-B spec's per-page expect should fail in that case; the orchestrator MUST NOT mark this step PASS if any expect failed.
- `axe-baseline.json` not written → check the `.axe-results/` directory exists; the W3-B spec creates it at runtime. If absent, the spec failed to launch axe-core injection — re-run with `DEBUG=pw:api`.

---

## Step 7 — Chaos-journey check (verifies 5 alert rules fire)

**Verbatim command:**
```bash
BASE_URL=http://localhost:8080/api node scripts/test/run-chaos-journey-check.js
```

(`http://localhost:8080/api` matches the nginx local-prod proxy → backend; backend's `/api/health` is the chaos burst target.)

The chaos script (`scripts/test/run-chaos-journey-check.js`) sends concurrent invalid + edge requests at the backend and asserts NO 5xx responses leak. Per W5-A's alert-rule doc (`docs/operations/sentry-alert-rules-2026-05-17.md`) the synthetic burst should trigger the **rate spike** rule (rule #1) within the burst window. To verify each of the 5 rules:

| Rule | Trigger method during chaos |
|------|----------------------------|
| #1 error rate spike (`level:error` > 5 in 5 min) | Chaos burst with invalid payloads → backend logs 4xx + some 5xx-from-deps if Redis is paused; baseline burst should NOT trigger if backend is healthy → verify rule fires only when Redis is killed (`docker stop gacp-redis-local`) |
| #2 p95 latency > 4000ms | Skip in chaos; verified separately by load-test if available (out of W5 scope) |
| #3 `BREACH_RECORDED` audit-log P0 | Synthesised via `node apps/backend/scripts/breach-drill.js` (R4-A) — verify the Sentry-side `event.tags.audit_action === 'BREACH_RECORDED'` event fires |
| #4 Redis dedupe miss > 10% | Stop Redis (`docker stop gacp-redis-local`) for 30s mid-burst → backend logs `REDIS_DEDUPE_MISS` → rule fires |
| #5 `RECEIPT_SEQUENCE_DB_UNAVAILABLE` | Synthesised via DB-pause: `docker stop gacp-postgres-local` for 5s during a receipt-issue chaos burst |

**Expected output (final 2-3 lines from `run-chaos-journey-check.js`):**
```
CHAOS-HEALTH-BURST: ok status=200 duration=Xms
CHAOS-... (more chaos cases)
chaos-journey: PASS
```

**Failure mode + escalation:**
- Any chaos case reports a 5xx leak → backend's error-handling middleware is too eager; file P2 + capture the chaos output.
- Sentry side: any of the 5 rules does NOT fire when its trigger is synthesised → P2 follow-up to add the alert rule to the Sentry dashboard (per `sentry-alert-rules-2026-05-17.md`).
- Chaos script crashes with `BASE_URL` ECONNREFUSED → nginx not exposing port 8080; re-check step 2 + step 3.

Restart Redis + Postgres if step 7 stopped them: `docker compose -f docker-compose.local-prod.yml up -d redis postgres`.

---

## Step 8 — W1 dev-server bug verification (`@hookform/resolvers/zod`)

**Verbatim command:**
```bash
pnpm install --frozen-lockfile
pnpm --filter web-app run dev > /tmp/dev-boot.log 2>&1 &
DEV_PID=$!
sleep 20
# Verify dev-server is alive AND no MODULE_NOT_FOUND for the W1 deferred bug
curl -sf http://localhost:3000/ > /dev/null && echo "OK dev server alive"
grep -i "MODULE_NOT_FOUND\|cannot find module" /tmp/dev-boot.log && echo "FAIL dev boot has missing module" || echo "OK no missing module"
kill $DEV_PID
```

(On Windows PowerShell, replace `&` background syntax with `Start-Process` per `_PowerShell-edition_` doc.)

**Expected output (final 2 lines):**
```
OK dev server alive
OK no missing module
```

**Failure mode + escalation:**
- `cannot find module '@hookform/resolvers/zod'` in `/tmp/dev-boot.log` → **W1 deferred bug NOT closed**; file P1; the next iteration must add `@hookform/resolvers` to `apps/web-app/package.json` dependencies (currently a transitive dep that does not resolve under pnpm strict mode on dev-server).
- Dev server boots but `/` returns 500 → unrelated regression; file P2.
- pnpm install fails with "frozen-lockfile out of sync" → the W5 commit's `pnpm-lock.yaml` was not regenerated after a package.json edit; revert + re-run pnpm install at the W5 SHA.

---

## Step 9 — npm audit re-run

**Verbatim command:**
```bash
pnpm audit --json > /tmp/audit-W5.json 2>&1 || true
# (pnpm audit exits non-zero when vulns present; the `|| true` lets us capture the JSON regardless)
node -e "const a=JSON.parse(require('fs').readFileSync('/tmp/audit-W5.json','utf8'));const counts={critical:0,high:0,moderate:0,low:0,info:0};for(const k in (a.advisories||{})){counts[a.advisories[k].severity]++;}console.log('W5 audit:',JSON.stringify(counts));"
```

**Expected output (1 line):**
```
W5 audit: {"critical":0,"high":0,"moderate":11,"low":2,"info":0}
```

Compare against the W2 baseline (`docs/handoffs/iter-W2/W2-A.md` "Accepted residuals (13 total: 2 low + 11 moderate)"):
- If **moderate ≤ 11 AND low ≤ 2**: PASS — no new residuals.
- If **moderate > 11 OR low > 2**: a NEW residual surfaced; capture the diff, file P2, and decide whether to block cutover (consult Security Lead).
- If **critical > 0 OR high > 0**: HALT cutover — re-run W2 audit triage immediately.

**Failure mode + escalation:**
- `pnpm audit` itself errors out (network down, registry 503) → retry after restoring network; this is not a cutover blocker but the audit log must be captured for the sign-off doc.
- New critical/high CVE → invoke the W2 triage playbook: bump direct dep OR add a `pnpm.overrides` entry for the transitive dep (precedent: W2-A bumped axios, next, express-rate-limit, multer + override entries for basic-ftp, handlebars, systeminformation, picomatch, minimatch, lodash).

Per **I-017**: any NEW CVE that surfaces here MUST be enumerated in the orchestrator's post-smoke commit message; do NOT silently absorb new findings.

---

## Step 10 — Teardown

**Verbatim commands:**
```bash
docker compose -f docker-compose.local-prod.yml down --volumes
docker ps --filter "name=gacp-" --format '{{.Names}}'
# Should print nothing — all containers gone.
echo "OK teardown clean"
```

**Expected output (final 1-2 lines):**
```
OK teardown clean
```

**Failure mode + escalation:**
- `docker ps` still shows `gacp-*` containers after `down --volumes` → run `docker rm -f gacp-nginx-local gacp-backend-local gacp-frontend-local gacp-postgres-local gacp-redis-local gacp-cert-gen` to force-remove. Capture the residual containers in the smoke log.
- Volume cleanup leaves orphan named volumes (e.g. `postgres-data-local`) → `docker volume prune` to clean up. Disk free returns to pre-step-2 baseline.

---

## Smoke verdict + sign-off

| Step | Result | Notes |
|------|--------|-------|
| Pre-flight | ☐ |  |
| 1 — Pre-flight verify | ☐ |  |
| 2 — Stack up | ☐ |  |
| 3 — Wait-for-ready | ☐ |  |
| 4 — Playwright mock-mode | ☐ | W1 baseline count: ___ specs PASS |
| 5 — Playwright live-mode | ☐ | 3 specs (farmer + DTAM + account-split) |
| 6 — axe-core baseline | ☐ | `docs/handoffs/iter-W5/axe-baseline.json` captured |
| 7 — Chaos check + 5 alert rules | ☐ | Rules 1/3/4/5 verified; rule 2 deferred to load test |
| 8 — W1 dev-server bug | ☐ | `@hookform/resolvers/zod` resolution OK |
| 9 — pnpm audit | ☐ | moderate ≤ 11 AND low ≤ 2 |
| 10 — Teardown | ☐ |  |

**Overall smoke verdict:** ALL GREEN → orchestrator updates `docs/operations/loop-w-2026-05-17-sign-off.md` §6 "Exit criteria" row "Docker smoke" from ☐ → ✓ + attaches this runbook output as the verification artefact.

**ANY RED:** HALT cutover. Escalate to Loop W reviewer + Engineering Lead. The Loop W sign-off remains DRAFT until smoke is re-run green.

---

## References

- **Loop W playbook section:** `docs/playbooks/hardening-loop-2026-05-17.md` §"Loop W Outcome (2026-05-17 — W1-W5 complete)"
- **Loop W sign-off (DRAFT):** `docs/operations/loop-w-2026-05-17-sign-off.md`
- **Cutover checklist (in-place re-swept):** `docs/operations/cutover-checklist-2026-05-17.md`
- **W5 RFC + per-task handoffs:** `docs/handoffs/iter-W5/00-rfc.md` + `docs/handoffs/iter-W5/W5-{A,B,C,D}.md`
- **Sentry installation guide:** `docs/operations/sentry-installation-guide-2026-05-17.md`
- **Sentry alert rule spec:** `docs/operations/sentry-alert-rules-2026-05-17.md`
- **W1 Playwright specs (mock-mode + live-mode):** `apps/web-app/playwright/{farmer-full-journey,dtam-staff-full-journey,account-split-journey}.spec.ts`
- **W3-B axe-core spec:** `apps/web-app/playwright/accessibility-scan.spec.ts`
- **Chaos check:** `scripts/test/run-chaos-journey-check.js`
- **Compose file (local-prod):** `docker-compose.local-prod.yml`
- **Pre-commit hook:** `.husky/pre-commit` (single source of truth per I-013)
- **Loop V sign-off (Loop V structural template for Loop W sign-off):** `docs/operations/loop-v-2026-05-17-sign-off.md`
- **Loop R sign-off (Loop R structural template for Loop V sign-off):** `docs/operations/hardening-loop-2026-05-17-sign-off.md`

---

