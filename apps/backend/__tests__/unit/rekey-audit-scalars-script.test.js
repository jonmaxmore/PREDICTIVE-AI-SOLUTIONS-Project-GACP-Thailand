/**
 * PDPA close-natid-ROUND-6 — rekey-audit-scalars.js unit tests.
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md
 *
 * The script is NOT auto-run. These tests prove its control flow with an
 * injected mock basePrisma (no DB): a 13-digit plaintext row is re-keyed to the
 * User UUID (audit scalars) / canonicalId token (the bundle FK); a UUID row is
 * left untouched; and the final 0-remaining assertion holds after a real run.
 */

'use strict';

const { rekey } = require('../../scripts/pdpa/rekey-audit-scalars');

const PLAINTEXT = '1234567890123';
const USER_UUID = 'uuid-of-user-1';
const USER_TOKEN = 'hmac-token-of-user-1';

// computeLookupHmac stub: deterministic, maps the plaintext to a known token.
function computeLookupHmac(value) {
    if (value === PLAINTEXT) { return USER_TOKEN; }
    return `hmac:${value}`;
}

/**
 * Build a mock basePrisma. `state` holds the current value per table.column so
 * the post-run 0-remaining COUNT probe reflects the writes the run performed.
 *
 * @param {object} opts
 * @param {boolean} opts.userExists  whether the WHERE *Hmac lookup finds a user
 */
function makeMockPrisma({ userExists = true } = {}) {
    // Seed: applications.updatedBy has ONE plaintext row + ONE already-UUID row.
    const state = {
        'applications.updatedBy': [
            { rowId: 'app-row-1', val: PLAINTEXT },
            { rowId: 'app-row-2', val: USER_UUID }, // already a UUID — must be skipped
        ],
        'application_bundles.healthId': [{ rowId: 'bundle-1', val: PLAINTEXT }],
        'application_comments.authorId': [],
        'revision_deadlines.createdBy': [],
        'revision_deadlines.updatedBy': [],
        'revision_deadlines.submittedBy': [],
    };
    const THIRTEEN = /^[0-9]{13}$/;
    const calls = { updates: [] };

    function keyFor(sql) {
        const m = sql.match(/FROM "([a-z_]+)"[\s\S]*"([A-Za-z]+)" ~/) // SELECT ... WHERE col ~
            || sql.match(/FROM "([a-z_]+)" WHERE "([A-Za-z]+)" ~/);   // COUNT ... WHERE col ~
        return m ? `${m[1]}.${m[2]}` : null;
    }

    const basePrisma = {
        $queryRawUnsafe: jest.fn(async (sql, arg) => {
            // User lookup by token.
            if (/FROM "users"\s+WHERE "healthIdHmac"/.test(sql)) {
                if (userExists && arg === USER_TOKEN) {
                    return [{ id: USER_UUID, canonicalId: USER_TOKEN }];
                }
                return [];
            }
            // COUNT(*) plaintext-remaining probe.
            if (/SELECT COUNT\(\*\)/.test(sql)) {
                const key = keyFor(sql);
                const rows = (state[key] || []).filter((r) => THIRTEEN.test(String(r.val || '')));
                return [{ c: BigInt(rows.length) }];
            }
            // SELECT plaintext rows for a column.
            const key = keyFor(sql);
            const rows = (state[key] || []).filter((r) => THIRTEEN.test(String(r.val || '')));
            return rows.map((r) => ({ rowId: r.rowId, val: r.val }));
        }),
        $executeRawUnsafe: jest.fn(async (sql, newValue, rowId) => {
            calls.updates.push({ sql, newValue, rowId });
            // Apply the write to the in-memory state so the COUNT probe drops.
            const m = sql.match(/UPDATE "([a-z_]+)" SET "([A-Za-z]+)"/);
            if (m) {
                const key = `${m[1]}.${m[2]}`;
                const row = (state[key] || []).find((r) => r.rowId === rowId);
                if (row) { row.val = newValue; }
            }
            return 1;
        }),
    };
    return { basePrisma, state, calls };
}

describe('rekey-audit-scalars — forward', () => {
    it('re-keys a 13-digit audit scalar (applications.updatedBy) to the User UUID, leaves a UUID row untouched', async () => {
        const { basePrisma, state, calls } = makeMockPrisma();

        const result = await rekey({ basePrisma, computeLookupHmac, log: () => {} });

        // app-row-1 (plaintext) re-keyed → UUID; app-row-2 (UUID) untouched.
        const appUpdated = state['applications.updatedBy'].find((r) => r.rowId === 'app-row-1');
        const appUntouched = state['applications.updatedBy'].find((r) => r.rowId === 'app-row-2');
        expect(appUpdated.val).toBe(USER_UUID);
        expect(appUntouched.val).toBe(USER_UUID); // unchanged (was already the UUID)

        // The UUID row was never written (idempotent skip).
        const wroteRow2 = calls.updates.find((u) => u.rowId === 'app-row-2');
        expect(wroteRow2).toBeUndefined();

        expect(result.rekeyed).toBeGreaterThanOrEqual(1);
        expect(result.unmatched).toBe(0);
    });

    it('re-keys the bundle FK column to the canonicalId TOKEN (not the UUID)', async () => {
        const { basePrisma, state } = makeMockPrisma();

        await rekey({ basePrisma, computeLookupHmac, log: () => {} });

        const bundle = state['application_bundles.healthId'].find((r) => r.rowId === 'bundle-1');
        // FK to users.canonicalId → must hold the TOKEN, never the UUID.
        expect(bundle.val).toBe(USER_TOKEN);
        expect(bundle.val).not.toBe(USER_UUID);
        expect(bundle.val).not.toBe(PLAINTEXT);
    });

    it('asserts 0 plaintext 13-digit remaining across all 5 columns after a real run', async () => {
        const { basePrisma } = makeMockPrisma();

        const result = await rekey({ basePrisma, computeLookupHmac, dryRun: false, log: () => {} });

        expect(result.remainingPlaintext).toBe(0);
        expect(result.assertionHeld).toBe(true);
    });

    it('--dry-run writes nothing (state keeps the plaintext) and does not assert 0', async () => {
        const { basePrisma, state, calls } = makeMockPrisma();

        const result = await rekey({ basePrisma, computeLookupHmac, dryRun: true, log: () => {} });

        // No UPDATE executed.
        expect(calls.updates.length).toBe(0);
        // Plaintext still present.
        expect(state['applications.updatedBy'].find((r) => r.rowId === 'app-row-1').val).toBe(PLAINTEXT);
        // assertionHeld is null for a dry run (state untouched, count > 0 expected).
        expect(result.assertionHeld).toBeNull();
        expect(result.remainingPlaintext).toBeGreaterThan(0);
    });

    it('leaves a plaintext row in place (logs UNMATCHED) when no owning user is found', async () => {
        const { basePrisma, state, calls } = makeMockPrisma({ userExists: false });

        const result = await rekey({ basePrisma, computeLookupHmac, dryRun: false, log: () => {} });

        // Unmatched → left in place; assertion FAILS (plaintext remains).
        expect(result.unmatched).toBeGreaterThanOrEqual(1);
        expect(calls.updates.length).toBe(0);
        expect(state['applications.updatedBy'].find((r) => r.rowId === 'app-row-1').val).toBe(PLAINTEXT);
        expect(result.assertionHeld).toBe(false);
    });
});
