/**
 * คำขอต่ออายุและใบแทน ไม่เคยถูกถามว่าเป็นพืชอะไร — และนั่นถูกแล้ว
 *
 * step1-request-type-config.ts:87-94 เขียนเหตุผลไว้ชัด: "A renewal inherits the scope of what
 * it renews, and asking again invites a filing whose scope contradicts the certificate it
 * succeeds." เหตุผลเดียวกันใช้กับพืช — ใบรับรองเดิมบอกอยู่แล้วว่าเป็นพืชอะไร (Certificate.cropType)
 * การถามซ้ำคือการเปิดช่องให้คำขอขัดกับใบที่มันต่อ
 *
 * แต่จนถึง 2026-09-07 ไม่มีใครส่งค่านั้นต่อ: ตัวแก้ dimension อ่านใบรับรองเดิมเพื่อยืนยันความ
 * เป็นเจ้าของและอายุ แล้วทิ้ง cropType ไป ⇒ `/requirements` ตอบ `PLANT_NOT_DECLARED` พร้อม
 * slots ว่างเปล่า และคำขอต่ออายุทุกใบเดินต่อไม่ได้ โดยที่เกษตรกรไม่มีช่องไหนให้แก้เลย
 * (เดินหน้าจอจริงเจอ: ต่ออายุ GACP-TH-2569-8F42A6 → 0 การ์ดเอกสารทุกขั้น ปุ่มยื่นตาย)
 *
 * พืชจึงต้องมาจากใบรับรอง ไม่ใช่จากคำถามใหม่
 */
'use strict';

const PLANT_FROM_CERT = 'cannabis';

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: {
            findFirst: jest.fn(),
        },
        // The renewal claim's SUBMIT_APPLICATION check on the holder (operator ruling 2026-10-03).
        entityMembership: { findUnique: jest.fn(async () => ({ id: 'm-1', role: 'OWNER', permissions: [], status: 'ACTIVE' })) },
        entityMemberPermissionGrant: { findMany: jest.fn(async () => []) },
    },
}));

const { prisma } = require('../../services/prisma-database');
const { resolveLawDimensions } = require('../../services/application-law-dimensions');

const OWNER = 'user-1';
const ACTIVE_CERT = {
    id: 'cert-1',
    certificateNumber: 'GACP-TH-2569-8F42A6',
    userId: OWNER,
    status: 'active',
    expiryDate: new Date(Date.now() + 365 * 86400000),
    application: { formData: { plantId: 'cannabis' }, entityId: 'entity-holder' },
};

describe('a succeeding request is judged as the plant its certificate names', () => {
    beforeEach(() => {
        prisma.certificate.findFirst.mockReset();
        prisma.certificate.findFirst.mockResolvedValue(ACTIVE_CERT);
    });

    it('การต่ออายุได้พืชมาจากใบรับรองเดิม', async () => {
        const out = await resolveLawDimensions({
            prisma, actorUserId: OWNER, filingEntityId: 'entity-holder',
            claimed: { requestType: 'RENEWAL', previousCertificateNumber: ACTIVE_CERT.certificateNumber },
        });
        expect(out.dimensions.requestType).toBe('RENEWAL');
        expect(out.dimensions.plantId).toBe(PLANT_FROM_CERT);
    });

    it('ใบแทนก็เหมือนกัน', async () => {
        const out = await resolveLawDimensions({
            prisma, actorUserId: OWNER, filingEntityId: 'entity-holder',
            claimed: { requestType: 'REPLACEMENT', previousCertificateNumber: ACTIVE_CERT.certificateNumber },
        });
        expect(out.dimensions.plantId).toBe(PLANT_FROM_CERT);
    });

    it('พืชที่คำขอประกาศไว้เองยังชนะ — ใบเก่าเติมเฉพาะตอนที่ยังไม่มีคำตอบ', async () => {
        const out = await resolveLawDimensions({
            prisma, actorUserId: OWNER, filingEntityId: 'entity-holder',
            claimed: {
                requestType: 'RENEWAL',
                previousCertificateNumber: ACTIVE_CERT.certificateNumber,
                plantId: 'turmeric',
            },
        });
        // ไม่เขียนทับ: คำขอตอบเองแล้ว ใบเก่าจึงไม่ยัดคำตอบให้
        expect(out.dimensions.plantId).toBeUndefined();
    });

    it('ใบรับรองของคนอื่น ไม่ยกพืชมาให้ และคำขอถูกลดเป็นขอใหม่', async () => {
        prisma.certificate.findFirst.mockResolvedValue({ ...ACTIVE_CERT, userId: 'someone-else' });
        const out = await resolveLawDimensions({
            prisma, actorUserId: OWNER, filingEntityId: 'entity-holder',
            claimed: { requestType: 'RENEWAL', previousCertificateNumber: ACTIVE_CERT.certificateNumber },
        });
        expect(out.dimensions.requestType).toBe('NEW');
        expect(out.dimensions.plantId ?? null).toBeNull();
        expect(out.notice.code).toBe('PREVIOUS_CERTIFICATE_NOT_YOURS');
    });
});
