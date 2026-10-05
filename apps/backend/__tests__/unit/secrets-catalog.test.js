/**
 * Iter 27 — secrets catalog + backend abstraction tests.
 *
 * Covers:
 *   1. Catalog shape (frozen, contains the Iter-27 additions)
 *   2. getSecret with the `env` backend
 *   3. getSecret throws on unknown secret name
 *   4. PENDING_FINANCE_CONFIRMATION sentinel is treated as missing
 *   5. validateSecretsForEnvironment fail-closed for production-required
 *   6. validateSecretsForEnvironment passes when production env supplies values
 *   7. validateSecretsForEnvironment surfaces TOO_SHORT failures
 *   8. validateSecretsForEnvironment ignores dev/test target environment
 *   9. Backend stubs (vault/aws/azure) throw with a descriptive error
 *  10. Unknown SECRET_BACKEND throws
 *  11. getSecretAsync resolves the same value as getSecret
 *  12. CLI helper (check-secrets.js) formats results human-readable
 */

const path = require('path');

const SECRETS_PATH = path.join(__dirname, '..', '..', 'config', 'secrets');
const CHECK_SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'check-secrets');

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
];

/**
 * Apply env overrides, re-require secrets.js, run the test body, then
 * restore env. Required because `validateSecretsForEnvironment` reads
 * `process.env` live (not at module-load time), so we cannot snapshot the
 * env back before calling it.
 *
 * The pattern is `withEnv({...}, (mod) => { assertions })`.
 */
function withEnv(envOverrides, body) {
    jest.resetModules();
    const allKeys = new Set([
        ...PRODUCTION_REQUIRED_KEYS,
        'NODE_ENV',
        'SECRET_BACKEND',
        ...Object.keys(envOverrides),
    ]);
    const backup = {};
    for (const k of allKeys) {backup[k] = process.env[k];}

    for (const [k, v] of Object.entries(envOverrides)) {
        if (v === undefined) {delete process.env[k];}
        else {process.env[k] = v;}
    }

    try {
        const mod = require(SECRETS_PATH);
        return body(mod);
    } finally {
        for (const k of allKeys) {
            if (backup[k] === undefined) {delete process.env[k];}
            else {process.env[k] = backup[k];}
        }
    }
}

describe('[Iter 27] secrets catalog — shape + new entries', () => {
    it('SECRETS_CATALOG is frozen and contains Iter-27 bank-account entries', () => {
        const mod = require(SECRETS_PATH);
        expect(Object.isFrozen(mod.SECRETS_CATALOG)).toBe(true);
        expect(mod.SECRETS_CATALOG.PLATFORM_BANK_ACCOUNT_NO).toBeDefined();
        expect(mod.SECRETS_CATALOG.PLATFORM_BANK_NAME).toBeDefined();
        expect(mod.SECRETS_CATALOG.DTAM_BANK_ACCOUNT_NO).toBeDefined();
        expect(mod.SECRETS_CATALOG.RSA_PRIVATE_KEY_PASSPHRASE).toBeDefined();
        expect(mod.SECRETS_CATALOG.ENCRYPTION_KEY).toBeDefined();
    });

    it('exports SUPPORTED_BACKENDS including stubs (vault/aws/azure)', () => {
        const mod = require(SECRETS_PATH);
        expect(mod.SUPPORTED_BACKENDS).toEqual(
            expect.arrayContaining(['env', 'file', 'vault', 'aws', 'azure']),
        );
    });

    it('exports the PENDING_FINANCE_CONFIRMATION sentinel string', () => {
        const mod = require(SECRETS_PATH);
        expect(mod.PENDING_SENTINEL).toBe('PENDING_FINANCE_CONFIRMATION');
    });
});

describe('[Iter 27] getSecret — env backend', () => {
    it('returns the value when set in process.env', () => {
        withEnv({
            NODE_ENV: 'test',
            SECRET_BACKEND: 'env',
            ENCRYPTION_KEY: 'real-encryption-key-32-bytes-long-x',
        }, (mod) => {
            expect(mod.getSecret('ENCRYPTION_KEY')).toBe('real-encryption-key-32-bytes-long-x');
        });
    });

    it('throws when asked for a name not in the catalog', () => {
        const mod = require(SECRETS_PATH);
        expect(() => mod.getSecret('NOT_A_REAL_SECRET'))
            .toThrow(/Unknown secret name/);
    });

    it('treats PENDING_FINANCE_CONFIRMATION as missing (falls back to dev or null)', () => {
        withEnv({
            NODE_ENV: 'test',
            SECRET_BACKEND: 'env',
            RSA_PRIVATE_KEY_PASSPHRASE: 'PENDING_FINANCE_CONFIRMATION',
        }, (mod) => {
            const value = mod.getSecret('RSA_PRIVATE_KEY_PASSPHRASE');
            expect(value).not.toBe('PENDING_FINANCE_CONFIRMATION');
            // The dev fallback used to be `dev-rsa-passphrase-<pid>-<Date.now()>`, and this
            // assertion pinned that prefix. That shape was the root cause of the 2026-08-26
            // signing-key incident: a passphrase containing the pid and the clock cannot be
            // reproduced by the next process, so every boot got `bad decrypt` on the key the
            // previous boot wrote and regenerated it, invalidating every certificate signed
            // before. The fallback is now a per-box random value persisted beside the key
            // (config/dev-signing-passphrase.js). What matters is pinned instead: it is a
            // real passphrase, and a second read gives the SAME one.
            expect(value).toMatch(/^[0-9a-f]{64}$/);
            expect(mod.getSecret('RSA_PRIVATE_KEY_PASSPHRASE')).toBe(value);
        });
    });
});

describe('[Iter 27] validateSecretsForEnvironment — fail-closed gate', () => {
    it('returns MISSING_OR_PENDING for production-required secrets that are unset', () => {
        const wipe = Object.fromEntries(PRODUCTION_REQUIRED_KEYS.map((k) => [k, undefined]));
        withEnv({
            NODE_ENV: 'test',
            SECRET_BACKEND: 'env',
            ...wipe,
        }, (mod) => {
            const errors = mod.validateSecretsForEnvironment('production');
            const errorNames = errors.map((e) => e.name);
            expect(errorNames).toEqual(expect.arrayContaining([
                'ENCRYPTION_KEY',
                'PLATFORM_BANK_ACCOUNT_NO',
                'PLATFORM_BANK_NAME',
                'RSA_PRIVATE_KEY_PASSPHRASE',
            ]));
            for (const e of errors) {
                expect(['MISSING_OR_PENDING', 'TOO_SHORT']).toContain(e.reason);
            }
        });
    });

    it('flags PENDING_FINANCE_CONFIRMATION as MISSING_OR_PENDING', () => {
        withEnv({
            NODE_ENV: 'test',
            SECRET_BACKEND: 'env',
            PLATFORM_BANK_ACCOUNT_NO: 'PENDING_FINANCE_CONFIRMATION',
            PLATFORM_BANK_NAME: 'PENDING_FINANCE_CONFIRMATION',
        }, (mod) => {
            const errors = mod.validateSecretsForEnvironment('production');
            const platformErr = errors.find((e) => e.name === 'PLATFORM_BANK_ACCOUNT_NO');
            expect(platformErr).toBeDefined();
            expect(platformErr.reason).toBe('MISSING_OR_PENDING');
        });
    });

    it('returns no errors when all production-required secrets are supplied', () => {
        const longValue = 'x'.repeat(40);
        const env = {
            NODE_ENV: 'test',
            SECRET_BACKEND: 'env',
            HEALTH_JWT_SECRET: longValue,
            PROVIDER_JWT_SECRET: longValue,
            ENCRYPTION_KEY: longValue,
            MASTER_ENCRYPTION_KEY: longValue,
            HMAC_KEY: longValue,
            SESSION_SECRET: longValue,
            DATABASE_URL: 'postgres://u:p@h:5432/db',
            REDIS_URL: 'redis://r:6379',
            S3_ACCESS_KEY: 'AKIA-abc',
            S3_SECRET_KEY: 'secret-xyz',
            PAYMENT_WEBHOOK_SECRET: 'webhook-secret-very-long-enough',
            RSA_PRIVATE_KEY_PASSPHRASE: 'rsa-passphrase-very-long-1',
            PLATFORM_BANK_ACCOUNT_NO: '123-4-56789-0',
            PLATFORM_BANK_NAME: 'ธนาคารกสิกรไทย สาขาลาดพร้าว',
        };
        withEnv(env, (mod) => {
            const errors = mod.validateSecretsForEnvironment('production');
            expect(errors).toEqual([]);
        });
    });

    // External-services cleanup Task 3 (2026-08-19, spec: design notes
    // specs/2026-08-19-external-services-cleanup-design.md) — the E3/S2
    // notification-transport rows (EMAIL_SMTP_*, THAIBULKSMS_*, SMS_PROVIDER,
    // SMS_HTTP_TIMEOUT_MS) and the legacy SMS_API_KEY row are retired from the
    // catalog because their only consumers (services/notification/providers/
    // {email,sms}-provider.js, services/notification/transports/{email,sms}-
    // transport.js, services/sms/sms-service.js) are deleted. Production boot
    // must validate clean WITHOUT any of those vars set — a production deploy
    // that never configures SMTP/ThaiBulkSMS must not fail to start.
    it('returns no errors in production WITHOUT any retired notification-transport vars set', () => {
        const longValue = 'x'.repeat(40);
        const env = {
            NODE_ENV: 'test',
            SECRET_BACKEND: 'env',
            HEALTH_JWT_SECRET: longValue,
            PROVIDER_JWT_SECRET: longValue,
            ENCRYPTION_KEY: longValue,
            MASTER_ENCRYPTION_KEY: longValue,
            HMAC_KEY: longValue,
            SESSION_SECRET: longValue,
            DATABASE_URL: 'postgres://u:p@h:5432/db',
            REDIS_URL: 'redis://r:6379',
            S3_ACCESS_KEY: 'AKIA-abc',
            S3_SECRET_KEY: 'secret-xyz',
            PAYMENT_WEBHOOK_SECRET: 'webhook-secret-very-long-enough',
            RSA_PRIVATE_KEY_PASSPHRASE: 'rsa-passphrase-very-long-1',
            PLATFORM_BANK_ACCOUNT_NO: '123-4-56789-0',
            PLATFORM_BANK_NAME: 'ธนาคารกสิกรไทย สาขาลาดพร้าว',
            // Deliberately UNSET — the retired vars. Pre-T3, these were
            // required:'production', so leaving them unset would surface as
            // MISSING_OR_PENDING errors below.
            EMAIL_SMTP_HOST: undefined,
            EMAIL_SMTP_USER: undefined,
            EMAIL_SMTP_PASS: undefined,
            THAIBULKSMS_API_KEY: undefined,
            THAIBULKSMS_API_SECRET: undefined,
        };
        withEnv(env, (mod) => {
            const errors = mod.validateSecretsForEnvironment('production');
            expect(errors).toEqual([]);
        });
    });

    it('the retired notification-transport + legacy SMS_API_KEY rows no longer exist in the catalog', () => {
        const mod = require(SECRETS_PATH);
        const retired = [
            'EMAIL_SMTP_HOST', 'EMAIL_SMTP_PORT', 'EMAIL_SMTP_SECURE',
            'EMAIL_SMTP_USER', 'EMAIL_SMTP_PASS', 'EMAIL_FROM_NAME', 'EMAIL_FROM_ADDRESS',
            'THAIBULKSMS_API_KEY', 'THAIBULKSMS_API_SECRET', 'THAIBULKSMS_SENDER',
            'SMS_PROVIDER', 'SMS_HTTP_TIMEOUT_MS', 'SMS_API_KEY',
        ];
        for (const name of retired) {
            expect(mod.SECRETS_CATALOG[name]).toBeUndefined();
        }
    });

    it('reports TOO_SHORT when a value is set but below minLength', () => {
        withEnv({
            NODE_ENV: 'test',
            SECRET_BACKEND: 'env',
            ENCRYPTION_KEY: 'too-short',
        }, (mod) => {
            const errors = mod.validateSecretsForEnvironment('production');
            const enc = errors.find((e) => e.name === 'ENCRYPTION_KEY');
            expect(enc).toBeDefined();
            expect(enc.reason).toBe('TOO_SHORT');
            expect(enc.actualLength).toBe('too-short'.length);
            expect(enc.spec.minLength).toBe(32);
        });
    });

    it('does not enforce production-required when validating against development', () => {
        const wipe = Object.fromEntries(PRODUCTION_REQUIRED_KEYS.map((k) => [k, undefined]));
        withEnv({
            NODE_ENV: 'test',
            SECRET_BACKEND: 'env',
            ...wipe,
        }, (mod) => {
            const errors = mod.validateSecretsForEnvironment('development');
            // `always`-required secrets (ENCRYPTION_KEY) still surface even in dev,
            // but production-only ones (PLATFORM_BANK_*) must not.
            const names = errors.map((e) => e.name);
            expect(names).not.toContain('PLATFORM_BANK_ACCOUNT_NO');
            expect(names).toContain('ENCRYPTION_KEY');
        });
    });
});

describe('[Iter 27] Backend abstraction — pluggable transports', () => {
    it('vault backend stub throws a descriptive error', () => {
        withEnv({
            NODE_ENV: 'test',
            SECRET_BACKEND: 'vault',
        }, (mod) => {
            expect(() => mod.getSecret('ENCRYPTION_KEY'))
                .toThrow(/Vault backend not yet implemented/);
        });
    });

    it('aws backend stub throws a descriptive error', () => {
        withEnv({
            NODE_ENV: 'test',
            SECRET_BACKEND: 'aws',
        }, (mod) => {
            expect(() => mod.getSecret('ENCRYPTION_KEY'))
                .toThrow(/AWS Secrets Manager backend not yet implemented/);
        });
    });

    it('azure backend stub throws a descriptive error', () => {
        withEnv({
            NODE_ENV: 'test',
            SECRET_BACKEND: 'azure',
        }, (mod) => {
            expect(() => mod.getSecret('ENCRYPTION_KEY'))
                .toThrow(/Azure Key Vault backend not yet implemented/);
        });
    });

    it('unknown backend throws with the list of supported backends', () => {
        withEnv({
            NODE_ENV: 'test',
            SECRET_BACKEND: 'not-a-real-backend',
        }, (mod) => {
            expect(() => mod.getSecret('ENCRYPTION_KEY'))
                .toThrow(/Unknown SECRET_BACKEND/);
        });
    });

    it('getActiveBackend reports the configured backend', () => {
        withEnv({
            NODE_ENV: 'test',
            SECRET_BACKEND: 'env',
        }, (mod) => {
            expect(mod.getActiveBackend()).toBe('env');
        });
    });
});

describe('[Iter 27] getSecretAsync — async-friendly API', () => {
    it('resolves to the same value as getSecret', async () => {
        await withEnv({
            NODE_ENV: 'test',
            SECRET_BACKEND: 'env',
            ENCRYPTION_KEY: 'async-key-x'.padEnd(40, 'y'),
        }, async (mod) => {
            const syncValue = mod.getSecret('ENCRYPTION_KEY');
            const asyncValue = await mod.getSecretAsync('ENCRYPTION_KEY');
            expect(asyncValue).toBe(syncValue);
        });
    });
});

describe('[Iter 27] check-secrets CLI helper — formatting', () => {
    it('formatHuman renders an OK banner when there are no errors', () => {
        const { formatHuman } = require(CHECK_SCRIPT_PATH);
        const out = formatHuman([], 'production');
        expect(out).toMatch(/OK — all required secrets present/);
    });

    it('formatHuman renders an itemized FAIL block when there are errors', () => {
        const { formatHuman } = require(CHECK_SCRIPT_PATH);
        const out = formatHuman(
            [{
                name: 'PLATFORM_BANK_ACCOUNT_NO',
                reason: 'MISSING_OR_PENDING',
                spec: {
                    description: 'Predictive AI Solution corporate bank account for platform-fee receipts',
                    required: 'production',
                    sensitive: false,
                    usedIn: ['config/invoice-issuers.js'],
                    aliases: [],
                },
            }],
            'production',
        );
        expect(out).toMatch(/FAIL/);
        expect(out).toMatch(/PLATFORM_BANK_ACCOUNT_NO/);
        expect(out).toMatch(/MISSING_OR_PENDING/);
        expect(out).toMatch(/config\/invoice-issuers\.js/);
    });

    it('parseArgs handles --env=production and --json', () => {
        const { parseArgs } = require(CHECK_SCRIPT_PATH);
        const args = parseArgs(['node', 'check-secrets.js', '--env=production', '--json']);
        expect(args.env).toBe('production');
        expect(args.json).toBe(true);
    });
});
