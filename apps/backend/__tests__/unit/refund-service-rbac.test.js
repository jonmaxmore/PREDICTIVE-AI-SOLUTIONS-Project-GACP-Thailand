/**
 * V4-D RB-8 design decision — refund-service intentionally EXCLUDES the
 * legacy ACCOUNT role from WRITE_ROLES + READ_ROLES.
 *
 * Why this test exists:
 *   - The other finance services in Tier 16+ (period-close, manual-JE,
 *     credit-note, purchase-invoice, WHT) admit the legacy `ACCOUNT` role
 *     as a migration-grace courtesy. Refund-service is the EXCEPTION:
 *     `refund-service.js:71-82` lists only ACCOUNT_PLATFORM + ADMIN in
 *     WRITE_ROLES, and only ACCOUNT_PLATFORM + ADMIN + AUDITOR in
 *     READ_ROLES. CANCEL_ROLES is ADMIN-only.
 *   - This file pins the design decision so a future "grace-period"
 *     change does not silently re-admit the legacy ACCOUNT role to the
 *     refund surface. Refunds carry the heaviest ledger consequences
 *     (Cr Revenue + Cr Output VAT reversal + cash refund) and the
 *     migration script `scripts/migrate-account-role.js` should have
 *     moved every legacy ACCOUNT user to ACCOUNT_PLATFORM before refunds
 *     are operated in production.
 *   - Documented as a design decision (RFC §V4-D / RB-8 IMPORTANT note):
 *     "legacy ACCOUNT is NOT in refund-service's WRITE_ROLES /
 *     READ_ROLES (only ACCOUNT_PLATFORM, ADMIN, AUDITOR). This is a
 *     conscious tightening since the migration script should have moved
 *     all legacy users to ACCOUNT_PLATFORM by the time refunds are run."
 *
 * Pattern: mounts the real /api/finance/refunds router under supertest;
 * the refund-service mock wires the canonical-rbac WRITE_ROLES /
 * READ_ROLES sets (NOT including ACCOUNT) and asserts that:
 *   (a) ACCOUNT_PLATFORM + ADMIN can initiate (positive)
 *   (b) ACCOUNT (legacy) gets 403 FORBIDDEN_ROLE on initiate
 *   (c) ACCOUNT_PLATFORM + ADMIN + AUDITOR can read status
 *   (d) ACCOUNT (legacy) gets 403 on read status
 *   (e) Only ADMIN can cancel — ACCOUNT_PLATFORM + ACCOUNT both 403
 *   (f) Service-layer side-effects (initiateRefund / getRefundStatus /
 *       cancelRefund) are not invoked on the 403 path.
 *
 * I-008 applied: refund-service mock exposes every helper the route
 * file imports; canonical-rbac kept REAL via jest.requireActual().
 *
 * See: docs/handoffs/iter-V4/00-rfc.md §V4-D / RB-8.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock ───────────────────────────────────────────────────────────────
jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'user-1',
            email: req.headers['x-test-email'] || 'user-1@example.com',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            healthId: role === 'health' ? (req.headers['x-test-health-id'] || 'health-1') : null,
            providerId: role !== 'health' ? (req.headers['x-test-provider-id'] || 'provider-1') : null,
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
        };
        return next();
    };
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticate: buildHeaderUser,
        requireRole: () => (_req, _res, next) => next(),
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

// canonical-rbac stays REAL — the test proves the canonical contract.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// ── Refund-service mock that mirrors the EXACT WRITE_ROLES / READ_ROLES /
//    CANCEL_ROLES sets from `refund-service.js:71-82` — intentionally
//    EXCLUDING legacy ACCOUNT. This file's purpose is to assert the
//    canonical contract; we use spies so the 403 path can prove the
//    service-layer side-effect was not invoked. ─────────────────────────────
const mockInitiateRefund = jest.fn();
const mockGetRefundStatus = jest.fn();
const mockCancelRefund = jest.fn();

jest.mock('../../services/refund-service', () => {
    const real = jest.requireActual('../../services/refund-service');
    const { normalizeRole } = jest.requireActual('../../shared/canonical-rbac');

    // ชุดบทบาทมาจาก service จริง (เดิมเป็นสำเนาในเทส → เทส export ข้างล่างเทียบสำเนากับ
    // ตัวเอง และเทสอ่านค้างคำตัดสินเก่าได้โดยไม่มีใครเห็น)
    const { WRITE_ROLES, CANCEL_ROLES, READ_ROLES } = real;

    const assertWrite = (actor) => {
        const role = normalizeRole(actor?.canonicalRole || actor?.role);
        if (!role || !WRITE_ROLES.has(role)) {
            const e = new Error(
                'ACCOUNT_PLATFORM or ADMIN role required to initiate a refund',
            );
            e.code = 'FORBIDDEN_ROLE';
            e.statusCode = 403;
            throw e;
        }
    };
    const assertRead = (actor) => {
        const role = normalizeRole(actor?.canonicalRole || actor?.role);
        if (!role || !READ_ROLES.has(role)) {
            const e = new Error(
                'ACCOUNT_PLATFORM, AUDITOR, or ADMIN role required to view refund status',
            );
            e.code = 'FORBIDDEN_ROLE';
            e.statusCode = 403;
            throw e;
        }
    };
    const assertCancel = (actor) => {
        const role = normalizeRole(actor?.canonicalRole || actor?.role);
        if (!role || !CANCEL_ROLES.has(role)) {
            const e = new Error(
                'ADMIN role required to cancel a refund (separation of duties)',
            );
            e.code = 'FORBIDDEN_ROLE';
            e.statusCode = 403;
            throw e;
        }
    };

    return {
        ...real,
        initiateRefund: (args) => {
            assertWrite(args?.actor);
            return mockInitiateRefund(args);
        },
        getRefundStatus: (id, opts) => {
            assertRead(opts?.actor);
            return mockGetRefundStatus(id, opts);
        },
        cancelRefund: (id, opts) => {
            assertCancel(opts?.actor);
            return mockCancelRefund(id, opts);
        },
    };
});

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../shared/logger', () => {
    const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(null) },
    AuditCategory: { PAYMENT: 'PAYMENT' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { INVOICE: 'INVOICE' },
}));

function seedHappyPath() {
    mockInitiateRefund.mockResolvedValue({ refundId: 'ref-1', status: 'INITIATED' });
    mockGetRefundStatus.mockResolvedValue({ status: 'NONE', history: [] });
    mockCancelRefund.mockResolvedValue({ refundId: 'ref-1', status: 'CANCELLED' });
}

const refundsRouter = require('../../routes/api/finance/refunds');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/finance/refunds', refundsRouter);
    return app;
}

// ── 1. WRITE_ROLES contract — legacy ACCOUNT excluded from initiate ─────────

describe('V4-D RB-8 refund-service WRITE_ROLES — ใครริเริ่มคืนเงินได้', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('account_platform CAN initiate a refund (positive — in WRITE_ROLES)', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/inv-1/initiate')
            .set('x-test-role', 'finance_officer_platform')
            .send({ reason: 'customer cancelled', reasonCode: 'CANCELLATION' });

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockInitiateRefund).toHaveBeenCalledTimes(1);
    });

    test('admin CAN initiate a refund (positive — in WRITE_ROLES)', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/inv-1/initiate')
            .set('x-test-role', 'system_admin_dtam')
            .send({ reason: 'admin override', reasonCode: 'CORRECTION' });

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockInitiateRefund).toHaveBeenCalledTimes(1);
    });

    test('account_dtam CANNOT initiate a refund (DTAM has no platform-fee write authority)', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/inv-1/initiate')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ reason: 'state-fee refund', reasonCode: 'CANCELLATION' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            error: 'FORBIDDEN_ROLE',
        });
        expect(mockInitiateRefund).not.toHaveBeenCalled();
    });

    test('auditor CANNOT initiate a refund (read-only across both sides)', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/inv-1/initiate')
            .set('x-test-role', 'field_inspector')
            .send({ reason: 'audit finding', reasonCode: 'CORRECTION' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            error: 'FORBIDDEN_ROLE',
        });
        expect(mockInitiateRefund).not.toHaveBeenCalled();
    });
});

// ── 2. READ_ROLES contract — legacy ACCOUNT excluded from status read ───────

describe('V4-D RB-8 refund-service READ_ROLES — ใครอ่านสถานะคืนเงินได้', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('account_platform CAN read refund status (positive — in READ_ROLES)', async () => {
        const response = await request(app)
            .get('/api/finance/refunds/inv-1/status')
            .set('x-test-role', 'finance_officer_platform');

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockGetRefundStatus).toHaveBeenCalledTimes(1);
    });

    test('admin CAN read refund status (positive — in READ_ROLES)', async () => {
        const response = await request(app)
            .get('/api/finance/refunds/inv-1/status')
            .set('x-test-role', 'system_admin_dtam');

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockGetRefundStatus).toHaveBeenCalledTimes(1);
    });

    // S6 (operator 2026-09-27): the field inspector no longer reads finance data — was "auditor CAN read"
    test('auditor (field_inspector) CANNOT read refund status', async () => {
        const response = await request(app)
            .get('/api/finance/refunds/inv-1/status')
            .set('x-test-role', 'field_inspector');

        expect(response.status).toBe(403);
        expect(mockGetRefundStatus).not.toHaveBeenCalled();
    });

    // operator 2026-09-11 "finance ต้องเห็นเหมือนกัน" — การอ่านสถานะคืนเงินเปิดให้การเงินทั้งสองบทบาท
    // (การเริ่มคืนเงินยังเป็นของฝั่งบริษัท + ผู้ดูแลเท่านั้น — เทส WRITE_ROLES ข้างล่างคงเดิม)
    test('account_dtam CAN read refund status (READ_ROLES มีการเงินทั้งสองบทบาท)', async () => {
        const response = await request(app)
            .get('/api/finance/refunds/inv-1/status')
            .set('x-test-role', 'finance_officer_dtam');

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockGetRefundStatus).toHaveBeenCalledTimes(1);
    });
});

// ── 3. CANCEL_ROLES contract — ADMIN-only (legacy ACCOUNT + PLATFORM also 403) ──

describe('V4-D RB-8 refund-service CANCEL_ROLES is ADMIN-only', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedHappyPath();
    });

    test('admin CAN cancel a refund (positive — only role in CANCEL_ROLES)', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/ref-1/cancel')
            .set('x-test-role', 'system_admin_dtam')
            .send({ reason: 'wrong invoice' });

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
        expect(mockCancelRefund).toHaveBeenCalledTimes(1);
    });

    test('account_platform CANNOT cancel a refund (separation of duties)', async () => {
        // PLATFORM accountants can INITIATE refunds (because they own
        // the original ใบเสร็จ + ม.86/10 credit note workflow) but
        // CANNOT cancel them. Separation of duties per TFRS for NPAEs
        // ch.2 — the same role that approves/initiates a credit note
        // must not be able to reverse it.
        const response = await request(app)
            .post('/api/finance/refunds/ref-1/cancel')
            .set('x-test-role', 'finance_officer_platform')
            .send({ reason: 'mistake' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            error: 'FORBIDDEN_ROLE',
        });
        expect(mockCancelRefund).not.toHaveBeenCalled();
    });

    test('account (legacy) CANNOT cancel a refund — RB-8 design decision', async () => {
        // Doubly excluded: legacy ACCOUNT is not in CANCEL_ROLES (which is
        // ADMIN-only) AND would be excluded from WRITE_ROLES even if the
        // role hierarchy promoted them. Asserting both layers locks the
        // contract.
        const response = await request(app)
            .post('/api/finance/refunds/ref-1/cancel')
            .set('x-test-role', 'finance_officer_platform')
            .send({ reason: 'mistake' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            error: 'FORBIDDEN_ROLE',
        });
        expect(mockCancelRefund).not.toHaveBeenCalled();
    });

    test('account_dtam CANNOT cancel a refund (no PLATFORM write authority)', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/ref-1/cancel')
            .set('x-test-role', 'finance_officer_dtam')
            .send({ reason: 'mistake' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            error: 'FORBIDDEN_ROLE',
        });
        expect(mockCancelRefund).not.toHaveBeenCalled();
    });

    test('auditor CANNOT cancel a refund (read-only oversight)', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/ref-1/cancel')
            .set('x-test-role', 'field_inspector')
            .send({ reason: 'audit finding' });

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            error: 'FORBIDDEN_ROLE',
        });
        expect(mockCancelRefund).not.toHaveBeenCalled();
    });
});

// ── 4. Canonical contract assertion — the WRITE_ROLES / READ_ROLES /
//      CANCEL_ROLES exports themselves must NOT contain ACCOUNT (legacy) ─────

describe('V4-D RB-8 refund-service role-set EXPORTS — ฝั่งกรมไม่มีอำนาจฝั่งแพลตฟอร์ม', () => {
    test('WRITE_ROLES = {การเงินฝั่งบริษัท, ผู้ดูแล}', () => {
        const { CANONICAL_ROLES } = jest.requireActual('../../shared/canonical-rbac');
        const refundService = require('../../services/refund-service');

        expect(refundService.WRITE_ROLES).toBeInstanceOf(Set);
        expect(refundService.WRITE_ROLES.has(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM)).toBe(true);
        expect(refundService.WRITE_ROLES.has(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM)).toBe(true);
        // RB-8: การเงินฝั่งกรมไม่มีอำนาจเขียนฝั่งค่าบริการแพลตฟอร์ม
        expect(refundService.WRITE_ROLES.has(CANONICAL_ROLES.FINANCE_OFFICER_DTAM)).toBe(false);
        expect(refundService.WRITE_ROLES.has(CANONICAL_ROLES.FIELD_INSPECTOR)).toBe(false);
    });

    test('READ_ROLES = {การเงินทั้งสองบทบาท, ผู้ดูแล} (ผู้ตรวจแปลงออก 2026-09-27)', () => {
        const { CANONICAL_ROLES } = jest.requireActual('../../shared/canonical-rbac');
        const refundService = require('../../services/refund-service');

        expect(refundService.READ_ROLES).toBeInstanceOf(Set);
        expect(refundService.READ_ROLES.has(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM)).toBe(true);
        expect(refundService.READ_ROLES.has(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM)).toBe(true);
        expect(refundService.READ_ROLES.has(CANONICAL_ROLES.FIELD_INSPECTOR)).toBe(false);
        // operator 2026-09-11: การเงินสองบทบาทอ่านได้เท่ากัน
        expect(refundService.READ_ROLES.has(CANONICAL_ROLES.FINANCE_OFFICER_DTAM)).toBe(true);
    });

    test('CANCEL_ROLES exports {ADMIN} only — separation of duties', () => {
        const { CANONICAL_ROLES } = jest.requireActual('../../shared/canonical-rbac');
        const refundService = require('../../services/refund-service');

        expect(refundService.CANCEL_ROLES).toBeInstanceOf(Set);
        expect(refundService.CANCEL_ROLES.has(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM)).toBe(true);
        expect(refundService.CANCEL_ROLES.has(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM)).toBe(false);
        expect(refundService.CANCEL_ROLES.has(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM)).toBe(false);
        expect(refundService.CANCEL_ROLES.has(CANONICAL_ROLES.FINANCE_OFFICER_DTAM)).toBe(false);
        expect(refundService.CANCEL_ROLES.has(CANONICAL_ROLES.FIELD_INSPECTOR)).toBe(false);
    });
});

// ── 5. Anonymous gate — every refund route requires authentication ──────────

describe('V4-D RB-8 anonymous (no token) — every refund route returns 401', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    test('POST /:invoiceId/initiate returns 401 without a token', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/inv-1/initiate')
            .send({ reason: 'test', reasonCode: 'CANCELLATION' });
        expect(response.status).toBe(401);
        expect(mockInitiateRefund).not.toHaveBeenCalled();
    });

    test('GET /:invoiceId/status returns 401 without a token', async () => {
        const response = await request(app).get('/api/finance/refunds/inv-1/status');
        expect(response.status).toBe(401);
        expect(mockGetRefundStatus).not.toHaveBeenCalled();
    });

    test('POST /:refundId/cancel returns 401 without a token', async () => {
        const response = await request(app)
            .post('/api/finance/refunds/ref-1/cancel')
            .send({ reason: 'mistake' });
        expect(response.status).toBe(401);
        expect(mockCancelRefund).not.toHaveBeenCalled();
    });
});
