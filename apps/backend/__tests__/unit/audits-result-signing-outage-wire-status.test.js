'use strict';

/**
 * Ruling 2, fix round — the wire must agree with the error catalog.
 *
 * The first round made issuance fail closed with `CERT_SIGNING_UNAVAILABLE`,
 * catalogued at HTTP 503, but the wire still answered 500: the status-writer's
 * wrapper copied only `code` off the cert error, dropping `statusCode`, and
 * `audits.js` honoured a writer's HTTP intent only below 500. So integrators
 * reading the catalog saw 503 and callers saw 500 for the same code — worse
 * than either answer alone, because the catalog is what people build against.
 *
 * 503 is also the semantically right answer here: a signing outage is "the key
 * is not mounted, come back once it is", not "this server is broken". Nothing
 * was written, so the auditor can simply press the button again.
 *
 * This pins the ROUTE contract end to end. The writer's rollback semantics are
 * pinned separately (application-status-writer-cert-hook.test.js); here the
 * writer is mocked so the assertions are about what reaches the client.
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

/** What the status writer throws once its cert hook rolled the flip back. */
function wrappedSigningOutage() {
    const err = new Error('cert-auto-gen failed; status rolled back: signing key unavailable');
    err.code = 'CERT_SIGNING_UNAVAILABLE';
    err.statusCode = 503;
    return err;
}

describe('Ruling 2 fix round — POST /audits/:id/result surfaces a signing outage as the catalogued status', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFindAuditApplication.mockResolvedValue({ ...BASE_APPLICATION });
        mockGetById.mockResolvedValue({ ...BASE_APPLICATION });
        app = buildApp();
    });

    test('signing outage on the cert-minting PASS → HTTP 503 with code CERT_SIGNING_UNAVAILABLE', async () => {
        mockWriteApplicationStatus.mockRejectedValue(wrappedSigningOutage());

        const res = await request(app)
            .post('/audits/APP-1/result')
            .send({ result: 'PASS', notes: 'ผ่านการตรวจประเมิน' });

        expect(res.status).toBe(503);
        expect(res.body.code).toBe('CERT_SIGNING_UNAVAILABLE');
        expect(res.body.success).toBe(false);
    });

    test('the wire status and message match the catalog entry exactly', async () => {
        mockWriteApplicationStatus.mockRejectedValue(wrappedSigningOutage());

        const res = await request(app)
            .post('/audits/APP-1/result')
            .send({ result: 'PASS', notes: 'ผ่านการตรวจประเมิน' });

        const entry = ERROR_CODES.CERT_SIGNING_UNAVAILABLE;
        expect(res.status).toBe(entry.httpStatus);
        expect(res.body.error).toBe(entry.messageEn);
        expect(res.body.errorTh).toBe(entry.messageTh);
    });

    test('an ordinary writer failure with no declared status stays 500 (no reclassification)', async () => {
        mockWriteApplicationStatus.mockRejectedValue(new Error('database exploded'));

        const res = await request(app)
            .post('/audits/APP-1/result')
            .send({ result: 'PASS', notes: 'ผ่านการตรวจประเมิน' });

        expect(res.status).toBe(500);
        expect(res.body.code).toBe('AUDIT_RESULT_FAILED');
    });

    test('a 4xx the writer declared is still honoured by its own branch', async () => {
        const err = new Error('waiver reopen required');
        err.code = 'WAIVER_REOPEN_REQUIRED';
        err.statusCode = 409;
        mockWriteApplicationStatus.mockRejectedValue(err);

        const res = await request(app)
            .post('/audits/APP-1/result')
            .send({ result: 'PASS', notes: 'ผ่านการตรวจประเมิน' });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('WAIVER_REOPEN_REQUIRED');
    });
});

describe('Ruling 2 fix round — the status-writer wrapper carries the cert error HTTP intent', () => {
    test('wrapped cert errors keep both code and statusCode', () => {
        // Mirrors application-status-writer.js: the wrapper must copy the HTTP
        // intent, not just the code, or the route above has nothing to honour.
        const certError = Object.assign(new Error('no key'), {
            code: 'CERT_SIGNING_UNAVAILABLE', statusCode: 503,
        });
        const wrapped = new Error(`cert-auto-gen failed; status rolled back: ${certError.message}`);
        wrapped.code = certError?.code || 'CERT_AUTO_GEN_FAILED';
        if (certError?.statusCode) { wrapped.statusCode = certError.statusCode; }

        const src = require('fs').readFileSync(
            require('path').join(__dirname, '../../services/application-status-writer.js'), 'utf8',
        );
        expect(src).toContain('wrapped.statusCode = certError.statusCode');
        expect(wrapped.statusCode).toBe(ERROR_CODES.CERT_SIGNING_UNAVAILABLE.httpStatus);
    });
});
