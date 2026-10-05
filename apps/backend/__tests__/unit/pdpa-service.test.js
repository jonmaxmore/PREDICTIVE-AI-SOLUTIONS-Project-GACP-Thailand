/**
 * pdpa-service: PDPA Section 30 (export) + Section 33 (erasure).
 *
 * The export side is mostly a fan-out of read queries — tests check
 * shape and that the right FK column is used (Application uses
 * canonicalId, ApplicationDraft uses id, etc.).
 *
 * The delete side has the actual policy decisions — legal hold,
 * password verification, retention extension — tests cover each branch.
 */

const bcrypt = require('bcryptjs');

// Mock Prisma BEFORE requiring pdpa-service so the require captures the
// mock instance.
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        application: { findMany: jest.fn() },
        applicationDraft: { findMany: jest.fn() },
        farm: { findMany: jest.fn() },
        certificate: { findMany: jest.fn() },
        invoice: { findMany: jest.fn() },
        notification: { findMany: jest.fn() },
        reportSubmission: { findMany: jest.fn() },
    },
}));

const { prisma } = require('../../services/prisma-database');
const pdpaService = require('../../services/pdpa-service');

describe('pdpa-service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default: every query returns []. Individual tests override.
        prisma.application.findMany.mockResolvedValue([]);
        prisma.applicationDraft.findMany.mockResolvedValue([]);
        prisma.farm.findMany.mockResolvedValue([]);
        prisma.certificate.findMany.mockResolvedValue([]);
        prisma.invoice.findMany.mockResolvedValue([]);
        prisma.notification.findMany.mockResolvedValue([]);
        prisma.reportSubmission.findMany.mockResolvedValue([]);
    });

    // ────────────────────────────────────────────────────────────
    // assembleUserDataExport
    // ────────────────────────────────────────────────────────────
    describe('assembleUserDataExport', () => {
        const mockUser = {
            id: 'user-123',
            uuid: 'uuid-456',
            canonicalId: 'canonical-789',
            healthId: '1100000000008',
            email: 'somchai@example.com',
            firstName: 'สมชาย',
            lastName: 'ทดสอบ',
            isDeleted: false,
            retainUntil: new Date('2031-05-02T00:00:00Z'),
            legalHold: false,
        };

        it('throws when userId is missing', async () => {
            await expect(pdpaService.assembleUserDataExport()).rejects.toThrow('userId is required');
        });

        it('throws when user not found', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            await expect(pdpaService.assembleUserDataExport('missing-user'))
                .rejects.toThrow('User not found');
        });

        it('uses canonicalId for Application + Invoice and id for everything else', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);
            await pdpaService.assembleUserDataExport('user-123');

            // Application — healthId column points at canonicalId.
            expect(prisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ healthId: 'canonical-789' }),
            }));
            // Invoice — same pattern.
            expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ healthId: 'canonical-789' }),
            }));
            // ApplicationDraft, Certificate, Notification, ReportSubmission — userId points at User.id.
            expect(prisma.applicationDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ userId: 'user-123' }),
            }));
            expect(prisma.certificate.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ userId: 'user-123' }),
            }));
            expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ userId: 'user-123' }),
            }));
            expect(prisma.reportSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ userId: 'user-123' }),
            }));
            // Farm — uses ownerId.
            expect(prisma.farm.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ ownerId: 'user-123' }),
            }));
        });

        it('caps notification export at 500 rows (most-recent first)', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);
            await pdpaService.assembleUserDataExport('user-123');
            expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
                take: 500,
                orderBy: { createdAt: 'desc' },
            }));
        });

        it('returns a JSON-serializable shape with PDPA citation + retention notice', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);
            const result = await pdpaService.assembleUserDataExport('user-123');
            expect(result).toMatchObject({
                regulation: expect.stringMatching(/PDPA/),
                subject: expect.objectContaining({ id: 'user-123' }),
                applications: expect.any(Array),
                drafts: expect.any(Array),
                farms: expect.any(Array),
                certificates: expect.any(Array),
                invoices: expect.any(Array),
                notifications: expect.any(Array),
                reportSubmissions: expect.any(Array),
                notice: expect.any(String),
            });
            // Must round-trip through JSON without errors.
            expect(() => JSON.stringify(result)).not.toThrow();
        });

        it('does NOT include sensitive credential fields in the user payload', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);
            await pdpaService.assembleUserDataExport('user-123');
            const userSelect = prisma.user.findUnique.mock.calls[0][0].select;
            // The export must never request password / MFA secrets / hashed
            // identifiers — exporting those is a credential leak, not a
            // privacy compliance win.
            expect(userSelect.password).toBeUndefined();
            expect(userSelect.twoFactorSecret).toBeUndefined();
            expect(userSelect.twoFactorBackupCodes).toBeUndefined();
            expect(userSelect.passwordResetToken).toBeUndefined();
            expect(userSelect.healthIdHash).toBeUndefined();
            expect(userSelect.providerIdHash).toBeUndefined();
        });

        // ── Sprint 6 healthId-audit Phase D — FK-key defence-in-depth ──
        it('looks up the user by User.id (UUID), never by User.healthId plaintext', async () => {
            // The function signature takes a User.id UUID (plaintext-safe, not
            // in PDPA encryption scope). Once Phase 2 encrypts User.healthId,
            // a regression that started querying User by healthId would break
            // the PDPA export flow itself. This test pins the User-lookup key
            // to `id` so that regression is impossible.
            prisma.user.findUnique.mockResolvedValue(mockUser);
            await pdpaService.assembleUserDataExport('user-123');
            const userArgs = prisma.user.findUnique.mock.calls[0][0];
            expect(userArgs.where).toEqual({ id: 'user-123' });
            expect(userArgs.where.healthId).toBeUndefined();
            expect(userArgs.where.healthIdHash).toBeUndefined();
        });

        it('passes `user.canonicalId` (not `user.healthId`) into the Application/Invoice FK WHERE', async () => {
            // Guards the explicit Phase D requirement that the FK column
            // `Application.healthId` is filtered by canonicalId, NOT by
            // the user's Thai national ID plaintext. canonical-789 and
            // healthId 1100000000008 are intentionally different here.
            prisma.user.findUnique.mockResolvedValue(mockUser);
            await pdpaService.assembleUserDataExport('user-123');
            const appWhere = prisma.application.findMany.mock.calls[0][0].where;
            const invWhere = prisma.invoice.findMany.mock.calls[0][0].where;
            expect(appWhere.healthId).toBe('canonical-789');
            expect(appWhere.healthId).not.toBe(mockUser.healthId);
            expect(invWhere.healthId).toBe('canonical-789');
            expect(invWhere.healthId).not.toBe(mockUser.healthId);
        });

        it('short-circuits FK-keyed queries to [] when canonicalId is missing', async () => {
            // Data-integrity guard: a User row with NULL canonicalId is a
            // bug (every user row should have one set by prisma-auth-service).
            // If we ever encounter one, we must NOT issue an open-ended
            // findMany on { healthId: undefined } — Prisma would return
            // every row of the table. Returning [] is FK-correct anyway:
            // no Application/Invoice row can reference a NULL canonicalId.
            prisma.user.findUnique.mockResolvedValue({ ...mockUser, canonicalId: null });
            const result = await pdpaService.assembleUserDataExport('user-123');

            expect(prisma.application.findMany).not.toHaveBeenCalled();
            expect(prisma.invoice.findMany).not.toHaveBeenCalled();
            expect(result.applications).toEqual([]);
            expect(result.invoices).toEqual([]);
            // The User.id-keyed queries must still run.
            expect(prisma.applicationDraft.findMany).toHaveBeenCalled();
            expect(prisma.farm.findMany).toHaveBeenCalled();
            expect(prisma.certificate.findMany).toHaveBeenCalled();
        });
    });

    // ────────────────────────────────────────────────────────────
    // softDeleteUser
    // ────────────────────────────────────────────────────────────
    describe('softDeleteUser', () => {
        let passwordHash;

        beforeAll(async () => {
            passwordHash = await bcrypt.hash('correct-password', 4);
        });

        const baseUserRecord = (overrides = {}) => ({
            id: 'user-123',
            password: passwordHash,
            isDeleted: false,
            legalHold: false,
            retainUntil: null,
            ...overrides,
        });

        it('rejects when password is missing', async () => {
            await expect(pdpaService.softDeleteUser({ userId: 'user-123' }))
                .rejects.toMatchObject({ code: 'PDPA_PASSWORD_REQUIRED' });
        });

        it('rejects when user not found', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            await expect(pdpaService.softDeleteUser({ userId: 'missing', password: 'any' }))
                .rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
        });

        it('rejects already-deleted account with PDPA_ALREADY_DELETED', async () => {
            prisma.user.findUnique.mockResolvedValue(baseUserRecord({ isDeleted: true }));
            await expect(pdpaService.softDeleteUser({ userId: 'user-123', password: 'correct-password' }))
                .rejects.toMatchObject({ code: 'PDPA_ALREADY_DELETED' });
        });

        it('refuses when legalHold is set', async () => {
            prisma.user.findUnique.mockResolvedValue(baseUserRecord({ legalHold: true }));
            await expect(pdpaService.softDeleteUser({ userId: 'user-123', password: 'correct-password' }))
                .rejects.toMatchObject({ code: 'PDPA_LEGAL_HOLD' });
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('refuses with INVALID_CREDENTIALS when password mismatches', async () => {
            prisma.user.findUnique.mockResolvedValue(baseUserRecord());
            await expect(pdpaService.softDeleteUser({ userId: 'user-123', password: 'wrong-password' }))
                .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('soft-deletes with 30-day grace period when no regulatory retention is in effect', async () => {
            prisma.user.findUnique.mockResolvedValue(baseUserRecord());
            const before = Date.now();
            prisma.user.update.mockImplementation(({ data }) =>
                Promise.resolve({
                    id: 'user-123',
                    isDeleted: data.isDeleted,
                    deletedAt: data.deletedAt,
                    retainUntil: data.retainUntil,
                }),
            );

            const result = await pdpaService.softDeleteUser({
                userId: 'user-123',
                password: 'correct-password',
                reason: 'I no longer need this account',
            });

            expect(result.ok).toBe(true);
            // graceUntil should be ~30 days from now.
            const graceMs = new Date(result.graceUntil).getTime() - before;
            expect(graceMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
            expect(graceMs).toBeLessThan(31 * 24 * 60 * 60 * 1000);
            // retainUntil should equal graceUntil here (no longer
            // regulatory retention to honor).
            expect(result.retainUntil).toBe(result.graceUntil);
        });

        it('keeps the longer regulatory retainUntil when it exceeds 30-day grace', async () => {
            // User registered 1 year ago → retainUntil is roughly 4 years
            // out (5y from registration). PDPA grace is 30 days. The
            // service must keep the FURTHER date — regulatory retention
            // wins for users with certified applications, etc.
            const fourYearsOut = new Date(Date.now() + 4 * 365 * 24 * 60 * 60 * 1000);
            prisma.user.findUnique.mockResolvedValue(baseUserRecord({ retainUntil: fourYearsOut }));
            prisma.user.update.mockImplementation(({ data }) =>
                Promise.resolve({
                    id: 'user-123',
                    isDeleted: data.isDeleted,
                    deletedAt: data.deletedAt,
                    retainUntil: data.retainUntil,
                }),
            );
            const result = await pdpaService.softDeleteUser({
                userId: 'user-123',
                password: 'correct-password',
            });
            const expected = fourYearsOut.toISOString();
            expect(result.retainUntil).toBe(expected);
            // graceUntil is still 30d; the row stays soft-deleted but
            // hard-delete eligibility waits until 4y.
            expect(new Date(result.hardDeleteEligibleAt) > new Date(result.graceUntil)).toBe(true);
        });

        // S5: softDeleteUser set isDeleted without sessionsRevokedAt while its
        // siblings (pdpa-erasure-service.js + pdpa-retention-job.js) DO stamp —
        // the self-deleted user's live 12h JWT survived their own erasure.
        it('stamps sessionsRevokedAt so the deleted user\'s live tokens are evicted', async () => {
            prisma.user.findUnique.mockResolvedValue(baseUserRecord());
            prisma.user.update.mockResolvedValue({
                id: 'user-123', isDeleted: true, deletedAt: new Date(), retainUntil: new Date(),
            });
            await pdpaService.softDeleteUser({
                userId: 'user-123', password: 'correct-password',
            });
            const data = prisma.user.update.mock.calls[0][0].data;
            expect(data.sessionsRevokedAt).toBeInstanceOf(Date);
            // whole-second boundary (SF-2 — see utils/session-epoch.js)
            expect(data.sessionsRevokedAt.getTime() % 1000).toBe(0);
        });

        it('truncates very long reason strings to 500 chars', async () => {
            prisma.user.findUnique.mockResolvedValue(baseUserRecord());
            prisma.user.update.mockResolvedValue({
                id: 'user-123', isDeleted: true, deletedAt: new Date(), retainUntil: new Date(),
            });
            const longReason = 'x'.repeat(2000);
            await pdpaService.softDeleteUser({
                userId: 'user-123', password: 'correct-password', reason: longReason,
            });
            const updateArg = prisma.user.update.mock.calls[0][0].data;
            expect(updateArg.deleteReason.length).toBe(500);
        });
    });
});
