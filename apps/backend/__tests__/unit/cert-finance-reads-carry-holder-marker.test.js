'use strict';

/**
 * Certificate, document, pre-check and finance reads on the applicant side carry
 * the holder fragment (spec 2026-09-30-remove-workspace-mode §3.1, Task 4) and,
 * since R2 Task 12, the fragment alone: the R1 shape (where.OR = [fragment,
 * legacy] with the pre-R1 filer pin as the AND member) is gone.
 *
 * Per method, with a prisma double that records the args:
 *   1. the fragment is spread at the top level, marked and unaltered;
 *   2. no OR legacy branch, no AND pin, no filer key;
 *   3. a by-id read is findFirst({ where: { id, ...fragment } }), never findUnique.
 * Plus: no scope on an applicant-only method fails closed with no query, and a
 * staff/system caller of a shared method (no holderScope) keeps its where.
 *
 * The runtime witness (throw mode) is pinned on a real Postgres in
 * holder-write-doors-witness-real-postgres.test.js and holder-scope-real-postgres.test.js.
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
 * Assertions 1 + 2: the fragment's keys at the top level (marked), nothing else
 * deciding the rows.
 * @param {object} where
 * @param {{ fragment?: object }} [expected]
 */
function expectHolderScoped(where, { fragment = BY_APPLICATION } = {}) {
    expect(hasHolderMarker(where)).toBe(true);
    for (const [key, value] of Object.entries(fragment)) {
        expect(plain(where[key])).toEqual(value);
    }
    expect(where.OR).toBeUndefined();
    expect(where.AND).toBeUndefined();
    for (const key of ['healthId', 'userId', 'applicant']) {
        expect(Object.prototype.hasOwnProperty.call(where, key)).toBe(false);
    }
}

describe('certificate-service', () => {
    const certificateService = require('../../services/certificate-service');

    test('listCertificatesForUser(scope): the fragment alone { userId }', async () => {
        await certificateService.listCertificatesForUser(SCOPE);
        const { where } = onlyCall(mockPrisma.certificate.findMany);
        expectHolderScoped(where);
        expect(where.isDeleted).toBe(false);
    });

    test('listCertificatesForUser without a scope (or with a positional userId) fails closed, no query', async () => {
        await expect(certificateService.listCertificatesForUser()).resolves.toEqual([]);
        await expect(certificateService.listCertificatesForUser(USER)).resolves.toEqual([]);
        expect(mockPrisma.certificate.findMany).not.toHaveBeenCalled();
    });

    test('getCertificateForUser(id, scope, opts): findFirst by id with the fragment alone, select/include passed through', async () => {
        await certificateService.getCertificateForUser(CERT, SCOPE, { select: { id: true } });
        const args = onlyCall(mockPrisma.certificate.findFirst);
        expect(args.where.id).toBe(CERT);
        expectHolderScoped(args.where);
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
        expectHolderScoped(where);
        expect(mockPrisma.certificate.findUnique).not.toHaveBeenCalled();

        await expect(certificateService.getCertificatePdf(CERT)).rejects.toThrow('Certificate not found');
        expect(onlyCall(mockPrisma.certificate.findUnique)).toEqual({ where: { id: CERT } });
    });
});

describe('document-service (report submissions)', () => {
    const documentService = require('../../services/document-service');

    test('listActiveCertificatesForUser(scope): the fragment alone { userId }', async () => {
        await documentService.listActiveCertificatesForUser(SCOPE);
        const { where } = onlyCall(mockPrisma.certificate.findMany);
        expectHolderScoped(where);
        expect(where.status).toBe('active');
    });

    test('findCertificateForUser(id, scope): findFirst by id, the fragment alone', async () => {
        await documentService.findCertificateForUser(CERT, SCOPE);
        const { where } = onlyCall(mockPrisma.certificate.findFirst);
        expect(where.id).toBe(CERT);
        expectHolderScoped(where);
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

    test('listForApplicant(healthId, { holderScope }): the fragment alone { application: { healthId } }', async () => {
        await quoteService.listForApplicant(HEALTH, { holderScope: SCOPE, status: 'SENT' });
        const { where } = onlyCall(mockPrisma.quote.findMany);
        expectHolderScoped(where);
        expect(where.status).toBe('SENT');
    });

    test('no scope fails closed, no query', async () => {
        await expect(quoteService.listForApplicant(HEALTH)).resolves.toEqual([]);
        expect(mockPrisma.quote.findMany).not.toHaveBeenCalled();
    });
});

// planting-service.findOwnedApplicationDocuments was deleted 2026-10-03 (C4 round 2):
// activity attachments are the cycle's Attachment rows, not application documents.

describe('quotation-service', () => {
    const quotationService = require('../../services/quotation-service');

    test('findQuotationsByApplicationId: with a holder scope the read carries the fragment; staff keep the plain where', async () => {
        await quotationService.findQuotationsByApplicationId(APP, { holderScope: SCOPE });
        const { where } = onlyCall(mockPrisma.quotation.findMany);
        expect(where.applicationId).toBe(APP);
        expectHolderScoped(where);

        mockPrisma.quotation.findMany.mockClear();
        await quotationService.findQuotationsByApplicationId(APP);
        expect(onlyCall(mockPrisma.quotation.findMany).where).toEqual({ applicationId: APP, isDeleted: false });
    });

    test('markQuotationAccepted: the pre-read carries the fragment', async () => {
        await expect(quotationService.markQuotationAccepted('q1', { snapshot: {}, holderScope: SCOPE }))
            .rejects.toMatchObject({ code: 'QUOTATION_NOT_FOUND' });
        const { where } = onlyCall(mockPrisma.quotation.findFirst);
        expect(where.id).toBe('q1');
        expectHolderScoped(where);
    });

    test('issueQuotationsForApplication: the application read is findFirst + fragment, the live-row probe carries the fragment', async () => {
        mockPrisma.application.findFirst.mockResolvedValue({ id: APP, formData: {}, isDeleted: false, organizationId: 'o' });
        mockPrisma.quotation.findMany.mockResolvedValue([{ id: 'q1', issuerType: 'PLATFORM' }]);
        await quotationService.issueQuotationsForApplication(APP, { holderScope: SCOPE });
        const appWhere = onlyCall(mockPrisma.application.findFirst).where;
        expect(appWhere.id).toBe(APP);
        expectHolderScoped(appWhere, { fragment: APPLICATION_FRAGMENT });
        expect(mockPrisma.application.findUnique).not.toHaveBeenCalled();
        expectHolderScoped(onlyCall(mockPrisma.quotation.findMany).where);
    });
});

describe('application-service applicant reads (submit, quotation doors)', () => {
    const { createApplicationApplicantQueryMethods } = require('../../services/application-service/application-applicant-query-methods');

    // R2 Task 9 (spec §3.2 Submit): by id, the fragment alone; who may submit is
    // the submit guard's question. R2 Task 12: the id-less fallback is the caller's
    // own filing (submitterId) within the fragment.
    test('findDraftForSubmit({ applicationId, holderScope }): findFirst({ where: { id, ...fragment, isDeleted: false } })', async () => {
        const service = createApplicationApplicantQueryMethods({ prisma: mockPrisma });
        await service.findDraftForSubmit({ applicationId: APP, healthId: HEALTH, holderScope: SCOPE });
        const { where } = onlyCall(mockPrisma.application.findFirst);
        expect(where.id).toBe(APP);
        expect(where.isDeleted).toBe(false);
        expect(hasHolderMarker(where)).toBe(true);
        expect(where.entityId).toEqual(APPLICATION_FRAGMENT.entityId);
        expect(where.OR).toBeUndefined();
        expect(where.AND).toBeUndefined();
        for (const key of FILER_PIN_KEYS) { expect(where[key]).toBeUndefined(); }
    });

    test('findDraftForSubmit without an id: the fragment alone { healthId } (Task 12), open source states only', async () => {
        const service = createApplicationApplicantQueryMethods({ prisma: mockPrisma });
        await service.findDraftForSubmit({ healthId: HEALTH, holderScope: SCOPE });
        const { where } = onlyCall(mockPrisma.application.findFirst);
        expectHolderScoped(where, { fragment: APPLICATION_FRAGMENT });
        expect(where.status).toEqual({ in: ['DRAFT', 'REVISION_REQUESTED', 'CAR_PENDING'] });
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
        expectHolderScoped(args.where, { fragment: APPLICATION_FRAGMENT });
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
        expectHolderScoped(probe);
        expect(tx.applicationDocument.findMany).toHaveBeenCalledTimes(2);
        for (const [args] of tx.applicationDocument.findMany.mock.calls) {
            expectHolderScoped(args.where);
        }
    });

    test('assertRequiredDocumentsPresent: the document read carries the fragment when given a holder scope', async () => {
        const { assertRequiredDocumentsPresent } = require('../../services/application-document-requirements');
        await assertRequiredDocumentsPresent({
            application: { id: APP, formData: {}, entityId: null }, mode: 'first-submit', client: mockPrisma, holderScope: SCOPE,
        }).catch(() => {});
        const { where } = onlyCall(mockPrisma.applicationDocument.findMany);
        expect(where.applicationId).toBe(APP);
        expectHolderScoped(where);
    });

    test('document pre-check: currentForSlots and acknowledge read with the fragment; staff keep their where', async () => {
        const precheck = require('../../services/document-precheck/service');
        await precheck.currentForSlots(APP, { holderScope: SCOPE });
        expectHolderScoped(onlyCall(mockPrisma.documentPrecheck.findMany).where);

        await expect(precheck.acknowledge('pc-1', HEALTH, { holderScope: SCOPE })).rejects.toMatchObject({ code: 'NOT_FOUND' });
        const ack = onlyCall(mockPrisma.documentPrecheck.findFirst).where;
        expect(ack.id).toBe('pc-1');
        expectHolderScoped(ack);
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
        expectHolderScoped(where, { fragment: APPLICATION_FRAGMENT });
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

    test('the ownership read is findFirst + the fragment alone (no filer pin, R2 Task 12)', async () => {
        await expect(createCheckoutForApplication({
            applicationId: APP, milestone: 'M1', actor: { id: USER, holderScope: SCOPE, role: 'health' },
        })).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
        const { where } = onlyCall(mockPrisma.application.findFirst);
        expect(where.id).toBe(APP);
        expectHolderScoped(where, { fragment: APPLICATION_FRAGMENT });
    });

    test('no holder scope on the actor fails closed (404), no query', async () => {
        await expect(createCheckoutForApplication({
            applicationId: APP, milestone: 'M1', actor: { id: USER, role: 'health' },
        })).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
        expect(mockPrisma.application.findFirst).not.toHaveBeenCalled();
    });
});
