'use strict';
/**
 * The quotation the applicant is shown is the row, not a recomputation
 * (spec 3.2, closing channel C of synthesis.md 3.3).
 *
 * GET /api/applications/:id/quotations used to recompute at the CURRENT rate
 * (routes/api/applications/quotations.js:163) and generateQuotationPdf did the
 * same (invoice-template-service.js:1021). If the rate table moves, the row,
 * the screen and the PDF are three different numbers, while
 * docs/legal/payment-terms-th-v1.2.md §3.4 binds the price of the accepted quotation.
 *
 * Fix round 1 (reviewer F1/F2/F3):
 *   - F1: a pre-W14 application has TWO rows whose split fields are identical
 *     and full-phase; only `amount` is that issuer's own money. Rendering the
 *     split printed the whole 33,210 THB price on BOTH cards.
 *   - F2: a pre-GAP-5 row carries `{phase, amount}` only, and rendering its
 *     absent split printed 0.00 under a real total.
 *   - F3: the first two describe blocks below are pure; the ROUTE block mounts
 *     the real router over a mocked Prisma so the four production edits
 *     (list branch, accept snapshot, PDF row hand-off, refusal mapping) are
 *     covered by a shipped test instead of by a deleted probe.
 */

const request = require('supertest');
const express = require('express');

const { buildQuotationLineItemsFromRow } = require('../../services/quotation-line-items');
const { getMessage, lookup } = require('../../shared/error-codes');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateAny: (req, _res, next) => {
        req.user = { id: 'user-1', canonicalId: 'h-1', canonicalRole: 'health' };
        next();
    },
    authenticateHealth: (req, _res, next) => {
        req.user = { id: 'user-1', canonicalId: 'h-1', canonicalRole: 'health' };
        next();
    },
    authenticateProvider: (req, _res, next) => next(),
}));

const mockGetApplicationSlice = jest.fn();
const mockEnsurePhaseInvoices = jest.fn(async () => ({ skipped: 'CHECKOUT_RAIL' }));
jest.mock('../../services/application-service', () => ({
    getApplicationSlice: (...a) => mockGetApplicationSlice(...a),
    // ประตูใบเสนอราคาถามความเป็นเจ้าของผ่านตัวตัดสินร่วมของระบบแล้ว (applicant → User.id)
    // แทนการเทียบ healthId ซึ่งอาจถูก redact ตามผู้เช่า
    // Spec 2026-09-30 §3.1: the lookup takes the caller's holder scope, not an id.
    findOwnedApplicationForApplicant: jest.fn(async (id, options) => (
        options?.holderScope?.userId === 'user-1' ? { id, isDeleted: false } : null
    )),
    resolveHealthIdentity: jest.fn(async () => ({ healthId: 'h-1', userId: 'user-1' })),
    ensurePhaseInvoices: (...a) => mockEnsurePhaseInvoices(...a),
}));

// The PDF engine is stubbed, the template service is REAL — the rendered HTML
// is captured so the route's hand-off of the stored row can be read off it.
const mockCapture = { html: '' };
jest.mock('../../services/pdf/pdf-generator.service', () => ({
    readTemplateCached: () => 'DOC=[[{{DOC_NUMBER}}]] ITEMS={{ITEMS_ROWS}} TOTAL=[[{{GRAND_TOTAL}}]]',
    replaceTemplateVariables: (tpl, data) =>
        tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(data[k] === undefined ? '' : data[k])),
    generatePDF: async (html) => { mockCapture.html = html; return Buffer.from('PDF'); },
}));

const mockQuotationFindMany = jest.fn();
const mockQuotationFindFirst = jest.fn();
const mockQuotationUpdate = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        quotation: {
            findMany: (...a) => mockQuotationFindMany(...a),
            findFirst: (...a) => mockQuotationFindFirst(...a),
            update: (...a) => mockQuotationUpdate(...a),
        },
    },
}));

const quotationService = require('../../services/quotation-service');
const quotationsRouter = require('../../routes/api/applications/quotations');

const APP_ID = 'app-1';

/** The W14 single-issuer row: ONE document carrying the whole price. */
const ROW = {
    id: 'qt-1',
    quotationNumber: 'QT-PRD-2026-000001',
    issuerType: 'PLATFORM',
    status: 'ACCEPTED',
    subtotal: '33000.00',
    vat: '2310.00',
    totalAmount: '35310.00',
    installments: [
        { phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
        { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
    ],
    acceptedSnapshot: null,
};

/**
 * The pre-W14 PAIR. Both rows carry the SAME full-phase split (verified against
 * _buildInstallments at 6248a0d1^); only `amount` differs, and only `amount` is
 * the money that document actually asks for.
 */
const PRE_W14_DTAM = {
    id: 'qt-dtam',
    quotationNumber: 'QT-DTAM-2026-000007',
    issuerType: 'DTAM',
    status: 'PENDING',
    subtotal: '30000.00',
    vat: '0.00',
    totalAmount: '30000.00',
    installments: [
        { phase: 'PHASE_1', amount: 5000, serviceFeeAmount: 5500, vatAmount: 35, scopeCount: 1 },
        { phase: 'PHASE_2', amount: 25000, serviceFeeAmount: 27500, vatAmount: 175, scopeCount: 1 },
    ],
    acceptedSnapshot: null,
};

const PRE_W14_PLATFORM = {
    ...PRE_W14_DTAM,
    id: 'qt-plat',
    quotationNumber: 'QT-PRD-2026-000007',
    issuerType: 'PLATFORM',
    subtotal: '3000.00',
    vat: '210.00',
    totalAmount: '3210.00',
    installments: [
        { phase: 'PHASE_1', amount: 535, serviceFeeAmount: 5500, vatAmount: 35, scopeCount: 1 },
        { phase: 'PHASE_2', amount: 2675, serviceFeeAmount: 27500, vatAmount: 175, scopeCount: 1 },
    ],
};

/** The row class GAP-5 replaced: `{phase, amount}` and nothing else. */
const PRE_GAP5 = {
    ...ROW,
    id: 'qt-legacy',
    status: 'PENDING',
    installments: [
        { phase: 'PHASE_1', amount: 5535 },
        { phase: 'PHASE_2', amount: 27675 },
    ],
};

describe('buildQuotationLineItemsFromRow — the stored row, never a recompute', () => {
    test('line items come from the stored installments, at the row scopeCount', () => {
        const items = buildQuotationLineItemsFromRow(ROW, ['outdoor']);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            method: 'outdoor', phase1Amount: 5885, phase2Amount: 29425,
        });
    });

    test('a row written under the retired VAT base renders THAT row, not the current formula', () => {
        const legacy = {
            ...ROW,
            installments: [
                { phase: 'PHASE_1', amount: 5535, serviceFeeAmount: 5500, vatAmount: 35, scopeCount: 1 },
                { phase: 'PHASE_2', amount: 27675, serviceFeeAmount: 27500, vatAmount: 175, scopeCount: 1 },
            ],
        };
        const items = buildQuotationLineItemsFromRow(legacy, ['outdoor']);
        // Under the live formula these would be 5,885 / 29,425.
        expect(items[0].phase1Amount).toBe(5535);
        expect(items[0].phase2Amount).toBe(27675);
    });

    test('a 3-scope row splits the stored totals across the three methods, summing back exactly', () => {
        const three = {
            ...ROW,
            installments: [
                { phase: 'PHASE_1', amount: 17655, serviceFeeAmount: 16500, vatAmount: 1155, scopeCount: 3 },
                { phase: 'PHASE_2', amount: 88275, serviceFeeAmount: 82500, vatAmount: 5775, scopeCount: 3 },
            ],
        };
        const items = buildQuotationLineItemsFromRow(three, ['indoor', 'greenhouse', 'outdoor']);
        expect(items).toHaveLength(3);
        expect(items.reduce((s, i) => s + i.phase1Amount, 0)).toBe(17655);
        expect(items.reduce((s, i) => s + i.phase2Amount, 0)).toBe(88275);
    });

    test('an accepted row renders its FROZEN snapshot, even if the installments were later touched', () => {
        const accepted = {
            ...ROW,
            acceptedSnapshot: {
                installments: [
                    { phase: 'PHASE_1', amount: '5885.00', stateAmount: '5000.00', platformAmount: '500.00', vatAmount: '385.00', phaseTotal: '5885.00' },
                    { phase: 'PHASE_2', amount: '29425.00', stateAmount: '25000.00', platformAmount: '2500.00', vatAmount: '1925.00', phaseTotal: '29425.00' },
                ],
                scopeCount: 1,
            },
            installments: [
                { phase: 'PHASE_1', amount: 9999, serviceFeeAmount: 9900, vatAmount: 99, scopeCount: 1 },
                { phase: 'PHASE_2', amount: 9999, serviceFeeAmount: 9900, vatAmount: 99, scopeCount: 1 },
            ],
        };
        const items = buildQuotationLineItemsFromRow(accepted, ['outdoor']);
        expect(items[0].phase1Amount).toBe(5885);
    });

    // ── Fix round 1 — F1 ──

    test('each pre-W14 card shows ITS OWN money, and its lines sum to its own total', () => {
        const dtam = buildQuotationLineItemsFromRow(PRE_W14_DTAM, ['outdoor']);
        const platform = buildQuotationLineItemsFromRow(PRE_W14_PLATFORM, ['outdoor']);

        // The state document asks for the state fee; the platform document asks
        // for the platform fee + VAT. Before this fix BOTH printed 5,535 /
        // 27,675 — the whole phase, twice, 66,420 THB of lines under a true
        // price of 33,210.
        expect([dtam[0].phase1Amount, dtam[0].phase2Amount]).toEqual([5000, 25000]);
        expect([platform[0].phase1Amount, platform[0].phase2Amount]).toEqual([535, 2675]);

        const cardTotal = (items) => items.reduce((s, i) => s + i.phase1Amount + i.phase2Amount, 0);
        expect(cardTotal(dtam)).toBe(Number(PRE_W14_DTAM.totalAmount));
        expect(cardTotal(platform)).toBe(Number(PRE_W14_PLATFORM.totalAmount));
        expect(cardTotal(dtam) + cardTotal(platform)).toBe(33210);
    });

    test('the VAT column no longer branches on the issuer — no side is exempt', () => {
        // Until 2026-09-11 the state side was rendered VAT-exempt (taxAmount 0,
        // net = the whole total) on the strength of ม.77/1(10). The operator
        // reversed F3: there is one issuer, the company, and nothing it bills is
        // exempt — so BOTH legacy rows are now rendered by one path with the VAT
        // their own instalments carry (35 + 175 = 210).
        //
        // Each card still adds up to its OWN total, which is what stops a
        // pre-W14 pair from printing the whole phase twice.
        const dtam = buildQuotationLineItemsFromRow(PRE_W14_DTAM, ['outdoor'])[0];
        const platform = buildQuotationLineItemsFromRow(PRE_W14_PLATFORM, ['outdoor'])[0];
        expect(dtam.taxAmount).toBe(210);
        expect(dtam.netAmount + dtam.taxAmount).toBe(Number(PRE_W14_DTAM.totalAmount));
        expect(platform.taxAmount).toBe(210);
        expect(platform.netAmount + platform.taxAmount).toBe(Number(PRE_W14_PLATFORM.totalAmount));
    });

    // ── Fix round 1 — F2 ──

    test('a pre-GAP-5 row falls back to its `amount`, never to a row of zeros', () => {
        const items = buildQuotationLineItemsFromRow(PRE_GAP5, ['outdoor']);
        expect(items[0].phase1Amount).toBe(5535);
        expect(items[0].phase2Amount).toBe(27675);
    });

    test('a frozen snapshot of a pre-W14 side renders the frozen `amount`, not the full-phase split', () => {
        const accepted = {
            ...PRE_W14_DTAM,
            status: 'ACCEPTED',
            acceptedSnapshot: {
                issuerType: 'DTAM',
                scopeCount: 1,
                installments: [
                    { phase: 'PHASE_1', amount: '5000.00', stateAmount: '5000.00', platformAmount: '500.00', vatAmount: '35.00', phaseTotal: '5535.00' },
                    { phase: 'PHASE_2', amount: '25000.00', stateAmount: '25000.00', platformAmount: '2500.00', vatAmount: '175.00', phaseTotal: '27675.00' },
                ],
            },
        };
        const items = buildQuotationLineItemsFromRow(accepted, ['outdoor']);
        expect([items[0].phase1Amount, items[0].phase2Amount]).toEqual([5000, 25000]);
    });
});

// ── Fix round 1 — F3: the ROUTE, over a mocked Prisma and a real service ──

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications/:applicationId/quotations', quotationsRouter);
    return app;
}

/** getApplicationSlice serves two different selects on this route. */
function seedApplication(formData = { cultivationMethods: ['outdoor'] }, scopeCount = 1) {
    mockGetApplicationSlice.mockImplementation(async (id, { select } = {}) => {
        if (select && select.healthId) {
            return { id, healthId: 'h-1', isDeleted: false };
        }
        return {
            id,
            applicationNumber: 'GACP-TH-2569-000123',
            formData,
            totalAreaTypes: scopeCount,
            cultivationScopeCount: scopeCount,
        };
    });
}

describe('GET /api/applications/:id/quotations — the API renders the row', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCapture.html = '';
        seedApplication();
        mockEnsurePhaseInvoices.mockResolvedValue({ skipped: 'CHECKOUT_RAIL' });
    });

    it('serves only the company row — the ministry card is gone from the response', async () => {
        // The response used to carry a `dtam` card beside the company one, and
        // a pre-W14 application showed both. operator 2026-09-11: there is one
        // issuer, so the API answers with one document. The legacy ministry row
        // is still in the table, untouched and un-repriced (the self-heal
        // declines to replace a pair) — it is simply not a document this door
        // hands out any more.
        mockQuotationFindMany.mockResolvedValue([PRE_W14_DTAM, PRE_W14_PLATFORM]);

        const res = await request(buildApp()).get(`/api/applications/${APP_ID}/quotations`);

        expect(res.status).toBe(200);
        const { dtam, platform } = res.body.data;
        expect(dtam).toBeUndefined();
        expect(platform.lineItems.map((i) => [i.phase1Amount, i.phase2Amount])).toEqual([[535, 2675]]);
        // The card's lines must add up to the total printed beneath them.
        const cardTotal = (row) => row.lineItems.reduce((s, i) => s + i.phase1Amount + i.phase2Amount, 0);
        expect(cardTotal(platform)).toBe(Number(platform.totalAmount));
    });

    it('renders the FROZEN snapshot of an accepted row, not the row installments that followed it', async () => {
        mockQuotationFindMany.mockResolvedValue([{
            ...ROW,
            acceptedSnapshot: {
                issuerType: 'PLATFORM',
                scopeCount: 1,
                installments: [
                    { phase: 'PHASE_1', amount: '5885.00', stateAmount: '5000.00', platformAmount: '500.00', vatAmount: '385.00', phaseTotal: '5885.00' },
                    { phase: 'PHASE_2', amount: '29425.00', stateAmount: '25000.00', platformAmount: '2500.00', vatAmount: '1925.00', phaseTotal: '29425.00' },
                ],
            },
            installments: [
                { phase: 'PHASE_1', amount: 9999, serviceFeeAmount: 9900, vatAmount: 99, scopeCount: 1 },
                { phase: 'PHASE_2', amount: 9999, serviceFeeAmount: 9900, vatAmount: 99, scopeCount: 1 },
            ],
        }]);

        const res = await request(buildApp()).get(`/api/applications/${APP_ID}/quotations`);

        expect(res.status).toBe(200);
        expect(res.body.data.platform.lineItems[0].phase1Amount).toBe(5885);
    });

    // the backlog ~line 611 — the checkout screen printed the
    // application's UUID under "เลขคำขอ" for lack of anywhere else on that
    // page's own data to read the human-facing number from. This door
    // already selects `applicationNumber` (seedApplication above) to build
    // the payer/copy blocks; it just never put it on the wire.
    it('carries the applicationNumber the select already reads — no second source', async () => {
        mockQuotationFindMany.mockResolvedValue([ROW]);

        const res = await request(buildApp()).get(`/api/applications/${APP_ID}/quotations`);

        expect(res.status).toBe(200);
        expect(res.body.data.applicationNumber).toBe('GACP-TH-2569-000123');
    });
});

describe('POST /api/applications/:id/quotations/:issuerType/accept — freezes the row', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        seedApplication();
        mockEnsurePhaseInvoices.mockResolvedValue({ skipped: 'CHECKOUT_RAIL' });
        mockQuotationUpdate.mockImplementation(async ({ data }) => ({ ...ROW, ...data }));
    });

    it('stores the snapshot built from THAT row, with its hash', async () => {
        const pending = { ...PRE_W14_PLATFORM, status: 'PENDING' };
        mockQuotationFindMany.mockResolvedValue([pending]);
        mockQuotationFindFirst.mockResolvedValue(pending);

        const res = await request(buildApp())
            .post(`/api/applications/${APP_ID}/quotations/PLATFORM/accept`)
            .send({});

        expect(res.status).toBe(200);
        const { data } = mockQuotationUpdate.mock.calls[0][0];
        expect(data.status).toBe('ACCEPTED');
        expect(data.acceptedSnapshot.installments.map((i) => i.amount)).toEqual(['535.00', '2675.00']);
        expect(data.acceptedSnapshot.totalAmount).toBe('3210.00');
        expect(data.acceptedSnapshotHash)
            .toBe(quotationService.canonicalSnapshotHash(data.acceptedSnapshot));
    });

    it('REFUSES a pre-GAP-5 row with the catalogued SNAPSHOT_REQUIRED copy, and writes nothing', async () => {
        mockQuotationFindMany.mockResolvedValue([PRE_GAP5]);
        mockQuotationFindFirst.mockResolvedValue(PRE_GAP5);

        const res = await request(buildApp())
            .post(`/api/applications/${APP_ID}/quotations/PLATFORM/accept`)
            .send({});

        expect(res.status).toBe(lookup('SNAPSHOT_REQUIRED').httpStatus);
        expect(res.body.error).toBe('SNAPSHOT_REQUIRED');
        // F6 — one source for the copy: the catalogue, not a literal in the route.
        expect(res.body.message).toBe(getMessage('SNAPSHOT_REQUIRED', 'th'));
        expect(mockQuotationUpdate).not.toHaveBeenCalled();
    });

    // Fix round 4 (R2): a document that cannot be frozen is the applicant's
    // request being refused, not the server failing. 409, from the catalogue.
    it('answers the snapshot refusal as a 409, not a 500', async () => {
        mockQuotationFindMany.mockResolvedValue([PRE_GAP5]);
        mockQuotationFindFirst.mockResolvedValue(PRE_GAP5);

        const res = await request(buildApp())
            .post(`/api/applications/${APP_ID}/quotations/PLATFORM/accept`)
            .send({});

        expect(res.status).toBe(409);
    });

    /**
     * Fix round 4 (R1). The gate refuses a still-unaccepted quotation past its
     * validity, so the acceptance door has to refuse it too — otherwise the
     * applicant clears QUOTATION_EXPIRED by pressing the button the same screen
     * still draws, and the window binds nobody.
     */
    it('REFUSES a lapsed offer with the catalogued QUOTATION_EXPIRED copy, and writes nothing', async () => {
        const lapsed = {
            ...PRE_W14_PLATFORM,
            status: 'PENDING',
            validUntil: new Date('2026-07-01T00:00:00.000Z'),
        };
        mockQuotationFindMany.mockResolvedValue([lapsed]);
        mockQuotationFindFirst.mockResolvedValue(lapsed);

        const res = await request(buildApp())
            .post(`/api/applications/${APP_ID}/quotations/PLATFORM/accept`)
            .send({});

        expect(res.status).toBe(lookup('QUOTATION_EXPIRED').httpStatus);
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('QUOTATION_EXPIRED');
        expect(res.body.message).toBe(getMessage('QUOTATION_EXPIRED', 'th'));
        expect(mockQuotationUpdate).not.toHaveBeenCalled();
    });
});

describe('GET /:issuerType/pdf — the document is the row', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCapture.html = '';
        seedApplication();
    });

    it('prints the W14 row figures for phase 1 (5,885 per scope, not the platform-only 885)', async () => {
        mockQuotationFindMany.mockResolvedValue([{
            ...ROW,
            acceptedSnapshot: {
                quotationNumber: ROW.quotationNumber,
                issuerType: 'PLATFORM',
                scopeCount: 1,
                installments: [
                    { phase: 'PHASE_1', amount: '5885.00', stateAmount: '5000.00', platformAmount: '500.00', vatAmount: '385.00', phaseTotal: '5885.00' },
                    { phase: 'PHASE_2', amount: '29425.00', stateAmount: '25000.00', platformAmount: '2500.00', vatAmount: '1925.00', phaseTotal: '29425.00' },
                ],
            },
        }]);

        const res = await request(buildApp())
            .get(`/api/applications/${APP_ID}/quotations/PLATFORM/pdf?phase=1`);

        expect(res.status).toBe(200);
        expect(mockCapture.html).toContain('TOTAL=[[5,885.00]]');
        // The retired per-side split printed the platform fee + VAT alone.
        expect(mockCapture.html).not.toContain('TOTAL=[[885.00]]');
        expect(mockCapture.html).toContain('DOC=[[QT-PRD-2026-000001]]');
    });

    it('REFUSES phase 1 of a renewal quotation instead of printing a 0.00 numbered document', async () => {
        const renewal = {
            ...ROW,
            quotationNumber: 'QT-PRD-2026-000042',
            subtotal: '27500.00',
            vat: '1925.00',
            totalAmount: '29425.00',
            acceptedSnapshot: {
                quotationNumber: 'QT-PRD-2026-000042',
                issuerType: 'PLATFORM',
                scopeCount: 1,
                installments: [
                    { phase: 'PHASE_2', amount: '29425.00', stateAmount: '25000.00', platformAmount: '2500.00', vatAmount: '1925.00', phaseTotal: '29425.00' },
                ],
            },
            installments: [ROW.installments[1]],
        };
        mockQuotationFindMany.mockResolvedValue([renewal]);

        const res = await request(buildApp())
            .get(`/api/applications/${APP_ID}/quotations/PLATFORM/pdf?phase=1`);

        expect(res.status).toBe(lookup('QUOTATION_PHASE_NOT_PRICED').httpStatus);
        expect(res.body.error).toBe('QUOTATION_PHASE_NOT_PRICED');
        expect(res.body.message).toBe(getMessage('QUOTATION_PHASE_NOT_PRICED', 'th'));
        expect(mockCapture.html).toBe('');
    });
});

// ── Ruling 12 (2026-08-28) — the row owns the line count, the application only
// names the lines ────────────────────────────────────────────────────────────
//
// Re-review N1: the divisor came from the row while the LIST came from the
// application's current cultivation methods, so a revision moved the money.
// A row accepted at three methods, revised to one, printed a single 5,885 +
// 29,425 line under a 105,930 footer; the reverse printed 105,930 of lines
// under a 35,310 footer.

/** Accepted at THREE methods: 17,655 + 88,275 = 105,930. */
const THREE_SCOPE_ROW = {
    ...ROW,
    id: 'qt-3scope',
    quotationNumber: 'QT-PRD-2026-000101',
    status: 'PENDING',
    subtotal: '99000.00',
    vat: '6930.00',
    totalAmount: '105930.00',
    installments: [
        { phase: 'PHASE_1', amount: 17655, serviceFeeAmount: 16500, vatAmount: 1155, scopeCount: 3 },
        { phase: 'PHASE_2', amount: 88275, serviceFeeAmount: 82500, vatAmount: 5775, scopeCount: 3 },
    ],
    acceptedSnapshot: null,
};

const lineSum = (items) => items.reduce((s, i) => s + i.phase1Amount + i.phase2Amount, 0);

describe('buildQuotationLineItemsFromRow — a revision cannot move the row (N1)', () => {
    test('accepted at 3 methods, revised to 1: three lines summing to the row total', () => {
        const items = buildQuotationLineItemsFromRow(THREE_SCOPE_ROW, ['OUTDOOR']);
        expect(items).toHaveLength(3);
        expect(lineSum(items)).toBe(Number(THREE_SCOPE_ROW.totalAmount)); // 105,930
    });

    test('accepted at 1 method, revised to 3: one line summing to the row total', () => {
        const items = buildQuotationLineItemsFromRow(ROW, ['INDOOR', 'GREENHOUSE', 'OUTDOOR']);
        expect(items).toHaveLength(1);
        expect(lineSum(items)).toBe(Number(ROW.totalAmount)); // 35,310
    });
});

describe('GET /api/applications/:id/quotations — the scope mismatch is declared (N1)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCapture.html = '';
        mockEnsurePhaseInvoices.mockResolvedValue({ skipped: 'CHECKOUT_RAIL' });
    });

    it('flags the row priced for three methods under an application now naming one', async () => {
        seedApplication({ cultivationMethods: ['outdoor'] }, 1);
        mockQuotationFindMany.mockResolvedValue([THREE_SCOPE_ROW]);

        const res = await request(buildApp()).get(`/api/applications/${APP_ID}/quotations`);

        expect(res.status).toBe(200);
        const { platform } = res.body.data;
        expect(platform.scopeMismatch).toBe(true);
        expect(platform.applicationScopeCount).toBe(1);
        expect(platform.lineItems).toHaveLength(3);
        expect(lineSum(platform.lineItems)).toBe(Number(platform.totalAmount));
        expect(platform.lineItems.map((i) => i.label)).toEqual([
            'รูปแบบการปลูกที่ 1', 'รูปแบบการปลูกที่ 2', 'รูปแบบการปลูกที่ 3',
        ]);
    });

    it('flags the row priced for one method under an application now naming three', async () => {
        seedApplication({ cultivationMethods: ['indoor', 'greenhouse', 'outdoor'] }, 3);
        mockQuotationFindMany.mockResolvedValue([ROW]);

        const res = await request(buildApp()).get(`/api/applications/${APP_ID}/quotations`);

        expect(res.status).toBe(200);
        const { platform } = res.body.data;
        expect(platform.scopeMismatch).toBe(true);
        expect(platform.applicationScopeCount).toBe(3);
        expect(platform.lineItems).toHaveLength(1);
        expect(lineSum(platform.lineItems)).toBe(Number(platform.totalAmount)); // 35,310
    });

    it('no mismatch when the counts agree: per-method labels, flag false', async () => {
        seedApplication({ cultivationMethods: ['indoor', 'greenhouse', 'outdoor'] }, 3);
        mockQuotationFindMany.mockResolvedValue([THREE_SCOPE_ROW]);

        const res = await request(buildApp()).get(`/api/applications/${APP_ID}/quotations`);

        expect(res.status).toBe(200);
        const { platform } = res.body.data;
        expect(platform.scopeMismatch).toBe(false);
        expect(platform.applicationScopeCount).toBe(3);
        expect(platform.lineItems.map((i) => i.label)).toEqual([
            'อาคารระบบปิด (Indoor)', 'โรงเรือน (Greenhouse)', 'กลางแจ้ง (Outdoor)',
        ]);
        expect(lineSum(platform.lineItems)).toBe(Number(platform.totalAmount));
    });
});

describe('GET /:issuerType/pdf — the document keeps the row line count (N1)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCapture.html = '';
    });

    /**
     * What N1 pins is WHOSE scope count decides the document: the stored row's,
     * never the application's current cultivationMethods.
     *
     * The count is expressed as a multiple of one scope's own rows rather than
     * as a literal (fix round 4). How many <tr> a single scope occupies is the
     * RENDERER's business and it changed underneath this file: a W14 scope is
     * now broken out into its ค่าธรรมเนียมกรม / ค่าบริการแพลตฟอร์ม / VAT
     * components, so the literal 3 and 1 below became 9 and 3 while nothing
     * about N1 changed. A literal here pins the wrong module's decision; the
     * ratio pins this one's. The per-scope figure is measured, and asserted to
     * be at least one line, so the comparison cannot pass vacuously.
     */
    async function renderPhase1(row, methods, scopeCount) {
        mockCapture.html = '';
        seedApplication({ cultivationMethods: methods }, scopeCount);
        mockQuotationFindMany.mockResolvedValue([row]);
        const res = await request(buildApp())
            .get(`/api/applications/${APP_ID}/quotations/PLATFORM/pdf?phase=1`);
        expect(res.status).toBe(200);
        return { html: mockCapture.html, rows: (mockCapture.html.match(/<tr>/g) || []).length };
    }

    it('prints the ROW`s three scopes and its phase-1 figure when the application names one method', async () => {
        const oneScope = await renderPhase1(ROW, ['outdoor'], 1);
        expect(oneScope.rows).toBeGreaterThanOrEqual(1);

        const threeScopes = await renderPhase1(THREE_SCOPE_ROW, ['outdoor'], 1);

        expect(threeScopes.html).toContain('TOTAL=[[17,655.00]]');
        expect(threeScopes.rows).toBe(3 * oneScope.rows);
    });

    it('prints the ROW`s ONE scope and its phase-1 figure when the application names three', async () => {
        const oneScope = await renderPhase1(ROW, ['outdoor'], 1);
        // The floor belongs on BOTH renders (fix round 1, reviewer minor):
        // without it, a renderer emitting no <tr> at all would satisfy the
        // equality below, and the TOTAL assertion does not read the table body.
        expect(oneScope.rows).toBeGreaterThanOrEqual(1);

        const three = await renderPhase1(ROW, ['indoor', 'greenhouse', 'outdoor'], 3);

        expect(three.html).toContain('TOTAL=[[5,885.00]]');
        expect(three.rows).toBe(oneScope.rows);
    });
});
