'use strict';

/**
 * Farm-location refusal — the wire must agree with the error catalog.
 *
 * certificate-service.js refuses to mint a certificate whose farm location is
 * blank or a retired stand-in (`CERTIFICATE_FARM_LOCATION_MISSING`, 422, Thai
 * message naming the missing fields). The status writer rolls the AUDIT_PASSED
 * flip back and rethrows `cert-auto-gen failed; status rolled back: <Thai>`
 * keeping code + statusCode, with the refusal itself as `cause`.
 *
 * Before this test the route's sub-500 branch answered that with
 *   error:   the English-prefixed wrapper message
 *   errorTh: 'ไม่สามารถบันทึกผลการตรวจประเมินจากสถานะปัจจุบันได้'
 * which names the application STATUS as the problem, not the farm location,
 * and the code had no catalog row at all — unlike its sibling
 * CERT_SIGNING_UNAVAILABLE (audits-result-signing-outage-wire-status.test.js).
 *
 * This pins the ROUTE contract end to end: status, code, and both messages
 * come from the catalog, and the refusal's structured `missingFields` reaches
 * the client so the specific blanks are not lost. The writer is mocked so the
 * assertions are about what reaches the auditor.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = {
        debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    };
    return { ...l, createLogger: jest.fn(() => l) };
});

const TX_MARKER = { __tx: true, auditLog: {} };
jest.mock('../../services/prisma-database', () => ({
    prisma: { $transaction: jest.fn(async (cb) => cb(TX_MARKER)) },
}));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => {
        req.user = {
            id: 'auditor-1', role: 'AUDITOR', canonicalRole: 'auditor', organizationId: 'org-1',
        };
        next();
    },
    requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../../services/notification-service', () => ({
    sendNotification: jest.fn().mockResolvedValue({}),
    NotifyType: { APPLICATION_APPROVED: 'APPLICATION_APPROVED', REVISION_REQUESTED: 'REVISION_REQUESTED' },
}));
jest.mock('../../services/workflow-transition-service', () => ({ buildTransitionUpdate: jest.fn() }));
jest.mock('../../services/farm-service', () => ({ updateFarmFromAudit: jest.fn().mockResolvedValue({}) }));

const mockFindAuditApplication = jest.fn();
const mockGetById = jest.fn();
jest.mock('../../services/application-service', () => ({
    findAuditApplication: (...a) => mockFindAuditApplication(...a),
    getById: (...a) => mockGetById(...a),
}));

const mockWriteApplicationStatus = jest.fn();
// The inspector's PASS now asks the onsite-evidence gate before the write (Batch A item 2);
// this suite is about what happens AFTER the evidence is accepted, and the gate has its own
// suites (onsite-evidence-gate, approver-sees-the-file-pass-doors).
jest.mock('../../services/onsite-evidence-gate', () => ({
    assertOnsiteEvidenceSufficient: jest.fn().mockResolvedValue({}),
    assertOnsiteEvidenceForPass: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
}));

jest.mock('../../shared/application-visibility', () => ({ withVisibility: (where) => where }));
jest.mock('../../services/car-deadline-service', () => ({
    computeCarDueDate: jest.fn(() => new Date('2026-07-15T09:00:00.000Z')),
    seedCarRevisionDeadline: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(), logWithin: jest.fn() },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO' },
    ResourceType: { APPLICATION: 'APPLICATION' },
    statusTransitionAuditHook: jest.fn(() => jest.fn().mockResolvedValue({})),
}));

const { ERROR_CODES } = require('../../shared/error-codes');

const CODE = 'CERTIFICATE_FARM_LOCATION_MISSING';

const BASE_APPLICATION = {
    id: 'APP-1',
    status: 'AUDIT_CONFIRMED',
    applicationNumber: 'GACP-2026-0001',
    formData: {},
    applicant: { id: 'health-user-1', healthId: 'tok-1' },
};

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/audits', require('../../routes/api/audit/audits'));
    return app;
}

/** Exactly what certificate-service.js refuseFarmLocation() returns. */
function farmLocationRefusal(missing = ['province', 'subDistrict']) {
    const err = new Error(
        'ไม่สามารถออกใบรับรองได้ เนื่องจากข้อมูลที่ตั้งฟาร์มไม่ครบถ้วน (ขาด จังหวัด, ตำบล) '
        + 'กรุณาแก้ไขข้อมูลที่ตั้งฟาร์มในคำขอให้ครบถ้วนก่อนออกใบรับรอง',
    );
    err.code = CODE;
    err.statusCode = 422;
    err.missingFields = missing;
    return err;
}

/** What the status writer throws once its cert hook rolled the flip back. */
function wrappedFarmLocationRefusal() {
    const cause = farmLocationRefusal();
    const wrapped = new Error(`cert-auto-gen failed; status rolled back: ${cause.message}`);
    wrapped.code = cause.code;
    wrapped.statusCode = cause.statusCode;
    wrapped.cause = cause;
    return wrapped;
}

function postPass(app) {
    return request(app)
        .post('/audits/APP-1/result')
        .send({ result: 'PASS', notes: 'ผ่านการตรวจประเมิน' });
}

describe('error catalog — CERTIFICATE_FARM_LOCATION_MISSING has a row that agrees with the service', () => {
    test('catalogued at 422 with a Thai message that names the farm location, not the status', () => {
        const entry = ERROR_CODES[CODE];
        expect(entry).toBeDefined();
        expect(entry.httpStatus).toBe(422);
        expect(entry.messageTh).toContain('ที่ตั้งฟาร์ม');
        expect(entry.messageTh).not.toContain('สถานะปัจจุบัน');
        expect(entry.messageEn).toMatch(/farm location/i);
        expect(entry.source).toMatch(/^services\/certificate-service\.js:\d+$/);
    });
});

describe('POST /audits/:id/result surfaces a farm-location refusal as the catalogued 422', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFindAuditApplication.mockResolvedValue({ ...BASE_APPLICATION });
        mockGetById.mockResolvedValue({ ...BASE_APPLICATION });
        app = buildApp();
    });

    test('refusal on the cert-minting PASS → HTTP 422 with code CERTIFICATE_FARM_LOCATION_MISSING', async () => {
        mockWriteApplicationStatus.mockRejectedValue(wrappedFarmLocationRefusal());

        const res = await postPass(app);

        expect(res.status).toBe(422);
        expect(res.body.code).toBe(CODE);
        expect(res.body.success).toBe(false);
    });

    test('the wire status and both messages match the catalog entry exactly', async () => {
        mockWriteApplicationStatus.mockRejectedValue(wrappedFarmLocationRefusal());

        const res = await postPass(app);

        const entry = ERROR_CODES[CODE];
        expect(res.status).toBe(entry.httpStatus);
        expect(res.body.error).toBe(entry.messageEn);
        expect(res.body.errorTh).toBe(entry.messageTh);
    });

    test('the Thai answer states the real reason (farm location), never the application status', async () => {
        mockWriteApplicationStatus.mockRejectedValue(wrappedFarmLocationRefusal());

        const res = await postPass(app);

        expect(res.body.errorTh).toContain('ที่ตั้งฟาร์ม');
        expect(res.body.errorTh).not.toContain('สถานะปัจจุบัน');
        // No writer-internal English prefix leaks into either field.
        expect(res.body.error).not.toMatch(/cert-auto-gen/);
        expect(res.body.errorTh).not.toMatch(/cert-auto-gen/);
    });

    test('the refusal\'s missingFields reach the client, so the specific blanks are not lost', async () => {
        mockWriteApplicationStatus.mockRejectedValue(wrappedFarmLocationRefusal());

        const res = await postPass(app);

        expect(res.body.missingFields).toEqual(['province', 'subDistrict']);
    });

    test('a sub-500 writer error with no missingFields carries no missingFields key', async () => {
        const err = new Error('waiver reopen required');
        err.code = 'WAIVER_REOPEN_REQUIRED';
        err.statusCode = 409;
        mockWriteApplicationStatus.mockRejectedValue(err);

        const res = await postPass(app);

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('WAIVER_REOPEN_REQUIRED');
        expect(res.body).not.toHaveProperty('missingFields');
    });

    test('the same branch serves the catalogued WAIVER_REOPEN_REQUIRED messages too', async () => {
        const err = new Error('waiver reopen required');
        err.code = 'WAIVER_REOPEN_REQUIRED';
        err.statusCode = 409;
        mockWriteApplicationStatus.mockRejectedValue(err);

        const res = await postPass(app);

        const entry = ERROR_CODES.WAIVER_REOPEN_REQUIRED;
        expect(res.status).toBe(entry.httpStatus);
        expect(res.body.error).toBe(entry.messageEn);
        expect(res.body.errorTh).toBe(entry.messageTh);
    });

    test('an uncatalogued sub-500 writer error still answers with its own message and the generic Thai line', async () => {
        const err = new Error('some fence the catalog does not know');
        err.code = 'SOME_UNCATALOGUED_FENCE';
        err.statusCode = 409;
        mockWriteApplicationStatus.mockRejectedValue(err);

        const res = await postPass(app);

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('SOME_UNCATALOGUED_FENCE');
        expect(res.body.error).toBe('some fence the catalog does not know');
        expect(typeof res.body.errorTh).toBe('string');
        expect(res.body.errorTh.length).toBeGreaterThan(0);
    });
});
