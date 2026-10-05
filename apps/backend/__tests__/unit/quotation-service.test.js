/**
 * Tests for quotation-service — Tier 18 / B18-A (2026-05-16).
 *
 * Coverage:
 *   1. issueQuotationsForApplication creates BOTH DTAM + PLATFORM quotations
 *   2. Idempotent: a second call returns the same rows, not duplicates
 *   3. DTAM math: subtotal = stateTotal, vat = 0, installments by phase
 *   4. PLATFORM math: subtotal = platformTotal, vat = vatTotal, installments
 *      include VAT
 *   5. Multi-scope (3 cultivation methods) — DTAM 90,000, PLATFORM 9,000, VAT 630
 *   6. Receipt numbers allocated via receipt-numbering allocator (in-memory
 *      fallback path because prisma.receiptSequence is unavailable in tests)
 *   7. findQuotationById with reviewerSide filter (DTAM/PLATFORM isolation)
 *   8. markQuotationAccepted flips status + records acceptedAt
 */

const path = require('path');

// Mock the prisma client BEFORE requiring the service so the service picks
// up the mock rather than the live PG client. Tests drive the mock's
// findUnique / findMany / create / update / $transaction handlers.

const makeMockPrisma = () => {
    const applications = new Map();
    const quotations = new Map();
    const receiptSequenceFails = true; // route the service into in-memory
                                       // fallback for predictable numbering

    let quotationIdCounter = 0;
    function genId(prefix) {
        return `${prefix}-${(++quotationIdCounter).toString().padStart(4, '0')}`;
    }

    const client = {
        // Test-only seeding helpers
        __seedApplication(app) {
            applications.set(app.id, { ...app });
        },
        __getQuotations() {
            return Array.from(quotations.values());
        },
        application: {
            findUnique: jest.fn(async ({ where }) => {
                const a = applications.get(where.id);
                return a ? { ...a } : null;
            }),
        },
        quotation: {
            findMany: jest.fn(async ({ where }) => {
                const list = Array.from(quotations.values());
                return list.filter((q) => {
                    if (where.applicationId && q.applicationId !== where.applicationId) {
                        return false;
                    }
                    if (where.isDeleted === false && q.isDeleted) { return false; }
                    if (where.issuerType?.in
                        && !where.issuerType.in.includes(q.issuerType)) {
                        return false;
                    }
                    return true;
                });
            }),
            findFirst: jest.fn(async ({ where }) => {
                const list = Array.from(quotations.values());
                return list.find((q) => {
                    if (where.id && q.id !== where.id) { return false; }
                    if (where.isDeleted === false && q.isDeleted) { return false; }
                    return true;
                }) || null;
            }),
            create: jest.fn(async ({ data }) => {
                const id = genId('qt');
                const row = {
                    id,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    isDeleted: false,
                    acceptedAt: null,
                    rejectedAt: null,
                    notes: null,
                    applicantNotes: null,
                    updatedBy: null,
                    ...data,
                };
                quotations.set(id, row);
                return { ...row };
            }),
            update: jest.fn(async ({ where, data }) => {
                const existing = quotations.get(where.id);
                if (!existing) {
                    throw new Error('quotation not found');
                }
                const next = { ...existing, ...data, updatedAt: new Date() };
                quotations.set(where.id, next);
                return { ...next };
            }),
        },
        // The service's _allocateQuotationNumber path tries receiptSequence
        // first, then falls back to in-memory when it gets
        // RECEIPT_SEQUENCE_MODEL_MISSING. We trigger the fallback by leaving
        // the delegate absent.
        ...(receiptSequenceFails
            ? {}
            : { receiptSequence: { upsert: jest.fn() } }
        ),
    };
    // Fix round 1 (reviewer BLOCKER B1) — issuance now runs its re-probe and
    // its create inside ONE prisma.$transaction, so this passthrough is on the
    // hot path instead of being "never expected to fire". It used to call
    // `cb(this)`, and `this` inside an arrow function in an object literal is
    // the module scope, NOT the mock: every delegate the callback reached was
    // undefined. Assigned after the literal so the callback is handed the
    // client itself, which is what an interactive transaction hands its body.
    client.$transaction = jest.fn(async (cb /* , opts */) => (
        typeof cb === 'function' ? cb(client) : null
    ));
    return client;
};

// Stash the mock at module scope so jest.mock can pick it up via the factory.
// Jest's babel transform requires the variable name to start with "mock"
// (case-insensitive) for the factory to reference it.
let mockPrisma;
jest.mock('../../services/prisma-database', () => {
    return {
        get prisma() { return mockPrisma; },
    };
});

// Load helpers AFTER setting up the mock factory
function loadService() {
    delete require.cache[require.resolve(
        path.join(__dirname, '..', '..', 'services', 'quotation-service'),
    )];
    // Also reset receipt-numbering so its in-memory counter map is fresh
    delete require.cache[require.resolve(
        path.join(__dirname, '..', '..', 'services', 'receipt-numbering-service'),
    )];
    return require(path.join(__dirname, '..', '..', 'services', 'quotation-service'));
}

// F-G4-64 — markQuotationAccepted now refuses an acceptance carrying no
// snapshot (SNAPSHOT_REQUIRED): recording that someone pressed a button, with
// nothing about what they were shown, is not evidence. The tests below are
// about the STATUS transitions, so they hand over the row's OWN snapshot, built
// by the service's pure builder — never a hand-written figure.
// Fix round 1 (reviewer F2): the builder now REFUSES a row it cannot describe
// (no installments, or instalments with no money columns) rather than freezing
// a document of zeros. The one call below that has no row of its own — the
// unknown-id case — therefore hands over a well-formed stand-in row, so the
// rejection it asserts can still only come from the missing row.
const ANY_WELL_FORMED_ROW = {
    quotationNumber: 'QT-PRD-2026-000000',
    issuerType: 'PLATFORM',
    subtotal: '1.00',
    vat: '0.00',
    totalAmount: '1.00',
    installments: [
        { phase: 'PHASE_2', amount: 1, serviceFeeAmount: 1, vatAmount: 0, scopeCount: 1 },
    ],
};

function snapshotFor(svc, row) {
    return svc._internals.buildAcceptanceSnapshot(row || ANY_WELL_FORMED_ROW);
}

const APP_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = 'org-abc';

function seedSingleScopeApplication(extra = {}) {
    mockPrisma.__seedApplication({
        id: APP_ID,
        formData: { cultivationMethods: ['outdoor'] },
        totalAreaTypes: 1,
        organizationId: ORG_ID,
        isDeleted: false,
        ...extra,
    });
}

beforeEach(() => {
    mockPrisma = makeMockPrisma();
});

describe('[B18-A] quotation-service — issueQuotationsForApplication', () => {
    // W14 (operator ruling 2026-08-22, the change log c28355ea): this block used
    // to assert that ONE application produced TWO quotation rows — a DTAM row
    // for the VAT-exempt state fee and a PLATFORM row for the platform fee plus
    // VAT. The company is now the sole issuer: the farmer pays it once, and it
    // settles with DTAM outside this system. One application, one quotation,
    // carrying the whole price.
    test('creates ONE company quotation on first call (was a DTAM+PLATFORM pair)', async () => {
        const svc = loadService();
        seedSingleScopeApplication();

        const { company, dtam, platform } = await svc.issueQuotationsForApplication(APP_ID, {
            actorId: 'user-1',
        });

        expect(company).toBeTruthy();
        expect(company.issuerType).toBe('PLATFORM');
        // No DTAM row is written at all.
        expect(dtam).toBeNull();
        // `platform` is the same row under the key the schema column uses.
        expect(platform).toBe(company);
        expect(mockPrisma.quotation.create).toHaveBeenCalledTimes(1);
    });

    test('the company quotation: subtotal = ค่าบริการ, vat = 7% of it, total = payable', async () => {
        const svc = loadService();
        seedSingleScopeApplication();

        const { company } = await svc.issueQuotationsForApplication(APP_ID, {});
        // Single scope: state 30,000 + platform 3,000 = ค่าบริการ 33,000;
        // VAT 7% of 33,000 = 2,310; payable 35,310.
        expect(company.subtotal).toBe(33000);
        expect(company.vat).toBe(2310);
        expect(company.totalAmount).toBe(35310);
        expect(company.totalAmount).toBe(company.subtotal + company.vat);
        // GAP-5: installments carry the frozen per-phase split so downstream
        // billing can copy the accepted price (single price-of-record).
        // 2026-09-06 — `scopeBreakdown` joined the frozen split and no amount moved. The
        // fee is a SUM of the declared cultivation types (operator ruling), so the price of
        // record carries the per-type lines the quotation prints rather than leaving the
        // document to divide a phase total by a count.
        expect(company.installments).toEqual([
            {
                phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1,
                scopeBreakdown: [{ method: 'OUTDOOR', serviceFeeAmount: 5500, vatAmount: 385 }],
            },
            {
                phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1,
                scopeBreakdown: [{ method: 'OUTDOOR', serviceFeeAmount: 27500, vatAmount: 1925 }],
            },
        ]);
    });

    test('is idempotent — second call returns the same row, not a duplicate', async () => {
        const svc = loadService();
        seedSingleScopeApplication();

        const first = await svc.issueQuotationsForApplication(APP_ID, {});
        const second = await svc.issueQuotationsForApplication(APP_ID, {});

        expect(second.company.id).toBe(first.company.id);
        expect(mockPrisma.quotation.create).toHaveBeenCalledTimes(1);
    });

    /**
     * Fix round 1 (reviewer m3). `notes` is the ENTIRE recorded mitigation for
     * F-G4-69: a quotation issued late is priced at today's rate table, not at
     * the table in force on the application's submission date, and the only
     * thing that tells a later reader so is the 'ISSUED_LATE:' marker the
     * self-heal writes here (services/quotation-issuance-on-submit.js). If the
     * value stops reaching the row, that mitigation silently becomes a comment.
     *
     * BORN GREEN — a PIN, not a fix: `notes` already reaches db.quotation.create
     * (added earlier in this task). Nothing was broken and nothing was
     * repaired; what was missing was any test that would notice its removal.
     */
    test('opts.notes is stored on the row, so the ISSUED_LATE marker survives the write', async () => {
        const svc = loadService();
        seedSingleScopeApplication();

        const { company } = await svc.issueQuotationsForApplication(APP_ID, {
            notes: 'ISSUED_LATE: MISSING_AT_READ',
        });

        expect(company.notes).toMatch(/^ISSUED_LATE:/);
        const [stored] = mockPrisma.__getQuotations();
        expect(stored.notes).toMatch(/^ISSUED_LATE:/);
    });

    test('a quotation issued the normal way carries no ISSUED_LATE marker', async () => {
        const svc = loadService();
        seedSingleScopeApplication();

        const { company } = await svc.issueQuotationsForApplication(APP_ID, {});
        expect(company.notes).toBeNull();
    });

    test('allocates the company number with the QT-PRD prefix', async () => {
        const svc = loadService();
        seedSingleScopeApplication();

        const { company } = await svc.issueQuotationsForApplication(APP_ID, {});
        expect(company.quotationNumber).toMatch(/^QT-PRD-/);
        // CE year + Arabic numerals (B2B convention). The QT-DTAM stream with
        // Thai numerals is no longer drawn from — nothing is issued in DTAM's name.
        expect(company.quotationNumber).toMatch(/^QT-PRD-\d{4}-\d{6}$/);
    });

    test('multi-scope (3 cultivation methods) — ค่าบริการ 99,000, vat 6,930, payable 105,930', async () => {
        const svc = loadService();
        mockPrisma.__seedApplication({
            id: APP_ID,
            formData: { cultivationMethods: ['indoor', 'greenhouse', 'outdoor'] },
            totalAreaTypes: 3,
            organizationId: ORG_ID,
            isDeleted: false,
        });

        const { company } = await svc.issueQuotationsForApplication(APP_ID, {});
        // 3 scopes: state 90,000 + platform 9,000 = 99,000; VAT 6,930.
        expect(company.subtotal).toBe(99000);
        expect(company.vat).toBe(6930);
        expect(company.totalAmount).toBe(105930);
        // The three lines are in the order the filing declared them, and they sum to the
        // phase amounts above — that IS the price now, not a presentation of it.
        expect(company.installments).toEqual([
            {
                phase: 'PHASE_1', amount: 17655, serviceFeeAmount: 16500, vatAmount: 1155, scopeCount: 3,
                scopeBreakdown: [
                    { method: 'INDOOR', serviceFeeAmount: 5500, vatAmount: 385 },
                    { method: 'GREENHOUSE', serviceFeeAmount: 5500, vatAmount: 385 },
                    { method: 'OUTDOOR', serviceFeeAmount: 5500, vatAmount: 385 },
                ],
            },
            {
                phase: 'PHASE_2', amount: 88275, serviceFeeAmount: 82500, vatAmount: 5775, scopeCount: 3,
                scopeBreakdown: [
                    { method: 'INDOOR', serviceFeeAmount: 27500, vatAmount: 1925 },
                    { method: 'GREENHOUSE', serviceFeeAmount: 27500, vatAmount: 1925 },
                    { method: 'OUTDOOR', serviceFeeAmount: 27500, vatAmount: 1925 },
                ],
            },
        ]);
    });

    test('throws APPLICATION_NOT_FOUND when applicationId does not exist', async () => {
        const svc = loadService();
        await expect(
            svc.issueQuotationsForApplication('no-such-id', {}),
        ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
    });

    test('respects soft-deleted application', async () => {
        const svc = loadService();
        seedSingleScopeApplication({ isDeleted: true });

        await expect(
            svc.issueQuotationsForApplication(APP_ID, {}),
        ).rejects.toMatchObject({ code: 'APPLICATION_DELETED' });
    });
});

// W14 (operator ruling 2026-08-22, the change log c28355ea): the ACCOUNT_DTAM /
// ACCOUNT_PLATFORM isolation is RETIRED. It kept a DTAM accountant from seeing a
// PLATFORM quotation because the two issuers were different businesses with
// different ledgers and signing keys. With one issuer there is one ledger and
// nothing to separate — the filter would only hide the company's own quotation
// from the company's own accountant.
//
// `reviewerSide` is still HONOURED so historical DTAM rows do not become newly
// visible as a side effect of a pricing change; it simply no longer matches
// anything newly issued.
describe('[B18-A] quotation-service — findQuotationById reviewerSide (legacy filter)', () => {
    test('a new company quotation is visible to the company reviewer', async () => {
        const svc = loadService();
        seedSingleScopeApplication();
        const { company } = await svc.issueQuotationsForApplication(APP_ID, {});

        const seen = await svc.findQuotationById(company.id, { reviewerSide: 'PLATFORM' });
        expect(seen).toBeTruthy();
        expect(seen.id).toBe(company.id);
    });

    test('the legacy DTAM filter matches nothing newly issued', async () => {
        const svc = loadService();
        seedSingleScopeApplication();
        const { company } = await svc.issueQuotationsForApplication(APP_ID, {});

        // Not a leak: there IS no DTAM-side quotation any more.
        expect(await svc.findQuotationById(company.id, { reviewerSide: 'DTAM' })).toBeNull();
    });

    test('no reviewerSide filter returns the row', async () => {
        const svc = loadService();
        seedSingleScopeApplication();
        const { company } = await svc.issueQuotationsForApplication(APP_ID, {});

        expect(await svc.findQuotationById(company.id)).toBeTruthy();
    });
});

describe('[B18-A] quotation-service — findQuotationsByApplicationId', () => {
    test('returns the ONE company row; the DTAM slot is empty (W14)', async () => {
        const svc = loadService();
        seedSingleScopeApplication();
        await svc.issueQuotationsForApplication(APP_ID, {});

        const { dtam, platform } = await svc.findQuotationsByApplicationId(APP_ID);
        // Was: both slots populated, one row per issuer. One issuer now.
        expect(platform.issuerType).toBe('PLATFORM');
        expect(dtam).toBeNull();
    });

    test('returns nulls when no quotations exist', async () => {
        const svc = loadService();
        seedSingleScopeApplication();

        const result = await svc.findQuotationsByApplicationId(APP_ID);
        expect(result.dtam).toBeNull();
        expect(result.platform).toBeNull();
    });
});

describe('[B18-A] quotation-service — markQuotationAccepted', () => {
    test('flips PENDING → ACCEPTED and records acceptedAt', async () => {
        const svc = loadService();
        seedSingleScopeApplication();
        const { company: dtam } = await svc.issueQuotationsForApplication(APP_ID, {});
        expect(dtam.status).toBe('PENDING');

        const accepted = await svc.markQuotationAccepted(dtam.id, {
            acceptedBy: 'user-1', snapshot: snapshotFor(svc, dtam),
        });
        expect(accepted.status).toBe('ACCEPTED');
        expect(accepted.acceptedAt).toBeTruthy();
        expect(accepted.updatedBy).toBe('user-1');
    });

    test('is a no-op when already ACCEPTED (idempotent)', async () => {
        const svc = loadService();
        seedSingleScopeApplication();
        const { company: dtam } = await svc.issueQuotationsForApplication(APP_ID, {});

        const once = await svc.markQuotationAccepted(dtam.id, {
            acceptedBy: 'u1', snapshot: snapshotFor(svc, dtam),
        });
        const twice = await svc.markQuotationAccepted(dtam.id, {
            acceptedBy: 'u2', snapshot: snapshotFor(svc, dtam),
        });
        expect(twice.status).toBe('ACCEPTED');
        // acceptedAt does not get bumped on the second call
        expect(twice.acceptedAt).toEqual(once.acceptedAt);
    });

    test('throws INVALID_QUOTATION_STATUS for non-acceptable states', async () => {
        const svc = loadService();
        seedSingleScopeApplication();
        const { company: dtam } = await svc.issueQuotationsForApplication(APP_ID, {});
        await svc.markQuotationAccepted(dtam.id, {
            acceptedBy: 'u1', snapshot: snapshotFor(svc, dtam),
        });
        // Forcibly move to INVOICED
        await svc.markQuotationInvoiced(dtam.id);

        // Trying to flip INVOICED → ACCEPTED is illegal
        await expect(
            svc.markQuotationAccepted(dtam.id, {
                acceptedBy: 'u1', snapshot: snapshotFor(svc, dtam),
            }),
        ).rejects.toMatchObject({ code: 'INVALID_QUOTATION_STATUS' });
    });

    test('throws QUOTATION_NOT_FOUND for an unknown id', async () => {
        const svc = loadService();
        await expect(
            // A snapshot IS supplied, so the rejection can only come from the
            // missing row — not from the new SNAPSHOT_REQUIRED guard.
            svc.markQuotationAccepted('bogus', {
                acceptedBy: 'u1', snapshot: snapshotFor(svc, null),
            }),
        ).rejects.toMatchObject({ code: 'QUOTATION_NOT_FOUND' });
    });
});

describe('[B18-A] quotation-service — markQuotationInvoiced', () => {
    test('flips ACCEPTED → INVOICED', async () => {
        const svc = loadService();
        seedSingleScopeApplication();
        const { company: dtam } = await svc.issueQuotationsForApplication(APP_ID, {});
        await svc.markQuotationAccepted(dtam.id, {
            acceptedBy: 'u1', snapshot: snapshotFor(svc, dtam),
        });

        const invoiced = await svc.markQuotationInvoiced(dtam.id);
        expect(invoiced.status).toBe('INVOICED');
    });

    test('refuses to move PENDING → INVOICED directly', async () => {
        const svc = loadService();
        seedSingleScopeApplication();
        const { company: dtam } = await svc.issueQuotationsForApplication(APP_ID, {});

        await expect(
            svc.markQuotationInvoiced(dtam.id),
        ).rejects.toMatchObject({ code: 'INVALID_QUOTATION_STATUS' });
    });
});

describe('[R6-B] quotation-service — production safety (no in-memory fallback)', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = originalNodeEnv;
        }
    });

    test('NODE_ENV=production throws QUOTATION_NUMBER_DB_UNAVAILABLE when prisma.receiptSequence is missing', async () => {
        process.env.NODE_ENV = 'production';
        const svc = loadService();
        seedSingleScopeApplication();

        try {
            await svc.issueQuotationsForApplication(APP_ID, {});
            throw new Error('expected throw — production must refuse the in-memory fallback');
        } catch (err) {
            expect(err.code).toBe('QUOTATION_NUMBER_DB_UNAVAILABLE');
            expect(err.message).toMatch(/npx prisma migrate deploy/);
            // The underlying root-cause should be attached for ops triage
            expect(err.cause).toBeTruthy();
        }
    });

    test('NODE_ENV=test keeps the existing in-memory fallback (back-compat)', async () => {
        process.env.NODE_ENV = 'test';
        const svc = loadService();
        seedSingleScopeApplication();

        const { company } = await svc.issueQuotationsForApplication(APP_ID, {});
        // W14 — one number, from the company's QT-PRD stream. The QT-DTAM
        // stream is no longer drawn from.
        expect(company.quotationNumber).toMatch(/^QT-PRD-/);
    });

    test('NODE_ENV=development keeps the existing in-memory fallback (back-compat)', async () => {
        process.env.NODE_ENV = 'development';
        const svc = loadService();
        seedSingleScopeApplication();

        const { company } = await svc.issueQuotationsForApplication(APP_ID, {});
        // W14 — one number, from the company's QT-PRD stream. The QT-DTAM
        // stream is no longer drawn from.
        expect(company.quotationNumber).toMatch(/^QT-PRD-/);
    });
});

// ── GAP-5: getFrozenPhaseFees — the single frozen price-of-record ─────────────
// The accepted quotation's enriched installments are the authoritative price.
// getFrozenPhaseFees reconstructs the per-phase breakdown so downstream billing
// (invoice mint, phase-payment) can COPY it instead of recomputing from mutable
// formData. Returns null (→ caller recomputes) for no-quote / legacy quotes.
describe('getFrozenPhaseFees — frozen price-of-record reader', () => {
    test('reconstructs the per-phase breakdown from issued quotations (single scope)', async () => {
        const svc = loadService();
        seedSingleScopeApplication();
        await svc.issueQuotationsForApplication(APP_ID, {});

        const frozen = await svc.getFrozenPhaseFees(APP_ID);
        // W12 (2026-08-22): `singleCharge` added to the returned shape when the
        // renewal single-charge quotation landed. Every AMOUNT below is
        // unchanged, byte for byte — only the new discriminator is asserted in
        // addition, and it is false here because this is an ordinary two-phase
        // application. See reports/design-cleanup-2026-08-21/W12-renewal-fast-path.md.
        expect(frozen).toEqual({
            scopeCount: 1,
            phase1: { serviceFeeAmount: 5500, vatAmount: 385, phaseTotal: 5885 },
            phase2: { serviceFeeAmount: 27500, vatAmount: 1925, phaseTotal: 29425 },
            singleCharge: false,
        });
    });

    test('reconstructs multi-scope breakdown (3 cultivation methods)', async () => {
        const svc = loadService();
        mockPrisma.__seedApplication({
            id: APP_ID,
            formData: { cultivationMethods: ['indoor', 'greenhouse', 'outdoor'] },
            totalAreaTypes: 3,
            organizationId: ORG_ID,
            isDeleted: false,
        });
        await svc.issueQuotationsForApplication(APP_ID, {});

        const frozen = await svc.getFrozenPhaseFees(APP_ID);
        expect(frozen.scopeCount).toBe(3);
        expect(frozen.phase1).toEqual({ serviceFeeAmount: 16500, vatAmount: 1155, phaseTotal: 17655 });
        expect(frozen.phase2).toEqual({ serviceFeeAmount: 82500, vatAmount: 5775, phaseTotal: 88275 });
    });

    test('returns null when no quotation exists (→ caller recomputes)', async () => {
        const svc = loadService();
        seedSingleScopeApplication();
        // no issueQuotationsForApplication call
        const frozen = await svc.getFrozenPhaseFees(APP_ID);
        expect(frozen).toBeNull();
    });

    test('returns null for a legacy quotation whose installments lack the split (→ caller recomputes)', async () => {
        const svc = loadService();
        seedSingleScopeApplication();
        // Seed a pre-GAP-5 quotation row: installments carry only {phase, amount}.
        await mockPrisma.quotation.create({
            data: {
                applicationId: APP_ID,
                issuerType: 'DTAM',
                installments: [
                    { phase: 'PHASE_1', amount: 5000 },
                    { phase: 'PHASE_2', amount: 25000 },
                ],
                isDeleted: false,
            },
        });

        const frozen = await svc.getFrozenPhaseFees(APP_ID);
        expect(frozen).toBeNull();
    });
});
