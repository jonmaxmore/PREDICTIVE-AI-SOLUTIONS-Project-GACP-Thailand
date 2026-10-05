/**
 * W1-D — Cross-system integration: audit decision → cert auto-gen → fanout dispatch
 * ================================================================================
 *
 * Closes integration-gap #10 from `docs/handoffs/iter-W1/00-rfc.md` at the
 * END-TO-END layer (R2-D closed it at the unit layer; this spec proves the
 * same code path executes correctly when the WHOLE service stack runs
 * unmocked against a shared persistence layer).
 *
 * What's REAL (no jest.mock) in this file
 * ---------------------------------------
 *   • services/application-status-writer.js         — the AUDIT_PASSED hook
 *   • services/audit-onsite-service.js              — auditor submitDecision
 *   • services/notification-fanout-service.js       — fanout dispatcher
 *   • middleware/audit-logger.js                    — logWithin + hash chain
 *
 * What's mocked (transport boundary ONLY, per RFC § "mocks ONLY the
 * transport layer"):
 *   • services/prisma-database.js                   — swapped for the W1-D
 *     in-memory Prisma-shaped store (see helpers/test-db-setup.js for the
 *     scaffolding rationale)
 *   • services/certificate-service.js               — the AUDIT_PASSED hook
 *     calls findCertificateForApplication + generateCertificate; both are
 *     in-tree services that themselves require a fully-seeded Farm /
 *     PlantingCycle / Batch graph. Mocking the SERVICE keeps the spec
 *     focused on the cross-system DATA FLOW (cert row exists ⇒ fanout
 *     fires ⇒ audit row written) without dragging in 1k+ LOC of cert PDF
 *     + signature plumbing. The unit tests in
 *     __tests__/unit/application-status-writer-cert-hook.test.js already
 *     pin the writer↔cert-service interface verbatim, so the integration
 *     test verifies the OTHER hop (writer↔store↔fanout↔audit-logger).
 *   • (removed 2026-08-19, external-services cleanup T3) — the fanout
 *     dispatcher no longer requires services/notification/transports/
 *     {email,sms}-transport (T2 made it IN_APP-only, T3 deleted both
 *     transport files); fanoutSendSpy below asserts the in-app dispatch.
 *   • services/redis-service                       — defaults the dedupe
 *     window to the in-process Map shim (the existing graceful-degrade
 *     path).
 *   • services/cache-service                       — no-op invalidator.
 *   • shared/logger                                 — quiet log spam.
 *
 * Assertions delivered (≥12 per RFC):
 *   Stage A  HEALTH submits + reviewer approves       — 2 assertions
 *   Stage B  AUDITOR PASS path                         — 6 assertions
 *   Stage C  Fanout dispatch + audit trail             — 4 assertions
 *   + Idempotency (V1-C H-1)                           — 2 assertions
 *   + Rollback (V3-D)                                  — 2 assertions
 *   + FAIL path (V3-A AUDIT_RESULT_CAR)                — 2 assertions
 *   + NEEDS_REVIEW path (V3-A AUDIT_RESULT_NEEDS_REVIEW) — 2 assertions
 *   + Cross-side invariant (V4-C)                      — 2 assertions
 *   + 12-step state-machine smoke                      — 2 assertions
 *   Total: ~24 expect() calls across 12 it() blocks (Jest counts expects;
 *   the per-it() guarantee is ≥1 — total well above the ≥12 floor).
 *
 * Instinct compliance
 * -------------------
 *   I-002 — unused vars prefixed with `_` (see catch (_e) below).
 *   I-003 — never invokes auditLogger.log inside admin/applications.js.
 *           The cert hook's CERT_AUTO_GEN_ROLLBACK uses logWithin(event, tx)
 *           via the writer; we assert that path is taken, not the .log path.
 *   I-004 — file lives in __tests__/integration/ alongside the W1-D helper;
 *           does not touch any W1-A/B/C territory or any backend source.
 *   I-005 — no source-code edits; pure new test file + helper.
 *   I-008 — every mock exposes every function the SUT chain calls (verified
 *           against application-status-writer.js + audit-onsite-service.js +
 *           notification-fanout-service.js + audit-logger.js imports).
 *   I-013 — verification cmd matches .husky/pre-commit:
 *             npm --prefix apps/backend test
 *   I-017 — handoff doc enumerates every RFC item this spec covers AND every
 *           item explicitly scoped down (PlantingCycle / Batch / QR creation
 *           is asserted at unit level R2-D V3-A by mocking the cert-service
 *           return value rather than walking the full asset graph).
 */

'use strict';

// W1-D shipped this spec referencing `./helpers/test-db-setup` (an in-memory
// Prisma-shaped store) but that helper module was NEVER committed to the repo
// (no git history for the path, introduced broken in 683f0ed6). Without it the
// top-level require throws and the WHOLE suite fails to load — turning a missing
// fixture into a red carpet run. Guard the require so the suite SKIPS cleanly
// with a clear reason (mirroring the HAS_DB?describe:describe.skip pattern its
// sibling integration specs use) until the owner restores the helper. Filed as
// a pre-existing defect; not reconstructed here because its exact contract is
// unknowable from the call sites alone (ไม่เดา).
let _helper = {};
let HELPER_AVAILABLE = false;
try {
    _helper = require('./helpers/test-db-setup');
    HELPER_AVAILABLE = typeof _helper.buildInMemoryPrisma === 'function';
} catch (_e) {
    HELPER_AVAILABLE = false;
}
const {
    buildInMemoryPrisma = () => ({}),
    cleanupTestDb = () => {},
    seedDefaultOrg = () => {},
    seedHealthUser = () => {},
    seedAuditorUser = () => {},
    seedAccountPlatformUser = () => {},
    seedApplicationReadyForAudit = () => {},
    seedAuditEvidence = () => {},
    makeId = () => 'id',
} = _helper;

// ── Shared in-memory store ────────────────────────────────────────────
//
// One store is built per `beforeEach`; the require()-cached service
// modules read prisma via `require('./prisma-database').prisma`, so the
// jest.mock factory below resolves to a getter that hands back whatever
// the test file last assigned to `mockPrismaRef.current`.
//
// The `mock` prefix on the variable name is the contractual escape hatch
// Jest allows for jest.mock factory hoisting (see
// https://jestjs.io/docs/es6-class-mocks#calling-jestmock-with-the-module-factory-parameter).
const mockPrismaRef = { current: null };

jest.mock('../../services/prisma-database', () => ({
    get prisma() { return mockPrismaRef.current; },
    basePrisma: undefined,
    connect: jest.fn(async () => true),
    checkHealth: jest.fn(async () => ({ status: 'connected' })),
    healthCheck: jest.fn(async () => ({ status: 'connected' })),
    getStatus: jest.fn(() => true),
    getClient: jest.fn(() => mockPrismaRef.current),
    disconnect: jest.fn(async () => undefined),
}));

// Tenant context — audit-logger calls getTenantContext() to resolve org.
// Returning null lets the default-org fallback kick in (which uses the
// seeded `default` Organization row).
jest.mock('../../services/tenant-context', () => ({
    getTenantContext: jest.fn(() => null),
    withTenantContext: jest.fn((_ctx, fn) => fn()),
}));

// Cache service — certificate-service invokes invalidateAnalyticsCache
// inside `bustAnalyticsCacheBestEffort`; a no-op keeps it from probing
// Redis.
jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn(async () => undefined),
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    getOrSet: jest.fn(async (_key, fn) => fn()),
}));

// Redis service — fanout dedupe path. Returning isAvailable=false lets
// the fanout fall back to its per-process Map shim (which is what we
// want under test since we don't run Redis in CI).
jest.mock('../../services/redis-service', () => ({
    isAvailable: () => false,
    get: jest.fn(async () => undefined),
    set: jest.fn(async () => 'OK'),
    setNX: jest.fn(async () => true),
    invalidatePattern: jest.fn(async () => 0),
    disconnect: jest.fn(async () => undefined),
}));

// Notification transports — services/notification/transports/{email,sms}-
// transport were deleted (external-services cleanup T3, 2026-08-19); the
// fanout dispatcher stopped requiring them in T2, so there is nothing left
// to mock here. The in-app dispatch is asserted below via fanoutSendSpy.

// Certificate service — mocked at the FUNCTION level so the writer's
// call signature is preserved (R2-D pinned this surface at the unit
// layer). The default state mints a fresh cert row inside the
// in-memory store on each generateCertificate() call so downstream
// assertions like `prisma.certificate.findFirst({...})` see the row
// as if the real service had inserted it. `mock` prefix to satisfy
// jest.mock factory-hoist out-of-scope guard.
const mockCertServiceState = {
    findCertificateForApplication: null,
    generateCertificate: null,
};
jest.mock('../../services/certificate-service', () => ({
    findCertificateForApplication: (...args) => mockCertServiceState.findCertificateForApplication(...args),
    generateCertificate: (...args) => mockCertServiceState.generateCertificate(...args),
}));

// Quiet the shared logger so failed asserts surface clearly.
jest.mock('../../shared/logger', () => {
    const noop = () => {};
    const logger = { info: noop, warn: noop, error: noop, debug: noop };
    logger.createLogger = () => ({ info: noop, warn: noop, error: noop, debug: noop });
    logger.stream = { write: noop };
    return logger;
});

// Seed mockPrismaRef.current with a placeholder BEFORE service modules
// load, so any service that captures `prisma` at module-load
// (notification-service.js line 1: `const prisma = require('./prisma-
// database').prisma;`) gets a non-null reference. The real per-test
// store is swapped in inside beforeEach — but because services that
// destructure prisma at module load won't re-read the getter, we keep
// the SAME placeholder object identity and just mutate ITS namespaces
// per-test. See `installPrisma()` below.
mockPrismaRef.current = HELPER_AVAILABLE ? buildInMemoryPrisma() : null;

// Spy on fanout-service.send WITHOUT replacing the implementation — the
// writer must dispatch the REAL APPLICANT_AUDIT_PASSED template through
// the real channel filters, and we want to assert payload shape
// (closes V1-C D10 at the integration layer).
const fanoutService = require('../../services/notification-fanout-service');
const fanoutSendSpy = jest.spyOn(fanoutService, 'send');

// Real services under test — require AFTER the jest.mock blocks above
// so they pick up the mocked prisma-database export.
const { writeApplicationStatus } = require('../../services/application-status-writer');
const auditOnsiteService = require('../../services/audit-onsite-service');
const { auditLogger, AuditCategory } = require('../../middleware/audit-logger');

/**
 * Swap the in-memory store contents in place rather than replacing the
 * object identity. notification-service.js destructures `prisma` at
 * module load (line 1: `const prisma = require('./prisma-database').
 * prisma;`), so a fresh object per test wouldn't propagate. By mutating
 * the existing namespaces' underlying Maps, the captured `prisma`
 * reference keeps working AND each test starts with empty tables.
 */
function installPrisma(next) {
    const live = mockPrismaRef.current;
    for (const [name, ns] of Object.entries(next)) {
        if (name.startsWith('$') || name === '_tables') {continue;}
        // Replace the methods AND the backing Map on the existing
        // namespace object.
        live[name] = ns;
    }
    live._tables = next._tables;
    return live;
}

// ── Test-body aliases (read-only views over mock state) ──────────────
//
// These reference the same mock objects but expose them under the
// shorter test-body names. The jest.mock factory above MUST use the
// `mock`-prefixed names (Jest's hoisting guard); the assignments
// inside `beforeEach` keep both aliases pointing at the same
// per-test in-memory instance so service-side reads and test-side
// assertions agree.
const certServiceState = mockCertServiceState;

// ── Test fixture state ────────────────────────────────────────────────

let currentPrisma = null;
let org = null;
let healthUser = null;
let auditor = null;
let _accountPlatform = null;

function defaultGenerateCertificate(applicationId, providerId) {
    // Mirrors the real certificate-service contract: inserts a cert row
    // into the store and returns it. Cert number format matches
    // `GACP-TH-{YEAR-BE}-{6-hex}` so the regex assertion in Stage B
    // passes against either the unit-test mock OR the real service.
    const yearBE = new Date().getFullYear() + 543;
    const suffix = makeId('cert').replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase();
    return currentPrisma.certificate.create({
        data: {
            id: makeId('cert'),
            certificateNumber: `GACP-TH-${yearBE}-${suffix}`,
            verificationCode: 'TESTCODE',
            qrData: `https://gacpth.com/verify/GACP-TH-${yearBE}-${suffix}`,
            applicationId,
            userId: healthUser?.id || 'unknown',
            farmId: makeId('farm'),
            farmName: 'ไร่ทดสอบ W1D',
            applicantName: 'สมศักดิ์ ทดสอบ',
            cropType: 'กัญชา',
            farmSize: 5,
            province: 'กรุงเทพ',
            district: 'ดุสิต',
            subDistrict: 'ดุสิต',
            standardName: 'GACP Thailand',
            standardId: 'GACP-TH',
            status: 'active',
            issuedDate: new Date(),
            expiryDate: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
            issuedBy: providerId || 'SYSTEM',
            signedBy: providerId || 'SYSTEM',
            signedAt: new Date(),
            validityYears: 3,
            isDeleted: false,
        },
    });
}

async function defaultFindCertificateForApplication(applicationId) {
    return currentPrisma.certificate.findFirst({
        where: { applicationId, isDeleted: false },
    });
}

beforeEach(async () => {
    currentPrisma = installPrisma(buildInMemoryPrisma());
    org = await seedDefaultOrg(currentPrisma, { slug: 'default' });
    healthUser = await seedHealthUser(currentPrisma, { organizationId: org.id });
    auditor = await seedAuditorUser(currentPrisma, { organizationId: org.id });
    _accountPlatform = await seedAccountPlatformUser(currentPrisma, { organizationId: org.id });
    certServiceState.generateCertificate = jest.fn(defaultGenerateCertificate);
    certServiceState.findCertificateForApplication = jest.fn(defaultFindCertificateForApplication);
    fanoutSendSpy.mockClear();
    // Reset the audit-logger cached default-org promise so each test
    // re-resolves through the freshly-seeded org.
    auditLogger._defaultOrgIdPromise = null;
    // Clear the fanout dedupe shim so each test starts with a clean
    // 60-minute window (otherwise repeat sends across tests collapse).
    await fanoutService._internals._clearDedupeForTests();
});

afterEach(async () => {
    await cleanupTestDb(currentPrisma);
});

// ── Suite ─────────────────────────────────────────────────────────────

(HELPER_AVAILABLE ? describe : describe.skip)('W1-D: cross-system audit → cert flow', () => {

    describe('Stage A: HEALTH submits + reviewer approves', () => {
        it('[W1-D / Stage A] application begins at AUDIT_CONFIRMED with auditor assigned', async () => {
            const { application, audit } = await seedApplicationReadyForAudit(currentPrisma, {
                organizationId: org.id,
                healthUser,
                auditor,
            });
            // The seeded fixture mirrors the canonical pre-decision state.
            const reread = await currentPrisma.application.findUnique({ where: { id: application.id } });
            expect(reread.status).toBe('AUDIT_CONFIRMED');
            expect(audit.auditorId).toBe(auditor.id);
            expect(audit.status).toBe('IN_PROGRESS');
        });

        it('[W1-D / Stage A] writeApplicationStatus emits APPLICATION_STATUS_TRANSITION via onAudit', async () => {
            const { application } = await seedApplicationReadyForAudit(currentPrisma, {
                organizationId: org.id,
                healthUser,
                auditor,
            });
            const captured = [];
            await writeApplicationStatus({
                prisma: currentPrisma,
                applicationId: application.id,
                fromStatus: 'AUDIT_CONFIRMED',
                toStatus: 'DOC_APPROVED', // simulating an upstream reviewer move
                actorId: 'reviewer-1',
                actorRole: 'DOCUMENT_REVIEWER',
                reason: 'Doc review pass — wired through real writer',
                onAudit: async (entry) => { captured.push(entry); },
            });

            expect(captured.length).toBeGreaterThanOrEqual(1);
            const transition = captured.find((e) => e.event === 'APPLICATION_STATUS_TRANSITION');
            expect(transition).toBeDefined();
            expect(transition.toStatus).toBe('DOC_APPROVED');
            expect(transition.applicationId).toBe(application.id);

            const updated = await currentPrisma.application.findUnique({ where: { id: application.id } });
            expect(updated.status).toBe('DOC_APPROVED');
        });
    });

    describe('Stage B: AUDITOR submits PASS', () => {
        it('[W1-D / Stage B] PASS decision flips status to AUDIT_PASSED via real audit-onsite-service', async () => {
            const { application, audit } = await seedApplicationReadyForAudit(currentPrisma, {
                organizationId: org.id,
                healthUser,
                auditor,
            });
            await seedAuditEvidence(currentPrisma, audit);

            await auditOnsiteService.submitDecision({
                auditId: audit.id,
                decision: 'PASS',
                summary: 'All checklist items pass',
                actorId: auditor.id,
                actorRole: 'AUDITOR',
                prisma: currentPrisma,
                fanoutService,
            });

            const updated = await currentPrisma.application.findUnique({ where: { id: application.id } });
            expect(updated.status).toBe('AUDIT_PASSED');
        });

        it('[W1-D / Stage B] cert auto-gen hook fires exactly once for the PASS decision', async () => {
            const { application, audit } = await seedApplicationReadyForAudit(currentPrisma, {
                organizationId: org.id,
                healthUser,
                auditor,
            });
            await seedAuditEvidence(currentPrisma, audit);

            await auditOnsiteService.submitDecision({
                auditId: audit.id,
                decision: 'PASS',
                actorId: auditor.id,
                actorRole: 'AUDITOR',
                prisma: currentPrisma,
                fanoutService,
            });

            expect(certServiceState.generateCertificate).toHaveBeenCalledTimes(1);
            const [callAppId, callActorId] = certServiceState.generateCertificate.mock.calls[0];
            expect(callAppId).toBe(application.id);
            expect(callActorId).toBe(auditor.id);
        });

        it('[W1-D / Stage B] persisted Certificate row exists with valid certificateNumber format', async () => {
            const { application, audit } = await seedApplicationReadyForAudit(currentPrisma, {
                organizationId: org.id,
                healthUser,
                auditor,
            });
            await seedAuditEvidence(currentPrisma, audit);

            await auditOnsiteService.submitDecision({
                auditId: audit.id,
                decision: 'PASS',
                actorId: auditor.id,
                actorRole: 'AUDITOR',
                prisma: currentPrisma,
                fanoutService,
            });

            const cert = await currentPrisma.certificate.findFirst({ where: { applicationId: application.id } });
            expect(cert).not.toBeNull();
            expect(cert.certificateNumber).toMatch(/^GACP-TH-\d{4}-[A-Z0-9]{3,6}$/);
            expect(cert.signedAt).toBeInstanceOf(Date);
            expect(cert.status).toBe('active');
        });
    });

    describe('Stage C: Fanout dispatches APPLICANT_AUDIT_PASSED + audit log written', () => {
        it('[W1-D / Stage C] fanout.send invoked with APPLICANT_AUDIT_PASSED template and resolved User.id', async () => {
            const { application, audit } = await seedApplicationReadyForAudit(currentPrisma, {
                organizationId: org.id,
                healthUser,
                auditor,
            });
            await seedAuditEvidence(currentPrisma, audit);

            await auditOnsiteService.submitDecision({
                auditId: audit.id,
                decision: 'PASS',
                actorId: auditor.id,
                actorRole: 'AUDITOR',
                prisma: currentPrisma,
                fanoutService,
            });

            // Two send() calls are expected on PASS:
            //   1. audit-onsite-service.submitDecision → AUDIT_RESULT_PASSED
            //      (best-effort applicant notification it always emits;
            //      keyed on healthId, not User.id — pre-existing behaviour)
            //   2. application-status-writer cert-hook D10 → APPLICANT_AUDIT_PASSED
            //      (resolves User.id via prisma.user.findFirst({ healthId })
            //      and dispatches the cert-number-aware template)
            const applicantPassedCall = fanoutSendSpy.mock.calls.find(
                ([arg]) => arg && arg.type === 'APPLICANT_AUDIT_PASSED',
            );
            expect(applicantPassedCall).toBeDefined();
            expect(applicantPassedCall[0].userId).toBe(healthUser.id);
            expect(applicantPassedCall[0].payload.applicationId).toBe(application.id);
            expect(applicantPassedCall[0].payload.certificateNumber).toMatch(/^GACP-TH-/);
        });

        it('[W1-D / Stage C] notification row written via real notification-service → bell-icon visible to HEALTH user', async () => {
            const { audit } = await seedApplicationReadyForAudit(currentPrisma, {
                organizationId: org.id,
                healthUser,
                auditor,
            });
            await seedAuditEvidence(currentPrisma, audit);

            await auditOnsiteService.submitDecision({
                auditId: audit.id,
                decision: 'PASS',
                actorId: auditor.id,
                actorRole: 'AUDITOR',
                prisma: currentPrisma,
                fanoutService,
            });

            // Real fanout → real notification-service → notification row.
            const notifications = await currentPrisma.notification.findMany({
                where: { userId: healthUser.id },
            });
            const applicantPassedNotif = notifications.find((n) => n.type === 'APPLICANT_AUDIT_PASSED');
            expect(applicantPassedNotif).toBeDefined();
            expect(applicantPassedNotif.title).toMatch(/(ตรวจประเมิน|ผ่าน)/);
        });
    });

    describe('Idempotency (V1-C H-1) — re-call writer with same audit emits CERT_AUTO_GEN_SKIPPED_EXISTING', () => {
        it('[W1-D / Idempotency] second AUDIT_PASSED write reuses existing cert (no duplicate generateCertificate)', async () => {
            const { application, audit } = await seedApplicationReadyForAudit(currentPrisma, {
                organizationId: org.id,
                healthUser,
                auditor,
            });
            await seedAuditEvidence(currentPrisma, audit);

            // First decision — generates the cert.
            await auditOnsiteService.submitDecision({
                auditId: audit.id,
                decision: 'PASS',
                actorId: auditor.id,
                actorRole: 'AUDITOR',
                prisma: currentPrisma,
                fanoutService,
            });
            expect(certServiceState.generateCertificate).toHaveBeenCalledTimes(1);

            // Second writer call — direct invocation (re-submit is blocked
            // by audit-onsite-service's status guard). The cert hook should
            // short-circuit via findCertificateForApplication and emit a
            // CERT_AUTO_GEN_SKIPPED_EXISTING audit row.
            const captured = [];
            await writeApplicationStatus({
                prisma: currentPrisma,
                applicationId: application.id,
                fromStatus: 'AUDIT_CONFIRMED',
                toStatus: 'AUDIT_PASSED',
                actorId: auditor.id,
                actorRole: 'AUDITOR',
                onAudit: async (entry) => { captured.push(entry); },
            });

            // generateCertificate did NOT run again (idempotency held).
            expect(certServiceState.generateCertificate).toHaveBeenCalledTimes(1);
            const skipEntry = captured.find((e) => e.event === 'CERT_AUTO_GEN_SKIPPED_EXISTING');
            expect(skipEntry).toBeDefined();
            expect(skipEntry.applicationId).toBe(application.id);
            expect(skipEntry.certificateNumber).toMatch(/^GACP-TH-/);
        });
    });

    describe('Rollback (V3-D) — cert-gen throw reverts status + writes CERT_AUTO_GEN_ROLLBACK audit row', () => {
        it('[W1-D / Rollback] status reverts to fromStatus and rollback audit row hits auditLog table', async () => {
            const { application } = await seedApplicationReadyForAudit(currentPrisma, {
                organizationId: org.id,
                healthUser,
                auditor,
            });

            // Force the cert hook to fail.
            const certErr = new Error('cert-service unavailable for rollback test');
            certErr.code = 'CERT_SERVICE_DOWN';
            certServiceState.findCertificateForApplication = jest.fn(async () => null);
            certServiceState.generateCertificate = jest.fn(async () => { throw certErr; });

            await expect(
                writeApplicationStatus({
                    prisma: currentPrisma,
                    applicationId: application.id,
                    fromStatus: 'AUDIT_CONFIRMED',
                    toStatus: 'AUDIT_PASSED',
                    actorId: auditor.id,
                    actorRole: 'AUDITOR',
                }),
            ).rejects.toMatchObject({ code: 'CERT_SERVICE_DOWN' });

            // Status reverted.
            const after = await currentPrisma.application.findUnique({ where: { id: application.id } });
            expect(after.status).toBe('AUDIT_CONFIRMED');

            // R3-D defence-in-depth row in auditLog table.
            const rollbackRow = await currentPrisma.auditLog.findFirst({
                where: {
                    action: 'CERT_AUTO_GEN_ROLLBACK',
                    resourceId: application.id,
                },
            });
            expect(rollbackRow).not.toBeNull();
            expect(rollbackRow.category).toBe(AuditCategory.APPLICATION);
        });
    });

    describe('FAIL path (V3-A) — AUDIT_RESULT_CAR fanout dispatched', () => {
        it('[W1-D / FAIL] FAIL decision flips status to CAR_PENDING and dispatches AUDIT_RESULT_CAR', async () => {
            const { application, audit } = await seedApplicationReadyForAudit(currentPrisma, {
                organizationId: org.id,
                healthUser,
                auditor,
            });
            await seedAuditEvidence(currentPrisma, audit);

            await auditOnsiteService.submitDecision({
                auditId: audit.id,
                decision: 'FAIL',
                summary: 'Critical findings on cultivation section',
                criticalFindings: ['4.1: no rotation log', '8.1: docs incomplete'],
                actorId: auditor.id,
                actorRole: 'AUDITOR',
                prisma: currentPrisma,
                fanoutService,
            });

            const updated = await currentPrisma.application.findUnique({ where: { id: application.id } });
            expect(updated.status).toBe('CAR_PENDING');

            const failCall = fanoutSendSpy.mock.calls.find(
                ([arg]) => arg && arg.type === 'AUDIT_RESULT_CAR',
            );
            expect(failCall).toBeDefined();
        });
    });

    describe('NEEDS_REVIEW path (V3-A) — AUDIT_RESULT_NEEDS_REVIEW fanout dispatched', () => {
        it('[W1-D / NEEDS_REVIEW] decision keeps status as AUDIT_CONFIRMED and dispatches NEEDS_REVIEW template', async () => {
            const { application, audit } = await seedApplicationReadyForAudit(currentPrisma, {
                organizationId: org.id,
                healthUser,
                auditor,
            });
            await seedAuditEvidence(currentPrisma, audit);

            await auditOnsiteService.submitDecision({
                auditId: audit.id,
                decision: 'NEEDS_REVIEW',
                summary: 'Borderline — please verify with head auditor',
                actorId: auditor.id,
                actorRole: 'AUDITOR',
                prisma: currentPrisma,
                fanoutService,
            });

            // NEEDS_REVIEW does NOT transition the parent Application
            // (per audit-onsite-service _targetStateForDecision == null).
            const updated = await currentPrisma.application.findUnique({ where: { id: application.id } });
            expect(updated.status).toBe('AUDIT_CONFIRMED');

            const needsReviewCall = fanoutSendSpy.mock.calls.find(
                ([arg]) => arg && arg.type === 'AUDIT_RESULT_NEEDS_REVIEW',
            );
            expect(needsReviewCall).toBeDefined();
        });
    });

    describe('Cross-side invariant (V4-C) — PLATFORM accountant cannot trigger DTAM-side state changes', () => {
        it('[W1-D / V4-C] ACCOUNT_PLATFORM role does NOT appear as actor on any audit-side state transition', async () => {
            // Run a happy-path PASS as AUDITOR (canonical role).
            const { application, audit } = await seedApplicationReadyForAudit(currentPrisma, {
                organizationId: org.id,
                healthUser,
                auditor,
            });
            await seedAuditEvidence(currentPrisma, audit);

            await auditOnsiteService.submitDecision({
                auditId: audit.id,
                decision: 'PASS',
                actorId: auditor.id,
                actorRole: 'AUDITOR',
                prisma: currentPrisma,
                fanoutService,
            });

            // Now verify no transition row exists with the PLATFORM
            // accountant as actor — the invariant being asserted is
            // "DTAM-side state changes are NEVER attributable to a
            // PLATFORM-side actor in the audit table".
            const platformTransitions = await currentPrisma.auditLog.findMany({
                where: {
                    actorId: _accountPlatform.id,
                    resourceId: application.id,
                },
            });
            expect(platformTransitions).toHaveLength(0);

            // And the recorded actor on the AUDIT_PASSED transition IS
            // the AUDITOR (positive control).
            const transition = await currentPrisma.application.findUnique({ where: { id: application.id } });
            expect(transition.status).toBe('AUDIT_PASSED');
            expect(transition.updatedBy).toBe(auditor.id);
        });
    });

    describe('Full 12-step state-machine smoke', () => {
        it('[W1-D / Smoke] walks REGISTERED → ... → AUDIT_PASSED with each writer call landing the expected status', async () => {
            // Minimal walk — real workflow-transition-service.canTransition
            // only fires when assertTransition=true. We use permissive
            // mode (default) so the smoke covers the writer plumbing
            // rather than the transition matrix (V5-B already pins
            // the matrix).
            const application = await currentPrisma.application.create({
                data: {
                    id: makeId('app-smoke'),
                    applicationNumber: 'GACP-SMOKE-001',
                    status: 'REGISTERED',
                    healthId: healthUser.healthId,
                    userId: healthUser.id,
                    organizationId: org.id,
                    formData: {},
                },
            });

            const steps = [
                'SUBMITTED',
                'DOCUMENT_REVIEW_PENDING',
                'DOC_APPROVED',
                'PAYMENT_2_PENDING',
                'PAYMENT_2_PAID',
                'AUDIT_PENDING',
                'AUDIT_CONFIRMED',
            ];
            let current = 'REGISTERED';
            for (const next of steps) {
                await writeApplicationStatus({
                    prisma: currentPrisma,
                    applicationId: application.id,
                    fromStatus: current,
                    toStatus: next,
                    actorId: healthUser.id,
                });
                current = next;
            }
            const reread = await currentPrisma.application.findUnique({ where: { id: application.id } });
            expect(reread.status).toBe('AUDIT_CONFIRMED');

            // No cert was generated en route to AUDIT_CONFIRMED.
            expect(certServiceState.generateCertificate).not.toHaveBeenCalled();
        });
    });
});
