/**
 * pdpa-erasure-service tests — Iter 27 (2026-05-16).
 *
 * Covers PDPA ม.32 right-to-forget request → confirm → executeErasure
 * flow plus the listErasureRequests admin view. The tests mock Prisma
 * + the audit logger + the notification fanout to keep the suite
 * deterministic without a database.
 *
 * Critical invariants asserted:
 *   1. The token round-trips through requestErasure → confirmErasure
 *      with constant-time equality (not echoed in error messages).
 *   2. executeErasure ANONYMISES the user + applications + certificates
 *      and PRESERVES Invoice / JournalLine / AuditLog
 *      (these models are NOT touched).
 *   3. Expired tokens are rejected; the envelope flips to EXPIRED.
 *   4. legalHold blocks both request and execute paths.
 *   5. The audit logger receives PDPA_ERASURE_REQUESTED + EXECUTED
 *      rows with the legal-basis citations.
 */

// Jest hoists jest.mock() calls above any `const`/`let` declarations, so
// any closure variables referenced inside the factory MUST be prefixed
// with `mock` (per Jest's hoisting safety check) or declared lazily
// inside the factory itself. Declare lazily here to keep the wiring
// readable.
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue({}) },
    AuditCategory: { SECURITY: 'SECURITY' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { USER: 'USER' },
}));

jest.mock('../../services/notification-fanout-service', () => ({
    send: jest.fn().mockResolvedValue({ ok: true }),
}));

// Detokenize STAGE 0: _resolveByHealthId now resolves the data subject via the
// H-4 hash-first helper (findUserByHealthIdSecurely) instead of a plaintext
// canonicalId WHERE. Mock it so the resolve step is deterministic.
jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: jest.fn(),
}));

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
    // Detokenize STAGE 0: erasure now anonymises the user's personal INDIVIDUAL
    // Entity (null thaiCitizenId/Hash) via the EntityMembership OWNER link.
    const entityMembership = { findMany: jest.fn() };
    const entity = { update: jest.fn() };
    const applicationDraft = { deleteMany: jest.fn() };
    const notification = { deleteMany: jest.fn() };

    // Task 10 fix round 1: erasure also clears the document pre-check text in its tx.
    // Final review I3: it first fails the user's still-PENDING pre-checks (none here).
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
const pdpaErasureService = require('../../services/pdpa-erasure-service');

describe('pdpa-erasure-service', () => {
    const HEALTH_ID = 'canonical-12345';
    const USER_ID = 'user-abc';
    const ORG_ID = 'org-1';

    const mockSubject = () => ({
        id: USER_ID,
        canonicalId: HEALTH_ID,
        organizationId: ORG_ID,
        email: 'somchai@example.test',
        isDeleted: false,
        legalHold: false,
    });

    beforeEach(() => {
        jest.clearAllMocks();
        audit.log.mockResolvedValue({});
        fanout.send.mockResolvedValue({ ok: true });
        // Default findFirst: returns nothing (overridden per-test).
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.user.findMany.mockResolvedValue([]);
        prisma.application.findMany.mockResolvedValue([]);
        prisma.certificate.findMany.mockResolvedValue([]);
        prisma.entityMembership.findMany.mockResolvedValue([]);
        prisma.entity.update.mockResolvedValue({ id: 'entity-x' });
        prisma.applicationDraft.deleteMany.mockResolvedValue({ count: 0 });
        prisma.notification.deleteMany.mockResolvedValue({ count: 0 });
        prisma.user.update.mockResolvedValue({ id: USER_ID, privacySettings: {} });
        // Detokenize STAGE 0: subject resolve goes through the hash-first helper.
        findUserByHealthIdSecurely.mockResolvedValue(null);
    });

    // ────────────────────────────────────────────────────────────
    // requestErasure
    // ────────────────────────────────────────────────────────────
    describe('requestErasure', () => {
        it('rejects when healthId is missing', async () => {
            await expect(pdpaErasureService.requestErasure({ actorId: 'a' }))
                .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        });

        it('rejects when actorId is missing', async () => {
            await expect(pdpaErasureService.requestErasure({ healthId: HEALTH_ID }))
                .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        });

        it('rejects unknown data subject', async () => {
            findUserByHealthIdSecurely.mockResolvedValue(null);
            await expect(pdpaErasureService.requestErasure({
                healthId: HEALTH_ID, actorId: USER_ID,
            })).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
        });

        it('rejects when legalHold is set', async () => {
            findUserByHealthIdSecurely.mockResolvedValue({ ...mockSubject(), legalHold: true });
            await expect(pdpaErasureService.requestErasure({
                healthId: HEALTH_ID, actorId: USER_ID,
            })).rejects.toMatchObject({ code: 'PDPA_LEGAL_HOLD' });
        });

        it('returns requestId + expiresAt + token; persists envelope; emits audit + fanout', async () => {
            // Resolve subject (hash-first helper).
            findUserByHealthIdSecurely.mockResolvedValue(mockSubject());
            prisma.user.findUnique
                // _loadEnvelope: existing privacySettings is null
                .mockResolvedValueOnce({
                    id: USER_ID, privacySettings: null, isDeleted: false, legalHold: false,
                })
                // _saveEnvelope first findUnique (load existing settings)
                .mockResolvedValueOnce({ privacySettings: null });

            prisma.user.update.mockResolvedValue({
                id: USER_ID, privacySettings: { pdpaErasure: {} },
            });

            const result = await pdpaErasureService.requestErasure({
                healthId: HEALTH_ID, reason: 'I no longer want this account.', actorId: USER_ID,
            });

            expect(result).toMatchObject({
                requestId: expect.stringMatching(/^pdpa-er-/),
                expiresAt: expect.any(String),
                token: expect.stringMatching(/^[a-f0-9]{32}$/),
            });

            // Envelope persisted.
            expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: USER_ID },
                data: expect.objectContaining({
                    privacySettings: expect.objectContaining({
                        pdpaErasure: expect.objectContaining({
                            requestId: result.requestId,
                            status: 'REQUESTED',
                            token: result.token,
                            reason: 'I no longer want this account.',
                        }),
                    }),
                }),
            }));

            // Audit row written with the right action + actor.
            expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'PDPA_ERASURE_REQUESTED',
                actorId: USER_ID,
                organizationId: ORG_ID,
                resourceId: USER_ID,
            }));

            // Fanout notified.
            expect(fanout.send).toHaveBeenCalledWith(expect.objectContaining({
                userId: USER_ID,
                type: 'PDPA_ERASURE_REQUESTED',
            }));
        });

        it('returns PDPA_ERASURE_IN_PROGRESS when a REQUESTED envelope already exists', async () => {
            findUserByHealthIdSecurely.mockResolvedValue(mockSubject());
            prisma.user.findUnique
                // _loadEnvelope finds an active envelope
                .mockResolvedValueOnce({
                    id: USER_ID,
                    privacySettings: {
                        pdpaErasure: {
                            requestId: 'pdpa-er-existing',
                            status: 'REQUESTED',
                            expiresAt: new Date(Date.now() + 60_000).toISOString(),
                        },
                    },
                    isDeleted: false,
                    legalHold: false,
                });

            await expect(pdpaErasureService.requestErasure({
                healthId: HEALTH_ID, actorId: USER_ID,
            })).rejects.toMatchObject({
                code: 'PDPA_ERASURE_IN_PROGRESS',
                requestId: 'pdpa-er-existing',
            });
        });
    });

    // ────────────────────────────────────────────────────────────
    // confirmErasure
    // ────────────────────────────────────────────────────────────
    describe('confirmErasure', () => {
        const envelope = (overrides = {}) => ({
            requestId: 'pdpa-er-test',
            status: 'REQUESTED',
            token: 'a'.repeat(32),
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            requestedAt: new Date().toISOString(),
            actorId: USER_ID,
            ...overrides,
        });

        const baseUser = (overrides = {}) => ({
            id: USER_ID,
            organizationId: ORG_ID,
            canonicalId: HEALTH_ID,
            privacySettings: { pdpaErasure: envelope() },
            isDeleted: false,
            legalHold: false,
            ...overrides,
        });

        it('rejects when token mismatches', async () => {
            prisma.user.findFirst.mockResolvedValueOnce(baseUser());
            await expect(pdpaErasureService.confirmErasure('pdpa-er-test', {
                token: 'b'.repeat(32), actorId: USER_ID,
            })).rejects.toMatchObject({ code: 'PDPA_ERASURE_INVALID_TOKEN' });
        });

        it('rejects and marks EXPIRED when the window has passed', async () => {
            const stale = baseUser({
                privacySettings: {
                    pdpaErasure: envelope({
                        expiresAt: new Date(Date.now() - 1000).toISOString(),
                    }),
                },
            });
            prisma.user.findFirst.mockResolvedValueOnce(stale);
            // _saveEnvelope: load current
            prisma.user.findUnique.mockResolvedValueOnce({ privacySettings: stale.privacySettings });
            await expect(pdpaErasureService.confirmErasure('pdpa-er-test', {
                token: 'a'.repeat(32), actorId: USER_ID,
            })).rejects.toMatchObject({ code: 'PDPA_ERASURE_EXPIRED' });
            // Envelope persisted as EXPIRED.
            expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    privacySettings: expect.objectContaining({
                        pdpaErasure: expect.objectContaining({ status: 'EXPIRED' }),
                    }),
                }),
            }));
        });

        it('rejects when requestId does not match the envelope', async () => {
            prisma.user.findFirst.mockResolvedValueOnce(baseUser());
            await expect(pdpaErasureService.confirmErasure('different-id', {
                token: 'a'.repeat(32), actorId: USER_ID,
            })).rejects.toMatchObject({ code: 'PDPA_ERASURE_NOT_FOUND' });
        });

        it('executes erasure on valid token and returns the summary', async () => {
            prisma.user.findFirst.mockResolvedValueOnce(baseUser());
            // executeErasure path resolves user via findUnique
            prisma.user.findUnique.mockResolvedValue({
                canonicalId: HEALTH_ID, organizationId: ORG_ID, legalHold: false,
            });
            const summary = await pdpaErasureService.confirmErasure('pdpa-er-test', {
                token: 'a'.repeat(32), actorId: USER_ID,
            });
            expect(summary).toMatchObject({
                ok: true,
                userId: USER_ID,
                anonymized: expect.any(Object),
                erased: expect.any(Object),
                preserved: expect.arrayContaining(['Invoice', 'JournalLine', 'AuditLog']),
            });
        });
    });

    // ────────────────────────────────────────────────────────────
    // executeErasure
    // ────────────────────────────────────────────────────────────
    describe('executeErasure', () => {
        it('anonymises user, application formData, and certificates; deletes drafts + notifications', async () => {
            prisma.user.findUnique.mockResolvedValue({
                canonicalId: HEALTH_ID, organizationId: ORG_ID, legalHold: false,
            });
            prisma.application.findMany.mockResolvedValue([
                {
                    id: 'app-1',
                    formData: {
                        applicantName: 'สมชาย ทดสอบ',
                        applicantPhone: '0812345678',
                        applicantEmail: 'somchai@example.test',
                        areaSize: 12,
                        cropType: 'cannabis',
                    },
                },
            ]);
            // Operator ruling 2026-08-27: a certificate under retention keeps
            // its holder name (see pdpa-erasure-respects-certificate-retention
            // .test.js). This case pins the ANONYMISED path, so the fixture
            // carries a retainUntil already in the past — a bare `{ id }` row
            // (retainUntil undefined) cannot exist in Postgres (NOT NULL,
            // default now()+5y) and would only pass by accident.
            prisma.certificate.findMany.mockResolvedValue([
                { id: 'cert-1', retainUntil: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), legalHold: false },
            ]);
            prisma.applicationDraft.deleteMany.mockResolvedValue({ count: 2 });
            prisma.notification.deleteMany.mockResolvedValue({ count: 5 });

            const summary = await pdpaErasureService.executeErasure({
                userId: USER_ID, actorId: USER_ID,
            });

            // User row anonymised — verify a representative subset of
            // fields the data clause is meant to clear / sentinel.
            expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: USER_ID },
                data: expect.objectContaining({
                    healthId: null,
                    phoneNumber: null,
                    firstName: 'PDPA_ERASED',
                    isDeleted: true,
                    password: 'PDPA_ERASED',
                }),
            }));

            // Application.formData PII keys cleared, non-PII preserved.
            const appUpdateCall = prisma.application.update.mock.calls[0][0];
            expect(appUpdateCall.data.formData.applicantName).toBeNull();
            expect(appUpdateCall.data.formData.applicantPhone).toBeNull();
            expect(appUpdateCall.data.formData.applicantEmail).toBeNull();
            expect(appUpdateCall.data.formData.areaSize).toBe(12);
            expect(appUpdateCall.data.formData.cropType).toBe('cannabis');

            // Certificate display fields cleared.
            expect(prisma.certificate.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'cert-1' },
                data: expect.objectContaining({
                    applicantName: 'PDPA_ERASED',
                    address: null,
                }),
            }));

            // Drafts + notifications deleted. R2 M1 (operator decision D-9
            // 2026-08-03): official letters are a permanent archive, so the
            // notification delete now EXCLUDES kind=OFFICIAL_LETTER — the
            // behavioural pins live in __tests__/unit/official-letter.test.js.
            expect(prisma.applicationDraft.deleteMany).toHaveBeenCalledWith({
                where: { userId: USER_ID },
            });
            expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
                where: { userId: USER_ID, kind: { not: 'OFFICIAL_LETTER' } },
            });

            // The financial / audit tables are NEVER touched.
            // Sanity assertion — no Invoice / JournalLine mocks exist on the
            // mocked prisma object, so any attempt to call them would throw.
            // The summary call simply needs to contain the preserved-table
            // list per ม.87/3.
            expect(summary.preserved).toEqual(expect.arrayContaining([
                'Invoice',
                'JournalLine',
                'AuditLog',
            ]));

            // Audit row emitted with legal-basis citations.
            const auditCall = audit.log.mock.calls.find(
                ([row]) => row.action === 'PDPA_ERASURE_EXECUTED',
            );
            expect(auditCall).toBeDefined();
            expect(auditCall[0].metadata.legalBasis).toEqual(
                expect.arrayContaining(['PDPA ม.32', 'ม.87/3 ป.รัษฎากร']),
            );
        });

        it('blocks erasure when legalHold is set on the user row', async () => {
            prisma.user.findUnique.mockResolvedValue({
                canonicalId: HEALTH_ID, organizationId: ORG_ID, legalHold: true,
            });
            await expect(pdpaErasureService.executeErasure({
                userId: USER_ID, actorId: USER_ID,
            })).rejects.toMatchObject({ code: 'PDPA_LEGAL_HOLD' });
        });

        it('requires either healthId or userId', async () => {
            await expect(pdpaErasureService.executeErasure({ actorId: USER_ID }))
                .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        });
    });

    // ────────────────────────────────────────────────────────────
    // _sanitizeApplicationFormData
    // ────────────────────────────────────────────────────────────
    describe('_sanitizeApplicationFormData', () => {
        it('clears known PII keys at every level of a nested blob', () => {
            const input = {
                applicantName: 'foo',
                contact: {
                    phone: '0812345678',
                    nestedNonPii: 'keep me',
                },
                farms: [
                    { applicantPhone: '+66800000000', cropType: 'cannabis' },
                ],
                cropType: 'cannabis',
            };
            const out = pdpaErasureService._sanitizeApplicationFormData(input);
            expect(out.applicantName).toBeNull();
            expect(out.contact.phone).toBeNull();
            expect(out.contact.nestedNonPii).toBe('keep me');
            expect(out.farms[0].applicantPhone).toBeNull();
            expect(out.farms[0].cropType).toBe('cannabis');
            expect(out.cropType).toBe('cannabis');
        });

        it('passes through null / primitive inputs unchanged', () => {
            expect(pdpaErasureService._sanitizeApplicationFormData(null)).toBeNull();
            expect(pdpaErasureService._sanitizeApplicationFormData('plain'))
                .toBe('plain');
            expect(pdpaErasureService._sanitizeApplicationFormData(42)).toBe(42);
        });
    });

    // ────────────────────────────────────────────────────────────
    // listErasureRequests
    // ────────────────────────────────────────────────────────────
    describe('listErasureRequests', () => {
        it('returns envelopes without the token field', async () => {
            prisma.user.findMany.mockResolvedValue([
                {
                    id: 'u1',
                    organizationId: ORG_ID,
                    privacySettings: {
                        pdpaErasure: {
                            requestId: 'pdpa-er-1',
                            status: 'REQUESTED',
                            token: 'should-not-leak',
                            requestedAt: '2026-05-16T00:00:00.000Z',
                            expiresAt: '2026-05-17T00:00:00.000Z',
                        },
                    },
                },
                {
                    id: 'u2',
                    organizationId: ORG_ID,
                    privacySettings: { pdpaErasure: { requestId: 'pdpa-er-2', status: 'EXECUTED' } },
                },
                {
                    id: 'u3',
                    organizationId: ORG_ID,
                    privacySettings: null, // not a request row — filtered out
                },
            ]);

            const rows = await pdpaErasureService.listErasureRequests({ organizationId: ORG_ID });
            expect(rows).toHaveLength(2);
            expect(rows[0]).toEqual(expect.objectContaining({
                userId: 'u1',
                requestId: 'pdpa-er-1',
                status: 'REQUESTED',
            }));
            // Token must NOT leak through the admin view.
            expect(rows[0].token).toBeUndefined();
        });

        it('filters by status when provided', async () => {
            prisma.user.findMany.mockResolvedValue([
                { id: 'u1', organizationId: ORG_ID,
                    privacySettings: { pdpaErasure: { requestId: 'r1', status: 'REQUESTED' } } },
                { id: 'u2', organizationId: ORG_ID,
                    privacySettings: { pdpaErasure: { requestId: 'r2', status: 'EXECUTED' } } },
            ]);
            const rows = await pdpaErasureService.listErasureRequests({
                status: 'EXECUTED', organizationId: ORG_ID,
            });
            expect(rows).toHaveLength(1);
            expect(rows[0].requestId).toBe('r2');
        });

        it('falls back to a broad scan when JSON-path filter is unsupported', async () => {
            prisma.user.findMany
                .mockRejectedValueOnce(new Error('json filter not supported'))
                .mockResolvedValueOnce([
                    { id: 'u1', organizationId: ORG_ID,
                        privacySettings: { pdpaErasure: { requestId: 'r1', status: 'REQUESTED' } } },
                ]);
            const rows = await pdpaErasureService.listErasureRequests({ organizationId: ORG_ID });
            expect(rows).toHaveLength(1);
            expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
        });
    });

    // ────────────────────────────────────────────────────────────
    // cancelErasure
    // ────────────────────────────────────────────────────────────
    describe('cancelErasure', () => {
        it('flips status to CANCELED and strips the token', async () => {
            prisma.user.findFirst.mockResolvedValueOnce({
                id: USER_ID, organizationId: ORG_ID,
                privacySettings: {
                    pdpaErasure: {
                        requestId: 'pdpa-er-1',
                        status: 'REQUESTED',
                        token: 'secret-32-chars-12345678901234567',
                        expiresAt: new Date(Date.now() + 60_000).toISOString(),
                    },
                },
            });
            // _saveEnvelope: load existing privacy settings
            prisma.user.findUnique.mockResolvedValue({
                privacySettings: { pdpaErasure: { requestId: 'pdpa-er-1', status: 'REQUESTED' } },
            });

            const out = await pdpaErasureService.cancelErasure('pdpa-er-1', { actorId: USER_ID });
            expect(out).toMatchObject({ ok: true, status: 'CANCELED' });

            const updateCall = prisma.user.update.mock.calls[0][0];
            const env = updateCall.data.privacySettings.pdpaErasure;
            expect(env.status).toBe('CANCELED');
            expect(env.token).toBeUndefined();
            expect(env.canceledAt).toEqual(expect.any(String));

            expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'PDPA_ERASURE_CANCELED',
            }));
        });

        it('refuses to cancel a non-REQUESTED envelope', async () => {
            prisma.user.findFirst.mockResolvedValueOnce({
                id: USER_ID, organizationId: ORG_ID,
                privacySettings: {
                    pdpaErasure: { requestId: 'pdpa-er-1', status: 'EXECUTED' },
                },
            });
            await expect(pdpaErasureService.cancelErasure('pdpa-er-1', { actorId: USER_ID }))
                .rejects.toMatchObject({ code: 'PDPA_ERASURE_BAD_STATUS' });
        });
    });

    // ────────────────────────────────────────────────────────────
    // Detokenize STAGE 0 — erasure gap fix + data-state-agnostic resolve
    // (RFC docs/handoffs/national-id-detokenize-rfc-2026-06-29.md)
    // ────────────────────────────────────────────────────────────
    describe('STAGE 0 — erasure gap + data-state-agnostic resolve', () => {
        afterEach(() => { delete process.env.APP_FK_USE_TOKEN; });

        it('(d) executeErasure ALSO nulls the *Hmac columns + sets canonicalId = user.id', async () => {
            prisma.user.findUnique.mockResolvedValue({
                canonicalId: HEALTH_ID, organizationId: ORG_ID, legalHold: false,
            });
            await pdpaErasureService.executeErasure({ userId: USER_ID, actorId: USER_ID });

            const data = prisma.user.update.mock.calls[0][0].data;
            // Gap fix: the keyed HMAC columns are nulled (legacy *Hash already were).
            expect(data.healthIdHmac).toBeNull();
            expect(data.providerIdHmac).toBeNull();
            expect(data.idCardHmac).toBeNull();
            expect(data.taxIdHmac).toBeNull();
            expect(data.communityRegistrationNoHmac).toBeNull();
            // canonicalId is @unique NOT NULL → re-keyed to the stable User.id.
            expect(data.canonicalId).toBe(USER_ID);
            // The legacy *Hash are still nulled (unchanged behaviour).
            expect(data.healthIdHash).toBeNull();
            expect(data.providerIdHash).toBeNull();
        });

        it('(d) anonymises the personal INDIVIDUAL Entity row (null thaiCitizenId + thaiCitizenIdHash)', async () => {
            prisma.user.findUnique.mockResolvedValue({
                canonicalId: HEALTH_ID, organizationId: ORG_ID, legalHold: false,
            });
            prisma.entityMembership.findMany.mockResolvedValue([{ entityId: 'ent-1' }]);

            const summary = await pdpaErasureService.executeErasure({ userId: USER_ID, actorId: USER_ID });

            // Found via the stable EntityMembership OWNER link (User.id never moves).
            expect(prisma.entityMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { userId: USER_ID, role: 'OWNER', entity: { type: 'INDIVIDUAL' } },
            }));
            expect(prisma.entity.update).toHaveBeenCalledWith({
                where: { id: 'ent-1' },
                data: { thaiCitizenId: null, thaiCitizenIdHash: null },
            });
            expect(summary.anonymized.entities).toBe(1);
        });

        it('(d) Application anonymise queries by the post-cascade FK value (resolvedUserId), not the old national ID', async () => {
            prisma.user.findUnique.mockResolvedValue({
                canonicalId: HEALTH_ID, organizationId: ORG_ID, legalHold: false,
            });
            await pdpaErasureService.executeErasure({ userId: USER_ID, actorId: USER_ID });
            // After step 1 re-keys canonicalId -> user.id (cascading to
            // Application.healthId), the formData scrub must query by user.id.
            expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { healthId: USER_ID },
            }));
        });

        it('(b) requestErasure resolves the subject by the national-ID HASH (not a canonicalId value WHERE)', async () => {
            // Data-state-agnostic: the route passes the national ID; the service
            // resolves via the hash helper, which is stable across the re-key.
            findUserByHealthIdSecurely.mockResolvedValue(mockSubject());
            prisma.user.findUnique
                .mockResolvedValueOnce({ id: USER_ID, privacySettings: null, isDeleted: false, legalHold: false })
                .mockResolvedValueOnce({ privacySettings: null });
            prisma.user.update.mockResolvedValue({ id: USER_ID, privacySettings: { pdpaErasure: {} } });

            const NATIONAL_ID = '1100100100011';
            await pdpaErasureService.requestErasure({ healthId: NATIONAL_ID, actorId: USER_ID });

            expect(findUserByHealthIdSecurely).toHaveBeenCalledWith(
                NATIONAL_ID,
                expect.objectContaining({ select: expect.objectContaining({ canonicalId: true }) }),
            );
        });
    });

    // ────────────────────────────────────────────────────────────
    // M1 (2026-08-15) — holder columns on erasure (plan D8 / AC4)
    //
    // A farm's name is not personal data; a person's is. The M1 columns
    // (`holderDisplayName` / `holderType`) split those two cases apart, so
    // erasure must now ASK which one a certificate carries before deciding
    // whether to wipe the holder name:
    //   LEGACY_PERSON / INDIVIDUAL → holderDisplayName is a human name
    //     (entity-service.js builds an INDIVIDUAL displayName from
    //     firstName + lastName) ⇒ sentinel it, or the erased name survives
    //     on the PDF / verify page / interop envelope.
    //   JURISTIC / COMMUNITY_ENTERPRISE → the holder is the legal entity,
    //     which outlives its members ⇒ never touched (AC4).
    //
    // These pins run WITHOUT a database. The DB-side proof lives in
    // __tests__/integration/m1-erasure-holder-survives.test.js (HAS_DB).
    // ────────────────────────────────────────────────────────────
    describe('M1 — erasure and the holder columns (D8 / AC4)', () => {
        const { ERASURE_SENTINEL } = pdpaErasureService;

        // Operator ruling 2026-08-27: a certificate whose retainUntil is still
        // ahead (or legalHold is set) is retained, not anonymised. Every pin in
        // this block is about the anonymised payload's SHAPE, so the seeded row
        // gets a past retainUntil — Postgres never yields retainUntil undefined
        // (NOT NULL, default now()+5y), so a bare `{ id, holderType }` fixture
        // would reach the update only through a shape the DB cannot produce.
        const PAST_RETENTION = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

        /** Run executeErasure over one seeded certificate row and hand back its update payload. */
        async function eraseWithCert(cert) {
            prisma.user.findUnique.mockResolvedValue({
                canonicalId: HEALTH_ID, organizationId: ORG_ID, legalHold: false,
            });
            prisma.certificate.findMany.mockResolvedValue([
                { retainUntil: PAST_RETENTION, legalHold: false, ...cert },
            ]);
            await pdpaErasureService.executeErasure({ userId: USER_ID, actorId: USER_ID });
            const call = prisma.certificate.update.mock.calls.find(
                ([arg]) => arg.where.id === cert.id,
            );
            expect(call).toBeDefined();
            return call[0].data;
        }

        it('asks Postgres for holderType — without it every branch below reads undefined', async () => {
            await eraseWithCert({ id: 'cert-select', holderType: 'JURISTIC' });
            expect(prisma.certificate.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { userId: USER_ID },
                select: expect.objectContaining({ id: true, holderType: true }),
            }));
        });

        it.each(['LEGACY_PERSON', 'INDIVIDUAL'])(
            'wipes holderDisplayName to the sentinel when holderType is %s (a person is behind that name)',
            async (holderType) => {
                const data = await eraseWithCert({ id: `cert-${holderType}`, holderType });
                expect(data.holderDisplayName).toBe(ERASURE_SENTINEL);
                // The pre-M1 behaviour is unchanged, letter for letter.
                expect(data.applicantName).toBe(ERASURE_SENTINEL);
                expect(data.address).toBeNull();
            },
        );

        it.each(['JURISTIC', 'COMMUNITY_ENTERPRISE'])(
            'never writes holderDisplayName at all when holderType is %s (AC4 — the farm keeps its certificate)',
            async (holderType) => {
                const data = await eraseWithCert({ id: `cert-${holderType}`, holderType });
                // Not "wrote the old value back" — the key must be ABSENT, so the
                // column is untouched by the UPDATE.
                expect(Object.keys(data)).not.toContain('holderDisplayName');
                expect(data.applicantName).toBe(ERASURE_SENTINEL);
            },
        );

        it('leaves holderDisplayName alone for a row whose holderType is still NULL (pre-backfill safety)', async () => {
            const data = await eraseWithCert({ id: 'cert-null-type', holderType: null });
            expect(Object.keys(data)).not.toContain('holderDisplayName');
        });
    });
});
