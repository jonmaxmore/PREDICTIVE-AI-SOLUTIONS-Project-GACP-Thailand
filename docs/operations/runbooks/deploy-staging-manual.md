# Runbook — Manual staging deploy (main → staging)

**Status:** active — and permanent, not interim. No workflow is coming to replace it: the operator ruled on 2026-08-14 that GitHub Actions will not be paid for, so `deploy-staging.yml` can never dispatch (the change log 2026-08-14).
**Owner:** platform operator (executes on the VM) · Infra proposes, operator runs (mandate §0)
**Date:** 2026-08-05 · **last truth-check 2026-08-14** · **Scope:** deploy current `main` to **staging** (`gacp_staging` DB, `backend-staging` container). NO AUTO-DEPLOY — the operator triggers this by hand.
**Freeze:** lifted 2026-08-05. `docker compose up` for staging is allowed; production is untouched by this runbook.

> **Where this sits now:** the canonical build+deploy pair is
> `docs/operations/runbooks/build-images-on-the-box.md` (build on the VM, tag `local-<sha12>`) followed by
> `sudo IMAGE_TAG=local-<sha12> bash scripts/deploy/deploy-staging.sh`. This runbook is the long form of
> the same deploy — read it for the risk table, the verify battery (§3) and the rollback (§4).
>
> **The drift narrative below is a dated snapshot, not today's state.** It was written on 2026-08-05,
> when staging ran a ~22-July image and `main` was ~150 commits ahead. Since 2026-08-14 staging is
> expected to track `origin/main` HEAD, and the probe `deploy-drift` is a **required** check in
> `scripts/ci/full-gate-checks.txt` — it goes red the moment staging falls behind. Do not read
> "150 commits" as a current measurement; run the probe.

---

## 0. The 150-commit jump — risk summary (from the gap analysis, verified vs code)

| axis | verdict |
|---|---|
| **New required env / secrets** | **NONE.** `docker-compose.production.yml`, `secrets.js` catalog, `env-validator.js`, `deploy-preflight.sh` REQUIRED lists — all zero diff. `.env.staging` needs no new variable to boot. |
| **New Prisma migrations** | **4, all additive/EXPAND-only** (safe on a populated DB): `20260803120000_add_notification_kind` (ADD COLUMN + CHECK + index — brief SHARE lock), `20260803122000_add_correction_rounds` (new table), `20260803130000_add_user_anonymization_markers` (ADD COLUMN on `users`, catalog-only), `20260804013000_add_identity_links` (new table + **idempotent** backfill, ACCESS SHARE only; needs PG≥13 — satisfied by `postgres:15-alpine`). Migration history intact (no M/D). |
| **Boot gates** | untouched — `/api/health`, env-validator, boot-secret-guard, secrets all zero diff. Nothing newly refuses to start. |
| **API routes removed/renamed** | none (one route file added: OAuth IdP; fail-closed `coming_soon`). |
| **Auth/JWT/cookies** | code unchanged. (Sessions were already invalidated by the JWT rotation in #762 — expected.) |

**Functional watch-items** (test these on staging — they won't fail boot but change behavior):
1. **Correction decisions now mint an official letter + a `CorrectionRound` row IN the same DB transaction as the status write**, and refuse the whole decision if the letter can't be written. → functionally test all decision paths (DOC review reject / CAR / audit) after deploy, not just health.
2. **PDPA self-service erasure** dropped its fallback for missing `isAnonymized`/`anonymizedAt` columns → only safe **after** migration `…_add_user_anonymization_markers` has applied (this runbook applies it before recreate — order is correct).
3. **staging now HIDES `/api-docs` + stack traces** (server.js gate moved to `NODE_ENV in {development,test}`; staging=`staging`). This fixes the old "staging leaks stack traces" finding. If QA needs `/api-docs` on staging, set `OPENAPI_DOCS_ENABLED=true` in `.env.staging` (decision, not required).
4. **checkout UI** returns 404 unless `NEXT_PUBLIC_CHECKOUT_UI_ENABLED=true` is **baked into the staging web-app image at build time** — confirm if QA needs the checkout UI by URL.
5. **work-inbox quick-decide now blocks `REJECTED`** (422) — staff quick-reject returns 422 (no FE change shipped).
6. **Provider ID OAuth** now needs 9 env vars (added `AUTH_PROVIDERID_PID_CLIENT_ID`) — lazy per-request, does NOT block boot; providerid stays `coming_soon` until all set.

---

## 1. Pre-deploy (on the VM, in `/opt/gacp-platform`)

```bash
cd /opt/gacp-platform

# 1.1 Fetch main and know exactly what you're deploying
git fetch origin main --quiet
git log --oneline origin/deploy/production..origin/main | wc -l   # ~150 — sanity
CURRENT="$(git rev-parse --short HEAD)"; TARGET="$(git rev-parse --short origin/main)"
echo "staging checkout $CURRENT → $TARGET"

# 1.2 Confirm .env.staging is complete (no NEW vars needed, but verify the
#     existing required set is present — deploy-staging.sh preflight enforces this)
for v in DB_PASSWORD STAGING_HEALTH_JWT_SECRET STAGING_PROVIDER_JWT_SECRET \
         STAGING_ENCRYPTION_KEY STAGING_QR_SIGNATURE_FALLBACK_SECRET \
         STAGING_PAYMENT_WEBHOOK_SECRET; do
  printf '%-40s present=%s\n' "$v" "$(grep -cE "^${v}=" .env.staging)"
done
# (STAGING_* fall back to the prod names if unset — both were rotated in #762.)

# 1.3 THE stepwise check the old script skips — migrate STATUS before apply.
#     Confirm the pending set is exactly the 4 additive migrations above,
#     not an unexpected backlog. Run against gacp_staging via a throwaway
#     client on the docker network (no secret in argv — password from .env):
STG_DB_URL="$(grep -E '^DATABASE_URL=' .env.staging | head -1 | cut -d= -f2- || true)"
# if .env.staging has no literal DATABASE_URL, build it from DB_PASSWORD + STAGING_DB_NAME (gacp_staging)
docker run --rm --network gacp-network -e DATABASE_URL="$STG_DB_URL" \
    "$(grep -E '^BACKEND_IMAGE=' .env.staging | cut -d= -f2- || echo ghcr.io/jonmaxmore/gacp-backend):main-latest" \
    sh -lc 'cd /app/apps/backend && npx prisma migrate status --schema prisma/schema'
# EXPECT: "Following migrations have not yet been applied: <the 4 above>".
# If it lists anything destructive or an unexpected backlog → STOP, report.
```

## 2. Deploy (the operator runs; `deploy-staging.sh` already sequences this)

The existing `scripts/deploy/deploy-staging.sh` does exactly the safe sequence — **prefer it** over hand-typing:

```bash
sudo IMAGE_TAG=local-<sha12> /opt/gacp-platform/scripts/deploy/deploy-staging.sh
```

It: (a) preflights `.env.staging` required vars, (b) **pg_dump-backs-up gacp_staging** (rollback safety net), (c) `prisma migrate deploy` against gacp_staging (the 4 additive migrations), (d) recreates `backend-staging` via the **two-file** form `-f docker-compose.production.yml -f docker-compose.staging.yml --env-file .env.staging`. If you must do it by hand, mirror that order exactly — migrate BEFORE recreate (the new image expects the new columns; the PDPA-erasure change requires the anonymization columns to exist first).

**Build note:** images are built **on the box**, not pulled from GHCR — `build-images.yml` cannot run (Actions unpaid, 2026-08-14) so no new tag ever reaches the registry. Build first per `docs/operations/runbooks/build-images-on-the-box.md`, then pass that tag: `deploy-staging.sh` accepts a local image and skips the pull when one exists. The web-app image must be built with `NEXT_PUBLIC_CHECKOUT_UI_ENABLED` set to the desired value (watch-item 4) — it's build-time.

## 3. Verify (mandatory — health smoke is NOT enough here)

```bash
# 3.1 Boot + health
curl -fsS -o /dev/null -w 'staging /api/health -> %{http_code}\n' http://127.0.0.1:8001/api/health   # 200
curl -fsS http://127.0.0.1:8001/api/health/ready | head -c 200; echo   # "status":"READY"

# 3.2 Migrations actually applied
docker logs --since 10m gacp-backend-staging 2>&1 | grep -ciE 'migrat|prisma'   # no errors

# 3.3 Login works end-to-end (JWT was rotated in #762 — fresh login must work)
#     use a staging test account; 200 or 401(bad creds) = DB+auth path OK, 5xx = FAIL
```

**3.4 Functional watch-items (the reason a health smoke is insufficient):**
- **Correction-decision paths** (watch-item 1): on a real staging application, exercise a DOC-review **reject** and, if reachable, a CAR/audit decision — confirm the decision succeeds AND an official letter + `CorrectionRound` row are written (the decision now fails closed if the letter can't be written).
- **PDPA erasure** (watch-item 2): only after migration confirmed applied — a self-service delete should now mark `isAnonymized`, not error.
- **work-inbox** (watch-item 5): a staff quick-reject now returns 422 — confirm that's understood (no FE fix shipped).

## 4. Rollback

`deploy-staging.sh` took a pre-deploy `pg_dump` of gacp_staging. To roll back:
1. Recreate `backend-staging` from the previous image tag: `STAGING_IMAGE_TAG=<old-sha> docker compose --env-file .env.staging -f docker-compose.production.yml -f docker-compose.staging.yml up -d --no-deps backend-staging`.
2. **Migrations are additive/EXPAND-only** — they do NOT need reverting (the old image ignores the new columns/tables). Only restore the DB from the pre-deploy dump if a data problem is found.

   > ⚠️ **แก้ 2026-08-13 — คำสั่งเดิมในข้อนี้กู้ลงฐานผิด**
   >
   > เดิมเขียนว่า `sudo bash scripts/backup/pg-backup.sh --restore <ไฟล์>` พร้อมหมายเหตุว่า
   > "จะทับข้อมูล gacp_staging" — **ไม่จริง** `scripts/backup/pg-backup.sh` ตั้ง
   > `DB_NAME="${DB_NAME:-gacp_db}"` (บรรทัด 33 ก่อนการแก้ครั้งนี้ · 36 หลังแก้)
   > ⇒ รันแบบนั้นจะเขียนลง `gacp_db` · และ `sudo` ตัด environment ทิ้ง จึงต้องใช้ `sudo env`
   >
   > และมันจะ **ไม่ error** เพราะดัมป์ก่อน deploy เป็น plain SQL บีบอัด
   > (`scripts/deploy/deploy-staging.sh:93-94` `pg_dump --clean --if-exists … | gzip`)
   > ซึ่งเข้ากันได้กับเส้นทาง restore พอดี · `--clean --if-exists` จะ DROP object
   > ของฐานปลายทางก่อนแล้วเขียนทับ — สำเร็จเรียบร้อย ผิดฐาน
   >
   > ตอนนี้สคริปต์ปฏิเสธการรันโดยไม่ระบุ `DB_NAME` แล้ว (guard ใน restore block)
   > รายละเอียด: `reports/risk-assessment/2026-08-13.md` §4 R2

   คำสั่งที่ถูก — หาไฟล์ก่อน แล้วระบุฐานปลายทางตรง ๆ ไม่พึ่งค่า default:

   ```bash
   # ไฟล์อยู่ที่ไหน — deploy-staging.sh:30,90 เขียนไว้ที่นี่ ไม่ใช่ /opt/gacp-platform/backups
   ls -lt /var/backups/gacp-staging/staging-pre-deploy-*.sql.gz | head -3

   gunzip -c <the pre-deploy dump> \
     | docker exec -i gacp-postgres psql -U gacp -d gacp_staging -v ON_ERROR_STOP=1 --single-transaction
   ```

   > `-v ON_ERROR_STOP=1` **ไม่ใช่ของแถม** — ถ้ามีแต่ `--single-transaction` psql จะยกเลิก
   > transaction ตั้งแต่ error แรก ข้ามคำสั่งที่เหลือเงียบ ๆ rollback ตอนจบ **แล้ว exit 0**
   > ⇒ การกู้ที่ไม่ได้เขียนอะไรเลยจะรายงานว่าสำเร็จ ซึ่งเป็นความพลาดแบบเดียวกับที่กล่องข้างบนบอกว่ากำลังปิด

   หรือผ่านสคริปต์โดยตั้งชื่อฐานให้ชัด (`sudo` ตัด environment ทิ้ง ต้องใช้ `sudo env`):

   ```bash
   sudo env DB_NAME=gacp_staging bash scripts/backup/pg-backup.sh --restore <the pre-deploy dump>
   ```

   **ห้ามใช้คำสั่งนี้กับไฟล์ใน `/opt/gacp-platform/backups/`** — ไฟล์ชุดนั้นเป็น `pg_dump -Fc`
   ต้องใช้ `pg_restore` ดู `docs/operations/runbooks/backup-and-restore.md`
3. Re-run §3 verify on the rolled-back image.

## 5. Related

- `scripts/deploy/deploy-staging.sh` — the script this runbook drives
- `docs/operations/runbooks/secret-rotation-full.md` — #762 rotation (JWT secrets already rotated)
- A11 part 1 (deploy-pipeline ADR) + part 2 (`deploy-staging.yml` workflow to replace this manual path) — pending
- Gap-analysis source: `git diff origin/deploy/production..origin/main`
