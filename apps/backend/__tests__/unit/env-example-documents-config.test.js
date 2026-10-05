'use strict';

/**
 * `.env.example` must document the configuration the security layers read.
 *
 * Found while checking one variable and discovering thirty-one. A team standing
 * up an environment from `.env.example` today cannot boot the backend at all:
 * jwt-security throws `CRITICAL: JWT secrets are missing` when the provider
 * secret is absent, and the message cannot name the variable because the
 * variable is not in the template. Everything else fails more quietly —
 * LEGACY_UNTYPED_TOKEN_GRACE_UNTIL unset logs out every live session on deploy,
 * an unset AUDIT_HASH_KEY changes how the audit chain is keyed, and the
 * DTAM/PLATFORM identity fields decide what a farmer's receipt says.
 *
 * Two categories are deliberately NOT required here:
 *
 *  1. Anything in the `config/secrets.js` catalog. Those are secrets fetched
 *     through a secret backend, and putting a bank account number in a
 *     committed template is the opposite of the intent. The catalog has its own
 *     readiness check.
 *  2. Anything under ALLOWED below — each entry states why.
 *
 * The comparison is between two independent artifacts (the code's
 * `process.env.X` reads vs. the template's text), so it is not tautological,
 * and it catches the NEXT variable somebody adds without documenting.
 */

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '../..');

/**
 * Scoped to the layers where an unset variable changes security or money
 * behaviour. Widening this to the whole backend would sweep in dozens of
 * genuinely optional feature flags and turn the gate into noise.
 */
const SCAN_DIRS = ['config', 'middleware'];

/**
 * Variables that legitimately need no template entry.
 *
 * NODE_ENV and PORT are platform-provided; the rest are read only to detect a
 * test or CI context. Each is listed individually rather than pattern-matched,
 * so adding one is a visible decision.
 */
const ALLOWED = new Set([
    'NODE_ENV',
    'JEST_WORKER_ID',
    'CI',
    // OS-provided, never deploy config: config/child-process-env.js passes the
    // parent's PATH through to the document pre-check's forked pdf worker so
    // `node` resolves there (document pre-check Task 4).
    'PATH',
]);

function readEnvExample() {
    return fs.readFileSync(path.join(BACKEND_ROOT, '.env.example'), 'utf8');
}

/** Names declared in the config/secrets.js catalog, which owns its own docs. */
function catalogManagedNames() {
    const source = fs.readFileSync(path.join(BACKEND_ROOT, 'config/secrets.js'), 'utf8');
    return new Set(
        [...source.matchAll(/^\s*([A-Z][A-Z0-9_]{2,}):\s*\{/gm)].map((m) => m[1]),
    );
}

/** Every `process.env.X` read under SCAN_DIRS. */
function envReadsInSecurityLayers() {
    const found = new Set();
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (['node_modules', '__tests__'].includes(entry.name)) { continue; }
                walk(full);
                continue;
            }
            if (!entry.name.endsWith('.js')) { continue; }
            const source = fs.readFileSync(full, 'utf8');
            for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) {
                found.add(match[1]);
            }
        }
    };
    for (const dir of SCAN_DIRS) { walk(path.join(BACKEND_ROOT, dir)); }
    return found;
}

describe('.env.example documents the config the security layers read', () => {
    test('the scan finds real reads (guards against a vacuous pass)', () => {
        // An empty set would make the assertion below trivially true.
        const reads = envReadsInSecurityLayers();
        expect(reads.size).toBeGreaterThan(20);
        expect(reads.has('DATABASE_URL')).toBe(true);
    });

    test('every direct-read variable appears in the template', () => {
        const template = readEnvExample();
        const catalog = catalogManagedNames();
        const missing = [...envReadsInSecurityLayers()]
            .filter((name) => !ALLOWED.has(name))
            .filter((name) => !catalog.has(name))
            .filter((name) => !template.includes(name))
            .sort();
        expect(missing).toEqual([]);
    });

    test('the deploy-blocking variables are documented with their consequence', () => {
        const template = readEnvExample();
        // Not just present — a bare `FOO=""` line teaches the operator nothing
        // about what happens when it is wrong. These three are the ones that
        // take the platform down or log everybody out.
        for (const name of ['PROVIDER_JWT_SECRET', 'LEGACY_UNTYPED_TOKEN_GRACE_UNTIL', 'LEGACY_NO_JTI_GRACE_UNTIL']) {
            expect(template).toContain(name);
        }
        expect(template).toMatch(/CRITICAL: JWT secrets are missing|cannot boot|will not start/i);
        expect(template).toMatch(/log(s|ged)? out|logout/i);
    });

    test('account numbers get no template line at all', () => {
        // Narrower than "everything in the catalog": DATABASE_URL and
        // PAYMENT_WEBHOOK_SECRET are catalog-managed AND belong in the template, because
        // an obvious placeholder is how an operator learns the shape. Account
        // numbers are different — a template line is an invitation to paste a
        // real one and commit it, and the secret backend is where they belong.
        const template = readEnvExample();
        const NEVER_TEMPLATED = ['DTAM_BANK_ACCOUNT_NO', 'PLATFORM_BANK_ACCOUNT_NO'];
        const leaked = NEVER_TEMPLATED.filter((name) => new RegExp(`^\\s*${name}\\s*=`, 'm').test(template));
        expect(leaked).toEqual([]);
    });

    test('no real-looking Thai bank account or tax number is committed', () => {
        // Belt and braces on the above: catch a real value pasted under any
        // name at all. Thai corporate tax IDs are 13 digits; bank accounts are
        // 10-12. Placeholders are a run of one repeated digit.
        const template = readEnvExample();
        const suspicious = template
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('#'))
            .filter((line) => /=\s*"?\d{10,13}"?\s*(#.*)?$/.test(line))
            .filter((line) => !/"?(\d)\1{9,12}"?/.test(line));
        expect(suspicious).toEqual([]);
    });
});
