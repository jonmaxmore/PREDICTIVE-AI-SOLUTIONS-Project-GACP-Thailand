'use strict';

/**
 * ฉบับแก้ไขภายใต้เลขเดิม — certificateService.reviseCertificateFromFarm.
 *
 * Spec: design note 2026-08-27-certificate-revision-design §3.
 * The corrected values come from the Farm row only; the signed original is
 * archived verbatim as revision n and the live row is rewritten + re-signed as
 * revision n+1 in one transaction. Drives the real service through the
 * injectable options.prisma client (pattern:
 * certificate-issuance-carries-farm-coordinates.test.js) — no DB.
 */

const mockTrustedFingerprint = 'sha256:trusted';
const mockSign = jest.fn(async () => 'sig-v2');
// One stub object for the whole file so a jest.spyOn on it is the same object
// the service reaches through getSignatureService().
const mockSignatureService = {
    signWithLocalKey: (...a) => mockSign(...a),
    getPublicKeyForNamespace: async () => 'pem-v2',
    verifyWithLocalKey: async () => true,
    getTrustedPublicKeyFingerprints: async () => new Set([mockTrustedFingerprint]),
};
jest.mock('../../services/crypto/signature-service', () => ({
    getSignatureService: () => mockSignatureService,
    fingerprintPublicKey: () => mockTrustedFingerprint,
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});
const mockAuditLog = jest.fn(async () => {});
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAuditLog(...a) },
    AuditCategory: { CERTIFICATE: 'CERTIFICATE' },
    AuditSeverity: { WARNING: 'WARNING' },
}));

const certService = require('../../services/certificate-service');

const ORG = 'org-1';
const farm = {
    id: 'farm-1', organizationId: ORG,
    province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subDistrict: 'สุเทพ', address: '88/12 หมู่ 5', postalCode: '50200',
};
// F-G4-58: the plant a revision names comes from the plant master through the
// application's wizard answer (formData.plantId, the FE slug), never from the
// certificate's own column and never from a literal.
const PLANT_MASTER = Object.freeze({
    CAN: { id: 'ps-can', code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' },
});
const application = { formData: { plantId: 'cannabis' } };
function liveCert(over = {}) {
    return {
        id: 'cert-1', certificateNumber: 'GACP-TH-2569-TEST01', verificationCode: 'vc', applicationId: 'app-1', userId: 'u1',
        farmId: 'farm-1', farmName: 'ไร่ทดสอบ', applicantName: 'สมชาย', cropType: 'กัญชา', farmSize: 200,
        province: 'Unknown', district: '-', subDistrict: '-', address: null,
        standardName: 'GACP', standardId: 'std', validityYears: 3, issuedDate: new Date('2026-08-26T00:00:00Z'),
        expiryDate: new Date('2029-08-26T00:00:00Z'), issuedBy: 'auditor-1', status: 'active', organizationId: ORG,
        revisionNo: 1, documentHash: 'hmac-sha256:old', signature: 'sig-v1', signatureAlgorithm: 'RSA-SHA256',
        signatureKeyId: 'rsa:gacp-certificate', signaturePublicKey: 'pem-v1', signedBy: 'auditor-1',
        signedAt: new Date('2026-08-26T00:00:00Z'),
        farm, application, ...over,
    };
}
function fakePrisma(cert) {
    const tx = {
        certificateRevision: { create: jest.fn(async ({ data }) => ({ id: 'rev-1', ...data })) },
        certificate: {
            updateMany: jest.fn(async () => ({ count: 1 })),
            findUnique: jest.fn(async () => ({ ...cert, revisionNo: 2 })),
        },
    };
    return {
        tx,
        certificate: { findFirst: jest.fn(async () => cert) },
        plantSpecies: { findUnique: jest.fn(async ({ where }) => PLANT_MASTER[where.code] || null) },
        $transaction: jest.fn(async (cb) => cb(tx)),
    };
}
const REASON = 'ที่ตั้งฟาร์มถูกบันทึกเป็น Unknown จากความผิดพลาดของระบบ';
const opts = (p) => ({ actorId: 'admin-1', reason: REASON, callerOrganizationId: ORG, prisma: p });

beforeEach(() => {
    mockSign.mockClear();
    mockAuditLog.mockClear();
});

describe('reviseCertificateFromFarm', () => {
    it('loads the certificate with its farm and the application\'s wizard answers, not-deleted only', async () => {
        const p = fakePrisma(liveCert());
        await certService.reviseCertificateFromFarm('cert-1', opts(p));
        expect(p.certificate.findFirst).toHaveBeenCalledWith({
            where: { id: 'cert-1', isDeleted: false },
            include: { farm: true, application: { select: { formData: true } } },
        });
    });

    it('archives the previous signed document verbatim as revision 1', async () => {
        const p = fakePrisma(liveCert());
        await certService.reviseCertificateFromFarm('cert-1', opts(p));
        const { data } = p.tx.certificateRevision.create.mock.calls[0][0];
        expect(data.certificateId).toBe('cert-1');
        expect(data.revisionNo).toBe(1);
        expect(data.documentHash).toBe('hmac-sha256:old');
        expect(data.signature).toBe('sig-v1');
        expect(data.signatureAlgorithm).toBe('RSA-SHA256');
        expect(data.signatureKeyId).toBe('rsa:gacp-certificate');
        expect(data.signaturePublicKey).toBe('pem-v1');
        expect(data.signedBy).toBe('auditor-1');
        expect(data.signedAt).toEqual(new Date('2026-08-26T00:00:00Z'));
        expect(data.snapshot.province).toBe('Unknown');
        expect(data.snapshot.district).toBe('-');
        expect(data.snapshot.address).toBeNull();
        // every canonical field, as it stood when signed (dates as ISO)
        expect(data.snapshot.certificateNumber).toBe('GACP-TH-2569-TEST01');
        expect(data.snapshot.issuedDate).toBe('2026-08-26T00:00:00.000Z');
        expect(data.reasonCode).toBe('SYSTEM_DATA_CORRECTION');
        expect(data.reasonText).toBe(REASON);
        expect(data.correctedFields.sort()).toEqual(['address', 'district', 'province', 'subDistrict']);
        expect(data.supersededBy).toBe('admin-1');
        expect(data.supersededAt).toBeInstanceOf(Date);
        expect(data.organizationId).toBe(ORG);
    });

    it('rewrites the live row from the farm, re-signs, bumps revisionNo conditionally', async () => {
        const p = fakePrisma(liveCert());
        const out = await certService.reviseCertificateFromFarm('cert-1', opts(p));
        const call = p.tx.certificate.updateMany.mock.calls[0][0];
        expect(call.where).toEqual({ id: 'cert-1', revisionNo: 1 });
        expect(call.data).toEqual(expect.objectContaining({
            province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subDistrict: 'สุเทพ', address: '88/12 หมู่ 5',
            revisionNo: 2, revisedBy: 'admin-1', revisionReason: 'SYSTEM_DATA_CORRECTION',
            signature: 'sig-v2', signatureAlgorithm: 'RSA-SHA256', signatureKeyId: 'rsa:gacp-certificate',
            signaturePublicKey: 'pem-v2', signedBy: 'admin-1',
            pdfGenerated: false, pdfGeneratedAt: null, updatedBy: 'admin-1',
        }));
        expect(call.data.documentHash).not.toBe('hmac-sha256:old');
        expect(call.data.revisedAt).toBeInstanceOf(Date);
        expect(call.data.signedAt).toEqual(call.data.revisedAt);
        // the live row keeps its identity: no status / number / id in the write
        expect(call.data).not.toHaveProperty('status');
        expect(call.data).not.toHaveProperty('certificateNumber');
        expect(call.data).not.toHaveProperty('id');
        expect(out.previousRevisionNo).toBe(1);
        expect(out.correctedFields.sort()).toEqual(['address', 'district', 'province', 'subDistrict']);
        expect(out.certificate.revisionNo).toBe(2);
    });

    it('the new hash is the canonical hash of the corrected content, and that is what was signed', async () => {
        const p = fakePrisma(liveCert());
        await certService.reviseCertificateFromFarm('cert-1', opts(p));
        const { data } = p.tx.certificate.updateMany.mock.calls[0][0];
        const expected = certService.buildCertificateDocumentHash({ ...liveCert(), ...data });
        expect(data.documentHash).toBe(expected);
        expect(mockSign).toHaveBeenCalledTimes(1);
        expect(mockSign.mock.calls[0][0]).toBe(expected);
    });

    it('records a CERTIFICATE_REVISED lifecycle audit with the revision facts', async () => {
        const p = fakePrisma(liveCert());
        await certService.reviseCertificateFromFarm('cert-1', opts(p));
        expect(mockAuditLog).toHaveBeenCalledTimes(1);
        const entry = mockAuditLog.mock.calls[0][0];
        expect(entry.action).toBe('CERTIFICATE_REVISED');
        expect(entry.actorId).toBe('admin-1');
        expect(entry.resourceId).toBe('cert-1');
        expect(entry.organizationId).toBe(ORG);
        expect(entry.metadata.reason).toBe(REASON);
        expect(entry.metadata.reasonCode).toBe('SYSTEM_DATA_CORRECTION');
        expect(entry.metadata.revisionNo).toBe(2);
        expect(entry.metadata.previousRevisionNo).toBe(1);
        expect(entry.metadata.correctedFields.sort()).toEqual(['address', 'district', 'province', 'subDistrict']);
    });

    it('archives and rewrites inside ONE transaction', async () => {
        const p = fakePrisma(liveCert());
        await certService.reviseCertificateFromFarm('cert-1', opts(p));
        expect(p.$transaction).toHaveBeenCalledTimes(1);
        expect(p.tx.certificateRevision.create).toHaveBeenCalledTimes(1);
        expect(p.tx.certificate.updateMany).toHaveBeenCalledTimes(1);
    });

    it('bumps from the number it read: a revision 2 certificate archives 2 and becomes 3', async () => {
        const p = fakePrisma(liveCert({ revisionNo: 2 }));
        const out = await certService.reviseCertificateFromFarm('cert-1', opts(p));
        expect(p.tx.certificateRevision.create.mock.calls[0][0].data.revisionNo).toBe(2);
        const call = p.tx.certificate.updateMany.mock.calls[0][0];
        expect(call.where).toEqual({ id: 'cert-1', revisionNo: 2 });
        expect(call.data.revisionNo).toBe(3);
        expect(out.previousRevisionNo).toBe(2);
    });

    it('only the fields that differ are listed as corrected', async () => {
        const p = fakePrisma(liveCert({ province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subDistrict: 'สุเทพ', address: null }));
        const out = await certService.reviseCertificateFromFarm('cert-1', opts(p));
        expect(out.correctedFields).toEqual(['address']);
        expect(p.tx.certificateRevision.create.mock.calls[0][0].data.correctedFields).toEqual(['address']);
    });

    it.each(['revoked', 'REVOKED', 'suspended', 'expired', 'renewed'])(
        'refuses a %s certificate with CERTIFICATE_NOT_REVISABLE and writes nothing',
        async (status) => {
            const p = fakePrisma(liveCert({ status }));
            await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
                .rejects.toMatchObject({ code: 'CERTIFICATE_NOT_REVISABLE', statusCode: 409 });
            expect(p.$transaction).not.toHaveBeenCalled();
            expect(mockSign).not.toHaveBeenCalled();
        },
    );

    it('refuses a certificate past its expiryDate even while its stored status is still active, and writes nothing', async () => {
        // Nothing in the backend writes status expired; the register derives it from expiryDate at read time.
        const p = fakePrisma(liveCert({ status: 'active', expiryDate: new Date('2026-08-26T00:00:00Z') }));
        await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
            .rejects.toMatchObject({ code: 'CERTIFICATE_NOT_REVISABLE', statusCode: 409 });
        expect(p.$transaction).not.toHaveBeenCalled();
        expect(mockSign).not.toHaveBeenCalled();
    });

    it('refuses when the farm and the certificate already agree', async () => {
        const p = fakePrisma(liveCert({ province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subDistrict: 'สุเทพ', address: '88/12 หมู่ 5' }));
        await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
            .rejects.toMatchObject({ code: 'CERTIFICATE_REVISION_NO_CHANGE', statusCode: 409 });
        expect(p.$transaction).not.toHaveBeenCalled();
        expect(mockSign).not.toHaveBeenCalled();
    });

    // F-G4-58: the demo register's certificates carry cropType 'Herb' inside the
    // signed canonical JSON. A revision corrects it from the plant master.
    describe('the plant name (F-G4-58)', () => {
        it('corrects a retired literal cropType from the plant master and archives the literal as it was signed', async () => {
            const p = fakePrisma(liveCert({ cropType: 'Herb' }));
            const out = await certService.reviseCertificateFromFarm('cert-1', opts(p));
            expect(out.correctedFields).toContain('cropType');
            expect(p.plantSpecies.findUnique).toHaveBeenCalledWith({ where: { code: 'CAN' } });
            const update = p.tx.certificate.updateMany.mock.calls[0][0].data;
            expect(update.cropType).toBe('กัญชา');
            const archived = p.tx.certificateRevision.create.mock.calls[0][0].data;
            expect(archived.snapshot.cropType).toBe('Herb');
            expect(archived.correctedFields).toContain('cropType');
        });

        it('a plant-only revision is published under a label that does not state a farm-location correction', async () => {
            // The c04 walk case: the location already agrees with the farm row;
            // only the retired literal cropType moves. The code written to the
            // live row is what the public verifier maps to its Thai label.
            const p = fakePrisma(liveCert({
                province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subDistrict: 'สุเทพ', address: '88/12 หมู่ 5', cropType: 'Herb',
            }));
            const out = await certService.reviseCertificateFromFarm('cert-1', opts(p));
            expect(out.correctedFields).toEqual(['cropType']);
            const update = p.tx.certificate.updateMany.mock.calls[0][0].data;
            const label = certService.REVISION_REASON_LABELS_TH[update.revisionReason];
            expect(label).toBe('แก้ไขข้อมูลบนใบรับรองให้ตรงกับบันทึกต้นทาง (ความผิดพลาดของระบบ)');
            expect(label).not.toMatch(/ที่ตั้งฟาร์ม/);
        });

        it('leaves cropType out of the corrected list when the certificate already names the plant', async () => {
            const p = fakePrisma(liveCert({ cropType: 'กัญชา' }));
            const out = await certService.reviseCertificateFromFarm('cert-1', opts(p));
            expect(out.correctedFields).not.toContain('cropType');
            expect(out.correctedFields.sort()).toEqual(['address', 'district', 'province', 'subDistrict']);
            // The rewrite carries every register field (same contract as the four
            // location fields); an unchanged one is written back as the master's name.
            expect(p.tx.certificate.updateMany.mock.calls[0][0].data.cropType).toBe('กัญชา');
            expect(p.tx.certificateRevision.create.mock.calls[0][0].data.correctedFields).not.toContain('cropType');
        });

        it('refuses with CERTIFICATE_PLANT_UNKNOWN when the application names a plant the master does not know, writing nothing', async () => {
            const p = fakePrisma(liveCert({ cropType: 'Herb', application: { formData: { plantId: 'durian' } } }));
            await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
                .rejects.toMatchObject({ code: 'CERTIFICATE_PLANT_UNKNOWN', statusCode: 422, message: expect.stringContaining('durian') });
            expect(p.$transaction).not.toHaveBeenCalled();
            expect(mockSign).not.toHaveBeenCalled();
        });

        it('refuses with CERTIFICATE_PLANT_UNKNOWN when the application names no plant, writing nothing', async () => {
            const p = fakePrisma(liveCert({ cropType: 'Herb', application: { formData: {} } }));
            await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
                .rejects.toMatchObject({ code: 'CERTIFICATE_PLANT_UNKNOWN', statusCode: 422 });
            expect(p.plantSpecies.findUnique).not.toHaveBeenCalled();
            expect(p.$transaction).not.toHaveBeenCalled();
        });
    });

    it('refuses when the farm row itself lacks a location fact', async () => {
        const p = fakePrisma(liveCert({ farm: { ...farm, district: '' } }));
        await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
            .rejects.toMatchObject({ code: 'CERTIFICATE_FARM_LOCATION_MISSING', statusCode: 422, missingFields: ['district'] });
        expect(p.$transaction).not.toHaveBeenCalled();
    });

    it('a retired stand-in on the farm row counts as missing, never as a place', async () => {
        const p = fakePrisma(liveCert({ farm: { ...farm, province: 'Unknown' } }));
        await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
            .rejects.toMatchObject({ code: 'CERTIFICATE_FARM_LOCATION_MISSING', missingFields: ['province'] });
        expect(p.$transaction).not.toHaveBeenCalled();
    });

    it('a lost race on revisionNo refuses with CERTIFICATE_REVISION_CONFLICT', async () => {
        const p = fakePrisma(liveCert());
        p.tx.certificate.updateMany.mockResolvedValueOnce({ count: 0 });
        await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
            .rejects.toMatchObject({ code: 'CERTIFICATE_REVISION_CONFLICT', statusCode: 409 });
        expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('the conditional update runs first: the loser never attempts an archive row', async () => {
        const p = fakePrisma(liveCert());
        p.tx.certificate.updateMany.mockResolvedValueOnce({ count: 0 });
        await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
            .rejects.toMatchObject({ code: 'CERTIFICATE_REVISION_CONFLICT', statusCode: 409 });
        expect(p.tx.certificateRevision.create).not.toHaveBeenCalled();
    });

    it('a unique-index collision on (certificateId, revisionNo) is the same lost race, never a raw P2002', async () => {
        const p = fakePrisma(liveCert());
        p.tx.certificateRevision.create.mockRejectedValueOnce(Object.assign(
            new Error('Unique constraint failed on the fields: (`certificateId`,`revisionNo`)'),
            { name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { target: ['certificateId', 'revisionNo'] } },
        ));
        await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
            .rejects.toMatchObject({ code: 'CERTIFICATE_REVISION_CONFLICT', statusCode: 409 });
        expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('a P2002 on some other unique (not the revision key) is not ours and surfaces untouched', async () => {
        const p = fakePrisma(liveCert());
        p.tx.certificateRevision.create.mockRejectedValueOnce(Object.assign(
            new Error('Unique constraint failed on the fields: (`id`)'),
            { name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { target: ['id'] } },
        ));
        await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
            .rejects.toMatchObject({ code: 'P2002' });
        expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('another tenant gets the same 404 as a missing certificate', async () => {
        const p = fakePrisma(liveCert({ organizationId: 'org-2' }));
        await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
            .rejects.toMatchObject({ statusCode: 404, message: 'Certificate not found' });
        expect(p.$transaction).not.toHaveBeenCalled();
    });

    it('a caller with no organization is refused with the same 404 (fail-closed)', async () => {
        const p = fakePrisma(liveCert());
        await expect(certService.reviseCertificateFromFarm('cert-1', { ...opts(p), callerOrganizationId: null }))
            .rejects.toMatchObject({ statusCode: 404 });
        expect(p.$transaction).not.toHaveBeenCalled();
    });

    it('a missing certificate is a 404', async () => {
        const p = fakePrisma(null);
        await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
            .rejects.toMatchObject({ statusCode: 404, message: 'Certificate not found' });
    });

    it('crossTenant (platform admin) may revise another organization\'s certificate', async () => {
        const p = fakePrisma(liveCert({ organizationId: 'org-2' }));
        const out = await certService.reviseCertificateFromFarm('cert-1', { ...opts(p), callerOrganizationId: null, crossTenant: true });
        expect(out.previousRevisionNo).toBe(1);
        expect(p.tx.certificateRevision.create.mock.calls[0][0].data.organizationId).toBe('org-2');
    });

    it('an untrusted signing key refuses the whole revision (nothing archived)', async () => {
        const p = fakePrisma(liveCert());
        const svc = require('../../services/crypto/signature-service').getSignatureService();
        const spy = jest.spyOn(svc, 'getTrustedPublicKeyFingerprints').mockResolvedValueOnce(new Set(['sha256:other']));
        await expect(certService.reviseCertificateFromFarm('cert-1', opts(p)))
            .rejects.toMatchObject({ code: 'CERT_SIGNING_UNAVAILABLE', statusCode: 503 });
        spy.mockRestore();
        expect(p.$transaction).not.toHaveBeenCalled();
        expect(p.tx.certificateRevision.create).not.toHaveBeenCalled();
    });

    it('stores a blank reason as null, a padded one trimmed', async () => {
        const blank = fakePrisma(liveCert());
        await certService.reviseCertificateFromFarm('cert-1', { ...opts(blank), reason: '   ' });
        expect(blank.tx.certificateRevision.create.mock.calls[0][0].data.reasonText).toBeNull();
        const padded = fakePrisma(liveCert());
        await certService.reviseCertificateFromFarm('cert-1', { ...opts(padded), reason: `  ${REASON}  ` });
        expect(padded.tx.certificateRevision.create.mock.calls[0][0].data.reasonText).toBe(REASON);
    });
});

describe('previewCertificateRevision', () => {
    it('returns current vs corrected and the changed keys without writing', async () => {
        const p = fakePrisma(liveCert());
        const out = await certService.previewCertificateRevision('cert-1', { callerOrganizationId: ORG, prisma: p });
        expect(out.current).toEqual({ province: 'Unknown', district: '-', subDistrict: '-', address: null, cropType: 'กัญชา' });
        expect(out.corrected).toEqual({ province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subDistrict: 'สุเทพ', address: '88/12 หมู่ 5', cropType: 'กัญชา' });
        expect(out.changed.sort()).toEqual(['address', 'district', 'province', 'subDistrict']);
        expect(p.$transaction).not.toHaveBeenCalled();
        expect(mockSign).not.toHaveBeenCalled();
    });

    it('reports a retired literal cropType as changed, with the master name as the correction (F-G4-58)', async () => {
        const p = fakePrisma(liveCert({ cropType: 'Herb' }));
        const out = await certService.previewCertificateRevision('cert-1', { callerOrganizationId: ORG, prisma: p });
        expect(out.current.cropType).toBe('Herb');
        expect(out.corrected.cropType).toBe('กัญชา');
        expect(out.changed).toContain('cropType');
        expect(p.$transaction).not.toHaveBeenCalled();
    });

    it('refuses the preview too when the plant is unknown to the master (F-G4-58)', async () => {
        const p = fakePrisma(liveCert({ cropType: 'Herb', application: { formData: { plantId: 'durian' } } }));
        await expect(certService.previewCertificateRevision('cert-1', { callerOrganizationId: ORG, prisma: p }))
            .rejects.toMatchObject({ code: 'CERTIFICATE_PLANT_UNKNOWN', statusCode: 422 });
    });

    it('answers changed: [] (no refusal) when the farm and the certificate agree', async () => {
        const p = fakePrisma(liveCert({ province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subDistrict: 'สุเทพ', address: '88/12 หมู่ 5' }));
        const out = await certService.previewCertificateRevision('cert-1', { callerOrganizationId: ORG, prisma: p });
        expect(out.changed).toEqual([]);
    });

    it('keeps the same refusals: not active, farm location missing, other tenant', async () => {
        await expect(certService.previewCertificateRevision('cert-1', { callerOrganizationId: ORG, prisma: fakePrisma(liveCert({ status: 'suspended' })) }))
            .rejects.toMatchObject({ code: 'CERTIFICATE_NOT_REVISABLE' });
        await expect(certService.previewCertificateRevision('cert-1', { callerOrganizationId: ORG, prisma: fakePrisma(liveCert({ status: 'active', expiryDate: new Date('2026-08-26T00:00:00Z') })) }))
            .rejects.toMatchObject({ code: 'CERTIFICATE_NOT_REVISABLE', statusCode: 409 });
        await expect(certService.previewCertificateRevision('cert-1', { callerOrganizationId: ORG, prisma: fakePrisma(liveCert({ farm: { ...farm, subDistrict: '-' } })) }))
            .rejects.toMatchObject({ code: 'CERTIFICATE_FARM_LOCATION_MISSING' });
        await expect(certService.previewCertificateRevision('cert-1', { callerOrganizationId: 'org-9', prisma: fakePrisma(liveCert()) }))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('revision constants on the service instance', () => {
    it('exposes the field list and the Thai reason label', () => {
        expect(certService.CERTIFICATE_REVISION_FIELDS).toEqual(['province', 'district', 'subDistrict', 'address', 'cropType']);
        expect(Object.isFrozen(certService.CERTIFICATE_REVISION_FIELDS)).toBe(true);
        expect(certService.REVISION_REASON_LABELS_TH.SYSTEM_DATA_CORRECTION).toBe('แก้ไขข้อมูลบนใบรับรองให้ตรงกับบันทึกต้นทาง (ความผิดพลาดของระบบ)');
        expect(certService.REVISION_REASON_LABELS_TH.SYSTEM_DATA_CORRECTION).not.toMatch(/—/);
        // The one code is stamped on every revision, whichever of the
        // CERTIFICATE_REVISION_FIELDS moved, so its public label may not name
        // a correction (the farm location) that a plant-only revision did not make.
        expect(certService.REVISION_REASON_LABELS_TH.SYSTEM_DATA_CORRECTION).not.toMatch(/ที่ตั้งฟาร์ม/);
        expect(Object.isFrozen(certService.REVISION_REASON_LABELS_TH)).toBe(true);
    });
});
