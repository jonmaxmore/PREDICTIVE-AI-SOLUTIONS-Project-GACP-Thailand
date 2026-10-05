/**
 * renewal-service unit tests — Iter 26 (2026-05-16).
 *
 * Verifies the renewal contract end-to-end with an in-memory prisma
 * stub (no real DB needed):
 *   - createRenewalApplication: ownership + ACTIVE gating + carry-forward
 *   - getApplicationsForRenewalReminder: exact-day window
 *   - markRenewalReminderSent: idempotency on (certId, reminderType)
 *   - supersedeCertificate: status + chain pointers
 *   - listUpcomingExpiry: delegates to certificate-service
 */

'use strict';

const path = require('path');

// --- Mock collaborators ----------------------------------------------------

const mockCertificateService = {
    listExpiringActiveCertificates: jest.fn(async () => []),
};
jest.mock('../../services/certificate-service', () => mockCertificateService);

jest.mock('../../shared/logger', () => {
    // F-G4-64 fix round 1: the renewal door now routes issuance through
    // services/quotation-issuance-on-submit, which calls createLogger at module
    // load. A logger stub without it throws 'createLogger is not a function'
    // the moment that require runs.
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

// prisma-database is consulted lazily; we inject prisma explicitly via the
// service args so the lazy require path can stay tolerant.
jest.mock('../../services/prisma-database', () => ({ prisma: null }));

// The submit guard's answer for the case under test (null = allowed).
const mockSubmitRefusal = { current: null };

const servicePath = path.resolve(__dirname, '../../services/renewal-service.js');
function loadService() {
    jest.resetModules();
    jest.doMock('../../services/certificate-service', () => mockCertificateService);
    jest.doMock('../../services/prisma-database', () => ({ prisma: null }));
    // The holder-capability gate (operator ruling 2026-10-03) reads memberships on
    // the real client; this stub-prisma suite is not about who may renew. The gate
    // is proven on a real Postgres in
    // __tests__/integration/renewal-requires-submit-capability-real-postgres.test.js.
    jest.doMock('../../services/application-submit-guard', () => ({
        // One renewal per certificate (RENEWAL_ALREADY_IN_PROGRESS): none in flight here.
        findInFlightSuccession: async () => null,
        lockCertificateSuccessions: async () => {},
        RENEWAL_ALREADY_IN_PROGRESS: 'RENEWAL_ALREADY_IN_PROGRESS',
        assertSubmitAllowed: async ({ application }) => {
            if (mockSubmitRefusal.current) { throw mockSubmitRefusal.current; }
            return { entityId: application.entityId };
        },
        recordSubmitDenial: async () => {},
    }));
    jest.doMock('../../services/holder-access', () => ({
        holderReadWhereIfScoped: () => ({}),
    }));
    jest.doMock('../../shared/logger', () => {
        const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
    });
    return require(servicePath);
}

// --- Prisma stub factory ---------------------------------------------------

function makePrismaStub(seed = {}) {
    const certificates = new Map(Object.entries(seed.certificates || {}));
    const applications = new Map(Object.entries(seed.applications || {}));

    const stub = {
        // The renewal is filed by the acting user (operator ruling 2026-10-03).
        user: { findUnique: jest.fn(async ({ where }) => ({ canonicalId: `canon-${where.id}` })) },
        certificate: {
            findFirst: jest.fn(async ({ where }) => {
                for (const cert of certificates.values()) {
                    if (cert.id !== where.id) {continue;}
                    if (where.isDeleted === false && cert.isDeleted) {continue;}
                    // The certificate's own application relation carries the holder.
                    return { ...cert, application: { entityId: applications.get(cert.applicationId)?.entityId ?? null } };
                }
                return null;
            }),
            findMany: jest.fn(async ({ where, take }) => {
                const out = [];
                for (const cert of certificates.values()) {
                    if (where.isDeleted === false && cert.isDeleted) {continue;}
                    if (where.status && cert.status !== where.status) {continue;}
                    if (where.expiryDate) {
                        const ts = cert.expiryDate ? new Date(cert.expiryDate).getTime() : null;
                        if (where.expiryDate.gte && ts < new Date(where.expiryDate.gte).getTime()) {continue;}
                        if (where.expiryDate.lt && ts >= new Date(where.expiryDate.lt).getTime()) {continue;}
                    }
                    out.push(cert);
                }
                return out.slice(0, take || out.length);
            }),
            update: jest.fn(async ({ where, data }) => {
                const cur = certificates.get(where.id);
                if (!cur) {throw new Error(`Certificate ${where.id} not found`);}
                const next = { ...cur, ...data };
                certificates.set(where.id, next);
                return next;
            }),
        },
        application: {
            findFirst: jest.fn(async ({ where }) => {
                const cur = applications.get(where.id);
                if (!cur) {return null;}
                if (where.isDeleted === false && cur.isDeleted) {return null;}
                return cur;
            }),
            create: jest.fn(async ({ data }) => {
                const id = data.id || `app-${applications.size + 1}`;
                const row = { id, isDeleted: false, ...data };
                applications.set(id, row);
                return row;
            }),
            update: jest.fn(async ({ where, data }) => {
                const cur = applications.get(where.id);
                if (!cur) {throw new Error(`Application ${where.id} not found`);}
                const next = { ...cur, ...data };
                applications.set(where.id, next);
                return next;
            }),
        },
    };
    return { stub, certificates, applications };
}

// --- Seed helpers ----------------------------------------------------------

const HOLDER_SCOPE = Object.freeze({ userId: 'user-1', readIds: ['entity-1'], editIds: ['entity-1'] }); // R2 Task 8 fix round 1

function seedCertificate(partial = {}) {
    return {
        id: 'cert-1',
        userId: 'user-1',
        applicationId: 'app-1',
        status: 'active',
        isDeleted: false,
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        certificateNumber: 'GACP-TH-2569-ABC123',
        farmName: 'Wonderful Herb Farm',
        farmId: 'farm-1',
        organizationId: 'org-1',
        renewedCertificateId: null,
        previousCertificateId: null,
        // R2 Task 8 fix round 1: the holder, read through the certificate's relation.
        application: { entityId: 'entity-1' },
        ...partial,
    };
}

function seedApplication(partial = {}) {
    return {
        id: 'app-1',
        healthId: 'user-1',
        entityId: 'entity-1',
        organizationId: 'org-1',
        areaType: 'OUTDOOR',
        applicationNumber: 'GACP-2026-001',
        isDeleted: false,
        formData: {
            farmData: { farmName: 'Wonderful Herb Farm' },
            locationData: { province: 'Chiang Mai' },
            plantName: 'กระชาย',
            cultivation_methods: ['ORGANIC'],
            plots: [{ name: 'Plot A', areaSize: 5, areaUnit: 'rai' }],
        },
        ...partial,
    };
}

// --- Tests -----------------------------------------------------------------

describe('renewal-service', () => {
    let svc;

    beforeEach(() => {
        mockCertificateService.listExpiringActiveCertificates.mockClear();
        svc = loadService();
    });

    // ── carry-forward shape ───────────────────────────────────────────────

    describe('_buildCarryForwardFormData', () => {
        test('copies the allow-listed farm + cultivation keys only', () => {
            const out = svc._internals._buildCarryForwardFormData({
                farmData: { farmName: 'F' },
                plantName: 'X',
                plots: [{ name: 'A' }],
                cultivation_methods: ['ORGANIC'],
                auditResult: 'PASS',       // must NOT be carried
                paymentStatus: 'PAID',     // must NOT be carried
                documents: [{ id: 'd1' }], // must NOT be carried
            });
            expect(out).toEqual({
                farmData: { farmName: 'F' },
                plantName: 'X',
                plots: [{ name: 'A' }],
                cultivation_methods: ['ORGANIC'],
            });
            expect(out.auditResult).toBeUndefined();
            expect(out.paymentStatus).toBeUndefined();
            expect(out.documents).toBeUndefined();
        });

        test('returns an empty object for malformed input', () => {
            expect(svc._internals._buildCarryForwardFormData(null)).toEqual({});
            expect(svc._internals._buildCarryForwardFormData(undefined)).toEqual({});
            expect(svc._internals._buildCarryForwardFormData('not-an-object')).toEqual({});
        });
    });

    // ── createRenewalApplication ──────────────────────────────────────────

    describe('createRenewalApplication', () => {
        test('creates a renewal at the audit-fee gate, with carry-forward + renewalOf', async () => {
            const cert = seedCertificate();
            const app = seedApplication();
            const { stub, applications } = makePrismaStub({
                certificates: { [cert.id]: cert },
                applications: { [app.id]: app },
            });

            const result = await svc.createRenewalApplication({
                originalCertificateId: cert.id,
                actorId: 'user-1',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            });

            expect(result.applicationId).toBeDefined();
            expect(result.renewalOf).toBe(cert.id);
            expect(result.renewalOfCertificateNumber).toBe(cert.certificateNumber);

            const created = applications.get(result.applicationId);
            // NOT 'DRAFT'. This expectation was written before the renewal fast path and
            // went stale when it landed; the product is right and the test was wrong.
            //
            // A renewal skips what a renewal can skip — the document fee and the document
            // review — and starts at the payment gate itself. It must NOT start at
            // AUDIT_FEE_PAID, which is the site-visit scheduling queue: reaching that state
            // requires a SETTLED payment (a verified Stripe webhook, or an accountant
            // approving a slip), so creating a renewal there directly would carry it past
            // the money gate without anyone paying — a free certificate, arrived at by
            // writing a string into a column. See renewal-service.js:215-232.
            //
            // Asserting the skipped-state record alongside the status is deliberate: the
            // status alone would still pass if someone changed WHICH states are skipped,
            // and the jump is only defensible while it is written down where a reviewer
            // reads it back.
            expect(created.status).toBe('PENDING_AUDIT_FEE');
            expect(created.formData.workflowStatesSkipped).toEqual(
                expect.arrayContaining(['SUBMITTED']),
            );
            expect(created.formData.workflowStatesSkipped).not.toContain('AUDIT_FEE_PAID');
            expect(created.healthId).toBe('canon-user-1'); // the acting user's canonicalId (operator ruling 2026-10-03)
            expect(created.organizationId).toBe('org-1');
            expect(created.formData.renewalOf).toBe(cert.id);
            expect(created.formData.renewalSourceApplicationId).toBe(app.id);
            expect(created.formData.renewalOfCertificateNumber).toBe(cert.certificateNumber);
            // carry-forward
            expect(created.formData.farmData).toEqual({ farmName: 'Wonderful Herb Farm' });
            expect(created.formData.plantName).toBe('กระชาย');
            expect(created.formData.cultivation_methods).toEqual(['ORGANIC']);
            // workflow marker — the mirror of the column, and it must not drift from it:
            // the two disagreeing is how a screen and a query end up telling an officer
            // different things about the same application (renewal-service.js:338).
            expect(created.formData.workflowState).toBe('PENDING_AUDIT_FEE');
            expect(created.formData.workflowState).toBe(created.status);
        });

        test('rejects when certificate is not found', async () => {
            const { stub } = makePrismaStub();
            await expect(svc.createRenewalApplication({
                originalCertificateId: 'cert-missing',
                actorId: 'user-1',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            })).rejects.toMatchObject({ code: 'CERT_NOT_FOUND', statusCode: 404 });
        });

        // Operator ruling 2026-10-03: the filer of the certificate is not asked; a member
        // the submit guard lets through renews it and files the renewal as themselves.
        test('a member who did not file the certificate renews it, filed under that member', async () => {
            const cert = seedCertificate({ userId: 'user-other' });
            const app = seedApplication();
            const { stub } = makePrismaStub({
                certificates: { [cert.id]: cert },
                applications: { [app.id]: app },
            });
            const out = await svc.createRenewalApplication({
                originalCertificateId: cert.id,
                actorId: 'user-1',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            });
            expect(out.applicationId).toBeTruthy();
            expect(stub.application.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ healthId: 'canon-user-1', submitterId: 'user-1' }),
            }));
        });

        test('rejects when certificate is REVOKED', async () => {
            const cert = seedCertificate({ status: 'revoked' });
            const app = seedApplication();
            const { stub } = makePrismaStub({
                certificates: { [cert.id]: cert },
                applications: { [app.id]: app },
            });
            await expect(svc.createRenewalApplication({
                originalCertificateId: cert.id,
                actorId: 'user-1',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            })).rejects.toMatchObject({ code: 'CERT_NOT_ACTIVE', statusCode: 409 });
        });

        test('rejects when certificate is RENEWED (already superseded)', async () => {
            const cert = seedCertificate({ status: 'renewed' });
            const app = seedApplication();
            const { stub } = makePrismaStub({
                certificates: { [cert.id]: cert },
                applications: { [app.id]: app },
            });
            await expect(svc.createRenewalApplication({
                originalCertificateId: cert.id,
                actorId: 'user-1',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            })).rejects.toMatchObject({ code: 'CERT_NOT_ACTIVE' });
        });

        test('rejects when certificate has already expired', async () => {
            const cert = seedCertificate({
                expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
            });
            const app = seedApplication();
            const { stub } = makePrismaStub({
                certificates: { [cert.id]: cert },
                applications: { [app.id]: app },
            });
            await expect(svc.createRenewalApplication({
                originalCertificateId: cert.id,
                actorId: 'user-1',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            })).rejects.toMatchObject({ code: 'CERT_ALREADY_EXPIRED', statusCode: 409 });
        });

        // R2 Task 8 fix round 1 (spec 2026-09-30 §3.2 + C3): the holder decides before any write.
        test('rejects a source with NO holder (400 APPLICATION_HOLDER_REQUIRED) and creates nothing', async () => {
            const cert = seedCertificate({ application: { entityId: null } });
            const app = seedApplication({ entityId: null });
            const { stub, applications } = makePrismaStub({
                certificates: { [cert.id]: cert },
                applications: { [app.id]: app },
            });
            const before = applications.size;
            await expect(svc.createRenewalApplication({
                originalCertificateId: cert.id, actorId: 'user-1', holderScope: HOLDER_SCOPE, prisma: stub,
            })).rejects.toMatchObject({ code: 'APPLICATION_HOLDER_REQUIRED', statusCode: 400 });
            expect(applications.size).toBe(before);
        });

        // Operator ruling 2026-10-03 (merged over R2 Task 8's editIds gate): the
        // renewal needs SUBMIT_APPLICATION on the holder, decided by the submit
        // guard; its refusal propagates and nothing is created. The guard itself
        // is proven on real Postgres (renewal-requires-submit-capability).
        test('rejects when the submit guard refuses SUBMIT_APPLICATION on the holder (403) and creates nothing', async () => {
            const cert = seedCertificate();
            const app = seedApplication();
            const { stub, applications } = makePrismaStub({
                certificates: { [cert.id]: cert },
                applications: { [app.id]: app },
            });
            const before = applications.size;
            mockSubmitRefusal.current = Object.assign(new Error('denied'), { code: 'ENTITY_PERMISSION_DENIED', statusCode: 403 });
            try {
                await expect(svc.createRenewalApplication({
                    originalCertificateId: cert.id, actorId: 'user-1', holderScope: HOLDER_SCOPE, prisma: stub,
                })).rejects.toMatchObject({ code: 'ENTITY_PERMISSION_DENIED', statusCode: 403 });
            } finally {
                mockSubmitRefusal.current = null;
            }
            expect(applications.size).toBe(before);
        });

        test('refuses to run without the caller\'s holder scope (TypeError, nothing read or written)', async () => {
            const { stub } = makePrismaStub();
            await expect(svc.createRenewalApplication({ originalCertificateId: 'c', actorId: 'u', prisma: stub }))
                .rejects.toThrow(TypeError);
        });

        test('rejects on missing required args', async () => {
            const { stub } = makePrismaStub();
            await expect(svc.createRenewalApplication({ actorId: 'u', holderScope: HOLDER_SCOPE, prisma: stub }))
                .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
            await expect(svc.createRenewalApplication({ originalCertificateId: 'c', holderScope: HOLDER_SCOPE, prisma: stub }))
                .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        });
    });

    // ── getApplicationsForRenewalReminder ─────────────────────────────────

    describe('getApplicationsForRenewalReminder', () => {
        const now = new Date('2026-05-16T03:00:00.000Z');

        function buildExpiringSeed() {
            // 00:00 in Bangkok, `d` Bangkok days after today's Bangkok day — the
            // window the service reads (operator 2026-09-26), whatever the
            // process zone (the old process-local midnight failed under LA).
            const { getZonedParts, startOfLocalCalendarDay } = require('../../utils/working-days');
            const inDays = (d) => {
                const { year, month, day } = getZonedParts(now);
                return startOfLocalCalendarDay(year, month, day + d);
            };
            return {
                certificates: {
                    'c-60': seedCertificate({ id: 'c-60', userId: 'u-60', applicationId: 'app-60', expiryDate: inDays(60) }),
                    'c-30': seedCertificate({ id: 'c-30', userId: 'u-30', applicationId: 'app-30', expiryDate: inDays(30) }),
                    'c-15': seedCertificate({ id: 'c-15', userId: 'u-15', applicationId: 'app-15', expiryDate: inDays(15) }),
                    'c-14': seedCertificate({ id: 'c-14', userId: 'u-14', applicationId: 'app-14', expiryDate: inDays(14) }),
                    'c-revoked-60': seedCertificate({ id: 'c-revoked-60', userId: 'u-x', applicationId: 'app-x', expiryDate: inDays(60), status: 'revoked' }),
                    'c-deleted-60': seedCertificate({ id: 'c-deleted-60', userId: 'u-d', applicationId: 'app-d', expiryDate: inDays(60), isDeleted: true }),
                },
            };
        }

        test('returns ACTIVE certs expiring in exactly the requested window', async () => {
            const seed = buildExpiringSeed();
            const { stub } = makePrismaStub(seed);

            const result60 = await svc.getApplicationsForRenewalReminder({
                daysBeforeExpiry: 60, now, prisma: stub,
            });
            expect(result60.map((r) => r.id)).toEqual(['c-60']);

            const result30 = await svc.getApplicationsForRenewalReminder({
                daysBeforeExpiry: 30, now, prisma: stub,
            });
            expect(result30.map((r) => r.id)).toEqual(['c-30']);

            const result15 = await svc.getApplicationsForRenewalReminder({
                daysBeforeExpiry: 15, now, prisma: stub,
            });
            expect(result15.map((r) => r.id)).toEqual(['c-15']);
        });

        test('excludes revoked and soft-deleted certificates', async () => {
            const seed = buildExpiringSeed();
            const { stub } = makePrismaStub(seed);

            const result60 = await svc.getApplicationsForRenewalReminder({
                daysBeforeExpiry: 60, now, prisma: stub,
            });
            expect(result60.find((r) => r.id === 'c-revoked-60')).toBeUndefined();
            expect(result60.find((r) => r.id === 'c-deleted-60')).toBeUndefined();
        });

        test('rejects invalid daysBeforeExpiry input', async () => {
            const { stub } = makePrismaStub();
            await expect(svc.getApplicationsForRenewalReminder({ daysBeforeExpiry: -5, prisma: stub }))
                .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
            await expect(svc.getApplicationsForRenewalReminder({ daysBeforeExpiry: 'foo', prisma: stub }))
                .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        });
    });

    // ── markRenewalReminderSent ───────────────────────────────────────────

    describe('markRenewalReminderSent', () => {
        test('writes a new reminder entry on first call', async () => {
            const cert = seedCertificate();
            const app = seedApplication();
            const { stub, applications } = makePrismaStub({
                certificates: { [cert.id]: cert },
                applications: { [app.id]: app },
            });

            const out = await svc.markRenewalReminderSent({
                certificateId: cert.id,
                reminderType: 'D60',
                dispatchId: 'fanout-key-1',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            });
            expect(out.alreadySent).toBe(false);
            expect(out.reminderType).toBe('D60');
            expect(out.applicationId).toBe(app.id);

            const updated = applications.get(app.id);
            expect(updated.formData.renewalReminders).toHaveLength(1);
            expect(updated.formData.renewalReminders[0]).toMatchObject({
                type: 'D60',
                certId: cert.id,
                dispatchId: 'fanout-key-1',
            });
        });

        test('is idempotent on (certId, reminderType)', async () => {
            const cert = seedCertificate();
            const app = seedApplication();
            const { stub, applications } = makePrismaStub({
                certificates: { [cert.id]: cert },
                applications: { [app.id]: app },
            });

            const first = await svc.markRenewalReminderSent({
                certificateId: cert.id,
                reminderType: 'D30',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            });
            expect(first.alreadySent).toBe(false);

            const second = await svc.markRenewalReminderSent({
                certificateId: cert.id,
                reminderType: 'D30',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            });
            expect(second.alreadySent).toBe(true);
            expect(second.sentAt).toBe(first.sentAt);

            const updated = applications.get(app.id);
            // The second call must NOT add another entry.
            expect(updated.formData.renewalReminders).toHaveLength(1);
        });

        test('different reminderTypes for same cert stack independently', async () => {
            const cert = seedCertificate();
            const app = seedApplication();
            const { stub, applications } = makePrismaStub({
                certificates: { [cert.id]: cert },
                applications: { [app.id]: app },
            });

            await svc.markRenewalReminderSent({ certificateId: cert.id, reminderType: 'D60', prisma: stub });
            await svc.markRenewalReminderSent({ certificateId: cert.id, reminderType: 'D30', prisma: stub });
            await svc.markRenewalReminderSent({ certificateId: cert.id, reminderType: 'D15', prisma: stub });

            const updated = applications.get(app.id);
            const types = updated.formData.renewalReminders.map((r) => r.type).sort();
            expect(types).toEqual(['D15', 'D30', 'D60']);
        });

        test('rejects unknown reminderType', async () => {
            const cert = seedCertificate();
            const app = seedApplication();
            const { stub } = makePrismaStub({
                certificates: { [cert.id]: cert },
                applications: { [app.id]: app },
            });
            await expect(svc.markRenewalReminderSent({
                certificateId: cert.id,
                reminderType: 'D7',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        });

        test('rejects when certificate is missing', async () => {
            const { stub } = makePrismaStub();
            await expect(svc.markRenewalReminderSent({
                certificateId: 'cert-missing',
                reminderType: 'D60',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            })).rejects.toMatchObject({ code: 'CERT_NOT_FOUND' });
        });
    });

    // ── supersedeCertificate ──────────────────────────────────────────────

    describe('supersedeCertificate', () => {
        test('marks the old cert as renewed and links the chain', async () => {
            const oldCert = seedCertificate({ id: 'cert-old' });
            const newCert = seedCertificate({ id: 'cert-new', certificateNumber: 'GACP-TH-2569-NEWXYZ' });
            const { stub, certificates } = makePrismaStub({
                certificates: { [oldCert.id]: oldCert, [newCert.id]: newCert },
            });

            const out = await svc.supersedeCertificate({
                oldCertificateId: 'cert-old',
                newCertificateId: 'cert-new',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            });
            expect(out.oldCertificateId).toBe('cert-old');
            expect(out.newCertificateId).toBe('cert-new');

            expect(certificates.get('cert-old').status).toBe('renewed');
            expect(certificates.get('cert-old').renewedCertificateId).toBe('cert-new');
            expect(certificates.get('cert-new').previousCertificateId).toBe('cert-old');
        });

        test('is idempotent when called twice', async () => {
            const oldCert = seedCertificate({ id: 'cert-old' });
            const newCert = seedCertificate({ id: 'cert-new' });
            const { stub, certificates } = makePrismaStub({
                certificates: { [oldCert.id]: oldCert, [newCert.id]: newCert },
            });

            await svc.supersedeCertificate({
                oldCertificateId: 'cert-old', newCertificateId: 'cert-new', prisma: stub,
            });
            await svc.supersedeCertificate({
                oldCertificateId: 'cert-old', newCertificateId: 'cert-new', prisma: stub,
            });

            expect(certificates.get('cert-old').status).toBe('renewed');
            expect(certificates.get('cert-new').previousCertificateId).toBe('cert-old');
            // No throw; second call is a no-op.
        });

        test('refuses self-supersession', async () => {
            const { stub } = makePrismaStub();
            await expect(svc.supersedeCertificate({
                oldCertificateId: 'cert-x',
                newCertificateId: 'cert-x',
                holderScope: HOLDER_SCOPE,
                prisma: stub,
            })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        });
    });

    // ── listUpcomingExpiry ────────────────────────────────────────────────

    describe('listUpcomingExpiry', () => {
        test('delegates to certificate-service.listExpiringActiveCertificates', async () => {
            mockCertificateService.listExpiringActiveCertificates.mockResolvedValueOnce([
                { id: 'c-1', certificateNumber: 'GACP-TH-2569-AAA111' },
            ]);
            const result = await svc.listUpcomingExpiry({ days: 30, take: 50 });
            expect(result).toEqual([{ id: 'c-1', certificateNumber: 'GACP-TH-2569-AAA111' }]);
            expect(mockCertificateService.listExpiringActiveCertificates).toHaveBeenCalledTimes(1);
            const args = mockCertificateService.listExpiringActiveCertificates.mock.calls[0][0];
            expect(args.take).toBe(50);
            expect(args.now).toBeInstanceOf(Date);
            expect(args.cutoff).toBeInstanceOf(Date);
            const diffMs = args.cutoff.getTime() - args.now.getTime();
            // 30 days ± 1ms wiggle for setDate semantics across month boundaries
            expect(diffMs).toBeGreaterThan(29.5 * 24 * 60 * 60 * 1000);
            expect(diffMs).toBeLessThan(30.5 * 24 * 60 * 60 * 1000);
        });
    });

    // ── REMINDER_DAYS public constant ────────────────────────────────────

    describe('exposed constants', () => {
        test('REMINDER_DAYS is [60, 30, 15]', () => {
            expect(svc.REMINDER_DAYS).toEqual([60, 30, 15]);
        });
        test('REMINDER_TYPE_BY_DAYS maps each tier', () => {
            expect(svc.REMINDER_TYPE_BY_DAYS[60]).toBe('D60');
            expect(svc.REMINDER_TYPE_BY_DAYS[30]).toBe('D30');
            expect(svc.REMINDER_TYPE_BY_DAYS[15]).toBe('D15');
        });
    });
});
