/**
 * W2-C — Production-secret-sentinel boot guard unit tests
 *
 * Exercises `apps/backend/config/boot-secret-guard.js` against the SECRETS_CATALOG
 * in `apps/backend/config/secrets.js`. The guard's contract is:
 *
 *   - production + at least one MISSING_OR_PENDING / TOO_SHORT secret → exit(1)
 *     with Thai + English messages on stderr, including the offending var name.
 *   - production + all required secrets present and well-formed → no exit.
 *   - development / test / any other NODE_ENV → silent no-op (no exit, no I/O
 *     fatal write).
 *
 * The guard delegates to `validateSecretsForEnvironment` from `config/secrets.js`
 * which reads from `process.env` (not the dev/test fallback path) so the test
 * sets `process.env` directly. The guard accepts explicit `env`, `exit`, and
 * `stderr` injection points to keep tests deterministic — we never let the
 * real `process.exit` run.
 *
 * @see docs/handoffs/iter-W2/00-rfc.md §W2-C
 */

'use strict';

const path = require('path');

// Load fresh module under test (no caching surprises across describe blocks).
const guardPath = path.join('..', '..', 'config', 'boot-secret-guard');
function loadGuard() {
    delete require.cache[require.resolve(guardPath)];
    return require(guardPath);
}

// Build a fake stderr stream that captures writes for assertion.
function makeStderr() {
    const buf = [];
    return {
        write: (chunk) => { buf.push(String(chunk)); return true; },
        toString: () => buf.join(''),
        chunks: buf,
    };
}

// Build an env object that satisfies every `required: 'production'` entry in
// SECRETS_CATALOG with realistic, long-enough values. This is the "all secrets
// valid" baseline; individual tests then override single keys to simulate
// sentinel / missing / too-short scenarios.
//
// NOTE: We do NOT touch the catalog — values mirror the catalog's
// `required: 'production'` membership at the time of writing. If a future
// iteration extends the catalog (per I-014), this helper would need to be
// kept in sync; today's W2-C scope is the existing catalog only.
function buildValidProductionEnv(extra) {
    const long = 'x'.repeat(40);
    const env = {
        NODE_ENV: 'production',
        // crypto + signing
        HEALTH_JWT_SECRET: long,
        PROVIDER_JWT_SECRET: long,
        ENCRYPTION_KEY: long,
        MASTER_ENCRYPTION_KEY: long,
        HMAC_KEY: long,
        SESSION_SECRET: long,
        RSA_PRIVATE_KEY_PASSPHRASE: 'rsa-passphrase-very-long-1-padding',
        PAYMENT_WEBHOOK_SECRET: 'webhook-secret-very-long-enough-padding',
        // infrastructure
        DATABASE_URL: 'postgres://u:p@h:5432/db',
        REDIS_URL: 'redis://r:6379',
        S3_ACCESS_KEY: 'AKIA-abc',
        S3_SECRET_KEY: 'secret-xyz-very-long-enough-padding',
        // invoice / bank-account (Iter 27)
        PLATFORM_BANK_ACCOUNT_NO: '123-4-56789-0',
        PLATFORM_BANK_NAME: 'ธนาคารทดสอบ สาขาทดสอบ',
        // NOTE: Iter R2-A's notification-transport secrets (EMAIL_SMTP_HOST/
        // USER/PASS, THAIBULKSMS_API_KEY/API_SECRET) were removed from this
        // baseline 2026-08-19 (external-services cleanup Task 3) — their
        // catalog rows are gone along with the E3/S2 stacks that consumed
        // them, so production boot no longer gates on them.
        // No error-tracking DSN is set: SENTRY_DSN is catalogued (re-added
        // 2026-10-02) but optional — unset means error tracking is off — so
        // the boot guard does not gate on it and the happy path passes without it.
    };
    return Object.assign(env, extra || {});
}

describe('[W2-C] validateProductionSecretsAtBoot — boot-time secret sentinel guard', () => {
    let originalEnv;
    let exitSpy;

    beforeEach(() => {
        originalEnv = process.env;
        // Use a clean env so the guard can't accidentally read host process
        // env vars (DATABASE_URL etc.) that the test isn't controlling.
        process.env = { NODE_ENV: 'test' };
        exitSpy = jest.fn();
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    it('does NOT exit in production when all production-required secrets are valid', () => {
        const guard = loadGuard();
        const stderr = makeStderr();
        const env = buildValidProductionEnv();
        // The guard reads NODE_ENV from its `env` option but
        // `validateSecretsForEnvironment` reads SECRETS_CATALOG values from
        // process.env, so we mirror env into process.env for the duration of
        // the call.
        process.env = env;
        const result = guard.validateProductionSecretsAtBoot({
            env,
            exit: exitSpy,
            stderr,
        });
        expect(exitSpy).not.toHaveBeenCalled();
        expect(result.ok).toBe(true);
        expect(result.skipped).toBe(false);
        expect(result.errors).toEqual([]);
    });

    it('does NOT exit when ALLOW_PENDING_SECRETS=true despite pending secrets (controlled-pilot bypass)', () => {
        const guard = loadGuard();
        const stderr = makeStderr();
        const env = buildValidProductionEnv({
            PLATFORM_BANK_ACCOUNT_NO: 'PENDING_FINANCE_CONFIRMATION',
            ALLOW_PENDING_SECRETS: 'true',
        });
        process.env = env;
        const result = guard.validateProductionSecretsAtBoot({ env, exit: exitSpy, stderr });
        expect(exitSpy).not.toHaveBeenCalled();
        expect(result.bypassed).toBe(true);
        expect(result.errors.length).toBeGreaterThan(0);
        const out = stderr.toString();
        // Loud, searchable bypass banner + still names the offending secret(s).
        expect(out).toMatch(/PENDING_SECRETS_BYPASS_ACTIVE/);
        expect(out).toMatch(/PLATFORM_BANK_ACCOUNT_NO/);
    });

    it('STILL exits 1 when ALLOW_PENDING_SECRETS is not exactly "true" (e.g. "1")', () => {
        const guard = loadGuard();
        const stderr = makeStderr();
        const env = buildValidProductionEnv({
            PLATFORM_BANK_ACCOUNT_NO: 'PENDING_FINANCE_CONFIRMATION',
            ALLOW_PENDING_SECRETS: '1',
        });
        process.env = env;
        guard.validateProductionSecretsAtBoot({ env, exit: exitSpy, stderr });
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits 1 in production when PLATFORM_BANK_ACCOUNT_NO holds the PENDING_FINANCE_CONFIRMATION sentinel', () => {
        const guard = loadGuard();
        const stderr = makeStderr();
        const env = buildValidProductionEnv({
            PLATFORM_BANK_ACCOUNT_NO: 'PENDING_FINANCE_CONFIRMATION',
        });
        process.env = env;
        guard.validateProductionSecretsAtBoot({
            env,
            exit: exitSpy,
            stderr,
        });
        expect(exitSpy).toHaveBeenCalledWith(1);
        const out = stderr.toString();
        expect(out).toMatch(/OPERATOR_INTERVENTION_REQUIRED/);
        expect(out).toMatch(/PLATFORM_BANK_ACCOUNT_NO/);
        // Thai marker must be present so log search finds either locale.
        expect(out).toMatch(/ต้องดำเนินการโดยผู้ดูแลระบบ/);
        // Reason must surface in the diagnostic.
        expect(out).toMatch(/MISSING_OR_PENDING/);
    });

    it('exits 1 in production when PLATFORM_BANK_ACCOUNT_NO is missing entirely', () => {
        const guard = loadGuard();
        const stderr = makeStderr();
        const env = buildValidProductionEnv();
        delete env.PLATFORM_BANK_ACCOUNT_NO;
        process.env = env;
        guard.validateProductionSecretsAtBoot({
            env,
            exit: exitSpy,
            stderr,
        });
        expect(exitSpy).toHaveBeenCalledWith(1);
        const out = stderr.toString();
        expect(out).toMatch(/PLATFORM_BANK_ACCOUNT_NO/);
        expect(out).toMatch(/MISSING_OR_PENDING/);
    });

    it('exits 1 in production when a required secret is shorter than minLength (TOO_SHORT)', () => {
        const guard = loadGuard();
        const stderr = makeStderr();
        // ENCRYPTION_KEY has minLength=32 — give it a 5-char value to trigger.
        const env = buildValidProductionEnv({
            ENCRYPTION_KEY: 'short',
        });
        process.env = env;
        guard.validateProductionSecretsAtBoot({
            env,
            exit: exitSpy,
            stderr,
        });
        expect(exitSpy).toHaveBeenCalledWith(1);
        const out = stderr.toString();
        expect(out).toMatch(/TOO_SHORT/);
        expect(out).toMatch(/ENCRYPTION_KEY/);
        // The min-length number should be surfaced for the operator.
        expect(out).toMatch(/32/);
    });

    it('does NOT exit in development when sentinel value is present (skip path)', () => {
        const guard = loadGuard();
        const stderr = makeStderr();
        const env = {
            NODE_ENV: 'development',
            PLATFORM_BANK_ACCOUNT_NO: 'PENDING_FINANCE_CONFIRMATION',
        };
        process.env = env;
        const result = guard.validateProductionSecretsAtBoot({
            env,
            exit: exitSpy,
            stderr,
        });
        expect(exitSpy).not.toHaveBeenCalled();
        expect(result.skipped).toBe(true);
        // Silent no-op: stderr should be untouched.
        expect(stderr.toString()).toBe('');
    });

    it('does NOT exit in test mode when sentinel value is present (skip path)', () => {
        const guard = loadGuard();
        const stderr = makeStderr();
        const env = {
            NODE_ENV: 'test',
            PLATFORM_BANK_ACCOUNT_NO: 'PENDING_FINANCE_CONFIRMATION',
        };
        process.env = env;
        const result = guard.validateProductionSecretsAtBoot({
            env,
            exit: exitSpy,
            stderr,
        });
        expect(exitSpy).not.toHaveBeenCalled();
        expect(result.skipped).toBe(true);
        expect(stderr.toString()).toBe('');
    });

    it('emits BOTH Thai and English actionable messages on production failure', () => {
        const guard = loadGuard();
        const stderr = makeStderr();
        const env = buildValidProductionEnv({
            PLATFORM_BANK_ACCOUNT_NO: 'PENDING_FINANCE_CONFIRMATION',
        });
        process.env = env;
        guard.validateProductionSecretsAtBoot({
            env,
            exit: exitSpy,
            stderr,
        });
        const out = stderr.toString();
        // English message + action present
        expect(out).toMatch(/EN: PLATFORM_BANK_ACCOUNT_NO is missing or holds the sentinel/);
        expect(out).toMatch(/Action: set PLATFORM_BANK_ACCOUNT_NO via the secret manager/);
        // Thai message + action present
        expect(out).toMatch(/TH: ตัวแปร PLATFORM_BANK_ACCOUNT_NO/);
        expect(out).toMatch(/Action \(TH\): กำหนดค่า PLATFORM_BANK_ACCOUNT_NO ผ่าน secret manager/);
        // Runbook reference must be present so operators know where to look.
        expect(out).toMatch(/docs\/operations\/cutover-checklist-2026-05-17\.md/);
    });

    it('reports every offending secret in a single boot pass (multi-error aggregation)', () => {
        const guard = loadGuard();
        const stderr = makeStderr();
        const env = buildValidProductionEnv({
            PLATFORM_BANK_ACCOUNT_NO: 'PENDING_FINANCE_CONFIRMATION',
            PLATFORM_BANK_NAME: 'PENDING_FINANCE_CONFIRMATION',
            HMAC_KEY: 'too-short',
        });
        process.env = env;
        guard.validateProductionSecretsAtBoot({
            env,
            exit: exitSpy,
            stderr,
        });
        expect(exitSpy).toHaveBeenCalledWith(1);
        const out = stderr.toString();
        // All three names should be surfaced (one boot pass, not 3 reboots).
        expect(out).toMatch(/PLATFORM_BANK_ACCOUNT_NO/);
        expect(out).toMatch(/PLATFORM_BANK_NAME/);
        expect(out).toMatch(/HMAC_KEY/);
        // Both reason codes should appear.
        expect(out).toMatch(/MISSING_OR_PENDING/);
        expect(out).toMatch(/TOO_SHORT/);
    });
});
