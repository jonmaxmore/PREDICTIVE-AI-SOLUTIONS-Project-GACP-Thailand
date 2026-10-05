'use strict';

/**
 * CERTIFICATE-INTEGRITY cluster — carpet-bomb inversion audit 2026-07-06.
 *
 * Findings covered here (certificate-service.js):
 *   #17 — findCertificateForApplication must ignore a human-REVOKED cert
 *         (isDeleted:false) so a re-passed application can mint a fresh valid
 *         cert. Today the idempotency probe returns the revoked cert → the
 *         writer skips generateCertificate → the replacement is blocked.
 *   #16 — verifyDocumentIntegrity must fail CLOSED on live revocation state.
 *         buildCertificateDocumentHash deliberately omits status/revocation
 *         (so a legit revoke isn't read as TAMPERED), but that also means an
 *         un-revoke (isDeleted→false / status→active) leaves the green
 *         integrity chip on a cert that was revoked. We do NOT change the hash
 *         formula (would break every existing signed cert); instead the verify
 *         path independently checks revocation and refuses to return 'VALID'.
 *   #15 — revokeCertificateForApplication (the audit-pass-reversal void) must
 *         invalidate the audit-pass record so a later force/path cannot
 *         re-mint a certificate off the STALE pass.
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
        },
        application: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    },
}));

jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));

const { prisma } = require('../../services/prisma-database');
const certificateService = require('../../services/certificate-service');

// ── #17 ─────────────────────────────────────────────────────────────────────
describe('#17 findCertificateForApplication ignores REVOKED certs so a re-pass can re-issue', () => {
    beforeEach(() => jest.clearAllMocks());

    it('excludes status revoked/REVOKED in the dedupe probe (mirrors generateCertificate dedupe)', async () => {
        prisma.certificate.findFirst.mockResolvedValueOnce(null);
        await certificateService.findCertificateForApplication('app-17');
        const where = prisma.certificate.findFirst.mock.calls[0][0].where;
        expect(where.applicationId).toBe('app-17');
        expect(where.isDeleted).toBe(false);
        // The bug: a human-revoked cert stays isDeleted:false (MF-1) — without a
        // status filter it is returned here and blocks the replacement.
        expect(where.status).toEqual({ notIn: ['revoked', 'REVOKED'] });
    });
});

// ── #16 ─────────────────────────────────────────────────────────────────────
describe('#16 verifyDocumentIntegrity fails CLOSED on live revocation (un-revoke cannot show green)', () => {
    const BASE = Object.freeze({
        certificateNumber: 'GACP-TH-2569-A3F7B2',
        verificationCode: 'A1B2C3D4',
        applicationId: 'app-1',
        userId: 'user-1',
        farmId: 'farm-1',
        farmName: 'ฟาร์มสมุนไพรสมชาย',
        applicantName: 'สมชาย ใจดี',
        cropType: 'กัญชา',
        farmSize: 5.5,
        province: 'เชียงราย',
        district: 'เมือง',
        subDistrict: 'รอบเวียง',
        standardName: 'GACP Thailand',
        standardId: 'GACP-TH',
        validityYears: 3,
        issuedDate: new Date('2026-05-16T03:00:00Z'),
        expiryDate: new Date('2029-05-16T03:00:00Z'),
        issuedBy: 'provider-1',
    });

    it('active untampered cert still returns VALID (no regression)', () => {
        const documentHash = certificateService.buildCertificateDocumentHash(BASE);
        const res = certificateService.verifyDocumentIntegrity({ ...BASE, documentHash, status: 'active' });
        expect(res.status).toBe('VALID');
    });

    it('a REVOKED cert whose row is otherwise intact does NOT return VALID', () => {
        const documentHash = certificateService.buildCertificateDocumentHash(BASE);
        const res = certificateService.verifyDocumentIntegrity({
            ...BASE, documentHash, status: 'revoked', revokedAt: new Date('2026-06-01T00:00:00Z'),
        });
        expect(res.status).not.toBe('VALID');
        expect(res.status).toBe('REVOKED');
    });

    it('catches an un-revoke that flips status→active + isDeleted→false but leaves revokedAt', () => {
        const documentHash = certificateService.buildCertificateDocumentHash(BASE);
        const res = certificateService.verifyDocumentIntegrity({
            ...BASE, documentHash, status: 'active', isDeleted: false, revokedAt: new Date('2026-06-01T00:00:00Z'),
        });
        expect(res.status).toBe('REVOKED');
    });

    it('still reports TAMPERED (hash mismatch takes precedence) for a revoked+tampered row', () => {
        const documentHash = certificateService.buildCertificateDocumentHash(BASE);
        const res = certificateService.verifyDocumentIntegrity({
            ...BASE, farmName: 'FORGED', documentHash, status: 'revoked', revokedAt: new Date(),
        });
        expect(res.status).toBe('TAMPERED');
    });
});

// ── #15 ─────────────────────────────────────────────────────────────────────
describe('#15 revokeCertificateForApplication invalidates the audit-pass record on reversal', () => {
    beforeEach(() => jest.clearAllMocks());

    it('clears Application.auditResult (column) + formData.auditResult/auditedAt (JSON)', async () => {
        const tx = {
            application: {
                findUnique: jest.fn().mockResolvedValue({
                    formData: { auditResult: 'PASS', auditedAt: '2026-07-06', plots: [{ name: 'A' }] },
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            certificate: {
                findFirst: jest.fn().mockResolvedValue({ id: 'cert-1' }),
                update: jest.fn().mockResolvedValue({ id: 'cert-1', status: 'revoked' }),
            },
        };

        await certificateService.revokeCertificateForApplication('app-15', {
            revokedBy: 'auditor-1',
            reason: 'reversed',
            prisma: tx,
        });

        expect(tx.application.update).toHaveBeenCalledTimes(1);
        const data = tx.application.update.mock.calls[0][0].data;
        expect(data.auditResult).toBeNull();
        // formData keeps every other field but strips the pass markers
        expect(data.formData).toEqual({ plots: [{ name: 'A' }] });
        expect(data.formData.auditResult).toBeUndefined();
        expect(data.formData.auditedAt).toBeUndefined();
    });

    it('still voids the live cert (existing behaviour preserved)', async () => {
        const tx = {
            application: {
                findUnique: jest.fn().mockResolvedValue({ formData: { auditResult: 'PASS' } }),
                update: jest.fn().mockResolvedValue({}),
            },
            certificate: {
                findFirst: jest.fn().mockResolvedValue({ id: 'cert-9' }),
                update: jest.fn().mockResolvedValue({ id: 'cert-9', status: 'revoked', isDeleted: true }),
            },
        };
        const out = await certificateService.revokeCertificateForApplication('app-9', {
            revokedBy: 'auditor-1',
            reason: 'reversed',
            prisma: tx,
        });
        expect(tx.certificate.update).toHaveBeenCalledTimes(1);
        expect(tx.certificate.update.mock.calls[0][0].data).toMatchObject({ status: 'revoked', isDeleted: true });
        expect(out).toMatchObject({ id: 'cert-9', status: 'revoked' });
    });
});
