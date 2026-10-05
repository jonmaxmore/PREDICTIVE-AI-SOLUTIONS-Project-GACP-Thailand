/**
 * Unit tests for scripts/backfill-entity-thaicitizenid-hmac.js
 *
 * Exercises backfill() with an injected fake prisma + helpers — no DB. Verifies:
 *   - computes computeLookupHmac(thaiCitizenId) into thaiCitizenIdHmac for
 *     INDIVIDUAL entities missing it;
 *   - dry-run writes nothing;
 *   - the final "0 active INDIVIDUAL entities missing thaiCitizenIdHmac"
 *     assertion holds after a real pass;
 *   - a @unique (P2002) conflict aborts loudly (never overwrites/skips).
 */

const { backfill } = require('../../scripts/backfill-entity-thaicitizenid-hmac');

// Deterministic fake HMAC so the test doesn't depend on the real key.
const fakeHmac = (v) => (v ? `hmac(${v})` : null);

// Build a tiny in-memory entities table. Each row: { id, type, thaiCitizenId,
// thaiCitizenIdHmac, isDeleted }.
function makeFakePrisma(rows) {
    const matches = (row, where) => {
        if (where.type && row.type !== where.type) {return false;}
        if (where.isDeleted !== undefined && row.isDeleted !== where.isDeleted) {return false;}
        if (where.thaiCitizenId && where.thaiCitizenId.not === null && (row.thaiCitizenId === null || row.thaiCitizenId === undefined)) {return false;}
        if (where.thaiCitizenIdHmac === null && (row.thaiCitizenIdHmac !== null && row.thaiCitizenIdHmac !== undefined)) {return false;}
        return true;
    };
    return {
        rows,
        entity: {
            findMany: async ({ where, take }) => rows.filter((r) => matches(r, where)).slice(0, take || rows.length).map((r) => ({ id: r.id, thaiCitizenId: r.thaiCitizenId })),
            count: async ({ where }) => rows.filter((r) => matches(r, where)).length,
            update: async ({ where, data }) => {
                const row = rows.find((r) => r.id === where.id);
                if (data.thaiCitizenIdHmac) {
                    // simulate @unique: another row already holds this hmac
                    const clash = rows.find((r) => r.id !== where.id && r.thaiCitizenIdHmac === data.thaiCitizenIdHmac);
                    if (clash) {
                        const e = new Error('Unique constraint failed');
                        e.code = 'P2002';
                        e.meta = { target: ['type', 'thaiCitizenIdHmac'] };
                        throw e;
                    }
                }
                Object.assign(row, data);
                return row;
            },
        },
    };
}

const helpers = {
    computeLookupHmac: fakeHmac,
    withoutTenantScope: (fn) => fn(),
};

describe('backfill-entity-thaicitizenid-hmac', () => {
    it('backfills thaiCitizenIdHmac for INDIVIDUAL entities missing it; assertion holds', async () => {
        const rows = [
            { id: 'e1', type: 'INDIVIDUAL', thaiCitizenId: '1100000000008', thaiCitizenIdHmac: null, isDeleted: false },
            { id: 'e2', type: 'INDIVIDUAL', thaiCitizenId: '1100000000009', thaiCitizenIdHmac: null, isDeleted: false },
            // already backfilled — untouched
            { id: 'e3', type: 'INDIVIDUAL', thaiCitizenId: '1100000000010', thaiCitizenIdHmac: 'hmac(1100000000010)', isDeleted: false },
            // not INDIVIDUAL — ignored
            { id: 'e4', type: 'JURISTIC', thaiCitizenId: null, thaiCitizenIdHmac: null, isDeleted: false },
        ];
        const prisma = makeFakePrisma(rows);

        const result = await backfill({ prisma, helpers, dryRun: false, batch: 10 });

        expect(rows.find((r) => r.id === 'e1').thaiCitizenIdHmac).toBe('hmac(1100000000008)');
        expect(rows.find((r) => r.id === 'e2').thaiCitizenIdHmac).toBe('hmac(1100000000009)');
        expect(result.assertion.held).toBe(true);
        expect(result.perColumn[0].updated).toBe(2);
    });

    it('dry-run writes nothing and reports what would remain', async () => {
        const rows = [
            { id: 'e1', type: 'INDIVIDUAL', thaiCitizenId: '1100000000008', thaiCitizenIdHmac: null, isDeleted: false },
        ];
        const prisma = makeFakePrisma(rows);

        const result = await backfill({ prisma, helpers, dryRun: true, batch: 10 });

        expect(rows[0].thaiCitizenIdHmac).toBeNull(); // untouched
        expect(result.dryRun).toBe(true);
        expect(result.assertion.held).toBeNull();
        expect(result.assertion.wouldRemainAfterDryRun).toEqual([{ column: 'thaiCitizenIdHmac', missing: 1 }]);
    });

    it('aborts loudly on a @unique (P2002) conflict — never overwrites', async () => {
        const rows = [
            { id: 'e1', type: 'INDIVIDUAL', thaiCitizenId: 'shared', thaiCitizenIdHmac: null, isDeleted: false },
            // e2 already holds hmac(shared) → e1's write collides
            { id: 'e2', type: 'INDIVIDUAL', thaiCitizenId: 'shared', thaiCitizenIdHmac: 'hmac(shared)', isDeleted: false },
        ];
        const prisma = makeFakePrisma(rows);

        await expect(backfill({ prisma, helpers, dryRun: false, batch: 10 }))
            .rejects.toThrow(/UNIQUE conflict/);
    });
});
