/**
 * Unit tests for certificate-service — read methods.
 *
 * R7-A (2026-05-17): Adds `findById(id)` for the cross-tenant ADMIN
 * detail page at /admin/certificates/[id]. Tests verify:
 *   1. Soft-deleted rows are filtered out (isDeleted: false) — the
 *      cross-tenant view must NEVER return a logically-deleted cert.
 *   2. No ownership predicate is applied — that's the route layer's
 *      job (gated by isProviderRole). The service trusts the caller.
 *   3. Optional `select` / `include` shapes are forwarded to Prisma.
 *   4. Empty id returns null without hitting Prisma.
 *   5. `getCertificateForUser` ownership: holder scope + the R1 userId pin (Task 4).
 *
 * Mock pattern mirrors application-service.test.js — a single Prisma
 * mock with `findFirst`, populated per-test via `mockResolvedValue`.
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
        },
    },
}));

jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));

const { prisma } = require('../../services/prisma-database');
const certificateService = require('../../services/certificate-service');
const { hasHolderMarker } = require('../../services/holder-marker');

describe('certificate-service.findById', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns null when id is empty without hitting Prisma', async () => {
        const out = await certificateService.findById('');
        expect(out).toBeNull();
        expect(prisma.certificate.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when id is null without hitting Prisma', async () => {
        const out = await certificateService.findById(null);
        expect(out).toBeNull();
        expect(prisma.certificate.findFirst).not.toHaveBeenCalled();
    });

    it('queries by id with isDeleted: false filter and NO userId predicate', async () => {
        const fakeCert = {
            id: 'cert-42',
            certificateNumber: 'GACP-TH-2569-A3F7B2',
            farmName: 'ฟาร์มสมุนไพรเหนือ',
            status: 'active',
            isDeleted: false,
        };
        prisma.certificate.findFirst.mockResolvedValueOnce(fakeCert);

        const out = await certificateService.findById('cert-42');

        expect(out).toEqual(fakeCert);
        expect(prisma.certificate.findFirst).toHaveBeenCalledTimes(1);
        const call = prisma.certificate.findFirst.mock.calls[0][0];
        expect(call.where).toEqual({ id: 'cert-42', isDeleted: false });
        // CRITICAL: no userId filter — that's the route's job. If a future
        // change adds it here by mistake, this assertion will fire.
        expect(call.where.userId).toBeUndefined();
    });

    it('returns null when Prisma returns null (soft-deleted or missing)', async () => {
        prisma.certificate.findFirst.mockResolvedValueOnce(null);
        const out = await certificateService.findById('cert-missing');
        expect(out).toBeNull();
    });

    it('forwards include option to Prisma (e.g. application relation)', async () => {
        prisma.certificate.findFirst.mockResolvedValueOnce({ id: 'cert-1' });
        await certificateService.findById('cert-1', {
            include: { application: { select: { applicationNumber: true } } },
        });
        const call = prisma.certificate.findFirst.mock.calls[0][0];
        expect(call.include).toEqual({
            application: { select: { applicationNumber: true } },
        });
    });

    it('forwards select option to Prisma (column projection)', async () => {
        prisma.certificate.findFirst.mockResolvedValueOnce({ id: 'cert-1' });
        await certificateService.findById('cert-1', {
            select: { id: true, certificateNumber: true },
        });
        const call = prisma.certificate.findFirst.mock.calls[0][0];
        expect(call.select).toEqual({ id: true, certificateNumber: true });
    });

    it('returns revoked certificates (REVOKED is a status, not a delete)', async () => {
        const revoked = {
            id: 'cert-rev',
            status: 'revoked',
            revokedAt: new Date('2026-04-15T08:30:00Z'),
            revokedReason: 'ตรวจพบการละเมิดมาตรฐาน GACP',
            isDeleted: false,
        };
        prisma.certificate.findFirst.mockResolvedValueOnce(revoked);

        const out = await certificateService.findById('cert-rev');
        expect(out).toEqual(revoked);
        expect(out.revokedAt).toBeInstanceOf(Date);
    });
});

describe('certificate-service.findById — tenant scoping (C3)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('adds organizationId to the where when an organizationId is supplied (non-cross-tenant provider)', async () => {
        prisma.certificate.findFirst.mockResolvedValueOnce({ id: 'cert-1' });
        await certificateService.findById('cert-1', { organizationId: 'org-A' });
        const call = prisma.certificate.findFirst.mock.calls[0][0];
        expect(call.where).toEqual({ id: 'cert-1', isDeleted: false, organizationId: 'org-A' });
    });

    it('a tenant-A scoped lookup of a tenant-B cert returns null (Prisma where excludes it)', async () => {
        // Simulate: the row exists but belongs to org-B, so the org-A-scoped
        // where never matches → Prisma returns null → route 404s.
        prisma.certificate.findFirst.mockResolvedValueOnce(null);
        const out = await certificateService.findById('cert-of-org-B', { organizationId: 'org-A' });
        expect(out).toBeNull();
        const call = prisma.certificate.findFirst.mock.calls[0][0];
        expect(call.where.organizationId).toBe('org-A');
    });

    it('does NOT add organizationId when crossTenant is true (PLATFORM_ADMIN)', async () => {
        prisma.certificate.findFirst.mockResolvedValueOnce({ id: 'cert-1' });
        await certificateService.findById('cert-1', { organizationId: 'org-A', crossTenant: true });
        const call = prisma.certificate.findFirst.mock.calls[0][0];
        expect(call.where).toEqual({ id: 'cert-1', isDeleted: false });
        expect(call.where.organizationId).toBeUndefined();
    });

    it('does NOT add organizationId when none is supplied (legacy/back-compat callers)', async () => {
        prisma.certificate.findFirst.mockResolvedValueOnce({ id: 'cert-1' });
        await certificateService.findById('cert-1');
        const call = prisma.certificate.findFirst.mock.calls[0][0];
        expect(call.where.organizationId).toBeUndefined();
    });
});

describe('certificate-service.listCertificates — tenant scoping (C3)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prisma.certificate.findMany.mockResolvedValue([]);
    });

    it('scope=all + organizationId → where narrowed to that org (no userId)', async () => {
        await certificateService.listCertificates({ scope: 'all', organizationId: 'org-A', take: 100 });
        const call = prisma.certificate.findMany.mock.calls[0][0];
        expect(call.where).toEqual({ isDeleted: false, organizationId: 'org-A' });
        expect(call.where.userId).toBeUndefined();
    });

    it('scope=all + crossTenant:true (PLATFORM_ADMIN) → no organizationId filter', async () => {
        await certificateService.listCertificates({ scope: 'all', organizationId: 'org-A', crossTenant: true, take: 100 });
        const call = prisma.certificate.findMany.mock.calls[0][0];
        expect(call.where).toEqual({ isDeleted: false });
        expect(call.where.organizationId).toBeUndefined();
    });

    it('scope=self narrows by the holder scope + the R1 userId pin (HEALTH owner) and ignores org filter', async () => {
        const holderScope = { userId: 'user-1', readIds: ['entity-1'], editIds: ['entity-1'] };
        await certificateService.listCertificates({ scope: 'self', userId: 'user-1', holderScope, organizationId: 'org-A' });
        const call = prisma.certificate.findMany.mock.calls[0][0];
        // Spec 2026-09-30 §3.1 (Task 4): the holder fragment (marked); R1 keeps { userId } as the AND member.
        expect(hasHolderMarker(call.where.OR[0])).toBe(true);
        expect(hasHolderMarker(call.where.OR[1])).toBe(true);
        // R1 (Task 4 fix round 1): the pre-R1 pin decides; the OR carries the fragment.
        expect(JSON.parse(JSON.stringify(call.where))).toEqual({
            OR: [{ application: { entityId: { in: ['entity-1'] } } }, { userId: 'user-1' }],
            AND: [{ userId: 'user-1' }],
            isDeleted: false,
        });
        expect(call.where.organizationId).toBeUndefined();
    });

    it('scope=self with no holder scope fails closed (no query)', async () => {
        await expect(certificateService.listCertificates({ scope: 'self', userId: 'user-1' })).resolves.toEqual([]);
        expect(prisma.certificate.findMany).not.toHaveBeenCalled();
    });
});

describe('certificate-service.getCertificateForUser (ownership preserved)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns null when certificateId is missing', async () => {
        const out = await certificateService.getCertificateForUser('', 'user-1');
        expect(out).toBeNull();
        expect(prisma.certificate.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when the holder scope is missing (a bare userId is not a scope)', async () => {
        expect(await certificateService.getCertificateForUser('cert-1', 'user-1')).toBeNull();
        const out = await certificateService.getCertificateForUser('cert-1', '');
        expect(out).toBeNull();
        expect(prisma.certificate.findFirst).not.toHaveBeenCalled();
    });

    it('queries with id, the holder fragment, the R1 userId pin and isDeleted (IDOR guard)', async () => {
        prisma.certificate.findFirst.mockResolvedValueOnce({ id: 'cert-1' });
        await certificateService.getCertificateForUser('cert-1', { userId: 'user-1', readIds: ['entity-1'], editIds: [] });
        const call = prisma.certificate.findFirst.mock.calls[0][0];
        expect(hasHolderMarker(call.where.OR[0])).toBe(true);
        expect(hasHolderMarker(call.where.OR[1])).toBe(true);
        expect(JSON.parse(JSON.stringify(call.where))).toEqual({
            id: 'cert-1',
            OR: [{ application: { entityId: { in: ['entity-1'] } } }, { userId: 'user-1' }],
            AND: [{ userId: 'user-1' }],
            isDeleted: false,
        });
    });
});

describe('certificate-service.findCertificateForApplication (dedupe primitive)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns null for empty applicationId without hitting Prisma', async () => {
        const out = await certificateService.findCertificateForApplication('');
        expect(out).toBeNull();
        expect(prisma.certificate.findFirst).not.toHaveBeenCalled();
    });

    it('filters out soft-deleted AND revoked certs so a re-pass re-issues (#17)', async () => {
        prisma.certificate.findFirst.mockResolvedValueOnce({ id: 'cert-1' });
        await certificateService.findCertificateForApplication('app-1');
        const call = prisma.certificate.findFirst.mock.calls[0][0];
        // #17 (integrity-audit 2026-07-06): a human-revoked cert stays
        // isDeleted:false (MF-1), so the probe is now status-aware too — mirrors
        // generateCertificate's dedupe so a revoked cert never blocks a fresh one.
        expect(call.where).toEqual({
            applicationId: 'app-1',
            isDeleted: false,
            status: { notIn: ['revoked', 'REVOKED'] },
        });
        expect(call.orderBy).toEqual({ createdAt: 'desc' });
    });
});

describe('certificate-service.revokeCertificateForApplication (audit-pass reversal)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns null for empty applicationId without hitting Prisma', async () => {
        const out = await certificateService.revokeCertificateForApplication('');
        expect(out).toBeNull();
        expect(prisma.certificate.findFirst).not.toHaveBeenCalled();
        expect(prisma.certificate.update).not.toHaveBeenCalled();
    });

    it('is a no-op (null) when no live cert exists for the application', async () => {
        prisma.certificate.findFirst.mockResolvedValueOnce(null);
        const out = await certificateService.revokeCertificateForApplication('app-1');
        expect(out).toBeNull();
        expect(prisma.certificate.update).not.toHaveBeenCalled();
    });

    it('voids the live cert: status=revoked + soft-delete + forensic fields', async () => {
        prisma.certificate.findFirst.mockResolvedValueOnce({ id: 'cert-9' });
        prisma.certificate.update.mockResolvedValueOnce({ id: 'cert-9', status: 'revoked', isDeleted: true });

        const out = await certificateService.revokeCertificateForApplication('app-9', {
            revokedBy: 'auditor-1',
            reason: 'Audit pass reversed by auditor: missing CAR evidence',
        });

        // only the live (non-deleted) cert is targeted
        const findArgs = prisma.certificate.findFirst.mock.calls[0][0];
        expect(findArgs.where).toEqual({ applicationId: 'app-9', isDeleted: false });

        const updateArgs = prisma.certificate.update.mock.calls[0][0];
        expect(updateArgs.where).toEqual({ id: 'cert-9' });
        expect(updateArgs.data).toMatchObject({
            status: 'revoked',
            revokedBy: 'auditor-1',
            revokedReason: 'Audit pass reversed by auditor: missing CAR evidence',
            isDeleted: true,
            deleteReason: 'Audit pass reversed by auditor: missing CAR evidence',
        });
        expect(updateArgs.data.revokedAt).toBeInstanceOf(Date);
        expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
        expect(out).toEqual({ id: 'cert-9', status: 'revoked', isDeleted: true });
    });

    it('uses the provided transaction handle (opts.prisma) for atomicity', async () => {
        const tx = {
            certificate: {
                findFirst: jest.fn().mockResolvedValueOnce({ id: 'cert-tx' }),
                update: jest.fn().mockResolvedValueOnce({ id: 'cert-tx' }),
            },
        };
        await certificateService.revokeCertificateForApplication('app-tx', {
            revokedBy: 'auditor-2',
            reason: 'reversed',
            prisma: tx,
        });
        // routed through the tx handle, NOT the module-level prisma
        expect(tx.certificate.findFirst).toHaveBeenCalledTimes(1);
        expect(tx.certificate.update).toHaveBeenCalledTimes(1);
        expect(prisma.certificate.findFirst).not.toHaveBeenCalled();
        expect(prisma.certificate.update).not.toHaveBeenCalled();
    });

    it("defaults revokedBy to 'system' and a generic reason when omitted", async () => {
        prisma.certificate.findFirst.mockResolvedValueOnce({ id: 'cert-d' });
        prisma.certificate.update.mockResolvedValueOnce({ id: 'cert-d' });
        await certificateService.revokeCertificateForApplication('app-d');
        const updateArgs = prisma.certificate.update.mock.calls[0][0];
        expect(updateArgs.data.revokedBy).toBe('system');
        expect(updateArgs.data.revokedReason).toBe('Audit pass reversed');
    });
});

// ── WF-1: Certificate suspension / reinstatement (ISO/IEC 17065 §7.11) ───────
describe('certificate-service.suspendCertificate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects a missing certificateId with VALIDATION_ERROR', async () => {
        await expect(certificateService.suspendCertificate('', { reason: 'x'.repeat(5) }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(prisma.certificate.update).not.toHaveBeenCalled();
    });

    it('requires a reason of at least 3 chars (ISO 17065 record of decision)', async () => {
        await expect(certificateService.suspendCertificate('cert-1', { reason: 'no' }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(prisma.certificate.update).not.toHaveBeenCalled();
    });

    it('suspends an active cert: status→suspended, scoped to {id, status:active, isDeleted:false}', async () => {
        prisma.certificate.update.mockResolvedValueOnce({
            id: 'cert-1', status: 'suspended', certificateNumber: 'GACP-2026-1', organizationId: 'org-1',
        });
        const res = await certificateService.suspendCertificate('cert-1', {
            reason: 'lab re-test pending', suspendedBy: 'admin-9',
        });
        expect(res.status).toBe('suspended');
        const args = prisma.certificate.update.mock.calls[0][0];
        // Atomic claim: only an ACTIVE, non-deleted row may transition.
        expect(args.where).toEqual({ id: 'cert-1', status: 'active', isDeleted: false });
        expect(args.data.status).toBe('suspended');
        expect(args.data.suspendedBy).toBe('admin-9');
        expect(args.data.suspendedReason).toBe('lab re-test pending');
        expect(args.data.suspendedAt).toBeInstanceOf(Date);
    });

    it('maps Prisma P2025 (no active row) to CERTIFICATE_NOT_SUSPENDABLE', async () => {
        prisma.certificate.update.mockRejectedValueOnce(
            Object.assign(new Error('Record to update not found'), { code: 'P2025' }),
        );
        await expect(certificateService.suspendCertificate('cert-1', { reason: 'reason here' }))
            .rejects.toMatchObject({ code: 'CERTIFICATE_NOT_SUSPENDABLE' });
    });
});

describe('certificate-service.reinstateCertificate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('reinstates a suspended cert: status→active, scoped to {id, status:suspended, isDeleted:false}', async () => {
        prisma.certificate.update.mockResolvedValueOnce({
            id: 'cert-1', status: 'active', certificateNumber: 'GACP-2026-1', organizationId: 'org-1',
        });
        const res = await certificateService.reinstateCertificate('cert-1', { reinstatedBy: 'admin-9' });
        expect(res.status).toBe('active');
        const args = prisma.certificate.update.mock.calls[0][0];
        expect(args.where).toEqual({ id: 'cert-1', status: 'suspended', isDeleted: false });
        expect(args.data.status).toBe('active');
        expect(args.data.reinstatedBy).toBe('admin-9');
        expect(args.data.reinstatedAt).toBeInstanceOf(Date);
        // Suspension history is RETAINED (not cleared) for the audit record.
        expect(args.data).not.toHaveProperty('suspendedReason');
    });

    it('maps Prisma P2025 (not suspended) to CERTIFICATE_NOT_REINSTATABLE', async () => {
        prisma.certificate.update.mockRejectedValueOnce(
            Object.assign(new Error('Record to update not found'), { code: 'P2025' }),
        );
        await expect(certificateService.reinstateCertificate('cert-1', {}))
            .rejects.toMatchObject({ code: 'CERTIFICATE_NOT_REINSTATABLE' });
    });
});
