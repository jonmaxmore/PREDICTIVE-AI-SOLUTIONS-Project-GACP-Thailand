/**
 * Iter 29 — deploy harness contract tests for check-secrets.js
 *
 * The Iter 29 deploy-prod.sh / .ps1 scripts treat `check-secrets.js`'s exit
 * code as the source of truth for pre-deploy gate readiness. This suite
 * pins that contract by spawning the script as a child process — the unit
 * tests in secrets-catalog.test.js already cover the in-process behaviour,
 * but the harness only ever sees the exit code from a subprocess, so we
 * test that surface too.
 *
 * Contract under test:
 *   exit 0  → all production-required secrets present + meet minLength
 *   exit 1  → at least one secret MISSING_OR_PENDING or TOO_SHORT
 *   exit 2  → internal error (not exercised here — would require a script bug)
 */

const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'check-secrets.js');

const PRODUCTION_REQUIRED_KEYS = [
    'HEALTH_JWT_SECRET',
    'PROVIDER_JWT_SECRET',
    'ENCRYPTION_KEY',
    'MASTER_ENCRYPTION_KEY',
    'HMAC_KEY',
    'SESSION_SECRET',
    'DATABASE_URL',
    'REDIS_URL',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'PAYMENT_WEBHOOK_SECRET',
    'RSA_PRIVATE_KEY_PASSPHRASE',
    'PLATFORM_BANK_ACCOUNT_NO',
    'PLATFORM_BANK_NAME',
    // NOTE: Iter R2-A's notification-transport secrets (EMAIL_SMTP_HOST/USER/
    // PASS, THAIBULKSMS_API_KEY/API_SECRET) were removed from this list
    // 2026-08-19 (external-services cleanup Task 3) — their catalog rows are
    // gone along with the E3/S2 stacks that consumed them.
    // NOTE: SENTRY_DSN is catalogued (re-added 2026-10-02) but optional — an
    // unset DSN means error tracking is off, so it is not production-required
    // and does not belong in this list.
];

/**
 * Build a fully-wiped env where every production-required secret is absent,
 * starting from a copy of `process.env` so the child process still inherits
 * PATH / NODE_PATH / etc.
 */
function envWithSecretsWiped(extra = {}) {
    const env = { ...process.env };
    for (const key of PRODUCTION_REQUIRED_KEYS) {
        delete env[key];
    }
    // Strip aliases that the catalog accepts as fallbacks.
    delete env.JWT_SECRET;
    return { ...env, ...extra };
}

function buildValidProductionEnv(extra = {}) {
    const long = 'x'.repeat(40);
    return envWithSecretsWiped({
        HEALTH_JWT_SECRET: long,
        PROVIDER_JWT_SECRET: long,
        ENCRYPTION_KEY: long,
        MASTER_ENCRYPTION_KEY: long,
        HMAC_KEY: long,
        SESSION_SECRET: long,
        DATABASE_URL: 'postgres://u:p@h:5432/db',
        REDIS_URL: 'redis://r:6379',
        S3_ACCESS_KEY: 'AKIA-abc',
        S3_SECRET_KEY: 'secret-xyz-very-long-enough-padding',
        PAYMENT_WEBHOOK_SECRET: 'webhook-secret-very-long-enough-padding',
        RSA_PRIVATE_KEY_PASSPHRASE: 'rsa-passphrase-very-long-1-padding',
        PLATFORM_BANK_ACCOUNT_NO: '123-4-56789-0',
        PLATFORM_BANK_NAME: 'ธนาคารทดสอบ สาขาทดสอบ',
        // No error-tracking DSN is set here — the catalog no longer has one
        // (removed 2026-07-25 with shared/production-logger.js), so the
        // happy path proves production boots without any foreign telemetry.
        ...extra,
    });
}

function runCheckSecrets(env) {
    return spawnSync(process.execPath, [SCRIPT_PATH, '--env=production'], {
        env,
        encoding: 'utf8',
    });
}

describe('[Iter 29] deploy-prod harness — check-secrets.js exit-code contract', () => {
    it('exits 1 when production-required secrets are missing', () => {
        const result = runCheckSecrets(envWithSecretsWiped());
        expect(result.status).toBe(1);
        // The human-readable output should name at least one missing secret
        // so the deploy operator can act without re-running with --json.
        expect(result.stdout).toMatch(/MISSING_OR_PENDING|TOO_SHORT/);
        expect(result.stdout).toMatch(/FAIL/);
    });

    it('exits 1 when a required secret is set but too short', () => {
        const env = buildValidProductionEnv({
            // Replace one valid value with a deliberately too-short one.
            ENCRYPTION_KEY: 'short',
        });
        const result = runCheckSecrets(env);
        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/TOO_SHORT/);
        expect(result.stdout).toMatch(/ENCRYPTION_KEY/);
    });

    it('exits 1 when a required secret holds the PENDING_FINANCE_CONFIRMATION sentinel', () => {
        const env = buildValidProductionEnv({
            PLATFORM_BANK_ACCOUNT_NO: 'PENDING_FINANCE_CONFIRMATION',
        });
        const result = runCheckSecrets(env);
        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/PLATFORM_BANK_ACCOUNT_NO/);
        expect(result.stdout).toMatch(/MISSING_OR_PENDING/);
    });

    it('exits 0 when all production-required secrets are present and meet minLength', () => {
        const env = buildValidProductionEnv();
        const result = runCheckSecrets(env);
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/OK/);
    });

    it('emits JSON when --json is passed and still exits non-zero on failure', () => {
        const env = envWithSecretsWiped();
        const result = spawnSync(process.execPath, [SCRIPT_PATH, '--env=production', '--json'], {
            env,
            encoding: 'utf8',
        });
        expect(result.status).toBe(1);
        let parsed;
        expect(() => { parsed = JSON.parse(result.stdout); }).not.toThrow();
        expect(parsed.ok).toBe(false);
        expect(parsed.env).toBe('production');
        expect(Array.isArray(parsed.errors)).toBe(true);
        expect(parsed.errors.length).toBeGreaterThan(0);
    });
});
