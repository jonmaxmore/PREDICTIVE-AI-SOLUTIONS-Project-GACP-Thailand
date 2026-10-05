/**
 * pdpa-erasure — a certificate under retention keeps the holder's name.
 *
 * Operator ruling 2026-08-27: a GACP certificate is a government register;
 * the holder's name stays on it for the life of the certificate even under
 * a PDPA erasure request. The Certificate model carries the same retention
 * columns the service already honours on the User row (retainUntil /
 * legalHold), so executeErasure step 3 must consult them per certificate:
 *
 *   legalHold === true                → retained, basis LEGAL_HOLD
 *   retainUntil is a Date in the future → retained, basis RETENTION_ACTIVE
 *   otherwise                          → anonymised exactly as before
 *
 * "Retained" is permanent for this data subject, and the summary must say so
 * by name: step 1 soft-deletes the User row (isDeleted, password sentinel,
 * sessions revoked, lookup hashes nulled) so the subject can never re-request,
 * and no job in the tree anonymises a certificate after retainUntil passes
 * (jobs/pdpa-retention-job.js sweeps prisma.user only). A field called
 * "deferred" would promise a later action nothing performs.
 *
 * A second reason the live case matters: the signed documentHash covers
 * applicantName, so anonymising a live certificate makes the public verifier
 * report TAMPERED for a genuinely valid certificate.
 *
 * Mocking scaffold copied from __tests__/unit/pdpa-erasure-service.test.js
 * (no database; Prisma + audit + fanout + lookup mocked).
 */

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue({}) },
    AuditCategory: { SECURITY: 'SECURITY' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { USER: 'USER' },
}));

jest.mock('../../services/notification-fanout-service', () => ({
    send: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: jest.fn(),
}));

// The service obtains its logger via createLogger('pdpa-erasure-service') at
// module load; hand it a spy so "warn once per retained certificate" is
// observable without a log sink.
jest.mock('../../shared/logger', () => {
    const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { createLogger: () => mockLogger, __mockLogger: mockLogger };
});

jest.mock('../../services/prisma-database', () => {
    const user = {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
    };
    const application = {
        findMany: jest.fn(),
        update: jest.fn(),
    };
    const certificate = {
        findMany: jest.fn(),
        update: jest.fn(),
    };
    const entityMembership = { findMany: jest.fn() };
    const entity = { update: jest.fn() };
    const applicationDraft = { deleteMany: jest.fn() };
    const notification = { deleteMany: jest.fn() };

    // Task 10 fix round 1: erasure also clears the document pre-check text in its tx.
    const documentPrecheck = { updateMany: jest.fn(), findMany: jest.fn(async () => []) };
    const documentPrecheckFlag = { updateMany: jest.fn(), create: jest.fn() };

    const tx = { user, application, certificate, entityMembership, entity, applicationDraft, notification, documentPrecheck, documentPrecheckFlag };

    return {
        prisma: {
            user, application, certificate, entityMembership, entity, applicationDraft, notification,
            $transaction: jest.fn(async (cb) => cb(tx)),
        },
    };
});

const { auditLogger: audit } = require('../../middleware/audit-logger');
const fanout = require('../../services/notification-fanout-service');
const { prisma } = require('../../services/prisma-database');
const { findUserByHealthIdSecurely } = require('../../services/user-lookup-service');
const { __mockLogger: mockLogger } = require('../../shared/logger');
const pdpaErasureService = require('../../services/pdpa-erasure-service');

describe('pdpa-erasure — certificate retention (operator ruling 2026-08-27)', () => {
    const { ERASURE_SENTINEL } = pdpaErasureService;
    const HEALTH_ID = 'canonical-12345';
    const USER_ID = 'user-abc';
    const ORG_ID = 'org-1';

    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    // Relative to the wall clock because the service reads `new Date()` once
    // per erasure (_now) and is not clock-injectable; a year either side
    // leaves no room for the test's own runtime to flip a comparison.
    const FUTURE = new Date(Date.now() + YEAR_MS);
    const PAST = new Date(Date.now() - YEAR_MS);

    const PRESERVED_LIVE_LINE =
        'Certificate (live: retainUntil/legalHold — holder name kept for the life of the certificate; operator ruling 2026-08-27)';
    const LEGAL_BASIS_REGISTER = 'ทะเบียนใบรับรอง GACP (เก็บตามอายุใบ)';

    beforeEach(() => {
        jest.clearAllMocks();
        audit.log.mockResolvedValue({});
        fanout.send.mockResolvedValue({ ok: true });
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.user.findMany.mockResolvedValue([]);
        prisma.application.findMany.mockResolvedValue([]);
        prisma.certificate.findMany.mockResolvedValue([]);
        prisma.entityMembership.findMany.mockResolvedValue([]);
        prisma.entity.update.mockResolvedValue({ id: 'entity-x' });
        prisma.applicationDraft.deleteMany.mockResolvedValue({ count: 0 });
        prisma.notification.deleteMany.mockResolvedValue({ count: 0 });
        prisma.user.update.mockResolvedValue({ id: USER_ID, privacySettings: {} });
        prisma.user.findUnique.mockResolvedValue({
            canonicalId: HEALTH_ID, organizationId: ORG_ID, legalHold: false,
        });
        findUserByHealthIdSecurely.mockResolvedValue(null);
    });

    /** Run executeErasure over the given certificate rows and return the summary. */
    async function eraseWithCerts(certs) {
        prisma.certificate.findMany.mockResolvedValue(certs);
        return pdpaErasureService.executeErasure({ userId: USER_ID, actorId: USER_ID });
    }

    const updateCallsFor = (id) =>
        prisma.certificate.update.mock.calls.filter(([arg]) => arg.where.id === id);

    it('(a) retainUntil in the future, no hold → never updated, retained as RETENTION_ACTIVE, not counted', async () => {
        const cert = {
            id: 'cert-live', certificateNumber: 'GACP-TH-2569-LIVE01', status: 'active',
            holderType: 'INDIVIDUAL', retainUntil: FUTURE, legalHold: false,
        };
        const summary = await eraseWithCerts([cert]);

        expect(updateCallsFor('cert-live')).toHaveLength(0);
        expect(prisma.certificate.update).not.toHaveBeenCalled();
        expect(summary.retained.certificates).toEqual([
            {
                id: 'cert-live',
                certificateNumber: 'GACP-TH-2569-LIVE01',
                basis: 'RETENTION_ACTIVE',
                retainUntil: FUTURE.toISOString(),
            },
        ]);
        expect(summary.anonymized.certificates).toBe(0);
    });

    it('(b) legalHold true with retainUntil already past → retained as LEGAL_HOLD, never updated', async () => {
        const cert = {
            id: 'cert-hold', certificateNumber: 'GACP-TH-2569-HOLD01', status: 'expired',
            holderType: 'LEGACY_PERSON', retainUntil: PAST, legalHold: true,
        };
        const summary = await eraseWithCerts([cert]);

        expect(prisma.certificate.update).not.toHaveBeenCalled();
        expect(summary.retained.certificates).toEqual([
            expect.objectContaining({ id: 'cert-hold', basis: 'LEGAL_HOLD', retainUntil: PAST.toISOString() }),
        ]);
        expect(summary.anonymized.certificates).toBe(0);
    });

    it('(c) retainUntil past, no hold → anonymised with exactly the pre-existing payload (person holder)', async () => {
        const cert = {
            id: 'cert-old', certificateNumber: 'GACP-TH-2564-OLD001', status: 'expired',
            holderType: 'INDIVIDUAL', retainUntil: PAST, legalHold: false,
        };
        const summary = await eraseWithCerts([cert]);

        expect(prisma.certificate.update).toHaveBeenCalledTimes(1);
        expect(prisma.certificate.update).toHaveBeenCalledWith({
            where: { id: 'cert-old' },
            data: {
                applicantName: ERASURE_SENTINEL,
                address: null,
                holderDisplayName: ERASURE_SENTINEL,
            },
        });
        expect(summary.anonymized.certificates).toBe(1);
        expect(summary.retained.certificates).toEqual([]);
    });

    it('(c\') retainUntil past, no hold, JURISTIC holder → payload omits holderDisplayName exactly as before', async () => {
        const cert = {
            id: 'cert-old-j', certificateNumber: 'GACP-TH-2564-OLD002', status: 'expired',
            holderType: 'JURISTIC', retainUntil: PAST, legalHold: false,
        };
        await eraseWithCerts([cert]);

        expect(prisma.certificate.update).toHaveBeenCalledTimes(1);
        expect(prisma.certificate.update).toHaveBeenCalledWith({
            where: { id: 'cert-old-j' },
            data: { applicantName: ERASURE_SENTINEL, address: null },
        });
    });

    it('(d) mixed list of three → exactly one update, two retained, one warn per retained certificate', async () => {
        const certs = [
            { id: 'c-live', certificateNumber: 'N-LIVE', status: 'active', holderType: 'INDIVIDUAL', retainUntil: FUTURE, legalHold: false },
            { id: 'c-old', certificateNumber: 'N-OLD', status: 'expired', holderType: 'INDIVIDUAL', retainUntil: PAST, legalHold: false },
            { id: 'c-hold', certificateNumber: 'N-HOLD', status: 'revoked', holderType: 'INDIVIDUAL', retainUntil: PAST, legalHold: true },
        ];
        const summary = await eraseWithCerts(certs);

        expect(prisma.certificate.update).toHaveBeenCalledTimes(1);
        expect(prisma.certificate.update.mock.calls[0][0].where).toEqual({ id: 'c-old' });
        expect(summary.anonymized.certificates).toBe(1);
        expect(summary.retained.certificates.map((d) => [d.id, d.basis])).toEqual([
            ['c-live', 'RETENTION_ACTIVE'],
            ['c-hold', 'LEGAL_HOLD'],
        ]);

        const retainWarns = mockLogger.warn.mock.calls.filter(
            ([msg]) => typeof msg === 'string' && /certificate/i.test(msg) && /retain|hold/i.test(msg) && !/defer/i.test(msg),
        );
        expect(retainWarns).toHaveLength(2);
    });

    it('(e) asks Postgres for retainUntil + legalHold — without them every branch reads undefined and a live certificate is silently anonymised', async () => {
        await eraseWithCerts([]);
        expect(prisma.certificate.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId: USER_ID },
            select: expect.objectContaining({
                id: true,
                holderType: true,
                retainUntil: true,
                legalHold: true,
                certificateNumber: true,
            }),
        }));
    });

    it('(f) summary + audit cite the register basis; retained list exists even when nothing is retained', async () => {
        const summary = await eraseWithCerts([]);

        expect(summary.retained).toEqual({ certificates: [] });
        expect(summary).not.toHaveProperty('deferred');
        expect(summary.preserved).toEqual(expect.arrayContaining([PRESERVED_LIVE_LINE]));
        expect(summary.preserved.some((line) => /^Certificate \(anonymised/.test(line) && /retention/i.test(line))).toBe(true);

        const auditCall = audit.log.mock.calls.find(([row]) => row.action === 'PDPA_ERASURE_EXECUTED');
        expect(auditCall).toBeDefined();
        expect(auditCall[0].metadata.legalBasis).toEqual(
            expect.arrayContaining(['PDPA ม.32', 'ม.87/3 ป.รัษฎากร', LEGAL_BASIS_REGISTER]),
        );
    });

    it('(g) the summary and the warn name the state "retained", never "deferred" — nothing in the tree anonymises the row later', async () => {
        const cert = {
            id: 'cert-live', certificateNumber: 'GACP-TH-2569-LIVE02', status: 'active',
            holderType: 'INDIVIDUAL', retainUntil: FUTURE, legalHold: false,
        };
        const summary = await eraseWithCerts([cert]);

        expect(summary).not.toHaveProperty('deferred');
        expect(summary.retained.certificates.map((c) => c.id)).toEqual(['cert-live']);

        const certWarns = mockLogger.warn.mock.calls.filter(
            ([msg]) => typeof msg === 'string' && /certificate/i.test(msg),
        );
        expect(certWarns).toHaveLength(1);
        expect(certWarns[0][0]).toMatch(/retained/);
        expect(certWarns[0][0]).not.toMatch(/defer/i);
    });
});
