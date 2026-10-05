/**
 * Cert revoke — org-guard + soft-delete + audit (bugs 1.2 / 6.4 / 7.1).
 *
 * Bug 1.2 [HIGH]: any tenant ADMIN could revoke ANY tenant's cert via
 *   POST /v1/certificates/:num/revoke — requireAdminRole is tenant-scoped but
 *   the fetch/update had NO org filter, and prod RLS is decorative.
 * Bug 6.4 [MED]: interop revoke left isDeleted:false → the issuance dedupe
 *   (generateCertificate ~:135) reused the REVOKED row, blocking a valid
 *   replacement cert.
 * Bug 7.1 [MED]: interop revoke wrote no AuditLog.
 *
 * Fix = one shared certificateService.revokeCertificate(idOrNumber, {
 *   reason, actorId, callerOrganizationId, crossTenant }):
 *   (a) tenant-A ADMIN revoking tenant-B cert → 404-mapped error, no update
 *   (b) PLATFORM_ADMIN (crossTenant:true) → revokes across tenants
 *   (c) same-tenant ADMIN → revokes + isDeleted:true + status 'revoked' +
 *       _auditCertLifecycle called + reason required
 *   (d) after revoke (isDeleted:true), issuance dedupe does NOT reuse the row
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        application: {
            findUnique: jest.fn(),
        },
    },
}));

jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const { prisma } = require('../../services/prisma-database');
const certificateService = require('../../services/certificate-service');

const CERT_A = {
    id: 'cert-a-1',
    certificateNumber: 'GACP-TH-2569-AAAAAA',
    organizationId: 'org-A',
    status: 'active',
    isDeleted: false,
};

describe('[1.2/6.4/7.1] certificateService.revokeCertificate', () => {
    let auditSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        // Spy on the lifecycle audit hook (7.1) — it swallows its own errors.
        auditSpy = jest.spyOn(certificateService, '_auditCertLifecycle').mockResolvedValue(undefined);
        prisma.certificate.update.mockImplementation(async ({ data }) => ({ ...CERT_A, ...data }));
    });

    afterEach(() => {
        auditSpy.mockRestore();
    });

    it('(a) tenant-A ADMIN revoking tenant-B cert → 404-mapped error, NO update', async () => {
        // Resolve returns a cert in org-A; caller is org-B, not cross-tenant.
        prisma.certificate.findUnique.mockResolvedValue(CERT_A);
        prisma.certificate.findFirst.mockResolvedValue(CERT_A);

        await expect(
            certificateService.revokeCertificate('GACP-TH-2569-AAAAAA', {
                reason: 'malicious cross-tenant revoke',
                actorId: 'attacker-admin',
                callerOrganizationId: 'org-B',
                crossTenant: false,
            }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(prisma.certificate.update).not.toHaveBeenCalled();
        expect(auditSpy).not.toHaveBeenCalled();
    });

    it('(b) PLATFORM_ADMIN (crossTenant:true) → revokes across tenants', async () => {
        prisma.certificate.findUnique.mockResolvedValue(CERT_A);
        prisma.certificate.findFirst.mockResolvedValue(CERT_A);

        const out = await certificateService.revokeCertificate('GACP-TH-2569-AAAAAA', {
            reason: 'platform-level revocation',
            actorId: 'platform-admin-1',
            callerOrganizationId: 'org-B', // different org, but crossTenant bypasses
            crossTenant: true,
        });

        expect(prisma.certificate.update).toHaveBeenCalledTimes(1);
        expect(out.status).toBe('revoked');
        // MF-1: not soft-deleted (stays visible as REVOKED on public verify).
        expect(prisma.certificate.update.mock.calls[0][0].data.isDeleted).not.toBe(true);
    });

    it('(c) same-tenant ADMIN → revokes + status revoked + NOT soft-deleted (MF-1) + audit + reason required', async () => {
        prisma.certificate.findUnique.mockResolvedValue(CERT_A);
        prisma.certificate.findFirst.mockResolvedValue(CERT_A);

        // reason required — empty reason throws 400 and does NOT update.
        await expect(
            certificateService.revokeCertificate('GACP-TH-2569-AAAAAA', {
                reason: '   ',
                actorId: 'admin-A',
                callerOrganizationId: 'org-A',
                crossTenant: false,
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(prisma.certificate.update).not.toHaveBeenCalled();

        // valid reason → revokes.
        const out = await certificateService.revokeCertificate('GACP-TH-2569-AAAAAA', {
            reason: 'non-conformity found',
            actorId: 'admin-A',
            callerOrganizationId: 'org-A',
            crossTenant: false,
        });

        expect(prisma.certificate.update).toHaveBeenCalledTimes(1);
        const updateArg = prisma.certificate.update.mock.calls[0][0];
        // Atomic guard: the stamp only lands on a row that is not yet revoked,
        // so two concurrent presses cannot both re-stamp (the loser gets P2025).
        expect(updateArg.where).toEqual({ id: 'cert-a-1', status: { notIn: ['revoked', 'REVOKED'] } });
        expect(updateArg.data.status).toBe('revoked'); // canonical lowercase
        // MF-1: a revoked cert must NOT be soft-deleted — else it VANISHES from
        // the public verify (shows "not found" instead of "REVOKED"). Re-issuance
        // is freed by the status-aware dedupe, not by soft-delete.
        expect(updateArg.data.isDeleted).not.toBe(true);
        expect(updateArg.data.deletedAt).toBeUndefined();
        expect(updateArg.data.revokedReason).toBe('non-conformity found');
        expect(updateArg.data.revokedAt).toBeInstanceOf(Date);
        expect(out.status).toBe('revoked');

        // 7.1: lifecycle audit fired.
        expect(auditSpy).toHaveBeenCalledWith(
            'CERTIFICATE_REVOKED',
            expect.any(Object),
            expect.objectContaining({ reason: 'non-conformity found', actorId: 'admin-A' }),
        );
    });

    it('(c2) not-found cert → 404-mapped error, no update', async () => {
        prisma.certificate.findUnique.mockResolvedValue(null);
        prisma.certificate.findFirst.mockResolvedValue(null);

        await expect(
            certificateService.revokeCertificate('GACP-TH-2569-MISSING', {
                reason: 'x',
                actorId: 'admin-A',
                callerOrganizationId: 'org-A',
                crossTenant: false,
            }),
        ).rejects.toMatchObject({ statusCode: 404 });
        expect(prisma.certificate.update).not.toHaveBeenCalled();
    });

    describe('(e) already revoked → 409, never re-stamped (ISO 17065 §7.11 record of decision)', () => {
        it.each(['revoked', 'REVOKED'])('resolved by certificateNumber with status %s → 409, no update, no audit', async (status) => {
            prisma.certificate.findUnique.mockResolvedValue({ ...CERT_A, status, revokedBy: 'admin-original' });
            prisma.certificate.findFirst.mockResolvedValue(null);

            await expect(
                certificateService.revokeCertificate('GACP-TH-2569-AAAAAA', {
                    reason: 'second attempt',
                    actorId: 'admin-A',
                    callerOrganizationId: 'org-A',
                    crossTenant: false,
                }),
            ).rejects.toMatchObject({ statusCode: 409 });

            expect(prisma.certificate.update).not.toHaveBeenCalled();
            expect(auditSpy).not.toHaveBeenCalled();
        });

        it('resolved by id, soft-deleted and revoked → 409, no update', async () => {
            prisma.certificate.findUnique.mockResolvedValue(null);
            prisma.certificate.findFirst.mockResolvedValue({ ...CERT_A, status: 'revoked', isDeleted: true });

            await expect(
                certificateService.revokeCertificate('cert-a-1', {
                    reason: 'second attempt on a deleted row',
                    actorId: 'admin-A',
                    callerOrganizationId: 'org-A',
                    crossTenant: false,
                }),
            ).rejects.toMatchObject({ statusCode: 409 });

            expect(prisma.certificate.update).not.toHaveBeenCalled();
        });

        it('cross-tenant caller on a revoked row still gets the 404, not the 409 (no existence disclosure)', async () => {
            prisma.certificate.findUnique.mockResolvedValue({ ...CERT_A, status: 'revoked' });
            prisma.certificate.findFirst.mockResolvedValue(null);

            await expect(
                certificateService.revokeCertificate('GACP-TH-2569-AAAAAA', {
                    reason: 'probe',
                    actorId: 'attacker-admin',
                    callerOrganizationId: 'org-B',
                    crossTenant: false,
                }),
            ).rejects.toMatchObject({ statusCode: 404 });

            expect(prisma.certificate.update).not.toHaveBeenCalled();
        });

        it('race loser: the read saw active but the conditional write matched no row (P2025) → 409, no audit', async () => {
            prisma.certificate.findUnique.mockResolvedValue(CERT_A);
            prisma.certificate.findFirst.mockResolvedValue(CERT_A);
            prisma.certificate.update.mockRejectedValue(
                Object.assign(new Error('Record to update not found.'), { code: 'P2025' }),
            );

            await expect(
                certificateService.revokeCertificate('GACP-TH-2569-AAAAAA', {
                    reason: 'concurrent press',
                    actorId: 'admin-A',
                    callerOrganizationId: 'org-A',
                    crossTenant: false,
                }),
            ).rejects.toMatchObject({ statusCode: 409 });

            expect(prisma.certificate.update).toHaveBeenCalledTimes(1);
            expect(auditSpy).not.toHaveBeenCalled();
        });

        it('a non-P2025 write failure is rethrown as-is (not masked as 409)', async () => {
            prisma.certificate.findUnique.mockResolvedValue(CERT_A);
            prisma.certificate.findFirst.mockResolvedValue(CERT_A);
            prisma.certificate.update.mockRejectedValue(
                Object.assign(new Error('connection lost'), { code: 'P1001' }),
            );

            await expect(
                certificateService.revokeCertificate('GACP-TH-2569-AAAAAA', {
                    reason: 'db down',
                    actorId: 'admin-A',
                    callerOrganizationId: 'org-A',
                    crossTenant: false,
                }),
            ).rejects.toMatchObject({ code: 'P1001' });
            expect(auditSpy).not.toHaveBeenCalled();
        });
    });

    it('(d) 6.4: issuance dedupe is STATUS-aware → a revoked (isDeleted:false) row never blocks reissue', async () => {
        // generateCertificate dedupe query MUST be status-aware: revoked certs are
        // kept isDeleted:false (MF-1, so they stay visible as REVOKED), so the
        // `status notIn [revoked,REVOKED]` filter is what frees the re-pass.
        // We assert the dedupe where-clause excludes revoked statuses.
        const revokedRow = { ...CERT_A, status: 'revoked', isDeleted: false };
        // The dedupe findFirst is scoped so a revoked/soft-deleted row is not matched.
        prisma.certificate.findFirst.mockResolvedValue(null);
        // application lookup will run past the dedupe → force an early controlled stop.
        prisma.application.findUnique.mockResolvedValue(null);

        await expect(
            certificateService.generateCertificate('app-reissue-1', 'provider-1'),
        ).rejects.toThrow(/Application not found/);

        // The dedupe query fired and its where-clause is status-aware (notIn revoked).
        expect(prisma.certificate.findFirst).toHaveBeenCalled();
        const dedupeWhere = prisma.certificate.findFirst.mock.calls[0][0].where;
        expect(dedupeWhere.isDeleted).toBe(false);
        expect(dedupeWhere.status).toEqual({ notIn: ['revoked', 'REVOKED'] });
        // Sanity: the constant used to build revokedRow is a revoked shape.
        expect(revokedRow.status).toBe('revoked');
    });
});
