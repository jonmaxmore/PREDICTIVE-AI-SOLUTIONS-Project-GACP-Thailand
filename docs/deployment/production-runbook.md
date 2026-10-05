---
artifact: production-deployment-runbook
version: 1.0
date: 2026-05-16
status: active
owners: DevOps Lead, Security Lead, Compliance Lead, DBA
audience: Operations engineer executing a production deploy
authoritative-references:
  - docs/financial-documents/RECEIPT-DESIGN-SPEC.md
  - docs/deployment/production-deployment-checklist.md
  - docs/deployment/production-diagnostic-runbook.md
  - apps/backend/config/secrets.js (SECRETS_CATALOG)
  - apps/backend/config/invoice-issuers.js (DTAM + PLATFORM issuers)
  - apps/backend/services/token-revocation-service.js (SECURITY POLICY block)
  - apps/backend/services/prisma-pdpa-extension.js (Phase 1 PII columns)
  - apps/backend/scripts/pdpa/backfill-encrypt-user-pii.js
  - apps/backend/scripts/backfill-platform-invoice-vat.js
  - apps/backend/middleware/auth-middleware.js (LEGACY_NO_JTI_GRACE_UNTIL)
  - apps/backend/middleware/uploads-security-headers.js
  - apps/backend/routes/api/admin/applications.js (admin status override + audit tx)
  - apps/backend/routes/api/auth/auth-health.js (PDPA S30 / S33 endpoints)
---

# GACP Production Deployment Runbook

> **Release:** Auth + PDPA + Financial hardening (post-9-commit security wave)
> **Target topology:** DigitalOcean droplet, host nginx → docker nginx → backend/frontend, Postgres, Redis, MinIO. See `docs/deployment/production-diagnostic-runbook.md` for the canonical host wiring and `docs/deployment/dtam-hosting-plan.md` for DTAM-targeted hosting variants.
> **Audience:** An ops engineer who has never seen this codebase before. Treat every "STOP if …" line as a hard halt — do not improvise.

---

## 0. How to use this document

1. Read §1 (prerequisites) end-to-end **before** you start §2.
2. §2 is the only sequence that mutates production. Steps are numbered and each one ends with a **STOP** condition. If a STOP fires, jump to §3 (rollback) for the same step number.
3. §4 is the post-deploy smoke checklist — every item must pass before declaring the deploy green.
4. §5 is the steady-state monitoring contract. Hand it to SecOps / SRE.
5. §6 is the known-gaps + TODO list that humans must still close before the platform is considered "no caveats".

All commands assume:

- Working directory on the production host: `/opt/gacp-platform`
- Compose entry point: `docker compose --env-file .env.production -f docker-compose.production.yml`
- Backend container service name: `backend`
- Database container service name: `postgres`
- Redis container service name: `redis`
- MinIO container service name: `minio`

If your environment differs (e.g. managed Postgres / managed Redis), substitute the equivalent connection but **do not** change the verification logic.

---

## 1. Pre-deploy prerequisites

### 1.1 Secret manager — required keys

Set the following before code is deployed. The backend will refuse to start if any `required: 'production'` or `required: 'always'` secret is missing — that behaviour is enforced by `apps/backend/config/secrets.js` `validateAllSecrets()`.

Use whichever backend you have configured (`SECRET_BACKEND=env` is the default — read from process env; `SECRET_BACKEND=file` reads from `/run/secrets/<NAME>` Docker-secret mounts).

#### 1.1.1 Authentication / JWT signing

| Secret | Required | Min length | Notes |
|---|---|---|---|
| `HEALTH_JWT_SECRET` | production | 32 | HS256 key for health (applicant) JWTs. Legacy alias: `JWT_SECRET`. |
| `PROVIDER_JWT_SECRET` | production | 32 | HS256 key for provider/DTAM-staff JWTs. Legacy alias: `DTAM_JWT_SECRET`. |
| `REFRESH_TOKEN_SECRET` | optional | 32 | Falls back to `HEALTH_JWT_SECRET` if unset. Set explicitly if you want refresh-token rotation isolation. |
| `SESSION_SECRET` | production | 32 | Cookie / CSRF / OAuth state. |

**Generate with:** `openssl rand -base64 48 | tr -d '=+/' | head -c 64`

#### 1.1.2 Encryption keys (CRITICAL — affects data integrity)

| Secret | Required | Min length | Notes |
|---|---|---|---|
| `ENCRYPTION_KEY` | **always** | 32 | AES-256 master key for PII. **Loss = unreadable encrypted columns.** Back this up to a separate secret store (e.g. AWS KMS, HashiCorp Vault root key) before the first backfill run. |
| `MASTER_ENCRYPTION_KEY` | production | 32 | Used by `EncryptionService` (security-compliance.js). Falls back to `ENCRYPTION_KEY` if unset. |
| `HMAC_KEY` | production | 32 | Signs audit-chain hashes + data integrity. Compromise lets attackers forge audit entries. |

**STOP if** any of these three are auto-generated, recycled across environments, or stored only in the application `.env` file. They must be in a separate secret store with rotation policy.

#### 1.1.3 Database / Redis / Object storage

| Secret | Required | Notes |
|---|---|---|
| `DATABASE_URL` | production | `postgresql://gacp:<pw>@<host>:5432/gacp_db?schema=public&sslmode=require` |
| `REDIS_URL` | production | Refresh-token allowlist, refresh-token blocklist, access-token blocklist, session-family blocklist, MFA challenge store all live here. **All four namespaces are required for security.** |
| `REDIS_PASSWORD` | optional | If not embedded in `REDIS_URL`. |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | production | Aliased to `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`. |

#### 1.1.4 Payment + webhook

| Secret | Required | Notes |
|---|---|---|
| `PAYMENT_WEBHOOK_SECRET` | production | Min 16 chars. HMAC of inbound webhook payloads. |
| `KSHER_APP_ID` / `KSHER_PRIVATE_KEY` | optional | Only when Ksher gateway is enabled. |
| `CRON_SECRET` | production | Required by `x-cron-secret` header on `/api/cron/*`. |
| `LAB_API_KEY` | production | Required by lab webhook. |

#### 1.1.5 Invoice issuer identity — DTAM + Platform

See `apps/backend/config/invoice-issuers.js`. These render into every issued financial document; if you ship with the `PENDING_FINANCE_CONFIRMATION` sentinel, the receipt prints that string. Validator: `listPendingIssuerFields()`.

**Platform issuer — confirmed by owner 2026-05-15. The defaults in `invoice-issuers.js` are already correct, but you should set the env vars explicitly in production so a future code rebase cannot silently change the legal entity.**

| Env var | Production value (confirmed) |
|---|---|
| `PLATFORM_COMPANY_NAME_TH` | `บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด (สำนักงานใหญ่)` |
| `PLATFORM_COMPANY_NAME_EN` | `Predictive AI Solution Co., Ltd. (Head Office)` |
| `PLATFORM_TAX_ID` | `0105568045932` |
| `PLATFORM_REGISTRATION_NO` | `0105568045932` (same as taxId in Thailand — DBD ↔ Revenue Department single-number policy) |
| `PLATFORM_ADDRESS_LINE1` | `429/69 หมู่บ้าน พรีเมี่ยมเพลส ถนนสุคนธสวัสดิ์ แขวงลาดพร้าว เขตลาดพร้าว` |
| `PLATFORM_ADDRESS_LINE2` | `กรุงเทพมหานคร 10230` |

**DTAM issuer — still PENDING. Without these values, `RCP-DTAM-…` receipts will print the literal string `PENDING_FINANCE_CONFIRMATION` where the tax ID should appear.**

| Env var | Required value |
|---|---|
| `DTAM_LEGAL_NAME_TH` | Default `กรมการแพทย์แผนไทยและการแพทย์ทางเลือก` is acceptable; override only if Finance requests the longer form. |
| `DTAM_LEGAL_NAME_EN` | Default `Department of Thai Traditional and Alternative Medicine` is acceptable. |
| `DTAM_TAX_ID` | TODO(Finance/DTAM): obtain DTAM's government revenue tax ID (gov budget code, 13-digit format). |
| `DTAM_ADDRESS_LINE1` | TODO(Finance/DTAM): registered address line 1. |
| `DTAM_ADDRESS_LINE2` | TODO(Finance/DTAM): registered address line 2 (postal code etc.). |

**STOP if** `DTAM_TAX_ID` is still PENDING and ANY state-fee receipt is expected to be issued during the rollout window. Either block state-fee payments at the gateway until the tax ID is confirmed, or hold the deploy.

#### 1.1.6 PDPA + auth rollout flags

| Env var | Initial value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Required. Toggles `secrets.js` strict mode, disables e2e routes, suppresses dev fallbacks. |
| `ENABLE_PDPA_FIELD_ENCRYPTION` | `false` initially | Flip to `true` only AFTER the backfill (Step 6 below). |
| `LEGACY_NO_JTI_GRACE_UNTIL` | ISO timestamp ~7 days out, e.g. `2026-05-23T00:00:00Z` | Tokens issued before the JTI enforcement upgrade are accepted (with warn-log) while inside this window. After the deadline they are 401'd. |
| `SECRET_BACKEND` | `env` (or `file` for Docker secrets) | Read by `apps/backend/config/secrets.js`. |

### 1.2 Redis availability check

The token revocation subsystem uses **four** Redis namespaces. Skipping any one of them creates a security regression. Verify all four respond:

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T redis redis-cli PING"
# Expected: PONG
```

```bash
# Probe each of the four namespaces with a synthetic key (delete it right after).
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T redis redis-cli SET auth:refresh:probe:1 'x' EX 10"
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T redis redis-cli SET auth:rt-blocklist:probe '1' EX 10"
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T redis redis-cli SET auth:family-blocklist:probe '1' EX 10"
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T redis redis-cli SET auth:blocklist:probe '1' EX 10"
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T redis redis-cli DEL auth:refresh:probe:1 auth:rt-blocklist:probe auth:family-blocklist:probe auth:blocklist:probe"
```

**STOP if** any of the four namespaces refuses a write — your security policy will degrade asymmetrically (refresh-token blocklist fails CLOSED, access-token blocklist fails OPEN; see `apps/backend/services/token-revocation-service.js` SECURITY POLICY block).

### 1.3 Postgres availability check

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c '\\conninfo'"
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c 'SELECT version();'"
```

Verify migrations are current **on the current image (pre-deploy)**:

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend npx prisma migrate status"
```

**STOP if** there are pending migrations from a previous deploy that never completed — you do not start a new deploy on top of a half-migrated database.

### 1.4 MinIO / object storage check

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T minio mc admin info local"
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T minio mc ls local/"
```

The `/uploads` mount serves biometric photos, audit-field photos, GPS-tagged farm images, and CAR documents. The security headers middleware (`apps/backend/middleware/uploads-security-headers.js`) sets four required PDPA-compliance headers on every response: `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment`, `Cross-Origin-Resource-Policy: same-site`, `Cache-Control: private, no-store, max-age=0`.

**STOP if** the uploads bucket is missing or unreadable, or if the `/uploads/*` path doesn't show the four headers on a probe request (§4 smoke test verifies this).

### 1.5 Pre-deploy backup

```bash
ssh root@<prod-host> "cd /opt/gacp-platform && pg_dump -Fc \$DATABASE_URL > /var/backups/gacp/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).dump"
ssh root@<prod-host> "ls -lh /var/backups/gacp/ | head -5"
# Verify the dump is restorable (header read only — does NOT actually restore)
ssh root@<prod-host> "pg_restore --list /var/backups/gacp/pre-deploy-*.dump | head"
```

**STOP if** the dump is `0 bytes`, fails its `pg_restore --list` integrity check, or is not on a different volume from the live Postgres data directory.

### 1.6 Image artifact ready

Confirm the image you are about to deploy is the right one:

```bash
ssh root@<prod-host> "docker pull ghcr.io/jonmaxmore/gacp-backend:<release-tag>"
ssh root@<prod-host> "docker image inspect --format='{{.Created}} {{.Id}}' ghcr.io/jonmaxmore/gacp-backend:<release-tag>"
# Tag the currently-running image for fast rollback
ssh root@<prod-host> "docker tag ghcr.io/jonmaxmore/gacp-backend:current ghcr.io/jonmaxmore/gacp-backend:pre-release-$(date -u +%Y%m%dT%H%M%SZ)"
```

### 1.7 DTAM coordination items

These are external dependencies that must be resolved BEFORE the cutover, not during:

- TODO(DTAM/Finance): Confirm `DTAM_TAX_ID` value (gov budget code, 13-digit format). Receipts cannot show this until it's set.
- TODO(DTAM/Finance): Confirm `DTAM_ADDRESS_LINE1` / `DTAM_ADDRESS_LINE2`.
- TODO(DTAM/Compliance): Confirm whether DTAM wants the platform to capture WHT 3% on its behalf, or whether corporate customers will withhold and remit via ภ.ง.ด.53. Default behaviour (per `invoice-issuers.js`): platform issues a full tax invoice and does NOT deduct WHT. Changing this requires a ภ.ง.ด.53 remittance pipeline that does not yet exist.
- TODO(SecOps): Confirm SIEM / SOC subscription for the structured audit events listed in §5.1.
- TODO(Ops): Confirm operator IPs to retain on the cloud firewall SSH rule (port 2222). See `docs/deployment/production-deployment-checklist.md` §0 for the firewall verification matrix.
- TODO(Compliance): Decide whether `LEGACY_NO_JTI_GRACE_UNTIL` should be 7 days or shorter for this rollout. 7 days is the cap (matches refresh-token TTL); shorter forces users to re-login more aggressively.

### 1.8 Production topology preflight

Run the canonical topology check (per `docs/deployment/production-deployment-checklist.md`):

```bash
node scripts/ci/check-production-topology.js
```

Expected: every check returns "ok". The ingress chain `DO Cloud Firewall → host nginx → docker nginx → backend/frontend` must be intact; SSH on port 2222 only; ports 80/443 open universally; everything else blocked.

**STOP if** topology preflight reports any deviation. Do not deploy on top of a missing or misconfigured firewall.

---

## 2. Deploy sequence

> **Sequencing rule:** every step has a verify gate and a STOP condition. Do not start step N+1 until step N is verified. If a STOP fires, the matching step in §3 (rollback) is your next action.

### Step 1 — Deploy code with PDPA encryption OFF

Goal: ship the new code but leave its behaviour identical to the previous release on all PII columns. This makes step 3 (dry-run backfill) meaningful and lets you roll back without re-encrypting.

```bash
# .env.production (or secret manager values) must contain:
ENABLE_PDPA_FIELD_ENCRYPTION=false
LEGACY_NO_JTI_GRACE_UNTIL=2026-05-23T00:00:00Z   # adjust to ~7 days from this deploy
NODE_ENV=production
# + every secret listed in §1.1

# On the production host:
ssh root@<prod-host> "cd /opt/gacp-platform && \
  docker compose --env-file .env.production -f docker-compose.production.yml pull backend frontend && \
  docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps backend frontend"
```

The backend will:

1. Run `secrets.validateAllSecrets()` at startup. If any `required: 'production'` secret is missing, it crashes with a non-zero exit. Compose will report `Exited` and the container won't reach healthy.
2. Run `listPendingIssuerFields()` and log a loud warning if any DTAM field is still `PENDING_FINANCE_CONFIRMATION`. Look for it: `docker compose ... logs backend | grep PENDING_FINANCE`.
3. Apply pending Prisma migrations only if you run `npx prisma migrate deploy` explicitly. This release does NOT auto-migrate. Run it manually:

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend npx prisma migrate deploy"
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend npx prisma migrate status"
```

**Verify step 1:**

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml ps backend"
# Expected: State=Up, Health=healthy
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml logs --tail 100 backend | grep -E '(listening|PENDING|secrets\\]|migrate)' || true"
```

```bash
curl -fsk -m 10 https://<prod-host>/api/health
# Expected: 200 { status: "ok", ... }
```

**STOP if:**
- Backend container does not reach `healthy` within 90 s.
- `secrets.validateAllSecrets()` reports any error (look for `[secrets] CRITICAL` in logs).
- Prisma reports a failed or out-of-order migration.
- `/api/health` does not return 200.

### Step 2 — Verify health endpoints + Redis + Postgres + secret manager

This is the "all green before mutation" gate. Run every probe in §1.2 (Redis), §1.3 (Postgres), §1.4 (MinIO) again, but now against the freshly-deployed backend.

```bash
# Backend reports back its dependencies
curl -fsk -m 10 https://<prod-host>/api/health
curl -fsk -m 10 https://<prod-host>/api/version | head -c 500
```

Verify that the four Redis namespaces are reachable from inside the backend container (not just from redis-cli):

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend node -e \"
const r = require('./services/redis-service');
(async () => {
  await r.set('runbook:health:probe', '1', 10);
  const v = await r.get('runbook:health:probe');
  await r.del('runbook:health:probe');
  if (v !== '1') { process.exit(1); }
  console.log('redis ok');
})().catch(e => { console.error(e.message); process.exit(1); });
\""
```

**Verify step 2:** All four Redis namespaces respond; `/api/health` reports `db.status='ok'` and `redis.status='ok'`; Postgres reports the expected version and no failed migrations.

**STOP if:** any of `db.status`, `redis.status`, or storage health field is anything other than `ok`. The backfill in step 4 requires all three.

### Step 3 — Dry-run backfill (PII encryption — Phase 1)

Run the backfill in dry-run mode first. This reports how many rows the real run will touch without actually writing.

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend node apps/backend/scripts/pdpa/backfill-encrypt-user-pii.js --dry-run --verbose"
```

Expected output (last block):

```
{
  "pagesScanned": <N>,
  "rowsScanned": <users-not-anon>,
  "rowsRequiringBackfill": <X>,
  "rowsUpdated": 0,
  "rowsSkipped": <users-already-encrypted-or-empty>
}
```

Phase 1 columns are display-only (never in `WHERE`): `idCard`, `taxId`, `laserCode`, `communityRegistrationNo`, `address`, `province`, `district`, `subdistrict`, `zipCode`. `healthId` and `providerId` are explicitly **not** in this phase — they are deferred to a future migration that switches lookups to `healthIdHash` / `providerIdHash`.

**Verify step 3:**
- `rowsRequiringBackfill` is a plausible non-zero number (existing platform has live users with PII).
- `rowsScanned` ≈ active user count (`prisma.user.count({ where: { isDeleted: false }})`).
- No exception printed.

**STOP if:**
- The script throws — most likely cause is `ENCRYPTION_KEY` not satisfying minLength 32, or Prisma extension misload.
- `rowsRequiringBackfill === 0` AND you expect existing PII rows. Something is wrong with the column-detection logic.

### Step 4 — Real backfill (PII encryption — Phase 1)

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend node apps/backend/scripts/pdpa/backfill-encrypt-user-pii.js --batch-size 200"
```

The script:

- Reads rows in cursor-paginated batches (default 100, here 200).
- Encrypts only columns lacking the `enc:v1:` prefix (idempotent — re-running is safe).
- Uses `basePrisma` (un-extended) and calls `encryptValue` manually so it behaves identically whether or not `ENABLE_PDPA_FIELD_ENCRYPTION` is on.
- Cursor-pagination means crash recovery just means re-running.

Optional: bound the run with `--max-rows N` if you want to chunk for very large tables.

**Verify step 4:**

```bash
# Spot-check: at least some rows now start with enc:v1:
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"
SELECT COUNT(*) FILTER (WHERE \\\"idCard\\\" LIKE 'enc:v1:%')          AS enc_idCard,
       COUNT(*) FILTER (WHERE \\\"idCard\\\" IS NOT NULL AND \\\"idCard\\\" NOT LIKE 'enc:v1:%') AS plain_idCard,
       COUNT(*)                                                          AS total
FROM \\\"User\\\" WHERE \\\"isDeleted\\\" = false;
\""
```

Expected: `plain_idCard` is 0 (or only matches rows whose `idCard` was always empty/null), `enc_idCard` > 0.

**STOP if:**
- `plain_idCard > 0` on rows that have non-null `idCard`. The flag should never flip to ON until plain count is 0 — otherwise reads return raw plaintext while writes encrypt, creating mixed state on a row's lifetime.
- The script exited non-zero. Investigate before retry; do not flip the env var.

### Step 5 — Apply LEGACY_NO_JTI_GRACE_UNTIL grace window

The `auth-middleware.js` JTI enforcement was added in the same sprint as token revocation. Tokens issued before the upgrade have no `jti` claim; without a grace window, those sessions 401 immediately at deploy time. To avoid a mass-logout incident:

1. Pick a deadline ~7 days out (matches refresh-token TTL — anything longer is wasted). Example: `2026-05-23T00:00:00Z`.
2. Set in secret manager:

```bash
LEGACY_NO_JTI_GRACE_UNTIL=2026-05-23T00:00:00Z
```

3. Restart backend (rolling, so traffic stays up):

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml restart backend"
```

During the grace window, tokens missing `jti` are accepted with a `warn`-level log entry; tokens with a valid `jti` go through the full revocation gate. After the deadline, missing-jti tokens are hard-rejected (401).

**Verify step 5:**

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend printenv LEGACY_NO_JTI_GRACE_UNTIL"
# Expected: the ISO timestamp you set.
```

**STOP if:** the deadline is in the past (e.g. typo / wrong timezone). The middleware treats "in the past" as no grace window and will hard-reject every legacy token immediately.

### Step 6 — Deploy with PDPA encryption ON

Now flip the encryption flag. From this moment forward all writes encrypt, all reads decrypt.

```bash
# In secret manager / .env.production:
ENABLE_PDPA_FIELD_ENCRYPTION=true
```

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml restart backend"
```

The backend log on restart should print the extension's startup banner (look for `prisma-pdpa-extension` or `PDPA Phase 1` in logs). All subsequent `User` reads decrypt the Phase-1 columns transparently; all writes prepend `enc:v1:`.

**Verify step 6:** §4 smoke test runs from here. Specifically:

- §4.2 (login) succeeds and the returned user payload contains decrypted PII (e.g. `idCard` is a real Thai ID, not `enc:v1:…`).
- §4.5 (admin PDPA export) returns plaintext PII.
- §4.6 (admin status override) succeeds.

**STOP if:** any user-facing API returns `[PII_DECRYPT_FAILED]` in a PII column. That marker only appears when `decryptValue` catches a cipher error — most likely cause is a wrong `ENCRYPTION_KEY` (the one you ran the backfill with is not the one the running backend has).

### Step 7 — API smoke tests with encryption ON

Execute every item in §4 (smoke test checklist). All must pass before declaring the deploy green.

Notable items that specifically test the encryption flip:

- §4.2 login flow returns decrypted PII.
- §4.5 PDPA right-of-access export returns plaintext.
- §4.9 receipt download — verify `ISSUER_TAX_ID = 0105568045932` on the platform tax invoice and not on the DTAM receipt.
- §4.10 PDPA right-of-erasure scrubs `formData`.

**STOP if** any §4 item fails. Jump to §3 — depending on which step failed, the rollback target is different.

### Step 8 — After grace deadline: remove the grace env var

After `LEGACY_NO_JTI_GRACE_UNTIL` has passed (≥ 7 days post-step 5), the middleware will hard-reject jti-less tokens regardless of whether the var is still set. Remove the var so it doesn't sit stale in the environment:

```bash
# In secret manager / .env.production: REMOVE the line entirely.
# unset LEGACY_NO_JTI_GRACE_UNTIL
```

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml restart backend"
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend printenv LEGACY_NO_JTI_GRACE_UNTIL"
# Expected: prints nothing (empty); printenv exits non-zero
```

**Verify step 8:** legacy-token usage should now be zero. Search audit logs:

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"
SELECT COUNT(*) FROM audit_logs
WHERE action = 'AUTH_LOGIN_SUCCESS'
  AND \\\"createdAt\\\" >= NOW() - INTERVAL '24 hours'
  AND metadata->>'noJtiGrace' = 'true';
\""
# Expected: 0 (no tokens accepted via grace after deadline)
```

TODO(SecOps): if the count above is > 0 after the deadline, those are tokens accepted under the grace window. Confirm with the auth-middleware grep that the var is truly unset; otherwise investigate as auth bypass.

**STOP if:** removing the var causes a measurable spike in 401s from authenticated clients. The grace window should have given all live sessions a chance to rotate; a spike means a third-party integration is still presenting legacy tokens.

### Step 9 — Monitor

Hand off to SecOps / SRE on the §5 monitoring contract. Do not declare the release closed until at least 24 h of green telemetry on:

- `REFRESH_TOKEN_REUSE_DETECTED` audit events: any non-zero rate is suspicious; spike = active session theft attempt → investigate per §5.1.
- `ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE` audit events: any non-zero count = degraded security posture (fail-OPEN per the SECURITY POLICY block in `token-revocation-service.js`). Page on first occurrence.
- `healthIdHash` NULL count on User table: should monotonically decrease toward 0 as users log in / register (login-side fills in the hash). Daily query in §5.3.
- `[PII_DECRYPT_FAILED]` markers in any audit-log metadata: should be zero.

### Step 10 — Tier-9 to Tier-10 follow-up: PLATFORM invoice VAT backfill (optional, conditional)

If the production database has PLATFORM-service-type invoices created **before** Tier 9 (i.e. rows where `serviceType IN (PHASE_1_PLATFORM_FEE, PHASE_2_PLATFORM_FEE) AND vat = 0`), the VAT 7% was not recorded on the invoice row even though the customer paid it. Backfill:

```bash
# Dry-run first
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend node apps/backend/scripts/backfill-platform-invoice-vat.js --dry-run --verbose"

# If dry-run shows the expected count of rows + strategies, run for real
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend node apps/backend/scripts/backfill-platform-invoice-vat.js"
```

The script:

- Touches ONLY `PHASE_1_PLATFORM_FEE` and `PHASE_2_PLATFORM_FEE` rows where `vat = 0` and `isDeleted = false`.
- Never touches STATE-fee rows (DTAM is VAT-exempt).
- For `status='paid'` rows: preserves `totalAmount` (since the customer already paid it), reverse-derives `subtotal = totalAmount / 1.07` and `vat = totalAmount - subtotal`. Strategy: `PAID_PRESERVE_TOTAL`.
- For `status='pending'` / `overdue`: keeps `subtotal` as-is, adds `vat = round(subtotal * 7%)`, recomputes `totalAmount = subtotal + vat`. Strategy: `PENDING_ADD_VAT`.
- Idempotent: re-running is a no-op because rows that already have `vat > 0` are skipped.

**Verify:**

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"
SELECT COUNT(*)
FROM \\\"Invoice\\\"
WHERE \\\"serviceType\\\" IN ('PHASE_1_PLATFORM_FEE','PHASE_2_PLATFORM_FEE')
  AND \\\"isDeleted\\\" = false
  AND vat = 0;
\""
# Expected after backfill: 0
```

TODO(Finance): if any rows remain at vat=0 after backfill with `subtotal > 0` and `status='paid'`, those need manual review — likely indicate a malformed row from a pre-Tier-8 era where `totalAmount` and `subtotal` diverged in unexpected ways.

---

## 3. Rollback procedures

### General contract

- **Code rollback** (image revert) is always safe — the previous image expects plaintext PII columns, and the `enc:v1:` prefix detection in `prisma-pdpa-extension.js` ensures both legacy plaintext and post-backfill ciphertext rows remain readable by any version of the code that has the extension code present.
- **Database rollback** requires the §1.5 backup. Restore is destructive (overwrites live tables). Prefer code rollback first; restore only if data corruption is confirmed.
- **NEVER** rollback by re-decrypting columns in the database. The `decryptValue()` cipher uses an in-memory key — running a "decrypt all" pass without `ENABLE_PDPA_FIELD_ENCRYPTION=true` is incoherent.

### 3.1 Rolling back Step 1 (code deploy)

```bash
ssh root@<prod-host> "docker tag ghcr.io/jonmaxmore/gacp-backend:pre-release-<timestamp> ghcr.io/jonmaxmore/gacp-backend:current"
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps backend frontend"
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend npx prisma migrate status"
```

If the new release included a forward-only migration that the old code does not understand, you may need to also run the migration's `down.sql` (`prisma/migrations/<id>/down.sql` if present). For the migrations in this release, the schema changes are additive (new nullable columns + indexes) and do NOT require a down migration to revert.

### 3.2 Rolling back Step 2 (verification gate)

Nothing was written. Just re-run §1 prerequisites and identify the broken dependency before retrying §2 step 1.

### 3.3 Rolling back Step 3 (dry-run backfill)

Nothing was written. Investigate the error, restart the dry-run.

### 3.4 Rolling back Step 4 (real backfill)

The backfill is **partially complete**. Rows that were already encrypted are now stored as `enc:v1:…`; rows that haven't been touched are still plaintext. The system is in a mixed state.

Choice point:

- **Path A — finish the backfill, then proceed.** Recommended if the script failed mid-run on a transient cause (e.g. Redis blip — though the script does not use Redis; or DB lock). Re-run the same command: the cursor + `enc:v1:` prefix make it idempotent.
- **Path B — fully revert.** Only if the encryption key is suspect (e.g. you ran the backfill with the wrong key and the data is now unreadable). Restore from §1.5 backup:

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml stop backend"
ssh root@<prod-host> "pg_restore -d \$DATABASE_URL --clean --if-exists /var/backups/gacp/pre-deploy-<timestamp>.dump"
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml up -d backend"
```

**WARNING:** Path B reverts every database write since the backup — applications submitted, payments made, audit entries written. This is a last resort. Confirm with the on-call Compliance Lead before executing.

### 3.5 Rolling back Step 5 (grace window applied)

Setting `LEGACY_NO_JTI_GRACE_UNTIL` is non-destructive. To remove it, unset and restart:

```bash
# Remove LEGACY_NO_JTI_GRACE_UNTIL from .env.production
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml restart backend"
```

The trade-off: removing it BEFORE existing sessions have rotated to jti-bearing tokens will 401 those sessions. Users will have to re-login. This is the desired behaviour AFTER the deadline; pre-deadline it is a forced-logout incident.

To extend the grace window (e.g. if a critical integration is still presenting legacy tokens), increase the date:

```bash
LEGACY_NO_JTI_GRACE_UNTIL=2026-05-30T00:00:00Z
```

### 3.6 Rolling back Step 6 (PDPA encryption flag flipped ON)

Flip the flag back OFF:

```bash
# In .env.production:
ENABLE_PDPA_FIELD_ENCRYPTION=false
```

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml restart backend"
```

This is **safe and reversible** because:

- All reads pass through `decryptValue()`. With the flag off, the extension is bypassed entirely — but `decryptValue()` recognises the `enc:v1:` prefix and processes it correctly when called explicitly. With the extension fully off, callers see ciphertext strings (clearly not plaintext PII), which is the correct fail-safe.
- Wait — actually with the extension off, callers see `enc:v1:…` raw strings. If user-facing APIs need to keep rendering decrypted PII while the flag is off (because the backfill has happened), you must **leave the flag on**. A flag-off rollback only makes sense BEFORE the backfill has run, or when you accept temporary garbled display while you investigate.

**Decision matrix:**

| Backfill state | Flag flip OFF effect | Recommended action |
|---|---|---|
| Backfill never ran | Identical to original (legacy plaintext) | Safe |
| Backfill partial | Mixed state — some users see plaintext, some see `enc:v1:` | Finish backfill THEN flip on, or restore backup |
| Backfill complete | All users see `enc:v1:…` raw strings — broken UX | Leave flag ON; rollback code instead (§3.1) |

### 3.7 Rolling back Step 7 (smoke tests)

No mutation. Re-run smoke tests; if persistent failure, see §3.6 (flag flip) or §3.1 (code rollback).

### 3.8 Rolling back Step 8 (grace var removed)

Same as §3.5 — set the var back to a future ISO timestamp.

### 3.9 Special: rolling back JTI enforcement

To temporarily restore pre-revocation behaviour (e.g. while investigating a Redis incident):

```bash
LEGACY_NO_JTI_GRACE_UNTIL=2030-01-01T00:00:00Z  # far in the future
```

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml restart backend"
```

This accepts any token (jti-less or otherwise) for the next ~4 years. **Security downgrade — only use during active incident response.** Remove as soon as the underlying issue is resolved.

### 3.10 Special: rolling back PDPA encryption

See §3.6 above. The two key facts:

1. The `enc:v1:` prefix makes the legacy/ciphertext detection backward-compatible — neither version of the code crashes when seeing the other version's row content.
2. The flag flip OFF only restores legacy behaviour for NEW reads/writes; existing encrypted rows are still ciphertext until a forward decrypt pass runs (which is NOT a supported operation — see §3.4 path B).

### 3.11 Special: full release rollback

If multiple steps need to be reverted (e.g. a regression in the financial flow that the smoke test caught at step 7):

```bash
# 1. Flag off (in case encryption flip is the culprit)
# ENABLE_PDPA_FIELD_ENCRYPTION=false in .env.production

# 2. Image revert
ssh root@<prod-host> "docker tag ghcr.io/jonmaxmore/gacp-backend:pre-release-<timestamp> ghcr.io/jonmaxmore/gacp-backend:current"
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps backend frontend"

# 3. Verify
curl -fsk -m 10 https://<prod-host>/api/health
```

The previous image will see `enc:v1:…` rows it doesn't understand IF the backfill ran AND the previous image lacks the PDPA extension code. Per the codebase, the extension shipped with this release — so the previous image would see ciphertext raw strings. This is the case where §3.4 Path B (database restore) may be necessary.

---

## 4. Smoke test checklist

> Every item below must pass on production after step 6 (encryption ON). Use real credentials from the staging-equivalent test accounts, not the dev seeds in `apps/backend/scripts/seed-test-accounts.js`.

### 4.1 Login — HEALTH (applicant)

```bash
curl -sk -m 10 -X POST https://<prod-host>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<staging-applicant-email>","password":"<password>"}' | head -c 500
```

Expected:
- HTTP 200.
- Response contains `accessToken`, `refreshToken`, `user.id`, `user.role`.
- The JWT decoded payload contains `jti` (random 32-byte hex), `sessionFamilyId` (UUID), `healthId` (only if pre-Sprint-6 token — new tokens omit it; middleware reads from DB).

```bash
# Decode the JWT
echo "<paste-access-token>" | tr '.' '\n' | sed -n '2p' | base64 -d 2>/dev/null
```

**STOP if:** the token has no `jti` claim. The middleware will accept it only inside the grace window and log a `warn`. Outside the window, login should be issuing jti-bearing tokens; absence indicates a regression in `prisma-auth-service.js login()`.

### 4.2 Login — PROVIDER (DTAM staff)

```bash
curl -sk -m 10 -X POST https://<prod-host>/api/auth/provider/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<staging-provider-email>","password":"<password>"}' | head -c 500
```

Expected: HTTP 200, response contains `accessToken` signed with `PROVIDER_JWT_SECRET`. Verify by attempting `/api/admin/applications` with the returned token — should 200 (provider role has admin access via canonical RBAC).

### 4.3 Application submit (full happy path)

End-to-end: log in as applicant → create application → submit → verify status transitions.

```bash
# (Use a test fixture script from scripts/test/ for the full flow.)
# Required: ApplicationService.create + submit
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend npm run -s smoke:application-submit"
```

TODO(QA): Confirm `scripts/test/smoke-application-submit.js` exists. If not, hand-execute the 5-step flow per `README.md` §🧪.

### 4.4 MFA setup + verify

```bash
# Setup
curl -sk -X POST https://<prod-host>/api/identity/mfa/setup \
  -H "Authorization: Bearer <access-token>"
# Returns: { secret, qrCodeUrl, recoveryCodes }

# Verify
curl -sk -X POST https://<prod-host>/api/identity/mfa/verify \
  -H "Authorization: Bearer <access-token>" \
  -H 'Content-Type: application/json' \
  -d '{"challengeToken":"<token-from-login-step>","code":"<6-digit-totp>"}'
```

The `/verify` endpoint expects a `challengeToken` (opaque, single-use, Redis-backed, bound to the userId at login). It MUST NOT accept a raw `userId` body parameter — that was the audit finding fixed in Sprint 5B. Verify by attempting to verify with a different user's id; expected 401.

### 4.5 Logout — verify refresh token revoked

```bash
# Log in, capture refreshToken
# Then logout:
curl -sk -X POST https://<prod-host>/api/auth/logout \
  -H "Authorization: Bearer <access-token>" \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refresh-token>"}'
# Expected: 200

# Now try to use the refreshToken:
curl -sk -X POST https://<prod-host>/api/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refresh-token>"}'
# Expected: 401 — token revoked
```

### 4.6 Refresh-token rotation

```bash
# Log in fresh, capture refreshToken1
# Call refresh:
curl -sk -X POST https://<prod-host>/api/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refreshToken1>"}'
# Expected: 200, response contains a NEW accessToken + NEW refreshToken2

# Verify refreshToken1 is now blocklisted (single-use rotation):
curl -sk -X POST https://<prod-host>/api/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refreshToken1>"}'
# Expected: 401 — and an audit-log entry: REFRESH_TOKEN_REUSE_DETECTED
```

### 4.7 Refresh-token reuse detection (family-scoped revocation)

The big behavioural change in Sprint 7: re-presenting an already-rotated RT triggers a **family-scoped** revocation, not user-wide. Two sessions on different devices keep working; only the compromised family is killed.

```bash
# Login from device A → refreshTokenA, capture sessionFamilyId from JWT
# Login from device B → refreshTokenB (different sessionFamilyId)
# Both should work in parallel.

# Now replay refreshTokenA after it's been rotated once:
# (rotate it first)
curl -sk -X POST https://<prod-host>/api/auth/refresh -d '{"refreshToken":"<refreshTokenA>"}'
# (replay the same one)
curl -sk -X POST https://<prod-host>/api/auth/refresh -d '{"refreshToken":"<refreshTokenA>"}'
# Expected: 401 BLOCKED

# Verify device B's token still works:
curl -sk -X POST https://<prod-host>/api/auth/refresh -d '{"refreshToken":"<refreshTokenB>"}'
# Expected: 200 — sibling session unaffected
```

Verify audit:

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"
SELECT action, severity, \\\"actorType\\\", \\\"createdAt\\\"
FROM audit_logs
WHERE action = 'REFRESH_TOKEN_REUSE_DETECTED'
ORDER BY \\\"createdAt\\\" DESC LIMIT 5;
\""
```

### 4.8 /uploads access — security headers present

```bash
curl -sk -I -m 10 "https://<prod-host>/uploads/<known-file>" \
  -H "Authorization: Bearer <access-token>" | grep -Ei '(content-disposition|x-content-type-options|cross-origin-resource-policy|cache-control)'
```

Expected — all four headers present:

```
X-Content-Type-Options: nosniff
Content-Disposition: attachment
Cross-Origin-Resource-Policy: same-site
Cache-Control: private, no-store, max-age=0
```

**STOP if** any of the four is missing. The `/uploads` mount holds biometric + GPS-tagged PII; the headers are the PDPA Section 27 leak prevention.

### 4.9 Admin status override — transactional audit + actorType='ADMIN'

Login as an admin/provider role. Pick a known application id from staging.

```bash
curl -sk -X PATCH "https://<prod-host>/api/admin/applications/<id>/status" \
  -H "Authorization: Bearer <admin-access-token>" \
  -H 'Content-Type: application/json' \
  -d '{"status":"DOC_APPROVED","reasonCode":"COMPLIANCE_ESCALATION","comment":"smoke-test runbook §4.9"}'
# Expected: 200 + updated row
```

Verify the audit row was written inside the same SERIALIZABLE transaction:

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"
SELECT \\\"sequenceNumber\\\", action, \\\"actorType\\\", severity, metadata->>'previousStatus', metadata->>'nextStatus', metadata->>'reasonCode'
FROM audit_logs
WHERE action = 'APPLICATION_STATUS_OVERRIDE'
ORDER BY \\\"createdAt\\\" DESC LIMIT 1;
\""
```

Expected:
- `actorType = 'ADMIN'` (this was the Sprint-6 fix — used to be missing).
- `severity = 'WARNING'`.
- `metadata->>'previousStatus'` and `'nextStatus'` populated.
- `sequenceNumber` is `(max - 1)` (i.e. monotonically increasing, no gap).

### 4.10 Receipt download — Platform tax invoice ISSUER

Issue a Phase-1 Platform fee invoice and download the receipt PDF.

```bash
curl -sk -m 30 "https://<prod-host>/api/invoices/<invoice-id>/receipt.pdf" \
  -H "Authorization: Bearer <access-token>" \
  -o /tmp/receipt.pdf
pdftotext /tmp/receipt.pdf - | head -50
```

**Verify in the rendered text:**

- The string `บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด (สำนักงานใหญ่)` appears (Platform issuer).
- The string `0105568045932` appears (Platform tax ID).
- The strings `เลขประจำตัวผู้เสียภาษีอากร` and `0105568045932` are adjacent.
- The literal "ใบกำกับภาษี" appears (required by ม.86/4 (1)).
- "(สำนักงานใหญ่)" appears (required by ม.86/4 (1) for VAT registration distinguishing head office vs branch).
- VAT amount appears (e.g. `35` for Phase-1 single-scope; `175` for Phase-2 single-scope).
- The string `กรมการแพทย์แผนไทย` does NOT appear (Platform invoice must not reference DTAM as issuer).
- The string `PENDING_FINANCE_CONFIRMATION` does NOT appear.

**STOP if** any of the above fail. Most likely cause: `PLATFORM_TAX_ID` env var override accidentally pointing to DTAM, or the wrong issuer was resolved by `getInvoiceIssuer()`.

### 4.11 Receipt download — DTAM state-fee receipt ISSUER

Issue a Phase-1 State fee invoice and download.

```bash
curl -sk -m 30 "https://<prod-host>/api/invoices/<state-invoice-id>/receipt.pdf" \
  -H "Authorization: Bearer <access-token>" \
  -o /tmp/state-receipt.pdf
pdftotext /tmp/state-receipt.pdf - | head -50
```

Expected:
- `กรมการแพทย์แผนไทยและการแพทย์ทางเลือก` appears (DTAM issuer).
- `ใบเสร็จเงินรายได้แผ่นดิน` appears (government revenue receipt format).
- NO `VAT`/`ภาษีมูลค่าเพิ่ม` line on the document — state revenue is VAT-exempt per Thai tax law.
- NO `ใบกำกับภาษี` literal — this is a receipt, not a tax invoice.
- NO `บริษัท พรีดิกทีฟ` — Platform must not appear on a DTAM-issued receipt.

If `DTAM_TAX_ID` is still PENDING in production, the literal `PENDING_FINANCE_CONFIRMATION` will print where the tax ID should be. TODO(Finance/DTAM): fix before public state-fee issuance.

### 4.12 PDPA right-of-access export (Section 30)

```bash
curl -sk -m 30 "https://<prod-host>/api/auth/me/export" \
  -H "Authorization: Bearer <access-token>" \
  -o /tmp/export.json
jq '.user.idCard, .user.taxId' /tmp/export.json
```

Expected: real plaintext values (not `enc:v1:…`). This confirms `decryptValue()` ran on the export path.

Verify audit:

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"
SELECT action, \\\"actorId\\\", metadata->>'regulation', \\\"createdAt\\\"
FROM audit_logs
WHERE action = 'PDPA_EXPORT'
ORDER BY \\\"createdAt\\\" DESC LIMIT 5;
\""
```

Expected: latest row has `metadata->>'regulation' = 'PDPA-S30'`.

### 4.13 PDPA right-of-erasure / deleteMe (Section 33)

```bash
# Use a disposable test account
curl -sk -X DELETE "https://<prod-host>/api/auth/me/delete" \
  -H "Authorization: Bearer <access-token>" \
  -H 'Content-Type: application/json' \
  -d '{"password":"<correct-password>","reason":"runbook §4.13 smoke test"}'
# Expected: 200 { success: true, data: { retainUntil: "...", ... } }
```

Verify:

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"
SELECT id, \\\"isDeleted\\\", \\\"deletedAt\\\", \\\"retainUntil\\\", \\\"isAnonymized\\\", \\\"formData\\\"::text
FROM \\\"User\\\"
WHERE email LIKE '<disposable-test-account>%';
\""
```

Expected: `isDeleted=true`, `deletedAt` non-null, `formData` scrubbed (no PII residual — either NULL or `{}`).

Verify audit:

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"
SELECT action, metadata->>'regulation', metadata->>'retainUntil'
FROM audit_logs WHERE action = 'PDPA_DELETE_REQUESTED'
ORDER BY \\\"createdAt\\\" DESC LIMIT 5;
\""
```

Expected: `metadata->>'regulation' = 'PDPA-S33'`.

### 4.14 PDPA right-of-access — hash lookup works

The export path uses a deterministic `healthIdHash` HMAC lookup (see `apps/backend/services/user-lookup-service.js` `findUserByHealthId`). Verify by exporting an account whose `healthIdHash` is non-null AND its `healthId` is encrypted:

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"
SELECT id, \\\"healthIdHash\\\" IS NOT NULL AS has_hash, \\\"healthId\\\" LIKE 'enc:v1:%' AS hid_encrypted
FROM \\\"User\\\"
WHERE \\\"isDeleted\\\" = false LIMIT 5;
\""
```

For all returned rows, `has_hash` should be `t`. If `has_hash` is `f` for an active user, that user's audit export will fall back to slower full-scan (Sprint 6 PR-04 fallback) — acceptable but not optimal. See §5.3 daily reconciliation.

---

## 5. Post-deploy monitoring

### 5.1 Audit events to alert on

Hand these to SecOps / SIEM. All events are written via `apps/backend/middleware/audit-logger.js` and surface as either `audit_logs` rows (for in-DB chain) or structured `logger.error('[SECURITY] <EVENT>')` records (for SIEM forwarders).

| Event | Severity | Source | Alert threshold | Recommended action |
|---|---|---|---|---|
| `REFRESH_TOKEN_REUSE_DETECTED` | HIGH | DB `audit_logs.action` | Any > 0 (per user per 24h) | Manual investigation: is this user's device compromised? Family-blocklist already triggered; consider forcing global logout via `revokeAllUserTokens`. |
| `ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE` | CRITICAL | Structured log + `securityEvent: true` | First occurrence pages on-call | Restore Redis. If credential compromise suspected during window, rotate `HEALTH_JWT_SECRET` / `PROVIDER_JWT_SECRET` — invalidates ALL access tokens. |
| `PDPA_EXPORT` | INFO | DB `audit_logs.action` | None — just retain | Quarterly Compliance review for unusual frequency from a single actor. |
| `PDPA_DELETE_REQUESTED` | WARNING | DB `audit_logs.action` | Spike (e.g. > 10/day platform-wide) | Compliance review: legitimate user requests, or potential account-takeover wiping evidence? |
| `APPLICATION_STATUS_OVERRIDE` | WARNING | DB `audit_logs.action` with `actorType='ADMIN'` | Spike from a single admin | Manager review of reasonCode + comment fields. |
| `[secrets] CRITICAL` | CRITICAL | Structured log | First occurrence on backend startup | Backend will crash; restore the missing secret and restart. |
| `PII_DECRYPT_FAILED` | HIGH | Application logs / API responses | Any > 0 | Cipher key mismatch — verify `ENCRYPTION_KEY` matches the one used during backfill. |
| `[invoice-issuers] PENDING` | WARNING | Structured log on startup | First occurrence | Set the missing DTAM env vars; restart backend. |

TODO(SecOps): wire each of the above into your SIEM rule engine and confirm SOC has the runbook entry for each event.

### 5.2 SIEM / SOC integration points

The structured high-severity events have a stable shape that SIEMs can filter on:

```json
{
  "severity": "CRITICAL",
  "securityEvent": true,
  "event": "ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE",
  "timestamp": "...",
  "jtiPrefix": "...",
  "error": "...",
  "recommendedAction": "...",
  "failMode": "OPEN"
}
```

SIEM filter recipe:

- **`securityEvent=true`** → tag all security-emitted log records for the security feed.
- **`severity=CRITICAL` AND `securityEvent=true`** → page on-call immediately.
- **`event=REFRESH_TOKEN_REUSE_DETECTED`** → write to `audit_logs` table; cross-reference with `actorId` to identify the user; trigger account review workflow.

The fail-OPEN policy on the access-token blocklist is intentional (see `token-revocation-service.js` SECURITY POLICY block — DO NOT REVERSE WITHOUT REVIEW). The CRITICAL audit event is the compensating control.

### 5.3 Daily reconciliation queries

Run these as a daily cron from a read replica or with a tight `statement_timeout` from the primary:

#### 5.3.1 Users without healthIdHash

```sql
SELECT COUNT(*) AS missing_hash_count
FROM "User"
WHERE "isDeleted" = false
  AND "healthId" IS NOT NULL
  AND "healthIdHash" IS NULL;
```

Expected: monotonically decreasing toward 0 as users log in (login fills the hash). If stuck above zero, investigate `prisma-auth-service.js` `_ensureUserHealthIdHash` execution path.

#### 5.3.2 PII columns still plaintext after backfill (post-Step 6)

```sql
SELECT
  COUNT(*) FILTER (WHERE "idCard" IS NOT NULL AND "idCard" NOT LIKE 'enc:v1:%') AS idCard_plain,
  COUNT(*) FILTER (WHERE "taxId" IS NOT NULL AND "taxId" NOT LIKE 'enc:v1:%')   AS taxId_plain,
  COUNT(*) FILTER (WHERE "address" IS NOT NULL AND "address" NOT LIKE 'enc:v1:%') AS address_plain
FROM "User"
WHERE "isDeleted" = false;
```

Expected after Step 4: all zero. Any non-zero count = orphaned row that the backfill missed (e.g. created between dry-run and real backfill).

#### 5.3.3 Audit chain integrity

```sql
SELECT MIN("sequenceNumber") AS min_seq,
       MAX("sequenceNumber") AS max_seq,
       COUNT(*)              AS rows,
       MAX("sequenceNumber") - MIN("sequenceNumber") + 1 - COUNT(*) AS missing_seqs
FROM audit_logs;
```

Expected: `missing_seqs = 0`. Non-zero means a gap in the global sequence — caused by a transaction that wrote an audit-log row but rolled back the application change without rolling back the audit. The Step-9 `actorType='ADMIN'` admin-override path is the most likely culprit if you see a non-zero count here.

#### 5.3.4 Invoice VAT consistency

```sql
SELECT COUNT(*) AS platform_invoices_missing_vat
FROM "Invoice"
WHERE "isDeleted" = false
  AND "serviceType" IN ('PHASE_1_PLATFORM_FEE','PHASE_2_PLATFORM_FEE')
  AND vat = 0;
```

Expected: 0 after Step 10 backfill (if any rows existed pre-Tier-9). Any non-zero count = a new PLATFORM invoice was created without the Tier-9 fix path being exercised.

#### 5.3.5 Pending issuer fields

Run on startup OR daily:

```bash
ssh root@<prod-host> "docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend node -e \"
const { listPendingIssuerFields } = require('./config/invoice-issuers');
const pending = listPendingIssuerFields();
console.log(JSON.stringify(pending, null, 2));
process.exit(pending.length ? 1 : 0);
\""
```

Expected: empty array (`[]`).

### 5.4 Performance baselines

Capture these on day 1 post-deploy and re-measure weekly. Significant regression = investigate.

| Metric | Baseline (typical) | How to capture |
|---|---|---|
| `/api/health` p95 latency | < 50 ms | Grafana / nginx access log percentile |
| `/api/auth/login` p95 latency | < 500 ms (incl. bcrypt) | Same |
| `/api/auth/refresh` p95 latency | < 100 ms (Redis-bound) | Same |
| `/api/admin/applications` p95 latency | < 300 ms | Same |
| Redis ops/s (auth namespaces) | varies by user load | `redis-cli INFO commandstats` |
| Postgres `audit_logs` insert rate | < 50/s steady-state | `pg_stat_user_tables` |
| Backend memory (RSS) | < 1.5 GB | `docker stats` |

TODO(Ops): wire each of the above into your APM (e.g. Grafana, DataDog) with alerts on > 2x baseline.

---

## 6. Known limitations + handoff items

This section is the explicit "what we know is not done" list. Hand this to the next sprint planning meeting.

### 6.1 PII encryption — Phase 2 deferred

`healthId` and `providerId` are NOT yet encrypted at rest. The platform uses these in `WHERE` clauses for user lookups; switching them to encrypted requires:

1. Migrating every `findFirst({ where: { healthId } })` callsite to `findFirst({ where: { healthIdHash } })` first, then decrypt-and-verify.
2. Then adding `healthId` and `providerId` to the `PHASE_1_PII_COLUMNS` list in `apps/backend/services/prisma-pdpa-extension.js`.
3. A new backfill pass for those two columns.

Phase 1 (the 9 display-only columns) is what shipped in this release. Phase 2 is a dedicated future sprint. See `prisma-pdpa-extension.js` for the full deferred list.

### 6.2 DTAM tax ID confirmation outstanding

TODO(Finance/DTAM): `DTAM_TAX_ID`, `DTAM_ADDRESS_LINE1`, `DTAM_ADDRESS_LINE2` are still `PENDING_FINANCE_CONFIRMATION` in production. Until set, every `RCP-DTAM-…` receipt prints the literal sentinel. Either:

- Block state-fee payments at the gateway during the rollout window, OR
- Get the values confirmed by Finance/DTAM before the first state-fee transaction.

### 6.3 Refresh-token migration window

TODO(SecOps/Compliance): `LEGACY_NO_JTI_GRACE_UNTIL` set to ~7 days. After the deadline, every legacy session forces re-login. Confirm with Customer Support that the support funnel can absorb the re-login spike.

### 6.4 Dev script PDPA-aware flags

TODO(Backend): `apps/backend/scripts/seed-test-accounts.js`, `seed-professional-account.js`, and the e2e/regression scripts under `apps/backend/scripts/` do NOT yet wrap their writes through the PDPA extension. They currently work because production NODE_ENV gates them off, but if anyone runs them against a prod-like environment with the flag on, they will write plaintext that then fails the daily reconciliation in §5.3.2.

Migration plan: each script should `require('../services/prisma-database').prisma` (the extended client) instead of `basePrisma`. Tracked under follow-up sprint backlog.

### 6.5 Withholding tax 3% (WHT) NOT collected by platform

Intentional. Per `apps/backend/config/invoice-issuers.js` header comment and owner direction 2026-05-15:

> "ถ้าหัก 3% แล้วเสี่ยงผิดกฎหมาย หรือเราไม่ได้นำส่ง เอาออกก็ได้"

Platform issues a full tax invoice; corporate customers withhold 3% on their own ภ.ง.ด.53 cycle. The Invoice schema has NO `withholdingTax` field — adding it without a ภ.ง.ด.53 remittance pipeline would create unremitted-tax exposure.

TODO(Finance/Compliance): formal decision document (yes-keep-current / no-build-WHT-pipeline) tracked for next compliance review.

### 6.6 Audit chain partitioning by tenant

Today `audit_logs.sequenceNumber` is a single global monotonic sequence. The Sprint-6 plan was to partition by `organizationId` so per-tenant audit chains are independent (reduces serialization contention on the admin-override hot path). Not yet shipped — see the in-line comment in `apps/backend/routes/api/admin/applications.js` for the retry strategy that compensates.

TODO(Backend/DBA): Phase 2 audit-chain partition migration.

### 6.7 Access-token blocklist fail-OPEN policy

`isAccessTokenBlocklisted` fails OPEN by design (see SECURITY POLICY block in `token-revocation-service.js`). This is asymmetric with `isRefreshTokenBlocklisted` (fails CLOSED). Risk accepted: a Redis outage means a token revoked via /logout or admin-force-logout remains valid for up to its remaining 15-min TTL. Compensating control: `ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE` audit event pages SecOps on the first occurrence.

TODO(SecOps/Security Lead): the policy was reviewed and approved 2026-05-16. Re-confirm at the next quarterly security review.

### 6.8 Manual provider tax-ID issuance

The `legalNameTH` for Platform includes `(สำนักงานใหญ่)` as the head-office distinguisher per ม.86/4 (1). The codebase does NOT yet support branch-office VAT registrations. If Predictive AI Solution opens a branch and wants to issue invoices under a branch tax ID, this requires a code change (new `PLATFORM_BRANCH_*` config) + Finance sign-off.

TODO(Finance): not currently needed; document for future.

### 6.9 Cloud firewall rotation

TODO(Ops): the DO Cloud Firewall `gacp-production` SSH allowlist needs operator-IP rotation procedure documented separately. Not in scope of this runbook.

### 6.10 SIEM / SOC subscription

TODO(SecOps): confirm SIEM subscription is active and the rule engine has the events from §5.1 wired up. Without this, the fail-OPEN compensating-control story in §6.7 is incomplete.

---

## 7. Appendix — quick reference

### 7.1 Environment variable cheat-sheet

```dotenv
# Hard required (backend won't start without these)
NODE_ENV=production
DATABASE_URL=postgresql://gacp:<pw>@<host>:5432/gacp_db?schema=public&sslmode=require
REDIS_URL=redis://:<pw>@<host>:6379
ENCRYPTION_KEY=<64-char-random>
MASTER_ENCRYPTION_KEY=<64-char-random>   # or omit to alias to ENCRYPTION_KEY
HMAC_KEY=<64-char-random>
HEALTH_JWT_SECRET=<64-char-random>
PROVIDER_JWT_SECRET=<64-char-random>
SESSION_SECRET=<64-char-random>
PAYMENT_WEBHOOK_SECRET=<32-char-random>
CRON_SECRET=<32-char-random>
LAB_API_KEY=<32-char-random>
S3_ACCESS_KEY=<minio-access-key>
S3_SECRET_KEY=<minio-secret-key>

# Rollout flags
ENABLE_PDPA_FIELD_ENCRYPTION=false                         # Step 1, flip to true at Step 6
LEGACY_NO_JTI_GRACE_UNTIL=2026-05-23T00:00:00Z             # Step 5, remove at Step 8

# Issuer (Platform — confirmed defaults, recommended to set explicitly)
PLATFORM_COMPANY_NAME_TH=บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด (สำนักงานใหญ่)
PLATFORM_COMPANY_NAME_EN=Predictive AI Solution Co., Ltd. (Head Office)
PLATFORM_TAX_ID=0105568045932
PLATFORM_REGISTRATION_NO=0105568045932
PLATFORM_ADDRESS_LINE1=429/69 หมู่บ้าน พรีเมี่ยมเพลส ถนนสุคนธสวัสดิ์ แขวงลาดพร้าว เขตลาดพร้าว
PLATFORM_ADDRESS_LINE2=กรุงเทพมหานคร 10230

# Issuer (DTAM — TODO before state-fee issuance)
# DTAM_TAX_ID=
# DTAM_ADDRESS_LINE1=
# DTAM_ADDRESS_LINE2=

# Application config (per production-deployment-checklist.md §1.3)
FRONTEND_URL=https://<prod-domain>
FRONTEND_BASE_URL=https://<prod-domain>
EMAIL_FROM_ADDRESS=noreply@<prod-domain>
SMS_SENDER=GACP
CORS_ORIGIN=https://<prod-domain>
LOG_LEVEL=info
PORT=3000
```

### 7.2 Deploy sequence at a glance

```
┌─ Phase 0: Prep ─────────────────────────────────────────┐
│  §1.1   Set all secrets in secret manager                │
│  §1.2   Verify Redis (4 namespaces)                       │
│  §1.3   Verify Postgres                                   │
│  §1.4   Verify MinIO                                      │
│  §1.5   Pre-deploy DB backup                              │
│  §1.6   Pre-tag rollback image                            │
│  §1.7   DTAM coordination items addressed                 │
│  §1.8   Topology preflight                                │
├─ Phase 1: Code deploy (encryption OFF) ─────────────────┤
│  §2.1   Pull + up backend/frontend (flag OFF)             │
│  §2.1   prisma migrate deploy                              │
│  §2.2   Verify /api/health, db.status, redis.status        │
├─ Phase 2: Backfill ──────────────────────────────────────┤
│  §2.3   pdpa backfill --dry-run                            │
│  §2.4   pdpa backfill (real)                                │
│  §2.4   Verify enc:v1: spot-check                            │
├─ Phase 3: Auth + Encryption cutover ────────────────────┤
│  §2.5   Set LEGACY_NO_JTI_GRACE_UNTIL, restart             │
│  §2.6   Set ENABLE_PDPA_FIELD_ENCRYPTION=true, restart      │
│  §2.7   Run §4 smoke tests (all 14 must pass)               │
├─ Phase 4: Grace expiry ──────────────────────────────────┤
│  §2.8   After deadline: remove LEGACY_NO_JTI_GRACE_UNTIL    │
│  §2.10  Conditional: PLATFORM invoice VAT backfill          │
├─ Phase 5: Monitor (24h+) ───────────────────────────────┤
│  §5.1   SecOps watching audit events                         │
│  §5.3   Daily reconciliation queries                          │
│  §5.4   Performance baselines captured                         │
└──────────────────────────────────────────────────────────┘
```

### 7.3 Sign-off

| Role | Name | Approved? | Date |
|---|---|---|---|
| DevOps Lead | | ☐ | |
| Security Lead | | ☐ | |
| Compliance Lead | | ☐ | |
| DBA | | ☐ | |
| QA Lead | | ☐ | |
| Product / Owner | | ☐ | |

### 7.4 Incident contacts (TODO)

TODO(Ops): populate this with the actual on-call rotation, paging numbers, and Compliance / Finance escalation chains. The runbook is incomplete without it.

| Role | Primary | Secondary | Page how |
|---|---|---|---|
| On-call SRE | TODO | TODO | TODO |
| Security Lead | TODO | TODO | TODO |
| Compliance Lead | TODO | TODO | TODO |
| Finance (for DTAM issuer questions) | TODO | TODO | TODO |
| DTAM coordination contact | TODO | TODO | TODO |

---

## Change log

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-05-16 | DevOps + Compliance Lead | Initial production deploy runbook covering post-9-commit security wave: PDPA Phase-1 encryption, JTI enforcement + grace window, refresh-token reuse detection with family-scoped revocation, audit-transactional integrity, invoice issuer separation (DTAM vs Platform), uploads security headers, PDPA Section 30 / 33 endpoints. |
