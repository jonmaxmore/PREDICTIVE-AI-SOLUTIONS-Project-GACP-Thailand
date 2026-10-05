# Secrets Catalog & Backend Abstraction — Iter 27 (2026-05-16)

Owner: Security / Infra (owner@example.com)
Status: Living document — update whenever a new secret is added to `apps/backend/config/secrets.js`.

> **Superseded note (2026-08-19)** — this is a dated snapshot; history below is left as-written.
> The EMAIL/SMS secret rows it inventories (`EMAIL_SMTP_*`, `THAIBULKSMS_*`/`SMS_*`) were retired
> 2026-08-19 by the external-services cleanup (Task 3) — those transports/providers were deleted
> and the rows removed from `apps/backend/config/secrets.js` + `.env.example`. See
> `docs/operations/notifications-inapp-only.md` for the current in-app-only notification design.

This document describes the **canonical inventory of secrets** consumed by the
GACP backend, the **pluggable secret-backend abstraction** introduced in
Iter 27, and the **operational runbook** for provisioning secrets in the
DTAM production environment.

---

## 1. Why a catalog?

Before Iter 27 the backend read secrets via two channels:

1. `config/secrets.js` (catalog + alias support, since Sprint 3).
2. Ad-hoc `process.env.X || 'fallback'` patterns scattered across services.

The PENDING sentinel `PENDING_FINANCE_CONFIRMATION` (defined in
`config/invoice-issuers.js`) flagged values that Finance/Legal had not yet
confirmed. Nothing prevented those sentinels from reaching production —
the runtime would happily print "PENDING_FINANCE_CONFIRMATION" on a
customer receipt.

Iter 27 closes that loop by:

- **Cataloguing every secret** the backend reads, with required-in-production
  flag, minimum length, sensitive marker, and the file(s) that use it.
- **Adding a fail-closed gate** (`validateSecretsForEnvironment`) that the
  pre-deploy CI / `scripts/check-secrets.js` invokes — exit 1 if any
  production-required value is missing, PENDING, or below `minLength`.
- **Decoupling the transport layer** so production can swap from plain env
  vars to Hashicorp Vault / AWS Secrets Manager / Azure Key Vault without
  touching call sites.

---

## 2. Catalog inventory

All entries live in `apps/backend/config/secrets.js` under `SECRETS_CATALOG`.
The catalog is `Object.freeze()`-d at module load.

| Name | Required | Sensitive | Min Length | Description | Used In |
|------|----------|-----------|-----------:|-------------|---------|
| `HEALTH_JWT_SECRET` | production | yes | 32 | HMAC-HS256 signing key for health (applicant) user JWTs | `middleware/auth`, `config/jwt-security.js` |
| `PROVIDER_JWT_SECRET` | production | yes | 32 | HMAC-HS256 signing key for provider/DTAM staff JWTs | `middleware/auth`, `config/jwt-security.js` |
| `REFRESH_TOKEN_SECRET` | optional | yes | 32 | HMAC signing key for refresh tokens (falls back to `HEALTH_JWT_SECRET`) | `services/auth` |
| `ENCRYPTION_KEY` | **always** | yes | 32 | AES-256 master encryption key for PII (Thai ID, personal data) | `utils/field-encryption.js`, `shared/encryption.js` |
| `MASTER_ENCRYPTION_KEY` | production | yes | 32 | Master AES-256 key used by EncryptionService | `services/security-compliance.js` |
| `HMAC_KEY` | production | yes | 32 | HMAC signing key for data integrity / audit signatures | `services/audit-*` |
| `SESSION_SECRET` | production | yes | 32 | Session signing secret (cookies, OAuth state) | `middleware/session` |
| `THAID_STATE_SECRET` | optional | yes | 32 | OAuth state HMAC for ThaiD CSRF protection | `routes/auth/thaid` |
| `DATABASE_URL` | production | yes (URL embeds password) | — | PostgreSQL connection string | `services/prisma-database` |
| `REDIS_URL` | production | yes | — | Redis connection string (Bull queues + cache) | `services/redis-service` |
| `REDIS_PASSWORD` | optional | yes | — | Redis password (when not embedded in URL) | `services/redis-service` |
| `S3_ACCESS_KEY` | production | yes | — | S3/MinIO access key ID | `services/storage` |
| `S3_SECRET_KEY` | production | yes | — | S3/MinIO secret access key | `services/storage` |
| `KSHER_APP_ID` | optional | yes | — | Ksher payment gateway app ID | `services/payment/ksher` |
| `KSHER_PRIVATE_KEY` | optional | yes | — | Ksher RSA private key for payment signing | `services/payment/ksher` |
| `PAYMENT_WEBHOOK_SECRET` | production | yes | 16 | HMAC secret for verifying inbound payment webhooks | `routes/webhooks/payment` |
| `SMTP_PASSWORD` | optional | yes | — | SMTP authentication password | `services/notification/email` |
| `SMS_API_KEY` | optional | yes | — | SMS provider API token | `services/notification/sms` |
| `SENTRY_DSN` | optional | yes (URL) | — | Sentry error tracking DSN | `shared/production-logger` |
| `LINE_NOTIFY_TOKEN` | optional | yes | — | LINE Notify API token | `services/notification/line` |
| `THAID_CLIENT_SECRET` | optional | yes | — | ThaiD OAuth client secret | `routes/auth/thaid` |
| `RSA_PRIVATE_KEY_PASSPHRASE` | production | yes | 16 | AES-256-CBC passphrase protecting RSA key used to sign certificates and tax invoices | `services/crypto/signature-service.js` |
| `DTAM_BANK_ACCOUNT_NO` | optional (baked default `4750134376`) | no | — | กรมบัญชีกลาง bank account for state-fee receipts | `config/invoice-issuers.js` |
| `PLATFORM_BANK_ACCOUNT_NO` | production | no | — | Predictive AI Solution corporate bank account for platform-fee receipts | `config/invoice-issuers.js` |
| `PLATFORM_BANK_NAME` | production | no | — | Bank + branch where the platform account lives | `config/invoice-issuers.js` |
| `PLATFORM_PROMPTPAY_ID` | optional (defaults to platform tax-ID) | no | — | PromptPay identifier for platform account | `config/invoice-issuers.js` |

Notes:

- `required: 'always'` means the secret MUST be present in any environment
  (including dev). Only `ENCRYPTION_KEY` is `always` — PII encrypted under a
  random/missing key is unrecoverable, so silent fallback is forbidden.
- `required: 'production'` means the secret is allowed to fall back in
  dev/test (via `devFallback`), but production startup must fail closed.
- `required: false` means optional — `getSecret()` returns `null` if absent.

---

## 3. Backend abstraction

```text
                              ┌─────────────────┐
                              │  config/secrets │
       getSecret(name)  ───►  │       .js       │  ───► value
                              │   (catalog +    │
                              │   validation)   │
                              └────────┬────────┘
                                       │
                          SECRET_BACKEND switch
                                       │
      ┌─────────────┬──────────────┬───┴──────────┬─────────────┐
      ▼             ▼              ▼              ▼             ▼
   env=process    file=/run     vault          aws            azure
   .env[name]    /secrets/X    (STUB)         (STUB)          (STUB)
   (default)     (Docker)      throws         throws          throws
```

| `SECRET_BACKEND` | Status | Transport |
|------------------|--------|-----------|
| `env` (default) | working | `process.env[name]` |
| `file` | working | `fs.readFileSync('/run/secrets/' + name)` |
| `vault` | **stub** | `@hashicorp/vault-client` — not installed; throws |
| `aws` | **stub** | `@aws-sdk/client-secrets-manager` — not installed; throws |
| `azure` | **stub** | `@azure/keyvault-secrets` — not installed; throws |

The stubs are deliberate: switching backend in production must be an
**explicit deploy-time decision** (install SDK + flip env + replace stub
implementation). A silent backend swap would risk plaintext leakage or
silent fallback to env vars that an attacker can read from a process
listing.

**`getSecretAsync(name)`** is exported alongside `getSecret(name)` to give
callers an async-friendly API that future Vault/AWS implementations can
use without breaking the synchronous contract today.

### Implementing a real backend

To wire Vault (example):

1. `npm install @hashicorp/vault-client` (or your client of choice).
2. Edit `_readFromBackend()` in `apps/backend/config/secrets.js` —
   replace the `case 'vault'` stub with a real read. The async API
   may require routing through `getSecretAsync`.
3. Add `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_NAMESPACE` to the
   secret-manager runbook below.
4. Set `SECRET_BACKEND=vault` in the production environment.
5. Run `node apps/backend/scripts/check-secrets.js --env=production` —
   should exit 0.

The same pattern applies to AWS Secrets Manager and Azure Key Vault.

---

## 4. Validation strategy

Two validators coexist:

### 4.1 `validateAllSecrets()` — runtime startup gate
Used by the running server's bootstrap. Returns `{ ok, errors, warnings, backend, nodeEnv }`.
Accepts dev fallbacks as "ok" so local development works without ops setup.

### 4.2 `validateSecretsForEnvironment(env)` — pre-deploy CI gate (NEW)
Designed for the `check-secrets` CLI and CI pipelines. Returns an array of
`{ name, reason, spec, actualLength? }` records. Possible reasons:

- `MISSING_OR_PENDING` — value is unset, empty, or equals the
  `PENDING_FINANCE_CONFIRMATION` sentinel.
- `TOO_SHORT` — value is set but shorter than `minLength`.

The CLI script `apps/backend/scripts/check-secrets.js`:

```bash
node apps/backend/scripts/check-secrets.js --env=production
# exit 0: all good
# exit 1: at least one production-required secret missing / PENDING / too short
# exit 2: internal script error

# Machine-readable for CI:
node apps/backend/scripts/check-secrets.js --env=production --json
```

The CLI does **not** consult dev fallbacks — pre-deploy validation must
catch the case "dev fallback masked a missing prod secret".

### 4.3 Wire-up at server boot (recommended — NOT done in this iter)

`server.js` already invokes `initializeEnvironment()` from
`config/env-validator.js`. Iter 27 chose **not** to auto-wire
`validateSecretsForEnvironment` at boot because doing so could break local
dev (a developer who hasn't set `PLATFORM_BANK_ACCOUNT_NO` shouldn't be
blocked from running tests). The orchestrator's task spec explicitly
defers that wiring decision.

Suggested wiring (for a future iter, after Finance fills in the PLATFORM
bank values):

```js
// near the top of apps/backend/server.js, after initializeEnvironment()
const { validateSecretsForEnvironment } = require('./config/secrets');
if (process.env.NODE_ENV === 'production') {
    const errors = validateSecretsForEnvironment('production');
    if (errors.length > 0) {
        console.error('STARTUP FAILED — Secret catalog gate:');
        for (const e of errors) {console.error('  ', e.name, e.reason);}
        process.exit(1);
    }
}
```

---

## 5. Provisioning runbook (production / DTAM)

The recommended target for DTAM production is Hashicorp Vault or Azure
Key Vault, both of which DTAM's IT can host. While the backend is still
on the `env` transport, secrets are read from the process environment —
typically injected by:

- `systemd` unit `Environment=` directives in a sealed `/etc/systemd/system/gacp-backend.service.d/override.conf`.
- Docker / Compose secrets mounted at `/run/secrets/<NAME>` (set `SECRET_BACKEND=file`).
- Kubernetes `Secret` objects projected as env vars or as files (`projected.sources.secret`).

For each secret in the catalog table above, the deploy team must:

1. Generate or obtain the value (see "Per-secret provisioning" below).
2. Store it in the secret manager (Vault path / AWS ARN / Azure secret).
3. Inject into the backend process via the configured `SECRET_BACKEND`.
4. Confirm by running `check-secrets.js --env=production`.

### Per-secret provisioning

- **Cryptographic keys (HEALTH_JWT_SECRET, PROVIDER_JWT_SECRET, ENCRYPTION_KEY, MASTER_ENCRYPTION_KEY, HMAC_KEY, SESSION_SECRET, PAYMENT_WEBHOOK_SECRET)**
  → Generate with `openssl rand -hex 32` (or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). NEVER share or check in.

- **RSA_PRIVATE_KEY_PASSPHRASE**
  → Generate a high-entropy passphrase (`openssl rand -base64 24`). The
  RSA private key file (`apps/backend/keys/private.pem`) must be encrypted
  with this passphrase via `openssl pkcs8 -topk8 -aes-256-cbc`. Loss of
  this passphrase = inability to sign new certificates.

- **DATABASE_URL** → Provided by DTAM database administrator. Format:
  `postgresql://user:pass@host:5432/db?schema=public&sslmode=require`.

- **REDIS_URL** → Provided by DTAM platform team. Use `rediss://` (TLS)
  in production.

- **S3_ACCESS_KEY / S3_SECRET_KEY** → Generated by the object-storage
  team. Scope the IAM/MinIO policy to the application's bucket only.

- **PAYMENT_WEBHOOK_SECRET** → Negotiate with Ksher / payment gateway
  during PSP onboarding. Same value must be configured in Ksher's
  dashboard for HMAC verification.

- **SENTRY_DSN** → Pull from the GACP Sentry project's "Client Keys (DSN)"
  page. Treat as sensitive — DSN exposure lets attackers spam events.

- **DTAM_BANK_ACCOUNT_NO** → Baked default `4750134376` is the public
  กรุงไทย account for "เงินบำรุงศูนย์พัฒนายาไทยและสมุนไพร" — confirmed
  in `apps/backend/services/pdf/templates/invoice.html` and reused by
  `config/invoice-issuers.js`. Override only if DTAM rotates the
  account via กรมบัญชีกลาง's TCMS.

- **PLATFORM_BANK_ACCOUNT_NO / PLATFORM_BANK_NAME** → **PENDING — must
  be supplied by Predictive AI's finance team before public production
  cutover**. Both fields default to `PENDING_FINANCE_CONFIRMATION` in
  `config/invoice-issuers.js`, which the catalog gate now flags.

- **PLATFORM_PROMPTPAY_ID** → Defaults to platform's 13-digit tax-ID
  `0105568045932`. Override only if a different PromptPay account is
  used for corporate receipts.

---

## 6. Local dev fallback strategy

Local development uses the `env` backend (default) and reads from
`apps/backend/.env`. Each catalog entry decides whether a dev fallback is
acceptable:

- `ENCRYPTION_KEY` — only `NODE_ENV=test` has a fallback
  (`test-only-encryption-key-32-bytes-exactly-here!`). For `NODE_ENV=development`
  the operator MUST set a real value, otherwise `getSecret` throws.
  Rationale: data encrypted under a transient dev key cannot be read by
  the next dev who joins.

- `RSA_PRIVATE_KEY_PASSPHRASE` — dev/test fallback
  `dev-rsa-passphrase-<pid>-<timestamp>`, memoized for the process lifetime
  so encrypt/sign cycles round-trip correctly.

- `HEALTH_JWT_SECRET`, `PROVIDER_JWT_SECRET` — dev/test fallback
  `dev-{role}-secret-<pid>-<timestamp>`. Tokens minted with these don't
  cross process boundaries — restart = full re-login (acceptable for dev).

- `HMAC_KEY` — test fallback only; dev developers must set their own.

All fallbacks are warned via `process.stderr` exactly once per name per
process (see `_warnOnce`).

---

## 7. Touched files (Iter 27)

- `apps/backend/config/secrets.js` — catalog extended with bank-account
  entries; added `validateSecretsForEnvironment`, `getSecretAsync`,
  `getActiveBackend`, `SUPPORTED_BACKENDS`, `PENDING_SENTINEL`, and
  vault/aws/azure backend stubs.
- `apps/backend/scripts/check-secrets.js` — NEW CLI; exit 1 on failure.
- `apps/backend/__tests__/unit/secrets-catalog.test.js` — NEW; 20 tests.
- `docs/security/secrets-catalog-2026-05-16.md` — this file.

## 8. Out of scope (Iter 27)

- Wiring `validateSecretsForEnvironment` into `server.js` boot path —
  deferred (could break local dev unless Finance/Ops complete provisioning
  first).
- Real Vault / AWS / Azure backend implementations — explicitly stubbed.
- Frontend secrets (`NEXT_PUBLIC_*`) — handled in the frontend repo.
- Iter-23 to Iter-26 services and the Prisma schema — out of territory.
