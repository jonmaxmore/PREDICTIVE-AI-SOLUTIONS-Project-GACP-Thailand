'use strict';

/**
 * POST /api/provider/applications/:applicationId/checklist must not open an audit on an
 * application nobody is scheduled to visit.
 *
 * Found 2026-08-26. This controller was a third creator of AuditChecklist rows, and unlike
 * the two scheduling doors it never read inspectionMode. The attack needs no forged data:
 * schedule an ONLINE_MEET inspection, have the assigned auditor POST here, and an audit row
 * appears. Every later check then passes honestly — the photographs and checklist items
 * really are this application's, so the application-binding guard is satisfied, the photo
 * hashes really are distinct, the images really decode — and a certificate mints for a farm
 * nobody set foot on. The evidence rule was satisfied without evidence.
 *
 * The fix is not a mode check bolted on here. It is that this door stopped deciding: it
 * hands the mode to services/audit/arm-onsite-evidence.js, the one place allowed to say
 * which inspections can produce onsite evidence. These tests run that armer for real, so
 * they fail if the controller starts deciding again OR if the armer's rule is widened.
 */

jest.mock('../../shared/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const mockResolveCurrentOnsiteAuditId = jest.fn();
jest.mock('../../services/onsite-audit-resolver', () => ({
    resolveCurrentOnsiteAuditId: (...args) => mockResolveCurrentOnsiteAuditId(...args),
}));

const mockAppFindUnique = jest.fn();
const mockTxChecklistFindFirst = jest.fn();
const mockTxChecklistCreate = jest.fn();
const mockTxChecklistFindUnique = jest.fn();
const mockTxChecklistUpdate = jest.fn();
const mockTxAppFindUnique = jest.fn();
const mockTxAppUpdate = jest.fn();

const tx = {
    auditChecklist: {
        findFirst: (...args) => mockTxChecklistFindFirst(...args),
        create: (...args) => mockTxChecklistCreate(...args),
        findUnique: (...args) => mockTxChecklistFindUnique(...args),
        update: (...args) => mockTxChecklistUpdate(...args),
    },
    application: {
        findUnique: (...args) => mockTxAppFindUnique(...args),
        update: (...args) => mockTxAppUpdate(...args),
    },
};

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findUnique: (...args) => mockAppFindUnique(...args) },
        auditChecklist: { findUnique: jest.fn() },
        $transaction: (fn) => fn(tx),
    },
}));

const auditChecklistController = require('../../controllers/audit-checklist-controller');
const { ERROR_CODES } = require('../../shared/error-codes');

function buildRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

const req = { params: { applicationId: 'app-1' }, body: {}, user: { id: 'auditor-1' } };

function applicationWith(formData) {
    mockAppFindUnique.mockResolvedValue({
        id: 'app-1', organizationId: 'org-1', auditorId: 'auditor-1', formData,
    });
    mockResolveCurrentOnsiteAuditId.mockResolvedValue(null);
    mockTxChecklistFindFirst.mockResolvedValue(null);
    mockTxChecklistCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'chk-new', ...data }));
    mockTxAppFindUnique.mockResolvedValue({ formData: formData || {} });
    mockTxAppUpdate.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
    mockTxChecklistFindUnique.mockResolvedValue({ id: 'chk-new', sections: [], auditor: null });
    mockTxChecklistUpdate.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, auditor: null, ...data }));
}

describe('the checklist controller refuses to open an audit that produces no onsite evidence', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    const refused = [
        ['an ONLINE_MEET inspection', { auditSchedule: { inspectionMode: 'ONLINE_MEET', meetingLink: 'https://meet.example/x' } }],
        ['the ONLINE alias the scheduler UI still sends', { auditSchedule: { auditMode: 'ONLINE' } }],
        ['a legacy row that stored only a meeting link', { auditSchedule: { meetingLink: 'https://meet.example/x' } }],
        ['an application with no audit booked at all', {}],
        ['an application with no formData at all', null],
        ['a mode nobody recognises', { auditSchedule: { inspectionMode: 'DRONE_FLYOVER' } }],
    ];

    test.each(refused)('%s creates nothing', async (_label, formData) => {
        applicationWith(formData);
        const res = buildRes();

        await auditChecklistController.create(req, res);

        expect(mockTxChecklistCreate).not.toHaveBeenCalled();
        // Nor may it leave the application pinned at an audit that was never opened.
        expect(mockTxAppUpdate).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            code: 'AUDIT_NOT_ONSITE',
        }));
    });

    test('the refusal names the cause and the next action, in Thai', async () => {
        applicationWith({ auditSchedule: { inspectionMode: 'ONLINE_MEET' } });
        const res = buildRes();

        await auditChecklistController.create(req, res);

        const body = res.json.mock.calls[0][0];
        expect(body.error).toBe(ERROR_CODES.AUDIT_NOT_ONSITE.messageTh);
        expect(body.error).toContain('ยังไม่มีการนัดตรวจแบบลงพื้นที่'); // cause
        expect(body.error).toContain('กรุณานัดหมายการตรวจแบบ ONSITE'); // next action
        expect(body.error).not.toContain('—'); // house Thai copy rule: no em dash
        // The armer's own sentence rides along for the operator; it names the mode.
        expect(body.reason).toContain('ออนไลน์');
    });

    test('the code is catalogued, so the caller never sees a bare string', () => {
        const entry = ERROR_CODES.AUDIT_NOT_ONSITE;
        expect(entry).toBeDefined();
        expect(entry.httpStatus).toBe(409);
        expect(entry.messageEn.length).toBeGreaterThan(0);
        expect(entry.messageTh.length).toBeGreaterThan(0);
    });

    const allowed = [
        ['an ONSITE inspection booked on the schedule', { auditSchedule: { inspectionMode: 'ONSITE', location: 'แปลงที่ 1' } }],
        ['the mode recorded at the top level of formData', { inspectionMode: 'ONSITE' }],
        ['a legacy row that stored only a map link', { auditSchedule: { mapLink: 'https://maps.example/x' } }],
    ];

    test.each(allowed)('%s still opens the audit, so the refusal is not blanket', async (_label, formData) => {
        applicationWith(formData);
        const res = buildRes();

        await auditChecklistController.create(req, res);

        expect(mockTxChecklistCreate).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(201);
    });
});
