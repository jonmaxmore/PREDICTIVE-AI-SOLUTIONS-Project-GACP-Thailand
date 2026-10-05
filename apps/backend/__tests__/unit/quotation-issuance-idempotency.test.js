'use strict';
/**
 * Issuance is idempotent UNDER CONCURRENCY, and the database is the arbiter
 * (F-G4-64, fix round 1, reviewer BLOCKER B1).
 *
 * The design of task 7 rests on the sentence "issueQuotationsForApplication is
 * already idempotent on (applicationId, issuerType)". It was written in three
 * comments and implemented nowhere: the guard was a findMany followed by a
 * create in two separate implicit transactions, with no lock, and
 * @@index([applicationId, issuerType]) is a PLAIN index — only quotationNumber
 * carried a unique constraint (migrations/20260516010000_add_journal_quotation_
 * receipt_seq_bank_accounts/migration.sql:137-140).
 *
 * That was survivable while the only callers were once-per-lifecycle submit
 * doors. Task 7 put the same write behind a GET that the payments page, the
 * quotation slot and the refresh button all hit, so two reads a few
 * milliseconds apart both found zero rows and both created: two PENDING
 * quotations for one application and two numbers burned off the QT-PRD legal
 * sequence. findQuotationsByApplicationId answers with the oldest
 * (quotation-service.js orderBy createdAt asc), so the second row is invisible
 * to the API and to the gate while being fully present in the table, in any
 * statement query, and in the repair script's counts.
 *
 * Two halves, both pinned here:
 *   1. the SQL — a partial unique index is what actually stops the second row;
 *   2. the CODE — the check and the create sit in one transaction, and the
 *      unique violation is read as "somebody else already issued it", never
 *      raised at the applicant.
 */

const fs = require('fs');
const path = require('path');

// ── Half 1: the constraint itself ────────────────────────────────────────────

const MIGRATION_SQL = path.join(
    __dirname, '..', '..', 'prisma', 'migrations',
    '20260828100000_quotation_acceptance_snapshot_expand', 'migration.sql',
);

describe('the partial unique index that makes issuance idempotent', () => {
    it('is declared in this branch\'s own migration, on (applicationId, issuerType) WHERE not deleted', () => {
        const sql = fs.readFileSync(MIGRATION_SQL, 'utf8');
        expect(sql).toMatch(
            /CREATE\s+UNIQUE\s+INDEX\s+"quotations_application_issuer_live_uq"\s+ON\s+"quotations"\s*\(\s*"applicationId"\s*,\s*"issuerType"\s*\)\s*WHERE\s+"isDeleted"\s*=\s*false/i,
        );
    });

    it('is PARTIAL, so a soft-deleted row can never block a re-issue', () => {
        const sql = fs.readFileSync(MIGRATION_SQL, 'utf8');
        const stmt = sql.split(/;\s*/).find((s) => s.includes('quotations_application_issuer_live_uq'));
        expect(stmt).toBeDefined();
        expect(stmt).toMatch(/WHERE\s+"isDeleted"\s*=\s*false/i);
    });

    it('is documented on the Prisma model, because Prisma cannot express it', () => {
        const schema = fs.readFileSync(
            path.join(__dirname, '..', '..', 'prisma', 'schema', 'billing.prisma'), 'utf8',
        );
        expect(schema).toContain('quotations_application_issuer_live_uq');
    });
});

// ── Half 2: the code that lives with it ──────────────────────────────────────

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

/**
 * A prisma stand-in that behaves the way PostgreSQL behaves once the partial
 * unique index above exists:
 *   - while the race window is open, every probe reads a snapshot with no
 *     rows in it — which is exactly what two concurrent requests see;
 *   - the SECOND insert for the same (applicationId, issuerType) is refused
 *     with P2002, and only then does the winner's row become visible.
 * Nothing here is scripted per-call-count: the refusal is what closes the
 * window, so the assertion does not depend on how the two promises interleave.
 */
function makeRacingPrisma() {
    const rows = [];
    let raceWindowOpen = true;
    const prismaStub = {
        __rows: rows,
        application: {
            findUnique: jest.fn(async () => ({
                id: 'app-1',
                formData: { cultivationMethods: ['outdoor'] },
                cultivationScopeCount: 1,
                totalAreaTypes: 1,
                organizationId: 'org-1',
                isDeleted: false,
            })),
        },
        quotation: {
            findMany: jest.fn(async ({ where }) => {
                if (raceWindowOpen) { return []; }
                return rows.filter((r) => r.applicationId === where.applicationId
                    && (where.isDeleted !== false || !r.isDeleted));
            }),
            create: jest.fn(async ({ data }) => {
                const clash = rows.some((r) => !r.isDeleted
                    && r.applicationId === data.applicationId
                    && r.issuerType === data.issuerType);
                if (clash) {
                    // The index has spoken; the winning row is now committed
                    // and visible to everybody, including the loser's re-read.
                    raceWindowOpen = false;
                    throw Object.assign(
                        new Error('Unique constraint failed on the fields: (`applicationId`,`issuerType`)'),
                        { code: 'P2002', meta: { target: ['applicationId', 'issuerType'] } },
                    );
                }
                const row = {
                    id: `qt-${rows.length + 1}`,
                    createdAt: new Date(),
                    isDeleted: false,
                    acceptedAt: null,
                    ...data,
                };
                rows.push(row);
                return { ...row };
            }),
        },
    };
    // The receiptSequence delegate is deliberately absent so the QT allocator
    // takes its documented in-memory test fallback instead of a DB round trip.
    prismaStub.$transaction = jest.fn(async (cb) => (
        typeof cb === 'function' ? cb(prismaStub) : null
    ));
    return prismaStub;
}

let mockPrisma;
jest.mock('../../services/prisma-database', () => ({
    get prisma() { return mockPrisma; },
}));

function loadQuotationService() {
    for (const m of ['quotation-service', 'receipt-numbering-service']) {
        delete require.cache[require.resolve(path.join(__dirname, '..', '..', 'services', m))];
    }
    return require(path.join(__dirname, '..', '..', 'services', 'quotation-service'));
}

describe('two issuances that race', () => {
    beforeEach(() => { mockPrisma = makeRacingPrisma(); });

    it('produce ONE quotation row and no error at either caller', async () => {
        const quotationService = loadQuotationService();

        const [a, b] = await Promise.all([
            quotationService.issueQuotationsForApplication('app-1', {}),
            quotationService.issueQuotationsForApplication('app-1', {}),
        ]);

        expect(mockPrisma.__rows).toHaveLength(1);
        expect(a.company.id).toBe(mockPrisma.__rows[0].id);
        // The loser is answered with the row that exists, not with a refusal:
        // an applicant whose page mounted twice must not see an error, and the
        // caller must not be handed a null it would read as "not issued".
        expect(b.company.id).toBe(a.company.id);
        expect(b.platform.id).toBe(a.company.id);
    });

    it('the loser is served by a re-read, so a create that clashes is never rethrown', async () => {
        const quotationService = loadQuotationService();
        await Promise.all([
            quotationService.issueQuotationsForApplication('app-1', {}),
            quotationService.issueQuotationsForApplication('app-1', {}),
        ]);
        // Two creates were attempted — the race is real, not designed away by
        // the stub — and exactly one of them stuck.
        expect(mockPrisma.quotation.create).toHaveBeenCalledTimes(2);
        expect(mockPrisma.__rows).toHaveLength(1);
    });

    it('a unique violation that leaves NO readable row is still raised', async () => {
        // A P2002 on some other constraint (quotationNumber, say) must not be
        // swallowed into a silent "already issued" — the caller would then be
        // told a price of record exists when none does.
        mockPrisma = makeRacingPrisma();
        mockPrisma.quotation.create = jest.fn(async () => {
            throw Object.assign(
                new Error('Unique constraint failed on the fields: (`quotationNumber`)'),
                { code: 'P2002', meta: { target: ['quotationNumber'] } },
            );
        });
        const quotationService = loadQuotationService();
        await expect(quotationService.issueQuotationsForApplication('app-1', {}))
            .rejects.toMatchObject({ code: 'P2002' });
    });
});

/**
 * ── When the CALLER owns the transaction, the violation goes back to them
 *    (fix round 4, R5) ──────────────────────────────────────────────────────
 *
 * `opts.tx` is an advertised parameter ("Prisma transaction handle for atomic
 * inclusion in a caller-owned $transaction"), and PostgreSQL aborts that whole
 * transaction the moment the partial unique index refuses the insert. The
 * read-the-winner recovery then runs on a handle on which every further
 * statement fails with 25P02 — so a benign lost race became a hard failure with
 * a misleading error, inside somebody else's transaction, which must be retried
 * as a whole anyway. The recovery is for a client this function owns.
 */
describe('a unique violation inside a caller-owned transaction', () => {
    beforeEach(() => { mockPrisma = makeRacingPrisma(); });

    it('is rethrown to the caller instead of read back on the aborted handle', async () => {
        const quotationService = loadQuotationService();

        // Somebody else's row is already live for this (applicationId, issuerType).
        mockPrisma.__rows.push({
            id: 'qt-winner', applicationId: 'app-1', issuerType: 'PLATFORM', isDeleted: false,
        });
        // A real interactive-transaction handle has no $transaction of its own.
        const { $transaction: _unusedTx, ...txHandle } = mockPrisma;

        await expect(quotationService.issueQuotationsForApplication('app-1', { tx: txHandle }))
            .rejects.toMatchObject({ code: 'P2002' });

        // Two probes ran BEFORE the create (the idempotency probe and the
        // in-transaction re-probe). What must not happen is a THIRD read after
        // the violation: that is the statement PostgreSQL refuses.
        expect(mockPrisma.quotation.findMany).toHaveBeenCalledTimes(2);
    });

    it('still recovers by re-reading when the transaction is this function`s own', async () => {
        const quotationService = loadQuotationService();
        const [a, b] = await Promise.all([
            quotationService.issueQuotationsForApplication('app-1', {}),
            quotationService.issueQuotationsForApplication('app-1', {}),
        ]);
        expect(a.company.id).toBe(b.company.id);
    });
});
