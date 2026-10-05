'use strict';

/**
 * Certificate, document, pre-check and finance reads on the applicant side carry
 * the holder fragment (spec 2026-09-30-remove-workspace-mode §3.1, Task 4), and
 * in R1 keep each door's pre-R1 filer pin beside it (operator ruling C1:
 * R1 returns exactly what the pre-R1 code returned; r1LegacyApplicantPin is
 * removed in Task 12).
 *
 * The same three assertions as Task 3, per method, with a prisma double that
 * records the args — in the R1 shape of Task 4 fix round 1:
 *   1. where.OR = [fragment, legacy]: the fragment marked and unaltered, the legacy
 *      branch (the read's own pre-R1 where) marked too, so the witness accepts
 *      every OR branch;
 *   2. no filer key at the top level — the pre-R1 filer pin is the AND member,
 *      verbatim, so (fragment ∪ legacy) ∩ pin = the pre-R1 rows exactly;
 *   3. a by-id read is findFirst({ where: { id, OR } }), never findUnique.
 * Plus: no scope on an applicant-only method fails closed with no query, and a
 * staff/system caller of a shared method (no holderScope) keeps its where.
 *
 * The runtime witness (throw mode) and the pre-R1 equality are pinned on a real
 * Postgres in holder-write-doors-witness-real-postgres.test.js and
 * r1-cert-doc-finance-reads-neutral-real-postgres.test.js.
 */

const mockPrisma = {};
jest.mock('../../services/prisma-database', () => ({ prisma: mockPrisma }));

const { hasHolderMarker } = require('../../services/holder-access');

const USER = '11111111-1111-4111-8111-111111111111';
const APP = '22222222-2222-4222-8222-222222222222';
const CERT = '33333333-3333-4333-8333-333333333333';
const HEALTH = 'health-token-1';
const SCOPE = Object.freeze({ userId: USER, readIds: ['entity-c', 'entity-p'], editIds: ['entity-c'] });
const BY_APPLICATION = { application: { entityId: { in: SCOPE.readIds } } };

const FILER_PIN_KEYS = ['applicant', 'healthId', 'userId'];

function delegate(found = null) {
    return {
        findFirst: jest.fn().mockResolvedValue(found),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(found),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue(found),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue(found),
    };
}

beforeEach(() => {
    for (const key of Object.keys(mockPrisma)) { delete mockPrisma[key]; }
    Object.assign(mockPrisma, {
        certificate: delegate(),
        quote: delegate(),
        quotation: delegate(),
        application: delegate(),
        applicationDocument: delegate(),
        documentPrecheck: delegate(),
        checkoutOrder: delegate(),
        entityMembership: delegate(),
        entity: delegate(),
    });
});

function onlyCall(fn) {
    expect(fn).toHaveBeenCalledTimes(1);
    return fn.mock.calls[0][0];
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const APPLICATION_FRAGMENT = { entityId: { in: SCOPE.readIds } };

/**
 * Assertions 1 + 2 in the R1 shape: where.OR = [fragment, legacy], both marked;
 * the pre-R1 filer pin (if the door had one) only as the AND member.
 * @param {object} where
 * @param {{ legacy: object, pin?: object, fragment?: object }} expected
 */
function expectR1Scoped(where, { legacy, pin, fragment = BY_APPLICATION }) {
    expect(Array.isArray(where.OR)).toBe(true);
    expect(where.OR).toHaveLength(2);
    const [holderBranch, legacyBranch] = where.OR;
    expect(hasHolderMarker(holderBranch)).toBe(true);
    expect(plain(holderBranch)).toEqual(fragment);
    expect(hasHolderMarker(legacyBranch)).toBe(true);
    expect(plain(legacyBranch)).toEqual(legacy);
    for (const key of ['healthId', 'userId', 'applicant', 'application', 'entityId']) {
        expect(Object.prototype.hasOwnProperty.call(where, key)).toBe(false);
    }
    if (pin === undefined) {
        expect(where.AND).toBeUndefined();
    } else {
        expect(where.AND).toEqual([pin]);
    }
}

describe('certificate-service', () => {
    const certificateService = require('../../services/certificate-service');

    test('listCertificatesForUser(scope): fragment + R1 pin { userId }', async () => {
        await certificateService.listCertificatesForUser(SCOPE);
        const { where } = onlyCall(mockPrisma.certificate.findMany);
        expectR1Scoped(where, { legacy: { userId: USER }, pin: { userId: USER } });
        expect(where.isDeleted).toBe(false);
    });

    test('listCertificatesForUser without a scope (or with a positional userId) fails closed, no query', async () => {
        await expect(certificateService.listCertificatesForUser()).resolves.toEqual([]);
        await expect(certificateService.listCertificatesForUser(USER)).resolves.toEqual([]);
        expect(mockPrisma.certificate.findMany).not.toHaveBeenCalled();
    });

    test('getCertificateForUser(id, scope, opts): findFirst by id with fragment + R1 pin, select/include passed through', async () => {
        await certificateService.getCertificateForUser(CERT, SCOPE, { select: { id: true } });
        const args = onlyCall(mockPrisma.certificate.findFirst);
        expect(args.where.id).toBe(CERT);
        expectR1Scoped(args.where, { legacy: { userId: USER }, pin: { userId: USER } });
        expect(args.select).toEqual({ id: true });
        expect(mockPrisma.certificate.findUnique).not.toHaveBeenCalled();
    });

    test('getCertificateForUser without a scope (or a positional userId) is null, no query', async () => {
        await expect(certificateService.getCertificateForUser(CERT, null)).resolves.toBeNull();
        await expect(certificateService.getCertificateForUser(CERT, USER)).resolves.toBeNull();
        expect(mockPrisma.certificate.findFirst).not.toHaveBeenCalled();
    });

    test('getCertificatePdf: with a holder scope reads findFirst + fragment; without (worker/staff) keeps findUnique', async () => {
        mockPrisma.certificate.findFirst.mockResolvedValue(null);
        await expect(certificateService.getCertificatePdf(CERT, { holderScope: SCOPE })).rejects.toThrow('Certificate not found');
        const { where } = onlyCall(mockPrisma.certificate.findFirst);
        expect(where.id).toBe(CERT);
        expectR1Scoped(where, { legacy: { id: CERT } });
        expect(mockPrisma.certificate.findUnique).not.toHaveBeenCalled();

        await expect(certificateService.getCertificatePdf(CERT)).rejects.toThrow('Certificate not found');
        expect(onlyCall(mockPrisma.certificate.findUnique)).toEqual({ where: { id: CERT } });
    });
});

describe('document-service (report submissions)', () => {
    const documentService = require('../../services/document-service');

    test('listActiveCertificatesForUser(scope): fragment + R1 pin { userId }', async () => {
        await documentService.listActiveCertificatesForUser(SCOPE);
        const { where } = onlyCall(mockPrisma.certificate.findMany);
        expectR1Scoped(where, { legacy: { userId: USER }, pin: { userId: USER } });
        expect(where.status).toBe('active');
    });

    test('findCertificateForUser(id, scope): findFirst by id, fragment + R1 pin', async () => {
        await documentService.findCertificateForUser(CERT, SCOPE);
        const { where } = onlyCall(mockPrisma.certificate.findFirst);
        expect(where.id).toBe(CERT);
        expectR1Scoped(where, { legacy: { userId: USER }, pin: { userId: USER } });
    });

    test('no scope fails closed, no query', async () => {
        await expect(documentService.listActiveCertificatesForUser(USER)).resolves.toEqual([]);
        await expect(documentService.findCertificateForUser(CERT, USER)).resolves.toBeNull();
        expect(mockPrisma.certificate.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.certificate.findFirst).not.toHaveBeenCalled();
    });
});

describe('quote-service', () => {
    const quoteService = require('../../services/quote-service');

    test('listForApplicant(healthId, { holderScope }): fragment + R1 pin { application: { healthId } }', async () => {
        await quoteService.listForApplicant(HEALTH, { holderScope: SCOPE, status: 'SENT' });
        const { where } = onlyCall(mockPrisma.quote.findMany);
        expectR1Scoped(where, { legacy: { application: { healthId: HEALTH } }, pin: { application: { healthId: HEALTH } } });
        expect(where.status).toBe('SENT');
    });

    test('no scope fails closed, no query', async () => {
        await expect(quoteService.listForApplicant(HEALTH)).resolves.toEqual([]);
        expect(mockPrisma.quote.findMany).not.toHaveBeenCalled();
    });
});

describe('planting-service', () => {
    const plantingService = require('../../services/planting-service');

    test('findOwnedApplicationDocuments(ids, userId, { holderScope }): fragment + R1 pin on the applicant', async () => {
        await plantingService.findOwnedApplicationDocuments(['d1'], USER, { holderScope: SCOPE });
        const { where } = onlyCall(mockPrisma.applicationDocument.findMany);
        expect(where.id).toEqual({ in: ['d1'] });
        const filerPin = { application: { applicant: { id: USER, isDeleted: false } } };
        expectR1Scoped(where, { legacy: filerPin, pin: filerPin });
    });

    test('no scope fails closed, no query', async () => {
        await expect(plantingService.findOwnedApplicationDocuments(['d1'], USER)).resolves.toEqual([]);
        expect(mockPrisma.applicationDocument.findMany).not.toHaveBeenCalled();
    });
});

describe('quotation-service', () => {
    const quotationService = require('../../services/quotation-service');

    test('findQuotationsByApplicationId: with a holder scope the read carries the fragment; staff keep the plain where', async () => {
        await quotationService.findQuotationsByApplicationId(APP, { holderScope: SCOPE });
        const { where } = onlyCall(mockPrisma.quotation.findMany);
        expect(where.applicationId).toBe(APP);
        expectR1Scoped(where, { legacy: { applicationId: APP } });

        mockPrisma.quotation.findMany.mockClear();
        await quotationService.findQuotationsByApplicationId(APP);
        expect(onlyCall(mockPrisma.quotation.findMany).where).toEqual({ applicationId: APP, isDeleted: false });
    });

    test('markQuotationAccepted: the pre-read carries the fragment', async () => {
        await expect(quotationService.markQuotationAccepted('q1', { snapshot: {}, holderScope: SCOPE }))
            .rejects.toMatchObject({ code: 'QUOTATION_NOT_FOUND' });
        const { where } = onlyCall(mockPrisma.quotation.findFirst);
        expect(where.id).toBe('q1');
        expectR1Scoped(where, { legacy: { id: 'q1' } });
    });

    test('issueQuotationsForApplication: the application read is findFirst + fragment, the live-row probe carries the fragment', async () => {
        mockPrisma.application.findFirst.mockResolvedValue({ id: APP, formData: {}, isDeleted: false, organizationId: 'o' });
        mockPrisma.quotation.findMany.mockResolvedValue([{ id: 'q1', issuerType: 'PLATFORM' }]);
        await quotationService.issueQuotationsForApplication(APP, { holderScope: SCOPE });
        const appWhere = onlyCall(mockPrisma.application.findFirst).where;
        expect(appWhere.id).toBe(APP);
        expectR1Scoped(appWhere, { legacy: { id: APP }, fragment: APPLICATION_FRAGMENT });
        expect(mockPrisma.application.findUnique).not.toHaveBeenCalled();
        expectR1Scoped(onlyCall(mockPrisma.quotation.findMany).where, { legacy: { applicationId: APP } });
    });
});

describe('application-service applicant reads (submit, quotation doors)', () => {
    const { createApplicationApplicantQueryMethods } = require('../../services/application-service/application-applicant-query-methods');

    test('findDraftForSubmit({ applicationId, healthId, holderScope }): findFirst, fragment + R1 pin { healthId }', async () => {
        const service = createApplicationApplicantQueryMethods({ prisma: mockPrisma });
        await service.findDraftForSubmit({ applicationId: APP, healthId: HEALTH, holderScope: SCOPE });
        const { where } = onlyCall(mockPrisma.application.findFirst);
        expect(where.id).toBe(APP);
        expectR1Scoped(where, { legacy: { healthId: HEALTH }, pin: { healthId: HEALTH }, fragment: APPLICATION_FRAGMENT });
    });

    test('findDraftForSubmit without a scope fails closed, no query', async () => {
        const service = createApplicationApplicantQueryMethods({ prisma: mockPrisma });
        await expect(service.findDraftForSubmit({ applicationId: APP, healthId: HEALTH })).resolves.toBeNull();
        expect(mockPrisma.application.findFirst).not.toHaveBeenCalled();
    });

    test('getApplicationSlice: a holder scope reads findFirst + fragment; no scope (staff, renewals) keeps findUnique', async () => {
        const service = createApplicationApplicantQueryMethods({ prisma: mockPrisma });
        await service.getApplicationSlice(APP, { select: { id: true }, holderScope: SCOPE });
        const args = onlyCall(mockPrisma.application.findFirst);
        expect(args.where.id).toBe(APP);
        expectR1Scoped(args.where, { legacy: { id: APP }, fragment: APPLICATION_FRAGMENT });
        expect(args.select).toEqual({ id: true });
        expect(mockPrisma.application.findUnique).not.toHaveBeenCalled();

        await service.getApplicationSlice(APP, { select: { id: true } });
        expect(onlyCall(mockPrisma.application.findUnique)).toEqual({ where: { id: APP }, select: { id: true } });
    });
});

describe('document reads behind the upload, submit and requirements doors', () => {
    test('syncApplicationDocument: the same-upload probe and both slot reads carry the fragment', async () => {
        const { syncApplicationDocument } = require('../../services/application-document-sync');
        const tx = { applicationDocument: delegate() };
        mockPrisma.$transaction = jest.fn((fn) => fn(tx));
        await syncApplicationDocument(mockPrisma, {
            applicationId: APP, documentId: 'doc-1', slotId: 'land_rights', fileUrl: '/uploads/x.pdf', holderScope: SCOPE,
        });
        const probe = onlyCall(mockPrisma.applicationDocument.findFirst).where;
        expect(probe).toMatchObject({ applicationId: APP, documentId: 'doc-1' });
        expectR1Scoped(probe, { legacy: { applicationId: APP } });
        expect(tx.applicationDocument.findMany).toHaveBeenCalledTimes(2);
        for (const [args] of tx.applicationDocument.findMany.mock.calls) {
            expectR1Scoped(args.where, { legacy: { applicationId: APP } });
        }
    });

    test('assertRequiredDocumentsPresent: the document read carries the fragment when given a holder scope', async () => {
        const { assertRequiredDocumentsPresent } = require('../../services/application-document-requirements');
        await assertRequiredDocumentsPresent({
            application: { id: APP, formData: {}, entityId: null }, mode: 'first-submit', client: mockPrisma, holderScope: SCOPE,
        }).catch(() => {});
        const { where } = onlyCall(mockPrisma.applicationDocument.findMany);
        expect(where.applicationId).toBe(APP);
        expectR1Scoped(where, { legacy: { applicationId: APP } });
    });

    test('document pre-check: currentForSlots and acknowledge read with the fragment; staff keep their where', async () => {
        const precheck = require('../../services/document-precheck/service');
        await precheck.currentForSlots(APP, { holderScope: SCOPE });
        expectR1Scoped(onlyCall(mockPrisma.documentPrecheck.findMany).where, { legacy: { applicationId: APP } });

        await expect(precheck.acknowledge('pc-1', HEALTH, { holderScope: SCOPE })).rejects.toMatchObject({ code: 'NOT_FOUND' });
        const ack = onlyCall(mockPrisma.documentPrecheck.findFirst).where;
        expect(ack.id).toBe('pc-1');
        expectR1Scoped(ack, { legacy: { id: 'pc-1' } });
        expect(mockPrisma.documentPrecheck.findUnique).not.toHaveBeenCalled();

        mockPrisma.documentPrecheck.findMany.mockClear();
        await precheck.currentForSlots(APP);
        const staffWhere = onlyCall(mockPrisma.documentPrecheck.findMany).where;
        expect(hasHolderMarker(staffWhere)).toBe(false);
        expect(staffWhere.OR).toBeUndefined();
    });
});

describe('application-status-writer pre-read (revision-resubmit)', () => {
    test('with a holder scope the formData pre-read is findFirst + fragment', async () => {
        const { writeApplicationStatus } = require('../../services/application-status-writer');
        mockPrisma.application.findFirst.mockResolvedValue({ formData: {} });
        mockPrisma.application.update.mockResolvedValue({ id: APP, status: 'ASSIGNED_FOR_REVIEW' });
        mockPrisma.auditLog = delegate();
        mockPrisma.$transaction = jest.fn((fn) => (typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn)));
        await writeApplicationStatus({
            prisma: mockPrisma, applicationId: APP, fromStatus: 'REVISION_REQUESTED', toStatus: 'ASSIGNED_FOR_REVIEW',
            actorId: USER, actorRole: 'health', reason: 'REVISION_RESUBMITTED', holderScope: SCOPE, onAudit: null,
        }).catch(() => {});
        const { where } = onlyCall(mockPrisma.application.findFirst);
        expect(where.id).toBe(APP);
        expectR1Scoped(where, { legacy: { id: APP }, fragment: APPLICATION_FRAGMENT });
        expect(mockPrisma.application.findUnique).not.toHaveBeenCalled();
    });
});

describe('application-status-writer: a scoped pre-read that finds nothing never wipes formData', () => {
    test('scoped findFirst → null ⇒ the status is written WITHOUT a formData patch (no `{ workflowState }` over the real JSON)', async () => {
        const { writeApplicationStatus } = require('../../services/application-status-writer');
        mockPrisma.application.findFirst.mockResolvedValue(null);
        mockPrisma.application.update.mockResolvedValue({ id: APP, status: 'ASSIGNED_FOR_REVIEW' });
        mockPrisma.auditLog = delegate();
        mockPrisma.$transaction = jest.fn((fn) => (typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn)));
        await writeApplicationStatus({
            prisma: mockPrisma, applicationId: APP, fromStatus: 'REVISION_REQUESTED', toStatus: 'ASSIGNED_FOR_REVIEW',
            actorId: USER, actorRole: 'health', reason: 'REVISION_RESUBMITTED', holderScope: SCOPE, onAudit: null,
        }).catch(() => {});
        expect(mockPrisma.application.findFirst).toHaveBeenCalledTimes(1);
        expect(mockPrisma.application.update).toHaveBeenCalled();
        for (const [args] of mockPrisma.application.update.mock.calls) {
            expect(args.data.formData).toBeUndefined();
        }
    });

    test('control: unscoped (staff) pre-read that finds the row stamps workflowState onto the existing formData', async () => {
        const { writeApplicationStatus } = require('../../services/application-status-writer');
        mockPrisma.application.findUnique.mockResolvedValue({ formData: { keep: 'me' } });
        mockPrisma.application.update.mockResolvedValue({ id: APP, status: 'ASSIGNED_FOR_REVIEW' });
        mockPrisma.auditLog = delegate();
        mockPrisma.$transaction = jest.fn((fn) => (typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn)));
        await writeApplicationStatus({
            prisma: mockPrisma, applicationId: APP, fromStatus: 'REVISION_REQUESTED', toStatus: 'ASSIGNED_FOR_REVIEW',
            actorId: USER, actorRole: 'health', reason: 'REVISION_RESUBMITTED', onAudit: null,
        }).catch(() => {});
        const [args] = mockPrisma.application.update.mock.calls[0];
        expect(args.data.formData).toMatchObject({ keep: 'me', workflowState: 'ASSIGNED_FOR_REVIEW' });
    });
});

describe('stripe-checkout-service (POST /payments/checkout)', () => {
    const { createCheckoutForApplication } = require('../../services/checkout/stripe-checkout-service');

    test('the ownership read is findFirst + fragment, with the R1 pin { healthId } as the AND member', async () => {
        await expect(createCheckoutForApplication({
            applicationId: APP, milestone: 'M1', actor: { id: USER, healthId: HEALTH, holderScope: SCOPE, role: 'health' },
        })).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
        const { where } = onlyCall(mockPrisma.application.findFirst);
        expect(where.id).toBe(APP);
        expectR1Scoped(where, { legacy: { healthId: HEALTH }, pin: { healthId: HEALTH }, fragment: APPLICATION_FRAGMENT });
    });

    test('no holder scope on the actor fails closed (404), no query', async () => {
        await expect(createCheckoutForApplication({
            applicationId: APP, milestone: 'M1', actor: { id: USER, healthId: HEALTH, role: 'health' },
        })).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
        expect(mockPrisma.application.findFirst).not.toHaveBeenCalled();
    });
});

describe('holder-access R1 helpers (Task 4 fix round 1)', () => {
    const { r1LegacyFilerFragment, r1HolderOrLegacy } = require('../../services/holder-access');

    test('r1LegacyFilerFragment marks a COPY of the pre-R1 pin; the caller\'s object stays unfrozen', () => {
        const pin = { application: { healthId: HEALTH } };
        const legacy = r1LegacyFilerFragment('Quote', pin);
        expect(hasHolderMarker(legacy)).toBe(true);
        expect(plain(legacy)).toEqual(pin);
        expect(legacy).not.toBe(pin);
        expect(Object.isFrozen(pin)).toBe(false);
        expect(Object.isFrozen(pin.application)).toBe(false);
    });

    test('a missing or empty pin matches nothing; a model without a holder is refused', () => {
        expect(plain(r1LegacyFilerFragment('Certificate', null))).toEqual({ id: { in: [] } });
        expect(plain(r1LegacyFilerFragment('Certificate', {}))).toEqual({ id: { in: [] } });
        expect(() => r1LegacyFilerFragment('User', { id: 'x' })).toThrow(/not a holder-bearing model/);
    });

    test('r1HolderOrLegacy = { OR: [holder fragment, legacy] }, both marked — also for an empty holder set', () => {
        const where = r1HolderOrLegacy({ userId: USER, readIds: [], editIds: [] }, 'DocumentPrecheck', { applicationId: APP });
        expect(Object.keys(where)).toEqual(['OR']);
        expect(plain(where.OR)).toEqual([{ application: { entityId: { in: [] } } }, { applicationId: APP }]);
        expect(where.OR.every(hasHolderMarker)).toBe(true);
    });
});
