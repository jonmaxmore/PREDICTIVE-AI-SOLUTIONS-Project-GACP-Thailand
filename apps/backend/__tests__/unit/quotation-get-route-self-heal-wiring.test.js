'use strict';
/**
 * GET /api/applications/:id/quotations — the self-heal branch, through the REAL
 * router (fix round 1, reviewer m2).
 *
 * The helper's own suite proves what the helper decides. Nothing proved that
 * the ROUTE reaches it, or that it hands it the caller's role and the
 * application's status — and quotation-api-renders-the-row.test.js exercises
 * this handler only with fixtures that carry no status, where the self-heal
 * short-circuits before it does anything at all. So the wiring was invisible:
 * dropping the role, the status or the whole call broke no test.
 *
 * What is pinned here:
 *   1. an applicant-owner reading a payable application with no quotation gets
 *      one minted, marked ISSUED_LATE, and rendered in the same response;
 *   2. a PROVIDER reading the same application gets the same answer WITHOUT a
 *      document being created — this is a state-changing GET behind
 *      sameSite:'lax' cookie auth, so a link in an email reaches it;
 *   3. a read of an application outside the payable window mints nothing;
 *   4. the read never fails because issuance did.
 */

const express = require('express');
const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateAny: (req, _res, next) => { req.user = mockCurrentUser; next(); },
    authenticateHealth: (req, _res, next) => { req.user = mockCurrentUser; next(); },
    authenticateProvider: (req, _res, next) => { req.user = mockCurrentUser; next(); },
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

const mockAuditLog = jest.fn(async () => ({ id: 'audit-1' }));
jest.mock('../../middleware/audit-logger', () => {
    const actual = jest.requireActual('../../middleware/audit-logger');
    return { ...actual, auditLogger: { log: (...a) => mockAuditLog(...a) } };
});

const APP_ROW = {
    id: 'app-1',
    healthId: 'h-1',
    isDeleted: false,
    status: 'PENDING_DOC_FEE',
    applicationNumber: 'APP-2026-100',
    organizationId: 'org-1',
    formData: { cultivationMethods: ['outdoor'] },
    cultivationScopeCount: 1,
    totalAreaTypes: 1,
};
let appRow = { ...APP_ROW };

// Honours `select` the way Prisma does, so a column the route forgets to ask
// for is genuinely absent here too.
const mockGetApplicationSlice = jest.fn(async (_id, opts = {}) => {
    if (!appRow) { return null; }
    if (!opts.select) { return appRow; }
    return Object.fromEntries(Object.entries(appRow).filter(([k]) => opts.select[k]));
});
jest.mock('../../services/application-service', () => ({
    getApplicationSlice: (...a) => mockGetApplicationSlice(...a),
    // ประตูใบเสนอราคาถามความเป็นเจ้าของผ่านตัวตัดสินร่วมของระบบแล้ว (applicant → User.id)
    // แทนการเทียบ healthId ซึ่งอาจถูก redact ตามผู้เช่า
    findOwnedApplicationForApplicant: jest.fn(async (id, options) => (
        mockCallerOwnsTheApplication && options?.holderScope?.userId === 'user-1' ? { id, isDeleted: false } : null
    )),
    resolveHealthIdentity: jest.fn(async () => ({ healthId: 'h-1', userId: 'user-1' })),
    ensurePhaseInvoices: jest.fn(async () => ({ skipped: 'CHECKOUT_RAIL' })),
}));

/** ความเป็นเจ้าของตัดสินจากความสัมพันธ์ applicant → User.id ไม่ใช่จาก healthId บนแถวอีกแล้ว */
let mockCallerOwnsTheApplication = true;
const mockFind = jest.fn();
const mockIssue = jest.fn();
jest.mock('../../services/quotation-service', () => ({
    findQuotationsByApplicationId: (...a) => mockFind(...a),
    issueQuotationsForApplication: (...a) => mockIssue(...a),
    findQuotationById: jest.fn(async () => null),
    markQuotationAccepted: jest.fn(),
}));

const quotationsRouter = require('../../routes/api/applications/quotations');

const MINTED_ROW = {
    id: 'qt-1',
    quotationNumber: 'QT-PRD-2026-000009',
    issuerType: 'PLATFORM',
    status: 'PENDING',
    subtotal: '33000.00',
    vat: '2310.00',
    totalAmount: '35310.00',
    notes: 'ISSUED_LATE: MISSING_AT_READ',
    installments: [
        { phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
        { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
    ],
};

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications/:applicationId/quotations', quotationsRouter);
    return app;
}

const OWNER = { id: 'user-1', canonicalId: 'h-1', healthId: 'h-1', canonicalRole: 'health' };
const ACCOUNTANT = { id: 'user-9', canonicalRole: 'finance_officer_platform' };

describe('the GET door\'s self-heal branch', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => {
        jest.clearAllMocks();
        appRow = { ...APP_ROW };
        mockCurrentUser = OWNER;
        mockCallerOwnsTheApplication = true;
    });

    it('mints the missing quotation for the applicant-owner and renders it in the same response', async () => {
        mockFind.mockResolvedValueOnce({ dtam: null, platform: null })
            .mockResolvedValueOnce({ dtam: null, platform: MINTED_ROW });
        mockIssue.mockResolvedValue({ company: MINTED_ROW, dtam: null, platform: MINTED_ROW });

        const r = await request(app).get('/api/applications/app-1/quotations');

        expect(r.status).toBe(200);
        // The row the route answers with is the one that was just created.
        expect(r.body.data.platform.id).toBe('qt-1');
        expect(r.body.data.platform.lineItems.length).toBeGreaterThan(0);
        // The marker that records F-G4-69 on the row survives the render.
        expect(r.body.data.platform.notes).toMatch(/^ISSUED_LATE:/);
        expect(mockIssue).toHaveBeenCalledWith('app-1', expect.objectContaining({
            actorId: 'user-1',
            notes: expect.stringMatching(/^ISSUED_LATE:/),
        }));
        expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
            action: 'QUOTATION_ISSUED_LATE',
            actorRole: 'health',
            resourceId: 'app-1',
            organizationId: 'org-1',
        }));
    });

    it('an ACCOUNTANT reading the same application creates nothing', async () => {
        mockCurrentUser = ACCOUNTANT;
        mockFind.mockResolvedValue({ dtam: null, platform: null });

        const r = await request(app).get('/api/applications/app-1/quotations');

        expect(r.status).toBe(200);
        expect(r.body.data.platform).toBeNull();
        expect(mockIssue).not.toHaveBeenCalled();
        expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('an application outside the payable window is read, not quoted', async () => {
        appRow = { ...APP_ROW, status: 'REJECTED' };
        mockFind.mockResolvedValue({ dtam: null, platform: null });

        const r = await request(app).get('/api/applications/app-1/quotations');

        expect(r.status).toBe(200);
        expect(r.body.data.platform).toBeNull();
        expect(mockIssue).not.toHaveBeenCalled();
    });

    it('a failed issuance still answers the read, it does not 500 it', async () => {
        mockFind.mockResolvedValue({ dtam: null, platform: null });
        mockIssue.mockRejectedValue(new Error('numbering down'));

        const r = await request(app).get('/api/applications/app-1/quotations');

        expect(r.status).toBe(200);
        expect(r.body.data.platform).toBeNull();
    });

    it('a non-owner applicant is 404\'d before the self-heal is ever reached', async () => {
        // ไม่ใช่เจ้าของ = ตัวตัดสินร่วมไม่คืนแถวให้ ไม่ใช่ healthId บนแถวไม่ตรง
        mockCallerOwnsTheApplication = false;
        mockFind.mockResolvedValue({ dtam: null, platform: null });

        const r = await request(app).get('/api/applications/app-1/quotations');

        expect(r.status).toBe(404);
        expect(mockIssue).not.toHaveBeenCalled();
    });
});
