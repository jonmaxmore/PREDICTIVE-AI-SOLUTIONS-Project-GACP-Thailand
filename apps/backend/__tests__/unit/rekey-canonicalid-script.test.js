/**
 * Detokenize STAGE A — rekey-canonicalid.js unit tests.
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md
 *
 * The script is NOT run by STAGE 0 — it ships inert. These tests prove its
 * control flow with an injected mock prisma (no DB): the forward re-key emits
 * the parent UPDATE (cascades to the 3 FK children) + the lockstep slip UPDATE,
 * asserts FK integrity, and the rollback restores from the escrow column.
 */

'use strict';

const { rekey } = require('../../scripts/rekey-canonicalid');

// $queryRawUnsafe answers the integrity/pre-flight count probes; the script
// keys off the SQL text to decide which count to return.
function makeMockPrisma({ orphans = 0, missingHmac = 0, missingEscrow = 0, usersUpdated = 5, slipsUpdated = 2, attachmentsUpdated = 3 } = {}) {
    const calls = { execRaw: [], queryRaw: [] };
    const tx = {
        $executeRawUnsafe: jest.fn(async (sql) => {
            calls.execRaw.push(sql);
            if (/UPDATE "payment_slips"/.test(sql)) {return slipsUpdated;}
            if (/UPDATE "attachments"/.test(sql)) {return attachmentsUpdated;}
            if (/UPDATE "users"/.test(sql)) {return usersUpdated;}
            return 0;
        }),
        $queryRawUnsafe: jest.fn(async (sql) => {
            calls.queryRaw.push(sql);
            if (/FROM "users"[\s\S]*healthIdHmac" IS NULL AND "providerIdHmac" IS NULL/.test(sql)) {
                return [{ c: BigInt(missingHmac) }];
            }
            if (/canonicalIdLegacy" IS NULL/.test(sql)) {
                return [{ c: BigInt(missingEscrow) }];
            }
            // FK-integrity probes (applications / invoices / application_bundles).
            return [{ c: BigInt(orphans) }];
        }),
    };
    const prisma = { $transaction: jest.fn(async (cb) => cb(tx)) };
    return { prisma, tx, calls };
}

const helpers = { withoutTenantScope: (fn) => fn() };

describe('rekey-canonicalid — forward', () => {
    it('emits the parent re-key (COALESCE) + lockstep slip UPDATE, asserts FK integrity', async () => {
        const { prisma, calls } = makeMockPrisma({ orphans: 0, usersUpdated: 5, slipsUpdated: 2 });
        const result = await rekey({ prisma, helpers, log: () => {} });

        expect(result.mode).toBe('forward');
        expect(result.usersRekeyed).toBe(5);
        expect(result.slipsRewritten).toBe(2);
        expect(result.assertionHeld).toBe(true);

        const parentUpdate = calls.execRaw.find((s) => /UPDATE "users" SET "canonicalId" = COALESCE\("healthIdHmac","providerIdHmac", id\)/.test(s));
        expect(parentUpdate).toBeTruthy();
        const slipUpdate = calls.execRaw.find((s) => /UPDATE "payment_slips"[\s\S]*"uploadedBy" = u\."canonicalId"/.test(s));
        expect(slipUpdate).toBeTruthy();
    });

    it('STAGE A.2: ALSO emits the attachments.uploadedBy lockstep (escrow-keyed → token) + reports the count', async () => {
        const { prisma, calls } = makeMockPrisma({ orphans: 0, attachmentsUpdated: 3 });
        const result = await rekey({ prisma, helpers, log: () => {} });

        expect(result.attachmentsRewritten).toBe(3);
        const attUpdate = calls.execRaw.find((s) => /UPDATE "attachments"[\s\S]*"uploadedBy" = u\."canonicalId"[\s\S]*WHERE a\."uploadedBy" = u\."canonicalIdLegacy"/.test(s));
        expect(attUpdate).toBeTruthy();
    });

    it('ABORTS (throws) when a row would change canonicalId with no escrow value (rollback impossible)', async () => {
        const { prisma } = makeMockPrisma({ missingEscrow: 3 });
        await expect(rekey({ prisma, helpers, log: () => {} }))
            .rejects.toThrow(/NO canonicalIdLegacy escrow/);
    });

    it('throws + rolls back when an FK-integrity orphan is detected', async () => {
        const { prisma } = makeMockPrisma({ orphans: 4 });
        await expect(rekey({ prisma, helpers, log: () => {} }))
            .rejects.toThrow(/FK integrity assertion FAILED/);
    });

    it('dry-run writes nothing (rolls back) but still reports the would-be counts', async () => {
        const { prisma, calls } = makeMockPrisma({ usersUpdated: 7, slipsUpdated: 3 });
        const result = await rekey({ prisma, helpers, dryRun: true, log: () => {} });
        expect(result.dryRun).toBe(true);
        expect(result.rolledBack).toBe(true);
        // The UPDATEs ran inside the tx (counts captured) but the tx is aborted.
        expect(calls.execRaw.length).toBeGreaterThan(0);
        expect(result.usersRekeyed).toBe(7);
    });
});

describe('rekey-canonicalid — rollback', () => {
    it('restores canonicalId from COALESCE(canonicalIdLegacy, canonicalId) + reverses the slip lockstep', async () => {
        const { prisma, calls } = makeMockPrisma({ orphans: 0, usersUpdated: 5, slipsUpdated: 2 });
        const result = await rekey({ prisma, helpers, rollback: true, log: () => {} });

        expect(result.mode).toBe('rollback');
        expect(result.assertionHeld).toBe(true);
        const restore = calls.execRaw.find((s) => /UPDATE "users" SET "canonicalId" = COALESCE\("canonicalIdLegacy","canonicalId"\)/.test(s));
        expect(restore).toBeTruthy();
        const slipRestore = calls.execRaw.find((s) => /UPDATE "payment_slips"[\s\S]*"uploadedBy" = u\."canonicalIdLegacy"/.test(s));
        expect(slipRestore).toBeTruthy();
    });

    it('STAGE A.2: ALSO reverses the attachments.uploadedBy lockstep (token → escrowed national ID)', async () => {
        const { prisma, calls } = makeMockPrisma({ orphans: 0, attachmentsUpdated: 3 });
        const result = await rekey({ prisma, helpers, rollback: true, log: () => {} });

        expect(result.attachmentsRewritten).toBe(3);
        const attRestore = calls.execRaw.find((s) => /UPDATE "attachments"[\s\S]*"uploadedBy" = u\."canonicalIdLegacy"[\s\S]*WHERE a\."uploadedBy" = u\."canonicalId"/.test(s));
        expect(attRestore).toBeTruthy();
    });
});
