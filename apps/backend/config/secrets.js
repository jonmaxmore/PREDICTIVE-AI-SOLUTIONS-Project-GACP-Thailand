/**
 * Unified Secret Manager
 *
 * Single source of truth for reading sensitive credentials in the GACP backend.
 * Replaces ad-hoc `process.env.X || 'fallback'` patterns throughout the codebase.
 *
 * Sprint 3 (2026-05-15): Created in response to security audit findings:
 *   - CRITICAL: silent dev-key fallback in field-encryption.js
 *   - CRITICAL: auto-generated keys in security-compliance.js (data loss on restart)
 *   - CRITICAL: NEXT_PUBLIC_JWT_SECRET exposure path
 *   - HIGH: token-rotation.js bypasses jwt-security.js
 *
 * Iter 27 (2026-05-16): Extended with:
 *   - Pluggable backend skeletons (`vault`, `aws`, `azure`) — currently stubs
 *     that throw so production deploys must install the right SDK and flip
 *     `SECRET_BACKEND` deliberately. The existing `env` and `file` backends
 *     remain the only working transports.
 *   - `validateSecretsForEnvironment()` — fail-closed startup gate that
 *     surfaces MISSING_OR_PENDING / TOO_SHORT issues for production-required
 *     secrets, including the `PENDING_FINANCE_CONFIRMATION` sentinel used by
 *     `config/invoice-issuers.js`.
 *   - `bankAccount`-flavored catalog entries (DTAM_BANK_ACCOUNT_NO,
 *     PLATFORM_BANK_ACCOUNT_NO, etc.) so the readiness check covers the
 *     two-money-flow inputs too.
 *
 * Architecture (DTAM-agnostic):
 * - Default backend: `env` (read from process.env)
 * - `file` backend reads from `/run/secrets/<NAME>` (Docker secrets style)
 * - `vault` / `aws` / `azure` are documented stubs — they throw at first use
 *   so production wiring is an explicit deploy-time decision (install SDK +
 *   flip env). Switching backend is intentionally NOT silent.
 *
 * Hard rules:
 * 1. Required secrets THROW in production if missing (no silent fallback)
 * 2. Dev-only fallbacks ONLY allowed when NODE_ENV is 'development' or 'test'
 *    AND the dev fallback is logged as a warning
 * 3. No auto-generated keys for cryptographic material (encryption, HMAC)
 * 4. Aliases (legacy names) supported via explicit `aliases` config
 * 5. `PENDING_FINANCE_CONFIRMATION` is treated as MISSING for validation
 *    purposes (production must fail closed when a sentinel slipped through).
 *
 * @module config/secrets
 */

const fs = require('fs');
const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const IS_DEV = NODE_ENV === 'development';
const IS_TEST = NODE_ENV === 'test';
const SECRET_BACKEND = (process.env.SECRET_BACKEND || 'env').toLowerCase();

// Track which secrets have already been warned about (avoid log spam)
const _warnedKeys = new Set();

// Cache resolved dev/test fallbacks per secret name so they are stable for the
// lifetime of the process. Without this, factories like
// `() => \`dev-...-${Date.now()}\`` would return a different value on every call
// — e.g. signature-service would encrypt a private key with passphrase A on
// generate and then try to decrypt it with passphrase B on sign, causing
// OpenSSL "bad decrypt". Memoizing here keeps the dev-fallback ergonomics
// (process-namespaced, never inlined) without breaking stable-passphrase
// consumers.
const _devFallbackCache = new Map();

/**
 * Canonical secret definitions.
 * Each entry declares: name, aliases (legacy names), required flag, devFallback, description.
 *
 * `required: 'production'` means: throw in production, allow missing in dev (with devFallback if set)
 * `required: 'always'` means: throw in any environment
 * `required: false` means: optional, return null if not set
 */
const SECRETS_CATALOG = Object.freeze({
    // ────────── JWT signing ──────────
    HEALTH_JWT_SECRET: {
        aliases: ['JWT_SECRET'],
        required: 'production',
        minLength: 32,
        description: 'HMAC-HS256 signing key for health (applicant) user JWTs',
        devFallback: () => `dev-health-secret-${process.pid}-${Date.now()}`,
    },
    PROVIDER_JWT_SECRET: {
        aliases: ['DTAM_JWT_SECRET'],
        required: 'production',
        minLength: 32,
        description: 'HMAC-HS256 signing key for provider/DTAM staff JWTs',
        devFallback: () => `dev-provider-secret-${process.pid}-${Date.now()}`,
    },
    REFRESH_TOKEN_SECRET: {
        aliases: ['JWT_REFRESH_SECRET'],
        required: false,  // Falls back to HEALTH_JWT_SECRET
        minLength: 32,
        description: 'HMAC signing key for refresh tokens (optional — falls back to HEALTH_JWT_SECRET)',
    },

    // ────────── Encryption keys (CRITICAL — affects data integrity) ──────────
    ENCRYPTION_KEY: {
        aliases: [],
        required: 'always',  // Hard required — encrypted PII cannot be decrypted without this
        minLength: 32,
        description: 'AES-256 master encryption key for PII (Thai ID, personal data)',
        sensitive: true,
        usedIn: ['utils/field-encryption.js', 'shared/encryption.js'],
        devFallback: NODE_ENV === 'test'
            ? () => 'test-only-encryption-key-32-bytes-exactly-here!'
            : null,  // No dev fallback for dev mode — force operators to set it
    },
    MASTER_ENCRYPTION_KEY: {
        aliases: ['ENCRYPTION_KEY'],  // Falls back to ENCRYPTION_KEY
        required: 'production',
        minLength: 32,
        description: 'Master AES-256 key used by EncryptionService (security-compliance.js)',
    },
    HMAC_KEY: {
        aliases: [],
        required: 'production',
        minLength: 32,
        description: 'HMAC signing key for data integrity / audit signatures',
        devFallback: NODE_ENV === 'test'
            ? () => 'test-only-hmac-key-32-bytes-exactly-here-okay'
            : null,
    },

    // ────────── Signed-URL signing (W1-2, 2026-08-21) ──────────
    // HMAC key behind the short-lived `/uploads` signed URLs that let a browser
    // <img>/download fetch a private file WITHOUT an Authorization header
    // (services/storage-service.js createSignedObjectUrl / verifySignedObjectRequest).
    //
    // `required: false` ON PURPOSE — it aliases HMAC_KEY, which is already
    // `required: 'production'`, so a production deploy that satisfies HMAC_KEY
    // satisfies this too. Adding a NEW production-required row would move the
    // boot gate for every operator with no security gain. storage-service
    // domain-separates before use (HMAC(raw, 'gacp:uploads-signed-url:v1')) so a
    // URL signature can never be replayed into another HMAC_KEY domain, and it
    // FAILS LOUD (SIGNED_URL_KEY_UNAVAILABLE) rather than signing with a
    // constant when nothing resolves.
    UPLOADS_URL_SIGNING_SECRET: {
        aliases: ['HMAC_KEY'],
        required: false,
        minLength: 32,
        description: 'HMAC key for short-lived /uploads signed download URLs (falls back to HMAC_KEY)',
        sensitive: true,
        usedIn: ['services/storage-service.js'],
        // Dev AND test both get a fallback: without one, local development has
        // no signing key at all (HMAC_KEY only ships a test fallback) and every
        // private image would stay broken on a dev box. Process-namespaced and
        // memoized by _devFallbackCache, so it is stable for the life of the
        // process and can never collide with a real deployed key. A backend
        // restart invalidates outstanding signatures, which is harmless at a
        // 5-minute TTL.
        devFallback: () => `dev-uploads-url-signing-${process.pid}-${Date.now()}-${'x'.repeat(16)}`,
    },

    // ────────── Session / OAuth ──────────
    SESSION_SECRET: {
        aliases: [],
        required: 'production',
        minLength: 32,
        description: 'Session signing secret (cookies, OAuth state)',
    },
    // ────────── Database ──────────
    DATABASE_URL: {
        aliases: [],
        required: 'production',  // Set explicitly in dev/test via .env or CI env
        description: 'PostgreSQL connection string with embedded credentials',
    },

    // ────────── Redis ──────────
    REDIS_URL: {
        aliases: [],
        required: 'production',
        description: 'Redis connection string (for Bull queues + cache)',
    },
    REDIS_PASSWORD: {
        aliases: [],
        required: false,
        description: 'Redis password (when not embedded in REDIS_URL)',
    },

    // ────────── Object Storage (MinIO / S3) ──────────
    S3_ACCESS_KEY: {
        aliases: ['MINIO_ACCESS_KEY'],
        required: 'production',
        description: 'S3/MinIO access key ID for object storage',
    },
    S3_SECRET_KEY: {
        aliases: ['MINIO_SECRET_KEY'],
        required: 'production',
        description: 'S3/MinIO secret access key',
    },

    // Ksher payment-gateway secrets (KSHER_APP_ID / KSHER_PRIVATE_KEY) were
    // removed 2026-06-04 — the gateway was retired for the slip-upload flow and
    // these vars had no readers. PAYMENT_WEBHOOK_SECRET stays (inbound webhook HMAC).
    PAYMENT_WEBHOOK_SECRET: {
        aliases: [],
        required: 'production',
        minLength: 16,
        description: 'HMAC secret for verifying inbound payment webhooks',
    },

    // ────────── External Services ──────────
    // REMOVED 2026-09-16: SMTP_PASSWORD (optional, no reader since the email
    // service was deleted 2026-09-15; operator: no email and no forgot-password
    // by email or SMS in the system).
    // REMOVED 2026-08-19 (external-services cleanup Task 3): legacy
    // SMS_API_KEY row. Its only consumer, services/sms/sms-service.js (S1),
    // is deleted — see the notification-transport removal note below for
    // the fuller rationale.
    // REMOVED 2026-07-25: LINE_NOTIFY_TOKEN. Its only consumer,
    // services/notification/line-notify-service.js, was deleted; LINE Notify
    // was retired upstream in 2025, and the revision notice it carried is
    // delivered by the in-app Notification row.

    // ────────── Error tracking (Sentry) ──────────
    // Re-added 2026-10-02 by operator decision, with PII scrubbing
    // (packages/error-reporting/src/scrub.js). Optional: unset = off, and the
    // SDK is never loaded. A DSN is an ingest-only key — it can send events to
    // the project, not read them — so it is not sensitive, but it is still
    // deploy configuration: it lives in the env file, never in the repository.
    // config/sentry.js reads it (with SENTRY_ENVIRONMENT and
    // SENTRY_TRACES_SAMPLE_RATE) directly, like every other config/ reader.
    SENTRY_DSN: {
        aliases: [],
        required: false,
        description: 'Sentry DSN of the backend project (ingest-only). Unset = error tracking off. Runbook: docs/operations/sentry-error-tracking.md',
        sensitive: false,
        usedIn: ['config/sentry.js'],
    },

    // ────────── Document signing (RSA private key passphrase) ──────────
    // Used by services/crypto/signature-service.js to decrypt the RSA private key
    // that signs GACP certificates and tax invoices. A leak or static fallback would
    // allow an attacker who exfiltrates the encrypted private key file to forge
    // legally-binding signed PDFs, so a default value is NEVER acceptable in production.
    RSA_PRIVATE_KEY_PASSPHRASE: {
        aliases: ['KEY_PASSPHRASE'],
        required: 'production',
        minLength: 16,
        description: 'AES-256-CBC passphrase that protects the RSA private key used to sign certificates and tax invoices',
        sensitive: true,
        usedIn: ['services/crypto/signature-service.js'],
        // Dev/test fallback exists only for local development of signing flows, and it
        // must be STABLE ACROSS PROCESSES. That is not a preference; it is the difference
        // between a working dev box and one that destroys its own certificates.
        //
        // This used to read `dev-rsa-passphrase-${process.pid}-${Date.now()}`, namespaced
        // that way so it "cannot collide with a real key". The intent was sound and the
        // consequence was fatal: a passphrase protects something WRITTEN TO DISK, so the
        // next process has to be able to reproduce it. With the pid and the clock in it,
        // no two processes ever agreed. Process A generated keys/private.pem under its
        // passphrase; process B read the same file with a different one and got
        // `bad decrypt` — every time, with no exception — and the old ensureLocalKeys
        // treated that as permission to generate a replacement, silently invalidating
        // every certificate A had signed.
        //
        // That is the whole 2026-08-26 incident, and the three signature-NULL rows found
        // on 2026-08-22 before it. It was never a race or bad luck: the loop ran on every
        // single boot, because the fallback guaranteed a mismatch by construction.
        //
        // The stable value lives in the key directory beside the key it protects — one
        // file, generated once per box, 32 random bytes, gitignored with the keys. Not a
        // constant in this repo: a committed passphrase would be a real secret with a
        // public value, and the comment above is right that a static fallback is never
        // acceptable. Not derived from the hostname or the path either — those are
        // guessable. Per box, random, persisted, and only ever reachable when NODE_ENV is
        // development or test, which the secrets layer enforces rather than the callers.
        devFallback: () => require('./dev-signing-passphrase').readOrCreateDevPassphrase(),
    },

    // ────────── Signing-key integrity (Ruling 2, 2026-08-22) ──────────
    // None of these is a secret in the cryptographic sense — a fingerprint is a
    // hash of a PUBLIC key and the flag is a boolean. They are catalogued here
    // so the signing-key policy resolves them through the SAME layer as the
    // passphrase: one lookup path, alias support, and no direct `process.env`
    // read inside services/ (which the env-direct ratchet counts).
    //
    // Not secret, but they ARE the trust anchor: together they answer "is this
    // public key ours?" for a key pinned on a certificate row. Anyone who can
    // change these values can make the verifier trust a key of their choosing,
    // so they belong to the deploy configuration, never to request data.
    REQUIRE_SIGNING_KEY: {
        required: false,
        description: 'Set to "true" to make a missing or unusable certificate signing key a FATAL boot error outside production (production is always fatal)',
        sensitive: false,
        usedIn: ['config/signing-key-policy.js'],
    },
    SIGNING_KEY_FINGERPRINT: {
        required: false,
        description: 'Expected sha256 hex of the certificate signing PUBLIC key (PEM). When set, a loaded key whose fingerprint differs refuses to boot',
        sensitive: false,
        usedIn: ['config/signing-key-policy.js'],
    },
    SIGNING_KEY_RETIRED_FINGERPRINTS: {
        required: false,
        description: 'Comma-separated sha256 hex fingerprints of PREVIOUS certificate signing public keys, kept trusted so certificates they already signed keep verifying after rotation',
        sensitive: false,
        usedIn: ['config/signing-key-policy.js'],
    },

    // ────────── Invoice issuer / bank-account inputs (B16-C, Iter 27) ──────────
    // These are NOT cryptographic secrets — they're identity + bank-routing
    // configuration consumed by config/invoice-issuers.js. They are catalogued
    // here so the startup readiness check can surface PENDING sentinels and
    // the deploy team has a single place to see "what must Finance fill in?".
    //
    // sensitive: false — these values appear on customer-facing receipts and
    // are therefore not secret in the cryptographic sense. They are still
    // production-required because a missing or PENDING value renders an
    // unusable receipt.
    DTAM_BANK_ACCOUNT_NO: {
        aliases: [],
        required: false, // Has documented public default (4750134376)
        description: 'กรมบัญชีกลาง bank account number for state-fee receipts (DTAM revenue)',
        sensitive: false,
        defaultDev: '4750134376', // documented public number — safe to bake
        usedIn: ['config/invoice-issuers.js'],
    },
    PLATFORM_BANK_ACCOUNT_NO: {
        aliases: [],
        required: 'production',
        description: 'Predictive AI Solution corporate bank account for platform-fee receipts',
        sensitive: false,
        usedIn: ['config/invoice-issuers.js'],
    },
    PLATFORM_BANK_NAME: {
        aliases: [],
        required: 'production',
        description: 'Bank + branch where the platform corporate account lives',
        sensitive: false,
        usedIn: ['config/invoice-issuers.js'],
    },
    PLATFORM_PROMPTPAY_ID: {
        aliases: [],
        required: false, // Defaults to platform tax-ID 0105568045932
        description: 'PromptPay identifier for the platform corporate account (defaults to tax-ID)',
        sensitive: false,
        usedIn: ['config/invoice-issuers.js'],
    },

    // REMOVED 2026-08-19 (external-services cleanup Task 3, spec:
    // design note 2026-08-19-external-services-cleanup-design):
    // EMAIL_SMTP_HOST/PORT/SECURE/USER/PASS, EMAIL_FROM_NAME/EMAIL_FROM_ADDRESS
    // (Iter R2-A notification-transport — Email) and THAIBULKSMS_API_KEY/
    // API_SECRET/SENDER, SMS_PROVIDER, SMS_HTTP_TIMEOUT_MS (Iter R2-B — SMS).
    // Every consumer is deleted: services/notification/providers/
    // {email,sms}-provider.js and services/notification/transports/
    // {email,sms}-transport.js. The operator decision (2026-08-13,
    // shared/notification-view.js:16-19) made the in-app inbox the only
    // business-notification channel; these secrets no longer gate production
    // boot. E1 (services/email-service.js, transition-only auth email: MFA OTP +
    // password reset) read SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/EMAIL_FROM
    // directly from process.env and was never catalogued here. It was deleted on
    // 2026-09-15 with the email second factor (operator: login is หมอพร้อม/ThaID
    // only, no email in the system), and the last SMTP row went on 2026-09-16.

    // ────────── OpenAPI / Swagger UI mount flag (W4-D, Iter W4) ──────────
    // Controls whether the production server mounts the `/api-docs`
    // swagger-ui-express HTML endpoint and the companion
    // `/api-docs/swagger.json` raw-spec route. Defaults:
    //   dev / test     → ON (operability for builders).
    //   production     → OFF (info-leak hardening; flip to 'true' for
    //                    integrator-support windows only).
    //
    // `required: false` because production deploys MUST NOT block on this
    // flag — the default-off behaviour is the safe path. Per I-014, since
    // this is required:false, the deploy-prod-check-secrets test helper
    // does NOT need updating; only required:'production' entries do.
    OPENAPI_DOCS_ENABLED: {
        aliases: [],
        required: false,
        description: 'When "true", mounts /api-docs swagger-ui + /api-docs/swagger.json in production (default off for info-leak hardening; dev defaults on)',
        sensitive: false,
        defaultDev: 'true',
        defaultProd: 'false',
        usedIn: ['server.js'],
    },
});

/**
 * Sentinel string used by config/invoice-issuers.js for fields awaiting
 * confirmation from Finance/Legal. The secrets layer treats any value equal
 * to this sentinel as "missing" for validation purposes — production must
 * fail closed if a PENDING value slips through (e.g., ops forgot to set the
 * platform bank-account number before going live).
 */
const PENDING_SENTINEL = 'PENDING_FINANCE_CONFIRMATION';

/**
 * Set of known SECRET_BACKEND values. Adding a new backend means:
 *   1. add its identifier here,
 *   2. add a case in `_readFromBackend`,
 *   3. install the SDK + wire credentials in the deploy environment.
 */
const SUPPORTED_BACKENDS = Object.freeze(['env', 'file', 'vault', 'aws', 'azure']);

/**
 * Internal: read raw value from configured backend.
 *
 * `env` and `file` are real transports. `vault` / `aws` / `azure` are
 * deliberate stubs — they throw a descriptive error so production deploys
 * cannot accidentally flip `SECRET_BACKEND` without first installing the
 * matching SDK and finishing the wiring. This keeps the abstraction safe by
 * default: the only way a new backend goes live is an explicit code change.
 */
function _readFromBackend(name) {
    switch (SECRET_BACKEND) {
        case 'file': {
            // Docker secrets / DTAM-mounted secret files at /run/secrets/<NAME>
            const secretsDir = process.env.SECRETS_DIR || '/run/secrets';
            const filePath = path.join(secretsDir, name);
            try {
                return fs.readFileSync(filePath, 'utf8').trim();
            } catch (_err) {
                return undefined;
            }
        }
        case 'vault':
            // TODO(iter-27): wire @hashicorp/vault-client.
            throw new Error(
                `[secrets] Vault backend not yet implemented. Install @hashicorp/vault-client and `
                + `replace this stub before setting SECRET_BACKEND=vault. (requested secret: ${name})`,
            );
        case 'aws':
            // TODO(iter-27): wire @aws-sdk/client-secrets-manager.
            throw new Error(
                `[secrets] AWS Secrets Manager backend not yet implemented. Install `
                + `@aws-sdk/client-secrets-manager and replace this stub before setting `
                + `SECRET_BACKEND=aws. (requested secret: ${name})`,
            );
        case 'azure':
            // TODO(iter-27): wire @azure/keyvault-secrets.
            throw new Error(
                `[secrets] Azure Key Vault backend not yet implemented. Install `
                + `@azure/keyvault-secrets and replace this stub before setting `
                + `SECRET_BACKEND=azure. (requested secret: ${name})`,
            );
        case 'env':
            return process.env[name];
        default:
            throw new Error(
                `[secrets] Unknown SECRET_BACKEND "${SECRET_BACKEND}". `
                + `Expected one of: ${SUPPORTED_BACKENDS.join(', ')}.`,
            );
    }
}

/**
 * Resolve a secret value through its primary name + aliases.
 * Returns the first non-empty value found. A value that equals the
 * `PENDING_FINANCE_CONFIRMATION` sentinel is treated as missing so callers
 * cannot accidentally encrypt with a placeholder or print a bogus account
 * number on a customer receipt.
 */
function _resolveValue(catalogEntry, primaryName) {
    const primary = _readFromBackend(primaryName);
    if (primary && primary !== PENDING_SENTINEL) {return primary;}

    for (const alias of catalogEntry.aliases || []) {
        const value = _readFromBackend(alias);
        if (value && value !== PENDING_SENTINEL) {return value;}
    }

    return undefined;
}

function _warnOnce(key, message) {
    if (_warnedKeys.has(key)) {return;}
    _warnedKeys.add(key);
    // Use stderr to avoid polluting stdout streams (e.g., for tests)
    process.stderr.write(`[secrets] ${message}\n`);
}

/**
 * Get a secret by canonical name.
 *
 * @param {string} name - Canonical secret name from SECRETS_CATALOG
 * @returns {string|null} Secret value, or null if not required and not set
 * @throws {Error} if secret is required and not set (per its `required` flag)
 */
function getSecret(name) {
    const entry = SECRETS_CATALOG[name];
    if (!entry) {
        throw new Error(`[secrets] Unknown secret name "${name}". Add it to SECRETS_CATALOG in apps/backend/config/secrets.js.`);
    }

    const value = _resolveValue(entry, name);

    if (value) {
        // Length validation
        if (entry.minLength && value.length < entry.minLength) {
            if (IS_PRODUCTION) {
                throw new Error(
                    `[secrets] CRITICAL: ${name} must be at least ${entry.minLength} chars (got ${value.length}). ${entry.description}`,
                );
            }
            _warnOnce(`${name}-short`, `WARNING: ${name} is shorter than ${entry.minLength} chars (got ${value.length}). Use a longer secret in production.`);
        }
        return value;
    }

    // Missing value — check dev fallback FIRST (test/dev only), then required policy
    //
    // Order matters: a `required: 'always'` secret with a `devFallback` (e.g., ENCRYPTION_KEY
    // for test runs) must use the fallback, not throw. The "always" policy only fires when
    // no fallback exists OR we're in production.
    const requiredPolicy = entry.required;

    if ((IS_DEV || IS_TEST) && typeof entry.devFallback === 'function') {
        _warnOnce(name, `WARNING: Using DEV FALLBACK for ${name}. Set a real value in .env for production-like behavior.`);
        if (!_devFallbackCache.has(name)) {
            _devFallbackCache.set(name, entry.devFallback());
        }
        return _devFallbackCache.get(name);
    }

    // No fallback available — enforce required policy
    if (requiredPolicy === 'always') {
        throw new Error(
            `[secrets] CRITICAL: Required secret ${name} is not set. ${entry.description}`,
        );
    }

    if (requiredPolicy === 'production' && IS_PRODUCTION) {
        throw new Error(
            `[secrets] CRITICAL: ${name} is required in production but not set. ${entry.description}`,
        );
    }

    return null;
}

/**
 * Get a secret, returning null instead of throwing when missing.
 * Use this only when the caller has a documented runtime fallback.
 */
function tryGetSecret(name) {
    try {
        return getSecret(name);
    } catch (_err) {
        return null;
    }
}

/**
 * Validate all required secrets at startup.
 * Call this from server bootstrap before any service uses secrets.
 *
 * In test/dev environments, secrets with a `devFallback` count as satisfied
 * (since `getSecret()` returns the fallback). This avoids false-positive errors
 * during local development and test runs.
 *
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateAllSecrets() {
    const errors = [];
    const warnings = [];
    const useFallback = IS_DEV || IS_TEST;

    for (const [name, entry] of Object.entries(SECRETS_CATALOG)) {
        const value = _resolveValue(entry, name);
        const hasFallback = useFallback && typeof entry.devFallback === 'function';

        if (!value) {
            if (entry.required === 'always') {
                if (hasFallback) {
                    warnings.push(`${name}: missing — using dev/test fallback (would FAIL in production)`);
                } else {
                    errors.push(`${name}: ${entry.description}`);
                }
            } else if (entry.required === 'production' && IS_PRODUCTION) {
                errors.push(`${name}: ${entry.description}`);
            } else if (entry.required === 'production' && !IS_PRODUCTION) {
                if (!hasFallback) {
                    warnings.push(`${name}: not set (required in production)`);
                }
                // Silent in dev when fallback exists
            }
        } else if (entry.minLength && value.length < entry.minLength) {
            if (IS_PRODUCTION) {
                errors.push(`${name}: must be at least ${entry.minLength} chars (got ${value.length})`);
            } else {
                warnings.push(`${name}: shorter than ${entry.minLength} chars (got ${value.length})`);
            }
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        backend: SECRET_BACKEND,
        nodeEnv: NODE_ENV,
    };
}

/**
 * Production-readiness validation gate (Iter 27).
 *
 * Iterates the catalog and returns structured error records for every secret
 * that is required in the target environment but is missing, TOO_SHORT, or
 * holds the `PENDING_FINANCE_CONFIRMATION` sentinel. Designed for a CLI /
 * boot-script that should EXIT 1 when the returned array is non-empty.
 *
 * Difference from `validateAllSecrets()`:
 *   - `validateAllSecrets()` returns errors + warnings + accepts dev fallbacks
 *     as "ok" (used by the running server at boot).
 *   - `validateSecretsForEnvironment()` returns ONLY blocking errors with
 *     machine-readable reasons (MISSING_OR_PENDING / TOO_SHORT) suitable
 *     for CI checks and pre-deploy verification.
 *
 * @param {string} [env] — NODE_ENV value to validate against (defaults to current)
 * @returns {Array<{name: string, reason: string, spec: object}>}
 */
function validateSecretsForEnvironment(env = process.env.NODE_ENV) {
    const errors = [];
    const targetIsProd = env === 'production';

    for (const [name, spec] of Object.entries(SECRETS_CATALOG)) {
        const isRequired = spec.required === 'always'
            || (spec.required === 'production' && targetIsProd);
        if (!isRequired) {continue;}

        // Read directly from process.env (not _resolveValue) so we see the
        // sentinel explicitly — fallbacks are deliberately bypassed because
        // a production deploy must have a real value, not a dev placeholder.
        const rawValue = process.env[name];
        const aliasValue = (spec.aliases || [])
            .map((a) => process.env[a])
            .find((v) => v !== undefined && v !== '');
        const value = rawValue || aliasValue;

        if (!value || value === PENDING_SENTINEL) {
            errors.push({
                name,
                reason: 'MISSING_OR_PENDING',
                spec: _publicSpec(spec),
            });
            continue;
        }
        if (spec.minLength && value.length < spec.minLength) {
            errors.push({
                name,
                reason: 'TOO_SHORT',
                spec: _publicSpec(spec),
                actualLength: value.length,
            });
        }
    }

    return errors;
}

/**
 * Strip non-serializable / sensitive fields from a catalog entry before
 * returning it to a caller (CLI scripts, docs).
 */
function _publicSpec(spec) {
    return {
        description: spec.description,
        required: spec.required,
        minLength: spec.minLength,
        sensitive: spec.sensitive === true,
        usedIn: spec.usedIn || [],
        aliases: spec.aliases || [],
    };
}

/**
 * Async variant of `getSecret` — same semantics, but signals to callers that
 * the implementation MAY block on I/O (Vault / AWS / Azure backends do).
 * Today this just defers to the synchronous `getSecret` because the only
 * working backends (env, file) are synchronous, but new backends should
 * register their async path here without breaking the sync API.
 */
async function getSecretAsync(name) {
    return getSecret(name);
}

/**
 * Inspection helper — return the currently active secret backend.
 * Used by the check-secrets CLI and by tests that need to skip vault stubs.
 */
function getActiveBackend() {
    return SECRET_BACKEND;
}

/**
 * List all secret names in the catalog (for inspection / docs).
 */
function listSecretNames() {
    return Object.keys(SECRETS_CATALOG);
}

/**
 * Get the catalog entry for a secret (for diagnostics).
 */
function getCatalogEntry(name) {
    const entry = SECRETS_CATALOG[name];
    if (!entry) {return null;}
    // Return a shallow copy without exposing devFallback function
    return {
        aliases: entry.aliases,
        required: entry.required,
        minLength: entry.minLength,
        description: entry.description,
        hasDevFallback: typeof entry.devFallback === 'function',
    };
}

module.exports = {
    getSecret,
    getSecretAsync,
    tryGetSecret,
    validateAllSecrets,
    validateSecretsForEnvironment,
    listSecretNames,
    getCatalogEntry,
    getActiveBackend,
    SECRETS_CATALOG: Object.freeze(SECRETS_CATALOG),
    SUPPORTED_BACKENDS,
    PENDING_SENTINEL,
    // Test helper — DO NOT use in production code
    _resetWarnings: () => _warnedKeys.clear(),
};
