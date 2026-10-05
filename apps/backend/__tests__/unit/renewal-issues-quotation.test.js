'use strict';
/**
 * A renewal application must be quoted at creation.
 *
 * renewal-service creates the application directly at PENDING_AUDIT_FEE
 * (RENEWAL_ENTRY_STATE) without passing through either submit door, so neither
 * issueQuotationsForApplication call site ever fires for it. PENDING_AUDIT_FEE
 * is an M2-payable state, so once the acceptance gate is fail-closed an
 * unquoted renewal cannot be paid at all.
 *
 * quotation-service already prices a renewal correctly (_resolveBillableFees to
 * calculateRenewalFee, ONE PHASE_2 instalment); it was simply never called.
 */
// The holder-capability gate (operator ruling 2026-10-03, via application-submit-guard)
// reads memberships on the real client; this stub-prisma suite is not about who may renew, so the gate
// lets everyone through. The gate itself is proven on a real Postgres in
// __tests__/integration/renewal-requires-submit-capability-real-postgres.test.js.
const mockAssertSubmitAllowed = jest.fn(async ({ application }) => ({ entityId: application.entityId }));
jest.mock('../../services/application-submit-guard', () => ({
    assertSubmitAllowed: (...a) => mockAssertSubmitAllowed(...a),
    recordSubmitDenial: async () => {},
}));
jest.mock('../../services/holder-access', () => ({
    r1HolderOrLegacyWhenScoped: () => ({}),
}));
const mockIssue = jest.fn(async () => ({
    company: { id: 'qt-ren-1' }, dtam: null, platform: { id: 'qt-ren-1' },
}));
jest.mock('../../services/quotation-service', () => ({
    issueQuotationsForApplication: (...a) => mockIssue(...a),
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});
const mockAuditLog = jest.fn(async () => ({}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAuditLog(...a) },
    AuditCategory: { APPLICATION: 'APPLICATION', PAYMENT: 'PAYMENT' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));
const mockNotifyAdmin = jest.fn(async () => {});
jest.mock('../../services/notification/domain-helpers', () => {
    const actual = jest.requireActual('../../services/notification/domain-helpers');
    return { ...actual, notifyAdminQuotationIssueFailed: (...a) => mockNotifyAdmin(...a) };
});

// `userId` is load-bearing: createRenewalApplication refuses anyone but the
// certificate owner (renewal-service.js:285 FORBIDDEN_NOT_OWNER), so a stub
// without it never reaches the code under test.
const CERT = {
    id: 'cert-old-1',
    userId: 'user-1',
    certificateNumber: 'GACP-TH-2568-000001',
    status: 'ACTIVE',
    expiryDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    applicationId: 'app-src-1',
    organizationId: 'org-1',
    isDeleted: false,
    // The holder, read through the certificate's own application relation. A
    // null holder is now refused before any write (APPLICANT_ENTITY_MISSING).
    application: { entityId: 'entity-1' },
};
const SOURCE_APP = {
    id: 'app-src-1',
    healthId: 'HID-1',
    organizationId: 'org-1',
    entityId: 'entity-1',
    areaType: 'OUTDOOR',
    formData: { cultivationMethods: ['outdoor'] },
    cultivationScopeCount: 1,
    isDeleted: false,
};
const prismaStub = {
    certificate: { findFirst: jest.fn(async () => CERT), findUnique: jest.fn(async () => CERT) },
    application: {
        findFirst: jest.fn(async () => SOURCE_APP),
        findUnique: jest.fn(async () => SOURCE_APP),
        create: jest.fn(async ({ data }) => ({ id: 'app-ren-1', ...data })),
    },
};

const renewalService = require('../../services/renewal-service');

beforeEach(() => jest.clearAllMocks());

test('creating a renewal application issues its quotation', async () => {
    await renewalService.createRenewalApplication({
        originalCertificateId: 'cert-old-1',
        actorId: 'user-1',
        actorRole: 'HEALTH',
        prisma: prismaStub,
    });
    expect(mockIssue).toHaveBeenCalledTimes(1);
    expect(mockIssue).toHaveBeenCalledWith('app-ren-1', expect.objectContaining({ actorId: 'user-1' }));
});

test('a quotation failure does not undo the renewal application already created', async () => {
    mockIssue.mockRejectedValueOnce(new Error('numbering down'));
    const result = await renewalService.createRenewalApplication({
        originalCertificateId: 'cert-old-1',
        actorId: 'user-1',
        actorRole: 'HEALTH',
        prisma: prismaStub,
    });
    // The resolved shape is `{ applicationId, renewalOf, ... }` — read from
    // renewal-service.js:427 and from its only caller, routes/api/applications/
    // renewals.js:102, which reads `result.applicationId`. Asserted under that
    // name so this test breaks if the contract the route depends on moves.
    expect(result.applicationId).toBe('app-ren-1');
    expect(result.quotation).toEqual({ issued: false, error: 'QUOTATION_ISSUE_FAILED' });
});

/**
 * Fix round 1 (reviewer MAJOR M1) — the THIRD issuance door audits and notifies
 * like the other two, because it goes through the same helper.
 *
 * It used to hand-roll its own try/catch: it returned the same
 * { issued:false, error:'QUOTATION_ISSUE_FAILED' } and wrote the same log line,
 * but no QUOTATION_ISSUE_FAILED audit row and no admin notification — while the
 * helper's docstring claimed to be the ONE place that block lives. Same
 * failure, same consequence once the acceptance gate is fail-closed (a renewal
 * that cannot be paid on either rail), two different levels of visibility: the
 * submit doors page somebody, the renewal door pages nobody.
 */
describe('a renewal whose issuance fails is as loud as a submit whose issuance fails', () => {
    const failedIssueRows = () => mockAuditLog.mock.calls
        .map(([entry]) => entry)
        .filter((entry) => entry.action === 'QUOTATION_ISSUE_FAILED');

    test('writes the QUOTATION_ISSUE_FAILED audit row, naming the renewal application', async () => {
        mockIssue.mockRejectedValueOnce(Object.assign(new Error('numbering down'), { code: 'SEQ_LOCK' }));
        await renewalService.createRenewalApplication({
            originalCertificateId: 'cert-old-1',
            actorId: 'user-1',
            actorRole: 'HEALTH',
            prisma: prismaStub,
        });
        expect(failedIssueRows()).toHaveLength(1);
        expect(failedIssueRows()[0]).toMatchObject({
            action: 'QUOTATION_ISSUE_FAILED',
            resourceId: 'app-ren-1',
            actorId: 'user-1',
            // AuditLog.actorRole is NOT NULL (prisma/schema/audit.prisma:25) —
            // an omitted role writes NO ROW at all, which is the failure
            // renewal-service.js already recorded once against the live
            // database for its own fast-path row.
            actorRole: 'HEALTH',
        });
    });

    test('pushes the failure to the admin queue', async () => {
        mockIssue.mockRejectedValueOnce(new Error('numbering down'));
        await renewalService.createRenewalApplication({
            originalCertificateId: 'cert-old-1',
            actorId: 'user-1',
            actorRole: 'HEALTH',
            prisma: prismaStub,
        });
        expect(mockNotifyAdmin).toHaveBeenCalledWith(expect.objectContaining({
            applicationId: 'app-ren-1',
        }));
    });

    test('a successful renewal issuance writes no failure record and pages nobody', async () => {
        await renewalService.createRenewalApplication({
            originalCertificateId: 'cert-old-1',
            actorId: 'user-1',
            actorRole: 'HEALTH',
            prisma: prismaStub,
        });
        expect(failedIssueRows()).toHaveLength(0);
        expect(mockNotifyAdmin).not.toHaveBeenCalled();
    });
});

test('issuance runs on the client the caller injected, not on a module global', async () => {
    // Fix round 1 (reviewer, major): createRenewalApplication resolves its own
    // Prisma client at renewal-service.js:258 (resolvePrisma(injectedPrisma)),
    // but issuance ignored it and quotation-service fell back to its module
    // global. Two costs, both real: a caller that passes a transactional or
    // tenant-scoped client has its not-yet-visible application row looked up on
    // a DIFFERENT connection (APPLICATION_NOT_FOUND, and the log blames
    // issuance instead of the client), and every suite that injects a stub
    // prisma opens a real connection to DATABASE_URL and waits for it to time
    // out. quotation-service._resolvePrisma (quotation-service.js:74) honours
    // `tx` and falls back to the global, so passing it changes nothing when
    // nothing was injected.
    await renewalService.createRenewalApplication({
        originalCertificateId: 'cert-old-1',
        actorId: 'user-1',
        actorRole: 'HEALTH',
        prisma: prismaStub,
    });
    expect(mockIssue).toHaveBeenCalledWith('app-ren-1', expect.objectContaining({
        actorId: 'user-1',
        tx: prismaStub,
    }));
});

test('the renewal row is stamped with the scope count its own formData implies', async () => {
    // Fix round 2 (reviewer, BLOCKER): createPayload stamped no scope count, so
    // the renewal row carried NULL (and, once the DB default landed,
    // totalAreaTypes = 1). quotation-service._resolveBillableFees
    // (quotation-service.js:278) turns that into an EXPLICIT { scopeCount: 1 },
    // and resolveCultivationScopeCount (modules/billing/internal/fee-service.js
    // :107-111) honours an explicit option OVER the carried-forward
    // formData.cultivationMethods. Every other renewal money surface derives the
    // count from formData instead: stripe-checkout-service.breakdownForMilestone
    // calls calculateRenewalFee(feeContext) with no explicit scopeCount
    // (services/checkout/stripe-checkout-service.js:137), and the
    // cultivationScopeCount key it puts on feeContext is documented inert
    // (:121-125). Measured divergence for this exact formData, 2 methods:
    // quotation 35,310 THB vs checkout 70,620 THB.
    //
    // A new application is unaffected because the submit door stamps the column
    // (application-submission-methods.js:156) before issuance at
    // applications.js:1211; a renewal passes through neither door.
    const twoScopeApp = {
        ...SOURCE_APP,
        formData: { cultivationMethods: ['outdoor', 'greenhouse'] },
    };
    prismaStub.application.findFirst.mockResolvedValueOnce(twoScopeApp);

    await renewalService.createRenewalApplication({
        originalCertificateId: 'cert-old-1',
        actorId: 'user-1',
        actorRole: 'HEALTH',
        prisma: prismaStub,
    });

    const created = prismaStub.application.create.mock.calls[0][0].data;
    expect(created.cultivationScopeCount).toBe(2);
    // The retired name for the same number, written by every other writer
    // (application-submission-methods.js:161, application-draft-query-methods
    // .js:76) so a rollback to the previous image still prices correctly. Its
    // column default is 1 (prisma/schema/application.prisma:80), so leaving it
    // unwritten is not neutral: it actively states "one scope".
    expect(created.totalAreaTypes).toBe(2);
});

test('a single-method renewal is still one scope (the fix does not inflate a price)', async () => {
    await renewalService.createRenewalApplication({
        originalCertificateId: 'cert-old-1',
        actorId: 'user-1',
        actorRole: 'HEALTH',
        prisma: prismaStub,
    });
    const created = prismaStub.application.create.mock.calls[0][0].data;
    expect(created.cultivationScopeCount).toBe(1);
    expect(created.totalAreaTypes).toBe(1);
});

test('the quotation end and the checkout end now price the renewal identically', async () => {
    // The convergence this whole fix exists for, driven by the row
    // createRenewalApplication actually builds.
    //
    // HONEST SCOPE OF THIS PIN: it calls the REAL calculateRenewalFee and the
    // REAL storedCultivationScopeCount, but reconstructs the two CALL SHAPES,
    // because breakdownForMilestone is not exported (stripe-checkout-service.js
    // :366-370). Each shape is a single cited line:
    //   quotation: quotation-service.js:278-279
    //              calculateRenewalFee(formData, { scopeCount: stored ?? 1 })
    //   checkout:  stripe-checkout-service.js:137
    //              calculateRenewalFee(feeContext)   // no options
    const { calculateRenewalFee } = require('../../modules/billing');
    const { storedCultivationScopeCount } = require('../../shared/application-scope');

    const threeScopeApp = {
        ...SOURCE_APP,
        formData: { cultivationMethods: ['outdoor', 'greenhouse', 'indoor'] },
    };
    prismaStub.application.findFirst.mockResolvedValueOnce(threeScopeApp);

    await renewalService.createRenewalApplication({
        originalCertificateId: 'cert-old-1',
        actorId: 'user-1',
        actorRole: 'HEALTH',
        prisma: prismaStub,
    });
    const row = prismaStub.application.create.mock.calls[0][0].data;

    const quotationSide = calculateRenewalFee(row.formData, {
        scopeCount: storedCultivationScopeCount(row) ?? 1,
    });
    const checkoutSide = calculateRenewalFee({
        ...row.formData,
        cultivationScopeCount: storedCultivationScopeCount(row),
    });

    expect(quotationSide.scopeCount).toBe(3);
    expect(checkoutSide.scopeCount).toBe(3);
    expect(quotationSide.phaseTotal).toBe(checkoutSide.phaseTotal);
    // Before the stamp the quotation side read 35,310 here while the checkout
    // side read 105,930 — a 70,620 THB gap on one renewal.
    expect(quotationSide.phaseTotal).toBe(105930);
});
